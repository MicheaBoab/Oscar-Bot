const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'announceHistory.json');

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

function ensureGuild(store, guildId) {
  if (!store[guildId] || typeof store[guildId] !== 'object') {
    store[guildId] = {};
  }
}

function getLastAnnounce(guildId, textKey) {
  const store = loadStore();
  ensureGuild(store, guildId);
  const key = String(textKey || '').trim().toLowerCase();
  return store[guildId][key] || null;
}

function setLastAnnounce(guildId, textKey, payload) {
  const store = loadStore();
  ensureGuild(store, guildId);

  const key = String(textKey || '').trim().toLowerCase();
  store[guildId][key] = {
    textKey: key,
    channelId: String(payload.channelId || ''),
    messageId: String(payload.messageId || ''),
    expiresAtMs: Number.isFinite(payload.expiresAtMs) ? Number(payload.expiresAtMs) : null,
    sentAtMs: Number.isFinite(payload.sentAtMs) ? Number(payload.sentAtMs) : Date.now(),
  };

  saveStore(store);
}

module.exports = {
  getLastAnnounce,
  setLastAnnounce,
};
