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
    '### C. Reaction 报名',
    '1. `/attendance create title:<标题> [description]`  - 发一条可用 reaction 报名的帖子。',
    '2. `/attendance list`  - 查看当前进行中的报名帖（仅管理员）。',
    '3. `/attendance participants title:<标题> [public]`  - 查看这个报名帖当前所有报名者；public:true 时会公开 @ 名单。',
    '4. `/attendance end title:<标题>`  - 手动结束报名并公布名单（仅管理员或创建者）。',
    '',
    '### D. 报名查询',
    '1. `/signup 当前最高层:<层数> ap:<AP> 职业:<职业> 需要carry:<true/false>`  - 提交个人报名信息。',
    '2. `/find`  - 按条件查找符合条件的成员。',
    '3. `/findall`  - 查看完整报名列表（分页）。',
    '',
    '### E. 市场队列与关注',
    '1. `/showqueue`  - 查看当前追踪到的市场队列状态。',
    '2. `/watch add` | `/watch list` | `/watch remove`  - 管理你的关注物品。',
    '3. `/reminder set-channel` | `/reminder set-role` | `/reminder add`  - 配置固定时间自动提醒。',
    '4. `/reminder sync-daynight phase:pm time:10:40`  - 按游戏内时间同步日夜看板。',
    '',
    '### Tips',
    '- `offset` 支持：`+10m` / `-30s` / `+2h` / `-1d`',
    '- 可用 `/manual section:<name>` 查看对应指令的更详细说明和示例（例如：`announce`、`watch`）。',
  ],
  announce: [
    '## 公告系统 Manual',
    '',
    '### 1) 三步完成',
    '- `/rolealias add|remove|list`：先建身分组别名。',
    '- `/notice add|edit|remove|list|set-image`：再建公告模板。',
    '- `/announce role:<别名> text:<模板> [offset] [force]`：最后发送。',
    '',
    '### 2) 参数格式',
    '- offset',
    '- 格式：`+/-数字+s/m/h/d`',
    '- 示例：`+10m`、`-30s`、`+2h`、`-1d`',
    '- force',
    '- 格式：`true|false`',
    '- 示例：`force:true`（强制重发并尝试删除旧公告）',
    '',
    '### 3) 常用示例',
    '- `/announce role:raid text:night_raid`',
    '- `/announce role:raid text:night_raid offset:+15m`',
    '- `/announce role:raid text:night_raid force:true`',
  ],
  poll: [
    '## 投票系统 Manual',
    '',
    '### 三个命令',
    '- `/createpoll`：创建投票。',
    '- `/listpolls`：查看进行中投票。',
    '- `/endpoll`：提前结束并结算。',
    '',
    '### 最短流程',
    '1. `/createpoll`',
    '2. `/listpolls`',
    '3. `/endpoll`（或等待自动结束）',
  ],
  attendance: [
    '## Reaction 报名 Manual',
    '',
    '### 四个命令',
    '- `/attendance create title:<标题> [description]`：创建报名帖。',
    '- `/attendance list`：查看进行中的报名帖（仅管理员）。',
    '- `/attendance participants title:<标题> [public]`：查看当前报名名单；`public:true` 会公开 @ 所有人。',
    '- `/attendance end title:<标题>`：手动结束报名帖（仅管理员或创建者）。',
    '',
    '### 最短流程',
    '1. `/attendance create title:周六黑沙团 description:请参加的人点✅`',
    '2. 成员对机器人发出的消息点 ✅ 报名。',
    '3. `/attendance participants title:周六黑沙团` 私密查看当前名单。',
    '4. `/attendance participants title:周六黑沙团 public:true` 公开 @ 当前所有报名者。',
    '5. `/attendance end title:周六黑沙团` 手动结束。',
  ],
  signup: [
    '## 报名与查询 Manual',
    '',
    '### 三个命令',
    '- `/signup`：提交或更新报名。',
    '- `/find`：按条件查人。',
    '- `/findall`：看全部报名。',
    '',
    '### signup 示例',
    '- `/signup 当前最高层:20 ap:310 职业:女武神 需要carry:false`',
  ],
  queue: [
    '## 市场队列 Manual',
    '',
    '### 常用命令',
    '- `/showqueue`：查看当前队列。',
    '- `/setqueue`：配置队列追踪。',
    '- `/forcequeue`：立即刷新一次。',
    '- `/stopqueue`：停止追踪。',
  ],
  watch: [
    '## 关注通知 Manual',
    '',
    '### 常用命令',
    '- `/watch add item_name:<物品名> [enhancement]`：新增关注（每人最多 15 个）。',
    '- `/watch list`：查看关注清单。',
    '- `/watch remove item_name:<物品名> [enhancement]`：移除关注。',
    '- `/setwatch`：调整提醒规则。',
    '- `/reminder sync-daynight phase:<am/pm> time:<12小时制时间>`：按分段函数同步日夜看板。',
    '',
    '### add 参数',
    '- 格式：`item_name:<名称> [enhancement:<强化>]`',
    '- 示例：`/watch add item_name:Blackstar Longsword enhancement:DUO`',
  ],
  reminder: [
    '## 定时提醒 Manual',
    '',
    '### 1) 先做一次基础设置',
    '- `/reminder set-channel channel:#活动提醒`（提醒发送与倒计时看板共用）',
    '- `/reminder set-role role:@RaidTeam`',
    '',
    '### 2) 用 `/reminder add` 打开弹窗填写',
    '- 频率（必填）',
    '- 格式：`每周X` 或 `每两周周X`',
    '- 示例：`每周日`、`每周三`、`每两周周一`、`每2周周五`',
    '- 提醒发出时间（必填）',
    '- 格式：`HH:MM TZ`（必须带时区代码）',
    '- 示例：`20:30 CDT`、`08:20 PT`、`22:00 ET`',
    '- 活动时间（选填）',
    '- 格式：`MM.DD.YYYY-MM.DD.YYYY [TZ]`',
    '- 示例：`08.01.2026-10.31.2026`、`08.01.2026-10.31.2026 CDT`',
    '- 说明：活动时间不写 TZ 时，会继承提醒发出时间里的 TZ。',
    '',
    '### 3) 常用查看与维护',
    '- `/reminder list`：显示下次触发时间和倒计时。',
    '- `/reminder refresh-board`：立即刷新一次看板。',
    '- `/reminder edit name:<名称>`：按名称编辑。',
    '- `/reminder remove reminder:<名称>`：删除。',
    '',
    '### 常见输入错误（会直接提示）',
    '- 时间格式错误：不是 24 小时制 HH:MM。',
    '- 时区代码错误：例如使用了不支持的代码或中文地名。',
    '- 活动时间格式错误：不是 `MM.DD.YYYY-MM.DD.YYYY [TZ]`。',
    '- 活动结束早于开始：结束日期不能早于开始日期。',
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
    '### Reaction 报名',
    '- `/attendance create`：创建 reaction 报名帖。',
    '- `/attendance list`：查看进行中的报名帖（仅管理员）。',
    '- `/attendance participants`：查看报名名单，或用 `public:true` 公开 @ 名单。',
    '- `/attendance end`：手动结束报名帖（仅管理员或创建者）。',
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
    '- `/reminder sync-daynight phase:<am/pm> time:<12小时制时间>`：按游戏内时间同步日夜看板。',
    '- `/reminder set-channel|set-role|refresh-board|add|edit|list|remove`：管理固定时间自动提醒与倒计时看板。',
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
          { name: 'attendance - Reaction 报名', value: 'attendance' },
          { name: 'signup - 报名查询', value: 'signup' },
          { name: 'queue - 市场队列', value: 'queue' },
          { name: 'watch - 关注通知', value: 'watch' },
          { name: 'reminder - 定时提醒', value: 'reminder' },
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
