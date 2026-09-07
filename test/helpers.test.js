const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDurationInput } = require('../helper/parseDuration');
const { parseOption } = require('../helper/parseOption');
const {
  toNextSameUtcTime,
  renderRecurringDiscordTimestamps,
} = require('../helper/timeHelpers');
const {
  parseClockTime,
  formatClockTime,
  normalizeReminderName,
  parseReminderTimeTemplate,
  parseIsoDate,
  weekdayFromIsoDate,
  compareDateKeys,
  buildReminderSlotKey,
  parseReminderSlotKey,
  isValidTimezone,
} = require('../helper/reminderUtils');

test('parseDurationInput handles defaults, aliases, and invalid input', () => {
  assert.deepEqual(parseDurationInput(''), {
    ok: true,
    ms: 10 * 60 * 1000,
    normalized: '10min',
    usedDefault: true,
  });
  assert.equal(parseDurationInput('2 hours').ms, 2 * 60 * 60 * 1000);
  assert.equal(parseDurationInput(' 30SEC ').normalized, '30s');
  assert.equal(parseDurationInput('5d').ms, 5 * 24 * 60 * 60 * 1000);
  assert.equal(parseDurationInput('0m').ok, false);
  assert.equal(parseDurationInput('tomorrow').ok, false);
});

test('parseOption distinguishes Discord user mentions from text', () => {
  assert.deepEqual(parseOption(' <@12345678901234567> '), {
    type: 'user',
    value: '12345678901234567',
  });
  assert.deepEqual(parseOption('<@!12345678901234567>'), {
    type: 'user',
    value: '12345678901234567',
  });
  assert.deepEqual(parseOption('hello world'), {
    type: 'text',
    value: 'hello world',
  });
});

test('timeHelpers advances recurring timestamps to the next occurrence', () => {
  const nowMs = Date.UTC(2026, 0, 1, 14, 0, 0);
  const templateUnix = Date.UTC(2020, 0, 1, 15, 30, 45) / 1000;
  const expectedUnix = Date.UTC(2026, 0, 1, 15, 30, 45) / 1000;

  assert.equal(toNextSameUtcTime(templateUnix, nowMs), expectedUnix);
  assert.equal(
    renderRecurringDiscordTimestamps('next <t:1577892645:F>', nowMs, 60),
    `next <t:${expectedUnix + 60}:F>`,
  );
  assert.equal(renderRecurringDiscordTimestamps('no timestamp', nowMs), 'no timestamp');
});

test('reminderUtils validates clocks, dates, and slot keys', () => {
  assert.deepEqual(parseClockTime(' 9：05 '), { hour: 9, minute: 5 });
  assert.deepEqual(parseClockTime('23:59'), { hour: 23, minute: 59 });
  assert.equal(parseClockTime('24:00'), null);
  assert.equal(formatClockTime(9, 5), '09:05');
  assert.equal(normalizeReminderName('  Raid Night '), 'raid night');

  assert.deepEqual(parseIsoDate('2028-02-29'), {
    year: 2028,
    month: 2,
    day: 29,
    dateKey: '2028-02-29',
  });
  assert.equal(parseIsoDate('2027-02-29'), null);
  assert.equal(weekdayFromIsoDate('2028-02-29'), 2);
  assert.equal(compareDateKeys('2028-02-28', '2028-02-29'), -1);

  assert.deepEqual(parseReminderTimeTemplate('<t:1700000000:F>'), {
    unix: 1700000000,
    format: 'F',
    raw: '<t:1700000000:F>',
  });
  assert.equal(parseReminderTimeTemplate('0'), null);
  assert.equal(buildReminderSlotKey('2028-02-29', 9, 5, 'start'), '2028-02-29T09:05|start');
  assert.deepEqual(parseReminderSlotKey('2028-02-29T09:05|start'), {
    dateKey: '2028-02-29',
    hour: 9,
    minute: 5,
    kind: 'start',
  });
  assert.equal(isValidTimezone('Asia/Taipei'), true);
  assert.equal(isValidTimezone('Not/A_Timezone'), false);
});
