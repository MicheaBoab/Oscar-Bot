const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const attendanceStore = require('../storage/attendanceStore');

const attendanceDir = path.join(__dirname, '..', 'storage', 'attendances');
const archiveDir = path.join(__dirname, '..', 'storage', 'archive');

function testTitle() {
  return `__unit_attendance_${process.pid}_${Date.now()}`;
}

function removeTestFiles(title) {
  const prefix = `attendance_${title}`;
  for (const directory of [attendanceDir, archiveDir]) {
    for (const file of fs.readdirSync(directory)) {
      if (file.startsWith(prefix)) {
        fs.rmSync(path.join(directory, file), { force: true });
      }
    }
  }
}

test('attendanceStore persists, sanitizes, finds, and archives an attendance', () => {
  const title = testTitle();
  removeTestFiles(title);

  try {
    const participants = Object.create(null);
    participants.good = { displayName: 'Alice' };
    Object.defineProperty(participants, '__proto__', {
      value: { displayName: 'unsafe' },
      enumerable: true,
    });
    Object.defineProperty(participants, 'constructor', {
      value: { displayName: 'unsafe' },
      enumerable: true,
    });

    attendanceStore.createAttendance(title, {
      title,
      status: 'active',
      messageId: 'signup-message',
      groupPanelMessageId: 'group-message',
      participants,
      declinedParticipants: null,
      groups: [
        { id: 'g1', label: 'Raid', capacity: 4.9, memberIds: [123] },
        { id: '', label: 'invalid' },
        null,
      ],
    });

    const loaded = attendanceStore.loadAttendance(title);
    assert.equal(loaded.status, 'active');
    assert.deepEqual(loaded.participants, { good: { displayName: 'Alice' } });
    assert.deepEqual(loaded.declinedParticipants, {});
    assert.deepEqual(loaded.groups, [
      { id: 'g1', label: 'Raid', capacity: 4, memberIds: ['123'] },
    ]);

    attendanceStore.updateAttendance(title, {
      ...loaded,
      messageId: 'updated-message',
    });

    assert.equal(attendanceStore.attendanceExistsByTitle(title), true);
    assert.equal(attendanceStore.findAttendanceByMessage('updated-message').title, title);
    assert.equal(attendanceStore.findAttendanceByGroupPanelMessage('group-message').title, title);

    assert.equal(attendanceStore.archiveAttendance(title), true);
    assert.equal(attendanceStore.loadAttendance(title), null);
    assert.equal(attendanceStore.archiveAttendance(title), false);
  } finally {
    removeTestFiles(title);
  }
});
