const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const store = require('../storage/attendanceStore');
const publishing = require('../helper/attendancePublishing');
const panel = require('../helper/attendancePanel');
const sessions = require('../helper/panelSessions');
const command = require('../commands/attendance');

function interaction() {
  const member = { id: 'user' }, bot = { id: 'bot' };
  const sent = [];
  const channel = { id: 'channel', guildId: 'guild', type: 0,
    permissionsFor: () => ({ has: () => true }),
    send: async payload => { sent.push(payload); return { id: 'message', delete: async () => {} }; } };
  const replies = [];
  return { user: member, guildId: 'guild', channelId: 'channel', locale: 'zh-CN',
    guild: { channels: { fetch: async () => channel }, members: { me: bot, fetch: async () => member } },
    memberPermissions: { has: () => false },
    reply: async value => { replies.push(value); }, update: async value => { replies.push(value); },
    editReply: async value => { replies.push(value); }, showModal: async value => { replies.push(value); },
    deferReply: async () => {}, deferUpdate: async () => {},
    isButton: () => false, isChannelSelectMenu: () => false, isModalSubmit: () => false,
    channel, sent, replies };
}
function storedEvent(t) {
  const title = `__panel_test_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const event = { title, guildId: 'guild', createdByUserId: 'user', messageId: title,
    status: 'active', participants: {}, selectRole: false };
  store.createAttendance(title, event);
  t.after(() => {
    for (const dir of ['attendances', 'archive']) {
      const root = path.join(__dirname, '..', 'storage', dir);
      for (const file of fs.readdirSync(root)) if (file.startsWith(`attendance_${title}`)) fs.unlinkSync(path.join(root, file));
    }
  });
  return event;
}

test('sessions isolate users, guilds, parallel flows and expired submissions', () => {
  const i = interaction();
  const id = sessions.createSession(i, { stage: 'type' });
  const other = sessions.createSession(i, { stage: 'settings' });
  assert.notEqual(id, other);
  assert.equal(sessions.getSession(id, { ...i, user: { id: 'other' } }), null);
  assert.equal(sessions.getSession(id, { ...i, guildId: 'other' }), null);
  sessions.getSession(id, i).expiresAt = 0;
  assert.equal(sessions.getSession(id, i), null);
  sessions.deleteSession(other);
});
test('normal and class flows select channel then open title/description modal', async () => {
  for (const type of ['normal', 'class']) {
    const i = interaction(); i.customId = 'ap:create'; i.isButton = () => true;
    await panel.handle(i);
    const id = i.replies[0].components[0].toJSON().components[0].custom_id.split(':')[2];
    i.customId = `ap:${type}:${id}`; await panel.handle(i);
    assert.equal(sessions.getSession(id, i).selectRole, type === 'class');
    i.isButton = () => false; i.isChannelSelectMenu = () => true;
    i.values = ['channel']; i.customId = `ap:publish-channel:${id}`;
    await panel.handle(i);
    assert.equal(i.replies.at(-1).toJSON().custom_id, `ap:submit:${id}`);
    assert.equal(sessions.getSession(id, i).channelId, 'channel');
    sessions.deleteSession(id);
  }
});
test('publication checks member permission independently from bot permission', async () => {
  const i = interaction();
  i.channel.permissionsFor = member => ({ has: () => member.id === 'bot' });
  await assert.rejects(publishing.getPublishChannel(i, 'channel'), /没有/);
  assert.equal(i.sent.length, 0);
});
test('publication sends first, persists position, and rejects simultaneous same-title creation', async t => {
  const i = interaction(); let saved;
  t.mock.method(store, 'loadAttendance', () => saved || null);
  t.mock.method(store, 'createAttendance', (_, value) => { saved = value; });
  const options = { channelId: 'channel', title: 'Event', description: 'Description', selectRole: false };
  const results = await Promise.allSettled([publishing.publishAttendance(i, options), publishing.publishAttendance(i, options)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(i.sent.length, 1); assert.equal(saved.messageId, 'message'); assert.equal(saved.createdByUserId, 'user');
});
test('failed send does not store an active signup; failed save cleans up the sent message', async t => {
  const i = interaction(); let writes = 0, deleted = 0;
  t.mock.method(store, 'loadAttendance', () => null);
  t.mock.method(store, 'createAttendance', () => { writes++; throw Error('disk'); });
  const options = { channelId: 'channel', title: 'Event', selectRole: false };
  i.channel.send = async () => { throw Error('send'); };
  await assert.rejects(publishing.publishAttendance(i, options), /send/);
  assert.equal(writes, 0);
  i.channel.send = async () => ({ id: 'message', delete: async () => { deleted++; } });
  await assert.rejects(publishing.publishAttendance(i, options), /disk/);
  assert.equal(deleted, 1);
});
test('modal can publish only once, even if its submission is replayed', async t => {
  const i = interaction();
  t.mock.method(store, 'loadAttendance', () => null);
  t.mock.method(store, 'createAttendance', () => {});
  const id = sessions.createSession(i, { stage: 'form', channelId: 'channel', selectRole: false });
  i.customId = `ap:submit:${id}`; i.isModalSubmit = () => true;
  i.fields = { getTextInputValue: name => name === 'title' ? 'Event' : '' };
  await Promise.all([panel.handle(i), panel.handle(i)]);
  await panel.handle(i);
  assert.equal(i.sent.length, 1);
});
test('revoked admin cannot submit group channel settings', async () => {
  const i = interaction();
  const id = sessions.createSession(i, { stage: 'settings' });
  i.customId = `ap:save-channel:${id}`; i.isChannelSelectMenu = () => true;
  await panel.handle(i); assert.match(i.replies[0].content, /管理员/);
  sessions.deleteSession(id);
});
test('creator may open close confirmation but cannot use other admin actions', async t => {
  const event = storedEvent(t), i = interaction();
  i.message = { id: event.messageId, edit: async () => {} };
  i.values = ['close_signup'];
  await command.handleAttendanceAdminMenu(i);
  assert.match(i.replies[0].components[0].toJSON().components[0].custom_id, /attendance_close_confirm/);
  i.values = ['group_open']; await command.handleAttendanceAdminMenu(i);
  assert.match(i.replies.at(-1).content, /无权/);
});
test('close confirmation rechecks ownership and allows creator closure', async t => {
  const event = storedEvent(t), i = interaction();
  i.customId = `attendance_close_confirm:${event.messageId}`;
  i.user = { id: 'stranger' };
  await command.handleAttendanceCloseConfirm(i);
  assert.equal(store.loadAttendance(event.title).status, 'active');
  i.user = { id: 'user' }; await command.handleAttendanceCloseConfirm(i);
  assert.equal(store.loadAttendance(event.title), null);
  await command.handleAttendanceCloseConfirm(i);
  assert.match(i.replies.at(-1).content, /已结束/);
});
test('missing group setup points to control panel without an event channel selector', async t => {
  const event = storedEvent(t), i = interaction();
  event.guildId = `test-guild-${event.title}`; store.updateAttendance(event.title, event);
  i.guildId = event.guildId; i.memberPermissions = { has: () => true };
  i.values = ['group_open']; i.message = { id: event.messageId, edit: async () => {} };
  await command.handleAttendanceAdminMenu(i);
  assert.match(i.replies.at(-1).content, /中控台/);
  assert.deepEqual(i.replies.at(-1).components, []);
});

test('unreadable existing group panel does not create a replacement', async t => {
  const event = storedEvent(t), i = interaction();
  event.groupPanelChannelId = 'old'; event.groupPanelMessageId = 'group'; store.updateAttendance(event.title, event);
  i.memberPermissions = { has: () => true }; i.values = ['group_open'];
  i.message = { id: event.messageId, edit: async () => {} };
  i.client = { channels: { fetch: async () => { throw Object.assign(Error('Missing Access'), { code: 50001 }); } } };
  t.mock.method(console, 'error', () => {});
  await command.handleAttendanceAdminMenu(i);
  assert.match(i.replies.at(-1).content, /无法读取/);
  assert.equal(store.loadAttendance(event.title).groupPanelMessageId, 'group');
  assert.equal(i.sent.length, 0);
});

test('existing group panel opens without requiring a new configured channel', async t => {
  const event = storedEvent(t), i = interaction();
  event.groupPanelChannelId = 'old'; event.groupPanelMessageId = 'group';
  store.updateAttendance(event.title, event);
  i.memberPermissions = { has: () => true }; i.values = ['group_open'];
  i.message = { id: event.messageId, edit: async () => {} };
  i.client = { channels: { fetch: async id => {
    assert.equal(id, 'old'); return { isTextBased: () => true, messages: { fetch: async () => ({ id: 'group' }) } };
  } } };
  await command.handleAttendanceAdminMenu(i);
  assert.match(i.replies.at(-1).components[0].toJSON().components[0].url, /old\/group/);
});
