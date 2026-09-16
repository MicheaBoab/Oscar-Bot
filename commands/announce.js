const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('发送公告（@角色 + 文本别名 + 可选图片）')
    .addStringOption(option =>
      option
        .setName('role')
        .setDescription('身分组别名（来自 /rolealias）')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('text')
        .setDescription('公告别名（来自 /notice）')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('offset')
        .setDescription('可选时间偏移：+/-数字+s/m/h/d（如 +10m、-30s）')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('force')
        .setDescription('强制重发：即使上一条未过期也发送，并尝试删除上一条')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      const service = require('../helper/announcementService');
      service.assertAdmin(interaction);
      await interaction.deferReply({ flags: 64 });
      const result = await service.send(interaction, {
        channelId: interaction.channelId,
        roleAlias: interaction.options.getString('role', true).trim().toLowerCase(),
        textKey: interaction.options.getString('text', true).trim().toLowerCase(),
        offset: interaction.options.getString('offset') || '',
        force: interaction.options.getBoolean('force') || false,
      });
      await interaction.editReply({ content: 'https://discord.com/channels/' + interaction.guildId + '/' + result.plan.channelId + '/' + result.message.id + result.warning, allowedMentions: { parse: [] } });
    } catch (error) {
      const payload = { content: error.message, allowedMentions: { parse: [] } };
      if (interaction.deferred) await interaction.editReply(payload);
      else await interaction.reply({ ...payload, flags: 64 });
    }
  },
};
