const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ICON_DIR = path.join(__dirname, 'items', 'icons');
const inFlightDownloads = new Map();

function ensureIconDir() {
  if (!fs.existsSync(ICON_DIR)) {
    fs.mkdirSync(ICON_DIR, { recursive: true });
  }
}

function extFromIconUrl(iconUrl) {
  const match = String(iconUrl || '').match(/\.(webp|png|jpg|jpeg)(?:\?|$)/i);
  return match ? `.${match[1].toLowerCase()}` : '.webp';
}

function buildIconFilePath(itemId, iconUrl) {
  const ext = extFromIconUrl(iconUrl);
  return path.join(ICON_DIR, `${String(itemId)}${ext}`);
}

async function downloadToFile(url, filePath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Oscar-Bot/1.0',
      'Accept': 'image/webp,image/*,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`Icon request failed with HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(filePath, buffer);
}

async function ensureLocalIcon(itemId, iconUrl) {
  if (!itemId || !iconUrl) return null;

  ensureIconDir();
  const filePath = buildIconFilePath(itemId, iconUrl);

  if (fs.existsSync(filePath)) {
    return filePath;
  }

  if (inFlightDownloads.has(filePath)) {
    return inFlightDownloads.get(filePath);
  }

  const task = (async () => {
    try {
      await downloadToFile(iconUrl, filePath);
      return filePath;
    } catch (error) {
      console.warn(`Icon cache download failed for item ${itemId}:`, error.message);
      return null;
    } finally {
      inFlightDownloads.delete(filePath);
    }
  })();

  inFlightDownloads.set(filePath, task);
  return task;
}

module.exports = {
  ICON_DIR,
  ensureLocalIcon,
};