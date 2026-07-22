'use strict';

const {
  parseJsonFromModelOutput,
  normalizeSectionsArray,
} = require('./parseModelJson');

/** introductionData から sections を配列で取得（キー名ゆれ・配列風オブジェクト対応） */
function pickSectionsFromIntroduction(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return (
    normalizeSectionsArray(obj.sections) ||
    normalizeSectionsArray(obj.Sections) ||
    normalizeSectionsArray(obj.section) ||
    normalizeSectionsArray(obj.article_sections)
  );
}

function normalizeSubsectionsList(v) {
  const a = normalizeSectionsArray(v);
  if (a && a.length) return a;
  if (Array.isArray(v) && v.length) return v;
  return [];
}

const MAX_OUTLINE_H4 = 3;

function normalizeHeadingOutline(keyword, sectionsRaw) {
  const kw = String(keyword || '').trim() || '商品';
  const defaults = [
    { h2: `${kw}選びのポイント`, subsections: ['', '', ''] },
    { h2: `${kw}の人気メーカー`, subsections: ['', '', ''] },
  ];
  const list = Array.isArray(sectionsRaw) ? sectionsRaw : [];
  return defaults.map((def, i) => {
    const src = list[i] || {};
    const itemsSrc = Array.isArray(src.items) ? src.items : null;
    const subsRaw = itemsSrc
      ? itemsSrc.map((it) => (typeof it === 'string' ? it : it?.h3 || ''))
      : normalizeSubsectionsList(src.subsections);
    const items = [0, 1, 2].map((j) => {
      const raw = itemsSrc?.[j];
      const h3Raw = subsRaw[j];
      const h3 =
        (raw && typeof raw === 'object' ? String(raw.h3 || '').trim() : '') ||
        (typeof h3Raw === 'string'
          ? h3Raw.trim()
          : String(h3Raw?.h3 || h3Raw?.title || '').trim());
      const h4s = [0, 1, 2].map((k) => {
        const h4 = Array.isArray(raw?.h4s) ? raw.h4s[k] : '';
        return String(h4 || '').trim();
      });
      return { h3, h4s };
    });
    return {
      h2: String(src.h2 || def.h2).trim() || def.h2,
      subsections: items.map((it) => it.h3),
      items,
    };
  });
}

function collectOutlineSections(body) {
  if (!Array.isArray(body?.sections)) return null;
  return body.sections
    .map((sec) => {
      const h2 = String(sec?.h2 || '').trim();
      const itemsSrc = Array.isArray(sec?.items)
        ? sec.items
        : (Array.isArray(sec?.subsections) ? sec.subsections : []).map((h3) => ({
            h3: typeof h3 === 'string' ? h3 : h3?.h3 || '',
            h4s: [],
          }));
      const items = itemsSrc
        .map((item) => {
          const h3 = String(item?.h3 || item?.title || '').trim();
          const h4s = (Array.isArray(item?.h4s) ? item.h4s : [])
            .map((h) => String(h || '').trim())
            .filter(Boolean)
            .slice(0, MAX_OUTLINE_H4);
          return { h3, h4s };
        })
        .filter((item) => item.h3);
      return { h2, items };
    })
    .filter((sec) => sec.h2 && sec.items.length);
}

function bodyPromptRules() {
  return `- キーワードとの関連性が高く、検索ユーザーの意図を満たす構成にする
- 内容は具体的で、独自の視点・根拠・事例を交えて説明且つ信頼感があり、客観的
- 家電販売店にふさわしいフォーマルな文体
- 数値・比較・用途別の提案など、検索ユーザーの満足度を意識
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ`;
}

async function generateH3BodyContent({
  getGeminiModel,
  keyword,
  title,
  heading_h2_first,
  h3Heading,
  competitorTexts,
  referenceOutputSection,
  index,
}) {
  const prompt = `
あなたはSEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」、タイトル「${title}」、H2見出し「${heading_h2_first}」の子見出し「${h3Heading}」の本文を200文字程度で作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h3": "${h3Heading}",
  "content": "本文(200文字程度)"
}
${bodyPromptRules()}
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
`;

  console.log(`🧠 Generating H3-${index} body with Gemini`);
  const raw = await generateGeminiTextWithRetry(getGeminiModel, prompt);
  const data = parseJsonFromModelOutput(raw);
  console.log(`🧾 H3-${index} generated:`, data);
  return data;
}

