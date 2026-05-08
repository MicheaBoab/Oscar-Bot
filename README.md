# Oscar-Bot

Oscar-Bot 是一个基于 discord.js v14 的模块化 Discord 机器人。

当前主要功能包括：

- 投票系统
- 报名与查询流程
- 黑沙（BDO）世界市场队列追踪
- 关注通知（watch）
- 公告模板与发送（支持单次时间偏移 offset）

## 核心特性

- 全部采用 Slash Commands
- 投票数据持久化，重启后可恢复
- 市场队列与 watch 自动调度
- notice 模板支持本地图片下载
- announce 支持单次 offset 调整时间戳（不会改写模板）

## 命令总览

### 公告系统

- `/rolealias add|remove|list`
  - 管理公告用的身份组别名
- `/notice add|edit|remove|list|set-image`
  - 管理公告模板与图片
- `/announce role:<别名> text:<公告别名> [offset]`
  - 发送公告并 @ 对应身份组
  - `offset` 格式：`+/-数字+s/m/h/d`
  - 示例：`+10m`、`-30s`、`+2h`、`-1d`
  - `offset` 仅本次生效

### 投票系统

- `/createpoll`
- `/listpolls`
- `/endpoll`

### 报名与查询

- `/signup`
- `/find`
- `/findall`

### 市场队列与关注

- `/showqueue`
- `/setqueue`
- `/forcequeue`
- `/stopqueue`
- `/watch add|list|remove`
- `/setwatch`

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

## 数据存储说明

机器人会将运行数据保存在 `storage/` 下，例如：

- 投票数据及归档
- watch 配置
- 队列快照
- 物品元数据与图标缓存
- role 别名与 notice 模板

## License

MIT
