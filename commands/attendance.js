const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  createAttendance,
  loadAllAttendances,
  loadAttendance,
  updateAttendance,
  archiveAttendance,
  attendanceExistsByTitle,
  findAttendanceByMessage,
  findAttendanceByGroupPanelMessage,
} = require('../storage/attendanceStore');
const { getGroupChannelId, setGroupChannelId } = require('../storage/attendanceSettingsStore');

const GROUP_SELECT_MAX_VALUES = 25;
const MAX_ATTENDANCE_GROUPS = 24;
const MAX_PARTICIPANT_FIELD_LENGTH = 1000;
const MAX_GROUP_PANEL_VISIBLE_MEMBERS = 50;

function isAdminInteraction(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
}

function getParticipantIds(attendance) {
  return Object.keys(attendance.participants || {});
}

function getParticipantSelection(participant) {
  return participant && typeof participant === 'object' ? participant.selection : null;
}

function getParticipantSpecialization(participant) {
  return participant && typeof participant === 'object' ? participant.specialization : null;
}

const SPECIALIZATION_DISPLAY = {
  succession: { symbol: '🔵' },
  awakening: { symbol: '🟠' },
  not_applicable: { symbol: '⚪' },
  shai: { symbol: '🟡' },
};

function formatParticipantEntry(userId, attendance) {
  const selection = getParticipantSelection(attendance.participants?.[userId]);
  return selection ? `<@${userId}> - ${selection}` : `<@${userId}>`;
}

const graphemeSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });

function graphemeWidth(grapheme) {
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2;
  const codePoint = grapheme.codePointAt(0);
  if (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f
      || codePoint === 0x2329
      || codePoint === 0x232a
      || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xfe10 && codePoint <= 0xfe6f)
      || (codePoint >= 0xff00 && codePoint <= 0xff60)
      || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    )
  ) return 2;
  return 1;
}

function displayWidth(value) {
  return Array.from(graphemeSegmenter.segment(String(value)), item => item.segment)
    .reduce((width, grapheme) => width + graphemeWidth(grapheme), 0);
}

function truncateDisplayWidth(value, maxWidth) {
  const graphemes = Array.from(graphemeSegmenter.segment(String(value)), item => item.segment);
  if (displayWidth(value) <= maxWidth) return String(value);
  let output = '';
  let width = 0;
  for (const grapheme of graphemes) {
    const nextWidth = graphemeWidth(grapheme);
    if (width + nextWidth > maxWidth - 1) break;
    output += grapheme;
    width += nextWidth;
  }
  return `${output}…`;
}

function padName(name, width) {
  const truncated = truncateDisplayWidth(name, width);
  return truncated + ' '.repeat(Math.max(0, width - displayWidth(truncated)));
}

function getClassEmojiMarkup(selection, guild) {
  if (!selection || !guild) return '';
  const classInfo = BLACK_DESERT_CLASSES.find(item => item.name === selection);
  if (!classInfo) return '';
  const emojis = guild.emojis?.cache;
  const emoji = emojis?.find?.(entry => entry.name === classInfo.emojiName)
    ?? emojis?.get?.(classInfo.emojiName);
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}

function buildParticipantTable(userIds, attendance, guild, renderState = null) {
  if (userIds.length === 0) return '（无）';

  const rows = userIds.map(userId => {
    const participant = attendance.participants?.[userId];
    const currentMember = guild?.members?.cache?.get?.(userId);
    const name = currentMember?.displayName || participant?.displayName || `用户${userId}`;
    const selection = getParticipantSelection(participant);
    const specialization = selection === 'Shai' ? 'shai' : getParticipantSpecialization(participant);
    return { name, selection, specialization };
  });

  const nameWidth = Math.min(Math.max(...rows.map(row => displayWidth(row.name))), 20);
  const classWidth = Math.min(Math.max(0, ...rows.map(row => displayWidth(row.selection || ''))), 20);
  const lines = rows.map(({ name, selection, specialization }) => {
    const paddedName = padName(name, nameWidth);
    const classIcon = getClassEmojiMarkup(selection, guild);
    const safeName = paddedName.replace(/`/g, 'ˋ');
    if (!selection) return `\`${safeName}\``;
    const specializationDisplay = SPECIALIZATION_DISPLAY[specialization] || SPECIALIZATION_DISPLAY.not_applicable;
    const paddedClass = padName(selection, classWidth);
    return `${classIcon ? `${classIcon} ` : ''}\`[${specializationDisplay.symbol} ${paddedClass}]   ${safeName}\``;
  });

  const output = [];
  for (const line of lines) {
    if (renderState && renderState.remaining <= 0) break;
    const hiddenAfterAdding = lines.length - output.length - 1;
    const summaryLength = hiddenAfterAdding > 0 ? `\n… 另有 ${hiddenAfterAdding} 人未显示`.length : 0;
    const candidateLength = output.join('\n').length + (output.length > 0 ? 1 : 0) + line.length + summaryLength;
    if (candidateLength > MAX_PARTICIPANT_FIELD_LENGTH) break;
    output.push(line);
    if (renderState) renderState.remaining--;
  }

  const hiddenCount = lines.length - output.length;
  if (hiddenCount > 0) {
    output.push(`… 另有 ${hiddenCount} 人未显示`);
  }
  return output.join('\n');
}

function isSelectRoleMode(attendance) {
  if (!attendance) return false;
  return attendance.selectRole ?? attendance.selectionRequired ?? false;
}

function getDeclinedCount(attendance) {
  return Object.keys(attendance.declinedParticipants || {}).length;
}

const BLACK_DESERT_CLASSES = [
  { name: 'Agent', chineseName: '男枪', emojiName: 'bdo_agent' },
  { name: 'Archer', chineseName: '男弓', emojiName: 'bdo_archer' },
  { name: 'Berserker', chineseName: '男蛮子', emojiName: 'bdo_berserker' },
  { name: 'Corsair', chineseName: '人鱼', emojiName: 'bdo_corsair' },
  { name: 'Dark Knight', chineseName: '黑骑', emojiName: 'bdo_dark_knight' },
  { name: 'Deadeye', chineseName: '女枪', emojiName: 'bdo_deadeye' },
  { name: 'Dosa', chineseName: '道士', emojiName: 'bdo_dosa' },
  { name: 'Drakania', chineseName: '龙女', emojiName: 'bdo_drakania' },
  { name: 'Guardian', chineseName: '女蛮子', emojiName: 'bdo_guardian' },
  { name: 'Hashashin', chineseName: '哈萨辛', emojiName: 'bdo_hashashin' },
  { name: 'Kunoichi', chineseName: '女忍', emojiName: 'bdo_kunoichi' },
  { name: 'Lahn', chineseName: '兰', emojiName: 'bdo_lahn' },
  { name: 'Maegu', chineseName: '魅狐', emojiName: 'bdo_maegu' },
  { name: 'Maehwa', chineseName: '梅花', emojiName: 'bdo_maehwa' },
  { name: 'Mystic', chineseName: '女拳', emojiName: 'bdo_mystic' },
  { name: 'Musa', chineseName: '武士', emojiName: 'bdo_musa' },
  { name: 'Ninja', chineseName: '男忍', emojiName: 'bdo_ninja' },
  { name: 'Nova', chineseName: '诺娃', emojiName: 'bdo_nova' },
  { name: 'Ranger', chineseName: '女弓', emojiName: 'bdo_ranger' },
  { name: 'Sage', chineseName: '大贤者', emojiName: 'bdo_sage' },
  { name: 'Scholar', chineseName: '大锤', emojiName: 'bdo_scholar' },
  { name: 'Seraph', chineseName: '女大剑', emojiName: 'bdo_seraph' },
  { name: 'Shai', chineseName: '莎亦', emojiName: 'bdo_shai' },
  { name: 'Sorceress', chineseName: '魔女', emojiName: 'bdo_sorceress' },
  { name: 'Striker', chineseName: '男拳', emojiName: 'bdo_striker' },
  { name: 'Tamer', chineseName: '兽娘', emojiName: 'bdo_tamer' },
  { name: 'Valkyrie', chineseName: '女武神', emojiName: 'bdo_valkyrie' },
  { name: 'Warrior', chineseName: '男大剑', emojiName: 'bdo_warrior' },
  { name: 'Witch', chineseName: '女法', emojiName: 'bdo_witch' },
  { name: 'Wizard', chineseName: '男法', emojiName: 'bdo_wizard' },
  { name: 'Woosa', chineseName: '羽士', emojiName: 'bdo_woosa' },
  { name: 'Wukong', chineseName: '悟空', emojiName: 'bdo_wukong' },
];

function buildClassMenu(customId, placeholder, classes, guild) {
  const guildEmojis = guild?.emojis?.cache ?? new Map();

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(classes.map(({ name, chineseName, emojiName }) => {
        const emoji = guildEmojis.find?.((entry) => entry.name === emojiName) ?? guildEmojis.get?.(emojiName) ?? null;

        return {
          label: name,
          value: name,
          description: chineseName,
          ...(emoji ? { emoji: { id: emoji.id, name: emoji.name } } : {}),
        };
      })),
  );
}

function buildAdminMenuRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('attendance_admin_menu')
      .setPlaceholder('⚙️ 管理员操作')
      .addOptions(
        { label: '🧩 分队管理', value: 'group_open' },
        { label: '📍 更新分组频道', value: 'group_channel_change' },
        { label: '🔄 刷新玩家名称', value: 'refresh_names' },
        { label: '🔒 关闭此报名', value: 'close_signup' },
      ),
  );
}

function buildAttendanceComponents(attendance, guild) {
  if (attendance.status === 'ended') return [];

  const declinedCount = getDeclinedCount(attendance);
  const nextTimeLabel = declinedCount > 0
    ? `下次一定U•ェ•*U (${declinedCount})`
    : '下次一定U•ェ•*U';

  if (!isSelectRoleMode(attendance)) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('attendance_join')
          .setLabel('报名')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('attendance_next_time')
          .setLabel(nextTimeLabel)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('attendance_cancel')
          .setLabel('取消报名')
          .setStyle(ButtonStyle.Danger),
      ),
      buildAdminMenuRow(),
    ];
  }

  const midpoint = Math.ceil(BLACK_DESERT_CLASSES.length / 2);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('attendance_next_time')
        .setLabel(nextTimeLabel)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('attendance_cancel')
        .setLabel('取消报名')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('attendance_specialization_change')
        .setLabel('⚔️ 继承/觉醒')
        .setStyle(ButtonStyle.Primary),
    ),
    buildClassMenu('attendance_class:first', '选择职业 (Archer - Musa)', BLACK_DESERT_CLASSES.slice(0, midpoint), guild),
    buildClassMenu('attendance_class:second', '选择职业 (Ninja - Wukong)', BLACK_DESERT_CLASSES.slice(midpoint), guild),
    buildAdminMenuRow(),
  ];
}

function buildAttendanceEmbed(attendance, options = {}) {
  if (attendance.published && !options.ended) {
    return buildGroupPanelEmbed(attendance, options.guild, true);
  }

  const participantIds = getParticipantIds(attendance);
  const participantTable = buildParticipantTable(participantIds, attendance, options.guild);

  return new EmbedBuilder()
    .setColor(options.ended ? 0x99AAB5 : 0x57F287)
    .setTitle(`${options.ended ? '📌 报名已结束' : '📌 活动报名'}：${attendance.title}`)
    .setDescription([
      attendance.description || '请点下方按钮报名参加。',
      '',
      `🖱️ 报名方式：${isSelectRoleMode(attendance) ? '选择下方职业即可报名或更新职业' : '点击下方按钮报名'}`,
      `👥 当前报名：${participantIds.length} 人`,
    ].join('\n'))
    .addFields({
      name: '报名名单',
      value: participantTable,
      inline: false,
    })
    .setFooter({ text: options.footerText || (options.ended ? '该报名帖已结束' : '可随时点击取消报名退出名单') })
    .setTimestamp();
}

function buildAttendanceResultEmbed(attendance, footerText = '该报名帖已结束', guild = null) {
  const participantIds = getParticipantIds(attendance);
  const resultTable = buildParticipantTable(participantIds, attendance, guild);

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📋 报名结果：${attendance.title}`)
    .setDescription([
      attendance.description || '活动报名统计',
      '',
      `👥 最终报名：${participantIds.length} 人`,
    ].join('\n'))
    .addFields({
      name: '参与名单',
      value: resultTable,
      inline: false,
    })
    .setFooter({ text: footerText })
    .setTimestamp();
}

function nextGroupId(attendance) {
  const existingIds = new Set((attendance.groups || []).map(group => group.id));
  let n = 1;
  while (existingIds.has(`g${n}`)) n++;
  return `g${n}`;
}

function getAssignedUserIds(attendance) {
  const assigned = new Set();
  for (const group of attendance.groups || []) {
    for (const userId of group.memberIds || []) assigned.add(userId);
  }
  return assigned;
}

function buildSpecializationButtons(messageId, classIndex) {
  const customIdPrefix = `attendance_specialization:${messageId}:${classIndex}`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:succession`)
      .setLabel('🔵 继承')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:awakening`)
      .setLabel('🟠 觉醒')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:not_applicable`)
      .setLabel('⚪ 不适用')
      .setStyle(ButtonStyle.Secondary),
  );
}

