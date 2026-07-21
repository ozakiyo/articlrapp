(function () {
  const TAB_KEY = 'articleappNode-tab';
  const RANKING_CONTEXT_KEY = 'articleappNode.rankingContext';
  const COMPETITOR_ANALYSIS_KEY = 'articleappNode.competitorAnalysis';
  const panels = {
    guide: document.getElementById('panel-guide'),
    weekly: document.getElementById('panel-weekly'),
    kyoso: document.getElementById('panel-kyoso'),
    usecase: document.getElementById('panel-usecase'),
    headings: document.getElementById('panel-headings'),
    article: document.getElementById('panel-article'),
  };
  const tabButtons = document.querySelectorAll('.tab-btn');

  const CategorySelect = {
    OTHER: '__other__',
    defaultCategory: '掃除機',
    pairs: [
      { selectId: 'weekly-category', otherId: 'weekly-category-other' },
      { selectId: 'kyoso-category', otherId: 'kyoso-category-other' },
      { selectId: 'usecase-category', otherId: 'usecase-category-other' },
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
      const res = await fetch('/api/categories');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'カテゴリ一覧の取得に失敗しました');
      this.defaultCategory = data.defaultCategory || '掃除機';
      if (data.otherOptionValue) this.OTHER = data.otherOptionValue;
      const categories = Array.isArray(data.categories) ? data.categories : [];

      for (const pair of this.pairs) {
        const select = document.getElementById(pair.selectId);
        const previous = this.get(pair.selectId, pair.otherId);
        this.fillSelect(select, categories, preferLabel || previous);
        if (preferLabel) {
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

  function showTab(name) {
    Object.keys(panels).forEach((key) => {
      const el = panels[key];
      if (el) el.hidden = key !== name;
    });
    tabButtons.forEach((btn) => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('secondary', !active);
    });
    try {
      localStorage.setItem(TAB_KEY, name);
    } catch {
      /* ignore */
    }
    if (name === 'kyoso') {
      loadKyosoSavedRankingUrls();
      loadKyosoSavedCompetitorArticles();
    }
    if (name === 'headings') {
      syncHeadingsTabFromSources({ force: false });
    }
    if (name === 'article') {
      syncArticleTabFromSources({ force: false });
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      showTab(btn.dataset.tab);
    });
  });

  document.querySelectorAll('[data-guide-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-guide-go');
      if (name && panels[name]) showTab(name);
    });
  });

  let initialTab = 'weekly';
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved && panels[saved]) initialTab = saved;
  } catch {
    /* ignore */
  }

  CategorySelect.refresh()
    .catch((err) => console.warn('CategorySelect.refresh:', err.message))
    .finally(() => {
      showTab(initialTab);
      if (initialTab === 'headings') syncHeadingsTabFromSources({ force: false });
      if (initialTab === 'article') syncArticleTabFromSources({ force: false });
      window.dispatchEvent(new CustomEvent('categories-ready'));
    });

  for (const pair of CategorySelect.pairs) {
    document.getElementById(pair.selectId)?.addEventListener('change', () => {
      CategorySelect.syncOtherVisibility(pair.selectId, pair.otherId);
      if (pair.selectId === 'kyoso-category') {
        loadKyosoSavedRankingUrls();
        loadKyosoSavedCompetitorArticles();
      }
      if (pair.selectId === 'weekly-category') {
        window.dispatchEvent(new CustomEvent('weekly-category-changed'));
      }
    });
    document.getElementById(pair.otherId)?.addEventListener('change', () => {
      if (pair.selectId === 'kyoso-category') {
        loadKyosoSavedRankingUrls();
        loadKyosoSavedCompetitorArticles();
      }
      if (pair.selectId === 'weekly-category') {
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
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  // --- 競合調査 ---
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
  const kyosoThemeSelects = [
    document.getElementById('kyoso-theme-2'),
    document.getElementById('kyoso-theme-3'),
  ];
  let kyosoThemePresets = [];
  let kyosoPhase1Cache = null;

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
          ? `週次・競合の結果より ${list.length} 件を入力済み（編集してから見出し生成してください）`
          : '週次レポートまたは競合調査の結果を取り込むと、候補と他社URLが入ります。');
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
    const candidates = collectBridgeHeadingCandidates(category);
    const existing = getHeadingCandidatesFromForm();
    if (force || !existing.length) {
      setHeadingCandidatesToForm(
        candidates,
        candidates.length
          ? `週次・競合の結果より ${candidates.length} 件を入力済み（編集してから見出し生成してください）`
          : undefined
      );
    }
    const urls = await fetchCompetitorArticleUrls(category);
    if (urls.length) setUrlFields('headings', urls, { force });
    const status = document.getElementById('headings-bridge-msg');
    if (status) {
      status.textContent = category
        ? `反映: ${category} / 候補 ${candidates.length} 件 / 競合URL ${urls.length} 件`
        : '反映できる週次・競合データがありません。先に取得してください。';
    }
    return { category, candidates, urls };
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
      { h2: `${kw}選びのポイント`, subsections: ['', '', ''] },
      { h2: `${kw}の人気メーカー`, subsections: ['', '', ''] },
    ];
    const list = Array.isArray(sectionsRaw) ? sectionsRaw : [];
    return defaults.map((def, i) => {
      const src = list[i] || {};
      const itemsSrc = Array.isArray(src.items) ? src.items : null;
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
        return { h3, h4s };
      });
      return {
        h2: String(src.h2 || def.h2).trim() || def.h2,
        subsections: items.map((it) => it.h3),
        items,
      };
    });
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
  }

  function loadOutlineFromStorage() {
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

  function renderOutlineEditor(containerId, outline, { withH4 = false, allowSuggest = false } = {}) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const sections = normalizeClientOutline('', outline);
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
                <span class="field-sub">H3-${hi + 1}</span>
                <input type="text" class="outline-h3-input" data-sec="${si}" data-h3="${hi}" value="${escapeHtml(item.h3 || '')}" placeholder="H3見出し" />
              </label>
              ${h4Fields}
            </div>`;
          })
          .join('');
        return `<div class="outline-section" data-sec="${si}">
          <label class="field">
            <span class="field-sub">H2-${si + 1}</span>
            <input type="text" class="outline-h2-input" data-sec="${si}" value="${escapeHtml(sec.h2 || '')}" />
          </label>
          ${h3Html}
        </div>`;
      })
      .join('');
  }

  function clearOutlineH4(outline) {
    return (outline || []).map((sec) => ({
      ...sec,
      items: (sec.items || []).map((item) => ({
        h3: item.h3 || '',
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

  async function suggestH4ForH3({ keyword, h3, urlPrefix = 'headings' }) {
    const data = await postJson('/api/article/generate-sub-headings', {
      keyword,
      h3,
      competitorUrl1: document.getElementById(`${urlPrefix}-url1`)?.value.trim() || '',
      competitorUrl2: document.getElementById(`${urlPrefix}-url2`)?.value.trim() || '',
      competitorUrl3: document.getElementById(`${urlPrefix}-url3`)?.value.trim() || '',
      referenceUrl:
        document.getElementById(`${urlPrefix}-ref-url`)?.value.trim() || '',
    });
    return (data.subheadings || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, MAX_OUTLINE_H4);
  }

  function fillH4Inputs(editor, si, hi, suggested) {
    for (let k = 0; k < MAX_OUTLINE_H4; k++) {
      const input = editor.querySelector(
        `.outline-h4-input[data-sec="${si}"][data-h3="${hi}"][data-h4="${k}"]`
      );
      if (input) input.value = suggested[k] || '';
    }
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
      const items = [0, 1, 2].map((hi) => {
        const h3 =
          secEl.querySelector(`.outline-h3-input[data-sec="${si}"][data-h3="${hi}"]`)
            ?.value.trim() || '';
        const h4s = [0, 1, 2].map(
          (k) =>
            secEl
              .querySelector(
                `.outline-h4-input[data-sec="${si}"][data-h3="${hi}"][data-h4="${k}"]`
              )
              ?.value.trim() || ''
        );
        return { h3, h4s };
      });
      return {
        h2,
        subsections: items.map((it) => it.h3),
        items,
      };
    });
  }

  function outlineToApiSections(outline) {
    return (outline || [])
      .map((sec) => ({
        h2: String(sec.h2 || '').trim(),
        items: (sec.items || [])
          .map((item) => ({
            h3: String(item.h3 || '').trim(),
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
    renderOutlineEditor('article-outline-editor', outline, {
      withH4: showH4,
      allowSuggest: false,
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

  // 後方互換
  function loadHeadingCandidatesFromStorage() {
    syncHeadingsTabFromSources({ force: false });
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

  /** 需要分析候補（pickedFeatures）だけをテーマ2・3の選択肢にする */
  function fillKyosoThemeSelectsFromFeatures(pickedFeatures, themePresets, suggestedIds) {
    kyosoThemePresets = Array.isArray(themePresets) ? themePresets : [];
    const presetById = new Map(kyosoThemePresets.map((p) => [p.id, p]));
    const candidates = (pickedFeatures || []).filter((f) => f.id && presetById.has(f.id));

    for (let i = 0; i < 2; i++) {
      const sel = kyosoThemeSelects[i];
      if (!sel) continue;
      sel.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '候補から選択';
      sel.appendChild(placeholder);
      for (const f of candidates) {
        const p = presetById.get(f.id);
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = `${p.label}（該当 ${f.matchCount ?? '—'}件）`;
        sel.appendChild(opt);
      }
      const suggested = suggestedIds?.[i];
      if (suggested && presetById.has(suggested)) sel.value = suggested;
      else if (candidates[i]) sel.value = candidates[i].id;
    }

    if (kyosoThemeSelectPanel) {
      kyosoThemeSelectPanel.hidden = candidates.length < 2;
    }
    if (kyosoBuildThemed) {
      kyosoBuildThemed.disabled = candidates.length < 2;
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
        `URL を保存しました（${savedDate} / data/ranking-urls.json）。週次レポートの「今週のランキングを取得」でも自動使用されます。`
      );
      await CategorySelect.refresh({ preferLabel: category });
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
    const category = getKyosoCategory();
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
    const category = getKyosoCategory();
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
    const category = getKyosoCategory();
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
      await CategorySelect.refresh({ preferLabel: category });
      CategorySelect.set('weekly-category', 'weekly-category-other', category);
    } catch (err) {
      showError(kyosoArticleError, err.message);
    } finally {
      setLoading(kyosoArticleSave, false, '記事URLを保存', '保存中...');
    }
  });

  kyosoArticleAnalyze?.addEventListener('click', async () => {
    showError(kyosoArticleError, '');
    const category = getKyosoCategory();
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

      kyosoPhase1Cache = {
        category: data.category || category,
        compositeItems: data.compositeRanking?.items || [],
        themePresets: data.themePresets || [],
        pickedFeatures: data.pickedFeatures || [],
        suggestedThemeIds: data.suggestedThemeIds || [],
        themeTopLimit: data.themeTopLimit,
      };
      fillKyosoThemeSelectsFromFeatures(
        kyosoPhase1Cache.pickedFeatures,
        kyosoPhase1Cache.themePresets,
        kyosoPhase1Cache.suggestedThemeIds
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
        showError(
          kyosoError,
          `一部の取得元でエラーがありました:\n${data.warnings
            .map((w) => `${w.source}: ${w.message}`)
            .join('\n')}`
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
    showError(kyosoError, '');
    if (!kyosoPhase1Cache?.compositeItems?.length) {
      showError(kyosoError, '先に「① ランキング取得・横断比較」を実行してください。');
      return;
    }

    const rankingThemes = getKyosoRankingThemesFromForm();
    const secondaryIds = rankingThemes
      .map((t) => t.id)
      .filter((id) => id && id !== 'overall');
    if (secondaryIds.length < 2) {
      showError(kyosoError, '需要分析の見出し候補から、テーマ2・3を選んでください。');
      return;
    }
    if (new Set(secondaryIds).size < 2) {
      showError(kyosoError, 'テーマ2とテーマ3は異なる見出しを選んでください。');
      return;
    }

    setLoading(
      kyosoBuildThemed,
      true,
      '見出し別ランキングを作成（テーマ2・3）',
      '作成中...'
    );
    try {
      const data = await postJson('/api/build-category-themed-rankings', {
        category: kyosoPhase1Cache.category,
        compositeItems: kyosoPhase1Cache.compositeItems,
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

      if (data.warnings?.length) {
        showError(
          kyosoError,
          data.warnings.map((w) => `${w.source}: ${w.message}`).join('\n')
        );
      }
    } catch (err) {
      showError(kyosoError, err.message);
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
    kyosoResult.hidden = true;
    if (kyosoUrlPanel) kyosoUrlPanel.hidden = true;
    if (kyosoThemeSelectPanel) kyosoThemeSelectPanel.hidden = true;
    kyosoPhase1Cache = null;
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
    if (kyosoCompositeTbody) kyosoCompositeTbody.innerHTML = '';
    if (kyosoCompositeMeta) kyosoCompositeMeta.textContent = '';
    if (kyosoThemedBlocks) kyosoThemedBlocks.innerHTML = '';
    if (kyosoThemeSelectPanel) kyosoThemeSelectPanel.hidden = true;
    kyosoPhase1Cache = null;
  });

  document.getElementById('kyoso-to-headings')?.addEventListener('click', () => {
    applyRankingContextToHeadingsTab(loadRankingContextFromStorage());
    showTab('headings');
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
    showTab('article');
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
    const active = localStorage.getItem(TAB_KEY);
    if (active === 'headings') syncHeadingsTabFromSources({ force: false });
    if (active === 'article') syncArticleTabFromSources({ force: false });
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
      });
      lastHeadingsData = data;
      lastHeadingsKeyword = keyword;

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

  document.getElementById('headings-reset')?.addEventListener('click', () => {
    formHeadings.reset();
    showError(headingsError, '');
    headingsResult.hidden = true;
    lastHeadingsData = null;
    lastHeadingsKeyword = '';
    const editor = document.getElementById('headings-outline-editor');
    if (editor) editor.innerHTML = '';
    const enableH4 = document.getElementById('headings-enable-h4');
    if (enableH4) enableH4.checked = false;
    const h4Actions = document.getElementById('headings-h4-actions');
    if (h4Actions) h4Actions.hidden = true;
    const h4Msg = document.getElementById('headings-h4-msg');
    if (h4Msg) h4Msg.textContent = '';
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
      const suggested = await suggestH4ForH3({ keyword, h3, urlPrefix: 'headings' });
      fillH4Inputs(editor, si, hi, suggested);
      const msg = document.getElementById('headings-h4-msg');
      if (msg) {
        msg.textContent = suggested.length
          ? `「${h3}」の H4 を ${suggested.length} 件提案しました。必要なら編集してから記事へ進んでください。`
          : 'H4案が空でした。手動入力するか、別の観点で再提案してください。';
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
      btn.textContent = `提案中... (0/${targets.length})`;
    }
    let done = 0;
    let failed = 0;
    try {
      for (const t of targets) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const suggested = await suggestH4ForH3({
            keyword,
            h3: t.h3,
            urlPrefix: 'headings',
          });
          fillH4Inputs(editor, t.si, t.hi, suggested);
        } catch {
          failed += 1;
        }
        done += 1;
        if (btn) btn.textContent = `提案中... (${done}/${targets.length})`;
      }
      if (msg) {
        msg.textContent =
          failed > 0
            ? `H4提案完了（成功 ${targets.length - failed} / 失敗 ${failed}）。内容を確認・編集してから記事へ進んでください。`
            : `全 ${targets.length} 件の H3 に H4 を提案しました。内容を確認・編集してから「見出し確定 → 記事生成へ」を押してください。`;
      }
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

  function renderOutlineArticleResult(data) {
    const intro = data.introduction || data.article?.introduction || '';
    const summary = data.summary || data.article?.summary || '';
    const sections = data.sections || data.article?.sections || [];
    let html = '';
    if (data.title || data.article?.h1) {
      html += `<div class="generated-block"><h3>タイトル</h3><p>${escapeHtml(data.title || data.article?.h1 || '')}</p></div>`;
    }
    if (intro) {
      html += `<div class="generated-block"><h3>導入文</h3><div class="generated-text">${paragraphsHtml(intro)}</div></div>`;
    }
    sections.forEach((sec) => {
      html += `<div class="generated-block section-block"><h3>${escapeHtml(sec.h2 || '')}</h3>`;
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
      html += `<div class="generated-block"><h3>まとめ</h3><div class="generated-text">${paragraphsHtml(summary)}</div></div>`;
    }
    return html;
  }

  formArticle?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(articleError, '');

    const keyword = document.getElementById('article-keyword').value.trim();
    if (!keyword) {
      showError(articleError, 'キーワードを入力してください。');
      return;
    }

    const outline = readOutlineFromEditor('article-outline-editor');
    const sections = outlineToApiSections(outline);
    if (!sections.length) {
      showError(
        articleError,
        '見出しが空です。見出し生成タブで見出しを確定してから引き継いでください。'
      );
      return;
    }

    saveOutlineToStorage(
      outline,
      keyword,
      document.getElementById('article-title')?.value.trim() || '',
      { enableH4: outlineHasAnyH4(outline) }
    );

    setLoading(articleSubmit, true, '確定した見出しで記事を生成', '生成中...');
    try {
      const data = await postJson('/api/article/generate', {
        keyword,
        title: document.getElementById('article-title').value.trim(),
        sections,
        competitorUrl1: document.getElementById('article-url1').value.trim(),
        competitorUrl2: document.getElementById('article-url2').value.trim(),
        competitorUrl3: document.getElementById('article-url3').value.trim(),
        referenceUrl: document.getElementById('article-ref-url').value.trim(),
        generateIntroduction: Boolean(document.getElementById('article-gen-intro')?.checked),
        generateSummary: Boolean(document.getElementById('article-gen-summary')?.checked),
      });

      renderWarnings(articleWarnings, data.warnings);
      articleBody.innerHTML = renderOutlineArticleResult(data);
      articleResult.hidden = false;
    } catch (err) {
      showError(articleError, err.message);
      articleResult.hidden = true;
    } finally {
      setLoading(articleSubmit, false, '確定した見出しで記事を生成', '生成中...');
    }
  });

  document.getElementById('article-reset')?.addEventListener('click', () => {
    formArticle.reset();
    showError(articleError, '');
    articleResult.hidden = true;
    const editor = document.getElementById('article-outline-editor');
    if (editor) {
      editor.innerHTML =
        '<p class="field-hint">見出し生成タブで見出しを確定し、「記事生成へ」を押してください。</p>';
    }
  });

  document.getElementById('article-clear')?.addEventListener('click', () => {
    articleResult.hidden = true;
    showError(articleError, '');
  });
})();
