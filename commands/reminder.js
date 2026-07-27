const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const {
  getReminderConfig,
  setReminderChannel,
  setReminderRole,
  setReminderBoardChannel,
  addReminder,
  getGuildReminders,
  removeReminder,
} = require('../storage/reminderStore');
const { forceRefreshReminderBoard } = require('../helper/reminderScheduler');
const {
  DEFAULT_REMINDER_TIMEZONE,
  formatClockTime,
  normalizeReminderName,
  isValidTimezone,
  parseClockTime,
  parseIsoDate,
  weekdayFromIsoDate,
  formatWeekdayLabel,
  getZonedDateParts,
  findUnixForLocalTime,
  computeNextReminderOccurrenceUnix,
} = require('../helper/reminderUtils');

const TIMEZONE_MARKER_MAP = {
  UTC: 'UTC',
  GMT: 'UTC',
  ET: 'America/New_York',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  CT: 'America/Chicago',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  MT: 'America/Denver',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  PT: 'America/Los_Angeles',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
};

function resolveTimezoneCode(markerRaw) {
  if (!markerRaw) return null;
  const upperMarker = String(markerRaw).trim().toUpperCase();
  const timezone = TIMEZONE_MARKER_MAP[upperMarker] || null;
  if (!timezone || !isValidTimezone(timezone)) return null;
  return { marker: upperMarker, timezone };
}

function toDotDate(isoDate) {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  return `${String(parsed.month).padStart(2, '0')}.${String(parsed.day).padStart(2, '0')}.${String(parsed.year).padStart(4, '0')}`;
}

function parseDotDateToIso(value) {
  const match = String(value || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) return null;

  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = parseIsoDate(iso);
  if (!parsed) return null;
  return parsed.dateKey;
}

function parseReminderRuleInput(value) {
  const source = String(value || '').trim().replace(/\s+/g, '');
  if (!source) {
    return { ok: false, error: '❌ 频率不能为空，请输入例如：每周日、每两周周三。' };
  }

  const weekdayMap = {
    '日': 0,
    '天': 0,
    '一': 1,
    '二': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
  };

  let match = source.match(/^每周(?:周|星期)?([天日一二三四五六])$/);
  if (match) {
    return {
      ok: true,
      frequencyWeeks: 1,
      weekday: weekdayMap[match[1]],
      normalizedRuleText: `每周${match[1]}`,
    };
  }

  match = source.match(/^每(?:隔)?(?:两|2)周(?:周|星期)?([天日一二三四五六])$/);
  if (match) {
    return {
      ok: true,
      frequencyWeeks: 2,
      weekday: weekdayMap[match[1]],
      normalizedRuleText: `每两周周${match[1]}`,
    };
  }

  return {
    ok: false,
    error: '❌ 频率格式无效。示例：每周日、每周三、每两周周一、每2周周五、每隔两周周三。',
  };
}

function parseReminderSendTimeInput(value) {
  const source = String(value || '').trim();
  if (!source) {
    return { ok: false, error: '❌ 提醒发出时间不能为空。必须填写“HH:MM TZ”，示例：20:30 CDT。' };
  }

  const tokens = source.split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) {
    return {
      ok: false,
      error: '❌ 提醒发出时间必须填写“时间 + 时区代码”。格式：HH:MM TZ，示例：20:30 CDT。',
    };
  }

  const timePart = String(tokens[0] || '').trim();
  const timezoneMarkerRaw = tokens[1] ? String(tokens[1]).trim() : null;
  const parsed = parseClockTime(timePart);
  if (!parsed) {
    return {
      ok: false,
      error: '❌ 时间格式无效，请使用 24小时制 HH:MM（支持 H:MM / 中文冒号），示例：8:05、20:30、20：30。',
    };
  }

  const resolved = resolveTimezoneCode(timezoneMarkerRaw);
  if (!resolved) {
    return {
      ok: false,
      error: `❌ 时区代码 "${timezoneMarkerRaw}" 无效。支持示例：ET、CT、MT、PT、CDT、PDT、UTC；暂不支持中文地名。`,
    };
  }

  return {
    ok: true,
    hour: parsed.hour,
    minute: parsed.minute,
    sourceTimezone: resolved.timezone,
    sourceMarker: resolved.marker,
  };
}

