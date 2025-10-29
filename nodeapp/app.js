// app.js (Node16対応版)
// 1. 必要なモジュールのインポート
const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const axios = require("axios");
const cheerio = require("cheerio");

dotenv.config();

// 2. サーバー設定
const app = express();
const PORT = process.env.PORT || 3001;

app.set("view engine", "ejs");
app.set("views", "./views");

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 3. ルートの定義
app.get("/", (req, res) => {
  res.render("index", { title: null, sections: [] }); // 初期状態は空
});

// 4.競合記事を取得
async function fetchCompetitorArticle(url) {
  try {
    console.log("📥 Fetching:", url);
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MyBot/1.0; +http://example.com/bot)"
      }
    });
    const $ = cheerio.load(res.data);

    // H1は最初の1つだけ取得
    const title = $("h1").first().text().trim();

    // H2を最大3個取得
    const h2Elements = $("h2").slice(0, 3);
    const headings = [];

    h2Elements.each((i, h2) => {
      const h2Text = $(h2).text().trim();
      headings.push({ level: "h2", text: h2Text });

      // H2の次の要素からH2またはH1までの間のH3を取得（最大3個）
      let countH3 = 0;
      $(h2).nextUntil("h1, h2", "h3").each((j, h3) => {
        if (countH3 < 3) {
          headings.push({ level: "h3", text: $(h3).text().trim() });
          countH3++;
        }
      });
    });

    return { title, headings, $ };

  } catch (err) {
    console.error("❌ スクレイピング失敗", url, err.message);
    return { title: "", headings: [], $: null };
  }
}

// 5. 記事生成(見出し中心)
app.post("/generate", async (req, res) => {
  const { keyword, competitorUrl1, competitorUrl2, competitorUrl3 } = req.body;

  const urls = [competitorUrl1, competitorUrl2, competitorUrl3]
    .map(u => u?.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return res.render("index", { title: "エラー", sections: [{ body: "URLを入力してください" }] });
  }

  const competitors = await Promise.all(urls.map(fetchCompetitorArticle));

  // 見出しをまとめる
  const allHeadings = competitors.flatMap(c => c.headings || []);

  // Gemini API用プロンプト
  const prompt = `
「${keyword}」に関するオリジナル記事を作成してください。
参考URLの見出し構成：
${allHeadings.map(h => `${h.level}: ${h.text}`).join("\n")}

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

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    { contents: [{ parts: [{ text: prompt }] }] },
    { headers: { "Content-Type": "application/json" } }
  );

  const rawText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const jsonText = rawText.replace(/```json|```/g, "").trim();

  let parsed;
  try { parsed = JSON.parse(jsonText); } 
  catch { parsed = { title: "不明", headings: [] }; }

  const sections = parsed.headings?.map(h => ({ body: `${h.level}: ${h.text}\n${h.body}` })) || [];

  res.render("index", { title: parsed.title, sections });
});

// 6. サーバー起動
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

