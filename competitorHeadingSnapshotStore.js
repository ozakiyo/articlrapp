/**
 * カテゴリ×URL 単位の競合記事見出しスナップショットと lastAnalysis の永続化
 */
const fs = require('fs');
const path = require('path');

const STORE_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(STORE_DIR, 'competitor-heading-snapshots.json');

function normalizeCategoryLabel(category) {
  return String(category || '').trim();
}

function articleKey(site, url) {
  return `${String(site || '').trim()}|${String(url || '').trim()}`;
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

function getCategoryBucket(store, category) {
  const label = normalizeCategoryLabel(category);
  if (!label) return null;
  if (!store.categories[label] || typeof store.categories[label] !== 'object') {
    store.categories[label] = { articles: {}, lastAnalysis: null };
  }
  const bucket = store.categories[label];
  if (!bucket.articles || typeof bucket.articles !== 'object') {
    bucket.articles = {};
  }
  return bucket;
}

/**
 * @returns {{ site: string, url: string, fetchedAt: string, headings: object[] } | null}
 */
function loadArticleSnapshot(category, site, url) {
  const label = normalizeCategoryLabel(category);
  if (!label || !url) return null;
  const store = readStore();
  const bucket = store.categories[label];
  if (!bucket?.articles) return null;
  const key = articleKey(site, url);
  const entry = bucket.articles[key];
  if (!entry || typeof entry !== 'object') return null;
  return {
    site: String(entry.site || site || '').trim(),
    url: String(entry.url || url || '').trim(),
    fetchedAt: entry.fetchedAt || null,
    headings: Array.isArray(entry.headings) ? entry.headings : [],
  };
}

/**
 * @param {string} category
 * @param {{ site: string, url: string, headings: object[], fetchedAt?: string }} snapshot
 */
function saveArticleSnapshot(category, snapshot) {
  const label = normalizeCategoryLabel(category);
  const site = String(snapshot?.site || '').trim();
  const url = String(snapshot?.url || '').trim();
  if (!label || !url) return null;

  const store = readStore();
  const bucket = getCategoryBucket(store, label);
  const fetchedAt = snapshot.fetchedAt || new Date().toISOString();
  const headings = Array.isArray(snapshot.headings)
    ? snapshot.headings
        .filter((h) => h && h.text)
        .map((h) => ({
          level: String(h.level || '').toLowerCase(),
          text: String(h.text || '').trim(),
        }))
    : [];

  const key = articleKey(site, url);
  bucket.articles[key] = { site, url, fetchedAt, headings };
  store.updatedAt = fetchedAt;
  writeStore(store);
  return bucket.articles[key];
}

function loadLastAnalysis(category) {
  const label = normalizeCategoryLabel(category);
  if (!label) return null;
  const store = readStore();
  const bucket = store.categories[label];
  if (!bucket?.lastAnalysis || typeof bucket.lastAnalysis !== 'object') return null;
  return bucket.lastAnalysis;
}

function saveLastAnalysis(category, analysis) {
  const label = normalizeCategoryLabel(category);
  if (!label || !analysis || typeof analysis !== 'object') return null;
  const store = readStore();
  const bucket = getCategoryBucket(store, label);
  bucket.lastAnalysis = analysis;
  store.updatedAt = analysis.fetchedAt || new Date().toISOString();
  writeStore(store);
  return bucket.lastAnalysis;
}

module.exports = {
  STORE_FILE,
  articleKey,
  ensureStoreFile,
  loadArticleSnapshot,
  saveArticleSnapshot,
  loadLastAnalysis,
  saveLastAnalysis,
};
