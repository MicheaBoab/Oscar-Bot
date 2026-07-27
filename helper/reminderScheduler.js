const { EmbedBuilder } = require('discord.js');
const {
  getAllReminderConfigs,
  updateReminderLastTriggered,
  updateReminderBoardMessageId,
} = require('../storage/reminderStore');
const {
  buildReminderSlotKey,
  computeNextReminderOccurrenceUnix,
  getZonedDateParts,
  matchesReminderDate,
  isReminderActiveOnDate,
  parseReminderSlotKey,
  findUnixForLocalTime,
} = require('./reminderUtils');

const CHECK_INTERVAL_MS = 30 * 1000;
const BOARD_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
let schedulerClient = null;
let schedulerTimer = null;
let schedulerInFlight = false;
const boardLastUpdatedAt = new Map();

function clearSchedulerTimer() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

function getTriggeredSlot(reminder, timezone, now = new Date()) {
  const parts = getZonedDateParts(now, timezone);
  if (parts.weekday !== reminder.weekday) return null;
  if (parts.hour !== reminder.hour || parts.minute !== reminder.minute) return null;
  if (!isReminderActiveOnDate(reminder, parts.dateKey)) return null;
  if (!matchesReminderDate(reminder, parts.dateKey)) return null;

  const slotKey = buildReminderSlotKey(parts.dateKey, reminder.hour, reminder.minute);
  if (reminder.lastTriggeredKey === slotKey) return null;

  return slotKey;
}

async function processGuildReminders(client, guildId, config) {
  if (!config || !Array.isArray(config.reminders) || config.reminders.length === 0) return;
  if (!config.channelId || !config.roleId) return;

  try {
    getZonedDateParts(new Date(), config.timezone);
  } catch {
    console.error(`[reminder] guild ${guildId} 时区无效: ${config.timezone}`);
    return;
  }

  let channel = null;
  try {
    channel = await client.channels.fetch(config.channelId);
  } catch {
    console.error(`[reminder] guild ${guildId} 无法获取频道 ${config.channelId}`);
    return;
  }

  if (!channel || typeof channel.send !== 'function') {
    console.error(`[reminder] guild ${guildId} 频道 ${config.channelId} 不可发送消息`);
    return;
  }

  for (const reminder of config.reminders) {
    const reminderTimezone = reminder.timezone || config.timezone;
    let slotKey = null;
    try {
      slotKey = getTriggeredSlot(reminder, reminderTimezone);
    } catch (error) {
      console.error(`[reminder] guild ${guildId} 计算提醒 ${reminder.name} 时失败:`, error.message);
      continue;
    }
    if (!slotKey) continue;

    const slot = parseReminderSlotKey(slotKey);
    const eventUnix = slot
      ? findUnixForLocalTime(slot.dateKey, slot.hour, slot.minute, reminderTimezone)
      : null;
    const endUnix = Number.isFinite(eventUnix) && Number.isInteger(reminder.durationSeconds)
      ? eventUnix + reminder.durationSeconds
      : null;
    const countdownLine = Number.isFinite(eventUnix)
      ? Number.isFinite(endUnix)
        ? `\n📅 活动时间：<t:${eventUnix}:F> - <t:${endUnix}:t>（<t:${eventUnix}:R>）`
        : `\n📅 活动时间：<t:${eventUnix}:F>（<t:${eventUnix}:R>）`
      : '';

    try {
      await channel.send({
        content: `<@&${config.roleId}>\n⏰ **${reminder.name}**${countdownLine}\n${reminder.message}`,
        allowedMentions: { roles: [config.roleId] },
      });
      updateReminderLastTriggered(guildId, reminder.id, slotKey);
    } catch (error) {
      console.error(`[reminder] guild ${guildId} 发送提醒 ${reminder.name} 失败:`, error.message);
    }
  }
}

function shouldRefreshBoard(guildId, config, forceRefresh = false) {
  if (forceRefresh) return true;
  const lastUpdated = boardLastUpdatedAt.get(guildId) || 0;
  return (Date.now() - lastUpdated) >= BOARD_REFRESH_INTERVAL_MS;
}

