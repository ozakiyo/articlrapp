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

const MAX_ARTICLE_H3 = 5;
const H3_SUFFIXES = ['first', 'second', 'third', 'fourth', 'fifth'];

function collectArticleH3Headings(body) {
  if (Array.isArray(body.heading_h3_list)) {
    const padded = [...body.heading_h3_list];
    while (padded.length < MAX_ARTICLE_H3) padded.push('');
    return padded
      .slice(0, MAX_ARTICLE_H3)
      .map((h) => String(h ?? '').trim());
  }
  return H3_SUFFIXES.map((suffix) =>
    String(body[`heading_h3_${suffix}`] ?? '').trim()
  );
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
- キーワードとの関連性が高く、検索ユーザーの意図を満たす構成にする
- 内容は具体的で、独自の視点・根拠・事例を交えて説明且つ信頼感があり、客観的
- 家電販売店にふさわしいフォーマルな文体
- 数値・比較・用途別の提案など、検索ユーザーの満足度を意識
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
`;

  console.log(`🧠 Generating H3-${index} body with Gemini`);
  const model = await getGeminiModel();
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  const raw = result.response?.text?.() || '';
  const data = parseJsonFromModelOutput(raw);
  console.log(`🧾 H3-${index} generated:`, data);
  return data;
}

function buildArticleH3FlatFields(h3BySlot) {
  const flat = { h3_items: [] };
  h3BySlot.forEach((entry, i) => {
    if (!entry) return;
    const suffix = H3_SUFFIXES[i];
    if (!suffix) return;
    const h3 = entry.data?.h3 || entry.heading;
    const content = entry.data?.content || '';
    flat[`h3_${suffix}`] = h3;
    flat[`h3_${suffix}_content`] = content;
    flat.h3_items.push({ h3, content });
  });
  return flat;
}

const MAX_ARTICLE_H4 = 5;

function collectArticleH4Headings(body) {
  if (Array.isArray(body.heading_h4_list)) {
    const padded = [...body.heading_h4_list];
    while (padded.length < MAX_ARTICLE_H4) padded.push('');
    return padded
      .slice(0, MAX_ARTICLE_H4)
      .map((h) => String(h ?? '').trim());
  }
  return H3_SUFFIXES.map((suffix) =>
    String(body[`heading_h4_${suffix}`] ?? '').trim()
  );
}

async function generateH4BodyContent({
  getGeminiModel,
  keyword,
  title,
  heading_h2_first,
  heading_h3,
  h4Heading,
  competitorTexts,
  referenceOutputSection,
  index,
}) {
  const prompt = `
あなたはSEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」、タイトル「${title}」、H2見出し「${heading_h2_first}」、H3見出し「${heading_h3}」の子見出し「${h4Heading}」（H4）の本文を200文字程度で作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h4": "${h4Heading}",
  "content": "本文(200文字程度)"
}
- キーワードとの関連性が高く、検索ユーザーの意図を満たす構成にする
- 内容は具体的で、独自の視点・根拠・事例を交えて説明且つ信頼感があり、客観的
- 家電販売店にふさわしいフォーマルな文体
- 数値・比較・用途別の提案など、検索ユーザーの満足度を意識
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
`;

  console.log(`🧠 Generating H4-${index} body with Gemini`);
  const model = await getGeminiModel();
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  const raw = result.response?.text?.() || '';
  const data = parseJsonFromModelOutput(raw);
  console.log(`🧾 H4-${index} generated:`, data);
  return data;
}

/**
 * 記事生成 UI（client/src/App_BK20260113.jsx）向け API。
 * 旧 app_BK20260113.js の POST /api/generate と同等の処理を /api/article/generate に提供する。
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
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const v = String(body?.[`headingCandidate${i}`] || '').trim();
    if (v) out.push(v);
  }
  return out;
}

function buildHeadingCandidatesPromptSection(candidates) {
  if (!candidates?.length) return '';
  const lines = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `
# 見出し候補（ランキング分析で抽出した読者ニーズ・機能切り口）
以下を H2 のテーマとして優先的に反映してください（3件ある場合は各 H2 に1つずつ割り当て）。
${lines}
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

function formatScrapedTexts(scrapedArticles, label) {
  return scrapedArticles
    .map(
      ({ url, text }) => `【${label}】${url}
${text}`
    )
    .join('\n---\n');
}

