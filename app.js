/*
Notion 最終
バックエンド→AI or 作成アプリ　→HTTP->HTTPS
https://www.notion.so/HTTP-HTTPS-2e256effa6dc8073853bf62d5673997b

Notion 初期
https://www.notion.so/AI-2a956effa6dc805080a7ea2c1f55e698

サーバー　Conoha
https://manage.conoha.jp/Dashboard

本番URL 動作確認OK
https://articleapp.duckdns.org/

【ローカル開発】
Macintosh HD/kiyoshiozawa/articleapp/
[サーバー]
kiyoshiozawa@MacBook-Air-5 articleapp % cd server
kiyoshiozawa@MacBook-Air-5 server % npm run dev
Server ready on http://localhost:3001
ozakiyo
kiyo0276

[クライアント]
kiyoshiozawa@MacBook-Air-5 client % npm run dev
http://localhost:5173/

エラーは出るが、スクレイピングは成功しているので、一旦OKとする。

ローカルでOKならば、本番への移行はまだ。


app.js バックエンド処理
[Express＋スクレイピング＋生成AIを組み合わせた構成]
①認証付きでAPIを提供
②競合記事をスクレイピング
③競合分析 → 記事構成を生成（Gemini）
④構成を元に本文を生成（Gemini）
⑤PIXTAから画像情報を取得
⑥Reactのビルド成果物を配信


このアプリ良い点：
アウトライン → 本文の2段階AI生成
Playwright + HTTPの二重スクレイピング
JSON厳格指定

gemini API無料枠制限：
1.リクエスト回数・速度の制限
  15RPM (Requests Per Minute)
  1分間に15回までしかリクエストできない。
  これを超えると429Too Many Requestsエラーが返る。
  短時間に連続してテストを行うと、すぐにこの上限に達する。
  1,500 RPD (Requests Per Day)
  1日に1,500回までリクエスト可能。
2. トークン量の制限
  1,000,000 TPM (Tokens Per Minute)
  1分間に処理できるトークン（文字数換算で約50万〜100万文字程度）の上限です。
*/

/*---①サーバーの基本設定と認証---*/
const express = require('express'); //Webサーバー
//expressというライブラリを使い、フロントエンド（ユーザーが操作する画面）からのリクエストを受け付ける。
const dotenv = require('dotenv'); //環境変数を読み込む
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright'); //ブラウザを自動操作してスクレイピング
const cheerio = require('cheerio'); //HTMLをパース(jQuery的)
const iconv = require('iconv-lite'); //文字コード変換(Shift_JIS対策)
const basicAuth = require('express-basic-auth');

// Load .env file from the server directory
//.envの読み込み　本番運用では必須のセキュリティ対策
dotenv.config({ path: path.join(__dirname, '.env') });

//----Express基本設定----
/*
このブロックは、「Expressでサーバーの土台を作り、待ち受けるポート番号を決め、フロントエンドからのJSONデータを正しく受け取れるように準備する」という、
サーバー起動に必須の初期設定を行っている部分
*/
//Webサーバー本体となり、これに対して「このURLにアクセスが来たらこう動いて」といった様々な命令を追加していくことになる。
const app = express(); 
//サーバーがどの「窓口」でリクエストを待ち受けるかを決めています。この窓口をポート番号と呼びます。
const PORT = Number(process.env.PORT) || 3050;
/** ランキングAPIで返す最大件数（キーワード絞り込み後）。環境変数 RANKING_RESULT_LIMIT で 1〜200 の範囲で変更可 */
const RANKING_RESULT_LIMIT = Math.min(
  Math.max(Number(process.env.RANKING_RESULT_LIMIT) || 50, 1),
  200
);
/** ヨドバシ mcol 追加読み込みの最大回数（1回あたり最大20件程度） */
const YODOBASHI_MCOL_MAX_ROUNDS = 15;
/** ビックカメラランキング: Playwright での下スクロール回数（遅延読み込み対策） */
const BICCAMERA_RANKING_SCROLL_ROUNDS = 14;
/** コジマ ranking.html の取得ページ数（rPage=1…N、重複 href は除外） */
const KOJIMA_RANKING_PAGE_COUNT = 3;
//ミドルウェアと呼ばれる「中間処理」を設定
/*
フロントエンド（ブラウザ）から送られてくるデータがJSON形式だった場合に、それを正しく解釈してプログラムで扱える形に変換してくれる機能です。
このアプリケーションでは、フロントエンドのReactから「キーワード」や「URL」がJSON形式で送られてくるため、この設定が不可欠です。これがないと、サーバーは送られてきたJSONデータを正しく受け取ることができません。
*/
app.use(express.json());
// ローカル開発: Vite から Express へ直接 fetch（VITE_API_BASE_URL）する場合の CORS
function isAllowedBrowserDevOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const o = origin.trim();
  return (
    /^https?:\/\/localhost(:\d+)?$/i.test(o) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(o) ||
    /^https?:\/\/\[::1\](:\d+)?$/i.test(o) ||
    /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(o) ||
    /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/i.test(o)
  );
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedBrowserDevOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
//----Express基本設定----

const publicPath = path.join(__dirname, 'public');
const viewsPath = path.join(__dirname, 'views');
app.set('view engine', 'ejs');
app.set('views', viewsPath);

//---ベーシック認証（本番: server/.env に BASIC_AUTH_PASSWORD を設定すると有効）---
// /api は対象外。SPA の fetch は Authorization を付けられないため、API まで掛けると
// 「認証が必要です。」だけ返ってランキング取得などが失敗する。
const basicAuthUser = String(process.env.BASIC_AUTH_USER || 'admin').trim();
const basicAuthPass = String(process.env.BASIC_AUTH_PASSWORD || '').trim();
if (basicAuthPass) {
  const basicAuthMiddleware = basicAuth({
    users: {
      [basicAuthUser]: basicAuthPass,
    },
    challenge: true,
    realm: 'ArticleApp',
    unauthorizedResponse: () => ({ error: '認証が必要です。' }),
  });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return basicAuthMiddleware(req, res, next);
  });
  console.log(
    '🔐 Basic authentication enabled for user:',
    basicAuthUser,
    '(HTML/static のみ。/api は対象外)'
  );
} else {
  console.log('ℹ️ Basic authentication disabled (set BASIC_AUTH_PASSWORD in .env to enable)');
}
//---ベーシック認証---

//---静的ファイル（CSS / JS）---
app.use(express.static(publicPath));
console.log('📦 Serving static assets from:', publicPath);


const { parseJsonFromModelOutput } = require('./parseModelJson');
const {
  fetchCategoryRankings,
  applyCategoryThemedRankings,
  resolveCategoryRankingUrls,
  getRankingThemePresets,
  getDefaultRankingThemeSelection,
  CSV_EXPORT_DIR,
} = require('./categoryRanking');
const weeklyReportConfig = require('./weeklyReportConfig');
const { fetchGoogleSuggestTop10 } = require('./googleSearchSuggest');
const {
  loadSavedRankingUrls,
  listSavedRankingCategories,
  saveRankingUrls,
} = require('./rankingUrlStore');
const {
  ensureStoreFile: ensureCompetitorArticlesStoreFile,
  loadSavedCompetitorArticles,
  listSavedCompetitorCategories,
  saveCompetitorArticles,
} = require('./competitorArticlesStore');
const { analyzeCompetitorArticles } = require('./competitorArticleEngine');
const { loadLastAnalysis } = require('./competitorHeadingSnapshotStore');
const { getCategoriesPayload } = require('./categoryRegistry');
const {
  getIsoWeekId,
  getPreviousWeekId,
  loadArticleMaster,
  loadSnapshot,
  saveSnapshot,
  listSnapshots,
  findLatestSnapshot,
  buildWeeklyReport,
  buildEmptyReport,
  buildReportFromSnapshot,
  buildEmptyReportWithComparison,
  buildWeeklyReportWithComparison,
  normalizeCompareMode,
  buildChangeLogFromEntries,
} = require('./weeklyReportEngine');

async function attachGoogleSearchInterest(report, category) {
  try {
    const googleSearchInterest = await fetchGoogleSuggestTop10(category);
    return { ...report, googleSearchInterest };
  } catch (err) {
    console.warn('⚠️ Google Suggest failed:', err.message);
    return {
      ...report,
      googleSearchInterest: {
        keyword: category,
        fetchedAt: null,
        items: [],
        source: 'google-suggest',
        error: err.message,
      },
    };
  }
}

/*
「AIモデルのインスタンスを効率的に取得すること」
AIモデルの初期化（準備）は少し時間がかかる処理なので、APIリクエストのたびに毎回準備していると、アプリケーションの応答が遅くなってしまう。
それを防ぐために、この関数は「一度だけ準備して、あとはそれを使い回す」という賢い仕組み（シングルトンパターンや遅延初期化と呼ばれる手法）を採用
*/
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
/** 無料枠切れ・モデル廃止時の代替（クォータはモデル別にカウントされる） */
const GEMINI_FALLBACK_MODELS = [
  GEMINI_MODEL,
  'gemini-flash-latest',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
].filter((name, i, arr) => name && arr.indexOf(name) === i);

let geminiClient;
let geminiModel;
//geminiModelという変数は、AIモデルの本体を格納するためのもの
async function getGeminiClient() {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  return geminiClient;
}

function isGeminiModelUnavailableError(err) {
  const message = String(err?.message || '');
  return (
    message.includes('[404 Not Found]') ||
    message.toLowerCase().includes('no longer available') ||
    message.toLowerCase().includes('not found')
  );
}

async function getGeminiModel() {
  if (geminiModel) return geminiModel;

  const genAI = await getGeminiClient();
  console.log('⚙️ Initializing Gemini with fallbacks:', GEMINI_FALLBACK_MODELS.join(' → '));

  // generateContent だけ使う薄いラッパー（429/404 時に次のモデルへ）
  geminiModel = {
    async generateContent(request) {
      let lastErr;
      for (const modelName of GEMINI_FALLBACK_MODELS) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(request);
          if (modelName !== GEMINI_MODEL) {
            console.log(`✅ Gemini fallback model used: ${modelName}`);
          }
          return result;
        } catch (err) {
          lastErr = err;
          const canFallback =
            isGeminiQuotaExceededError(err) || isGeminiModelUnavailableError(err);
          console.warn(
            `⚠️ Gemini model failed (${modelName}):`,
            String(err?.message || err).slice(0, 180)
          );
          if (!canFallback) throw err;
        }
      }
      throw lastErr;
    },
  };
  return geminiModel;
}

function parseRetryAfterSecondsFromMessage(message = '') {
  const match = String(message).match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : null;
}

function isGeminiQuotaExceededError(err) {
  const message = String(err?.message || '');
  return (
    message.includes('[429 Too Many Requests]') ||
    message.toLowerCase().includes('quota exceeded')
  );
}

const ENABLE_AI_RANKING_EXTRACTION =
  String(process.env.ENABLE_AI_RANKING_EXTRACTION || '').toLowerCase() === 'true';

function normalizeForKeywordMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/\s+/g, '')
    .trim();
}

