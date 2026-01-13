/*
app.js バックエンド処理
[Express＋スクレイピング＋生成AIを組み合わせた構成]
①認証付きでAPIを提供
②競合記事をスクレイピング
③競合分析 → 記事構成を生成（Gemini）
④構成を元に本文を生成（Gemini）
⑤PIXTAから画像情報を取得
⑥Reactのビルド成果物を配信


このアプリ良い点：
アウトライン → 本文の2段階AI生成
Playwright + HTTPの二重スクレイピング
JSON厳格指定

gemini API無料枠制限：
1.リクエスト回数・速度の制限
  15RPM (Requests Per Minute)
  1分間に15回までしかリクエストできない。
  これを超えると429Too Many Requestsエラーが返る。
  短時間に連続してテストを行うと、すぐにこの上限に達する。
  1,500 RPD (Requests Per Day)
  1日に1,500回までリクエスト可能。
2. トークン量の制限
  1,000,000 TPM (Tokens Per Minute)
  1分間に処理できるトークン（文字数換算で約50万〜100万文字程度）の上限です。
*/

/*---①サーバーの基本設定と認証---*/
const express = require('express'); //Webサーバー
//expressというライブラリを使い、フロントエンド（ユーザーが操作する画面）からのリクエストを受け付ける。
const dotenv = require('dotenv'); //環境変数を読み込む
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright'); //ブラウザを自動操作してスクレイピング
const cheerio = require('cheerio'); //HTMLをパース(jQuery的)
const iconv = require('iconv-lite'); //文字コード変換(Shift_JIS対策)
//const basicAuth = require('express-basic-auth'); //ベーシック認証

// Load .env file from the server directory
//.envの読み込み　本番運用では必須のセキュリティ対策
dotenv.config({ path: path.join(__dirname, '.env') });

//----------------------------------Express基本設定------------------------------------
/*
このブロックは、「Expressでサーバーの土台を作り、待ち受けるポート番号を決め、フロントエンドからのJSONデータを正しく受け取れるように準備する」という、
サーバー起動に必須の初期設定を行っている部分
*/
//Webサーバー本体となり、これに対して「このURLにアクセスが来たらこう動いて」といった様々な命令を追加していくことになる。
const app = express(); 
//サーバーがどの「窓口」でリクエストを待ち受けるかを決めています。この窓口をポート番号と呼びます。
const PORT = process.env.PORT || 3001;
//ミドルウェアと呼ばれる「中間処理」を設定
/*
フロントエンド（ブラウザ）から送られてくるデータがJSON形式だった場合に、それを正しく解釈してプログラムで扱える形に変換してくれる機能です。
このアプリケーションでは、フロントエンドのReactから「キーワード」や「URL」がJSON形式で送られてくるため、この設定が不可欠です。これがないと、サーバーは送られてきたJSONデータを正しく受け取ることができません。
*/
app.use(express.json());
//----------------------------------Express基本設定------------------------------------

//----------------------------------フロント基本設定------------------------------------
//フロントエンドのファイルが格納されているpublicフォルダへの絶対パスを作成
const clientDistPath = path.join(__dirname, 'public');
//publicフォルダの中にある、Webページの本体であるindex.htmlファイルへの絶対パスを作成
const clientIndexPath = path.join(clientDistPath, 'index.html');

//---ベーシック認証---
/*const basicAuthUser = process.env.BASIC_AUTH_USER || 'admin';
const basicAuthPass = process.env.BASIC_AUTH_PASSWORD || 'password';

const basicAuthMiddleware = basicAuth({
  users: {
    [basicAuthUser]: basicAuthPass
  },
  challenge: true,
  realm: 'ArticlrApp',
  unauthorizedResponse: () => {
    return { error: '認証が必要です。' };
  }
});
app.use(basicAuthMiddleware);*/
//---ベーシック認証---

