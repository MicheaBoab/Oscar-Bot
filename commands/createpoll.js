const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  TeamMemberMembershipState,
  flatten,
} = require('discord.js');

const {
  parseOption
} = require('../helper/parseOption');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('createpoll')
    .setDescription('创建一个下拉菜单投票')
    .addStringOption(option =>
      option.setName('title')
            .setDescription('投票标题')
            .setRequired(true),
    )
    .addStringOption(option =>
      option.setName('options')
            .setDescription('投票选项, 请用 | 来做分割 (最多25个)')
            .setRequired(true),
    ),

  // 1. 读取参数
  // 2. 校验 options
  // 3. 构建 pollData
  // 4. createPoll()
  // 5. 构建 Embed
  // 6. 构建 Select Menu
  // 7. reply()
  async execute(interaction) {
    const crypto = require('crypto');
    const {createPoll, pollExistsByTitle} = require('../storage/pollFileStore');

    /* =========================
    ① 读取参数
    ========================= */
    const title = interaction.options.getString('title');

    // 冲突检测
    if (pollExistsByTitle(title)) {
      return interaction.reply({
        content: `❌ 已经存在名为 **${title}** 的投票（区分大小写）`,
        flags: 64,
      });
  }
    // 收集所有选项
    const rawOptions = interaction.options
      .getString(`options`)
      .split('|')
      .map(opt => opt.trim())
      .filter(Boolean);
    
    /* =========================
    ② 校验选项
    ========================= */
    if (rawOptions.length < 2) {
      return interaction.reply({
        content: '❌ 至少需要 2 个选项',
        ephemeral: true,
        flags: 64,
    });
    }
    if (rawOptions.length > 25) {
      return interaction.reply({
        content: '❌ 最多只能有 25 个选项',
        ephemeral: true,
        flags: 64,
      });
    }

    const parsedOptions = [];

    for (const raw of rawOptions) {
      const parsed = parseOption(raw);

      if (parsed.type === 'user') {
        try {
          const member = await interaction.guild.members.fetch(parsed.value);
          parsed.label = member.displayName;
        } catch {
          // 用户 ID 不存在 → 降级成文本
          parsed.type = 'text';
          parsed.value = raw;
          parsed.label = raw;
        }
      } else {
        parsed.label = parsed.value;
      }

      parsedOptions.push(parsed);
    }

    const menuOptions = parsedOptions.map(opt => ({
      label: opt.label,
      value: opt.type === 'user'
        ? `user:${opt.value}`
        : `text:${opt.value}`,
    }));

    /* =========================
      ④ 构建并写入 pollData
      ========================= */

    const pollData = {
      title,
      options: menuOptions,
      votes: {},
      status: 'active',
      time: Date.now(),
    };

    // ⭐ 写入文件
    createPoll(title, pollData);

    /* =========================
      ⑤ 构建 Embed fields
      ========================= */
    const fields = menuOptions.map((opt) => ({
      name: '\u200B', //视觉不可见
      value: `${opt.label}\n**0 票**`,
      inline: false,
    }));

    const embed = new EmbedBuilder()
      .setTitle(`📊 投票：${title}`)
      .setFields(fields)
      .setDescription('请从下拉菜单中选择一个选项')
      .setColor(0x5865f2);

    /* =========================
    ⑥ 构建 Select Menu
    ========================= */
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`poll_select:${title}`) // 👈 非常重要
      .setPlaceholder('请选择一个选项')
      .addOptions(menuOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
      embeds: [embed],
      components: [row],
    });
  },
};