/** 同一H3配下のH4本文を1回のGemini呼び出しでまとめて生成（API回数削減） */
async function generateH4GroupBodyContent({
  getGeminiModel,
  keyword,
  title,
  heading_h2_first,
  heading_h3,
  h4Headings,
  competitorTexts,
  referenceOutputSection,
}) {
  const list = h4Headings.map((h, i) => `${i + 1}. ${h}`).join('\n');
  const prompt = `
あなたはSEOに強い家電専門ライターです。
キーワード「${keyword}」、タイトル「${title}」、H2「${heading_h2_first}」、H3「${heading_h3}」の配下にある次のH4見出しそれぞれについて、本文を各200文字程度で作成してください。

# 対象H4
${list}

# 出力条件
- JSON形式で出力
- 形式:
{
  "h4_items": [
    { "h4": "対象H4と同じ文言", "content": "本文(200文字程度)" }
  ]
}
- h4_items は対象H4と同じ件数・同じ順序
${bodyPromptRules()}
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
`;

  console.log(
    `🧠 Generating H4 group (${h4Headings.length}) under「${heading_h3}」with Gemini`
  );
  const raw = await generateGeminiTextWithRetry(getGeminiModel, prompt);
  const data = parseJsonFromModelOutput(raw);
  const itemsRaw = Array.isArray(data?.h4_items) ? data.h4_items : [];
  const byH4 = new Map();
  itemsRaw.forEach((item) => {
    const key = String(item?.h4 || '').trim();
    if (!key) return;
    byH4.set(key, String(item?.content || '').trim());
  });
  return h4Headings.map((h4, index) => ({
    h4,
    content: byH4.get(h4) || String(itemsRaw[index]?.content || '').trim(),
  }));
}

/**
 * 記事アプリ（見出し生成／記事生成）向け API。
 * 記事本文はアウトライン（H2 → H3 → 任意H4）の sections を受け取って生成する。
 */
async function scrapeCompetitorArticles(candidateUrls, scrape) {
  const warnings = [];
  const scrapedArticles = [];

  for (const url of candidateUrls) {
    try {
      console.log('🔗 Scraping competitor article:', url);
      const text = await scrape(url);
      scrapedArticles.push({ url, text });
    } catch (err) {
      console.error('❌ Failed to scrape', url, err.message);
      warnings.push({ url, message: err.message });
    }
  }

  return { warnings, scrapedArticles };
}

function collectCandidateUrls(body) {
  const {
    urls = [],
    competitorUrl1,
    competitorUrl2,
    competitorUrl3,
  } = body;

  return [...urls, competitorUrl1, competitorUrl2, competitorUrl3]
    .map((u) => u?.trim())
    .filter(Boolean);
}

function collectHeadingCandidates(body) {
  if (Array.isArray(body?.headingCandidates)) {
    return body.headingCandidates
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 5);
  }
  return [];
}

function buildHeadingCandidatesPromptSection(candidates) {
  if (!candidates?.length) return '';
  const lines = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `
# 選び方の観点候補（週次・競合から拾った読者ニーズ）
以下は「選び方」の観点として使う。商品ランキングやおすすめ商品の見出しにはしない。
H2/H3 は購入判断の軸（比較ポイント・チェック項目）に変換して反映すること。
${lines}
`;
}

