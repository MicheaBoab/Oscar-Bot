const { resolveItemMeta } = require('../storage/itemNameStore');
const { writeEnhRangeToTable } = require('../storage/itemNameStore');
const { ensureLocalIcon } = require('../storage/localIconStore');
const queueStore = require('../storage/liveQueueStore');
const { getGuildWatches, getLastSeenMatch, setLastSeenMatch } = require('../storage/watchStore');
const {
  parseWaitList,
  formatDisplayName,
  formatEnhancementWithRange,
  buildMessagePayload,
  EMBEDS_PER_MSG,
  REGION_BASE_URL,
  resolveEnhRange,
} = require('./marketQueueFormatting');

const SCAN_INTERVAL_MS = 60 * 1000; // 1 分钟
const ICON_CONCURRENCY = 5;
let schedulerClient = null;
let schedulerTimer = null;
const inFlight = new Map();
const lastManualRefresh = new Map();
const REFRESH_COOLDOWN_MS = 10000;

async function fetchQueueItems() {
  const url = `${REGION_BASE_URL.na}/Trademarket/GetWorldMarketWaitList`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'BlackDesert',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (data.resultCode !== 0) throw new Error(`resultCode=${data.resultCode}`);
  return parseWaitList(data.resultMsg);
}

async function prepareItems(items, pendingRangeUpdates, current = () => true) {
  const prepared = new Array(items.length);
  for (let i = 0; i < items.length; i += ICON_CONCURRENCY) {
    if (!current()) return [];
    const batch = items.slice(i, i + ICON_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (item) => {
        const itemMeta = resolveItemMeta(item.itemId);
        const displayName = formatDisplayName(itemMeta, item.itemId);
        const localIconPath = itemMeta?.icon
          ? await ensureLocalIcon(item.itemId, itemMeta.icon)
          : null;
        const enhRange = pendingRangeUpdates[item.itemId] || {};
        return { item, displayName, localIconPath, enhRange, enhanceTag: itemMeta?.enhanceTag || 'none' };
      })
    );
    results.forEach((r, j) => { prepared[i + j] = r; });
  }
  return prepared;
}

function normalizeEnhancementLabel(value) {
  if (value === null || value === undefined) return 'BASE';
  const text = String(value).trim().toUpperCase().replace(/\s+/g, '');
  const numberMatch = text.match(/^\+?(\d+)$/);
  if (numberMatch) return numberMatch[1];
  return text || 'BASE';
}

async function sendWatchNotifications(channel, guildId, preparedItems, current = () => true) {
  const watches = getGuildWatches(guildId);
  if (!Array.isArray(watches) || watches.length === 0) return;

  for (const watch of watches) {
    if (!current()) return;
    const matchedEntry = preparedItems.find(({ item, enhRange, enhanceTag }) => {
      if (String(item.itemId) !== String(watch.itemId)) return false;
      if (!watch.enhancement) return true;
      const range = enhRange || {};
      const formattedEnhancement = formatEnhancementWithRange(item.sid, range.wmEnhMin, range.wmEnhMax, enhanceTag);
      const fallbackEnhancement = Number(item.sid) === 0 ? 'BASE' : String(item.sid);
      const currentEnhance = normalizeEnhancementLabel(formattedEnhancement ?? fallbackEnhancement);
      return currentEnhance === normalizeEnhancementLabel(watch.enhancement);
    });

    const wasMatched = getLastSeenMatch(guildId, watch.id);
    const isMatched = Boolean(matchedEntry);

    if (isMatched && !wasMatched) {
      const payload = buildMessagePayload([matchedEntry]);
      payload.content = `🔔 <@${watch.userId}> 你关注的物品已进入队列：**${watch.itemName || matchedEntry.displayName.title}**`;
      try {
        await channel.send(payload);
      } catch (err) {
        console.error(`[liveQueue] guild ${guildId} 发送 watch 通知失败:`, err.message);
        continue;
      }
    }

    if (current() && wasMatched !== isMatched) {
      setLastSeenMatch(guildId, watch.id, isMatched);
    }
  }
}

