const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stopqueue')
    .setDescription('停止自动更新市场队列（仅管理员）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await require('../helper/marketActions').configure(interaction, 'stop');
  },
};
