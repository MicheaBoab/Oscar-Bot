const fs = require('fs');
const path = require('path');

const WATCH_STORE_PATH = path.join(__dirname, 'watchStore.json');

function loadStore() {
  if (!fs.existsSync(WATCH_STORE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(WATCH_STORE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStore(store) {
  fs.writeFileSync(WATCH_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

function ensureGuild(store, guildId) {
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
}

function getGuildWatches(guildId) {
  const store = loadStore();
  ensureGuild(store, guildId);
  return store[guildId].watches;
}

function addWatch(guildId, watch) {
  const store = loadStore();
  ensureGuild(store, guildId);

  const existing = store[guildId].watches.find(w =>
    w.userId === watch.userId
    && String(w.itemId) === String(watch.itemId)
    && (w.enhancement || null) === (watch.enhancement || null)
  );

  if (existing) return { added: false, reason: 'duplicate', watch: existing };

  const userCount = store[guildId].watches.filter(w => w.userId === String(watch.userId)).length;
  if (userCount >= 5) return { added: false, reason: 'limit', watch: null };

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id,
    userId: String(watch.userId),
    itemId: String(watch.itemId),
    itemName: String(watch.itemName || ''),
    enhancement: watch.enhancement || null,
    createdAt: Date.now(),
  };

  store[guildId].watches.push(row);
  saveStore(store);
  return { added: true, watch: row };
}

function getUserWatches(guildId, userId) {
  const store = loadStore();
  ensureGuild(store, guildId);
  return store[guildId].watches.filter(w => w.userId === String(userId));
}

function removeWatch(guildId, watchId) {
  const store = loadStore();
  ensureGuild(store, guildId);
  const before = store[guildId].watches.length;
  store[guildId].watches = store[guildId].watches.filter(w => w.id !== String(watchId));
  if (store[guildId].watches.length < before) {
    delete store[guildId].lastSeenMatches[String(watchId)];
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
  ensureGuild(store, guildId);
  store[guildId].lastSeenMatches[String(watchId)] = Boolean(isMatched);
  saveStore(store);
}

function getLastSeenMatch(guildId, watchId) {
  const store = loadStore();
  ensureGuild(store, guildId);
  return Boolean(store[guildId].lastSeenMatches[String(watchId)]);
}

module.exports = {
  getGuildWatches,
  getUserWatches,
  addWatch,
  removeWatch,
  getAllWatchGuilds,
  setLastSeenMatch,
  getLastSeenMatch,
};
