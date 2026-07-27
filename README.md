# Oscar-Bot

Oscar-Bot 是一个基于 discord.js v14 的模块化 Discord 机器人。

当前主要功能包括：

- 投票系统
- 报名与查询流程
- 黑沙（BDO）世界市场队列追踪
- 关注通知（watch）
- 固定时间自动提醒（weekly / biweekly）
- 公告模板与发送（支持单次时间偏移 offset）

## 核心特性

- 全部采用 Slash Commands
- 投票数据持久化，重启后可恢复
- 市场队列与 watch 自动调度
- reminder 固定时间自动调度
- notice 模板支持本地图片下载
- announce 支持单次 offset 调整时间戳（不会改写模板）

## 命令总览

### 公告系统

- `/rolealias add|remove|list`：管理公告用身份组别名
- `/notice add|edit|remove|list|set-image`：管理公告模板与图片
- `/announce role:<别名> text:<公告别名> [offset] [force]`：发送公告
- offset
	- 格式：`+/-数字+s/m/h/d`
	- 示例：`+10m`、`-30s`、`+2h`、`-1d`
- force
	- 格式：`true|false`
	- 示例：`force:true`

### 投票系统

- `/createpoll`：创建投票
- `/listpolls`：查看进行中投票
- `/endpoll`：提前结束并结算

### 报名与查询

- `/signup`：提交或更新报名
- `/find`：按条件查询
- `/findall`：查看全部报名

### 市场队列与关注

- `/showqueue`：查看当前队列
- `/setqueue`：配置追踪
- `/forcequeue`：立即刷新一次
- `/stopqueue`：停止追踪
- `/watch add|list|remove`：管理关注项
- 每位用户最多可建立 15 个 watch
- `/setwatch`：调整提醒规则

### 定时提醒

- 建议：群内使用以 `/manual section:reminder` 为主（更短）；本节作为完整参考。

- `/reminder set-channel`
	- 设置 reminder 发送频道（提醒发送与倒计时看板共用）
- `/reminder set-role`
	- 设置 reminder 发送时要 @ 的身分组
- `/reminder refresh-board`
	- 立即刷新看板（新增/编辑/删除 reminder 后也会自动刷新）
- `/reminder add`：打开弹窗一次填写
- 频率
	- 格式：`每周X` 或 `每两周周X`
	- 示例：`每周日`、`每周三`、`每两周周一`、`每2周周五`
- 提醒发出时间（24 小时制）
	- 格式：`HH:MM TZ`（必须带时区代码）
	- 示例：`20:30 CDT`、`08:20 PT`、`22:00 ET`
- 活动时间（选填）
	- 格式：`MM.DD.YYYY-MM.DD.YYYY [TZ]`
	- 示例：`08.01.2026-10.31.2026`、`08.01.2026-10.31.2026 CDT`
	- 说明：不填 TZ 时，会继承“提醒发出时间”中的 TZ
- `/reminder edit name:<提醒名称>`
	- 通过名称打开编辑弹窗，更新既有 reminder
- `/reminder list`
- `/reminder remove reminder:<提醒名称>`

#### reminder 输入校验与报错

- 当输入不符合格式时，机器人会返回具体错误原因与可用示例，例如：
	- 时间格式错误（需为 24 小时制 HH:MM）
	- 时区代码错误（例如不支持中文地名）
	- 活动时间范围格式错误（需为 `MM.DD.YYYY-MM.DD.YYYY [TZ]`）
	- 活动结束日期早于开始日期

## 常见使用流程

1. 设置公告角色别名

```text
/rolealias add name:raid role1:@GroupA role2:@GroupB
```

2. 新建公告模板

```text
/notice add alias:night_raid
```

3. （可选）给模板设置图片

```text
/notice set-image alias:night_raid image_url:https://example.com/pic.jpg
```

4. 发送公告

```text
/announce role:raid text:night_raid
```

5. 发送公告并做单次时间偏移

```text
/announce role:raid text:night_raid offset:+15m
```

6. 上一条未过期时强制重发（并删除旧消息）

```text
/announce role:raid text:night_raid force:true
```

## 数据存储说明

机器人会将运行数据保存在 `storage/` 下，例如：

- 投票数据及归档
- watch 配置
- reminder 配置
- 队列快照
- 物品元数据与图标缓存
- role 别名与 notice 模板

## License

MIT