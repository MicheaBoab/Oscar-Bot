const { randomUUID, createHash } = require('crypto');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../storage/pollFileStore');
const { withPanelLock } = require('./fixedPanel');
const { getPublishChannel } = require('./attendancePublishing');
const { parseOption } = require('./parseOption');
const { parseDurationInput } = require('./parseDuration');

function counts(poll) {
  const result = poll.options.map(() => 0);
  for (const index of Object.values(poll.votes || {})) {
    if (Number.isInteger(index) && index >= 0 && index < result.length) result[index]++;
  }
  return result;
}
function pollPayload(poll) {
  const ended = poll.status !== 'active';
  const totals = counts(poll);
  const embed = new EmbedBuilder().setColor(ended ? 0x99aab5 : 0x5865f2)
    .setTitle(`${ended ? '📊 投票已结束' : '📊 投票'}：${poll.title}`.slice(0, 256))
    .setDescription(ended ? '该投票已结束，无法继续投票。' : `请选择一个选项。\n⏳ 截止：<t:${Math.floor(poll.expiresAt / 1000)}:F>（<t:${Math.floor(poll.expiresAt / 1000)}:R>）`)
    .setFields(poll.options.map((option, index) => ({ name: '\u200b', value: `${option.label}\n**${totals[index]} 票**` })));
  return { content: null, embeds: [embed], allowedMentions: { parse: [] }, components: ended ? [] : [
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`poll_vote:${poll.id}`)
      .setPlaceholder('请选择一个选项').addOptions(poll.options.map((option, index) => ({ label: option.label.slice(0, 100), value: String(index) })))),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`poll_end:${poll.id}`)
      .setLabel('结束投票').setStyle(ButtonStyle.Danger)),
  ] };
}
function resultPayload(poll) {
  const totals = counts(poll), maximum = Math.max(0, ...totals);
  const winners = poll.options.filter((_, index) => maximum > 0 && totals[index] === maximum).map(option => option.label);
  return { embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🏆 投票结果公布')
    .setDescription(`**${poll.title}**\n${maximum ? `获胜选项：${winners.join(' | ')}` : '本次无人投票。'}\n感谢大家的参与。`)],
    allowedMentions: { parse: [] } };
}

async function createPoll(interaction, { channelId, title, options, duration }) {
  title = String(title || '').trim();
  const parsedDuration = parseDurationInput(duration);
  if (!title || title.length > 180) throw new Error('标题须为 1–180 字符。');
  if (!parsedDuration.ok) throw new Error(parsedDuration.error);
  if (!Number.isSafeInteger(Date.now() + parsedDuration.ms)) throw new Error('投票时长过大。');
  const raw = options.map(value => value.trim()).filter(Boolean);
  if (raw.length < 2 || raw.length > 25 || raw.some(value => value.length > 100)) {
    throw new Error('请输入 2–25 个选项，每项最多 100 字符。');
  }
  return withPanelLock('poll:create', async () => {
    if (store.pollExistsByTitle(title)) throw new Error('已有同名投票，请换一个标题。');
    const channel = await getPublishChannel(interaction, channelId);
    const parsedOptions = [];
    for (const value of raw) {
      const option = parseOption(value);
      let label = value;
      if (option.type === 'user') {
        const member = await interaction.guild.members.fetch(option.value).catch(() => null);
        if (member) label = member.displayName;
      }
      parsedOptions.push({ label: label.slice(0, 100), value: `${option.type}:${option.value}` });
    }
    const poll = { id: randomUUID(), title, options: parsedOptions, votes: {}, status: 'active',
      time: Date.now(), expiresAt: Date.now() + parsedDuration.ms, durationMs: parsedDuration.ms,
      countdownInput: parsedDuration.normalized, guildId: interaction.guildId, channelId, createdByUserId: interaction.user.id };
    const message = await channel.send(pollPayload(poll));
    poll.messageId = message.id;
    try { store.createPoll(poll.id, poll); }
    catch (error) {
      try { await message.delete(); }
      catch { error.message += ` 请手动删除未保存消息：https://discord.com/channels/${poll.guildId}/${channelId}/${message.id}`; }
      throw error;
    }
    return poll;
  });
}

function resolveInteraction(interaction) {
  const legacy = interaction.customId.startsWith('poll_select:');
  const id = interaction.customId.slice(interaction.customId.indexOf(':') + 1);
  return store.loadAllPolls().find(({ data }) =>
    data.messageId === interaction.message.id && data.channelId === interaction.channelId &&
    (!data.guildId || data.guildId === interaction.guildId) && (legacy || data.id === id));
}

