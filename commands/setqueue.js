const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setLiveQueue } = require('../storage/liveQueueStore');
const { doQueueUpdateForGuild } = require('../helper/liveQueueScheduler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setqueue')
    .setDescription('设置自动更新市场队列的频道（仅管理员）')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('要发送队列消息的频道')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    setLiveQueue(guildId, channel.id);

    await interaction.reply({
      content: `✅ 已将市场队列自动更新频道设置为 ${channel}，正在发送第一条消息…`,
      flags: 64,
    });

    // 立即触发一次更新，不等待结果
    doQueueUpdateForGuild(interaction.client, guildId).catch(err =>
      console.error('[setqueue] 首次更新失败:', err)
    );
  },
};
