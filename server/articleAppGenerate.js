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
      urls = [],
      competitorUrl1,
      competitorUrl2,
      competitorUrl3,
    } = req.body;

    console.log('🛎️ POST /api/article/generate called with:', {
      keyword,
      title,
      heading_h2_first,
      heading_h3_first,
      heading_h3_second,
      heading_h3_third,
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

    let introductionData;
    try {
      console.log('🧠 Generating outline with Gemini');
      const model = await getGeminiModel();
      const introductionResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: introductionPrompt }] }],
      });
      const introductionRaw = introductionResult.response?.text?.() || '';
      introductionData = parseJsonFromModelOutput(introductionRaw);
      console.log(
        '🧾 Outline generated. H2 count:',
        pickSectionsFromIntroduction(introductionData)?.length ?? 0
      );
    } catch (err) {
      console.error('❌ Outline generation failed', err.message);
      return res.status(502).json({
        error: '記事構成の生成に失敗しました。',
        warnings,
      });
    }

    const introductionJSON = JSON.stringify(introductionData, null, 2);
    console.log('introductionJSON', introductionJSON);

    const heading_h3_firstPrompt = `
あなたはSEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」、タイトル「${title}」、H2見出し「${heading_h2_first}」の子見出し「${heading_h3_first}」の本文を200文字程度で作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h3": "${heading_h3_first}",
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

    let heading_h3_firstData;
    try {
      console.log('🧠 Generating H3-1 body with Gemini');
      const model = await getGeminiModel();
      const heading_h3_firstResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: heading_h3_firstPrompt }] }],
      });

      const heading_h3_firstRaw = heading_h3_firstResult.response?.text?.() || '';

      heading_h3_firstData = parseJsonFromModelOutput(heading_h3_firstRaw);
      console.log('🧾 H3-1 generated:', heading_h3_firstData);
    } catch (err) {
      console.error('❌ H3-1 generation failed', err.message);
      return res.status(502).json({
        error: 'H3-1本文の生成に失敗しました。',
        warnings,
      });
    }

    const heading_h3_firstJSON = JSON.stringify(heading_h3_firstData, null, 2);
    console.log('heading_h3_firstJSON', heading_h3_firstJSON);

    const heading_h3_secondPrompt = `
あなたはSEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」、タイトル「${title}」、H2見出し「${heading_h2_first}」の子見出し「${heading_h3_second}」の本文を200文字程度で作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h3": "${heading_h3_second}",
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

    let heading_h3_secondData;
    try {
      console.log('🧠 Generating H3-2 body with Gemini');
      const model = await getGeminiModel();
      const heading_h3_secondResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: heading_h3_secondPrompt }] }],
      });

      const heading_h3_secondRaw = heading_h3_secondResult.response?.text?.() || '';

      heading_h3_secondData = parseJsonFromModelOutput(heading_h3_secondRaw);
      console.log('🧾 H3-2 generated:', heading_h3_secondData);
    } catch (err) {
      console.error('❌ H3-2 generation failed', err.message);
      return res.status(502).json({
        error: 'H3-2本文の生成に失敗しました。',
        warnings,
      });
    }

    const heading_h3_secondJSON = JSON.stringify(heading_h3_secondData, null, 2);
    console.log('heading_h3_secondJSON', heading_h3_secondJSON);

    const heading_h3_thirdPrompt = `
あなたはSEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」、タイトル「${title}」、H2見出し「${heading_h2_first}」の子見出し「${heading_h3_third}」の本文を200文字程度で作成してください。

# 出力条件
- JSON形式で出力
- 形式:
{
  "h3": "${heading_h3_third}",
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

    let heading_h3_thirdData;
    try {
      console.log('🧠 Generating H3-3 body with Gemini');
      const model = await getGeminiModel();
      const heading_h3_thirdResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: heading_h3_thirdPrompt }] }],
      });

      const heading_h3_thirdRaw = heading_h3_thirdResult.response?.text?.() || '';

      heading_h3_thirdData = parseJsonFromModelOutput(heading_h3_thirdRaw);
      console.log('🧾 H3-3 generated:', heading_h3_thirdData);
    } catch (err) {
      console.error('❌ H3-3 generation failed', err.message);
      return res.status(502).json({
        error: 'H3-3本文の生成に失敗しました。',
        warnings,
      });
    }

    const heading_h3_thirdJSON = JSON.stringify(heading_h3_thirdData, null, 2);
    console.log('heading_h3_thirdJSON', heading_h3_thirdJSON);

    const h3BodiesForSummary = [
      heading_h3_firstData?.content,
      heading_h3_secondData?.content,
      heading_h3_thirdData?.content,
    ]
      .filter(Boolean)
      .join('\n');

    const summaryPrompt = `
