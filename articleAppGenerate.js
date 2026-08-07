'use strict';

const cheerio = require('cheerio');
const {
  parseJsonFromModelOutput,
  normalizeSectionsArray,
} = require('./parseModelJson');
const { discoverRetailerArticleUrls } = require('./discoverRetailerArticleUrls');
const { extractHeadingsFromHtml } = require('./competitorArticleEngine');

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
    const itemsSrc = Array.isArray(src.items)
      ? src.items
      : Array.isArray(src.subsections) &&
          src.subsections.some((x) => x && typeof x === 'object' && (x.h3 || x.title || x.intent))
        ? src.subsections
        : null;
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
      const intent = String(
        (raw && typeof raw === 'object' ? raw.intent || raw.searchIntent : '') ||
          (typeof h3Raw === 'object' ? h3Raw?.intent || h3Raw?.searchIntent : '') ||
          ''
      ).trim();
      return { h3, h4s, intent };
    });
    return {
      h2: String(src.h2 || def.h2).trim() || def.h2,
      searchIntent: String(src.searchIntent || src.intent || defIntentForH2(def.h2, i)).trim(),
      subsections: items.map((it) => it.h3),
      items,
    };
  });
}

function defIntentForH2(h2, index) {
  if (index === 0 || /選び|ポイント|比較|基準/.test(String(h2 || ''))) return '選び方';
  if (/メーカー|ブランド/.test(String(h2 || ''))) return 'メーカー';
  return 'おすすめ';
}

function collectOutlineSections(body) {
  if (!Array.isArray(body?.sections)) return null;
  return body.sections
    .map((sec) => {
      const h2 = String(sec?.h2 || '').trim();
      const searchIntent = String(sec?.searchIntent || sec?.intent || '').trim();
      const itemsSrc = Array.isArray(sec?.items)
        ? sec.items
        : (Array.isArray(sec?.subsections) ? sec.subsections : []).map((h3) => ({
            h3: typeof h3 === 'string' ? h3 : h3?.h3 || '',
            h4s: [],
            intent: typeof h3 === 'object' ? h3?.intent || '' : '',
          }));
      const items = itemsSrc
        .map((item) => {
          const h3 = String(item?.h3 || item?.title || '').trim();
          const intent = String(item?.intent || item?.searchIntent || '').trim();
          const h4s = (Array.isArray(item?.h4s) ? item.h4s : [])
            .map((h) => String(h || '').trim())
            .filter(Boolean)
            .slice(0, MAX_OUTLINE_H4);
          return { h3, h4s, intent };
        })
        .filter((item) => item.h3);
      return { h2, searchIntent, items };
    })
    .filter((sec) => sec.h2 && sec.items.length);
}

function bodyPromptRules({ isMakerSection = false, includeComparisonTable = false } = {}) {
  const makerRules = isMakerSection
    ? `
- メーカー紹介では宣伝調の最上級（「国内トップシェア」「No.1」等）を避け、「定評がある」「家庭用〜業務寄りのラインが厚い」など根拠の弱い断定を弱める
- 本文末尾に必ず「向いている人: …」を1文入れる（例: 精度・自動認識を重視する方）
- 可能ならシリーズ名・ライン名の例を1つ入れる（個別型番・価格は書かない）
- 新興ブランドや家電量販の定番枠以外のブランドは、位置づけを一文補足する（例: デジタル機器ブランドのヘルスケア展開）
- メーカー固有の機能名は一般名＋例示にする（例: 自動認識機能（各社の乗るだけで判別する機能 等））`
    : '';
  const tableRules = includeComparisonTable
    ? `
- 本文内に「目的 × 推奨タイプ × 確認ポイント」の比較表を Markdown 表（| 列 |）でちょうど1つ入れる（製品名・価格は書かない）
- 表の前後は短い説明文にする`
    : '';
  return `- キーワードとの関連性が高く、検索ユーザーの意図を満たす構成にする
- 内容は具体的で、独自の視点・根拠・事例を交えて説明且つ信頼感があり、客観的
- 家電販売店にふさわしいフォーマルな文体
- 数値・条件・用途別の提案で決断しやすくする（「向いている／適している」だけで終わらせない）
- 比較は「AならX、BならY」の条件分岐で書く（例: 部位別なら両手両足、毎日の習慣なら足裏）
- 同一記事内で既出の論点が重複しない。重なる場合は「確認チェックリスト」に変え、同じ説明を繰り返さない
- スマホ連携・データ管理など近いテーマが複数見出しにある場合、後続はメリット再説ではなく確認項目（対応アプリ／登録人数／自動認識の有無など）に寄せる
- 製品名・価格は直接記載しない
- 出典のないシェア・No.1・最上級は書かない。書くなら「傾向として」「目安」に留める
- メーカー固有名称は一般名称を先に書き、例示として固有名を添える
- AEO/GEO向け: content の先頭段落は「答えになる1文」（40字前後・句点で終える）を「結論:」などのラベルなしで書き、空行のあとに本文を続ける
- 「結論:」「まとめ:」など見出しラベルを本文に書かない
- 曖昧語（おすすめ・高品質など単体）を避け、「向いている人」「選ぶ基準」など定義・列挙を明確にする${makerRules}${tableRules}
- 出力は厳密にJSONのみ`;
}

/** 「結論:」等の明示ラベルを除去 */
function stripConclusionLabel(text) {
  return String(text || '')
    .trim()
    .replace(/^結論\s*[:：]\s*/, '')
    .replace(/^まとめ\s*[:：]\s*/, '');
}

