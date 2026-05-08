const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const { downloadImage } = require('../helper/downloadImage');
const { renderRecurringDiscordTimestamps } = require('../helper/timeHelpers');

const NOTICES_FILE = path.join(__dirname, '../storage/noticeTexts.json');

function loadNotices() {
  if (fs.existsSync(NOTICES_FILE)) {
    const data = JSON.parse(fs.readFileSync(NOTICES_FILE, 'utf-8'));
    // 向后兼容：如果 notices 中存储的是字符串，转换为对象格式
    const notices = data.notices || {};
    const converted = {};
    Object.entries(notices).forEach(([alias, content]) => {
      if (typeof content === 'string') {
        converted[alias] = { text: content, imagePath: null, timeTemplates: extractTimeTemplates(content) };
      } else {
        converted[alias] = {
          text: content.text || '',
          imagePath: content.imagePath || null,
          timeTemplates: Array.isArray(content.timeTemplates)
            ? content.timeTemplates
            : extractTimeTemplates(content.text || ''),
        };
      }
    });
    return { notices: converted };
  }
  return { notices: {} };
}

function saveNotices(data) {
  fs.writeFileSync(NOTICES_FILE, JSON.stringify(data, null, 2));
}

function extractTimeTemplates(text) {
  const templates = [];
  const source = String(text || '');
  // 从 helper 中复用 DISCORD_TS_REGEX（通过重新定义本地引用）
  const DISCORD_TS_REGEX = /<t:(\d{1,12})(?::([tTdDfFR]))?>/g;
  let match;

  while ((match = DISCORD_TS_REGEX.exec(source)) !== null) {
    const unix = Number(match[1]);
    if (!Number.isFinite(unix)) continue;

    const dt = new Date(unix * 1000);
    templates.push({
      original: match[0],
      format: match[2] || null,
      hour: dt.getUTCHours(),
      minute: dt.getUTCMinutes(),
      second: dt.getUTCSeconds(),
    });
  }

  return templates;
}

// 获取 notice 的文本内容
function getNoticeText(alias) {
  const data = loadNotices();
  const notice = data.notices[alias];
  if (!notice) return null;
  // 兼容旧格式和新格式
  return typeof notice === 'string' ? notice : notice.text;
}

