import { useEffect, useState } from 'react';

/** 開発時は client/.env.development の VITE_API_BASE_URL で API 直指定（プロキシ不要） */
function apiUrl(path) {
  const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

/*
①入力情報を管理する
②記事生成AIへPOSTする
③PIXTA画像検索APIへGETする
④返ってきたデータをUIに表示する
⑤画像はモーダルで検索結果を閲覧

・pixta関連コメント
・ローディングドット部分カット

*/

const initialUrls = ['', '', ''];

export default function ArticleApp() {
//役割:アプリケーション全体のメインコンポーネント
//useStateを使って、
//変数：キーワード、
//変数：URL、
//変数：記事データ
//の「状態」を管理

/*const [keyword, setKeyword] = useState(''); を分解して説明する。
1. 何をしているか
この1行で、「変数の宣言」 と 「その変数を書き換えるための関数の作成」 を同時に行う。
useState(''):
状態の初期値を ''（空文字）に設定。画面を開いた瞬間、キーワードは空っぽの状態。
keyword:
現在の値が入る変数。ここに入力された文字が保存される。
setKeyword:
その値を更新するための関数。
これを呼び出すとkeywordの中身が書き換わり、
Reactが画面を自動的に再描画する。
ユーザーがキーボードで文字を打つたびにsetKeywordが実行され、
keywordの中身が更新され、入力欄に文字が表示される仕組み
*/
  const [keyword, setKeyword] = useState('');
  const [title, setTitle] = useState('');
  const [heading_h2_first, setHeading_h2_first] = useState('');
  const [heading_h3_first, setHeading_h3_first] = useState('');
  const [heading_h3_second, setHeading_h3_second] = useState('');
  const [heading_h3_third, setHeading_h3_third] = useState('');
  const [competitorUrls, setCompetitorUrls] = useState(initialUrls);
  
  /*---⑴app.jsからの戻り値保存変数作成---*/
  const [article, setArticle] = useState(null);
  console.log("article",article);
  //const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  //const [loadingDots, setLoadingDots] = useState(0);
  //const [searchPIXTA, setSearchPIXTA] = useState(false);
  //const [pixtaResults, setPixtaResults] = useState(null);
  //const [pixtaLoading, setPixtaLoading] = useState(false);
  //const [pixtaError, setPixtaError] = useState('');
  //const [showImageModal, setShowImageModal] = useState(false);
  //const [modalTab, setModalTab] = useState('images'); // 'images' or 'screenshot'

  //①---競合URL更新　　３つのURLフォームの更新---
  //[handleUrlChange関数]
  //競合記事URLの入力欄が変更されたときの更新処理
  //処理内容:
  //1.現在のcompetitorUrls配列をコピー
  //2.指定されたindex（1つ目、2つ目、3つ目のいずれか）のURLを新しい値（value）で書き換える
  //3.更新された配列をsetCompetitorUrlsでステートに保存し、画面上の入力欄に反映
  const handleUrlChange = (index, value) => {
    const next = [...competitorUrls];
    next[index] = value;
    setCompetitorUrls(next);
  };

  /*const handlePixtaSearch = async () => {
    if (!keyword) {
      setPixtaError('キーワードを入力してください。');
      return;
    }

    setPixtaLoading(true);
    setPixtaError('');

    try {
      const response = await fetch(
        apiUrl(`/api/article/searchPIXTAimage?keyword=${encodeURIComponent(keyword)}`)
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'PIXTA検索に失敗しました。');
      }

      const data = await response.json();
      setPixtaResults(data);
    } catch (err) {
      setPixtaError(err.message);
      setPixtaResults(null);
    } finally {
      setPixtaLoading(false);
    }
  };*/

  //----------③記事生成（メイン処理）------------
  //[handleSubmit関数]
  //「記事を生成」ボタンが押されたときのメイン処理
  //処理内容:
  //1.event.preventDefault()でフォーム送信による画面リロードを防ぐ。
  //2.ローディング状態（isLoading）をONにし、エラー表示をリセット。
  //3.入力されたキーワードと3つの競合URLをまとめたデータ（payload）を作成。
  //4. /api/generate というAPIエンドポイントに対して、そのデータをPOST送信。
  //5.成功時: 返ってきた記事データをsetArticleで保存し、画面に表示。
  //6.失敗時: エラーメッセージをsetErrorで保存し、画面に表示。
  //7.最後にローディング状態をOFFに戻す。
  const handleSubmit = async (event) => { //client->server送信処置
  //1.event.preventDefault()でフォーム送信による画面リロードを防ぐ。
    event.preventDefault();
  //2.ローディング状態（isLoading）をONにし、エラー表示をリセット。
    //setIsLoading(true);
    setError('');
    setIsLoading(true);
  //3.入力されたキーワードとタイトルと見出しH2と3つの競合URLをまとめたデータ（payload）を作成。
    const payload = {
      keyword,
      title,
      heading_h2_first,
      heading_h3_first,
      heading_h3_second,
      heading_h3_third,
      competitorUrl1: competitorUrls[0],
      competitorUrl2: competitorUrls[1],
      competitorUrl3: competitorUrls[2],
    };
    console.log("payload",payload);

    try {
      const response = await fetch(apiUrl('/api/article/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '記事の生成に失敗しました。');
      }
      //5.成功時: 返ってきた記事データをsetArticleで保存し、画面に表示。
/*---------------app.js　サーバーからの戻り値保存からフロント表示まで------------------*/
      //setArticle(data)で article ステートに保存
      const data = await response.json();
      setArticle(data);

      // 記事生成後、チェックボックスがONならPIXTA検索も実行
      /*if (searchPIXTA) {
        await handlePixtaSearch();
      }*/
    } catch (err) {
    //6.失敗時: エラーメッセージをsetErrorで保存し、画面に表示。
      setError(err.message);
      setArticle(null);
    } finally {
      setIsLoading(false);
    }
  };
  //-----------③記事生成（メイン処理）------------

  //---⑤出力のクリア/入力のリセット---
  //[handleReset関数]
  //役割:「リセット」ボタンが押されたときの処理
  //処理内容:
  //キーワード、競合URL、生成された記事、エラーメッセージなど、
  //すべてのステートを初期状態（空の状態）に戻す。
  //入力内容も消去される。
  const handleReset = () => {
    setKeyword('');
    setCompetitorUrls(initialUrls);
    setArticle(null);
    setError('');
  };
  //---⑤出力のクリア/入力のリセット---

  //---出力だけ消す(入力は保持)---
  //[handleClearOutput関数]
  //役割:「クリア」ボタンが押されたときの処理
  //処理内容:
  //生成された記事（article）とエラーメッセージ（error）だけを空にする。
  //入力されたキーワードやURLは保持されたままになる。
  const handleClearOutput = () => {
    setArticle(null);
    setError('');
  };
  //---出力だけ消す(入力は保持)---

  //----④ローディングドットのアニメーション----
  /*useEffect(() => {
    if (!isLoading) {
      setLoadingDots(0);
      return;
    }

    const handle = setInterval(() => {
      setLoadingDots((prev) => (prev + 1) % 3);
    }, 400);

    return () => clearInterval(handle);
  }, [isLoading]);*/
  //-------------------------------
  
  //APIから返ってきたarticleデータが、
  //「構成案だけの状態」なのか、
  //「本文まである完全な状態」なのかを判定し、
  //タイトルや本文などのパーツを使いやすい変数に取り出している
  //「表示の前準備」の処理
  
  const hasStructuredHeadings = false;
    //Array.isArray(article?.headings) && article.headings.length > 0;
  //article.headings（見出しリスト）が存在し、かつ中身があるかどうかを判定している。
  //これがtrueなら、単純な見出しリスト形式で表示するためのフラグとして使われる。

  /*------(3-1)setArticle(data);で保存した、articleから取り出し(アウトライン)-------*/
  //const outlineData = article?.article;
  //console.log("outlineData",outlineData);
  //記事のアウトライン（目次のような構成案）データをarticleから取り出す。
  //後でrenderOutline()関数に渡して表示するために使われる。
  
  const articleBody =
    article?.article && typeof article.article === 'object' && !Array.isArray(article.article)
      ? article.article
      : null;

  const h3Articles = [
    {
      title: String(heading_h3_first || articleBody?.h3_first || '').trim(),
      content: String(articleBody?.h3_first_content || '').trim(),
    },
    {
      title: String(heading_h3_second || articleBody?.h3_second || '').trim(),
      content: String(articleBody?.h3_second_content || '').trim(),
    },
    {
      title: String(heading_h3_third || articleBody?.h3_third || '').trim(),
      content: String(articleBody?.h3_third_content || '').trim(),
    },
  ].filter((block) => block.title || block.content);

  const introduction = articleBody?.introduction ?? article?.introduction ?? '';
  const summary = articleBody?.summary ?? article?.summary ?? '';

  const hasStructuredArticle =
    !!article && !!(introduction || summary || h3Articles.length > 0);

  //[splitIntoParagraphs関数]
  //役割:長いテキストを段落ごとの配列に分割する関数
  //処理内容:
  //テキストを「2つ以上の連続する改行（\n{2,}）」で区切って分割。
  //前後の空白を取り除き、空の行を除外して配列として返す。
  const splitIntoParagraphs = (text) =>
    String(text ?? '')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

  //[normalizeMarkdown関数]
  //役割:テキストからMarkdown特有の記号を取り除く関数
  //処理内容:
  //段落の先頭にある箇条書き記号（*や-）や
  //番号付きリスト（1.など）を正規表現で削除し、
  //プレーンなテキストに整形
  const normalizeMarkdown = (paragraph) =>
    paragraph.replace(/^\s*([*-]|\d+\.)\s*/g, '');

  //[renderParagraphs関数]
  //役割:テキストを画面表示用のHTML（JSX）に変換する関数
  //処理内容:
  //splitIntoParagraphsを使ってテキストを分割し、
  //normalizeMarkdownで整形した後、
  //それぞれの段落を<p>タグで囲んで配列として返す。
  const renderParagraphs = (text, keyPrefix) =>
    splitIntoParagraphs(text || '').map((paragraph, index) => (
      <p key={`${keyPrefix}-${index}`}>{normalizeMarkdown(paragraph)}</p>
    ));
  

  /*-----------記事画面フロント部分(client画面表示処理)------------*/
  return (
    <>
      <header>
        <h1>AI記事生成アプリ</h1>
        <p>キーワードと競合記事URLを入力して、記事の叩き台を作成します。</p>
      </header>
      <section className="panel">
        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            {/*キーワード入力欄:*/}
            <span>キーワード *</span>
            <input
              type="text"
              value={keyword}
              placeholder="例: AI ライティング"
              /*必須項目（required）のテキスト入力*/
              required
              /*keywordという変数（ステート）が更新*/
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>

          <label className="field">
            <span>タイトル（任意）</span>
            <input
              type="text"
              value={title}
              placeholder="例: AIによる記事コンテンツ作成"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="field">
            <span>H2:見出し１（任意）</span>
            <input
              type="text"
              value={heading_h2_first}
              placeholder="例: AIで記事を作成してみよう"
              onChange={(event) => setHeading_h2_first(event.target.value)}
            />
          </label>

          <label className="field">
            <span>H3:見出し１（任意）</span>
            <input
              type="text"
              value={heading_h3_first}
              placeholder="例: AIで記事を作成してみよう"
              onChange={(event) => setHeading_h3_first(event.target.value)}
            />
          </label>

          <label className="field">
            <span>H3:見出し2（任意）</span>
            <input
              type="text"
              value={heading_h3_second}
              placeholder="例: AIで記事を作成してみよう"
              onChange={(event) => setHeading_h3_second(event.target.value)}
            />
          </label>

          <label className="field">
            <span>H3:見出し3（任意）</span>
            <input
              type="text"
              value={heading_h3_third}
              placeholder="例: AIで記事を作成してみよう"
              onChange={(event) => setHeading_h3_third(event.target.value)}
            />
          </label>
          {competitorUrls.map((value, index) => (
            <label className="field" key={`competitor-${index}`}>
              <span>{`競合記事URL ${index + 1}`}</span>
              <input
                type="url"
                value={value}
                placeholder="https://example.com/article"
                /*それぞれの入力欄が変更されると、handleUrlChange関数が呼ばれてURLが保存*/
                onChange={(event) => handleUrlChange(index, event.target.value)}
              />
            </label>
          ))}

          <div className="actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? '生成中...' : '記事を生成'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleReset}
              disabled={isLoading}
            >
              リセット
            </button>
          </div>
        </form>
        {error && <p className="error">{error}</p>}
      </section>      
      {article && (
        <section className="panel">
          <h2>記事生成結果</h2>
          <div className="result-actions">
            <button
              type="button"
              className="secondary"
              onClick={handleClearOutput}
            >
              クリア
            </button>
          </div>

          {article.warnings?.length > 0 && (
            <div className="warning">
              <strong>一部のURLでスクレイピングに失敗しました。</strong>
              <p>
                以下のURLは取得できませんでした。アクセス制限やボット対策が原因の可能性があります。
              </p>
              <ul>
                {article.warnings.map((warning, index) => (
                  <li key={`${warning.url}-${index}`}>
                    <span>{warning.url}</span>
                    {warning.message && (
                      <span className="warning-detail">（{warning.message}）</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasStructuredArticle && (
            <div className="generated-article">
              {introduction && (
                <div className="generated-block">
                  <h3>導入文</h3>
                  <div className="generated-text">
                    {renderParagraphs(introduction, 'intro')}
                  </div>
                </div>
              )}

              {h3Articles.map((block, idx) => (
                <div key={`h3-article-${idx}`} className="generated-block section-block">
                  {block.title && <h4>{block.title}</h4>}
                  {block.content && (
                    <div className="generated-text">
                      {renderParagraphs(block.content, `h3-${idx}`)}
                    </div>
                  )}
                </div>
              ))}

              {summary && (
                <div className="generated-block">
                  <h3>まとめ</h3>
                  <div className="generated-text">
                    {renderParagraphs(summary, 'summary')}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}