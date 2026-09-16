const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const sessions = require('./panelSessions');
const service = require('./pollService');
const store = require('../storage/pollFileStore');
const row = component => new ActionRowBuilder().addComponents(component);
function buildPanel() {
  return { embeds: [new EmbedBuilder().setTitle('投票').setDescription('创建投票后，在投票消息上参与和管理。')],
    components: [row(new ButtonBuilder().setCustomId('pp:create').setLabel('创建投票').setStyle(ButtonStyle.Primary))] };
}
async function requireAdmin(interaction) {
  if (interaction.guildId && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  await interaction.reply({ content: '❌ 只有管理员可以结束投票。', flags: 64 });
  return false;
}
async function endByTitle(interaction, title) {
  if (!await requireAdmin(interaction)) return;
  await interaction.deferReply({ flags: 64 });
  let found;
  for (const entry of store.loadAllPolls()) {
    if (entry.data.title !== title) continue;
    if (entry.data.guildId && entry.data.guildId !== interaction.guildId) continue;
    const channel = await interaction.client.channels.fetch(entry.data.channelId);
    if (channel?.guildId === interaction.guildId) { found = entry; break; }
  }
  if (!found) return interaction.editReply({ content: '此服务器没有找到该投票。' });
  await service.endPoll(interaction.client, found.key, interaction.guildId);
  await interaction.editReply({ content: '✅ 投票已结束，结果已发布到原频道。' });
}
async function handle(interaction) {
  if (interaction.isStringSelectMenu() && /^(poll_vote|poll_select):/.test(interaction.customId)) return service.vote(interaction);
  if (interaction.isButton() && interaction.customId.startsWith('poll_end:')) {
    if (!await requireAdmin(interaction)) return;
    const found = service.resolveInteraction(interaction);
    if (!found) return interaction.reply({ content: '该投票已结束或不存在。', flags: 64 });
    await interaction.deferReply({ flags: 64 });
    const ended = await service.endPoll(interaction.client, found.key, interaction.guildId);
    return interaction.editReply({ content: ended ? '✅ 投票已结束，结果已发布到原频道。' : '该投票已结束。' });
  }
  if (!interaction.guildId) return interaction.reply({ content: '请在服务器中创建投票。', flags: 64 });
  const [, action, token] = interaction.customId.split(':');
  if (action === 'create' && interaction.isButton()) {
    const id = sessions.createSession(interaction, { stage: 'channel' });
    return interaction.reply({ content: '请选择投票发布频道。', flags: 64,
      components: [row(new ChannelSelectMenuBuilder().setCustomId(`pp:channel:${id}`)
        .setPlaceholder('选择投票频道').addChannelTypes(ChannelType.GuildText))] });
  }
  const session = sessions.getSession(token, interaction);
  if (!session || session.busy) return interaction.reply({ content: '此流程已失效或正在处理，请重新打开投票面板。', flags: 64 });
  if (action === 'channel' && interaction.isChannelSelectMenu() && session.stage === 'channel') {
    session.channelId = interaction.values[0]; session.stage = 'form';
    return interaction.showModal(new ModalBuilder().setCustomId(`pp:submit:${token}`).setTitle('创建投票').addComponents(
      row(new TextInputBuilder().setCustomId('title').setLabel('投票标题').setStyle(TextInputStyle.Short).setMaxLength(180).setRequired(true)),
      row(new TextInputBuilder().setCustomId('options').setLabel('选项（每行一项，2–25 项，每项最多 100 字符）').setStyle(TextInputStyle.Paragraph).setMaxLength(2600).setRequired(true)),
      row(new TextInputBuilder().setCustomId('duration').setLabel('时长（例如 30s / 120min / 5d，默认 10min）').setStyle(TextInputStyle.Short).setRequired(false))));
  }
  if (action === 'submit' && interaction.isModalSubmit() && session.stage === 'form') {
    session.busy = true;
    await interaction.deferReply({ flags: 64 });
    try {
      const poll = await service.createPoll(interaction, { channelId: session.channelId,
        title: interaction.fields.getTextInputValue('title'), options: interaction.fields.getTextInputValue('options').split(/\r?\n/),
        duration: interaction.fields.getTextInputValue('duration') });
      sessions.deleteSession(token);
      return await interaction.editReply({ content: `✅ 已创建投票：https://discord.com/channels/${poll.guildId}/${poll.channelId}/${poll.messageId}` });
    } catch (error) {
      sessions.deleteSession(token);
      return interaction.editReply({ content: `❌ ${error.message}\n请重新点击「创建投票」。`, allowedMentions: { parse: [] } });
    }
  }
  return interaction.reply({ content: '这一步已失效，请重新打开投票面板。', flags: 64 });
}
module.exports = { buildPanel, handle, endByTitle };
