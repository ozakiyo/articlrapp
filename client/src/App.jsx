import { useEffect, useState } from 'react';
import KyosoApp from './KyosoApp.jsx';
import ArticleApp from './App_BK20260113.jsx';
import HeadingGenerateApp from './HeadingGenerateApp.jsx';

const STORAGE_KEY = 'articleapp-selected-tab';
const VALID_TABS = ['kyoso', 'headings', 'article'];

export default function App() {
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (VALID_TABS.includes(saved)) return saved;
    } catch {
      /* ignore */
    }
    return 'kyoso';
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  return (
    <div className="app">
      <nav className="app-main-nav panel" aria-label="アプリの切り替え">
        <div className="app-main-nav-inner">
          <span className="app-main-nav-label">利用するアプリ</span>
          <div className="app-main-nav-buttons">
            <button
              type="button"
              className={tab === 'kyoso' ? undefined : 'secondary'}
              onClick={() => setTab('kyoso')}
            >
              競合調査（ランキング抽出）
            </button>
            <button
              type="button"
              className={tab === 'headings' ? undefined : 'secondary'}
              onClick={() => setTab('headings')}
            >
              見出し生成
            </button>
            <button
              type="button"
              className={tab === 'article' ? undefined : 'secondary'}
              onClick={() => setTab('article')}
            >
              記事生成
            </button>
          </div>
        </div>
      </nav>

      {tab === 'kyoso' && <KyosoApp />}
      {tab === 'headings' && <HeadingGenerateApp />}
      {tab === 'article' && <ArticleApp />}
    </div>
  );
}
