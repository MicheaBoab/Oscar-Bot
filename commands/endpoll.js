//const { SlashCommandBuilder } = require('discord.js');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
  listPolls,
  loadPoll,
  updatePoll,
  archivePoll,
} = require('../storage/pollFileStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('endpoll')
    .setDescription('根据投票名称停止一个投票（区分大小写）')
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('投票名称（区分大小写，必须完全一致）')
        .setRequired(true),
    ),

  async execute(interaction) {
    const title = interaction.options.getString('name');

    /* =========================
       ① 查找对应 title 的 poll
       ========================= */
    const pollTitles = listPolls();
    let targetPollTitle = null;
    let targetPoll = null;

    for (const pollTile of pollTitles) {
      const poll = loadPoll(pollTile);
      if (poll && poll.title === title) {
        targetPollTitle = title;
        targetPoll = poll;
        break;
      }
    }

    /* =========================
       ② 没找到
       ========================= */
    if (!targetPoll) {
      return interaction.reply({
        content: `❌ 没有找到名为 **${title}** 的投票`,
        flags: 64,
      });
    }

    /* =========================
       ③ 已经结束
       ========================= */
    if (targetPoll.status === 'ended') {
      return interaction.reply({
        content: `⚠️ 投票 **${title}** 已经是结束状态`,
        flags: 64,
      });
    }

    // ⭐ 统计票数
    const counts = new Array(targetPoll.options.length).fill(0);
    for (const voteIndex of Object.values(targetPoll.votes)) {
      counts[voteIndex]++;
    }

    // ⭐ 找最高票

    const maxVotes = Math.max(...counts);


    const winnerIndexes = counts
      .map((count, index) => ({ count, index }))
      .filter(item => item.count === maxVotes)
      .map(item => item.index);

    const winnerNames = winnerIndexes.map(i => targetPoll.options[i]);
    const winnerMentions = winnerNames.map(opt=> {
      if(opt.value.startsWith('user:')) {
        const userId = opt.value.split(':')[1];
        return `<@${userId}>`;
      }
      return opt.label;
    })

    const isTie = winnerIndexes.length > 1;

    //const winnerName = targetPoll.options[winnerIndex];
    /* =========================
       ④ 停止投票
       ========================= */
    targetPoll.status = 'ended';
    updatePoll(title, targetPoll);
    archivePoll(title);

    if(maxVotes < 1)
    {
      return interaction.reply({
        content: `🏆 **投票结果公布**\n⚖️ 本次无人投票\n👏 感谢大家的参与`,
      });
    }

    /* =========================
       ⑤ 回复确认
       ========================= */
    const embed = new EmbedBuilder()
      .setColor(0x57F287) // Discord 成功绿
      .setTitle(`🟢 投票已结束\n`)
      .setDescription(
        [
          `\n🏆 **${targetPoll.title}** 投票结果公布\n`,
          `🎉 获胜者为： **${winnerMentions.join(' | ')}**`,
          //`⚖️ 票数 -- **${maxVotes}**`,
          `\n👏 感谢大家的参与`,
        ].join('\n')
      )
      .setFooter({ text: '该投票已结束' })
      .setTimestamp();

      await interaction.reply({
        embeds: [embed],
      });
  },
};
