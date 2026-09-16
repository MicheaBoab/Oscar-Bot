const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../storage/announcementStore');
const history = require('../storage/announceHistoryStore');
const service = require('../helper/announcementService');
const images = require('../helper/announcementImages');
const panel = require('../helper/announcementPanel');
const sessions = require('../helper/panelSessions');

function setup(t) {
  const f = { notices: { raid: { text: 'Ready', imagePath: null } }, aliases: { team: ['123'] }, last: null, sent: [], replies: [], deleted: 0 };
  t.mock.method(store, 'notices', () => structuredClone(f.notices));
  t.mock.method(store, 'aliases', () => structuredClone(f.aliases));
  t.mock.method(history, 'getLastAnnounce', () => f.last);
  t.mock.method(history, 'setLastAnnounce', (_g, _r, _n, data) => { if (f.diskFailure) throw Error('disk'); f.last = data; });
  const channel = { guildId: 'guild', type: 0, permissionsFor: () => ({ has: () => true }),
    send: async payload => { if (f.sendFailure) throw Error('network'); f.sent.push(payload); return { id: 'new' }; },
    messages: { fetch: async () => ({ delete: async () => { if (f.deleteFailure) throw Error('permission'); f.deleted++; } }) } };
  f.i = { guildId: 'guild', user: { id: 'admin' }, memberPermissions: { has: () => true },
    guild: { channels: { fetch: async () => channel }, members: { me: {}, fetch: async () => ({}) },
      roles: { fetch: async () => ({ guild: { id: 'guild' }, mentionable: true }) } },
    client: { channels: { fetch: async () => channel } },
    reply: async p => f.replies.push(p), update: async p => f.replies.push(p), editReply: async p => f.replies.push(p),
    showModal: async p => f.replies.push(p.toJSON()), deferReply: async () => {}, deferUpdate: async () => {} };
  f.input = { channelId: 'channel', textKey: 'raid', roleAlias: 'team' };
  return f;
}
function temporaryStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-announcement-'));
  t.after(() => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) { for (const name of fs.readdirSync(file)) fs.unlinkSync(path.join(file, name)); fs.rmdirSync(file); }
      else fs.unlinkSync(file);
    }
    fs.rmdirSync(root);
  });
  return store.createStore(root);
}
const png = () => Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(16)]);

test('legacy template strings load and text edits preserve persistent images', t => {
  const s = temporaryStore(t);
  fs.writeFileSync(path.join(s.root, 'noticeTexts.json'), JSON.stringify({ notices: { raid: 'old' } }));
  s.changeImage('raid', 'notice-images/old.png');
  s.putNotice('raid', 'new');
  assert.equal(store.createStore(s.root).notices().raid.imagePath, 'notice-images/old.png');
  assert.throws(() => s.putNotice('raid', 'stale', { expected: '{}' }));
  assert.throws(() => s.imageFile('../outside.png'));
  assert.throws(() => store.aliasKey('__proto__'));
});

test('image replacement preserves shared files and removes unreferenced images', t => {
  const s = temporaryStore(t);
  fs.mkdirSync(path.join(s.root, 'notice-images'));
  fs.writeFileSync(s.imageFile('notice-images/old.png'), png());
  for (const key of ['one', 'two']) { s.putNotice(key, 'text', { create: true }); s.changeImage(key, 'notice-images/old.png'); }
  s.changeImage('one', null);
  assert.ok(fs.existsSync(s.imageFile('notice-images/old.png')));
  s.removeNotice('two');
  assert.equal(fs.existsSync(s.imageFile('notice-images/old.png')), false);
  assert.equal(s.notices().one.text, 'text');
});

test('image save uses recognizable unique name and rolls back file on stale binding', t => {
  const s = temporaryStore(t);
  s.putNotice('raid', 'text', { create: true });
  t.mock.method(store, 'imageFile', s.imageFile); t.mock.method(store, 'changeImage', s.changeImage);
  const relative = images.saveImage('raid', png(), JSON.stringify(s.notices().raid));
  assert.match(relative, /^notice-images\/notice_raid_[\da-f-]+\.png$/);
  assert.throws(() => images.saveImage('raid', png(), '{}'));
  assert.deepEqual(fs.readdirSync(path.dirname(s.imageFile(relative))), [path.basename(relative)]);
});

test('image download enforces streamed limit and signature without network', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, headers: { get: () => null }, body: (async function* () { yield Buffer.alloc(images.MAX_BYTES); yield Buffer.alloc(1); })() }));
  await assert.rejects(images.fetchImage('https://example.com/image'), /8 MiB/);
  await assert.rejects(images.fetchImage('file:///image'));
  assert.throws(() => images.imageExtension(Buffer.from('<html>not an image</html>')));
  assert.equal(images.imageExtension(png()), 'png');
});

