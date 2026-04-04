import { useState } from 'react';

/** 開発時は client/.env.development の VITE_API_BASE_URL で API 直指定（プロキシ不要） */
function apiUrl(path) {
  const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

export default function App() {
  const [kakakuRankingUrl, setKakakuRankingUrl] = useState('');
  const [otherRankingUrl, setOtherRankingUrl] = useState('');
  const [keyword1, setKeyword1] = useState('');
  const [keyword2, setKeyword2] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setResult(null);

    const kakaku = kakakuRankingUrl.trim();
    const other = otherRankingUrl.trim();

    if (!kakaku && !other) {
      setError(
        '価格.com または別サイトのランキングURLのどちらか一方を入力してください。'
      );
      return;
    }
    if (kakaku && other) {
      setError(
        '両方のURLには入力できません。価格.com と別サイトのどちらか一方だけ入力してください。'
      );
      return;
    }

    const rankingUrl = kakaku || other;

    const k1 = keyword1.trim();
    const k2 = keyword2.trim();
    const keywords = [];
    if (k1) keywords.push(k1);
    if (k2) keywords.push(k2);

    if (keywords.length > 2) {
      setError('キーワードは2つまでです。');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(apiUrl('/api/extract-ranking-by-keywords'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rankingUrl,
          keywords,
          keyword1: k1,
          keyword2: k2,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || data.details || 'ランキングの取得に失敗しました。'
        );
      }

      setResult(data);
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg === 'Failed to fetch' || msg === 'Load failed') {
        setError(
          'サーバーに接続できませんでした（Failed to fetch）。次を確認してください: (1) server で npm run dev が動いている (2) client/.env.development の VITE_API_BASE_URL をコメントアウトし、同じオリジン＋Vite プロキシの /api 経由で試す (3) ブラウザを http://localhost:5173 で開いている'
        );
      } else {
        setError(msg);
      }
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setKakakuRankingUrl('');
    setOtherRankingUrl('');
    setKeyword1('');
    setKeyword2('');
    setResult(null);
    setError('');
  };

  const handleClearOutput = () => {
    setResult(null);
    setError('');
  };

  const sortedItems = Array.isArray(result?.items)
    ? [...result.items].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    : [];

  return (
    <div className="app">
      <header>
        <h1>ランキング商品抽出</h1>
        <p>
          価格.com または別サイトのランキングURLのどちらか一方と、価格.com
          と同じルールのキーワード（最大2つ）を指定し、条件に合う商品を順位の高い順に表示します。
          キーワード1つだけの絞り込みもできます。
        </p>
      </header>

      <section className="panel">
        <form className="form" onSubmit={handleSubmit}>
          <div className="field">
            <span>ランキングページURL（どちらか一方のみ）</span>
            <p className="field-hint">
              価格.com と別サイトは排他です。両方空・両方入力はできません。
            </p>
            <label className="field nested-field">
              <span className="field-sub">価格.com（itemlist）</span>
              <input
                type="url"
                value={kakakuRankingUrl}
                placeholder="https://kakaku.com/pc/.../itemlist.aspx"
                onChange={(e) => setKakakuRankingUrl(e.target.value)}
              />
            </label>
            <label className="field nested-field">
              <span className="field-sub">
                別サイト（例: ヨドバシ …/ranking/、コジマ …/ec/ranking.html、ビック …/bc/ranking/）
              </span>
              <input
                type="url"
                value={otherRankingUrl}
                placeholder="https://www.yodobashi.com/.../ranking/ または https://www.kojima.net/ec/ranking.html?... など"
                onChange={(e) => setOtherRankingUrl(e.target.value)}
              />
            </label>
          </div>

          <div className="field">
            <span>キーワード（価格.com と同一ルール）</span>
            <p className="field-hint">
              順位だけ取得する場合は空のまま。絞り込む場合はキーワード1のみ、キーワード2のみ、または1と2の最大2つ（1と2は両方AND）です。
            </p>
            <label className="field nested-field">
              <span className="field-sub">キーワード1</span>
              <input
                type="text"
                value={keyword1}
                placeholder="例: ASUS"
                onChange={(e) => setKeyword1(e.target.value)}
              />
            </label>
            <label className="field nested-field">
              <span className="field-sub">キーワード2</span>
              <input
                type="text"
                value={keyword2}
                placeholder="例: 27インチ以上"
                onChange={(e) => setKeyword2(e.target.value)}
              />
            </label>
          </div>

          <div className="actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? '取得中...' : 'ランキングを取得'}
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

      {result && (
        <section className="panel">
          <h2>取得結果</h2>
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

          <p className="note">
            対象URL: {result.rankingUrl}
            {Array.isArray(result.keywords) && result.keywords.length > 0 && (
              <> / キーワード: {result.keywords.join('、')}</>
            )}
            {typeof result.count === 'number' && (
              <> / {result.count}件</>
            )}
          </p>

          <div className="generated-block">
            <div className="ranking-table-wrap">
              <table className="ranking-table">
                <thead>
                  <tr>
                    <th>順位</th>
                    <th>メーカー</th>
                    <th>型式</th>
                    <th>一致理由</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((row, index) => (
                    <tr key={`${row.rank}-${row.model}-${index}`}>
                      <td>{row.rank}</td>
                      <td>{row.manufacturer}</td>
                      <td>{row.model}</td>
                      <td>{row.feature || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
