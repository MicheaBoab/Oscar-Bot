const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { renderRecurringDiscordTimestamps } = require('../helper/timeHelpers');
const { getLastAnnounce, setLastAnnounce } = require('../storage/announceHistoryStore');

const ALIASES_FILE = path.join(__dirname, '../storage/roleAliases.json');
const NOTICES_FILE = path.join(__dirname, '../storage/noticeTexts.json');
const DISCORD_TS_REGEX = /<t:(\d{1,12})(?::[tTdDfFRsS])?>/g;

function loadRoleAliases() {
  if (fs.existsSync(ALIASES_FILE)) {
    return JSON.parse(fs.readFileSync(ALIASES_FILE, 'utf-8'));
  }
  return { aliases: {} };
}

function loadNotices() {
  if (fs.existsSync(NOTICES_FILE)) {
    return JSON.parse(fs.readFileSync(NOTICES_FILE, 'utf-8'));
  }
  return { notices: {} };
}

function resolveNoticeText(textKeyRaw) {
  const textKey = String(textKeyRaw || '').trim().toLowerCase();
  const data = loadNotices();
  const notice = data.notices?.[textKey];
  if (!notice) {
    return { ok: false, textKey, text: null, imagePath: null };
  }

  if (typeof notice === 'string') {
    return { ok: true, textKey, text: notice, imagePath: null };
  }

  return {
    ok: true,
    textKey,
    text: String(notice.text || ''),
    imagePath: notice.imagePath ? String(notice.imagePath) : null,
  };
}

function parseSignedOffset(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return { ok: true, seconds: 0, normalized: '+0s' };
  }

  const match = text.match(/^([+-])\s*(\d+)\s*([smhd])$/i);
  if (!match) {
    return {
      ok: false,
      error: 'offset 格式无效。请使用例如 +10m、-30s、+2h、-1d',
    };
  }

  const sign = match[1] === '+' ? 1 : -1;
  const amount = Number(match[2]);
  const unit = match[3].toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      error: 'offset 数字必须大于 0',
    };
  }

  let multiplier = 1;
  if (unit === 'm') multiplier = 60;
  if (unit === 'h') multiplier = 60 * 60;
  if (unit === 'd') multiplier = 24 * 60 * 60;

  return {
    ok: true,
    seconds: sign * amount * multiplier,
    normalized: `${sign > 0 ? '+' : '-'}${amount}${unit}`,
  };
}

function extractDiscordTimestamps(text) {
  const matches = String(text || '').matchAll(DISCORD_TS_REGEX);
  const unixList = [];
  for (const match of matches) {
    const unix = Number(match[1]);
    if (Number.isFinite(unix) && unix > 0) {
      unixList.push(unix);
    }
  }
  return unixList;
}

