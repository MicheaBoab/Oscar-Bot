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
  parseReminderSlotKey,
  findUnixForLocalTime,
} = require('./reminderUtils');

const CHECK_INTERVAL_MS = 30 * 1000;
const BOARD_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const BD_DAY_SECONDS = 3 * 60 * 60 + 20 * 60;
const BD_NIGHT_SECONDS = 40 * 60;
const BD_CYCLE_SECONDS = BD_DAY_SECONDS + BD_NIGHT_SECONDS;
const BD_UTC_OFFSET_SECONDS = 3 * 60 * 60 + 40 * 60;
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

function getTriggeredSlots(reminder, timezone, now = new Date()) {
  const nowTs = now.getTime();
  const fromDate = new Date(nowTs - 60 * 1000);
  const nextUnix = computeNextReminderOccurrenceUnix(reminder, timezone, fromDate);
  if (!Number.isFinite(nextUnix)) return [];

  const nowParts = getZonedDateParts(now, timezone);
  const triggerCandidates = [
    { kind: 'pre-10m', unix: nextUnix - 10 * 60 },
  ];

  return triggerCandidates
    .map(candidate => {
      const candidateParts = getZonedDateParts(new Date(candidate.unix * 1000), timezone);
      const isCurrentMinute = candidateParts.dateKey === nowParts.dateKey
        && candidateParts.hour === nowParts.hour
        && candidateParts.minute === nowParts.minute;
      if (!isCurrentMinute) return null;

      const slotKey = buildReminderSlotKey(candidateParts.dateKey, candidateParts.hour, candidateParts.minute, candidate.kind);
      return { slotKey, kind: candidate.kind, unix: candidate.unix };
    })
    .filter(Boolean)
    .filter(entry => entry.unix >= Math.floor(nowTs / 1000) - 60);
}

function getTriggeredSlot(reminder, timezone, now = new Date()) {
  const slots = getTriggeredSlots(reminder, timezone, now);
  return slots[0]?.slotKey || null;
}

function resolveEventStartUnix(triggerUnix, kind) {
  if (!Number.isFinite(triggerUnix)) return null;
  if (kind === 'pre-10m') return triggerUnix + 10 * 60;
  return triggerUnix;
}

function getDayNightSummary(now = new Date(), config = {}) {
  const nowSeconds = now.getTime() / 1000;
  const anchorUnix = Number(config.dayNightAnchor?.unix);
  const anchorCycleSeconds = Number(config.dayNightAnchor?.cycleSeconds);
  let cycleSeconds;

  if (Number.isFinite(anchorUnix) && anchorUnix > 0 && Number.isFinite(anchorCycleSeconds)) {
    cycleSeconds = anchorCycleSeconds + (nowSeconds - anchorUnix);
  } else {
    const utcMidnightSeconds = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ) / 1000;
    cycleSeconds = ((nowSeconds - utcMidnightSeconds) + BD_UTC_OFFSET_SECONDS);
  }

  cycleSeconds = ((cycleSeconds % BD_CYCLE_SECONDS) + BD_CYCLE_SECONDS) % BD_CYCLE_SECONDS;
  const currentType = cycleSeconds < BD_DAY_SECONDS ? 'day' : 'night';
  const secondsUntilNextCycle = currentType === 'day'
    ? BD_DAY_SECONDS - cycleSeconds
    : BD_CYCLE_SECONDS - cycleSeconds;
  const secondsUntilNextOpposite = secondsUntilNextCycle + (currentType === 'day' ? BD_NIGHT_SECONDS : BD_DAY_SECONDS);
  const nextCycleUnix = Math.floor(nowSeconds + secondsUntilNextCycle);
  const nextOppositeUnix = Math.floor(nowSeconds + secondsUntilNextOpposite);

  return {
    currentType,
    currentLabel: currentType === 'day' ? '☀️ 白天' : '🌙 夜晚',
    firstLabel: currentType === 'day' ? '🌙 夜晚还有' : '☀️ 白天还有',
    secondLabel: currentType === 'day' ? '☀️ 下一个白天还有' : '🌙 下一个夜晚还有',
    firstCountdown: `<t:${nextCycleUnix}:R>`,
    secondCountdown: `<t:${nextOppositeUnix}:R>`,
  };
}

async function processGuildReminders(client, guildId, config) {
  if (!config || !Array.isArray(config.reminders) || config.reminders.length === 0) return;

  if (!config.boardChannelId) {
    return;
  }

  const roleIds = Array.isArray(config.roleIds) && config.roleIds.length > 0
    ? config.roleIds
    : (config.roleId ? [config.roleId] : []);

  if (!config.channelId || roleIds.length === 0) return;

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
    let triggerSlots = [];
    try {
      triggerSlots = getTriggeredSlots(reminder, reminderTimezone);
    } catch (error) {
      console.error(`[reminder] guild ${guildId} 计算提醒 ${reminder.name} 时失败:`, error.message);
      continue;
    }

    for (const trigger of triggerSlots) {
      // Deduplicate by slot key to avoid repeated sends in the same trigger window.
      if (String(reminder.lastTriggeredKey || '') === String(trigger.slotKey || '')) {
        continue;
      }

      const slot = parseReminderSlotKey(trigger.slotKey);
      const triggerUnixFromSlot = slot
        ? findUnixForLocalTime(slot.dateKey, slot.hour, slot.minute, reminderTimezone)
        : null;
      const eventUnix = resolveEventStartUnix(triggerUnixFromSlot, trigger.kind);
      const endUnix = Number.isFinite(eventUnix) && Number.isInteger(reminder.durationSeconds)
        ? eventUnix + reminder.durationSeconds
        : null;
      const countdownLine = Number.isFinite(eventUnix)
        ? Number.isFinite(endUnix)
          ? `\n📅 活动时间：<t:${eventUnix}:F> - <t:${endUnix}:t>（<t:${eventUnix}:R>）`
          : `\n📅 活动时间：<t:${eventUnix}:F>（<t:${eventUnix}:R>）`
        : '';
      const kindLabel = trigger.kind === 'pre-10m'
        ? '\n🕒 提前 10 分钟提醒'
        : '';

      try {
        await channel.send({
          content: `${roleIds.map(id => `<@&${id}>`).join(' ')}\n⏰ **${reminder.name}**${kindLabel}${countdownLine}\n${reminder.message}`,
          allowedMentions: { roles: roleIds },
        });
        updateReminderLastTriggered(guildId, reminder.id, trigger.slotKey);
      } catch (error) {
        console.error(`[reminder] guild ${guildId} 发送提醒 ${reminder.name} 失败:`, error.message);
      }
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
    .slice(0, 20);

  const dayNightSummary = getDayNightSummary(new Date(nowUnix * 1000), config);

  const descriptionLines = [
    `🕒 最后更新：<t:${nowUnix}:R>`,
    '⚠️ 日夜提示为规则推算，仅为大概时间，非绝对准确，请以游戏内时间为准。',
    '',
    '## 日夜提示',
    `- 当前：${dayNightSummary.currentLabel}`,
    `- ${dayNightSummary.firstLabel}：${dayNightSummary.firstCountdown}`,
    `- ${dayNightSummary.secondLabel}：${dayNightSummary.secondCountdown}`,
    '',
    '## 活动提醒',
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
  const boardChannelId = config.boardChannelId || null;
  if (!boardChannelId) return false;
  if (!shouldRefreshBoard(guildId, config, forceRefresh)) return false;

  let channel;
  try {
    channel = await client.channels.fetch(boardChannelId);
  } catch {
    console.error(`[reminder] guild ${guildId} 无法获取看板频道 ${boardChannelId}`);
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