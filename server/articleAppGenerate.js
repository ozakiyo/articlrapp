'use strict';

/**
 * 記事生成 UI（client/src/App_BK20260113.jsx）向け API。
 * 旧 app_BK20260113.js の POST /api/generate と同等の処理を /api/article/generate に提供する。
 */
function registerArticleAppRoutes(app, { scrape, getGeminiModel }) {
  app.post('/api/article/generate', async (req, res) => {
    const requestStartedAt = Date.now();
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
    });

    if (!keyword) {
      console.warn('⚠️ keyword is missing in request body');
      return res.status(400).json({ error: 'キーワードを入力してください。' });
    }

    const candidateUrls = [
      ...urls,
      competitorUrl1,
      competitorUrl2,
      competitorUrl3,
    ]
      .map((u) => u?.trim())
      .filter(Boolean);

    if (candidateUrls.length === 0) {
      console.warn('⚠️ No URLs provided');
      return res
        .status(400)
        .json({ error: 'URLを少なくとも1つ入力してください。' });
    }

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

    if (scrapedArticles.length === 0) {
      console.error('🚨 Scraping failed for all URLs');
      return res.status(502).json({
        error: '競合記事の取得に失敗しました。',
        warnings,
      });
    }

    console.log('📚 Successfully scraped', scrapedArticles.length, 'sources');

    const competitorTexts = scrapedArticles
      .map(
        ({ url, text }) => `【Source】${url}
${text}`
      )
      .join('\n---\n');

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

# 参考記事
${competitorTexts} 
  `;

    let introductionData;
    try {
      console.log('🧠 Generating outline with Gemini');
      const model = await getGeminiModel();
      const introductionResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: introductionPrompt }] }],
      });
      const introductionRaw = introductionResult.response?.text?.() || '';
      const introductionJsonText = introductionRaw.replace(/```json|```/g, '').trim();
      introductionData = JSON.parse(introductionJsonText);
      console.log(
        '🧾 Outline generated. H2 count:',
        Array.isArray(introductionData.sections) ? introductionData.sections.length : 0
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

# 参考記事
${competitorTexts} 
`;

    let heading_h3_firstData;
    try {
      console.log('🧠 Generating H3-1 body with Gemini');
      const model = await getGeminiModel();
      const heading_h3_firstResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: heading_h3_firstPrompt }] }],
      });

      const heading_h3_firstRaw = heading_h3_firstResult.response?.text?.() || '';
      const heading_h3_firstJsonText = heading_h3_firstRaw
        .replace(/```json|```/g, '')
        .trim();

      heading_h3_firstData = JSON.parse(heading_h3_firstJsonText);
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

# 参考記事
${competitorTexts} 
`;

    let heading_h3_secondData;
    try {
      console.log('🧠 Generating H3-2 body with Gemini');
      const model = await getGeminiModel();
      const heading_h3_secondResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: heading_h3_secondPrompt }] }],
      });

      const heading_h3_secondRaw = heading_h3_secondResult.response?.text?.() || '';
      const heading_h3_secondJsonText = heading_h3_secondRaw
        .replace(/```json|```/g, '')
        .trim();

      heading_h3_secondData = JSON.parse(heading_h3_secondJsonText);
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

# 参考記事
${competitorTexts} 
`;

    let heading_h3_thirdData;
    try {
      console.log('🧠 Generating H3-3 body with Gemini');
      const model = await getGeminiModel();
      const heading_h3_thirdResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: heading_h3_thirdPrompt }] }],
      });

      const heading_h3_thirdRaw = heading_h3_thirdResult.response?.text?.() || '';
      const heading_h3_thirdJsonText = heading_h3_thirdRaw
        .replace(/```json|```/g, '')
        .trim();

      heading_h3_thirdData = JSON.parse(heading_h3_thirdJsonText);
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

    console.log(
      '✅ Completed /api/article/generate in',
      `${Date.now() - requestStartedAt}ms`
    );

    res.json({
      title: introductionData.h1 || '',
      introduction: introductionData.introduction || '',
      article: {
        h1: introductionData.h1 || '',
        introduction: introductionData.introduction || '',
        h2: heading_h2_first,
        h3_first: heading_h3_firstData?.h3 || heading_h3_first,
        h3_first_content: heading_h3_firstData?.content || '',
        h3_second: heading_h3_secondData?.h3 || heading_h3_second,
        h3_second_content: heading_h3_secondData?.content || '',
        h3_third: heading_h3_thirdData?.h3 || heading_h3_third,
        h3_third_content: heading_h3_thirdData?.content || '',
      },
    });
  });
}

module.exports = registerArticleAppRoutes;
