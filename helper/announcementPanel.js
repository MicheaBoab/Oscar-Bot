const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, FileUploadBuilder, LabelBuilder } = require('discord.js');
const store = require('../storage/announcementStore');
const service = require('./announcementService');
const images = require('./announcementImages');
const sessions = require('./panelSessions');
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const textInput = (id, label, value = '', max = 80, paragraph = false, required = true) => {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setMaxLength(max).setRequired(required);
  if (value) input.setValue(value);
  return row(input);
};
function buildPanel(page = 'root') {
  const entries = page === 'templates' ? [['add', '新增模板'], ['edit', '编辑模板'], ['delete', '删除模板'], ['image', '设置图片'], ['unimage', '移除图片'], ['list', '模板列表']]
    : page === 'aliases' ? [['alias-add', '新增别名'], ['alias-delete', '删除别名'], ['alias-list', '别名列表']]
      : [['send', '发送公告'], ['templates', '公告模板'], ['aliases', '身分组别名']];
  const controls = entries.map(([id, label]) => button(`ann:${id}`, label));
  const rows = [];
  while (controls.length) rows.push(row(...controls.splice(0, 5)));
  if (page !== 'root') rows.push(row(button('ann:root', '返回上一级')));
  return { embeds: [new EmbedBuilder().setTitle(page === 'root' ? '公告' : page === 'templates' ? '公告模板' : '身分组别名')
    .setDescription('请选择操作。')], content: null, attachments: [], components: rows, allowedMentions: { parse: [] } };
}
function picker(session, token) {
  const start = session.page * 25;
  return { content: `请选择${session.kind === 'alias' ? '身分组别名' : '公告模板'}（${session.page + 1}/${Math.ceil(session.keys.length / 25)}）。`,
    embeds: [], attachments: [], allowedMentions: { parse: [] }, components: [
      row(new StringSelectMenuBuilder().setCustomId(`ann:pick:${token}`).setPlaceholder('请选择').addOptions(
        session.keys.slice(start, start + 25).map((key, index) => ({ label: key.slice(0, 100), value: String(start + index) })))),
      row(button(`ann:prev:${token}`, '上一页').setDisabled(start === 0), button(`ann:next:${token}`, '下一页').setDisabled(start + 25 >= session.keys.length)),
    ] };
}
function setPicker(session, action) {
  session.action = action; session.kind = action.startsWith('alias') || action === 'send-role' ? 'alias' : 'notice';
  session.keys = Object.keys(session.kind === 'alias' ? store.aliases() : store.notices()); session.page = 0; session.stage = 'pick';
  if (!session.keys.length) throw new Error(session.kind === 'alias' ? '请先新增身分组别名。' : '请先新增公告模板。');
}
function noticeModal(token, alias, text = '', create = false) {
  const modal = new ModalBuilder().setCustomId(`ann:notice-save:${token}`).setTitle(create ? '新增公告模板' : '编辑公告模板');
  if (create) modal.addComponents(textInput('alias', '模板别名', alias));
  return modal.addComponents(textInput('text', '公告内容（发送时正文与提及合计最多 2000 字符）', text, 4000, true));
}
function preview(plan, token) {
  const body = new EmbedBuilder().setTitle('公告预览').setDescription(plan.content);
  if (plan.imagePath) body.setImage(`attachment://notice${path.extname(plan.imagePath)}`);
  return { content: null, attachments: [], files: service.files(plan), allowedMentions: { parse: [] },
    embeds: [body, new EmbedBuilder().setTitle('发送确认').setDescription([
      `目标频道：<#${plan.channelId}>`, `提及：${plan.roles.map(id => `<@&${id}>`).join(' ')}`,
      plan.blocked ? '上一条公告尚未过期；请返回重新选择强制重发。' : plan.deletePrevious ? '发送成功后将尝试删除上一条公告。' : '没有需要删除的上一条公告。',
    ].join('\n'))], components: [row(button(`ann:confirm:${token}`, '确认发送').setDisabled(plan.blocked), button('ann:send', '重新开始'))] };
}
async function openNotice(i, alias, create) {
  alias = create && !alias ? '' : store.aliasKey(alias);
  const notice = store.notices()[alias];
  if (create && notice) throw new Error('模板别名已存在。');
  if (!create && !notice) throw new Error('模板不存在。');
  const token = sessions.createSession(i, { stage: 'notice-form', alias, create, expected: notice ? JSON.stringify(notice) : undefined });
  await i.showModal(noticeModal(token, alias, notice?.text || '', create));
}
async function handle(i) {
  service.assertAdmin(i);
  const [, action, token] = i.customId.split(':');
  if (['root', 'templates', 'aliases'].includes(action)) return i.update(buildPanel(action));
  if (action === 'send') {
    const id = sessions.createSession(i, { stage: 'channel' });
    return i.reply({ content: '请选择公告发送频道。', flags: 64, components: [row(new ChannelSelectMenuBuilder()
      .setCustomId(`ann:channel:${id}`).setPlaceholder('公告发送频道').addChannelTypes(ChannelType.GuildText))] });
  }
  if (action === 'add') return openNotice(i, '', true);
  if (action === 'alias-add') {
    const id = sessions.createSession(i, { stage: 'alias-name' });
    return i.showModal(new ModalBuilder().setCustomId(`ann:alias-name:${id}`).setTitle('新增身分组别名').addComponents(textInput('alias', '别名（同名会更新身分组）')));
  }
  if (['edit', 'delete', 'image', 'unimage', 'list', 'alias-delete', 'alias-list'].includes(action)) {
    const id = sessions.createSession(i, {}), session = sessions.getSession(id, i);
    setPicker(session, action); return i.reply({ ...picker(session, id), flags: 64 });
  }
  const session = sessions.getSession(token, i);
  if (!session || session.busy) throw new Error('此流程已失效或正在处理，请重新打开自己的公告面板。');
  if (action === 'channel' && session.stage === 'channel') {
    session.channelId = i.values[0]; setPicker(session, 'send-template'); return i.update(picker(session, token));
  }
  if (['prev', 'next'].includes(action) && session.stage === 'pick') {
    session.page = Math.max(0, Math.min(Math.ceil(session.keys.length / 25) - 1, session.page + (action === 'next' ? 1 : -1)));
    return i.update(picker(session, token));
  }
  if (action === 'pick' && session.stage === 'pick') {
    const index = Number(i.values[0]), key = session.keys[index];
    if (!Number.isInteger(index) || !key) throw new Error('选择已失效。');
    session.alias = key;
    const value = session.kind === 'alias' ? store.aliases()[key] : store.notices()[key];
    if (!value) throw new Error('所选对象已删除。');
    session.expected = JSON.stringify(value);
    if (session.action === 'send-template') { session.textKey = key; setPicker(session, 'send-role'); return i.update(picker(session, token)); }
    if (session.action === 'send-role') {
      session.roleAlias = key; session.stage = 'options';
      return i.update({ content: '请选择发送方式，然后填写可选时间偏移。', components: [row(button(`ann:normal:${token}`, '正常发送'), button(`ann:force:${token}`, '强制重发'))] });
    }
    if (session.action === 'edit') {
      session.create = false; session.stage = 'notice-form'; return i.showModal(noticeModal(token, key, value.text));
    }
    if (session.action === 'image') {
      session.stage = 'image-form';
      return i.showModal(new ModalBuilder().setCustomId(`ann:image-save:${token}`).setTitle('上传模板图片').addLabelComponents(
        new LabelBuilder().setLabel('选择一张图片（PNG/JPEG/GIF/WebP，最多 8 MiB）').setFileUploadComponent(
          new FileUploadBuilder().setCustomId('image').setMinValues(1).setMaxValues(1).setRequired(true))));
    }
    if (['list', 'alias-list'].includes(session.action)) {
      const entry = new EmbedBuilder().setTitle(key.slice(0, 256)).setDescription(session.kind === 'alias' ? value.map(id => `<@&${id}>`).join(' ') : value.text || '（空模板）');
      return i.update({ ...picker(session, token), embeds: [entry] });
    }
    session.stage = 'delete-confirm';
    return i.update({ content: `确认${session.action === 'unimage' ? '移除图片' : '删除'}：${key}？`, components: [row(button(`ann:delete-confirm:${token}`, '确认'), button('ann:root', '取消'))], allowedMentions: { parse: [] } });
  }
  if (['normal', 'force'].includes(action) && session.stage === 'options') {
    session.force = action === 'force'; session.stage = 'offset';
    return i.showModal(new ModalBuilder().setCustomId(`ann:offset:${token}`).setTitle('公告时间偏移').addComponents(textInput('offset', '可选：+10m、-30s、+2h、-1d；留空不偏移', '', 40, false, false)));
  }
  if (action === 'offset' && session.stage === 'offset') {
    session.offset = i.fields.getTextInputValue('offset'); session.busy = true;
    await i.deferReply({ flags: 64 });
    try { session.plan = await service.prepare(i, session); session.stage = 'confirm'; return await i.editReply(preview(session.plan, token)); }
    finally { session.busy = false; }
  }
  if (action === 'confirm' && session.stage === 'confirm') {
    session.busy = true; await i.deferUpdate();
    try {
      const result = await service.send(i, session, session.plan.fingerprint, () => sessions.deleteSession(token));
      if (result.changed) {
        session.plan = result.plan;
        return await i.editReply({ ...preview(result.plan, token), content: '内容或公告记录已变化，请核对新的预览并再次确认。' });
      }
      return await i.editReply({ content: `✅ 已发送：https://discord.com/channels/${i.guildId}/${result.plan.channelId}/${result.message.id}${result.warning}`,
        embeds: [], components: [], attachments: [], allowedMentions: { parse: [] } });
    } finally { session.busy = false; }
  }
  if (action === 'notice-save' && session.stage === 'notice-form') {
    const alias = session.create ? store.aliasKey(i.fields.getTextInputValue('alias')) : session.alias;
    store.putNotice(alias, i.fields.getTextInputValue('text'), { create: session.create, expected: session.expected });
    sessions.deleteSession(token); return i.reply({ content: '✅ 公告模板已保存。', flags: 64 });
  }
  if (action === 'image-save' && session.stage === 'image-form') {
    session.busy = true; await i.deferReply({ flags: 64 });
    try {
      const uploads = i.fields.getUploadedFiles('image', true);
      if (uploads.size !== 1) throw new Error('请上传一张图片。');
      const file = uploads.first();
      const buffer = await images.fetchImage(file.url, file.size);
      service.assertAdmin(i);
      const relative = images.saveImage(session.alias, buffer, session.expected);
      sessions.deleteSession(token);
      return await i.editReply({ content: '✅ 图片已保存并绑定到模板。', files: [store.imageFile(relative)] });
    } finally { session.busy = false; }
  }
  if (action === 'alias-name' && session.stage === 'alias-name') {
    session.alias = store.aliasKey(i.fields.getTextInputValue('alias')); session.stage = 'roles';
    return i.reply({ content: '请选择 1–5 个身分组。同名别名会更新为本次选择。', flags: 64, components: [row(new RoleSelectMenuBuilder()
      .setCustomId(`ann:roles:${token}`).setMinValues(1).setMaxValues(5).setPlaceholder('选择身分组'))] });
  }
  if (action === 'roles' && session.stage === 'roles') {
    session.busy = true; await i.deferUpdate();
    try { await service.validateRoles(i, i.values); service.assertAdmin(i); store.putAlias(session.alias, i.values); sessions.deleteSession(token);
      return await i.editReply({ content: '✅ 身分组别名已保存。', components: [] }); }
    finally { session.busy = false; }
  }
  if (action === 'delete-confirm' && session.stage === 'delete-confirm') {
    if (session.action === 'alias-delete') store.removeAlias(session.alias, session.expected);
    else if (session.action === 'unimage') store.changeImage(session.alias, null, session.expected);
    else store.removeNotice(session.alias, session.expected);
    sessions.deleteSession(token); return i.update({ content: '✅ 已完成操作。', components: [] });
  }
  throw new Error('步骤已失效，请重新打开公告面板。');
}

