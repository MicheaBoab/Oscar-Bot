const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const MANUALS = {
  quick: [
    '## OSCAR-BOT 快速上手',
    '',
    '### A. 公告流程',
    '1. `/rolealias add name:raid role1:@GroupA`  - 建立可复用的身分组映射，后续 announce 只写别名即可。',
    '2. `/notice add alias:night_raid`  - 新建公告模板，alias 用于后续快速调用。',
    '3. `/notice set-image alias:night_raid image_url:<url>`（可选）  - 给模板绑定图片。',
    '4. `/announce role:raid text:night_raid [offset] [force]`  - 真正发送公告并删除上一条；offset 为单次偏移，force 会强制删除上一条同类公告。',
    '',
    '### B. 投票流程',
    '1. `/createpoll`  - 发起新投票并开始计时。',
    '2. `/listpolls`  - 查看当前仍在进行中的投票。',
    '3. `/endpoll`  - 手动提前结束投票并结算结果。',
    '',
    '### C. 报名查询',
    '1. `/signup 当前最高层:<层数> ap:<AP> 职业:<职业> 需要carry:<true/false>`  - 提交个人报名信息。',
    '2. `/find`  - 按条件查找符合条件的成员。',
    '3. `/findall`  - 查看完整报名列表（分页）。',
    '',
    '### D. 市场队列与关注',
    '1. `/showqueue`  - 查看当前追踪到的市场队列状态。',
    '2. `/watch add` | `/watch list` | `/watch remove`  - 管理你的关注物品。',
    '',
    '### Tips',
    '- `offset` 支持：`+10m` / `-30s` / `+2h` / `-1d`',
    '- 可用 `/manual section:<name>` 查看对应指令的更详细说明和示例（例如：`announce`、`watch`）。',
  ],
  announce: [
    '## 公告系统 Manual',
    '',
    '### 1) 角色别名',
    '- `/rolealias add|remove|list`：维护身分组别名，减少每次手动 @ 角色。',
    '',
    '### 2) 公告模板',
    '- `/notice add|edit|remove|list|set-image`：维护公告模板与图片资源。',
    '',
    '### 3) 实际发送',
    '- `/announce role:<别名> text:<公告别名> [offset] [force]`：按模板发送公告，支持单次偏移与强制重发。',
    '- `role`：对应 `/rolealias` 中的别名，机器人会根据别名自动 @ 对应身分组。',
    '- `text`：对应 `/notice` 中保存的模板别名。',
    '- `offset`：只影响本次发送，不会改写模板原始时间。',
    '- `force:true`：当同类旧公告尚未过期时，先删除旧公告再发送新公告。',
    '',
    '### 常见示例',
    '- `/announce role:raid text:night_raid`：正常发送。',
    '- `/announce role:raid text:night_raid offset:+15m`：仅本次时间 +15 分钟。',
    '- `/announce role:raid text:night_raid force:true`：删除未过期旧公告并重发。',
    '',
    '### offset 支持',
    '- `+10m`  `-30s`  `+2h`  `-1d`',
    '- `offset` 会套用到公告文本里所有 `<t:...>` 时间戳。',
    '',
    '### timestamp 模板怎么用（重点）',
    '- 在 `/notice` 模板中直接写 Discord 时间戳，例如：`集合时间：<t:1735732800:F>`。',
    '- 机器人发送时会把模板里的 `<t:unix>` 计算成「下一个同 UTC 时刻」，再叠加 `offset`。',
    '- 例：模板是 `<t:1735732800:F>`（每天同一 UTC 时刻），发送时加 `offset:+15m`，最终显示会整体 +15 分钟。',
    '- 若模板里有多个 `<t:...>`，全部都会一起套用 `offset`。',
    '- 若模板里没有任何 `<t:...>`：系统不会有“过期时间”概念，下次同 role+text 发送会直接替换上一条。',
    '- 若模板里有 `<t:...>`：系统会用文本中最晚的时间作为过期点；未过期时默认阻止重发，除非 `force:true`。',
    '- `force:true`：无论是否过期都重发，并尝试删除上一条同 role+text 公告。',
  ],
  poll: [
    '## 投票系统 Manual',
    '',
    '### 命令',
    '- `/createpoll`：创建投票并发布到频道。',
    '- `/listpolls`：查看进行中的投票标题与状态。',
    '- `/endpoll`：手动结束指定投票，立即公布结果。',
    '- 说明：投票到期后会自动结束并归档，`/endpoll` 适合临时提前结算。',
    '',
    '### 建议流程',
    '1. `/createpoll`',
    '2. 群友投票',
    '3. `/listpolls` 查看状态',
    '4. 到点后 `/endpoll` 或等待自动结束',
  ],
  signup: [
    '## 报名与查询 Manual',
    '',
    '### 命令',
    '- `/signup 当前最高层:<层数> ap:<AP> 职业:<职业> 需要carry:<true/false>`：提交或更新你的报名记录。',
    '- `/find`：按层数、AP、职业、是否需要 carry 等条件筛选。',
    '- `/findall`：输出全部报名记录，适合管理者快速总览。',
    '- 参数建议：`需要carry:true` 通常用于标记需要协助的成员，便于队伍安排。',
    '',
    '### 示例',
    '- `/signup 当前最高层:20 ap:310 职业:女武神 需要carry:false`',
  ],
  queue: [
    '## 市场队列 Manual',
    '',
    '### 命令',
    '- `/showqueue`：查看当前市场队列快照。',
    '- `/setqueue`：配置队列追踪参数（如目标项、刷新节奏）。',
    '- `/forcequeue`：忽略等待周期，立即刷新一次。',
    '- `/stopqueue`：停止当前队列追踪任务。',
    '- 使用建议：先用 `/setqueue` 配好参数，再用 `/showqueue` 验证结果是否符合预期。',
  ],
  watch: [
    '## 关注通知 Manual',
    '',
    '### 命令',
    '- `/watch add item_name:<物品名> [enhancement]`：新增关注项，命中后会触发提醒。',
    '- `/watch list`：查看你当前的关注清单。',
    '- `/watch remove item_name:<物品名或自动补全项> [enhancement]`：移除某个关注项。',
    '- `/setwatch`：调整 watch 检查规则与提醒参数。',
    '- 说明：若同名物品有不同强化等级，建议带上 `enhancement`，避免提醒过多。',
    '',
    '### 示例',
    '- `/watch add item_name:Blackstar Longsword enhancement:DUO`',
  ],
  all: [
    '## 命令总览',
    '',
    '使用方式：`/manual [section]`',
    '',
    '### 公告',
    '- `/rolealias add|remove|list`：管理公告身份组别名。',
    '- `/notice add|edit|remove|list|set-image`：管理公告模板与图片。',
    '- `/announce role:<别名> text:<公告别名> [offset] [force]`：按模板发送公告。',
    '',
    '### 投票',
    '- `/createpoll`：创建投票。',
    '- `/listpolls`：查看进行中投票。',
    '- `/endpoll`：手动结束投票。',
    '',
    '### 报名查询',
    '- `/signup`：提交报名信息。',
    '- `/find`：条件查询报名记录。',
    '- `/findall`：查看完整报名列表。',
    '',
    '### 市场与关注',
    '- `/showqueue`：查看队列状态。',
    '- `/setqueue`：配置队列追踪。',
    '- `/forcequeue`：立即刷新队列。',
    '- `/stopqueue`：停止队列任务。',
    '- `/watch add|list|remove`：管理关注项。',
    '- `/setwatch`：配置提醒策略。',
  ],
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('manual')
    .setDescription('显示 Oscar-Bot 使用手册（README 风格）')
    .addStringOption(option =>
      option
        .setName('section')
        .setDescription('查看指定模块手册')
        .setRequired(false)
        .addChoices(
          { name: 'quick - 快速上手', value: 'quick' },
          { name: 'announce - 公告系统', value: 'announce' },
          { name: 'poll - 投票系统', value: 'poll' },
          { name: 'signup - 报名查询', value: 'signup' },
          { name: 'queue - 市场队列', value: 'queue' },
          { name: 'watch - 关注通知', value: 'watch' },
          { name: 'all - 命令总览', value: 'all' },
        )
    ),

  async execute(interaction) {
    const sectionInput = interaction.options.getString('section');
    const section = sectionInput || 'quick';
    const isPrivate = sectionInput !== null;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;

    // 规则：/manual（不带 section）仅管理员可用；/manual section:<name> 所有人可用且私密
    if (sectionInput === null && !isAdmin) {
      await interaction.reply({
        content: '❌ `/manual`（总览）仅管理员可用。请使用 `/manual section:<name>` 查看对应模块说明。',
        flags: 64,
      });
      return;
    }

    const lines = MANUALS[section] || MANUALS.quick;
    const content = ['# 📘 Oscar-Bot 使用手册', ...lines].join('\n');

    const payload = { content };
    if (isPrivate) payload.flags = 64;

    await interaction.reply(payload);
  },
};
