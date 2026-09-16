const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'controlPanelStore.json');
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isSafeObjectKey(key) {
  return key.length > 0 && !FORBIDDEN_KEYS.has(key);
}

function normalizeConfig(raw) {
  return {
    channelId: typeof raw?.channelId === 'string' ? raw.channelId : null,
    messageId: typeof raw?.messageId === 'string' ? raw.messageId : null,
  };
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const safeStore = {};
    for (const [guildId, config] of Object.entries(parsed)) {
      const guildKey = normalizeKey(guildId);
      if (!isSafeObjectKey(guildKey)) continue;
      safeStore[guildKey] = normalizeConfig(config);
    }
    return safeStore;
  } catch (error) {
    console.error('[control] 读取中控台设置失败:', error.message);
    return {};
  }
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function ensureGuild(store, guildId) {
  if (!isSafeObjectKey(guildId)) return false;
  store[guildId] = normalizeConfig(store[guildId] || {});
  return true;
}

function getControlPanelConfig(guildId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;
  return store[guildKey];
}

function getAllControlPanelConfigs() {
  return loadStore();
}

function setControlPanelChannel(guildId, channelId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;

  store[guildKey].channelId = String(channelId);
  store[guildKey].messageId = null;
  saveStore(store);
  return store[guildKey];
}

function updateControlPanelMessageId(guildId, messageId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return null;

  store[guildKey].messageId = messageId ? String(messageId) : null;
  saveStore(store);
  return store[guildKey];
}

function saveControlPanelLocation(guildId, location) {
  const store = loadStore();
  const key = normalizeKey(guildId);
  if (!ensureGuild(store, key)) throw new Error('Invalid guild');
  store[key] = normalizeConfig(location);
  saveStore(store);
  return store[key];
}

module.exports = {
  saveControlPanelLocation,
  getControlPanelConfig,
  getAllControlPanelConfigs,
  setControlPanelChannel,
  updateControlPanelMessageId,
};
