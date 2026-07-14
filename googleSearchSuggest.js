const config = require('./weeklyReportConfig');
const { getSuggestSeeds } = require('./categoryRegistry');

const SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';

async function fetchSuggestQueries(query) {
  const url = new URL(SUGGEST_URL);
  url.searchParams.set('client', 'firefox');
  url.searchParams.set('hl', 'ja');
  url.searchParams.set('q', query);

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; articleappNode/1.0)',
      Accept: 'application/json,text/plain,*/*',
    },
  });

  if (!res.ok) {
    throw new Error(`Google Suggest HTTP ${res.status}`);
  }

  const text = await res.text();
  const data = JSON.parse(text);
  const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
  return suggestions.map((s) => String(s || '').trim()).filter(Boolean);
}

function scoreSuggestions(scored, query, weight) {
  query = String(query || '').trim().toLowerCase();
  if (!query) return;
  const existing = scored.get(query);
  if (existing) {
    existing.score += weight;
    return;
  }
  scored.set(query, { query, score: weight });
}

/**
 * カテゴリ名をベースに Google サジェストから TOP N を取得
 */
async function fetchGoogleSuggestTop10(keyword, options = {}) {
  const cfg = config.googleSuggest || {};
  const topN = options.topN ?? cfg.topN ?? 10;
  const seeds = options.seeds ?? getSuggestSeeds(keyword);
  const base = String(keyword || config.defaultCategory).trim();
  const scored = new Map();

  const queries = [base, ...seeds.map((s) => `${base} ${s}`.trim())];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    try {
      const suggestions = await fetchSuggestQueries(q);
      suggestions.forEach((s, idx) => {
        const normalized = s.toLowerCase();
        if (normalized === base.toLowerCase()) return;
        const positionWeight = Math.max(1, 10 - idx);
        const seedWeight = i === 0 ? 2 : 1;
        scoreSuggestions(scored, s, positionWeight * seedWeight);
      });
    } catch (err) {
      console.warn('⚠️ Google Suggest fetch failed for:', q, err.message);
    }
  }

  const items = [...scored.values()]
    .sort((a, b) => b.score - a.score || a.query.localeCompare(b.query, 'ja'))
    .slice(0, topN)
    .map((entry, idx) => ({
      rank: idx + 1,
      query: entry.query,
      score: entry.score,
    }));

  return {
    keyword: base,
    fetchedAt: new Date().toISOString(),
    items,
    source: 'google-suggest',
    error: items.length ? null : 'サジェストを取得できませんでした',
  };
}

module.exports = {
  fetchGoogleSuggestTop10,
  fetchSuggestQueries,
};