// Caller holds poll:key lock. Completion progress stays on disk until every step succeeds.
async function finishLocked(client, key, poll) {
  if (poll.status === 'active') {
    poll.status = 'ended'; poll.endedAt = Date.now();
    poll.completion = { originalUpdated: false, resultMessageId: null };
    store.updatePoll(key, poll);
  }
  poll.completion ||= { originalUpdated: false, resultMessageId: null };
  const channel = await client.channels.fetch(poll.channelId);
  if (!channel?.isTextBased() || (poll.guildId && channel.guildId !== poll.guildId)) throw new Error('投票频道不可用。');
  if (!poll.completion.originalUpdated) {
    try {
      const message = await channel.messages.fetch(poll.messageId);
      await message.edit(pollPayload(poll));
    } catch (error) { if (error.code !== 10008) throw error; }
    poll.completion.originalUpdated = true; store.updatePoll(key, poll);
  }
  if (!poll.completion.resultMessageId) {
    // Stable nonce also reduces duplicate sends after an ambiguous network failure.
    const nonce = createHash('sha256').update(`${key}:${poll.messageId}`).digest('hex').slice(0, 24);
    const result = await channel.send({ ...resultPayload(poll), nonce, enforceNonce: true });
    poll.completion.resultMessageId = result.id; store.updatePoll(key, poll);
  }
  store.archivePoll(key);
  return true;
}
async function endPoll(client, key, guildId) {
  return withPanelLock(`poll:${key}`, async () => {
    const poll = store.loadPoll(key);
    if (!poll) return false;
    if (guildId) {
      const channel = await client.channels.fetch(poll.channelId);
      if (channel?.guildId !== guildId || (poll.guildId && poll.guildId !== guildId)) throw new Error('投票不属于此服务器。');
    }
    return finishLocked(client, key, poll);
  });
}
async function vote(interaction) {
  const found = resolveInteraction(interaction);
  if (!found) return interaction.reply({ content: '该投票已结束或不存在。', flags: 64 });
  await interaction.deferUpdate();
  return withPanelLock(`poll:${found.key}`, async () => {
    const poll = store.loadPoll(found.key);
    if (!poll) return;
    if (poll.status !== 'active' || Date.now() >= poll.expiresAt) return finishLocked(interaction.client, found.key, poll);
    const value = interaction.values[0];
    const index = interaction.customId.startsWith('poll_select:')
      ? poll.options.findIndex(option => option.value === value)
      : /^\d+$/.test(value) ? Number(value) : -1;
    if (!Number.isInteger(index) || index < 0 || index >= poll.options.length) {
      return interaction.followUp({ content: '无效的投票选项。', flags: 64 });
    }
    poll.votes ||= {}; poll.votes[interaction.user.id] = index;
    // Legacy controls are upgraded in place, but the existing storage key stays compatible.
    poll.id ||= randomUUID(); poll.guildId ||= interaction.guildId;
    store.updatePoll(found.key, poll);
    await interaction.editReply(pollPayload(poll));
  });
}
async function scanPolls(client, { refreshActive = false } = {}) {
  for (const { key } of store.loadAllPolls()) {
    try {
      await withPanelLock(`poll:${key}`, async () => {
        const poll = store.loadPoll(key);
        if (!poll) return;
        if (poll.status !== 'active' || (Number.isFinite(poll.expiresAt) && Date.now() >= poll.expiresAt)) {
          await finishLocked(client, key, poll); return;
        }
        let changed = false;
        if (!Number.isFinite(poll.expiresAt)) { poll.expiresAt = Date.now() + 10 * 60 * 1000; changed = true; }
        if (!poll.id) { poll.id = randomUUID(); changed = true; }
        if (changed) store.updatePoll(key, poll);
        if (refreshActive && poll.channelId && poll.messageId) {
          const channel = await client.channels.fetch(poll.channelId);
          const message = await channel.messages.fetch(poll.messageId);
          await message.edit(pollPayload(poll));
        }
      });
    } catch (error) { console.error(`[poll] ${key} 同步失败，将在下次扫描重试:`, error.message); }
  }
}
module.exports = { createPoll, endPoll, vote, scanPolls, resolveInteraction, pollPayload, resultPayload, counts };
