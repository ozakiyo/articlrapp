'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { parseJsonFromModelOutput } = require('./parseModelJson');

const KOJIMA_ORIGIN = 'https://www.kojima.net';

/** refrigerator.html / mixer.html と同型の記事用CSS（出力HTMLにインライン） */
let kojimaFeatureArticleCssCache = null;
function getKojimaFeatureArticleStyleTag() {
  if (kojimaFeatureArticleCssCache == null) {
    const cssPath = path.join(__dirname, 'public', 'css', 'kojima-feature-article.css');
    try {
      kojimaFeatureArticleCssCache = fs.readFileSync(cssPath, 'utf8').trim();
    } catch (err) {
      console.warn('⚠️ kojima-feature-article.css を読めません:', err.message);
      kojimaFeatureArticleCssCache = '';
    }
  }
  if (!kojimaFeatureArticleCssCache) return '';
  return `<style type="text/css">\n${kojimaFeatureArticleCssCache}\n</style>`;
}

function productKey(p) {
  return String(p?.modelKey || p?.modelCode || p?.id || `${p?.manufacturer || ''}|${p?.productName || ''}`).trim();
}

function hasKojimaStock(p) {
  return p?.rankKojima != null || Boolean(p?.hrefKojima);
}

/**
 * カテゴリのコジマ人気ランキングURL。保存済みがあれば優先、なければ keyword 検索。
 */
function resolveKojimaRankingUrl(category, rankingUrlOverride) {
  const override = String(rankingUrlOverride || '').trim();
  if (override) return override;
  const cat = String(category || '').trim();
  if (!cat) return `${KOJIMA_ORIGIN}/ec/ranking.html`;
  return `${KOJIMA_ORIGIN}/ec/ranking.html?keyword=${encodeURIComponent(cat)}`;
}

/**
 * コジマ商品詳細HTMLから完売・取扱終了っぽいかを判定する。
 */
function isKojimaProductPageSoldOut(html) {
  const raw = String(html || '');
  if (!raw.trim()) return false;
  const $ = cheerio.load(raw);
  $('script, style, noscript, iframe').remove();
  const zoneText = [
    $('.cart').text(),
    $('.buy').text(),
    $('#cart').text(),
    $('[class*="cart"]').first().text(),
    $('[class*="stock"]').text(),
    $('[class*="zaiko"]').text(),
    $('[id*="stock"]').text(),
    $('.btn_cart').text(),
    $('.item_detail').text(),
    $('.prod_detail').text(),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const mainText = (
    $('#contents').text() ||
    $('#content').text() ||
    $('main').text() ||
    $('body').text() ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);

  const strong =
    /現在完売|完売しました|完売につき|売り切れました|現在お取り扱いできません|この商品は現在販売しておりません|カートに入れられません|取扱[い]?終了|販売終了/;
  const soft = /完売|売り切れ|売切れ|品切れ|在庫なし|在庫切れ/;

  if (zoneText && (strong.test(zoneText) || soft.test(zoneText))) return true;
  if (strong.test(mainText)) return true;
  if (soft.test(mainText.slice(0, 2500))) return true;
  if (/入荷待ち/.test(mainText) && /カート/.test(mainText) && /(できません|不可|受付停止)/.test(mainText)) {
    return true;
  }
  return false;
}

async function fetchKojimaProductHtml(product, fetchHtml, prefetchedHtml) {
  if (prefetchedHtml) return String(prefetchedHtml);
  const href = String(product?.hrefKojima || '').trim();
  if (!href || typeof fetchHtml !== 'function') return '';
  try {
    return String(await fetchHtml(href) || '');
  } catch (err) {
    console.warn('⚠️ Kojima product page fetch failed:', err.message);
    return '';
  }
}

function sortKojimaRankingProducts(items) {
  return filterKojimaProducts(items)
    .slice()
    .sort((a, b) => {
      const ra = Number.isFinite(Number(a.rankKojima)) ? Number(a.rankKojima) : 9999;
      const rb = Number.isFinite(Number(b.rankKojima)) ? Number(b.rankKojima) : 9999;
      if (ra !== rb) return ra - rb;
      return String(a.label || a.productName || '').localeCompare(
        String(b.label || b.productName || ''),
        'ja'
      );
    });
}

function productLookupKeys(p) {
  return [
    String(p?.modelKey || '').trim(),
    String(p?.modelCode || '').trim(),
    String(p?.modelCode || p?.modelKey || '').trim().toUpperCase(),
    productCacheKey(p),
    productKey(p),
    String(p?.hrefKojima || '').trim(),
  ].filter(Boolean);
}

/**
 * 週次 composite 等のカタログから hrefKojima などを補完する。
 */
function enrichProductsWithKojimaUrls(products, catalog = []) {
  const byKey = new Map();
  for (const c of catalog || []) {
    for (const k of productLookupKeys(c)) {
      if (!byKey.has(k)) byKey.set(k, c);
    }
  }
  return (products || []).map((p) => {
    if (String(p?.hrefKojima || '').trim()) return p;
    let hit = null;
    for (const k of productLookupKeys(p)) {
      hit = byKey.get(k);
      if (hit) break;
    }
    if (!hit) return p;
    return {
      ...p,
      hrefKojima: p.hrefKojima || hit.hrefKojima || '',
      hrefAmazon: p.hrefAmazon || hit.hrefAmazon || '',
      hrefRakuten: p.hrefRakuten || hit.hrefRakuten || '',
      hrefYahoo: p.hrefYahoo || hit.hrefYahoo || '',
      hrefBic: p.hrefBic || hit.hrefBic || '',
      rankKojima: p.rankKojima ?? hit.rankKojima ?? null,
      label:
        p.label ||
        hit.label ||
        [hit.manufacturer, hit.productName || hit.representativeModel, hit.modelCode]
          .filter(Boolean)
          .join(' '),
    };
  });
}

function countKojimaUrls(products) {
  return (products || []).filter((p) => String(p?.hrefKojima || '').trim()).length;
}

function productIdentityKey(p) {
  return (
    productCacheKey(p) ||
    productKey(p) ||
    String(p?.hrefKojima || '').trim() ||
    String(p?.key || '').trim()
  );
}

/**
 * 完売商品の差し替え先として、コジマ人気ランキング上位から在庫あり候補を選ぶ。
 */
async function pickAvailableRankingReplacement({
  original,
  rankingProducts,
  usedKeys,
  fetchHtml,
  maxChecks = 8,
}) {
  const origKey = productIdentityKey(original);
  const origHref = String(original?.hrefKojima || '').trim();
  const used = usedKeys instanceof Set ? usedKeys : new Set();
  const candidates = sortKojimaRankingProducts(rankingProducts || []);
  let checked = 0;

  for (const cand of candidates) {
    const key = productIdentityKey(cand);
    if (!key || key === origKey) continue;
    if (origHref && String(cand.hrefKojima || '').trim() === origHref) continue;
    if (used.has(key)) continue;
    if (!String(cand.hrefKojima || '').trim()) continue;

    checked += 1;
    if (checked > maxChecks) break;

    const html = await fetchKojimaProductHtml(cand, fetchHtml);
    if (html && isKojimaProductPageSoldOut(html)) continue;

    return {
      product: {
        ...cand,
        _key: key,
        label:
          cand.label ||
          [cand.manufacturer, cand.productName || cand.representativeModel, cand.modelCode]
            .filter(Boolean)
            .join(' '),
      },
      productHtml: html,
      key,
    };
  }
  return null;
}

/**
 * 商品詳細の取得と完売判定（CTAは商品詳細のみ。完売時の誘導はしない）。
 */
async function resolveProductCtaLink({ product, fetchHtml, prefetchedHtml }) {
  const detailUrl = String(product?.hrefKojima || '').trim();
  const fallbackLabel = '商品詳細はこちら';
  const productHtml = await fetchKojimaProductHtml(product, fetchHtml, prefetchedHtml);
  const soldOut = detailUrl
    ? productHtml
      ? isKojimaProductPageSoldOut(productHtml)
      : false
    : true;

  return {
    ctaUrl: detailUrl,
    linkLabel: fallbackLabel,
    linkSoldOut: false,
    soldOut,
    detailUrl,
    productHtml,
  };
}

function dummyProductImageUrl(seed) {
  const s = String(seed || 'product')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 48) || 'product';
  return `https://picsum.photos/seed/kojima-${encodeURIComponent(s)}/480/480`;
}