/**
 * 本文先頭に答えとなる1文を埋め込む（「結論:」ラベルは付けない）
 */
function ensureConclusionPrefix(content, conclusion) {
  let body = stripConclusionLabel(content);
  const conc = stripConclusionLabel(conclusion);
  if (!body && !conc) return '';
  if (!conc) return body;

  const firstPara = body.split(/\n\n+/)[0].trim();
  if (firstPara === conc || body.startsWith(conc)) {
    return body;
  }
  // AIが「結論: xxx\n\n本文」と返した場合、先頭段落だけ再ストリップ
  body = body
    .split(/\n\n+/)
    .map((p, i) => (i === 0 ? stripConclusionLabel(p) : p))
    .join('\n\n');
  const firstAgain = body.split(/\n\n+/)[0].trim();
  if (firstAgain === conc || body.startsWith(conc)) {
    return body;
  }
  return body ? `${conc}\n\n${body}` : conc;
}

/** 先頭段落が答え文として機能しているか（チェックリスト用） */
function hasLeadAnswerParagraph(content) {
  const t = stripConclusionLabel(content);
  if (!t) return false;
  if (/^結論[:：]/.test(String(content || '').trim())) return true;
  const first = t.split(/\n\n+/)[0].trim();
  return first.length >= 12 && first.length <= 100 && /[。．]$/.test(first);
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
  includeComparisonTable = false,
}) {
  const isMakerSection = /メーカー|ブランド/.test(String(heading_h2_first || ''));
  const prompt = `
あなたはSEO・AEO・GEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」、タイトル「${title}」、H2見出し「${heading_h2_first}」の子見出し「${h3Heading}」の本文を作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h3": "${h3Heading}",
  "conclusion": "この見出しの答えになる1文（40字前後・句点で終える。ラベルは書かない）",
  "content": "（conclusionと同じ文を先頭段落に）\\n\\n本文（合計200〜350文字程度。先頭に答えの1文を含む）"
}
${bodyPromptRules({ isMakerSection, includeComparisonTable })}
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
`;

  console.log(`🧠 Generating H3-${index} body with Gemini`);
  const raw = await generateGeminiTextWithRetry(getGeminiModel, prompt);
  const data = parseJsonFromModelOutput(raw) || {};
  const content = ensureConclusionPrefix(data.content, data.conclusion);
  console.log(`🧾 H3-${index} generated:`, { ...data, content });
  return {
    ...data,
    content,
    conclusion: stripConclusionLabel(data.conclusion),
  };
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
  priorH4Headings = [],
  includeComparisonTable = false,
}) {
  const list = h4Headings.map((h, i) => `${i + 1}. ${h}`).join('\n');
  const prior =
    priorH4Headings.length > 0
      ? `\n# 同一記事で既出のH4（重複説明禁止。近いテーマなら確認チェックリスト化）\n${priorH4Headings
          .map((h, i) => `${i + 1}. ${h}`)
          .join('\n')}\n`
      : '';
  const tableHint = includeComparisonTable
    ? `\n- 先頭のH4本文に「目的 × 推奨タイプ × 確認ポイント」の比較表を Markdown 表で1つ含める（製品名・価格は書かない）\n`
    : '';
  const prompt = `
あなたはSEO・AEO・GEOに強い家電専門ライターです。
キーワード「${keyword}」、タイトル「${title}」、H2「${heading_h2_first}」、H3「${heading_h3}」の配下にある次のH4見出しそれぞれについて、本文を作成してください。

# 対象H4
${list}
${prior}
# 出力条件
- JSON形式で出力
- 形式:
{
  "h4_items": [
    {
      "h4": "対象H4と同じ文言",
      "conclusion": "答えになる1文（40字前後。ラベルは書かない）",
      "content": "（conclusionと同じ文を先頭段落に）\\n\\n本文（各200〜300文字程度）"
    }
  ]
}
- h4_items は対象H4と同じ件数・同じ順序
- 対象H4同士でも論点が重複しないよう役割分担する${tableHint}
${bodyPromptRules({ includeComparisonTable: false })}
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
    byH4.set(key, {
      content: ensureConclusionPrefix(item?.content, item?.conclusion),
      conclusion: stripConclusionLabel(item?.conclusion),
    });
  });
  return h4Headings.map((h4, index) => {
    const hit = byH4.get(h4) || {
      content: ensureConclusionPrefix(itemsRaw[index]?.content, itemsRaw[index]?.conclusion),
      conclusion: stripConclusionLabel(itemsRaw[index]?.conclusion),
    };
    return { h4, content: hit.content, conclusion: hit.conclusion };
  });
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
# 追加キーワード（ユーザーが指定）
以下のキーワードを見出し生成で考慮すること。商品ランキングやおすすめ商品の見出しにはしない。
「選びのポイント」配下のH3などへ、購入判断の軸として自然に反映する（文言の直コピーは禁止）。
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
ただしこの工程では H2 と H3 のみ出力する（H4は記事コンテンツで任意追加）。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h1": "タイトル案（例: 【年】${keyword}のおすすめ…種類や選び方、人気メーカーを紹介）",
  "sections": [
    {
      "h2": "${pointsH2}",
      "searchIntent": "選び方",
      "subsections": [
        { "h3": "判断軸H3-1", "intent": "比較" },
        { "h3": "判断軸H3-2", "intent": "選び方" },
        { "h3": "判断軸H3-3", "intent": "用途" }
      ]
    },
    {
      "h2": "${makersH2}",
      "searchIntent": "メーカー",
      "subsections": [
        { "h3": "メーカー名1", "intent": "メーカー" },
        { "h3": "メーカー名2", "intent": "メーカー" },
        { "h3": "メーカー名3", "intent": "メーカー" }
      ]
    }
  ]
}
- sections は必ず2件（上記H2文言をほぼこのまま使う。語尾の微調整のみ可）
- 各H2に H3 をちょうど3つ（文字列のみでも可。その場合も searchIntent は付与）
- searchIntent / intent は次のいずれか: 比較 / 選び方 / おすすめ / メーカー / 用途 / FAQ
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

function buildRewriteSourceSection(keyword, sourceTexts) {
  if (!sourceTexts) return '';
  return `
# リライト指示
あなたは既存特集記事のリライト担当です。キーワード「${keyword}」。
- 下記「リライト元記事」の事実・数値・切り口を根拠にする（ソースにない断定的な新事実は足さない）
- 文言の直コピーは禁止。コジマネット特集向けの丁寧な文体で書き直す
- 出力する見出しは指定されたアウトラインに厳密に従う
- AEO向けに、各本文の先頭段落は答えになる1文（ラベルなし）とする

# リライト元記事
${sourceTexts}
`;
}

const REWRITE_NOISE_HEADING =
  /^(目次|関連記事|おすすめ特集|人気記事|カテゴリ|シェア|breadcrumb|パンくず|footer|header|ログイン|会員登録|カート)$/i;

/**
 * HTML から h1–h4 を抽出（リライト用。competitor 用の h1–h3 抽出を拡張）
 */
function extractRewriteHeadingsFromHtml(html) {
  const base = extractHeadingsFromHtml(html) || [];
  const $ = cheerio.load(String(html || ''));
  const rootSelectors = [
    '#fwCms_wrapper',
    '#mainblock006479',
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
    if ($found.length && $found.find('h2, h3, h4').length >= 1) {
      $root = $found;
      break;
    }
  }

  const headings = [];
  const seen = new Set();
  const push = (level, text) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length < 2 || t.length > 140) return;
    if (REWRITE_NOISE_HEADING.test(t)) return;
    const key = `${level}:${t.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    headings.push({ level, text: t });
  };

  $root.find('h1, h2, h3, h4').each((_, el) => {
    const level = String(el.tagName || '').toLowerCase();
    if (!['h1', 'h2', 'h3', 'h4'].includes(level)) return;
    push(level, $(el).text());
  });

  // cheerio で取れない場合は既存の h1–h3 結果を返す
  if (headings.length === 0 && base.length) return base;
  return headings.length ? headings : base;
}

