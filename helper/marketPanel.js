const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
  ChannelSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const sessions = require('./panelSessions');
const store = require('../storage/liveQueueStore');
const watches = require('../storage/watchStore');
const items = require('../storage/itemNameStore');
const actions = require('./marketActions');
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const admin = i => i.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
const back = () => row(button('control_page:market', '返回上一级'));

function buildPanel(name, isAdmin, guildId) {
  const config = store.getLiveQueue(guildId);
  const state = !config ? '未设置' : config.active ? '运行中' : '已停止';
  const controls = name === 'queue'
    ? isAdmin ? [row(button('mp:queue-channel', '设置通知频道'), button(config?.active ? 'mp:stop' : 'mp:resume', config?.active ? '停止追踪' : '恢复追踪'))] : []
    : [row(button('mp:add', '新增关注物品'), button('mp:remove', '删除关注物品'), ...(isAdmin ? [button('mp:watch-channel', '设置通知频道')] : []))];
  const channel = name === 'queue' ? config?.channelId : config?.watchChannelId;
  return { embeds: [new EmbedBuilder().setTitle(name === 'queue' ? '市场队列' : '上架提醒')
    .setDescription(`追踪状态：${state}\n通知频道：${channel ? `<#${channel}>` : '未设置'}`)], components: [...controls, back()] };
}
function results(session, token) {
  const page = session.page || 0, values = session.results.slice(page * 25, (page + 1) * 25);
  return { content: `请选择物品（第 ${page + 1}/${Math.ceil(session.results.length / 25)} 页）。`,
    components: [row(new StringSelectMenuBuilder().setCustomId(`mp:item:${token}`).setPlaceholder('选择物品')
      .addOptions(values.map(item => ({ label: item.name.slice(0, 100), value: item.value })))),
      row(button(`mp:prev:${token}`, '上一页').setDisabled(page === 0), button(`mp:next:${token}`, '下一页').setDisabled((page + 1) * 25 >= session.results.length))] };
}
async function handle(i) {
  const [, action, token] = i.customId.split(':');
  if (!i.guildId) return i.reply({ content: '请在服务器中使用。', flags: 64 });
  if (['queue-channel', 'watch-channel', 'stop', 'resume'].includes(action)) {
    if (!admin(i)) return i.reply({ content: '此操作仅管理员可用。', flags: 64 });
    if (['stop', 'resume'].includes(action)) return actions.configure(i, action);
    const id = sessions.createSession(i, { stage: 'channel', action });
    return i.reply({ content: '请选择通知频道。', flags: 64, components: [row(new ChannelSelectMenuBuilder()
      .setCustomId(`mp:channel:${id}`).setPlaceholder('选择通知频道').addChannelTypes(ChannelType.GuildText))] });
  }
  if (action === 'add') {
    const id = sessions.createSession(i, { stage: 'search' });
    return i.showModal(new ModalBuilder().setCustomId(`mp:search:${id}`).setTitle('搜索关注物品').addComponents(
      row(new TextInputBuilder().setCustomId('query').setLabel('输入物品名称关键词').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))));
  }
  if (action === 'remove') {
    const list = watches.getUserWatches(i.guildId, i.user.id);
    if (!list.length) return i.reply({ content: '你目前没有关注任何物品。', flags: 64 });
    const id = sessions.createSession(i, { stage: 'remove', ids: list.map(w => w.id) });
    return i.reply({ content: '这是你的关注记录；选择一项即可删除。', flags: 64, components: [row(new StringSelectMenuBuilder()
      .setCustomId(`mp:delete:${id}`).setPlaceholder('选择要删除的关注').addOptions(list.map(w => ({
        label: `${w.itemName} · ${w.enhancement || '不限强化'}`.slice(0, 100), value: w.id }))))] });
  }
  const session = sessions.getSession(token, i);
  if (!session || session.busy) return i.reply({ content: '流程已失效或正在处理，请重新打开 Market。', flags: 64 });
  if (action === 'channel' && session.stage === 'channel') {
    session.busy = true;
    try { return await actions.configure(i, session.action, i.values[0]); }
    finally { sessions.deleteSession(token); }
  }
  if (action === 'search' && session.stage === 'search') {
    // Full search permits paging through every match rather than silently truncating the selection.
    session.results = items.searchItems(i.fields.getTextInputValue('query'), Number.MAX_SAFE_INTEGER);
    if (!session.results.length) { sessions.deleteSession(token); return i.reply({ content: '没有找到物品，请重新输入更准确的关键词。', flags: 64 }); }
    session.stage = 'item'; session.page = 0;
    return i.reply({ ...results(session, token), flags: 64 });
  }
  if (['prev', 'next'].includes(action) && session.stage === 'item') {
    session.page = Math.max(0, Math.min(Math.ceil(session.results.length / 25) - 1, session.page + (action === 'next' ? 1 : -1)));
    return i.update(results(session, token));
  }
  if (action === 'item' && session.stage === 'item') {
    const item = session.results.find(item => item.value === i.values[0]);
    if (!item) return i.reply({ content: '物品选择无效。', flags: 64 });
    session.item = item; session.stage = 'enhancement';
    const levels = [{ label: '不限强化', value: 'any' }, { label: '未强化 / BASE', value: 'BASE' },
      ...Array.from({ length: 15 }, (_, index) => ({ label: `+${index + 1}`, value: String(index + 1) })),
      ...['PRI(I)', 'DUO(II)', 'TRI(III)', 'TET(IV)', 'PEN(V)'].map(value => ({ label: value, value }))];
    return i.update({ content: `已选择：${item.name}。请选择强化条件。`, components: [row(new StringSelectMenuBuilder()
      .setCustomId(`mp:enhancement:${token}`).setPlaceholder('强化等级').addOptions(levels)),
      row(button(`mp:advanced:${token}`, 'VI–X 等级'))] });
  }
  if (action === 'advanced' && session.stage === 'enhancement') {
    return i.update({ content: '请选择 VI–X 强化等级。', components: [row(new StringSelectMenuBuilder()
      .setCustomId(`mp:enhancement:${token}`).setPlaceholder('强化等级').addOptions(['HEX(VI)', 'SEP(VII)', 'OCT(VIII)', 'NOV(IX)', 'DEC(X)'].map(value => ({ label: value, value }))))] });
  }
  if (action === 'enhancement' && session.stage === 'enhancement') {
    const value = i.values[0];
    const allowed = ['any', 'BASE', ...Array.from({ length: 15 }, (_, index) => String(index + 1)), 'PRI(I)', 'DUO(II)', 'TRI(III)', 'TET(IV)', 'PEN(V)', 'HEX(VI)', 'SEP(VII)', 'OCT(VIII)', 'NOV(IX)', 'DEC(X)'];
    if (!allowed.includes(value)) return i.reply({ content: '无效强化等级。', flags: 64 });
    session.enhancement = value === 'any' ? null : value; session.stage = 'confirm';
    return i.update({ content: `确认关注：${session.item.name} · ${session.enhancement || '不限强化'}？`,
      allowedMentions: { parse: [] }, components: [row(button(`mp:confirm:${token}`, '确认添加'))] });
  }
  if (action === 'confirm' && session.stage === 'confirm') {
    session.busy = true;
    const result = watches.addWatch(i.guildId, { userId: i.user.id, itemId: session.item.value, itemName: session.item.name, enhancement: session.enhancement });
    sessions.deleteSession(token);
    return i.update({ content: result.added ? '✅ 已添加关注。运行中的追踪命中时，会在上架提醒频道通知你。' : result.reason === 'limit' ? '已达到关注上限，请先删除旧关注。' : '已经关注过该物品和强化等级。', components: [] });
  }
  if (action === 'delete' && session.stage === 'remove') {
    const id = i.values[0];
    if (!session.ids.includes(id) || !watches.getUserWatches(i.guildId, i.user.id).some(w => w.id === id)) return i.reply({ content: '关注记录不存在或不属于你。', flags: 64 });
    session.busy = true; watches.removeWatch(i.guildId, id); sessions.deleteSession(token);
    return i.update({ content: '✅ 已删除所选关注。', components: [] });
  }
  return i.reply({ content: '步骤已失效，请重新打开 Market。', flags: 64 });
}
module.exports = { buildPanel, handle };
