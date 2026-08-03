'use strict';

/**
 * SEO上位に出やすい家電量販店・比較メディアの「記事ページ」URLを自動発見する。
 * 優先: DuckDuckGo HTML検索 →（不足時）Gemini 補完
 */

const cheerio = require('cheerio');
const { parseJsonFromModelOutput } = require('./parseModelJson');

const MAX_RESULTS = 3;

/** 他社として使うドメイン（自社 kojima は除外） */
const RETAILER_SITES = [
  {
    id: 'biccamera',
    site: 'ビックカメラ',
    hosts: ['biccamera.com', 'www.biccamera.com'],
  },
  {
    id: 'yodobashi',
    site: 'ヨドバシ',
    hosts: ['yodobashi.com', 'www.yodobashi.com'],
  },
  {
    id: 'kakaku',
    site: '価格.com',
    hosts: ['kakaku.com', 'www.kakaku.com'],
  },
  {
    id: 'yamada',
    site: 'ヤマダ電機',
    hosts: [
      'yamada-denki.com',
      'www.yamada-denki.com',
      'yamada-denkiweb.com',
      'www.yamada-denkiweb.com',
      'yamada.co.jp',
      'www.yamada.co.jp',
    ],
  },
  {
    id: 'edion',
    site: 'エディオン',
    hosts: ['edion.com', 'www.edion.com', 'edion.co.jp', 'www.edion.co.jp'],
  },
  {
    id: 'joshin',
    site: 'ジョーシン',
    hosts: ['joshin.co.jp', 'www.joshin.co.jp', 'joshinweb.jp', 'www.joshinweb.jp'],
  },
  {
    id: 'nojima',
    site: 'ノジマ',
    hosts: ['nojima.co.jp', 'www.nojima.co.jp'],
  },
];

const ARTICLE_PATH_HINTS =
  /\/(topics|feature|special|guide|magazine|article|column|reading|howto|select|lab|media|kaden\/|bc\/i\/)/i;

const REJECT_PATH_HINTS =
  /\/(cart|login|member|search\?|prod_detail|item\/|product\/|sku|ranking\.html|category_list)/i;

function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  try {
    const parsed = new URL(u);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|yclid|gclid|fbclid|ref$|lid$)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function matchRetailerSite(url) {
  const host = hostOf(url);
  if (!host) return null;
  return (
    RETAILER_SITES.find((s) =>
      s.hosts.some((h) => {
        const nh = h.replace(/^www\./i, '').toLowerCase();
        return host === nh || host.endsWith(`.${nh}`);
      })
    ) || null
  );
}

