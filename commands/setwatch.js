const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setWatchChannel } = require('../storage/liveQueueStore');

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
    const channel = interaction.options.getChannel('channel');
    const guildId = interaction.guildId;

    setWatchChannel(guildId, channel.id);

    await interaction.reply({
      content: `✅ 已将 watch 通知频道设置为 ${channel}。后续命中只会在该频道 @用户。`,
      flags: 64,
    });
  },
};
