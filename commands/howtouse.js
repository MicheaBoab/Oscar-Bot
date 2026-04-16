const { SlashCommandBuilder } = require('discord.js');

function getOptionTypeName(type) {
  // Discord API option type values.
  const typeMap = {
    3: 'string',
    4: 'int',
    5: 'bool',
    6: 'user',
    7: 'channel',
    8: 'role',
    9: 'mentionable',
    10: 'number',
    11: 'attachment',
  };

  return typeMap[type] || 'value';
}

function formatUsageLine(commandJson) {
  const options = Array.isArray(commandJson.options) ? commandJson.options : [];

  if (options.length === 0) {
    return `/${commandJson.name}`;
  }

  const parts = options.map(option => {
    const typeName = getOptionTypeName(option.type);
    const wrapped = option.required
      ? `<${option.name}:${typeName}>`
      : `[${option.name}:${typeName}]`;

    return wrapped;
  });

  return `/${commandJson.name} ${parts.join(' ')}`;
}

function formatOptionDetails(commandJson) {
  const options = Array.isArray(commandJson.options) ? commandJson.options : [];
  if (options.length === 0) return ['- 参数: 无'];

  return options.map(option => {
    const requiredText = option.required ? '必填' : '选填';
    const typeName = getOptionTypeName(option.type);
    const desc = option.description || '无描述';

    return `- ${option.name} (${typeName}, ${requiredText}): ${desc}`;
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('howtouse')
    .setDescription('查看这个 Bot 的命令使用攻略（私密）'),

  async execute(interaction) {
    const GROUPS = [
      {
        label: '📋  报名系统',
        names: ['signup', 'find'],
      },
      {
        label: '📊  投票系统',
        names: ['createpoll', 'listpolls', 'endpoll'],
      },
      {
        label: '🔧  工具',
        names: ['howtouse', 'ping'],
      },
    ];

    const allCommands = new Map(
      [...interaction.client.commands.values()]
        .map(cmd => {
          const json = cmd.data?.toJSON?.();
          return json ? [json.name, json] : null;
        })
        .filter(Boolean)
    );

    const WIDTH = 56;
    const DIVIDER = '─'.repeat(WIDTH);
    const THIN   = '┄'.repeat(WIDTH);

    function center(text) {
      const len = text.length;
      if (len >= WIDTH) return text;
      const pad = Math.floor((WIDTH - len) / 2);
      return ' '.repeat(pad) + text;
    }

    const lines = [
      center('Oscar Bot  使用攻略'),
      DIVIDER,
    ];

    for (const group of GROUPS) {
      lines.push('');
      lines.push(`  ${group.label}`);
      lines.push(`  ${THIN}`);

      for (const name of group.names) {
        const cmd = allCommands.get(name);
        if (!cmd) continue;

        lines.push(`  /${cmd.name}`);
        lines.push(`    ${cmd.description || '无描述'}`);

        const options = Array.isArray(cmd.options) ? cmd.options : [];
        if (options.length > 0) {
          lines.push('');
          lines.push('    参数:');
          for (const opt of options) {
            const typeName = getOptionTypeName(opt.type);
            const req = opt.required ? '必填' : '选填';
            lines.push(`      ${opt.required ? '▸' : '▹'} ${opt.name} (${typeName}, ${req})`);
            lines.push(`        ${opt.description || '无描述'}`);
          }
        }

        lines.push('');
        lines.push(`    用法: ${formatUsageLine(cmd)}`);
        lines.push(`  ${THIN}`);
      }
    }

    lines.push('');
    lines.push(DIVIDER);
    lines.push('  Tips');
    lines.push('  ▸ /signup 重复报名会覆盖你的旧记录。');
    lines.push('  ▸ /find 结果所有人可见，2 分钟后自动删除。');
    lines.push('  ▸ /find 结果超过 10 条时可用按钮翻页。');
    lines.push(DIVIDER);

    const fullText = lines.join('\n');
    const content = fullText.length > 1900
      ? `${fullText.slice(0, 1880)}\n\n  ...(内容过长，已截断)`
      : fullText;

    await interaction.reply({
      content: `\`\`\`text\n${content}\n\`\`\``,
      flags: 64,
    });
  },
};