function isLikelyArticlePage(url) {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    if (REJECT_PATH_HINTS.test(path)) return false;
    if (ARTICLE_PATH_HINTS.test(path)) return true;
    // パスが深い or guide_ など記事っぽいもの
    if (/guide_\d+/i.test(path)) return true;
    if ((u.pathname.match(/\//g) || []).length >= 3) return true;
    return u.pathname.length > 12;
  } catch {
    return false;
  }
}

function buildSearchQueries(keyword) {
  const k = String(keyword || '').trim();
  if (!k) return [];
  return [
    `${k} 選び方`,
    `${k} おすすめ`,
    `${k} ランキング 特集`,
  ];
}

function extractDuckDuckGoUrls(html) {
  const $ = cheerio.load(String(html || ''));
  const urls = [];
  const seen = new Set();

  $('a.result__a').each((_, el) => {
    const href = $(el).attr('href') || '';
    let target = '';
    try {
      if (href.includes('uddg=')) {
        const abs = href.startsWith('http')
          ? href
          : `https://duckduckgo.com${href.startsWith('/') ? '' : '/'}${href}`;
        const u = new URL(abs);
        target = decodeURIComponent(u.searchParams.get('uddg') || '');
      } else if (/^https?:\/\//i.test(href)) {
        target = href;
      }
    } catch {
      target = '';
    }
    const normalized = normalizeUrl(target);
    if (!normalized || seen.has(normalized)) return;
    // 広告・DuckDuckGo 自身を除外
    const h = hostOf(normalized);
    if (!h || h.includes('duckduckgo') || h.includes('bing.com')) return;
    seen.add(normalized);
    urls.push(normalized);
  });

  // fallback: raw uddg=
  if (!urls.length) {
    const re = /uddg=(https?%3A%2F%2F[^&"']+)/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      try {
        const normalized = normalizeUrl(decodeURIComponent(m[1]));
        if (!normalized || seen.has(normalized)) continue;
        const h = hostOf(normalized);
        if (!h || h.includes('duckduckgo') || h.includes('bing.com')) continue;
        seen.add(normalized);
        urls.push(normalized);
      } catch {
        /* ignore */
      }
    }
  }

  return urls;
}

async function searchDuckDuckGo(query, fetchHtml) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  console.log('🔎 [SERP] DuckDuckGo:', query);
  const html = await fetchHtml(url);
  return extractDuckDuckGoUrls(html);
}

function scoreCandidate(url, queryIndex) {
  let score = 100 - queryIndex * 10;
  if (ARTICLE_PATH_HINTS.test(url)) score += 30;
  if (/選び|おすすめ|ランキング|特集|guide/i.test(url)) score += 10;
  if (REJECT_PATH_HINTS.test(url)) score -= 50;
  return score;
}

function pickTopRetailerArticles(rawUrls, { limit = MAX_RESULTS } = {}) {
  const scored = [];
  for (let i = 0; i < rawUrls.length; i++) {
    const url = normalizeUrl(rawUrls[i].url || rawUrls[i]);
    if (!url) continue;
    const site = matchRetailerSite(url);
    if (!site) continue;
    if (!isLikelyArticlePage(url)) continue;
    scored.push({
      url,
      site: site.site,
      siteId: site.id,
      source: rawUrls[i].source || 'serp',
      query: rawUrls[i].query || '',
      score: scoreCandidate(url, rawUrls[i].queryIndex ?? 0) + (rawUrls[i].bonus || 0),
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const out = [];
  const usedSites = new Set();
  const usedUrls = new Set();
  for (const item of scored) {
    if (usedUrls.has(item.url) || usedSites.has(item.siteId)) continue;
    usedUrls.add(item.url);
    usedSites.add(item.siteId);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

async function discoverWithGemini(keyword, getGeminiModel) {
  if (!getGeminiModel) return [];
  const sites = RETAILER_SITES.map((s) => `- ${s.site}: ${s.hosts[0]}`).join('\n');
  const prompt = `
キーワード「${keyword}」について、日本の Google 検索で上位に出やすい「家電量販店・価格比較メディアの特集／選び方記事ページ」のURLを最大5件、JSONのみで返してください。

# 対象サイト（これ以外は不可）
${sites}

# 条件
- 商品詳細・カート・カテゴリ一覧・売れ筋ランキング一覧ではなく、選び方／おすすめ／特集の記事ページ
- 実在しそうな公開URL（推測で架空ドメインは不可）
- コジマネット（kojima.net）は含めない（他社のみ）

# 出力
{"articles":[{"site":"ビックカメラ","url":"https://..."},{"site":"ヨドバシ","url":"https://..."}]}
`;

  try {
    const model = await getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const raw = result.response?.text?.() || '';
    const data = parseJsonFromModelOutput(raw);
    const list = Array.isArray(data?.articles) ? data.articles : [];
    return list
      .map((a) => ({
        url: normalizeUrl(a?.url),
        source: 'gemini',
        bonus: 5,
        queryIndex: 9,
      }))
      .filter((a) => a.url);
  } catch (err) {
    console.warn('⚠️ Gemini retailer article discovery failed:', err.message);
    return [];
  }
}

/**
 * @param {string} keyword
 * @param {{ fetchHtml?: Function, getGeminiModel?: Function, limit?: number }} [deps]
 * @returns {Promise<{ keyword: string, articles: Array<{url,site,siteId,source}>, queries: string[], notes: string[] }>}
 */
async function discoverRetailerArticleUrls(keyword, deps = {}) {
  const trimmed = String(keyword || '').trim();
  const limit = deps.limit || MAX_RESULTS;
  const notes = [];
  const queries = buildSearchQueries(trimmed);
  const collected = [];

  if (!trimmed) {
    return { keyword: '', articles: [], queries: [], notes: ['キーワードが空です'] };
  }

  if (typeof deps.fetchHtml === 'function') {
    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      try {
        const urls = await searchDuckDuckGo(q, deps.fetchHtml);
        notes.push(`検索「${q}」: ${urls.length} 件ヒット`);
        urls.forEach((url) => {
          collected.push({ url, source: 'duckduckgo', query: q, queryIndex: qi });
        });
      } catch (err) {
        notes.push(`検索「${q}」失敗: ${err.message}`);
        console.warn('⚠️ DuckDuckGo search failed:', q, err.message);
      }
    }
  } else {
    notes.push('fetchHtml 未設定のため検索をスキップし、Gemini のみ試行します。');
  }

  let articles = pickTopRetailerArticles(collected, { limit });

  if (articles.length < limit && deps.getGeminiModel) {
    const geminiHits = await discoverWithGemini(trimmed, deps.getGeminiModel);
    if (geminiHits.length) {
      notes.push(`Gemini で ${geminiHits.length} 件の候補を補完`);
      articles = pickTopRetailerArticles([...collected, ...geminiHits], { limit });
    }
  }

  if (!articles.length) {
    notes.push('家電量販店の記事URLを見つかりませんでした。手入力してください。');
  } else {
    notes.push(
      `自動取得 ${articles.length} 件: ${articles.map((a) => a.site).join(' / ')}`
    );
  }

  return {
    keyword: trimmed,
    articles: articles.map(({ url, site, siteId, source, query }) => ({
      url,
      site,
      siteId,
      source,
      query,
    })),
    queries,
    notes,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = {
  discoverRetailerArticleUrls,
  RETAILER_SITES,
  matchRetailerSite,
  isLikelyArticlePage,
  extractDuckDuckGoUrls,
  pickTopRetailerArticles,
  normalizeUrl,
};
