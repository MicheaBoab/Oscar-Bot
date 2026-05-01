const fs = require('fs');
const path = require('path');

const ITEM_DIR = path.join(__dirname, 'items');
const CODEX_ITEM_TABLE_FILE = path.join(ITEM_DIR, 'codexItemTable.json');
const CODEX_META_FILE = path.join(ITEM_DIR, 'codexItemMeta.json');

const CODEX_ITEMS_URL_EN = 'https://bdocodex.com/query.php?a=items&l=en';
const CODEX_ITEMS_URL_CN = 'https://bdocodex.com/query.php?a=items&l=cn';
const CODEX_ITEMS_URL_TW = 'https://bdocodex.com/query.php?a=items&l=tw';
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // check every 24 hours
const MAX_SYNC_AGE_MS = 7 * 24 * 60 * 60 * 1000; // refresh if older than 7 days

let syncTimer = null;
let inFlightSync = null;

function ensureFiles() {
  if (!fs.existsSync(ITEM_DIR)) {
    fs.mkdirSync(ITEM_DIR, { recursive: true });
  }

  if (!fs.existsSync(CODEX_ITEM_TABLE_FILE)) {
    fs.writeFileSync(CODEX_ITEM_TABLE_FILE, JSON.stringify({}, null, 2));
  }

  if (!fs.existsSync(CODEX_META_FILE)) {
    fs.writeFileSync(CODEX_META_FILE, JSON.stringify({ lastSyncAt: null }, null, 2));
  }
}

function readLastSyncAt() {
  ensureFiles();

  try {
    const metaRaw = fs.readFileSync(CODEX_META_FILE, 'utf8');
    const meta = JSON.parse(metaRaw);
    return typeof meta.lastSyncAt === 'number' ? meta.lastSyncAt : null;
  } catch {
    return null;
  }
}

