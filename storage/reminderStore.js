const fs = require('fs');
const path = require('path');
const {
  DEFAULT_REMINDER_TIMEZONE,
  normalizeReminderName,
  parseIsoDate,
  isValidTimezone,
} = require('../helper/reminderUtils');

const STORE_PATH = path.join(__dirname, 'reminderStore.json');
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isSafeObjectKey(key) {
  return key.length > 0 && !FORBIDDEN_KEYS.has(key);
}

function normalizeReminder(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const weekday = Number(raw.weekday);
  const hour = Number(raw.hour);
  const minute = Number(raw.minute);
  const frequencyWeeks = Number(raw.frequencyWeeks) === 2 ? 2 : 1;
  const timezone = typeof raw.timezone === 'string' && raw.timezone.trim()
    ? raw.timezone.trim()
    : DEFAULT_REMINDER_TIMEZONE;
  const parsedStartDate = raw.startDate ? parseIsoDate(raw.startDate) : null;
  const parsedActiveStartDate = raw.activeStartDate ? parseIsoDate(raw.activeStartDate) : null;
  const parsedActiveEndDate = raw.activeEndDate ? parseIsoDate(raw.activeEndDate) : null;

  if (!String(raw.id || '').trim()) return null;
  if (!String(raw.name || '').trim()) return null;
  if (!String(raw.message || '').trim()) return null;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!isValidTimezone(timezone)) return null;
  if (frequencyWeeks === 2 && !parsedStartDate) return null;
  if (raw.activeStartDate && !parsedActiveStartDate) return null;
  if (raw.activeEndDate && !parsedActiveEndDate) return null;
  if (raw.durationSeconds !== null && raw.durationSeconds !== undefined) {
    const durationSeconds = Number(raw.durationSeconds);
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) return null;
  }

  return {
    id: String(raw.id),
    name: String(raw.name),
    normalizedName: normalizeReminderName(raw.name),
    message: String(raw.message),
    weekday,
    hour,
    minute,
    frequencyWeeks,
    timezone,
    startDate: parsedStartDate ? parsedStartDate.dateKey : null,
    activeStartDate: parsedActiveStartDate ? parsedActiveStartDate.dateKey : null,
    activeEndDate: parsedActiveEndDate ? parsedActiveEndDate.dateKey : null,
    durationSeconds: raw.durationSeconds === null || raw.durationSeconds === undefined
      ? null
      : Number(raw.durationSeconds),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    lastTriggeredKey: raw.lastTriggeredKey ? String(raw.lastTriggeredKey) : null,
  };
}

function normalizeRoleIds(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map(value => String(value || '').trim()).filter(Boolean);
  }

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}

function normalizeGuildConfig(raw) {
  const reminders = Array.isArray(raw?.reminders)
    ? raw.reminders.map(normalizeReminder).filter(Boolean)
    : [];

  return {
    channelId: typeof raw?.channelId === 'string' ? raw.channelId : null,
    roleId: typeof raw?.roleId === 'string' ? raw.roleId : null,
    roleIds: normalizeRoleIds(raw?.roleIds || raw?.roleId),
    timezone: typeof raw?.timezone === 'string' && raw.timezone.trim()
      ? raw.timezone.trim()
      : DEFAULT_REMINDER_TIMEZONE,
    boardChannelId: typeof raw?.boardChannelId === 'string' ? raw.boardChannelId : null,
    boardMessageId: typeof raw?.boardMessageId === 'string' ? raw.boardMessageId : null,
    reminders,
  };
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};

    const safeStore = {};
    for (const [guildId, config] of Object.entries(parsed)) {
      const guildKey = normalizeKey(guildId);
      if (!isSafeObjectKey(guildKey)) continue;
      safeStore[guildKey] = normalizeGuildConfig(config);
    }
    return safeStore;
  } catch {
    return {};
  }
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

function ensureGuild(store, guildId) {
  if (!isSafeObjectKey(guildId)) return false;
  if (!store[guildId]) {
    store[guildId] = normalizeGuildConfig({});
  } else {
    store[guildId] = normalizeGuildConfig(store[guildId]);
  }
  return true;
}

