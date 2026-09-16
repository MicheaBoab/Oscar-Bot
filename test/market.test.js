const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const store = require('../storage/liveQueueStore');
const scheduler = require('../helper/liveQueueScheduler');
const panel = require('../helper/marketPanel');
const actions = require('../helper/marketActions');
const sessions = require('../helper/panelSessions');
const watches = require('../storage/watchStore');
const items = require('../storage/itemNameStore');

function memoryStore(t, initial = {}) {
  let data = JSON.stringify(initial);
  const exists = fs.existsSync, read = fs.readFileSync, write = fs.writeFileSync;
  const target = p => String(p).endsWith('liveQueue.json');
  t.mock.method(fs, 'existsSync', p => target(p) ? true : exists(p));
  t.mock.method(fs, 'readFileSync', (p, ...args) => target(p) ? data : read(p, ...args));
  t.mock.method(fs, 'writeFileSync', (p, value, ...args) => target(p) ? (data = value) : write(p, value, ...args));
  return () => JSON.parse(data);
}
function fixture(t) {
  const id = `market-test-${Math.random()}`;
  memoryStore(t, { [id]: { channelId: 'queue', watchChannelId: 'watch', messageIds: [], active: true, revision: 0 } });
  let requests = 0;
  t.mock.method(global, 'fetch', async () => { requests++; return { ok: true, json: async () => ({ resultCode: 0, resultMsg: '' }) }; });
  const sent = [], edits = [], replies = [];
  const channel = { id: 'queue', guildId: id, type: 0, permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async messageId => ({ id: messageId, edit: async payload => { edits.push(payload); return { id: messageId }; } }) },
    send: async payload => { sent.push(payload); return { id: `m-${sent.length}` }; } };
  const i = { guildId: id, user: { id: 'user' }, memberPermissions: { has: () => true },
    client: { channels: { fetch: async () => channel } },
    guild: { channels: { fetch: async () => channel }, members: { me: {}, fetch: async () => ({}) } },
    reply: async p => replies.push(p), update: async p => replies.push(p), editReply: async p => replies.push(p),
    deferReply: async () => {}, showModal: async p => replies.push(p.toJSON()) };
  return { id, i, sent, edits, replies, channel, requests: () => requests };
}
test('legacy configs default active; stop persists, keeps channels/IDs, and channel edits do not resume', t => {
  const read = memoryStore(t, { guild: { channelId: 'queue', watchChannelId: 'watch', messageIds: ['old'] } });
  assert.equal(store.getLiveQueue('guild').active, true);
  store.setTrackingActive('guild', false);
  store.setLiveQueue('guild', 'queue'); store.setWatchChannel('guild', 'watch2');
  const config = store.getLiveQueue('guild');
  assert.equal(config.active, false); assert.deepEqual(config.messageIds, ['old']);
  assert.equal(config.watchChannelId, 'watch2'); assert.equal(read().guild.active, false);
  store.setTrackingActive('guild', true); assert.equal(store.getLiveQueue('guild').active, true);
});
test('first-time watch-only configuration still enables tracking', t => {
  memoryStore(t); store.setWatchChannel('guild', 'watch');
  assert.equal(store.getLiveQueue('guild').active, true);
  assert.equal(store.getLiveQueue('guild').channelId, null);
});
test('stopped automatic and manual refreshes make no market requests', async t => {
  const f = fixture(t); store.setTrackingActive(f.id, false);
  assert.equal((await scheduler.doQueueUpdateForGuild(f.i.client, f.id)).status, 'stopped');
  assert.equal((await scheduler.refreshMarket(f.i.client, f.id)).status, 'stopped');
  assert.equal(f.requests(), 0); assert.equal(f.sent.length, 0);
});
test('concurrent requests share one update and repeated manual refresh has cooldown', async t => {
  const f = fixture(t);
  await Promise.all([scheduler.refreshMarket(f.i.client, f.id), scheduler.refreshMarket(f.i.client, f.id)]);
  assert.equal(f.requests(), 1); assert.equal(f.sent.length, 1);
  assert.equal((await scheduler.refreshMarket(f.i.client, f.id)).status, 'cooldown');
});
test('manual refresh does not reset or allocate the scheduler timer', async t => {
  const f = fixture(t); let timers = 0;
  t.mock.method(global, 'setTimeout', () => { timers++; return 123; });
  t.mock.method(global, 'clearTimeout', () => {});
  scheduler.startLiveQueueScheduler(f.i.client);
  assert.equal(timers, 1);
  await scheduler.refreshMarket(f.i.client, f.id);
  assert.equal(timers, 1);
});
test('stopping during API request discards its result before publishing', async t => {
  const f = fixture(t); let release, started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  const originalFetch = global.fetch;
  global.fetch = async () => { started(); await new Promise(resolve => { release = resolve; }); return { ok: true, json: async () => ({ resultCode: 0, resultMsg: '' }) }; };
  const pending = scheduler.doQueueUpdateForGuild(f.i.client, f.id);
  await requestStarted; store.setTrackingActive(f.id, false); release();
  assert.equal((await pending).status, 'stopped'); assert.equal(f.sent.length, 0);
  // Restore the first mock before Node restores this test's mocks.
  global.fetch = originalFetch;
});
test('stop marks existing output, preserves settings and resume refreshes immediately', async t => {
  const f = fixture(t); store.updateMessageIds(f.id, ['old'], 'queue');
  await actions.configure(f.i, 'stop');
  assert.equal(store.getLiveQueue(f.id).active, false);
  assert.match(f.edits[0].content, /已停止/);
  assert.equal(store.getLiveQueue(f.id).watchChannelId, 'watch'); assert.equal(f.requests(), 0);
  await actions.configure(f.i, 'resume');
  assert.equal(store.getLiveQueue(f.id).active, true); assert.equal(f.requests(), 1);
});
test('non-admin cannot change settings, stop or resume', async t => {
  const f = fixture(t); f.i.memberPermissions.has = () => false;
  for (const action of ['stop', 'resume', 'queue-channel', 'watch-channel']) await actions.configure(f.i, action, 'queue');
  assert.equal(f.requests(), 0); assert.equal(store.getLiveQueue(f.id).active, true);
  assert.ok(f.replies.every(p => p.flags === 64));
});
test('watch search pages all matches and confirms a selected enhancement before saving', async t => {
  const f = fixture(t); let added;
  t.mock.method(items, 'searchItems', () => Array.from({ length: 26 }, (_, index) => ({ name: `Item ${index}`, value: String(index) })));
  t.mock.method(watches, 'addWatch', (guildId, watch) => { added = { guildId, ...watch }; return { added: true }; });
  f.i.customId = 'mp:add'; await panel.handle(f.i);
  const token = f.replies[0].custom_id.split(':')[2];
  f.i.customId = `mp:search:${token}`; f.i.fields = { getTextInputValue: () => 'Item' }; await panel.handle(f.i);
  f.i.customId = `mp:next:${token}`; await panel.handle(f.i);
  assert.equal(f.replies.at(-1).components[0].toJSON().components[0].options.length, 1);
  f.i.customId = `mp:item:${token}`; f.i.values = ['25']; await panel.handle(f.i);
  f.i.customId = `mp:enhancement:${token}`; f.i.values = ['BASE']; await panel.handle(f.i);
  assert.equal(added, undefined);
  f.i.customId = `mp:confirm:${token}`; await panel.handle(f.i); await panel.handle(f.i);
  assert.equal(added.itemId, '25'); assert.equal(added.enhancement, 'BASE'); assert.equal(added.userId, 'user');
});
test('watch removal rechecks ownership and listing alone does not delete', async t => {
  const f = fixture(t); let deletes = 0;
  t.mock.method(watches, 'getUserWatches', () => [{ id: 'own', itemName: 'Own', enhancement: null }]);
  t.mock.method(watches, 'removeWatch', () => { deletes++; });
  f.i.customId = 'mp:remove'; await panel.handle(f.i);
  const token = f.replies[0].components[0].toJSON().components[0].custom_id.split(':')[2];
  assert.equal(deletes, 0);
  f.i.customId = `mp:delete:${token}`; f.i.values = ['someone-else']; await panel.handle(f.i); assert.equal(deletes, 0);
  f.i.values = ['own']; await panel.handle(f.i); assert.equal(deletes, 1);
  assert.equal(sessions.getSession(token, f.i), null);
});
