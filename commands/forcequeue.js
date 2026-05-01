const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { forceRefreshAndReset } = require('../helper/liveQueueScheduler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forcequeue')
    .setDescription('立即刷新市场队列并重置自动刷新倒计时（仅管理员）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const guildId = interaction.guildId;
    await interaction.deferReply({ flags: 64 });

    try {
      await forceRefreshAndReset(guildId);
      await interaction.editReply('✅ 已立即刷新队列，并将下一次自动刷新倒计时重置为 1 分钟。');
    } catch (error) {
      if (error && error.message === 'refresh in progress') {
        await interaction.editReply('⏳ 当前已有刷新任务在执行，请稍后再试。');
        return;
      }
      await interaction.editReply('❌ 强制刷新失败，请查看 bot 日志。');
    }
  },
};