function getReminderConfig(guildId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;
  return store[guildKey];
}

function getAllReminderConfigs() {
  return loadStore();
}

function setReminderChannel(guildId, channelId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;
  store[guildKey].channelId = String(channelId);
  saveStore(store);
  return store[guildKey];
}

function setReminderRole(guildId, roleIds) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;

  const normalizedRoleIds = Array.isArray(roleIds)
    ? roleIds.map(value => String(value || '').trim()).filter(Boolean)
    : [String(roleIds || '').trim()].filter(Boolean);

  store[guildKey].roleIds = normalizedRoleIds;
  store[guildKey].roleId = normalizedRoleIds[0] || null;
  saveStore(store);
  return store[guildKey];
}

function setReminderTimezone(guildId, timezone) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;
  store[guildKey].timezone = String(timezone).trim() || DEFAULT_REMINDER_TIMEZONE;
  saveStore(store);
  return store[guildKey];
}

function setReminderBoardChannel(guildId, channelId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;

  store[guildKey].boardChannelId = String(channelId);
  // 切换看板频道后重建消息，避免编辑旧频道消息失败。
  store[guildKey].boardMessageId = null;
  saveStore(store);
  return store[guildKey];
}

function updateReminderBoardMessageId(guildId, messageId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;

  store[guildKey].boardMessageId = messageId ? String(messageId) : null;
  saveStore(store);
  return store[guildKey];
}

function addReminder(guildId, reminderInput) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) {
    return { added: false, reason: 'invalid-guild', reminder: null };
  }

  const normalizedName = normalizeReminderName(reminderInput.name);
  if (!normalizedName || !isSafeObjectKey(normalizedName)) {
    return { added: false, reason: 'invalid-name', reminder: null };
  }

  const existing = store[guildKey].reminders.find(reminder => reminder.normalizedName === normalizedName);
  if (existing) {
    return { added: false, reason: 'duplicate-name', reminder: existing };
  }

  const reminder = normalizeReminder({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: String(reminderInput.name).trim(),
    message: String(reminderInput.message).trim(),
    weekday: reminderInput.weekday,
    hour: reminderInput.hour,
    minute: reminderInput.minute,
    frequencyWeeks: reminderInput.frequencyWeeks,
    timezone: reminderInput.timezone || store[guildKey].timezone || DEFAULT_REMINDER_TIMEZONE,
    startDate: reminderInput.startDate || null,
    activeStartDate: reminderInput.activeStartDate || null,
    activeEndDate: reminderInput.activeEndDate || null,
    durationSeconds: reminderInput.durationSeconds || null,
    createdAt: Date.now(),
    lastTriggeredKey: null,
  });

  if (!reminder) {
    return { added: false, reason: 'invalid-reminder', reminder: null };
  }

  store[guildKey].reminders.push(reminder);
  saveStore(store);
  return { added: true, reminder };
}

function getGuildReminders(guildId) {
  const config = getReminderConfig(guildId);
  return Array.isArray(config?.reminders) ? config.reminders : [];
}

function removeReminder(guildId, reminderId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;

  const index = store[guildKey].reminders.findIndex(reminder => reminder.id === String(reminderId));
  if (index === -1) return null;

  const removed = store[guildKey].reminders.splice(index, 1)[0] || null;
  saveStore(store);
  return removed;
}

function updateReminderLastTriggered(guildId, reminderId, slotKey) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return false;

  const reminder = store[guildKey].reminders.find(entry => entry.id === String(reminderId));
  if (!reminder) return false;

  reminder.lastTriggeredKey = String(slotKey);
  saveStore(store);
  return true;
}

module.exports = {
  getReminderConfig,
  getAllReminderConfigs,
  setReminderChannel,
  setReminderRole,
  setReminderTimezone,
  setReminderBoardChannel,
  updateReminderBoardMessageId,
  addReminder,
  getGuildReminders,
  removeReminder,
  updateReminderLastTriggered,
};