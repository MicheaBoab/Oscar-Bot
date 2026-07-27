const { SlashCommandBuilder } = require('discord.js');
const { findItemByName, resolveItemMeta, searchItems } = require('../storage/itemNameStore');
const { addWatch, getUserWatches, removeWatch, MAX_WATCHES_PER_USER } = require('../storage/watchStore');

const ROMAN_ALIAS = {
  I: 'PRI(I)',
  II: 'DUO(II)',
  III: 'TRI(III)',
  IV: 'TET(IV)',
  V: 'PEN(V)',
  VI: 'HEX(VI)',
  VII: 'SEP(VII)',
  VIII: 'OCT(VIII)',
  IX: 'NOV(IX)',
  X: 'DEC(X)',
};

const STAGE_ALIAS = {
  PRI: 'PRI(I)',
  DUO: 'DUO(II)',
  TRI: 'TRI(III)',
  TET: 'TET(IV)',
  PEN: 'PEN(V)',
  HEX: 'HEX(VI)',
  SEP: 'SEP(VII)',
  OCT: 'OCT(VIII)',
  NOV: 'NOV(IX)',
  DEC: 'DEC(X)',
};

function normalizeEnhancementInput(raw) {
  if (!raw) return null;
  const text = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  if (!text) return null;

  if (text === 'BASE' || text === '0') return 'BASE';
  if (STAGE_ALIAS[text]) return STAGE_ALIAS[text];
  if (ROMAN_ALIAS[text]) return ROMAN_ALIAS[text];

  const plusMatch = text.match(/^\+?(\d+)$/);
  if (plusMatch) {
    const level = Number(plusMatch[1]);
    if (!Number.isFinite(level)) return null;
    return String(level);
  }

  const normalizedParenthesized = text.replace(/[\[\{]/g, '(').replace(/[\]\}]/g, ')');
  if (/^[A-Z]+\([A-Z0-9]+\)$/.test(normalizedParenthesized)) return normalizedParenthesized;

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('watch')
    .setDescription('管理物品上架关注')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription(`关注某个物品上架：命中队列时会@你（每人最多${MAX_WATCHES_PER_USER}个）`)
        .addStringOption(option =>
          option
            .setName('item_name')
            .setDescription('物品名（支持英文或中文，输入时自动补全）')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('enhancement')
            .setDescription('可选：强化筛选，如 PRI、DUO、+15、0(BASE)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('查看你目前关注的所有物品')
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('移除一个关注物品')
        .addStringOption(option =>
          option
            .setName('item_name')
            .setDescription('物品名（输入时自动补全你的关注列表）')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName('enhancement')
            .setDescription('可选：强化筛选（用于区分同一物品的不同强化关注）')
            .setRequired(false)
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'item_name') {
      await interaction.respond([]);
      return;
    }

    const sub = interaction.options.getSubcommand(false);

    // /watch remove 时只补全该用户已关注的物品
    if (sub === 'remove') {
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const userWatches = getUserWatches(guildId, userId);
      const query = focused.value.toLowerCase();
      const filtered = userWatches.filter(w =>
        !query || w.itemName.toLowerCase().includes(query)
      ).slice(0, 25);
      await interaction.respond(
        filtered.map(w => ({
          name: `${w.itemName}${w.enhancement ? ` (${w.enhancement})` : ''}`,
          value: w.id,
        }))
      );
      return;
    }

    // /watch add 时全库搜索
    const results = searchItems(focused.value, 25);
    await interaction.respond(
      results.map(r => ({
        name: r.name.length > 100 ? r.name.slice(0, 97) + '…' : r.name,
        value: r.value,
      }))
    );
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // ── /watch list ──────────────────────────────────────────────
    if (sub === 'list') {
      const watches = getUserWatches(guildId, userId);
      if (watches.length === 0) {
        await interaction.reply({ content: 'ℹ️ 你目前没有关注任何物品。', flags: 64 });
        return;
      }
      const lines = watches.map((w, i) =>
        `${i + 1}. **${w.itemName}**${w.enhancement ? ` — ${w.enhancement}` : ''}`
      );
      await interaction.reply({
        content: `📋 你的关注列表（${watches.length}/${MAX_WATCHES_PER_USER}）：
${lines.join('\n')}`,
        flags: 64,
      });
      return;
    }

    // ── /watch remove ─────────────────────────────────────────────
    if (sub === 'remove') {
      const rawInput = interaction.options.getString('item_name', true);
      const userWatches = getUserWatches(guildId, userId);

      // autocomplete 传回的 value 是 watch.id，直接匹配
      let target = userWatches.find(w => w.id === rawInput);

      // 如果用户手动输入名字，则按名字+强化匹配
      if (!target) {
        const enhancementRaw = interaction.options.getString('enhancement', false);
        const enhancement = normalizeEnhancementInput(enhancementRaw);
        target = userWatches.find(w =>
          w.itemName.toLowerCase().includes(rawInput.toLowerCase()) &&
          (enhancement === null || (w.enhancement || null) === enhancement)
        );
      }

      if (!target) {
        await interaction.reply({ content: '❌ 未找到该关注记录。', flags: 64 });
        return;
      }

      removeWatch(guildId, target.id);
      await interaction.reply({
        content: `✅ 已移除关注：**${target.itemName}**${target.enhancement ? ` — ${target.enhancement}` : ''}`,
        flags: 64,
      });
      return;
    }

    // ── /watch add ────────────────────────────────────────────────
    if (sub !== 'add') return;

    const rawInput = interaction.options.getString('item_name', true);
    const enhancementRaw = interaction.options.getString('enhancement', false);

    // autocomplete 选中后 value 是 itemId，优先直接解析；否则按名字搜索
    const directMeta = resolveItemMeta(rawInput);
    const found = directMeta
      ? { itemId: rawInput, meta: directMeta }
      : findItemByName(rawInput);

    if (!found) {
      await interaction.reply({
        content: '❌ 当前物品名称无效，请检查后重新输入。',
        flags: 64,
      });
      return;
    }

    const enhancement = normalizeEnhancementInput(enhancementRaw);
    if (enhancementRaw && !enhancement) {
      await interaction.reply({
        content: '❌ 强化格式无法识别，可用示例：PRI、DUO、+15、0。',
        flags: 64,
      });
      return;
    }

    const result = addWatch(guildId, {
      userId,
      itemId: found.itemId,
      itemName: found.meta?.name || found.meta?.nameCN || rawInput,
      enhancement,
    });

    if (!result.added) {
      if (result.reason === 'limit') {
        await interaction.reply({
          content: `❌ 你已达到关注上限（最多 ${MAX_WATCHES_PER_USER} 个），请先移除旧的关注。`,
          flags: 64,
        });
      } else {
        await interaction.reply({
          content: `ℹ️ 你已经关注过该物品：${result.watch.itemName}${result.watch.enhancement ? `（${result.watch.enhancement}）` : ''}`,
          flags: 64,
        });
      }
      return;
    }

    await interaction.reply({
      content: `✅ 关注成功：${result.watch.itemName}${enhancement ? `（${enhancement}）` : ''}\n命中 queue 时会在自动队列频道 @你。`,
      flags: 64,
    });
  },
};