function removeUserFromGroups(attendance, userId) {
  for (const group of attendance.groups || []) {
    group.memberIds = group.memberIds.filter(memberId => memberId !== userId);
  }
}

function buildGroupPanelEmbed(attendance, guild = null, published = false) {
  const groups = attendance.groups || [];
  const assignedIds = getAssignedUserIds(attendance);
  const unassignedIds = getParticipantIds(attendance).filter(userId => !assignedIds.has(userId));
  const renderState = { remaining: MAX_GROUP_PANEL_VISIBLE_MEMBERS };

  const embed = new EmbedBuilder()
    .setColor(published ? 0x57F287 : 0x5865f2)
    .setTitle(`${published ? '📌 活动报名' : '🧩 分队面板'}：${attendance.title}`)
    .setDescription(published
      ? [
        attendance.description || '请点下方按钮报名参加。',
        '',
        `🖱️ 报名方式：${isSelectRoleMode(attendance) ? '选择下方职业即可报名或更新职业' : '点击下方按钮报名'}`,
        `👥 当前报名：${getParticipantIds(attendance).length} 人`,
        '📋 新报名或更换职业的玩家会进入 Waitlist，等待管理员分配。',
      ].join('\n')
      : (groups.length > 0 ? '按队伍查看当前分组情况' : '当前还没有任何队伍，点击下方「新建队伍」开始。'))
    .setTimestamp();

  for (const group of groups) {
    const memberLine = buildParticipantTable(group.memberIds, attendance, guild, renderState);
    const capacityLabel = group.capacity ? `${group.memberIds.length}/${group.capacity}` : `${group.memberIds.length}`;

    embed.addFields({
      name: `${group.label} (${capacityLabel})`,
      value: memberLine,
      inline: !published,
    });
  }

  embed.addFields({
    name: `${published ? 'Waitlist' : '未分组'} (${unassignedIds.length})`,
    value: buildParticipantTable(unassignedIds, attendance, guild, renderState),
    inline: false,
  });

  if (published) embed.setFooter({ text: '可随时点击取消报名退出名单' });
  return embed;
}

function buildGroupPanelComponents(attendance) {
  const hasGroups = (attendance.groups || []).length > 0;
  const reachedGroupLimit = (attendance.groups || []).length >= MAX_ATTENDANCE_GROUPS;

  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('attendance_group_action:create')
      .setLabel('➕ 新建队伍')
      .setStyle(ButtonStyle.Success)
      .setDisabled(reachedGroupLimit),
    new ButtonBuilder()
      .setCustomId('attendance_group_action:delete')
      .setLabel('🗑️ 删除队伍')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasGroups),
    new ButtonBuilder()
      .setCustomId('attendance_group_action:assign')
      .setLabel('👥 分配成员')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasGroups),
    new ButtonBuilder()
      .setCustomId('attendance_group_action:refresh')
      .setLabel('🔄 刷新')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('attendance_group_action:publish')
      .setLabel('📢 发布')
      .setStyle(ButtonStyle.Primary),
  ), new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('attendance_group_action:close')
      .setLabel('✖️ 关闭面板')
      .setStyle(ButtonStyle.Secondary),
  )];
}

async function deleteGroupPanel(interaction, title, attendance) {
  attendance.groupPanelMessageId = null;
  attendance.groupPanelChannelId = null;
  updateAttendance(title, attendance);
  await interaction.message.delete().catch(error => {
    console.error('[attendance] 删除分队面板失败:', error.message);
  });
}

async function removeExistingGroupPanel(client, attendance) {
  const channelId = attendance.groupPanelChannelId;
  const messageId = attendance.groupPanelMessageId;
  attendance.groupPanelChannelId = null;
  attendance.groupPanelMessageId = null;
  if (!channelId || !messageId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(messageId);
    await message.delete();
  } catch (error) {
    console.warn('[attendance] 旧分队面板已不存在或无法删除:', error.message);
  }
}

async function getExistingGroupPanelMessage(client, attendance) {
  if (!attendance.groupPanelChannelId || !attendance.groupPanelMessageId) return null;
  try {
    const channel = await client.channels.fetch(attendance.groupPanelChannelId);
    if (!channel || !channel.isTextBased()) return null;
    return await channel.messages.fetch(attendance.groupPanelMessageId);
  } catch {
    return null;
  }
}

