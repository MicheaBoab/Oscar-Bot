const DEFAULT_REMINDER_TIMEZONE = 'Asia/Taipei';
const DISCORD_TS_TEMPLATE_REGEX = /^<t:(\d{1,12})(?::([tTdDfFRsS]))?>$/;

const WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const WEEKDAY_NAMES_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_SHORT_TO_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseClockTime(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[：﹕︓]/g, ':');
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

function formatClockTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeReminderName(value) {
  return String(value || '').trim().toLowerCase();
}

function parseReminderTimeTemplate(value) {
  const source = String(value || '').trim();
  if (!source) return null;

  const templateMatch = source.match(DISCORD_TS_TEMPLATE_REGEX);
  if (templateMatch) {
    const unix = Number(templateMatch[1]);
    if (!Number.isFinite(unix) || unix <= 0) return null;
    return {
      unix,
      format: templateMatch[2] || null,
      raw: source,
    };
  }

  if (/^\d{1,12}$/.test(source)) {
    const unix = Number(source);
    if (!Number.isFinite(unix) || unix <= 0) return null;
    return { unix, format: null, raw: source };
  }

  return null;
}

function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseIsoDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const utcDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    utcDate.getUTCFullYear() !== year
    || utcDate.getUTCMonth() !== month - 1
    || utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

function weekdayFromIsoDate(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0)).getUTCDay();
}

function dateKeyToSerial(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return Math.floor(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / 86400000);
}

function compareDateKeys(a, b) {
  const aSerial = dateKeyToSerial(a);
  const bSerial = dateKeyToSerial(b);
  if (!Number.isInteger(aSerial) || !Number.isInteger(bSerial)) return null;
  if (aSerial === bSerial) return 0;
  return aSerial < bSerial ? -1 : 1;
}

function addDaysToDateKey(dateKey, days) {
  const parsed = parseIsoDate(dateKey);
  if (!parsed || !Number.isInteger(days)) return null;
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  const year = next.getUTCFullYear();
  const month = next.getUTCMonth() + 1;
  const day = next.getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getZonedDateParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  return {
    weekday: WEEKDAY_SHORT_TO_INDEX[parts.weekday],
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function getLocalScheduleFromUnix(unix, timezone) {
  if (!Number.isFinite(unix) || unix <= 0) return null;
  const parts = getZonedDateParts(new Date(unix * 1000), timezone);
  if (!Number.isInteger(parts.weekday)) return null;
  return {
    weekday: parts.weekday,
    hour: parts.hour,
    minute: parts.minute,
    dateKey: parts.dateKey,
    unix,
  };
}

function matchesReminderDate(reminder, dateKey) {
  if (!reminder || reminder.frequencyWeeks === 1) return true;

  const currentSerial = dateKeyToSerial(dateKey);
  const startSerial = dateKeyToSerial(reminder.startDate);
  if (!Number.isInteger(currentSerial) || !Number.isInteger(startSerial)) return false;
  if (currentSerial < startSerial) return false;

  return (currentSerial - startSerial) % 14 === 0;
}

function isReminderActiveOnDate(reminder, dateKey) {
  if (!reminder) return false;
  if (!parseIsoDate(dateKey)) return false;

  if (reminder.activeStartDate) {
    const cmpStart = compareDateKeys(dateKey, reminder.activeStartDate);
    if (cmpStart === null || cmpStart < 0) return false;
  }

  if (reminder.activeEndDate) {
    const cmpEnd = compareDateKeys(dateKey, reminder.activeEndDate);
    if (cmpEnd === null || cmpEnd > 0) return false;
  }

  return true;
}

function buildReminderSlotKey(dateKey, hour, minute) {
  return `${dateKey}T${formatClockTime(hour, minute)}`;
}

function parseReminderSlotKey(slotKey) {
  const match = String(slotKey || '').trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const dateKey = match[1];
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (!parseIsoDate(dateKey)) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { dateKey, hour, minute };
}

function findUnixForLocalTime(dateKey, hour, minute, timezone) {
  const parsed = parseIsoDate(dateKey);
  if (!parsed) return null;

  const baseGuess = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour, minute, 0);
  const searchStart = baseGuess - 24 * 60 * 60 * 1000;
  const searchEnd = baseGuess + 24 * 60 * 60 * 1000;

  for (let ts = searchStart; ts <= searchEnd; ts += 60 * 1000) {
    const parts = getZonedDateParts(new Date(ts), timezone);
    if (
      parts.dateKey === dateKey
      && parts.hour === hour
      && parts.minute === minute
    ) {
      return Math.floor(ts / 1000);
    }
  }

  return null;
}

function computeNextReminderOccurrenceUnix(reminder, timezone, fromDate = new Date()) {
  const nowParts = getZonedDateParts(fromDate, timezone);
  const fromMs = fromDate.getTime();

  for (let dayOffset = 0; dayOffset <= 400; dayOffset += 1) {
    const candidateDateKey = addDaysToDateKey(nowParts.dateKey, dayOffset);
    if (!candidateDateKey) continue;

    const weekday = weekdayFromIsoDate(candidateDateKey);
    if (weekday !== reminder.weekday) continue;
    if (!isReminderActiveOnDate(reminder, candidateDateKey)) continue;
    if (!matchesReminderDate(reminder, candidateDateKey)) continue;

    const unix = findUnixForLocalTime(candidateDateKey, reminder.hour, reminder.minute, timezone);
    if (!Number.isFinite(unix)) continue;
    if (unix * 1000 <= fromMs) continue;

    return unix;
  }

  return null;
}

function formatWeekdayLabel(weekday) {
  return WEEKDAY_LABELS[weekday] || `星期${weekday}`;
}

function formatWeekdayShort(weekday) {
  return WEEKDAY_NAMES_ZH[weekday] || `周${weekday}`;
}

module.exports = {
  DEFAULT_REMINDER_TIMEZONE,
  parseClockTime,
  formatClockTime,
  normalizeReminderName,
  parseReminderTimeTemplate,
  isValidTimezone,
  parseIsoDate,
  weekdayFromIsoDate,
  compareDateKeys,
  isReminderActiveOnDate,
  getLocalScheduleFromUnix,
  getZonedDateParts,
  matchesReminderDate,
  buildReminderSlotKey,
  parseReminderSlotKey,
  findUnixForLocalTime,
  computeNextReminderOccurrenceUnix,
  formatWeekdayLabel,
  formatWeekdayShort,
};