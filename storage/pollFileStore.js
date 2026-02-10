const path = require('path');
const fs = require('fs');
const { title } = require('process');

const POLL_DIR = path.join(__dirname, 'polls');
const ARCHIVE_DIR = path.join(__dirname, 'archive');

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

// 确保目录存在
if (!fs.existsSync(POLL_DIR)) {
  fs.mkdirSync(POLL_DIR, { recursive: true });
}
if (!fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

// 获取当前投票名称
function getPollPath(titlename) {
  return path.join(POLL_DIR, `poll_${titlename}.json`);
}

// archive停止的投票
function archivePoll(titlename) {
  const sourcePath = path.join(POLL_DIR, `poll_${titlename}.json`);
  if (!fs.existsSync(sourcePath)) {
    return false;
  }
  const readableTime = formatDateForFilename(new Date());
  const archiveFileName = `poll_${titlename}_${readableTime}.json`;
  const targetPath = path.join(ARCHIVE_DIR, archiveFileName);
  //const targetPath = path.join(ARCHIVE_DIR, `${titlename}_${formatDateForFilename(new Date.now())}.json`);

  // ⭐ 核心：移动文件
  fs.renameSync(sourcePath, targetPath);
  return true;
}

// 创建投票文件
function createPoll(title, data) {
  const filePath = getPollPath(title);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// 读取投票
function loadPoll(title) {
  const filePath = getPollPath(title);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// 更新投票
function updatePoll(title, data) {
  const filePath = getPollPath(title);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// 检测poll名字是否存在
function pollExistsByTitle(title) {
  const pollTitles = listPolls();

  for (const pollTitle of pollTitles) {
    const poll = loadPoll(pollTitle);
    if (poll && poll.title === title) {
      return true;
    }
  }
  return false;
}

// 读取所有投票内容 (用于listpoll)
function loadAllPolls() {
  const files = fs.readdirSync(POLL_DIR);

  const polls = [];

  for (const file of files) {
    // ⭐ 只处理 .json
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(POLL_DIR, file);

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      polls.push({
        data,             // 你给出的结构
      });
    } catch (err) {
      console.error('读取 poll 失败:', file, err);
    }
  }

  return polls;
}

// 列出所有投票名称（重启恢复用）
function listPolls() {
  return fs
    .readdirSync(POLL_DIR)
    .filter(f => f.startsWith('poll_') && f.endsWith('.json'))
    .map(f => f.replace('poll_', '').replace('.json', ''));
}

function findPollsByTitle(title) {
  const pollTitles = listPolls();
  const matches = [];

  for (const pollTitle of pollTitles) {
    const poll = loadPoll(pollTitle);
    if (poll && poll.title === title) {
      matches.push({ pollTitle, poll });
    }
  }

  return matches;
}

module.exports = {
  createPoll,
  loadPoll,
  updatePoll,
  archivePoll,
  listPolls,
  findPollsByTitle,
  pollExistsByTitle,
  formatDateForFilename,
  loadAllPolls,
};
