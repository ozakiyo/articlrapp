/**
 * カテゴリ別ランキング URL の永続化（1ファイルに複数カテゴリを保存）
 */
const fs = require('fs');
const path = require('path');

const STORE_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(STORE_DIR, 'ranking-urls.json');
/** @deprecated 旧形式（カテゴリごと個別 JSON）の読み込み用 */
const LEGACY_STORE_DIR = path.join(STORE_DIR, 'ranking-urls');

const MALL_KEYS = ['amazon', 'rakuten', 'yahoo', 'kojima', 'bic'];

function normalizeCategoryLabel(category) {
  return String(category || '').trim();
}

function normalizeRankingUrlsInput(urls) {
  const out = {};
  if (!urls || typeof urls !== 'object') return out;
  for (const key of MALL_KEYS) {
    const v = String(urls[key] || '').trim();
    if (v) out[key] = v;
  }
  return out;
}

function emptyStore() {
  return { version: 1, updatedAt: null, categories: {} };
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function importLegacyCategoryFile(filePath) {
  const raw = readJsonFile(filePath);
  if (!raw || typeof raw !== 'object') return null;
  const category = normalizeCategoryLabel(raw.category);
  const rankingUrls = normalizeRankingUrlsInput(raw.rankingUrls);
  if (!category || !Object.keys(rankingUrls).length) return null;
  return {
    category,
    entry: {
      rankingUrls,
      savedAt: raw.savedAt || null,
      note: String(raw.note || '').trim() || null,
    },
  };
}

function migrateLegacyFiles(store) {
  if (!fs.existsSync(LEGACY_STORE_DIR)) return store;
  let changed = false;
  for (const name of fs.readdirSync(LEGACY_STORE_DIR)) {
    if (!name.endsWith('.json')) continue;
    const imported = importLegacyCategoryFile(path.join(LEGACY_STORE_DIR, name));
    if (!imported) continue;
    const existing = store.categories[imported.category];
    const existingAt = existing?.savedAt ? Date.parse(existing.savedAt) : 0;
    const importedAt = imported.entry.savedAt ? Date.parse(imported.entry.savedAt) : 0;
    if (!existing || importedAt >= existingAt) {
      store.categories[imported.category] = imported.entry;
      changed = true;
    }
  }
  if (changed) {
    store.updatedAt = new Date().toISOString();
    writeStore(store);
  }
  return store;
}

function readStore() {
  let store = emptyStore();
  if (fs.existsSync(STORE_FILE)) {
    const raw = readJsonFile(STORE_FILE);
    if (raw && typeof raw === 'object') {
      store = {
        version: 1,
        updatedAt: raw.updatedAt || null,
        categories:
          raw.categories && typeof raw.categories === 'object' ? { ...raw.categories } : {},
      };
    }
  }
  return migrateLegacyFiles(store);
}

function writeStore(store) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const payload = {
    version: 1,
    updatedAt: store.updatedAt || new Date().toISOString(),
    categories: store.categories || {},
  };
  fs.writeFileSync(STORE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function normalizeCategoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const rankingUrls = normalizeRankingUrlsInput(entry.rankingUrls);
  if (!Object.keys(rankingUrls).length) return null;
  return {
    rankingUrls,
    savedAt: entry.savedAt || null,
    note: String(entry.note || '').trim() || null,
  };
}

/**
 * @returns {{ category: string, rankingUrls: object, savedAt?: string, note?: string } | null}
 */
function loadSavedRankingUrls(category) {
  const label = normalizeCategoryLabel(category);
  if (!label) return null;
  const store = readStore();
  const entry = normalizeCategoryEntry(store.categories[label]);
  if (!entry) return null;
  return { category: label, ...entry };
}

function hasSavedRankingUrls(category) {
  return Boolean(loadSavedRankingUrls(category));
}

/**
 * @returns {{ category: string, rankingUrls: object, savedAt: string|null, note: string|null }[]}
 */
function listSavedRankingCategories() {
  const store = readStore();
  return Object.entries(store.categories)
    .map(([category, entry]) => {
      const normalized = normalizeCategoryEntry(entry);
      if (!normalized) return null;
      return { category, ...normalized };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a.savedAt ? Date.parse(a.savedAt) : 0;
      const bTime = b.savedAt ? Date.parse(b.savedAt) : 0;
      return bTime - aTime || a.category.localeCompare(b.category, 'ja');
    });
}

/**
 * @param {string} category
 * @param {object} rankingUrls
 * @param {{ note?: string }} [meta]
 */
function saveRankingUrls(category, rankingUrls, meta = {}) {
  const label = normalizeCategoryLabel(category);
  if (!label) {
    throw new Error('カテゴリを指定してください。');
  }
  const normalized = normalizeRankingUrlsInput(rankingUrls);
  if (!Object.keys(normalized).length) {
    throw new Error('保存する URL を1件以上入力してください。');
  }

  const store = readStore();
  const savedAt = new Date().toISOString();
  const entry = {
    rankingUrls: normalized,
    savedAt,
    note: String(meta?.note || '').trim() || undefined,
  };
  store.categories[label] = entry;
  store.updatedAt = savedAt;
  writeStore(store);

  return {
    category: label,
    rankingUrls: normalized,
    savedAt,
    note: entry.note || null,
  };
}

module.exports = {
  STORE_FILE,
  LEGACY_STORE_DIR,
  MALL_KEYS,
  loadSavedRankingUrls,
  hasSavedRankingUrls,
  listSavedRankingCategories,
  saveRankingUrls,
  normalizeRankingUrlsInput,
};
