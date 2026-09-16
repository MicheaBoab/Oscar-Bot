const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const {
  getReminderConfig,
  setReminderChannel,
  setReminderRole,
  setReminderDayNightSyncAnchor,
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
  formatWeekdayShort,
  getReminderWeekdays,
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

const BD_DAY_SECONDS = 3 * 60 * 60 + 20 * 60;
const BD_NIGHT_SECONDS = 40 * 60;
const GAME_DAY_START_MINUTES = 7 * 60;
const GAME_NIGHT_START_MINUTES = 22 * 60;
const GAME_DAY_MINUTES = 15 * 60;
const GAME_NIGHT_MINUTES = 9 * 60;

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

function buildRoleMentionText(roleIds = []) {
  return (Array.isArray(roleIds) ? roleIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .map(id => `<@&${id}>`)
    .join(' ');
}

function parseSyncGameTimeInput(phaseInput, timeInput) {
  const phase = String(phaseInput || '').trim().toLowerCase();
  if (phase !== 'am' && phase !== 'pm') {
    return { ok: false, error: '❌ phase 只能是 am 或 pm。' };
  }

  const normalized = String(timeInput || '')
    .trim()
    .replace(/[：﹕︓]/g, ':')
    .replace(/\./g, ':');

  if (!normalized) {
    return { ok: false, error: '❌ 当前游戏内时间不能为空，请使用例如 7:31、12:05。' };
  }

  if (/(^|\s)(AM|PM)($|\s)/i.test(normalized)) {
    return { ok: false, error: '❌ 不需要再输入 AM/PM，phase 已经提供。' };
  }

  const match = normalized.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    return { ok: false, error: '❌ 时间格式无效，请使用 12 小时制，例如 7:31、12:05。' };
  }

  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) {
    return { ok: false, error: '❌ 12 小时制下，小时必须介于 1 到 12。' };
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { ok: false, error: '❌ 分钟必须介于 00 到 59。' };
  }

  const hour24 = phase === 'am'
    ? (hour12 === 12 ? 0 : hour12)
    : (hour12 === 12 ? 12 : hour12 + 12);

  return {
    ok: true,
    phase,
    hour12,
    hour24,
    minute,
    displayTime: `${phase} ${hour12}:${String(minute).padStart(2, '0')}`,
  };
}

function getCycleSecondsFromGameClock(hour24, minute) {
  const gameMinutes = (Number(hour24) * 60) + Number(minute);

  if (gameMinutes >= GAME_DAY_START_MINUTES && gameMinutes < GAME_NIGHT_START_MINUTES) {
    const dayElapsedMinutes = gameMinutes - GAME_DAY_START_MINUTES;
    return Math.floor((dayElapsedMinutes / GAME_DAY_MINUTES) * BD_DAY_SECONDS);
  }

  const nightElapsedMinutes = gameMinutes >= GAME_NIGHT_START_MINUTES
    ? gameMinutes - GAME_NIGHT_START_MINUTES
    : gameMinutes + (24 * 60 - GAME_NIGHT_START_MINUTES);
  const nightCycleSeconds = Math.floor((nightElapsedMinutes / GAME_NIGHT_MINUTES) * BD_NIGHT_SECONDS);
  return BD_DAY_SECONDS + nightCycleSeconds;
}

function getGamePeriodLabel(hour24) {
  return (hour24 >= 7 && hour24 < 22) ? '白天' : '夜晚';
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

const WEEKDAY_INPUT_MAP = {
  '日': 0,
  '天': 0,
  '一': 1,
  '二': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
};

const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function uniqSortedWeekdays(values) {
  return [...new Set(values
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 6))]
    .sort((a, b) => a - b);
}

function parseWeekdayListInput(value) {
  const source = String(value || '')
    .replace(/星期|礼拜|週|周/g, '')
    .replace(/[，,、]/g, '')
    .trim();
  if (!source) return [];

  const rangeMatch = source.match(/^([天日一二三四五六])(?:到|至|-)([天日一二三四五六])$/);
  if (rangeMatch) {
    const start = WEEKDAY_INPUT_MAP[rangeMatch[1]];
    const end = WEEKDAY_INPUT_MAP[rangeMatch[2]];
    if (!Number.isInteger(start) || !Number.isInteger(end)) return [];

    const weekdays = [];
    for (let day = start; ; day = (day + 1) % 7) {
      weekdays.push(day);
      if (day === end) break;
    }
    return uniqSortedWeekdays(weekdays);
  }

  if (!/^[天日一二三四五六]+$/.test(source)) return [];
  return uniqSortedWeekdays([...source].map(char => WEEKDAY_INPUT_MAP[char]));
}

