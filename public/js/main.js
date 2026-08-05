(function () {
  const TAB_KEY = 'articleappNode-tab';
  const RANKING_CONTEXT_KEY = 'articleappNode.rankingContext';
  const COMPETITOR_ANALYSIS_KEY = 'articleappNode.competitorAnalysis';
  const KYOSO_PHASE1_KEY = 'articleappNode.kyosoPhase1';
  const panels = {
    guide: document.getElementById('panel-guide'),
    ranking: document.getElementById('panel-ranking'),
    weekly: document.getElementById('panel-weekly'),
    productlp: document.getElementById('panel-productlp'),
    usecase: document.getElementById('panel-usecase'),
    headings: document.getElementById('panel-headings'),
    article: document.getElementById('panel-article'),
  };
  /** ナビ tab 名 → 表示する panel キー */
  const TAB_VISIBLE = {
    guide: ['guide'],
    ranking: ['ranking'],
    weekly: ['weekly'],
    productlp: ['productlp'],
    usecase: ['usecase'],
    'pillar-new': ['headings', 'article'],
    'pillar-rewrite': ['article'],
  };
  /** 旧タブ名（localStorage / リンク互換） */
  const TAB_ALIASES = {
    kyoso: 'ranking',
    headings: 'pillar-new',
    article: 'pillar-new',
  };
  const tabButtons = document.querySelectorAll('.tab-btn');

  const CategorySelect = {
    OTHER: '__other__',
    defaultCategory: '掃除機',
    pairs: [
      { selectId: 'weekly-category', otherId: 'weekly-category-other' },
      { selectId: 'kyoso-category', otherId: 'kyoso-category-other' },
      { selectId: 'usecase-category', otherId: 'usecase-category-other' },
      { selectId: 'productlp-category', otherId: 'productlp-category-other' },
    ],

    get(selectId, otherId) {
      const select = document.getElementById(selectId);
      const other = document.getElementById(otherId);
      if (!select) return '';
      if (select.value === this.OTHER) {
        return String(other?.value || '').trim();
      }
      return String(select.value || '').trim();
    },

    syncOtherVisibility(selectId, otherId) {
      const select = document.getElementById(selectId);
      const other = document.getElementById(otherId);
      if (!select || !other) return;
      const isOther = select.value === this.OTHER;
      other.hidden = !isOther;
      if (!isOther) other.value = '';
    },

    fillSelect(select, categories, preferred) {
      if (!select) return;
      const current =
        preferred ||
        (select.value === this.OTHER
          ? ''
          : select.value) ||
        this.defaultCategory;
      const labels = Array.isArray(categories) ? categories.map((c) => c.label || c.id) : [];
      const hasPreferred = preferred && !labels.includes(preferred);
      select.innerHTML = '';
      for (const label of labels) {
        const opt = document.createElement('option');
        opt.value = label;
        opt.textContent = label;
        select.appendChild(opt);
      }
      const otherOpt = document.createElement('option');
      otherOpt.value = this.OTHER;
      otherOpt.textContent = 'その他（自由入力）';
      select.appendChild(otherOpt);

      if (hasPreferred) {
        select.value = this.OTHER;
      } else if (labels.includes(current)) {
        select.value = current;
      } else if (labels.includes(this.defaultCategory)) {
        select.value = this.defaultCategory;
      } else if (labels.length) {
        select.value = labels[0];
      } else {
        select.value = this.OTHER;
      }
    },

    set(selectId, otherId, label) {
      const select = document.getElementById(selectId);
      const other = document.getElementById(otherId);
      const name = String(label || '').trim();
      if (!select) return;
      const optionValues = [...select.options].map((o) => o.value);
      if (name && optionValues.includes(name)) {
        select.value = name;
        if (other) {
          other.hidden = true;
          other.value = '';
        }
        return;
      }
      select.value = this.OTHER;
      if (other) {
        other.hidden = false;
        other.value = name;
      }
    },

    async refresh(options = {}) {
      const preferLabel = String(options.preferLabel || '').trim();
      const preferSelectId = String(options.preferSelectId || '').trim();
      const res = await fetch('/api/categories');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'カテゴリ一覧の取得に失敗しました');
      this.defaultCategory = data.defaultCategory || '掃除機';
      if (data.otherOptionValue) this.OTHER = data.otherOptionValue;
      const categories = Array.isArray(data.categories) ? data.categories : [];

      for (const pair of this.pairs) {
        const select = document.getElementById(pair.selectId);
        const previous = this.get(pair.selectId, pair.otherId);
        const preferThis =
          !!preferLabel && (!preferSelectId || preferSelectId === pair.selectId);
        this.fillSelect(select, categories, preferThis ? preferLabel : previous);
        if (preferThis) {
          this.set(pair.selectId, pair.otherId, preferLabel);
        } else if (previous) {
          this.set(pair.selectId, pair.otherId, previous);
        }
        this.syncOtherVisibility(pair.selectId, pair.otherId);
      }
      return data;
    },
  };
  window.CategorySelect = CategorySelect;

  function getKyosoCategory() {
    return CategorySelect.get('kyoso-category', 'kyoso-category-other');
  }

  function getWeeklyCategory() {
    return CategorySelect.get('weekly-category', 'weekly-category-other');
  }

  function resolveTabName(name) {
    const raw = String(name || '').trim();
    if (TAB_VISIBLE[raw]) return raw;
    if (TAB_ALIASES[raw]) return TAB_ALIASES[raw];
    return 'weekly';
  }

  function setArticleMode(mode) {
    const create = document.getElementById('article-mode-create');
    const rewrite = document.getElementById('article-mode-rewrite');
    const panel = document.getElementById('panel-article');
    if (mode === 'rewrite') {
      if (rewrite) rewrite.checked = true;
      if (create) create.checked = false;
    } else {
      if (create) create.checked = true;
      if (rewrite) rewrite.checked = false;
    }
    if (panel) panel.dataset.articleMode = mode === 'rewrite' ? 'rewrite' : 'create';
    if (typeof syncArticleModeUi === 'function') syncArticleModeUi();
    const title = document.getElementById('article-panel-title');
    if (title) {
      title.textContent =
        mode === 'rewrite' ? '記事コンテンツ（リライト）' : '記事コンテンツ（新規）— 本文';
    }
  }

  function openRankingTab(options = {}) {
    const weeklyCat = getWeeklyCategory();
    if (weeklyCat) {
      CategorySelect.set('kyoso-category', 'kyoso-category-other', weeklyCat);
    }
    showTab('ranking');
    loadKyosoSavedRankingUrls();
  }
  window.openRankingTab = openRankingTab;
  /** @deprecated 互換用 */
  window.openWeeklyUrlSetup = openRankingTab;

  function showTab(name) {
    const resolved = resolveTabName(name);
    const prevTab = resolveTabName(localStorage.getItem(TAB_KEY));
    // タブ切替前に記事下書きをフラッシュ
    if (typeof flushArticleDraftForCurrentMode === 'function') {
      flushArticleDraftForCurrentMode();
    }
    if (prevTab === 'pillar-new' && typeof savePillarNewDraftNow === 'function') {
      savePillarNewDraftNow();
    }
    const visibleKeys = new Set(TAB_VISIBLE[resolved] || ['weekly']);
    Object.keys(panels).forEach((key) => {
      const el = panels[key];
      if (el) el.hidden = !visibleKeys.has(key);
    });
    tabButtons.forEach((btn) => {
      const active = btn.dataset.tab === resolved;
      btn.classList.toggle('secondary', !active);
    });
    try {
      localStorage.setItem(TAB_KEY, resolved);
    } catch {
      /* ignore */
    }
    if (resolved === 'ranking') {
      loadKyosoSavedRankingUrls();
    }
    if (resolved === 'weekly') {
      loadKyosoSavedCompetitorArticles();
    }
    if (resolved === 'pillar-new') {
      setArticleMode('create');
      if (typeof applyArticleDraftForMode === 'function') applyArticleDraftForMode('create');
      syncHeadingsTabFromSources({ force: false });
      syncArticleTabFromSources({ force: false }).then(() => syncArticleModeUi());
    }
    if (resolved === 'pillar-rewrite') {
      setArticleMode('rewrite');
      if (typeof applyArticleDraftForMode === 'function') applyArticleDraftForMode('rewrite');
      // リライトは元URLから構成取得するため、新規用のURL／見出し取込はしない
    }
  }
  window.showTab = showTab;

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      showTab(btn.dataset.tab);
    });
  });

  document.querySelectorAll('[data-guide-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-guide-go');
      if (!name) return;
      if (name === 'kyoso') {
        openRankingTab();
        return;
      }
      showTab(name);
    });
  });

  let initialTab = 'weekly';
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved) initialTab = resolveTabName(saved);
  } catch {
    /* ignore */
  }

  CategorySelect.refresh()
    .catch((err) => console.warn('CategorySelect.refresh:', err.message))
    .finally(() => {
      if (typeof restorePillarDraftsOnLoad === 'function') restorePillarDraftsOnLoad();
      showTab(initialTab);
      window.dispatchEvent(new CustomEvent('categories-ready'));
    });

  for (const pair of CategorySelect.pairs) {
    document.getElementById(pair.selectId)?.addEventListener('change', () => {
      CategorySelect.syncOtherVisibility(pair.selectId, pair.otherId);
      if (pair.selectId === 'kyoso-category') {
        loadKyosoSavedRankingUrls();
      }
      if (pair.selectId === 'weekly-category') {
        loadKyosoSavedCompetitorArticles();
        window.dispatchEvent(new CustomEvent('weekly-category-changed'));
      }
    });
    document.getElementById(pair.otherId)?.addEventListener('change', () => {
      if (pair.selectId === 'kyoso-category') {
        loadKyosoSavedRankingUrls();
      }
      if (pair.selectId === 'weekly-category') {
        loadKyosoSavedCompetitorArticles();
        window.dispatchEvent(new CustomEvent('weekly-category-changed'));
      }
    });
  }

  function showError(el, message) {
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function setLoading(btn, loading, label, loadingLabel) {
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? loadingLabel : label;
  }

  async function postJson(url, body) {
    const payload =
      window.AiProvider && typeof window.AiProvider.withBody === 'function'
        ? window.AiProvider.withBody(body)
        : body;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let msg = data.error || data.details || 'リクエストに失敗しました。';
      if (Array.isArray(data.warnings) && data.warnings.length) {
        const detail = data.warnings
          .map((w) => (w.url ? `${w.url}: ${w.message}` : w.message))
          .filter(Boolean)
          .join('\n');
        if (detail) msg += `\n\n${detail}`;
      }
      throw new Error(msg);
    }
    return data;
  }

  function splitParagraphs(text) {
    return String(text ?? '')
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean);
  }

  function normalizeMarkdown(p) {
    return p.replace(/^\s*([*-]|\d+\.)\s*/g, '');
  }

  function paragraphsHtml(text, prefix) {
    return splitParagraphs(text)
      .map(
        (p, i) =>
          `<p>${escapeHtml(normalizeMarkdown(p))}</p>`
      )
      .join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderWarnings(container, warnings) {
    if (!container) return;
    if (!warnings?.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    const items = warnings
      .map(
        (w) =>
          `<li><span>${escapeHtml(w.url)}</span>${
            w.message
              ? ` <span class="warning-detail">（${escapeHtml(w.message)}）</span>`
              : ''
          }</li>`
      )
      .join('');
    container.innerHTML = `<strong>一部のURLでスクレイピングに失敗しました。</strong><ul>${items}</ul>`;
    container.hidden = false;
  }

  // --- ランキング ---
  const formKyoso = document.getElementById('form-kyoso');
  const kyosoError = document.getElementById('kyoso-error');
  const kyosoResult = document.getElementById('kyoso-result');
  const kyosoMeta = document.getElementById('kyoso-meta');
  const kyosoTbody = document.getElementById('kyoso-tbody');
  const kyosoCompositeTbody = document.getElementById('kyoso-composite-tbody');
  const kyosoCompositeMeta = document.getElementById('kyoso-composite-meta');
  const kyosoThemedBlocks = document.getElementById('kyoso-themed-blocks');
  const kyosoThemeSelectPanel = document.getElementById('kyoso-theme-select-panel');
  const kyosoBuildThemed = document.getElementById('kyoso-build-themed');
  const kyosoThemedMsg = document.getElementById('kyoso-themed-msg');
  const kyosoThemedError = document.getElementById('kyoso-themed-error');
  const kyosoThemeSelects = [
    document.getElementById('kyoso-theme-2'),
    document.getElementById('kyoso-theme-3'),
  ];
  let kyosoThemePresets = [];
  let kyosoPhase1Cache = null;

  function setKyosoThemedMsg(message) {
    if (kyosoThemedMsg) kyosoThemedMsg.textContent = message || '';
  }

  function showKyosoThemedError(message) {
    showError(kyosoThemedError, message);
    showError(kyosoError, message);
  }

  function saveKyosoPhase1Cache(cache) {
    kyosoPhase1Cache = cache;
    try {
      sessionStorage.setItem(KYOSO_PHASE1_KEY, JSON.stringify(cache));
    } catch {
      /* ignore quota */
    }
  }

  function loadKyosoPhase1Cache() {
    if (kyosoPhase1Cache?.compositeItems?.length) return kyosoPhase1Cache;
    try {
      const raw = sessionStorage.getItem(KYOSO_PHASE1_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.compositeItems?.length) {
        kyosoPhase1Cache = parsed;
        kyosoThemePresets = Array.isArray(parsed.themePresets) ? parsed.themePresets : [];
        return kyosoPhase1Cache;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function clearKyosoPhase1Cache() {
    kyosoPhase1Cache = null;
    try {
      sessionStorage.removeItem(KYOSO_PHASE1_KEY);
    } catch {
      /* ignore */
    }
  }

  const kyosoSubmit = document.getElementById('kyoso-submit');
  const kyosoResolveUrls = document.getElementById('kyoso-resolve-urls');
  const kyosoSaveUrls = document.getElementById('kyoso-save-urls');
  const kyosoUrlPanel = document.getElementById('kyoso-url-panel');
  const kyosoUrlNotes = document.getElementById('kyoso-url-notes');
  const kyosoUrlSavedHint = document.getElementById('kyoso-url-saved-hint');

  function saveRankingContextToStorage(ctx) {
    try {
      sessionStorage.setItem(RANKING_CONTEXT_KEY, JSON.stringify(ctx));
    } catch {
      /* ignore */
    }
  }

  function loadRankingContextFromStorage() {
    try {
      const raw = sessionStorage.getItem(RANKING_CONTEXT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function loadCompetitorAnalysisFromStorage() {
    try {
      const raw = sessionStorage.getItem(COMPETITOR_ANALYSIS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function resolveBridgeCategory() {
    const ctx = loadRankingContextFromStorage();
    if (ctx?.category) return String(ctx.category).trim();
    const analysis = loadCompetitorAnalysisFromStorage();
    if (analysis?.category) return String(analysis.category).trim();
    const weekly = getWeeklyCategory();
    if (weekly) return weekly;
    const kyoso = getKyosoCategory();
    if (kyoso) return kyoso;
    const fromKw = document.getElementById('headings-keyword')?.value.trim();
    if (fromKw) return fromKw;
    const fromArticle = document.getElementById('article-keyword')?.value.trim();
    if (fromArticle) return fromArticle;
    return '';
  }

  function uniqueCandidateStrings(lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const item of list || []) {
        const s = String(
          typeof item === 'string'
            ? item
            : item?.headingCandidate || item?.heading || item?.label || ''
        ).trim();
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
    }
    return out.slice(0, 5);
  }

  function collectBridgeHeadingCandidates(category) {
    const ctx = loadRankingContextFromStorage();
    const analysis = loadCompetitorAnalysisFromStorage();
    const fromRanking =
      !category || !ctx?.category || ctx.category === category
        ? ctx?.pickedFeatures || []
        : [];
    const fromProposals =
      analysis?.data && (!category || analysis.category === category)
        ? analysis.data.proposals || []
        : [];
    const fromUpdates =
      analysis?.data && (!category || analysis.category === category)
        ? (analysis.data.headingUpdates || [])
            .filter((u) => u.type === 'added' || u.change === 'added')
            .map((u) => u.heading)
        : [];
    return uniqueCandidateStrings([fromRanking, fromProposals, fromUpdates]);
  }

  function setUrlFields(prefix, urls, { force = false } = {}) {
    const list = (urls || []).filter(Boolean).slice(0, 3);
    for (let i = 1; i <= 3; i++) {
      const el = document.getElementById(`${prefix}-url${i}`);
      if (!el) continue;
      if (!force && el.value.trim()) continue;
      el.value = list[i - 1] || (force ? '' : el.value);
    }
  }

  function copyUrlFields(fromPrefix, toPrefix, { force = false } = {}) {
    for (let i = 1; i <= 3; i++) {
      const from = document.getElementById(`${fromPrefix}-url${i}`);
      const to = document.getElementById(`${toPrefix}-url${i}`);
      if (!from || !to) continue;
      if (!force && to.value.trim()) continue;
      if (from.value.trim()) to.value = from.value.trim();
    }
    const fromRef = document.getElementById(`${fromPrefix}-ref-url`);
    const toRef = document.getElementById(`${toPrefix}-ref-url`);
    if (fromRef && toRef && (force || !toRef.value.trim()) && fromRef.value.trim()) {
      toRef.value = fromRef.value.trim();
    }
  }

  async function fetchCompetitorArticleUrls(category) {
    if (!category) return [];
    try {
      const res = await fetch(
        `/api/competitor-articles?category=${encodeURIComponent(category)}`
      );
      const data = await res.json();
      if (!Array.isArray(data.articles)) return [];
      return data.articles.map((a) => a.url).filter(Boolean).slice(0, 3);
    } catch {
      return [];
    }
  }

  function fillHeadingsCompetitorUrls(articles) {
    const list = (articles || []).slice(0, 3);
    for (let i = 0; i < 3; i++) {
      const el = document.getElementById(`headings-url${i + 1}`);
      if (!el) continue;
      el.value = list[i]?.url || el.value || '';
    }
  }

  async function discoverCompetitorUrlsForHeadings() {
    const keyword = document.getElementById('headings-keyword')?.value.trim();
    const msg = document.getElementById('headings-discover-msg');
    const btn = document.getElementById('headings-discover-urls');
    if (!keyword) {
      showError(headingsError, 'キーワードを入力してから他社URLを自動取得してください。');
      return;
    }
    showError(headingsError, '');
    if (msg) msg.textContent = '検索中（家電量販店の上位記事）…';
    setLoading(btn, true, '他社URLを自動取得（SEO上位）', '取得中...');
    try {
      const data = await postJson('/api/article/discover-competitor-urls', { keyword });
      const articles = data.articles || [];
      if (!articles.length) {
        if (msg) {
          msg.textContent =
            (data.notes || []).join(' / ') ||
            '該当する家電量販店記事が見つかりませんでした。手入力してください。';
        }
        return;
      }
      fillHeadingsCompetitorUrls(articles);
      if (msg) {
        msg.textContent = `取得 ${articles.length} 件: ${articles
          .map((a) => `${a.site}`)
          .join(' / ')}`;
      }
    } catch (err) {
      showError(headingsError, err.message);
      if (msg) msg.textContent = '';
    } finally {
      setLoading(btn, false, '他社URLを自動取得（SEO上位）', '取得中...');
    }
  }

  function setHeadingCandidatesToForm(features, hintText) {
    const list = uniqueCandidateStrings([features]);
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById(`headings-candidate-${i}`);
      if (el) el.value = list[i - 1] || '';
    }
    const hint = document.getElementById('headings-candidates-hint');
    if (hint) {
      hint.textContent =
        hintText ||
        (list.length
          ? `追加キーワード ${list.length} 件を入力済み（見出し生成時に考慮されます）`
          : 'デフォルトは空欄でOK。必要なときだけ入力すると、見出し生成時に考慮します。');
    }
  }

  function getHeadingCandidatesFromForm() {
    const out = [];
    for (let i = 1; i <= 5; i++) {
      const v = document.getElementById(`headings-candidate-${i}`)?.value.trim();
      if (v) out.push(v);
    }
    return out;
  }

  async function syncHeadingsTabFromSources({ force = true } = {}) {
    const ctx = loadRankingContextFromStorage();
    const category = resolveBridgeCategory() || ctx?.category || '';
    const kw = document.getElementById('headings-keyword');
    if (kw && category && (force || !kw.value.trim())) {
      kw.value = category;
    }
    // 追加キーワードは手動入力のみ（自動では埋めない）
    const existing = getHeadingCandidatesFromForm();
    const hint = document.getElementById('headings-candidates-hint');
    if (hint && !existing.length) {
      hint.textContent =
        'デフォルトは空欄でOK。必要なときだけ入力すると、見出し生成時に考慮します。';
    }
    const urls = await fetchCompetitorArticleUrls(category);
    if (urls.length) setUrlFields('headings', urls, { force });
    const status = document.getElementById('headings-bridge-msg');
    if (status) {
      status.textContent = category
        ? `反映: ${category} / 競合URL ${urls.length} 件（追加キーワードは手動）`
        : '反映できる週次・競合データがありません。先に取得してください。';
    }
    return { category, candidates: existing, urls };
  }

  async function syncArticleTabFromSources({ force = true } = {}) {
    const ctx = loadRankingContextFromStorage();
    const category =
      resolveBridgeCategory() ||
      document.getElementById('headings-keyword')?.value.trim() ||
      ctx?.category ||
      '';
    const kw = document.getElementById('article-keyword');
    if (kw && category && (force || !kw.value.trim())) {
      kw.value = category;
    }
    const urls = await fetchCompetitorArticleUrls(category);
    if (urls.length) setUrlFields('article', urls, { force });
    // 見出しタブに既にURLがあれば記事側へもコピー
    copyUrlFields('headings', 'article', { force: false });
    const status = document.getElementById('article-bridge-msg');
    if (status) {
      status.textContent = category
        ? `反映: ${category} / 競合URL ${urls.length} 件（見出し結果の引き継ぎは下のボタン）`
        : '反映できる週次・競合データがありません。先に取得してください。';
    }
    return { category, urls };
  }

  const OUTLINE_STORAGE_KEY = 'articleAppOutline';
  const MAX_OUTLINE_H4 = 3;

  function normalizeClientOutline(keyword, sectionsRaw) {
    const kw = String(keyword || '').trim() || '商品';
    const defaults = [
      { h2: `${kw}選びのポイント`, subsections: ['', '', ''], searchIntent: '選び方' },
      { h2: `${kw}の人気メーカー`, subsections: ['', '', ''], searchIntent: 'メーカー' },
    ];
    const list = Array.isArray(sectionsRaw) ? sectionsRaw : [];
    return defaults.map((def, i) => {
      const src = list[i] || {};
      const itemsSrc = Array.isArray(src.items)
        ? src.items
        : Array.isArray(src.subsections) &&
            src.subsections.some((x) => x && typeof x === 'object' && (x.h3 || x.intent))
          ? src.subsections
          : null;
      const subsRaw = itemsSrc
        ? itemsSrc.map((it) => (typeof it === 'string' ? it : it?.h3 || ''))
        : Array.isArray(src.subsections)
          ? src.subsections
          : [];
      const items = [0, 1, 2].map((j) => {
        const raw = itemsSrc?.[j];
        const h3Raw = subsRaw[j];
        const h3 =
          (raw && typeof raw === 'object' ? String(raw.h3 || '').trim() : '') ||
          (typeof h3Raw === 'string'
            ? h3Raw.trim()
            : String(h3Raw?.h3 || h3Raw?.title || '').trim());
        const h4s = [0, 1, 2].map((k) => {
          const h4 = Array.isArray(raw?.h4s) ? raw.h4s[k] : '';
          return String(h4 || '').trim();
        });
        const intent = String(
          (raw && typeof raw === 'object' ? raw.intent || raw.searchIntent : '') ||
            (typeof h3Raw === 'object' ? h3Raw?.intent || '' : '') ||
            ''
        ).trim();
        return { h3, h4s, intent };
      });
      return {
        h2: String(src.h2 || def.h2).trim() || def.h2,
        searchIntent: String(src.searchIntent || src.intent || def.searchIntent || '').trim(),
        subsections: items.map((it) => it.h3),
        items,
      };
    });
  }

  /** リライト用: H2/H3 件数を強制せず、取り込み構成をそのまま編集可能にする */
  function normalizeFlexibleOutline(sectionsRaw) {
    const list = Array.isArray(sectionsRaw) ? sectionsRaw : [];
    return list
      .map((src) => {
        const itemsSrc = Array.isArray(src.items)
          ? src.items
          : Array.isArray(src.subsections)
            ? src.subsections.map((h3) =>
                typeof h3 === 'string' ? { h3, h4s: [], intent: '' } : h3
              )
            : [];
        const items = itemsSrc
          .map((raw) => {
            const h3 =
              typeof raw === 'string'
                ? raw.trim()
                : String(raw?.h3 || raw?.title || '').trim();
            const h4s = [0, 1, 2].map((k) => {
              const h4 = Array.isArray(raw?.h4s) ? raw.h4s[k] : '';
              return String(h4 || '').trim();
            });
            const intent = String(
              (raw && typeof raw === 'object' ? raw.intent || raw.searchIntent : '') || ''
            ).trim();
            return { h3, h4s, intent };
          })
          .filter((it) => it.h3);
        if (!items.length && String(src.h2 || '').trim()) {
          items.push({ h3: String(src.h2).trim(), h4s: ['', '', ''], intent: '' });
        }
        return {
          h2: String(src.h2 || '').trim(),
          searchIntent: String(src.searchIntent || src.intent || '').trim(),
          subsections: items.map((it) => it.h3),
          items,
        };
      })
      .filter((sec) => sec.h2 && sec.items.length);
  }

  function saveOutlineToStorage(outline, keyword, title, extra = {}) {
    try {
      sessionStorage.setItem(
        OUTLINE_STORAGE_KEY,
        JSON.stringify({
          keyword: keyword || '',
          title: title || '',
          outline,
          enableH4: Boolean(extra.enableH4),
          savedAt: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }
    if (typeof schedulePillarDraftSave === 'function') {
      schedulePillarDraftSave();
    }
  }

  function loadOutlineFromStorage() {
    const DS = window.DraftStore;
    if (DS) {
      const draft = DS.load(DS.KEYS.pillarNew);
      if (draft?.headingsOutline?.length || draft?.articleOutline?.length) {
        return {
          keyword: draft.headingsKeyword || draft.articleKeyword || '',
          title: draft.articleTitle || '',
          outline: draft.headingsOutline || draft.articleOutline,
          enableH4: Boolean(draft.enableH4),
          savedAt: draft.savedAt,
        };
      }
    }
    try {
      const raw = sessionStorage.getItem(OUTLINE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.outline?.length) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function renderOutlineEditor(
    containerId,
    outline,
    { withH4 = false, allowSuggest = false, flexible = false } = {}
  ) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const sections = flexible
      ? normalizeFlexibleOutline(outline)
      : normalizeClientOutline('', outline);
    if (!sections.length) {
      root.innerHTML =
        '<p class="field-hint">見出しがありません。構成を取り込むか、記事コンテンツ（新規）から引き継いでください。</p>';
      return;
    }
    root.innerHTML = sections
      .map((sec, si) => {
        const h3Html = (sec.items || [])
          .map((item, hi) => {
            const h4Fields = withH4
              ? `<div class="outline-h4-list" data-sec="${si}" data-h3="${hi}">
                  ${[0, 1, 2]
                    .map(
                      (k) => `<label class="field nested-field outline-h4-field">
                        <span class="field-sub">H4-${k + 1}</span>
                        <input type="text" class="outline-h4-input" data-sec="${si}" data-h3="${hi}" data-h4="${k}" value="${escapeHtml(item.h4s?.[k] || '')}" placeholder="${allowSuggest ? '提案後に編集可（空ならこのH4は使わない）' : '空ならH3本文のみ'}" />
                      </label>`
                    )
                    .join('')}
                </div>
                ${
                  allowSuggest
                    ? `<div class="outline-h3-actions">
                  <button type="button" class="secondary outline-suggest-h4" data-sec="${si}" data-h3="${hi}">このH3のH4を提案</button>
                </div>`
                    : ''
                }`
              : '';
            return `<div class="outline-h3-block" data-sec="${si}" data-h3="${hi}">
              <label class="field nested-field">
                <span class="field-sub">H3-${hi + 1}${item.intent ? ` <span class="intent-badge">${escapeHtml(item.intent)}</span>` : ''}</span>
                <input type="text" class="outline-h3-input" data-sec="${si}" data-h3="${hi}" value="${escapeHtml(item.h3 || '')}" placeholder="H3見出し" />
                <input type="hidden" class="outline-h3-intent" data-sec="${si}" data-h3="${hi}" value="${escapeHtml(item.intent || '')}" />
              </label>
              ${h4Fields}
            </div>`;
          })
          .join('');
        return `<div class="outline-section" data-sec="${si}">
          <label class="field">
            <span class="field-sub">H2-${si + 1}${sec.searchIntent ? ` <span class="intent-badge">${escapeHtml(sec.searchIntent)}</span>` : ''}</span>
            <input type="text" class="outline-h2-input" data-sec="${si}" value="${escapeHtml(sec.h2 || '')}" />
            <input type="hidden" class="outline-h2-intent" data-sec="${si}" value="${escapeHtml(sec.searchIntent || '')}" />
          </label>
          ${h3Html}
        </div>`;
      })
      .join('');
  }

  function clearOutlineH4(outline) {
    return (outline || []).map((sec) => ({
      ...sec,
      searchIntent: sec.searchIntent || '',
      items: (sec.items || []).map((item) => ({
        h3: item.h3 || '',
        intent: item.intent || '',
        h4s: ['', '', ''],
      })),
      subsections: (sec.items || []).map((item) => item.h3 || ''),
    }));
  }

  function outlineHasAnyH4(outline) {
    return (outline || []).some((sec) =>
      (sec.items || []).some((item) =>
        (item.h4s || []).some((h) => String(h || '').trim())
      )
    );
  }

  function isHeadingsH4Enabled() {
    return Boolean(document.getElementById('headings-enable-h4')?.checked);
  }

  function syncHeadingsH4Ui(outline) {
    const enabled = isHeadingsH4Enabled();
    const actions = document.getElementById('headings-h4-actions');
    if (actions) actions.hidden = !enabled;
    const current =
      outline ||
      readOutlineFromEditor('headings-outline-editor') ||
      lastHeadingsData?.outline;
    if (!current?.length) return;
    const next = enabled ? current : clearOutlineH4(current);
    if (lastHeadingsData) lastHeadingsData.outline = next;
    renderOutlineEditor('headings-outline-editor', next, {
      withH4: enabled,
      allowSuggest: enabled,
    });
  }

  async function suggestH4ForH3({ keyword, h3 }) {
    const data = await postJson('/api/article/generate-sub-headings', {
      keyword,
      h3,
      skipScrape: true,
    });
    return {
      subheadings: (data.subheadings || [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, MAX_OUTLINE_H4),
      warnings: data.warnings || [],
    };
  }

  async function suggestH4ForH3List({ keyword, h3List }) {
    const data = await postJson('/api/article/generate-sub-headings', {
      keyword,
      h3List,
      skipScrape: true,
    });
    return {
      items: Array.isArray(data.items) ? data.items : [],
      warnings: data.warnings || [],
    };
  }

  let h4SuggestInFlight = false;
  let lastH4SuggestAt = 0;
  const H4_SUGGEST_COOLDOWN_MS = 4000;

  async function withH4SuggestGate(run) {
    if (h4SuggestInFlight) {
      throw new Error('別のH4提案が実行中です。完了してから再度お試しください。');
    }
    const waitMs = lastH4SuggestAt
      ? Math.max(0, H4_SUGGEST_COOLDOWN_MS - (Date.now() - lastH4SuggestAt))
      : 0;
    h4SuggestInFlight = true;
    try {
      if (waitMs > 0) {
        const msg = document.getElementById('headings-h4-msg');
        if (msg) {
          msg.textContent = `API制限対策のため ${Math.ceil(waitMs / 1000)} 秒待ってから提案します…`;
        }
        await new Promise((r) => setTimeout(r, waitMs));
      }
      const result = await run();
      lastH4SuggestAt = Date.now();
      return result;
    } finally {
      h4SuggestInFlight = false;
    }
  }

  function fillH4Inputs(editor, si, hi, suggested) {
    for (let k = 0; k < MAX_OUTLINE_H4; k++) {
      const input = editor.querySelector(
        `.outline-h4-input[data-sec="${si}"][data-h3="${hi}"][data-h4="${k}"]`
      );
      if (input) input.value = suggested[k] || '';
    }
  }

  function formatWarningHint(warnings) {
    if (!Array.isArray(warnings) || !warnings.length) return '';
    const detail = warnings
      .map((w) => (w.url ? `${w.url}: ${w.message}` : w.message))
      .filter(Boolean)
      .join(' / ');
    return detail ? `（注意: ${detail}）` : '';
  }

  function readOutlineFromEditor(containerId) {
    const root = document.getElementById(containerId);
    if (!root) return null;
    const sections = [...root.querySelectorAll('.outline-section')];
    if (!sections.length) return null;
    return sections.map((secEl, si) => {
      const h2 =
        secEl.querySelector(`.outline-h2-input[data-sec="${si}"]`)?.value.trim() ||
        '';
      const searchIntent =
        secEl.querySelector(`.outline-h2-intent[data-sec="${si}"]`)?.value.trim() ||
        '';
      const items = [0, 1, 2].map((hi) => {
        const h3 =
          secEl.querySelector(`.outline-h3-input[data-sec="${si}"][data-h3="${hi}"]`)
            ?.value.trim() || '';
        const intent =
          secEl
            .querySelector(`.outline-h3-intent[data-sec="${si}"][data-h3="${hi}"]`)
            ?.value.trim() || '';
        const h4s = [0, 1, 2].map(
          (k) =>
            secEl
              .querySelector(
                `.outline-h4-input[data-sec="${si}"][data-h3="${hi}"][data-h4="${k}"]`
              )
              ?.value.trim() || ''
        );
        return { h3, h4s, intent };
      });
      return {
        h2,
        searchIntent,
        subsections: items.map((it) => it.h3),
        items,
      };
    });
  }

  function outlineToApiSections(outline) {
    return (outline || [])
      .map((sec) => ({
        h2: String(sec.h2 || '').trim(),
        searchIntent: String(sec.searchIntent || '').trim(),
        items: (sec.items || [])
          .map((item) => ({
            h3: String(item.h3 || '').trim(),
            intent: String(item.intent || '').trim(),
            h4s: (item.h4s || [])
              .map((h) => String(h || '').trim())
              .filter(Boolean)
              .slice(0, MAX_OUTLINE_H4),
          }))
          .filter((item) => item.h3),
      }))
      .filter((sec) => sec.h2 && sec.items.length);
  }

  function applyHeadingsResultToArticleForm() {
    let outline =
      readOutlineFromEditor('headings-outline-editor') ||
      lastHeadingsData?.outline ||
      normalizeClientOutline(lastHeadingsKeyword, lastHeadingsData?.sections);
    if (!outline?.length) {
      const status = document.getElementById('article-bridge-msg');
      if (status) status.textContent = '先に見出し生成を実行してください。';
      return false;
    }
    const enableH4 = isHeadingsH4Enabled();
    if (!enableH4) outline = clearOutlineH4(outline);
    const kw = document.getElementById('article-keyword');
    if (kw) kw.value = lastHeadingsKeyword || kw.value;
    const title = document.getElementById('article-title');
    if (title && lastHeadingsData?.title) title.value = lastHeadingsData.title;
    copyUrlFields('headings', 'article', { force: true });
    const refH = document.getElementById('headings-ref-url')?.value.trim();
    const refA = document.getElementById('article-ref-url');
    if (refA && refH) refA.value = refH;
    const showH4 = enableH4 || outlineHasAnyH4(outline);
    articleOutlineFlexible = false;
    if (document.getElementById('article-mode-create')) {
      document.getElementById('article-mode-create').checked = true;
      syncArticleModeUi();
    }
    renderOutlineEditor('article-outline-editor', outline, {
      withH4: showH4,
      allowSuggest: false,
      flexible: false,
    });
    saveOutlineToStorage(outline, lastHeadingsKeyword, lastHeadingsData?.title || '', {
      enableH4: showH4,
    });
    const status = document.getElementById('article-bridge-msg');
    if (status) {
      status.textContent = showH4
        ? '見出し（H2／H3／H4）を確定して記事フォームへ引き継ぎました。本文を生成できます。'
        : '見出し（H2／H3）を確定して記事フォームへ引き継ぎました。H4なしで本文を生成できます。';
    }
    return true;
  }

  function applyRankingContextToHeadingsTab(ctx) {
    if (!ctx) {
      syncHeadingsTabFromSources({ force: true });
      return;
    }
    if (ctx.category) {
      const kw = document.getElementById('headings-keyword');
      if (kw) kw.value = ctx.category;
    }
    const merged = uniqueCandidateStrings([
      ctx.pickedFeatures || [],
      collectBridgeHeadingCandidates(ctx.category),
    ]);
    if (merged.length) setHeadingCandidatesToForm(merged);
    syncHeadingsTabFromSources({ force: true });
  }

  window.ArticleAppBridge = {
    syncHeadingsTabFromSources,
    syncArticleTabFromSources,
    applyHeadingsResultToArticleForm,
    applyRankingContextToHeadingsTab,
    collectBridgeHeadingCandidates,
  };

  function renderKyosoPickedFeatures(pickedFeatures, category) {
    const block = document.getElementById('kyoso-features-block');
    const list = document.getElementById('kyoso-features-list');
    const meta = document.getElementById('kyoso-features-meta');
    if (!block || !list) return;
    if (!pickedFeatures?.length) {
      block.hidden = true;
      return;
    }
    if (meta) {
      meta.textContent = `カテゴリ: ${category || '—'} — 横断比較（総合ランキング）から需要の高い切り口を抽出`;
    }
    list.innerHTML = pickedFeatures
      .map(
        (f, i) =>
          `<li><strong>${i + 1}.</strong> ${escapeHtml(f.headingCandidate || f.label)} <span class="field-hint">（ランキング該当 ${escapeHtml(String(f.matchCount ?? ''))}件）</span></li>`
      )
      .join('');
    block.hidden = false;
  }

  function getKyosoRankingUrlsFromForm() {
    return {
      amazon: document.getElementById('kyoso-url-amazon')?.value.trim() || '',
      rakuten: document.getElementById('kyoso-url-rakuten')?.value.trim() || '',
      yahoo: document.getElementById('kyoso-url-yahoo')?.value.trim() || '',
      kojima: document.getElementById('kyoso-url-kojima')?.value.trim() || '',
      bic: document.getElementById('kyoso-url-bic')?.value.trim() || '',
    };
  }

  function setKyosoRankingUrlsToForm(urls) {
    const map = {
      amazon: 'kyoso-url-amazon',
      rakuten: 'kyoso-url-rakuten',
      yahoo: 'kyoso-url-yahoo',
      kojima: 'kyoso-url-kojima',
      bic: 'kyoso-url-bic',
    };
    for (const [key, id] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.value = urls?.[key] || '';
    }
  }

  function enableKyosoSubmitIfUrlsReady() {
    const urls = getKyosoRankingUrlsFromForm();
    const ready = Boolean(
      urls.amazon || urls.rakuten || urls.yahoo || urls.kojima || urls.bic
    );
    if (kyosoSubmit) kyosoSubmit.disabled = !ready;
  }

  function setKyosoSavedHint(message) {
    if (kyosoUrlSavedHint) kyosoUrlSavedHint.textContent = message || '';
  }

  async function loadKyosoSavedRankingUrls() {
    const category = getKyosoCategory();
    if (!category) {
      setKyosoSavedHint('');
      return;
    }
    try {
      const res = await fetch(
        `/api/category-ranking-urls?category=${encodeURIComponent(category)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存済み URL の読み込みに失敗しました');
      if (!data.saved) {
        setKyosoSavedHint('保存済み URL はありません。調べた URL を入力して「URLを保存」してください。');
        return;
      }
      setKyosoRankingUrlsToForm(data.rankingUrls || {});
      if (kyosoUrlPanel) kyosoUrlPanel.hidden = false;
      enableKyosoSubmitIfUrlsReady();
      const savedDate = data.savedAt ? data.savedAt.slice(0, 10) : '—';
      setKyosoSavedHint(
        `保存済み URL を読み込みました（${savedDate} 保存 / data/ranking-urls.json）。週次レポート取得でも自動使用されます。`
      );
    } catch (err) {
      setKyosoSavedHint('');
      console.warn('loadKyosoSavedRankingUrls:', err.message);
    }
  }

  /** テーマ2・3の選択肢を埋める。需要候補を優先し、不足時はプリセット全体から選べる */
  function fillKyosoThemeSelectsFromFeatures(pickedFeatures, themePresets, suggestedIds) {
    kyosoThemePresets = Array.isArray(themePresets) ? themePresets : [];
    const presetById = new Map(kyosoThemePresets.map((p) => [p.id, p]));
    const featureById = new Map(
      (pickedFeatures || []).filter((f) => f.id).map((f) => [f.id, f])
    );
    const demandCandidates = (pickedFeatures || []).filter(
      (f) => f.id && f.id !== 'overall' && presetById.has(f.id)
    );
    const secondaryPresets = kyosoThemePresets.filter((p) => p.id && p.id !== 'overall');
    // 需要候補が少ない場合でもプリセットから選択できるようにする
    const optionPresets =
      demandCandidates.length >= 2
        ? demandCandidates.map((f) => presetById.get(f.id)).filter(Boolean)
        : secondaryPresets;

    for (let i = 0; i < 2; i++) {
      const sel = kyosoThemeSelects[i];
      if (!sel) continue;
      sel.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '候補から選択';
      sel.appendChild(placeholder);
      for (const p of optionPresets) {
        const feat = featureById.get(p.id);
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = feat
          ? `${p.label}（該当 ${feat.matchCount ?? '—'}件）`
          : p.label;
        sel.appendChild(opt);
      }
      const suggested = suggestedIds?.[i];
      if (suggested && optionPresets.some((p) => p.id === suggested)) {
        sel.value = suggested;
      } else if (demandCandidates[i]) {
        sel.value = demandCandidates[i].id;
      } else if (optionPresets[i]) {
        sel.value = optionPresets[i].id;
      }
    }

    const canSelect = optionPresets.length >= 2;
    if (kyosoThemeSelectPanel) {
      kyosoThemeSelectPanel.hidden = !canSelect;
    }
    if (kyosoBuildThemed) {
      kyosoBuildThemed.disabled = !canSelect;
    }
    if (canSelect) {
      setKyosoThemedMsg(
        demandCandidates.length >= 2
          ? '需要候補からテーマ2・3を選んで作成できます。'
          : '需要候補が少ないため、カテゴリのテーマ一覧から選んでください。'
      );
    } else {
      setKyosoThemedMsg('このカテゴリでは選択できるテーマが不足しています。');
    }
  }

  function getKyosoRankingThemesFromForm() {
    const themes = [];
    const overall = kyosoThemePresets.find((p) => p.id === 'overall');
    if (overall) {
      themes.push({
        id: overall.id,
        label: overall.label,
        title: overall.title,
        keywords: overall.keywords || [],
        excludeKeywords: overall.excludeKeywords || [],
        minSiteCount: overall.minSiteCount ?? 0,
      });
    }
    for (let i = 0; i < 2; i++) {
      const sel = kyosoThemeSelects[i];
      const id = sel?.value || '';
      if (!id) continue;
      const preset = kyosoThemePresets.find((p) => p.id === id);
      if (preset) {
        themes.push({
          id: preset.id,
          label: preset.label,
          title: preset.title,
          keywords: preset.keywords || [],
          excludeKeywords: preset.excludeKeywords || [],
          minSiteCount: preset.minSiteCount ?? 0,
        });
      }
    }
    return themes;
  }

  function appendThemedCsvToMeta(metaEl, data) {
    if (!metaEl?.innerHTML || !data?.themedCsvDownloadUrl) return;
    if (metaEl.innerHTML.includes('テーマ別 CSV')) return;
    metaEl.innerHTML += ` / <a href="${escapeHtml(data.themedCsvDownloadUrl)}" download="${escapeHtml(data.themedCsvFilename || 'ranking-themed.csv')}">テーマ別 CSV</a>`;
  }

  function renderKyosoThemedBlocks(themedRanking, themeTopLimit = 5) {
    if (!kyosoThemedBlocks) return;
    const blocks = themedRanking?.themes || [];
    const maxPerTheme = Number(themeTopLimit) > 0 ? Number(themeTopLimit) : 5;
    if (!blocks.length) {
      kyosoThemedBlocks.innerHTML = '';
      return;
    }
    const rankCell = (n) => (n != null && n !== '' ? escapeHtml(String(n)) : '—');
    kyosoThemedBlocks.innerHTML = blocks
      .map((block) => {
        const rows = (block.items || [])
          .map(
            (item) =>
              `<tr>
                <td>${escapeHtml(item.rank)}</td>
                <td>${escapeHtml(item.modelKey || '')}</td>
                <td>${escapeHtml(item.manufacturer || '')}</td>
                <td>${rankCell(item.rankAmazon)}</td>
                <td>${rankCell(item.rankRakuten)}</td>
                <td>${rankCell(item.rankYahoo)}</td>
                <td>${rankCell(item.rankKojima)}</td>
                <td>${rankCell(item.rankBic)}</td>
                <td>${escapeHtml(item.siteCount ?? '')}</td>
                <td>${item.avgRank != null ? escapeHtml(String(item.avgRank)) : '—'}</td>
                <td>${escapeHtml((item.representativeModel || '').slice(0, 48))}</td>
              </tr>`
          )
          .join('');
        const note =
          block.items.length < maxPerTheme
            ? `<p class="field-hint">候補 ${block.candidateCount}件 — 最大${escapeHtml(String(maxPerTheme))}件が ${block.items.length}件（条件を緩めるかテーマを変更してください）</p>`
            : '';
        const stepTag =
          blocks.length === 1
            ? '② テーマ1（総合・確定）'
            : escapeHtml(block.title || block.label);
        return `<div class="generated-block">
          <h3>${blocks.length === 1 ? stepTag : escapeHtml(block.title || block.label)}</h3>
          ${note}
          <div class="ranking-table-wrap">
            <table class="ranking-table">
              <thead>
                <tr>
                  <th>順位</th><th>型番</th><th>メーカー</th>
                  <th>Amazon</th><th>楽天</th><th>Yahoo!</th><th>コジマ</th><th>ビック</th>
                  <th>掲載数</th><th>平均</th><th>商品名</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="11">該当なし</td></tr>'}</tbody>
            </table>
          </div>
        </div>`;
      })
      .join('');
  }

  kyosoResolveUrls?.addEventListener('click', async () => {
    showError(kyosoError, '');
    const category = getKyosoCategory();
    if (!category) {
      showError(kyosoError, 'カテゴリを入力してください。');
      return;
    }

    setLoading(kyosoResolveUrls, true, 'ランキング URL を自動取得（Gemini）', 'URL 取得中...');
    try {
      const data = await postJson('/api/resolve-category-ranking-urls', { category });
      setKyosoRankingUrlsToForm(data.rankingUrls || {});
      if (kyosoUrlPanel) kyosoUrlPanel.hidden = false;

      const res = data.urlResolution || {};
      const resLine = [
        data.rankingUrls?.amazon && `Amazon: ${res.amazon || '—'}`,
        data.rankingUrls?.rakuten && `楽天: ${res.rakuten || '—'}`,
        data.rankingUrls?.yahoo && `Yahoo: ${res.yahoo || '—'}`,
        data.rankingUrls?.kojima && `コジマ: ${res.kojima || '—'}`,
        data.rankingUrls?.bic && `ビック: ${res.bic || '—'}`,
      ]
        .filter(Boolean)
        .join(' / ');

      const notes = Array.isArray(data.notes) ? data.notes.join(' ') : '';
      if (kyosoUrlNotes) {
        kyosoUrlNotes.textContent = [notes, resLine].filter(Boolean).join(' ');
      }

      enableKyosoSubmitIfUrlsReady();
      kyosoResult.hidden = true;
    } catch (err) {
      showError(kyosoError, err.message);
    } finally {
      setLoading(
        kyosoResolveUrls,
        false,
        'ランキング URL を自動取得（Gemini）',
        'URL 取得中...'
      );
    }
  });

  kyosoSaveUrls?.addEventListener('click', async () => {
    showError(kyosoError, '');
    const category = getKyosoCategory();
    if (!category) {
      showError(kyosoError, 'カテゴリを入力してください。');
      return;
    }
    const rankingUrls = getKyosoRankingUrlsFromForm();
    if (
      !rankingUrls.amazon &&
      !rankingUrls.rakuten &&
      !rankingUrls.yahoo &&
      !rankingUrls.kojima &&
      !rankingUrls.bic
    ) {
      showError(kyosoError, '保存する URL を1件以上入力してください。');
      return;
    }

    setLoading(kyosoSaveUrls, true, 'URLを保存', '保存中...');
    try {
      const data = await postJson('/api/category-ranking-urls', { category, rankingUrls });
      if (kyosoUrlPanel) kyosoUrlPanel.hidden = false;
      const savedDate = data.savedAt ? data.savedAt.slice(0, 10) : '—';
      setKyosoSavedHint(
        `URL を保存しました（${savedDate} / data/ranking-urls.json）。ランキングの「取得して、週次レポート用に保存する」でも自動使用されます。`
      );
      await CategorySelect.refresh({
        preferLabel: category,
        preferSelectId: 'kyoso-category',
      });
      CategorySelect.set('weekly-category', 'weekly-category-other', category);
    } catch (err) {
      showError(kyosoError, err.message);
    } finally {
      setLoading(kyosoSaveUrls, false, 'URLを保存', '保存中...');
    }
  });

  // category change handlers are bound in CategorySelect init above

  // --- 競合記事 URL ---
  const kyosoArticleList = document.getElementById('kyoso-article-url-list');
  const kyosoArticleSave = document.getElementById('kyoso-article-save');
  const kyosoArticleAdd = document.getElementById('kyoso-article-add');
  const kyosoArticleAnalyze = document.getElementById('kyoso-article-analyze');
  const kyosoArticleError = document.getElementById('kyoso-article-error');
  const kyosoArticleSavedHint = document.getElementById('kyoso-article-saved-hint');
  const kyosoArticleResult = document.getElementById('kyoso-article-result');
  const kyosoArticleMeta = document.getElementById('kyoso-article-meta');
  const kyosoArticleTbody = document.getElementById('kyoso-article-tbody');

  function setKyosoArticleSavedHint(message) {
    if (kyosoArticleSavedHint) kyosoArticleSavedHint.textContent = message || '';
  }

  function competitorArticleRowHtml(article = {}, index = 0) {
    const category =
      article.category ||
      (typeof getWeeklyCategory === 'function' ? getWeeklyCategory() : '') ||
      (typeof getKyosoCategory === 'function' ? getKyosoCategory() : '') ||
      '';
    return `<div class="competitor-article-row" data-index="${index}">
      <label class="field nested-field competitor-article-site">
        <span class="field-sub">サイト名</span>
        <input type="text" class="kyoso-article-site" placeholder="例: ビックカメラ" value="${escapeHtml(article.site || '')}" />
      </label>
      <label class="field nested-field competitor-article-category">
        <span class="field-sub">カテゴリ</span>
        <input type="text" class="kyoso-article-category" placeholder="例: 掃除機" value="${escapeHtml(category)}" />
      </label>
      <label class="field nested-field competitor-article-url">
        <span class="field-sub">記事 URL</span>
        <input type="url" class="kyoso-article-url" placeholder="https://..." value="${escapeHtml(article.url || '')}" />
      </label>
      <button type="button" class="secondary competitor-article-remove" title="行を削除">×</button>
    </div>`;
  }

  function renderCompetitorArticleRows(articles = []) {
    if (!kyosoArticleList) return;
    const category = getWeeklyCategory() || getKyosoCategory();
    const rows = articles.length
      ? articles
      : [
          { site: 'ビックカメラ', category, url: '' },
          { site: 'ヨドバシ', category, url: '' },
          { site: '価格.comマガジン', category, url: '' },
        ];
    kyosoArticleList.innerHTML = rows.map((a, i) => competitorArticleRowHtml(a, i)).join('');
    kyosoArticleList.querySelectorAll('.competitor-article-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('.competitor-article-row')?.remove();
        if (!kyosoArticleList.querySelector('.competitor-article-row')) {
          renderCompetitorArticleRows([]);
        }
      });
    });
  }

  function getCompetitorArticlesFromForm() {
    if (!kyosoArticleList) return [];
    const fallbackCategory = getKyosoCategory();
    return [...kyosoArticleList.querySelectorAll('.competitor-article-row')]
      .map((row) => ({
        site: row.querySelector('.kyoso-article-site')?.value.trim() || '',
        category:
          row.querySelector('.kyoso-article-category')?.value.trim() || fallbackCategory || '',
        url: row.querySelector('.kyoso-article-url')?.value.trim() || '',
      }))
      .filter((a) => a.url);
  }

  function competitorPriorityBadge(priority) {
    if (priority === 'high') return '<span class="weekly-badge weekly-badge-warn">高</span>';
    return '<span class="weekly-badge weekly-badge-info">中</span>';
  }

  function renderCompetitorAnalysisTable(data, tbody, metaEl) {
    const proposals = data?.proposals || [];
    const summary = data?.summary || {};
    if (metaEl) {
      const parts = [
        `自社見出し ${data.ownHeadingCount ?? 0}件`,
        `競合 ${summary.successCount ?? 0}/${summary.competitorCount ?? 0} 件取得`,
        `改修候補 ${summary.proposalCount ?? 0}件（高優先 ${summary.highPriorityCount ?? 0}）`,
      ];
      if (data.fetchedAt) {
        parts.push(`取得: ${new Date(data.fetchedAt).toLocaleString('ja-JP')}`);
      }
      metaEl.textContent = parts.join(' / ');
    }
    if (!tbody) return;
    if (!proposals.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="weekly-empty-cell">自社にない見出し候補はありません（または取得失敗）</td></tr>';
      return;
    }
    tbody.innerHTML = proposals
      .map(
        (p) => `<tr>
        <td>${competitorPriorityBadge(p.priority)}</td>
        <td>${escapeHtml(p.site)}</td>
        <td>${escapeHtml(p.heading)}</td>
        <td>${escapeHtml(p.level?.toUpperCase() || '')}</td>
        <td class="weekly-reason-cell">${escapeHtml(p.reason)}</td>
        <td><a href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener">参照</a></td>
      </tr>`
      )
      .join('');
  }

  function storeCompetitorAnalysis(category, data) {
    try {
      sessionStorage.setItem(
        COMPETITOR_ANALYSIS_KEY,
        JSON.stringify({ category, data, storedAt: Date.now() })
      );
    } catch {
      /* ignore */
    }
    // 見出し候補としても残す（週次・見出しタブが同じ rankingContext を読む）
    try {
      const prev = loadRankingContextFromStorage() || {};
      if (!prev.category || prev.category === category) {
        const merged = uniqueCandidateStrings([
          prev.pickedFeatures || [],
          data?.proposals || [],
          (data?.headingUpdates || [])
            .filter((u) => u.type === 'added' || u.change === 'added')
            .map((u) => u.heading),
        ]);
        saveRankingContextToStorage({
          ...prev,
          category,
          source: prev.source || 'competitor-articles',
          pickedFeatures: merged.map((headingCandidate, i) => ({
            id: `bridge-${i + 1}`,
            label: headingCandidate,
            headingCandidate,
          })),
          savedAt: new Date().toISOString(),
        });
      }
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent('competitor-analysis-updated', { detail: { category, data } })
    );
  }

  async function loadKyosoSavedCompetitorArticles() {
    const category =
      (typeof getWeeklyCategory === 'function' ? getWeeklyCategory() : '') ||
      getKyosoCategory();
    if (!category) {
      renderCompetitorArticleRows([]);
      setKyosoArticleSavedHint('');
      return;
    }
    try {
      const res = await fetch(
        `/api/competitor-articles?category=${encodeURIComponent(category)}`
      );
      const data = await res.json();
      if (data.saved && Array.isArray(data.articles)) {
        renderCompetitorArticleRows(data.articles);
        const savedDate = data.savedAt
          ? new Date(data.savedAt).toLocaleString('ja-JP')
          : '—';
        setKyosoArticleSavedHint(
          `保存済み競合記事 ${data.articles.length}件（${savedDate} / data/competitor-articles.json）`
        );
      } else {
        renderCompetitorArticleRows([]);
        setKyosoArticleSavedHint('');
      }
    } catch {
      renderCompetitorArticleRows([]);
    }
  }

  kyosoArticleAdd?.addEventListener('click', () => {
    if (!kyosoArticleList) return;
    const count = kyosoArticleList.querySelectorAll('.competitor-article-row').length;
    if (count >= 8) {
      showError(kyosoArticleError, '競合記事 URL は最大8件までです。');
      return;
    }
    showError(kyosoArticleError, '');
    kyosoArticleList.insertAdjacentHTML('beforeend', competitorArticleRowHtml({}, count));
    const lastRow = kyosoArticleList.lastElementChild;
    lastRow?.querySelector('.competitor-article-remove')?.addEventListener('click', () => {
      lastRow.remove();
    });
  });

  kyosoArticleSave?.addEventListener('click', async () => {
    showError(kyosoArticleError, '');
    const category = getWeeklyCategory() || getKyosoCategory();
    if (!category) {
      showError(kyosoArticleError, 'カテゴリを入力してください。');
      return;
    }
    const articles = getCompetitorArticlesFromForm();
    if (!articles.length) {
      showError(kyosoArticleError, '保存する記事 URL を1件以上入力してください。');
      return;
    }
    setLoading(kyosoArticleSave, true, '記事URLを保存', '保存中...');
    try {
      const data = await postJson('/api/competitor-articles', { category, articles });
      const savedDate = data.savedAt
        ? new Date(data.savedAt).toLocaleString('ja-JP')
        : '—';
      setKyosoArticleSavedHint(
        `競合記事 URL を保存しました（${savedDate} / data/competitor-articles.json）`
      );
      await CategorySelect.refresh({
        preferLabel: category,
        preferSelectId: 'weekly-category',
      });
      CategorySelect.set('weekly-category', 'weekly-category-other', category);
    } catch (err) {
      showError(kyosoArticleError, err.message);
    } finally {
      setLoading(kyosoArticleSave, false, '記事URLを保存', '保存中...');
    }
  });

  kyosoArticleAnalyze?.addEventListener('click', async () => {
    showError(kyosoArticleError, '');
    const category = getWeeklyCategory() || getKyosoCategory();
    if (!category) {
      showError(kyosoArticleError, 'カテゴリを入力してください。');
      return;
    }
    const articles = getCompetitorArticlesFromForm();
    setLoading(kyosoArticleAnalyze, true, '競合記事を取得・比較', '取得中…');
    if (kyosoArticleResult) kyosoArticleResult.hidden = true;
    try {
      const data = await postJson('/api/competitor-articles/analyze', {
        category,
        articles: articles.length ? articles : undefined,
      });
      renderCompetitorAnalysisTable(data, kyosoArticleTbody, kyosoArticleMeta);
      if (kyosoArticleResult) kyosoArticleResult.hidden = false;
      if (data.warnings?.length) {
        showError(
          kyosoArticleError,
          data.warnings.map((w) => `${w.site}: ${w.message}`).join('\n')
        );
      }
      storeCompetitorAnalysis(category, data);
    } catch (err) {
      showError(kyosoArticleError, err.message);
    } finally {
      setLoading(kyosoArticleAnalyze, false, '競合記事を取得・比較', '取得中…');
    }
  });

  renderCompetitorArticleRows([]);

  [
    'kyoso-url-amazon',
    'kyoso-url-rakuten',
    'kyoso-url-yahoo',
    'kyoso-url-kojima',
    'kyoso-url-bic',
  ].forEach(
    (id) => {
      document.getElementById(id)?.addEventListener('input', enableKyosoSubmitIfUrlsReady);
    }
  );

  formKyoso?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(kyosoError, '');

    const category = getKyosoCategory();
    if (!category) {
      showError(kyosoError, 'カテゴリを入力してください。');
      return;
    }

    const rankingUrls = getKyosoRankingUrlsFromForm();
    if (
      !rankingUrls.amazon &&
      !rankingUrls.rakuten &&
      !rankingUrls.yahoo &&
      !rankingUrls.kojima &&
      !rankingUrls.bic
    ) {
      showError(kyosoError, '先に「ランキング URL を自動取得」を実行するか、URL を入力してください。');
      return;
    }

    setLoading(kyosoSubmit, true, '① ランキング取得・横断比較', '取得中...');
    try {
      const data = await postJson('/api/extract-category-rankings', {
        category,
        rankingUrls,
      });

      const rows = [];
      const sources = Array.isArray(data.sources) ? data.sources : [];
      for (const block of sources) {
        const typeLabel = block.sourceType === 'mall' ? 'モール' : 'コジマネット';
        for (const item of block.items || []) {
          rows.push({
            typeLabel,
            sourceLabel: block.sourceLabel || '',
            rank: item.rank,
            manufacturer: item.manufacturer,
            model: item.model,
            href: item.href,
          });
        }
      }

      let meta = `カテゴリ: ${escapeHtml(data.category || category)}`;
      if (data.rankingUrls && typeof data.rankingUrls === 'object') {
        const res = data.urlResolution || {};
        const parts = [
          data.rankingUrls.amazon && `Amazon(${escapeHtml(res.amazon || '—')})`,
          data.rankingUrls.rakuten && `楽天(${escapeHtml(res.rakuten || '—')})`,
          data.rankingUrls.yahoo && `Yahoo(${escapeHtml(res.yahoo || '—')})`,
          data.rankingUrls.kojima && `コジマ(${escapeHtml(res.kojima || '—')})`,
          data.rankingUrls.bic && `ビック(${escapeHtml(res.bic || '—')})`,
        ].filter(Boolean);
        if (parts.length) meta += ` / URL解決: ${parts.join(' · ')}`;
      }
      if (data.csvDownloadUrl) {
        meta += ` / <a href="${escapeHtml(data.csvDownloadUrl)}" download="${escapeHtml(data.csvFilename || 'ranking.csv')}">サイト別 CSV</a>`;
      }
      if (data.compositeCsvDownloadUrl) {
        meta += ` / <a href="${escapeHtml(data.compositeCsvDownloadUrl)}" download="${escapeHtml(data.compositeCsvFilename || 'ranking-composite.csv')}">横断比較 CSV</a>`;
      }
      if (data.phase === 'themed_complete' && data.themedCsvDownloadUrl) {
        meta += ` / <a href="${escapeHtml(data.themedCsvDownloadUrl)}" download="${escapeHtml(data.themedCsvFilename || 'ranking-themed.csv')}">テーマ別 CSV</a>`;
      }
      if (data.rankingThemes?.length) {
        const themeLabels = data.rankingThemes.map((t, i) => {
          const tag = i === 0 ? '（総合・確定）' : '（選択）';
          return `${escapeHtml(t.label)}${tag}`;
        });
        meta += ` / テーマ: ${themeLabels.join(' · ')}`;
      } else if (data.phase === 'awaiting_theme_selection') {
        meta += ' / ④ 見出し候補からテーマ2・3を選択してください';
      }
      if (data.warnings?.length) {
        meta += ` / 警告: ${data.warnings.length}件`;
      }
      const diag = data.rankingDiagnostics || {};
      if (Array.isArray(data.urlNotes) && data.urlNotes.length) {
        meta += `<br><span class="field-hint">${escapeHtml(data.urlNotes.slice(0, 3).join(' '))}</span>`;
      }
      if (diag.recommendSaveOfficialUrls) {
        meta +=
          '<br><strong>推奨:</strong> ランキングで「ランキング URL を自動取得」→「URLを保存」すると、次回から安定して取得できます。';
      }
      if (diag.emptyReason) {
        meta += `<br><strong>空の理由:</strong> ${escapeHtml(diag.emptyReason)}`;
      }
      const sourceCounts = (data.sources || [])
        .map(
          (s) =>
            `${escapeHtml(s.sourceLabel || s.sourceId || '')}: ${escapeHtml(String(s.count ?? 0))}件` +
            (s.usedUnfilteredFallback ? '（フィルタ緩和）' : '')
        )
        .join(' · ');
      if (sourceCounts) {
        meta += `<br><span class="field-hint">取得件数: ${sourceCounts}</span>`;
      }
      kyosoMeta.innerHTML = meta;

      kyosoTbody.innerHTML = rows
        .map(
          (row) =>
            `<tr>
              <td>${escapeHtml(row.typeLabel)}</td>
              <td>${escapeHtml(row.sourceLabel)}</td>
              <td>${escapeHtml(row.rank)}</td>
              <td>${escapeHtml(row.manufacturer || '')}</td>
              <td>${escapeHtml(row.model || '')}</td>
              <td>${
                row.href
                  ? `<a href="${escapeHtml(row.href)}" target="_blank" rel="noopener">リンク</a>`
                  : '—'
              }</td>
            </tr>`
        )
        .join('');

      if (!rows.length) {
        kyosoTbody.innerHTML =
          '<tr><td colspan="6" class="weekly-empty-cell">商品が0件です。上の「空の理由」を確認し、公式ランキングURLを保存してから再取得してください。</td></tr>';
      }

      const compositeItems = data.compositeRanking?.items || [];
      const compositeStats = data.compositeRanking?.stats || {};
      if (kyosoCompositeMeta) {
        const parts = [
          `型番で集約: ${compositeStats.totalRows ?? compositeItems.length}件`,
        ];
        if (compositeStats.unknownModelCount > 0) {
          parts.push(`型番不明（除外）: ${compositeStats.unknownModelCount}件`);
        }
        kyosoCompositeMeta.textContent = parts.join(' / ');
      }
      if (kyosoCompositeTbody) {
        const rankCell = (n) => (n != null && n !== '' ? escapeHtml(String(n)) : '—');
        kyosoCompositeTbody.innerHTML = compositeItems
          .map(
            (row) =>
              `<tr>
                <td>${escapeHtml(row.modelKey || '')}</td>
                <td>${escapeHtml(row.manufacturer || '')}</td>
                <td>${rankCell(row.rankAmazon)}</td>
                <td>${rankCell(row.rankRakuten)}</td>
                <td>${rankCell(row.rankYahoo)}</td>
                <td>${rankCell(row.rankKojima)}</td>
                <td>${rankCell(row.rankBic)}</td>
                <td>${escapeHtml(row.siteCount ?? '')}</td>
                <td>${row.avgRank != null ? escapeHtml(String(row.avgRank)) : '—'}</td>
                <td>${escapeHtml(row.representativeModel || '')}</td>
              </tr>`
          )
          .join('');
      }

      renderKyosoThemedBlocks(data.themedRanking, data.themeTopLimit);

      saveKyosoPhase1Cache({
        category: data.category || category,
        compositeItems: data.compositeRanking?.items || [],
        themePresets: data.themePresets || [],
        pickedFeatures: data.pickedFeatures || [],
        suggestedThemeIds: data.suggestedThemeIds || [],
        themeTopLimit: data.themeTopLimit,
      });
      fillKyosoThemeSelectsFromFeatures(
        kyosoPhase1Cache.pickedFeatures,
        kyosoPhase1Cache.themePresets,
        kyosoPhase1Cache.suggestedThemeIds
      );
      setKyosoThemedMsg(
        kyosoThemeSelectPanel && !kyosoThemeSelectPanel.hidden
          ? 'テーマ2・3を選んで「見出し別ランキングを作成」を押すと、下に結果が表示されます。'
          : ''
      );

      const rankingCtx = {
        category: kyosoPhase1Cache.category,
        pickedFeatures: kyosoPhase1Cache.pickedFeatures,
        compositeItems: kyosoPhase1Cache.compositeItems,
        savedAt: Date.now(),
        source: 'kyoso',
      };
      saveRankingContextToStorage(rankingCtx);
      renderKyosoPickedFeatures(rankingCtx.pickedFeatures, rankingCtx.category);
      const headingsKw = document.getElementById('headings-keyword');
      if (headingsKw && !headingsKw.value.trim()) {
        applyRankingContextToHeadingsTab(rankingCtx);
      }

      if (data.warnings?.length) {
        const diagHint = data.rankingDiagnostics?.emptyReason
          ? `\n${data.rankingDiagnostics.emptyReason}`
          : data.rankingDiagnostics?.recommendSaveOfficialUrls
            ? '\n公式ランキングURLの保存を推奨します（このタブ上部の「ランキング URL を自動取得」→「URLを保存」）。'
            : '';
        showError(
          kyosoError,
          `一部の取得元で注意があります:\n${data.warnings
            .map((w) => `${w.source}: ${w.message}`)
            .join('\n')}${diagHint}`
        );
      }

      kyosoResult.hidden = false;
    } catch (err) {
      showError(kyosoError, err.message);
      kyosoResult.hidden = true;
    } finally {
      setLoading(kyosoSubmit, false, '① ランキング取得・横断比較', '取得中...');
    }
  });

  kyosoBuildThemed?.addEventListener('click', async () => {
    showKyosoThemedError('');
    setKyosoThemedMsg('');
    const phase1 = loadKyosoPhase1Cache();
    if (!phase1?.compositeItems?.length) {
      showKyosoThemedError('先に「① ランキング取得・横断比較」を実行してください。');
      return;
    }
    if (Array.isArray(phase1.themePresets) && phase1.themePresets.length) {
      kyosoThemePresets = phase1.themePresets;
    }

    const rankingThemes = getKyosoRankingThemesFromForm();
    const secondaryIds = rankingThemes
      .map((t) => t.id)
      .filter((id) => id && id !== 'overall');
    if (secondaryIds.length < 2) {
      showKyosoThemedError('需要分析の見出し候補から、テーマ2・3を選んでください。');
      return;
    }
    if (new Set(secondaryIds).size < 2) {
      showKyosoThemedError('テーマ2とテーマ3は異なる見出しを選んでください。');
      return;
    }

    setLoading(
      kyosoBuildThemed,
      true,
      '見出し別ランキングを作成（テーマ2・3）',
      '作成中...'
    );
    setKyosoThemedMsg('作成中…');
    try {
      const data = await postJson('/api/build-category-themed-rankings', {
        category: phase1.category,
        compositeItems: phase1.compositeItems,
        rankingThemes,
      });

      renderKyosoThemedBlocks(data.themedRanking, data.themeTopLimit);
      appendThemedCsvToMeta(kyosoMeta, data);

      if (data.rankingThemes?.length && kyosoMeta) {
        const base = kyosoMeta.innerHTML.replace(
          / \/ ④ 見出し候補からテーマ2・3を選択してください/,
          ''
        );
        const themeLabels = data.rankingThemes
          .map((t, i) => `${escapeHtml(t.label)}${i === 0 ? '（総合）' : '（選択）'}`)
          .join(' · ');
        kyosoMeta.innerHTML = base.includes('テーマ:')
          ? base
          : `${base} / テーマ: ${themeLabels}`;
      }

      const themeCount = data.themedRanking?.themes?.length || 0;
      const itemCounts = (data.themedRanking?.themes || [])
        .map((t) => `${t.label}:${(t.items || []).length}件`)
        .join(' · ');
      setKyosoThemedMsg(
        themeCount
          ? `作成しました（${itemCounts}）。結果は下に表示しています。`
          : '作成しましたが、表示できるテーマがありません。'
      );

      if (data.warnings?.length) {
        showKyosoThemedError(
          data.warnings.map((w) => `${w.source}: ${w.message}`).join('\n')
        );
      }

      kyosoThemedBlocks?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      showKyosoThemedError(err.message);
      setKyosoThemedMsg('');
    } finally {
      setLoading(
        kyosoBuildThemed,
        false,
        '見出し別ランキングを作成（テーマ2・3）',
        '作成中...'
      );
    }
  });

  document.getElementById('kyoso-reset')?.addEventListener('click', () => {
    formKyoso.reset();
    showError(kyosoError, '');
    showKyosoThemedError('');
    setKyosoThemedMsg('');
    kyosoResult.hidden = true;
    if (kyosoUrlPanel) kyosoUrlPanel.hidden = true;
    if (kyosoThemeSelectPanel) kyosoThemeSelectPanel.hidden = true;
    clearKyosoPhase1Cache();
    if (kyosoUrlNotes) kyosoUrlNotes.textContent = '';
    setKyosoSavedHint('');
    if (kyosoCompositeTbody) kyosoCompositeTbody.innerHTML = '';
    if (kyosoCompositeMeta) kyosoCompositeMeta.textContent = '';
    if (kyosoThemedBlocks) kyosoThemedBlocks.innerHTML = '';
    const featBlock = document.getElementById('kyoso-features-block');
    if (featBlock) featBlock.hidden = true;
    try {
      sessionStorage.removeItem(RANKING_CONTEXT_KEY);
    } catch {
      /* ignore */
    }
    kyosoThemePresets = [];
    for (const sel of kyosoThemeSelects) {
      if (sel) sel.innerHTML = '';
    }
    setKyosoRankingUrlsToForm({});
    if (kyosoSubmit) kyosoSubmit.disabled = true;
    CategorySelect.refresh().catch(() => {});
  });

  document.getElementById('kyoso-clear')?.addEventListener('click', () => {
    kyosoResult.hidden = true;
    showError(kyosoError, '');
    showKyosoThemedError('');
    setKyosoThemedMsg('');
    if (kyosoCompositeTbody) kyosoCompositeTbody.innerHTML = '';
    if (kyosoCompositeMeta) kyosoCompositeMeta.textContent = '';
    if (kyosoThemedBlocks) kyosoThemedBlocks.innerHTML = '';
    if (kyosoThemeSelectPanel) kyosoThemeSelectPanel.hidden = true;
    clearKyosoPhase1Cache();
  });

  document.getElementById('kyoso-to-headings')?.addEventListener('click', () => {
    applyRankingContextToHeadingsTab(loadRankingContextFromStorage());
    showTab('pillar-new');
  });

  // --- 見出し生成 ---
  const formHeadings = document.getElementById('form-headings');
  const headingsError = document.getElementById('headings-error');
  const headingsResult = document.getElementById('headings-result');
  const headingsWarnings = document.getElementById('headings-warnings');
  const headingsSubmit = document.getElementById('headings-submit');
  // applyHeadingsResultToArticleForm より前に宣言（同一スコープ）
  var lastHeadingsData = null;
  var lastHeadingsKeyword = '';

  function transferHeadingsToArticle() {
    const outline = readOutlineFromEditor('headings-outline-editor');
    if (outline?.length) {
      lastHeadingsData = {
        ...(lastHeadingsData || {}),
        outline,
        sections: outline.map((s) => ({
          h2: s.h2,
          subsections: s.subsections || s.items?.map((it) => it.h3) || [],
          items: s.items || [],
        })),
        title: lastHeadingsData?.title || '',
      };
    }
    if (!lastHeadingsData?.outline?.length && !outline?.length) {
      const status = document.getElementById('headings-bridge-msg');
      if (status) status.textContent = '先に見出しを生成してください。';
      return;
    }
    applyHeadingsResultToArticleForm();
    showTab('pillar-new');
    document.getElementById('panel-article')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  document.getElementById('headings-import-sources')?.addEventListener('click', () => {
    syncHeadingsTabFromSources({ force: true });
  });

  document.getElementById('headings-to-article')?.addEventListener('click', () => {
    transferHeadingsToArticle();
  });
  document.getElementById('headings-to-article-bottom')?.addEventListener('click', () => {
    transferHeadingsToArticle();
  });

  window.addEventListener('competitor-analysis-updated', () => {
    const active = resolveTabName(localStorage.getItem(TAB_KEY));
    if (active === 'pillar-new') {
      syncHeadingsTabFromSources({ force: false });
      syncArticleTabFromSources({ force: false });
    }
    if (active === 'pillar-rewrite') syncArticleTabFromSources({ force: false });
  });

  formHeadings?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(headingsError, '');
    const keyword = document.getElementById('headings-keyword').value.trim();
    if (!keyword) {
      showError(headingsError, 'キーワードを入力してください。');
      return;
    }

    setLoading(
      headingsSubmit,
      true,
      '見出しを生成（選びのポイント／人気メーカー）',
      '生成中...'
    );
    try {
      const headingCandidates = getHeadingCandidatesFromForm();
      const data = await postJson('/api/article/generate-headings', {
        keyword,
        headingCandidates,
        competitorUrl1: document.getElementById('headings-url1').value.trim(),
        competitorUrl2: document.getElementById('headings-url2').value.trim(),
        competitorUrl3: document.getElementById('headings-url3').value.trim(),
        referenceUrl: document.getElementById('headings-ref-url').value.trim(),
        autoDiscoverCompetitors: true,
      });
      lastHeadingsData = data;
      lastHeadingsKeyword = keyword;

      if (Array.isArray(data.discoveredCompetitorUrls) && data.discoveredCompetitorUrls.length) {
        fillHeadingsCompetitorUrls(
          (data.competitorUrlsUsed || []).map((url) => {
            const hit = data.discoveredCompetitorUrls.find((a) => a.url === url);
            return hit || { url };
          })
        );
        // 既存入力＋自動取得の最終URLも反映
        const used = data.competitorUrlsUsed || [];
        for (let i = 0; i < 3; i++) {
          const el = document.getElementById(`headings-url${i + 1}`);
          if (el && used[i]) el.value = used[i];
        }
        const dmsg = document.getElementById('headings-discover-msg');
        if (dmsg) {
          dmsg.textContent = `生成時に自動取得: ${(data.discoveredCompetitorUrls || [])
            .map((a) => a.site)
            .join(' / ')}`;
        }
      }

      renderWarnings(headingsWarnings, data.warnings);

      const outline =
        data.outline || normalizeClientOutline(keyword, data.sections);
      lastHeadingsData.outline = outline;
      const enableH4 = document.getElementById('headings-enable-h4');
      if (enableH4) enableH4.checked = false;
      syncHeadingsH4Ui(outline);
      const h4Msg = document.getElementById('headings-h4-msg');
      if (h4Msg) h4Msg.textContent = '';
      saveOutlineToStorage(outline, keyword, data.title || '', { enableH4: false });

      const headingsBody = document.getElementById('headings-body');
      if (headingsBody) {
        headingsBody.hidden = false;
        headingsBody.innerHTML = data.title
          ? `<div class="generated-block"><h3>タイトル案</h3><p>${escapeHtml(data.title)}</p></div>`
          : '';
      }
      headingsResult.hidden = false;
    } catch (err) {
      showError(headingsError, err.message);
      headingsResult.hidden = true;
    } finally {
      setLoading(
        headingsSubmit,
        false,
        '見出しを生成（選びのポイント／人気メーカー）',
        '生成中...'
      );
    }
  });

  document.getElementById('headings-discover-urls')?.addEventListener('click', () => {
    discoverCompetitorUrlsForHeadings();
  });

  document.getElementById('headings-reset')?.addEventListener('click', () => {
    formHeadings.reset();
    showError(headingsError, '');
    headingsResult.hidden = true;
    lastHeadingsData = null;
    lastHeadingsKeyword = '';
    const discoverMsg = document.getElementById('headings-discover-msg');
    if (discoverMsg) discoverMsg.textContent = '';
    const editor = document.getElementById('headings-outline-editor');
    if (editor) editor.innerHTML = '';
    const enableH4 = document.getElementById('headings-enable-h4');
    if (enableH4) enableH4.checked = false;
    const h4Actions = document.getElementById('headings-h4-actions');
    if (h4Actions) h4Actions.hidden = true;
    const h4Msg = document.getElementById('headings-h4-msg');
    if (h4Msg) h4Msg.textContent = '';
    if (window.DraftStore) {
      window.DraftStore.clear(window.DraftStore.KEYS.pillarNew);
      window.DraftStore.clearHint('pillar-new-draft-hint');
    }
    try {
      sessionStorage.removeItem(OUTLINE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  });

  document.getElementById('headings-enable-h4')?.addEventListener('change', () => {
    const current =
      readOutlineFromEditor('headings-outline-editor') || lastHeadingsData?.outline;
    syncHeadingsH4Ui(current);
    const msg = document.getElementById('headings-h4-msg');
    if (!msg) return;
    msg.textContent = isHeadingsH4Enabled()
      ? 'H4入力欄を表示しました。「このH3のH4を提案」または「全H3のH4を提案」で作成し、内容を確定してください。'
      : 'H4なしで進めます。記事生成では H3 本文のみ作成されます。';
  });

  document.getElementById('headings-outline-editor')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.outline-suggest-h4');
    if (!btn) return;
    if (!isHeadingsH4Enabled()) return;
    const si = Number(btn.dataset.sec);
    const hi = Number(btn.dataset.h3);
    const editor = document.getElementById('headings-outline-editor');
    const h3 =
      editor
        ?.querySelector(`.outline-h3-input[data-sec="${si}"][data-h3="${hi}"]`)
        ?.value.trim() || '';
    if (!h3) {
      showError(headingsError, 'H4を提案する前に、対象のH3を入力してください。');
      return;
    }
    const keyword =
      document.getElementById('headings-keyword')?.value.trim() || lastHeadingsKeyword;
    if (!keyword) {
      showError(headingsError, 'キーワードを入力してください。');
      return;
    }
    showError(headingsError, '');
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '提案中...';
    try {
      const result = await withH4SuggestGate(() =>
        suggestH4ForH3({ keyword, h3 })
      );
      fillH4Inputs(editor, si, hi, result.subheadings);
      const msg = document.getElementById('headings-h4-msg');
      if (msg) {
        const warn = formatWarningHint(result.warnings);
        msg.textContent = result.subheadings.length
          ? `「${h3}」の H4 を ${result.subheadings.length} 件提案しました。必要なら編集してから記事へ進んでください。${warn}`
          : `H4案が空でした。手動入力するか、別の観点で再提案してください。${warn}`;
      }
    } catch (err) {
      showError(headingsError, err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  });

  document.getElementById('headings-suggest-all-h4')?.addEventListener('click', async () => {
    if (!isHeadingsH4Enabled()) return;
    const editor = document.getElementById('headings-outline-editor');
    const outline = readOutlineFromEditor('headings-outline-editor');
    if (!outline?.length) {
      showError(headingsError, '先に H2／H3 見出しを生成してください。');
      return;
    }
    const keyword =
      document.getElementById('headings-keyword')?.value.trim() || lastHeadingsKeyword;
    if (!keyword) {
      showError(headingsError, 'キーワードを入力してください。');
      return;
    }
    const btn = document.getElementById('headings-suggest-all-h4');
    const msg = document.getElementById('headings-h4-msg');
    showError(headingsError, '');
    const targets = [];
    outline.forEach((sec, si) => {
      (sec.items || []).forEach((item, hi) => {
        if (item.h3) targets.push({ si, hi, h3: item.h3 });
      });
    });
    if (!targets.length) {
      showError(headingsError, 'H3 が空です。先に H3 を入力してください。');
      return;
    }
    const prevLabel = btn?.textContent || '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '一括提案中...';
    }
    try {
      const result = await withH4SuggestGate(() =>
        suggestH4ForH3List({
          keyword,
          h3List: targets.map((t) => t.h3),
        })
      );
      const byH3 = new Map(
        (result.items || []).map((item) => [
          String(item.h3 || '').trim(),
          (item.subheadings || [])
            .map((s) => String(s || '').trim())
            .filter(Boolean)
            .slice(0, MAX_OUTLINE_H4),
        ])
      );
      targets.forEach((t, index) => {
        const suggested =
          byH3.get(t.h3) ||
          (result.items?.[index]?.subheadings || [])
            .map((s) => String(s || '').trim())
            .filter(Boolean)
            .slice(0, MAX_OUTLINE_H4);
        fillH4Inputs(editor, t.si, t.hi, suggested);
      });
      if (msg) {
        const warn = formatWarningHint(result.warnings);
        msg.textContent = `全 ${targets.length} 件の H3 に H4 を提案しました。内容を確認・編集してから「見出し確定 → 記事生成へ」を押してください。${warn}`;
      }
    } catch (err) {
      showError(headingsError, err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel;
      }
    }
  });

  document.getElementById('headings-clear')?.addEventListener('click', () => {
    headingsResult.hidden = true;
    showError(headingsError, '');
  });

  document.getElementById('headings-copy')?.addEventListener('click', async () => {
    const msg = document.getElementById('headings-copy-msg');
    const outline =
      readOutlineFromEditor('headings-outline-editor') || lastHeadingsData?.outline;
    if (!outline?.length) return;
    const lines = [
      `キーワード: ${lastHeadingsKeyword}`,
      `タイトル: ${lastHeadingsData?.title || ''}`,
    ];
    outline.forEach((section, i) => {
      lines.push('');
      lines.push(`H2-${i + 1}: ${section.h2 || ''}`);
      (section.items || []).forEach((item, j) => {
        lines.push(`  H3-${j + 1}: ${item.h3 || ''}`);
        (item.h4s || [])
          .map((h) => String(h || '').trim())
          .filter(Boolean)
          .forEach((h4, k) => {
            lines.push(`    H4-${k + 1}: ${h4}`);
          });
      });
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      msg.textContent = 'クリップボードにコピーしました。';
      msg.hidden = false;
    } catch {
      msg.textContent = 'コピーに失敗しました。';
      msg.hidden = false;
    }
  });

  // --- 記事生成 ---
  const formArticle = document.getElementById('form-article');
  const articleError = document.getElementById('article-error');
  const articleResult = document.getElementById('article-result');
  const articleBody = document.getElementById('article-body');
  const articleWarnings = document.getElementById('article-warnings');
  const articleSubmit = document.getElementById('article-submit');

  // 保存済みアウトラインがあれば記事タブに復元
  (() => {
    const saved = loadOutlineFromStorage();
    if (!saved?.outline?.length) return;
    const editor = document.getElementById('article-outline-editor');
    if (!editor || editor.querySelector('.outline-section')) return;
    const showH4 = Boolean(saved.enableH4) || outlineHasAnyH4(saved.outline);
    renderOutlineEditor('article-outline-editor', saved.outline, {
      withH4: showH4,
      allowSuggest: false,
    });
    const kw = document.getElementById('article-keyword');
    if (kw && saved.keyword && !kw.value.trim()) kw.value = saved.keyword;
    const title = document.getElementById('article-title');
    if (title && saved.title && !title.value.trim()) title.value = saved.title;
  })();

  document.getElementById('article-import-sources')?.addEventListener('click', () => {
    syncArticleTabFromSources({ force: true });
  });

  document.getElementById('article-import-headings')?.addEventListener('click', () => {
    applyHeadingsResultToArticleForm();
  });

  function renderAeoChecklist(checklist) {
    const el = document.getElementById('article-aeo-checklist');
    if (!el) return;
    if (!Array.isArray(checklist) || !checklist.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const items = checklist
      .map((c) => {
        const pillar = String(c.pillar || '').toLowerCase();
        const tagClass =
          pillar === 'aeo'
            ? 'pillar-aeo'
            : pillar === 'geo'
              ? 'pillar-geo'
              : 'pillar-seo';
        const purpose = c.purpose
          ? `<span class="aeo-check-purpose">${escapeHtml(c.purpose)}</span>`
          : '';
        return `<li class="${c.ok ? 'ok' : 'ng'}">
          <span class="pillar-tag ${tagClass}">${escapeHtml(c.pillar || '')}</span>
          ${c.ok ? '✓' : '×'} ${escapeHtml(c.label || '')}
          ${purpose}
        </li>`;
      })
      .join('');
    el.innerHTML = `
      <h3>組み立てチェック（意図どおり揃っているか）</h3>
      <p class="field-hint aeo-check-lead">緑=揃っている / 赤=不足。タグは何のための項目かを示します。</p>
      <ul>${items}</ul>`;
    el.hidden = false;
  }

  function buildCmsHtmlFromArticle(data) {
    const images = collectArticleImages();
    const seoTitle = data.seoTitle || '';
    const meta = data.metaDescription || '';
    const direct = data.directAnswer || data.article?.directAnswer || '';
    const intro = data.introduction || data.article?.introduction || '';
    const summary = data.summary || data.article?.summary || '';
    const sections = data.sections || data.article?.sections || [];
    const faq = data.faq || data.article?.faq || [];
    const related = data.relatedLinks || data.article?.relatedLinks || [];
    const sources = data.sourcesNote || data.article?.sourcesNote || '';

    const used = new Set();
    const take = (placement, heading = '') => {
      const out = [];
      for (const img of images) {
        if (used.has(img)) continue;
        if (img.placement !== placement) continue;
        if (
          placement === 'after_h2' ||
          placement === 'after_h3' ||
          placement === 'after_h4'
        ) {
          const needle = String(img.afterHeading || '').trim();
          if (!needle) continue;
          if (!String(heading || '').includes(needle)) continue;
        }
        used.add(img);
        out.push(img);
      }
      return out;
    };

    const parts = [];
    parts.push('<!-- Requires zzb_special4.css (#fwCms_wrapper / #mainblock006479 / .commentblock / .image_box) -->');
    if (seoTitle) parts.push(`<!-- SEO title: ${escapeHtml(seoTitle)} -->`);
    if (meta) parts.push(`<!-- meta description: ${escapeHtml(meta)} -->`);
    parts.push('<div id="fwCms_wrapper">');
    parts.push('<div id="mainblock006479">');

    const h1 = data.title || data.article?.h1 || '';
    if (h1) parts.push(`<h1 class="top_title">${escapeHtml(h1)}</h1>`);

    for (const img of take('after_h1')) {
      parts.push(renderArticleFullOrLoneImage(img));
    }

    if (direct) parts.push(articleParagraphsHtml(direct));
    if (intro) parts.push(articleParagraphsHtml(intro));

    for (const img of take('after_intro')) {
      parts.push(renderArticleFullOrLoneImage(img));
    }

    let ank = 1;
    sections.forEach((sec) => {
      const h2 = String(sec.h2 || '').trim();
      const ankId = `ank${String(ank).padStart(2, '0')}`;
      ank += 1;
      if (h2) {
        parts.push(`<h2 class="title" id="${ankId}">${escapeHtml(h2)}</h2>`);
        for (const img of take('after_h2', h2)) {
          parts.push(renderArticleFullOrLoneImage(img));
        }
      }

      (sec.items || []).forEach((item) => {
        const h3 = String(item.h3 || '').trim();
        const content = String(item.content || '').trim();
        const sideImgs = h3 ? take('after_h3', h3) : [];
        if (h3) parts.push(`<h3>${escapeHtml(h3)}</h3>`);

        if (sideImgs.length && content) {
          const [first, ...rest] = sideImgs;
          parts.push(renderArticleImageTextBlock(first, articleParagraphsHtml(content)));
          rest.forEach((img) => parts.push(renderArticleFullOrLoneImage(img)));
        } else {
          if (content) parts.push(articleParagraphsHtml(content));
          sideImgs.forEach((img) => parts.push(renderArticleFullOrLoneImage(img)));
        }

        (item.h4_items || []).forEach((h4item) => {
          const h4 = String(h4item.h4 || '').trim();
          const h4content = String(h4item.content || '').trim();
          const h4Imgs = h4 ? take('after_h4', h4) : [];
          if (h4) parts.push(`<h4>${escapeHtml(h4)}</h4>`);
          if (h4Imgs.length && h4content) {
            const [first, ...rest] = h4Imgs;
            parts.push(renderArticleImageTextBlock(first, articleParagraphsHtml(h4content)));
            rest.forEach((img) => parts.push(renderArticleFullOrLoneImage(img)));
          } else {
            if (h4content) parts.push(articleParagraphsHtml(h4content));
            h4Imgs.forEach((img) => parts.push(renderArticleFullOrLoneImage(img)));
          }
        });
      });
    });

    for (const img of take('before_summary')) {
      parts.push(renderArticleFullOrLoneImage(img));
    }
    if (summary) {
      parts.push('<h2 class="title">まとめ</h2>');
      parts.push(articleParagraphsHtml(summary));
    }

    for (const img of take('before_faq')) {
      parts.push(renderArticleFullOrLoneImage(img));
    }
    if (faq.length) {
      parts.push('<h2 class="title">よくある質問</h2>');
      faq.forEach((q) => {
        parts.push(`<h3>${escapeHtml(q.question)}</h3>`);
        parts.push(articleParagraphsHtml(q.answer));
      });
    }

    if (related.length) {
      parts.push('<h2 class="title">関連記事（候補）</h2>');
      parts.push('<ul class="listmark_m">');
      related.forEach((r) => {
        parts.push(
          `<li>${escapeHtml(r.anchor)}${r.hint ? ` — ${escapeHtml(r.hint)}` : ''}</li>`
        );
      });
      parts.push('</ul>');
    }
    if (sources) {
      parts.push(
        `<p class="pc_font12 pc_mb20"><small>${escapeHtml(sources)}</small></p>`
      );
    }

    for (const img of take('before_end')) {
      parts.push(renderArticleFullOrLoneImage(img));
    }
    // 未使用（見出し不一致など）は末尾に全幅で出す
    images.forEach((img) => {
      if (used.has(img)) return;
      used.add(img);
      parts.push(renderArticleFullOrLoneImage(img));
    });

    parts.push('</div><!-- /#mainblock006479 -->');
    parts.push('</div><!-- /#fwCms_wrapper -->');
    return parts.join('\n');
  }

  function setArticleCmsOutput(data) {
    const html = buildCmsHtmlFromArticle(data);
    const htmlOut = document.getElementById('article-html-output');
    const preview = document.getElementById('article-cms-preview');
    if (htmlOut) {
      htmlOut.value = html;
      htmlOut.hidden = false;
    }
    if (preview) {
      preview.innerHTML = html;
      preview.hidden = false;
    }
    return html;
  }

  let articleImageSeq = 0;
  const ARTICLE_IMAGE_PLACEMENTS = [
    { value: 'after_h1', label: 'TOP（H1の直後）' },
    { value: 'after_intro', label: '導入文の後' },
    { value: 'after_h2', label: '指定H2の後' },
    { value: 'after_h3', label: '指定H3と本文を左右配置' },
    { value: 'after_h4', label: '指定H4と本文を左右配置' },
    { value: 'before_summary', label: 'まとめの前' },
    { value: 'before_faq', label: 'FAQの前' },
    { value: 'before_end', label: '末尾' },
  ];
  const ARTICLE_IMAGE_SIZES = [
    { value: 'side_40', label: '左40% / 右本文60%' },
    { value: 'full', label: '全幅' },
  ];
  const ARTICLE_SIZE_PRESETS = {
    side_40: { image: 'pc_w40per', text: 'pc_w60per', imageFirst: true, layout: 'side' },
    full: { image: 'pc_w100per', text: null, imageFirst: true, layout: 'full' },
  };

  function articlePlacementOptions(selected) {
    return ARTICLE_IMAGE_PLACEMENTS.map(
      (o) =>
        `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`
    ).join('');
  }
  function articleSizeOptions(selected) {
    return ARTICLE_IMAGE_SIZES.map(
      (o) =>
        `<option value="${o.value}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`
    ).join('');
  }

  function syncArticleImageHeadingField(row) {
    const placement = row.querySelector('.article-img-placement')?.value;
    const wrap = row.querySelector('.article-img-heading-wrap');
    if (!wrap) return;
    wrap.hidden = !['after_h2', 'after_h3', 'after_h4'].includes(placement);
  }

  function addArticleImageRow(prefill) {
    const list = document.getElementById('article-images-list');
    if (!list) return;
    articleImageSeq += 1;
    const row = document.createElement('div');
    row.className = 'article-image-row';
    row.innerHTML = `
      <div class="article-image-grid">
        <label class="field">
          <span>画像URL</span>
          <input type="url" class="article-img-url" placeholder="https://" />
        </label>
        <label class="field">
          <span>代替テキスト</span>
          <input type="text" class="article-img-alt" placeholder="例: 集じん方式のイメージ" />
        </label>
        <label class="field">
          <span>挿入位置</span>
          <select class="article-img-placement">${articlePlacementOptions(
            prefill?.placement || 'after_h3'
          )}</select>
        </label>
        <label class="field">
          <span>サイズ</span>
          <select class="article-img-size">${articleSizeOptions(
            prefill?.size || 'side_40'
          )}</select>
        </label>
        <label class="field article-img-heading-wrap" hidden>
          <span>対象見出し（部分一致）</span>
          <input type="text" class="article-img-after-heading" placeholder="例: 集じん方法 / 選びのポイント" />
        </label>
        <label class="field">
          <span>参照ラベル（任意）</span>
          <input type="text" class="article-img-ref-label" placeholder="例: パナソニック" />
        </label>
        <label class="field">
          <span>参照URL（任意）</span>
          <input type="url" class="article-img-ref-url" placeholder="https://" />
        </label>
      </div>
      <div class="actions">
        <button type="button" class="secondary article-img-remove">この行を削除</button>
      </div>`;
    list.appendChild(row);
    row.querySelector('.article-img-remove')?.addEventListener('click', () => {
      row.remove();
      if (lastArticleData) setArticleCmsOutput(lastArticleData);
    });
    row
      .querySelector('.article-img-placement')
      ?.addEventListener('change', () => {
        syncArticleImageHeadingField(row);
        if (lastArticleData) setArticleCmsOutput(lastArticleData);
      });
    if (prefill) {
      if (prefill.url) row.querySelector('.article-img-url').value = prefill.url;
      if (prefill.alt) row.querySelector('.article-img-alt').value = prefill.alt;
      if (prefill.placement) row.querySelector('.article-img-placement').value = prefill.placement;
      if (prefill.size) row.querySelector('.article-img-size').value = prefill.size;
      if (prefill.afterHeading) {
        row.querySelector('.article-img-after-heading').value = prefill.afterHeading;
      }
      if (prefill.refLabel) row.querySelector('.article-img-ref-label').value = prefill.refLabel;
      if (prefill.refUrl) row.querySelector('.article-img-ref-url').value = prefill.refUrl;
    }
    syncArticleImageHeadingField(row);
    if (lastArticleData) setArticleCmsOutput(lastArticleData);
  }

  function collectArticleImages() {
    const out = [];
    document.querySelectorAll('#article-images-list .article-image-row').forEach((row) => {
      const url = String(row.querySelector('.article-img-url')?.value || '').trim();
      if (!url) return;
      out.push({
        url,
        alt: String(row.querySelector('.article-img-alt')?.value || '').trim(),
        placement: row.querySelector('.article-img-placement')?.value || 'after_h3',
        size: row.querySelector('.article-img-size')?.value || 'side_40',
        afterHeading: String(row.querySelector('.article-img-after-heading')?.value || '').trim(),
        refLabel: String(row.querySelector('.article-img-ref-label')?.value || '').trim(),
        refUrl: String(row.querySelector('.article-img-ref-url')?.value || '').trim(),
      });
    });
    return out;
  }

  function articleParagraphsHtml(text) {
    return String(text || '')
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map(
        (p) =>
          `<p class="pc_mb20">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`
      )
      .join('\n');
  }

  function renderArticleImageInner(img) {
    const alt = escapeHtml(img.alt || '');
    const src = escapeHtml(img.url);
    let html = `<p class="img_area"><img alt="${alt}" class="pc_w100per" src="${src}"></p>`;
    if (img.refLabel || img.refUrl) {
      const label = escapeHtml(img.refLabel || img.refUrl);
      const ref = img.refUrl
        ? `参照：<a target="_blank" rel="noopener" title="" href="${escapeHtml(img.refUrl)}">${label}</a>`
        : `参照：${label}`;
      html += `<span class="ref pc_font12 sp_font12">${ref}</span>`;
    }
    return html;
  }

  function renderArticleImageTextBlock(img, textHtml) {
    const preset = ARTICLE_SIZE_PRESETS[img.size] || ARTICLE_SIZE_PRESETS.side_40;
    if (preset.layout === 'full') {
      return `${renderArticleFullOrLoneImage(img)}\n${textHtml}`;
    }
    const imgCol = `<div class="block2 ${preset.image} sp_w90per image_box pc_tac">${renderArticleImageInner(
      img
    )}</div>`;
    const textCol = `<div class="block2 ${preset.text} sp_w95per">${textHtml}</div>`;
    const inner = preset.imageFirst ? `${imgCol}\n${textCol}` : `${textCol}\n${imgCol}`;
    return `<div class="commentblock pc_mb30">\n${inner}\n</div>`;
  }

  function renderArticleFullOrLoneImage(img) {
    const preset = ARTICLE_SIZE_PRESETS[img.size] || ARTICLE_SIZE_PRESETS.full;
    if (preset.layout === 'side') {
      // 単独挿入時は画像カラムのみ
      return `<div class="commentblock pc_mb30"><div class="block2 ${preset.image} sp_w90per image_box pc_tac">${renderArticleImageInner(
        img
      )}</div></div>`;
    }
    return `<div class="image_box pc_tac pc_mb30">${renderArticleImageInner(img)}</div>`;
  }

  function clearArticleImagesList() {
    const list = document.getElementById('article-images-list');
    if (list) list.innerHTML = '';
  }

  function clearArticleCmsOutput() {
    const htmlOut = document.getElementById('article-html-output');
    const preview = document.getElementById('article-cms-preview');
    if (htmlOut) {
      htmlOut.value = '';
      htmlOut.hidden = true;
    }
    if (preview) {
      preview.innerHTML = '';
      preview.hidden = true;
    }
  }

  function renderOutlineArticleResult(data) {
    const intro = data.introduction || data.article?.introduction || '';
    const summary = data.summary || data.article?.summary || '';
    const sections = data.sections || data.article?.sections || [];
    const direct = data.directAnswer || data.article?.directAnswer || '';
    const seoTitle = data.seoTitle || '';
    const meta = data.metaDescription || '';
    const faq = data.faq || data.article?.faq || [];
    const related = data.relatedLinks || data.article?.relatedLinks || [];
    const sources = data.sourcesNote || data.article?.sourcesNote || '';
    let html = '';
    if (data.mode === 'rewrite') {
      html += `<div class="generated-block"><h3>リライト結果</h3>
        <p class="field-hint">元URL: ${escapeHtml(data.rewriteSourceUrl || '')}</p></div>`;
    }
    if (seoTitle || meta) {
      html += `<div class="generated-block"><h3><span class="pillar-tag pillar-seo">SEO</span> タイトル／メタ候補</h3>
        <p class="field-hint">検索結果に出す表示用。クリックされやすい要約を意図しています。</p>`;
      if (seoTitle) html += `<p><strong>title:</strong> ${escapeHtml(seoTitle)}</p>`;
      if (meta) html += `<p><strong>description:</strong> ${escapeHtml(meta)}</p>`;
      html += `</div>`;
    }
    if (data.title || data.article?.h1) {
      html += `<div class="generated-block"><h3>タイトル（H1）</h3><p>${escapeHtml(data.title || data.article?.h1 || '')}</p></div>`;
    }
    if (direct) {
      html += `<div class="generated-block"><h3><span class="pillar-tag pillar-aeo">AEO</span> 直接回答</h3>
        <p class="field-hint">検索クエリへの一文答え。AI Overview 等が抜き出しやすい位置に置きます。</p>
        <div class="direct-answer-block generated-text">${paragraphsHtml(direct)}</div></div>`;
    }
    if (intro) {
      html += `<div class="generated-block"><h3><span class="pillar-tag pillar-seo">SEO</span> 導入文</h3>
        <p class="field-hint">続きを読む導線。直接回答のあとに詳しく説明する想定です。</p>
        <div class="generated-text">${paragraphsHtml(intro)}</div></div>`;
    }
    sections.forEach((sec) => {
      const intent = sec.searchIntent
        ? ` <span class="intent-badge">${escapeHtml(sec.searchIntent)}</span>`
        : '';
      html += `<div class="generated-block section-block"><h3>${escapeHtml(sec.h2 || '')}${intent}</h3>
        <p class="field-hint">各見出し本文の冒頭に答えの1文を自然に置きます（AEO向け。「結論:」ラベルは付けません）。意図タグは SEO/GEO の切り口固定です。</p>`;
      (sec.items || []).forEach((item) => {
        html += `<div class="generated-block"><h4>${escapeHtml(item.h3 || '')}</h4>`;
        if (item.content) {
          html += `<div class="generated-text">${paragraphsHtml(item.content)}</div>`;
        }
        (item.h4_items || []).forEach((h4item) => {
          html += `<div class="generated-block outline-h4-result"><h5>${escapeHtml(h4item.h4 || '')}</h5>`;
          if (h4item.content) {
            html += `<div class="generated-text">${paragraphsHtml(h4item.content)}</div>`;
          }
          html += '</div>';
        });
        html += '</div>';
      });
      html += '</div>';
    });
    if (summary) {
      html += `<div class="generated-block"><h3><span class="pillar-tag pillar-seo">SEO</span> / <span class="pillar-tag pillar-geo">GEO</span> まとめ</h3>
        <p class="field-hint">記事の要点再提示。引用・要約の材料にもなります。</p>
        <div class="generated-text">${paragraphsHtml(summary)}</div></div>`;
    }
    if (faq.length) {
      html += `<div class="generated-block"><h3><span class="pillar-tag pillar-aeo">AEO</span> FAQ</h3>
        <p class="field-hint">よくある質問単位で答えを渡すためのブロックです。</p>`;
      faq.forEach((q) => {
        html += `<div class="generated-block"><h4>${escapeHtml(q.question)}</h4><div class="generated-text">${paragraphsHtml(q.answer)}</div></div>`;
      });
      html += `</div>`;
    }
    if (related.length) {
      html += `<div class="generated-block"><h3><span class="pillar-tag pillar-seo">SEO</span> 内部リンク候補</h3>
        <p class="field-hint">同カテゴリ・関連意図への回遊用（CMSで実URLに差し替え）。</p><ul>`;
      related.forEach((r) => {
        html += `<li><strong>${escapeHtml(r.anchor)}</strong>${r.hint ? ` — ${escapeHtml(r.hint)}` : ''}</li>`;
      });
      html += `</ul></div>`;
    }
    if (sources) {
      html += `<div class="generated-block"><h3><span class="pillar-tag pillar-geo">GEO</span> 出典・更新メモ</h3>
        <p class="field-hint">生成AIが根拠付きで扱いやすい注記です。架空の日付は付けません。</p>
        <div class="generated-text">${paragraphsHtml(sources)}</div></div>`;
    }
    return html;
  }

  let lastArticleData = null;
  let articleOutlineFlexible = false;

  function isArticleRewriteMode() {
    return Boolean(document.getElementById('article-mode-rewrite')?.checked);
  }

  function syncArticleModeUi() {
    const rewrite = isArticleRewriteMode();
    const panel = document.getElementById('panel-article');
    if (panel) panel.dataset.articleMode = rewrite ? 'rewrite' : 'create';

    const createDesc = document.getElementById('article-mode-desc-create');
    const rewriteDesc = document.getElementById('article-mode-desc-rewrite');
    const modeField = document.getElementById('article-mode-field');
    const createActions = document.getElementById('article-create-actions');
    const createUrls = document.getElementById('article-create-urls');
    const bridgeMsg = document.getElementById('article-bridge-msg');
    const rewriteFields = document.getElementById('article-rewrite-fields');
    const outlineHint = document.getElementById('article-outline-hint');
    const submitBtn = document.getElementById('article-submit');

    // モード切替UIはメニュー分離後は常に非表示
    if (modeField) modeField.hidden = true;
    if (createDesc) createDesc.hidden = rewrite;
    if (rewriteDesc) rewriteDesc.hidden = !rewrite;
    if (createActions) createActions.hidden = rewrite;
    if (createUrls) createUrls.hidden = rewrite;
    if (bridgeMsg) {
      bridgeMsg.hidden = rewrite || !bridgeMsg.textContent.trim();
      if (rewrite) bridgeMsg.textContent = '';
    }
    if (rewriteFields) rewriteFields.hidden = !rewrite;
    if (outlineHint) {
      outlineHint.textContent = rewrite
        ? 'リライト元から取り込み、良い見出しは改善した案です。必要なら戻・微修正してから本文を生成してください。'
        : 'H4 の有無は上の見出し欄で指定済みです。ここでは誤字などの微修正のみ行い、本文を生成します。';
    }
    if (submitBtn) {
      submitBtn.textContent = rewrite
        ? 'リライト本文を生成'
        : '確定した見出しで記事を生成';
    }
  }

  document.querySelectorAll('input[name="article-mode"]').forEach((el) => {
    el.addEventListener('change', () => {
      syncArticleModeUi();
      showError(articleError, '');
    });
  });
  syncArticleModeUi();

  document.getElementById('article-extract-outline')?.addEventListener('click', async () => {
    const btn = document.getElementById('article-extract-outline');
    const msg = document.getElementById('article-rewrite-msg');
    const url = document.getElementById('article-rewrite-url')?.value.trim();
    showError(articleError, '');
    if (msg) msg.textContent = '';
    if (!url) {
      showError(articleError, 'リライト元URLを入力してください。');
      return;
    }
    setLoading(btn, true, '構成を取り込み（見出し改善）', '改善中...');
    try {
      const data = await postJson('/api/article/extract-outline-from-url', {
        url,
        keyword: document.getElementById('article-keyword')?.value.trim() || '',
      });
      const outline = normalizeFlexibleOutline(data.outline || []);
      if (!outline.length) {
        throw new Error('構成を取得できませんでした。');
      }
      articleOutlineFlexible = true;
      if (data.keyword && !document.getElementById('article-keyword')?.value.trim()) {
        document.getElementById('article-keyword').value = data.keyword;
      }
      if (data.title) {
        document.getElementById('article-title').value = data.title;
      }
      const kw = document.getElementById('article-keyword')?.value.trim() || data.keyword || '';
      renderOutlineEditor('article-outline-editor', outline, {
        withH4: true,
        allowSuggest: false,
        flexible: true,
      });
      saveOutlineToStorage(outline, kw, data.title || '', {
        enableH4: true,
        mode: 'rewrite',
        rewriteSourceUrl: url,
      });
      if (msg) {
        const warn = formatWarningHint(data.warnings);
        msg.textContent = `構成を取り込み、見出し改善案を反映しました（${data.method || 'ai-improved'}）。確認して本文を生成してください。${warn}`;
      }
    } catch (err) {
      showError(articleError, err.message);
      if (msg) msg.textContent = '';
    } finally {
      setLoading(btn, false, '構成を取り込み（見出し改善）', '改善中...');
    }
  });

  formArticle?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(articleError, '');

    const rewrite = isArticleRewriteMode();
    const keyword = document.getElementById('article-keyword').value.trim();
    if (!keyword) {
      showError(articleError, 'キーワードを入力してください。');
      return;
    }

    const rewriteUrl = document.getElementById('article-rewrite-url')?.value.trim() || '';
    if (rewrite && !rewriteUrl) {
      showError(articleError, 'リライト元URLを入力してください。');
      return;
    }

    const outline = readOutlineFromEditor('article-outline-editor');
    const sections = outlineToApiSections(outline);
    if (!sections.length) {
      showError(
        articleError,
        rewrite
          ? '見出しが空です。リライト元URLから構成を取り込んでください。'
          : '見出しが空です。記事コンテンツ（新規）で見出しを確定してから引き継いでください。'
      );
      return;
    }

    saveOutlineToStorage(
      outline,
      keyword,
      document.getElementById('article-title')?.value.trim() || '',
      {
        enableH4: outlineHasAnyH4(outline),
        mode: rewrite ? 'rewrite' : 'create',
        rewriteSourceUrl: rewriteUrl,
      }
    );

    const submitLabel = rewrite ? 'リライト本文を生成' : '確定した見出しで記事を生成';
    setLoading(articleSubmit, true, submitLabel, '生成中...');
    try {
      const payload = {
        keyword,
        title: document.getElementById('article-title').value.trim(),
        sections,
        generateIntroduction: Boolean(document.getElementById('article-gen-intro')?.checked),
        generateSummary: Boolean(document.getElementById('article-gen-summary')?.checked),
        generateAeoPack: Boolean(document.getElementById('article-gen-aeo')?.checked),
        generateFaq: Boolean(document.getElementById('article-gen-faq')?.checked),
      };
      if (rewrite) {
        payload.mode = 'rewrite';
        payload.rewriteSourceUrl = rewriteUrl;
        payload.referenceUrl = rewriteUrl;
        payload.skipScrape = false;
        payload.useArticleContext = true;
      } else {
        payload.mode = 'outline';
        payload.competitorUrl1 = document.getElementById('article-url1').value.trim();
        payload.competitorUrl2 = document.getElementById('article-url2').value.trim();
        payload.competitorUrl3 = document.getElementById('article-url3').value.trim();
        payload.referenceUrl = document.getElementById('article-ref-url').value.trim();
        payload.skipScrape = true;
      }

      const data = await postJson('/api/article/generate', payload);

      lastArticleData = data;
      renderWarnings(articleWarnings, data.warnings);
      renderAeoChecklist(data.aeoChecklist);
      articleBody.innerHTML = renderOutlineArticleResult(data);
      setArticleCmsOutput(data);
      articleResult.hidden = false;
      if (typeof flushArticleDraftForCurrentMode === 'function') {
        flushArticleDraftForCurrentMode();
      }
    } catch (err) {
      showError(articleError, err.message);
      articleResult.hidden = true;
      lastArticleData = null;
    } finally {
      setLoading(articleSubmit, false, submitLabel, '生成中...');
    }
  });

  document.getElementById('article-add-image')?.addEventListener('click', () => {
    addArticleImageRow();
  });

  document.getElementById('article-images-list')?.addEventListener('change', () => {
    if (lastArticleData) setArticleCmsOutput(lastArticleData);
  });
  document.getElementById('article-images-list')?.addEventListener('input', () => {
    if (lastArticleData) setArticleCmsOutput(lastArticleData);
  });

  document.getElementById('article-copy-html')?.addEventListener('click', async () => {
    const htmlOut = document.getElementById('article-html-output');
    const msg = document.getElementById('article-copy-msg');
    const text = lastArticleData
      ? setArticleCmsOutput(lastArticleData)
      : String(htmlOut?.value || '').trim();
    if (!text) {
      if (msg) {
        msg.hidden = false;
        msg.textContent = 'コピーするHTMLがありません。先に記事を生成してください。';
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (msg) {
        msg.hidden = false;
        msg.textContent = 'CMS用HTMLをコピーしました。';
      }
    } catch {
      if (htmlOut) {
        htmlOut.hidden = false;
        htmlOut.select();
      }
      if (msg) {
        msg.hidden = false;
        msg.textContent = '自動コピーに失敗しました。下のテキストを手動でコピーしてください。';
      }
    }
  });

  document.getElementById('article-reset')?.addEventListener('click', () => {
    formArticle.reset();
    showError(articleError, '');
    articleResult.hidden = true;
    clearArticleImagesList();
    clearArticleCmsOutput();
    lastArticleData = null;
    articleOutlineFlexible = false;
    const rewriteMsg = document.getElementById('article-rewrite-msg');
    if (rewriteMsg) rewriteMsg.textContent = '';
    const activeTab = resolveTabName(localStorage.getItem(TAB_KEY));
    setArticleMode(activeTab === 'pillar-rewrite' ? 'rewrite' : 'create');
    const editor = document.getElementById('article-outline-editor');
    if (editor) {
      editor.innerHTML = isArticleRewriteMode()
        ? '<p class="field-hint">リライト元URLから「構成を取り込み」を実行してください。</p>'
        : '<p class="field-hint">上の見出し欄で見出しを確定し、「本文へ」を押してください。</p>';
    }
    if (window.DraftStore) {
      if (isArticleRewriteMode()) {
        window.DraftStore.clear(window.DraftStore.KEYS.pillarRewrite);
      } else {
        // 本文リセット時は新規下書きの記事部分だけ消すため再保存で空記事を書く
        const DS = window.DraftStore;
        const prev = DS.load(DS.KEYS.pillarNew) || {};
        DS.save(DS.KEYS.pillarNew, {
          ...prev,
          article: null,
          articleOutline: [],
          articleKeyword: '',
          articleTitle: '',
        });
      }
      window.DraftStore.clearHint('article-draft-hint');
    }
  });

  document.getElementById('article-clear')?.addEventListener('click', () => {
    articleResult.hidden = true;
    showError(articleError, '');
    if (articleBody) articleBody.innerHTML = '';
    lastArticleData = null;
    renderAeoChecklist([]);
    clearArticleCmsOutput();
    if (typeof schedulePillarDraftSave === 'function') schedulePillarDraftSave();
  });

  // --- 下書き（localStorage・各画面最新1件） ---
  const DS = window.DraftStore;
  let restoringArticleDraft = false;
  let pillarDraftsHydrated = false;

  function val(id) {
    return document.getElementById(id)?.value ?? '';
  }
  function setVal(id, v) {
    const el = document.getElementById(id);
    if (el && v != null) el.value = String(v);
  }
  function checked(id) {
    return Boolean(document.getElementById(id)?.checked);
  }
  function setChecked(id, v) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(v);
  }

  function collectArticleFormSnapshot() {
    return {
      keyword: val('article-keyword').trim(),
      title: val('article-title').trim(),
      rewriteUrl: val('article-rewrite-url').trim(),
      url1: val('article-url1').trim(),
      url2: val('article-url2').trim(),
      url3: val('article-url3').trim(),
      refUrl: val('article-ref-url').trim(),
      genIntro: checked('article-gen-intro'),
      genSummary: checked('article-gen-summary'),
      genAeo: checked('article-gen-aeo'),
      genFaq: checked('article-gen-faq'),
      images: typeof collectArticleImages === 'function' ? collectArticleImages() : [],
      outline:
        typeof readOutlineFromEditor === 'function'
          ? readOutlineFromEditor('article-outline-editor')
          : [],
      outlineFlexible: Boolean(articleOutlineFlexible),
      lastArticleData: lastArticleData || null,
      resultVisible: Boolean(articleResult && !articleResult.hidden),
    };
  }

  function applyArticleFormSnapshot(snap, { flexible = false } = {}) {
    if (!snap || typeof snap !== 'object') return;
    restoringArticleDraft = true;
    try {
      setVal('article-keyword', snap.keyword || '');
      setVal('article-title', snap.title || '');
      setVal('article-rewrite-url', snap.rewriteUrl || '');
      setVal('article-url1', snap.url1 || '');
      setVal('article-url2', snap.url2 || '');
      setVal('article-url3', snap.url3 || '');
      setVal('article-ref-url', snap.refUrl || '');
      setChecked('article-gen-intro', snap.genIntro);
      setChecked('article-gen-summary', snap.genSummary);
      if (snap.genAeo != null) setChecked('article-gen-aeo', snap.genAeo);
      if (snap.genFaq != null) setChecked('article-gen-faq', snap.genFaq);
      clearArticleImagesList();
      (snap.images || []).forEach((img) => addArticleImageRow(img));
      articleOutlineFlexible = Boolean(snap.outlineFlexible || flexible);
      const outline = snap.outline || [];
      if (outline.length) {
        const showH4 = outlineHasAnyH4(outline);
        renderOutlineEditor('article-outline-editor', outline, {
          withH4: showH4,
          allowSuggest: false,
          flexible: articleOutlineFlexible,
        });
      }
      lastArticleData = snap.lastArticleData || null;
      if (lastArticleData && articleBody) {
        renderWarnings(articleWarnings, lastArticleData.warnings);
        renderAeoChecklist(lastArticleData.aeoChecklist);
        articleBody.innerHTML = renderOutlineArticleResult(lastArticleData);
        setArticleCmsOutput(lastArticleData);
        if (articleResult) articleResult.hidden = !snap.resultVisible;
      } else if (articleResult) {
        articleResult.hidden = true;
      }
    } finally {
      restoringArticleDraft = false;
    }
  }

  function collectHeadingsSnapshot() {
    return {
      keyword: val('headings-keyword').trim(),
      refUrl: val('headings-ref-url').trim(),
      url1: val('headings-url1').trim(),
      url2: val('headings-url2').trim(),
      url3: val('headings-url3').trim(),
      candidate1: val('headings-candidate-1').trim(),
      candidate2: val('headings-candidate-2').trim(),
      candidate3: val('headings-candidate-3').trim(),
      candidate4: val('headings-candidate-4').trim(),
      candidate5: val('headings-candidate-5').trim(),
      enableH4: checked('headings-enable-h4'),
      outline:
        typeof readOutlineFromEditor === 'function'
          ? readOutlineFromEditor('headings-outline-editor')
          : lastHeadingsData?.outline || [],
      lastHeadingsData: lastHeadingsData || null,
      lastHeadingsKeyword: lastHeadingsKeyword || '',
      resultVisible: Boolean(headingsResult && !headingsResult.hidden),
    };
  }

  function applyHeadingsSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    restoringArticleDraft = true;
    try {
      setVal('headings-keyword', snap.keyword || '');
      setVal('headings-ref-url', snap.refUrl || '');
      setVal('headings-url1', snap.url1 || '');
      setVal('headings-url2', snap.url2 || '');
      setVal('headings-url3', snap.url3 || '');
      setVal('headings-candidate-1', snap.candidate1 || '');
      setVal('headings-candidate-2', snap.candidate2 || '');
      setVal('headings-candidate-3', snap.candidate3 || '');
      setVal('headings-candidate-4', snap.candidate4 || '');
      setVal('headings-candidate-5', snap.candidate5 || '');
      setChecked('headings-enable-h4', snap.enableH4);
      lastHeadingsData = snap.lastHeadingsData || null;
      lastHeadingsKeyword = snap.lastHeadingsKeyword || snap.keyword || '';
      const outline = snap.outline || lastHeadingsData?.outline || [];
      if (outline.length) {
        if (lastHeadingsData) lastHeadingsData.outline = outline;
        syncHeadingsH4Ui(outline);
        if (headingsResult) headingsResult.hidden = !snap.resultVisible;
      }
    } finally {
      restoringArticleDraft = false;
    }
  }

  function savePillarNewDraftNow() {
    if (!DS || restoringArticleDraft) return;
    const headings = collectHeadingsSnapshot();
    const article = isArticleRewriteMode() ? null : collectArticleFormSnapshot();
    const prev = DS.load(DS.KEYS.pillarNew) || {};
    DS.save(DS.KEYS.pillarNew, {
      headings,
      article: article || prev.article || null,
      enableH4: headings.enableH4,
      headingsOutline: headings.outline,
      headingsKeyword: headings.keyword,
      articleKeyword: article?.keyword || prev.articleKeyword || '',
      articleTitle: article?.title || prev.articleTitle || '',
      articleOutline: article?.outline || prev.articleOutline || [],
    });
  }

  function savePillarRewriteDraftNow() {
    if (!DS || restoringArticleDraft) return;
    if (!isArticleRewriteMode()) return;
    const article = collectArticleFormSnapshot();
    DS.save(DS.KEYS.pillarRewrite, { article });
  }

  function flushArticleDraftForCurrentMode() {
    if (!DS || restoringArticleDraft) return;
    if (isArticleRewriteMode()) savePillarRewriteDraftNow();
    else savePillarNewDraftNow();
  }

  const schedulePillarDraftSave = DS
    ? DS.debounce(() => {
        if (restoringArticleDraft) return;
        if (isArticleRewriteMode()) savePillarRewriteDraftNow();
        else savePillarNewDraftNow();
      }, 500)
    : function () {};

  function applyArticleDraftForMode(mode) {
    if (!DS) return;
    if (mode === 'rewrite') {
      const draft = DS.load(DS.KEYS.pillarRewrite);
      if (draft?.article) {
        applyArticleFormSnapshot(draft.article, { flexible: true });
        DS.setHint('article-draft-hint', draft.savedAt);
      } else {
        DS.clearHint('article-draft-hint');
      }
      return;
    }
    const draft = DS.load(DS.KEYS.pillarNew);
    if (draft?.article) {
      applyArticleFormSnapshot(draft.article);
      DS.setHint('article-draft-hint', draft.savedAt);
    } else {
      DS.clearHint('article-draft-hint');
    }
  }

  function restorePillarDraftsOnLoad() {
    if (!DS) return;
    if (pillarDraftsHydrated) return;
    pillarDraftsHydrated = true;
    // sessionStorage アウトラインを localStorage へ移行
    try {
      const raw = sessionStorage.getItem(OUTLINE_STORAGE_KEY);
      if (raw && !DS.load(DS.KEYS.pillarNew)) {
        const parsed = JSON.parse(raw);
        if (parsed?.outline?.length) {
          DS.save(DS.KEYS.pillarNew, {
            headings: {
              keyword: parsed.keyword || '',
              outline: parsed.outline,
              enableH4: Boolean(parsed.enableH4),
              resultVisible: true,
            },
            article: {
              keyword: parsed.keyword || '',
              title: parsed.title || '',
              outline: parsed.outline,
              genAeo: true,
              genFaq: true,
            },
            headingsOutline: parsed.outline,
            headingsKeyword: parsed.keyword || '',
            enableH4: Boolean(parsed.enableH4),
          });
          sessionStorage.removeItem(OUTLINE_STORAGE_KEY);
        }
      }
    } catch {
      /* ignore */
    }

    const newDraft = DS.load(DS.KEYS.pillarNew);
    if (newDraft?.headings) {
      applyHeadingsSnapshot(newDraft.headings);
      DS.setHint('pillar-new-draft-hint', newDraft.savedAt);
    } else if (newDraft?.headingsOutline?.length) {
      applyHeadingsSnapshot({
        keyword: newDraft.headingsKeyword || '',
        outline: newDraft.headingsOutline,
        enableH4: newDraft.enableH4,
        resultVisible: true,
      });
      DS.setHint('pillar-new-draft-hint', newDraft.savedAt);
    }
  }

  function discardPillarNewDraft() {
    if (!DS) return;
    if (!confirm('新規記事の下書きを破棄しますか？（画面の内容はそのまま残ります）')) return;
    DS.clear(DS.KEYS.pillarNew);
    DS.clearHint('pillar-new-draft-hint');
    if (!isArticleRewriteMode()) DS.clearHint('article-draft-hint');
    try {
      sessionStorage.removeItem(OUTLINE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function discardPillarRewriteDraft() {
    if (!DS) return;
    if (!confirm('リライトの下書きを破棄しますか？（画面の内容はそのまま残ります）')) return;
    DS.clear(DS.KEYS.pillarRewrite);
    if (isArticleRewriteMode()) DS.clearHint('article-draft-hint');
  }

  function discardCurrentArticleDraft() {
    if (isArticleRewriteMode()) discardPillarRewriteDraft();
    else discardPillarNewDraft();
  }

  document.getElementById('pillar-new-draft-discard')?.addEventListener('click', discardPillarNewDraft);
  document.getElementById('article-draft-discard')?.addEventListener('click', discardCurrentArticleDraft);

  const draftWatchRoots = [
    document.getElementById('panel-headings'),
    document.getElementById('panel-article'),
  ].filter(Boolean);
  for (const root of draftWatchRoots) {
    root.addEventListener('input', () => {
      if (!restoringArticleDraft) schedulePillarDraftSave();
    });
    root.addEventListener('change', () => {
      if (!restoringArticleDraft) schedulePillarDraftSave();
    });
  }

  window.addEventListener('beforeunload', () => {
    if (typeof schedulePillarDraftSave.flush === 'function') {
      schedulePillarDraftSave.flush();
    } else {
      flushArticleDraftForCurrentMode();
    }
  });

})();
