const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('notice')
    .setDescription('公告文本与图片别名管理')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('添加公告文本别名')
        .addStringOption(option =>
          option.setName('alias').setDescription('别名').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('编辑公告文本别名')
        .addStringOption(option =>
          option.setName('alias').setDescription('别名').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('删除公告文本别名')
        .addStringOption(option =>
          option.setName('alias').setDescription('别名').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('列出所有公告文本别名')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-image')
        .setDescription('为公告别名设置图片（输入 URL，bot 自动下载到本地）')
        .addStringOption(option =>
          option.setName('alias').setDescription('别名').setRequired(true)
        )
        .addStringOption(option =>
          option.setName('image_url').setDescription('图片 URL').setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try { await require('../helper/announcementPanel').legacyNotice(interaction); }
    catch (error) {
      const payload = { content: error.message, allowedMentions: { parse: [] } };
      if (interaction.deferred) await interaction.editReply(payload);
      else await interaction.reply({ ...payload, flags: 64 });
    }
  },
  async handleModalSubmit(interaction) {
    try {
      require('../helper/announcementService').assertAdmin(interaction);
      const store = require('../storage/announcementStore');
      const match = interaction.customId.match(/^notice_(add|edit)_modal_(.+)$/);
      if (!match) return;
      store.putNotice(match[2], interaction.fields.getTextInputValue('notice_content'), { create: match[1] === 'add' });
      await interaction.reply({ content: '✅ 公告模板已保存。', flags: 64 });
    } catch (error) { await interaction.reply({ content: error.message, flags: 64, allowedMentions: { parse: [] } }); }
  },
};
