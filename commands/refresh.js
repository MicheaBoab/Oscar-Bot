const { SlashCommandBuilder } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('refresh').setDescription('立即刷新一次市场队列（不改变自动刷新计时）'),
  execute: interaction => require('../helper/marketActions').refresh(interaction),
};