//---React(フロントエンド)の配信---
//WebサーバーはReactで作られたWebサイトをブラウザに表示できるようになる
if (fs.existsSync(clientDistPath)) {
//fs.existsSync(): Node.jsのファイルシステムモジュール(fs)の関数で、指定されたパスにファイルまたはディレクトリが存在するかどうかをチェック
//Reactのビルドファイルがあるかどうかを確認
  console.log('📦 Serving static assets from:', clientDistPath);
//もしあれば、それらのファイルをWebサーバーからアクセスできるように設定
  app.use(express.static(clientDistPath));
/*非常に重要な処理。express.static()は、指定されたディレクトリ（ここではpublicディレクトリ）にあるファイルを、Webサーバーから直接アクセスできるようにするExpressの機能（ミドルウェア）。
これにより、ブラウザから「/index.html」や「/css/style.css」のようなURLでアクセスすると、publicディレクトリの中にある対応するファイルが自動的に送信され、Webページが表示されるようになる*/
} else {
//もしなければ、エラーメッセージを表示
  console.log('⚠️ React build not found at:', clientDistPath);
}
//----------------------------------フロント基本設定------------------------------------


//----------------------------------gemini　AI設定------------------------------------
/*
「AIモデルのインスタンスを効率的に取得すること」
AIモデルの初期化（準備）は少し時間がかかる処理なので、APIリクエストのたびに毎回準備していると、アプリケーションの応答が遅くなってしまう。
それを防ぐために、この関数は「一度だけ準備して、あとはそれを使い回す」という賢い仕組み（シングルトンパターンや遅延初期化と呼ばれる手法）を採用
*/
let geminiModel;
//geminiModelという変数は、AIモデルの本体を格納するためのもの
async function getGeminiModel() {
  if (!geminiModel) {
    //「まだgeminiModelが空っぽ（未準備）ですか？」とチェック
    //最初の呼び出し時: geminiModelは空なので、if文の中の処理が実行
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    console.log('⚙️ Initializing Gemini model: gemini-2.5-flash');
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    //gemini-2.0-flashモデルを使用 高速・低コスト向けのモデル
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }
  /*2回目以降の呼び出し時: geminiModelには既に準備済みのモデルが入っているので、if文の中はスキップされ、すぐに最後のreturnに進む。*/
  return geminiModel;
}
//----------------------------------gemini　AI設定------------------------------------

//----------------------------------スクレイピング２設定------------------------------------
/*
Playwrightでのスクレイピングが失敗した際の代替手段として
使われる scrapeWithHttpClient 関数から呼び出されている。
*/
/*
クライアントを取得するための関数。
asyncキーワードが付いているのは、内部で await を使って非同期処理（ライブラリの読み込み）を待つ必要があるため
*/
let gotScrapingClient;
async function getGotScraping() {
  if (!gotScrapingClient) {
    //初回呼び出し時: 
    /*import()を使って、got-scrapingライブラリを動的に読み込む。
    ライブラリの読み込みは非同期で行われるため、await で処理が終わるのを待つ。
    */
    const mod = await import('got-scraping');
    /*読み込みが完了したモジュール(mod)から、
    実際に使用するクライアント (mod.gotScraping) を取り出し、
    最初に宣言した gotScrapingClient 変数に格納。
    これにより、クライアントがアプリケーション内で共有されるようになる*/
    gotScrapingClient = mod.gotScraping;
  }
  //2回目以降の呼び出し時
  /*準備ができたクライアントを返す。
  2回目以降の呼び出しでは、if 文がスキップされ、すぐにこの行に到達して既存のクライアントが返される*/
  return gotScrapingClient;
}
//----------------------------------スクレイピング２設定------------------------------------

//------------------------------スクレイピングしたデータの補正--------------------------------
/*
この関数は、HTTPリクエストで取得した生のデータ（buffer）を、
正しい文字コードで文字列に変換（デコード）するためのもの。
特に、日本語の古いウェブサイトで使われがちなShift_JISなど、UTF-8以外の文字コードに対応するために重要な役割
*/
/*
HTTPレスポンスのバッファとヘッダーから文字コードを判別し、HTMLをデコードする関数
{Buffer} buffer - HTTPレスポンスのボディ部分のバッファ
{object} headers - HTTPレスポンスヘッダー
{string} デコードされたHTML文字列
 */
