const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createpoll')
    .setDescription('创建一个下拉菜单投票')
    .addStringOption(option =>
      option.setName('title')
            .setDescription('投票标题')
            .setRequired(true),
    )
    .addStringOption(option =>
      option.setName('options')
            .setDescription('投票选项, 请用 | 来做分割 (最多25个)')
            .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('countdown')
        .setDescription('可选：倒计时，如 30s / 60s / 120min / 5d（默认10min）')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });
    try {
      const poll = await require('../helper/pollService').createPoll(interaction, {
        channelId: interaction.channelId,
        title: interaction.options.getString('title', true),
        options: interaction.options.getString('options', true).split('|'),
        duration: interaction.options.getString('countdown'),
      });
      await interaction.editReply({ content: 'https://discord.com/channels/' + poll.guildId + '/' + poll.channelId + '/' + poll.messageId });
    } catch (error) {
      await interaction.editReply({ content: error.message, allowedMentions: { parse: [] } });
    }
  },
};
