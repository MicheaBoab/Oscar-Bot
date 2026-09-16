const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forcequeue')
    .setDescription('立即刷新市场队列（仅管理员，不改变自动刷新计时）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await require('../helper/marketActions').refresh(interaction, true);
  },
};
