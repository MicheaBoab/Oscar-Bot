const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { EventEmitter } = require('events');
const discord = require('discord.js');

test('runtime enables only retained slash commands while legacy Reminder controls still dispatch', async () => {
  let client;
  class Client extends EventEmitter {
    constructor() { super(); client = this; }
    login() { return Promise.resolve(); }
  }
  const calls = [];
  const reminder = Object.fromEntries(['handleButton', 'handleSelectMenu', 'handleChannelSelect', 'handleRoleSelect', 'handleModalSubmit']
    .map(name => [name, async () => calls.push(name)]));
  const filename = path.join(__dirname, '..', 'index.js');
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => {
      if (name === 'discord.js') return { ...discord, Client };
      if (name === 'dotenv') return { config() {} };
      if (name === './storage/codexItemStore') return { initializeCodexAutoUpdate() {} };
      if (name === './storage/pollFileStore') return { listPolls: () => [] };
      if (name === './commands/reminder') return reminder;
      return localRequire(name);
    }, process: { env: {} }, console: { log() {}, error: (...args) => { throw Error(args.join(' ')); } }, setInterval() {},
  }, { filename });
  assert.deepEqual([...client.commands.keys()].sort(), ['control', 'manual', 'ping', 'refresh']);
  const handle = client.listeners(discord.Events.InteractionCreate)[0];
  for (const [kind, id] of [
    ['isButton', 'reminder_board_refresh'], ['isStringSelectMenu', 'reminder_admin_menu'],
    ['isChannelSelectMenu', 'reminder_channel_select'], ['isRoleSelectMenu', 'reminder_role_select'],
    ['isModalSubmit', 'reminder_add_modal'],
  ]) {
    const interaction = { customId: id };
    for (const method of ['isAutocomplete', 'isChatInputCommand', 'isButton', 'isStringSelectMenu', 'isChannelSelectMenu', 'isRoleSelectMenu', 'isModalSubmit']) {
      interaction[method] = () => method === kind;
    }
    await handle(interaction);
  }
  assert.deepEqual(calls, Object.keys(reminder));
  for (const command of client.commands.values()) assert.ok(command.data.toJSON().name);
});
