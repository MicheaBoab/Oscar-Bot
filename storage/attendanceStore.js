const fs = require('fs');
const path = require('path');

const ATTENDANCE_DIR = path.join(__dirname, 'attendances');
const ARCHIVE_DIR = path.join(__dirname, 'archive');
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function formatDateForFilename(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-')
    + '_'
    + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join('-');
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const output = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const key = String(rawKey || '').trim();
    if (!key || FORBIDDEN_KEYS.has(key)) continue;
    output[key] = value;
  }

  return output;
}

function safeSlug(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');
}

function sanitizeGroups(groups) {
  if (!Array.isArray(groups)) return [];

  return groups
    .filter(group => group && typeof group === 'object' && typeof group.id === 'string' && group.id)
    .map(group => ({
      id: group.id,
      label: String(group.label || group.id).slice(0, 80),
      capacity: Number.isFinite(group.capacity) && group.capacity > 0 ? Math.floor(group.capacity) : null,
      memberIds: Array.isArray(group.memberIds) ? group.memberIds.map(String) : [],
    }));
}

ensureDirectory(ATTENDANCE_DIR);
ensureDirectory(ARCHIVE_DIR);

function getAttendancePath(title) {
  return path.join(ATTENDANCE_DIR, `attendance_${safeSlug(title)}.json`);
}

function createAttendance(title, data) {
  fs.writeFileSync(getAttendancePath(title), JSON.stringify(data, null, 2), 'utf-8');
}

function loadAttendance(title) {
  const filePath = getAttendancePath(title);
  if (!fs.existsSync(filePath)) return null;

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  parsed.participants = sanitizeObject(parsed.participants);
  parsed.declinedParticipants = sanitizeObject(parsed.declinedParticipants);
  parsed.groups = sanitizeGroups(parsed.groups);
  parsed.status = parsed.status === 'ended' ? 'ended' : 'active';
  return parsed;
}

function updateAttendance(title, data) {
  const nextData = {
    ...data,
    participants: sanitizeObject(data.participants),
    declinedParticipants: sanitizeObject(data.declinedParticipants),
    groups: sanitizeGroups(data.groups),
  };

  fs.writeFileSync(getAttendancePath(title), JSON.stringify(nextData, null, 2), 'utf-8');
}

function archiveAttendance(title) {
  const sourcePath = getAttendancePath(title);
  if (!fs.existsSync(sourcePath)) return false;

  const archiveFileName = `attendance_${safeSlug(title)}_${formatDateForFilename(new Date())}.json`;
  const targetPath = path.join(ARCHIVE_DIR, archiveFileName);
  fs.renameSync(sourcePath, targetPath);
  return true;
}

function listAttendances() {
  return fs
    .readdirSync(ATTENDANCE_DIR)
    .filter(file => file.startsWith('attendance_') && file.endsWith('.json'))
    .map(file => file.replace(/^attendance_/, '').replace(/\.json$/, ''));
}

function loadAllAttendances() {
  const files = fs.readdirSync(ATTENDANCE_DIR);
  const attendances = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ATTENDANCE_DIR, file), 'utf-8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      raw.participants = sanitizeObject(raw.participants);
      raw.declinedParticipants = sanitizeObject(raw.declinedParticipants);
      raw.groups = sanitizeGroups(raw.groups);
      attendances.push({ data: raw });
    } catch (error) {
      console.error('[attendance] 读取失败:', file, error.message);
    }
  }

  return attendances;
}

function attendanceExistsByTitle(title) {
  return loadAttendance(title) !== null;
}

function findAttendanceByMessage(messageId) {
  if (!messageId) return null;

  for (const title of listAttendances()) {
    const attendance = loadAttendance(title);
    if (!attendance || attendance.status !== 'active') continue;
    if (String(attendance.messageId || '') !== String(messageId)) continue;
    return { title, attendance };
  }

  return null;
}

function findAttendanceByGroupPanelMessage(messageId) {
  if (!messageId) return null;

  for (const title of listAttendances()) {
    const attendance = loadAttendance(title);
    if (!attendance) continue;
    if (String(attendance.groupPanelMessageId || '') !== String(messageId)) continue;
    return { title, attendance };
  }

  return null;
}

module.exports = {
  createAttendance,
  loadAttendance,
  updateAttendance,
  archiveAttendance,
  listAttendances,
  loadAllAttendances,
  attendanceExistsByTitle,
  findAttendanceByMessage,
  findAttendanceByGroupPanelMessage,
};