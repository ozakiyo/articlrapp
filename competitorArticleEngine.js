/**
 * 競合記事の取得・見出し抽出・自社記事との比較
 */
const cheerio = require('cheerio');
const { loadSavedCompetitorArticles } = require('./competitorArticlesStore');

const NOISE_HEADING =
  /^(目次|関連記事|おすすめ|人気記事|カテゴリ|シェア|breadcrumb|パンくず|footer|header)$/i;

function normalizeHeadingText(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[　·・｜|/／]/g, '')
    .toLowerCase();
}

function extractHeadingsFromHtml(html) {
  const $ = cheerio.load(String(html || ''));
  const rootSelectors = [
    'article',
    'main',
    '[role="main"]',
    '#contents',
    '#content',
    '.contents',
    '.article-body',
    '.entry-content',
    'body',
  ];
  let $root = $('body');
  for (const sel of rootSelectors) {
    const $found = $(sel).first();
    if ($found.length && $found.find('h2, h3').length >= 1) {
      $root = $found;
      break;
    }
  }

  const headings = [];
  const seen = new Set();
  $root.find('h1, h2, h3').each((_, el) => {
    const level = String(el.tagName || '').toLowerCase();
    if (!['h1', 'h2', 'h3'].includes(level)) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2 || text.length > 120) return;
    if (NOISE_HEADING.test(text)) return;
    const norm = normalizeHeadingText(text);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    headings.push({ level, text });
  });
  return headings;
}

function collectOwnHeadings(articleMaster) {
  const headings = [];
  const seen = new Set();

  const push = (level, text, source = '自社') => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    const norm = normalizeHeadingText(t);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    headings.push({ level, text: t, source });
  };

  if (articleMaster?.hubPage?.title) {
    push('h1', articleMaster.hubPage.title);
  }
  for (const m of articleMaster?.menuHeadings || []) {
    push('h2', m.label);
  }
  for (const s of articleMaster?.sections || articleMaster?.articles || []) {
    if (s.title) push('h2', s.title);
    for (const sub of s.subsections || s.headings || []) {
      const label = typeof sub === 'string' ? sub : sub?.title || sub?.label;
      if (label) push('h3', label);
    }
  }
  return headings;
}

function headingMatchesOwn(headingText, ownHeadings) {
  const norm = normalizeHeadingText(headingText);
  if (!norm || norm.length < 3) return true;
  return ownHeadings.some((own) => {
    const on = normalizeHeadingText(own.text);
    if (!on) return false;
    if (on === norm) return true;
    if (on.includes(norm) || norm.includes(on)) return true;
    const minLen = Math.min(on.length, norm.length);
    if (minLen >= 6 && on.slice(0, minLen) === norm.slice(0, minLen)) return true;
    return false;
  });
}

async function fetchCompetitorArticlePage(url, deps = {}) {
  const { fetchHtmlWithHttpClient, scrapeText } = deps;
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    throw new Error('URL が空です。');
  }

  if (fetchHtmlWithHttpClient) {
    try {
      const html = await fetchHtmlWithHttpClient(normalizedUrl);
      const headings = extractHeadingsFromHtml(html);
      if (headings.length > 0) {
        return { url: normalizedUrl, headings, fetchMethod: 'html' };
      }
    } catch (err) {
      if (!scrapeText) throw err;
    }
  }

  if (scrapeText) {
    const text = await scrapeText(normalizedUrl);
    const pseudoHtml = `<body><pre>${text}</pre></body>`;
    const headings = extractHeadingsFromHtml(pseudoHtml);
    return { url: normalizedUrl, headings, fetchMethod: 'scrape-text', pageText: text };
  }

  throw new Error('記事ページを取得できませんでした。');
}

function buildGapProposals(competitors, ownHeadings) {
  const proposals = [];
  const proposalSeen = new Set();

  for (const comp of competitors) {
    if (!comp.headings?.length) continue;
    for (const h of comp.headings) {
      if (h.level === 'h1') continue;
      if (headingMatchesOwn(h.text, ownHeadings)) continue;
      const norm = normalizeHeadingText(h.text);
      if (proposalSeen.has(norm)) continue;
      proposalSeen.add(norm);
      proposals.push({
        site: comp.site,
        sourceUrl: comp.url,
        level: h.level,
        heading: h.text,
        reason:
          h.level === 'h2'
            ? '競合の主要見出し。自社柱記事に未掲載のテーマ'
            : '競合の小見出し。自社にない切り口の可能性',
        priority: h.level === 'h2' ? 'high' : 'medium',
      });
    }
  }

  const priorityOrder = { high: 0, medium: 1 };
  return proposals.sort(
    (a, b) =>
      (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9) ||
      a.heading.localeCompare(b.heading, 'ja')
  );
}

/**
 * @param {string} category
 * @param {{ articles?: object[], articleMaster?: object }} options
 * @param {{ fetchHtmlWithHttpClient?: Function, scrapeText?: Function, loadArticleMaster?: Function }} deps
 */
async function analyzeCompetitorArticles(category, options = {}, deps = {}) {
  const label = String(category || '').trim();
  if (!label) {
    throw new Error('カテゴリを指定してください。');
  }

  const saved = loadSavedCompetitorArticles(label);
  const articles = options.articles?.length
    ? options.articles
    : saved?.articles || [];
  if (!articles.length) {
    throw new Error(
      '競合記事 URL が未登録です。競合調査タブで記事 URL を保存してください。'
    );
  }

  const articleMaster =
    options.articleMaster ||
    (deps.loadArticleMaster ? deps.loadArticleMaster(label) : { category: label });
  const ownHeadings = collectOwnHeadings(articleMaster);

  const competitors = [];
  const warnings = [];

  for (const article of articles) {
    const site = article.site || '競合';
    const url = article.url;
    try {
      const page = await fetchCompetitorArticlePage(url, deps);
      const headings = page.headings || [];
      const gaps = headings
        .filter((h) => h.level !== 'h1')
        .filter((h) => !headingMatchesOwn(h.text, ownHeadings))
        .map((h) => ({ level: h.level, text: h.text }));

      competitors.push({
        id: article.id,
        site,
        title: article.title || site,
        url,
        fetchMethod: page.fetchMethod,
        headingCount: headings.length,
        headings,
        gaps,
        gapCount: gaps.length,
      });
    } catch (err) {
      warnings.push({ site, url, message: err.message });
      competitors.push({
        id: article.id,
        site,
        title: article.title || site,
        url,
        fetchMethod: null,
        headingCount: 0,
        headings: [],
        gaps: [],
        gapCount: 0,
        error: err.message,
      });
    }
  }

  const proposals = buildGapProposals(competitors, ownHeadings);
  const successCount = competitors.filter((c) => c.headingCount > 0).length;

  return {
    category: label,
    fetchedAt: new Date().toISOString(),
    hubUrl: articleMaster?.hubPage?.url || saved?.hubUrl || null,
    ownHeadingCount: ownHeadings.length,
    ownHeadings,
    competitors,
    proposals,
    summary: {
      competitorCount: competitors.length,
      successCount,
      proposalCount: proposals.length,
      highPriorityCount: proposals.filter((p) => p.priority === 'high').length,
    },
    warnings,
    savedAt: saved?.savedAt || null,
  };
}

module.exports = {
  extractHeadingsFromHtml,
  collectOwnHeadings,
  headingMatchesOwn,
  fetchCompetitorArticlePage,
  analyzeCompetitorArticles,
};