async function legacyNotice(i) {
  service.assertAdmin(i);
  const action = i.options.getSubcommand();
  if (action === 'add' || action === 'edit') return openNotice(i, i.options.getString('alias', true), action === 'add');
  if (action === 'list') { const token = sessions.createSession(i, {}), session = sessions.getSession(token, i); setPicker(session, 'list'); return i.reply({ ...picker(session, token), flags: 64 }); }
  const alias = store.aliasKey(i.options.getString('alias', true));
  if (action === 'remove') { store.removeNotice(alias); return i.reply({ content: '✅ 模板已删除。', flags: 64 }); }
  if (action === 'set-image') {
    const expected = JSON.stringify(store.notices()[alias]);
    if (!expected) throw new Error('模板不存在。');
    await i.deferReply({ flags: 64 });
    const buffer = await images.fetchImage(i.options.getString('image_url', true)); service.assertAdmin(i);
    const relative = images.saveImage(alias, buffer, expected);
    return i.editReply({ content: '✅ 图片已保存并绑定到模板。', files: [store.imageFile(relative)] });
  }
}
async function legacyAlias(i) {
  service.assertAdmin(i);
  const action = i.options.getSubcommand();
  if (action === 'list') { const token = sessions.createSession(i, {}), session = sessions.getSession(token, i); setPicker(session, 'alias-list'); return i.reply({ ...picker(session, token), flags: 64 }); }
  const name = store.aliasKey(i.options.getString('name', true));
  if (action === 'add') {
    const roles = Array.from({ length: 5 }, (_, index) => i.options.getRole(`role${index + 1}`)?.id).filter(Boolean);
    await service.validateRoles(i, roles); service.assertAdmin(i); store.putAlias(name, roles);
  } else store.removeAlias(name);
  return i.reply({ content: '✅ 身分组别名已更新。', flags: 64 });
}
module.exports = { buildPanel, handle, legacyNotice, legacyAlias, preview };