async function deletePreviousAnnounceMessage(client, guildId, channelId, messageId) {
  if (!guildId || !channelId || !messageId) return;

  try {
    const channel = await client.channels.fetch(String(channelId));
    if (!channel || !channel.isTextBased()) return;

    const oldMessage = await channel.messages.fetch(String(messageId));
    if (oldMessage) {
      await oldMessage.delete();
    }
  } catch {
    // 旧消息可能已被删除，或机器人无权限删除，忽略即可
  }
}



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
    const guildId = interaction.guildId;
    const roleAlias = interaction.options.getString('role', true).trim().toLowerCase();
    const textKey = interaction.options.getString('text', true).trim().toLowerCase();
    const offsetRaw = interaction.options.getString('offset', false) || '';
    const forceResend = interaction.options.getBoolean('force', false) || false;

    const offset = parseSignedOffset(offsetRaw);
    if (!offset.ok) {
      await interaction.reply({
        content: `❌ ${offset.error}`,
        flags: 64,
      });
      return;
    }

    const roleAliasData = loadRoleAliases();
    const roleIds = roleAliasData.aliases?.[roleAlias];

    if (!Array.isArray(roleIds) || roleIds.length === 0) {
      const aliases = Object.keys(roleAliasData.aliases || {});
      const hint = aliases.length > 0
        ? `\n可用别名：${aliases.map(a => `\`${a}\``).join(', ')}`
        : '\n当前还没有任何 role alias，请先用 /rolealias add 建立。';

      await interaction.reply({
        content: `❌ 找不到 role alias：\`${roleAlias}\`${hint}`,
        flags: 64,
      });
      return;
    }

    const mentionText = roleIds.map(id => `<@&${id}>`).join(' ');
    const noticeResolved = resolveNoticeText(textKey);

    if (!noticeResolved.ok) {
      const notices = loadNotices();
      const aliases = Object.keys(notices.notices || {});
      const hint = aliases.length > 0
        ? `\n可用公告别名：${aliases.map(a => `\`${a}\``).join(', ')}`
        : '\n当前还没有任何公告别名，请先用 /notice add 建立。';

      await interaction.reply({
        content: `❌ 找不到公告别名：\`${textKey}\`${hint}`,
        flags: 64,
      });
      return;
    }

    const lastAnnounce = guildId ? getLastAnnounce(guildId, textKey) : null;
    if (
      lastAnnounce
      && Number.isFinite(lastAnnounce.expiresAtMs)
      && Date.now() < lastAnnounce.expiresAtMs
      && !forceResend
    ) {
      const expiresUnix = Math.floor(lastAnnounce.expiresAtMs / 1000);
      const jumpUrl = lastAnnounce.channelId && lastAnnounce.messageId
        ? `https://discord.com/channels/${guildId}/${lastAnnounce.channelId}/${lastAnnounce.messageId}`
        : null;
      const location = lastAnnounce.channelId ? `<#${lastAnnounce.channelId}>` : '未知频道';

      await interaction.reply({
        content: [
          `⚠️ 公告别名 \`${textKey}\` 的上一条消息尚未过期。`,
          `过期时间：<t:${expiresUnix}:F>（<t:${expiresUnix}:R>）`,
          `发送位置：${location}`,
          jumpUrl ? `消息链接：${jumpUrl}` : null,
          '如需立刻重发并删除旧消息，可使用：`/announce ... force:true`',
        ].filter(Boolean).join('\n'),
        flags: 64,
      });
      return;
    }

    const renderedNoticeText = renderRecurringDiscordTimestamps(
      noticeResolved.text,
      Date.now(),
      offset.seconds
    );
    const content = `${mentionText}\n${renderedNoticeText}`;

    const files = [];
    if (noticeResolved.imagePath) {
      const absoluteImagePath = path.join(__dirname, '../storage', noticeResolved.imagePath);
      if (fs.existsSync(absoluteImagePath)) {
        files.push(new AttachmentBuilder(absoluteImagePath));
      }
    }

    const sentMessage = await interaction.reply({
      content,
      files,
      allowedMentions: {
        roles: roleIds,
      },
      fetchReply: true,
    });

    const renderedUnixList = extractDiscordTimestamps(renderedNoticeText);
    const expiresAtMs = renderedUnixList.length > 0
      ? Math.max(...renderedUnixList) * 1000
      : null;

    if (guildId) {
      setLastAnnounce(guildId, textKey, {
        channelId: sentMessage.channelId,
        messageId: sentMessage.id,
        expiresAtMs,
        sentAtMs: Date.now(),
      });

      const isLastExpired = !!lastAnnounce
        && Number.isFinite(lastAnnounce.expiresAtMs)
        && Date.now() >= lastAnnounce.expiresAtMs;

      if (lastAnnounce && (isLastExpired || forceResend)) {
        await deletePreviousAnnounceMessage(
          interaction.client,
          guildId,
          lastAnnounce.channelId,
          lastAnnounce.messageId,
        );
      }
    }
  },
};