function buildSelectionGuideHeadingPrompt({
  keyword,
  headingCandidates,
  competitorTexts,
  referenceOutputSection,
}) {
  const pointsH2 = `${keyword}選びのポイント`;
  const makersH2 = `${keyword}の人気メーカー`;
  return `
あなたはコジマネットなど家電量販店の特集記事ライターです。
キーワード「${keyword}」について、参考記事（掃除機特集など）の構成に合わせた見出し案を作成してください。

# 必須構成（この2つのH2のみ。順番固定）
1. H2「${pointsH2}」— 購入前の判断軸・チェック項目
2. H2「${makersH2}」— 代表的なメーカー紹介（型番・個別商品のおすすめは書かない）

# 禁止
- 「用途別おすすめ」「おすすめ○選」「ランキング掲載商品紹介」の見出し
- H2を3つ以上にする／上記以外のH2を追加する
- 特定型番・価格の羅列

# 参考URLの使い方（最優先）
参考記事の「選びのポイント」「人気メーカー」の見出し粒度・切り口を最優先で参考にする。
文言のコピーは禁止。キーワード「${keyword}」向けに再構成する。
例（掃除機）: 選びのポイント配下に「集じん方法をチェック」など、必要ならその下にH4級の細分がある構成。
ただしこの工程では H2 と H3 のみ出力する（H4は記事生成タブで任意追加）。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h1": "タイトル案（例: 【年】${keyword}のおすすめ…種類や選び方、人気メーカーを紹介）",
  "sections": [
    {
      "h2": "${pointsH2}",
      "subsections": ["観点H3-1", "観点H3-2", "観点H3-3"]
    },
    {
      "h2": "${makersH2}",
      "subsections": ["メーカー名1", "メーカー名2", "メーカー名3"]
    }
  ]
}
- sections は必ず2件（上記H2文言をほぼこのまま使う。語尾の微調整のみ可）
- 各H2に H3 をちょうど3つ
- 「${pointsH2}」のH3は「〜をチェック」「〜の見方」など判断軸にする
- 「${makersH2}」のH3はメーカー名（またはブランド名）にする
- 見出しテキストのみ（本文禁止）
- 家電販売店向けの丁寧な文体
- 出力は厳密にJSONのみ
${buildHeadingCandidatesPromptSection(headingCandidates)}${competitorTexts ? `\n# 他社記事（切り口の参考。商品紹介部分は無視）\n${competitorTexts}` : ''}${referenceOutputSection}
`;
}

function collectReferenceUrls(body) {
  const {
    referenceUrls = [],
    referenceUrl,
    referenceUrl1,
    referenceUrl2,
    referenceUrl3,
  } = body;

  return [
    ...referenceUrls,
    referenceUrl,
    referenceUrl1,
    referenceUrl2,
    referenceUrl3,
  ]
    .map((u) => u?.trim())
    .filter(Boolean);
}

function formatScrapedTexts(scrapedArticles, label, maxCharsPerArticle = 6000) {
  return scrapedArticles
    .map(({ url, text }) => {
      const body = String(text || '');
      const clipped =
        body.length > maxCharsPerArticle
          ? `${body.slice(0, maxCharsPerArticle)}\n…(省略)`
          : body;
      return `【${label}】${url}\n${clipped}`;
    })
    .join('\n---\n');
}

function buildReferenceOutputSection(keyword, referenceTexts) {
  if (!referenceTexts) return '';

  return `
# 出力の参考について
以下の参考記事は、「選び方」セクションの見出し構成・切り口の粒度・文体・情報の出し方を参考にするためのものです。
作成する記事のキーワードは「${keyword}」であり、参考記事のキーワード・テーマとは異なります。
参考記事の文言や内容をそのまま流用せず、選び方の構成・観点のみを参考に、新しいキーワード向けのオリジナルな出力を作成してください。
商品おすすめ・ランキング紹介の見出しは参考にしないでください。

# 出力参考記事
${referenceTexts}
`;
}

async function loadOptionalArticleContext(body, scrape, { maxCharsPerArticle = 4000 } = {}) {
  const warnings = [];
  const candidateUrls = collectCandidateUrls(body);
  const referenceUrls = collectReferenceUrls(body);
  let scrapedArticles = [];
  let scrapedReferenceArticles = [];

  if (candidateUrls.length > 0) {
    const r = await scrapeCompetitorArticles(candidateUrls, scrape);
    warnings.push(...r.warnings);
    scrapedArticles = r.scrapedArticles;
  }
  if (referenceUrls.length > 0) {
    const r = await scrapeCompetitorArticles(referenceUrls, scrape);
    warnings.push(...r.warnings);
    scrapedReferenceArticles = r.scrapedArticles;
  }

  if (
    (candidateUrls.length > 0 || referenceUrls.length > 0) &&
    scrapedArticles.length === 0 &&
    scrapedReferenceArticles.length === 0
  ) {
    warnings.push({
      message:
        '参考URL・他社URLの取得に失敗したため、キーワードとH3のみでH4を提案します。',
    });
  }

  const competitorTexts = formatScrapedTexts(
    scrapedArticles,
    '他社記事',
    maxCharsPerArticle
  );
  const referenceTexts = formatScrapedTexts(
    scrapedReferenceArticles,
    '参考記事',
    maxCharsPerArticle
  );
  const keyword = String(body?.keyword || '').trim();
  const referenceOutputSection = buildReferenceOutputSection(keyword, referenceTexts);

  return {
    warnings,
    competitorTexts,
    referenceOutputSection,
    hasScraped: scrapedArticles.length > 0 || scrapedReferenceArticles.length > 0,
  };
}

function buildH4SuggestPrompt({
  keyword,
  h3,
  competitorTexts,
  referenceOutputSection,
}) {
  return `
あなたはコジマネットなど家電量販店の特集記事ライターです。
キーワード「${keyword}」の「選び方／人気メーカー」記事において、H3見出し「${h3}」の配下に置くH4小見出しの案を作成してください。

# 役割
- 選び方の細分（例: 集じん方法の下のサイクロン式／紙パック式）や補足観点を具体化する
- 商品おすすめ・型番紹介・ランキング掲載の見出しは作らない
- H4は必要なときだけ。最大3つ

# 出力条件
- JSON形式で出力
- 形式:
{
  "h3": "${h3}",
  "subheadings": ["小見出し1（H4）", "小見出し2（H4）", "小見出し3（H4）"]
}
- H4は1〜3つ（不要なら少なくてよい。最大3）
- 各H4は「何を確認するか／どう比べるか」が分かる短文にする
- 各見出しは本文を書かず、見出しテキストのみを出力する
- 家電販売店にふさわしい丁寧な文体
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ
${competitorTexts ? `\n# 他社記事（選び方の切り口のみ参考）\n${competitorTexts}` : ''}${referenceOutputSection}
`;
}

function buildBulkH4SuggestPrompt({
  keyword,
  h3List,
  competitorTexts,
  referenceOutputSection,
}) {
  const list = h3List.map((h, i) => `${i + 1}. ${h}`).join('\n');
  return `
あなたはコジマネットなど家電量販店の特集記事ライターです。
キーワード「${keyword}」の「選び方／人気メーカー」記事について、次の各H3配下に置くH4小見出し案を作成してください。

# 対象H3
${list}

# 役割
- 選び方の細分や補足観点を具体化する
- 商品おすすめ・型番紹介・ランキング掲載の見出しは作らない
- 各H3あたりH4は最大3つ（不要なら少なくてよい）

# 出力条件
- JSON形式で出力
- 形式:
{
  "items": [
    { "h3": "対象H3と同じ文言", "subheadings": ["H4-1", "H4-2", "H4-3"] }
  ]
}
- items は対象H3と同じ件数・同じ順序
- 各見出しは本文を書かず、見出しテキストのみ
- 家電販売店にふさわしい丁寧な文体
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ
${competitorTexts ? `\n# 他社記事（選び方の切り口のみ参考）\n${competitorTexts}` : ''}${referenceOutputSection}
`;
}

function normalizeH4Subheadings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, MAX_OUTLINE_H4);
}

function isQuotaLikeError(err) {
  const message = String(err?.message || '');
  const lower = message.toLowerCase();
  return (
    message.includes('[429 Too Many Requests]') ||
    lower.includes('quota exceeded') ||
    lower.includes('resource_exhausted') ||
    lower.includes('error fetching from') ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  );
}

function parseRetryAfterSeconds(err) {
  const match = String(err?.message || '').match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateGeminiTextWithRetry(getGeminiModel, prompt) {
  const model = await getGeminiModel();
  let lastErr;
  // 連続呼び出しで 429 / 一時通信エラーになりやすいため、待機付きで最大3回
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      return result.response?.text?.() || '';
    } catch (err) {
      lastErr = err;
      if (!isQuotaLikeError(err) || attempt >= 3) break;
      const waitSec = Math.min(parseRetryAfterSeconds(err) || 10 + attempt * 4, 30);
      console.warn(`⚠️ Gemini retry in ${waitSec}s (attempt ${attempt}/3)`);
      await sleep(waitSec * 1000);
    }
  }
  throw lastErr;
}

async function generateOutlineArticleBodies({
  outlineSections,
  getGeminiModel,
  keyword,
  title,
  competitorTexts,
  referenceOutputSection,
  warnings,
  bodyGapMs = 2500,
}) {
  const contentResults = [];
  const outlineResultSections = [];

  for (const sec of outlineSections) {
    const outItems = [];
    for (const item of sec.items) {
      if (item.h4s?.length) {
        try {
          if (contentResults.length > 0 || outItems.length > 0) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(bodyGapMs);
          }
          // eslint-disable-next-line no-await-in-loop
          const h4_items = await generateH4GroupBodyContent({
            getGeminiModel,
            keyword,
            title,
            heading_h2_first: sec.h2,
            heading_h3: item.h3,
            h4Headings: item.h4s,
            competitorTexts,
            referenceOutputSection,
          });
          h4_items.forEach((row) => {
            contentResults.push({
              heading: row.h4,
              data: { content: row.content },
              level: 'h4',
            });
          });
          outItems.push({ h3: item.h3, content: '', h4_items });
        } catch (err) {
          console.error(`❌ outline H4 group generation failed`, err.message);
          warnings.push({
            message: `H3「${item.h3}」配下のH4本文生成に失敗したため空欄にしました。（${String(err.message || '').slice(0, 120)}）`,
          });
          outItems.push({
            h3: item.h3,
            content: '',
            h4_items: item.h4s.map((h4) => ({ h4, content: '' })),
          });
        }
      } else {
        try {
          if (contentResults.length > 0 || outItems.length > 0) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(bodyGapMs);
          }
          // eslint-disable-next-line no-await-in-loop
          const data = await generateH3BodyContent({
            getGeminiModel,
            keyword,
            title,
            heading_h2_first: sec.h2,
            h3Heading: item.h3,
            competitorTexts,
            referenceOutputSection,
            index: outItems.length + 1,
          });
          outItems.push({
            h3: item.h3,
            content: data?.content || '',
            h4_items: [],
          });
          contentResults.push({ heading: item.h3, data, level: 'h3' });
        } catch (err) {
          console.error(`❌ outline H3 generation failed`, err.message);
          warnings.push({
            message: `H3「${item.h3}」本文の生成に失敗したため空欄にしました。（${String(err.message || '').slice(0, 120)}）`,
          });
          outItems.push({
            h3: item.h3,
            content: '',
            h4_items: [],
          });
        }
      }
    }
    outlineResultSections.push({ h2: sec.h2, items: outItems });
  }

  return { contentResults, outlineResultSections };
}

function registerArticleAppRoutes(app, { scrape, getGeminiModel, bindGetAiModel }) {
  function resolveGetAiModel(req) {
    if (typeof bindGetAiModel === 'function') {
      return bindGetAiModel(req);
    }
    const fallback = getGeminiModel || (async () => {
      throw new Error('AI model factory is not configured');
    });
    return Object.assign(fallback, { provider: 'gemini' });
  }

  app.post('/api/article/generate', async (req, res) => {
    const requestStartedAt = Date.now();
    try {
      const getAiModel = resolveGetAiModel(req);
      await handleArticleGenerate(req, res, requestStartedAt, {
        scrape,
        getGeminiModel: getAiModel,
        aiProviderUsed: getAiModel.provider,
      });
    } catch (err) {
      console.error('💥 /api/article/generate unhandled error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          error: err?.message || '記事の生成中にサーバーエラーが発生しました。',
        });
      }
    }
  });

  app.post('/api/article/generate-headings', async (req, res) => {
    const requestStartedAt = Date.now();
    try {
      const getAiModel = resolveGetAiModel(req);
      await handleHeadingGenerate(req, res, requestStartedAt, {
        scrape,
        getGeminiModel: getAiModel,
        aiProviderUsed: getAiModel.provider,
      });
    } catch (err) {
      console.error('💥 /api/article/generate-headings unhandled error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          error: err?.message || '見出しの生成中にサーバーエラーが発生しました。',
        });
      }
    }
  });

  app.post('/api/article/generate-sub-headings', async (req, res) => {
    const requestStartedAt = Date.now();
    try {
      const getAiModel = resolveGetAiModel(req);
      await handleSubHeadingGenerate(req, res, requestStartedAt, {
        scrape,
        getGeminiModel: getAiModel,
        aiProviderUsed: getAiModel.provider,
      });
    } catch (err) {
      console.error('💥 /api/article/generate-sub-headings unhandled error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          error: err?.message || 'H4見出しの生成中にサーバーエラーが発生しました。',
        });
      }
    }
  });
}

async function handleArticleGenerate(
  req,
  res,
  requestStartedAt,
  { scrape, getGeminiModel, aiProviderUsed = 'gemini' }
) {
    const { keyword, title = '', urls = [], competitorUrl1, competitorUrl2, competitorUrl3 } =
      req.body;

    const generateIntroduction =
      req.body.generateIntroduction === true || req.body.generateIntroduction === 'true';
    const generateSummary =
      req.body.generateSummary === true || req.body.generateSummary === 'true';

    console.log('🛎️ POST /api/article/generate called with:', {
      keyword,
      title,
      generateIntroduction,
      generateSummary,
      sectionCount: Array.isArray(req.body?.sections) ? req.body.sections.length : 0,
      urls,
      competitorUrl1,
      competitorUrl2,
      competitorUrl3,
      referenceUrl: req.body.referenceUrl,
      skipScrape: req.body.skipScrape,
    });

    if (!keyword) {
      console.warn('⚠️ keyword is missing in request body');
      return res.status(400).json({ error: 'キーワードを入力してください。' });
    }

    const outlineSections = collectOutlineSections(req.body);
    if (!outlineSections?.length) {
      return res.status(400).json({
        error:
          '見出しアウトライン（sections）が必要です。見出し生成タブで見出しを確定してから引き継いでください。',
      });
    }

    const candidateUrls = collectCandidateUrls(req.body);
    const referenceUrls = collectReferenceUrls(req.body);
    const useArticleContext =
      req.body.useArticleContext === true || req.body.useArticleContext === 'true';
    // 確定アウトラインがある場合は既定でURL再取得しない（joshin等のタイムアウトで全体が落ちるのを防ぐ）
    const skipScrape =
      !useArticleContext &&
      req.body.skipScrape !== false &&
      req.body.skipScrape !== 'false';

    const warnings = [];
    let scrapedArticles = [];
    let scrapedReferenceArticles = [];

    if (skipScrape) {
      console.log('⏭️ Skipping URL scrape for outline article generate');
    } else {
    if (candidateUrls.length > 0) {
      const competitorResult = await scrapeCompetitorArticles(candidateUrls, scrape);
      warnings.push(...competitorResult.warnings);
      scrapedArticles = competitorResult.scrapedArticles;
    }

    if (referenceUrls.length > 0) {
      const referenceResult = await scrapeCompetitorArticles(referenceUrls, scrape);
      warnings.push(...referenceResult.warnings);
      scrapedReferenceArticles = referenceResult.scrapedArticles;
    }

    if (scrapedArticles.length === 0 && scrapedReferenceArticles.length === 0) {
        console.warn('⚠️ Scraping failed or skipped; continue with keyword + headings only');
        warnings.push({
          message:
            '参考URL・他社URLの取得に失敗（または未入力）のため、確定見出しのみで本文を生成します。',
        });
      } else {
    console.log(
      '📚 Successfully scraped',
      scrapedArticles.length,
      'competitor sources and',
      scrapedReferenceArticles.length,
      'reference sources'
    );
      }
    }

    const competitorTexts = formatScrapedTexts(scrapedArticles, '他社記事', 2500);
    const referenceTexts = formatScrapedTexts(scrapedReferenceArticles, '参考記事', 2500);
    const referenceOutputSection = buildReferenceOutputSection(keyword, referenceTexts);

    let introductionData = {
      h1: title || '',
      introduction: '',
    };

    if (generateIntroduction) {
      const introductionPrompt = `
あなたはSEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」、タイトル「${title}」の導入文を200文字程度で作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h1": "${title}",
  "introduction": "導入文(200文字程度)",
}
${bodyPromptRules()}
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
  `;

      try {
        console.log('🧠 Generating introduction with Gemini');
        const introductionRaw = await generateGeminiTextWithRetry(
          getGeminiModel,
          introductionPrompt
        );
        introductionData = parseJsonFromModelOutput(introductionRaw) || introductionData;
        console.log(
          '🧾 Introduction generated. H2 count:',
          pickSectionsFromIntroduction(introductionData)?.length ?? 0
        );
      } catch (err) {
        console.error('❌ Introduction generation failed', err.message);
        warnings.push({
          message: `導入文の生成に失敗したため空欄にしました。（${String(err.message || '').slice(0, 120)}）`,
        });
      }
    } else {
      console.log('⏭️ Skipping introduction generation (unchecked)');
    }

    const BODY_GAP_MS = 2500;
    const { contentResults, outlineResultSections } = await generateOutlineArticleBodies({
      outlineSections,
      getGeminiModel,
      keyword,
      title,
      competitorTexts,
      referenceOutputSection,
        warnings,
      bodyGapMs: BODY_GAP_MS,
    });

    const bodiesForSummary = contentResults
      .map((r) => r.data?.content)
      .filter(Boolean)
      .join('\n');

    let summaryData = { summary: '' };

    if (generateSummary) {
      if (!bodiesForSummary.trim()) {
        warnings.push({
          message:
            'まとめ文は、本文がほぼ空のためスキップしました。先に本文が生成できた見出しから再実行してください。',
        });
      } else {
      const introSection = introductionData.introduction
        ? `# 導入文\n${introductionData.introduction}\n\n`
        : '';
      const summaryPrompt = `
あなたはSEOに強い家電専門ライターです。
キーワード「${keyword}」、タイトル「${title}」の記事について、${introSection ? '導入文と' : ''}各見出し本文を踏まえたまとめ文を150〜200文字で作成してください。

${introSection}# 見出し本文
${bodiesForSummary}

# 出力条件
- JSON形式で出力
- 形式: { "summary": "まとめ文(150〜200文字)" }
- 家電販売店にふさわしいフォーマルな文体
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
`;

      try {
        console.log('📝 Generating summary with Gemini');
          await sleep(BODY_GAP_MS);
          const summaryRaw = await generateGeminiTextWithRetry(getGeminiModel, summaryPrompt);
        summaryData = parseJsonFromModelOutput(summaryRaw) || summaryData;
      } catch (err) {
        console.error('❌ Summary generation failed', err.message);
          warnings.push({
            message: `まとめ文の生成に失敗したため空欄にしました。（${String(err.message || '').slice(0, 120)}）`,
        });
        }
      }
    } else {
      console.log('⏭️ Skipping summary generation (unchecked)');
    }

    console.log(
      '✅ Completed /api/article/generate in',
      `${Date.now() - requestStartedAt}ms`
    );

    res.json({
      generateIntroduction,
      generateSummary,
      mode: 'outline',
      aiProviderUsed,
      title: introductionData.h1 || title || '',
      introduction: introductionData.introduction || '',
      summary: summaryData?.summary || '',
      sections: outlineResultSections,
      article: {
        h1: introductionData.h1 || title || '',
        introduction: introductionData.introduction || '',
        summary: summaryData?.summary || '',
        sections: outlineResultSections,
      },
      warnings,
    });
}

