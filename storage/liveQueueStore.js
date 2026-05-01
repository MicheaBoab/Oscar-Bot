const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'liveQueue.json');

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function getLiveQueue(guildId) {
  return loadStore()[guildId] || null;
}

/** 设置（或覆盖）某个 guild 的推送频道，同时清空旧消息 ID */
function setLiveQueue(guildId, channelId) {
  const store = loadStore();
  const existing = store[guildId] || {};
  store[guildId] = {
    channelId,
    messageIds: [],
    watchChannelId: existing.watchChannelId || null,
  };
  saveStore(store);
}

function setWatchChannel(guildId, watchChannelId) {
  const store = loadStore();
  const existing = store[guildId] || {};
  store[guildId] = {
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
  const store = loadStore();
  if (store[guildId]) {
    store[guildId].messageIds = messageIds;
    saveStore(store);
  }
}

function getAllLiveQueues() {
  return loadStore();
}

function removeLiveQueue(guildId) {
  const store = loadStore();
  const existing = store[guildId] || null;
  if (existing) {
    delete store[guildId];
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