function formatWeekdayList(weekdays) {
  const set = new Set(weekdays);
  return WEEKDAY_DISPLAY_ORDER
    .filter(day => set.has(day))
    .map(day => formatWeekdayShort(day))
    .join('、');
}

function buildFrequencyLabel(reminder) {
  const weekdays = getReminderWeekdays(reminder);
  if (reminder.frequencyWeeks === 2) {
    return `每两周${formatWeekdayShort(weekdays[0] ?? reminder.weekday)}`;
  }

  if (weekdays.length === 7) return '每天';
  if (weekdays.length === 5 && [1, 2, 3, 4, 5].every(day => weekdays.includes(day))) return '工作日';
  if (weekdays.length === 2 && weekdays.includes(0) && weekdays.includes(6)) return '周末';
  if (weekdays.length === 6) {
    const excluded = [0, 1, 2, 3, 4, 5, 6].find(day => !weekdays.includes(day));
    if (Number.isInteger(excluded)) return `每天除${formatWeekdayShort(excluded)}`;
  }

  return `每周${formatWeekdayList(weekdays)}`;
}

function parseReminderRuleInput(value) {
  const source = String(value || '').trim().replace(/\s+/g, '');
  if (!source) {
    return { ok: false, error: '❌ 频率不能为空，请输入例如：每天除周六、每周一三五、每两周周三。' };
  }

  const allWeekdays = [0, 1, 2, 3, 4, 5, 6];

  if (/^(每天|每日)$/.test(source)) {
    return {
      ok: true,
      frequencyWeeks: 1,
      weekday: 0,
      weekdays: allWeekdays,
      normalizedRuleText: '每天',
    };
  }

  if (/^(工作日|平日)$/.test(source)) {
    return {
      ok: true,
      frequencyWeeks: 1,
      weekday: 1,
      weekdays: [1, 2, 3, 4, 5],
      normalizedRuleText: '工作日',
    };
  }

  if (/^(周末|週末)$/.test(source)) {
    return {
      ok: true,
      frequencyWeeks: 1,
      weekday: 0,
      weekdays: [0, 6],
      normalizedRuleText: '周末',
    };
  }

  let exceptMatch = source.match(/^(?:每天|每日)(?:除了|除)(.+)$/)
    || source.match(/^(?:除了|除)(.+)(?:每天|每日)$/);
  if (exceptMatch) {
    const excluded = parseWeekdayListInput(exceptMatch[1]);
    if (excluded.length > 0 && excluded.length < 7) {
      const weekdays = allWeekdays.filter(day => !excluded.includes(day));
      return {
        ok: true,
        frequencyWeeks: 1,
        weekday: weekdays[0],
        weekdays,
        normalizedRuleText: `每天除${formatWeekdayList(excluded)}`,
      };
    }
  }

  let match = source.match(/^每周(?:周|星期)?([天日一二三四五六])$/);
  if (match) {
    const weekday = WEEKDAY_INPUT_MAP[match[1]];
    return {
      ok: true,
      frequencyWeeks: 1,
      weekday,
      weekdays: [weekday],
      normalizedRuleText: `每周${match[1]}`,
    };
  }

  match = source.match(/^每周(.+)$/) || source.match(/^周([天日一二三四五六].*)$/);
  if (match) {
    const weekdays = parseWeekdayListInput(match[1]);
    if (weekdays.length > 0) {
      return {
        ok: true,
        frequencyWeeks: 1,
        weekday: weekdays[0],
        weekdays,
        normalizedRuleText: buildFrequencyLabel({ frequencyWeeks: 1, weekday: weekdays[0], weekdays }),
      };
    }
  }

  match = source.match(/^每(?:隔)?(?:两|2)周(?:周|星期)?([天日一二三四五六])$/);
  if (match) {
    const weekday = WEEKDAY_INPUT_MAP[match[1]];
    return {
      ok: true,
      frequencyWeeks: 2,
      weekday,
      weekdays: [weekday],
      normalizedRuleText: `每两周周${match[1]}`,
    };
  }

  return {
    ok: false,
    error: '❌ 频率格式无效。示例：每天、每天除周六、每周一三五、周一到周五、工作日、周末、每两周周三。',
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

function buildCreateResultMessage(reminder, config) {
  const startDateLine = reminder.frequencyWeeks === 2 ? `，起始日 ${reminder.startDate}` : '';
  const activeRangeLine = reminder.activeStartDate || reminder.activeEndDate
    ? `\n活动时间：${reminder.activeStartDate ? toDotDate(reminder.activeStartDate) : '不限'} ~ ${reminder.activeEndDate ? toDotDate(reminder.activeEndDate) : '不限'}`
    : '';
  const timezone = reminder.timezone || DEFAULT_REMINDER_TIMEZONE;
  const nextUnix = computeNextReminderOccurrenceUnix(reminder, timezone);
  const nextParts = Number.isFinite(nextUnix)
    ? getZonedDateParts(new Date(nextUnix * 1000), timezone)
    : null;
  const scheduleHour = Number.isInteger(nextParts?.hour) ? nextParts.hour : reminder.hour;
  const scheduleMinute = Number.isInteger(nextParts?.minute) ? nextParts.minute : reminder.minute;
  const nextRunLine = Number.isFinite(nextUnix)
    ? reminder.durationSeconds
      ? `\n下次触发：<t:${nextUnix}:F> - <t:${nextUnix + reminder.durationSeconds}:t>（<t:${nextUnix}:R>）`
      : `\n下次触发：<t:${nextUnix}:F>（<t:${nextUnix}:R>）`
    : '';

  const roleMentions = buildRoleMentionText(config.roleIds || []);
  const roleLine = roleMentions || '未设置';

  return [
    `✅ 已建立 reminder：**${reminder.name}**`,
    `发送：<#${config.channelId}> · ${roleLine}（提前 10 分钟@）`,
    `排程：${buildFrequencyLabel(reminder)} ${formatClockTime(scheduleHour, scheduleMinute)} ${createMarkerFromTimezone(reminder.timezone)}${startDateLine}${activeRangeLine}${nextRunLine}`,
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

function buildReminderAddModal() {
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
    .setPlaceholder('例：每天除周六 / 每周一三五 / 每两周周三')
    .setRequired(true)
    .setMaxLength(40);

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

  return modal;
}

function buildReminderEditModal(target) {
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
    .setPlaceholder('例：每天除周六 / 每周一三五 / 每两周周三')
    .setRequired(true)
    .setValue(buildReminderRuleText(target))
    .setMaxLength(40);

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

  return modal;
}

function buildDayNightSyncModal() {
  const modal = new ModalBuilder()
    .setCustomId('reminder_daynight_modal')
    .setTitle('同步日夜看板');

  const phaseInput = new TextInputBuilder()
    .setCustomId('reminder_daynight_phase')
    .setLabel('游戏内阶段')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('am 或 pm')
    .setRequired(true)
    .setMaxLength(2);

  const timeInput = new TextInputBuilder()
    .setCustomId('reminder_daynight_time')
    .setLabel('当前游戏内时间')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('示例：7:31、12:05')
    .setRequired(true)
    .setMaxLength(8);

  modal.addComponents(
    new ActionRowBuilder().addComponents(phaseInput),
    new ActionRowBuilder().addComponents(timeInput),
  );

  return modal;
}

function findReminderByInput(guildId, rawInput) {
  const reminders = getGuildReminders(guildId);
  return reminders.find(reminder => reminder.id === rawInput)
    || reminders.find(reminder => reminder.normalizedName === normalizeReminderName(rawInput));
}

function buildReminderActionSelect(guildId, action) {
  const reminders = getGuildReminders(guildId).slice(0, 25);
  if (reminders.length === 0) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`reminder_select_${action}`)
      .setPlaceholder(action === 'edit' ? '选择要编辑的提醒' : '选择要删除的提醒')
      .addOptions(reminders.map(reminder => ({
        label: reminder.name.slice(0, 100),
        description: `${buildFrequencyLabel(reminder)} ${formatClockTime(reminder.hour, reminder.minute)}`.slice(0, 100),
        value: reminder.id,
      }))),
  );
}

function buildReminderChannelSelect() {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('reminder_channel_select')
      .setPlaceholder('选择提醒要发送到的频道')
      .addChannelTypes(ChannelType.GuildText),
  );
}

function buildReminderRoleSelect() {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('reminder_role_select')
      .setPlaceholder('选择提醒要 @ 的身分组')
      .setMinValues(1)
      .setMaxValues(5),
  );
}