/**
 * フラットな見出し列をアウトライン（H2→H3→H4）に変換
 */
function headingsToOutline(headings) {
  const list = Array.isArray(headings) ? headings : [];
  let title = '';
  const sections = [];
  let currentSec = null;
  let currentItem = null;

  const ensureSection = (h2) => {
    currentSec = {
      h2,
      searchIntent: '',
      items: [],
      subsections: [],
    };
    sections.push(currentSec);
    currentItem = null;
  };

  for (const h of list) {
    const level = String(h?.level || '').toLowerCase();
    const text = String(h?.text || '').trim();
    if (!text) continue;
    if (level === 'h1') {
      if (!title) title = text;
      continue;
    }
    if (level === 'h2') {
      ensureSection(text);
      continue;
    }
    if (level === 'h3') {
      if (!currentSec) ensureSection(title || '本文');
      currentItem = { h3: text, intent: '', h4s: [] };
      currentSec.items.push(currentItem);
      currentSec.subsections.push(text);
      continue;
    }
    if (level === 'h4') {
      if (!currentSec) ensureSection(title || '本文');
      if (!currentItem) {
        currentItem = { h3: text, intent: '', h4s: [] };
        currentSec.items.push(currentItem);
        currentSec.subsections.push(text);
      } else if (currentItem.h4s.length < MAX_OUTLINE_H4) {
        currentItem.h4s.push(text);
      }
    }
  }

  // H2のみでH3が無いセクションは、本文生成用に H3 を1つ補う
  for (const sec of sections) {
    if (!sec.items.length) {
      sec.items.push({ h3: sec.h2, intent: '', h4s: [] });
      sec.subsections.push(sec.h2);
    }
    sec.items = sec.items.map((it) => ({
      ...it,
      h4s: [...(it.h4s || []), '', '', ''].slice(0, MAX_OUTLINE_H4),
    }));
  }

  return {
    title,
    outline: sections.filter((s) => s.h2 && s.items.length),
  };
}