function formatUtcTime(hour, minute, second) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function buildRawPreviewBlock(text, maxLen = 1200) {
  const source = String(text || '').replace(/```/g, '`\\`\\`');
  const preview = source.length > maxLen
    ? `${source.slice(0, maxLen)}\n...（预览已截断，完整内容已保存）`
    : source;
  return `\`\`\`\n${preview}\n\`\`\``;
}

function buildNoticeSavedMessage(actionText, alias, content, timeTemplates) {
  const templates = Array.isArray(timeTemplates) ? timeTemplates : [];
  const renderedPreview = renderRecurringDiscordTimestamps(content);
  const templateSummary = templates.length === 0
    ? '未检测到时间模板（格式示例：<t:1778291040:R>）'
    : [
      `已检测到时间模板：${templates.length} 个`,
      ...templates.map((tpl, idx) => (
        `${idx + 1}. \`${tpl.original}\` → 每日 ${formatUtcTime(tpl.hour, tpl.minute, tpl.second)} UTC`
      )),
    ].join('\n');

  return [
    `✅ 已${actionText}公告文本别名 \`${alias}\``,
    '',
    '模板原文：',
    buildRawPreviewBlock(content),
    '',
    '================ 发送时示例（最终效果） ================',
    '下面这段会和 /announce 实际发送效果一致：',
    renderedPreview,
    '================ 发送时示例结束 ================',
    '',
    templateSummary,
    '',
    '发送规则：使用 /announce 时，文本中的 <t:...:...> 会按 UTC 同一时刻重算（过时顺延到次日），并保留原格式字母。',
  ].join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notice')
    .setDescription('公告文本与图片别名管理')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('添加公告文本别名')
        .addStringOption(option =>
          option.setName('alias').setDescription('别名').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('编辑公告文本别名')
        .addStringOption(option =>
          option.setName('alias').setDescription('别名').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('删除公告文本别名')
        .addStringOption(option =>
          option.setName('alias').setDescription('别名').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('列出所有公告文本别名')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('set-image')
        .setDescription('为公告别名设置图片（输入 URL，bot 自动下载到本地）')
        .addStringOption(option =>
          option.setName('alias').setDescription('别名').setRequired(true)
        )
        .addStringOption(option =>
          option.setName('image_url').setDescription('图片 URL').setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const data = loadNotices();

    if (subcommand === 'add') {
      const alias = interaction.options.getString('alias', true).trim().toLowerCase();

      if (data.notices[alias]) {
        await interaction.reply({
          content: `❌ 别名 \`${alias}\` 已存在，请使用其他名称或用 /notice edit 来修改`,
          flags: 64,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`notice_add_modal_${alias}`)
        .setTitle(`添加公告文本：${alias}`);

      const textInput = new TextInputBuilder()
        .setCustomId('notice_content')
        .setLabel('公告内容')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('输入公告的具体内容（支持多行）')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(4000);

      modal.addComponents(textInput);
      await interaction.showModal(modal);
      return;
    }

    if (subcommand === 'edit') {
      const alias = interaction.options.getString('alias', true).trim().toLowerCase();

      if (!data.notices[alias]) {
        const aliases = Object.keys(data.notices || {});
        const hint = aliases.length > 0
          ? `\n已有别名：${aliases.map(a => `\`${a}\``).join(', ')}`
          : '\n当前还没有任何公告文本别名。';

        await interaction.reply({
          content: `❌ 找不到别名 \`${alias}\`${hint}`,
          flags: 64,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`notice_edit_modal_${alias}`)
        .setTitle(`编辑公告文本：${alias}`);

      const currentText = getNoticeText(alias) || '';

      const textInput = new TextInputBuilder()
        .setCustomId('notice_content')
        .setLabel('公告内容')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentText)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(4000);

      modal.addComponents(textInput);
      await interaction.showModal(modal);
      return;
    }

    if (subcommand === 'remove') {
      const alias = interaction.options.getString('alias', true).trim().toLowerCase();

      if (!data.notices[alias]) {
        const aliases = Object.keys(data.notices || {});
        const hint = aliases.length > 0
          ? `\n已有别名：${aliases.map(a => `\`${a}\``).join(', ')}`
          : '\n当前还没有任何公告文本别名。';

        await interaction.reply({
          content: `❌ 找不到别名 \`${alias}\`${hint}`,
          flags: 64,
        });
        return;
      }

      delete data.notices[alias];
      saveNotices(data);

      await interaction.reply({
        content: `✅ 已删除公告文本别名 \`${alias}\``,
        flags: 64,
      });
      return;
    }

    if (subcommand === 'list') {
      const entries = Object.entries(data.notices || {});
      if (entries.length === 0) {
        await interaction.reply({
          content: '当前还没有任何公告文本别名',
          flags: 64,
        });
        return;
      }

      const aliasList = entries
        .map(([alias, content]) => {
          const text = typeof content === 'string' ? content : (content.text || '');
          const preview = text.split('\n')[0] + (text.split('\n').length > 1 ? '...' : '');
          const hasImage = content.imagePath ? ' 🖼️' : '';
          return `• **${alias}**: ${preview}${hasImage}`;
        })
        .join('\n');

      await interaction.reply({
        content: `**已注册的公告别名：**\n${aliasList}\n\n🖼️ = 已设置图片`,
        flags: 64,
      });
      return;
    }

    if (subcommand === 'set-image') {
      const alias = interaction.options.getString('alias', true).trim().toLowerCase();
      const imageUrl = interaction.options.getString('image_url', true).trim();

      if (!data.notices[alias]) {
        const aliases = Object.keys(data.notices || {});
        const hint = aliases.length > 0
          ? `\n已有别名：${aliases.map(a => `\`${a}\``).join(', ')}`
          : '\n当前还没有任何公告文本别名。';

        await interaction.reply({
          content: `❌ 找不到别名 \`${alias}\`${hint}`,
          flags: 64,
        });
        return;
      }

      await interaction.deferReply({ flags: 64 });

      try {
        // 验证 URL 格式
        new URL(imageUrl);
      } catch {
        await interaction.editReply(`❌ 无效的 URL：${imageUrl}`);
        return;
      }

      try {
        const relativePath = await downloadImage(imageUrl, alias);

        // 更新数据
        const notice = data.notices[alias];
        if (typeof notice === 'string') {
          data.notices[alias] = { text: notice, imagePath: relativePath };
        } else {
          notice.imagePath = relativePath;
        }
        saveNotices(data);

        await interaction.editReply(`✅ 已为别名 \`${alias}\` 设置图片\n📁 保存路径：\`${relativePath}\``);
      } catch (error) {
        const errorMsg = error.message || '未知错误';
        await interaction.editReply(`❌ 下载图片失败：${errorMsg}`);
      }
      return;
    }
  },

  // Modal 提交处理（由 index.js 调用）
  async handleModalSubmit(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith('notice_add_modal_')) {
      const alias = customId.replace('notice_add_modal_', '');
      const content = interaction.fields.getTextInputValue('notice_content');

      const data = loadNotices();

      if (data.notices[alias]) {
        await interaction.reply({
          content: `❌ 别名 \`${alias}\` 已存在（可能被其他管理员添加）`,
          flags: 64,
        });
        return;
      }

      data.notices[alias] = {
        text: content,
        imagePath: null,
        timeTemplates: extractTimeTemplates(content),
      };
      saveNotices(data);

      const templateData = data.notices[alias].timeTemplates;
      await interaction.reply({
        content: buildNoticeSavedMessage('添加', alias, content, templateData),
        flags: 64,
      });
      return;
    }

    if (customId.startsWith('notice_edit_modal_')) {
      const alias = customId.replace('notice_edit_modal_', '');
      const content = interaction.fields.getTextInputValue('notice_content');

      const data = loadNotices();

      if (!data.notices[alias]) {
        await interaction.reply({
          content: `❌ 别名 \`${alias}\` 已被删除`,
          flags: 64,
        });
        return;
      }

      const notice = data.notices[alias];
      if (typeof notice === 'string') {
        data.notices[alias] = {
          text: content,
          imagePath: null,
          timeTemplates: extractTimeTemplates(content),
        };
      } else {
        notice.text = content;
        notice.timeTemplates = extractTimeTemplates(content);
      }
      saveNotices(data);

      const updated = data.notices[alias];
      await interaction.reply({
        content: buildNoticeSavedMessage('更新', alias, content, updated.timeTemplates),
        flags: 64,
      });
      return;
    }
  },
};