function convertRuleTimeToTargetTimezone({ weekday, hour, minute, sourceTimezone, targetTimezone }) {
  if (!sourceTimezone || sourceTimezone === targetTimezone) {
    return { ok: true, weekday, hour, minute, converted: false };
  }

  const now = new Date();
  const sourceNowParts = getZonedDateParts(now, sourceTimezone);
  const dayOffset = (weekday - sourceNowParts.weekday + 7) % 7;
  const sourceDateKey = addDaysToIsoDate(sourceNowParts.dateKey, dayOffset);
  if (!sourceDateKey) {
    return { ok: false, error: '❌ 无法计算时区转换日期，请稍后重试。' };
  }

  const instantUnix = findUnixForLocalTime(sourceDateKey, hour, minute, sourceTimezone);
  if (!Number.isFinite(instantUnix)) {
    return { ok: false, error: '❌ 无法根据时区标识转换提醒时间，请检查输入。' };
  }

  const targetParts = getZonedDateParts(new Date(instantUnix * 1000), targetTimezone);
  if (!Number.isInteger(targetParts.weekday)) {
    return { ok: false, error: '❌ 无法读取目标时区时间，请稍后重试。' };
  }

  return {
    ok: true,
    weekday: targetParts.weekday,
    hour: targetParts.hour,
    minute: targetParts.minute,
    converted: true,
    sourceDateKey,
  };
}

