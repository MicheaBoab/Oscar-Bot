const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'announceHistory.json');
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isSafeObjectKey(key) {
  return key.length > 0 && !FORBIDDEN_KEYS.has(key);
}

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
  if (!isSafeObjectKey(guildId)) {
    return false;
  }

  if (!store[guildId] || typeof store[guildId] !== 'object') {
    store[guildId] = {};
  }

  return true;
}

function getLastAnnounce(guildId, roleAlias, textKey) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  const roleKey = normalizeKey(roleAlias);
  const textKeyNormalized = normalizeKey(textKey);

  if (!isSafeObjectKey(guildKey) || !isSafeObjectKey(roleKey) || !isSafeObjectKey(textKeyNormalized)) {
    return null;
  }

  if (!ensureGuild(store, guildKey)) {
    return null;
  }
  
  if (!store[guildKey][roleKey] || typeof store[guildKey][roleKey] !== 'object') {
    return null;
  }
  
  return store[guildKey][roleKey][textKeyNormalized] || null;
}

function setLastAnnounce(guildId, roleAlias, textKey, payload) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  const roleKey = normalizeKey(roleAlias);
  const textKeyNormalized = normalizeKey(textKey);

  if (!isSafeObjectKey(guildKey) || !isSafeObjectKey(roleKey) || !isSafeObjectKey(textKeyNormalized)) {
    return;
  }

  if (!ensureGuild(store, guildKey)) {
    return;
  }
  
  if (!store[guildKey][roleKey] || typeof store[guildKey][roleKey] !== 'object') {
    store[guildKey][roleKey] = {};
  }
  
  store[guildKey][roleKey][textKeyNormalized] = {
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