function buildReferenceOutputSection(keyword, referenceTexts) {
  if (!referenceTexts) return '';

  return `
# 出力の参考について
以下の参考記事は、見出し構成・文体・記事の書き方・情報の出し方など「出力の仕方」を参考にするためのものです。
作成する記事のキーワードは「${keyword}」であり、参考記事のキーワード・テーマとは異なります。
参考記事の文言や内容をそのまま流用せず、構成や文体のみを参考に、新しいキーワード向けのオリジナルな出力を作成してください。

# 出力参考記事
${referenceTexts}
`;
}

function registerArticleAppRoutes(app, { scrape, getGeminiModel }) {
  app.post('/api/article/generate', async (req, res) => {
    const requestStartedAt = Date.now();
    try {
      await handleArticleGenerate(req, res, requestStartedAt, {
        scrape,
        getGeminiModel,
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
      await handleHeadingGenerate(req, res, requestStartedAt, {
        scrape,
        getGeminiModel,
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
      await handleSubHeadingGenerate(req, res, requestStartedAt, {
        scrape,
        getGeminiModel,
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
  { scrape, getGeminiModel }
) {
    const {
      keyword,
      title,
      heading_h2_first,
      heading_h3_first,
      heading_h3_second,
      heading_h3_third,
      heading_h3_fourth,
      heading_h3_fifth,
      urls = [],
      competitorUrl1,
      competitorUrl2,
      competitorUrl3,
    } = req.body;

    const generateIntroduction =
      req.body.generateIntroduction === true || req.body.generateIntroduction === 'true';
    const generateSummary =
      req.body.generateSummary === true || req.body.generateSummary === 'true';

    console.log('🛎️ POST /api/article/generate called with:', {
      keyword,
      title,
      heading_h2_first,
      heading_h3_first,
      heading_h3_second,
      heading_h3_third,
      heading_h3_fourth,
      heading_h3_fifth,
      generateIntroduction,
      generateSummary,
      urls,
      competitorUrl1,
      competitorUrl2,
      competitorUrl3,
      referenceUrl: req.body.referenceUrl,
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
        error: '他社URLまたは参考URLを少なくとも1つ入力してください。',
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
- キーワードとの関連性が高く、検索ユーザーの意図を満たす構成にする
- 内容は具体的で、独自の視点・根拠・事例を交えて説明且つ信頼感があり、客観的
- 家電販売店にふさわしいフォーマルな文体
- 数値・比較・用途別の提案など、検索ユーザーの満足度を意識
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
  `;

      try {
        console.log('🧠 Generating introduction with Gemini');
        const model = await getGeminiModel();
        const introductionResult = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: introductionPrompt }] }],
        });
        const introductionRaw = introductionResult.response?.text?.() || '';
        introductionData = parseJsonFromModelOutput(introductionRaw) || introductionData;
        console.log(
          '🧾 Introduction generated. H2 count:',
          pickSectionsFromIntroduction(introductionData)?.length ?? 0
        );
      } catch (err) {
        console.error('❌ Introduction generation failed', err.message);
        return res.status(502).json({
          error: '導入文の生成に失敗しました。',
          warnings,
        });
      }

      console.log('introductionJSON', JSON.stringify(introductionData, null, 2));
    } else {
      console.log('⏭️ Skipping introduction generation (unchecked)');
    }

    const h4Headings = collectArticleH4Headings(req.body);
    const hasH4 = h4Headings.some((h) => h);
    const heading_h3_target = String(req.body.heading_h3_target || '').trim();
    const isH4Mode = hasH4 && heading_h3_target;

    const contentResults = [];

    if (isH4Mode) {
      for (let i = 0; i < h4Headings.length; i++) {
        const h4Heading = h4Headings[i];
        if (!h4Heading) continue;
        try {
          const data = await generateH4BodyContent({
            getGeminiModel,
            keyword,
            title,
            heading_h2_first,
            heading_h3: heading_h3_target,
            h4Heading,
            competitorTexts,
            referenceOutputSection,
            index: i + 1,
          });
          contentResults.push({ heading: h4Heading, data, level: 'h4' });
        } catch (err) {
          console.error(`❌ H4-${i + 1} generation failed`, err.message);
          return res.status(502).json({
            error: `H4-${i + 1}本文の生成に失敗しました。`,
            warnings,
          });
        }
      }
    } else {
      const h3Headings = collectArticleH3Headings(req.body);
      for (let i = 0; i < h3Headings.length; i++) {
        const h3Heading = h3Headings[i];
        if (!h3Heading) continue;
        try {
          const data = await generateH3BodyContent({
            getGeminiModel,
            keyword,
            title,
            heading_h2_first,
            h3Heading,
            competitorTexts,
            referenceOutputSection,
            index: i + 1,
          });
          contentResults.push({ heading: h3Heading, data, level: 'h3' });
        } catch (err) {
          console.error(`❌ H3-${i + 1} generation failed`, err.message);
          return res.status(502).json({
            error: `H3-${i + 1}本文の生成に失敗しました。`,
            warnings,
          });
        }
      }
    }

    const bodiesForSummary = contentResults
      .map((r) => r.data?.content)
      .filter(Boolean)
      .join('\n');

    let summaryData = { summary: '' };

    if (generateSummary) {
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
        const model = await getGeminiModel();
        const summaryResult = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
        });
        const summaryRaw = summaryResult.response?.text?.() || '';
        summaryData = parseJsonFromModelOutput(summaryRaw) || summaryData;
      } catch (err) {
        console.error('❌ Summary generation failed', err.message);
        return res.status(502).json({
          error: 'まとめ文の生成に失敗しました。',
          warnings,
        });
      }
    } else {
      console.log('⏭️ Skipping summary generation (unchecked)');
    }

    console.log(
      '✅ Completed /api/article/generate in',
      `${Date.now() - requestStartedAt}ms`
    );

    if (isH4Mode) {
      const h4Items = contentResults
        .filter((r) => r.level === 'h4')
        .map((r) => ({
          h4: r.data?.h4 || r.heading,
          content: r.data?.content || '',
        }));

      res.json({
        generateIntroduction,
        generateSummary,
        mode: 'h4',
        title: introductionData.h1 || title || '',
        introduction: introductionData.introduction || '',
        summary: summaryData?.summary || '',
        article: {
          h1: introductionData.h1 || title || '',
          introduction: introductionData.introduction || '',
          summary: summaryData?.summary || '',
          h2: heading_h2_first,
          h3_target: heading_h3_target,
          h4_items: h4Items,
        },
      });
    } else {
      const sectionsRaw = pickSectionsFromIntroduction(introductionData);
      let sectionsForClient = sectionsRaw;
      const h3Headings = collectArticleH3Headings(req.body);

      let resultIdx = 0;
      const h3BySlot = h3Headings.map((heading) => {
        if (!heading) return null;
        const item = contentResults[resultIdx++];
        return item ? { heading: item.heading, data: item.data } : null;
      });
      const articleH3Fields = buildArticleH3FlatFields(h3BySlot);

      if (!sectionsForClient?.length) {
        sectionsForClient = [
          {
            h2: heading_h2_first || '',
            content: '',
            subsections: articleH3Fields.h3_items.map((sub) => ({
              h3: sub.h3,
              content: sub.content,
            })),
          },
        ].filter(
          (sec) =>
            String(sec.h2 || '').trim() ||
            (Array.isArray(sec.subsections) && sec.subsections.length > 0)
        );
      } else {
        sectionsForClient = sectionsForClient.map((sec) => ({
          ...sec,
          subsections: normalizeSubsectionsList(sec.subsections),
        }));
      }

      res.json({
        generateIntroduction,
        generateSummary,
        mode: 'h3',
        title: introductionData.h1 || title || '',
        introduction: introductionData.introduction || '',
        summary: summaryData?.summary || '',
        article: {
          h1: introductionData.h1 || title || '',
          introduction: introductionData.introduction || '',
          summary: summaryData?.summary || '',
          sections: sectionsForClient,
          h2: heading_h2_first,
          ...articleH3Fields,
        },
      });
    }
}

async function handleHeadingGenerate(
  req,
  res,
  requestStartedAt,
  { scrape, getGeminiModel }
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
      error: '他社URLまたは参考URLを少なくとも1つ入力してください。',
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

  const headingsPrompt = `
あなたはSEOに強い家電専門ライターです。
キーワード「${keyword}」の記事見出し案を作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h1": "タイトル案",
  "sections": [
    {
      "h2": "大見出し1（H2）",
      "subsections": ["小見出し1-1（H3）", "小見出し1-2（H3）", "小見出し1-3（H3）"]
    },
    {
      "h2": "大見出し2（H2）",
      "subsections": ["小見出し2-1（H3）", "小見出し2-2（H3）", "小見出し2-3（H3）"]
    },
    {
      "h2": "大見出し3（H2）",
      "subsections": ["小見出し3-1（H3）", "小見出し3-2（H3）", "小見出し3-3（H3）"]
    }
  ]
}
- H2は3つ、各H2に対してH3を3つ作成
- 各見出しは本文を書かず、見出しテキストのみを出力する
- キーワードとの関連性が高く、検索ユーザーの意図を満たす構成にする
- 家電販売店にふさわしいフォーマルな文体
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ
${buildHeadingCandidatesPromptSection(headingCandidates)}${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
  `;

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
  const sectionsForClient = sectionsRaw.map((sec) => {
    const subsectionsRaw = normalizeSubsectionsList(sec.subsections);
    const subsections = subsectionsRaw
      .map((sub) => {
        if (typeof sub === 'string') return sub.trim();
        if (sub && typeof sub === 'object') {
          return String(sub.h3 || sub.title || '').trim();
        }
        return '';
      })
      .filter(Boolean);

    return {
      h2: String(sec.h2 || '').trim(),
      subsections,
    };
  }).filter((sec) => sec.h2 || sec.subsections.length > 0);

  res.json({
    title: headingData.h1 || '',
    sections: sectionsForClient,
    headingCandidatesUsed: headingCandidates,
    warnings,
  });
}

async function handleSubHeadingGenerate(
  req,
  res,
  requestStartedAt,
  { scrape, getGeminiModel }
) {
  const { keyword, h3 } = req.body;

  console.log('🛎️ POST /api/article/generate-sub-headings called with:', {
    keyword,
    h3,
    competitorUrls: collectCandidateUrls(req.body),
    referenceUrls: collectReferenceUrls(req.body),
  });

  if (!keyword) {
    return res.status(400).json({ error: 'キーワードを入力してください。' });
  }
  if (!h3) {
    return res.status(400).json({ error: 'H3見出しを入力してください。' });
  }

  const candidateUrls = collectCandidateUrls(req.body);
  const referenceUrls = collectReferenceUrls(req.body);

  if (candidateUrls.length === 0 && referenceUrls.length === 0) {
    return res.status(400).json({
      error: '他社URLまたは参考URLを少なくとも1つ入力してください。',
    });
  }

  const warnings = [];
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

  if (scrapedArticles.length === 0 && scrapedReferenceArticles.length === 0) {
    return res.status(502).json({
      error: '記事の取得に失敗しました。',
      warnings,
    });
  }

  const competitorTexts = formatScrapedTexts(scrapedArticles, '他社記事');
  const referenceTexts = formatScrapedTexts(scrapedReferenceArticles, '参考記事');
  const referenceOutputSection = buildReferenceOutputSection(keyword, referenceTexts);

  const prompt = `
あなたはSEOに強い家電専門ライターです。
キーワード「${keyword}」の記事において、H3見出し「${h3}」の配下に置くH4小見出しの案を作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h3": "${h3}",
  "subheadings": ["小見出し1（H4）", "小見出し2（H4）", "小見出し3（H4）", "小見出し4（H4）", "小見出し5（H4）"]
}
- H4は最大5つ作成
- 各H4はH3の内容をさらに具体的に掘り下げたテーマにする
- 各見出しは本文を書かず、見出しテキストのみを出力する
- キーワードとの関連性が高く、検索ユーザーの意図を満たす構成にする
- 家電販売店にふさわしいフォーマルな文体
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
`;

  let data;
  try {
    console.log('🧠 Generating H4 sub-headings with Gemini');
    const model = await getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const raw = result.response?.text?.() || '';
    data = parseJsonFromModelOutput(raw);
    console.log('🧾 H4 sub-headings generated:', data);
  } catch (err) {
    console.error('❌ H4 heading generation failed', err.message);
    return res.status(502).json({
      error: 'H4見出しの生成に失敗しました。',
      warnings,
    });
  }

  console.log(
    '✅ Completed /api/article/generate-sub-headings in',
    `${Date.now() - requestStartedAt}ms`
  );

  const subheadings = Array.isArray(data?.subheadings)
    ? data.subheadings.map((s) => String(s || '').trim()).filter(Boolean)
    : [];

  res.json({
    h3: data?.h3 || h3,
    subheadings,
    warnings,
  });
}

module.exports = registerArticleAppRoutes;
