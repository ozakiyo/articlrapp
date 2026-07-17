/**
 * カテゴリ別 競合記事 URL の永続化
 */
const fs = require('fs');
const path = require('path');

const STORE_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(STORE_DIR, 'competitor-articles.json');
const MAX_ARTICLES_PER_CATEGORY = 8;
const TRACKING_QUERY_KEYS = new Set([
  'lid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'ref',
  'yclid',
  'gclid',
  'fbclid',
]);

function normalizeCategoryLabel(category) {
  return String(category || '').trim();
}

function normalizeUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  try {
    const parsed = new URL(u);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_QUERY_KEYS.has(String(key).toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return u;
  }
}

function normalizeArticleEntry(raw, index = 0, fallbackCategory = '') {
  if (!raw || typeof raw !== 'object') return null;
  const url = normalizeUrl(raw.url);
  if (!url) return null;
  const site = String(raw.site || '').trim() || `競合${index + 1}`;
  const category =
    String(raw.category || fallbackCategory || '').trim() || fallbackCategory || '';
  return { site, category, url };
}

function normalizeArticlesInput(articles, fallbackCategory = '') {
  if (!Array.isArray(articles)) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < articles.length; i++) {
    const entry = normalizeArticleEntry(articles[i], i, fallbackCategory);
    if (!entry || seen.has(entry.url)) continue;
    seen.add(entry.url);
    out.push(entry);
    if (out.length >= MAX_ARTICLES_PER_CATEGORY) break;
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

function ensureStoreFile() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    writeStore(emptyStore());
  }
}

function readStore() {
  ensureStoreFile();
  const raw = readJsonFile(STORE_FILE);
  if (!raw || typeof raw !== 'object') return emptyStore();
  return {
    version: 1,
    updatedAt: raw.updatedAt || null,
    categories:
      raw.categories && typeof raw.categories === 'object' ? { ...raw.categories } : {},
  };
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

function normalizeCategoryEntry(entry, categoryLabel = '') {
  if (!entry || typeof entry !== 'object') return null;
  const label = normalizeCategoryLabel(categoryLabel);
  const articles = normalizeArticlesInput(entry.articles, label);
  if (!articles.length) return null;
  return {
    articles,
    hubUrl: normalizeUrl(entry.hubUrl) || null,
    savedAt: entry.savedAt || null,
    note: String(entry.note || '').trim() || null,
  };
}

/**
 * @returns {{ category: string, articles: object[], hubUrl?: string, savedAt?: string, note?: string } | null}
 */
function loadSavedCompetitorArticles(category) {
  const label = normalizeCategoryLabel(category);
  if (!label) return null;
  const store = readStore();
  const entry = normalizeCategoryEntry(store.categories[label], label);
  if (!entry) return null;
  return { category: label, ...entry };
}

function listSavedCompetitorCategories() {
  const store = readStore();
  return Object.entries(store.categories)
    .map(([category, entry]) => {
      const normalized = normalizeCategoryEntry(entry, category);
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
 * @param {object[]} articles
 * @param {{ note?: string, hubUrl?: string }} [meta]
 */
function saveCompetitorArticles(category, articles, meta = {}) {
  const label = normalizeCategoryLabel(category);
  if (!label) {
    throw new Error('カテゴリを指定してください。');
  }
  const normalized = normalizeArticlesInput(articles, label);
  if (!normalized.length) {
    throw new Error('保存する競合記事 URL を1件以上入力してください。');
  }

  const store = readStore();
  const savedAt = new Date().toISOString();
  const entry = {
    articles: normalized,
    hubUrl: normalizeUrl(meta.hubUrl) || undefined,
    savedAt,
    note: String(meta?.note || '').trim() || undefined,
  };
  store.categories[label] = entry;
  store.updatedAt = savedAt;
  writeStore(store);

  return {
    category: label,
    articles: normalized,
    hubUrl: entry.hubUrl || null,
    savedAt,
    note: entry.note || null,
  };
}

module.exports = {
  STORE_FILE,
  MAX_ARTICLES_PER_CATEGORY,
  ensureStoreFile,
  loadSavedCompetitorArticles,
  listSavedCompetitorCategories,
  saveCompetitorArticles,
  normalizeArticlesInput,
};