function decodeHtml(buffer, headers) {
  //1.デフォルトの文字コードを'utf-8'に設定
  const defaultEncoding = 'utf-8';
  let encoding; //検出された文字コードを格納する変数
  //2.【優先度1】HTTPヘッダーから文字コードを特定
  //ヘッダーのキーはケースセンシティブでないため、両方のパターンをチェック
  const contentType = headers['content-type'] || headers['Content-Type'];
  if (contentType) {
    // 'charset=...' の部分を正規表現で探し、文字コード名を取得
    const match = contentType.match(/charset=([^;]+)/i);
    if (match) encoding = match[1].trim().toLowerCase();
  }

  //3.【優先度2】ヘッダーに情報がなければ、HTMLの<meta>タグから特定
  if (!encoding) {
    //HTMLの先頭部分（<head>タグがある可能性が高い）だけを読み込む
    const headChunk = buffer.toString(
      'ascii',
      0,
      Math.min(buffer.length, 2048)//バッファの先頭、最大2048バイト
    );

    //HTML5形式の<meta charset="...">を探す
    const metaCharset = headChunk.match(
      /<meta\s+[^>]*charset=["']?([a-zA-Z0-9\-_]+)/i
    );
    if (metaCharset) {
      encoding = metaCharset[1].toLowerCase();
    } else {
      //古い形式の<meta http-equiv="..." content="...; charset=...">を探す
      const metaContent = headChunk.match(
        /<meta\s+[^>]*content=["'][^"']*charset=([^"';\s]+)/i
      );
      if (metaContent) {
        encoding = metaContent[1].toLowerCase();
      }
    }
  }

  //4.文字コードのエイリアス（別名）を統一
  //'sjis'や'shift-jis'などを、ライブラリが認識できる'shift_jis'に正規化
  const encodingMap = {
    sjis: 'shift_jis',
    'shift-jis': 'shift_jis',
    shift_jis: 'shift_jis',
    'windows-31j': 'shift_jis',
    'euc-jp': 'euc-jp',
  };

  //5.最終的な文字コードを決定し、デコード
  //もし文字コードが特定できなかったり、ライブラリが対応していない場合は、デフォルトの'utf-8'を使用
  if (encoding && encodingMap[encoding]) {
    encoding = encodingMap[encoding];
  }

  if (!encoding || !iconv.encodingExists(encoding)) {
    encoding = defaultEncoding;
  }

  console.log('🧩 [Fallback] Detected encoding:', encoding);
  //iconv-liteライブラリを使って、特定した文字コードでバッファを文字列に変換
  return iconv.decode(buffer, encoding);
}
//------------------------------スクレイピングしたデータの補正--------------------------------

//------------------------------⑵got-scrapingスクレイピング---------------------------------
/*
Playwright（本命）
失敗したら HTTPクライアント（保険） got-scraping
*/

/*フォールバック（HTTP直取得）*/
/*この関数は、scrapeWithHttpClientという、
got-scrapingライブラリを使ったフォールバック用の
スクレイピング処理の中で使われている。
Playwrightのようなブラウザベースのスクレイピングが
失敗した際の「保険」として、HTTPリクエストで
直接取得したHTMLを正しく解釈するために不可欠な機能*/
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
//------------------------------⑵got-scrapingスクレイピング---------------------------------

