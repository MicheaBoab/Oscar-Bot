const { ChannelType, PermissionFlagsBits } = require('discord.js');

const locks = new Map();
async function withPanelLock(key, action) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  locks.set(key, current);
  try { return await current; }
  finally { if (locks.get(key) === current) locks.delete(key); }
}

async function publishFixedPanel({ client, guildId, channelId, previous, payload, save }) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.guildId !== guildId || channel.type !== ChannelType.GuildText) {
    throw new Error('请选择本服务器的文字频道。');
  }
  const me = channel.guild.members.me || await channel.guild.members.fetchMe();
  if (!channel.permissionsFor(me)?.has([
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory,
  ])) throw new Error('机器人需要查看频道、发送消息、嵌入链接和读取历史消息权限。');

  let message;
  if (previous?.channelId === channelId && previous.messageId) {
    try { message = await channel.messages.fetch(previous.messageId); }
    catch (error) { if (error.code !== 10008) throw error; }
    // An edit failure is not evidence that the message is missing.
    if (message) message = await message.edit(payload);
  }
  const created = !message;
  if (created) message = await channel.send(payload);
  try { await save({ channelId, messageId: message.id }); }
  catch (error) {
    if (created) {
      try { await message.delete(); }
      catch { error.message += ` 新消息未能清理，请手动删除：https://discord.com/channels/${guildId}/${channelId}/${message.id}`; }
    }
    throw error;
  }

  let cleanupWarning = '';
  if (previous?.channelId && previous.messageId && previous.channelId !== channelId) {
    try {
      const oldChannel = await client.channels.fetch(previous.channelId);
      const oldMessage = await oldChannel.messages.fetch(previous.messageId);
      await oldMessage.delete();
    } catch (error) {
      if (error.code !== 10008 && error.code !== 10003) {
        cleanupWarning = `\n⚠️ 旧消息删除失败，请管理员手动删除。\n旧频道：<#${previous.channelId}>\nhttps://discord.com/channels/${guildId}/${previous.channelId}/${previous.messageId}`;
      }
    }
  }
  return { message, cleanupWarning };
}

module.exports = { withPanelLock, publishFixedPanel };
