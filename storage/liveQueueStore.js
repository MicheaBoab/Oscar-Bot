const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'liveQueue.json');
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isSafeObjectKey(key) {
  return key.length > 0 && !FORBIDDEN_KEYS.has(key);
}

function normalizeGuildConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    channelId: typeof raw.channelId === 'string' ? raw.channelId : null,
    messageIds: Array.isArray(raw.messageIds) ? raw.messageIds : [],
    watchChannelId: typeof raw.watchChannelId === 'string' ? raw.watchChannelId : null,
  };
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    const normalized = {};
    for (const [guildId, config] of Object.entries(raw)) {
      const guildKey = normalizeKey(guildId);
      if (!isSafeObjectKey(guildKey)) continue;

      const clean = normalizeGuildConfig(config);
      if (clean) normalized[guildKey] = clean;
    }
    return normalized;
  } catch {
    return {};
  }
}

function saveStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function getLiveQueue(guildId) {
  const guildKey = normalizeKey(guildId);
  if (!isSafeObjectKey(guildKey)) return null;
  return loadStore()[guildKey] || null;
}

/** 设置（或覆盖）某个 guild 的推送频道，同时清空旧消息 ID */
function setLiveQueue(guildId, channelId) {
  const guildKey = normalizeKey(guildId);
  if (!isSafeObjectKey(guildKey)) return;

  const store = loadStore();
  const existing = store[guildKey] || {};
  store[guildKey] = {
    channelId,
    messageIds: [],
    watchChannelId: existing.watchChannelId || null,
  };
  saveStore(store);
}

function setWatchChannel(guildId, watchChannelId) {
  const guildKey = normalizeKey(guildId);
  if (!isSafeObjectKey(guildKey)) return;

  const store = loadStore();
  const existing = store[guildKey] || {};
  store[guildKey] = {
    channelId: existing.channelId || null,
    messageIds: Array.isArray(existing.messageIds) ? existing.messageIds : [],
    watchChannelId,
  };
  saveStore(store);
}

function getWatchChannel(guildId) {
  const config = getLiveQueue(guildId);
  if (!config) return null;
  return config.watchChannelId || null;
}

/** 更新已发送消息的 ID 列表 */
function updateMessageIds(guildId, messageIds) {
  const guildKey = normalizeKey(guildId);
  if (!isSafeObjectKey(guildKey)) return;

  const store = loadStore();
  if (store[guildKey]) {
    store[guildKey].messageIds = messageIds;
    saveStore(store);
  }
}

function getAllLiveQueues() {
  return loadStore();
}

function removeLiveQueue(guildId) {
  const guildKey = normalizeKey(guildId);
  if (!isSafeObjectKey(guildKey)) return null;

  const store = loadStore();
  const existing = store[guildKey] || null;
  if (existing) {
    delete store[guildKey];
    saveStore(store);
  }
  return existing;
}

module.exports = {
  getLiveQueue,
  setLiveQueue,
  setWatchChannel,
  getWatchChannel,
  updateMessageIds,
  getAllLiveQueues,
  removeLiveQueue,
};
