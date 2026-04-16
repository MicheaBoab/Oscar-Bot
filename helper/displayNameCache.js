const DISPLAY_NAME_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 5000;

const displayNameCache = new Map();
const pendingResolutions = new Map();

function buildCacheKey(guildId, userId) {
  const scope = guildId || 'global';
  return `${scope}:${userId}`;
}

function trimCacheIfNeeded() {
  if (displayNameCache.size <= MAX_CACHE_SIZE) return;

  let removed = 0;
  for (const key of displayNameCache.keys()) {
    displayNameCache.delete(key);
    removed += 1;
    if (displayNameCache.size <= MAX_CACHE_SIZE - 500) break;
  }

  if (removed === 0) {
    displayNameCache.clear();
  }
}

async function resolveDisplayName({ guild, client, userId, fallbackName }) {
  if (!userId) return fallbackName || 'unknown';

  const key = buildCacheKey(guild?.id, userId);
  const now = Date.now();
  const cached = displayNameCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const pending = pendingResolutions.get(key);
  if (pending) {
    return pending;
  }

  const resolverPromise = (async () => {
    let name = null;

    if (guild) {
      try {
        const member = await guild.members.fetch(userId);
        if (member?.displayName) {
          name = member.displayName;
        }
      } catch {
        // Ignore guild lookup failure and fall back to user/global name.
      }
    }

    if (!name && client) {
      try {
        const user = await client.users.fetch(userId);
        if (user?.username) {
          name = user.username;
        }
      } catch {
        // Ignore user lookup failure and use fallback.
      }
    }

    const value = name || fallbackName || userId;
    displayNameCache.set(key, {
      value,
      expiresAt: Date.now() + DISPLAY_NAME_TTL_MS,
    });
    trimCacheIfNeeded();
    return value;
  })();

  pendingResolutions.set(key, resolverPromise);

  try {
    return await resolverPromise;
  } finally {
    pendingResolutions.delete(key);
  }
}

module.exports = {
  resolveDisplayName,
};