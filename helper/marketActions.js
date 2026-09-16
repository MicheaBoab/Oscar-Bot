const { PermissionFlagsBits } = require('discord.js');
const store = require('../storage/liveQueueStore');
const scheduler = require('./liveQueueScheduler');
const { getPublishChannel } = require('./attendancePublishing');
const { withPanelLock } = require('./fixedPanel');

const refreshText = result => ({
  updated: '✅ 已刷新市场数据，自动刷新计时保持不变。',
  stopped: '追踪已停止，请管理员先到 Market → 市场队列恢复追踪。',
  unconfigured: '请管理员先在 Market 设置通知频道。',
  cooldown: '刷新过于频繁，请稍等 10 秒再试。',
}[result?.status] || '本次更新未完成，请稍后重试。');

async function refresh(interaction, adminOnly = false) {
  if (!interaction.guildId) return interaction.reply({ content: '请在服务器中使用。', flags: 64 });
  if (adminOnly && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '此操作仅管理员可用。', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  try { await interaction.editReply({ content: refreshText(await scheduler.refreshMarket(interaction.client, interaction.guildId)) }); }
  catch (error) { console.error('[market refresh]', error); await interaction.editReply({ content: '❌ 更新失败，请检查频道权限或稍后重试。' }); }
}

async function configure(interaction, action, channelId) {
  if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '此操作仅管理员可用。', flags: 64 });
  }
  await interaction.deferReply({ flags: 64 });
  await withPanelLock(`market:settings:${interaction.guildId}`, async () => {
    try {
      const guildId = interaction.guildId;
      if (action === 'stop') {
        if (!store.getLiveQueue(guildId)) return interaction.editReply({ content: '尚未设置通知频道。' });
        store.setTrackingActive(guildId, false);
        await scheduler.waitForGuildUpdate(guildId);
        const config = store.getLiveQueue(guildId);
        const failures = [];
        if (config.channelId) {
          for (const id of config.messageIds) {
            try {
              const channel = await interaction.client.channels.fetch(config.channelId);
              const message = await channel.messages.fetch(id);
              await message.edit({ content: '⏸️ 追踪已停止，以下数据不再更新。', allowedMentions: { parse: [] } });
            } catch (error) {
              if (![10008, 10003].includes(error.code)) failures.push(`https://discord.com/channels/${guildId}/${config.channelId}/${id}`);
            }
          }
        }
        return interaction.editReply({ content: `⏸️ 已停止市场获取、队列更新及上架提醒，配置和关注记录已保留。${failures.length ? `\n以下旧消息无法标注，请手动处理：\n${failures.slice(0, 8).join('\n')}` : ''}` });
      }
      if (action === 'resume') {
        const config = store.getLiveQueue(guildId);
        if (!config?.channelId && !config?.watchChannelId) throw new Error('请先设置通知频道。');
        for (const id of new Set([config.channelId, config.watchChannelId].filter(Boolean))) await getPublishChannel(interaction, id);
        // Finish canceled work before enabling the next generation.
        await scheduler.waitForGuildUpdate(guildId);
        store.setTrackingActive(guildId, true);
      } else if (action === 'queue-channel' || action === 'watch-channel') {
        const channel = await getPublishChannel(interaction, channelId);
        if (action === 'queue-channel') store.setLiveQueue(guildId, channel.id);
        else store.setWatchChannel(guildId, channel.id);
        await scheduler.waitForGuildUpdate(guildId);
      } else throw new Error('未知操作。');
      const config = store.getLiveQueue(guildId);
      if (!config.active) return interaction.editReply({ content: '✅ 频道已保存，追踪仍为停止状态；请管理员点击「恢复追踪」。' });
      try {
        const result = await scheduler.doQueueUpdateForGuild(interaction.client, guildId);
        await interaction.editReply({ content: `✅ 设置已保存。${refreshText(result)}` });
      } catch (error) {
        console.error('[market setup refresh]', error);
        await interaction.editReply({ content: '✅ 设置已保存，追踪已启用，但本次刷新失败；自动任务将继续重试。' });
      }
    } catch (error) {
      await interaction.editReply({ content: `❌ ${error.message}`, allowedMentions: { parse: [] } });
    }
  });
}
module.exports = { refresh, configure, refreshText };
