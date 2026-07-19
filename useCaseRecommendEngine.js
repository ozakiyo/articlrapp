'use strict';

const { parseJsonFromModelOutput } = require('./parseModelJson');

function productKey(p) {
  return String(p?.modelKey || p?.modelCode || p?.id || `${p?.manufacturer || ''}|${p?.productName || ''}`).trim();
}

function hasKojimaStock(p) {
  return p?.rankKojima != null || Boolean(p?.hrefKojima);
}

function filterKojimaProducts(items) {
  return (items || []).filter(hasKojimaStock).map((p, i) => ({
    ...p,
    _key: productKey(p) || `p-${i}`,
    label:
      p.label ||
      [p.manufacturer, p.productName || p.representativeModel, p.modelCode]
        .filter(Boolean)
        .join(' '),
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

async function runGeminiJson(getGeminiModel, prompt, label) {
  const model = await getGeminiModel();
  console.log(`🧠 [${label}] Gemini generateContent`);
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  const raw = result.response?.text?.() || '';
  return parseJsonFromModelOutput(raw);
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

async function resolveManufacturerPageUrl({ product, getGeminiModel }) {
  const prompt = `
家電メーカーの公式サイト上の、次の商品の製品情報ページURLを1つ推定してください。
存在が不確かな場合は null。

# 商品
${JSON.stringify(compactProductForPrompt(product), null, 2)}

# 出力（厳密にJSONのみ）
{
  "url": "https://...",
  "confidence": "high|medium|low",
  "note": "短い補足"
}
`;
  const data = await runGeminiJson(getGeminiModel, prompt, 'resolveMakerUrl');
  const url = String(data?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { url: null, confidence: 'low', note: data?.note || 'URLを特定できませんでした' };
  }
  return {
    url,
    confidence: data?.confidence || 'medium',
    note: data?.note || '',
  };
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
 */
function normalizeFeatureRows(rows, labels) {
  const list = Array.isArray(labels) && labels.length ? labels : [];
  const byLabel = new Map();
  for (const r of rows || []) {
    const label = String(r?.label || '')
      .trim()
      .replace(/\s+/g, ' ');
    const value = String(r?.value || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (label) byLabel.set(label, value || '—');
  }
  if (!list.length) {
    return (rows || [])
      .map((r) => ({
        label: String(r?.label || '').trim(),
        value: String(r?.value || '').trim() || '—',
      }))
      .filter((r) => r.label);
  }
  return list.map((label) => ({
    label,
    value: byLabel.get(label) || '—',
  }));
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
 * 説明文・機能表・見出しを生成（機能表項目はカテゴリ共通）
 */
async function generateProductCopy({
  category,
  useCase,
  product,
  factsText,
  manufacturerUrl,
  getGeminiModel,
  featureLabels,
}) {
  const labels =
    Array.isArray(featureLabels) && featureLabels.length
      ? featureLabels
      : defaultFeatureLabelsForCategory(category);
  const labelsJson = JSON.stringify(labels, null, 2);

  const prompt = `
あなたはコジマネットの家電特集記事ライターです。
参考形式（冷蔵庫記事）に合わせ、用途別おすすめ1商品の原稿を作ってください。

# カテゴリ
${category}

# 用途
${JSON.stringify(useCase || {}, null, 2)}

# 商品
${JSON.stringify(compactProductForPrompt(product), null, 2)}

# メーカー公式から取得したテキスト（根拠。無い場合は商品メタのみで慎重に）
${factsText ? factsText.slice(0, 10000) : '（取得なし）'}

# メーカー公式URL
${manufacturerUrl || '（なし）'}

# 機能表の項目（このカテゴリ共通。全商品で同じラベル・同じ順序）
${labelsJson}

# 出力（厳密にJSONのみ）
{
  "heading": "メーカー「シリーズ」型番（主要スペック要約）",
  "description": "2〜4文の説明。機能名は「」で示す。用途に結び付ける。",
  "featureRows": [
    { "label": "上記の項目名と完全一致", "value": "値。不明なら —" }
  ],
  "linkLabel": "商品詳細はこちら"
}

# 制約
- featureRows は上記ラベルをすべて、同じ順序で出力する（件数はラベル数と一致）
- ラベル名を言い換えない・追加しない・省略しない
- 取得テキストにないスペック・数値は捏造しない。不明な項目の value は「—」
- 説明文に書いたスペックと機能表の値は矛盾させない
- 誇大広告・最上級表現は避ける
- 家電販売店向けの丁寧な文体
`;

  const data = await runGeminiJson(getGeminiModel, prompt, 'generateProductCopy');
  const rawRows = Array.isArray(data?.featureRows)
    ? data.featureRows.map((r) => ({
        label: String(r.label || '').trim(),
        value: String(r.value || '').trim(),
      }))
    : [];
  const featureRows = normalizeFeatureRows(rawRows, labels);

  return {
    heading: String(data?.heading || product.label || product.productName || '').trim(),
    description: String(data?.description || '').trim(),
    featureRows,
    linkLabel: String(data?.linkLabel || '商品詳細はこちら').trim(),
    manufacturerUrl: manufacturerUrl || null,
    hrefKojima: product.hrefKojima || null,
    product: compactProductForPrompt(product),
  };
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
        `<tr><th scope="row">${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`
    )
    .join('');
  const link =
    copy.hrefKojima
      ? `<p><a href="${escapeHtml(copy.hrefKojima)}" target="_blank" rel="noopener">${escapeHtml(copy.linkLabel || '商品詳細はこちら')}</a></p>`
      : '';
  return `
<p><strong>${rankIndex}</strong></p>
<h4>${escapeHtml(copy.heading)}</h4>
<p>${escapeHtml(copy.description)}</p>
${rows ? `<table class="usecase-feature-table"><tbody>${rows}</tbody></table>` : ''}
${link}
`.trim();
}

/**
 * @param {{ label: string, products: object[] }[]} sections
 *   products[].copy に generateProductCopy 結果
 */
function renderUseCaseHtml(sections) {
  const blocks = (sections || []).map((sec) => {
    const productsHtml = (sec.products || [])
      .map((p, i) => renderProductBlockHtml(p.copy || p, i + 1))
      .join('\n\n');
    return `
<h3>${escapeHtml(sec.label)}のおすすめ</h3>
${productsHtml}
`.trim();
  });
  return blocks.join('\n\n');
}

/**
 * 1商品: URL解決 → スクレイプ → コピー生成
 */
async function generateCopyForProduct({
  category,
  useCase,
  product,
  manufacturerUrl: forcedUrl,
  scrape,
  getGeminiModel,
  featureLabels,
}) {
  let manufacturerUrl = String(forcedUrl || '').trim() || null;
  let urlMeta = null;
  if (!manufacturerUrl) {
    try {
      urlMeta = await resolveManufacturerPageUrl({ product, getGeminiModel });
      manufacturerUrl = urlMeta.url;
    } catch (err) {
      urlMeta = {
        url: null,
        confidence: 'low',
        note: String(err?.message || err),
      };
      manufacturerUrl = null;
    }
  }
  const scraped = manufacturerUrl
    ? await scrapeManufacturerFacts({ url: manufacturerUrl, scrape })
    : { text: '', error: 'メーカーURL未設定', charCount: 0 };

  const copy = await generateProductCopy({
    category,
    useCase,
    product,
    factsText: scraped.text,
    manufacturerUrl,
    getGeminiModel,
    featureLabels,
  });

  return {
    copy,
    manufacturerUrl,
    urlMeta,
    scrapeError: scraped.error,
    scrapeCharCount: scraped.charCount,
  };
}

module.exports = {
  filterKojimaProducts,
  proposeUseCases,
  assignProductsToUseCases,
  resolveManufacturerPageUrl,
  scrapeManufacturerFacts,
  resolveFeatureLabels,
  normalizeFeatureRows,
  defaultFeatureLabelsForCategory,
  productCacheKey,
  generateProductCopy,
  generateCopyForProduct,
  renderUseCaseHtml,
  hasKojimaStock,
  productKey,
};
