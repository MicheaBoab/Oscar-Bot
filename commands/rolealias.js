const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolealias')
    .setDescription('身分组别名管理')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('添加身分组别名')
        .addStringOption(option =>
          option.setName('name').setDescription('别名').setRequired(true)
        )
        .addRoleOption(option =>
          option.setName('role1').setDescription('第1个身分组').setRequired(true)
        )
        .addRoleOption(option =>
          option.setName('role2').setDescription('第2个身分组(可选)').setRequired(false)
        )
        .addRoleOption(option =>
          option.setName('role3').setDescription('第3个身分组(可选)').setRequired(false)
        )
        .addRoleOption(option =>
          option.setName('role4').setDescription('第4个身分组(可选)').setRequired(false)
        )
        .addRoleOption(option =>
          option.setName('role5').setDescription('第5个身分组(可选)').setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('删除身分组别名')
        .addStringOption(option =>
          option.setName('name').setDescription('别名').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('列出所有身分组别名')
    ),

  async execute(interaction) {
    try { await require('../helper/announcementPanel').legacyAlias(interaction); }
    catch (error) {
      const payload = { content: error.message, allowedMentions: { parse: [] } };
      if (interaction.deferred) await interaction.editReply(payload);
      else await interaction.reply({ ...payload, flags: 64 });
    }
  },
};
