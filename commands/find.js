const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { loadSignups } = require('../storage/signupFileStore');
const { resolveDisplayName } = require('../helper/displayNameCache');
const SIGNUP_CONSTANTS = require('../helper/signupConstants');

const PAGE_SIZE = 10;
const FIND_REPLY_TTL_MS = 2 * 60 * 1000;
const NAME_WIDTH = 14;
const FLOOR_WIDTH = 4;
const AP_WIDTH = 4;
const ROLE_WIDTH = 8;
const CARRY_WIDTH = 4;
const UPDATED_WIDTH = 10;
const findAutoDeleteTimers = new Map();

function scheduleFindAutoDelete(client, channelId, messageId) {
  if (!channelId || !messageId) return;

  const key = `${channelId}:${messageId}`;
  const existing = findAutoDeleteTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.messages && typeof channel.messages.delete === 'function') {
        await channel.messages.delete(messageId);
      }
    } catch {
      // Ignore if message is already deleted or cannot be deleted anymore.
    } finally {
      findAutoDeleteTimers.delete(key);
    }
  }, FIND_REPLY_TTL_MS);

  findAutoDeleteTimers.set(key, timer);
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

  // Rough CJK/full-width detection for monospace table alignment in Discord code blocks.
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

function parseMaybeNumber(value) {
  if (value === 'x') return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMaybeString(value) {
  if (value === 'x') return null;
  return value;
}

function buildFindPageCustomId({ userId, floor, ap, page, targetUserId }) {
  const floorToken = floor === null ? 'x' : String(floor);
  const apToken = ap === null ? 'x' : String(ap);
  const targetUserToken = targetUserId === null ? 'x' : String(targetUserId);
  return `find_page:${userId}:${floorToken}:${apToken}:${page}:${targetUserToken}`;
}

function parseFindPageCustomId(customId) {
  if (!customId.startsWith('find_page:')) return null;

  const parts = customId.split(':');
  if (parts.length !== 6) return null;

  const [, userId, floorToken, apToken, pageToken, targetUserToken] = parts;
  const page = Number(pageToken);
  if (!Number.isFinite(page) || page < 1) return null;

  return {
    userId,
    floor: parseMaybeNumber(floorToken),
    ap: parseMaybeNumber(apToken),
    page,
    targetUserId: parseMaybeString(targetUserToken),
  };
}

async function buildFindResultPayload(interaction, {
  floor,
  ap,
  page,
  userId,
  targetUserId,
}) {
  const signups = loadSignups();

  const matches = signups.filter(item => {
    const floorValue = item['当前最高层数'] ?? item['当前最高层'];
    const apValue = item.ap ?? item.AP;
    const userFloor = Number(floorValue);
    const userAp = Number(apValue);

    if (!Number.isFinite(userFloor) || !Number.isFinite(userAp)) {
      return false;
    }

    const floorMatch = floor === null ? true : userFloor <= floor;
    const apMatch = ap === null ? true : userAp >= ap;
    const userMatch = targetUserId === null ? true : item.userId === targetUserId;

    return floorMatch && apMatch && userMatch;
  });

  matches.sort((a, b) => {
    const apDiff = Number((b.ap ?? b.AP) || 0) - Number((a.ap ?? a.AP) || 0);
    if (apDiff !== 0) return apDiff;

    const floorDiff = Number((b['当前最高层数'] ?? b['当前最高层']) || 0)
      - Number((a['当前最高层数'] ?? a['当前最高层']) || 0);
    if (floorDiff !== 0) return floorDiff;

    return Number((b.updatedAt ?? b.createdAt) || 0)
      - Number((a.updatedAt ?? a.createdAt) || 0);
  });

  const conditionParts = [];
  if (floor !== null) conditionParts.push(`当前最高层 <= ${floor}`);
  if (ap !== null) conditionParts.push(`AP >= ${ap}`);
  if (targetUserId !== null) {
    const targetName = await resolveDisplayName({
      guild: interaction.guild,
      client: interaction.client,
      userId: targetUserId,
      fallbackName: targetUserId,
    });

    conditionParts.push(`用户 = ${targetName}`);
  }
  const conditionText = conditionParts.join('，');

  if (matches.length === 0) {
    return {
      content: `未找到符合条件的用户（${conditionText}）`,
      components: [],
    };
  }

  const total = matches.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = matches.slice(start, start + PAGE_SIZE);

  const lines = await Promise.all(pageItems.map(async item => {
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
    const updatedAgo = formatUpdatedAgo(item.updatedAt ?? item.createdAt);

    const nameText = padRight(nickname, NAME_WIDTH);
    const floorText = padLeft(floorValue, FLOOR_WIDTH);
    const apText = padLeft(apValue, AP_WIDTH);
    const carryValue = item['需要carry'] === true ? '是' : item['需要carry'] === false ? '否' : '?';
    const roleText = padRight(role, ROLE_WIDTH);
    const carryText = padRight(carryValue, CARRY_WIDTH);
    const updatedText = padRight(updatedAgo, UPDATED_WIDTH);

    return `${nameText} | ${floorText} | ${apText} | ${roleText} | ${carryText} | ${updatedText}`;
  }));

  const header = `${padRight('名称', NAME_WIDTH)} | ${padRight('层', FLOOR_WIDTH)} | ${padRight('AP', AP_WIDTH)} | ${padRight('职业', ROLE_WIDTH)} | ${padRight('带', CARRY_WIDTH)} | ${padRight('更新时间', UPDATED_WIDTH)}`;
  const separator = '-'.repeat(header.length);

  const payload = {
    content: [
      `找到 ${total} 位符合条件的用户（${conditionText}）`,
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
      .setCustomId(buildFindPageCustomId({
        userId,
        floor,
        ap,
        page: safePage - 1,
        targetUserId,
      }))
      .setLabel('上一页')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1);

    const nextButton = new ButtonBuilder()
      .setCustomId(buildFindPageCustomId({
        userId,
        floor,
        ap,
        page: safePage + 1,
        targetUserId,
      }))
      .setLabel('下一页')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages);

    payload.components = [
      new ActionRowBuilder().addComponents(prevButton, nextButton),
    ];
  }

  return payload;
}

