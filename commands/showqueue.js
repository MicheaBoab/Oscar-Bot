const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { resolveItemMeta, writeEnhRangeToTable } = require('../storage/itemNameStore');
const { ensureLocalIcon } = require('../storage/localIconStore');

// 强化范围缓存 TTL：半年
const ENH_RANGE_TTL_MS = 6 * 30 * 24 * 60 * 60 * 1000;

const EMBEDS_PER_MSG = 10; // Discord limit is 10 embeds per message

const REGION_BASE_URL = {
  eu: 'https://eu-trade.naeu.playblackdesert.com',
  na: 'https://na-trade.naeu.playblackdesert.com',
  sea: 'https://trade.sea.playblackdesert.com',
  mena: 'https://trade.tr.playblackdesert.com',
  kr: 'https://trade.kr.playblackdesert.com',
  tw: 'https://trade.tw.playblackdesert.com',
  th: 'https://trade.th.playblackdesert.com',
  jp: 'https://trade.jp.playblackdesert.com',
  ru: 'https://trade.ru.playblackdesert.com',
};

function parseWaitList(resultMsg) {
  const text = String(resultMsg || '').trim();
  if (!text) return [];

  return text
    .split('|')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const parts = entry.split('-');
      if (parts.length < 4) {
        return null;
      }

      const [itemId, sid, price, unixTs] = parts;
      const ts = Number(unixTs);

      if (!itemId) return null;

      return {
        itemId,
        sid,
        price: Number(price),
        liveAtUnix: Number.isFinite(ts) ? ts : null,
        hitAt: Number.isFinite(ts) ? new Date(ts * 1000) : null,
      };
    })
    .filter(Boolean);
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return '未知';
  return value.toLocaleString('en-US');
}

function formatDisplayName(itemMeta, itemId) {
  const nameEN = String(itemMeta?.name || '').trim();
  if (nameEN) return { title: nameEN };
  return { title: `未知物品(${itemId})` };
}

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const ENHANCE_STAGE_LABELS = ['PRI', 'DUO', 'TRI', 'TET', 'PEN', 'HEX', 'SEP', 'OCT', 'NOV', 'DEC'];

// 解析 GetWorldMarketSubList 的 resultMsg，返回该物品所有行的强化级别集合
function parseSubList(resultMsg) {
  const text = String(resultMsg || '').trim();
  if (!text) return [];

  return text
    .split('|')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const parts = entry.split('-');
      if (parts.length < 10) return null;
      const enhMin = Number(parts[1]);
      const enhMax = Number(parts[2]);
      if (!Number.isFinite(enhMin) || !Number.isFinite(enhMax)) return null;
      return { enhMin, enhMax };
    })
    .filter(Boolean);
}

// 调用 GetWorldMarketSubList，返回 { wmEnhMin, wmEnhMax, wmRangeUpdatedAt }
// 若 API 返回空则写入 sentinel（min/max 均为 null）
async function fetchSubListRange(itemId, baseUrl) {
  const url = `${baseUrl}/Trademarket/GetWorldMarketSubList`;
  const now = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'BlackDesert' },
      body: JSON.stringify({ keyType: 0, mainKey: Number(itemId) }),
    });
    if (!response.ok) return { wmEnhMin: null, wmEnhMax: null, wmRangeUpdatedAt: now };
    const data = await response.json();
    if (data.resultCode !== 0) return { wmEnhMin: null, wmEnhMax: null, wmRangeUpdatedAt: now };
    const rows = parseSubList(data.resultMsg);
    if (rows.length === 0) return { wmEnhMin: null, wmEnhMax: null, wmRangeUpdatedAt: now };
    const wmEnhMin = Math.min(...rows.map(r => r.enhMin));
    const wmEnhMax = Math.max(...rows.map(r => r.enhMax));
    return { wmEnhMin, wmEnhMax, wmRangeUpdatedAt: now };
  } catch {
    return { wmEnhMin: null, wmEnhMax: null, wmRangeUpdatedAt: now };
  }
}