async function openReminderAddModal(interaction) {
  const guildId = interaction.guildId;
  const config = getReminderConfig(guildId) || {
    channelId: null,
    roleId: null,
    roleIds: [],
    timezone: DEFAULT_REMINDER_TIMEZONE,
    reminders: [],
  };

  if (!config.channelId) {
    await interaction.reply({
      content: '❌ 请先在 reminder 看板的管理员菜单里设置提醒频道。',
      flags: 64,
    });
    return;
  }

  if (!Array.isArray(config.roleIds) || config.roleIds.length === 0) {
    await interaction.reply({
      content: '❌ 请先在 reminder 看板的管理员菜单里设置提醒身分组。',
      flags: 64,
    });
    return;
  }

  await interaction.showModal(buildReminderAddModal());
}

function canManageReminders(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
}

function weekdayToRuleSuffix(weekday) {
  const map = ['日', '一', '二', '三', '四', '五', '六'];
  return map[weekday] || String(weekday);
}

function buildReminderRuleText(reminder) {
  if (reminder.frequencyWeeks === 2) {
    const suffix = weekdayToRuleSuffix(getReminderWeekdays(reminder)[0] ?? reminder.weekday);
    return `每两周周${suffix}`;
  }
  return buildFrequencyLabel(reminder);
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
  const { frequencyWeeks, weekday: ruleWeekday, weekdays: ruleWeekdays } = ruleParsed;

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
    weekdays: frequencyWeeks === 2 ? [weekday] : (ruleWeekdays || [weekday]),
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
        weekdays: removedOriginal.weekdays,
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
        .setName('set-board-channel')
        .setDescription('设置倒计时看板要发送到的频道')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('看板发送频道')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set-board-channel') {
      const channel = interaction.options.getChannel('channel', true);
      await require('./control').configurePanel(interaction, channel.id, true);
      return;
    }
  },

  async handleButton(interaction) {
    if (!interaction.customId.startsWith('reminder_board_')) return;

    if (interaction.customId === 'reminder_board_refresh') {
      await interaction.deferReply({ flags: 64 });
      try {
        const refreshed = await forceRefreshReminderBoard(interaction.guildId);
        await interaction.editReply(refreshed ? '✅ 已刷新 reminder 看板。' : 'ℹ️ 当前暂无可刷新内容，或看板频道不可用。');
      } catch {
        await interaction.editReply('❌ 刷新看板失败，请确认看板频道存在且 bot 有权限。');
      }
      return;
    }

    if (interaction.customId === 'reminder_board_sync_daynight') {
      await interaction.showModal(buildDayNightSyncModal());
      return;
    }
  },

  async handleSelectMenu(interaction) {
    if (interaction.customId === 'reminder_admin_menu') {
      if (!canManageReminders(interaction)) {
        await interaction.reply({ content: '❌ 只有管理员可以管理 reminder。', flags: 64 });
        return;
      }

      const action = interaction.values[0];

      if (action === 'add') {
        await openReminderAddModal(interaction);
        return;
      }

      if (action === 'edit' || action === 'remove') {
        const selectRow = buildReminderActionSelect(interaction.guildId, action);
        if (!selectRow) {
          await interaction.reply({ content: '当前还没有任何 reminder。', flags: 64 });
          return;
        }

        await interaction.reply({
          content: action === 'edit' ? '请选择要编辑的 reminder。' : '请选择要删除的 reminder。',
          components: [selectRow],
          flags: 64,
        });
        return;
      }

      if (action === 'set_channel') {
        await interaction.reply({
          content: '请选择 reminder 要发送到的频道。',
          components: [buildReminderChannelSelect()],
          flags: 64,
        });
        return;
      }

      if (action === 'set_roles') {
        await interaction.reply({
          content: '请选择 reminder 要 @ 的身分组。',
          components: [buildReminderRoleSelect()],
          flags: 64,
        });
        return;
      }
    }

    if (!interaction.customId.startsWith('reminder_select_')) return;

    if (!canManageReminders(interaction)) {
      await interaction.reply({ content: '❌ 只有管理员可以管理 reminder。', flags: 64 });
      return;
    }

    const action = interaction.customId.replace('reminder_select_', '');
    const reminderId = interaction.values[0];
    const target = findReminderByInput(interaction.guildId, reminderId);

    if (!target) {
      await interaction.update({ content: '❌ 找不到这个 reminder，可能已经被删除。', components: [] });
      return;
    }

    if (action === 'edit') {
      await interaction.showModal(buildReminderEditModal(target));
      return;
    }

    if (action === 'remove') {
      removeReminder(interaction.guildId, target.id);
      await interaction.update({ content: `✅ 已删除 reminder：**${target.name}**`, components: [] });
      forceRefreshReminderBoard(interaction.guildId).catch(error =>
        console.error('[reminder] board remove 后刷新看板失败:', error.message)
      );
    }
  },

  async handleChannelSelect(interaction) {
    if (interaction.customId !== 'reminder_channel_select') return;

    if (!canManageReminders(interaction)) {
      await interaction.reply({ content: '❌ 只有管理员可以管理 reminder。', flags: 64 });
      return;
    }

    const channelId = interaction.values[0];
    setReminderChannel(interaction.guildId, channelId);
    await interaction.update({ content: `✅ reminder 发送频道已设置为 <#${channelId}>。`, components: [] });
    forceRefreshReminderBoard(interaction.guildId).catch(error =>
      console.error('[reminder] board set-channel 后刷新看板失败:', error.message)
    );
  },

  async handleRoleSelect(interaction) {
    if (interaction.customId !== 'reminder_role_select') return;

    if (!canManageReminders(interaction)) {
      await interaction.reply({ content: '❌ 只有管理员可以管理 reminder。', flags: 64 });
      return;
    }

    const roleIds = interaction.values;
    setReminderRole(interaction.guildId, roleIds);
    await interaction.update({
      content: `✅ reminder @ 身分组已设置为 ${roleIds.map(id => `<@&${id}>`).join(' ')}`,
      components: [],
    });
    forceRefreshReminderBoard(interaction.guildId).catch(error =>
      console.error('[reminder] board set-role 后刷新看板失败:', error.message)
    );
  },

  async handleModalSubmit(interaction) {
    const isAdd = interaction.customId === 'reminder_add_modal';
    const isEdit = interaction.customId.startsWith('reminder_edit_modal_');
    const isDayNight = interaction.customId === 'reminder_daynight_modal';
    if (!isAdd && !isEdit && !isDayNight) {
      return;
    }

    if (isDayNight) {
      const phase = interaction.fields.getTextInputValue('reminder_daynight_phase').trim();
      const rawTime = interaction.fields.getTextInputValue('reminder_daynight_time').trim();
      const parsed = parseSyncGameTimeInput(phase, rawTime);
      if (!parsed.ok) {
        await interaction.reply({ content: parsed.error, flags: 64 });
        return;
      }

      const cycleSeconds = getCycleSecondsFromGameClock(parsed.hour24, parsed.minute);
      setReminderDayNightSyncAnchor(interaction.guildId, Date.now() / 1000, cycleSeconds);
      await interaction.reply({
        content: [
          '✅ 已同步日夜看板。',
          `- 输入：${parsed.displayTime}`,
          `- 对应游戏时段：${getGamePeriodLabel(parsed.hour24)}`,
        ].join('\n'),
        flags: 64,
      });

      forceRefreshReminderBoard(interaction.guildId).catch(error =>
        console.error('[reminder] board sync-daynight 后刷新看板失败:', error.message)
      );
      return;
    }

    if (!canManageReminders(interaction)) {
      await interaction.reply({ content: '❌ 只有管理员可以管理 reminder。', flags: 64 });
      return;
    }

    const guildId = interaction.guildId;
    const config = getReminderConfig(guildId) || {
      channelId: null,
      roleId: null,
      roleIds: [],
      timezone: DEFAULT_REMINDER_TIMEZONE,
      reminders: [],
    };

    if (!config.channelId) {
      await interaction.reply({
        content: '❌ 请先在 reminder 看板的管理员菜单里设置提醒频道。',
        flags: 64,
      });
      return;
    }

    if (!Array.isArray(config.roleIds) || config.roleIds.length === 0) {
      await interaction.reply({
        content: '❌ 请先在 reminder 看板的管理员菜单里设置提醒身分组。',
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
  _private: {
    parseReminderRuleInput,
    buildReminderRuleText,
    buildFrequencyLabel,
    buildReminderAddModal,
    buildReminderEditModal,
    buildDayNightSyncModal,
    buildReminderChannelSelect,
    buildReminderRoleSelect,
  },
};
