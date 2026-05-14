import { useState } from 'react';

function apiUrl(path) {
  const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

const initialUrls = ['', '', ''];

export default function HeadingGenerateApp() {
  const [keyword, setKeyword] = useState('');
  const [competitorUrls, setCompetitorUrls] = useState(initialUrls);
  const [referenceUrl, setReferenceUrl] = useState('');
  const [headings, setHeadings] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');

  const handleUrlChange = (index, value) => {
    const next = [...competitorUrls];
    next[index] = value;
    setCompetitorUrls(next);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setCopyMessage('');
    setIsLoading(true);

    const payload = {
      keyword,
      competitorUrl1: competitorUrls[0],
      competitorUrl2: competitorUrls[1],
      competitorUrl3: competitorUrls[2],
      referenceUrl,
    };

    try {
      const response = await fetch(apiUrl('/api/article/generate-headings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '見出しの生成に失敗しました。');
      }

      const data = await response.json();
      setHeadings(data);
    } catch (err) {
      setError(err.message);
      setHeadings(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setKeyword('');
    setCompetitorUrls(initialUrls);
    setReferenceUrl('');
    setHeadings(null);
    setError('');
    setCopyMessage('');
  };

  const handleClearOutput = () => {
    setHeadings(null);
    setError('');
    setCopyMessage('');
  };

  const handleCopyAll = async () => {
    if (!headings) return;

    const lines = [`キーワード: ${keyword}`, `タイトル: ${headings.title || ''}`];

    (headings.sections || []).forEach((section, h2Index) => {
      lines.push('');
      lines.push(`H2-${h2Index + 1}: ${section.h2 || ''}`);
      (section.subsections || []).forEach((h3, h3Index) => {
        lines.push(`  H3-${h3Index + 1}: ${h3}`);
      });
    });

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyMessage('クリップボードにコピーしました。');
    } catch {
      setCopyMessage('コピーに失敗しました。');
    }
  };

  return (
    <>
      <header>
        <h1>見出し生成</h1>
        <p>キーワードと他社URL・参考URLを入力して、大見出し（H2）3つと、各H2に小見出し（H3）3つずつの案を作成します。参考URLは見出しの構成・書き方の参考に使い、キーワードは別のものを指定します。</p>
      </header>

      <section className="panel">
        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span>キーワード *</span>
            <input
              type="text"
              value={keyword}
              placeholder="例: 洗濯機 おすすめ"
              required
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>

          {competitorUrls.map((value, index) => (
            <label className="field" key={`competitor-${index}`}>
              <span>{`他社URL ${index + 1}`}</span>
              <input
                type="url"
                value={value}
                placeholder="https://example.com/article"
                onChange={(event) => handleUrlChange(index, event.target.value)}
              />
            </label>
          ))}

          <label className="field">
            <span>参考URL</span>
            <input
              type="url"
              value={referenceUrl}
              placeholder="https://example.com/reference-article"
              onChange={(event) => setReferenceUrl(event.target.value)}
            />
            <p className="field-hint">
              見出しの構成・書き方の参考にする記事URLです。キーワードは上記で指定したものとは異なる記事でも構いません。
            </p>
          </label>

          <div className="actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? '生成中...' : '見出しを生成'}
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

      {headings && (
        <section className="panel">
          <h2>見出し生成結果</h2>
          <div className="result-actions">
            <button type="button" className="secondary" onClick={handleCopyAll}>
              すべてコピー
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleClearOutput}
            >
              クリア
            </button>
          </div>
          {copyMessage && <p className="field-hint">{copyMessage}</p>}

          {headings.warnings?.length > 0 && (
            <div className="warning">
              <strong>一部のURLでスクレイピングに失敗しました。</strong>
              <ul>
                {headings.warnings.map((warning, index) => (
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

          <div className="generated-article">
            {headings.title && (
              <div className="generated-block">
                <h3>タイトル案</h3>
                <p>{headings.title}</p>
              </div>
            )}

            {(headings.sections || []).map((section, h2Index) => (
              <div key={`h2-${h2Index}`} className="generated-block section-block">
                <h3>{`H2-${h2Index + 1}: ${section.h2 || ''}`}</h3>
                {(section.subsections || []).map((h3, h3Index) => (
                  <div key={`h3-${h2Index}-${h3Index}`} className="generated-block">
                    <h4>{`H3-${h3Index + 1}`}</h4>
                    <p>{h3}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
