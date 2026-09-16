const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { createSession, getSession, deleteSession } = require('./panelSessions');
const { publishAttendance, getPublishChannel } = require('./attendancePublishing');
const { getGroupChannelId, setGroupChannelId } = require('../storage/attendanceSettingsStore');
const row = component => new ActionRowBuilder().addComponents(component);
const button = (id, label) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const isAdmin = i => i.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;

function buildPanel(admin, guildId) {
  const channel = getGroupChannelId(guildId);
  return { embeds: [new EmbedBuilder().setTitle('活动报名').setDescription(
    `创建活动报名帖，或设置分队面板的默认频道。\n分队面板频道：${channel ? `<#${channel}>` : '未设置'}`)],
  components: [new ActionRowBuilder().addComponents(button('ap:create', '创建活动报名帖'),
    ...(admin ? [button('ap:settings', '设置分队面板频道')] : []))] };
}
function channelSelector(token, settings = false) {
  return row(new ChannelSelectMenuBuilder().setCustomId(`ap:${settings ? 'save-channel' : 'publish-channel'}:${token}`)
    .setPlaceholder(settings ? '选择分队面板频道' : '选择报名发布频道').addChannelTypes(ChannelType.GuildText));
}
async function handle(interaction) {
  const [, action, token] = interaction.customId.split(':');
  if (!interaction.guildId) return interaction.reply({ content: '请在服务器内使用。', flags: 64 });
  if (action === 'create' && interaction.isButton()) {
    const id = createSession(interaction, { stage: 'type' });
    return interaction.reply({ content: '请选择报名类型。', flags: 64,
      components: [new ActionRowBuilder().addComponents(button(`ap:normal:${id}`, '普通报名'), button(`ap:class:${id}`, '职业报名'))] });
  }
  if (action === 'settings' && interaction.isButton()) {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ 仅管理员可以设置分队频道。', flags: 64 });
    const id = createSession(interaction, { stage: 'settings' });
    return interaction.reply({ content: '设置只影响以后新建的分队面板。', components: [channelSelector(id, true)], flags: 64 });
  }
  const session = getSession(token, interaction);
  if (!session || session.busy) return interaction.reply({ content: '此流程已失效或正在处理，请重新打开自己的面板。', flags: 64 });
  if (['normal', 'class'].includes(action) && interaction.isButton() && session.stage === 'type') {
    session.selectRole = action === 'class'; session.stage = 'channel';
    return interaction.update({ content: '请选择报名发布频道。', components: [channelSelector(token)] });
  }
  if (action === 'publish-channel' && interaction.isChannelSelectMenu() && session.stage === 'channel') {
    session.channelId = interaction.values[0]; session.stage = 'form';
    const modal = new ModalBuilder().setCustomId(`ap:submit:${token}`).setTitle('创建活动报名帖').addComponents(
      row(new TextInputBuilder().setCustomId('title').setLabel('活动标题').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(180)),
      row(new TextInputBuilder().setCustomId('description').setLabel('活动说明').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(3000)));
    return interaction.showModal(modal);
  }
  if (action === 'save-channel' && interaction.isChannelSelectMenu() && session.stage === 'settings') {
    if (!isAdmin(interaction)) return interaction.reply({ content: '❌ 仅管理员可以设置分队频道。', flags: 64 });
    session.busy = true;
    await interaction.deferUpdate();
    try {
      const channel = await getPublishChannel(interaction, interaction.values[0]);
      setGroupChannelId(interaction.guildId, channel.id);
      deleteSession(token);
      return await interaction.editReply({ content: `✅ 分队面板频道已设置为 <#${channel.id}>。已有面板保持原位置。`, components: [] });
    } catch (error) {
      session.busy = false;
      return interaction.editReply({ content: `❌ ${error.message}`, components: [channelSelector(token, true)] });
    }
  }
  if (action === 'submit' && interaction.isModalSubmit() && session.stage === 'form') {
    session.busy = true;
    await interaction.deferReply({ flags: 64 });
    try {
      const attendance = await publishAttendance(interaction, { channelId: session.channelId, selectRole: session.selectRole,
        title: interaction.fields.getTextInputValue('title'), description: interaction.fields.getTextInputValue('description') });
      deleteSession(token);
      return await interaction.editReply({ content: `✅ 已创建报名帖：https://discord.com/channels/${attendance.guildId}/${attendance.channelId}/${attendance.messageId}` });
    } catch (error) {
      deleteSession(token);
      return interaction.editReply({ content: `❌ ${error.message}\n请重新点击「创建活动报名帖」。`, allowedMentions: { parse: [] } });
    }
  }
  return interaction.reply({ content: '这一步已失效，请重新打开报名面板。', flags: 64 });
}
module.exports = { buildPanel, handle };
