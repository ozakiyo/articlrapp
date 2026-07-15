/**
 * カテゴリ指定で Amazon・楽天・Yahoo!・ビックカメラとコジマネットの
 * ランキング TOP15 を取得し、CSV へ出力する。
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const { loadSavedRankingUrls } = require('./rankingUrlStore');

const CSV_EXPORT_DIR = path.join(__dirname, 'exports', 'rankings');

const CATEGORY_RANKING_TOP = Math.min(
  Math.max(Number(process.env.CATEGORY_RANKING_TOP) || 15, 1),
  50
);

/** テーマ別ランキングの1テーマあたり最大件数（記事は1〜3位、予備まで出力） */
const THEME_RANKING_TOP = Math.min(
  Math.max(Number(process.env.THEME_RANKING_TOP) || 5, 1),
  10
);

/** ランキング分析から見出し候補に使う機能・切り口の最大件数 */
const USER_FEATURE_PICK_MAX = Math.min(
  Math.max(Number(process.env.USER_FEATURE_PICK_MAX) || 5, 1),
  10
);

const MALL_SOURCES = [
  { id: 'amazon', label: 'Amazon', type: 'mall' },
  { id: 'rakuten', label: '楽天', type: 'mall' },
  { id: 'yahoo', label: 'Yahoo!', type: 'mall' },
  { id: 'bic', label: 'ビックカメラ', type: 'mall' },
];

const RANKING_SOURCE_KEYS = ['amazon', 'rakuten', 'yahoo', 'kojima', 'bic'];

const KOJIMA_NET_SOURCE = {
  id: 'kojima',
  label: 'コジマネット',
  type: 'kojima_net',
  defaultRankingUrl(category) {
    const q = encodeURIComponent(String(category || '').trim());
    return `https://www.kojima.net/ec/ranking.html?keyword=${q}`;
  },
};

const BIC_CAMERA_SOURCE = {
  id: 'bic',
  label: 'ビックカメラ',
  type: 'mall',
  defaultRankingUrl() {
    return 'https://www.biccamera.com/bc/c/contents/ranking/index.jsp';
  },
};

/** 記事用ランキング: カテゴリ別テーマプリセット（テーマ1固定・2・3はユーザー選択） */
const RANKING_THEME_PRESETS_BY_CATEGORY = {
  窓用エアコン: [
    {
      id: 'overall',
      label: '総合おすすめ',
      title: '窓用エアコン 総合おすすめ',
      keywords: [],
      excludeKeywords: [],
      minSiteCount: 2,
      defaultOrder: 1,
    },
    {
      id: 'cooling_only',
      label: '冷房専用・ノンドレン',
      title: '冷房専用・ノンドレンがおすすめ',
      keywords: ['冷房専用'],
      excludeKeywords: ['冷暖房', '暖房兼用', 'オートドレン'],
      defaultOrder: 2,
    },
    {
      id: 'heat_cool',
      label: '冷暖房兼用',
      title: '冷暖房兼用の窓用エアコン',
      keywords: ['冷暖房', '暖房兼用', '冷房・暖房', '冷房･暖房', 'cwh-a'],
      excludeKeywords: ['冷房専用'],
      defaultOrder: 3,
    },
    {
      id: 'tatami_4_6',
      label: '4〜6畳向け',
      title: '4〜6畳向け 窓用エアコン',
      keywords: ['4〜6', '4～6', '4-6畳', '4〜6畳'],
      excludeKeywords: ['冷暖房', '7〜8', '7～8'],
      defaultOrder: 4,
    },
    {
      id: 'tatami_6_7',
      label: '6〜7畳向け',
      title: '6〜7畳向け 窓用エアコン',
      keywords: ['6〜7', '6～7', '6-7畳', '6〜7畳'],
      excludeKeywords: [],
      defaultOrder: 5,
    },
    {
      id: 'tatami_7_8',
      label: '7〜8畳向け',
      title: '7〜8畳向け 窓用エアコン',
      keywords: ['7〜8畳', '7～8畳', '7〜8', '7～8', '7-8畳'],
      excludeKeywords: ['4.5〜8', '4.5～8', '5～8', '5〜8'],
      defaultOrder: 6,
    },
    {
      id: 'easy_install',
      label: '工事不要・設置簡単',
      title: '工事不要で設置しやすい窓用エアコン',
      keywords: ['工事不要', 'ノンドレン'],
      excludeKeywords: ['部材', 'リモコン', '延長枠'],
      defaultOrder: 7,
    },
  ],
};

const RANKING_THEME_PRESETS_DEFAULT = [
  {
    id: 'overall',
    label: '総合おすすめ',
    title: '総合おすすめ',
    keywords: [],
    excludeKeywords: [],
    minSiteCount: 2,
    defaultOrder: 1,
  },
  {
    id: 'value',
    label: 'コスパ・人気',
    title: '人気・掲載多数',
    keywords: [],
    excludeKeywords: [],
    minSiteCount: 2,
    defaultOrder: 2,
  },
  {
    id: 'compact',
    label: '小型・省スペース',
    title: '小型・省スペース向け',
    keywords: ['コンパクト', '小型', '省スペース'],
    excludeKeywords: [],
    defaultOrder: 3,
  },
  {
    id: 'premium',
    label: '高性能・上位機種',
    title: '高性能モデル',
    keywords: ['上位', 'ハイグレード', 'プレミアム'],
    excludeKeywords: [],
    defaultOrder: 4,
  },
];

/**
 * カテゴリ名に対応する公式ランキング URL（わかっているものだけ登録）
 * 未登録カテゴリは buildDefaultRankingUrls の検索 URL にフォールバック
 */
const KNOWN_CATEGORY_RANKING_URLS = {
  窓用エアコン: {
    amazon:
      'https://www.amazon.co.jp/gp/bestsellers/kitchen/84824051/ref=zg_bs_nav_kitchen_4_84823051',
    kojima: 'https://www.kojima.net/ec/ranking.html?cate=window_air_conditioner',
    // 楽天: ルームエアコン（565123）× 設置場所:窓（tags=1004945）
    rakuten:
      'https://ranking.rakuten.co.jp/daily/565123/tags=1004945/?l2-id=Ranking_PC_daily-565123_1000350_1004945',
    // Yahoo! 窓用エアコン（cid=26311）カテゴリランキング
    yahoo:
      'https://shopping.yahoo.co.jp/searchranking?p=%E7%AA%93%E7%94%A8%E3%82%A8%E3%82%A2%E3%82%B3%E3%83%B3&cid=26311&rcid=26311&rterm=default&rmore=1&prom=1',
  },
  スポットクーラー: {
    // Amazon: Portable Air Conditioners / スポットクーラー
    amazon: 'https://www.amazon.co.jp/gp/bestsellers/kitchen/2354281051',
    // 楽天: スポットエアコン
    rakuten: 'https://ranking.rakuten.co.jp/daily/565124/',
    // Yahoo! スポットクーラー（cid は自動発見結果を固定）
    yahoo:
      'https://shopping.yahoo.co.jp/searchranking?p=%E3%82%B9%E3%83%9D%E3%83%83%E3%83%88%E3%82%AF%E3%83%BC%E3%83%A9%E3%83%BC&cid=26309&rcid=26309&rterm=default&rmore=1&prom=1',
    // コジマ: 冷風機・冷風扇（スポットクーラー含む）
    kojima: 'https://www.kojima.net/ec/ranking.html?cate=fan_circulator_010',
  },
};

/** 検索ベースのフォールバック URL */
function buildDefaultRankingUrls(category) {
  const q = encodeURIComponent(String(category || '').trim());
  return {
    amazon: `https://www.amazon.co.jp/s?k=${q}&s=exact-aware-popularity-rank`,
    rakuten: `https://search.rakuten.co.jp/search/mall/${q}/?s=4&sv=6`,
    yahoo: `https://shopping.yahoo.co.jp/search?p=${q}&X=2`,
    kojima: KOJIMA_NET_SOURCE.defaultRankingUrl(category),
    bic: BIC_CAMERA_SOURCE.defaultRankingUrl(),
  };
}

function normalizeCategoryKey(category) {
  return String(category || '').trim().replace(/\s+/g, '');
}

function getRankingThemePresets(category) {
  const key = normalizeCategoryKey(category);
  const list =
    RANKING_THEME_PRESETS_BY_CATEGORY[key] ||
    RANKING_THEME_PRESETS_BY_CATEGORY[String(category || '').trim()] ||
    RANKING_THEME_PRESETS_DEFAULT;
  return list
    .map((p) => ({ ...p }))
    .sort((a, b) => (a.defaultOrder || 99) - (b.defaultOrder || 99));
}

function presetToRankingTheme(preset) {
  return {
    id: preset.id,
    label: preset.label,
    title: preset.title,
    keywords: [...(preset.keywords || [])],
    excludeKeywords: [...(preset.excludeKeywords || [])],
    minSiteCount: preset.minSiteCount ?? 0,
  };
}

/**
 * テーマ1は総合おすすめ固定。テーマ2・3はユーザー選択を優先し、不足時は需要分析で補完
 * @param {object[]} [rankingThemesInput] クライアントからのテーマ指定（最大3件）
 */
function buildArticleRankingThemes(category, pickedFeatures, rankingThemesInput) {
  const presets = getRankingThemePresets(category);
  const byId = new Map(presets.map((p) => [p.id, p]));
  const overall = byId.get('overall') || presets[0];
  const themes = [];
  const usedIds = new Set();

  if (overall) {
    themes.push(presetToRankingTheme(overall));
    usedIds.add(overall.id);
  }

  const userThemes = normalizeRankingThemesInput(rankingThemesInput, category);
  for (const t of userThemes) {
    if (themes.length >= 3) break;
    const id = String(t?.id || '').trim();
    if (!id || id === 'overall' || usedIds.has(id)) continue;
    themes.push(t);
    usedIds.add(id);
  }

  for (const feat of pickedFeatures || []) {
    if (themes.length >= 3) break;
    const id = String(feat?.id || '').trim();
    if (!id || id === 'overall' || usedIds.has(id)) continue;
    const preset = byId.get(id);
    if (preset) {
      themes.push(presetToRankingTheme(preset));
      usedIds.add(id);
    }
  }

  for (const p of presets) {
    if (themes.length >= 3) break;
    if (usedIds.has(p.id)) continue;
    themes.push(presetToRankingTheme(p));
    usedIds.add(p.id);
  }

  return themes.slice(0, 3);
}