function absolutizeKojimaUrl(src) {
  const s = String(src || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `${KOJIMA_ORIGIN}${s}`;
  return `${KOJIMA_ORIGIN}/${s.replace(/^\//, '')}`;
}

function extractKojimaProdCode(url) {
  const u = String(url || '');
  const m = /[?&](?:prod|sku)=(\d{8,14})/i.exec(u);
  return m ? m[1] : '';
}

/** コジマCDNの定番パス（JAN / prod コードから推定） */
function buildKojimaCdnImageUrl(prodCode) {
  const jan = String(prodCode || '').replace(/\D/g, '');
  if (jan.length < 8) return '';
  const p6 = jan.slice(0, 6);
  const p9 = jan.slice(0, Math.min(9, jan.length));
  return `${KOJIMA_ORIGIN}/ito/img_public/prod/${p6}/${p9}/${jan}/IMG_PATH_L/pc/${jan}_A01.jpg`;
}

/**
 * コジマ商品詳細 or CDN から画像URLを取得。見つからなければダミー。
 * @returns {Promise<{ url: string, source: string, isDummy: boolean }>}
 */
async function resolveKojimaProductImage({ product, fetchHtml, html: prefetchedHtml }) {
  const href = String(product?.hrefKojima || '').trim();
  const seed = productCacheKey(product) || product?.label || product?.productName || 'product';
  const dummy = dummyProductImageUrl(seed);

  if (product?.imageUrl && /^https?:\/\//i.test(String(product.imageUrl))) {
    return { url: String(product.imageUrl).trim(), source: 'product', isDummy: false };
  }

  let html = String(prefetchedHtml || '');
  if (!html && href && typeof fetchHtml === 'function') {
    try {
      html = await fetchHtml(href);
    } catch (err) {
      console.warn('⚠️ Kojima product image scrape failed:', err.message);
    }
  }

  if (html) {
    try {
      const $ = cheerio.load(String(html || ''));
      const candidates = [
        $('meta[property="og:image"]').attr('content'),
        $('meta[name="thumbnail"]').attr('content'),
        $('img[src*="img_public/prod"]').first().attr('src'),
        $('img[src*="IMG_PATH"]').first().attr('src'),
        $('img[src*="/ito/img"]').first().attr('src'),
      ];
      for (const c of candidates) {
        const abs = absolutizeKojimaUrl(c);
        if (abs && !/noimage|spacer|blank|1x1/i.test(abs)) {
          return { url: abs, source: 'kojima-detail', isDummy: false, html };
        }
      }
    } catch (err) {
      console.warn('⚠️ Kojima product image parse failed:', err.message);
    }
  }

  const cdn = buildKojimaCdnImageUrl(extractKojimaProdCode(href));
  if (cdn) {
    return { url: cdn, source: 'kojima-cdn', isDummy: false, html };
  }

  return { url: dummy, source: 'dummy', isDummy: true, html };
}

function filterKojimaProducts(items) {
  return (items || []).filter(hasKojimaStock).map((p, i) => ({
    ...p,
    _key: productKey(p) || `p-${i}`,
    label: formatProductTitle(p) || p.label || '',
  }));
}

function compactProductForPrompt(p) {
  return {
    key: p._key || productKey(p),
    manufacturer: p.manufacturer || null,
    productName: p.productName || p.label || null,
    modelCode: p.modelCode || p.modelKey || null,
    rankKojima: p.rankKojima ?? null,
    rankAmazon: p.rankAmazon ?? null,
    rankRakuten: p.rankRakuten ?? null,
    compositeRank: p.compositeRank ?? p.rank ?? null,
    hrefKojima: p.hrefKojima || null,
  };
}

/** 商品タイトル: メーカー （あれば「シリーズ名」） 型式 */
function resolveProductModel(product) {
  const code = String(
    product?.modelCode || product?.modelKey || product?.model || ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (code) return code;
  const rep = String(product?.representativeModel || '').replace(/\s+/g, ' ').trim();
  // 長い商品名は型式として使わない
  if (rep && rep.length <= 36 && !/\s/.test(rep)) return rep;
  return '';
}

function normalizeSeriesName(raw, manufacturer, model) {
  let s = String(raw || '')
    .trim()
    .replace(/^[「『"'“”]+|[」』"'“”]+$/g, '')
    .trim();
  if (!s) return '';
  const maker = String(manufacturer || '').trim();
  const modelCode = String(model || '').trim();
  if (maker) {
    s = s.replace(new RegExp(maker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim();
  }
  if (modelCode) {
    s = s
      .replace(new RegExp(modelCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
      .trim();
  }
  s = s
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[【\[][^】\]]*[】\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length < 2 || s.length > 28) return '';
  if (/^\d+$/.test(s)) return '';
  if (/おすすめ|限定|特価|レビュー/.test(s)) return '';
  return s;
}

function formatProductTitle(product, seriesName) {
  const manufacturer = String(product?.manufacturer || '').trim();
  const model = resolveProductModel(product);
  const series = normalizeSeriesName(
    seriesName != null ? seriesName : product?.seriesName || product?.series || '',
    manufacturer,
    model
  );
  const parts = [];
  if (manufacturer) parts.push(manufacturer);
  if (series) parts.push(`「${series}」`);
  if (model) parts.push(model);
  if (parts.length) return parts.join(' ');
  return String(product?.label || product?.productName || '').trim();
}

async function runGeminiJson(getGeminiModel, prompt, label) {
  const model = await getGeminiModel();
  const provider = model?.provider || 'unknown';
  console.log(`🧠 [${label}] ${provider} generateContent`);
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  const raw = result.response?.text?.() || '';
  try {
    return parseJsonFromModelOutput(raw);
  } catch (err) {
    const preview = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    throw new Error(
      `${provider} JSON抽出失敗 (${label}): ${err.message}${preview ? ` / 出力先頭: ${preview}` : ' / 出力空'}`
    );
  }
}

/**
 * AIが用途をちょうど3つ提案
 */
async function proposeUseCases({ category, products, getGeminiModel }) {
  const kojima = filterKojimaProducts(products);
  const sample = kojima.slice(0, 40).map(compactProductForPrompt);
  const prompt = `
あなたは家電量販店コジマの担当者です。カテゴリ「${category}」の売れ筋商品を、購入シーン・用途でちょうど3つに分けてください。

# 商品サンプル（コジマ取扱）
${JSON.stringify(sample, null, 2)}

# 出力（厳密にJSONのみ）
{
  "useCases": [
    {
      "id": "uc1",
      "label": "用途名（例: 一人暮らし・自炊派）",
      "rationale": "なぜこの切り口か（1文）",
      "buyerHint": "想定読者（短く）"
    }
  ]
}

# 制約
- useCases は必ず3件
- ラベルは記事見出しに使える短い日本語（「〜向け」「〜用」など）
- 重複する切り口にしない
- 商品が振り分けやすい具体的な用途にする
`;

  const data = await runGeminiJson(getGeminiModel, prompt, 'proposeUseCases');
  const useCases = Array.isArray(data?.useCases) ? data.useCases.slice(0, 3) : [];
  while (useCases.length < 3) {
    useCases.push({
      id: `uc${useCases.length + 1}`,
      label: `用途${useCases.length + 1}`,
      rationale: '',
      buyerHint: '',
    });
  }
  return {
    useCases: useCases.map((u, i) => ({
      id: String(u.id || `uc${i + 1}`),
      label: String(u.label || `用途${i + 1}`).trim(),
      rationale: String(u.rationale || '').trim(),
      buyerHint: String(u.buyerHint || '').trim(),
    })),
    kojimaCount: kojima.length,
    productCount: (products || []).length,
  };
}

/**
 * 確定した用途ごとにコジマ商品を最大3選
 */
async function assignProductsToUseCases({ useCases, products, getGeminiModel }) {
  const kojima = filterKojimaProducts(products);
  if (!kojima.length) {
    return {
      assignments: (useCases || []).map((uc) => ({
        useCaseId: uc.id,
        label: uc.label,
        products: [],
        warning: 'コジマ取扱商品がランキングにありません',
      })),
      kojimaCount: 0,
    };
  }

  const prompt = `
カテゴリの売れ筋（コジマ取扱のみ）を、用途ごとに担当者おすすめ最大3商品へ振り分けてください。

# 用途
${JSON.stringify(useCases, null, 2)}

# 商品一覧
${JSON.stringify(kojima.map(compactProductForPrompt), null, 2)}

# 出力（厳密にJSONのみ）
{
  "assignments": [
    {
      "useCaseId": "uc1",
      "productKeys": ["key1", "key2", "key3"],
      "reasons": ["選んだ理由1", "選んだ理由2", "選んだ理由3"]
    }
  ]
}

# 制約
- 各用途の productKeys は最大3・できれば3
- 同一商品の重複は可能な限り避ける（全体でユニーク優先）
- 型番・メーカーが用途に合うものを優先
- productKeys は入力の key と完全一致
`;

  const data = await runGeminiJson(getGeminiModel, prompt, 'assignProducts');
  const byKey = new Map(kojima.map((p) => [p._key, p]));
  const used = new Set();

  const assignments = (useCases || []).map((uc) => {
    const row = (data?.assignments || []).find((a) => a.useCaseId === uc.id) || {};
    const keys = Array.isArray(row.productKeys) ? row.productKeys : [];
    const reasons = Array.isArray(row.reasons) ? row.reasons : [];
    const picked = [];
    for (const key of keys) {
      if (picked.length >= 3) break;
      const p = byKey.get(String(key));
      if (!p || used.has(p._key)) continue;
      used.add(p._key);
      picked.push({
        ...compactProductForPrompt(p),
        label: p.label,
        reason: reasons[picked.length] || '',
        hrefKojima: p.hrefKojima || null,
      });
    }
    // 足りなければ未使用のコジマ商品で埋める
    if (picked.length < 3) {
      for (const p of kojima) {
        if (picked.length >= 3) break;
        if (used.has(p._key)) continue;
        used.add(p._key);
        picked.push({
          ...compactProductForPrompt(p),
          label: p.label,
          reason: 'ランキング上位のコジマ取扱品で補完',
          hrefKojima: p.hrefKojima || null,
        });
      }
    }
    return {
      useCaseId: uc.id,
      label: uc.label,
      rationale: uc.rationale || '',
      products: picked,
      warning: picked.length < 3 ? `商品が${picked.length}件のみです` : null,
    };
  });

  return { assignments, kojimaCount: kojima.length };
}

/** メーカー公式以外（販売店・価格比較）を除外 */
function isRetailerOrMarketplaceUrl(url) {
  return /amazon\.|rakuten\.|yahoo\.co\.jp|shopping\.yahoo|kojima\.net|biccamera\.|yodobashi\.|kakaku\.com|joshin\.|edion\.|yamada|bestbuy|mercari/i.test(
    String(url || '')
  );
}

function manufacturerDomainHint(manufacturer) {
  const m = String(manufacturer || '').trim();
  if (!m) return '';
  const map = [
    [/パナソニック|Panasonic/i, 'panasonic.jp'],
    [/シャープ|Sharp/i, 'jp.sharp / sharp.co.jp'],
    [/日立|HITACHI|Hitachi/i, 'hitachi.co.jp / hitachi-gls.co.jp'],
    [/東芝|TOSHIBA|Toshiba/i, 'toshiba / toshiba-lifestyle'],
    [/三菱電機|三菱|Mitsubishi/i, 'mitsubishielectric.co.jp'],
    [/アイリスオーヤマ|IRIS/i, 'irisohyama.co.jp'],
    [/ダイキン|Daikin/i, 'daikin.co.jp'],
    [/ソニー|Sony/i, 'sony.jp'],
    [/サムスン|Samsung/i, 'samsung.com/jp'],
    [/LG/i, 'lg.com/jp'],
    [/バルミューダ|BALMUDA/i, 'balmuda.com'],
    [/ダイソン|Dyson/i, 'dyson.co.jp'],
    [/エレクトロラックス|Electrolux/i, 'electrolux.jp / electrolux.co.jp'],
    [/ハイアール|Haier/i, 'haier.com'],
    [/アクア|AQUA/i, 'aqua-washer / hisense'],
    [/ハイセンス|Hisense/i, 'hisense'],
    [/富士通|Fujitsu/i, 'fujitsu-general.com'],
    [/コロナ|CORONA/i, 'corona.co.jp'],
    [/象印|ZOJIRUSHI/i, 'zojirushi.co.jp'],
    [/タイガー|TIGER/i, 'tiger.jp'],
    [/シロカ|siroca/i, 'siroca.co.jp'],
    [/レコルト|recolte/i, 'recolte.jp'],
    [/タニタ|TANITA/i, 'tanita.co.jp'],
    [/オムロン|OMRON/i, 'omronconnectivity / healthcare.omron / omron.co.jp'],
    [/エレコム|ELECOM/i, 'elecom.co.jp'],
    [/ドリテック|dretec/i, 'dretec.co.jp'],
    [/エー・アンド・デイ|A&D|AND /i, 'aandd.co.jp'],
    [/Withings/i, 'withings.com'],
    [/Eufy|Anker/i, 'eufy / ankerjapan'],
    [/シチズン|CITIZEN/i, 'citizen.co.jp'],
    [/山善|YAMAZEN/i, 'yamazen.co.jp'],
  ];
  for (const [re, hint] of map) {
    if (re.test(m)) return hint;
  }
  return '';
}

/** ドメインヒントから site: 用のホスト候補を抜く */
function manufacturerSiteHosts(manufacturer) {
  const hint = manufacturerDomainHint(manufacturer);
  if (!hint) return [];
  return hint
    .split(/[\s/]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('.') && !s.includes(' '));
}

function extractSerpUrls(html) {
  const $ = cheerio.load(String(html || ''));
  const urls = [];
  const seen = new Set();
  const push = (raw) => {
    let target = String(raw || '').trim();
    if (!target) return;
    try {
      if (target.includes('uddg=')) {
        const abs = target.startsWith('http')
          ? target
          : `https://duckduckgo.com${target.startsWith('/') ? '' : '/'}${target}`;
        target = decodeURIComponent(new URL(abs).searchParams.get('uddg') || '');
      }
      if (!/^https?:\/\//i.test(target)) return;
      const u = new URL(target);
      const normalized = `${u.origin}${u.pathname}`.replace(/\/$/, '');
      if (seen.has(normalized) || isRetailerOrMarketplaceUrl(normalized)) return;
      if (/duckduckgo|bing\.com|google\./i.test(u.hostname)) return;
      seen.add(normalized);
      urls.push(normalized);
    } catch {
      /* ignore */
    }
  };
  $('a.result__a').each((_, el) => push($(el).attr('href') || ''));
  if (!urls.length) {
    const re = /uddg=(https?%3A%2F%2F[^&"']+)/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      try {
        push(decodeURIComponent(m[1]));
      } catch {
        /* ignore */
      }
    }
  }
  return urls;
}

/**
 * DuckDuckGo でメーカー公式製品ページ候補を探す
 */
async function searchManufacturerPageUrls({ product, fetchHtml }) {
  if (typeof fetchHtml !== 'function') return [];
  const manufacturer = String(product?.manufacturer || '').trim();
  const model = String(product?.modelCode || product?.modelKey || '').trim();
  const name = String(product?.productName || product?.label || '').trim();
  const hosts = manufacturerSiteHosts(manufacturer);
  const queries = [];
  if (hosts[0] && model) queries.push(`site:${hosts[0]} ${model}`);
  if (manufacturer && model) queries.push(`${manufacturer} ${model} 仕様 公式`);
  if (manufacturer && model) queries.push(`${manufacturer} ${model} 製品`);
  if (manufacturer && name) queries.push(`${manufacturer} ${name} 公式`);
  if (!queries.length && name) queries.push(`${name} メーカー 公式 仕様`);

  const found = [];
  const seen = new Set();
  for (const q of queries.slice(0, 3)) {
    try {
      const serpUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      console.log('🔎 maker SERP:', q);
      // eslint-disable-next-line no-await-in-loop
      const html = await fetchHtml(serpUrl);
      for (const url of extractSerpUrls(html)) {
        if (seen.has(url)) continue;
        // ドメインヒントがある場合は優先フィルタ（緩く）
        if (hosts.length) {
          const hostOk = hosts.some((h) => url.includes(h.replace(/^www\./, '')));
          if (!hostOk && found.length >= 2) continue;
        }
        seen.add(url);
        found.push(url);
      }
      if (found.length >= 4) break;
    } catch (err) {
      console.warn('maker SERP failed:', q, err.message);
    }
  }
  return found.slice(0, 5);
}

function isBlankFeatureValue(value) {
  const v = String(value || '')
    .trim()
    .replace(/\s+/g, '');
  return !v || v === '—' || v === '-' || v === 'ー' || v === '−' || v === 'なし' || v === '不明';
}

function featureFillScore(rows) {
  return (rows || []).filter((r) => !isBlankFeatureValue(r?.value)).length;
}

function pickBetterFeatureRows(primary, secondary, labels) {
  const a = normalizeFeatureRows(primary || [], labels);
  const b = normalizeFeatureRows(secondary || [], labels);
  const scoreA = featureFillScore(a);
  const scoreB = featureFillScore(b);
  if (scoreA === 0 && scoreB === 0) return a;
  if (scoreA >= scoreB) {
    // primary の空欄だけ secondary で補完
    return a.map((row, i) =>
      isBlankFeatureValue(row.value) && b[i] && !isBlankFeatureValue(b[i].value)
        ? { label: row.label, value: b[i].value }
        : row
    );
  }
  return b.map((row, i) =>
    isBlankFeatureValue(row.value) && a[i] && !isBlankFeatureValue(a[i].value)
      ? { label: row.label, value: a[i].value }
      : row
  );
}

function looksLikeLowQualityScrape(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 250) return true;
  const lower = t.toLowerCase();
  const junkHits = [
    'cookie',
    'クッキー',
    '同意する',
    'access denied',
    'just a moment',
    'captcha',
    'ロボット',
    'enable javascript',
  ].filter((w) => lower.includes(w)).length;
  const uniqueRatio = new Set(t.split(' ').filter(Boolean)).size / Math.max(t.split(' ').length, 1);
  return junkHits >= 2 || uniqueRatio < 0.12;
}

async function resolveManufacturerPageUrl({ product, getGeminiModel }) {
  const domainHint = manufacturerDomainHint(product?.manufacturer);
  const prompt = `
家電メーカーの公式サイト上の、次の商品の製品仕様・製品情報ページURLを最大3つ候補で挙げてください。
コジマ・Amazon・楽天・Yahoo・ビック・ヨドバシ・価格.com など販売店・価格比較サイトのURLは禁止です。
確からしい順に並べ、不確かな場合は urls を空配列に。

# 商品
${JSON.stringify(compactProductForPrompt(product), null, 2)}

# メーカー公式ドメインのヒント（あればこの系統を優先）
${domainHint || '（特になし。メーカー公式ドメインを推定）'}

# 出力（厳密にJSONのみ）
{
  "urls": ["https://...", "https://..."],
  "url": "https://...（最有力1件。urls[0]と同じで可）",
  "confidence": "high|medium|low",
  "note": "短い補足"
}
`;
  const data = await runGeminiJson(getGeminiModel, prompt, 'resolveMakerUrl');
  const urls = [];
  const pushUrl = (u) => {
    const url = String(u || '').trim();
    if (!/^https?:\/\//i.test(url) || isRetailerOrMarketplaceUrl(url)) return;
    if (!urls.includes(url)) urls.push(url);
  };
  if (Array.isArray(data?.urls)) data.urls.forEach(pushUrl);
  pushUrl(data?.url);
  return {
    url: urls[0] || null,
    urls,
    confidence: data?.confidence || (urls.length ? 'medium' : 'low'),
    note: data?.note || (urls.length ? '' : 'メーカー公式URLを特定できませんでした'),
  };
}

/**
 * メーカー公式ページを複数候補からスクレイプして本文を集める
 */
async function gatherManufacturerFacts({
  product,
  forcedUrl,
  scrape,
  fetchHtml,
  getGeminiModel,
}) {
  const tried = [];
  const candidates = [];
  const forced = String(forcedUrl || product?.manufacturerUrl || '').trim();
  if (forced && !isRetailerOrMarketplaceUrl(forced)) candidates.push(forced);

  // 検索で公式ページを先に拾う（Geminiの幻覚URLより実在しやすい）
  try {
    const searched = await searchManufacturerPageUrls({ product, fetchHtml });
    for (const u of searched) candidates.push(u);
  } catch (err) {
    console.warn('searchManufacturerPageUrls:', err.message);
  }

  let urlMeta = null;
  try {
    urlMeta = await resolveManufacturerPageUrl({ product, getGeminiModel });
    for (const u of urlMeta.urls || []) candidates.push(u);
    if (urlMeta.url) candidates.push(urlMeta.url);
  } catch (err) {
    urlMeta = { url: null, urls: [], confidence: 'low', note: String(err?.message || err) };
  }

  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  let best = {
    text: '',
    error: uniqueCandidates.length ? null : 'メーカーURL未設定',
    charCount: 0,
    url: null,
  };

  for (const url of uniqueCandidates.slice(0, 5)) {
    tried.push(url);
    try {
      // eslint-disable-next-line no-await-in-loop
      const scraped = await scrapeManufacturerFacts({ url, scrape, maxChars: 14000 });
      const text = String(scraped.text || '').trim();
      const charCount = text.length;
      const low = looksLikeLowQualityScrape(text);
      console.log(
        `📄 maker scrape ${charCount} chars quality=${low ? 'low' : 'ok'} ${url}`
      );
      if (charCount > best.charCount && !low) {
        best = { text, error: null, charCount, url };
        if (charCount >= 800) break;
      } else if (charCount > best.charCount) {
        best = { text, error: scraped.error || '本文品質が低い', charCount, url };
      }
    } catch (err) {
      console.warn('maker scrape failed:', url, err.message);
    }
  }

  return {
    ...best,
    manufacturerUrl: best.url || uniqueCandidates[0] || null,
    urlMeta,
    triedUrls: tried,
  };
}

/**
 * 商品名・型番から埋められる項目をヒューリスティックに補完（体重計など）
 */
function heuristicFeatureRowsFromProduct(category, product, featureLabels) {
  const labels =
    Array.isArray(featureLabels) && featureLabels.length
      ? featureLabels
      : defaultFeatureLabelsForCategory(category);
  const blob = [
    product?.label,
    product?.productName,
    product?.representativeModel,
    product?.modelCode,
    product?.manufacturer,
  ]
    .filter(Boolean)
    .join(' ');
  const rows = labels.map((label) => ({ label, value: '—' }));
  const setIf = (pred, labelSubstr, value) => {
    const idx = rows.findIndex((r) => r.label.includes(labelSubstr));
    if (idx >= 0 && isBlankFeatureValue(rows[idx].value) && pred) {
      rows[idx].value = value;
    }
  };

  if (/体重計|体組成|体脂肪|ヘルスメーター/i.test(String(category || '')) || /体組成|体脂肪|体重計/i.test(blob)) {
    const measures = [];
    if (/体重/.test(blob) || /体組成|体脂肪|体重計/.test(blob) || /体重計|体組成/.test(String(category || ''))) {
      measures.push('体重');
    }
    if (/体脂肪/.test(blob) || /体組成/.test(String(category || ''))) measures.push('体脂肪率');
    if (/筋肉/.test(blob)) measures.push('筋肉量');
    if (/骨量|骨/.test(blob)) measures.push('骨量');
    if (/水分/.test(blob)) measures.push('体水分率');
    if (/BMI/i.test(blob)) measures.push('BMI');
    if (/内臓脂肪/.test(blob)) measures.push('内臓脂肪レベル');
    if (/基礎代謝/.test(blob)) measures.push('基礎代謝量');
    // カテゴリが体組成計なら最低限
    if (!measures.length && /体組成/.test(String(category || ''))) {
      measures.push('体重', '体脂肪率');
    }
    if (measures.length) {
      setIf(true, '測定', [...new Set(measures)].join('・'));
    }
    if (/Bluetooth|ブルートゥース|アプリ|スマホ|スマートフォン|Wi-?Fi/i.test(blob)) {
      setIf(true, 'スマホ', 'あり（アプリ連携）');
    }
  }
  return rows;
}

/**
 * 公式ページ本文が取れないときのフォールバック。
 * 型番が特定できる場合、メーカー公式として一般公開されている仕様で埋める。
 */
async function fillFeatureRowsFromOfficialModelKnowledge({
  category,
  product,
  featureLabels,
  getGeminiModel,
}) {
  const labels =
    Array.isArray(featureLabels) && featureLabels.length
      ? featureLabels
      : defaultFeatureLabelsForCategory(category);
  const modelCode = String(product?.modelCode || product?.modelKey || '').trim();
  const manufacturer = String(product?.manufacturer || '').trim();
  if (!modelCode && !manufacturer) {
    return heuristicFeatureRowsFromProduct(category, product, labels);
  }

  const prompt = `
あなたはメーカー公式スペック記入係です。
次の商品について、メーカー公式サイト／公式カタログで公開されている仕様として一般に知られている内容で機能表を埋めてください。
販売店（コジマ・Amazon・楽天等）の独自表記は使わないでください。

重要:
- 型番が分かる場合、その型番の公式仕様を優先して具体値を書く（全部「—」にしない）
- 体重計・体組成計なら測定項目・スマホ連携・サイズ・最小表示・登録人数をできるだけ埋める
- 本当に分からない項目だけ「—」
- 値は短く（例: 「体重・体脂肪率・筋肉量」「Bluetooth」「約300×300×28mm」「100g単位」「5人」）

# カテゴリ
${category}

# 商品
${JSON.stringify(compactProductForPrompt(product), null, 2)}

# 機能表ラベル（この順序で values）
${JSON.stringify(labels, null, 2)}

# 出力（厳密にJSONのみ）
{ "values": ["値1", "値2", "値3", "値4", "値5"], "note": "短い補足" }
`;
  try {
    const data = await runGeminiJson(
      getGeminiModel,
      prompt,
      'fillFeatureRowsFromOfficialModelKnowledge'
    );
    const fromAi = normalizeFeatureRowsFromValues(data?.values, labels);
    const heur = heuristicFeatureRowsFromProduct(category, product, labels);
    return pickBetterFeatureRows(fromAi, heur, labels);
  } catch (err) {
    console.warn('fillFeatureRowsFromOfficialModelKnowledge:', err.message);
    return heuristicFeatureRowsFromProduct(category, product, labels);
  }
}

async function scrapeManufacturerFacts({ url, scrape, maxChars = 12000 }) {
  if (!url) return { text: '', error: 'URLがありません' };
  try {
    const text = await scrape(url, maxChars);
    return {
      text: String(text || '').slice(0, maxChars),
      error: null,
      charCount: String(text || '').length,
    };
  } catch (err) {
    return { text: '', error: err.message || String(err), charCount: 0 };
  }
}

/**
 * 分類（カテゴリ）ごとの機能表項目。同じ分類内の全商品で同じラベル・同じ順序にする。
 * 参考: コジマ冷蔵庫記事 = 容量 / 本体の大きさ / 扉の仕様 / 引出しレイアウト / 年間電気代目安
 */
const FEATURE_SCHEMA_BY_CATEGORY = {
  冷蔵庫: ['容量', '本体の大きさ', '扉の仕様', '引出しレイアウト', '年間電気代目安'],
  洗濯機: ['洗濯容量', '本体の大きさ', '乾燥機能', '洗浄機能', '年間電気代目安'],
  掃除機: ['吸引方式', '本体の大きさ・重さ', '運転時間（充電式の場合）', '主な付属ノズル', '集じん方式'],
  エアコン: ['対応畳数目安', '冷房能力', '暖房能力', '省エネ性能', '主な機能'],
  電子レンジ: ['庫内容量', '本体の大きさ', '出力', '主な調理機能', '庫内の仕様'],
  テレビ: ['画面サイズ', '解像度', 'チューナー', 'スマート機能', '外形寸法'],
  '体重計・体組成計': [
    '主な測定項目',
    'スマホ連携',
    '本体サイズ・厚さ',
    '最小表示単位',
    '登録人数',
  ],
};

function defaultFeatureLabelsForCategory(category) {
  const key = String(category || '').trim();
  if (FEATURE_SCHEMA_BY_CATEGORY[key]) return [...FEATURE_SCHEMA_BY_CATEGORY[key]];
  const hit = Object.keys(FEATURE_SCHEMA_BY_CATEGORY).find((k) => key.includes(k));
  if (hit) return [...FEATURE_SCHEMA_BY_CATEGORY[hit]];
  return ['主なスペック1', '主なスペック2', '主なスペック3', '主なスペック4', '主なスペック5'];
}

/**
 * 分類共通の機能表ラベルを決める（一括生成ではカテゴリにつき1回）
 */
async function resolveFeatureLabels({ category, getGeminiModel }) {
  const key = String(category || '').trim();
  if (FEATURE_SCHEMA_BY_CATEGORY[key]) {
    return [...FEATURE_SCHEMA_BY_CATEGORY[key]];
  }
  const fallback = defaultFeatureLabelsForCategory(category);
  const knownHit = Object.keys(FEATURE_SCHEMA_BY_CATEGORY).find((k) => key.includes(k));
  if (knownHit) return [...FEATURE_SCHEMA_BY_CATEGORY[knownHit]];

  try {
    const prompt = `
家電カテゴリ「${category}」の特集記事で、用途別おすすめの機能表に使う項目名をちょうど5つ決めてください。
同じカテゴリ内の全商品で、同じ項目名・同じ順序を使います。購入比較に効く具体的な項目にしてください。

# 出力（厳密にJSONのみ）
{ "labels": ["項目1", "項目2", "項目3", "項目4", "項目5"] }
`;
    const data = await runGeminiJson(getGeminiModel, prompt, 'resolveFeatureLabels');
    const labels = (Array.isArray(data?.labels) ? data.labels : [])
      .map((l) => String(l || '').trim())
      .filter(Boolean)
      .slice(0, 5);
    return labels.length >= 3 ? labels : fallback;
  } catch (err) {
    console.warn('resolveFeatureLabels fallback:', err.message);
    return fallback;
  }
}

/**
 * 分類共通ラベルに合わせて機能表を揃える（不明は —）
 * ラベルの完全一致に加え、正規化／部分一致でも値を拾う
 */
function normalizeLabelKey(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[・･./／]/g, '')
    .toLowerCase();
}

function normalizeFeatureRows(rows, labels) {
  const list = Array.isArray(labels) && labels.length ? labels : [];
  const byLabel = new Map();
  const byKey = new Map();
  for (const r of rows || []) {
    const label = String(r?.label || '')
      .trim()
      .replace(/\s+/g, ' ');
    const value = String(r?.value || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!label) continue;
    byLabel.set(label, value || '—');
    byKey.set(normalizeLabelKey(label), value || '—');
  }
  if (!list.length) {
    return (rows || [])
      .map((r) => ({
        label: String(r?.label || '').trim(),
        value: String(r?.value || '').trim() || '—',
      }))
      .filter((r) => r.label);
  }
  return list.map((label) => {
    if (byLabel.has(label)) return { label, value: byLabel.get(label) || '—' };
    const key = normalizeLabelKey(label);
    if (byKey.has(key)) return { label, value: byKey.get(key) || '—' };
    for (const [k, v] of byKey.entries()) {
      if (k && key && (k.includes(key) || key.includes(k))) {
        return { label, value: v || '—' };
      }
    }
    return { label, value: '—' };
  });
}

function normalizeFeatureRowsFromValues(values, labels) {
  const list = Array.isArray(labels) && labels.length ? labels : [];
  const vals = Array.isArray(values) ? values : [];
  return list.map((label, i) => ({
    label,
    value: String(vals[i] ?? '')
      .trim()
      .replace(/\s+/g, ' ') || '—',
  }));
}

/**
 * メーカー公式テキストのみを根拠に機能表を埋める（販売店ページは使わない）
 */
async function extractFeatureRowsFromManufacturerFacts({
  category,
  product,
  featureLabels,
  factsText,
  manufacturerUrl,
  getGeminiModel,
}) {
  const labels =
    Array.isArray(featureLabels) && featureLabels.length
      ? featureLabels
      : defaultFeatureLabelsForCategory(category);
  const text = String(factsText || '').trim();
  if (text.length < 80) {
    return labels.map((label) => ({ label, value: '—' }));
  }

  const prompt = `
あなたは家電スペック抽出係です。
次の「メーカー公式ページ本文」だけを根拠に、機能表の値を埋めてください。
コジマ・Amazon・楽天・Yahoo・ビックなど販売店の情報は使いません。

重要:
- 本文に書かれている測定項目・連携・サイズ・表示単位・登録人数などは必ず拾って具体値にする
- 全部を「—」にしない（本文にスペックらしき記述があるなら最低2項目は埋める）
- 本文に本当にない項目だけ「—」

# カテゴリ
${category}

# 商品
${JSON.stringify(compactProductForPrompt(product), null, 2)}

# メーカー公式URL
${manufacturerUrl || '（なし）'}

# メーカー公式ページ本文
${text.slice(0, 12000)}

# 機能表ラベル（この順序・この件数で values を返す）
${JSON.stringify(labels, null, 2)}

# 出力（厳密にJSONのみ）
{
  "values": ["値1", "値2", "値3", "値4", "値5"]
}

# 制約
- values の件数はラベル数と完全一致
- 値は短く具体的に（単位があれば残す）
- ラベル名は返さない（values のみ）
`;

  try {
    const data = await runGeminiJson(
      getGeminiModel,
      prompt,
      'extractFeatureRowsFromManufacturerFacts'
    );
    return normalizeFeatureRowsFromValues(data?.values, labels);
  } catch (err) {
    console.warn('extractFeatureRowsFromManufacturerFacts:', err.message);
    return labels.map((label) => ({ label, value: '—' }));
  }
}

function productCacheKey(product) {
  return String(
    product?.key ||
      product?._key ||
      product?.modelKey ||
      product?.modelCode ||
      `${product?.manufacturer || ''}|${product?.productName || product?.label || ''}`
  ).trim();
}

/**
 * 説明文・見出しを生成（機能表はメーカー公式抽出結果を渡す）
 */
async function generateProductCopy({
  category,
  useCase,
  product,
  factsText,
  manufacturerUrl,
  getGeminiModel,
  featureLabels,
  featureRows: presetFeatureRows,
}) {
  const labels =
    Array.isArray(featureLabels) && featureLabels.length
      ? featureLabels
      : defaultFeatureLabelsForCategory(category);
  const labelsJson = JSON.stringify(labels, null, 2);
  const presetNormalized =
    Array.isArray(presetFeatureRows) && presetFeatureRows.length
      ? normalizeFeatureRows(presetFeatureRows, labels)
      : null;
  const usablePreset =
    presetNormalized && featureFillScore(presetNormalized) > 0 ? presetNormalized : null;
  const hasFacts = Boolean(factsText && String(factsText).trim().length >= 80);

  const prompt = `
あなたはコジマネットの家電特集記事ライターです。
参考形式（冷蔵庫記事）に合わせ、用途別おすすめ1商品の原稿を作ってください。
スペック・機能の根拠はメーカー公式テキスト（またはメーカー公式として公開されている仕様）です。販売店ページの情報は使いません。

# カテゴリ
${category}

# 用途
${JSON.stringify(useCase || {}, null, 2)}

# 商品
${JSON.stringify(compactProductForPrompt(product), null, 2)}

# メーカー公式から取得したテキスト（根拠）
${factsText ? factsText.slice(0, 10000) : '（取得なし）'}

# メーカー公式URL
${manufacturerUrl || '（なし）'}

${
  usablePreset
    ? `# 機能表（メーカー公式から抽出済み。説明文と矛盾させない）\n${JSON.stringify(usablePreset, null, 2)}\n`
    : `# 機能表ラベル（featureValues をこの順序で埋める。本文や公式仕様から具体値を書く）\n${labelsJson}\n`
}

# 出力（厳密にJSONのみ）
{
  "seriesName": "シリーズ名のみ（不明なら空文字。メーカー名・型式・スペックは書かない）",
  "heading": "（サーバ側で組み立てるため空でよい）",
  "conclusion": "この商品の答えになる1文（35〜45字・句点で終える。ラベルは書かない）",
  "suitableFor": "向いている人を自然な一文で（例: 一人暮らしで静音を重視する方に向いています。ラベルは書かない）",
  "description": "先頭段落に conclusion と同じ文 → 空行 → 続き1〜2文。suitableFor の内容も本文に自然に含める。機能名は「」で示す。全体で120〜160字（答えの1文を含む）。",
  "featureValues": ["機能表と同じ順序の値"],
  "linkLabel": "商品詳細はこちら"
}

# 制約
- seriesName は公式のシリーズ名があるときだけ（例: パワーコードレス）。無ければ ""
- 商品タイトルはサーバ側で「メーカー 「シリーズ名」 型式」形式に組み立てる（シリーズが無ければ「メーカー 型式」）
- conclusion / suitableFor / description は必須（空にしない）
- description の先頭は答えの1文（conclusion）とし、「結論:」「向いている人:」などのラベルは一切書かない
- description は冗長にせず、答え1文＋続き1〜2文で全体120〜160字に収める（スペックの羅列や宣伝口調は避ける）
- featureValues は機能表ラベルと同じ件数・同じ順序
- ${hasFacts ? 'メーカー公式テキストにあるスペックは必ず featureValues に反映する（全部「—」禁止）' : '型番が分かる場合はメーカー公式仕様として知られている値をできるだけ埋め、全部「—」にしない'}
- 説明文に書いたスペックと機能表の値は矛盾させない
- 誇大広告・最上級表現は避ける
- 家電販売店向けの丁寧な文体
`;

  const data = await runGeminiJson(getGeminiModel, prompt, 'generateProductCopy');
  let featureRows;
  if (usablePreset) {
    featureRows = usablePreset;
  } else if (Array.isArray(data?.featureValues) && data.featureValues.length) {
    featureRows = normalizeFeatureRowsFromValues(data.featureValues, labels);
  } else if (Array.isArray(data?.featureRows)) {
    featureRows = normalizeFeatureRows(
      data.featureRows.map((r) => ({
        label: String(r.label || '').trim(),
        value: String(r.value || '').trim(),
      })),
      labels
    );
  } else {
    featureRows = labels.map((label) => ({ label, value: '—' }));
  }
  // 生成結果が空ならヒューリスティックで最低限埋める
  if (featureFillScore(featureRows) === 0) {
    featureRows = pickBetterFeatureRows(
      featureRows,
      heuristicFeatureRowsFromProduct(category, product, labels),
      labels
    );
  }
  const conclusion = stripUseCaseLabel(data?.conclusion);
  const suitableFor = stripUseCaseLabel(data?.suitableFor);
  let description = ensureUseCaseDescriptionPrefix(
    data?.description,
    conclusion,
    suitableFor
  );

  return {
    heading:
      formatProductTitle(product, data?.seriesName) ||
      String(data?.heading || '').trim(),
    conclusion,
    suitableFor,
    description,
    featureRows,
    linkLabel: String(data?.linkLabel || '商品詳細はこちら').trim(),
    manufacturerUrl: manufacturerUrl || null,
    hrefKojima: product.hrefKojima || null,
    product: compactProductForPrompt(product),
  };
}

/** 「結論:」「向いている人:」等の明示ラベルを除去 */
function stripUseCaseLabel(text) {
  return String(text || '')
    .trim()
    .replace(/^結論\s*[:：]\s*/, '')
    .replace(/^向いている人\s*[:：]\s*/, '')
    .replace(/^おすすめ\s*[:：]\s*/, '');
}

/**
 * 説明文の冒頭に答えの1文を自然に埋め込む（記事本文と同型。「結論:」ラベルなし）。
 */
function ensureUseCaseDescriptionPrefix(description, conclusion, suitableFor) {
  let body = stripUseCaseLabel(description);
  const conc = stripUseCaseLabel(conclusion);
  const suit = stripUseCaseLabel(suitableFor);

  // 先頭段落のラベル除去
  body = body
    .split(/\n\n+/)
    .map((p, i) => (i === 0 ? stripUseCaseLabel(p) : p))
    .join('\n\n')
    .trim();

  if (conc) {
    const firstPara = body.split(/\n\n+/)[0]?.trim() || '';
    if (!body) {
      body = conc;
    } else if (firstPara !== conc && !body.startsWith(conc)) {
      body = `${conc}\n\n${body}`;
    }
  }

  if (suit && !body.includes(suit.replace(/[。．]$/, ''))) {
    const suitSentence = /[。．!！?？]$/.test(suit) ? suit : `${suit}。`;
    body = body ? `${body}\n\n${suitSentence}` : suitSentence;
  }

  return body.trim();
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderProductBlockHtml(copy, rankIndex) {
  const rows = (copy.featureRows || [])
    .map(
      (r) =>
        `<tr>
                                                <th>${escapeHtml(r.label)}</th>
                                                <td>${escapeHtml(r.value)}</td>
                                              </tr>`
    )
    .join('\n');
  const detailUrl = String(copy.ctaUrl || copy.hrefKojima || copy.manufacturerUrl || '').trim();
  const linkLabel = String(copy.linkLabel || '').trim() || '商品詳細はこちら';
  const link = detailUrl
    ? `<p class="linkbtn"><a title="" href="${escapeHtml(detailUrl)}">${escapeHtml(linkLabel)}</a></p>`
    : '';

  const descParts = [];
  if (copy.description) {
    const paras = String(copy.description)
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        // 旧出力の「結論:」「向いている人:」ラベルが残っていても表示しない
        const cleaned = stripUseCaseLabel(p);
        return cleaned
          ? `<p class="pc_mb20">${escapeHtml(cleaned).replace(/\n/g, '<br>')}</p>`
          : '';
      })
      .filter(Boolean);
    descParts.push(...paras);
  }
  if (copy.productReplaced && copy.replacedFromLabel) {
    descParts.push(
      `<p class="pc_font12 pc_mb10">※当初の「${escapeHtml(copy.replacedFromLabel)}」が完売・取扱終了のため、人気ランキング上位の本商品に差し替えました。</p>`
    );
  }

  const table = rows
    ? `<table class="pickup_spec pc_w100per">
                                            <tbody>
${rows}
                                            </tbody>
                                        </table>`
    : '';

  const heading = escapeHtml(copy.heading || '');
  const imageUrl =
    String(copy.imageUrl || '').trim() ||
    dummyProductImageUrl(copy.heading || String(rankIndex));
  const imgInner = detailUrl
    ? `<a title="" href="${escapeHtml(detailUrl)}"><img alt="${heading}" src="${escapeHtml(imageUrl)}"></a>`
    : `<img alt="${heading}" src="${escapeHtml(imageUrl)}">`;

  // mixer.html と同型: 左画像(35%) + 右スペック/CTA(65%)
  const specBlock = `<div class="commentblock pc_mb30">
                                <div class="block2 pc_w35per sp_w90per pc_tac sp_mha">${imgInner}
                                </div>
                                <div class="block2 pc_w65per sp_w100per sp_mha">
                                        ${table}
                                        ${link}
                                </div>
                        </div>`;

  return `
<div class="pickup">
                        <div>
                                        <h4 class="pc_mt0">${heading}</h4>
                                </div>
                        ${descParts.join('\n                        ')}
                        ${specBlock}
                        </div>`.trim();
}

/**
 * @param {{ label: string, products: object[] }[]} sections
 *   products[].copy に generateProductCopy 結果
 * @param {{ category?: string, title?: string }} [meta]
 */
function renderUseCaseHtml(sections, meta = {}) {
  const category = String(meta.category || '').trim();
  const title =
    String(meta.title || '').trim() ||
    (category ? `【用途別】${category}のおすすめ` : '用途別おすすめ');

  const blocks = (sections || []).map((sec, secIdx) => {
    const ank = `ank${String(secIdx + 1).padStart(2, '0')}`;
    const productsHtml = (sec.products || [])
      .map((p, i) => renderProductBlockHtml(p.copy || p, i + 1))
      .join('\n\n');
    return `
                <h3 id="${ank}">${escapeHtml(sec.label)} おすすめ</h3>
                ${productsHtml}`.trim();
  });

  // refrigerator.html / mixer.html と同型: zzb_special4.css + 記事用インラインCSS
  const articleStyle = getKojimaFeatureArticleStyleTag();
  return `<!-- zzb_special4.css + 特集記事用CSS（refrigerator/mixer と同型） -->
${articleStyle}
<div id="fwCms_wrapper">
<div id="mainblock006479">
<h1 class="top_title">${escapeHtml(title)}</h1>
${blocks.join('\n\n')}
</div><!-- /#mainblock006479 -->
</div><!-- /#fwCms_wrapper -->`;
}

/**
 * 1商品: 完売ならランキング上位へ差し替え → URL解決 → スクレイプ → コピー生成。
 * 差し替え候補が無い完売は skipped=true（掲載カット）。
 */
async function generateCopyForProduct({
  category,
  useCase,
  product,
  manufacturerUrl: forcedUrl,
  scrape,
  fetchHtml,
  getGeminiModel,
  featureLabels,
  rankingProducts = [],
  usedProductKeys = null,
}) {
  const usedKeys = usedProductKeys instanceof Set ? usedProductKeys : new Set();
  let effectiveProduct = product;
  let replacedFromLabel = '';
  let productReplaced = false;
  let productHtml = '';

  const originalKey = productIdentityKey(product);
  if (originalKey) usedKeys.add(originalKey);

  const originalLabel =
    product.label ||
    product.productName ||
    [product.manufacturer, product.modelCode].filter(Boolean).join(' ') ||
    originalKey ||
    '（不明）';

  productHtml = await fetchKojimaProductHtml(product, fetchHtml);
  const hasDetailUrl = Boolean(String(product?.hrefKojima || '').trim());
  const originalSoldOut = Boolean(productHtml) && isKojimaProductPageSoldOut(productHtml);

  // 完売確定時のみ必須差し替え。URL欠落は差し替えを試みるが、失敗しても生成は続行する。
  if (originalSoldOut || !hasDetailUrl) {
    const swap = await pickAvailableRankingReplacement({
      original: product,
      rankingProducts,
      usedKeys,
      fetchHtml,
    });
    if (swap?.product) {
      replacedFromLabel = originalLabel;
      effectiveProduct = swap.product;
      productHtml = swap.productHtml || '';
      productReplaced = true;
      if (originalKey) usedKeys.delete(originalKey);
      if (swap.key) usedKeys.add(swap.key);
      forcedUrl = null; // 差し替え商品では元のメーカーURLを使わない
    } else if (originalSoldOut) {
      if (originalKey) usedKeys.delete(originalKey);
      return {
        skipped: true,
        skipReason: 'sold_out_no_replacement',
        product,
        productLabel: originalLabel,
        productReplaced: false,
        replacedFromLabel: '',
        copy: null,
      };
    }
    // URL欠落のみで差し替え不可 → メーカー情報ベースで生成継続（掲載カットしない）
  }

  let manufacturerUrl = String(forcedUrl || effectiveProduct?.manufacturerUrl || '').trim() || null;
  if (manufacturerUrl && isRetailerOrMarketplaceUrl(manufacturerUrl)) {
    manufacturerUrl = null;
  }

  const gathered = await gatherManufacturerFacts({
    product: effectiveProduct,
    forcedUrl: manufacturerUrl,
    scrape,
    fetchHtml,
    getGeminiModel,
  });
  let scraped = {
    text: gathered.text || '',
    error: gathered.error,
    charCount: gathered.charCount || 0,
  };
  manufacturerUrl = gathered.manufacturerUrl || manufacturerUrl;
  const urlMeta = gathered.urlMeta;

  console.log(
    `📋 usecase maker facts: url=${manufacturerUrl || '—'} chars=${scraped.charCount} tried=${(gathered.triedUrls || []).length}`
  );

  // 機能表はメーカー公式テキストから抽出
  let featureRowsFromMaker = await extractFeatureRowsFromManufacturerFacts({
    category,
    product: effectiveProduct,
    featureLabels,
    factsText: scraped.text,
    manufacturerUrl,
    getGeminiModel,
  });

  // 空なら公式知識フォールバック＋商品名ヒューリスティック
  if (featureFillScore(featureRowsFromMaker) < 2) {
    const knowledgeRows = await fillFeatureRowsFromOfficialModelKnowledge({
      category,
      product: effectiveProduct,
      featureLabels,
      getGeminiModel,
    });
    featureRowsFromMaker = pickBetterFeatureRows(
      featureRowsFromMaker,
      knowledgeRows,
      featureLabels
    );
  }

  const imageMeta = await resolveKojimaProductImage({
    product: effectiveProduct,
    fetchHtml,
    html: productHtml,
  });

  const copy = await generateProductCopy({
    category,
    useCase,
    product: effectiveProduct,
    factsText: scraped.text,
    manufacturerUrl,
    getGeminiModel,
    featureLabels,
    featureRows: featureRowsFromMaker,
  });
  // 空の抽出結果で生成結果を潰さない
  copy.featureRows = pickBetterFeatureRows(featureRowsFromMaker, copy.featureRows, featureLabels);
  console.log(
    `📋 usecase feature fill: ${featureFillScore(copy.featureRows)}/${(featureLabels || []).length} for ${effectiveProduct?.modelCode || effectiveProduct?.label || ''}`
  );

  const detailUrl = String(effectiveProduct.hrefKojima || '').trim();
  const ctaUrl = detailUrl || manufacturerUrl || '';
  const linkLabel = copy.linkLabel || '商品詳細はこちら';

  const effectiveKey = productIdentityKey(effectiveProduct);
  if (effectiveKey) usedKeys.add(effectiveKey);

  return {
    skipped: false,
    copy: {
      ...copy,
      imageUrl: imageMeta.url,
      imageSource: imageMeta.source,
      imageIsDummy: imageMeta.isDummy,
      hrefKojima: effectiveProduct.hrefKojima || null,
      ctaUrl,
      linkLabel,
      productReplaced,
      replacedFromLabel: productReplaced ? replacedFromLabel : '',
      originalSoldOut: Boolean(originalSoldOut),
    },
    product: effectiveProduct,
    manufacturerUrl,
    urlMeta,
    scrapeError: scraped.error,
    scrapeCharCount: scraped.charCount,
    productReplaced,
    replacedFromLabel: productReplaced ? replacedFromLabel : '',
  };
}

module.exports = {
  filterKojimaProducts,
  proposeUseCases,
  assignProductsToUseCases,
  resolveManufacturerPageUrl,
  scrapeManufacturerFacts,
  gatherManufacturerFacts,
  resolveFeatureLabels,
  normalizeFeatureRows,
  normalizeFeatureRowsFromValues,
  extractFeatureRowsFromManufacturerFacts,
  fillFeatureRowsFromOfficialModelKnowledge,
  pickBetterFeatureRows,
  featureFillScore,
  defaultFeatureLabelsForCategory,
  productCacheKey,
  generateProductCopy,
  generateCopyForProduct,
  renderUseCaseHtml,
  resolveKojimaProductImage,
  resolveKojimaRankingUrl,
  resolveProductCtaLink,
  pickAvailableRankingReplacement,
  enrichProductsWithKojimaUrls,
  countKojimaUrls,
  isKojimaProductPageSoldOut,
  hasKojimaStock,
  productKey,
  isRetailerOrMarketplaceUrl,
};