function parseInchThresholdFromKeyword(keyword) {
  const normalized = normalizeForKeywordMatch(keyword);
  const match = normalized.match(/(\d+(?:\.\d+)?)インチ以上/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function includes4kSignal(text) {
  const normalized = normalizeForKeywordMatch(text);
  return (
    normalized.includes('4k') ||
    normalized.includes('3840x2160') ||
    normalized.includes('uhd')
  );
}

function extractMaxInchFromText(text) {
  const normalized = normalizeForKeywordMatch(text).replace(/ｃ/g, 'c');
  const regex = /(\d+(?:\.\d+)?)c?インチ/g;
  let max = null;
  let m;
  while ((m = regex.exec(normalized)) !== null) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    if (max === null || value > max) {
      max = value;
    }
  }
  return max;
}

function keywordMatchesBlock(keyword, blockText) {
  const normalizedKeyword = normalizeForKeywordMatch(keyword);
  const normalizedBlock = normalizeForKeywordMatch(blockText);

  if (!normalizedKeyword) return true;
  if (normalizedKeyword === '4k') {
    return includes4kSignal(normalizedBlock);
  }

  const inchThreshold = parseInchThresholdFromKeyword(normalizedKeyword);
  if (inchThreshold !== null) {
    const maxInch = extractMaxInchFromText(normalizedBlock);
    return maxInch !== null && maxInch >= inchThreshold;
  }

  return normalizedBlock.includes(normalizedKeyword);
}

function isResolutionLikeToken(token) {
  const t = String(token || '').replace(/\s/g, '');
  return /^\d{3,5}[x×]\d{3,5}$/i.test(t);
}

/**
 * 価格.com 商品一覧では innerText が「商品名・型番 … N位 …」の順になりやすい。
 * メーカー名の直後〜 [ や （ や ¥ までを型式候補とする。
 */
function extractLikelyModelFromBlock(block, manufacturer) {
  // 価格.comの一覧は「¥999」等がメーカーより前に出ることがあり、
  // 先に「¥」で split するとメーカー/型式が落ちるため、ここでは切り捨てない。
  const head = String(block || '').trim();
  if (!manufacturer) return null;
  const brandIndices = [];
  let idx = head.indexOf(manufacturer);
  while (idx >= 0) {
    brandIndices.push(idx);
    idx = head.indexOf(manufacturer, idx + manufacturer.length);
  }
  if (brandIndices.length === 0) return null;

  // 型番コード（英数字＋記号の塊）はメーカー名の近傍に出やすい。
  // メーカー名が複数回出る可能性があるため、全出現位置を試す。
  for (let bi = brandIndices.length - 1; bi >= 0; bi--) {
    const brandIdx = brandIndices[bi];
    const near = head.slice(
      Math.max(0, brandIdx - 600),
      Math.min(head.length, brandIdx + 2500)
    );
    const nearTokens =
      near.match(/[A-Za-z0-9][A-Za-z0-9\-_/+.]{2,}/g) || [];
    for (const token of nearTokens) {
      if (token.length < 2) continue;
      if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) continue;
      if (isResolutionLikeToken(token)) continue;
      if (token.toLowerCase().includes(String(manufacturer).toLowerCase()))
        continue;
      if (/(gpt|itemlist|728x90|div-)/i.test(token)) continue;
      if (/(IPS|VA|TN|OLED|HDR|HDCP|Hz|kHz|cd\/m2|WQHD|4K|UHD)/i.test(token))
        continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9\-_/+.]{1,60}$/.test(token)) continue;
      return token;
    }
  }

  // 以降の処理（メーカー直後からの切り出し）では、先頭の出現を起点にする
  const brandIdx = brandIndices[0];

  // メーカー名の右隣（表示名）をなるべくそのまま抜く
  // 例: "GigaCrysta S KH-GDU271JLAQD [27インチ ブラック]"
  let rest = head.slice(brandIdx + manufacturer.length);
  rest = rest.replace(/^[\s　:：\-–—・|｜]+/, '').trim();
  const stopMarkers = [
    '¥',
    '￥',
    'Amazon',
    '楽天',
    'Yahoo',
    'レビュー',
    '口コミ',
    '気に入り',
    '登録',
    '比較',
    'スペック',
  ];
  let stopAt = rest.length;
  for (const m of stopMarkers) {
    const p = rest.indexOf(m);
    if (p >= 0 && p < stopAt) stopAt = p;
  }
  const specStop = rest.search(
    /モニタサイズ\s*:|解像度\s*\(|パネル種類\s*:|画面種類\s*:|リフレッシュレート/i
  );
  if (specStop >= 0 && specStop < stopAt) stopAt = specStop;

  const segment = rest.slice(0, stopAt).trim();
  if (!segment) return null;

  // bracket まで含めた「商品名+型番」文字列を優先して返す（英字/数字が無い場合は除外）
  if (segment.length >= 2 && segment.length <= 180 && (/[A-Za-z]/.test(segment) || /\d/.test(segment))) {
    return segment;
  }

  const words = segment.split(/\s+/).filter(Boolean);
  const filtered = words.filter(
    (w) =>
      !isResolutionLikeToken(w) &&
      !/^\d+(\.\d+)?$/.test(w) &&
      !/^\d+(\.\d+)?(hz|インチ)$/i.test(w)
  );
  if (filtered.length === 0) return null;

  // "3840x2160" のような解像度トークンを除外した上で、
  // まずは型式っぽい「1トークン」を優先して返す（途中で解像度が混ざっても落ちにくくする）。
  for (const token of filtered) {
    if (token.length < 2) continue;
    if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9\-_/+.]{1,90}$/.test(token)) continue;
    return token;
  }

  // トークン単位で見つからない場合だけ、残った語を連結して候補にする
  let candidate = filtered.join(' ').trim();
  if (!candidate || isResolutionLikeToken(candidate)) return null;
  // 仕様文（モニタサイズ/解像度など）だけで構成されているケースを弾く
  // （型式コードは英数字を含むことが多いので、英字/数字が無い候補は返さない）
  if (!/[A-Za-z]/.test(candidate) || !/\d/.test(candidate)) return null;
  if (/モニタサイズ|解像度|パネル種類|HDR|IPS|VA|TN|OLED/.test(candidate)) return null;
  if (candidate.length > 120) candidate = candidate.slice(0, 120).trim();
  return candidate.length >= 2 ? candidate : null;
}