//-------------------------------⑴Playwrightスクレイピング----------------------------------
/*Playwrightスクレイピング*/
/*この関数は、指定されたウェブサイト（URL）から
本文テキストを抽出（スクレイピング）するためのもの。
この関数の最大の特徴は、2段階の堅牢な方法でコンテンツ取得を試みること

本命（Playwright）: まず、人間がブラウザで見るのと同じようにページを完全に表示させてからテキストを抜き出す、高機能な方法を試す。
保険（HTTPクライアント）: もし本命の方法が失敗したら、サイトの裏側（HTMLソースコード）に直接アクセスしてテキストを抜き出す、シンプルな方法に切り替える。
これにより、現代的なウェブサイト（JavaScriptを多用するサイト）と、単純な構造のサイトの両方に対応しつつ、エラーが発生しても簡単には諦めない、安定した作りになっている。
効率と確実性の両立: 
PlaywrightはJavaScriptで動的に生成されるコンテンツも取得できるため
確実性が高いですが、リソースを多く消費。もしそれで失敗した場合は、
より軽量なHTTPクライアントに切り替えることで、バランスを取っている。

scrape関数は、記事生成API（/api/generate）の中核的なデータ収集部分を担っている。
*/
async function scrape(url) {
  console.log('📥 [Playwright] Start scrape:', url);
  //chromium（Chromeのオープンソース版）をヘッドレスモード（画面表示なし）で起動
  const browser = await chromium.launch({ headless: true });
  let page; //ページ（タブ）を操作するための変数を準備
  try {
    // --- ここから本命のPlaywrightによる処理 ---
    page = await browser.newPage();//新しいタブを開く
    console.log('🌐 Navigating to:', url);

    //2.ページへのアクセスと待機
    //指定されたURLに移動し、ページの読み込みが落ち着くまで待つ（最大30秒）
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('⏳ Waiting for body content');
    //念のため、bodyタグが表示されるまで待つ（最大10秒）
    await page.waitForSelector('body', { timeout: 10000 });
    
    //3.テキストの抽出
    //ページ内のbodyタグ全体の表示テキスト（innerText）を取得
    const text = await page.$eval('body', (el) => el.innerText || '');
    
    //4.テキストの整形
    //連続する空白や改行を一つのスペースにまとめ、前後の余白を削除
    /*データ整形: 抽出したテキストから不要な空白や改行を
    削除する処理（replace(/\s+/g, ' ').trim()）が含まれており、
    後続のAI処理がしやすいように、綺麗なテキストデータに整形している。*/
    const normalized = text.replace(/\s+/g, ' ').trim();
    console.log(`📝 Scraped ${normalized.length} characters from`, url);
    
    //5.成功：結果を返す
    //抽出したテキストの先頭8000文字を返す（AIへの入力文字数制限のため）
    return normalized.slice(0, 8000);
  } catch (err) {
    // --- Playwrightが失敗した場合の保険処理 ---
    console.error('❌ Playwright scraping failed', url, err.message);
    console.log('🔁 Attempting HTTP fallback for', url);
    try {
      //別の関数 `scrapeWithHttpClient` を呼び出して再挑戦
      const fallbackText = await scrapeWithHttpClient(url);
      console.log('✅ Fallback succeeded for', url);
      //こちらも同様に先頭8000文字を返す
      return fallbackText.slice(0, 8000);
    } catch (fallbackErr) {
      //保険の手段も失敗した場合
      console.error(
        '💥 Fallback scraping also failed',
        url,
        fallbackErr.message
      );
      //最終的にエラーを投げて、処理を中断させる
      throw fallbackErr;
    }
  } finally {
    //--- 後片付け ---
    //処理が成功しても失敗しても、必ず実行される
    if (page) {
      await page.close().catch(() => {});//開いたタブを閉じる
    }
    await browser.close().catch(() => {});//ブラウザを閉じる
    console.log('🧹 Closed browser instance for', url);
  }
}
//-------------------------------⑴Playwrightスクレイピング----------------------------------


//-------------------------------トップページへのアクセス時の処理----------------------------------
/*このコードは「サイトのトップページにアクセスが来たら、準備済みのReactアプリをユーザーに渡す。
もし準備できていなければ、開発者にエラーを教える」という、
Webサーバーの基本的ながら非常に重要な処理を行う*/

