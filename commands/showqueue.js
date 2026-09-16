const { SlashCommandBuilder } = require('discord.js');
const { resolveItemMeta, writeEnhRangeToTable } = require('../storage/itemNameStore');
const { ensureLocalIcon } = require('../storage/localIconStore');
const { parseWaitList, formatDisplayName, formatEnhancement, formatEnhancementWithRange, formatPrice, buildMessagePayload, EMBEDS_PER_MSG, REGION_BASE_URL, ENH_RANGE_TTL_MS, resolveEnhRange } = require('../helper/marketQueueFormatting');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('showqueue')
    .setDescription('查看 BDO NA 世界市场上架队列（WaitList）'),

  async execute(interaction) {
    if (require('../storage/liveQueueStore').getLiveQueue(interaction.guildId)?.active === false) {
      await interaction.reply({ content: '追踪已停止，请管理员先在 Market 恢复追踪。', flags: 64 });
      return;
    }
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