// 判断某个 itemId 是否需要拉取强化范围
async function resolveEnhRange(itemId, baseUrl, pendingRangeUpdates) {
  // 1. 优先用本轮 in-memory pending
  if (pendingRangeUpdates[itemId] !== undefined) return pendingRangeUpdates[itemId];

  // 2. 再查本地 JSON
  const meta = resolveItemMeta(itemId);
  if (meta && meta.wmRangeUpdatedAt !== undefined) {
    const expired = (Date.now() - meta.wmRangeUpdatedAt) > ENH_RANGE_TTL_MS;
    if (!expired) {
      pendingRangeUpdates[itemId] = { wmEnhMin: meta.wmEnhMin ?? null, wmEnhMax: meta.wmEnhMax ?? null, wmRangeUpdatedAt: meta.wmRangeUpdatedAt };
      return pendingRangeUpdates[itemId];
    }
  }

  // 3. 调用 API
  const range = await fetchSubListRange(itemId, baseUrl);
  pendingRangeUpdates[itemId] = range;
  return range;
}

function formatEnhancement(sid) {
  const level = Number(sid);
  if (!Number.isFinite(level)) return '未知';

  // Global rule #1: 0..10 maps to BASE..DEC.
  if (level === 0) {
    return 'BASE';
  }

  if (level >= 1 && level <= 10) {
    const stageIndex = level - 1;
    return `${ENHANCE_STAGE_LABELS[stageIndex]}(${ROMAN_NUMERALS[stageIndex]})`;
  }

  // Global rule #2: values > 15 map (level - 15) to PRI..PEN.
  if (level > 15) {
    const stageValue = level - 15;
    if (stageValue >= 1 && stageValue <= 5) {
      const stageIndex = stageValue - 1;
      return `${ENHANCE_STAGE_LABELS[stageIndex]}(${ROMAN_NUMERALS[stageIndex]})`;
    }
  }

  return `+${level}`;
}

function formatStageFromOne(level, maxStage) {
  if (!Number.isFinite(level) || level < 1 || level > maxStage) return null;
  const stageIndex = level - 1;
  return `${ENHANCE_STAGE_LABELS[stageIndex]}(${ROMAN_NUMERALS[stageIndex]})`;
}

// 基于已知强化范围，输出最符合游戏内的强化标识
function formatEnhancementWithRange(sid, wmEnhMin, wmEnhMax, enhanceTag = null) {
  const level = Number(sid);
  if (!Number.isFinite(level)) return '未知';

  const hasRange = Number.isFinite(wmEnhMin) && Number.isFinite(wmEnhMax);

  // 已拿到真实范围且只有单一强化等级：不显示强化字段
  if (hasRange && wmEnhMin === wmEnhMax) {
    return null;
  }

  // 其他类型统一显示数字
  if (enhanceTag === 'none') {
    return String(level);
  }

  // 没有范围信息，回退到原始逻辑
  if (!hasRange) {
    return formatEnhancement(sid);
  }

  if (enhanceTag === 'weaponArmor') {
    // 武器/防具：0-20 显示为 0..15 + PRI..PEN
    if (wmEnhMin === 0 && wmEnhMax === 20) {
      if (level === 0) return 'BASE';
      if (level >= 1 && level <= 15) return String(level);
      if (level >= 16 && level <= 20) {
        const stage = formatStageFromOne(level - 15, 5);
        if (stage) return stage;
      }
      return String(level);
    }

    // 武器/防具：0-5 显示为 BASE + PRI..PEN
    if (wmEnhMin === 0 && wmEnhMax === 5) {
      if (level === 0) return 'BASE';
      const stage = formatStageFromOne(level, 5);
      if (stage) return stage;
      return String(level);
    }

    // 武器/防具其他范围，保留数字
    return String(level);
  }

  if (enhanceTag === 'accessory') {
    // 首饰：0-5 显示为 BASE + PRI..PEN
    if (wmEnhMin === 0 && wmEnhMax === 5) {
      if (level === 0) return 'BASE';
      const stage = formatStageFromOne(level, 5);
      if (stage) return stage;
      return String(level);
    }

    // 首饰：0-10 显示为 BASE + PRI..DEC
    if (wmEnhMin === 0 && wmEnhMax === 10) {
      if (level === 0) return 'BASE';
      if (level === 10) return 'DEC(X)';
      const stage = formatStageFromOne(level, 10);
      if (stage) return stage;
      return String(level);
    }

    // 首饰其他范围，保留数字
    return String(level);
  }

  // 未识别分类，显示数字
  return String(level);
}

