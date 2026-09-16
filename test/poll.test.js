const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const store = require('../storage/pollFileStore');
const service = require('../helper/pollService');
const panel = require('../helper/pollPanel');
const sessions = require('../helper/panelSessions');

function setup(t, initial = []) {
  const data = new Map(initial.map(p => [p.key || p.id, structuredClone(p)]));
  const archive = [], sent = [], edits = [];
  t.mock.method(store, 'loadAllPolls', () => [...data].map(([key, value]) => ({ key, data: structuredClone(value) })));
  t.mock.method(store, 'loadPoll', key => data.has(key) ? structuredClone(data.get(key)) : null);
  t.mock.method(store, 'updatePoll', (key, value) => data.set(key, structuredClone(value)));
  t.mock.method(store, 'createPoll', (key, value) => data.set(key, structuredClone(value)));
  t.mock.method(store, 'pollExistsByTitle', title => [...data.values()].some(p => p.title === title));
  t.mock.method(store, 'archivePoll', key => { archive.push(data.get(key)); data.delete(key); });
  const channel = { id: 'channel', guildId: 'guild', type: 0, isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => ({ edit: async value => { edits.push(value); } }) },
    send: async value => { sent.push(value); return { id: `sent-${sent.length}`, delete: async () => {} }; } };
  const replies = [];
  const i = { guildId: 'guild', channelId: 'channel', user: { id: 'user' }, message: { id: 'message' },
    guild: { channels: { fetch: async () => channel }, members: { me: {}, fetch: async () => ({ displayName: 'Member' }) } },
    client: { channels: { fetch: async () => channel } },
    memberPermissions: { has: () => true },
    isButton: () => false, isStringSelectMenu: () => false, isChannelSelectMenu: () => false, isModalSubmit: () => false,
    deferReply: async () => {}, deferUpdate: async () => {},
    editReply: async p => { replies.push(p); }, reply: async p => { replies.push(p); }, followUp: async p => { replies.push(p); },
    showModal: async p => { replies.push(p.toJSON()); } };
  return { data, archive, sent, edits, channel, i, replies };
}
function poll(overrides = {}) {
  return { id: 'id', title: 'Title: with colon', guildId: 'guild', channelId: 'channel', messageId: 'message',
    status: 'active', expiresAt: Date.now() + 60000, options: [{ label: 'A', value: 'text:A' }, { label: 'B', value: 'text:B' }], votes: {}, ...overrides };
}
test('creation uses IDs for storage and controls, with existing duration syntax and duplicate title policy', async t => {
  const f = setup(t);
  const p = await service.createPoll(f.i, { channelId: 'channel', title: 'Raid: Friday / poll', options: ['A', 'B'], duration: '2min' });
  assert.notEqual(p.id, p.title); assert.equal(p.durationMs, 120000);
  assert.equal(f.data.get(p.id).messageId, 'sent-1');
  assert.equal(f.sent[0].components[0].toJSON().components[0].custom_id, `poll_vote:${p.id}`);
  await assert.rejects(service.createPoll(f.i, { channelId: 'channel', title: p.title, options: ['A', 'B'] }), /同名/);
});
test('member permissions, invalid options, and huge durations prevent publication', async t => {
  const f = setup(t), input = { channelId: 'channel', title: 'Title', options: ['A', 'B'] };
  await assert.rejects(service.createPoll(f.i, { ...input, options: ['A'] }));
  await assert.rejects(service.createPoll(f.i, { ...input, duration: '999999999999999999999d' }));
  f.channel.permissionsFor = () => ({ has: () => false });
  await assert.rejects(service.createPoll(f.i, input), /权限/);
  assert.equal(f.sent.length, 0); assert.equal(f.data.size, 0);
});
test('failed creation send leaves no record', async t => {
  const f = setup(t); f.channel.send = async () => { throw Error('network'); };
  await assert.rejects(service.createPoll(f.i, { channelId: 'channel', title: 'T', options: ['A', 'B'] }), /network/);
  assert.equal(f.data.size, 0);
});
test('legacy title menu including colon votes by original message and upgrades controls', async t => {
  const f = setup(t, [poll({ key: 'legacy-key', id: undefined, guildId: undefined })]);
  f.i.customId = 'poll_select:Title: with colon'; f.i.values = ['text:B'];
  await service.vote(f.i);
  const saved = f.data.get('legacy-key');
  assert.equal(saved.votes.user, 1); assert.ok(saved.id);
  assert.equal(f.replies[0].components[1].toJSON().components[0].custom_id, `poll_end:${saved.id}`);
  f.i.message.id = 'unrelated'; assert.equal(service.resolveInteraction(f.i), undefined);
});
test('invalid votes are rejected and concurrent users are not lost', async t => {
  const f = setup(t, [poll()]); f.i.customId = 'poll_vote:id'; f.i.values = ['99'];
  await service.vote(f.i); assert.deepEqual(f.data.get('id').votes, {});
  f.i.values = ['0'];
  await Promise.all([service.vote(f.i), service.vote({ ...f.i, user: { id: 'second' }, values: ['1'] })]);
  assert.deepEqual(f.data.get('id').votes, { user: 0, second: 1 });
});
test('manual closure and expiry race edits original, publishes once, and archives once', async t => {
  const f = setup(t, [poll({ expiresAt: 0 })]);
  await Promise.all([service.endPoll(f.i.client, 'id', 'guild'), service.scanPolls(f.i.client)]);
  assert.equal(f.sent.length, 1); assert.equal(f.edits.length, 1); assert.equal(f.archive.length, 1);
  assert.deepEqual(f.edits[0].components, []);
  assert.match(f.sent[0].embeds[0].toJSON().description, /无人投票/);
});
test('transient result failure keeps progress for retry without reopening voting', async t => {
  const f = setup(t, [poll()]); const send = f.channel.send; let attempts = 0;
  f.channel.send = async p => { if (++attempts === 1) throw Error('network'); return send(p); };
  await assert.rejects(service.endPoll(f.i.client, 'id'), /network/);
  assert.equal(f.data.get('id').status, 'ended'); assert.equal(f.archive.length, 0);
  await service.scanPolls(f.i.client);
  assert.equal(f.edits.length, 1); assert.equal(f.sent.length, 1); assert.equal(f.archive.length, 1);
});
test('archive failure retries without sending results twice', async t => {
  const f = setup(t, [poll()]); let first = true;
  store.archivePoll = key => { if (first) { first = false; throw Error('disk'); } f.data.delete(key); };
  await assert.rejects(service.endPoll(f.i.client, 'id'), /disk/);
  await service.endPoll(f.i.client, 'id'); assert.equal(f.sent.length, 1);
});
test('ordinary members cannot end via button or legacy slash', async t => {
  const f = setup(t, [poll()]); f.i.memberPermissions.has = () => false;
  f.i.customId = 'poll_end:id'; f.i.isButton = () => true;
  await panel.handle(f.i); await panel.endByTitle(f.i, 'Title: with colon');
  assert.equal(f.data.get('id').status, 'active'); assert.equal(f.sent.length, 0);
  assert.ok(f.replies.every(r => r.flags === 64));
});
test('end validates guild and cannot act on a different original message', async t => {
  const f = setup(t, [poll()]);
  await assert.rejects(service.endPoll(f.i.client, 'id', 'other'), /服务器/);
  f.i.customId = 'poll_end:id'; f.i.message.id = 'other';
  assert.equal(service.resolveInteraction(f.i), undefined);
});
test('startup upgrades active legacy controls and finishes expired legacy polls after connection', async t => {
  const f = setup(t, [poll({ id: undefined, key: 'old', guildId: undefined })]);
  await service.scanPolls(f.i.client, { refreshActive: true });
  assert.ok(f.data.get('old').id); assert.equal(f.edits.length, 1); assert.equal(f.sent.length, 0);
  f.data.get('old').expiresAt = 0;
  await service.scanPolls(f.i.client, { refreshActive: true });
  assert.equal(f.sent.length, 1); assert.equal(f.archive.length, 1);
});
test('poll modal uses channel session and rejects reused submissions', async t => {
  const f = setup(t); f.i.customId = 'pp:create'; f.i.isButton = () => true;
  await panel.handle(f.i);
  const id = f.replies[0].components[0].toJSON().components[0].custom_id.split(':')[2];
  f.i.isButton = () => false; f.i.isChannelSelectMenu = () => true; f.i.values = ['channel']; f.i.customId = `pp:channel:${id}`;
  await panel.handle(f.i); assert.equal(f.replies.at(-1).custom_id, `pp:submit:${id}`);
  f.i.isChannelSelectMenu = () => false; f.i.isModalSubmit = () => true; f.i.customId = `pp:submit:${id}`;
  f.i.fields = { getTextInputValue: name => ({ title: 'Title', options: 'A\nB', duration: '30s' })[name] };
  await Promise.all([panel.handle(f.i), panel.handle(f.i)]);
  assert.equal(f.sent.length, 1); assert.equal(sessions.getSession(id, f.i), null);
});
test('poll file store persists ID keys, archives, and rejects path traversal', () => {
  const key = `__unit_poll_${process.pid}_${Date.now()}`;
  try {
    store.createPoll(key, poll({ id: key })); assert.equal(store.loadPoll(key).id, key);
    assert.ok(store.loadAllPolls().some(p => p.key === key));
    store.updatePoll(key, poll({ id: key, status: 'ended' })); store.archivePoll(key);
    assert.equal(store.loadPoll(key), null);
    assert.throws(() => store.loadPoll('../escape'), /Invalid/);
  } finally {
    for (const dir of ['polls', 'archive']) {
      const root = path.join(__dirname, '..', 'storage', dir);
      for (const file of fs.readdirSync(root)) if (file.startsWith(`poll_${key}`)) fs.unlinkSync(path.join(root, file));
    }
  }
});