function getDefaultRankingThemeSelection(category) {
  const presets = getRankingThemePresets(category);
  const overall = presets.find((p) => p.id === 'overall') || presets[0];
  const secondary = presets.filter((p) => p.id !== 'overall').slice(0, 2);
  const out = [];
  if (overall) out.push(presetToRankingTheme(overall));
  for (const p of secondary) out.push(presetToRankingTheme(p));
  return out;
}

function hasUserSecondaryThemes(rankingThemesInput) {
  if (!Array.isArray(rankingThemesInput)) return false;
  const ids = rankingThemesInput
    .map((t) => String(t?.id || '').trim())
    .filter((id) => id && id !== 'overall');
  return new Set(ids).size >= 2;
}

function normalizeRankingThemesInput(themes, category) {
  const presets = getRankingThemePresets(category);
  const byId = new Map(presets.map((p) => [p.id, p]));
  const raw = Array.isArray(themes) ? themes : [];
  const out = [];

  for (const t of raw.slice(0, 3)) {
    const id = String(t?.id || '').trim();
    const preset = id ? byId.get(id) : null;
    if (preset) {
      out.push({
        id: preset.id,
        label: String(t?.label || preset.label).trim() || preset.label,
        title: String(t?.title || preset.title).trim() || preset.title,
        keywords: [...(preset.keywords || [])],
        excludeKeywords: [...(preset.excludeKeywords || [])],
        minSiteCount: preset.minSiteCount ?? 0,
      });
      continue;
    }
    const title = String(t?.title || t?.label || '').trim();
    if (!title) continue;
    const keywords = Array.isArray(t?.keywords)
      ? t.keywords.map((k) => String(k).trim()).filter(Boolean)
      : String(t?.keywords || '')
          .split(/[,、\s]+/)
          .map((k) => k.trim())
          .filter(Boolean);
    const excludeKeywords = Array.isArray(t?.excludeKeywords)
      ? t.excludeKeywords.map((k) => String(k).trim()).filter(Boolean)
      : String(t?.excludeKeywords || '')
          .split(/[,、\s]+/)
          .map((k) => k.trim())
          .filter(Boolean);
    out.push({
      id: id || `custom_${out.length + 1}`,
      label: String(t?.label || title).trim(),
      title,
      keywords,
      excludeKeywords,
      minSiteCount: Number(t?.minSiteCount) > 0 ? Number(t.minSiteCount) : 0,
    });
  }
  return out;
}

function buildYahooSearchRankingUrl(category, cid) {
  const q = encodeURIComponent(String(category || '').trim());
  // 新形式: /searchranking/{キーワード}/{cid}/ （クエリ形式の cid= は表示できない場合がある）
  if (cid) {
    const c = encodeURIComponent(String(cid));
    return `https://shopping.yahoo.co.jp/searchranking/${q}/${c}/?rmore=1&prom=1`;
  }
  return `https://shopping.yahoo.co.jp/searchranking?p=${q}&rmore=1&prom=1`;
}

/** ランキング TOP15 取得用（rmore=1 で一覧をまとめて読み込む） */
function ensureYahooRankingListUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || !/shopping\.yahoo\.co\.jp\/searchranking/i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (!u.searchParams.has('rmore')) u.searchParams.set('rmore', '1');
    if (!u.searchParams.has('prom')) u.searchParams.set('prom', '1');
    const cid = u.searchParams.get('cid');
    if (cid) {
      if (!u.searchParams.has('rcid')) u.searchParams.set('rcid', cid);
      if (!u.searchParams.has('rterm')) u.searchParams.set('rterm', 'default');
    }
    return u.toString();
  } catch {
    return raw.includes('rmore=') ? raw : `${raw}${raw.includes('?') ? '&' : '?'}rmore=1&prom=1`;
  }
}

function getYahooBffRankingHtml(pageHtml) {
  try {
    const $ = cheerio.load(String(pageHtml || ''));
    const nd = $('#__NEXT_DATA__').html();
    if (!nd) return '';
    const data = JSON.parse(nd);
    const items = data?.props?.initialState?.bff?.searchRanking?.items;
    if (!Array.isArray(items)) return '';
    return items.map((it) => String(it?.html || '')).join('');
  } catch {
    return '';
  }
}

/** 窓用エアコン等: キーワード別ランキングのノイズを除外 */
function isYahooRankingProductTitle(title, category) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 8) return false;
  // 店名の「Yahoo!店」は商品名に含まれるため除外しない（ロゴ用 alt のみ弾く）
  if (t.length < 30 && /^yahoo!?$/i.test(t)) return false;
  if (/yahoo\s*ショッピング|^ショッピング$/i.test(t)) return false;
  if (/logo|icon|最安値を見る/i.test(t)) return false;
  if (/防犯フィルム|窓ガラスフィルム|マジックミラー/i.test(t)) return false;
  if (/^スポットクーラー|スポットクーラー\s|ポータブルクーラー|コンパクトエアコン/i.test(t)) {
    if (!/JA-W|CW-|CWH-|窓用ルーム|リララ.*窓用/i.test(t)) return false;
  }
  if (
    /延長枠|取付枠|テラス窓用タイプ|部材.*窓枠|WMA-1/i.test(t) &&
    !/冷房|冷暖/i.test(t)
  ) {
    return false;
  }
  const cat = String(category || '').trim();
  if (!cat) return true;
  return titleMatchesCategory(t, cat);
}

function extractYahooRankingRowsFromBff(pageHtml, limit = CATEGORY_RANKING_TOP, category = '') {
  const embedded = getYahooBffRankingHtml(pageHtml);
  if (!embedded) return [];

  const $ = cheerio.load(embedded);
  const candidates = [];
  const seenHref = new Set();

  $('div.line').each((_, line) => {
    const $line = $(line);
    const title =
      $line.find('img[alt]').first().attr('alt')?.replace(/\s+/g, ' ').trim() ||
      $line.find('[class*="title"]').first().text().replace(/\s+/g, ' ').trim() ||
      '';
    if (!isYahooRankingProductTitle(title, category)) return;

    let href = '';
    $line.find('a[href]').each((_, a) => {
      const h = String($(a).attr('href') || '').trim();
      if (/store\.shopping\.yahoo\.co\.jp|shopping\.yahoo\.co\.jp\/products\//i.test(h)) {
        href = h.split('?')[0];
        return false;
      }
    });
    if (!href) return;
    if (seenHref.has(href)) return;
    seenHref.add(href);
    candidates.push({ title, href });
  });

  if (candidates.length < limit) {
    extractYahooRankingRowsFromRankingFlag(embedded, limit, category).forEach((row) => {
      if (candidates.length >= limit) return;
      if (!row.href || seenHref.has(row.href)) return;
      seenHref.add(row.href);
      candidates.push({ title: row.model, href: row.href });
    });
  }

  return candidates.slice(0, limit).map((item, idx) =>
    normalizeRow(
      {
        title: item.title,
        href: item.href,
        manufacturer: findManufacturerInBlock(item.title),
      },
      idx + 1
    )
  );
}