function buildExistingGroupPanelRow(guildId, attendance) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('➡️ 前往分队面板')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${attendance.groupPanelChannelId}/${attendance.groupPanelMessageId}`),
  );
}

function buildGroupChannelSelector(originalMessageId, mode) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`attendance_group_channel_select:${originalMessageId}:${mode}`)
      .setPlaceholder('选择分队面板发送频道')
      .setMinValues(1)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText),
  );
}

async function getWritableGroupChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ])) return null;
  return channel;
}

async function sendGroupPanelToChannel(client, title, attendance, channel, guild) {
  await removeExistingGroupPanel(client, attendance);
  updateAttendance(title, attendance);
  const panelMessage = await channel.send({
    embeds: [buildGroupPanelEmbed(attendance, guild)],
    components: buildGroupPanelComponents(attendance),
  });
  attendance.groupPanelMessageId = panelMessage.id;
  attendance.groupPanelChannelId = panelMessage.channelId;
  updateAttendance(title, attendance);
}

async function refreshGroupPanelMessage(client, attendance) {
  if (!attendance.groupPanelChannelId || !attendance.groupPanelMessageId) return;

  try {
    const channel = await client.channels.fetch(attendance.groupPanelChannelId);
    if (!channel || !channel.isTextBased()) return;
    const guild = attendance.guildId
      ? await client.guilds.fetch(attendance.guildId).catch(() => null)
      : channel.guild;

    const message = await channel.messages.fetch(attendance.groupPanelMessageId);
    await message.edit({
      embeds: [buildGroupPanelEmbed(attendance, guild)],
      components: buildGroupPanelComponents(attendance),
    });
  } catch (error) {
    console.error('[attendance] 刷新分队面板失败:', error.message);
  }
}

async function closeAttendance(client, title, attendance) {
  attendance.status = 'ended';
  updateAttendance(title, attendance);

  if (attendance.channelId && attendance.messageId) {
    try {
      const channel = await client.channels.fetch(attendance.channelId);
      if (channel && channel.isTextBased()) {
        const message = await channel.messages.fetch(attendance.messageId);
        await message.edit({
          embeds: [buildAttendanceEmbed(attendance, { ended: true, guild: channel.guild })],
          components: [],
        });
      }
    } catch {
      // 原消息已被删除或机器人无权限编辑时忽略
    }
  }

  archiveAttendance(title);
}

async function resetAdminMenuSelection(interaction, attendance) {
  try {
    await interaction.message.edit({
      components: buildAttendanceComponents(attendance, interaction.guild),
    });
  } catch (error) {
    console.error('[attendance] 重置管理员操作菜单失败:', error.message);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('attendance')
    .setDescription('创建和管理按钮报名帖')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('创建一个新的按钮报名帖')
        .addStringOption(option =>
          option
            .setName('title')
            .setDescription('报名标题')
            .setRequired(true),
        )
        .addBooleanOption(option =>
          option
            .setName('select_role')
            .setDescription('是否启用职业选择报名模式')
            .setRequired(true),
        )
        .addStringOption(option =>
          option
            .setName('description')
            .setDescription('报名说明')
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('查看当前进行中的报名帖'),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('participants')
        .setDescription('查看某个报名帖当前所有报名者')
        .addStringOption(option =>
          option
            .setName('title')
            .setDescription('报名标题，必须完全一致')
            .setRequired(true),
        )
        .addBooleanOption(option =>
          option
            .setName('public')
            .setDescription('true 时在频道里公开 @ 名单；默认 false 为私密查看')
            .setRequired(false),
        ),
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('end')
        .setDescription('手动结束一个报名帖')
        .addStringOption(option =>
          option
            .setName('title')
            .setDescription('报名标题，必须完全一致')
            .setRequired(true),
        ),
    )
    .addSubcommandGroup(group =>
      group
        .setName('group')
        .setDescription('分队管理')
        .addSubcommand(subcommand =>
          subcommand
            .setName('panel')
            .setDescription('打开某个报名帖的分队面板（仅管理员）')
            .addStringOption(option =>
              option
                .setName('title')
                .setDescription('报名标题，必须完全一致')
                .setRequired(true),
            ),
        ),
    ),

  async execute(interaction) {
    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    if (subcommandGroup === 'group' && subcommand === 'panel') {
      if (!isAdminInteraction(interaction)) {
        await interaction.reply({ content: '❌ 分队面板仅管理员可用。', flags: 64 });
        return;
      }

      const title = interaction.options.getString('title', true).trim();
      const attendance = loadAttendance(title);

      if (!attendance) {
        await interaction.reply({
          content: `❌ 没有找到名为 **${title}** 的报名帖`,
          flags: 64,
        });
        return;
      }

      await interaction.deferReply({ flags: 64 });
      const existingPanel = await getExistingGroupPanelMessage(interaction.client, attendance);
      if (existingPanel) {
        await interaction.editReply({
          content: '⚠️ 该活动已经有一个分队面板，请前往现有面板继续操作。',
          components: [buildExistingGroupPanelRow(interaction.guildId, attendance)],
        });
        return;
      }
      if (attendance.groupPanelMessageId || attendance.groupPanelChannelId) {
        attendance.groupPanelMessageId = null;
        attendance.groupPanelChannelId = null;
        updateAttendance(title, attendance);
      }

      const savedChannelId = getGroupChannelId(interaction.guildId);
      const targetChannel = await getWritableGroupChannel(interaction.guild, savedChannelId);
      if (!targetChannel) {
        await interaction.editReply({
          content: savedChannelId
            ? '原分组频道已不存在或机器人没有发送权限，请重新选择：'
            : '首次使用分队管理，请选择分队面板发送频道：',
          components: [buildGroupChannelSelector(attendance.messageId, 'open')],
        });
        return;
      }

      await sendGroupPanelToChannel(interaction.client, title, attendance, targetChannel, interaction.guild);
      await interaction.editReply({ content: `✅ 分队面板已发送到 <#${targetChannel.id}>。` });
      return;
    }

    if (subcommand === 'create') {
      const title = interaction.options.getString('title', true).trim();
      const description = (interaction.options.getString('description', false) || '').trim();
      const selectRole = interaction.options.getBoolean('select_role', true);

      if (attendanceExistsByTitle(title)) {
        await interaction.reply({
          content: `❌ 已经存在名为 **${title}** 的报名帖`,
          flags: 64,
        });
        return;
      }

      const attendance = {
        title,
        description,
        participants: {},
        selectRole,
        status: 'active',
        time: Date.now(),
        createdByUserId: interaction.user.id,
      };

      createAttendance(title, attendance);

      const reply = await interaction.reply({
        embeds: [buildAttendanceEmbed(attendance, { guild: interaction.guild })],
        components: buildAttendanceComponents(attendance, interaction.guild),
      });

      const replyMessage = await interaction.fetchReply();
      attendance.messageId = replyMessage.id;
      attendance.channelId = replyMessage.channelId;
      attendance.guildId = interaction.guildId;
      updateAttendance(title, attendance);

      return;
    }

    if (subcommand === 'list') {
      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;

      if (!isAdmin) {
        await interaction.reply({
          content: '❌ `/attendance list` 仅管理员可用。',
          flags: 64,
        });
        return;
      }

      const attendances = loadAllAttendances().filter(item => item.data.status === 'active');

      if (attendances.length === 0) {
        await interaction.reply({
          content: '当前没有进行中的报名帖。',
          flags: 64,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📌 报名帖列表')
        .setColor(0x57F287);

      for (const { data } of attendances) {
        const participantCount = getParticipantIds(data).length;

        embed.addFields({
          name: `🟢 ${data.title}`,
          value: [
            `👥 当前报名：${participantCount} 人`,
            isSelectRoleMode(data) ? '🗂️ 报名时需选择黑色沙漠职业' : '🟢 点击报名按钮即可报名',
            data.channelId ? `📍 频道：<#${data.channelId}>` : null,
          ].filter(Boolean).join('\n'),
          inline: false,
        });
      }

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'participants') {
      const title = interaction.options.getString('title', true).trim();
      const isPublic = interaction.options.getBoolean('public', false) || false;
      const attendance = loadAttendance(title);
      const participantIds = attendance ? getParticipantIds(attendance) : [];

      if (!attendance) {
        await interaction.reply({
          content: `❌ 没有找到名为 **${title}** 的报名帖`,
          flags: 64,
        });
        return;
      }

      if (isPublic) {
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
        const isCreator = attendance.createdByUserId === interaction.user.id;

        if (!isAdmin && !isCreator) {
          await interaction.reply({
            content: '❌ 只有管理员或这条报名帖的创建者才能公开 @ 报名名单。',
            flags: 64,
          });
          return;
        }

        if (attendance.channelId && interaction.channelId !== attendance.channelId) {
          await interaction.reply({
            content: `❌ 只能在原报名帖所在频道 <#${attendance.channelId}> 公开 @ 报名名单。`,
            flags: 64,
          });
          return;
        }

        const mentionLine = participantIds.length > 0
          ? participantIds.map(userId => formatParticipantEntry(userId, attendance)).join(' ')
          : '当前无人报名。';

        await interaction.reply({
          content: participantIds.length > 0
            ? `📣 **${attendance.title}** 当前报名名单\n${mentionLine}`
            : `📣 **${attendance.title}** 当前无人报名。`,
          allowedMentions: {
            users: participantIds,
          },
        });
        return;
      }

      await interaction.reply({
        embeds: [buildAttendanceResultEmbed(attendance, attendance.status === 'ended' ? '该报名帖已结束' : '当前报名名单', interaction.guild)],
        flags: 64,
      });
      return;
    }

    if (subcommand === 'end') {
      const title = interaction.options.getString('title', true).trim();
      const attendance = loadAttendance(title);

      if (!attendance) {
        await interaction.reply({
          content: `❌ 没有找到名为 **${title}** 的报名帖`,
          flags: 64,
        });
        return;
      }

      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
      const isCreator = attendance.createdByUserId === interaction.user.id;

      if (!isAdmin && !isCreator) {
        await interaction.reply({
          content: '❌ 只有管理员或这条报名帖的创建者才能结束报名帖。',
          flags: 64,
        });
        return;
      }

      if (attendance.status === 'ended') {
        await interaction.reply({
          content: `⚠️ 报名帖 **${title}** 已经结束`,
          flags: 64,
        });
        return;
      }

      await closeAttendance(interaction.client, title, attendance);

      await interaction.reply({ embeds: [buildAttendanceResultEmbed(attendance, '该报名帖已结束', interaction.guild)] });
    }
  },

  buildAttendanceEmbed,
  buildAttendanceResultEmbed,
  buildAttendanceComponents,
  buildGroupPanelComponents,

  async handleAttendanceButton(interaction) {
    const match = findAttendanceByMessage(interaction.message.id);
    if (!match || match.attendance.status !== 'active') {
      await interaction.reply({ content: '❌ 该报名帖已结束或不存在。', flags: 64 });
      return;
    }

    const { title, attendance } = match;
    attendance.participants = attendance.participants || {};
    attendance.declinedParticipants = attendance.declinedParticipants || {};

    if (interaction.customId === 'attendance_join') {
      delete attendance.declinedParticipants[interaction.user.id];
      attendance.participants[interaction.user.id] = {
        displayName: interaction.member?.displayName || interaction.user.username,
        selection: attendance.participants[interaction.user.id]?.selection ?? null,
      };
      updateAttendance(title, attendance);
      await interaction.update({
        embeds: [buildAttendanceEmbed(attendance, { guild: interaction.guild })],
        components: buildAttendanceComponents(attendance, interaction.guild),
      });
      return;
    }

    if (interaction.customId === 'attendance_next_time') {
      delete attendance.participants[interaction.user.id];
      removeUserFromGroups(attendance, interaction.user.id);
      attendance.declinedParticipants[interaction.user.id] = {
        displayName: interaction.member?.displayName || interaction.user.username,
      };
      updateAttendance(title, attendance);
      await interaction.update({
        embeds: [buildAttendanceEmbed(attendance, { guild: interaction.guild })],
        components: buildAttendanceComponents(attendance, interaction.guild),
      });
      return;
    }

    if (interaction.customId === 'attendance_cancel') {
      delete attendance.participants[interaction.user.id];
      delete attendance.declinedParticipants[interaction.user.id];
      removeUserFromGroups(attendance, interaction.user.id);
      updateAttendance(title, attendance);
      await interaction.update({
        embeds: [buildAttendanceEmbed(attendance, { guild: interaction.guild })],
        components: buildAttendanceComponents(attendance, interaction.guild),
      });
      return;
    }

  },

  async handleAttendanceSpecializationChange(interaction) {
    const match = findAttendanceByMessage(interaction.message.id);
    if (!match || match.attendance.status !== 'active') {
      await interaction.reply({ content: '❌ 该报名帖已结束或不存在。', flags: 64 });
      return;
    }

    const participant = match.attendance.participants?.[interaction.user.id];
    const selection = getParticipantSelection(participant);
    const classIndex = BLACK_DESERT_CLASSES.findIndex(item => item.name === selection);
    if (!participant || classIndex < 0) {
      await interaction.reply({ content: '⚠️ 请先从职业下拉菜单选择职业并完成报名。', flags: 64 });
      return;
    }

    if (selection === 'Shai') {
      await interaction.reply({ content: '🟡 Shai 不需要选择继承或觉醒。', flags: 64 });
      return;
    }

    await interaction.reply({
      content: `当前职业：**${selection}**。请选择继承、觉醒或不适用：`,
      components: [buildSpecializationButtons(interaction.message.id, classIndex)],
      flags: 64,
    });
  },

  async handleAttendanceClassSelection(interaction) {
    const match = findAttendanceByMessage(interaction.message.id);
    if (!match || match.attendance.status !== 'active') {
      await interaction.update({ content: '❌ 该报名帖已结束或不存在。', components: [] });
      return;
    }

    const nextSelection = interaction.values[0];
    const classIndex = BLACK_DESERT_CLASSES.findIndex(item => item.name === nextSelection);
    if (classIndex < 0) {
      await interaction.reply({ content: '❌ 无法识别所选职业，请重新选择。', flags: 64 });
      return;
    }

    if (nextSelection === 'Shai') {
      const { title, attendance } = match;
      attendance.participants = attendance.participants || {};
      attendance.declinedParticipants = attendance.declinedParticipants || {};
      const previousParticipant = attendance.participants[interaction.user.id];
      const changedClass = previousParticipant
        && getParticipantSelection(previousParticipant) !== nextSelection;
      if (attendance.published && changedClass) {
        removeUserFromGroups(attendance, interaction.user.id);
      }
      delete attendance.declinedParticipants[interaction.user.id];
      attendance.participants[interaction.user.id] = {
        displayName: interaction.member?.displayName || interaction.user.username,
        selection: nextSelection,
        specialization: 'shai',
      };
      updateAttendance(title, attendance);
      await interaction.update({
        embeds: [buildAttendanceEmbed(attendance, { guild: interaction.guild })],
        components: buildAttendanceComponents(attendance, interaction.guild),
      });
      return;
    }

    await interaction.reply({
      content: `已选择 **${nextSelection}**，请选择继承、觉醒或不适用：`,
      components: [buildSpecializationButtons(interaction.message.id, classIndex)],
      flags: 64,
    });
  },

  async handleAttendanceSpecialization(interaction) {
    const [, originalMessageId, classIndexRaw, specialization] = interaction.customId.split(':');
    const classInfo = BLACK_DESERT_CLASSES[Number.parseInt(classIndexRaw, 10)];
    const match = findAttendanceByMessage(originalMessageId);
    const validSpecialization = classInfo?.name === 'Shai'
      ? specialization === 'shai'
      : ['succession', 'awakening', 'not_applicable'].includes(specialization);

    if (!match || match.attendance.status !== 'active' || !classInfo || !validSpecialization) {
      await interaction.update({ content: '❌ 该选择已失效，请回到报名面板重新选择职业。', components: [] });
      return;
    }

    await interaction.deferUpdate();
    const { title, attendance } = match;
    attendance.participants = attendance.participants || {};
    attendance.declinedParticipants = attendance.declinedParticipants || {};
    const previousParticipant = attendance.participants[interaction.user.id];
    const changedClass = previousParticipant
      && getParticipantSelection(previousParticipant) !== classInfo.name;

    if (attendance.published && changedClass) {
      removeUserFromGroups(attendance, interaction.user.id);
    }

    delete attendance.declinedParticipants[interaction.user.id];
    attendance.participants[interaction.user.id] = {
      displayName: interaction.member?.displayName || interaction.user.username,
      selection: classInfo.name,
      specialization,
    };
    updateAttendance(title, attendance);

    try {
      const channel = await interaction.client.channels.fetch(attendance.channelId);
      const signupMessage = await channel.messages.fetch(attendance.messageId);
      await signupMessage.edit({
        embeds: [buildAttendanceEmbed(attendance, { guild: interaction.guild })],
        components: buildAttendanceComponents(attendance, interaction.guild),
      });
    } catch (error) {
      console.error('[attendance] 更新职业与形态失败:', error.message);
    }

    await interaction.deleteReply().catch(() => interaction.editReply({ content: '\u200b', components: [] }));
  },

  async handleAttendanceAdminMenu(interaction) {
    const match = findAttendanceByMessage(interaction.message.id);
    if (!match || match.attendance.status !== 'active') {
      await interaction.reply({ content: '❌ 该报名帖已结束或不存在。', flags: 64 });
      return;
    }

    if (!isAdminInteraction(interaction)) {
      await interaction.reply({ content: '❌ 该操作仅管理员可用。', flags: 64 });
      return;
    }

    const { title, attendance } = match;
    const action = interaction.values[0];

    if (action === 'refresh_names') {
      await interaction.deferUpdate();
      const participantIds = getParticipantIds(attendance);
      const memberResults = await Promise.allSettled(
        participantIds.map(userId => interaction.guild.members.fetch(userId)),
      );

      memberResults.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        const participant = attendance.participants?.[participantIds[index]];
        if (participant && typeof participant === 'object') {
          participant.displayName = result.value.displayName;
        }
      });

      updateAttendance(title, attendance);
      await interaction.message.edit({
        embeds: [buildAttendanceEmbed(attendance, { guild: interaction.guild })],
        components: buildAttendanceComponents(attendance, interaction.guild),
      });
      return;
    }

    if (action === 'group_channel_change') {
      await interaction.reply({
        content: '请选择以后用于发送临时分队面板的频道：',
        components: [buildGroupChannelSelector(interaction.message.id, 'change')],
        flags: 64,
      });
      await resetAdminMenuSelection(interaction, attendance);
      return;
    }

    if (action === 'group_open') {
      await interaction.deferReply({ flags: 64 });
      const existingPanel = await getExistingGroupPanelMessage(interaction.client, attendance);
      if (existingPanel) {
        await interaction.editReply({
          content: '⚠️ 该活动已经有一个分队面板，请前往现有面板继续操作。',
          components: [buildExistingGroupPanelRow(interaction.guildId, attendance)],
        });
        await resetAdminMenuSelection(interaction, attendance);
        return;
      }
      if (attendance.groupPanelMessageId || attendance.groupPanelChannelId) {
        attendance.groupPanelMessageId = null;
        attendance.groupPanelChannelId = null;
        updateAttendance(title, attendance);
      }

      const savedChannelId = getGroupChannelId(interaction.guildId);
      const targetChannel = await getWritableGroupChannel(interaction.guild, savedChannelId);
      if (!targetChannel) {
        await interaction.editReply({
          content: savedChannelId
            ? '原分组频道已不存在或机器人没有发送权限，请重新选择：'
            : '首次使用分队管理，请选择分队面板发送频道：',
          components: [buildGroupChannelSelector(interaction.message.id, 'open')],
        });
        await resetAdminMenuSelection(interaction, attendance);
        return;
      }

      await sendGroupPanelToChannel(interaction.client, title, attendance, targetChannel, interaction.guild);
      await resetAdminMenuSelection(interaction, attendance);
      await interaction.editReply({ content: `✅ 分队面板已发送到 <#${targetChannel.id}>。` });
      return;
    }

    if (action === 'close_signup') {
      await interaction.reply({
        content: `⚠️ 确定要关闭报名帖「${attendance.title}」吗？关闭后将无法继续报名。`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`attendance_close_confirm:${interaction.message.id}`)
            .setLabel('✅ 确认关闭')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('attendance_close_cancel')
            .setLabel('❌ 取消')
            .setStyle(ButtonStyle.Secondary),
        )],
        flags: 64,
      });
      await resetAdminMenuSelection(interaction, attendance);
      return;
    }
  },

  async handleGroupChannelSelect(interaction) {
    if (!isAdminInteraction(interaction)) {
      await interaction.update({ content: '❌ 仅管理员可以设置分组频道。', components: [] });
      return;
    }

    const [, originalMessageId, mode] = interaction.customId.split(':');
    const match = findAttendanceByMessage(originalMessageId);
    if (!match || match.attendance.status !== 'active') {
      await interaction.update({ content: '❌ 该报名帖已结束或不存在。', components: [] });
      return;
    }

    await interaction.deferUpdate();
    const targetChannel = await getWritableGroupChannel(interaction.guild, interaction.values[0]);
    if (!targetChannel) {
      await interaction.editReply({
        content: '❌ 机器人无法在该频道发送分队面板，请选择允许机器人查看、发言和嵌入链接的文字频道。',
        components: [buildGroupChannelSelector(originalMessageId, mode)],
      });
      return;
    }

    setGroupChannelId(interaction.guildId, targetChannel.id);
    if (mode === 'change') {
      await interaction.editReply({ content: `✅ 默认分组频道已更新为 <#${targetChannel.id}>。`, components: [] });
      return;
    }

    const latestMatch = findAttendanceByMessage(originalMessageId);
    if (!latestMatch || latestMatch.attendance.status !== 'active') {
      await interaction.editReply({ content: '❌ 该报名帖已结束或不存在。', components: [] });
      return;
    }

    const { title, attendance } = latestMatch;
    const existingPanel = await getExistingGroupPanelMessage(interaction.client, attendance);
    if (existingPanel) {
      await interaction.editReply({
        content: '⚠️ 该活动已经有一个分队面板，请前往现有面板继续操作。',
        components: [buildExistingGroupPanelRow(interaction.guildId, attendance)],
      });
      return;
    }
    if (attendance.groupPanelMessageId || attendance.groupPanelChannelId) {
      attendance.groupPanelMessageId = null;
      attendance.groupPanelChannelId = null;
      updateAttendance(title, attendance);
    }

    await sendGroupPanelToChannel(interaction.client, title, attendance, targetChannel, interaction.guild);
    try {
      const signupChannel = await interaction.client.channels.fetch(attendance.channelId);
      const signupMessage = await signupChannel.messages.fetch(attendance.messageId);
      await signupMessage.edit({ components: buildAttendanceComponents(attendance, interaction.guild) });
    } catch (error) {
      console.error('[attendance] 重置管理员菜单失败:', error.message);
    }
    await interaction.editReply({ content: `✅ 分队面板已发送到 <#${targetChannel.id}>。`, components: [] });
  },

  async handleAttendanceCloseConfirm(interaction) {
    if (!isAdminInteraction(interaction)) {
      await interaction.update({ content: '❌ 该操作仅管理员可用。', components: [] });
      return;
    }

    const originalMessageId = interaction.customId.split(':')[1];
    const match = findAttendanceByMessage(originalMessageId);

    if (!match) {
      await interaction.update({ content: '❌ 该报名帖已结束或不存在。', components: [] });
      return;
    }

    const { title, attendance } = match;
    await closeAttendance(interaction.client, title, attendance);

    await interaction.update({ content: `✅ 已关闭「${attendance.title}」的报名帖。`, components: [] });
  },

  async handleAttendanceCloseCancel(interaction) {
    await interaction.update({ content: '已取消操作。', components: [] });
  },

  async handleGroupPanelAction(interaction) {
    if (!isAdminInteraction(interaction)) {
      await interaction.reply({ content: '❌ 仅管理员可以操作分队面板。', flags: 64 });
      return;
    }

    const match = findAttendanceByGroupPanelMessage(interaction.message.id);
    if (!match) {
      await interaction.reply({ content: '❌ 找不到该分队面板对应的报名帖。', flags: 64 });
      return;
    }

    const { title, attendance } = match;
    const action = interaction.customId.split(':')[1];

    if (action === 'refresh') {
      await interaction.update({
        embeds: [buildGroupPanelEmbed(attendance, interaction.guild)],
        components: buildGroupPanelComponents(attendance),
      });
      return;
    }

    if (action === 'create') {
      if ((attendance.groups || []).length >= MAX_ATTENDANCE_GROUPS) {
        await interaction.reply({ content: `⚠️ 每个活动最多只能创建 ${MAX_ATTENDANCE_GROUPS} 个队伍。`, flags: 64 });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`attendance_group_create_modal:${interaction.message.id}`)
        .setTitle('新建队伍')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('team_name')
              .setLabel('队伍名称')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(80)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('team_capacity')
              .setLabel('人数上限（留空表示不限）')
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );

      await interaction.showModal(modal);
      return;
    }

    const groups = attendance.groups || [];

    if (action === 'close') {
      await interaction.deferUpdate();
      await deleteGroupPanel(interaction, title, attendance);
      return;
    }

    if (action === 'delete') {
      if (groups.length === 0) {
        await interaction.reply({ content: '⚠️ 当前还没有任何队伍。', flags: 64 });
        return;
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`attendance_group_delete_select:${interaction.message.id}`)
        .setPlaceholder('选择要删除的队伍')
        .setMinValues(1)
        .setMaxValues(Math.min(groups.length, GROUP_SELECT_MAX_VALUES))
        .addOptions(groups.map(group => ({ label: group.label, value: group.id })));

      await interaction.reply({
        content: '选择要删除的队伍（已分配的成员会移回未分组）：',
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        flags: 64,
      });
      return;
    }

    if (action === 'assign') {
      if (groups.length === 0) {
        await interaction.reply({ content: '⚠️ 当前还没有任何队伍，请先新建队伍。', flags: 64 });
        return;
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`attendance_group_target_select:${interaction.message.id}`)
        .setPlaceholder('选择要分配成员的队伍')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(groups.map(group => ({ label: group.label, value: group.id })));

      await interaction.reply({
        content: '第一步：选择要分配成员的队伍',
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        flags: 64,
      });
      return;
    }

    if (action === 'publish') {
      await interaction.deferUpdate();
      try {
        const channel = await interaction.client.channels.fetch(attendance.channelId);
        const signupMessage = await channel.messages.fetch(attendance.messageId);
        attendance.published = true;
        await signupMessage.edit({
          embeds: [buildGroupPanelEmbed(attendance, interaction.guild, true)],
          components: buildAttendanceComponents(attendance, interaction.guild),
        });
      } catch (error) {
        console.error('[attendance] 发布分组到报名帖失败:', error.message);
        await interaction.followUp({ content: '❌ 无法更新原活动报名面板，请检查消息是否仍存在以及机器人权限。', flags: 64 });
        return;
      }
      await deleteGroupPanel(interaction, title, attendance);
      return;
    }
  },

  async handleGroupCreateModalSubmit(interaction) {
    const panelMessageId = interaction.customId.split(':')[1];

    if (!isAdminInteraction(interaction)) {
      await interaction.reply({ content: '❌ 仅管理员可以操作分队面板。', flags: 64 });
      return;
    }

    const match = findAttendanceByGroupPanelMessage(panelMessageId);
    if (!match) {
      await interaction.reply({ content: '❌ 找不到该分队面板对应的报名帖。', flags: 64 });
      return;
    }

    const { title, attendance } = match;
    const name = interaction.fields.getTextInputValue('team_name').trim();
    const capacityRaw = interaction.fields.getTextInputValue('team_capacity').trim();
    const capacity = capacityRaw ? Number.parseInt(capacityRaw, 10) : null;

    if (!name) {
      await interaction.reply({ content: '❌ 队伍名称不能为空。', flags: 64 });
      return;
    }

    if (capacityRaw && (!Number.isFinite(capacity) || capacity <= 0)) {
      await interaction.reply({ content: '❌ 人数上限必须是大于 0 的数字，或留空表示不限。', flags: 64 });
      return;
    }

    if ((attendance.groups || []).length >= MAX_ATTENDANCE_GROUPS) {
      await interaction.reply({ content: `⚠️ 每个活动最多只能创建 ${MAX_ATTENDANCE_GROUPS} 个队伍。`, flags: 64 });
      return;
    }

    const newGroup = {
      id: nextGroupId(attendance),
      label: name,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
      memberIds: [],
    };

    await interaction.deferUpdate();
    attendance.groups = [...(attendance.groups || []), newGroup];
    updateAttendance(title, attendance);
    await refreshGroupPanelMessage(interaction.client, attendance);
  },

  async handleGroupDeleteSelect(interaction) {
    const panelMessageId = interaction.customId.split(':')[1];

    if (!isAdminInteraction(interaction)) {
      await interaction.reply({ content: '❌ 仅管理员可以操作分队面板。', flags: 64 });
      return;
    }

    const match = findAttendanceByGroupPanelMessage(panelMessageId);
    if (!match) {
      await interaction.update({ content: '❌ 找不到该分队面板对应的报名帖。', components: [] });
      return;
    }

    const { title, attendance } = match;
    const selectedIds = new Set(interaction.values);

    await interaction.deferUpdate();
    attendance.groups = (attendance.groups || []).filter(group => !selectedIds.has(group.id));
    updateAttendance(title, attendance);
    await refreshGroupPanelMessage(interaction.client, attendance);
    await interaction.deleteReply().catch(() => interaction.editReply({ content: '\u200b', components: [] }));
  },

  async handleGroupTargetSelect(interaction) {
    const panelMessageId = interaction.customId.split(':')[1];

    if (!isAdminInteraction(interaction)) {
      await interaction.reply({ content: '❌ 仅管理员可以操作分队面板。', flags: 64 });
      return;
    }

    const match = findAttendanceByGroupPanelMessage(panelMessageId);
    if (!match) {
      await interaction.update({ content: '❌ 找不到该分队面板对应的报名帖。', components: [] });
      return;
    }

    const { attendance } = match;
    const groupId = interaction.values[0];
    const group = (attendance.groups || []).find(item => item.id === groupId);

    if (!group) {
      await interaction.update({ content: '❌ 该队伍已不存在，请重新操作。', components: [] });
      return;
    }

    const participantIds = getParticipantIds(attendance);
    if (participantIds.length === 0) {
      await interaction.update({ content: '⚠️ 当前没有已报名成员可供分配。', components: [] });
      return;
    }

    const selectableIds = participantIds.slice(0, GROUP_SELECT_MAX_VALUES * 5);
    const chunks = [];
    for (let index = 0; index < selectableIds.length; index += GROUP_SELECT_MAX_VALUES) {
      chunks.push(selectableIds.slice(index, index + GROUP_SELECT_MAX_VALUES));
    }
    const memberRows = chunks.map((chunk, pageIndex) => new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`attendance_group_user_select:${panelMessageId}:${groupId}:${pageIndex}`)
        .setPlaceholder(`${group.label}：已报名成员 ${pageIndex + 1}/${chunks.length}`)
        .setMinValues(1)
        .setMaxValues(chunk.length)
        .addOptions(chunk.map(userId => {
        const participant = attendance.participants[userId];
        const selection = getParticipantSelection(participant);
        const classInfo = BLACK_DESERT_CLASSES.find(item => item.name === selection);
        const emoji = classInfo
          ? interaction.guild?.emojis?.cache?.find(entry => entry.name === classInfo.emojiName)
          : null;
        return {
          label: String(participant?.displayName || `用户${userId}`).slice(0, 100),
          value: userId,
          ...(selection ? { description: selection.slice(0, 100) } : {}),
          ...(emoji ? { emoji: { id: emoji.id, name: emoji.name } } : {}),
        };
        })),
    ));

    await interaction.update({
      content: `第二步：选择要加入「${group.label}」的已报名成员${participantIds.length > GROUP_SELECT_MAX_VALUES * 5 ? '（Discord 单次最多显示前 125 人）' : ''}`,
      components: memberRows,
    });
  },

  async handleGroupUserSelect(interaction) {
    const [, panelMessageId, groupId] = interaction.customId.split(':');

    if (!isAdminInteraction(interaction)) {
      await interaction.reply({ content: '❌ 仅管理员可以操作分队面板。', flags: 64 });
      return;
    }

    const match = findAttendanceByGroupPanelMessage(panelMessageId);
    if (!match) {
      await interaction.update({ content: '❌ 找不到该分队面板对应的报名帖。', components: [] });
      return;
    }

    const { title, attendance } = match;
    const group = (attendance.groups || []).find(item => item.id === groupId);

    if (!group) {
      await interaction.update({ content: '❌ 该队伍已不存在，请重新操作。', components: [] });
      return;
    }

    const registeredIds = new Set(getParticipantIds(attendance));
    const selectedUserIds = interaction.values.filter(userId => registeredIds.has(userId));

    if (selectedUserIds.length === 0) {
      await interaction.update({ content: '❌ 所选成员已不在报名名单中，请重新分配。', components: [] });
      return;
    }

    await interaction.deferUpdate();

    for (const otherGroup of attendance.groups) {
      otherGroup.memberIds = otherGroup.memberIds.filter(userId => !selectedUserIds.includes(userId));
    }
    group.memberIds = Array.from(new Set([...group.memberIds, ...selectedUserIds]));

    updateAttendance(title, attendance);
    await refreshGroupPanelMessage(interaction.client, attendance);
    await interaction.deleteReply().catch(() => interaction.editReply({ content: '\u200b', components: [] }));
  },
};
