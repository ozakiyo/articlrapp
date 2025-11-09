const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const basicAuth = require('express-basic-auth');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json());

const clientDistPath = path.join(__dirname, 'public');
const clientIndexPath = path.join(clientDistPath, 'index.html');

// Basic Authentication Middleware
const basicAuthMiddleware = basicAuth({
  users: {
    [process.env.BASIC_AUTH_USER || 'admin']: process.env.BASIC_AUTH_PASSWORD || 'password'
  },
  challenge: true,
  realm: 'ArticlrApp',
  unauthorizedResponse: () => {
    return { error: '認証が必要です。' };
  }
});

// Apply basic auth to all routes
app.use(basicAuthMiddleware);

if (fs.existsSync(clientDistPath)) {
  console.log('📦 Serving static assets from:', clientDistPath);
  app.use(express.static(clientDistPath));
} else {
  console.log('⚠️ React build not found at:', clientDistPath);
}

let geminiModel;
async function getGeminiModel() {
  if (!geminiModel) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    console.log('⚙️ Initializing Gemini model: gemini-2.0-flash');
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }
  return geminiModel;
}

let gotScrapingClient;
async function getGotScraping() {
  if (!gotScrapingClient) {
    const mod = await import('got-scraping');
    gotScrapingClient = mod.gotScraping;
  }
  return gotScrapingClient;
}

function decodeHtml(buffer, headers) {
  const defaultEncoding = 'utf-8';
  let encoding;

  const contentType = headers['content-type'] || headers['Content-Type'];
  if (contentType) {
    const match = contentType.match(/charset=([^;]+)/i);
    if (match) encoding = match[1].trim().toLowerCase();
  }

  if (!encoding) {
    const headChunk = buffer.toString(
      'ascii',
      0,
      Math.min(buffer.length, 2048)
    );
    const metaCharset = headChunk.match(
      /<meta\s+[^>]*charset=["']?([a-zA-Z0-9\-_]+)/i
    );
    if (metaCharset) {
      encoding = metaCharset[1].toLowerCase();
    } else {
      const metaContent = headChunk.match(
        /<meta\s+[^>]*content=["'][^"']*charset=([^"';\s]+)/i
      );
      if (metaContent) {
        encoding = metaContent[1].toLowerCase();
      }
    }
  }

  const encodingMap = {
    sjis: 'shift_jis',
    'shift-jis': 'shift_jis',
    shift_jis: 'shift_jis',
    'windows-31j': 'shift_jis',
    'euc-jp': 'euc-jp',
  };

  if (encoding && encodingMap[encoding]) {
    encoding = encodingMap[encoding];
  }

  if (!encoding || !iconv.encodingExists(encoding)) {
    encoding = defaultEncoding;
  }

  console.log('🧩 [Fallback] Detected encoding:', encoding);
  return iconv.decode(buffer, encoding);
}

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
    http2: true,
    headers: {
      'user-agent': undefined,
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
  const html = decodeHtml(res.body, res.headers);
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  console.log(`📝 [Fallback] Extracted ${text.length} characters from`, url);
  if (!text) {
    throw new Error('本文を取得できませんでした。');
  }
  return text;
}

async function scrape(url) {
  console.log('📥 [Playwright] Start scrape:', url);
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage();
    console.log('🌐 Navigating to:', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('⏳ Waiting for body content');
    await page.waitForSelector('body', { timeout: 10000 });
    const text = await page.$eval('body', (el) => el.innerText || '');
    const normalized = text.replace(/\s+/g, ' ').trim();
    console.log(`📝 Scraped ${normalized.length} characters from`, url);
    return normalized.slice(0, 8000);
  } catch (err) {
    console.error('❌ Playwright scraping failed', url, err.message);
    console.log('🔁 Attempting HTTP fallback for', url);
    try {
      const fallbackText = await scrapeWithHttpClient(url);
      console.log('✅ Fallback succeeded for', url);
      return fallbackText.slice(0, 8000);
    } catch (fallbackErr) {
      console.error(
        '💥 Fallback scraping also failed',
        url,
        fallbackErr.message
      );
      throw fallbackErr;
    }
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    await browser.close().catch(() => {});
    console.log('🧹 Closed browser instance for', url);
  }
}

app.get('/', (_req, res) => {
  console.log('📨 GET /');
  if (fs.existsSync(clientIndexPath)) {
    console.log('➡️ Serving React index.html');
    return res.sendFile(clientIndexPath);
  }
  console.log('⚠️ React build not available, sending fallback message');
  res.send(
    'React build not found. Run "npm run build" in the client project to generate static assets.'
  );
});

app.post('/api/generate', async (req, res) => {
  const requestStartedAt = Date.now();
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
    console.log('🧠 Generating outline with Gemini');
    const model = await getGeminiModel();
    const outlineResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: outlinePrompt }] }],
    });
    const outlineRaw = outlineResult.response?.text?.() || '';
    const outlineJsonText = outlineRaw.replace(/```json|```/g, '').trim();
    outlineData = JSON.parse(outlineJsonText);
    console.log(
      '🧾 Outline generated. H2 count:',
      Array.isArray(outlineData.sections) ? outlineData.sections.length : 0
    );
  } catch (err) {
    console.error('❌ Outline generation failed', err.message);
    return res.status(502).json({
      error: '記事構成の生成に失敗しました。',
      warnings,
    });
  }

  const outlineJSON = JSON.stringify(outlineData, null, 2);

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
    console.log('✍️ Generating article body with Gemini');
    const model = await getGeminiModel();
    const articleResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: articlePrompt }] }],
    });
    const articleRaw = articleResult.response?.text?.() || '';
    const articleJsonText = articleRaw.replace(/```json|```/g, '').trim();
    articleData = JSON.parse(articleJsonText);
    console.log(
      '📄 Article generated. Sections:',
      Array.isArray(articleData.sections) ? articleData.sections.length : 0
    );
  } catch (err) {
    console.error('❌ Article generation failed', err.message);
    return res.status(502).json({
      error: '記事本文の生成に失敗しました。',
      outline: outlineData,
      warnings,
    });
  }

  const headings = [];
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

  console.log(
    '✅ Completed /api/generate in',
    `${Date.now() - requestStartedAt}ms`
  );

  res.json({
    title: articleData.h1 || '',
    introduction: articleData.introduction || '',
    summary: articleData.summary || '',
    outline: outlineData,
    article: articleData,
    headings,
    warnings,
  });
});

app.listen(PORT, () =>
  console.log(`✅ Server ready on http://localhost:${PORT}`)
);
