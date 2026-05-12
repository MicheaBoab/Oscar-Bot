const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ALIASES_FILE = path.join(__dirname, '../storage/roleAliases.json');
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeAliasName(value) {
  return String(value || '').trim().toLowerCase();
}

function isSafeObjectKey(key) {
  return key.length > 0 && !FORBIDDEN_KEYS.has(key);
}

function loadAliases() {
  if (!fs.existsSync(ALIASES_FILE)) {
    return { aliases: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(ALIASES_FILE, 'utf-8'));
    const aliases = {};
    const source = parsed && typeof parsed.aliases === 'object' ? parsed.aliases : {};

    for (const [name, roles] of Object.entries(source)) {
      const key = normalizeAliasName(name);
      if (!isSafeObjectKey(key)) continue;
      aliases[key] = Array.isArray(roles) ? roles.map(id => String(id)) : [];
    }

    return { aliases };
  } catch {
    return { aliases: {} };
  }
}

function saveAliases(data) {
  fs.writeFileSync(ALIASES_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolealias')
    .setDescription('身分组别名管理')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('添加身分组别名')
        .addStringOption(option =>
          option.setName('name').setDescription('别名').setRequired(true)
        )
        .addRoleOption(option =>
          option.setName('role1').setDescription('第1个身分组').setRequired(true)
        )
        .addRoleOption(option =>
          option.setName('role2').setDescription('第2个身分组(可选)').setRequired(false)
        )
        .addRoleOption(option =>
          option.setName('role3').setDescription('第3个身分组(可选)').setRequired(false)
        )
        .addRoleOption(option =>
          option.setName('role4').setDescription('第4个身分组(可选)').setRequired(false)
        )
        .addRoleOption(option =>
          option.setName('role5').setDescription('第5个身分组(可选)').setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('删除身分组别名')
        .addStringOption(option =>
          option.setName('name').setDescription('别名').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('列出所有身分组别名')
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: '❌ 只有管理员可以使用此命令', ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const data = loadAliases();

    if (subcommand === 'add') {
      const name = normalizeAliasName(interaction.options.getString('name'));

      if (!isSafeObjectKey(name)) {
        await interaction.reply({ content: '❌ 别名不可使用保留关键字，请换一个名称', ephemeral: true });
        return;
      }

      const roles = [];

      for (let i = 1; i <= 5; i += 1) {
        const role = interaction.options.getRole(`role${i}`);
        if (role) {
          roles.push(role.id);
        }
      }

      if (roles.length === 0) {
        await interaction.reply({ content: '❌ 至少需要提供一个身分组', ephemeral: true });
        return;
      }

      data.aliases[name] = roles;
      saveAliases(data);

      const roleList = roles.map(id => `<@&${id}>`).join(' ');
      await interaction.reply({
        content: `✅ 已添加别名 **${name}** → ${roleList}`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'remove') {
      const name = normalizeAliasName(interaction.options.getString('name'));

      if (!isSafeObjectKey(name)) {
        await interaction.reply({ content: '❌ 别名不可使用保留关键字，请换一个名称', ephemeral: true });
        return;
      }

      if (!data.aliases[name]) {
        await interaction.reply({ content: `❌ 找不到别名 **${name}**`, ephemeral: true });
        return;
      }

      delete data.aliases[name];
      saveAliases(data);

      await interaction.reply({
        content: `✅ 已删除别名 **${name}**`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'list') {
      const entries = Object.entries(data.aliases);
      if (entries.length === 0) {
        await interaction.reply({ content: '还没有注册任何身分组别名', ephemeral: true });
        return;
      }

      const aliasList = entries
        .map(([alias, roleIds]) => `• **${alias}**: ${roleIds.map(id => `<@&${id}>`).join(' ')}`)
        .join('\n');

      await interaction.reply({
        content: `**已注册的身分组别名：**\n${aliasList}`,
        ephemeral: true,
      });
    }
  },
};
