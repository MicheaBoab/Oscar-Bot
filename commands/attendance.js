const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const {
  createAttendance,
  loadAllAttendances,
  loadAttendance,
  updateAttendance,
  archiveAttendance,
  attendanceExistsByTitle,
  findAttendanceByMessage,
} = require('../storage/attendanceStore');

function getParticipantIds(attendance) {
  return Object.keys(attendance.participants || {});
}

function getParticipantSelection(participant) {
  return participant && typeof participant === 'object' ? participant.selection : null;
}

function formatParticipantEntry(userId, attendance) {
  const selection = getParticipantSelection(attendance.participants?.[userId]);
  return selection ? `<@${userId}> - ${selection}` : `<@${userId}>`;
}

function isSelectRoleMode(attendance) {
  if (!attendance) return false;
  return attendance.selectRole ?? attendance.selectionRequired ?? false;
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

function buildAttendanceComponents(attendance, guild) {
  if (attendance.status === 'ended') return [];

  if (!isSelectRoleMode(attendance)) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('attendance_join')
        .setLabel('报名')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('attendance_cancel')
        .setLabel('取消报名')
        .setStyle(ButtonStyle.Danger),
    )];
  }

  const midpoint = Math.ceil(BLACK_DESERT_CLASSES.length / 2);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('attendance_next_time')
        .setLabel('下次一定U•ェ•*U')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('attendance_cancel')
        .setLabel('取消报名')
        .setStyle(ButtonStyle.Danger),
    ),
    buildClassMenu('attendance_class:first', '选择职业 (Archer - Musa)', BLACK_DESERT_CLASSES.slice(0, midpoint), guild),
    buildClassMenu('attendance_class:second', '选择职业 (Ninja - Wukong)', BLACK_DESERT_CLASSES.slice(midpoint), guild),
  ];
}

function buildAttendanceEmbed(attendance, options = {}) {
  const participantIds = getParticipantIds(attendance);
  const participantLine = participantIds.length > 0
    ? participantIds.map(userId => formatParticipantEntry(userId, attendance)).join('\n')
    : '暂时还没有人报名';

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
      value: participantLine,
      inline: false,
    })
    .setFooter({ text: options.footerText || (options.ended ? '该报名帖已结束' : '可随时点击取消报名退出名单') })
    .setTimestamp();
}

function buildAttendanceResultEmbed(attendance, footerText = '该报名帖已结束') {
  const participantIds = getParticipantIds(attendance);
  const resultLine = participantIds.length > 0
    ? participantIds.map(userId => formatParticipantEntry(userId, attendance)).join('\n')
    : '无人报名';

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
      value: resultLine,
      inline: false,
    })
    .setFooter({ text: footerText })
    .setTimestamp();
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
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

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
        embeds: [buildAttendanceEmbed(attendance)],
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
        embeds: [buildAttendanceResultEmbed(attendance, attendance.status === 'ended' ? '该报名帖已结束' : '当前报名名单')],
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

      attendance.status = 'ended';
      updateAttendance(title, attendance);

      if (attendance.channelId && attendance.messageId) {
        try {
          const channel = await interaction.client.channels.fetch(attendance.channelId);
          if (channel && channel.isTextBased()) {
            const message = await channel.messages.fetch(attendance.messageId);
            await message.edit({
              embeds: [buildAttendanceEmbed(attendance, { ended: true })],
              components: [],
            });
          }
        } catch {
          // 原消息已被删除或机器人无权限编辑时忽略
        }
      }

      archiveAttendance(title);

      await interaction.reply({ embeds: [buildAttendanceResultEmbed(attendance)] });
    }
  },

  buildAttendanceEmbed,
  buildAttendanceResultEmbed,
  buildAttendanceComponents,

  async handleAttendanceButton(interaction) {
    const match = findAttendanceByMessage(interaction.message.id);
    if (!match || match.attendance.status !== 'active') {
      await interaction.reply({ content: '❌ 该报名帖已结束或不存在。', flags: 64 });
      return;
    }

    const { title, attendance } = match;
    attendance.participants = attendance.participants || {};

    if (interaction.customId === 'attendance_join') {
      attendance.participants[interaction.user.id] = {
        displayName: interaction.member?.displayName || interaction.user.username,
        selection: attendance.participants[interaction.user.id]?.selection ?? null,
      };
      updateAttendance(title, attendance);
      await interaction.update({
        embeds: [buildAttendanceEmbed(attendance)],
        components: buildAttendanceComponents(attendance, interaction.guild),
      });
      return;
    }

    if (interaction.customId === 'attendance_next_time') {
      await interaction.reply({ content: '收到，下次见！', flags: 64 });
      return;
    }

    if (interaction.customId === 'attendance_cancel') {
      if (!attendance.participants[interaction.user.id]) {
        await interaction.reply({ content: '⚠️ 你目前尚未报名。', flags: 64 });
        return;
      }

      delete attendance.participants[interaction.user.id];
      updateAttendance(title, attendance);
      await interaction.update({
        embeds: [buildAttendanceEmbed(attendance)],
        components: buildAttendanceComponents(attendance, interaction.guild),
      });
      return;
    }

  },

  async handleAttendanceClassSelection(interaction) {
    const match = findAttendanceByMessage(interaction.message.id);
    if (!match || match.attendance.status !== 'active') {
      await interaction.update({ content: '❌ 该报名帖已结束或不存在。', components: [] });
      return;
    }

    const { title, attendance } = match;
    attendance.participants = attendance.participants || {};
    attendance.participants[interaction.user.id] = {
      displayName: interaction.member?.displayName || interaction.user.username,
      selection: interaction.values[0],
    };
    updateAttendance(title, attendance);

    await interaction.update({
      embeds: [buildAttendanceEmbed(attendance)],
      components: buildAttendanceComponents(attendance, interaction.guild),
    });
  },
};