//サーバーのトップページ（'/'）にGETリクエストが来た時の処理を定義
app.get('/', (_req, res) => {
  //1.サーバーのコンソールにアクセスがあったことを記録
  console.log('📨 GET /');
  //2.Reactアプリのビルドファイル（index.html）が存在するかチェック
  //clientIndexPathは 'public/index.html' へのフルパスを指す変数
  if (fs.existsSync(clientIndexPath)) {
    //3.【ファイルが存在する場合】
    //Reactアプリの本体であるindex.htmlをブラウザに送信する
    console.log('➡️ Serving React index.html');
    return res.sendFile(clientIndexPath);
  }
  //4.【ファイルが存在しない場合】
  //開発者向けに、ビルドが必要であることを知らせるメッセージをブラウザに表示
  console.log('⚠️ React build not available, sending fallback message');
  res.send(
    'React build not found. Run "npm run build" in the client project to generate static assets.'
  );
});
//-------------------------------トップページへのアクセス時の処理----------------------------------

//この関数は、サーバーに溜まった古いスクリーンショットファイルを自動で掃除するためのもの
/*function cleanupOldScreenshots() {
  const publicDir = path.join(__dirname, 'public');
  const oneHourAgo = Date.now() - 60 * 60 * 1000; // 1 hour in milliseconds

  try {
    const files = fs.readdirSync(publicDir);
    let deletedCount = 0;

    files.forEach((file) => {
      if (file.startsWith('pixta_') && file.endsWith('.png')) {
        const filePath = path.join(publicDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtimeMs < oneHourAgo) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log('🗑️ Deleted old screenshot:', file);
        }
      }
    });

    if (deletedCount > 0) {
      console.log(`✅ Cleaned up ${deletedCount} old screenshot(s)`);
    }
  } catch (err) {
    console.error('⚠️ Screenshot cleanup failed:', err.message);
  }
}*/

/*---③PIXTA画像検索API---*/
/*app.get('/api/searchPIXTAimage', async (req, res) => {
  const { keyword } = req.query;

  console.log('🔍 GET /api/searchPIXTAimage called with keyword:', keyword);

  if (!keyword) {
    console.warn('⚠️ keyword is missing in query');
    return res.status(400).json({ error: 'キーワードを指定してください。' });
  }

  // Clean up old screenshots before creating a new one
  cleanupOldScreenshots();

  const searchUrl = `https://pixta.jp/tags/${encodeURIComponent(keyword)}`;
  console.log('🌐 Searching PIXTA:', searchUrl);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    console.log('📸 Navigating to PIXTA search results');
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // スクリーンショットを取得
    const screenshotPath = path.join(__dirname, 'public', `pixta_${keyword}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('📷 Screenshot saved:', screenshotPath);

    // 素材情報を取得
    console.log('🔍 Extracting image data from search results');
    const images = await page.$$eval('.item-list--large__wrap', (elements) => {
      return elements.map((el) => {
        // div要素のid属性から素材番号を取得
        const divWithId = el.querySelector('div[id]');
        const materialNo = divWithId ? divWithId.id : null;

        // img要素のdata-src属性またはsrc属性から画像URLを取得
        const img = el.querySelector('img.lozad');
        const srcUrl = img ? (img.getAttribute('data-src') || img.getAttribute('src')) : null;

        return materialNo && srcUrl ? { materialNo, srcUrl } : null;
      }).filter(item => item !== null);
    });

    console.log(`✅ Found ${images.length} images from PIXTA`);

    await page.close();

    res.json({
      PIXTAimages: images,
      screenshot: path.basename(screenshotPath)
    });
  } catch (err) {
    console.error('❌ PIXTA search failed:', err.message);
    res.status(500).json({
      error: 'PIXTA検索に失敗しました。',
      details: err.message
    });
  } finally {
    if (browser) {
      await browser.close();
      console.log('🧹 Closed browser instance');
    }
  }
});*/


