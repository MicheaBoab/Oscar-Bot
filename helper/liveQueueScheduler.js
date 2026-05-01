const { resolveItemMeta } = require('../storage/itemNameStore');
const { ensureLocalIcon } = require('../storage/localIconStore');
const { getAllLiveQueues, updateMessageIds } = require('../storage/liveQueueStore');
const { getGuildWatches, getLastSeenMatch, setLastSeenMatch } = require('../storage/watchStore');
const {
  parseWaitList,
  formatDisplayName,
  formatEnhancement,
  buildMessagePayload,
  EMBEDS_PER_MSG,
  REGION_BASE_URL,
} = require('../commands/showqueue');

const SCAN_INTERVAL_MS = 60 * 1000; // 1 分钟
const ICON_CONCURRENCY = 5;
let schedulerClient = null;
let schedulerTimer = null;
let schedulerInFlight = false;

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

async function prepareItems(items) {
  const prepared = new Array(items.length);
  for (let i = 0; i < items.length; i += ICON_CONCURRENCY) {
    const batch = items.slice(i, i + ICON_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (item) => {
        const itemMeta = resolveItemMeta(item.itemId);
        const displayName = formatDisplayName(itemMeta, item.itemId);
        const localIconPath = itemMeta?.icon
          ? await ensureLocalIcon(item.itemId, itemMeta.icon)
          : null;
        return { item, displayName, localIconPath };
      })
    );
    results.forEach((r, j) => { prepared[i + j] = r; });
  }
  return prepared;
}

function normalizeEnhancementLabel(value) {
  if (value === null || value === undefined) return 'BASE';
  const text = String(value).trim().toUpperCase().replace(/\s+/g, '');
  return text || 'BASE';
}

async function sendWatchNotifications(channel, guildId, preparedItems) {
  const watches = getGuildWatches(guildId);
  if (!Array.isArray(watches) || watches.length === 0) return;

  for (const watch of watches) {
    const matchedEntry = preparedItems.find(({ item }) => {
      if (String(item.itemId) !== String(watch.itemId)) return false;
      if (!watch.enhancement) return true;
      const currentEnhance = normalizeEnhancementLabel(formatEnhancement(item.sid));
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
      }
    }

    if (wasMatched !== isMatched) {
      setLastSeenMatch(guildId, watch.id, isMatched);
    }
  }
}

async function doQueueUpdateForGuild(client, guildId) {
  const allQueues = getAllLiveQueues();
  const config = allQueues[guildId];
  if (!config) return;

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

  // 拉取队列，失败则静默跳过本次更新
  let activeItems = [];
  try {
    const items = await fetchQueueItems();
    const now = Math.floor(Date.now() / 1000);
    // 过滤掉已超时超过 1 分钟的物品
    activeItems = items.filter(item =>
      !Number.isFinite(item.liveAtUnix) || item.liveAtUnix > now - 60
    );
  } catch (err) {
    console.error(`[liveQueue] guild ${guildId} 拉取队列失败:`, err.message);
    return;
  }

  // 准备物品数据（并发下载图标）
  const preparedItems = activeItems.length > 0 ? await prepareItems(activeItems) : [];

  if (watchChannel) {
    await sendWatchNotifications(watchChannel, guildId, preparedItems);
  }

  if (!queueChannel) {
    return;
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
    } catch {
      // 消息不存在或不可访问，忽略
    }
  }

  const finalMessageIds = [];
  try {
    for (let i = 0; i < desiredPayloads.length; i++) {
      const payload = desiredPayloads[i];
      const existingMessage = currentMessages[i];

      if (existingMessage) {
        const edited = await existingMessage.edit(payload);
        finalMessageIds.push(edited.id);
      } else {
        const created = await queueChannel.send(payload);
        finalMessageIds.push(created.id);
      }
    }
  } catch (err) {
    console.error(`[liveQueue] guild ${guildId} 更新消息失败:`, err.message);
    return;
  }

  for (let i = desiredPayloads.length; i < currentMessages.length; i++) {
    try {
      await currentMessages[i].delete();
    } catch {
      // 消息已被删除，忽略
    }
  }

  updateMessageIds(guildId, finalMessageIds);
}

async function runAllGuilds(client) {
  const allQueues = getAllLiveQueues();
  for (const guildId of Object.keys(allQueues)) {
    await doQueueUpdateForGuild(client, guildId);
  }
}

function scheduleNextRun() {
  if (!schedulerClient) return;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
  }
  schedulerTimer = setTimeout(async () => {
    try {
      schedulerInFlight = true;
      await runAllGuilds(schedulerClient);
    } catch (err) {
      console.error('[liveQueue] 自动扫描失败:', err);
    } finally {
      schedulerInFlight = false;
      scheduleNextRun();
    }
  }, SCAN_INTERVAL_MS);
}

function startLiveQueueScheduler(client) {
  schedulerClient = client;
  console.log('📡 市场队列自动更新已启动（每1分钟扫描一次）');
  scheduleNextRun();
}

async function forceRefreshAndReset(guildId) {
  if (!schedulerClient) {
    throw new Error('scheduler not started');
  }
  if (schedulerInFlight) {
    throw new Error('refresh in progress');
  }

  schedulerInFlight = true;
  try {
    if (guildId) {
      await doQueueUpdateForGuild(schedulerClient, guildId);
    } else {
      await runAllGuilds(schedulerClient);
    }
  } finally {
    schedulerInFlight = false;
    scheduleNextRun();
  }
}

module.exports = {
  startLiveQueueScheduler,
  doQueueUpdateForGuild,
  forceRefreshAndReset,
};
