const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('测试用指令，回复 pong'),

  async execute(interaction) {
    await interaction.reply('🏓 pong!');
  },
};