function findManufacturerInBlock(headBlock, knownManufacturers) {
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

/** ルールベース／ヨドバシHTML解析で共通のメーカー名候補 */
const KNOWN_MANUFACTURERS_RANKING = [
  'IODATA',
  'IO DATA',
  'DELL',
  'Dell',
  'ASUS',
  'LG',
  'LGエレクトロニクス',
  'Acer',
  'Lenovo',
  'BenQ',
  'EIZO',
  'MSI',
  'Philips',
  'PHILIPS',
  'フィリップス',
  'JAPANNEXT',
  'iiyama',
  'HP',
  'TVS REGZA',
  'REGZA',
  'Titan Army',
  'Corsair',
  'MAXZEN',
  'Pixio',
  'ViewSonic',
  'SONY',
  'Apple',
  'GIGABYTE',
  'AOC',
  'Thermalright',
  'INNOCN',
  '富士通',
  'FUJITSU',
  'NEC',
  '日本電気',
];

function extractRankingByKeywordsRuleBased(pageText, keywords) {
  const normalizedKeywords = keywords.map((k) => String(k || '').trim()).filter(Boolean);
  const compactText = String(pageText || '').replace(/\s+/g, ' ').trim();

  const knownManufacturers = KNOWN_MANUFACTURERS_RANKING;

  // N位の出現位置を基準に、順位ごとの周辺テキストを切り出す
  const rankMarker = /(\d{1,3})\s*位/g;
  const rankHits = [];
  let hm;
  while ((hm = rankMarker.exec(compactText)) !== null) {
    const r = Number(hm[1]);
    if (Number.isInteger(r) && r >= 1 && r <= 999) {
      rankHits.push({ rank: r, start: hm.index, end: hm.index + hm[0].length });
    }
  }

  const items = [];
  const seen = new Set();
  const seenRanks = new Set();

  for (let i = 0; i < rankHits.length; i++) {
    const { rank, start } = rankHits[i];
    const nextStart = i + 1 < rankHits.length ? rankHits[i + 1].start : compactText.length;
    const rawBlock = compactText.slice(start, nextStart).trim();
    if (rawBlock.length < 12) continue;

    const keywordMatched =
      normalizedKeywords.length === 0
        ? true
        : normalizedKeywords.every((kw) => keywordMatchesBlock(kw, rawBlock));
    if (!keywordMatched) continue;
    if (seenRanks.has(rank)) continue;

    const manufacturer = findManufacturerInBlock(rawBlock, knownManufacturers) || '不明';
    const model =
      manufacturer === '不明' ? null : extractLikelyModelFromBlock(rawBlock, manufacturer);
    const modelSafe = model || '不明';
    if (keywords.length === 0 && rank <= 2 && modelSafe === '不明') {
      const mi = manufacturer === '不明' ? -1 : rawBlock.indexOf(manufacturer);
      console.log('🔎 model-debug', {
        rank,
        manufacturer,
        manufacturerIndex: mi,
        blockSnippet: rawBlock.slice(Math.max(0, mi - 80), Math.min(rawBlock.length, mi + 420)),
      });
    }

    const dedupeKey = `${rank}:${modelSafe}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    seenRanks.add(rank);

    items.push({
      rank,
      manufacturer,
      model: modelSafe,
      feature:
        normalizedKeywords.length > 0
          ? `キーワード一致: ${normalizedKeywords.join(' / ')}`
          : '順位抽出',
    });
  }

  const sorted = items.sort((a, b) => a.rank - b.rank);
  if (sorted.length === 0 && normalizedKeywords.length === 0) {
    // キーワードなしで何も返らない場合は、順位だけ返す
    const ranksUnique = [];
    const seenRank = new Set();
    for (const h of rankHits) {
      if (seenRank.has(h.rank)) continue;
      seenRank.add(h.rank);
      ranksUnique.push(h.rank);
      if (ranksUnique.length >= RANKING_RESULT_LIMIT) break;
    }
    return ranksUnique.map((r) => ({
      rank: r,
      manufacturer: '不明',
      model: '不明',
      feature: '順位抽出',
    }));
  }

  return sorted.slice(0, RANKING_RESULT_LIMIT);
}

/*
Playwrightでのスクレイピングが失敗した際の代替手段として
使われる scrapeWithHttpClient 関数から呼び出されている。
*/
/*
クライアントを取得するための関数。
async キーワードが付いているのは、内部で await を使って非同期処理（ライブラリの読み込み）を待つ必要があるため
*/
let gotScrapingClient;
async function getGotScraping() {
  if (!gotScrapingClient) {
    //初回呼び出し時: 
    /*import()を使って、got-scrapingライブラリを動的に読み込む。
    ライブラリの読み込みは非同期で行われるため、await で処理が終わるのを待つ。
    */
    const mod = await import('got-scraping');
    /*読み込みが完了したモジュール(mod)から、
    実際に使用するクライアント (mod.gotScraping) を取り出し、
    最初に宣言した gotScrapingClient 変数に格納。
    これにより、クライアントがアプリケーション内で共有されるようになる*/
    gotScrapingClient = mod.gotScraping;
  }
  //2回目以降の呼び出し時
  /*準備ができたクライアントを返す。
  2回目以降の呼び出しでは、if 文がスキップされ、すぐにこの行に到達して既存のクライアントが返される*/
  return gotScrapingClient;
}

/*
この関数は、HTTPリクエストで取得した生のデータ（buffer）を、
正しい文字コードで文字列に変換（デコード）するためのもの。
特に、日本語の古いウェブサイトで使われがちなShift_JISなど、UTF-8以外の文字コードに対応するために重要な役割
*/
/**
HTTPレスポンスのバッファとヘッダーから文字コードを判別し、HTMLをデコードする関数
{Buffer} buffer - HTTPレスポンスのボディ部分のバッファ
{object} headers - HTTPレスポンスヘッダー
{string} デコードされたHTML文字列
 */
function decodeHtml(buffer, headers) {
  //1.デフォルトの文字コードを'utf-8'に設定
  const defaultEncoding = 'utf-8';
  let encoding; //検出された文字コードを格納する変数
  //2.【優先度1】HTTPヘッダーから文字コードを特定
  //ヘッダーのキーはケースセンシティブでないため、両方のパターンをチェック
  const contentType = headers['content-type'] || headers['Content-Type'];
  if (contentType) {
    // 'charset=...' の部分を正規表現で探し、文字コード名を取得
    const match = contentType.match(/charset=([^;]+)/i);
    if (match) encoding = match[1].trim().toLowerCase();
  }

  //3.【優先度2】ヘッダーに情報がなければ、HTMLの<meta>タグから特定
  if (!encoding) {
    //HTMLの先頭部分（<head>タグがある可能性が高い）だけを読み込む
    const headChunk = buffer.toString(
      'ascii',
      0,
      Math.min(buffer.length, 2048)//バッファの先頭、最大2048バイト
    );

    //HTML5形式の<meta charset="...">を探す
    const metaCharset = headChunk.match(
      /<meta\s+[^>]*charset=["']?([a-zA-Z0-9\-_]+)/i
    );
    if (metaCharset) {
      encoding = metaCharset[1].toLowerCase();
    } else {
      //古い形式の<meta http-equiv="..." content="...; charset=...">を探す
      const metaContent = headChunk.match(
        /<meta\s+[^>]*content=["'][^"']*charset=([^"';\s]+)/i
      );
      if (metaContent) {
        encoding = metaContent[1].toLowerCase();
      }
    }
  }

  //4.文字コードのエイリアス（別名）を統一
  //'sjis'や'shift-jis'などを、ライブラリが認識できる'shift_jis'に正規化
  const encodingMap = {
    sjis: 'shift_jis',
    'shift-jis': 'shift_jis',
    shift_jis: 'shift_jis',
    'windows-31j': 'shift_jis',
    'euc-jp': 'euc-jp',
  };

  //5.最終的な文字コードを決定し、デコード
  //もし文字コードが特定できなかったり、ライブラリが対応していない場合は、デフォルトの'utf-8'を使用
  if (encoding && encodingMap[encoding]) {
    encoding = encodingMap[encoding];
  }

  if (!encoding || !iconv.encodingExists(encoding)) {
    encoding = defaultEncoding;
  }

  console.log('🧩 [Fallback] Detected encoding:', encoding);
  //iconv-liteライブラリを使って、特定した文字コードでバッファを文字列に変換
  return iconv.decode(buffer, encoding);
}

//---②Playwrightスクレイピング---
/*
Playwright（本命）
失敗したら HTTPクライアント（保険） got-scraping
*/

/*フォールバック（HTTP直取得）*/
/*この関数は、scrapeWithHttpClientという、
got-scrapingライブラリを使ったフォールバック用の
スクレイピング処理の中で使われている。
Playwrightのようなブラウザベースのスクレイピングが
失敗した際の「保険」として、HTTPリクエストで
直接取得したHTMLを正しく解釈するために不可欠な機能*/
async function scrapeWithHttpClient(url) {
  console.log('🌐 [Fallback] Fetching via HTTP client:', url);
  const gotScraping = await getGotScraping();
  const res = await gotScraping({
    url,
    timeout: {
      request: 10000,
    },
    retry: {
      limit: 2,
      statusCodes: [403, 408, 425, 429, 500, 502, 503, 504],
      errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'],
    },
    http2: false,
    throwHttpErrors: false,
    headers: {
      'user-agent': undefined,
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
      referer: 'https://www.google.com/',
    },
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 110 }],
      devices: ['desktop'],
      operatingSystems: ['windows', 'linux', 'macos'],
    },
    responseType: 'buffer',
  });
  console.log(
    res.statusCode === 200
      ? '✅ [Fallback] Fetch successful'
      : '❌ [Fallback] Fetch failed',
    url
  );
  if (res.statusCode >= 400) {
    throw new Error(`HTTP fallback failed with status ${res.statusCode}`);
  }

  const html = decodeHtml(res.body, res.headers);
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  console.log(`📝 [Fallback] Extracted ${text.length} characters from`, url);
  if (!text) {
    throw new Error('本文を取得できませんでした。');
  }
  return text;
}

async function fetchHtmlWithHttpClient(url) {
  console.log('🌐 [HTML] Fetching via HTTP client:', url);
  const gotScraping = await getGotScraping();
  const res = await gotScraping({
    url,
    timeout: { request: 10000 },
    retry: {
      limit: 2,
      statusCodes: [403, 408, 425, 429, 500, 502, 503, 504],
      errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'],
    },
    http2: false,
    throwHttpErrors: false,
    headers: {
      'user-agent': undefined,
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
      referer: 'https://www.google.com/',
    },
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 110 }],
      devices: ['desktop'],
      operatingSystems: ['windows', 'linux', 'macos'],
    },
    responseType: 'buffer',
  });
  if (res.statusCode >= 400) {
    throw new Error(`HTTP html fetch failed with status ${res.statusCode}`);
  }
  return decodeHtml(res.body, res.headers);
}

/**
 * 価格.com itemlist の pdf_pg を除いたベースURL（他クエリは維持）
 */
function kakakuItemlistPagesBaseUrl(urlStr) {
  const u = new URL(urlStr);
  u.searchParams.delete('pdf_pg');
  return u.href;
}

/**
 * 1-based ページ番号。1ページ目は pdf_pg なし（サイト既定）
 */
function kakakuItemlistPageUrl(baseUrlStr, pageNum) {
  const u = new URL(baseUrlStr);
  if (pageNum <= 1) {
    u.searchParams.delete('pdf_pg');
  } else {
    u.searchParams.set('pdf_pg', String(pageNum));
  }
  return u.href;
}

/**
 * 価格.com 商品一覧（itemlist.aspx）: 1商品は tr.tr-border が複数行にまたがる。
 * 解像度などは「商品名行」の次の tr（一覧表のセル）に載るため、a タグ順で tr を取ると行がずれ blockText に入らないことがある。
 * 商品名は a.ckitanker、順位は td.swrank2（人気売れ筋）の「N位」を使う。
 * @param {Set<string>} [seenHref] 複数ページマージ時は同一 href を跨いで除外
 */
function extractKakakuItemlistRowsFromHtml(html, seenHref) {
  const hrefSeen = seenHref || new Set();
  const $ = cheerio.load(String(html || ''));

  function collectKakakuTrBorderBlockText(titleRow) {
    const parts = [];
    let cur = titleRow;
    let isFirst = true;
    while (cur && cur.length) {
      parts.push(cur.text());
      const next = cur.next('tr');
      if (!next.length) break;
      // 次の商品ブロック先頭（チェックボックス列つき）は同一商品に含めない
      if (!isFirst && next.find('input[name="ChkProductID"]').length) break;
      isFirst = false;
      cur = $(next);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function kakakuListRankFromDetailRow($detailRow) {
    let t = $detailRow.find('td.swrank2').first().text();
    if (!String(t).replace(/\s/g, '')) {
      t = $detailRow.find('td.swrank1').first().text();
    }
    const m = String(t).replace(/\s+/g, '').match(/(\d+)位/);
    return m ? parseInt(m[1], 10) : null;
  }

  const knownManufacturers = [
    'IODATA',
    'IO DATA',
    'Dell',
    'DELL',
    'ASUS',
    'LG',
    'LGエレクトロニクス',
    'フィリップス',
    'Philips',
    'JAPANNEXT',
    'Titan Army',
    'EIZO',
    'MSI',
    'BenQ',
    'Acer',
    'Lenovo',
    'HP',
  ];

  const productTexts = [];

  $('tr.tr-border').each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass('theadItemRow')) return;
    const link = $tr.find('a.ckitanker[href*="kakaku.com/item/K"]').first();
    if (!link.length) return;
    const href = link.attr('href') || '';
    const titleText = link.text().replace(/\s+/g, ' ').trim();
    if (!href || !titleText) return;
    if (hrefSeen.has(href)) return;
    hrefSeen.add(href);

    const blockText = collectKakakuTrBorderBlockText($tr);
    const detailRow = $tr.next('tr');
    let listRank = null;
    if (detailRow.length && detailRow.hasClass('tr-border')) {
      listRank = kakakuListRankFromDetailRow(detailRow);
    }
    productTexts.push({ href, titleText, blockText, listRank });
  });

  // フォールバック: ckitanker が無いレイアウトのみ従来の item リンク走査
  if (productTexts.length === 0) {
    $('a[href*="kakaku.com/item/K"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const text = $(a).text().replace(/\s+/g, ' ').trim();
      if (!href || !text) return;
      if (text.startsWith('¥') || text.startsWith('￥')) return;
      if (hrefSeen.has(href)) return;
      hrefSeen.add(href);
      const tr = $(a).closest('tr');
      const blockText = collectKakakuTrBorderBlockText(tr);
      productTexts.push({ href, titleText: text, blockText, listRank: null });
    });
  }

  return productTexts.map(({ href, titleText, blockText, listRank }, idx) => {
    const manufacturer = findManufacturerInBlock(titleText, knownManufacturers) || '不明';
    const model =
      manufacturer === '不明'
        ? titleText
        : titleText.replace(manufacturer, '').replace(/^[\s　]+/, '').trim();
    return {
      rank: listRank != null ? listRank : idx + 1,
      manufacturer,
      model: model || '不明',
      href,
      _text: blockText || titleText,
    };
  });
}

function finalizeKakakuItemlistRows(allRanked, keywords) {
  const normalizedKeywords = keywords.map((k) => String(k || '').trim()).filter(Boolean);
  const filtered =
    normalizedKeywords.length === 0
      ? allRanked
      : allRanked.filter((row) =>
          normalizedKeywords.every((kw) => keywordMatchesBlock(kw, row._text))
        );

  return filtered
    .sort((a, b) => a.rank - b.rank || String(a.href).localeCompare(String(b.href)))
    .slice(0, RANKING_RESULT_LIMIT)
    .map(({ rank, manufacturer, model }) => ({
      rank,
      manufacturer,
      model,
      feature:
        normalizedKeywords.length > 0
          ? `キーワード一致: ${normalizedKeywords.join(' / ')}`
          : '順位抽出',
    }));
}

function extractKakakuItemlistFromHtml(html, keywords) {
  const rows = extractKakakuItemlistRowsFromHtml(html, new Set());
  return finalizeKakakuItemlistRows(rows, keywords);
}

/**
 * ヨドバシ一覧の商品画像 alt は「スペック/…/色 型番」のように型番が末尾に付くことが多い。
 */
function extractYodobashiModelFromImgAlt(imgAlt) {
  if (!imgAlt) return null;
  const s = String(imgAlt).trim();
  const lastSpace = s.lastIndexOf(' ');
  const tail = lastSpace >= 0 ? s.slice(lastSpace + 1).trim() : '';
  if (
    tail.length >= 4 &&
    tail.length <= 120 &&
    /[A-Za-z]/.test(tail) &&
    /\d/.test(tail) &&
    !isResolutionLikeToken(tail)
  ) {
    const cleaned = tail.replace(/[／]+$/, '').trim();
    if (!/^(\d{1,2}(\.\d)?)(型|インチ)$/i.test(cleaned)) return cleaned;
  }
  const segs = s.split('/').map((x) => x.trim()).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    if (seg.length < 4 || seg.length > 120) continue;
    if (!/[A-Za-z]/.test(seg) || !/\d/.test(seg)) continue;
    if (isResolutionLikeToken(seg)) continue;
    if (/^[0-9]+(\.[0-9]+)?(型|インチ|Hz)$/i.test(seg)) continue;
    return seg;
  }
  return null;
}

/**
 * ヨドバシ.com カテゴリ人気ランキング（…/ranking/）の HTML から行を抽出する。
 * .listContentsLine.rnkngBrdrT.js_productBlock 内の順位・商品リンク・一覧テキストを使う。
 */
function extractYodobashiRankingRowsFromHtml(html, seenHref) {
  const hrefSeen = seenHref || new Set();
  const $ = cheerio.load(String(html || ''));
  const knownManufacturers = KNOWN_MANUFACTURERS_RANKING;

  const rows = [];
  $('.listContentsLine.rnkngBrdrT.js_productBlock').each((_, block) => {
    const $b = $(block);
    let $box = $b.find('.sectionListRow.itemListLine.js_productBox').first();
    if (!$box.length) {
      $box = $b.find('.sectionListRow.itemListLine').first();
    }
    if (!$box.length) return;

    const rankText = $b.find('span.rankNum.js_ranking').first().text().trim();
    const rank = parseInt(rankText, 10);
    if (!Number.isFinite(rank) || rank < 1) return;

    const $prodLink = $b.find('a[href^="/product/"]').first();
    const href = $prodLink.attr('href') || '';
    if (!href || hrefSeen.has(href)) return;
    hrefSeen.add(href);

    const imgAlt = $b.find('img[alt]').first().attr('alt') || '';
    let titleText = '';
    let maxLen = 0;
    $b.find('a').each((_, a) => {
      const t = $(a).text().replace(/\s+/g, ' ').trim();
      if (!t || t === '在庫のある店舗' || t.length < 12) return;
      if (t.length > maxLen) {
        maxLen = t.length;
        titleText = t;
      }
    });
    if (!titleText) titleText = imgAlt;

    const blockText = $box.text().replace(/\s+/g, ' ').trim();
    const _text = [blockText, imgAlt].filter(Boolean).join(' ');

    const manufacturer =
      findManufacturerInBlock(`${titleText} ${blockText}`, knownManufacturers) || '不明';

    let model;
    if (manufacturer === '不明') {
      model =
        extractYodobashiModelFromImgAlt(imgAlt) || titleText || imgAlt || '不明';
    } else {
      model =
        extractYodobashiModelFromImgAlt(imgAlt) ||
        extractLikelyModelFromBlock(_text, manufacturer);
      if (!model) {
        model = titleText.replace(manufacturer, '').replace(/^[\s　]+/, '').trim();
      }
      if (!model) model = imgAlt;
      if (!model) model = '不明';
    }

    rows.push({
      rank,
      manufacturer,
      model: String(model).replace(/\s+/g, ' ').trim().slice(0, 200),
      href,
      _text,
    });
  });

  return rows;
}

/**
 * 1ページ目 HTML から mcol 用パラメータを取る（サイトの無限スクロールと同じ）
 */
function parseYodobashiMcolParamsFromFirstHtml(html) {
  const $ = cheerio.load(String(html || ''));
  const scroll = $('.js_rankingScrollLoad').first();
  if (!scroll.length) return null;
  const cateCd = scroll.attr('data-uniquecategorycode');
  const limit = parseInt(scroll.attr('data-limit') || '20', 10) || 20;
  const lastBlock = $('.js_mainCateRankContainer .js_productBlock').last();
  if (!lastBlock.length) return null;
  const offset = lastBlock.attr('data-order');
  const lastShowOrder = lastBlock.find('.js_ranking').first().text().trim();
  if (!cateCd || offset == null || String(offset).trim() === '' || !lastShowOrder) {
    return null;
  }
  return { cateCd, limit, offset: String(offset), lastShowOrder };
}

async function fetchYodobashiMcolJson(cateCd, limit, offset, lastShowOrder, refererUrl) {
  const gotScraping = await getGotScraping();
  const qs = new URLSearchParams({
    cateCd,
    limit: String(limit),
    offset: String(offset),
    lastShowOrder: String(lastShowOrder),
  });
  const url = `https://www.yodobashi.com/ws/api/ec/ranking/pc/mcol?${qs.toString()}`;
  const res = await gotScraping({
    url,
    method: 'GET',
    timeout: { request: 15000 },
    retry: {
      limit: 2,
      statusCodes: [403, 408, 425, 429, 500, 502, 503, 504],
      errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'],
    },
    http2: false,
    throwHttpErrors: false,
    headers: {
      'user-agent': undefined,
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
      referer: refererUrl || 'https://www.yodobashi.com/',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/javascript, */*; q=0.01',
    },
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 110 }],
      devices: ['desktop'],
      operatingSystems: ['windows', 'linux', 'macos'],
    },
    responseType: 'text',
  });
  if (res.statusCode >= 400) {
    throw new Error(`yodobashi mcol failed with status ${res.statusCode}`);
  }
  return JSON.parse(String(res.body || '{}'));
}

/**
 * 1ページ目に加え、スクロール読み込み API（mcol）で後続ブロックを取得して行をマージする
 */
async function extractYodobashiRankingRowsMergedWithMcol(firstHtml, pageUrl, seenHref) {
  const rows = extractYodobashiRankingRowsFromHtml(firstHtml, seenHref);
  const params = parseYodobashiMcolParamsFromFirstHtml(firstHtml);
  const fetchedApiUrls = [];
  if (!params) {
    return { rows, fetchedApiUrls };
  }

  let { cateCd, limit, offset: curOffset, lastShowOrder: curLastShow } = params;
  let isTerminus = false;
  let rounds = 0;

  while (!isTerminus && rounds < YODOBASHI_MCOL_MAX_ROUNDS) {
    const qs = new URLSearchParams({
      cateCd,
      limit: String(limit),
      offset: String(curOffset),
      lastShowOrder: String(curLastShow),
    });
    const apiUrl = `https://www.yodobashi.com/ws/api/ec/ranking/pc/mcol?${qs.toString()}`;
    fetchedApiUrls.push(apiUrl);

    let data;
    try {
      data = await fetchYodobashiMcolJson(
        cateCd,
        limit,
        curOffset,
        curLastShow,
        pageUrl
      );
    } catch (err) {
      console.warn('⚠️ yodobashi mcol fetch failed', err.message);
      break;
    }

    isTerminus = data.isTerminus === true;
    const products = Array.isArray(data.products) ? data.products : [];
    for (const frag of products) {
      const partRows = extractYodobashiRankingRowsFromHtml(frag, seenHref);
      rows.push(...partRows);
    }

    if (products.length === 0) break;

    curOffset = data.lastOrder;
    curLastShow = String(data.lastShowOrder);
    rounds++;
  }

  return { rows, fetchedApiUrls };
}

/**
 * 同一クエリで rPage のみ 1..pageCount に変えた URL 一覧
 */
function kojimaRankingPageUrls(originalUrlStr, pageCount) {
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

/**
 * コジマネット ec/ranking.html: div.ranking-box / p.rank「N位」/ prod_detail リンク
 */
function extractKojimaRankingRowsFromHtml(html, seenHref) {
  const hrefSeen = seenHref || new Set();
  const $ = cheerio.load(String(html || ''));
  const knownManufacturers = KNOWN_MANUFACTURERS_RANKING;
  const rows = [];

  $('div.ranking-box').each((_, box) => {
    const $box = $(box);
    const rankText = $box.find('p.rank').first().text().replace(/\s+/g, '').trim();
    const rm = /^(\d+)位$/.exec(rankText) || /(\d+)位/.exec(rankText);
    const rank = rm ? parseInt(rm[1], 10) : 0;
    if (!Number.isFinite(rank) || rank < 1) return;

    const $a = $box.find('a.mk2TagClick[href*="prod_detail.html"]').first();
    let href = String($a.attr('href') || '').trim();
    if (!href) return;
    if (href.startsWith('//')) href = `https:${href}`;
    else if (href.startsWith('/')) href = `https://www.kojima.net${href}`;
    else if (!/^https?:\/\//i.test(href)) href = `https://www.kojima.net/${href.replace(/^\//, '')}`;

    if (hrefSeen.has(href)) return;
    hrefSeen.add(href);

    let titleText = $box.find('p.name a span').first().text().replace(/\s+/g, ' ').trim();
    if (!titleText) {
      titleText = String($box.find('.inner').attr('mk2pname') || '').trim();
    }
    if (!titleText) {
      titleText = String($box.find('.image img[title]').first().attr('title') || '').trim();
    }
    const catchText = $box.find('p.catch').first().text().replace(/\s+/g, ' ').trim();
    const blockText = $box.text().replace(/\s+/g, ' ').trim();
    const _text = [catchText, titleText, blockText].filter(Boolean).join(' ');

    const manufacturer =
      findManufacturerInBlock(`${titleText} ${catchText} ${blockText}`, knownManufacturers) ||
      '不明';

    let model;
    if (manufacturer === '不明') {
      model = titleText || '不明';
    } else {
      model = extractLikelyModelFromBlock(_text, manufacturer);
      if (!model) {
        model = titleText.replace(manufacturer, '').replace(/^[\s　]+/, '').trim();
      }
      if (!model) model = titleText;
      if (!model) model = '不明';
    }

    rows.push({
      rank,
      manufacturer,
      model: String(model).replace(/\s+/g, ' ').trim().slice(0, 200),
      href,
      _text,
    });
  });

  return rows;
}

/**
 * ビックカメラ商品ブロックから 1 行分を組み立てる（.prod_box / .cssopa / .bcs_maker）
 */
function extractOneBiccameraProdBox($, $box, rank, knownManufacturers, hrefSeen) {
  const hrefSeenSet = hrefSeen || new Set();
  const $link = $box.find('a.cssopa').first();
  let rawHref = $link.attr('href') || '';
  if (!rawHref) {
    rawHref =
      $box.find('a[href*="/bc/item/"]').first().attr('href') ||
      $box.find('a[href*="/bc/products/"]').first().attr('href') ||
      '';
  }
  let href = String(rawHref || '').trim();
  if (href.startsWith('//')) href = `https:${href}`;
  else if (href.startsWith('/')) href = `https://www.biccamera.com${href}`;
  else if (href && !/^https?:\/\//i.test(href)) {
    href = `https://www.biccamera.com/${href.replace(/^\//, '')}`;
  }
  if (!href || hrefSeenSet.has(href)) return null;
  hrefSeenSet.add(href);

  const imgAlt = ($link.find('img').first().attr('alt') || '').replace(/\s+/g, ' ').trim();
  let titleText = imgAlt;
  let maxLen = 0;
  $box.find('a').each((_, a) => {
    const t = $(a).text().replace(/\s+/g, ' ').trim();
    if (!t || t.length < 8) return;
    if (t.length > maxLen) {
      maxLen = t.length;
      titleText = t;
    }
  });
  if (!titleText) titleText = imgAlt;

  const makerFromDom = ($box.find('.bcs_maker').first().text() || '')
    .replace(/\s+/g, ' ')
    .trim();
  const makerShort = makerFromDom ? makerFromDom.split(/[／｜|]/)[0].trim() : '';

  const blockText = $box.text().replace(/\s+/g, ' ').trim();
  const _text = [blockText, imgAlt, makerFromDom].filter(Boolean).join(' ');

  const manufacturer =
    findManufacturerInBlock(`${titleText} ${blockText}`, knownManufacturers) ||
    makerShort ||
    '不明';

  let model;
  if (manufacturer === '不明') {
    model = titleText || imgAlt || '不明';
  } else {
    model = extractLikelyModelFromBlock(_text, manufacturer);
    if (!model) {
      model = titleText.replace(manufacturer, '').replace(/^[\s　]+/, '').trim();
    }
    if (!model) model = imgAlt;
    if (!model) model = '不明';
  }

  return {
    rank,
    manufacturer,
    model: String(model).replace(/\s+/g, ' ').trim().slice(0, 200),
    href,
    _text,
  };
}

/**
 * ビックカメラ bc/ranking/ の HTML から順位・商品を抽出する。
 * id="rankli_N" がある場合はそれを順位に使い、無ければ prod_box の出現順。
 */
function extractBiccameraRankingRowsFromHtml(html, seenHref) {
  const hrefSeen = seenHref || new Set();
  const $ = cheerio.load(String(html || ''));
  const knownManufacturers = KNOWN_MANUFACTURERS_RANKING;
  const rows = [];

  const rankLis = $('[id^="rankli_"]');
  if (rankLis.length > 0) {
    rankLis.each((_, li) => {
      const $li = $(li);
      const id = $li.attr('id') || '';
      const m = /^rankli_(\d+)$/i.exec(id);
      const rank = m ? parseInt(m[1], 10) : 0;
      if (!Number.isFinite(rank) || rank < 1) return;

      const $box = $li.find('[class*="prod_box"]').first();
      if (!$box.length) return;

      const row = extractOneBiccameraProdBox($, $box, rank, knownManufacturers, hrefSeen);
      if (row) rows.push(row);
    });
    if (rows.length > 0) return rows;
  }

  const seenBoxes = new Set();
  $('[class*="prod_box"]').each((_, el) => {
    const cls = $(el).attr('class') || '';
    if (!/\bprod_box\b/.test(cls)) return;
    if (seenBoxes.has(el)) return;
    seenBoxes.add(el);

    const row = extractOneBiccameraProdBox(
      $,
      $(el),
      rows.length + 1,
      knownManufacturers,
      hrefSeen
    );
    if (row) rows.push(row);
  });

  return rows;
}

function biccameraHtmlLooksLikeAkamaiChallenge(html) {
  const s = String(html || '');
  if (s.length < 3500) return true;
  if (
    /sec-if-cpt-container|scf-akamai-logo|Powered and protected by/i.test(s) &&
    !/\bprod_box\b/.test(s)
  ) {
    return true;
  }
  return false;
}

function isPlaywrightChromiumMissingError(err) {
  return String(err?.message || '').includes("Executable doesn't exist");
}

/**
 * Playwright のみでビックランキング HTML を取得（失敗時は呼び出し側で HTTP フォールバック可）
 */
async function fetchBiccameraRankingHtmlPlaywrightOnly(targetUrl) {
  // ビックカメラ等で net::ERR_HTTP2_PROTOCOL_ERROR になる環境があるため HTTP/2 を切る
  const launchOpts = {
    headless: true,
    args: ['--disable-http2', '--disable-blink-features=AutomationControlled'],
  };
  if (process.env.PLAYWRIGHT_CHROMIUM_NO_SANDBOX === '1') {
    launchOpts.args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  const pwChannel = String(process.env.BICCAMERA_PLAYWRIGHT_CHANNEL || '').trim();
  if (pwChannel) {
    launchOpts.channel = pwChannel;
  }

  console.log('📥 [Playwright] BicCamera ranking HTML:', targetUrl);
  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 1365, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
      } catch {
        /* ignore */
      }
    });
    const page = await context.newPage();
    await page.setExtraHTTPHeaders({
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    });
    // domcontentloaded だけ待つと Akamai 等で 60s 超えることがある。commit で先に確定し、あとから DCL／商品要素を待つ。
    await page.goto(targetUrl, { waitUntil: 'commit', timeout: 90000 });
    await page
      .waitForLoadState('domcontentloaded', { timeout: 90000 })
      .catch(() => {
        console.warn('⚠️ BicCamera: domcontentloaded 待ちをスキップ（タイムアウト）');
      });
    await page.waitForSelector('body', { state: 'attached', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 5000));
    await Promise.race([
      page.waitForSelector('[id^="rankli_"]', { timeout: 45000 }),
      page.waitForSelector('[class*="prod_box"]', { timeout: 45000 }),
    ]).catch(() => {
      console.warn('⚠️ BicCamera: rankli / prod_box の出現待ちがタイムアウト（続行して HTML を取得）');
    });

    for (let i = 0; i < BICCAMERA_RANKING_SCROLL_ROUNDS; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, Math.max(500, window.innerHeight));
      });
      await new Promise((r) => setTimeout(r, 450));
    }

    const html = await page.content();
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    return { html, fetchedUrl: targetUrl, fetchVia: 'playwright' };
  } finally {
    await browser.close().catch(() => {});
    console.log('🧹 [Playwright] BicCamera browser closed');
  }
}

/**
 * ビックカメラは Akamai 等で素の HTTP がチャレンジになりやすいが、環境によっては HTTP で取れる。
 * まず Playwright、失敗またはチャレンジページっぽい HTML のときは got-scraping を試す。
 * Chromium 未インストール時は分かりやすいメッセージを投げる。
 */
async function fetchBiccameraRankingHtmlWithPlaywright(urlStr) {
  const targetUrl = (() => {
    try {
      const u = new URL(urlStr);
      u.hash = '';
      return u.href;
    } catch {
      return urlStr;
    }
  })();

  let playErr = null;
  try {
    const out = await fetchBiccameraRankingHtmlPlaywrightOnly(targetUrl);
    if (!biccameraHtmlLooksLikeAkamaiChallenge(out.html)) {
      return out;
    }
    console.warn(
      '⚠️ BicCamera Playwright HTML looks like challenge or empty; trying HTTP fallback'
    );
  } catch (e) {
    playErr = e;
    console.warn('⚠️ BicCamera Playwright failed:', e.message);
  }

  let httpFallbackHtmlLen = 0;
  try {
    const html = await fetchHtmlWithHttpClient(targetUrl);
    httpFallbackHtmlLen = String(html || '').length;
    if (!biccameraHtmlLooksLikeAkamaiChallenge(html) && /\bprod_box\b/.test(html)) {
      console.log('✅ BicCamera ranking HTML via HTTP fallback');
      return { html, fetchedUrl: targetUrl, fetchVia: 'http' };
    }
    console.warn(
      '⚠️ BicCamera HTTP fallback: チャレンジページ相当、または prod_box なし（バイト数:',
      httpFallbackHtmlLen,
      '）'
    );
  } catch (e) {
    console.warn('⚠️ BicCamera HTTP fallback failed:', e.message);
  }

  if (playErr && isPlaywrightChromiumMissingError(playErr)) {
    const err = new Error(
      'Playwright 用の Chromium が未インストールです。server フォルダで次を実行してください: npx playwright install chromium'
    );
    err.code = 'PLAYWRIGHT_BROWSER_MISSING';
    throw err;
  }

  if (playErr) {
    if (String(playErr.message || '').includes('ERR_HTTP2_PROTOCOL_ERROR')) {
      const err = new Error(
        'ビックカメラへの接続で HTTP/2 エラーが発生しました。app.js では Chromium に --disable-http2 を付与済みです。サーバーを再起動して再試行するか、VPN／別回線、またはしばらく時間をおいて試してください。'
      );
      err.code = 'BICCAMERA_HTTP2_ERROR';
      err.cause = playErr;
      throw err;
    }
    if (/Timeout \d+ms exceeded/i.test(String(playErr.message || ''))) {
      const err = new Error(
        'ビックカメラのページ表示がタイムアウトしました。時間をおいて再試行するか、Mac に Google Chrome を入れたうえで環境変数 BICCAMERA_PLAYWRIGHT_CHANNEL=chrome を設定してサーバーを再起動し、システムの Chrome 経由で取得を試してください。'
      );
      err.code = 'BICCAMERA_GOTO_TIMEOUT';
      err.cause = playErr;
      throw err;
    }
    throw playErr;
  }

  const err = new Error(
    'ビックカメラのランキング本文を取得できませんでした（Bot 対策でヘッドレスのみでは本文が返らない可能性があります）。環境変数 BICCAMERA_PLAYWRIGHT_CHANNEL=chrome で再試行するか、時間をおいて試してください。'
  );
  err.code = 'BICCAMERA_FETCH_EMPTY';
  throw err;
}

/*Playwrightスクレイピング*/
/*この関数は、指定されたウェブサイト（URL）から
本文テキストを抽出（スクレイピング）するためのもの。
この関数の最大の特徴は、2段階の堅牢な方法でコンテンツ取得を試みること

本命（Playwright）: まず、人間がブラウザで見るのと同じようにページを完全に表示させてからテキストを抜き出す、高機能な方法を試す。
保険（HTTPクライアント）: もし本命の方法が失敗したら、サイトの裏側（HTMLソースコード）に直接アクセスしてテキストを抜き出す、シンプルな方法に切り替える。
これにより、現代的なウェブサイト（JavaScriptを多用するサイト）と、単純な構造のサイトの両方に対応しつつ、エラーが発生しても簡単には諦めない、安定した作りになっている。
効率と確実性の両立: 
PlaywrightはJavaScriptで動的に生成されるコンテンツも取得できるため
確実性が高いですが、リソースを多く消費。もしそれで失敗した場合は、
より軽量なHTTPクライアントに切り替えることで、バランスを取っている。

scrape関数は、記事生成API（/api/generate）の中核的なデータ収集部分を担っている。
*/
function playwrightLaunchOptions() {
  const args = ['--disable-http2', '--disable-blink-features=AutomationControlled'];
  if (process.env.PLAYWRIGHT_CHROMIUM_NO_SANDBOX === '1') {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  return { headless: true, args };
}

async function scrape(url, maxChars = 8000) {
  console.log('📥 [Playwright] Start scrape:', url);
  const browser = await chromium.launch(playwrightLaunchOptions());
  let page; //ページ（タブ）を操作するための変数を準備
  try {
    // --- ここから本命のPlaywrightによる処理 ---
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    page = await context.newPage();//新しいタブを開く
    await page.setExtraHTTPHeaders({
      'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    });
    console.log('🌐 Navigating to:', url);

    //2.ページへのアクセスと待機
    //指定されたURLに移動し、ページの読み込みが落ち着くまで待つ（最大30秒）
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log('⏳ Waiting for body content');
    //念のため、bodyタグが表示されるまで待つ（最大10秒）
    await page.waitForSelector('body', { timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    
    //3.テキストの抽出
    //ページ内のbodyタグ全体の表示テキスト（innerText）を取得
    const text = await page.$eval('body', (el) => el.innerText || '');
    
    //4.テキストの整形
    //連続する空白や改行を一つのスペースにまとめ、前後の余白を削除
    /*データ整形: 抽出したテキストから不要な空白や改行を
    削除する処理（replace(/\s+/g, ' ').trim()）が含まれており、
    後続のAI処理がしやすいように、綺麗なテキストデータに整形している。*/
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length < 200) {
      throw new Error('抽出テキストが短すぎるため、HTTPフォールバックを試行します。');
    }
    console.log(`📝 Scraped ${normalized.length} characters from`, url);
    
    //5.成功：結果を返す
    //抽出したテキストの先頭 maxChars 文字を返す
    return normalized.slice(0, maxChars);
  } catch (err) {
    // --- Playwrightが失敗した場合の保険処理 ---
    console.error('❌ Playwright scraping failed', url, err.message);
    console.log('🔁 Attempting HTTP fallback for', url);
    try {
      //別の関数 `scrapeWithHttpClient` を呼び出して再挑戦
      const fallbackText = await scrapeWithHttpClient(url);
      console.log('✅ Fallback succeeded for', url);
      //こちらも同様に先頭 maxChars 文字を返す
      return fallbackText.slice(0, maxChars);
    } catch (fallbackErr) {
      //保険の手段も失敗した場合
      console.error(
        '💥 Fallback scraping also failed',
        url,
        fallbackErr.message
      );
      //最終的にエラーを投げて、処理を中断させる
      throw fallbackErr;
    }
  } finally {
    //--- 後片付け ---
    //処理が成功しても失敗しても、必ず実行される
    if (page) {
      await page.close().catch(() => {});//開いたタブを閉じる
    }
    await browser.close().catch(() => {});//ブラウザを閉じる
    console.log('🧹 Closed browser instance for', url);
  }
}

/*このコードは「サイトのトップページにアクセスが来たら、準備済みのReactアプリをユーザーに渡す。
もし準備できていなければ、開発者にエラーを教える」という、
Webサーバーの基本的ながら非常に重要な処理を行う*/

app.get('/', (_req, res) => {
  console.log('📨 GET /');
  res.render('index');
});

//この関数は、サーバーに溜まった古いスクリーンショットファイルを自動で掃除するためのもの
function cleanupOldScreenshots() {
  const publicDir = publicPath;
  const oneHourAgo = Date.now() - 60 * 60 * 1000; // 1 hour in milliseconds

  try {
    const files = fs.readdirSync(publicDir);
    let deletedCount = 0;

    files.forEach((file) => {
      if (file.startsWith('pixta_') && file.endsWith('.png')) {
        const filePath = path.join(publicDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtimeMs < oneHourAgo) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log('🗑️ Deleted old screenshot:', file);
        }
      }
    });

    if (deletedCount > 0) {
      console.log(`✅ Cleaned up ${deletedCount} old screenshot(s)`);
    }
  } catch (err) {
    console.error('⚠️ Screenshot cleanup failed:', err.message);
  }
}

/*---③PIXTA画像検索API---*/
/*app.get('/api/searchPIXTAimage', async (req, res) => {
  const { keyword } = req.query;

  console.log('🔍 GET /api/searchPIXTAimage called with keyword:', keyword);

  if (!keyword) {
    console.warn('⚠️ keyword is missing in query');
    return res.status(400).json({ error: 'キーワードを指定してください。' });
  }

  // Clean up old screenshots before creating a new one
  cleanupOldScreenshots();

  const searchUrl = `https://pixta.jp/tags/${encodeURIComponent(keyword)}`;
  console.log('🌐 Searching PIXTA:', searchUrl);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    console.log('📸 Navigating to PIXTA search results');
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // スクリーンショットを取得
    const screenshotPath = path.join(__dirname, 'public', `pixta_${keyword}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('📷 Screenshot saved:', screenshotPath);

    // 素材情報を取得
    console.log('🔍 Extracting image data from search results');
    const images = await page.$$eval('.item-list--large__wrap', (elements) => {
      return elements.map((el) => {
        // div要素のid属性から素材番号を取得
        const divWithId = el.querySelector('div[id]');
        const materialNo = divWithId ? divWithId.id : null;

        // img要素のdata-src属性またはsrc属性から画像URLを取得
        const img = el.querySelector('img.lozad');
        const srcUrl = img ? (img.getAttribute('data-src') || img.getAttribute('src')) : null;

        return materialNo && srcUrl ? { materialNo, srcUrl } : null;
      }).filter(item => item !== null);
    });

    console.log(`✅ Found ${images.length} images from PIXTA`);

    await page.close();

    res.json({
      PIXTAimages: images,
      screenshot: path.basename(screenshotPath)
    });
  } catch (err) {
    console.error('❌ PIXTA search failed:', err.message);
    res.status(500).json({
      error: 'PIXTA検索に失敗しました。',
      details: err.message
    });
  } finally {
    if (browser) {
      await browser.close();
      console.log('🧹 Closed browser instance');
    }
  }
});*/


app.get('/api/category-ranking-theme-presets', (req, res) => {
  const category = String(req.query?.category ?? '').trim();
  if (!category) {
    return res.status(400).json({ error: 'カテゴリを指定してください。' });
  }
  return res.json({
    category,
    presets: getRankingThemePresets(category),
    defaultSelection: getDefaultRankingThemeSelection(category),
  });
});

app.post('/api/resolve-category-ranking-urls', async (req, res) => {
  const category = String(req.body?.category ?? '').trim();
  console.log('🛎️ POST /api/resolve-category-ranking-urls called with:', { category });

  if (!category) {
    return res.status(400).json({ error: 'カテゴリを入力してください。' });
  }

  try {
    const result = await resolveCategoryRankingUrls(category, {
      fetchHtmlWithHttpClient,
      getGeminiModel,
      parseJsonFromModelOutput,
    });
    return res.json({
      category,
      rankingUrls: result.urls,
      urlResolution: result.urlResolution,
      notes: result.notes || [],
      savedAt: result.savedAt || null,
      hasSavedUrls: Boolean(result.savedRankingUrls),
      themePresets: getRankingThemePresets(category),
      defaultThemeSelection: getDefaultRankingThemeSelection(category),
    });
  } catch (err) {
    console.error('❌ Resolve category ranking URLs failed', err.message);
    if (isGeminiQuotaExceededError(err)) {
      const retryAfterSec = parseRetryAfterSecondsFromMessage(err.message);
      const payload = {
        error:
          'Gemini API の利用上限に達しました。しばらく待って再実行するか、APIキーの利用枠/課金設定を確認してください。',
        details: err.message,
      };
      if (retryAfterSec) payload.retryAfterSeconds = retryAfterSec;
      return res.status(429).json(payload);
    }
    return res.status(502).json({
      error: 'ランキング URL の自動取得に失敗しました。',
      details: err.message,
    });
  }
});

app.post('/api/build-category-themed-rankings', async (req, res) => {
  const requestStartedAt = Date.now();
  const category = String(req.body?.category ?? '').trim();
  const compositeItems = req.body?.compositeItems;
  const rankingThemes = req.body?.rankingThemes;

  console.log('🛎️ POST /api/build-category-themed-rankings called with:', {
    category,
    compositeCount: Array.isArray(compositeItems) ? compositeItems.length : 0,
    themeCount: Array.isArray(rankingThemes) ? rankingThemes.length : 0,
  });

  if (!category) {
    return res.status(400).json({ error: 'カテゴリを入力してください。' });
  }

  try {
    const result = applyCategoryThemedRankings(category, compositeItems, rankingThemes);
    console.log(
      '✅ Completed /api/build-category-themed-rankings in',
      `${Date.now() - requestStartedAt}ms`
    );
    return res.json(result);
  } catch (err) {
    console.error('❌ Themed rankings build failed', err.message);
    return res.status(400).json({
      error: err.message || '見出し別ランキングの作成に失敗しました。',
    });
  }
});

app.get('/api/category-ranking-urls', (req, res) => {
  const category = String(req.query?.category ?? '').trim();
  if (!category) {
    const categories = listSavedRankingCategories();
    return res.json({
      saved: categories.length > 0,
      count: categories.length,
      categories,
    });
  }
  const saved = loadSavedRankingUrls(category);
  if (!saved) {
    return res.json({ category, saved: false, rankingUrls: null });
  }
  return res.json({
    category: saved.category,
    saved: true,
    rankingUrls: saved.rankingUrls,
    savedAt: saved.savedAt,
    note: saved.note,
  });
});

app.post('/api/category-ranking-urls', (req, res) => {
  const category = String(req.body?.category ?? '').trim();
  const rankingUrls = req.body?.rankingUrls;
  const note = req.body?.note;

  if (!category) {
    return res.status(400).json({ error: 'カテゴリを指定してください。' });
  }

  try {
    const payload = saveRankingUrls(category, rankingUrls, { note });
    console.log('💾 Saved category ranking URLs:', { category: payload.category });
    return res.json({ ok: true, ...payload });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.get('/api/competitor-articles', (req, res) => {
  ensureCompetitorArticlesStoreFile();
  const category = String(req.query?.category ?? '').trim();
  if (!category) {
    const categories = listSavedCompetitorCategories();
    return res.json({
      saved: categories.length > 0,
      count: categories.length,
      categories,
    });
  }
  const saved = loadSavedCompetitorArticles(category);
  if (!saved) {
    return res.json({ category, saved: false, articles: null });
  }
  return res.json({
    category: saved.category,
    saved: true,
    articles: saved.articles,
    hubUrl: saved.hubUrl,
    savedAt: saved.savedAt,
    note: saved.note,
  });
});

app.post('/api/competitor-articles', (req, res) => {
  const category = String(req.body?.category ?? '').trim();
  const articles = req.body?.articles;
  const note = req.body?.note;
  const hubUrl = req.body?.hubUrl;

  if (!category) {
    return res.status(400).json({ error: 'カテゴリを指定してください。' });
  }

  try {
    const payload = saveCompetitorArticles(category, articles, { note, hubUrl });
    console.log('💾 Saved competitor articles:', {
      category: payload.category,
      count: payload.articles.length,
    });
    return res.json({ ok: true, ...payload });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.post('/api/competitor-articles/analyze', async (req, res) => {
  const category = String(req.body?.category ?? '').trim();
  const articles = req.body?.articles;

  if (!category) {
    return res.status(400).json({ error: 'カテゴリを指定してください。' });
  }

  console.log('🛎️ POST /api/competitor-articles/analyze called with:', { category });

  try {
    const result = await analyzeCompetitorArticles(
      category,
      { articles: Array.isArray(articles) ? articles : undefined },
      {
        fetchHtmlWithHttpClient,
        scrapeText: scrape,
        loadArticleMaster,
      }
    );
    console.log('✅ Competitor article analysis:', {
      category,
      proposals: result.summary?.proposalCount,
      success: result.summary?.successCount,
      headingUpdates: result.summary?.headingUpdateCount,
    });
    return res.json(result);
  } catch (err) {
    console.error('❌ Competitor article analysis failed:', err.message);
    return res.status(400).json({ error: err.message });
  }
});

app.get('/api/competitor-articles/last-analysis', (req, res) => {
  const category = String(req.query?.category ?? '').trim();
  if (!category) {
    return res.status(400).json({ error: 'カテゴリを指定してください。' });
  }
  const analysis = loadLastAnalysis(category);
  if (!analysis) {
    return res.status(404).json({ error: '前回の比較結果がありません。' });
  }
  return res.json(analysis);
});

app.post('/api/extract-category-rankings', async (req, res) => {
  const requestStartedAt = Date.now();
  const category = String(req.body?.category ?? '').trim();
  const rankingUrls = req.body?.rankingUrls;
  const rankingThemes = req.body?.rankingThemes;

  console.log('🛎️ POST /api/extract-category-rankings called with:', {
    category,
    hasManualUrls: Boolean(rankingUrls),
    themeCount: Array.isArray(rankingThemes) ? rankingThemes.length : 0,
  });

  if (!category) {
    return res.status(400).json({ error: 'カテゴリを入力してください。' });
  }

  try {
    const result = await fetchCategoryRankings(
      category,
      {
        fetchHtmlWithHttpClient,
        getGeminiModel,
        parseJsonFromModelOutput,
      },
      { rankingUrls, rankingThemes }
    );

    console.log(
      '✅ Completed /api/extract-category-rankings in',
      `${Date.now() - requestStartedAt}ms`
    );

    return res.json(result);
  } catch (err) {
    console.error('❌ Category ranking failed', err.message);
    if (isGeminiQuotaExceededError(err)) {
      const retryAfterSec = parseRetryAfterSecondsFromMessage(err.message);
      const payload = {
        error:
          'Gemini API の利用上限に達しました。しばらく待って再実行するか、APIキーの利用枠/課金設定を確認してください。',
        details: err.message,
      };
      if (retryAfterSec) payload.retryAfterSeconds = retryAfterSec;
      return res.status(429).json(payload);
    }
    return res.status(502).json({
      error: 'カテゴリ別ランキングの取得または CSV 出力に失敗しました。',
      details: err.message,
    });
  }
});

app.get('/api/categories', (_req, res) => {
  try {
    return res.json(getCategoriesPayload());
  } catch (err) {
    console.error('❌ GET /api/categories failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/weekly/config', (req, res) => {
  return res.json({
    defaultCategory: weeklyReportConfig.defaultCategory,
    categories: getCategoriesPayload().categories,
    bestseller: weeklyReportConfig.bestseller,
    articlePerformancePhase: weeklyReportConfig.articlePerformancePhase,
    reasonMode: weeklyReportConfig.reasonMode,
    weekDefinition: weeklyReportConfig.weekDefinition,
    performance: weeklyReportConfig.performance,
    priorityScoring: weeklyReportConfig.priorityScoring,
    signals: weeklyReportConfig.signals,
    comparison: weeklyReportConfig.comparison,
  });
});

app.get('/api/weekly/report', async (req, res) => {
  const category = String(req.query?.category || weeklyReportConfig.defaultCategory).trim();
  const weekId = String(req.query?.weekId || '').trim() || getIsoWeekId();
  const compareMode = normalizeCompareMode(req.query?.compare);
  const articleMaster = loadArticleMaster(category);

  let snapshot = loadSnapshot(category, weekId);
  if (!snapshot) {
    const latest = findLatestSnapshot(category);
    if (latest?.weekId === weekId) snapshot = latest;
  }

  if (snapshot) {
    const report = await attachGoogleSearchInterest(
      buildReportFromSnapshot(snapshot, articleMaster, compareMode),
      category
    );
    return res.json({
      ...report,
      snapshots: listSnapshots(category),
    });
  }

  const report = await attachGoogleSearchInterest(
    buildEmptyReportWithComparison(category, articleMaster, weekId, compareMode),
    category
  );
  return res.json({
    ...report,
    snapshots: listSnapshots(category),
  });
});

app.post('/api/weekly/fetch', async (req, res) => {
  const requestStartedAt = Date.now();
  const category = String(req.body?.category || weeklyReportConfig.defaultCategory).trim();
  const compareMode = normalizeCompareMode(req.body?.compare);
  const weekId = getIsoWeekId();
  const articleMaster = loadArticleMaster(category);

  console.log('🛎️ POST /api/weekly/fetch called with:', {
    category,
    weekId,
    compareMode,
  });

  try {
    const fetchResult = await fetchCategoryRankings(
      category,
      {
        fetchHtmlWithHttpClient,
        getGeminiModel,
        parseJsonFromModelOutput,
      },
      {}
    );

    const fetchedAt = new Date().toISOString();
    const report = buildWeeklyReportWithComparison({
      category,
      weekId,
      fetchResult,
      articleMaster,
      fetchedAt,
      compareMode,
    });

    saveSnapshot(category, weekId, {
      weekId,
      category,
      fetchedAt: report.fetchedAt,
      compositeRanking: fetchResult.compositeRanking,
      warnings: fetchResult.warnings || [],
      report,
    });

    console.log('✅ Completed /api/weekly/fetch in', `${Date.now() - requestStartedAt}ms`);

    const reportWithInterest = await attachGoogleSearchInterest(report, category);

    return res.json({
      ...reportWithInterest,
      snapshots: listSnapshots(category),
      csvDownloadUrl: fetchResult.compositeCsvDownloadUrl || null,
    });
  } catch (err) {
    console.error('❌ Weekly fetch failed', err.message);
    if (isGeminiQuotaExceededError(err)) {
      const retryAfterSec = parseRetryAfterSecondsFromMessage(err.message);
      const payload = {
        error:
          'Gemini API の利用上限に達しました。しばらく待って再実行するか、APIキーの利用枠/課金設定を確認してください。',
        details: err.message,
      };
      if (retryAfterSec) payload.retryAfterSeconds = retryAfterSec;
      return res.status(429).json(payload);
    }
    return res.status(502).json({
      error: '週次ランキングの取得に失敗しました。',
      details: err.message,
    });
  }
});

app.post('/api/weekly/confirm', (req, res) => {
  const category = String(req.body?.category || weeklyReportConfig.defaultCategory).trim();
  const weekId = String(req.body?.weekId || '').trim() || getIsoWeekId();
  const snapshot = loadSnapshot(category, weekId);

  if (!snapshot) {
    return res.status(404).json({
      error: `週次スナップショットが見つかりません（${weekId}）。先にランキングを取得してください。`,
    });
  }

  const confirmedAt = new Date().toISOString();
  const changeEntries = Array.isArray(req.body?.changeEntries) ? req.body.changeEntries : [];
  const changeLog = buildChangeLogFromEntries(changeEntries, weekId, confirmedAt);

  snapshot.confirmedAt = confirmedAt;
  snapshot.changeLog = changeLog;
  // 会社KPI（PV/遷移/CV）は個人サーバーに保存しない
  delete snapshot.hubPagePerformance;
  delete snapshot.productClicks;
  delete snapshot.menuClicks;
  if (snapshot.report) {
    snapshot.report.confirmedAt = confirmedAt;
    snapshot.report.changeEffects = undefined;
  }
  saveSnapshot(category, weekId, snapshot);

  console.log('✅ Weekly report confirmed:', {
    category,
    weekId,
    confirmedAt,
    changeLogCount: changeLog.length,
  });

  return res.json({
    ok: true,
    category,
    weekId,
    confirmedAt,
    changeLogCount: changeLog.length,
  });
});

app.get('/api/download-category-ranking-csv/:filename', (req, res) => {
  const filename = path.basename(String(req.params.filename || ''));
  if (!/^ranking-.+\.csv$/i.test(filename)) {
    return res.status(400).json({ error: '無効なファイル名です。' });
  }
  const filePath = path.join(CSV_EXPORT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'CSV ファイルが見つかりません。' });
  }
  return res.download(filePath, filename, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
});

function normalizeRankingKeywordsFromBody(body) {
  const fromArr = Array.isArray(body?.keywords)
    ? body.keywords.map((k) => String(k || '').trim()).filter(Boolean)
    : [];
  const fromFields = [body?.keyword1, body?.keyword2]
    .map((k) => String(k ?? '').trim())
    .filter(Boolean);
  // 配列だけ1件のときは、keyword1/keyword2 の両方が埋まっている方を優先（2つ目が落ちる不整合を防ぐ）
  if (fromFields.length > fromArr.length) return fromFields.slice(0, 2);
  return fromArr.slice(0, 2);
}

app.post('/api/extract-ranking-by-keywords', async (req, res) => {
  const requestStartedAt = Date.now();
  const { rankingUrl } = req.body;

  const keywords = normalizeRankingKeywordsFromBody(req.body);

  console.log('🛎️ POST /api/extract-ranking-by-keywords called with:', {
    rankingUrl,
    keywords,
  });

  if (!rankingUrl || typeof rankingUrl !== 'string' || !rankingUrl.trim()) {
    return res.status(400).json({ error: 'ランキングページのURLを入力してください。' });
  }
  if (keywords.length > 2) {
    return res.status(400).json({ error: 'キーワードは2つまでです。' });
  }

  let pageText = '';
  try {
    const ruleBasedMaxChars = 25000;
    const aiMaxChars = 8000;
    const trimmedUrl = rankingUrl.trim();
    const maxChars =
      !ENABLE_AI_RANKING_EXTRACTION || keywords.length === 0
        ? ruleBasedMaxChars
        : aiMaxChars;

    // 価格.com itemlist は HTML 解析で商品名を取る（順位/型式が安定）
    // pdf_pg=2 が 2ページ目 — 1〜3ページをマージしてからキーワード絞り込み（最大 RANKING_RESULT_LIMIT 件）
    if (/^https?:\/\/kakaku\.com\/.+\/itemlist\.aspx/i.test(trimmedUrl)) {
      const KAKAKU_ITEMLIST_PAGE_COUNT = 3;
      const baseItemlistUrl = kakakuItemlistPagesBaseUrl(trimmedUrl);
      const fetchedPageUrls = [];
      const seenHref = new Set();
      const mergedRows = [];
      let firstPageHtml = '';
      for (let p = 1; p <= KAKAKU_ITEMLIST_PAGE_COUNT; p++) {
        const pageUrl = kakakuItemlistPageUrl(baseItemlistUrl, p);
        fetchedPageUrls.push(pageUrl);
        try {
          const html = await fetchHtmlWithHttpClient(pageUrl);
          if (p === 1) firstPageHtml = html;
          const rows = extractKakakuItemlistRowsFromHtml(html, seenHref);
          mergedRows.push(...rows);
        } catch (err) {
          console.warn(`⚠️ kakaku itemlist page ${p} fetch failed`, pageUrl, err.message);
          if (p === 1) throw err;
        }
      }
      pageText = cheerio
        .load(firstPageHtml || '')('body')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
      const items = finalizeKakakuItemlistRows(mergedRows, keywords);
      if (items.length === 0) {
        return res.json({
          rankingUrl: trimmedUrl,
          keywords,
          count: 0,
          extractionMode: 'rule-based',
          fetchedPageUrls,
          items: [],
        });
      }
      return res.json({
        rankingUrl: trimmedUrl,
        keywords,
        count: items.length,
        extractionMode: 'rule-based',
        fetchedPageUrls,
        items,
      });
    }

    // ヨドバシ.com カテゴリ人気ランキング（…/ranking/）は HTML で順位・商品名が取れる
    if (/^https?:\/\/(www\.)?yodobashi\.com\/[^?#]+\/ranking\/?/i.test(trimmedUrl)) {
      let html;
      try {
        html = await fetchHtmlWithHttpClient(trimmedUrl);
      } catch (err) {
        console.warn('⚠️ yodobashi ranking fetch failed', trimmedUrl, err.message);
        throw err;
      }
      pageText = cheerio
        .load(html || '')('body')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
      const seenHref = new Set();
      const { rows: mergedRows, fetchedApiUrls } =
        await extractYodobashiRankingRowsMergedWithMcol(html, trimmedUrl, seenHref);
      const fetchedPageUrls = [trimmedUrl, ...fetchedApiUrls];
      const items = finalizeKakakuItemlistRows(mergedRows, keywords);
      if (items.length === 0) {
        return res.json({
          rankingUrl: trimmedUrl,
          keywords,
          count: 0,
          extractionMode: 'rule-based',
          fetchedPageUrls,
          items: [],
        });
      }
      return res.json({
        rankingUrl: trimmedUrl,
        keywords,
        count: items.length,
        extractionMode: 'rule-based',
        fetchedPageUrls,
        items,
      });
    }

    // コジマネット ec/ranking.html（HTTP で取得、rPage 1〜KOJIMA_RANKING_PAGE_COUNT をマージ）
    if (/^https?:\/\/(www\.)?kojima\.net\/ec\/ranking\.html/i.test(trimmedUrl)) {
      const pageUrls = kojimaRankingPageUrls(trimmedUrl, KOJIMA_RANKING_PAGE_COUNT);
      const fetchedPageUrls = [];
      const seenHref = new Set();
      const mergedRows = [];
      let firstPageHtml = '';
      for (const pageUrl of pageUrls) {
        let html;
        try {
          html = await fetchHtmlWithHttpClient(pageUrl);
        } catch (err) {
          console.warn('⚠️ kojima ranking page fetch failed', pageUrl, err.message);
          if (!firstPageHtml) throw err;
          break;
        }
        fetchedPageUrls.push(pageUrl);
        if (!firstPageHtml) firstPageHtml = html;
        const rows = extractKojimaRankingRowsFromHtml(html, seenHref);
        mergedRows.push(...rows);
        if (rows.length === 0) break;
      }
      pageText = cheerio
        .load(firstPageHtml || '')('body')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
      const items = finalizeKakakuItemlistRows(mergedRows, keywords);
      if (items.length === 0) {
        return res.json({
          rankingUrl: trimmedUrl,
          keywords,
          count: 0,
          extractionMode: 'rule-based',
          fetchedPageUrls,
          items: [],
        });
      }
      return res.json({
        rankingUrl: trimmedUrl,
        keywords,
        count: items.length,
        extractionMode: 'rule-based',
        fetchedPageUrls,
        items,
      });
    }

    // ビックカメラ.com カテゴリランキング（/bc/ranking/…）— Akamai 回避のため Playwright で HTML 取得
    if (/^https?:\/\/(www\.)?biccamera\.com\/bc\/ranking\//i.test(trimmedUrl)) {
      let html;
      let fetchedUrlForLog;
      try {
        const out = await fetchBiccameraRankingHtmlWithPlaywright(trimmedUrl);
        html = out.html;
        fetchedUrlForLog = out.fetchedUrl;
      } catch (err) {
        console.warn('⚠️ biccamera ranking Playwright fetch failed', trimmedUrl, err.message);
        throw err;
      }
      pageText = cheerio
        .load(html || '')('body')
        .text()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
      const seenHref = new Set();
      const mergedRows = extractBiccameraRankingRowsFromHtml(html, seenHref);
      const fetchedPageUrls = [fetchedUrlForLog || trimmedUrl];
      const items = finalizeKakakuItemlistRows(mergedRows, keywords);
      if (items.length === 0) {
        return res.json({
          rankingUrl: trimmedUrl,
          keywords,
          count: 0,
          extractionMode: 'rule-based',
          fetchedPageUrls,
          items: [],
        });
      }
      return res.json({
        rankingUrl: trimmedUrl,
        keywords,
        count: items.length,
        extractionMode: 'rule-based',
        fetchedPageUrls,
        items,
      });
    }

    pageText = await scrape(trimmedUrl, maxChars);
  } catch (err) {
    console.error('❌ Ranking page scrape failed', err.message);
    return res.status(502).json({
      error: 'ランキングページの取得に失敗しました。',
      details: err.message,
    });
  }

  // キーワードが無い場合は、AIに渡さずルールベースで「順位一覧」を返す
  if (!ENABLE_AI_RANKING_EXTRACTION || keywords.length === 0) {
    const items = extractRankingByKeywordsRuleBased(pageText, keywords);
    if (items.length === 0) {
      console.log('⚠️ rule-based extraction returned 0 items', {
        rankingUrl: rankingUrl.trim(),
        keywords,
        pageTextLen: String(pageText || '').length,
      });
      // キーワードなしのときは「順位一覧」が目的のため 200 で空配列を返す
      if (keywords.length === 0) {
        return res.json({
          rankingUrl: rankingUrl.trim(),
          keywords,
          count: 0,
          extractionMode: 'rule-based',
          items: [],
        });
      }
      return res.status(404).json({
        error:
          'キーワードに一致するランキング商品を抽出できませんでした。キーワードを変更して再実行してください。',
      });
    }
    console.log(
      '✅ Completed /api/extract-ranking-by-keywords in',
      `${Date.now() - requestStartedAt}ms`,
      '(rule-based)'
    );
    return res.json({
      rankingUrl: rankingUrl.trim(),
      keywords,
      count: items.length,
      extractionMode: 'rule-based',
      items,
    });
  }

  const keywordList = keywords.join('、');
  const prompt = `
あなたは情報抽出アシスタントです。
以下のテキストは家電などのランキングページから取得した本文です。

# キーワード（すべてに関連する商品のみ抽出）
${keywordList}

# ルール
- ページに明示された「順位・人気順・売れ筋順」などのランキングに載っている商品だけを対象にする
- キーワードに合致する商品のみを抽出する（メーカー名・型番・説明文のいずれかに部分一致すればよい）
- 抽出した商品を、順位が高い順（数値が小さい順）に並べる
- 最大${RANKING_RESULT_LIMIT}件まで
- 出力は厳密にJSONのみ（説明文・コメント禁止）

# 出力形式
{
  "items": [
    {
      "rank": 1,
      "manufacturer": "メーカー名",
      "model": "型式",
      "feature": "キーワードとの一致理由（短く）"
    }
  ]
}

# 対象テキスト
${pageText}
  `;

  try {
    console.log('🧠 Extracting ranking by keywords with Gemini');
    const model = await getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const raw = result.response?.text?.() || '';
    const data = parseJsonFromModelOutput(raw);

    if (!Array.isArray(data.items)) {
      throw new Error('items 配列が存在しません。');
    }

    const normalized = data.items
      .map((x) => ({
        rank: Number(x?.rank),
        manufacturer: String(x?.manufacturer ?? '不明').trim() || '不明',
        model: String(x?.model ?? '不明').trim() || '不明',
        feature: String(x?.feature ?? '').trim(),
      }))
      .filter(
        (x) =>
          Number.isInteger(x.rank) &&
          x.rank >= 1 &&
          x.rank <= 999
      )
      .sort((a, b) => a.rank - b.rank)
      .slice(0, RANKING_RESULT_LIMIT);

    if (normalized.length === 0) {
      throw new Error('条件に合う商品を抽出できませんでした。');
    }

    console.log(
      '✅ Completed /api/extract-ranking-by-keywords in',
      `${Date.now() - requestStartedAt}ms`
    );
    return res.json({
      rankingUrl: rankingUrl.trim(),
      keywords,
      count: normalized.length,
      extractionMode: 'ai',
      items: normalized,
    });
  } catch (err) {
    console.error('❌ Ranking extraction failed', err.message);
    if (isGeminiQuotaExceededError(err)) {
      const retryAfterSec = parseRetryAfterSecondsFromMessage(err.message);
      const payload = {
        error:
          'Gemini API の利用上限に達しました。しばらく待って再実行するか、APIキーの利用枠/課金設定を確認してください。',
        details: err.message,
      };
      if (retryAfterSec) {
        payload.retryAfterSeconds = retryAfterSec;
      }
      return res.status(429).json(payload);
    }
    return res.status(502).json({
      error: 'ランキング情報の抽出に失敗しました。',
      details: err.message,
    });
  }
});


//---④記事生成API（メイン機能）---
/*このコードは、このWebアプリケーションの**最も中心的な機能である「記事自動生成API」**を実装した部分。
フロントエンドから「キーワード」と「参考URL」を受け取り、最終的な記事を生成して返すまでの一連の複雑な処理を担う。

[処理は大きく分けて以下の4つのステップで構成]
①入力データの受け取りと検証: ユーザーからのリクエストが妥当かチェック。
②競合記事のスクレイピング: 参考URLのコンテンツを収集。
③記事構成案の生成（AI活用 第1段階）: 収集した情報を基に、AIが記事の骨子（アウトライン）を作成。
④記事本文の生成（AI活用 第2段階）: AIが作成した構成案に沿って、本格的な記事本文を執筆。
この2段階のAI生成プロセスが、出力される記事の品質と安定性を高めるための重要な工夫。*/

/*
GET: 「このページを見せてください」とお願いするだけ。ブラウザのアドレスバーにURLを入れてエンターキーを押すような、通常のページ閲覧がこれにあたる。
POST: 「このデータを渡すので、何か作業をしてください（例: 記事を作る、ユーザー登録をするなど）」と、データと一緒に処理をお願いするのがPOST。
*/
app.post('/api/generate', async (req, res) => {
  const requestStartedAt = Date.now();
  //ステップ1：依頼内容の確認（入力チェック）
  //フロントエンドから送られてきた「キーワード」と「参考URL」を受け取る
  const {
    keyword,
    urls = [],
    competitorUrl1,
    competitorUrl2,
    competitorUrl3,
  } = req.body;

  console.log('🛎️ POST /api/generate called with:', {
    keyword,
    urls,
    competitorUrl1,
    competitorUrl2,
    competitorUrl3,
  });

/*---入力チェック---*/
  //キーワードが空っぽじゃないか？
  if (!keyword) {
    console.warn('⚠️ keyword is missing in request body');
    return res.status(400).json({ error: 'キーワードを入力してください。' });
  }

  //参考URLが1つも入力されていないんじゃないか？
  const candidateUrls = [
    ...urls,
    competitorUrl1,
    competitorUrl2,
    competitorUrl3,
  ]
    .map((u) => u?.trim()) //余分な空白を削除
    .filter(Boolean);      //空のURLを除外

  //未入力ありエラー処理
  if (candidateUrls.length === 0) {
    console.warn('⚠️ No URLs provided');
    return res
      .status(400)
      .json({ error: 'URLを少なくとも1つ入力してください。' });
  }

/*---競合記事のスクレイピング---*/
/*入力された複数の競合URLを順番にスクレイピングし、記事のテキストデータを集めます。*/
  const warnings = [];
  const scrapedArticles = [];

  //依頼されたURLを一つずつ順番に調べる
  for (const url of candidateUrls) {
    try {
      console.log('🔗 Scraping competitor article:', url);
      //scrape関数でWebサイトから本文を抜き出す
      const text = await scrape(url);
      scrapedArticles.push({ url, text });
    } catch (err) {
      console.error('❌ Failed to scrape', url, err.message);
      //失敗しても止めずに、警告リストに記録して次のURLへ
      warnings.push({ url, message: err.message });
    }
  }

  //もし、全部のサイトから情報が取れなかったら...
  if (scrapedArticles.length === 0) {
    console.error('🚨 Scraping failed for all URLs');
    return res.status(502).json({
      error: '競合記事の取得に失敗しました。',
      warnings,
    });
  }

  console.log('📚 Successfully scraped', scrapedArticles.length, 'sources');

  //AIが読みやすいように、集めた情報を一つのテキストにまとめる
  const competitorTexts = scrapedArticles
    .map(
      ({ url, text }) => `【Source】${url}
${text}`
    )
    .join('\n---\n');

/*---記事構成案(アウトライン)生成---*/
/*集めたテキストとキーワードを基に、**「あなたはSEOに強いライターです。これらの情報を参考に、
記事の構成案を考えてください」**という指示（プロンプト）を作成します。*/
/*
H2 * 3
各H2にH3*3
SEO重視
JSONで出力
*/

//AIへの「構成案作成」の依頼書（プロンプト）を作成
  const outlinePrompt = `
あなたはSEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」の記事構成案を作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h1": "タイトル案",
  "sections": [
    {
      "h2": "見出し2",
      "subsections": ["見出し3-1", "見出し3-2", "見出し3-3"]
    }
  ]
}
- H2は3つ、各H2に対してH3を3つ作成
- キーワードとの関連性が高く、検索ユーザーの意図を満たす構成にする
- 各見出しに対応する本文を生成（最低でも300文字以上）
- 内容は具体的で、独自の視点・根拠・事例を交えて説明且つ信頼感があり、客観的
- 家電販売店にふさわしいフォーマルな文体
- 数値・比較・用途別の提案など、検索ユーザーの満足度を意識
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ

# 参考記事
${competitorTexts}
  `;

  let outlineData;
  try {
    //Geminiモデルに構成案の生成を依頼
    console.log('🧠 Generating outline with Gemini');
    const model = await getGeminiModel();
    const outlineResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: outlinePrompt }] }],
    });
    //AIからの返事を整形して、プログラムで扱えるオブジェクト形式に変換
    const outlineRaw = outlineResult.response?.text?.() || '';
    outlineData = parseJsonFromModelOutput(outlineRaw);
    console.log(
      '🧾 Outline generated. H2 count:',
      Array.isArray(outlineData.sections) ? outlineData.sections.length : 0
    );
  } catch (err) {
    //AIが構成案を作れなかったらエラー
    console.error('❌ Outline generation failed', err.message);
    return res.status(502).json({
      error: '記事構成の生成に失敗しました。',
      warnings,
    });
  }

  const outlineJSON = JSON.stringify(outlineData, null, 2);

/*---記事本文生成---*/
/*
上記の構成をもとに本文を生成
構成 → 本文 の2段階生成で品質を安定
JSONで出力
*/
  //AIへの「本文執筆」の依頼書（プロンプト）を作成
  const articlePrompt = `
あなたはSEOに強い家電専門ライターです。  
以下の構成をもとに、完全オリジナルの日本語記事を作成してください。

# テーマ
${keyword}

# 構成
${outlineJSON}

# 出力条件
- 出力形式：JSON
- 構成の階層（H1, H2, H3）を維持したJSONで出力
- 各見出しに対応する本文を生成（最低でも300文字以上）
- 内容は具体的で、独自の視点・根拠・事例を交えて説明且つ信頼感があり、客観的
- 家電販売店にふさわしいフォーマルな文体
- 数値・比較・用途別の提案など、検索ユーザーの満足度を意識
- 製品名・価格は直接記載しない

# 出力フォーマット
{
  "h1": "タイトル",
  "introduction": "導入文",
  "sections": [
    {
      "h2": "見出し2",
      "content": "本文（300文字以上）",
      "subsections": [
        {
          "h3": "見出し3",
          "content": "本文（200文字以上）"
        }
      ]
    }
  ],
  "summary": "まとめ文（150〜200文字）"
}
  `;

  let articleData;
  try {
    //Geminiモデルに、構成案に基づいた本文の執筆を依頼
    console.log('✍️ Generating article body with Gemini');
    const model = await getGeminiModel();
    const articleResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: articlePrompt }] }],
    });
    //AIからの返事を整形して、最終的な記事データとして取得
    const articleRaw = articleResult.response?.text?.() || '';
    articleData = parseJsonFromModelOutput(articleRaw);
    console.log(
      '📄 Article generated. Sections:',
      Array.isArray(articleData.sections) ? articleData.sections.length : 0
    );
  } catch (err) {
    //AIが本文を執筆できなかったらエラー
    console.error('❌ Article generation failed', err.message);
    return res.status(502).json({
      error: '記事本文の生成に失敗しました。',
      outline: outlineData,
      warnings,
    });
  }

  //ステップ5： クライアントへのレスポンス
  //抽出した見出し情報を配列にまとめる
  //フロントエンドで使いやすいように、見出し情報を別途まとめる
  const headings = [];
  //見出し情報をheadings配列に詰める処理
  if (Array.isArray(articleData.sections)) {
    articleData.sections.forEach((section) => {
      if (section?.h2) {
        headings.push({
          level: 'h2',
          text: section.h2,
          body: section.content || '',
        });
      }
      if (Array.isArray(section?.subsections)) {
        section.subsections.forEach((sub) => {
          if (sub?.h3) {
            headings.push({
              level: 'h3',
              text: sub.h3,
              body: sub.content || '',
            });
          }
        });
      }
    });
  }
  //処理にかかった時間を記録
  console.log(
    '✅ Completed /api/generate in',
    `${Date.now() - requestStartedAt}ms`
  );
  //完成した記事データなどをJSON形式でクライアントに送信
  /*res.json()は、Express.jsの機能で、
  JavaScriptのオブジェクトをJSON（ジェイソン）というデータ形式に
  変換して、HTTPレスポンスとして送信。
  フロントエンドのReactアプリケーションは、
  このJSONデータを受け取って画面に表示*/
  res.json({
    title: articleData.h1 || '',
    introduction: articleData.introduction || '',
    summary: articleData.summary || '',
    sections: Array.isArray(articleData.sections) ? articleData.sections : [],
    outline: outlineData,
    article: articleData,
    /*記事の中から見出し（H2, H3）だけを抜き出して整形した配列*/
    headings,
    /*スクレイピング中に発生した警告メッセージのリスト*/
    warnings,
  });
});

const {
  filterKojimaProducts,
  proposeUseCases,
  assignProductsToUseCases,
  generateCopyForProduct,
  renderUseCaseHtml,
} = require('./useCaseRecommendEngine');

function normalizeUseCaseProductsPayload(items) {
  return Array.isArray(items) ? items : [];
}

function geminiQuotaPayload(err) {
  const retryAfterSec = parseRetryAfterSecondsFromMessage(err.message);
  const payload = {
    error:
      'Gemini API の利用上限に達しました。しばらく待って再実行するか、APIキーの利用枠/課金設定を確認してください。',
    details: err.message,
  };
  if (retryAfterSec) payload.retryAfterSeconds = retryAfterSec;
  return payload;
}

app.post('/api/usecase/propose', async (req, res) => {
  const category = String(req.body?.category || '').trim();
  const items = normalizeUseCaseProductsPayload(req.body?.items);
  if (!category) {
    return res.status(400).json({ error: 'カテゴリを指定してください。' });
  }
  if (!items.length) {
    return res.status(400).json({
      error: 'ランキング商品が空です。週次レポートまたは競合調査でランキングを取得してください。',
    });
  }
  try {
    const result = await proposeUseCases({
      category,
      products: items,
      getGeminiModel,
    });
    return res.json({ ok: true, category, ...result });
  } catch (err) {
    console.error('💥 /api/usecase/propose error:', err);
    if (isGeminiQuotaExceededError(err)) {
      return res.status(429).json(geminiQuotaPayload(err));
    }
    return res.status(500).json({
      error: '用途の提案に失敗しました。',
      details: err.message,
    });
  }
});

app.post('/api/usecase/assign', async (req, res) => {
  const category = String(req.body?.category || '').trim();
  const items = normalizeUseCaseProductsPayload(req.body?.items);
  const useCases = Array.isArray(req.body?.useCases) ? req.body.useCases : [];
  if (!category) {
    return res.status(400).json({ error: 'カテゴリを指定してください。' });
  }
  if (useCases.length < 1) {
    return res.status(400).json({ error: '用途を1つ以上指定してください。' });
  }
  try {
    const result = await assignProductsToUseCases({
      useCases: useCases.slice(0, 3),
      products: items,
      getGeminiModel,
    });
    return res.json({
      ok: true,
      category,
      kojimaPreview: filterKojimaProducts(items).slice(0, 20).map((p) => ({
        key: p._key,
        label: p.label,
        rankKojima: p.rankKojima,
        hrefKojima: p.hrefKojima,
      })),
      ...result,
    });
  } catch (err) {
    console.error('💥 /api/usecase/assign error:', err);
    if (isGeminiQuotaExceededError(err)) {
      return res.status(429).json(geminiQuotaPayload(err));
    }
    return res.status(500).json({
      error: '商品の振り分けに失敗しました。',
      details: err.message,
    });
  }
});

app.post('/api/usecase/generate-copy', async (req, res) => {
  const category = String(req.body?.category || '').trim();
  const useCase = req.body?.useCase || {};
  const product = req.body?.product || null;
  const manufacturerUrl = String(req.body?.manufacturerUrl || '').trim() || null;
  const sections = Array.isArray(req.body?.sections) ? req.body.sections : null;

  if (!category) {
    return res.status(400).json({ error: 'カテゴリを指定してください。' });
  }

  // 一括は Playwright より HTTP 優先（9件×ブラウザ起動でゲートウェイタイムアウトしやすい）
  const scrapeFast = async (url, maxChars = 12000) => {
    try {
      const text = await scrapeWithHttpClient(url);
      const normalized = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (normalized.length >= 200) return normalized.slice(0, maxChars);
    } catch (err) {
      console.warn('usecase scrapeFast HTTP failed, fallback to Playwright:', err.message);
    }
    return scrape(url, maxChars);
  };

  try {
    // 一括: sections = [{ label, useCaseId, products: [{...}, manufacturerUrl?] }]
    if (sections?.length) {
      const outSections = [];
      const errors = [];
      for (const sec of sections) {
        const productsOut = [];
        for (const p of sec.products || []) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const generated = await generateCopyForProduct({
              category,
              useCase: {
                id: sec.useCaseId,
                label: sec.label,
                rationale: sec.rationale,
              },
              product: p,
              manufacturerUrl: p.manufacturerUrl || null,
              scrape: scrapeFast,
              getGeminiModel,
            });
            productsOut.push({
              ...p,
              copy: generated.copy,
              manufacturerUrl: generated.manufacturerUrl,
              scrapeError: generated.scrapeError,
              scrapeCharCount: generated.scrapeCharCount,
            });
          } catch (err) {
            const message = String(err?.message || err);
            console.error('usecase generate-copy product failed:', p?.label || p?.key, message);
            errors.push({
              useCaseId: sec.useCaseId,
              label: sec.label,
              productKey: p?.key || '',
              productLabel: p?.label || p?.productName || '',
              error: message,
            });
            productsOut.push({
              ...p,
              copy: {
                heading: p?.label || p?.productName || '（生成失敗）',
                description: `※この商品の生成に失敗しました: ${message}`,
                featureRows: [],
                linkLabel: '商品詳細はこちら',
                hrefKojima: p?.hrefKojima || null,
                manufacturerUrl: p?.manufacturerUrl || null,
              },
              manufacturerUrl: p?.manufacturerUrl || null,
              scrapeError: message,
              scrapeCharCount: 0,
              generateError: message,
            });
          }
        }
        outSections.push({
          useCaseId: sec.useCaseId,
          label: sec.label,
          rationale: sec.rationale || '',
          products: productsOut,
        });
      }
      return res.json({
        ok: true,
        category,
        sections: outSections,
        html: renderUseCaseHtml(outSections),
        errorCount: errors.length,
        errors,
      });
    }

    if (!product) {
      return res.status(400).json({ error: 'product または sections を指定してください。' });
    }

    const generated = await generateCopyForProduct({
      category,
      useCase,
      product,
      manufacturerUrl,
      scrape: scrapeFast,
      getGeminiModel,
    });
    return res.json({
      ok: true,
      category,
      ...generated,
    });
  } catch (err) {
    console.error('💥 /api/usecase/generate-copy error:', err);
    if (isGeminiQuotaExceededError(err)) {
      return res.status(429).json(geminiQuotaPayload(err));
    }
    return res.status(500).json({
      error: '説明文・機能表の生成に失敗しました。',
      details: err.message,
    });
  }
});

const registerArticleAppRoutes = require('./articleAppGenerate');
registerArticleAppRoutes(app, { scrape, getGeminiModel });

const server = app.listen(PORT, () =>
  console.log(`✅ Server ready on http://localhost:${PORT}`)
);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `❌ ポート ${PORT} は既に使用中です（EADDRINUSE）。\n` +
        `   別ターミナルで動いている node / nodemon を停止するか、次で占有プロセスを終了してください:\n` +
        `   kill $(lsof -ti :${PORT})\n` +
        `   別ポートで起動する場合: PORT=3051 npm run dev（client/vite.config.js の proxy target も同じ番号に合わせる）`
    );
    process.exit(1);
  }
  throw err;
});
