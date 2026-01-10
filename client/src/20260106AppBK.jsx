import { useEffect, useState } from 'react';
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

export default function App() {
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
  const initialHeadings = ['', '', ''];
  const [competitorUrls, setCompetitorUrls] = useState(initialUrls);
  const [article, setArticle] = useState(null);
  //const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
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
      const response = await fetch(`/api/searchPIXTAimage?keyword=${encodeURIComponent(keyword)}`);

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

    //記事生成AIへPOST処理
    //4. /api/generate というAPIエンドポイントに対して、そのデータをPOST送信。
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '記事の生成に失敗しました。');
      }
      //5.成功時: 返ってきた記事データをsetArticleで保存し、画面に表示。
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
    //7.最後にローディング状態をOFFに戻す。
      //setIsLoading(false);
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

  const outlineData = article?.article;
  //記事のアウトライン（目次のような構成案）データをarticleから取り出す。
  //後でrenderOutline()関数に渡して表示するために使われる。
  
  const structuredArticle = article?.article;
  //記事の本文データ（セクションごとの構成など）が入っているarticle.articleオブジェクトを取り出す。
  
  const hasStructuredArticle =
    structuredArticle &&
    ((Array.isArray(structuredArticle.sections) &&
      structuredArticle.sections.length > 0) ||
      !!structuredArticle.introduction); // ← 変更1：導入文があればOKとする条件を追加
  //構造化された記事本文（structuredArticle）が存在し、
  //かつセクション（sections）が含まれているかを判定。
  //これがtrueなら、導入文・本文・まとめといった「完成形の記事」として表示するモードになる。

  const displayTitle = structuredArticle?.h1 || article?.title || '';
  //画面に表示する「タイトル」を決定する。
  //優先順位：structuredArticle.h1（生成されたH1） > article.title（元データのタイトル） > ''（空文字）
  //どちらかのデータがあればそれをタイトルとして使う。

  const introduction = structuredArticle?.introduction;
  //記事の「導入文」をstructuredArticleから取り出す

  const summary = structuredArticle?.summary;
  //記事の「まとめ」部分をstructuredArticleから取り出す

  //[splitIntoParagraphs関数]
  //役割:長いテキストを段落ごとの配列に分割する関数
  //処理内容:
  //テキストを「2つ以上の連続する改行（\n{2,}）」で区切って分割。
  //前後の空白を取り除き、空の行を除外して配列として返す。
  const splitIntoParagraphs = (text) =>
    text
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
  

  //[renderOutline関数]
  //役割:記事のアウトライン（目次構成）を表示する関数
  //処理内容:
  //生成された記事データにアウトライン情報（outlineData）が含まれているか確認。
  //データがある場合、大見出し（h2）と小見出し（h3）の階層構造を持つリスト（<ul>, <li>）として整形し、画面に表示。
  const renderOutline = () => {
    /*データのチェック:*/
    /*アウトラインのデータ（outlineData）や、その中のセクション情報（sections）が正しく存在するか確認*/
    if (!outlineData || !Array.isArray(outlineData.sections)) return null;

    return (
    /*データがある場合*/
    /*「記事がどのような章立て（H2）と小見出し（H3）で構成されているか」を、入れ子状のリスト形式でユーザーに見せる役割*/
      <div className="generated-block">
        <h3>アウトライン</h3>
        <div className="outline">
          {/*階層構造の描画:*/}
          <ul>
            {/*<ul>（箇条書きリスト）を使って記事の構造を表示*/}
            {outlineData.sections.map((section, index) => (
              <li key={`outline-h2-${index}`}>
                <strong>{section?.h2}</strong>
                {/*大見出し(H2):sections配列をループし、各セクションのタイトル（h2）を太字で表示*/}
                {Array.isArray(section?.subsections) && (
                  <ul>
                    {section.subsections.map((sub, subIndex) => (
                      <li key={`outline-h3-${index}-${subIndex}`}>{sub}</li>
                      /*小見出し(H3):各セクションの中にsubsections（小見出しの配列）がある場合、さらに内側にリスト（<ul>）を作り、小見出しを表示*/
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  };

  {/*-----------記事画面フロント部分(client画面表示処理)------------*/}
  return (
    <div className="app">
      {/*isLoading && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-message">{`考え中${'.'.repeat(
            loadingDots + 1
          )}`}</div>
        </div>
      )*/}
      {/*　ヘッダー*/}
      <header>
        <h1>AI記事生成アプリ</h1>
        <p>キーワードと競合記事URLを入力して、記事の叩き台を作成します。</p>
      </header>

      {/*入力フォームエリア*/}
      <section className="panel">
        {/*送信ボタンを押すとhandleSubmit関数が実行*/}
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
          {/*タイトル入力欄:*/}
            <span>タイトル *</span>
            <input
              type="text"
              value={title}
              placeholder="例: AIによる記事コンテンツ作成"
              /*必須項目（required）のテキスト入力*/
              required
              /*titleという変数（ステート）が更新*/
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="field">
          {/*H2:見出し１入力欄:*/}
            <span>H2:見出し１ *</span>
            <input
              type="text"
              value={heading_h2}
              placeholder="例: AIで記事を作成してみよう"
              /*必須項目（required）のテキスト入力*/
              required
              /*heading_h2という変数（ステート）が更新*/
              onChange={(event) => setHeading_h2(event.target.value)}
            />
          </label>

          <label className="field">
          {/*H3:見出し１入力欄:*/}
            <span>H3:見出し１ *</span>
            <input
              type="text"
              value={heading_h2}
              placeholder="例: AIで記事を作成してみよう"
              /*必須項目（required）のテキスト入力*/
              required
              /*heading_h2という変数（ステート）が更新*/
              onChange={(event) => setHeading_h2(event.target.value)}
            />
          </label>

          <label className="field">
          {/*H3:見出し2入力欄:*/}
            <span>H3:見出し2 *</span>
            <input
              type="text"
              value={heading_h2}
              placeholder="例: AIで記事を作成してみよう"
              /*必須項目（required）のテキスト入力*/
              required
              /*heading_h2という変数（ステート）が更新*/
              onChange={(event) => setHeading_h2(event.target.value)}
            />
          </label>

          <label className="field">
          {/*H3:見出し3入力欄:*/}
            <span>H3:見出し3 *</span>
            <input
              type="text"
              value={heading_h2}
              placeholder="例: AIで記事を作成してみよう"
              /*必須項目（required）のテキスト入力*/
              required
              /*heading_h2という変数（ステート）が更新*/
              onChange={(event) => setHeading_h2(event.target.value)}
            />
          </label>

          {/*<div className="pixta-search-section">
            <button
              type="button"
              onClick={handlePixtaSearch}
              disabled={pixtaLoading || !keyword}
              className="pixta-search-button"
            >
              {pixtaLoading ? '検索中...' : '🖼️ PIXTA画像を検索'}
            </button>
          </div>

          <label className="field checkbox-field">
            <input
              type="checkbox"
              checked={searchPIXTA}
              onChange={(event) => setSearchPIXTA(event.target.checked)}
            />
            <span>PIXTA画像も検索する（記事生成時）</span>
          </label>*/}
          {/*競合記事URL入力欄*/}
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
            {/*ォームの送信処理（記事生成APIへのリクエスト）を実行*/}
            <button type="submit" /*disabled={isLoading}*/>
              {/*isLoading ? '生成中...' : */'記事を生成'}
            </button>
            {/*「リセット」ボタン:handleReset関数を呼び出し、入力内容や表示結果を初期状態に戻し。*/}
            <button
              type="button"
              className="secondary"
              onClick={handleReset}
              /*disabled={isLoading}*/
            >
              リセット
            </button>
          </div>
        </form>
        {/*エラー表示 ({error && ...})*/}
        {error && <p className="error">{error}</p>}
      </section>

      {/*{pixtaError && (
        <section className="panel">
          <p className="error">{pixtaError}</p>
        </section>
      )}

      {pixtaResults && (
        <section className="panel">
          <h2>PIXTA検索結果</h2>
          <div className="generated-block pixta-results-highlight">
            <h3>🖼️ PIXTA検索結果</h3>
            <p className="note">検索結果: {pixtaResults.PIXTAimages?.length || 0}件</p>

            <div className="pixta-actions">
              {pixtaResults.PIXTAimages && pixtaResults.PIXTAimages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setModalTab('images');
                    setShowImageModal(true);
                  }}
                  className="pixta-button-primary"
                >
                  📸 画像一覧を表示 ({pixtaResults.PIXTAimages.length}件)
                </button>
              )}

              {pixtaResults.screenshot && (
                <button
                  type="button"
                  onClick={() => {
                    setModalTab('screenshot');
                    setShowImageModal(true);
                  }}
                  className="secondary"
                >
                  🔍 スクリーンショットを見る
                </button>
              )}
            </div>
          </div>
        </section>
      )}
      */}
      {/*-----------記事画面フロント部分------------*/}

      {/*-------------生成記事表示箇所(serverからの戻り後処理)------------*/}
      {/*AIによって生成された記事データを画面に表示するためのUI部分*/}
      {/*articleというデータが存在する場合にのみ表示されるセクション（<section>）の中身を定義*/}
      {article && (
        <section className="panel">
          <h2>記事生成結果</h2>
          <div className="result-actions">
            <button
              type="button"
              className="secondary"
              onClick={handleClearOutput}
              /*disabled={isLoading}*/
            >
              クリア
            </button>
            {/*クリアボタン:「クリア」ボタンを配置。クリックするとhandleClearOutput関数が実行され、表示結果をリセット（消去）*/}
          </div>

          {/*エラー・警告の表示*/}
          {/*スクレイピング失敗の通知:
            もし article.warnings（警告リスト）にデータが含まれていれば、
            警告エリアを表示。
            「一部のURLでスクレイピングに失敗しました」というメッセージと共に、取得できなかったURLとエラー詳細をリスト表示。*/}
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

          {/*アウトラインの表示*/}
          {renderOutline()}
          {/*{renderOutline()} を呼び出して、記事の構成案（目次のような階層構造）を表示*/}

          {hasStructuredArticle ? (
          /*パターンA：構成が整った記事がある場合 (hasStructuredArticle)*/
          /*導入・本文・まとめが揃っている場合に表示*/
            <div className="generated-article">
              {displayTitle && (
              /*タイトル: 記事タイトルを表示*/
                <div className="generated-block">
                  <h3>タイトル</h3>
                  <p className="generated-title">{displayTitle}</p>
                </div>
              )}

              {introduction && (
              /*導入文:introductionがあれば、renderParagraphs関数を使って段落ごとに整形して表示*/
                <div className="generated-block">
                  <h3>導入文</h3>
                  <div className="generated-text">
                    {renderParagraphs(introduction, 'intro')}
                  </div>
                </div>
              )}

              {structuredArticle.sections?.map((section, index) => ( //変更２：?.をつけることで、sectionsがundefinedの場合は何もしない（エラーにならない）ようになる
              /*本文セクション:sections配列をループし、章ごとに表示*/
                <div className="generated-block section-block" key={`section-${index}`}>
                  <h3>{section?.h2}</h3>
                  {/*大見出し (H2) とその本文*/}
                  <div className="generated-text">
                    {renderParagraphs(section?.content || '', `section-${index}`)}
                  </div>
                  {Array.isArray(section?.subsections) &&
                    section.subsections.map((sub, subIndex) => (
                      <div className="generated-subsection" key={`sub-${index}-${subIndex}`}>
                        <h4>{sub?.h3}</h4>
                        {/*小見出し(H3)がある場合は、さらにその下に小見出しと本文を表示。*/}
                        <div className="generated-text">
                          {renderParagraphs(sub?.content || '', `sub-${index}-${subIndex}`)}
                        </div>
                      </div>
                    ))}
                </div>
              ))}

              {summary && (
                /*まとめ: summary があれば、最後に表示*/
                <div className="generated-block">
                  <h3>まとめ</h3>
                  <div className="generated-text">
                    {renderParagraphs(summary, 'summary')}
                  </div>
                </div>
              )}
            </div>
          ) : hasStructuredHeadings ? (
          /*パターンB：見出しリストのみの場合 (hasStructuredHeadings)*/
          /*本文がなく、見出しのリストだけがある場合の簡易表示モード*/
            <article className="article">
              <h3>{displayTitle}</h3>
              <div className="article-content">
                {article.headings?.map((heading, index) => (
                /*article.headings 配列をループし、見出しレベル（H2かそれ以外か）に応じてタグを使い分けてリスト表示*/
                  <div className={`section ${heading.level}`} key={`${heading.text}-${index}`}>
                    {heading.level === 'h2' ? (
                      <h4>{heading.text}</h4>
                    ) : (
                      <h5>{heading.text}</h5>
                    )}
                    {heading.body && <p>{heading.body}</p>}
                  </div>
                ))}
              </div>
            </article>
          ) : displayTitle ? (
            /*パターンC：それ以外*/
            /*タイトルだけがある場合はタイトルのみ表示。*/
            <div className="generated-block">
              <h3>タイトル</h3>
              <p className="generated-title">{displayTitle}</p>
            </div>
          ) : (
            /*タイトルすらない場合は「記事タイトルを取得できませんでした。」というメッセージを表示*/
            <p className="note">記事タイトルを取得できませんでした。</p>
          )}
        </section>
      )}
      {/*-------------生成記事表示箇所------------*/}

      {/*{showImageModal && pixtaResults && (
        <div className="modal-overlay" onClick={() => setShowImageModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>PIXTA検索結果</h3>
              <button
                className="modal-close"
                onClick={() => setShowImageModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-tabs">
              <button
                className={`modal-tab ${modalTab === 'images' ? 'active' : ''}`}
                onClick={() => setModalTab('images')}
              >
                📸 画像一覧 ({pixtaResults.PIXTAimages?.length || 0})
              </button>
              {pixtaResults.screenshot && (
                <button
                  className={`modal-tab ${modalTab === 'screenshot' ? 'active' : ''}`}
                  onClick={() => setModalTab('screenshot')}
                >
                  🔍 スクリーンショット
                </button>
              )}
            </div>

            <div className="modal-body">
              {modalTab === 'images' ? (
                <div className="image-grid">
                  {pixtaResults.PIXTAimages.map((image, index) => (
                    <div key={`${image.materialNo}-${index}`} className="image-card">
                      <img
                        src={image.srcUrl}
                        alt={`素材番号: ${image.materialNo}`}
                        loading="lazy"
                      />
                      <div className="image-info">
                        <p><strong>素材番号:</strong> {image.materialNo}</p>
                        <a
                          href={`https://pixta.jp/photo/${image.materialNo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          PIXTAで見る
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="screenshot-viewer">
                  <img
                    src={`/${pixtaResults.screenshot}`}
                    alt="PIXTA検索結果のスクリーンショット"
                    style={{ width: '100%', display: 'block' }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}*/}
    </div>
  );
}
