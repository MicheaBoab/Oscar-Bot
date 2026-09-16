const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

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
    await require('../helper/marketActions').configure(interaction, 'queue-channel', interaction.options.getChannel('channel', true).id);
  },
};