function writeLastSyncAt(timestamp) {
  fs.writeFileSync(CODEX_META_FILE, JSON.stringify({ lastSyncAt: timestamp }, null, 2));
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(html) {
  const withoutTags = String(html).replace(/<[^>]*>/g, ' ');
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

function parseIconUrl(iconHtml) {
  const text = String(iconHtml || '');
  const webp = text.match(/\/items\/[^\"'\]]+\.(?:webp|png|jpg|jpeg)/i);
  if (!webp) return null;
  return `https://bdocodex.com${webp[0]}`;
}

function inferCategoryFromIconUrl(iconUrl) {
  const text = String(iconUrl || '').toLowerCase();
  if (!text) return 'other';

  if (text.includes('/06_pc_equipitem/')) {
    if (text.includes('/15_necklace/') || text.includes('/16_ring/') || text.includes('/17_earring/') || text.includes('/18_belt/')) {
      return 'accessory';
    }

    if (text.includes('/01_weapon/') || text.includes('/08_subweapon/')) {
      return 'weapon';
    }

    if (text.includes('/09_upperbody/') || text.includes('/11_hand/') || text.includes('/12_foot/') || text.includes('/13_hel/')) {
      return 'armor';
    }
  }

  return 'other';
}

function inferEnhanceTagFromCategory(category) {
  if (category === 'accessory') return 'accessory';
  if (category === 'weapon' || category === 'armor') return 'weaponArmor';
  return 'none';
}

function parseCodexJson(rawText) {
  let text = String(rawText || '').trim();
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const jsonStart = text.indexOf('{');
  if (jsonStart > 0) {
    text = text.slice(jsonStart);
  }

  return JSON.parse(text);
}

function buildItemMapFromCodexRows(rows, locale = 'en') {
  const nameField = locale === 'cn'
    ? 'nameCN'
    : (locale === 'tw' ? 'nameTW' : 'name');
  const map = {};

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;

    const rawId = row[0];
    const rawNameHtml = row[2];
    const rawIconHtml = row[1];

    const id = String(rawId);
    if (!id || id === 'undefined' || id === 'null') continue;
    if (map[id]) continue; // keep first occurrence if duplicated

    const name = stripHtml(rawNameHtml);
    if (!name) continue;

    const icon = parseIconUrl(rawIconHtml);
    const category = inferCategoryFromIconUrl(icon);
    const enhanceTag = inferEnhanceTagFromCategory(category);
    map[id] = {
      [nameField]: name,
      icon,
      category,
      enhanceTag,
    };
  }

  return map;
}

async function fetchCodexRows(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Oscar-Bot/1.0',
      'Accept': 'application/json,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`Codex request failed with HTTP ${response.status} (${url})`);
  }

  const text = await response.text();
  const parsed = parseCodexJson(text);
  return Array.isArray(parsed.aaData) ? parsed.aaData : [];
}

async function fetchAndSaveCodexItemTable() {
  ensureFiles();

  console.log('📡 Fetching EN item names from Codex...');
  const enRows = await fetchCodexRows(CODEX_ITEMS_URL_EN);
  const enMap = buildItemMapFromCodexRows(enRows, 'en');

  console.log('📡 Fetching CN item names from Codex...');
  const cnRows = await fetchCodexRows(CODEX_ITEMS_URL_CN);
  const cnMap = buildItemMapFromCodexRows(cnRows, 'cn');

  console.log('📡 Fetching TW item names from Codex...');
  const twRows = await fetchCodexRows(CODEX_ITEMS_URL_TW);
  const twMap = buildItemMapFromCodexRows(twRows, 'tw');

  // Merge: EN entries as base, inject CN/TW localized names
  const merged = {};
  for (const [id, entry] of Object.entries(enMap)) {
    const category = entry.category || cnMap[id]?.category || twMap[id]?.category || 'other';
    const enhanceTag = entry.enhanceTag || cnMap[id]?.enhanceTag || twMap[id]?.enhanceTag || 'none';
    merged[id] = {
      name: entry.name,
      nameCN: cnMap[id]?.nameCN ?? null,
      nameTW: twMap[id]?.nameTW ?? null,
      icon: entry.icon,
      category,
      enhanceTag,
    };
  }
  // Include any CN-only/TW-only entries (edge case)
  for (const [id, entry] of Object.entries(cnMap)) {
    if (!merged[id]) {
      merged[id] = {
        name: null,
        nameCN: entry.nameCN,
        nameTW: twMap[id]?.nameTW ?? null,
        icon: entry.icon,
        category: entry.category || 'other',
        enhanceTag: entry.enhanceTag || 'none',
      };
    }
  }
  for (const [id, entry] of Object.entries(twMap)) {
    if (!merged[id]) {
      merged[id] = {
        name: null,
        nameCN: cnMap[id]?.nameCN ?? null,
        nameTW: entry.nameTW,
        icon: entry.icon,
        category: entry.category || 'other',
        enhanceTag: entry.enhanceTag || 'none',
      };
    }
  }

  fs.writeFileSync(CODEX_ITEM_TABLE_FILE, JSON.stringify(merged, null, 2));
  writeLastSyncAt(Date.now());

  return Object.keys(merged).length;
}

async function syncCodexItemTable(force = false) {
  if (inFlightSync) return inFlightSync;

  inFlightSync = (async () => {
    const lastSyncAt = readLastSyncAt();
    const stale = !lastSyncAt || (Date.now() - lastSyncAt) > MAX_SYNC_AGE_MS;
    if (!force && !stale) return null;

    const count = await fetchAndSaveCodexItemTable();
    return count;
  })();

  try {
    return await inFlightSync;
  } finally {
    inFlightSync = null;
  }
}

async function initializeCodexAutoUpdate() {
  ensureFiles();

  try {
    const updatedCount = await syncCodexItemTable(false);
    if (typeof updatedCount === 'number') {
      console.log(`📦 Codex item table updated: ${updatedCount} items`);
    }
  } catch (error) {
    console.error('❌ Initial Codex sync failed:', error.message);
  }

  if (!syncTimer) {
    syncTimer = setInterval(async () => {
      try {
        const updatedCount = await syncCodexItemTable(false);
        if (typeof updatedCount === 'number') {
          console.log(`📦 Codex item table updated: ${updatedCount} items`);
        }
      } catch (error) {
        console.error('❌ Scheduled Codex sync failed:', error.message);
      }
    }, SYNC_INTERVAL_MS);
  }
}

module.exports = {
  CODEX_ITEM_TABLE_FILE,
  CODEX_META_FILE,
  initializeCodexAutoUpdate,
  syncCodexItemTable,
};
