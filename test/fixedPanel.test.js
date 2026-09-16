const test = require('node:test');
const assert = require('node:assert/strict');
const { publishFixedPanel, withPanelLock } = require('../helper/fixedPanel');
const control = require('../commands/control');
const { routePanelInteraction } = require('../helper/panelInteractions');

function fixture() {
  const calls = [];
  const message = { id: 'message', edit: async () => { calls.push('edit'); return message; },
    delete: async () => { calls.push('delete'); } };
  const channel = { guildId: 'guild', type: 0, guild: { members: { me: {} } },
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => message },
    send: async () => { calls.push('send'); return message; } };
  const options = { client: { channels: { fetch: async () => channel } }, guildId: 'guild', channelId: 'new',
    previous: { channelId: 'old', messageId: 'old-message' }, payload: {},
    save: async () => { calls.push('save'); } };
  return { calls, message, channel, options };
}

test('relocation sends and commits before deleting the old message', async () => {
  const f = fixture();
  await publishFixedPanel(f.options);
  assert.deepEqual(f.calls, ['send', 'save', 'delete']);
});
test('same-channel setup edits; only unknown-message recreates', async () => {
  const f = fixture(); f.options.previous.channelId = 'new';
  await publishFixedPanel(f.options);
  assert.deepEqual(f.calls, ['edit', 'save']);
  f.calls.length = 0;
  f.channel.messages.fetch = async () => { throw { code: 10008 }; };
  await publishFixedPanel(f.options);
  assert.deepEqual(f.calls, ['send', 'save']);
});
test('fetch/edit failures do not create duplicate messages or save a new location', async () => {
  for (const operation of ['fetch', 'edit']) {
    const f = fixture(); f.options.previous.channelId = 'new';
    if (operation === 'fetch') f.channel.messages.fetch = async () => { throw Error('network'); };
    else f.message.edit = async () => { throw Error('network'); };
    await assert.rejects(publishFixedPanel(f.options), /network/);
    assert.deepEqual(f.calls, []);
  }
});
test('failed publication preserves config and the old message', async () => {
  const f = fixture(); f.channel.send = async () => { throw Error('send failed'); };
  await assert.rejects(publishFixedPanel(f.options), /send failed/);
  assert.deepEqual(f.calls, []);
});
test('failed old deletion returns its link without editing old controls', async () => {
  const f = fixture(); f.message.delete = async () => { throw { code: 50013 }; };
  const result = await publishFixedPanel(f.options);
  assert.match(result.cleanupWarning, /guild\/old\/old-message/);
  assert.deepEqual(f.calls, ['send', 'save']);
});
test('failed commit cleans up the new message and does not fetch old channel', async () => {
  const f = fixture(); let fetches = 0;
  f.options.client.channels.fetch = async () => { fetches++; return f.channel; };
  f.options.save = async () => { throw Error('disk'); };
  await assert.rejects(publishFixedPanel(f.options), /disk/);
  assert.deepEqual(f.calls, ['send', 'delete']);
  assert.equal(fetches, 1);
});
test('cross-guild and unwriteable channels are rejected before sending', async () => {
  for (const kind of ['guild', 'permission']) {
    const f = fixture();
    if (kind === 'guild') f.channel.guildId = 'other';
    else f.channel.permissionsFor = () => ({ has: () => false });
    await assert.rejects(publishFixedPanel(f.options));
    assert.deepEqual(f.calls, []);
  }
});
test('panel lock serializes operations and recovers after a failure', async () => {
  const seen = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = withPanelLock('test', async () => { seen.push(1); await gate; throw Error('failed'); });
  const rejected = assert.rejects(first, /failed/);
  const second = withPanelLock('test', async () => { seen.push(2); });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(seen, [1]);
  release(); await rejected; await second;
  assert.deepEqual(seen, [1, 2]);
});
test('non-admin cannot configure a panel, including legacy slash entry', async () => {
  let reply;
  await control.configurePanel({ guildId: 'g', memberPermissions: { has: () => false },
    reply: async value => { reply = value; } }, 'channel', true);
  assert.equal(reply.flags, 64);
  assert.match(reply.content, /管理员/);
});
test('channel selector rejects other users, expired workflows, and revoked admin permission', async () => {
  for (const [owner, time, expected] of [['other', Date.now(), /失效/], ['user', 0, /失效/], ['user', Date.now(), /管理员/]]) {
    let reply;
    await control.handleChannelSelect({ customId: `control_reminder_channel:${owner}:${time}`,
      user: { id: 'user' }, guildId: 'guild', values: ['channel'], memberPermissions: { has: () => false },
      reply: async value => { reply = value; } });
    assert.equal(reply.flags, 64); assert.match(reply.content, expected);
  }
});
test('panel routing works without a slash command registry and uses private replies', async () => {
  let reply;
  const handled = await routePanelInteraction({ customId: 'control_module:help',
    isButton: () => true, reply: async value => { reply = value; } });
  assert.equal(handled, true); assert.equal(reply.flags, 64);
  assert.deepEqual(control.buildModulePanel('reminder').components, []);
});