async function handleHeadingGenerate(
  req,
  res,
  requestStartedAt,
  { scrape, getGeminiModel, aiProviderUsed = 'gemini' }
) {
  const { keyword } = req.body;
  const headingCandidates = collectHeadingCandidates(req.body);

  console.log('🛎️ POST /api/article/generate-headings called with:', {
    keyword,
    headingCandidates,
    competitorUrls: collectCandidateUrls(req.body),
    referenceUrls: collectReferenceUrls(req.body),
  });

  if (!keyword) {
    console.warn('⚠️ keyword is missing in request body');
    return res.status(400).json({ error: 'キーワードを入力してください。' });
  }

  const candidateUrls = collectCandidateUrls(req.body);
  const referenceUrls = collectReferenceUrls(req.body);

  if (candidateUrls.length === 0 && referenceUrls.length === 0) {
    console.warn('⚠️ No URLs provided');
    return res.status(400).json({
      error: '参考URL（推奨）または他社URLを少なくとも1つ入力してください。選び方見出しの作成には参考URLがあると精度が上がります。',
    });
  }

  const warnings = [];
  let scrapedArticles = [];
  let scrapedReferenceArticles = [];

  if (candidateUrls.length > 0) {
    const competitorResult = await scrapeCompetitorArticles(candidateUrls, scrape);
    warnings.push(...competitorResult.warnings);
    scrapedArticles = competitorResult.scrapedArticles;
  }

  if (referenceUrls.length > 0) {
    const referenceResult = await scrapeCompetitorArticles(referenceUrls, scrape);
    warnings.push(...referenceResult.warnings);
    scrapedReferenceArticles = referenceResult.scrapedArticles;
  }

  if (scrapedArticles.length === 0 && scrapedReferenceArticles.length === 0) {
    console.error('🚨 Scraping failed for all URLs');
    return res.status(502).json({
      error: '記事の取得に失敗しました。',
      warnings,
    });
  }

  if (scrapedReferenceArticles.length === 0) {
    warnings.push({
      message:
        '参考URLが未取得です。選び方見出しは参考記事の構成を優先するため、参考URLの入力を推奨します。',
    });
  }

  console.log(
    '📚 Successfully scraped',
    scrapedArticles.length,
    'competitor sources and',
    scrapedReferenceArticles.length,
    'reference sources'
  );

  const competitorTexts = formatScrapedTexts(scrapedArticles, '他社記事');
  const referenceTexts = formatScrapedTexts(scrapedReferenceArticles, '参考記事');
  const referenceOutputSection = buildReferenceOutputSection(keyword, referenceTexts);

  const headingsPrompt = buildSelectionGuideHeadingPrompt({
    keyword,
    headingCandidates,
    competitorTexts,
    referenceOutputSection,
  });

  let headingData;
  try {
    console.log('🧠 Generating headings with Gemini');
    const model = await getGeminiModel();
    const headingsResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: headingsPrompt }] }],
    });
    const headingsRaw = headingsResult.response?.text?.() || '';
    headingData = parseJsonFromModelOutput(headingsRaw);
    console.log('🧾 Headings generated:', headingData);
  } catch (err) {
    console.error('❌ Heading generation failed', err.message);
    return res.status(502).json({
      error: '見出しの生成に失敗しました。',
      warnings,
    });
  }

  console.log(
    '✅ Completed /api/article/generate-headings in',
    `${Date.now() - requestStartedAt}ms`
  );

  const sectionsRaw = normalizeSectionsArray(headingData.sections) || [];
  const outline = normalizeHeadingOutline(keyword, sectionsRaw);

  res.json({
    title: headingData.h1 || '',
    outline,
    sections: outline.map((sec) => ({
      h2: sec.h2,
      subsections: sec.subsections,
      items: sec.items,
    })),
    headingCandidatesUsed: headingCandidates,
    aiProviderUsed,
    warnings,
  });
}