あなたはSEOに強い家電専門ライターです。
キーワード「${keyword}」、タイトル「${title}」の記事について、導入文と各見出し本文を踏まえたまとめ文を150〜200文字で作成してください。

# 導入文
${introductionData.introduction || ''}

# 見出し本文
${h3BodiesForSummary}

# 出力条件
- JSON形式で出力
- 形式: { "summary": "まとめ文(150〜200文字)" }
- 家電販売店にふさわしいフォーマルな文体
- 製品名・価格は直接記載しない
- 出力は厳密にJSONのみ
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
`;

    let summaryData;
    try {
      console.log('📝 Generating summary with Gemini');
      const model = await getGeminiModel();
      const summaryResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
      });
      const summaryRaw = summaryResult.response?.text?.() || '';
      summaryData = parseJsonFromModelOutput(summaryRaw);
    } catch (err) {
      console.error('❌ Summary generation failed', err.message);
      return res.status(502).json({
        error: 'まとめ文の生成に失敗しました。',
        warnings,
      });
    }

    console.log(
      '✅ Completed /api/article/generate in',
      `${Date.now() - requestStartedAt}ms`
    );

    const sectionsRaw = pickSectionsFromIntroduction(introductionData);
    let sectionsForClient = sectionsRaw;

    if (!sectionsForClient?.length) {
      sectionsForClient = [
        {
          h2: heading_h2_first || '',
          content: '',
          subsections: [
            {
              h3: heading_h3_firstData?.h3 || heading_h3_first,
              content: heading_h3_firstData?.content || '',
            },
            {
              h3: heading_h3_secondData?.h3 || heading_h3_second,
              content: heading_h3_secondData?.content || '',
            },
            {
              h3: heading_h3_thirdData?.h3 || heading_h3_third,
              content: heading_h3_thirdData?.content || '',
            },
          ].filter((sub) => String(sub.h3 || sub.content || '').trim()),
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
      title: introductionData.h1 || title || '',
      introduction: introductionData.introduction || '',
      summary: summaryData?.summary || '',
      article: {
        h1: introductionData.h1 || title || '',
        introduction: introductionData.introduction || '',
        summary: summaryData?.summary || '',
        sections: sectionsForClient,
        h2: heading_h2_first,
        h3_first: heading_h3_firstData?.h3 || heading_h3_first,
        h3_first_content: heading_h3_firstData?.content || '',
        h3_second: heading_h3_secondData?.h3 || heading_h3_second,
        h3_second_content: heading_h3_secondData?.content || '',
        h3_third: heading_h3_thirdData?.h3 || heading_h3_third,
        h3_third_content: heading_h3_thirdData?.content || '',
      },
    });
}

async function handleHeadingGenerate(
  req,
  res,
  requestStartedAt,
  { scrape, getGeminiModel }
) {
  const { keyword } = req.body;

  console.log('🛎️ POST /api/article/generate-headings called with:', {
    keyword,
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
${competitorTexts ? `\n# 他社記事\n${competitorTexts}` : ''}${referenceOutputSection}
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
    warnings,
  });
}

module.exports = registerArticleAppRoutes;
