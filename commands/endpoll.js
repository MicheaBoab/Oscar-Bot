const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('endpoll')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDescription('根据投票名称停止一个投票（区分大小写）')
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('投票名称（区分大小写，必须完全一致）')
        .setRequired(true),
    ),

  async execute(interaction) {
    try {
      await require('../helper/pollPanel').endByTitle(interaction, interaction.options.getString('name', true));
    } catch (error) {
      if (interaction.deferred) await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } });
      else await interaction.reply({ content: error.message, flags: 64, allowedMentions: { parse: [] } });
    }
  },
};