async function performQueueUpdate(client, guildId) {
  const allQueues = queueStore.getAllLiveQueues();
  const config = allQueues[guildId];
  if (!config) return { status: 'unconfigured' };
  if (config.active === false) return { status: 'stopped' };
  const current = () => { const latest = queueStore.getLiveQueue(guildId); return latest?.active !== false && latest?.revision === config.revision; };
  if (!current()) return { status: 'stopped' };

  let queueChannel = null;
  const queueChannelId = config.channelId || null;
  if (queueChannelId) {
    try {
      queueChannel = await client.channels.fetch(queueChannelId);
      if (!queueChannel) {
        console.error(`[liveQueue] guild ${guildId} 无法获取频道 ${queueChannelId}`);
      }
    } catch {
      console.error(`[liveQueue] guild ${guildId} 无法获取频道 ${queueChannelId}`);
    }
  }

  let watchChannel = null;
  const watchChannelId = config.watchChannelId || null;
  if (watchChannelId) {
    try {
      watchChannel = await client.channels.fetch(watchChannelId);
      if (!watchChannel) {
        console.error(`[liveQueue] guild ${guildId} 无法获取 watch 频道 ${watchChannelId}`);
      }
    } catch {
      console.error(`[liveQueue] guild ${guildId} 无法获取 watch 频道 ${watchChannelId}`);
    }
  }

  if ((queueChannelId && !queueChannel) || (watchChannelId && !watchChannel)) {
    throw new Error('通知频道不可用，请管理员重新设置。');
  }
  if (!queueChannel && !watchChannel) throw new Error('尚未设置通知频道。');

  // 拉取最新数据；失败交由调用方报告并在下次扫描重试。
  let activeItems = [];
  try {
    if (!current()) return { status: 'stopped' };
    const items = await fetchQueueItems();
    const now = Math.floor(Date.now() / 1000);
    // 过滤掉已超时超过 1 分钟的物品
    activeItems = items.filter(item =>
      !Number.isFinite(item.liveAtUnix) || item.liveAtUnix > now - 60
    );
  } catch (err) {
    console.error(`[liveQueue] guild ${guildId} 拉取队列失败:`, err.message);
    throw err;
  }

  // 对去重 itemId 拉取强化范围（in-memory pending，最后批量写入 JSON）
  const pendingRangeUpdates = {};
  if (activeItems.length > 0) {
    const uniqueItemIds = [...new Set(activeItems.map(i => i.itemId))];
    for (let i = 0; i < uniqueItemIds.length; i += ICON_CONCURRENCY) {
      if (!current()) return { status: 'stopped' };
      await Promise.all(
        uniqueItemIds.slice(i, i + ICON_CONCURRENCY).map(id =>
          resolveEnhRange(id, REGION_BASE_URL.na, pendingRangeUpdates)
        )
      );
    }
  }

  // 准备物品数据（并发下载图标）
  if (!current()) return { status: 'stopped' };
  const preparedItems = activeItems.length > 0 ? await prepareItems(activeItems, pendingRangeUpdates, current) : [];

  if (!current()) return { status: 'stopped' };
  if (watchChannel) {
    await sendWatchNotifications(watchChannel, guildId, preparedItems, current);
  }

  if (!current()) return { status: 'stopped' };
  if (!queueChannel) {
    writeEnhRangeToTable(pendingRangeUpdates);
    return { status: 'updated' };
  }

  // 分块（Discord 每条消息最多 10 个 embed）
  const chunks = [];
  for (let i = 0; i < preparedItems.length; i += EMBEDS_PER_MSG) {
    chunks.push(preparedItems.slice(i, i + EMBEDS_PER_MSG));
  }

  const desiredPayloads = [];
  if (chunks.length > 0) {
    for (let i = 0; i < chunks.length; i++) {
      const payload = buildMessagePayload(chunks[i]);
      payload.content = i === 0
        ? `**World Market WaitList（NA）— 共 ${activeItems.length} 条**`
        : null;
      desiredPayloads.push(payload);
    }
  } else {
    desiredPayloads.push({
      content: `📭 当前市场队列为空`,
      embeds: [],
      files: [],
    });
  }

  const currentMessageIds = Array.isArray(config.messageIds) ? config.messageIds : [];
  const currentMessages = [];
  for (const msgId of currentMessageIds) {
    try {
      const message = await queueChannel.messages.fetch(msgId);
      currentMessages.push(message);
    } catch (error) {
      if (error.code !== 10008) throw error;
      // 消息不存在或不可访问，忽略
    }
  }

  const finalMessageIds = [];
  try {
    for (let i = 0; i < desiredPayloads.length; i++) {
      if (!current()) return { status: 'stopped' };
      const payload = desiredPayloads[i];
      const existingMessage = currentMessages[i];

      if (existingMessage) {
        const edited = await existingMessage.edit(payload);
        finalMessageIds.push(edited.id);
        queueStore.updateMessageIds(guildId, [...finalMessageIds, ...currentMessages.slice(i + 1).map(m => m.id)], queueChannelId);
      } else {
        const created = await queueChannel.send(payload);
        finalMessageIds.push(created.id);
        queueStore.updateMessageIds(guildId, [...finalMessageIds, ...currentMessages.slice(i + 1).map(m => m.id)], queueChannelId);
      }
    }
  } catch (err) {
    console.error(`[liveQueue] guild ${guildId} 更新消息失败:`, err.message);
    throw err;
  }

  if (!current()) return { status: 'stopped' };
  for (let i = desiredPayloads.length; i < currentMessages.length; i++) {
    if (!current()) return { status: 'stopped' };
    try {
      await currentMessages[i].delete();
    } catch {
      // 消息已被删除，忽略
    }
  }

  queueStore.updateMessageIds(guildId, finalMessageIds, queueChannelId);

  // 所有 embed 更新完毕，批量将本轮新拉取的范围写入 JSON
  writeEnhRangeToTable(pendingRangeUpdates);
  return { status: 'updated' };
}