function addDaysToIsoDate(dateKey, days) {
  const parsed = parseIsoDate(dateKey);
  if (!parsed || !Number.isInteger(days)) return null;
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  const year = next.getUTCFullYear();
  const month = next.getUTCMonth() + 1;
  const day = next.getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function resolveBiweeklyStartDate(weekday, timezone, activeStartDate) {
  if (activeStartDate) {
    const startWeekday = weekdayFromIsoDate(activeStartDate);
    if (startWeekday !== weekday) {
      return {
        ok: false,
        error: `❌ 活动时间开始日 ${toDotDate(activeStartDate)} 不是 ${formatWeekdayLabel(weekday)}，请调整活动时间或频率。`,
      };
    }
    return { ok: true, startDate: activeStartDate };
  }

  const parts = getZonedDateParts(new Date(), timezone);
  const offset = (weekday - parts.weekday + 7) % 7;
  const startDate = addDaysToIsoDate(parts.dateKey, offset);
  if (!startDate) {
    return { ok: false, error: '❌ 无法计算双周提醒起始日，请稍后重试。' };
  }
  return { ok: true, startDate };
}

function buildReminderLine(reminder) {
  const timezone = reminder.timezone || DEFAULT_REMINDER_TIMEZONE;
  const timezoneMarker = createMarkerFromTimezone(timezone);
  const frequencyLabel = reminder.frequencyWeeks === 2 ? '每两周' : '每周';
  const startDateLabel = reminder.frequencyWeeks === 2 && reminder.startDate
    ? `，起始日 ${reminder.startDate}`
    : '';
  const activeRangeLabel = reminder.activeStartDate || reminder.activeEndDate
    ? `，活动时间 ${reminder.activeStartDate ? toDotDate(reminder.activeStartDate) : '不限'} ~ ${reminder.activeEndDate ? toDotDate(reminder.activeEndDate) : '不限'}`
    : '';
  const nextUnix = computeNextReminderOccurrenceUnix(reminder, timezone);
  const nextLine = Number.isFinite(nextUnix)
    ? reminder.durationSeconds
      ? `，下次：<t:${nextUnix}:F> - <t:${nextUnix + reminder.durationSeconds}:t>（<t:${nextUnix}:R>）`
      : `，下次：<t:${nextUnix}:F>（<t:${nextUnix}:R>）`
    : '，下次：无法计算';
  return `• **${reminder.name}**：${frequencyLabel}${formatWeekdayLabel(reminder.weekday)} ${formatClockTime(reminder.hour, reminder.minute)} ${timezoneMarker}${startDateLabel}${activeRangeLabel}${nextLine}`;
}

function buildCreateResultMessage(reminder, config) {
  const frequencyLabel = reminder.frequencyWeeks === 2 ? '每两周' : '每周';
  const startDateLine = reminder.frequencyWeeks === 2 ? `，起始日 ${reminder.startDate}` : '';
  const activeRangeLine = reminder.activeStartDate || reminder.activeEndDate
    ? `\n活动时间：${reminder.activeStartDate ? toDotDate(reminder.activeStartDate) : '不限'} ~ ${reminder.activeEndDate ? toDotDate(reminder.activeEndDate) : '不限'}`
    : '';
  const timezone = reminder.timezone || DEFAULT_REMINDER_TIMEZONE;
  const nextUnix = computeNextReminderOccurrenceUnix(reminder, timezone);
  const nextParts = Number.isFinite(nextUnix)
    ? getZonedDateParts(new Date(nextUnix * 1000), timezone)
    : null;
  const scheduleWeekday = Number.isInteger(nextParts?.weekday) ? nextParts.weekday : reminder.weekday;
  const scheduleHour = Number.isInteger(nextParts?.hour) ? nextParts.hour : reminder.hour;
  const scheduleMinute = Number.isInteger(nextParts?.minute) ? nextParts.minute : reminder.minute;
  const nextRunLine = Number.isFinite(nextUnix)
    ? reminder.durationSeconds
      ? `\n下次触发：<t:${nextUnix}:F> - <t:${nextUnix + reminder.durationSeconds}:t>（<t:${nextUnix}:R>）`
      : `\n下次触发：<t:${nextUnix}:F>（<t:${nextUnix}:R>）`
    : '';

  return [
    `✅ 已建立 reminder：**${reminder.name}**`,
    `发送：<#${config.channelId}> · <@&${config.roleId}>`,
    `排程：${frequencyLabel}${formatWeekdayLabel(scheduleWeekday)} ${formatClockTime(scheduleHour, scheduleMinute)} ${createMarkerFromTimezone(reminder.timezone)}${startDateLine}${activeRangeLine}${nextRunLine}`,
    `内容：${reminder.message}`,
  ].join('\n');
}

function createMarkerFromTimezone(timezone) {
  if (!timezone) return '';
  const entry = Object.entries(TIMEZONE_MARKER_MAP).find(([, tz]) => tz === timezone);
  return entry ? entry[0] : timezone;
}

function buildSendTimeInputValue(reminder) {
  const marker = createMarkerFromTimezone(reminder.timezone || DEFAULT_REMINDER_TIMEZONE);
  return `${formatClockTime(reminder.hour, reminder.minute)} ${marker}`.trim();
}

function weekdayToRuleSuffix(weekday) {
  const map = ['日', '一', '二', '三', '四', '五', '六'];
  return map[weekday] || String(weekday);
}

function buildReminderRuleText(reminder) {
  const suffix = weekdayToRuleSuffix(reminder.weekday);
  if (reminder.frequencyWeeks === 2) {
    return `每两周周${suffix}`;
  }
  return `每周${suffix}`;
}

function parseActivityPeriodInput(value, options = {}) {
  const { sourceTimezone = null, targetTimezone = DEFAULT_REMINDER_TIMEZONE } = options;
  const source = String(value || '').trim();
  if (!source) {
    return { ok: true, activeStartDate: null, activeEndDate: null, effectiveTimezone: sourceTimezone || targetTimezone };
  }

  const compactRange = source.replace(/\s*-\s*/, '-');
  const tokens = compactRange.split(/\s+/).filter(Boolean);
  if (tokens.length > 2) {
    return {
      ok: false,
      error: '❌ 活动时间格式无效。只能填写“日期范围”或“日期范围 + 1个时区代码”。',
    };
  }

  const rangeToken = tokens[0] || '';
  const timezoneToken = tokens[1] || null;
  const rangeMatch = rangeToken.match(/^(\d{2}\.\d{2}\.\d{4})-(\d{2}\.\d{2}\.\d{4})$/);
  if (!rangeMatch) {
    return {
      ok: false,
      error: '❌ 活动时间格式无效。格式：MM.DD.YYYY-MM.DD.YYYY [时区]，示例：08.01.2026-10.31.2026 CDT。',
    };
  }

  const startIso = parseDotDateToIso(rangeMatch[1]);
  const endIso = parseDotDateToIso(rangeMatch[2]);
  if (!startIso || !endIso) {
    return { ok: false, error: '❌ 活动时间日期无效，请检查 MM.DD.YYYY。' };
  }

  const parsedStart = parseIsoDate(startIso);
  const parsedEnd = parseIsoDate(endIso);

  const startMs = Date.UTC(parsedStart.year, parsedStart.month - 1, parsedStart.day);
  const endMs = Date.UTC(parsedEnd.year, parsedEnd.month - 1, parsedEnd.day);
  if (endMs < startMs) {
    return { ok: false, error: '❌ 活动结束日期不能早于开始日期。' };
  }

  const explicitTz = timezoneToken ? resolveTimezoneCode(timezoneToken) : null;
  if (timezoneToken && !explicitTz) {
    return {
      ok: false,
      error: `❌ 活动时间时区代码 "${timezoneToken}" 无效。示例：08.01.2026-10.31.2026 CDT。`,
    };
  }

  const effectiveTimezone = explicitTz?.timezone || sourceTimezone || targetTimezone;

  if (effectiveTimezone !== targetTimezone) {
    const startUnix = findUnixForLocalTime(parsedStart.dateKey, 0, 0, effectiveTimezone);
    const endUnix = findUnixForLocalTime(parsedEnd.dateKey, 23, 59, effectiveTimezone);
    if (!Number.isFinite(startUnix) || !Number.isFinite(endUnix)) {
      return { ok: false, error: '❌ 无法根据活动时间时区转换日期范围，请检查输入。' };
    }

    const targetStart = getZonedDateParts(new Date(startUnix * 1000), targetTimezone);
    const targetEnd = getZonedDateParts(new Date(endUnix * 1000), targetTimezone);
    return {
      ok: true,
      activeStartDate: targetStart.dateKey,
      activeEndDate: targetEnd.dateKey,
      effectiveTimezone,
    };
  }

  return {
    ok: true,
    activeStartDate: parsedStart.dateKey,
    activeEndDate: parsedEnd.dateKey,
    effectiveTimezone,
  };
}

function createReminderFromTemplateInput({ guildId, config, name, message, frequencyRaw, activityPeriodRaw, sendTimeRaw, replaceReminderId = null }) {
  const ruleParsed = parseReminderRuleInput(frequencyRaw);
  if (!ruleParsed.ok) return ruleParsed;
  const { frequencyWeeks, weekday: ruleWeekday } = ruleParsed;

  const sendTimeParsed = parseReminderSendTimeInput(sendTimeRaw);
  if (!sendTimeParsed.ok) return sendTimeParsed;
  const scheduleTimezone = sendTimeParsed.sourceTimezone;
  const convertedTime = convertRuleTimeToTargetTimezone({
    weekday: ruleWeekday,
    hour: sendTimeParsed.hour,
    minute: sendTimeParsed.minute,
    sourceTimezone: sendTimeParsed.sourceTimezone,
    targetTimezone: scheduleTimezone,
  });
  if (!convertedTime.ok) return convertedTime;
  const { weekday, hour, minute } = convertedTime;

  const activePeriod = parseActivityPeriodInput(activityPeriodRaw, {
    sourceTimezone: sendTimeParsed.sourceTimezone,
    targetTimezone: scheduleTimezone,
  });
  if (!activePeriod.ok) return activePeriod;
  const { activeStartDate, activeEndDate } = activePeriod;

  let startDate = null;
  if (frequencyWeeks === 2) {
    const biweeklyStart = resolveBiweeklyStartDate(weekday, scheduleTimezone, activeStartDate);
    if (!biweeklyStart.ok) return biweeklyStart;
    startDate = biweeklyStart.startDate;
  }

  let removedOriginal = null;
  if (replaceReminderId) {
    removedOriginal = removeReminder(guildId, replaceReminderId);
    if (!removedOriginal) {
      return { ok: false, error: '❌ 原 reminder 不存在或已被删除，请重新操作。' };
    }
  }

  const result = addReminder(guildId, {
    name,
    message,
    weekday,
    hour,
    minute,
    timezone: scheduleTimezone,
    frequencyWeeks,
    startDate,
    activeStartDate,
    activeEndDate,
    durationSeconds: null,
  });

  if (!result.added) {
    if (removedOriginal) {
      addReminder(guildId, {
        name: removedOriginal.name,
        message: removedOriginal.message,
        weekday: removedOriginal.weekday,
        hour: removedOriginal.hour,
        minute: removedOriginal.minute,
        timezone: removedOriginal.timezone,
        frequencyWeeks: removedOriginal.frequencyWeeks,
        startDate: removedOriginal.startDate,
        activeStartDate: removedOriginal.activeStartDate,
        activeEndDate: removedOriginal.activeEndDate,
        durationSeconds: removedOriginal.durationSeconds,
      });
    }

    let error = '❌ reminder 建立失败。';
    if (result.reason === 'duplicate-name') {
      error = `❌ reminder 名称 **${name}** 已存在，请换一个名称。`;
    } else if (result.reason === 'invalid-name') {
      error = '❌ reminder 名称无效，请避免空白与保留关键字。';
    }
    return { ok: false, error };
  }

  return {
    ok: true,
    reminder: result.reminder,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reminder')
    .setDescription('管理固定时间自动提醒')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-channel')
        .setDescription('设置提醒要发送到的频道')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('提醒发送频道')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-role')
        .setDescription('设置提醒时要@的身分组')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('提醒要@的身分组')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('refresh-board')
        .setDescription('立即刷新一次倒计时看板')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('打开弹窗，一次性填写 reminder')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('按名称编辑 reminder')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('要编辑的 reminder 名称')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('列出当前所有 reminder')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('删除一个 reminder')
        .addStringOption(option =>
          option
            .setName('reminder')
            .setDescription('要删除的 reminder')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'reminder' && focused.name !== 'name') {
      await interaction.respond([]);
      return;
    }

    const reminders = getGuildReminders(interaction.guildId);
    const query = String(focused.value || '').trim().toLowerCase();
    const filtered = reminders.filter(reminder => {
      if (!query) return true;
      return reminder.name.toLowerCase().includes(query);
    }).slice(0, 25);

    await interaction.respond(
      filtered.map(reminder => ({
        name: `${reminder.name} · ${reminder.frequencyWeeks === 2 ? '每两周' : '每周'}${formatWeekdayLabel(reminder.weekday)} ${formatClockTime(reminder.hour, reminder.minute)}`,
        value: reminder.id,
      }))
    );
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (subcommand === 'set-channel') {
      const channel = interaction.options.getChannel('channel', true);
      setReminderChannel(guildId, channel.id);
      setReminderBoardChannel(guildId, channel.id);
      await interaction.reply({
        content: `✅ reminder 频道已设置为 ${channel}（提醒发送与倒计时看板共用该频道）。`,
        flags: 64,
      });

      forceRefreshReminderBoard(guildId).catch(error =>
        console.error('[reminder] set-channel 后刷新看板失败:', error.message)
      );
      return;
    }

    if (subcommand === 'set-role') {
      const role = interaction.options.getRole('role', true);
      setReminderRole(guildId, role.id);
      await interaction.reply({
        content: `✅ reminder @ 身分组已设置为 <@&${role.id}>`,
        flags: 64,
      });
      return;
    }

    if (subcommand === 'refresh-board') {
      await interaction.deferReply({ flags: 64 });
      try {
        const refreshed = await forceRefreshReminderBoard(guildId);
        if (refreshed) {
          await interaction.editReply('✅ 已立即刷新 reminder 倒计时看板。');
        } else {
          await interaction.editReply('ℹ️ 当前未设置 reminder 频道，或暂无可刷新内容。请先使用 `/reminder set-channel`。');
        }
      } catch (error) {
        await interaction.editReply('❌ 刷新看板失败。请确认已设置 /reminder set-channel，并检查 bot 权限。');
      }
      return;
    }

    if (subcommand === 'list') {
      const config = getReminderConfig(guildId) || {
        channelId: null,
        roleId: null,
        timezone: DEFAULT_REMINDER_TIMEZONE,
        reminders: [],
      };

      const reminderLines = config.reminders.length > 0
        ? config.reminders.map(reminder => buildReminderLine(reminder)).join('\n')
        : '当前还没有任何 reminder。';

      await interaction.reply({
        content: [
          '## Reminder 设置',
          `- 频道：${config.channelId ? `<#${config.channelId}>` : '未设置'}`,
          `- 身分组：${config.roleId ? `<@&${config.roleId}>` : '未设置'}`,
          '- 看板刷新：每 30 分钟（固定）',
          '',
          '## Reminder 列表',
          reminderLines,
        ].join('\n'),
        flags: 64,
      });
      return;
    }

    if (subcommand === 'remove') {
      const rawInput = interaction.options.getString('reminder', true);
      const reminders = getGuildReminders(guildId);
      const target = reminders.find(reminder => reminder.id === rawInput)
        || reminders.find(reminder => reminder.normalizedName === normalizeReminderName(rawInput));

      if (!target) {
        await interaction.reply({
          content: '❌ 找不到这个 reminder。请先用 /reminder list 确认名称。',
          flags: 64,
        });
        return;
      }

      removeReminder(guildId, target.id);
      await interaction.reply({
        content: `✅ 已删除 reminder：**${target.name}**`,
        flags: 64,
      });

      forceRefreshReminderBoard(guildId).catch(error =>
        console.error('[reminder] remove 后刷新看板失败:', error.message)
      );
      return;
    }

    if (subcommand === 'edit') {
      const rawInput = interaction.options.getString('name', true);
      const reminders = getGuildReminders(guildId);
      const target = reminders.find(reminder => reminder.id === rawInput)
        || reminders.find(reminder => reminder.normalizedName === normalizeReminderName(rawInput));

      if (!target) {
        await interaction.reply({
          content: '❌ 找不到这个 reminder。请先用 /reminder list 确认名称。',
          flags: 64,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`reminder_edit_modal_${target.id}`)
        .setTitle(`编辑提醒：${target.name}`);

      const nameInput = new TextInputBuilder()
        .setCustomId('reminder_name')
        .setLabel('名称')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('示例：weekly-boss')
        .setRequired(true)
        .setValue(target.name)
        .setMaxLength(80);

      const messageInput = new TextInputBuilder()
        .setCustomId('reminder_message')
        .setLabel('提醒内容')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('示例：世界王 15 分钟后开始集合')
        .setRequired(true)
        .setValue(target.message)
        .setMaxLength(1000);

      const frequencyInput = new TextInputBuilder()
        .setCustomId('reminder_schedule_rule')
        .setLabel('频率')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('示例：每周_ / 每_周周_（与下方时间联动）')
        .setRequired(true)
        .setValue(buildReminderRuleText(target))
        .setMaxLength(20);

      const sendTimeInput = new TextInputBuilder()
        .setCustomId('reminder_send_time')
        .setLabel('提醒发出时间（24小时制）')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('格式 HH:MM TZ，例 20:30 CDT')
        .setRequired(true)
        .setValue(buildSendTimeInputValue(target))
        .setMaxLength(40);

      const activePeriodInput = new TextInputBuilder()
        .setCustomId('reminder_activity_period')
        .setLabel('活动时间（选填）')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('格式 MM.DD.YYYY-MM.DD.YYYY [TZ]')
        .setRequired(false)
        .setValue(
          target.activeStartDate && target.activeEndDate
            ? `${toDotDate(target.activeStartDate)}-${toDotDate(target.activeEndDate)}`
            : ''
        )
        .setMaxLength(80);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(messageInput),
        new ActionRowBuilder().addComponents(frequencyInput),
        new ActionRowBuilder().addComponents(sendTimeInput),
        new ActionRowBuilder().addComponents(activePeriodInput),
      );

      await interaction.showModal(modal);
      return;
    }

    if (subcommand !== 'add') {
      return;
    }

    const config = getReminderConfig(guildId) || {
      channelId: null,
      roleId: null,
      timezone: DEFAULT_REMINDER_TIMEZONE,
      reminders: [],
    };

    if (!config.channelId) {
      await interaction.reply({
        content: '❌ 请先使用 /reminder set-channel 设置提醒频道。',
        flags: 64,
      });
      return;
    }

    if (!config.roleId) {
      await interaction.reply({
        content: '❌ 请先使用 /reminder set-role 设置提醒身分组。',
        flags: 64,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('reminder_add_modal')
      .setTitle('新增定时提醒');

    const nameInput = new TextInputBuilder()
      .setCustomId('reminder_name')
      .setLabel('名称')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('示例：weekly-boss')
      .setRequired(true)
      .setMaxLength(80);

    const messageInput = new TextInputBuilder()
      .setCustomId('reminder_message')
      .setLabel('提醒内容')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('示例：世界王 15 分钟后开始集合')
      .setRequired(true)
      .setMaxLength(1000);

    const frequencyInput = new TextInputBuilder()
      .setCustomId('reminder_schedule_rule')
      .setLabel('频率')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('示例：每周_ / 每_周周_（与下方时间联动）')
      .setRequired(true)
      .setMaxLength(20);

    const sendTimeInput = new TextInputBuilder()
      .setCustomId('reminder_send_time')
      .setLabel('提醒发出时间（24小时制）')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('格式 HH:MM TZ，例 20:30 CDT')
      .setRequired(true)
      .setMaxLength(40);

    const activePeriodInput = new TextInputBuilder()
      .setCustomId('reminder_activity_period')
      .setLabel('活动时间（选填）')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('格式 MM.DD.YYYY-MM.DD.YYYY [TZ]')
      .setRequired(false)
      .setMaxLength(80);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(messageInput),
      new ActionRowBuilder().addComponents(frequencyInput),
      new ActionRowBuilder().addComponents(sendTimeInput),
      new ActionRowBuilder().addComponents(activePeriodInput),
    );

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    const isAdd = interaction.customId === 'reminder_add_modal';
    const isEdit = interaction.customId.startsWith('reminder_edit_modal_');
    if (!isAdd && !isEdit) {
      return;
    }

    const guildId = interaction.guildId;
    const config = getReminderConfig(guildId) || {
      channelId: null,
      roleId: null,
      timezone: DEFAULT_REMINDER_TIMEZONE,
      reminders: [],
    };

    if (!config.channelId) {
      await interaction.reply({
        content: '❌ 请先使用 /reminder set-channel 设置提醒频道。',
        flags: 64,
      });
      return;
    }

    if (!config.roleId) {
      await interaction.reply({
        content: '❌ 请先使用 /reminder set-role 设置提醒身分组。',
        flags: 64,
      });
      return;
    }

    const name = interaction.fields.getTextInputValue('reminder_name').trim();
    const message = interaction.fields.getTextInputValue('reminder_message').trim();
    const frequencyRaw = interaction.fields.getTextInputValue('reminder_schedule_rule').trim();
    const sendTimeRaw = interaction.fields.getTextInputValue('reminder_send_time').trim();
    const activityPeriodRaw = interaction.fields.getTextInputValue('reminder_activity_period').trim();

    const replaceReminderId = isEdit
      ? interaction.customId.replace('reminder_edit_modal_', '')
      : null;

    const created = createReminderFromTemplateInput({
      guildId,
      config,
      name,
      message,
      frequencyRaw,
      activityPeriodRaw,
      sendTimeRaw,
      replaceReminderId,
    });

    if (!created.ok) {
      await interaction.reply({
        content: created.error,
        flags: 64,
      });
      return;
    }

    await interaction.reply({
      content: buildCreateResultMessage(created.reminder, config),
      flags: 64,
    });

    forceRefreshReminderBoard(guildId).catch(error =>
      console.error('[reminder] add/edit 后刷新看板失败:', error.message)
    );
  },
};
