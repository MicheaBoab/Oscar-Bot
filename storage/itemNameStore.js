const fs = require('fs');
const path = require('path');

const ITEM_DIR = path.join(__dirname, 'items');
const CODEX_ITEM_TABLE_FILE = path.join(ITEM_DIR, 'codexItemTable.json');

let cachedCodexMap = null;
let cachedCodexMtimeMs = null;

function inferCategoryFromIcon(icon) {
  const text = String(icon || '').toLowerCase();
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

function inferEnhanceTag(category) {
  if (category === 'accessory') return 'accessory';
  if (category === 'weapon' || category === 'armor') return 'weaponArmor';
  return 'none';
}

function ensureItemTableFile() {
  if (!fs.existsSync(ITEM_DIR)) {
    fs.mkdirSync(ITEM_DIR, { recursive: true });
  }

  if (!fs.existsSync(CODEX_ITEM_TABLE_FILE)) {
    fs.writeFileSync(CODEX_ITEM_TABLE_FILE, JSON.stringify({}, null, 2));
  }
}

function normalizeTableToMap(raw) {
  const map = new Map();

  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;

      const id = row.itemId ?? row.id ?? row.mainKey;
      const name = row.name ?? row.itemName ?? row.enName ?? row.title;
      const icon = row.icon ?? null;
      const category = row.category ?? null;
      const enhanceTag = row.enhanceTag ?? null;

      if (id === undefined || id === null || !name) continue;
      const resolvedCategory = category ? String(category) : inferCategoryFromIcon(icon);
      const resolvedEnhanceTag = enhanceTag ? String(enhanceTag) : inferEnhanceTag(resolvedCategory);
      map.set(String(id), {
        name: String(name),
        icon: icon ? String(icon) : null,
        category: resolvedCategory,
        enhanceTag: resolvedEnhanceTag,
      });
    }

    return map;
  }

  if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        map.set(String(id), {
          name: value,
          icon: null,
          category: 'other',
          enhanceTag: 'none',
        });
        continue;
      }

      if (value && typeof value === 'object') {
        const name = value.name ?? value.itemName ?? value.enName ?? value.title;
        const nameCN = value.nameCN ?? null;
        const nameTW = value.nameTW ?? null;
        const icon = value.icon ?? null;
        const category = value.category ?? null;
        const enhanceTag = value.enhanceTag ?? null;
        const wmEnhMin = value.wmEnhMin !== undefined ? value.wmEnhMin : undefined;
        const wmEnhMax = value.wmEnhMax !== undefined ? value.wmEnhMax : undefined;
        const wmRangeUpdatedAt = typeof value.wmRangeUpdatedAt === 'number' ? value.wmRangeUpdatedAt : undefined;
        if (name || nameCN || nameTW) {
          const resolvedCategory = category ? String(category) : inferCategoryFromIcon(icon);
          const resolvedEnhanceTag = enhanceTag ? String(enhanceTag) : inferEnhanceTag(resolvedCategory);
          const entry = {
            name: name ? String(name) : null,
            nameCN: nameCN ? String(nameCN) : null,
            nameTW: nameTW ? String(nameTW) : null,
            icon: icon ? String(icon) : null,
            category: resolvedCategory,
            enhanceTag: resolvedEnhanceTag,
          };
          if (wmEnhMin !== undefined) entry.wmEnhMin = wmEnhMin;
          if (wmEnhMax !== undefined) entry.wmEnhMax = wmEnhMax;
          if (wmRangeUpdatedAt !== undefined) entry.wmRangeUpdatedAt = wmRangeUpdatedAt;
          map.set(String(id), entry);
        }
      }
    }
  }

  return map;
}

function loadMapFromFile(filePath) {
  ensureItemTableFile();

  let parsed;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  return normalizeTableToMap(parsed);
}

function loadCodexMap() {
  ensureItemTableFile();
  const stat = fs.statSync(CODEX_ITEM_TABLE_FILE);

  if (cachedCodexMap && cachedCodexMtimeMs === stat.mtimeMs) {
    return cachedCodexMap;
  }

  cachedCodexMap = loadMapFromFile(CODEX_ITEM_TABLE_FILE);
  cachedCodexMtimeMs = stat.mtimeMs;
  return cachedCodexMap;
}

function resolveItemName(itemId) {
  const meta = resolveItemMeta(itemId);
  return meta?.name || null;
}

