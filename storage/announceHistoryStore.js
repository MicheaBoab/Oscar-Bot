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

function getLastAnnounce(guildId, roleAlias, textKey) {
  const store = loadStore();
  ensureGuild(store, guildId);
  const roleKey = String(roleAlias || '').trim().toLowerCase();
  const textKeyNormalized = String(textKey || '').trim().toLowerCase();
  
  if (!store[guildId][roleKey] || typeof store[guildId][roleKey] !== 'object') {
    return null;
  }
  
  return store[guildId][roleKey][textKeyNormalized] || null;
}

function setLastAnnounce(guildId, roleAlias, textKey, payload) {
  const store = loadStore();
  ensureGuild(store, guildId);

  const roleKey = String(roleAlias || '').trim().toLowerCase();
  const textKeyNormalized = String(textKey || '').trim().toLowerCase();
  
  if (!store[guildId][roleKey] || typeof store[guildId][roleKey] !== 'object') {
    store[guildId][roleKey] = {};
  }
  
  store[guildId][roleKey][textKeyNormalized] = {
    textKey: textKeyNormalized,
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