async function handleSubHeadingGenerate(
  req,
  res,
  requestStartedAt,
  { scrape, getGeminiModel, aiProviderUsed = 'gemini' }
) {
  const keyword = String(req.body?.keyword || '').trim();
  const h3 = String(req.body?.h3 || '').trim();
  const h3ListRaw = Array.isArray(req.body?.h3List) ? req.body.h3List : null;
  const h3List = h3ListRaw
    ? h3ListRaw.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 12)
    : null;
  const isBulk = Boolean(h3List?.length);

  console.log('🛎️ POST /api/article/generate-sub-headings called with:', {
    keyword,
    h3: isBulk ? undefined : h3,
    h3Count: isBulk ? h3List.length : h3 ? 1 : 0,
    competitorUrls: collectCandidateUrls(req.body),
    referenceUrls: collectReferenceUrls(req.body),
  });

  if (!keyword) {
    return res.status(400).json({ error: 'キーワードを入力してください。' });
  }
  if (!isBulk && !h3) {
    return res.status(400).json({ error: 'H3見出しを入力してください。' });
  }

  // H4提案はキーワード＋H3だけで十分。毎回のURL再取得は遅く、2回目以降の502原因になるため既定でスキップ。
  // 明示的に useArticleContext=true のときだけ参考記事を取りに行く。
  const useArticleContext =
    req.body.useArticleContext === true || req.body.useArticleContext === 'true';
  const skipScrape =
    !useArticleContext ||
    req.body.skipScrape === true ||
    req.body.skipScrape === 'true';

  let ctx = {
    warnings: [],
    competitorTexts: '',
    referenceOutputSection: '',
    hasScraped: false,
  };
  if (!skipScrape) {
    ctx = await loadOptionalArticleContext(req.body, scrape, {
      maxCharsPerArticle: 2500,
    });
  } else {
    console.log('⏭️ Skipping URL scrape for H4 suggest (keyword + H3 only)');
  }
  const warnings = [...ctx.warnings];

  let data;
  try {
    console.log(
      isBulk
        ? `🧠 Generating bulk H4 sub-headings (${h3List.length}) with Gemini (scrape=${!skipScrape})`
        : `🧠 Generating H4 sub-headings with Gemini (scrape=${!skipScrape})`
    );
    const prompt = isBulk
      ? buildBulkH4SuggestPrompt({
          keyword,
          h3List,
          competitorTexts: ctx.competitorTexts,
          referenceOutputSection: ctx.referenceOutputSection,
        })
      : buildH4SuggestPrompt({
          keyword,
          h3,
          competitorTexts: ctx.competitorTexts,
          referenceOutputSection: ctx.referenceOutputSection,
        });
    const raw = await generateGeminiTextWithRetry(getGeminiModel, prompt);
    data = parseJsonFromModelOutput(raw);
    console.log('🧾 H4 sub-headings generated:', data);
  } catch (err) {
    console.error('❌ H4 heading generation failed', err.message);
    const retryAfter = parseRetryAfterSeconds(err);
    return res.status(502).json({
      error: retryAfter
        ? `H4見出しの生成に失敗しました（API制限）。約${retryAfter}秒後に再試行してください。`
        : `H4見出しの生成に失敗しました。${err?.message ? `（${String(err.message).slice(0, 160)}）` : ''}`,
      warnings,
    });
  }

  console.log(
    '✅ Completed /api/article/generate-sub-headings in',
    `${Date.now() - requestStartedAt}ms`
  );

  if (isBulk) {
    const byH3 = new Map();
    const itemsRaw = Array.isArray(data?.items) ? data.items : [];
    itemsRaw.forEach((item) => {
      const key = String(item?.h3 || '').trim();
      if (!key) return;
      byH3.set(key, normalizeH4Subheadings(item?.subheadings));
    });
    const items = h3List.map((targetH3, index) => {
      const matched =
        byH3.get(targetH3) ||
        normalizeH4Subheadings(itemsRaw[index]?.subheadings);
    return {
        h3: targetH3,
        subheadings: matched,
      };
    });
    return res.json({ items, warnings, aiProviderUsed });
  }

  const subheadings = normalizeH4Subheadings(data?.subheadings);

  res.json({
    h3: data?.h3 || h3,
    subheadings,
    aiProviderUsed,
    warnings,
  });
}

module.exports = registerArticleAppRoutes;
