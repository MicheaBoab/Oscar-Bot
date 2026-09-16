const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setwatch')
    .setDescription('设置 watch 通知频道（仅管理员）')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('要发送 watch 通知的频道')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await require('../helper/marketActions').configure(interaction, 'watch-channel', interaction.options.getChannel('channel', true).id);
  },
};
