const { ChannelType, PermissionFlagsBits } = require('discord.js');
const store = require('../storage/attendanceStore');
const { withPanelLock } = require('./fixedPanel');

async function getPublishChannel(interaction, channelId) {
  const channel = await interaction.guild.channels.fetch(channelId);
  if (!channel || channel.guildId !== interaction.guildId || channel.type !== ChannelType.GuildText) {
    throw new Error('请选择本服务器的文字频道。');
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const bot = interaction.guild.members.me || await interaction.guild.members.fetchMe();
  if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    throw new Error('你没有在该频道发布消息的权限。');
  }
  if (!channel.permissionsFor(bot)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    throw new Error('机器人需要查看频道、发送消息和嵌入链接权限。');
  }
  return channel;
}
async function publishAttendance(interaction, { channelId, title, description = '', selectRole }) {
  title = String(title || '').trim(); description = String(description || '').trim();
  if (!title || title.length > 180 || description.length > 3000 || typeof selectRole !== 'boolean') {
    throw new Error('标题须为 1–180 字符，说明最多 3000 字符，请重新创建。');
  }
  // Legacy storage uses sanitized titles globally; serialize both entry points globally.
  return withPanelLock('attendance:create', async () => {
    if (store.loadAttendance(title)) throw new Error('已有相同标题或文件名冲突的报名帖，请换一个标题。');
    const channel = await getPublishChannel(interaction, channelId);
    const attendance = { title, description, selectRole, participants: {}, status: 'active',
      time: Date.now(), createdByUserId: interaction.user.id, guildId: interaction.guildId, channelId };
    const command = require('../commands/attendance');
    const message = await channel.send({
      embeds: [command.buildAttendanceEmbed(attendance, { guild: interaction.guild })],
      components: command.buildAttendanceComponents(attendance, interaction.guild), allowedMentions: { parse: [] },
    });
    attendance.messageId = message.id;
    try { store.createAttendance(title, attendance); }
    catch (error) {
      try { await message.delete(); }
      catch { error.message += ` 请手动清理未保存的报名消息：https://discord.com/channels/${interaction.guildId}/${channelId}/${message.id}`; }
      throw error;
    }
    return attendance;
  });
}
module.exports = { publishAttendance, getPublishChannel };