function resolveItemMeta(itemId) {
  const key = String(itemId);

  const codexMap = loadCodexMap();
  return codexMap.get(key) || null;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function findItemByName(query) {
  const target = normalizeName(query);
  if (!target) return null;

  const codexMap = loadCodexMap();
  let partialHit = null;

  for (const [itemId, meta] of codexMap.entries()) {
    const nameEN = normalizeName(meta?.name);
    const nameCN = normalizeName(meta?.nameCN);
    const nameTW = normalizeName(meta?.nameTW);

    if (!nameEN && !nameCN && !nameTW) continue;

    if (nameEN === target || nameCN === target || nameTW === target) {
      return { itemId, meta };
    }

    if (!partialHit && (nameEN.includes(target) || nameCN.includes(target) || nameTW.includes(target))) {
      partialHit = { itemId, meta };
    }
  }

  return partialHit;
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function hasTraditionalHint(text) {
  // Common Traditional Chinese-only characters used to choose TW display preference.
  return /[體臺萬與為來們個這說點開關觀畫門風龍寶擇]/.test(String(text || ''));
}

function detectChineseVariantPreference(codexMap, target, rawQuery) {
  if (hasTraditionalHint(rawQuery)) return 'tw';

  let twOnlyHits = 0;
  let cnOnlyHits = 0;

  for (const meta of codexMap.values()) {
    const nameCN = normalizeName(meta?.nameCN);
    const nameTW = normalizeName(meta?.nameTW);
    if (!nameCN && !nameTW) continue;

    const cnMatch = nameCN.includes(target);
    const twMatch = nameTW.includes(target);

    if (twMatch && !cnMatch) twOnlyHits += 1;
    if (cnMatch && !twMatch) cnOnlyHits += 1;

    if (twOnlyHits >= 2 || cnOnlyHits >= 2) break;
  }

  if (twOnlyHits > cnOnlyHits) return 'tw';
  return 'cn';
}

function searchItems(query, limit = 25) {
  const target = normalizeName(query);
  const codexMap = loadCodexMap();

  if (!target) return [];

  const preferChinese = hasChinese(query);
  const preferredChineseVariant = preferChinese
    ? detectChineseVariantPreference(codexMap, target, query)
    : null;
  const exact = [];
  const prefix = [];
  const contains = [];

  for (const [itemId, meta] of codexMap.entries()) {
    const nameEN = normalizeName(meta?.name);
    const nameCN = normalizeName(meta?.nameCN);
    const nameTW = normalizeName(meta?.nameTW);
    const displayName = preferChinese
      ? (preferredChineseVariant === 'tw'
        ? (meta?.nameTW || meta?.nameCN || meta?.name || itemId)
        : (meta?.nameCN || meta?.nameTW || meta?.name || itemId))
      : (meta?.name || meta?.nameTW || meta?.nameCN || itemId);

    if (!nameEN && !nameCN && !nameTW) continue;

    if (nameEN === target || nameCN === target || nameTW === target) {
      exact.push({ name: displayName, value: itemId });
    } else if (nameEN.startsWith(target) || nameCN.startsWith(target) || nameTW.startsWith(target)) {
      prefix.push({ name: displayName, value: itemId });
    } else if (nameEN.includes(target) || nameCN.includes(target) || nameTW.includes(target)) {
      contains.push({ name: displayName, value: itemId });
    }

    if (exact.length >= limit) break;
    if (prefix.length + contains.length >= limit * 4) break;
  }

  return [...exact, ...prefix, ...contains].slice(0, limit);
}

// 写锁：确保同一时刻只有一个 writeEnhRangeToTable 在写文件
let enhWriteQueue = Promise.resolve();

/**
 * 批量将强化范围写入 codexItemTable.json。
 * updates: { [itemId]: { wmEnhMin, wmEnhMax, wmRangeUpdatedAt } }
 * 使用 Promise 队列保证并发安全，只在所有 embed 构建完后统一调用一次。
 */
function writeEnhRangeToTable(updates) {
  if (!updates || Object.keys(updates).length === 0) return enhWriteQueue;
  enhWriteQueue = enhWriteQueue.then(() => {
    ensureItemTableFile();
    let table;
    try {
      table = JSON.parse(fs.readFileSync(CODEX_ITEM_TABLE_FILE, 'utf8'));
    } catch {
      table = {};
    }
    for (const [id, range] of Object.entries(updates)) {
      if (!table[id]) table[id] = {};
      table[id].wmEnhMin = range.wmEnhMin !== undefined ? range.wmEnhMin : null;
      table[id].wmEnhMax = range.wmEnhMax !== undefined ? range.wmEnhMax : null;
      table[id].wmRangeUpdatedAt = range.wmRangeUpdatedAt;
    }
    fs.writeFileSync(CODEX_ITEM_TABLE_FILE, JSON.stringify(table, null, 2));
  }).catch(err => {
    console.error('[itemNameStore] writeEnhRangeToTable 写入失败:', err.message);
  });
  return enhWriteQueue;
}

module.exports = {
  CODEX_ITEM_TABLE_FILE,
  resolveItemMeta,
  resolveItemName,
  findItemByName,
  searchItems,
  writeEnhRangeToTable,
};