async function improveRewriteOutlineFromArticle(
  getGeminiModel,
  { keyword, title, text, seedOutline }
) {
  const clipped = String(text || '').slice(0, 12000);
  const seedJson =
    Array.isArray(seedOutline) && seedOutline.length
      ? JSON.stringify(
          {
            h1: title || '',
            sections: seedOutline.map((sec) => ({
              h2: sec.h2,
              searchIntent: sec.searchIntent || '',
              items: (sec.items || []).map((it) => ({
                h3: it.h3,
                intent: it.intent || '',
                h4s: (it.h4s || []).filter(Boolean),
              })),
            })),
          },
          null,
          2
        )
      : '（なし）';

  const prompt = `
あなたはコジマネットなど家電量販店の特集記事の編集者です。
リライト用に、元記事の見出しアウトラインを改善してください。

# 方針
- 元記事の切り口・情報の流れは保つ（まったく別テーマにしない）
- 新規作成用の固定テンプレ（「選びのポイント」「人気メーカー」の2本強制）には載せない
- **より良い見出しがあれば積極的に書き換える**
  - 検索意図が伝わる／具体的／冗長・曖昧・宣伝ノイズを減らす
  - SEO/AEO向けに「何が分かるか」が明確な見出しにする
  - 重複・薄い見出しは統合または削除してよい
- 元見出しのままで十分なものは無理に変えない
- タイトル(h1)も、よりクリックされやすく正確なら改善してよい
- H2は2〜8、各H2配下のH3は1〜6、各H3配下のH4は0〜3
- JSONのみ出力

# 形式
{
  "h1": "タイトル",
  "keyword": "${keyword || ''}",
  "sections": [
    {
      "h2": "H2",
      "searchIntent": "選び方",
      "items": [
        { "h3": "H3", "intent": "", "h4s": ["H4"] }
      ]
    }
  ]
}

# ヒント
キーワード候補: ${keyword || '（本文から推定）'}
タイトル候補: ${title || '（本文から推定）'}

# 元見出し（抽出済み・改善の種）
${seedJson}

# 記事本文
${clipped}
`;
  const raw = await generateGeminiTextWithRetry(getGeminiModel, prompt);
  const data = parseJsonFromModelOutput(raw) || {};
  const outline = collectOutlineSections({ sections: data.sections }) || [];
  const padded = outline.map((sec) => ({
    ...sec,
    subsections: (sec.items || []).map((it) => it.h3),
    items: (sec.items || []).map((it) => ({
      h3: it.h3,
      intent: it.intent || '',
      h4s: [...(it.h4s || []), '', '', ''].slice(0, MAX_OUTLINE_H4),
    })),
  }));
  return {
    title: String(data.h1 || data.title || title || '').trim(),
    keyword: String(data.keyword || keyword || '').trim(),
    outline: padded,
  };
}

async function extractRewriteOutlineFromUrl({
  url,
  keyword,
  scrape,
  getGeminiModel,
  fetchHtmlWithHttpClient,
}) {
  const warnings = [];
  const sourceUrl = String(url || '').trim();
  if (!sourceUrl) {
    throw Object.assign(new Error('リライト元URLを入力してください。'), { status: 400 });
  }

  let html = '';
  let pageText = '';
  let headings = [];

  if (typeof fetchHtmlWithHttpClient === 'function') {
    try {
      html = await fetchHtmlWithHttpClient(sourceUrl);
      headings = extractRewriteHeadingsFromHtml(html);
    } catch (err) {
      warnings.push({
        url: sourceUrl,
        message: `HTML取得失敗: ${String(err.message || '').slice(0, 120)}`,
      });
    }
  }

  try {
    pageText = await scrape(sourceUrl);
  } catch (err) {
    warnings.push({
      url: sourceUrl,
      message: `テキスト取得失敗: ${String(err.message || '').slice(0, 120)}`,
    });
  }

  let title = '';
  let outline = [];
  const fromHtml = headingsToOutline(headings);
  title = fromHtml.title;
  outline = fromHtml.outline;

  if (!title && html) {
    const $ = cheerio.load(html);
    title =
      $('h1.top_title').first().text().replace(/\s+/g, ' ').trim() ||
      $('h1').first().text().replace(/\s+/g, ' ').trim() ||
      $('title').first().text().replace(/\s+/g, ' ').trim();
  }

  let method = outline.length ? 'html' : 'none';
  const sourceForAi = pageText || (outline.length ? JSON.stringify(outline) : '');

  // 見出し改善: 本文（または抽出見出し）があるときは常にAIで良い見出しへ更新
  if (sourceForAi && typeof getGeminiModel === 'function') {
    try {
      const improved = await improveRewriteOutlineFromArticle(getGeminiModel, {
        keyword: String(keyword || '').trim(),
        title,
        text: pageText || `タイトル: ${title}\n\n抽出見出し:\n${JSON.stringify(outline, null, 2)}`,
        seedOutline: outline,
      });
      if (improved.outline?.length) {
        outline = improved.outline;
        if (improved.title) title = improved.title;
        method = pageText ? 'ai-improved' : 'ai-improved-from-html';
        warnings.push({
          message:
            '見出しは読みやすさ・検索意図に合わせて改善案に更新しています。必要な箇所だけ戻・修正してください。',
        });
        return {
          sourceUrl,
          title,
          keyword: String(keyword || improved.keyword || '').trim(),
          outline,
          headings,
          warnings,
          method,
        };
      }
    } catch (err) {
      warnings.push({
        message: `見出し改善に失敗したため、抽出した元見出しを使います。（${String(err.message || '').slice(0, 120)}）`,
      });
    }
  }

  if (!outline.length) {
    const err = new Error(
      'リライト元URLから見出し構成を取得できませんでした。URLやページ内容を確認してください。'
    );
    err.status = 502;
    err.warnings = warnings;
    throw err;
  }

  return {
    sourceUrl,
    title,
    keyword: String(keyword || '').trim(),
    outline,
    headings,
    warnings,
    method,
  };
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
- 同一H3内でテーマが重複するH4は作らない（例: 「スマホ連携」と「データ管理」を別H4にしない。片方にまとめ、もう片方は別観点にするか省略）

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
- 記事全体でテーマ重複を避ける（例: あるH3で「スマホ連携」を扱ったら、他H3で同趣旨のH4を重ねない。後続は「確認チェックリスト」向けの別観点にするか省略）

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
  const priorH4Headings = [];
  let comparisonTableAssigned = false;

  for (const sec of outlineSections) {
    const outItems = [];
    const isPointsSection = /選び|ポイント|比較/.test(String(sec.h2 || ''));
    for (const item of sec.items) {
      if (item.h4s?.length) {
        try {
          if (contentResults.length > 0 || outItems.length > 0) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(bodyGapMs);
          }
          const includeComparisonTableInH4 =
            isPointsSection && !comparisonTableAssigned && outItems.length === 0;
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
            priorH4Headings: [...priorH4Headings],
            includeComparisonTable: includeComparisonTableInH4,
          });
          if (includeComparisonTableInH4) comparisonTableAssigned = true;
          priorH4Headings.push(...item.h4s);
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
          const includeComparisonTable = isPointsSection && !comparisonTableAssigned;
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
            includeComparisonTable,
          });
          if (includeComparisonTable) comparisonTableAssigned = true;
          outItems.push({
            h3: item.h3,
            content: data?.content || '',
            conclusion: data?.conclusion || '',
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
            conclusion: '',
            h4_items: [],
          });
        }
      }
    }
    // 選び方H2でH4のみの場合、最初のH3に短い比較表用の補足本文を付けられないため
    // H4グループの先頭H4生成時に表を入れる余地はない。AEOパック側の comparisonTable で補完する。
    outlineResultSections.push({
      h2: sec.h2,
      searchIntent: sec.searchIntent || '',
      items: outItems,
    });
  }

  return { contentResults, outlineResultSections };
}

