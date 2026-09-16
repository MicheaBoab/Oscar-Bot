const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ChannelSelectMenuBuilder,
  EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder,
} = require('discord.js');
const { getAllControlPanelConfigs, getControlPanelConfig, saveControlPanelLocation } = require('../storage/controlPanelStore');
const { getReminderConfig } = require('../storage/reminderStore');
const { setReminderBoardLocation } = require('../helper/reminderScheduler');
const { withPanelLock, publishFixedPanel } = require('../helper/fixedPanel');

const button = (id, label) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const embed = (title, description) => new EmbedBuilder().setColor(0x2f3136).setTitle(title).setDescription(description);
const isAdmin = interaction => Boolean(interaction.guildId && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));

function buildControlPanelEmbed() {
  return embed('🧭 Oscar Bot · 中控台', '活动、提醒与市场动态，都从这里开始。\n选择下方模块，打开你的个人操作面板。')
    .setColor(0x5865f2)
    .addFields(
      { name: '📅 活动协作', value: '定时提醒 · 活动报名 · 公告发布', inline: true },
      { name: '✨ 日常工具', value: '投票决策 · 市场追踪 · 使用帮助', inline: true },
    )
    .setFooter({ text: '个人面板仅自己可见 · 管理功能仅管理员可用' });
}
function buildControlPanelComponents() {
  return [
    row(button('control_module:reminder', '定时提醒').setEmoji('⏰').setStyle(ButtonStyle.Primary),
      button('control_module:attendance', '活动报名').setEmoji('📋').setStyle(ButtonStyle.Primary),
      button('control_module:announce', '公告发布').setEmoji('📣').setStyle(ButtonStyle.Primary)),
    row(button('control_module:poll', '发起投票').setEmoji('🗳️'),
      button('control_module:market', '市场追踪').setEmoji('📈'),
      button('control_module:help', '使用帮助').setEmoji('📖')),
  ];
}
function buildModulePanel(name, { config = {}, isAdmin: admin = false, guildId } = {}) {
  if (name === 'attendance') return require('../helper/attendancePanel').buildPanel(admin, guildId);
  if (name === 'poll') return require('../helper/pollPanel').buildPanel();
  if (name === 'announce') return require('../helper/announcementPanel').buildPanel();
  if (name === 'queue' || name === 'watch') return require('../helper/marketPanel').buildPanel(name, admin, guildId);
  if (name === 'reminder') return {
    embeds: [embed('Reminder 控制', `当前主频道：${config.boardChannelId ? `<#${config.boardChannelId}>` : '未设置'}`)],
    components: admin ? [row(button('control_reminder_setup', '设置 / 更换主频道'))] : [],
  };
  if (name === 'market') return {
    embeds: [embed('Market', '请选择市场功能。')],
    components: [row(button('control_page:queue', '市场队列'), button('control_page:watch', '上架提醒'))],
  };
  return { embeds: [embed('帮助', [
    '从固定中控台选择模块，操作面板仅自己可见；创建的公告、报名和投票会发布到所选频道。',
    '',
    '**Reminder**：查看主频道；管理员设置频道，日常提醒操作在该频道的看板上。',
    '**活动报名（Attendance）**：创建普通或职业报名；报名及分队操作在活动消息上，管理员在模块中设置分队频道。',
    '**公告（Announcement，仅管理员）**：管理模板、图片和身分组别名，预览确认后发送。',
    '**投票（Poll）**：创建投票；在投票消息上投票，管理员可提前结束。',
    '**Market**：市场队列设置、停止/恢复追踪，以及个人上架提醒。`/refresh` 单次刷新，停止期间不获取数据。',
    '',
    '详细说明：`/manual section:quick`；可选 announce、attendance、poll、queue、watch、reminder、all。',
    '流程超过 15 分钟或机器人重启后，请重新打开。日常操作已统一到中控台。',
  ].join('\n'))], components: [] };
}
function controlPayload() {
  return { content: null, embeds: [buildControlPanelEmbed()],
    components: buildControlPanelComponents(), allowedMentions: { parse: [] } };
}
async function setControlPanelLocation(client, guildId, channelId) {
  return withPanelLock(`control:${guildId}`, () => publishFixedPanel({
    client, guildId, channelId, previous: getControlPanelConfig(guildId), payload: controlPayload(),
    save: location => saveControlPanelLocation(guildId, location),
  }));
}
async function sendOrUpdateControlPanel(client, guildId) {
  return withPanelLock(`control:${guildId}`, async () => {
    const config = getControlPanelConfig(guildId);
    if (!config?.channelId) return false;
    await publishFixedPanel({ client, guildId, channelId: config.channelId, previous: config,
      payload: controlPayload(), save: location => saveControlPanelLocation(guildId, location) });
    return true;
  });
}
async function refreshAllControlPanels(client) {
  for (const guildId of Object.keys(getAllControlPanelConfigs())) {
    try { await sendOrUpdateControlPanel(client, guildId); }
    catch (error) { console.error(`[control] ${guildId} 恢复失败:`, error.message); }
  }
}
async function requireAdmin(interaction) {
  if (isAdmin(interaction)) return true;
  await interaction.reply({ content: '❌ 该操作仅管理员可用。', flags: 64 });
  return false;
}
async function configurePanel(interaction, channelId, reminder = false) {
  if (!await requireAdmin(interaction)) return;
  await interaction.deferReply({ flags: 64 });
  try {
    const action = reminder ? setReminderBoardLocation : setControlPanelLocation;
    const result = await action(interaction.client, interaction.guildId, channelId);
    await interaction.editReply({ content: `✅ ${reminder ? 'Reminder 主频道' : '中控台'}已设置到 <#${channelId}>。${result.cleanupWarning}`,
      allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('[control] 设置频道失败:', error);
    await interaction.editReply({ content: `❌ 设置失败：${error.message}`, allowedMentions: { parse: [] } });
  }
}
module.exports = {
  data: new SlashCommandBuilder().setName('control').setDescription('设置 Oscar Bot 固定中控台')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('set-channel').setDescription('设置固定中控台频道')
      .addChannelOption(option => option.setName('channel').setDescription('中控台所在频道')
        .addChannelTypes(ChannelType.GuildText).setRequired(true))),
  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'set-channel') {
      await configurePanel(interaction, interaction.options.getChannel('channel', true).id);
    }
  },
  async handleButton(interaction) {
    if (interaction.customId === 'control_reminder_setup') {
      if (!await requireAdmin(interaction)) return;
      await interaction.reply({ content: '请选择 Reminder 主频道。', flags: 64,
        components: [row(new ChannelSelectMenuBuilder()
          .setCustomId(`control_reminder_channel:${interaction.user.id}:${Date.now()}`)
          .setPlaceholder('选择看板所在频道').addChannelTypes(ChannelType.GuildText))] });
      return;
    }
    const name = interaction.customId.split(':')[1];
    if (name === 'announce' && !await requireAdmin(interaction)) return;
    const panel = buildModulePanel(name, { isAdmin: isAdmin(interaction), guildId: interaction.guildId,
      config: name === 'reminder' ? getReminderConfig(interaction.guildId) || {} : {} });
    if (interaction.customId.startsWith('control_page:')) await interaction.update(panel);
    else await interaction.reply({ ...panel, flags: 64 });
  },
  async handleChannelSelect(interaction) {
    const [, owner, timestamp] = interaction.customId.split(':');
    const age = Date.now() - Number(timestamp);
    if (owner !== interaction.user.id || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000) {
      await interaction.reply({ content: '此操作已失效，请重新打开自己的 Reminder 设置。', flags: 64 });
      return;
    }
    await configurePanel(interaction, interaction.values[0], true);
  },
  configurePanel, setControlPanelLocation, buildControlPanelEmbed, buildControlPanelComponents,
  buildModulePanel, sendOrUpdateControlPanel, refreshAllControlPanels,
};
