const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  createAttendance,
  loadAllAttendances,
  loadAttendance,
  updateAttendance,
  archiveAttendance,
  attendanceExistsByTitle,
} = require('../storage/attendanceStore');

const DEFAULT_EMOJI = '✅';

function getParticipantIds(attendance) {
  return Object.keys(attendance.participants || {});
}

function buildAttendanceEmbed(attendance, options = {}) {
  const participantIds = getParticipantIds(attendance);
  const participantLine = participantIds.length > 0
    ? participantIds.map(userId => `<@${userId}>`).join('\n')
    : '暂时还没有人报名';

  return new EmbedBuilder()
    .setColor(options.ended ? 0x99AAB5 : 0x57F287)
    .setTitle(`${options.ended ? '📌 报名已结束' : '📌 活动报名'}：${attendance.title}`)
    .setDescription([
      attendance.description || '请点下方 reaction 报名参加。',
      '',
      `✅ 报名 reaction：${attendance.emoji || DEFAULT_EMOJI}`,
      `👥 当前报名：${participantIds.length} 人`,
    ].join('\n'))
    .addFields({
      name: '报名名单',
      value: participantLine,
      inline: false,
    })
    .setFooter({ text: options.footerText || (options.ended ? '该报名帖已结束' : '点 reaction 即可加入，取消 reaction 即可退出') })
    .setTimestamp();
}

function buildAttendanceResultEmbed(attendance, footerText = '该报名帖已结束') {
  const participantIds = getParticipantIds(attendance);
  const resultLine = participantIds.length > 0
    ? participantIds.map(userId => `<@${userId}>`).join('\n')
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
    .setDescription('创建和管理 reaction 报名帖')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('创建一个新的 reaction 报名帖')
        .addStringOption(option =>
          option
            .setName('title')
            .setDescription('报名标题')
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
        emoji: DEFAULT_EMOJI,
        participants: {},
        status: 'active',
        time: Date.now(),
        createdByUserId: interaction.user.id,
      };

      createAttendance(title, attendance);

      await interaction.reply({
        embeds: [buildAttendanceEmbed(attendance)],
        fetchReply: true,
      });

      const replyMessage = await interaction.fetchReply();
      attendance.messageId = replyMessage.id;
      attendance.channelId = replyMessage.channelId;
      attendance.guildId = interaction.guildId;
      updateAttendance(title, attendance);

      try {
        await replyMessage.react(DEFAULT_EMOJI);
      } catch (error) {
        console.error('[attendance] 添加默认 reaction 失败:', error.message);
      }

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
          ? participantIds.map(userId => `<@${userId}>`).join(' ')
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
};