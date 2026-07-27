const fs = require('fs');
const path = require('path');

const WATCH_STORE_PATH = path.join(__dirname, 'watchStore.json');
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_WATCHES_PER_USER = 15;

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isSafeObjectKey(key) {
  return key.length > 0 && !FORBIDDEN_KEYS.has(key);
}

function loadStore() {
  if (!fs.existsSync(WATCH_STORE_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(WATCH_STORE_PATH, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return {};

    const safeStore = {};
    for (const [guildId, guildData] of Object.entries(parsed)) {
      const guildKey = normalizeKey(guildId);
      if (!isSafeObjectKey(guildKey)) continue;
      safeStore[guildKey] = guildData;
    }
    return safeStore;
  } catch {
    return {};
  }
}

function saveStore(store) {
  fs.writeFileSync(WATCH_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

function ensureGuild(store, guildId) {
  if (!isSafeObjectKey(guildId)) {
    return false;
  }

  if (!store[guildId]) {
    store[guildId] = {
      watches: [],
      lastSeenMatches: {},
    };
  }

  if (!Array.isArray(store[guildId].watches)) {
    store[guildId].watches = [];
  }

  if (!store[guildId].lastSeenMatches || typeof store[guildId].lastSeenMatches !== 'object') {
    store[guildId].lastSeenMatches = {};
  }

  return true;
}

function getGuildWatches(guildId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return [];
  return store[guildKey].watches;
}

function addWatch(guildId, watch) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) {
    return { added: false, reason: 'invalid-guild', watch: null };
  }

  const existing = store[guildKey].watches.find(w =>
    w.userId === watch.userId
    && String(w.itemId) === String(watch.itemId)
    && (w.enhancement || null) === (watch.enhancement || null)
  );

  if (existing) return { added: false, reason: 'duplicate', watch: existing };

  const userCount = store[guildKey].watches.filter(w => w.userId === String(watch.userId)).length;
  if (userCount >= MAX_WATCHES_PER_USER) return { added: false, reason: 'limit', watch: null };

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id,
    userId: String(watch.userId),
    itemId: String(watch.itemId),
    itemName: String(watch.itemName || ''),
    enhancement: watch.enhancement || null,
    createdAt: Date.now(),
  };

  store[guildKey].watches.push(row);
  saveStore(store);
  return { added: true, watch: row };
}

function getUserWatches(guildId, userId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return [];
  return store[guildKey].watches.filter(w => w.userId === String(userId));
}

function removeWatch(guildId, watchId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return false;
  const before = store[guildKey].watches.length;
  store[guildKey].watches = store[guildKey].watches.filter(w => w.id !== String(watchId));
  if (store[guildKey].watches.length < before) {
    delete store[guildKey].lastSeenMatches[String(watchId)];
    saveStore(store);
    return true;
  }
  return false;
}

function getAllWatchGuilds() {
  return loadStore();
}

function setLastSeenMatch(guildId, watchId, isMatched) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return;
  store[guildKey].lastSeenMatches[String(watchId)] = Boolean(isMatched);
  saveStore(store);
}

function getLastSeenMatch(guildId, watchId) {
  const store = loadStore();
  const guildKey = normalizeKey(guildId);
  if (!ensureGuild(store, guildKey)) return false;
  return Boolean(store[guildKey].lastSeenMatches[String(watchId)]);
}

module.exports = {
  MAX_WATCHES_PER_USER,
  getGuildWatches,
  getUserWatches,
  addWatch,
  removeWatch,
  getAllWatchGuilds,
  setLastSeenMatch,
  getLastSeenMatch,
};
