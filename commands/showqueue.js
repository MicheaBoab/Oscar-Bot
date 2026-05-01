const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { resolveItemMeta } = require('../storage/itemNameStore');
const { ensureLocalIcon } = require('../storage/localIconStore');

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

function formatEnhancement(sid) {
  const level = Number(sid);
  if (!Number.isFinite(level)) return '未知';

  // Global rule #1: 0..10 maps to BASE..DEC.
  if (level === 0) {
    return null;
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

function buildMessagePayload(chunk) {
  const embeds = [];
  const files = [];

  chunk.forEach((entry, index) => {
    const { item, displayName, localIconPath } = entry;
    const countdown = Number.isFinite(item.liveAtUnix)
      ? `<t:${item.liveAtUnix}:R>`
      : '未知';
    const enhanceText = formatEnhancement(item.sid);

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
            return { item, displayName, localIconPath };
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
    } catch (error) {
      console.error('showqueue error:', error);
      await interaction.editReply('❌ 获取队列失败，请稍后再试。');
    }
  },
    // exported for liveQueueScheduler
    parseWaitList,
    formatDisplayName,
    formatEnhancement,
    formatPrice,
    buildMessagePayload,
    EMBEDS_PER_MSG,
    REGION_BASE_URL,
  };