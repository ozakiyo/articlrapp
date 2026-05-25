// app.js (Node16対応版)
// 1. 必要なモジュールのインポート
const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const iconv = require('iconv-lite');

let gotScrapingClient;
async function getGotScraping() {
  if (!gotScrapingClient) {
    const mod = await import('got-scraping');
    gotScrapingClient = mod.gotScraping;
  }
  return gotScrapingClient;
}

let geminiModel;
async function getGeminiModel() {
  if (!geminiModel) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    const client = new GoogleGenerativeAI(apiKey);
    geminiModel = client.getGenerativeModel({
      model: 'gemini-2.0-flash',
    });
  }
  return geminiModel;
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

  console.log('🧩 Detected encoding:', encoding);
  return iconv.decode(buffer, encoding);
}

dotenv.config();

// 2. サーバー設定
const app = express();
const PORT = process.env.PORT || 3001;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const clientDistPath = path.join(__dirname, 'public');
const clientIndexPath = path.join(clientDistPath, 'index.html');

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
}

// 3. ルートの定義
app.get('/', (req, res) => {
  if (fs.existsSync(clientIndexPath)) {
    return res.sendFile(clientIndexPath);
  }
  res.send(
    'React build not found. Run "npm run build" in the client project to generate static assets.'
  );
});

// 4.競合記事を取得
async function fetchCompetitorArticle(url) {
  try {
    console.log('📥 Fetching:', url);
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
        'user-agent': undefined, // got-scrapingが動的に生成
      },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 110 }],
        devices: ['desktop'],
        operatingSystems: ['windows', 'linux', 'macos'],
      },
      responseType: 'buffer',
    });
    console.log(
      res.statusCode === 200 ? '✅ Fetch successful' : '❌ Fetch failed',
      url
    );
    console.log('🔍 Parsing HTML content');
    const html = decodeHtml(res.body, res.headers);
    const $ = cheerio.load(html);

    // H1は最初の1つだけ取得
    const title = $('h1').first().text().trim();
    console.log('📝 Extracted title:', title || '(empty)');

    // H2を最大3個取得
    const h2Elements = $('h2').slice(0, 3);
    const headings = [];

    h2Elements.each((i, h2) => {
      const h2Text = $(h2).text().trim();
      headings.push({ level: 'h2', text: h2Text });
      console.log(`➡️ Found H2[${i}]:`, h2Text || '(empty)');

      // H2の次の要素からH2またはH1までの間のH3を取得（最大3個）
      let countH3 = 0;
      $(h2)
        .nextUntil('h1, h2', 'h3')
        .each((j, h3) => {
          if (countH3 < 3) {
            const h3Text = $(h3).text().trim();
            headings.push({ level: 'h3', text: h3Text });
            countH3++;
            console.log(`   ↳ H3[${j}]:`, h3Text || '(empty)');
          }
        });
    });

    console.log(`📑 Collected ${headings.length} headings from`, url);
    return { title, headings, sourceUrl: url, error: null };
  } catch (err) {
    const message =
      err?.response?.statusCode === 403
        ? 'アクセスが拒否されました（403 Forbidden）'
        : err.message;
    console.error('❌ スクレイピング失敗', url, message);
    return { title: '', headings: [], sourceUrl: url, error: message };
  }
}

// 5. 記事生成(見出し中心)
app.post('/api/generate', async (req, res) => {
  const { keyword, competitorUrl1, competitorUrl2, competitorUrl3 } = req.body;

  const urls = [competitorUrl1, competitorUrl2, competitorUrl3]
    .map((u) => u?.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return res
      .status(400)
      .json({ error: 'URLを少なくとも1つ入力してください。' });
  }

  const competitors = await Promise.all(urls.map(fetchCompetitorArticle));
  const warnings = competitors
    .filter((entry) => entry.error)
    .map((entry) => ({
      url: entry.sourceUrl,
      message: entry.error,
    }));

  // 見出しをまとめる
  const allHeadings = competitors
    .filter((c) => (c.headings || []).length > 0)
    .flatMap((c) => c.headings || []);

  // Gemini API用プロンプト
  const prompt = `
「${keyword}」に関するオリジナル記事を作成してください。
参考URLの見出し構成：
${allHeadings.map((h) => `${h.level}: ${h.text}`).join('\n')}

条件：
- H1 1個（記事タイトル）
- H2 3個（各H2に対してH3を3個ずつ）
- 文章はオリジナルで生成する
- JSON形式で出力:
{
  "title": "記事タイトル",
  "headings": [
    {"level": "h2", "text": "見出し1", "body": "ここに文章"},
    {"level": "h3", "text": "見出し1-1", "body": "ここに文章"},
    ...
  ]
}
`;

  let parsed;
  try {
    console.log('🪄 Generating article via Gemini API');
    const model = await getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const textOutput = result.response?.text?.() || '';
    const jsonText = textOutput.replace(/```json|```/g, '').trim();

    parsed = JSON.parse(jsonText);
  } catch (err) {
    console.error('❌ Gemini API request failed', err.message);
    return res.status(502).json({
      error:
        '記事生成APIの呼び出しに失敗しました。APIキーやネットワークを確認してください。',
      warnings,
    });
  }

  res.json({
    title: parsed.title || '',
    headings: parsed.headings || [],
    warnings,
  });
});

app.get('*', (req, res) => {
  if (fs.existsSync(clientIndexPath)) {
    return res.sendFile(clientIndexPath);
  }
  res.status(404).json({ error: 'Not found' });
});

// 6. サーバー起動
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