//------------------⑴フロントからの受け取り→⑵スクレイピング処理→⑶データの編集→⑷AIへの記事構成案プロンプト→⑸AIへの記事本文プロンプト---------------------
//---④記事生成API（メイン機能）---
/*このコードは、このWebアプリケーションの**最も中心的な機能である「記事自動生成API」**を実装した部分。
フロントエンドから「キーワード」と「参考URL」を受け取り、最終的な記事を生成して返すまでの一連の複雑な処理を担う。

[処理は大きく分けて以下の4つのステップで構成]
①入力データの受け取りと検証: ユーザーからのリクエストが妥当かチェック。
②競合記事のスクレイピング: 参考URLのコンテンツを収集。
③記事構成案の生成（AI活用 第1段階）: 収集した情報を基に、AIが記事の骨子（アウトライン）を作成。
④記事本文の生成（AI活用 第2段階）: AIが作成した構成案に沿って、本格的な記事本文を執筆。
この2段階のAI生成プロセスが、出力される記事の品質と安定性を高めるための重要な工夫。*/

/*
GET: 「このページを見せてください」とお願いするだけ。ブラウザのアドレスバーにURLを入れてエンターキーを押すような、通常のページ閲覧がこれにあたる。
POST: 「このデータを渡すので、何か作業をしてください（例: 記事を作る、ユーザー登録をするなど）」と、データと一緒に処理をお願いするのがPOST。
*/

/*-----⑴フロントからの受け取り------*/
app.post('/api/generate', async (req, res) => {
  const requestStartedAt = Date.now();
  //ステップ1：依頼内容の確認（入力チェック）
  //フロントエンドから送られてきた「キーワード」と「参考URL」を受け取る
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

  console.log('🛎️ POST /api/generate called with:', {
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

/*---入力チェック---*/
  //キーワードが空っぽじゃないか？
  if (!keyword) {
    console.warn('⚠️ keyword is missing in request body');
    return res.status(400).json({ error: 'キーワードを入力してください。' });
  }

  //参考URLが1つも入力されていないんじゃないか？
  const candidateUrls = [
    ...urls,
    competitorUrl1,
    competitorUrl2,
    competitorUrl3,
  ]
    .map((u) => u?.trim()) //余分な空白を削除
    .filter(Boolean);      //空のURLを除外

  //未入力ありエラー処理
  if (candidateUrls.length === 0) {
    console.warn('⚠️ No URLs provided');
    return res
      .status(400)
      .json({ error: 'URLを少なくとも1つ入力してください。' });
  }

/*------⑵競合記事のスクレイピング------*/
/*入力された複数の競合URLを順番にスクレイピングし、記事のテキストデータを集める。*/
  const warnings = [];
  const scrapedArticles = [];

  //依頼されたURLを一つずつ順番に調べる
  for (const url of candidateUrls) {
    try {
      console.log('🔗 Scraping competitor article:', url);
      //scrape関数でWebサイトから本文を抜き出す
      const text = await scrape(url);
      scrapedArticles.push({ url, text });
    } catch (err) {
      console.error('❌ Failed to scrape', url, err.message);
      //失敗しても止めずに、警告リストに記録して次のURLへ
      warnings.push({ url, message: err.message });
    }
  }

  //もし、全部のサイトから情報が取れなかったら...
  if (scrapedArticles.length === 0) {
    console.error('🚨 Scraping failed for all URLs');
    return res.status(502).json({
      error: '競合記事の取得に失敗しました。',
      warnings,
    });
  }

  console.log('📚 Successfully scraped', scrapedArticles.length, 'sources');
  /*------⑵競合記事のスクレイピング------*/

  /*------⑶スクレイピングデータの整理------*/
  //AIが読みやすいように、集めた情報を一つのテキストにまとめる
  const competitorTexts = scrapedArticles //スクレイピングデータは、competitorTextsに入る
    .map(
      ({ url, text }) => `【Source】${url}
${text}`
    )
    .join('\n---\n');
  /*------⑶スクレイピングデータの整理------*/

/*---記事構成案(アウトライン)生成---*/
/*集めたテキストとキーワードを基に、**「あなたはSEOに強いライターです。これらの情報を参考に、
記事の構成案を考えてください」**という指示（プロンプト）を作成します。*/
/*
H2 * 3
各H2にH3*3
SEO重視
JSONで出力
*/

/*-----⑷AIへ導入文のプロンプト作成-------*/
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
//competitorTextsは、スクレイピングしたデータ

/*------------geminiにプロンプトを送信-----------------*/
  let introductionData;
  try {
    //Geminiモデルに構成案の生成を依頼
    console.log('🧠 Generating outline with Gemini');
    const model = await getGeminiModel();
    const introductionResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: introductionPrompt }] }],
    });
    //AIからの返事を整形して、プログラムで扱えるオブジェクト形式に変換
    const introductionRaw = introductionResult.response?.text?.() || '';
    const introductionJsonText = introductionRaw.replace(/```json|```/g, '').trim();
    introductionData = JSON.parse(introductionJsonText);
    console.log(
      '🧾 Outline generated. H2 count:',
      Array.isArray(introductionData.sections) ? introductionData.sections.length : 0
    );
  } catch (err) {
    //AIが構成案を作れなかったらエラー
    console.error('❌ Outline generation failed', err.message);
    return res.status(502).json({
      error: '記事構成の生成に失敗しました。',
      warnings,
    });
  }

  const introductionJSON = JSON.stringify(introductionData, null, 2);
  console.log("introductionJSON",introductionJSON);
  //------------------⑴フロントからの受け取り→⑵スクレイピング処理→⑶データの編集→⑷記事構成案処理→⑸記事本文---------------------

