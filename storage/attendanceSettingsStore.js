const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, 'attendanceSettings.json');

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error('[attendance] 读取分组频道设置失败:', error.message);
    return {};
  }
}

function getGroupChannelId(guildId) {
  if (!guildId) return null;
  const value = loadSettings()[String(guildId)]?.groupChannelId;
  return typeof value === 'string' && value ? value : null;
}

function setGroupChannelId(guildId, channelId) {
  if (!guildId || !channelId) return;
  const settings = loadSettings();
  settings[String(guildId)] = {
    ...(settings[String(guildId)] || {}),
    groupChannelId: String(channelId),
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

module.exports = { getGroupChannelId, setGroupChannelId };
