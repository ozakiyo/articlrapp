import { useEffect, useState } from 'react';

const initialUrls = ['', '', ''];

export default function App() {
  const [keyword, setKeyword] = useState('');
  const [competitorUrls, setCompetitorUrls] = useState(initialUrls);
  const [article, setArticle] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingDots, setLoadingDots] = useState(0);
  const [searchPIXTA, setSearchPIXTA] = useState(false);
  const [pixtaResults, setPixtaResults] = useState(null);
  const [pixtaLoading, setPixtaLoading] = useState(false);
  const [pixtaError, setPixtaError] = useState('');
  const [showImageModal, setShowImageModal] = useState(false);
  const [modalTab, setModalTab] = useState('images'); // 'images' or 'screenshot'

  const handleUrlChange = (index, value) => {
    const next = [...competitorUrls];
    next[index] = value;
    setCompetitorUrls(next);
  };

  const handlePixtaSearch = async () => {
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
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    setError('');

    const payload = {
      keyword,
      competitorUrl1: competitorUrls[0],
      competitorUrl2: competitorUrls[1],
      competitorUrl3: competitorUrls[2],
    };

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

      const data = await response.json();
      setArticle(data);

      // 記事生成後、チェックボックスがONならPIXTA検索も実行
      if (searchPIXTA) {
        await handlePixtaSearch();
      }
    } catch (err) {
      setError(err.message);
      setArticle(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setKeyword('');
    setCompetitorUrls(initialUrls);
    setArticle(null);
    setError('');
    setPixtaResults(null);
    setPixtaError('');
    setSearchPIXTA(false);
  };

  const handleClearOutput = () => {
    setArticle(null);
    setError('');
    setPixtaResults(null);
    setPixtaError('');
  };

  useEffect(() => {
    if (!isLoading) {
      setLoadingDots(0);
      return;
    }

    const handle = setInterval(() => {
      setLoadingDots((prev) => (prev + 1) % 3);
    }, 400);

    return () => clearInterval(handle);
  }, [isLoading]);

  const hasStructuredHeadings =
    Array.isArray(article?.headings) && article.headings.length > 0;
  const outlineData = article?.outline;
  const structuredArticle = article?.article;
  const hasStructuredArticle =
    structuredArticle &&
    Array.isArray(structuredArticle.sections) &&
    structuredArticle.sections.length > 0;
  const displayTitle = structuredArticle?.h1 || article?.title || '';
  const introduction = structuredArticle?.introduction;
  const summary = structuredArticle?.summary;

  const splitIntoParagraphs = (text) =>
    text
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

  const normalizeMarkdown = (paragraph) =>
    paragraph.replace(/^\s*([*-]|\d+\.)\s*/g, '');

  const renderParagraphs = (text, keyPrefix) =>
    splitIntoParagraphs(text || '').map((paragraph, index) => (
      <p key={`${keyPrefix}-${index}`}>{normalizeMarkdown(paragraph)}</p>
    ));

  const renderOutline = () => {
    if (!outlineData || !Array.isArray(outlineData.sections)) return null;

    return (
      <div className="generated-block">
        <h3>アウトライン</h3>
        <div className="outline">
          <ul>
            {outlineData.sections.map((section, index) => (
              <li key={`outline-h2-${index}`}>
                <strong>{section?.h2}</strong>
                {Array.isArray(section?.subsections) && (
                  <ul>
                    {section.subsections.map((sub, subIndex) => (
                      <li key={`outline-h3-${index}-${subIndex}`}>{sub}</li>
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

  return (
    <div className="app">
      {isLoading && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-message">{`考え中${'.'.repeat(
            loadingDots + 1
          )}`}</div>
        </div>
      )}
      <header>
        <h1>AI記事生成アプリ</h1>
        <p>キーワードと競合記事URLを入力して、記事の叩き台を作成します。</p>
      </header>

      <section className="panel">
        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span>キーワード *</span>
            <input
              type="text"
              value={keyword}
              placeholder="例: AI ライティング"
              required
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>

          <div className="pixta-search-section">
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
          </label>

          {competitorUrls.map((value, index) => (
            <label className="field" key={`competitor-${index}`}>
              <span>{`競合記事URL ${index + 1}`}</span>
              <input
                type="url"
                value={value}
                placeholder="https://example.com/article"
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

      {pixtaError && (
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

      {article && (
        <section className="panel">
          <h2>記事生成結果</h2>
          <div className="result-actions">
            <button
              type="button"
              className="secondary"
              onClick={handleClearOutput}
              disabled={isLoading}
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

          {renderOutline()}

          {hasStructuredArticle ? (
            <div className="generated-article">
              {displayTitle && (
                <div className="generated-block">
                  <h3>タイトル</h3>
                  <p className="generated-title">{displayTitle}</p>
                </div>
              )}

              {introduction && (
                <div className="generated-block">
                  <h3>導入文</h3>
                  <div className="generated-text">
                    {renderParagraphs(introduction, 'intro')}
                  </div>
                </div>
              )}

              {structuredArticle.sections.map((section, index) => (
                <div className="generated-block section-block" key={`section-${index}`}>
                  <h3>{section?.h2}</h3>
                  <div className="generated-text">
                    {renderParagraphs(section?.content || '', `section-${index}`)}
                  </div>
                  {Array.isArray(section?.subsections) &&
                    section.subsections.map((sub, subIndex) => (
                      <div className="generated-subsection" key={`sub-${index}-${subIndex}`}>
                        <h4>{sub?.h3}</h4>
                        <div className="generated-text">
                          {renderParagraphs(sub?.content || '', `sub-${index}-${subIndex}`)}
                        </div>
                      </div>
                    ))}
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
          ) : hasStructuredHeadings ? (
            <article className="article">
              <h3>{displayTitle}</h3>
              <div className="article-content">
                {article.headings?.map((heading, index) => (
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
            <div className="generated-block">
              <h3>タイトル</h3>
              <p className="generated-title">{displayTitle}</p>
            </div>
          ) : (
            <p className="note">記事タイトルを取得できませんでした。</p>
          )}
        </section>
      )}

      {showImageModal && pixtaResults && (
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
      )}
    </div>
  );
}