//---⑸ H3-1 用プロンプト---
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

// ログ（任意）
const heading_h3_firstJSON = JSON.stringify(heading_h3_firstData, null, 2);
console.log('heading_h3_firstJSON', heading_h3_firstJSON);

//---⑸ H3-2用プロンプト---
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
  console.log('🧠 Generating H3-1 body with Gemini');
  const model = await getGeminiModel();
  const heading_h3_secondResult = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: heading_h3_secondPrompt }] }],
  });

  const heading_h3_secondRaw = heading_h3_secondResult.response?.text?.() || '';
  const heading_h3_secondJsonText = heading_h3_secondRaw
    .replace(/```json|```/g, '')
    .trim();

  heading_h3_secondData = JSON.parse(heading_h3_secondJsonText);
  console.log('🧾 H3-1 generated:', heading_h3_secondData);
} catch (err) {
  console.error('❌ H3-1 generation failed', err.message);
  return res.status(502).json({
    error: 'H3-1本文の生成に失敗しました。',
    warnings,
  });
}

// ログ（任意）
const heading_h3_secondJSON = JSON.stringify(heading_h3_secondData, null, 2);
console.log('heading_h3_secondJSON', heading_h3_secondJSON);

//---⑸ H3-3用プロンプト---
const heading_h3_thirdPrompt = `
あなたはSEOに強い家電専門ライターです。
以下の競合記事を分析し、キーワード「${keyword}」、タイトル「${title}」、H2見出し「${heading_h2_first}」の子見出し「${heading_h3_third}}」の本文を200文字程度で作成してください。

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
  console.log('🧠 Generating H3-1 body with Gemini');
  const model = await getGeminiModel();
  const heading_h3_thirdResult = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: heading_h3_thirdPrompt }] }],
  });

  const heading_h3_thirdRaw = heading_h3_thirdResult.response?.text?.() || '';
  const heading_h3_thirdJsonText = heading_h3_thirdRaw
    .replace(/```json|```/g, '')
    .trim();

  heading_h3_thirdData = JSON.parse(heading_h3_thirdJsonText);
  console.log('🧾 H3-1 generated:', heading_h3_thirdData);
} catch (err) {
  console.error('❌ H3-1 generation failed', err.message);
  return res.status(502).json({
    error: 'H3-1本文の生成に失敗しました。',
    warnings,
  });
}

// ログ（任意）
const heading_h3_thirdJSON = JSON.stringify(heading_h3_thirdData, null, 2);
console.log('heading_h3_thirdJSON', heading_h3_thirdJSON);


/*---記事本文生成---*/
/*
上記の構成をもとに本文を生成
構成 → 本文 の2段階生成で品質を安定
JSONで出力
*/
  //AIへの「本文執筆」の依頼書（プロンプト）を作成
/*const articlePrompt = `
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
    //Geminiモデルに、構成案に基づいた本文の執筆を依頼
    console.log('✍️ Generating article body with Gemini');
    const model = await getGeminiModel();
    const articleResult = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: articlePrompt }] }],
    });
    //AIからの返事を整形して、最終的な記事データとして取得
    const articleRaw = articleResult.response?.text?.() || '';
    const articleJsonText = articleRaw.replace(/```json|```/g, '').trim();
    articleData = JSON.parse(articleJsonText);
    console.log(
      '📄 Article generated. Sections:',
      Array.isArray(articleData.sections) ? articleData.sections.length : 0
    );
  } catch (err) {
    //AIが本文を執筆できなかったらエラー
    console.error('❌ Article generation failed', err.message);
    return res.status(502).json({
      error: '記事本文の生成に失敗しました。',
      outline: outlineData,
      warnings,
    });
  }*/


  //-----------------AIが作成した記事を配列に整理する(headings配列作成)---------------------
  //ステップ5： クライアントへのレスポンス
  //抽出した見出し情報を配列にまとめる
  //フロントエンドで使いやすいように、見出し情報を別途まとめる
  /*const headings = [];
  //見出し情報をheadings配列に詰める処理
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
  }*/
  //-----------------AIが作成した記事を配列に整理する(headings配列作成)---------------------

  //処理にかかった時間を記録
  console.log(
    '✅ Completed /api/generate in',
    `${Date.now() - requestStartedAt}ms`
  );

  //-----------------AIが作成した記事を配列に整理した内容をJSONにして、フロントに送信---------------------
  //完成した記事データなどをJSON形式でクライアントに送信
  /*res.json()は、Express.jsの機能で、
  JavaScriptのオブジェクトをJSON（ジェイソン）というデータ形式に
  変換して、HTTPレスポンスとして送信。
  フロントエンドのReactアプリケーションは、
  このJSONデータを受け取って画面に表示*/
  //res.json({
    //記事のタイトル
    //title: articleData.h1 || '',
    //導入文
    //introduction: articleData.introduction || '',
    //まとめ文
    //summary: articleData.summary || '',
    //構成案（アウトライン）
    //outline: outlineData,
    /*記事全体のデータ
    タイトル、導入文、各見出しとそれに対応する本文、まとめ文などが
    階層構造で含まれている。
    フロントエンドは主にこのデータを使って記事全体を画面に描画*/
    //article: articleData,
    /*記事の中から見出し（H2, H3）だけを抜き出して整形した配列*/
    //headings,
    /*スクレイピング中に発生した警告メッセージのリスト*/
    //warnings,
  //});
  res.json({
    // 記事のタイトル
    title: introductionData.h1 || '',
    // 導入文
    introduction: introductionData.introduction || '',
    // フロント側で扱いやすいよう、article の中にまとめて入れる
    article: {
      h1: introductionData.h1 || '',
      introduction: introductionData.introduction || '',
      h2: heading_h2_first,
      h3_first: heading_h3_firstData?.h3 || heading_h3_first,
      h3_first_content: heading_h3_firstData?.content || '',
      h3_second: heading_h3_secondData?.h3 || heading_h3_second,
      h3_second_content: heading_h3_secondData?.content || '',
      h3_third: heading_h3_third?.h3 || heading_h3_third,
      h3_third_content: heading_h3_thirdData?.content || '',
    },

  });

});

app.listen(PORT, () =>
  console.log(`✅ Server ready on http://localhost:${PORT}`)
);