async function runAllGuilds(client) {
  const allQueues = queueStore.getAllLiveQueues();
  for (const guildId of Object.keys(allQueues)) {
    try { await doQueueUpdateForGuild(client, guildId); } catch (error) { console.error('[market]', guildId, error.message); }
  }
}

function scheduleNextRun() {
  if (!schedulerClient) return;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
  }
  schedulerTimer = setTimeout(async () => {
    try {
      await runAllGuilds(schedulerClient);
    } catch (err) {
      console.error('[liveQueue] 自动扫描失败:', err);
    } finally {
      scheduleNextRun();
    }
  }, SCAN_INTERVAL_MS);
}

function startLiveQueueScheduler(client) {
  schedulerClient = client;
  console.log('📡 市场队列自动更新已启动（每1分钟扫描一次）');
  scheduleNextRun();
}

function doQueueUpdateForGuild(client, guildId) {
  if (inFlight.has(guildId)) return inFlight.get(guildId);
  const task = performQueueUpdate(client, guildId).finally(() => { if (inFlight.get(guildId) === task) inFlight.delete(guildId); });
  inFlight.set(guildId, task);
  return task;
}
async function refreshMarket(client, guildId) {
  const config = queueStore.getLiveQueue(guildId);
  if (!config) return { status: 'unconfigured' };
  if (config.active === false) return { status: 'stopped' };
  if (inFlight.has(guildId)) return inFlight.get(guildId);
  if (Date.now() - (lastManualRefresh.get(guildId) || 0) < REFRESH_COOLDOWN_MS) return { status: 'cooldown' };
  lastManualRefresh.set(guildId, Date.now());
  return doQueueUpdateForGuild(client, guildId);
}
async function waitForGuildUpdate(guildId) {
  await inFlight.get(guildId)?.catch(() => {});
}
// Legacy name remains callable, but manual refresh no longer resets the schedule.
async function forceRefreshAndReset(guildId) {
  if (!schedulerClient) throw new Error('scheduler not started');
  return refreshMarket(schedulerClient, guildId);
}
module.exports = { startLiveQueueScheduler, doQueueUpdateForGuild, refreshMarket, waitForGuildUpdate, forceRefreshAndReset };
