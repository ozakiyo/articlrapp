// 1. 必要なモジュールのインポート
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";

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

app.post("/generate", async (req, res) => {
  const { keyword } = req.body;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `「${keyword}」について記事を書いてください。
出力フォーマットは以下のJSON形式でお願いします：
{
  "title": "記事タイトル",
  "body": "本文（200文字程度ごとに改行して分割してください）"
}`
                },
              ],
            },
          ],
        }),
      }
    );

    const data = await response.json();
    console.log("📝 Gemini APIレスポンス:", JSON.stringify(data, null, 2));

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 余計な ```json ``` を削除
    const jsonText = rawText.replace(/```json|```/g, "").trim();

    // JSONパース
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.error("❌ JSONパース失敗:", e);
      parsed = { title: "不明なタイトル", body: rawText };
    }

    // 本文を200文字ごとに分割
    const sections = [];
    if (parsed.body) {
      const bodyText = parsed.body.replace(/\\n/g, "\n");
      for (let i = 0; i < bodyText.length; i += 200) {
        sections.push({ body: bodyText.slice(i, i + 200) });
      }
    }

    res.render("index", {
      title: parsed.title,
      sections: sections,
    });

  } catch (error) {
    console.error("❌ API呼び出し中のエラー:", error);
    res.render("index", { title: "エラー", sections: [{ body: "⚠️ AI記事生成に失敗しました。" }] });
  }
});

// 4. サーバー起動
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});