async function handleFindPageButton(interaction) {
  const parsed = parseFindPageCustomId(interaction.customId);
  if (!parsed) return false;

  await interaction.deferUpdate();
  const payload = await buildFindResultPayload(interaction, parsed);
  await interaction.editReply(payload);
  scheduleFindAutoDelete(interaction.client, interaction.channelId, interaction.message.id);
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('find')
    .setDescription('按条件查找已报名用户')
    .addIntegerOption(option =>
      option
        .setName('最高层数')
        .setDescription(`最高允许当前最高层（${SIGNUP_CONSTANTS.FLOOR_MIN}-${SIGNUP_CONSTANTS.FLOOR_MAX}）`)
        .setMinValue(SIGNUP_CONSTANTS.FLOOR_MIN)
        .setMaxValue(SIGNUP_CONSTANTS.FLOOR_MAX)
        .setRequired(false),
    )
    .addIntegerOption(option =>
      option
        .setName('ap')
        .setDescription(`最低 AP（${SIGNUP_CONSTANTS.AP_MIN}-${SIGNUP_CONSTANTS.AP_MAX}）`)
        .setMinValue(SIGNUP_CONSTANTS.AP_MIN)
        .setMaxValue(SIGNUP_CONSTANTS.AP_MAX)
        .setRequired(false),
    )
    .addUserOption(option =>
      option
        .setName('用户')
        .setDescription('仅查询这个用户的报名信息')
        .setRequired(false),
    ),

  async execute(interaction) {
    const floor = interaction.options.getInteger('最高层数');
    const ap = interaction.options.getInteger('ap');
    const targetUser = interaction.options.getUser('用户');
    const targetUserId = targetUser ? targetUser.id : null;

    if (floor === null && ap === null && targetUserId === null) {
      await interaction.reply({
        content: '请至少填写一个筛选条件：最高层数 / ap / 用户',
        flags: 64,
      });
      return;
    }

    const payload = await buildFindResultPayload(interaction, {
      floor,
      ap,
      page: 1,
      userId: interaction.user.id,
      targetUserId,
    });

    await interaction.reply({
      ...payload,
    });
    const msg = await interaction.fetchReply();
    scheduleFindAutoDelete(interaction.client, interaction.channelId, msg.id);
  },

  handleFindPageButton,
};