function buildMessagePayload(chunk) {
  const embeds = [];
  const files = [];

  chunk.forEach((entry, index) => {
    const { item, displayName, localIconPath } = entry;
    const countdown = Number.isFinite(item.liveAtUnix)
      ? `<t:${item.liveAtUnix}:R>`
      : '未知';
    const range = entry.enhRange || {};
    const enhanceText = formatEnhancementWithRange(item.sid, range.wmEnhMin, range.wmEnhMax, entry.enhanceTag);

    const fields = [
      { name: '上架倒计时', value: countdown, inline: true },
      { name: '价格', value: `**${formatPrice(item.price)}**`, inline: true },
    ];

    if (enhanceText !== null) {
      fields.push({ name: '强化', value: `**${enhanceText}**`, inline: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(displayName.title)
      .addFields(...fields);

    if (localIconPath) {
      const ext = path.extname(localIconPath) || '.webp';
      const attachmentName = `item_${item.itemId}_${index}${ext}`;
      embed.setThumbnail(`attachment://${attachmentName}`);
      files.push(new AttachmentBuilder(localIconPath, { name: attachmentName }));
    }

    embeds.push(embed);
  });

  return { embeds, files };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('showqueue')
    .setDescription('查看 BDO NA 世界市场上架队列（WaitList）'),

  async execute(interaction) {
    const region = 'na';
    const baseUrl = REGION_BASE_URL.na;
    const url = `${baseUrl}/Trademarket/GetWorldMarketWaitList`;

    await interaction.deferReply();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'BlackDesert',
        },
      });

      if (!response.ok) {
        await interaction.editReply(`❌ 请求失败：HTTP ${response.status}（region: ${region.toUpperCase()}）`);
        return;
      }

      const data = await response.json();
      if (data.resultCode !== 0) {
        await interaction.editReply(`❌ API 返回异常：resultCode=${data.resultCode}`);
        return;
      }

      const items = parseWaitList(data.resultMsg);
      if (items.length === 0) {
        await interaction.editReply(`当前队列为空（region: ${region.toUpperCase()}）。`);
        return;
      }

      const ICON_CONCURRENCY = 5;

      // 先对去重的 itemId 拉取强化范围（延迟写入，最后批量落盘）
      const pendingRangeUpdates = {};
      const uniqueItemIds = [...new Set(items.map(i => i.itemId))];
      for (let i = 0; i < uniqueItemIds.length; i += ICON_CONCURRENCY) {
        await Promise.all(
          uniqueItemIds.slice(i, i + ICON_CONCURRENCY).map(id =>
            resolveEnhRange(id, baseUrl, pendingRangeUpdates)
          )
        );
      }

      const preparedItems = new Array(items.length);
      for (let i = 0; i < items.length; i += ICON_CONCURRENCY) {
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
        results.forEach((r, j) => { preparedItems[i + j] = r; });
      }

      // Split into chunks of EMBEDS_PER_MSG (Discord's embed/file limit per message)
      const itemChunks = [];
      for (let i = 0; i < preparedItems.length; i += EMBEDS_PER_MSG) {
        itemChunks.push(preparedItems.slice(i, i + EMBEDS_PER_MSG));
      }

      const firstPayload = buildMessagePayload(itemChunks[0] || []);
      await interaction.editReply({
        content: `World Market WaitList（${region.toUpperCase()}）— 共 ${items.length} 条`,
        embeds: firstPayload.embeds,
        files: firstPayload.files,
      });

      for (let i = 1; i < itemChunks.length; i++) {
        const payload = buildMessagePayload(itemChunks[i]);
        await interaction.followUp({
          embeds: payload.embeds,
          files: payload.files,
        });
      }

      // 所有 embed 构建完毕，批量将新拉取的范围写入 JSON
      writeEnhRangeToTable(pendingRangeUpdates);
    } catch (error) {
      console.error('showqueue error:', error);
      await interaction.editReply('❌ 获取队列失败，请稍后再试。');
    }
  },
    // exported for liveQueueScheduler
    parseWaitList,
    formatDisplayName,
    formatEnhancement,
    formatEnhancementWithRange,
    formatPrice,
    buildMessagePayload,
    EMBEDS_PER_MSG,
    REGION_BASE_URL,
    ENH_RANGE_TTL_MS,
    resolveEnhRange,
  };