function extractYahooRankingRowsFromRankingFlag(html, limit, category) {
  const $ = cheerio.load(String(html || ''));
  const rows = [];
  const anchor = html.indexOf('CW-1626') > 0 ? html.indexOf('CW-1626') : 0;
  const slice = anchor > 0 ? html.slice(Math.max(0, anchor - 3000), anchor + 90000) : html;

  const $slice = cheerio.load(slice);
  $slice('[class*="RankingFlag"]').each((_, flag) => {
    const $flag = $slice(flag);
    let rank = null;
    const cls = $flag.attr('class') || '';
    if (cls.includes('rank1')) rank = 1;
    else if (cls.includes('rank2')) rank = 2;
    else if (cls.includes('rank3')) rank = 3;
    else {
      const t = $flag.find('[class*="__text"]').text().replace(/\s+/g, '').trim();
      const m = t.match(/^(\d{1,2})$/);
      if (m) rank = parseInt(m[1], 10);
    }
    if (!rank || rank > limit || rows.some((x) => x.rank === rank)) return;

    let $item = $flag.parent();
    for (let i = 0; i < 15; i++) {
      const alt = $item.find('img[alt]').first().attr('alt')?.replace(/\s+/g, ' ').trim();
      if (alt && isYahooRankingProductTitle(alt, category)) {
        let href = '';
        $item.find('a[href]').each((_, a) => {
          const h = $slice(a).attr('href') || '';
          if (/store\.shopping\.yahoo\.co\.jp|\/products\//.test(h)) {
            href = h.split('?')[0];
            return false;
          }
        });
        rows.push(
          normalizeRow({ title: alt, href, manufacturer: findManufacturerInBlock(alt) }, rank)
        );
        break;
      }
      $item = $item.parent();
    }
  });

  return rows.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

/** Yahoo: キーワードランキングページから cid を推定 */
async function discoverYahooRankingUrl(category, fetchHtmlWithHttpClient) {
  const trimmed = String(category || '').trim();
  const base = buildYahooSearchRankingUrl(trimmed);
  const html = await fetchHtmlWithHttpClient(base);
  const cidCounts = new Map();
  const cidPatterns = [
    /[?&]cid=(\d+)/g,
    /"cid"\s*:\s*"?(\d+)"?/g,
    /searchranking\?[^"']*cid=(\d+)/g,
  ];
  for (const re of cidPatterns) {
    for (const m of String(html).matchAll(re)) {
      const cid = m[1];
      if (cid === '0' || cid === '1') continue;
      cidCounts.set(cid, (cidCounts.get(cid) || 0) + 1);
    }
  }
  let bestCid = null;
  let bestCount = 0;
  for (const [cid, count] of cidCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestCid = cid;
    }
  }
  if (!bestCid) {
    const first = [...String(html).matchAll(/cid=(\d+)/g)].find(
      (m) => m[1] !== '0' && m[1] !== '1'
    );
    bestCid = first?.[1] || null;
  }
  return buildYahooSearchRankingUrl(trimmed, bestCid);
}

function discoverKojimaRankingUrl(category) {
  const trimmed = String(category || '').trim();
  const known = KNOWN_CATEGORY_RANKING_URLS[normalizeCategoryKey(trimmed)];
  if (known?.kojima) return known.kojima;
  if (/窓/.test(trimmed) && /エアコン/.test(trimmed)) {
    return 'https://www.kojima.net/ec/ranking.html?cate=window_air_conditioner';
  }
  if (/スポット/.test(trimmed) && /クーラー|エアコン/.test(trimmed)) {
    return 'https://www.kojima.net/ec/ranking.html?cate=fan_circulator_010';
  }
  return KOJIMA_NET_SOURCE.defaultRankingUrl(trimmed);
}

function discoverAmazonRankingUrl(category) {
  const trimmed = String(category || '').trim();
  const known = KNOWN_CATEGORY_RANKING_URLS[normalizeCategoryKey(trimmed)];
  if (known?.amazon) return known.amazon;
  if (/窓/.test(trimmed) && /エアコン/.test(trimmed)) {
    return (
      KNOWN_CATEGORY_RANKING_URLS['窓用エアコン']?.amazon ||
      buildDefaultRankingUrls(trimmed).amazon
    );
  }
  if (/スポット/.test(trimmed) && /クーラー|エアコン/.test(trimmed)) {
    return (
      KNOWN_CATEGORY_RANKING_URLS['スポットクーラー']?.amazon ||
      buildDefaultRankingUrls(trimmed).amazon
    );
  }
  return buildDefaultRankingUrls(trimmed).amazon;
}

/** 楽天: ルームエアコンジャンルから「窓」タグなどを推定 */
async function discoverRakutenRankingUrl(category, fetchHtmlWithHttpClient) {
  const trimmed = String(category || '').trim();
  const known = KNOWN_CATEGORY_RANKING_URLS[normalizeCategoryKey(trimmed)];
  if (known?.rakuten) return known.rakuten;

  if (/エアコン/.test(trimmed) && /窓/.test(trimmed)) {
    try {
      const html = await fetchHtmlWithHttpClient('https://ranking.rakuten.co.jp/daily/565123/');
      const $ = cheerio.load(html);
      const href = $('a[href*="tags=1004945"]').first().attr('href');
      if (href) {
        if (/^https?:\/\//i.test(href)) return href;
        return `https://ranking.rakuten.co.jp${href.startsWith('/') ? href : `/${href}`}`;
      }
    } catch (err) {
      console.warn('⚠️ Rakuten tag discovery failed:', err.message);
    }
  }
  return buildDefaultRankingUrls(trimmed).rakuten;
}

function normalizeMallRankingUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  return u;
}

function isValidMallRankingUrl(mallId, url) {
  const u = normalizeMallRankingUrl(url);
  if (!u) return false;
  if (mallId === 'amazon') return /amazon\.co\.jp/i.test(u);
  if (mallId === 'rakuten') return /ranking\.rakuten\.co\.jp|search\.rakuten\.co\.jp/i.test(u);
  if (mallId === 'yahoo') return /shopping\.yahoo\.co\.jp/i.test(u);
  if (mallId === 'kojima') return /kojima\.net\/ec\/ranking/i.test(u);
  if (mallId === 'bic') {
    return (
      /biccamera\.com\/bc\/(?:ranking|c\/contents\/ranking)/i.test(u) ||
      /houjin\.biccamera\.com\/ranking\/list\.aspx/i.test(u)
    );
  }
  return false;
}

function applyManualRankingUrls(defaults, manualUrls) {
  const out = { ...defaults };
  if (!manualUrls || typeof manualUrls !== 'object') return out;
  for (const key of RANKING_SOURCE_KEYS) {
    const v = normalizeMallRankingUrl(manualUrls[key]);
    if (v) out[key] = v;
  }
  return out;
}

function hasProvidedRankingUrls(manualUrls) {
  if (!manualUrls || typeof manualUrls !== 'object') return false;
  return RANKING_SOURCE_KEYS.some((k) =>
    Boolean(normalizeMallRankingUrl(manualUrls[k]))
  );
}

async function discoverRankingUrlsWithGemini(category, deps) {
  const { getGeminiModel, parseJsonFromModelOutput } = deps;
  if (!getGeminiModel || !parseJsonFromModelOutput) return null;

  const prompt = `
キーワード「${category}」について、日本のEC各モールの「売れ筋・人気ランキングの一覧ページ」URLを調べ、JSON だけ返してください。
商品検索結果ページではなく、ランキング一覧ページを優先してください。

# 各サイトの形式（わからない項目は空文字 ""）
- amazon: https://www.amazon.co.jp/gp/bestsellers/... （ベストセラー）
- rakuten: https://ranking.rakuten.co.jp/daily/数字/ （tags= 付き可）
- yahoo: https://shopping.yahoo.co.jp/searchranking?p=...&cid=...
- kojima: https://www.kojima.net/ec/ranking.html?cate=... または ?keyword=...
- bic: https://www.biccamera.com/bc/ranking/... （人気売れ筋ランキング）

# 出力（JSON のみ・説明不要）
{"amazon":"","rakuten":"","yahoo":"","kojima":"","bic":""}
`;

  try {
    const model = await getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const raw = result.response?.text?.() || '';
    const data = parseJsonFromModelOutput(raw);
    if (!data || typeof data !== 'object') return null;
    const out = {
      amazon: normalizeMallRankingUrl(data.amazon),
      rakuten: normalizeMallRankingUrl(data.rakuten),
      yahoo: normalizeMallRankingUrl(data.yahoo),
      kojima: normalizeMallRankingUrl(data.kojima),
      bic: normalizeMallRankingUrl(data.bic),
    };
    for (const key of Object.keys(out)) {
      if (out[key] && !isValidMallRankingUrl(key, out[key])) {
        console.warn(`⚠️ Gemini URL rejected for ${key}:`, out[key]);
        out[key] = '';
      }
    }
    return out;
  } catch (err) {
    console.warn('⚠️ Gemini ranking URL discovery failed:', err.message);
    return null;
  }
}

function classifyUrlResolution(mallId, url, method) {
  if (method === 'manual') return 'manual';
  if (method === 'saved') return 'saved';
  if (method === 'known') return 'known';
  if (mallId === 'amazon') {
    if (method === 'gemini') return 'gemini-bestsellers';
    if (isAmazonBestsellerUrl(url)) return 'auto-bestsellers';
    return 'search-popularity';
  }
  if (mallId === 'rakuten') {
    if (method === 'gemini') return 'gemini-daily';
    if (isRakutenDailyRankingUrl(url) && /tags=/.test(url)) return 'auto-daily-tag';
    if (isRakutenDailyRankingUrl(url)) return 'auto-daily';
    return 'search-popularity';
  }
  if (mallId === 'yahoo') {
    if (method === 'manual') return 'manual';
    if (method === 'known') return 'known';
    if (method === 'gemini') return isYahooCategoryRankingUrl(url) ? 'gemini-cid' : 'gemini';
    if (isYahooCategoryRankingUrl(url)) return 'auto-searchranking-cid';
    if (/searchranking/i.test(url)) return 'auto-searchranking';
    return 'search';
  }
  if (mallId === 'kojima') {
    if (/cate=/.test(url)) return 'auto-category';
    return 'keyword';
  }
  if (mallId === 'bic') {
    if (/\/bc\/ranking\//i.test(url)) return method === 'gemini' ? 'gemini-ranking' : 'ranking';
    return method;
  }
  return method;
}

function applyKnownCategoryRankingUrls(urls, methods, category) {
  const known = KNOWN_CATEGORY_RANKING_URLS[normalizeCategoryKey(category)];
  if (!known) return 0;
  let applied = 0;
  for (const key of RANKING_SOURCE_KEYS) {
    if (methods[key] !== 'fallback') continue;
    const candidate = normalizeMallRankingUrl(known[key]);
    if (!candidate || !isValidMallRankingUrl(key, candidate)) continue;
    urls[key] = candidate;
    methods[key] = 'known';
    applied += 1;
  }
  return applied;
}

function needsGeminiUrlDiscovery(methods) {
  return RANKING_SOURCE_KEYS.some((key) => methods[key] === 'fallback');
}

/**
 * 保存済み URL → 既知マスタ → Gemini / スクレイピングの順でランキング URL を解決
 * @returns {Promise<{ urls: object, urlResolution: object, notes: string[], savedRankingUrls?: object }>}
 */
async function resolveCategoryRankingUrls(category, deps = {}) {
  const trimmed = String(category || '').trim();
  const defaults = buildDefaultRankingUrls(trimmed);
  const { fetchHtmlWithHttpClient, getGeminiModel, parseJsonFromModelOutput } = deps;
  const notes = [];

  const urls = { ...defaults };
  const methods = {
    amazon: 'fallback',
    rakuten: 'fallback',
    yahoo: 'fallback',
    kojima: 'fallback',
    bic: 'fallback',
  };

  const saved = loadSavedRankingUrls(trimmed);
  if (saved?.rankingUrls) {
    for (const key of RANKING_SOURCE_KEYS) {
      const candidate = normalizeMallRankingUrl(saved.rankingUrls[key]);
      if (!candidate || !isValidMallRankingUrl(key, candidate)) continue;
      urls[key] = candidate;
      methods[key] = 'saved';
    }
    const savedCount = RANKING_SOURCE_KEYS.filter(
      (k) => methods[k] === 'saved'
    ).length;
    if (savedCount > 0) {
      const savedAt = saved.savedAt ? `（${saved.savedAt.slice(0, 10)} 保存）` : '';
      notes.push(`保存済みランキング URL を ${savedCount} 件使用します${savedAt}。`);
    }
  }

  const knownCount = applyKnownCategoryRankingUrls(urls, methods, trimmed);
  if (knownCount > 0) {
    notes.push(`登録済みマスタ URL を ${knownCount} 件使用しました。`);
  }

  if (needsGeminiUrlDiscovery(methods) && getGeminiModel) {
    const geminiUrls = await discoverRankingUrlsWithGemini(trimmed, deps);
    if (geminiUrls) {
      for (const key of RANKING_SOURCE_KEYS) {
        if (methods[key] !== 'fallback' || !geminiUrls[key]) continue;
        urls[key] = geminiUrls[key];
        methods[key] = 'gemini';
      }
      const filled = RANKING_SOURCE_KEYS.filter(
        (k) => methods[k] === 'gemini'
      ).length;
      if (filled > 0) {
        notes.push(`Gemini で ${filled} 件のランキング URL を補完しました。内容を確認してください。`);
      }
    } else if (needsGeminiUrlDiscovery(methods)) {
      notes.push('Gemini から URL を取得できませんでした。スクレイピングで補完します。');
    }
  } else if (needsGeminiUrlDiscovery(methods) && !getGeminiModel) {
    notes.push('GEMINI_API_KEY が未設定です。スクレイピングと検索 URL で補完します。');
  }

  if (fetchHtmlWithHttpClient) {
    if (
      methods.yahoo === 'fallback' ||
      (methods.yahoo === 'gemini' && !isYahooCategoryRankingUrl(urls.yahoo))
    ) {
      try {
        urls.yahoo = await discoverYahooRankingUrl(trimmed, fetchHtmlWithHttpClient);
        methods.yahoo = isYahooCategoryRankingUrl(urls.yahoo) ? 'auto' : 'fallback';
      } catch (err) {
        console.warn('⚠️ Yahoo URL discovery failed:', err.message);
        urls.yahoo = buildYahooSearchRankingUrl(trimmed);
        methods.yahoo = 'fallback';
      }
    }
    if (methods.rakuten === 'fallback' || !isRakutenOfficialRankingUrl(urls.rakuten)) {
      if (methods.rakuten === 'fallback') {
        urls.rakuten = await discoverRakutenRankingUrl(trimmed, fetchHtmlWithHttpClient);
        if (isRakutenOfficialRankingUrl(urls.rakuten)) methods.rakuten = 'auto';
      }
    }
  }

  if (methods.amazon === 'fallback' && !isAmazonBestsellerUrl(urls.amazon)) {
    const amazonCandidate = discoverAmazonRankingUrl(trimmed);
    if (isAmazonBestsellerUrl(amazonCandidate)) {
      urls.amazon = amazonCandidate;
      methods.amazon = 'pattern';
    }
  }

  if (
    methods.kojima === 'fallback' ||
    (methods.kojima === 'gemini' && !/kojima\.net\/ec\/ranking/i.test(urls.kojima))
  ) {
    urls.kojima = discoverKojimaRankingUrl(trimmed);
    if (/cate=/.test(urls.kojima)) methods.kojima = 'pattern';
    else if (methods.kojima === 'gemini') methods.kojima = 'gemini';
    else if (methods.kojima === 'fallback') methods.kojima = 'fallback';
  }

  const urlResolution = {
    amazon: classifyUrlResolution('amazon', urls.amazon, methods.amazon),
    rakuten: classifyUrlResolution('rakuten', urls.rakuten, methods.rakuten),
    yahoo: classifyUrlResolution('yahoo', urls.yahoo, methods.yahoo),
    kojima: classifyUrlResolution('kojima', urls.kojima, methods.kojima),
    bic: classifyUrlResolution('bic', urls.bic, methods.bic),
  };

  return {
    urls,
    urlResolution,
    notes,
    savedRankingUrls: saved?.rankingUrls || null,
    savedAt: saved?.savedAt || null,
  };
}

/** @deprecated 互換用。resolveCategoryRankingUrls を利用 */
async function resolveRankingUrls(category, deps = {}) {
  const { urls, urlResolution } = await resolveCategoryRankingUrls(category, deps);
  return { urls, urlResolution };
}

function isAmazonBestsellerUrl(url) {
  return /amazon\.co\.jp\/gp\/bestsellers\//i.test(String(url || ''));
}

function isYahooCategoryRankingUrl(url) {
  const u = String(url || '');
  if (!/shopping\.yahoo\.co\.jp\/searchranking/i.test(u)) return false;
  // 旧: ?cid=123 / 新: /searchranking/キーワード/123/
  return /[?&]cid=\d+/i.test(u) || /\/searchranking\/[^/]+\/\d+\/?/i.test(u);
}

function isRakutenOfficialRankingUrl(url) {
  return /ranking\.rakuten\.co\.jp\/(?:daily|weekly)\/\d+/i.test(String(url || ''));
}

/** @deprecated use isRakutenOfficialRankingUrl */
function isRakutenDailyRankingUrl(url) {
  return isRakutenOfficialRankingUrl(url);
}

function categoryMatchTokens(category) {
  const raw = String(category || '').trim();
  const tokens = new Set();
  if (raw) tokens.add(raw.replace(/\s+/g, ''));
  for (const part of raw.split(/[\s　・／/]+/)) {
    const p = part.trim();
    if (p.length >= 2) tokens.add(p);
  }
  return [...tokens];
}

function titleMatchesCategory(title, category) {
  const raw = String(title || '');
  const normalized = raw.replace(/\s+/g, '');
  if (!normalized) return false;
  const cat = String(category || '').trim();
  if (!cat) return true;

  // スポットクーラー: ルームエアコン・他カテゴリの総合ランキング混入を除外
  if (/スポット/.test(cat) && /クーラー|エアコン/.test(cat)) {
    const isSpot =
      /スポット\s*(クーラー|エアコン|エアクーラー)|ポータブル\s*(クーラー|エアコン)|移動式\s*(クーラー|エアコン)|コンパクトクーラー|ダクトレス.*クーラー|工事不要.*クーラー|排気ダクト|排熱ダクト/i.test(
        raw
      );
    if (!isSpot) return false;
    // 壁掛けルームエアコン（おもにN畳用 + 室外機想定の型番）を除外
    if (
      /おもに\d+畳|白くまくん|リララ|RAS-|RC-\d{4}|壁掛|セパレート/i.test(raw) &&
      !/スポット|ポータブル|移動式|ダクトレス|工事不要/i.test(raw)
    ) {
      return false;
    }
    return true;
  }

  const tokens = categoryMatchTokens(category);
  if (tokens.length === 0) return true;
  const lower = normalized.toLowerCase();
  if (tokens.some((t) => lower.includes(t.replace(/\s+/g, '').toLowerCase()))) {
    return true;
  }
  if (/エアコン/.test(cat) && /エアコン|aircon|air.?con|airconditioner|クーラー/i.test(raw)) {
    return true;
  }
  if (/窓/.test(cat) && /窓|window/i.test(raw)) {
    return true;
  }
  if (/掃除機/.test(cat) && /掃除機|クリーナー|cleaner|コードレス.*掃除機|スティッククリーナー/i.test(raw)) {
    return true;
  }
  return false;
}

const KNOWN_MANUFACTURERS = [
  'SONY',
  'Panasonic',
  'パナソニック',
  'SHARP',
  'シャープ',
  'HITACHI',
  '日立',
  '三菱',
  'MITSUBISHI',
  'DAIKIN',
  'ダイキン',
  'CORONA',
  'コロナ',
  'Haier',
  'ハイアール',
  'KOIZUMI',
  'コイズミ',
  'トヨトミ',
  'TOYOTOMI',
  'TOSHIBA',
  '東芝',
  'IRIS OHYAMA',
  'アイリスオーヤマ',
  'Dyson',
  'ダイソン',
  'Apple',
  'DELL',
  'Dell',
  'ASUS',
  'LG',
  'HP',
  'Lenovo',
  'Acer',
  'MSI',
  'IODATA',
  'IO DATA',
];

function findManufacturerInBlock(headBlock, knownManufacturers = KNOWN_MANUFACTURERS) {
  const sorted = [...knownManufacturers].sort((a, b) => b.length - a.length);
  let best = null;
  let bestIdx = Infinity;
  for (const name of sorted) {
    const idx = headBlock.indexOf(name);
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      best = name;
    }
  }
  return best;
}

function normalizeRow(raw, rank) {
  const title = String(raw.model || raw.title || '').replace(/\s+/g, ' ').trim();
  const manufacturer =
    raw.manufacturer && raw.manufacturer !== '不明'
      ? raw.manufacturer
      : findManufacturerInBlock(title) || '不明';
  let model = title;
  if (manufacturer !== '不明') {
    model = title.replace(manufacturer, '').replace(/^[\s　]+/, '').trim() || title;
  }
  return {
    rank,
    manufacturer,
    model: model.slice(0, 200),
    href: raw.href || '',
    sourceLabel: raw.sourceLabel || '',
    sourceType: raw.sourceType || '',
  };
}

function extractAmazonRankingRows(html, limit = CATEGORY_RANKING_TOP, category = '') {
  const $ = cheerio.load(String(html || ''));
  const rows = [];
  const seen = new Set();

  const pushFromElement = ($el, rankHint) => {
    if (rows.length >= limit) return false;
    let asin = String($el.attr('data-asin') || '').trim();
    if (!asin || asin === '0') {
      const href = $el.find('a[href*="/dp/"]').first().attr('href') || '';
      const m = /\/dp\/([A-Z0-9]{10})/i.exec(href);
      asin = m ? m[1] : '';
    }
    if (!asin || asin === '0' || seen.has(asin)) return;
    seen.add(asin);

    let title =
      $el.find('h2 a span, h2 span').first().text() ||
      $el.find('img').first().attr('alt') ||
      $el.find('[class*="p13n-sc-truncate"], [class*="truncate"]').first().text() ||
      $el.find('a[href*="/dp/"]').first().text();
    title = String(title || '').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 3) return;
    if (category && !titleMatchesCategory(title, category)) return;

    const rank =
      rankHint != null
        ? rankHint
        : (() => {
            const badge = $el.find('.zg-badge-text, [class*="zg-badge"]').first().text();
            const rm = /#?\s*(\d+)/.exec(String(badge).replace(/\s+/g, ''));
            return rm ? parseInt(rm[1], 10) : rows.length + 1;
          })();

    rows.push(
      normalizeRow(
        {
          title,
          href: `https://www.amazon.co.jp/dp/${asin}`,
          manufacturer: findManufacturerInBlock(title),
        },
        rank
      )
    );
  };

  const $bestsellerList = $('#zg-ordered-list li');
  if ($bestsellerList.length > 0) {
    $bestsellerList.each((idx, el) => {
      if (rows.length >= limit) return false;
      pushFromElement($(el), idx + 1);
    });
    return rows.sort((a, b) => a.rank - b.rank).slice(0, limit);
  }

  const selectorList = [
    'div[data-component-type="s-search-result"][data-asin]',
    'li[data-asin]',
    'div[data-asin]',
  ];

  let $candidates = $();
  for (const sel of selectorList) {
    const found = $(sel);
    if (found.length > $candidates.length) $candidates = found;
  }

  $candidates.each((_, el) => {
    if (rows.length >= limit) return false;
    pushFromElement($(el), null);
  });
  return rows.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

function extractRakutenRankingRows(html, limit = CATEGORY_RANKING_TOP, category = '') {
  const $ = cheerio.load(String(html || ''));
  const rows = [];
  const seen = new Set();

  $('a[href*="item.rakuten.co.jp"]').each((_, a) => {
    if (rows.length >= limit) return false;
    const href = String($(a).attr('href') || '').trim();
    let title = $(a).text().replace(/\s+/g, ' ').trim();
    if (!title || title.length < 8) {
      title = $(a).find('img').attr('alt') || $(a).attr('title') || '';
      title = String(title).replace(/\s+/g, ' ').trim();
    }
    if (!href || title.length < 8 || seen.has(href)) return;
    if (category && !titleMatchesCategory(title, category)) return;
    seen.add(href);
    rows.push(
      normalizeRow(
        { title, href, manufacturer: findManufacturerInBlock(title) },
        rows.length + 1
      )
    );
  });
  return rows;
}

function extractYahooRankingRows(html, limit = CATEGORY_RANKING_TOP, category = '') {
  const pageHtml = String(html || '');
  const fromBff = extractYahooRankingRowsFromBff(pageHtml, limit, category);
  if (fromBff.length > 0) return fromBff;

  const fromFlag = extractYahooRankingRowsFromRankingFlag(pageHtml, limit, category);
  if (fromFlag.length > 0) return fromFlag;

  return [];
}

/** コジマネット ec/ranking.html */
function extractKojimaNetRankingRows(html, limit = CATEGORY_RANKING_TOP, category = '') {
  const $ = cheerio.load(String(html || ''));
  const rows = [];
  const seen = new Set();

  $('div.ranking-box').each((_, box) => {
    if (rows.length >= limit) return false;
    const $box = $(box);
    const rankText = $box.find('p.rank').first().text().replace(/\s+/g, '').trim();
    const rm = /^(\d+)位$/.exec(rankText) || /(\d+)位/.exec(rankText);
    const rank = rm ? parseInt(rm[1], 10) : rows.length + 1;
    if (!Number.isFinite(rank) || rank < 1) return;

    const $a = $box.find('a.mk2TagClick[href*="prod_detail.html"]').first();
    let href = String($a.attr('href') || '').trim();
    if (!href) return;
    if (href.startsWith('//')) href = `https:${href}`;
    else if (href.startsWith('/')) href = `https://www.kojima.net${href}`;
    else if (!/^https?:\/\//i.test(href)) {
      href = `https://www.kojima.net/${href.replace(/^\//, '')}`;
    }
    if (seen.has(href)) return;

    let titleText = $box.find('p.name a span').first().text().replace(/\s+/g, ' ').trim();
    if (!titleText) titleText = String($box.find('.inner').attr('mk2pname') || '').trim();
    if (!titleText) {
      titleText = String($box.find('.image img[title]').first().attr('title') || '').trim();
    }
    if (!titleText) return;
    if (category && !titleMatchesCategory(titleText, category)) return;

    seen.add(href);

    const manufacturer = findManufacturerInBlock(titleText) || '不明';
    let model = titleText;
    if (manufacturer !== '不明') {
      model =
        titleText.replace(manufacturer, '').replace(/^[\s　]+/, '').trim() || titleText;
    }

    rows.push(
      normalizeRow(
        {
          title: model || titleText,
          href,
          manufacturer,
          sourceLabel: KOJIMA_NET_SOURCE.label,
          sourceType: KOJIMA_NET_SOURCE.type,
        },
        rank
      )
    );
  });

  return rows.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

/** ビックカメラ.com /bc/ranking/... */
function extractBicCameraRankingRows(html, limit = CATEGORY_RANKING_TOP, category = '') {
  const $ = cheerio.load(String(html || ''));
  const rows = [];
  const seen = new Set();

  const isAccessory = (title) =>
    /掃除機用|交換用|取り替え用|紙パック.*枚入|フィルター|アクセサリー|アタッチメント/i.test(
      title
    );

  // 法人専用サイトは Akamai 回避用の公式フォールバックとして利用する。
  $('.product_list_item').each((index, item) => {
    if (rows.length >= limit) return false;
    const $item = $(item);
    const $a = $item.find('a[href*="/product/detail.aspx"]').filter((_, a) => {
      return $(a).text().replace(/\s+/g, ' ').trim().length >= 8;
    }).first();
    const href = String($a.attr('href') || '').trim();
    const title = $a.text().replace(/\s+/g, ' ').trim();
    if (!href || !title || isAccessory(title) || seen.has(href)) return;
    if (category && !titleMatchesCategory(title, category)) return;

    const rankSrc = String(
      $item.find('img[src*="icon_ranking"]').first().attr('src') || ''
    );
    const rankMatch = /no(\d{1,2})\.png/i.exec(rankSrc);
    const rank = rankMatch ? Number(rankMatch[1]) : index + 1;
    const absoluteHref = href.startsWith('/')
      ? `https://houjin.biccamera.com${href}`
      : href;
    seen.add(absoluteHref);
    rows.push(
      normalizeRow(
        {
          title,
          href: absoluteHref,
          manufacturer: findManufacturerInBlock($item.text()) || findManufacturerInBlock(title),
          sourceLabel: BIC_CAMERA_SOURCE.label,
          sourceType: BIC_CAMERA_SOURCE.type,
        },
        rank
      )
    );
  });
  if (rows.length >= limit) {
    return rows.sort((a, b) => a.rank - b.rank).slice(0, limit);
  }

  $('a[href*="/bc/item/"]').each((_, anchor) => {
    if (rows.length >= limit) return false;

    const $a = $(anchor);
    let href = String($a.attr('href') || '').trim();
    if (!href) return;
    if (href.startsWith('//')) href = `https:${href}`;
    else if (href.startsWith('/')) href = `https://www.biccamera.com${href}`;
    if (!/^https?:\/\/(?:www\.)?biccamera\.com\/bc\/item\//i.test(href)) return;
    href = href.split('?')[0];
    if (seen.has(href)) return;

    let $block = $a.closest(
      'li, article, [class*="rankingItem"], [class*="ranking_item"], [class*="rankItem"]'
    );
    if (!$block.length) $block = $a.parent();

    let title = [
      $block.find('[class*="itemName"], [class*="item_name"]').first().text(),
      $block.find('[class*="productName"], [class*="product_name"]').first().text(),
      $a.text(),
      $a.find('img[alt]').first().attr('alt'),
      $block.find('img[alt]').first().attr('alt'),
    ]
      .map((v) => String(v || '').replace(/\s+/g, ' ').trim())
      .find((v) => v.length >= 8);
    if (!title || isAccessory(title)) return;
    if (category && !titleMatchesCategory(title, category)) return;

    const rankCandidates = [
      $block.find('[class*="rank"]').first().text(),
      $block.find('img[alt*="位"]').first().attr('alt'),
      $block.text().slice(0, 300),
    ];
    let rank = null;
    for (const candidate of rankCandidates) {
      const match = String(candidate || '').replace(/\s+/g, ' ').match(/(?:第)?(\d{1,2})\s*位|#\s*(\d{1,2})/);
      if (match) {
        rank = Number(match[1] || match[2]);
        break;
      }
    }
    if (!Number.isFinite(rank) || rank < 1) rank = rows.length + 1;

    seen.add(href);
    rows.push(
      normalizeRow(
        {
          title,
          href,
          manufacturer: findManufacturerInBlock(title),
          sourceLabel: BIC_CAMERA_SOURCE.label,
          sourceType: BIC_CAMERA_SOURCE.type,
        },
        rank
      )
    );
  });

  return rows.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

function buildBicCorporateRankingUrl(url) {
  const match = String(url || '').match(/\/bc\/ranking\/((?:\d+\/?)+)/i);
  const categoryId = match?.[1]?.replace(/\D/g, '');
  if (!categoryId) return '';
  return `https://houjin.biccamera.com/ranking/list.aspx?ctid=${categoryId}`;
}

function kojimaNetRankingPageUrls(originalUrlStr, pageCount = 3) {
  const urls = [];
  try {
    for (let p = 1; p <= pageCount; p++) {
      const u = new URL(originalUrlStr);
      u.searchParams.set('rPage', String(p));
      urls.push(u.href);
    }
  } catch {
    urls.push(originalUrlStr);
  }
  return urls;
}

async function fetchHtmlWithPlaywright(url, { waitForSelector } = {}) {
  const launchOpts = {
    headless: true,
    args: ['--disable-http2', '--disable-blink-features=AutomationControlled'],
  };
  if (process.env.PLAYWRIGHT_CHROMIUM_NO_SANDBOX === '1') {
    launchOpts.args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  const pwChannel = String(process.env.PLAYWRIGHT_CHANNEL || '').trim();
  if (pwChannel) launchOpts.channel = pwChannel;

  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 30000 }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 2500));
    const html = await page.content();
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    return html;
  } finally {
    await browser.close().catch(() => {});
  }
}


async function extractWithGeminiFallback(pageText, sourceLabel, getGeminiModel, parseJsonFromModelOutput) {
  const prompt = `
以下は「${sourceLabel}」のランキングページ本文です。順位付きランキング商品を最大${CATEGORY_RANKING_TOP}件、順位の高い順に抽出してください。

# 出力（JSON のみ）
{
  "items": [
    { "rank": 1, "manufacturer": "メーカー名または不明", "model": "商品名", "href": "商品URL（あれば）" }
  ]
}

# 本文
${String(pageText || '').slice(0, 12000)}
`;

  const model = await getGeminiModel();
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  const raw = result.response?.text?.() || '';
  const data = parseJsonFromModelOutput(raw);
  if (!Array.isArray(data.items)) return [];
  return data.items
    .map((x, i) =>
      normalizeRow(
        {
          title: String(x.model || x.title || ''),
          manufacturer: String(x.manufacturer || '不明'),
          href: String(x.href || ''),
          sourceLabel,
        },
        Number(x.rank) || i + 1
      )
    )
    .filter((x) => x.model)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, CATEGORY_RANKING_TOP)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function escapeCsvCell(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function sanitizeCsvFilenamePart(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

/** 横断比較用: 商品名から型番キーを抽出（同等品のみの行は null） */
const MODEL_KEY_PATTERNS = [
  /\bCWH-A\d{4}R(?:-W|-WS)?/i,
  /\bCW-FA\d{4}R(?:-W|-WS)?/i,
  /\bCW-F\d{4}R(?:-W|-WS)?/i,
  /\bCW-\d{4}R(?:-W|-WS)?/i,
  /\bJA-W\d{2}[A-Z](?:-W)?/i,
  /\bJA-\d{2}T\b/i,
  /\bKAW-\d{4,5}(?:\/W)?/i,
  /\bACW-S?\d{2}R(?:-W)?/i,
  /\bTIW-A\d{3}M\b/i,
];

function normalizeModelKeyToken(raw) {
  let k = String(raw || '')
    .toUpperCase()
    .replace(/\(WS\)/gi, '')
    .trim();
  k = k.replace(/-WS$/i, '').replace(/\/W$/i, '');
  if (/^JA-W\d{2}[A-Z]-W$/i.test(k)) k = k.replace(/-W$/i, '');
  else if (/R-W$/i.test(k) && /^CW|^CWH/i.test(k)) k = k.replace(/-W$/i, '');
  return k;
}

function extractModelKey(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const re of MODEL_KEY_PATTERNS) {
    const m = re.exec(t);
    if (m) return normalizeModelKeyToken(m[0]);
  }

  // 掃除機などの一般的な家電型番（MC-SB54K / SV46FF / CL108FDSHW 等）
  const genericCandidates = String(t)
    .toUpperCase()
    .match(/\b(?=[A-Z0-9-]{4,20}\b)(?=[A-Z0-9-]*\d)[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){0,2}\b/g);
  if (!genericCandidates?.length) return null;

  const ignored = /^(?:HEPA\d*|TYPE-C|USB\d*|LED\d*|2WAY|3WAY|WI-?FI)$/i;
  const candidates = [...new Set(genericCandidates)]
    .filter((token) => !ignored.test(token))
    .map((token) => {
      let score = token.length;
      if (token.includes('-')) score += 8;
      if (/^(?:MC|SV|PV|CV|VC|TC|EC|SCD|CL|HC|Y|G|DEX|RV|ROBOROCK)/i.test(token)) {
        score += 12;
      }
      if (/^[A-Z]\d{1,2}$/i.test(token)) score -= 8;
      return { token, score };
    })
    .sort((a, b) => b.score - a.score || b.token.length - a.token.length);

  return candidates[0] ? normalizeModelKeyToken(candidates[0].token) : null;
}

const COMPOSITE_SOURCE_RANK_FIELDS = {
  Amazon: { rank: 'rankAmazon', href: 'hrefAmazon' },
  楽天: { rank: 'rankRakuten', href: 'hrefRakuten' },
  'Yahoo!': { rank: 'rankYahoo', href: 'hrefYahoo' },
  コジマネット: { rank: 'rankKojima', href: 'hrefKojima' },
  ビックカメラ: { rank: 'rankBic', href: 'hrefBic' },
};

function buildCompositeRanking(sourceResults) {
  const byKey = new Map();
  let unknownModelCount = 0;
  const sourceCounts = {};

  for (const block of sourceResults || []) {
    const sourceLabel = block.sourceLabel || '';
    sourceCounts[sourceLabel] = (block.items || []).length;
    const fields = COMPOSITE_SOURCE_RANK_FIELDS[sourceLabel];
    if (!fields) continue;

    for (const item of block.items || []) {
      const modelKey = extractModelKey(
        `${item.model || ''} ${item.manufacturer || ''} ${item.title || ''}`
      );
      if (!modelKey) {
        unknownModelCount++;
        continue;
      }

      if (!byKey.has(modelKey)) {
        byKey.set(modelKey, {
          modelKey,
          manufacturer: '不明',
          representativeModel: '',
          rankAmazon: null,
          rankRakuten: null,
          rankYahoo: null,
          rankKojima: null,
          rankBic: null,
          hrefAmazon: '',
          hrefRakuten: '',
          hrefYahoo: '',
          hrefKojima: '',
          hrefBic: '',
        });
      }
      const agg = byKey.get(modelKey);
      const mfr = item.manufacturer && item.manufacturer !== '不明' ? item.manufacturer : null;
      if (mfr) agg.manufacturer = mfr;
      const modelText = String(item.model || '').trim();
      if (
        modelText &&
        (!agg.representativeModel || modelText.length < agg.representativeModel.length)
      ) {
        agg.representativeModel = modelText;
      }

      const rank = Number(item.rank);
      if (!Number.isFinite(rank) || rank < 1) continue;
      const prev = agg[fields.rank];
      if (prev == null || rank < prev) {
        agg[fields.rank] = rank;
        if (item.href) agg[fields.href] = item.href;
      }
    }
  }

  const items = [...byKey.values()]
    .map((row) => {
      const ranks = [
        row.rankAmazon,
        row.rankRakuten,
        row.rankYahoo,
        row.rankKojima,
        row.rankBic,
      ].filter((r) => r != null);
      const siteCount = ranks.length;
      const avgRank =
        siteCount > 0
          ? Math.round((ranks.reduce((a, b) => a + b, 0) / siteCount) * 100) / 100
          : null;
      return { ...row, siteCount, avgRank };
    })
    .sort((a, b) => {
      if (b.siteCount !== a.siteCount) return b.siteCount - a.siteCount;
      const avgA = a.avgRank ?? 999;
      const avgB = b.avgRank ?? 999;
      if (avgA !== avgB) return avgA - avgB;
      return String(a.modelKey).localeCompare(String(b.modelKey));
    });

  return {
    items,
    stats: {
      totalRows: items.length,
      unknownModelCount,
      sourceCounts,
    },
  };
}

function productTextForThemeMatch(row) {
  return `${row.modelKey || ''} ${row.manufacturer || ''} ${row.representativeModel || ''}`
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function matchesRankingTheme(row, theme) {
  const text = productTextForThemeMatch(row);
  for (const kw of theme.excludeKeywords || []) {
    if (kw && text.includes(String(kw).toLowerCase())) return false;
  }
  const keywords = theme.keywords || [];
  if (keywords.length === 0) return true;
  // キーワードは OR（いずれか1つが商品名に含まれれば候補）
  return keywords.some((kw) => text.includes(String(kw).toLowerCase()));
}

function scoreProductForTheme(row, theme) {
  if (theme.minSiteCount > 0 && row.siteCount < theme.minSiteCount) return -1;
  const avg = row.avgRank ?? 99;
  return row.siteCount * 100 - avg * 10;
}

function pickPrimaryProductHref(row) {
  return (
    row.hrefAmazon ||
    row.hrefRakuten ||
    row.hrefYahoo ||
    row.hrefKojima ||
    row.hrefBic ||
    ''
  );
}

/**
 * 横断比較（型番マスタ）から、ユーザー指定テーマごとに最大 N 件を生成
 * @param {object[]} compositeItems
 * @param {object[]} themes 最大3件
 * @param {{ topPerTheme?: number, avoidDuplicateAcrossThemes?: boolean }} [options]
 */
function buildThemedRankings(compositeItems, themes, options = {}) {
  const topPerTheme = Math.min(
    Math.max(Number(options.topPerTheme) || THEME_RANKING_TOP, 1),
    10
  );
  const avoidDup = options.avoidDuplicateAcrossThemes === true;
  const usedKeys = avoidDup ? new Set() : null;
  const themeBlocks = [];

  for (const theme of (themes || []).slice(0, 3)) {
    const pool = (compositeItems || [])
      .filter((row) => matchesRankingTheme(row, theme))
      .map((row) => ({ row, score: scoreProductForTheme(row, theme) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.row.avgRank ?? 999) - (b.row.avgRank ?? 999);
      });

    const items = [];
    for (const { row } of pool) {
      if (items.length >= topPerTheme) break;
      if (usedKeys?.has(row.modelKey)) continue;
      items.push({
        rank: items.length + 1,
        modelKey: row.modelKey,
        manufacturer: row.manufacturer,
        representativeModel: row.representativeModel,
        siteCount: row.siteCount,
        avgRank: row.avgRank,
        rankAmazon: row.rankAmazon,
        rankRakuten: row.rankRakuten,
        rankYahoo: row.rankYahoo,
        rankKojima: row.rankKojima,
        rankBic: row.rankBic,
        href: pickPrimaryProductHref(row),
        hrefAmazon: row.hrefAmazon,
        hrefRakuten: row.hrefRakuten,
        hrefYahoo: row.hrefYahoo,
        hrefKojima: row.hrefKojima,
        hrefBic: row.hrefBic,
      });
      usedKeys?.add(row.modelKey);
    }

    themeBlocks.push({
      themeId: theme.id,
      label: theme.label,
      title: theme.title,
      keywords: theme.keywords || [],
      excludeKeywords: theme.excludeKeywords || [],
      minSiteCount: theme.minSiteCount || 0,
      candidateCount: pool.length,
      items,
    });
  }

  return { themes: themeBlocks };
}

function scoreFeaturesFromProductRows(rows, scored) {
  for (const row of rows || []) {
    const productRow = {
      modelKey: row.modelKey || extractModelKey(`${row.representativeModel || ''} ${row.manufacturer || ''}`),
      manufacturer: row.manufacturer,
      representativeModel: row.representativeModel || '',
      siteCount: row.siteCount,
    };
    let weight = 1;
    if (row.siteCount != null && row.avgRank != null) {
      weight = Number(row.siteCount) * 10 + (16 - Math.min(Number(row.avgRank), 15));
    } else {
      const rank = Number(row.rank);
      weight = Number.isFinite(rank) && rank >= 1 ? 16 - Math.min(rank, 15) : 1;
    }

    for (const entry of scored) {
      if (matchesRankingTheme(productRow, entry)) {
        entry.score += weight;
        entry.matchCount += 1;
      }
    }
  }
}

function initFeatureScoreRules(category) {
  return getRankingThemePresets(category)
    .filter((r) => r.id !== 'overall')
    .map((rule) => ({
      id: rule.id,
      label: rule.label,
      headingCandidate: rule.title || rule.label,
      keywords: [...(rule.keywords || [])],
      excludeKeywords: [...(rule.excludeKeywords || [])],
      minSiteCount: rule.minSiteCount || 0,
      score: 0,
      matchCount: 0,
    }));
}

function finalizeFeatureScores(scored, maxFeatures) {
  return scored
    .filter((e) => e.matchCount > 0)
    .sort((a, b) => b.score - a.score || b.matchCount - a.matchCount)
    .slice(0, maxFeatures)
    .map(({ id, label, headingCandidate, score, matchCount }) => ({
      id,
      label,
      headingCandidate,
      score,
      matchCount,
    }));
}

/** 横断比較（総合ランキング）から需要の高い機能・切り口を最大 N 件抽出 */
function pickUserFeaturesFromComposite(compositeItems, category, maxFeatures = USER_FEATURE_PICK_MAX) {
  const scored = initFeatureScoreRules(category);
  scoreFeaturesFromProductRows(compositeItems, scored);
  return finalizeFeatureScores(scored, maxFeatures);
}

/**
 * 各サイトのランキング商品名から、読者が求めている機能・切り口を最大 N 件抽出
 */
function pickUserFeaturesFromRankings(sourceResults, category, maxFeatures = USER_FEATURE_PICK_MAX) {
  const scored = initFeatureScoreRules(category);
  for (const block of sourceResults || []) {
    for (const item of block.items || []) {
      scoreFeaturesFromProductRows(
        [
          {
            modelKey: extractModelKey(`${item.model || ''} ${item.manufacturer || ''}`),
            manufacturer: item.manufacturer,
            representativeModel: item.model || '',
            rank: item.rank,
          },
        ],
        scored
      );
    }
  }
  return finalizeFeatureScores(scored, maxFeatures);
}

function buildOverallOnlyThemes(category) {
  const presets = getRankingThemePresets(category);
  const overall = presets.find((p) => p.id === 'overall') || presets[0];
  return overall ? [presetToRankingTheme(overall)] : [];
}

/** ユーザーが選んだテーマ2・3のみで3テーマ構成（自動補完なし） */
function buildRankingThemesFromUserSelection(category, rankingThemesInput) {
  const presets = getRankingThemePresets(category);
  const byId = new Map(presets.map((p) => [p.id, p]));
  const overall = byId.get('overall') || presets[0];
  const themes = [];
  const usedIds = new Set();

  if (overall) {
    themes.push(presetToRankingTheme(overall));
    usedIds.add(overall.id);
  }

  const userThemes = normalizeRankingThemesInput(rankingThemesInput, category);
  for (const t of userThemes) {
    if (themes.length >= 3) break;
    const id = String(t?.id || '').trim();
    if (!id || id === 'overall' || usedIds.has(id)) continue;
    themes.push(t);
    usedIds.add(id);
  }

  if (themes.length < 3) {
    throw new Error('テーマ2・3を、需要分析の見出し候補から選んでください。');
  }
  return themes.slice(0, 3);
}

/**
 * ④ 見出し別ランキング（テーマ1〜3・各最大5件）を横断比較から生成
 */
function applyCategoryThemedRankings(category, compositeItems, rankingThemesInput) {
  const trimmedCategory = String(category || '').trim();
  if (!trimmedCategory) {
    throw new Error('カテゴリを入力してください。');
  }
  if (!Array.isArray(compositeItems) || compositeItems.length === 0) {
    throw new Error('横断比較データがありません。先にランキングを取得してください。');
  }

  const rankingThemes = buildRankingThemesFromUserSelection(
    trimmedCategory,
    rankingThemesInput
  );
  const themedRanking = buildThemedRankings(compositeItems, rankingThemes, {
    topPerTheme: THEME_RANKING_TOP,
  });
  const themedCsvOutput = writeThemedRankingsCsv(trimmedCategory, themedRanking);
  const warnings = [];

  for (const block of themedRanking.themes) {
    if (block.items.length < THEME_RANKING_TOP) {
      warnings.push({
        source: `テーマ:${block.label}`,
        url: '',
        message: `候補 ${block.candidateCount}件のうち最大${THEME_RANKING_TOP}件が ${block.items.length}件まで（キーワード条件を確認してください）`,
      });
    }
  }

  return {
    category: trimmedCategory,
    themeTopLimit: THEME_RANKING_TOP,
    phase: 'themed_complete',
    rankingThemes,
    themeSelectionSource: 'user',
    themedRanking,
    themedCsvFilename: themedCsvOutput.filename,
    themedCsvDownloadUrl: themedCsvOutput.csvDownloadUrl,
    warnings,
  };
}

function buildThemedRankingsCsv(category, themedResult) {
  const fetchedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const lines = [
    [
      'カテゴリ',
      'テーマID',
      'テーマ名',
      '記事見出し',
      'テーマ内順位',
      '型番',
      'メーカー',
      '代表商品名',
      '掲載サイト数',
      '平均順位',
      'Amazon順位',
      '楽天順位',
      'Yahoo順位',
      'コジマ順位',
      'ビック順位',
      '代表URL',
      '取得日時',
    ]
      .map(escapeCsvCell)
      .join(','),
  ];

  for (const block of themedResult?.themes || []) {
    if (!block.items?.length) {
      lines.push(
        [
          category,
          block.themeId,
          block.label,
          block.title,
          '',
          '',
          '',
          '（該当商品なし）',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          fetchedAt,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
      continue;
    }
    for (const item of block.items || []) {
      lines.push(
        [
          category,
          block.themeId,
          block.label,
          block.title,
          item.rank,
          item.modelKey,
          item.manufacturer,
          item.representativeModel,
          item.siteCount,
          item.avgRank ?? '',
          item.rankAmazon ?? '',
          item.rankRakuten ?? '',
          item.rankYahoo ?? '',
          item.rankKojima ?? '',
          item.rankBic ?? '',
          item.href || '',
          fetchedAt,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  return `\uFEFF${lines.join('\n')}`;
}

function writeThemedRankingsCsv(category, themedResult) {
  const csv = buildThemedRankingsCsv(category, themedResult);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `ranking-${sanitizeCsvFilenamePart(category)}-${stamp}-themed.csv`;

  fs.mkdirSync(CSV_EXPORT_DIR, { recursive: true });
  const filePath = path.join(CSV_EXPORT_DIR, filename);
  fs.writeFileSync(filePath, csv, 'utf8');

  return {
    filename,
    filePath,
    csvDownloadUrl: `/api/download-category-ranking-csv/${encodeURIComponent(filename)}`,
  };
}

function buildCompositeRankingsCsv(category, compositeItems) {
  const fetchedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const lines = [
    [
      'カテゴリ',
      '型番キー',
      'メーカー',
      '代表商品名',
      'Amazon順位',
      '楽天順位',
      'Yahoo順位',
      'コジマ順位',
      'ビック順位',
      '掲載サイト数',
      '平均順位',
      'Amazon URL',
      '楽天 URL',
      'Yahoo URL',
      'コジマ URL',
      'ビック URL',
      '取得日時',
    ]
      .map(escapeCsvCell)
      .join(','),
  ];

  for (const row of compositeItems || []) {
    lines.push(
      [
        category,
        row.modelKey,
        row.manufacturer,
        row.representativeModel,
        row.rankAmazon ?? '',
        row.rankRakuten ?? '',
        row.rankYahoo ?? '',
        row.rankKojima ?? '',
        row.rankBic ?? '',
        row.siteCount,
        row.avgRank ?? '',
        row.hrefAmazon || '',
        row.hrefRakuten || '',
        row.hrefYahoo || '',
        row.hrefKojima || '',
        row.hrefBic || '',
        fetchedAt,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }

  return `\uFEFF${lines.join('\n')}`;
}

function writeCompositeRankingsCsv(category, compositeItems) {
  const csv = buildCompositeRankingsCsv(category, compositeItems);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `ranking-${sanitizeCsvFilenamePart(category)}-${stamp}-composite.csv`;

  fs.mkdirSync(CSV_EXPORT_DIR, { recursive: true });
  const filePath = path.join(CSV_EXPORT_DIR, filename);
  fs.writeFileSync(filePath, csv, 'utf8');

  return {
    filename,
    filePath,
    csvDownloadUrl: `/api/download-category-ranking-csv/${encodeURIComponent(filename)}`,
  };
}

function buildRankingsCsv(category, sourceResults) {
  const fetchedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const lines = [
    ['カテゴリ', '取得元種別', '取得元', '順位', 'メーカー', '商品名', 'URL', '取得日時']
      .map(escapeCsvCell)
      .join(','),
  ];

  for (const block of sourceResults) {
    const typeLabel = block.sourceType === 'mall' ? 'モール' : 'コジマネット';
    for (const item of block.items || []) {
      lines.push(
        [
          category,
          typeLabel,
          block.sourceLabel,
          item.rank,
          item.manufacturer,
          item.model,
          item.href || '',
          fetchedAt,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
  }

  return `\uFEFF${lines.join('\n')}`;
}

function writeRankingsCsv(category, sourceResults) {
  const csv = buildRankingsCsv(category, sourceResults);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `ranking-${sanitizeCsvFilenamePart(category)}-${stamp}.csv`;

  fs.mkdirSync(CSV_EXPORT_DIR, { recursive: true });
  const filePath = path.join(CSV_EXPORT_DIR, filename);
  fs.writeFileSync(filePath, csv, 'utf8');

  return {
    filename,
    filePath,
    csvDownloadUrl: `/api/download-category-ranking-csv/${encodeURIComponent(filename)}`,
  };
}

/**
 * @param {object} deps
 * @param {Function} deps.fetchHtmlWithHttpClient
 * @param {Function} deps.getGeminiModel
 * @param {Function} deps.parseJsonFromModelOutput
 */
function buildManualUrlResolution(manualUrls) {
  return {
    amazon: normalizeMallRankingUrl(manualUrls?.amazon) ? 'manual' : 'fallback',
    rakuten: normalizeMallRankingUrl(manualUrls?.rakuten) ? 'manual' : 'fallback',
    yahoo: normalizeMallRankingUrl(manualUrls?.yahoo) ? 'manual' : 'fallback',
    kojima: normalizeMallRankingUrl(manualUrls?.kojima) ? 'manual' : 'fallback',
    bic: normalizeMallRankingUrl(manualUrls?.bic) ? 'manual' : 'fallback',
  };
}

/**
 * @param {object} deps
 * @param {object} [options]
 * @param {object} [options.rankingUrls] ユーザー確認済み URL（手動上書き）
 * @param {object[]} [options.rankingThemes] テーマ2・3の見出し（プリセット id）。未指定時は需要分析で補完
 */
async function fetchCategoryRankings(category, deps, options = {}) {
  const { fetchHtmlWithHttpClient, getGeminiModel, parseJsonFromModelOutput } = deps;
  const trimmedCategory = String(category || '').trim();
  if (!trimmedCategory) {
    throw new Error('カテゴリを入力してください。');
  }

  const defaults = buildDefaultRankingUrls(trimmedCategory);
  let urls;
  let urlResolution;
  let urlNotes = [];

  if (hasProvidedRankingUrls(options.rankingUrls)) {
    urls = applyManualRankingUrls(defaults, options.rankingUrls);
    urlResolution = buildManualUrlResolution(options.rankingUrls);
    urlNotes = ['ユーザー指定のランキング URL で取得しました。'];
  } else {
    const resolved = await resolveCategoryRankingUrls(trimmedCategory, {
      fetchHtmlWithHttpClient,
      getGeminiModel,
      parseJsonFromModelOutput,
    });
    urls = resolved.urls;
    urlResolution = resolved.urlResolution;
    urlNotes = resolved.notes || [];
    const savedCount = Object.values(urlResolution).filter((v) => v === 'saved').length;
    if (savedCount > 0) {
      console.log(`💾 Using ${savedCount} saved ranking URL(s) from data/ranking-urls.json`);
    } else if (!loadSavedRankingUrls(trimmedCategory)) {
      console.warn(
        '⚠️ No saved ranking URLs for category:',
        trimmedCategory,
        '— add URLs in 競合調査 tab or data/ranking-urls.json'
      );
    }
  }

  const sourceResults = [];
  const warnings = [];

  async function fetchMall(mall, url, extractFn, playwrightOpts) {
    let items = [];
    let html = '';
    const fetchUrl = mall.id === 'yahoo' ? ensureYahooRankingListUrl(url) : url;
    let effectiveUrl = fetchUrl;
    try {
      try {
        html = await fetchHtmlWithHttpClient(fetchUrl);
      } catch (httpErr) {
        console.warn(`⚠️ ${mall.label} HTTP fetch failed, trying Playwright:`, httpErr.message);
        html = await fetchHtmlWithPlaywright(fetchUrl, playwrightOpts);
      }
      const skipCategoryFilter =
        (mall.id === 'amazon' &&
          isAmazonBestsellerUrl(fetchUrl) &&
          /\/gp\/bestsellers\/[^/?#]+\/\d+/i.test(fetchUrl)) ||
        (mall.id === 'yahoo' && isYahooCategoryRankingUrl(fetchUrl)) ||
        (mall.id === 'rakuten' && isRakutenOfficialRankingUrl(fetchUrl));
      // スポットクーラー等の曖昧カテゴリは、専用ランキングでもタイトル絞り込みを必須にする
      const forceCategoryFilter = /スポット/.test(trimmedCategory);
      const categoryForExtract =
        skipCategoryFilter && !forceCategoryFilter ? '' : trimmedCategory;
      items = extractFn(html, CATEGORY_RANKING_TOP, categoryForExtract);
      if (items.length === 0 && mall.id === 'bic') {
        const corporateUrl = buildBicCorporateRankingUrl(fetchUrl);
        if (corporateUrl) {
          try {
            const corporateHtml = await fetchHtmlWithHttpClient(corporateUrl);
            items = extractFn(corporateHtml, CATEGORY_RANKING_TOP, categoryForExtract);
            if (items.length > 0) {
              effectiveUrl = corporateUrl;
              urlNotes.push('ビックカメラは公式法人サイトの週間ランキングで補完しました。');
            }
          } catch (corporateErr) {
            console.warn('⚠️ ビックカメラ法人ランキング fallback failed:', corporateErr.message);
          }
        }
      }
      if (items.length === 0 && (mall.id === 'amazon' || mall.id === 'bic')) {
        try {
          html = await fetchHtmlWithPlaywright(url, playwrightOpts);
          items = extractFn(html, CATEGORY_RANKING_TOP, categoryForExtract);
        } catch (pwErr) {
          console.warn(`⚠️ ${mall.label} Playwright fallback failed:`, pwErr.message);
        }
      }
      if (items.length === 0) {
        const bodyText = cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim();
        items = await extractWithGeminiFallback(
          bodyText,
          mall.label,
          getGeminiModel,
          parseJsonFromModelOutput
        );
      }
    } catch (err) {
      warnings.push({ source: mall.label, url: fetchUrl, message: err.message });
    }
    sourceResults.push({
      sourceId: mall.id,
      sourceLabel: mall.label,
      sourceType: 'mall',
      rankingUrl: effectiveUrl,
      count: items.length,
      items: items.map((it) => ({
        ...it,
        sourceLabel: mall.label,
        sourceType: 'mall',
      })),
    });
  }

  await fetchMall(
    MALL_SOURCES[0],
    urls.amazon,
    extractAmazonRankingRows,
    { waitForSelector: 'li[data-asin], #zg-ordered-list li' }
  );
  await fetchMall(
    MALL_SOURCES[1],
    urls.rakuten,
    extractRakutenRankingRows,
    { waitForSelector: 'a[href*="item.rakuten.co.jp"]' }
  );
  await fetchMall(
    MALL_SOURCES[2],
    urls.yahoo,
    extractYahooRankingRows,
    { waitForSelector: 'img[alt]' }
  );
  await fetchMall(
    MALL_SOURCES[3],
    urls.bic,
    extractBicCameraRankingRows,
    { waitForSelector: 'a[href*="/bc/item/"]' }
  );

  // コジマネット（モールではなく kojima.net から取得）
  const kojimaUrl = urls.kojima || KOJIMA_NET_SOURCE.defaultRankingUrl(trimmedCategory);
  let kojimaItems = [];
  try {
    const pageUrls = kojimaNetRankingPageUrls(kojimaUrl, 3);
    const seenHref = new Set();
    const merged = [];
    for (const pageUrl of pageUrls) {
      let html;
      try {
        html = await fetchHtmlWithHttpClient(pageUrl);
      } catch (err) {
        if (!merged.length) throw err;
        break;
      }
      const part = extractKojimaNetRankingRows(html, CATEGORY_RANKING_TOP, trimmedCategory);
      for (const row of part) {
        if (row.href && seenHref.has(row.href)) continue;
        if (row.href) seenHref.add(row.href);
        merged.push(row);
      }
      if (merged.length >= CATEGORY_RANKING_TOP) break;
    }
    kojimaItems = merged
      .sort((a, b) => a.rank - b.rank)
      .slice(0, CATEGORY_RANKING_TOP)
      .map((r, i) => ({
        ...r,
        rank: i + 1,
        sourceLabel: KOJIMA_NET_SOURCE.label,
        sourceType: KOJIMA_NET_SOURCE.type,
      }));
  } catch (err) {
    warnings.push({ source: KOJIMA_NET_SOURCE.label, url: kojimaUrl, message: err.message });
  }

  sourceResults.push({
    sourceId: KOJIMA_NET_SOURCE.id,
    sourceLabel: KOJIMA_NET_SOURCE.label,
    sourceType: KOJIMA_NET_SOURCE.type,
    rankingUrl: kojimaUrl,
    count: kojimaItems.length,
    items: kojimaItems,
  });

  const csvOutput = writeRankingsCsv(trimmedCategory, sourceResults);
  const compositeRanking = buildCompositeRanking(sourceResults);
  const compositeCsvOutput = writeCompositeRankingsCsv(
    trimmedCategory,
    compositeRanking.items
  );

  if (compositeRanking.stats.unknownModelCount > 0) {
    warnings.push({
      source: '横断比較',
      url: '',
      message: `型番を抽出できなかった掲載行: ${compositeRanking.stats.unknownModelCount}件（横断表から除外）`,
    });
  }

  const pickedFeatures = pickUserFeaturesFromComposite(
    compositeRanking.items,
    trimmedCategory
  );
  const themePresets = getRankingThemePresets(trimmedCategory);

  let rankingThemes;
  let themedRanking;
  let themedCsvOutput = null;
  let themeSelectionSource = 'pending';
  let phase = 'awaiting_theme_selection';

  if (hasUserSecondaryThemes(options.rankingThemes)) {
    rankingThemes = buildRankingThemesFromUserSelection(
      trimmedCategory,
      options.rankingThemes
    );
    themedRanking = buildThemedRankings(compositeRanking.items, rankingThemes, {
      topPerTheme: THEME_RANKING_TOP,
    });
    themedCsvOutput = writeThemedRankingsCsv(trimmedCategory, themedRanking);
    themeSelectionSource = 'user';
    phase = 'themed_complete';

    for (const block of themedRanking.themes) {
      if (block.items.length < THEME_RANKING_TOP) {
        warnings.push({
          source: `テーマ:${block.label}`,
          url: '',
          message: `候補 ${block.candidateCount}件のうち最大${THEME_RANKING_TOP}件が ${block.items.length}件まで（キーワード条件を確認してください）`,
        });
      }
    }
  } else {
    rankingThemes = buildOverallOnlyThemes(trimmedCategory);
    themedRanking = buildThemedRankings(compositeRanking.items, rankingThemes, {
      topPerTheme: THEME_RANKING_TOP,
    });
    if (themedRanking.themes[0]?.items.length < THEME_RANKING_TOP) {
      warnings.push({
        source: `テーマ:${themedRanking.themes[0]?.label || '総合'}`,
        url: '',
        message: `候補 ${themedRanking.themes[0]?.candidateCount ?? 0}件のうち最大${THEME_RANKING_TOP}件が ${themedRanking.themes[0]?.items.length ?? 0}件まで`,
      });
    }
  }

  return {
    category: trimmedCategory,
    phase,
    topLimit: CATEGORY_RANKING_TOP,
    themeTopLimit: THEME_RANKING_TOP,
    rankingUrls: urls,
    urlResolution,
    urlNotes,
    rankingThemes,
    themeSelectionSource,
    suggestedThemeIds: pickedFeatures.slice(0, 2).map((f) => f.id).filter(Boolean),
    themePresets,
    malls: sourceResults.filter((s) => s.sourceType === 'mall'),
    kojimaNet: sourceResults.find((s) => s.sourceType === KOJIMA_NET_SOURCE.type) || null,
    sources: sourceResults,
    compositeRanking,
    themedRanking,
    pickedFeatures,
    warnings,
    csvFilename: csvOutput.filename,
    csvDownloadUrl: csvOutput.csvDownloadUrl,
    compositeCsvFilename: compositeCsvOutput.filename,
    compositeCsvDownloadUrl: compositeCsvOutput.csvDownloadUrl,
    themedCsvFilename: themedCsvOutput?.filename || null,
    themedCsvDownloadUrl: themedCsvOutput?.csvDownloadUrl || null,
  };
}

module.exports = {
  CATEGORY_RANKING_TOP,
  THEME_RANKING_TOP,
  USER_FEATURE_PICK_MAX,
  pickUserFeaturesFromRankings,
  pickUserFeaturesFromComposite,
  buildOverallOnlyThemes,
  buildRankingThemesFromUserSelection,
  applyCategoryThemedRankings,
  CSV_EXPORT_DIR,
  MALL_SOURCES,
  KOJIMA_NET_SOURCE,
  BIC_CAMERA_SOURCE,
  KNOWN_CATEGORY_RANKING_URLS,
  buildDefaultRankingUrls,
  buildYahooSearchRankingUrl,
  discoverYahooRankingUrl,
  discoverKojimaRankingUrl,
  discoverAmazonRankingUrl,
  discoverRakutenRankingUrl,
  discoverRankingUrlsWithGemini,
  resolveCategoryRankingUrls,
  resolveRankingUrls,
  applyManualRankingUrls,
  hasProvidedRankingUrls,
  isAmazonBestsellerUrl,
  getRankingThemePresets,
  getDefaultRankingThemeSelection,
  buildArticleRankingThemes,
  hasUserSecondaryThemes,
  presetToRankingTheme,
  normalizeRankingThemesInput,
  fetchCategoryRankings,
  extractModelKey,
  buildCompositeRanking,
  buildThemedRankings,
  buildRankingsCsv,
  buildCompositeRankingsCsv,
  buildThemedRankingsCsv,
  writeRankingsCsv,
  writeCompositeRankingsCsv,
  writeThemedRankingsCsv,
  extractAmazonRankingRows,
  extractRakutenRankingRows,
  extractYahooRankingRows,
  extractKojimaNetRankingRows,
  extractBicCameraRankingRows,
  buildBicCorporateRankingUrl,
};