test('offsets validate units, sign, and bounds', () => {
  assert.equal(service.parseOffset(''), 0); assert.equal(service.parseOffset('+10m'), 600); assert.equal(service.parseOffset('-2h'), -7200);
  for (const value of ['10m', '+0m', '+1year', '+999999999999999d']) assert.throws(() => service.parseOffset(value));
});

test('changed preview requires another confirmation without publication', async t => {
  const f = setup(t), plan = await service.prepare(f.i, f.input);
  f.notices.raid.text = 'Changed';
  const result = await service.send(f.i, f.input, plan.fingerprint);
  assert.equal(result.changed, true); assert.equal(f.sent.length, 0);
  await service.send(f.i, f.input, result.plan.fingerprint);
  assert.equal(f.sent.length, 1); assert.deepEqual(f.sent[0].allowedMentions, { parse: [], roles: ['123'] });
});

test('unexpired announcement blocks normal send; force replaces only after publication', async t => {
  const f = setup(t); f.last = { channelId: 'old', messageId: 'old-message', expiresAtMs: Date.now() + 60000 };
  await assert.rejects(service.send(f.i, f.input)); assert.equal(f.deleted, 0);
  await service.send(f.i, { ...f.input, force: true });
  assert.equal(f.sent.length, 1); assert.equal(f.deleted, 1); assert.equal(f.last.messageId, 'new');
});

test('failed publication preserves old history and message', async t => {
  const f = setup(t); const last = f.last = { channelId: 'old', messageId: 'old-message', expiresAtMs: null }; f.sendFailure = true;
  await assert.rejects(service.send(f.i, f.input), /network/);
  assert.equal(f.last, last); assert.equal(f.deleted, 0);
});

test('failed history save consumes workflow but preserves old message', async t => {
  const f = setup(t); f.last = { channelId: 'old', messageId: 'old-message' }; f.diskFailure = true;
  let consumed = 0;
  const result = await service.send(f.i, f.input, undefined, () => consumed++);
  assert.equal(consumed, 1); assert.equal(f.sent.length, 1); assert.equal(f.deleted, 0); assert.match(result.warning, /记录保存失败/);
});

test('failed old-message deletion returns manual deletion link', async t => {
  const f = setup(t); f.last = { channelId: 'old', messageId: 'old-message' }; f.deleteFailure = true;
  const result = await service.send(f.i, f.input);
  assert.match(result.warning, /https:\/\/discord.com\/channels\/guild\/old\/old-message/);
  assert.equal(f.last.messageId, 'new');
});

test('panel pagination and upload modal serialize with installed Discord builders', async t => {
  const f = setup(t);
  f.notices = Object.fromEntries(Array.from({ length: 26 }, (_, n) => [`item${n}`, { text: 'text' }]));
  f.i.customId = 'ann:image'; await panel.handle(f.i);
  const menu = f.replies.at(-1).components[0].toJSON().components[0], token = menu.custom_id.split(':')[2];
  assert.equal(menu.options.length, 25);
  f.i.customId = `ann:next:${token}`; await panel.handle(f.i);
  assert.equal(f.replies.at(-1).components[0].toJSON().components[0].options.length, 1);
  f.i.customId = `ann:pick:${token}`; f.i.values = ['25']; await panel.handle(f.i);
  assert.equal(f.replies.at(-1).components[0].component.custom_id, 'image');
  sessions.deleteSession(token);
  for (const page of ['root', 'templates', 'aliases']) for (const row of panel.buildPanel(page).components) row.toJSON();
});

test('permission and ownership checks reject restricted or foreign sessions', async t => {
  const f = setup(t), token = sessions.createSession(f.i, { stage: 'notice-form' });
  f.i.customId = `ann:notice-save:${token}`;
  await assert.rejects(panel.handle({ ...f.i, user: { id: 'other' } }));
  f.i.memberPermissions.has = () => false;
  await assert.rejects(panel.handle(f.i)); await assert.rejects(service.send(f.i, f.input));
  assert.equal(f.sent.length, 0); sessions.deleteSession(token);
});

test('concurrent and repeated confirmation publishes only once', async t => {
  const f = setup(t), plan = await service.prepare(f.i, f.input);
  const token = sessions.createSession(f.i, { ...f.input, stage: 'confirm', plan });
  f.i.customId = `ann:confirm:${token}`;
  const results = await Promise.allSettled([panel.handle(f.i), panel.handle(f.i)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.sent.length, 1); assert.equal(sessions.getSession(token, f.i), null);
  await assert.rejects(panel.handle(f.i));
});
