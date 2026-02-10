const { SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const {
  loadAllPolls
} = require('../storage/pollFileStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listpolls')
    .setDescription('显示当前开启poll'),

  async execute(interaction) {
    const polls = loadAllPolls();

    function formatTime(ts) {
      return new Date(ts).toLocaleString();
    }

    const embed = new EmbedBuilder()
      .setTitle('📊 投票列表')
      .setColor(0x5865f2);

    for (const poll of polls) {
      const pollData = poll.data;
      const voteCount = Object.keys(pollData.votes || {}).length;
      const statusIcon = pollData.status === 'active' ? '🟢' : '🔴';

      embed.addFields({
        name: `${statusIcon} ${pollData.title}`,
        value: [
          `⏱ 创建与：${formatTime(pollData.time)}`,
          `👥 参与：${voteCount} 人`,
        ].join('\n'),
      });
    }

    await interaction.reply({
      embeds: [embed],
    });
  },
};