function registerArticleAppRoutes(
  app,
  { scrape, getGeminiModel, bindGetAiModel, fetchHtmlWithHttpClient }
) {
  function resolveGetAiModel(req) {
    if (typeof bindGetAiModel === 'function') {
      return bindGetAiModel(req);
    }
    const fallback = getGeminiModel || (async () => {
      throw new Error('AI model factory is not configured');
    });
    return Object.assign(fallback, { provider: 'gemini' });
  }

  app.post('/api/article/discover-competitor-urls', async (req, res) => {
    try {
      const keyword = String(req.body?.keyword || req.body?.category || '').trim();
      if (!keyword) {
        return res.status(400).json({ error: 'キーワードを入力してください。' });
      }
      const getAiModel = resolveGetAiModel(req);
      const result = await discoverRetailerArticleUrls(keyword, {
        fetchHtml: fetchHtmlWithHttpClient,
        getGeminiModel: getAiModel,
        limit: 3,
      });
      return res.json(result);
    } catch (err) {
      console.error('💥 /api/article/discover-competitor-urls error:', err);
      return res.status(502).json({
        error: err?.message || '他社記事URLの自動取得に失敗しました。',
      });
    }
  });

  app.post('/api/article/extract-outline-from-url', async (req, res) => {
    try {
      const getAiModel = resolveGetAiModel(req);
      const url = String(req.body?.url || req.body?.rewriteSourceUrl || '').trim();
      const keyword = String(req.body?.keyword || '').trim();
      const result = await extractRewriteOutlineFromUrl({
        url,
        keyword,
        scrape,
        getGeminiModel: getAiModel,
        fetchHtmlWithHttpClient,
      });
      return res.json(result);
    } catch (err) {
      console.error('💥 /api/article/extract-outline-from-url error:', err);
      const status = err?.status || 502;
      return res.status(status).json({
        error: err?.message || '構成の取り込みに失敗しました。',
        warnings: err?.warnings || [],
      });
    }
  });

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
        fetchHtmlWithHttpClient,
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
        fetchHtmlWithHttpClient,
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

function normalizeFaqList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      question: String(item?.question || item?.q || '').trim(),
      answer: String(item?.answer || item?.a || '').trim(),
    }))
    .filter((item) => item.question && item.answer)
    .slice(0, 5);
}

function buildAeoChecklist({
  directAnswer,
  sections,
  faq,
  seoTitle,
  metaDescription,
  sourcesNote,
  comparisonTable,
  hasToc,
}) {
  const flatContents = [];
  for (const sec of sections || []) {
    for (const item of sec.items || []) {
      if (item.content) flatContents.push(item.content);
      for (const h4 of item.h4_items || []) {
        if (h4.content) flatContents.push(h4.content);
      }
    }
  }
  const withConclusion = flatContents.filter((c) => hasLeadAnswerParagraph(c));
  const tableOk = Boolean(
    comparisonTable?.headers?.length >= 2 && comparisonTable?.rows?.length >= 2
  );
  return [
    {
      id: 'directAnswer',
      pillar: 'AEO',
      label: '直接回答（冒頭）あり',
      purpose: 'AI Overview / スニペットが抜き出しやすい一文回答',
      ok: Boolean(String(directAnswer || '').trim()),
    },
    {
      id: 'h3Conclusion',
      pillar: 'AEO',
      label: '見出し本文の冒頭に答えの1文あり',
      purpose: '段落単位で答えを抜き出せるようにする（「結論:」ラベルは不要）',
      ok: flatContents.length > 0 && withConclusion.length >= Math.ceil(flatContents.length * 0.5),
    },
    {
      id: 'faq',
      pillar: 'AEO',
      label: 'FAQ が3件以上',
      purpose: '質問単位の回答エンジン向け',
      ok: (faq || []).length >= 3,
    },
    {
      id: 'toc',
      pillar: 'SEO',
      label: '目次リンクあり',
      purpose: '回遊・滞在。コジマ特集と同様に H2 へジャンプ',
      ok: Boolean(hasToc),
    },
    {
      id: 'comparisonTable',
      pillar: 'SEO',
      label: '目的別の比較表あり',
      purpose: '抽象表現を減らし、決断しやすい条件提示',
      ok: tableOk,
    },
    {
      id: 'seoTitle',
      pillar: 'SEO',
      label: 'SEOタイトル候補あり',
      purpose: '検索結果のタイトル表示・クリック率',
      ok: Boolean(String(seoTitle || '').trim()),
    },
    {
      id: 'metaDescription',
      pillar: 'SEO',
      label: 'メタディスクリプション候補あり',
      purpose: '検索結果の説明文・要約提示',
      ok: Boolean(String(metaDescription || '').trim()),
    },
    {
      id: 'sourcesNote',
      pillar: 'GEO',
      label: '出典・更新メモあり',
      purpose: '生成AIが根拠付きで扱いやすい注記',
      ok: Boolean(String(sourcesNote || '').trim()),
    },
  ];
}

