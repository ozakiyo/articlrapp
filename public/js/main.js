(function () {
  const TAB_KEY = 'articleappNode-tab';
  const RANKING_CONTEXT_KEY = 'articleappNode.rankingContext';
  const panels = {
    weekly: document.getElementById('panel-weekly'),
    kyoso: document.getElementById('panel-kyoso'),
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
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      showTab(btn.dataset.tab);
      if (btn.dataset.tab === 'headings') loadHeadingCandidatesFromStorage();
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
      if (initialTab === 'headings') loadHeadingCandidatesFromStorage();
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

  function setHeadingCandidatesToForm(features) {
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById(`headings-candidate-${i}`);
      const f = features[i - 1];
      if (el) {
        el.value =
          f?.headingCandidate || f?.label || (typeof f === 'string' ? f : '') || '';
      }
    }
    const hint = document.getElementById('headings-candidates-hint');
    if (hint && features?.length) {
      hint.textContent = `ランキング分析より ${features.length} 件を入力済み（編集してから見出し生成してください）`;
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

  function loadHeadingCandidatesFromStorage() {
    const ctx = loadRankingContextFromStorage();
    if (ctx?.pickedFeatures?.length) {
      setHeadingCandidatesToForm(ctx.pickedFeatures);
    }
    if (ctx?.category) {
      const kw = document.getElementById('headings-keyword');
      if (kw && !kw.value.trim()) kw.value = ctx.category;
    }
  }

  function applyRankingContextToHeadingsTab(ctx) {
    if (!ctx) return;
    if (ctx.category) {
      const kw = document.getElementById('headings-keyword');
      if (kw) kw.value = ctx.category;
    }
    if (ctx.pickedFeatures?.length) {
      setHeadingCandidatesToForm(ctx.pickedFeatures);
    }
  }

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
  const COMPETITOR_ANALYSIS_KEY = 'articleappNode.competitorAnalysis';

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
        savedAt: Date.now(),
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
  const headingsBody = document.getElementById('headings-body');
  const headingsWarnings = document.getElementById('headings-warnings');
  const headingsSubmit = document.getElementById('headings-submit');
  let lastHeadingsData = null;
  let lastHeadingsKeyword = '';

  formHeadings?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(headingsError, '');
    const keyword = document.getElementById('headings-keyword').value.trim();
    if (!keyword) {
      showError(headingsError, 'キーワードを入力してください。');
      return;
    }

    setLoading(headingsSubmit, true, '見出しを生成', '生成中...');
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

      let html = '';
      if (data.title) {
        html += `<div class="generated-block"><h3>タイトル案</h3><p>${escapeHtml(data.title)}</p></div>`;
      }
      (data.sections || []).forEach((section, i) => {
        html += `<div class="generated-block section-block"><h3>H2-${i + 1}: ${escapeHtml(section.h2 || '')}</h3>`;
        (section.subsections || []).forEach((h3, j) => {
          html += `<div class="generated-block"><h4>H3-${j + 1}</h4><p class="clickable-h3" data-h3="${escapeHtml(h3)}" title="クリックでH4生成へ">${escapeHtml(h3)}</p></div>`;
        });
        html += '</div>';
      });
      headingsBody.innerHTML = html;
      headingsResult.hidden = false;
      const subPanel = document.getElementById('sub-headings-panel');
      if (subPanel) subPanel.hidden = false;
    } catch (err) {
      showError(headingsError, err.message);
      headingsResult.hidden = true;
    } finally {
      setLoading(headingsSubmit, false, '見出しを生成', '生成中...');
    }
  });

  document.getElementById('headings-reset')?.addEventListener('click', () => {
    formHeadings.reset();
    showError(headingsError, '');
    headingsResult.hidden = true;
    lastHeadingsData = null;
  });

  document.getElementById('headings-clear')?.addEventListener('click', () => {
    headingsResult.hidden = true;
    showError(headingsError, '');
  });

  document.getElementById('headings-copy')?.addEventListener('click', async () => {
    const msg = document.getElementById('headings-copy-msg');
    if (!lastHeadingsData) return;
    const lines = [`キーワード: ${lastHeadingsKeyword}`, `タイトル: ${lastHeadingsData.title || ''}`];
    (lastHeadingsData.sections || []).forEach((section, i) => {
      lines.push('');
      lines.push(`H2-${i + 1}: ${section.h2 || ''}`);
      (section.subsections || []).forEach((h3, j) => {
        lines.push(`  H3-${j + 1}: ${h3}`);
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

  // --- H4見出し生成 ---
  const formSubHeadings = document.getElementById('form-sub-headings');
  const subHeadingsError = document.getElementById('sub-headings-error');
  const subHeadingsResult = document.getElementById('sub-headings-result');
  const subHeadingsBody = document.getElementById('sub-headings-body');
  const subHeadingsSubmit = document.getElementById('sub-headings-submit');
  let lastSubHeadingsData = null;

  headingsBody?.addEventListener('click', (e) => {
    const target = e.target.closest('.clickable-h3');
    if (!target) return;
    const h3Text = target.dataset.h3;
    const h3Input = document.getElementById('sub-headings-h3');
    if (h3Input) h3Input.value = h3Text;
    const subPanel = document.getElementById('sub-headings-panel');
    if (subPanel) subPanel.hidden = false;
    subPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  formSubHeadings?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(subHeadingsError, '');
    const h3 = document.getElementById('sub-headings-h3').value.trim();
    if (!h3) {
      showError(subHeadingsError, 'H3見出しを入力してください。');
      return;
    }

    const keyword = document.getElementById('headings-keyword').value.trim();
    if (!keyword) {
      showError(subHeadingsError, '見出し生成タブのキーワードを入力してください。');
      return;
    }

    setLoading(subHeadingsSubmit, true, 'H4見出しを生成', '生成中...');
    try {
      const data = await postJson('/api/article/generate-sub-headings', {
        keyword,
        h3,
        competitorUrl1: document.getElementById('headings-url1').value.trim(),
        competitorUrl2: document.getElementById('headings-url2').value.trim(),
        competitorUrl3: document.getElementById('headings-url3').value.trim(),
        referenceUrl: document.getElementById('headings-ref-url').value.trim(),
      });
      lastSubHeadingsData = data;

      let html = `<div class="generated-block"><h3>H3: ${escapeHtml(data.h3 || h3)}</h3>`;
      (data.subheadings || []).forEach((h4, j) => {
        html += `<div class="generated-block"><h4>H4-${j + 1}: ${escapeHtml(h4)}</h4></div>`;
      });
      html += '</div>';
      subHeadingsBody.innerHTML = html;
      subHeadingsResult.hidden = false;
    } catch (err) {
      showError(subHeadingsError, err.message);
      subHeadingsResult.hidden = true;
    } finally {
      setLoading(subHeadingsSubmit, false, 'H4見出しを生成', '生成中...');
    }
  });

  document.getElementById('sub-headings-clear')?.addEventListener('click', () => {
    showError(subHeadingsError, '');
    if (subHeadingsResult) subHeadingsResult.hidden = true;
    if (subHeadingsBody) subHeadingsBody.innerHTML = '';
    lastSubHeadingsData = null;
  });

  // --- 記事生成 ---
  const formArticle = document.getElementById('form-article');
  const articleError = document.getElementById('article-error');
  const articleResult = document.getElementById('article-result');
  const articleBody = document.getElementById('article-body');
  const articleWarnings = document.getElementById('article-warnings');
  const articleSubmit = document.getElementById('article-submit');

  const ARTICLE_H3_SUFFIXES = ['first', 'second', 'third', 'fourth', 'fifth'];

  function getArticleH3Payload() {
    const payload = {};
    ARTICLE_H3_SUFFIXES.forEach((suffix, i) => {
      payload[`heading_h3_${suffix}`] =
        document.getElementById(`article-h3-${i + 1}`)?.value.trim() || '';
    });
    return payload;
  }

  function getArticleH4Payload() {
    const payload = {};
    ARTICLE_H3_SUFFIXES.forEach((suffix, i) => {
      payload[`heading_h4_${suffix}`] =
        document.getElementById(`article-h4-${i + 1}`)?.value.trim() || '';
    });
    return payload;
  }

  function buildArticleH4Blocks(body) {
    if (!Array.isArray(body?.h4_items)) return [];
    return body.h4_items.map((item) => ({
      title: item.h4 || '',
      content: item.content || '',
    }));
  }

  function buildArticleH3Blocks(body) {
    if (Array.isArray(body?.h3_items) && body.h3_items.length) {
      return body.h3_items.map((item) => ({
        title: item.h3 || '',
        content: item.content || '',
      }));
    }
    return ARTICLE_H3_SUFFIXES.map((suffix) => ({
      title:
        document.getElementById(
          `article-h3-${ARTICLE_H3_SUFFIXES.indexOf(suffix) + 1}`
        )?.value.trim() ||
        body?.[`h3_${suffix}`] ||
        '',
      content: body?.[`h3_${suffix}_content`] || '',
    })).filter((b) => b.title || b.content);
  }

  formArticle?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(articleError, '');

    const keyword = document.getElementById('article-keyword').value.trim();
    if (!keyword) {
      showError(articleError, 'キーワードを入力してください。');
      return;
    }

    setLoading(articleSubmit, true, '記事を生成', '生成中...');
    try {
      const data = await postJson('/api/article/generate', {
        keyword,
        title: document.getElementById('article-title').value.trim(),
        heading_h2_first: document.getElementById('article-h2').value.trim(),
        ...getArticleH3Payload(),
        heading_h3_target: document.getElementById('article-h3-target')?.value.trim() || '',
        ...getArticleH4Payload(),
        competitorUrl1: document.getElementById('article-url1').value.trim(),
        competitorUrl2: document.getElementById('article-url2').value.trim(),
        competitorUrl3: document.getElementById('article-url3').value.trim(),
        referenceUrl: document.getElementById('article-ref-url').value.trim(),
        generateIntroduction: Boolean(document.getElementById('article-gen-intro')?.checked),
        generateSummary: Boolean(document.getElementById('article-gen-summary')?.checked),
      });

      renderWarnings(articleWarnings, data.warnings);

      const body =
        data.article && typeof data.article === 'object' && !Array.isArray(data.article)
          ? data.article
          : null;
      const isH4Mode = data.mode === 'h4';
      const blocks = isH4Mode ? buildArticleH4Blocks(body) : buildArticleH3Blocks(body);

      const intro = body?.introduction ?? data.introduction ?? '';
      const summary = body?.summary ?? data.summary ?? '';

      let html = '';
      if (intro) {
        html += `<div class="generated-block"><h3>導入文</h3><div class="generated-text">${paragraphsHtml(intro)}</div></div>`;
      }
      if (isH4Mode && body?.h3_target) {
        html += `<div class="generated-block section-block"><h3>H3: ${escapeHtml(body.h3_target)}</h3>`;
        blocks.forEach((block) => {
          html += '<div class="generated-block">';
          if (block.title) html += `<h4>${escapeHtml(block.title)}</h4>`;
          if (block.content) {
            html += `<div class="generated-text">${paragraphsHtml(block.content)}</div>`;
          }
          html += '</div>';
        });
        html += '</div>';
      } else {
        blocks.forEach((block) => {
          html += '<div class="generated-block section-block">';
          if (block.title) html += `<h4>${escapeHtml(block.title)}</h4>`;
          if (block.content) {
            html += `<div class="generated-text">${paragraphsHtml(block.content)}</div>`;
          }
          html += '</div>';
        });
      }
      if (summary) {
        html += `<div class="generated-block"><h3>まとめ</h3><div class="generated-text">${paragraphsHtml(summary)}</div></div>`;
      }

      articleBody.innerHTML = html;
      articleResult.hidden = false;
    } catch (err) {
      showError(articleError, err.message);
      articleResult.hidden = true;
    } finally {
      setLoading(articleSubmit, false, '記事を生成', '生成中...');
    }
  });

  document.getElementById('article-reset')?.addEventListener('click', () => {
    formArticle.reset();
    showError(articleError, '');
    articleResult.hidden = true;
  });

  document.getElementById('article-clear')?.addEventListener('click', () => {
    articleResult.hidden = true;
    showError(articleError, '');
  });
})();