function buildBoardEmbed(guildId, config, nowUnix) {
  const reminders = Array.isArray(config.reminders) ? config.reminders : [];

  const entries = reminders
    .map(reminder => {
      const timezone = reminder.timezone || config.timezone;
      const nextUnix = computeNextReminderOccurrenceUnix(reminder, timezone);
      return { reminder, nextUnix };
    })
    .filter(entry => Number.isFinite(entry.nextUnix))
    .sort((a, b) => a.nextUnix - b.nextUnix)
    .slice(0, 20);

  const descriptionLines = [
    `最后更新：<t:${nowUnix}:F>`,
    '',
  ];

  if (entries.length === 0) {
    descriptionLines.push('当前没有可计算的未来提醒。请先使用 `/reminder add` 新增条目。');
  } else {
    for (let i = 0; i < entries.length; i += 1) {
      const { reminder, nextUnix } = entries[i];
      const messagePreview = String(reminder.message || '').replace(/\s+/g, ' ').trim();
      descriptionLines.push(`**${i + 1}. ${reminder.name}**`);
      descriptionLines.push(`• ${messagePreview || '（无）'}`);
      descriptionLines.push(`• 倒计时：<t:${nextUnix}:F>（<t:${nextUnix}:R>）`);
      descriptionLines.push('');
    }
  }

  return new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle('📌 活动提醒看板')
    .setDescription(descriptionLines.join('\n'));
}

async function refreshReminderBoardForGuild(client, guildId, config, options = {}) {
  const forceRefresh = options.forceRefresh === true;
  if (!config || !config.boardChannelId) return false;
  if (!shouldRefreshBoard(guildId, config, forceRefresh)) return false;

  let channel;
  try {
    channel = await client.channels.fetch(config.boardChannelId);
  } catch {
    console.error(`[reminder] guild ${guildId} 无法获取看板频道 ${config.boardChannelId}`);
    return false;
  }

  if (!channel || typeof channel.send !== 'function') {
    console.error(`[reminder] guild ${guildId} 看板频道 ${config.boardChannelId} 不可发送消息`);
    return false;
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const embed = buildBoardEmbed(guildId, config, nowUnix);
  const payload = {
    content: '🧭 固定时间提醒看板（自动刷新）',
    embeds: [embed],
    allowedMentions: { parse: [] },
  };

  let sentMessage = null;
  if (config.boardMessageId) {
    try {
      const oldMessage = await channel.messages.fetch(config.boardMessageId);
      sentMessage = await oldMessage.edit(payload);
    } catch {
      sentMessage = null;
    }
  }

  if (!sentMessage) {
    try {
      sentMessage = await channel.send(payload);
    } catch (error) {
      console.error(`[reminder] guild ${guildId} 发送看板失败:`, error.message);
      return false;
    }
  }

  updateReminderBoardMessageId(guildId, sentMessage.id);
  boardLastUpdatedAt.set(guildId, Date.now());
  return true;
}

async function runReminderScan(client) {
  const configs = getAllReminderConfigs();
  for (const [guildId, config] of Object.entries(configs)) {
    await processGuildReminders(client, guildId, config);
    await refreshReminderBoardForGuild(client, guildId, config);
  }
}

function scheduleNextRun() {
  if (!schedulerClient) return;
  clearSchedulerTimer();
  schedulerTimer = setTimeout(async () => {
    try {
      schedulerInFlight = true;
      await runReminderScan(schedulerClient);
    } catch (error) {
      console.error('[reminder] 自动检查失败:', error);
    } finally {
      schedulerInFlight = false;
      scheduleNextRun();
    }
  }, CHECK_INTERVAL_MS);
}

function startReminderScheduler(client) {
  schedulerClient = client;
  console.log('⏰ 定时提醒调度已启动（每30秒检查一次；看板每30分钟刷新，固定）');
  scheduleNextRun();
}

async function forceRefreshReminderBoard(guildId) {
  if (!schedulerClient) {
    throw new Error('scheduler not started');
  }
  const configs = getAllReminderConfigs();
  const config = configs[String(guildId || '').trim().toLowerCase()];
  if (!config) {
    throw new Error('guild config not found');
  }
  return refreshReminderBoardForGuild(schedulerClient, String(guildId).trim().toLowerCase(), config, { forceRefresh: true });
}

module.exports = {
  startReminderScheduler,
  runReminderScan,
  getTriggeredSlot,
  forceRefreshReminderBoard,
  refreshReminderBoardForGuild,
};