const fs = require('fs');
const { createHash } = require('crypto');
const { PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const store = require('../storage/announcementStore');
const history = require('../storage/announceHistoryStore');
const { getPublishChannel } = require('./attendancePublishing');
const { renderRecurringDiscordTimestamps } = require('./timeHelpers');
const { withPanelLock } = require('./fixedPanel');

function assertAdmin(i) {
  if (!i.guildId || !i.memberPermissions?.has(PermissionFlagsBits.Administrator)) throw new Error('只有管理员可以管理公告。');
}
function parseOffset(raw) {
  if (!String(raw || '').trim()) return 0;
  const match = String(raw).trim().match(/^([+-])\s*(\d+)\s*([smhd])$/i);
  if (!match || Number(match[2]) <= 0) throw new Error('时间偏移格式：+10m、-30s、+2h、-1d；无需偏移请留空。');
  const seconds = Number(match[2]) * ({ s: 1, m: 60, h: 3600, d: 86400 })[match[3].toLowerCase()] * (match[1] === '+' ? 1 : -1);
  if (!Number.isSafeInteger(seconds) || Math.abs(seconds) > 8640000000000) throw new Error('时间偏移过大。');
  return seconds;
}
async function validateRoles(i, ids) {
  for (const id of ids) {
    const role = await i.guild.roles.fetch(id);
    if (!role || role.guild.id !== i.guildId) throw new Error('身分组已删除或不属于本服务器。');
  }
}
async function prepare(i, input) {
  assertAdmin(i);
  const textKey = store.aliasKey(input.textKey), roleAlias = store.aliasKey(input.roleAlias);
  const notice = store.notices()[textKey], roles = store.aliases()[roleAlias];
  if (!notice) throw new Error('公告模板不存在。');
  if (!Array.isArray(roles) || !roles.length) throw new Error('身分组别名不存在或为空。');
  const channel = await getPublishChannel(i, input.channelId);
  await validateRoles(i, roles);
  const me = i.guild.members.me || await i.guild.members.fetchMe();
  for (const id of roles) {
    const role = await i.guild.roles.fetch(id);
    if (!role.mentionable && !channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone)) throw new Error('机器人没有提及所选身分组的权限。');
  }
  if (notice.imagePath && !channel.permissionsFor(me)?.has(PermissionFlagsBits.AttachFiles)) throw new Error('机器人没有在目标频道上传文件的权限。');
  const content = `${roles.map(id => `<@&${id}>`).join(' ')}\n${renderRecurringDiscordTimestamps(notice.text, Date.now(), parseOffset(input.offset))}`;
  if (content.length > 2000) throw new Error('公告正文加身分组提及超过 2000 字符，请缩短模板。');
  const last = history.getLastAnnounce(i.guildId, roleAlias, textKey);
  const blocked = Boolean(last && Number.isFinite(last.expiresAtMs) && last.expiresAtMs > Date.now() && !input.force);
  let imagePath = null, imageHash = null;
  if (notice.imagePath) { imagePath = store.imageFile(notice.imagePath); imageHash = createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex'); }
  const timestamps = [...content.matchAll(/<t:(\d{1,12})(?::[tTdDfFRsS])?>/g)].map(m => Number(m[1]) * 1000);
  const plan = { channel, channelId: input.channelId, roleAlias, textKey, roles, content, imagePath,
    expiresAtMs: timestamps.length ? Math.max(...timestamps) : null, last, blocked, deletePrevious: Boolean(last && !blocked) };
  plan.fingerprint = createHash('sha256').update(JSON.stringify({ content, roles, imageHash, last, blocked,
    channelId: input.channelId, force: Boolean(input.force), notice })).digest('hex');
  if (JSON.stringify(store.notices()[textKey]) !== JSON.stringify(notice) || JSON.stringify(store.aliases()[roleAlias]) !== JSON.stringify(roles)) {
    throw new Error('模板或身分组别名在校验期间发生变化，请重新预览。');
  }
  return plan;
}
function files(plan) {
  return plan.imagePath ? [new AttachmentBuilder(fs.readFileSync(plan.imagePath), { name: `notice${require('path').extname(plan.imagePath)}` })] : [];
}
async function send(i, input, expectedFingerprint, onPublished = () => {}) {
  assertAdmin(i);
  return withPanelLock(`announce:${i.guildId}:${JSON.stringify([input.roleAlias, input.textKey])}`, async () => {
    const plan = await prepare(i, input);
    if (expectedFingerprint && plan.fingerprint !== expectedFingerprint) return { changed: true, plan };
    if (plan.blocked) throw new Error('上一条公告尚未过期。如需替换，请开启强制重发并重新确认。');
    const message = await plan.channel.send({ content: plan.content, files: files(plan), allowedMentions: { parse: [], roles: plan.roles } });
    // Consume private workflow immediately after publication, even if history persistence fails.
    onPublished();
    let warning = '';
    try {
      history.setLastAnnounce(i.guildId, plan.roleAlias, plan.textKey, { channelId: plan.channelId, messageId: message.id,
        expiresAtMs: plan.expiresAtMs, sentAtMs: Date.now() });
    } catch (error) {
      return { message, plan, warning: '\n⚠️ 公告已发送，但记录保存失败；请勿重复点击发送。旧公告未删除。' };
    }
    if (plan.deletePrevious && plan.last.channelId && plan.last.messageId) {
      try {
        const oldChannel = await i.client.channels.fetch(plan.last.channelId);
        if (oldChannel.guildId !== i.guildId) throw new Error('Wrong guild');
        const old = await oldChannel.messages.fetch(plan.last.messageId); await old.delete();
      } catch (error) {
        if (![10008, 10003].includes(error.code)) warning = `\n⚠️ 旧公告删除失败，请手动处理：https://discord.com/channels/${i.guildId}/${plan.last.channelId}/${plan.last.messageId}`;
      }
    }
    return { message, plan, warning };
  });
}
module.exports = { assertAdmin, parseOffset, validateRoles, prepare, send, files };
