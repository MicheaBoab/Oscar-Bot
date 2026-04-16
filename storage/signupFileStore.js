const fs = require('fs');
const path = require('path');

const AOB_DIR = path.join(__dirname, 'AOB');
const BACKUP_DIR = path.join(AOB_DIR, 'backup');
const SIGNUP_FILE = path.join(AOB_DIR, 'signups.json');

function formatBackupTime(date = new Date()) {
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

function ensureDirs() {
  if (!fs.existsSync(AOB_DIR)) {
    fs.mkdirSync(AOB_DIR, { recursive: true });
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function ensureSignupFile() {
  ensureDirs();

  if (!fs.existsSync(SIGNUP_FILE)) {
    fs.writeFileSync(SIGNUP_FILE, JSON.stringify([], null, 2));
  }
}

function backupSignupFile() {
  ensureDirs();

  if (!fs.existsSync(SIGNUP_FILE)) {
    return;
  }

  const backupName = `signups_${formatBackupTime()}.json`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  fs.copyFileSync(SIGNUP_FILE, backupPath);
}

function loadSignups() {
  ensureSignupFile();

  const raw = fs.readFileSync(SIGNUP_FILE, 'utf8');
  return JSON.parse(raw);
}

function appendSignup(signupData) {
  const signups = loadSignups();
  const existingIndex = signups.findIndex(item => item.userId === signupData.userId);

  if (existingIndex >= 0) {
    signups[existingIndex] = signupData;
  } else {
    signups.push(signupData);
  }

  backupSignupFile();
  fs.writeFileSync(SIGNUP_FILE, JSON.stringify(signups, null, 2));
}

module.exports = {
  appendSignup,
  loadSignups,
};