function normalizeComparisonTable(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const headers = (Array.isArray(raw.headers) ? raw.headers : [])
    .map((h) => String(h || '').trim())
    .filter(Boolean)
    .slice(0, 5);
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .map((row) =>
      (Array.isArray(row) ? row : []).map((cell) => String(cell || '').trim()).slice(0, headers.length || 5)
    )
    .filter((row) => row.some(Boolean))
    .slice(0, 8);
  if (headers.length < 2 || rows.length < 2) return null;
  return {
    caption: String(raw.caption || '目的別の選び方早見').trim() || '目的別の選び方早見',
    headers,
    rows: rows.map((row) => {
      while (row.length < headers.length) row.push('—');
      return row.slice(0, headers.length);
    }),
  };
}

async function generateAeoSeoPack({
  getGeminiModel,
  keyword,
  title,
  introduction,
  summary,
  outlineResultSections,
  bodiesForSummary,
  competitorUrls,
  referenceUrls,
  generateFaq,
}) {
  const outlinePreview = (outlineResultSections || [])
    .map((sec) => {
      const items = (sec.items || []).map((it) => `  - H3: ${it.h3}`).join('\n');
      return `H2: ${sec.h2}\n${items}`;
    })
    .join('\n');

  const prompt = `
あなたはSEO・AEO・GEOに強い家電専門エディターです。
キーワード「${keyword}」、タイトル「${title || keyword}」の特集記事向けに、検索・AI回答で抜き出されやすい補助ブロックを作成してください。

# 導入文
${introduction || '（なし）'}

# まとめ
${summary || '（なし）'}

# 見出し構成
${outlinePreview}

# 本文抜粋
${String(bodiesForSummary || '').slice(0, 6000)}

# 出力（厳密にJSONのみ）
{
  "seoTitle": "検索結果用タイトル（28〜32字目安。キーワードを自然に含む）",
  "metaDescription": "メタディスクリプション（80〜120字。答えの要点と対象読者を含める）",
  "directAnswer": "検索クエリへの直接回答（40〜80字。1文で完結。「結論:」ラベルは付けない）",
  "faq": [
    { "question": "よくある質問", "answer": "簡潔な回答（60〜120字）" }
  ],
  "comparisonTable": {
    "caption": "目的別の選び方早見",
    "headers": ["目的", "推奨タイプ", "確認ポイント"],
    "rows": [
      ["例: 毎日の体重管理", "例: 足裏測定の体組成計", "例: 表示の見やすさ"],
      ["例: 部位別の体組成", "例: 両手両足測定", "例: 部位別表示の有無"]
    ]
  },
  "sourcesNote": "参考・更新に関する注記（ランキング時点・比較の留意。架空の日付は書かない。シェア断定はしない）"
}

# 制約
- faq は${generateFaq ? '3〜5件必須' : '空配列 [] でよい'}
- comparisonTable は必須（目的×推奨タイプ×確認ポイント）。製品名・価格・出典なきシェアは書かない
- relatedLinks / 関連記事候補は出力しない（空でもキー自体不要）
- 誇大・最上級表現は避ける
- 家電販売店向けの丁寧な文体
${competitorUrls?.length ? `\n# 他社URL（参考）\n${competitorUrls.join('\n')}` : ''}
${referenceUrls?.length ? `\n# 参考URL\n${referenceUrls.join('\n')}` : ''}
`;

  const raw = await generateGeminiTextWithRetry(getGeminiModel, prompt);
  const data = parseJsonFromModelOutput(raw) || {};
  const faq = generateFaq ? normalizeFaqList(data.faq) : [];

  return {
    seoTitle: String(data.seoTitle || data.title || '').trim(),
    metaDescription: String(data.metaDescription || '').trim(),
    directAnswer: stripConclusionLabel(data.directAnswer),
    faq,
    relatedLinks: [],
    comparisonTable: normalizeComparisonTable(data.comparisonTable),
    sourcesNote: String(data.sourcesNote || '').trim(),
  };
}

async function handleArticleGenerate(
  req,
  res,
  requestStartedAt,
  { scrape, getGeminiModel, aiProviderUsed = 'gemini' }
) {
    const { keyword, title = '', urls = [], competitorUrl1, competitorUrl2, competitorUrl3 } =
      req.body;

    const modeRaw = String(req.body.mode || 'outline').toLowerCase();
    const isRewrite = modeRaw === 'rewrite';
    const rewriteSourceUrl = String(
      req.body.rewriteSourceUrl || req.body.referenceUrl || ''
    ).trim();

    const generateIntroduction =
      req.body.generateIntroduction === true || req.body.generateIntroduction === 'true';
    const generateSummary =
      req.body.generateSummary === true || req.body.generateSummary === 'true';
    const generateFaq =
      req.body.generateFaq !== false && req.body.generateFaq !== 'false';
    const generateAeoPack =
      req.body.generateAeoPack !== false && req.body.generateAeoPack !== 'false';

    console.log('🛎️ POST /api/article/generate called with:', {
      mode: isRewrite ? 'rewrite' : 'outline',
      keyword,
      title,
      rewriteSourceUrl: isRewrite ? rewriteSourceUrl : undefined,
      generateIntroduction,
      generateSummary,
      generateFaq,
      generateAeoPack,
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

    if (isRewrite && !rewriteSourceUrl) {
      return res.status(400).json({ error: 'リライト元URLを入力してください。' });
    }

    const outlineSections = collectOutlineSections(req.body);
    if (!outlineSections?.length) {
      return res.status(400).json({
        error: isRewrite
          ? '見出しアウトライン（sections）が必要です。リライト元URLから構成を取り込んでください。'
          : '見出しアウトライン（sections）が必要です。記事コンテンツ（新規）で見出しを確定してから引き継いでください。',
      });
    }

    const candidateUrls = isRewrite ? collectCandidateUrls(req.body) : collectCandidateUrls(req.body);
    const referenceUrls = isRewrite
      ? [rewriteSourceUrl, ...collectReferenceUrls(req.body).filter((u) => u !== rewriteSourceUrl)]
      : collectReferenceUrls(req.body);
    const useArticleContext =
      req.body.useArticleContext === true || req.body.useArticleContext === 'true';
    // リライトはソース必須のためスクレイプする。新規は確定アウトライン時は既定スキップ
    const skipScrape = isRewrite
      ? false
      : !useArticleContext &&
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

    if (isRewrite) {
      const hasSource = scrapedReferenceArticles.some((a) => a.url === rewriteSourceUrl);
      if (!hasSource && scrapedReferenceArticles.length === 0) {
        return res.status(502).json({
          error: 'リライト元URLの本文を取得できませんでした。URLを確認して再試行してください。',
          warnings,
        });
      }
      if (!hasSource && scrapedReferenceArticles.length > 0) {
        warnings.push({
          message:
            '指定のリライト元URLと一致する取得結果がありませんが、取得できた参考本文で続行します。',
        });
      }
    } else if (scrapedArticles.length === 0 && scrapedReferenceArticles.length === 0) {
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
    const referenceTexts = formatScrapedTexts(
      scrapedReferenceArticles,
      isRewrite ? 'リライト元記事' : '参考記事',
      isRewrite ? 8000 : 2500
    );
    const referenceOutputSection = isRewrite
      ? buildRewriteSourceSection(keyword, referenceTexts)
      : buildReferenceOutputSection(keyword, referenceTexts);

    let introductionData = {
      h1: title || '',
      introduction: '',
    };

    if (generateIntroduction) {
      const introductionPrompt = isRewrite
        ? `
あなたはSEO・AEOに強い家電専門ライターです。
キーワード「${keyword}」、タイトル「${title}」のリライト記事について、導入文を作成してください。
リライト元の導入意図を踏まえつつ文言は書き直してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h1": "${title}",
  "introduction": "導入文"
}
- 構成（必須）:
  1) 先頭1文: 検索意図への答え（40〜60字・句点で終える。「結論:」ラベルなし）
  2) 続けて2〜3文: この記事で分かること（選び方の観点／測定方式やタイプの違い／人気メーカーの見方 など）を案内し、目次へ読み進める導線にする
