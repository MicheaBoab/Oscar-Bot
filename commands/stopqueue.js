const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { removeLiveQueue } = require('../storage/liveQueueStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stopqueue')
    .setDescription('停止自动更新市场队列（仅管理员）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const config = removeLiveQueue(guildId);

    if (!config) {
      await interaction.reply({
        content: 'ℹ️ 当前服务器还没有设置自动队列频道。',
        flags: 64,
      });
      return;
    }

    let deletedCount = 0;
    let missingCount = 0;

    try {
      const channel = await interaction.client.channels.fetch(config.channelId);
      if (channel && Array.isArray(config.messageIds)) {
        for (const messageId of config.messageIds) {
          try {
            const message = await channel.messages.fetch(messageId);
            await message.delete();
            deletedCount += 1;
          } catch {
            missingCount += 1;
          }
        }
      }
    } catch {
      // 频道不存在或权限不足时，仅停止配置
    }

    await interaction.reply({
      content: `🛑 已停止自动队列更新。已清理消息 ${deletedCount} 条（无法清理 ${missingCount} 条）。`,
      flags: 64,
    });
  },
};
