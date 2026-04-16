const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { loadSignups } = require('../storage/signupFileStore');
const { resolveDisplayName } = require('../helper/displayNameCache');

const PAGE_SIZE = 10;
const FINDALL_REPLY_TTL_MS = 2 * 60 * 1000;
const NAME_WIDTH = 14;
const FLOOR_WIDTH = 4;
const AP_WIDTH = 4;
const ROLE_WIDTH = 8;
const CARRY_WIDTH = 4;
const UPDATED_WIDTH = 10;
const findAllAutoDeleteTimers = new Map();

function scheduleFindAllAutoDelete(client, channelId, messageId) {
  if (!channelId || !messageId) return;

  const key = `${channelId}:${messageId}`;
  const existing = findAllAutoDeleteTimers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.messages && typeof channel.messages.delete === 'function') {
        await channel.messages.delete(messageId);
      }
    } catch {
      // Ignore if message is already deleted.
    } finally {
      findAllAutoDeleteTimers.delete(key);
    }
  }, FINDALL_REPLY_TTL_MS);

  findAllAutoDeleteTimers.set(key, timer);
}

function formatUpdatedAgo(timestamp) {
  const time = Number(timestamp);
  if (!Number.isFinite(time)) return '未知';

  const diffMs = Date.now() - time;
  if (diffMs < 60 * 1000) return '刚刚';

  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) return `${diffMinutes}分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}小时前`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}天前`;
}

function charDisplayWidth(ch) {
  const code = ch.codePointAt(0);
  if (!Number.isFinite(code)) return 1;

  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 2;
  }

  return 1;
}

function stringDisplayWidth(value) {
  let width = 0;
  for (const ch of String(value ?? '')) {
    width += charDisplayWidth(ch);
  }
  return width;
}

function truncateByDisplayWidth(value, maxWidth) {
  let result = '';
  let width = 0;

  for (const ch of String(value ?? '')) {
    const w = charDisplayWidth(ch);
    if (width + w > maxWidth) break;
    result += ch;
    width += w;
  }

  return result;
}

function padRight(value, width) {
  const text = truncateByDisplayWidth(value, width);
  const w = stringDisplayWidth(text);
  if (w >= width) return text;
  return text + ' '.repeat(width - w);
}

function padLeft(value, width) {
  const text = truncateByDisplayWidth(value, width);
  const w = stringDisplayWidth(text);
  if (w >= width) return text;
  return ' '.repeat(width - w) + text;
}

function buildFindAllPageCustomId({ userId, page }) {
  return `findall_page:${userId}:${page}`;
}

function parseFindAllPageCustomId(customId) {
  if (!customId.startsWith('findall_page:')) return null;

  const parts = customId.split(':');
  if (parts.length !== 3) return null;

  const [, userId, pageToken] = parts;
  const page = Number(pageToken);
  if (!Number.isFinite(page) || page < 1) return null;

  return { userId, page };
}

async function buildFindAllPagePayload(interaction, { page, userId }) {
  const signups = loadSignups();

  signups.sort((a, b) => {
    const apDiff = Number((b.ap ?? b.AP) || 0) - Number((a.ap ?? a.AP) || 0);
    if (apDiff !== 0) return apDiff;

    const floorDiff =
      Number((b['当前最高层数'] ?? b['当前最高层']) || 0) -
      Number((a['当前最高层数'] ?? a['当前最高层']) || 0);
    if (floorDiff !== 0) return floorDiff;

    return (
      Number((b.updatedAt ?? b.createdAt) || 0) -
      Number((a.updatedAt ?? a.createdAt) || 0)
    );
  });

  const total = signups.length;

  if (total === 0) {
    return { content: '目前还没有人报名。', components: [] };
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = signups.slice(start, start + PAGE_SIZE);

  const lines = await Promise.all(
    pageItems.map(async item => {
      const fallbackName = item['昵称'] || item.username || 'unknown';
      const nickname = await resolveDisplayName({
        guild: interaction.guild,
        client: interaction.client,
        userId: item.userId,
        fallbackName,
      });

      const floorValue = item['当前最高层数'] ?? item['当前最高层'] ?? '未填写';
      const apValue = item.ap ?? item.AP ?? '未填写';
      const role = item['职业'] || '未填写';
      const carryValue = item['需要carry'] === true ? '是' : item['需要carry'] === false ? '否' : '?';
      const updatedAgo = formatUpdatedAgo(item.updatedAt ?? item.createdAt);

      return (
        `${padRight(nickname, NAME_WIDTH)} | ${padLeft(floorValue, FLOOR_WIDTH)} | ` +
        `${padLeft(apValue, AP_WIDTH)} | ${padRight(role, ROLE_WIDTH)} | ${padRight(carryValue, CARRY_WIDTH)} | ${padRight(updatedAgo, UPDATED_WIDTH)}`
      );
    }),
  );

  const header =
    `${padRight('名称', NAME_WIDTH)} | ${padRight('层', FLOOR_WIDTH)} | ` +
    `${padRight('AP', AP_WIDTH)} | ${padRight('职业', ROLE_WIDTH)} | ${padRight('带', CARRY_WIDTH)} | ${padRight('更新时间', UPDATED_WIDTH)}`;
  const separator = '-'.repeat(header.length);

  const payload = {
    content: [
      `共 ${total} 位已报名用户`,
      '```text',
      `第 ${safePage}/${totalPages} 页，每页 ${PAGE_SIZE} 条`,
      separator,
      header,
      separator,
      ...lines,
      '```',
    ].join('\n'),
    components: [],
  };

  if (totalPages > 1) {
    const prevButton = new ButtonBuilder()
      .setCustomId(buildFindAllPageCustomId({ userId, page: safePage - 1 }))
      .setLabel('上一页')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1);

    const nextButton = new ButtonBuilder()
      .setCustomId(buildFindAllPageCustomId({ userId, page: safePage + 1 }))
      .setLabel('下一页')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages);

    payload.components = [new ActionRowBuilder().addComponents(prevButton, nextButton)];
  }

  return payload;
}

async function handleFindAllPageButton(interaction) {
  const parsed = parseFindAllPageCustomId(interaction.customId);
  if (!parsed) return false;

  await interaction.deferUpdate();
  const payload = await buildFindAllPagePayload(interaction, parsed);
  await interaction.editReply(payload);
  scheduleFindAllAutoDelete(interaction.client, interaction.channelId, interaction.message.id);
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('findall')
    .setDescription('查看所有已报名用户（按 AP 从高到低排序）'),

  async execute(interaction) {
    const payload = await buildFindAllPagePayload(interaction, {
      page: 1,
      userId: interaction.user.id,
    });

    await interaction.reply({ ...payload });
    const msg = await interaction.fetchReply();
    scheduleFindAllAutoDelete(interaction.client, interaction.channelId, msg.id);
  },

  handleFindAllPageButton,
};