- 全体で180〜280文字程度
- 製品名・価格・出典なきシェアは書かない
${bodyPromptRules()}
${referenceOutputSection}
`
        : `
あなたはSEO・AEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」、タイトル「${title}」の導入文を作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h1": "${title}",
  "introduction": "導入文"
}
- 構成（必須）:
  1) 先頭1文: 検索意図への答え（40〜60字・句点で終える。「結論:」ラベルなし）
  2) 続けて2〜3文: この記事で分かること（選び方の観点／測定方式やタイプの違い／人気メーカーの見方 など）を案内し、目次へ読み進める導線にする
- 全体で180〜280文字程度
- 製品名・価格・出典なきシェアは書かない
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
      competitorTexts: isRewrite ? '' : competitorTexts,
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
キーワード「${keyword}」、タイトル「${title}」の記事について、${introSection ? '導入文と' : ''}各見出し本文を踏まえたまとめ文を作成してください。

${introSection}# 見出し本文
${bodiesForSummary}

# 出力条件
- JSON形式で出力
- 形式: { "summary": "まとめ文" }
- 導入文の言い換えにしない
- 読者の次アクションで締める（例: 目的を決める → タイプを選ぶ → 家族利用なら自動認識 → 記録重視ならアプリ対応を確認）
- 150〜220文字
- 家電販売店にふさわしいフォーマルな文体
- 製品名・価格・出典なきシェアは書かない
- 出力は厳密にJSONのみ
${isRewrite ? referenceOutputSection : `${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}`}
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

    let aeoPack = {
      seoTitle: '',
      metaDescription: '',
      directAnswer: '',
      faq: [],
      relatedLinks: [],
      comparisonTable: null,
      sourcesNote: '',
    };

    if (generateAeoPack) {
      try {
        await sleep(BODY_GAP_MS);
        console.log('🧭 Generating AEO/GEO/SEO pack');
        aeoPack = await generateAeoSeoPack({
          getGeminiModel,
          keyword,
          title: introductionData.h1 || title || '',
          introduction: introductionData.introduction || '',
          summary: summaryData?.summary || '',
          outlineResultSections,
          bodiesForSummary,
          competitorUrls: candidateUrls,
          referenceUrls,
          generateFaq,
        });
        if (isRewrite && !aeoPack.sourcesNote) {
          aeoPack.sourcesNote = `リライト元: ${rewriteSourceUrl}`;
        }
      } catch (err) {
        console.error('❌ AEO/SEO pack generation failed', err.message);
        warnings.push({
          message: `直接回答・FAQ・メタ候補の生成に失敗したため空欄にしました。（${String(err.message || '').slice(0, 120)}）`,
        });
      }
    } else {
      console.log('⏭️ Skipping AEO/SEO pack (unchecked)');
    }

    const aeoChecklist = buildAeoChecklist({
      directAnswer: aeoPack.directAnswer,
      sections: outlineResultSections,
      faq: aeoPack.faq,
      seoTitle: aeoPack.seoTitle,
      metaDescription: aeoPack.metaDescription,
      sourcesNote: aeoPack.sourcesNote,
      comparisonTable: aeoPack.comparisonTable,
      hasToc: (outlineResultSections || []).some((s) => String(s.h2 || '').trim()),
    });

    console.log(
      '✅ Completed /api/article/generate in',
      `${Date.now() - requestStartedAt}ms`
    );

    res.json({
      generateIntroduction,
      generateSummary,
      generateFaq,
      generateAeoPack,
      mode: isRewrite ? 'rewrite' : 'outline',
      rewriteSourceUrl: isRewrite ? rewriteSourceUrl : undefined,
      aiProviderUsed,
      title: introductionData.h1 || title || '',
      seoTitle: aeoPack.seoTitle,
      metaDescription: aeoPack.metaDescription,
      directAnswer: aeoPack.directAnswer,
      faq: aeoPack.faq,
      relatedLinks: [],
      comparisonTable: aeoPack.comparisonTable,
      sourcesNote: aeoPack.sourcesNote,
      aeoChecklist,
      introduction: introductionData.introduction || '',
      summary: summaryData?.summary || '',
      sections: outlineResultSections,
      article: {
        h1: introductionData.h1 || title || '',
        seoTitle: aeoPack.seoTitle,
        metaDescription: aeoPack.metaDescription,
        directAnswer: aeoPack.directAnswer,
        faq: aeoPack.faq,
        relatedLinks: [],
        comparisonTable: aeoPack.comparisonTable,
        sourcesNote: aeoPack.sourcesNote,
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
  { scrape, getGeminiModel, aiProviderUsed = 'gemini', fetchHtmlWithHttpClient }
) {
  const { keyword } = req.body;
  const headingCandidates = collectHeadingCandidates(req.body);
  const autoDiscover =
    req.body?.autoDiscoverCompetitors !== false &&
    req.body?.autoDiscoverCompetitors !== 'false';

  console.log('🛎️ POST /api/article/generate-headings called with:', {
    keyword,
    headingCandidates,
    competitorUrls: collectCandidateUrls(req.body),
    referenceUrls: collectReferenceUrls(req.body),
    autoDiscover,
  });

  if (!keyword) {
    console.warn('⚠️ keyword is missing in request body');
    return res.status(400).json({ error: 'キーワードを入力してください。' });
  }

  let candidateUrls = collectCandidateUrls(req.body);
  const referenceUrls = collectReferenceUrls(req.body);
  const warnings = [];
  let discoveredCompetitorUrls = [];

  if (autoDiscover && candidateUrls.length < 3) {
    try {
      console.log('🔎 Auto-discovering retailer article URLs for:', keyword);
      const discovered = await discoverRetailerArticleUrls(keyword, {
        fetchHtml: fetchHtmlWithHttpClient,
        getGeminiModel,
        limit: 3,
      });
      const existing = new Set(candidateUrls);
      for (const a of discovered.articles || []) {
        if (existing.has(a.url)) continue;
        candidateUrls.push(a.url);
        existing.add(a.url);
        discoveredCompetitorUrls.push(a);
        if (candidateUrls.length >= 3) break;
      }
      for (const note of discovered.notes || []) {
        warnings.push({ message: note });
      }
      if (discoveredCompetitorUrls.length) {
        warnings.push({
          message: `SEO上位の家電量販店記事を自動取得しました: ${discoveredCompetitorUrls
            .map((a) => `${a.site}`)
            .join(' / ')}`,
        });
      }
    } catch (err) {
      console.warn('⚠️ Auto-discover competitor URLs failed:', err.message);
      warnings.push({
        message: `他社URLの自動取得に失敗しました: ${err.message}`,
      });
    }
  }

  if (candidateUrls.length === 0 && referenceUrls.length === 0) {
    console.warn('⚠️ No URLs provided');
    return res.status(400).json({
      error:
        '参考URL（推奨）または他社URLを少なくとも1つ入力してください。空欄のまま生成するとSEO上位の家電量販店記事を自動取得します。自動取得も失敗した場合はURLを手入力してください。',
      warnings,
    });
  }

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
      discoveredCompetitorUrls,
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
      discoveredCompetitorUrls,
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
      searchIntent: sec.searchIntent || '',
      subsections: sec.subsections,
      items: sec.items,
    })),
    headingCandidatesUsed: headingCandidates,
    competitorUrlsUsed: candidateUrls,
    discoveredCompetitorUrls,
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
