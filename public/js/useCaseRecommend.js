/**
 * 用途別担当者おすすめ3選
 */
(function () {
  const RANKING_CONTEXT_KEY = 'articleappNode.rankingContext';

  let rankingItems = [];
  let rankingSource = '';
  let useCases = [];
  let assignments = [];
  let generatedSections = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  function getCategory() {
    if (window.CategorySelect) {
      return window.CategorySelect.get('usecase-category', 'usecase-category-other');
    }
    return document.getElementById('usecase-category')?.value || '';
  }

  function showError(msg) {
    const el = document.getElementById('usecase-error');
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function hasKojima(p) {
    return p?.rankKojima != null || Boolean(p?.hrefKojima);
  }

  function loadStoredRanking() {
    try {
      const raw = sessionStorage.getItem(RANKING_CONTEXT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function loadRanking() {
    showError('');
    const category = getCategory();
    const msg = document.getElementById('usecase-ranking-msg');
    const proposeBtn = document.getElementById('usecase-propose');
    if (!category) {
      showError('カテゴリを選択してください。');
      return;
    }
    if (msg) msg.textContent = '読み込み中…';

    let items = [];
    let source = '';

    // 1) sessionStorage（競合調査 / 週次）
    const stored = loadStoredRanking();
    if (
      stored?.compositeItems?.length &&
      (!stored.category || stored.category === category)
    ) {
      items = stored.compositeItems;
      source = stored.source || 'session';
    }

    // 2) 週次API
    if (!items.length) {
      try {
        const res = await fetch(
          `/api/weekly/report?category=${encodeURIComponent(category)}`
        );
        const data = await res.json();
        if (res.ok) {
          items = data.bestsellers || data.compositeRanking?.items || [];
          if (items.length) source = 'weekly';
        }
      } catch {
        /* ignore */
      }
    }

    rankingItems = items;
    rankingSource = source;
    const kojimaCount = items.filter(hasKojima).length;

    if (!items.length) {
      if (msg) {
        msg.textContent =
          'ランキングがありません。先に週次レポートまたは競合調査でランキングを取得してください。';
      }
      if (proposeBtn) proposeBtn.disabled = true;
      showError('ランキング未取得です。');
      return;
    }

    if (msg) {
      msg.textContent = `${category}: 全${items.length}件 / コジマ取扱 ${kojimaCount}件（取得元: ${source || '—'}）`;
    }
    if (proposeBtn) proposeBtn.disabled = false;
    document.getElementById('usecase-confirm-use-cases').disabled = true;
    document.getElementById('usecase-generate-all').disabled = true;
    document.getElementById('usecase-copy-html').disabled = true;
    useCases = [];
    assignments = [];
    generatedSections = null;
    document.getElementById('usecase-use-cases').innerHTML = '';
    document.getElementById('usecase-assignments').innerHTML = '';
    document.getElementById('usecase-html-output').value = '';
    document.getElementById('usecase-html-preview').innerHTML = '';
  }

  function readUseCasesFromForm() {
    const cards = document.querySelectorAll('.usecase-uc-card');
    return [...cards].map((card, i) => ({
      id: card.dataset.id || `uc${i + 1}`,
      label: card.querySelector('.usecase-uc-label')?.value.trim() || `用途${i + 1}`,
      rationale: card.querySelector('.usecase-uc-rationale')?.value.trim() || '',
      buyerHint: card.querySelector('.usecase-uc-hint')?.value.trim() || '',
    }));
  }

  function renderUseCases(list) {
    const box = document.getElementById('usecase-use-cases');
    if (!box) return;
    box.innerHTML = list
      .map(
        (uc, i) => `
      <div class="usecase-uc-card" data-id="${esc(uc.id)}">
        <h3>用途 ${i + 1}</h3>
        <label class="field">
          <span>名称</span>
          <input type="text" class="usecase-uc-label" value="${esc(uc.label)}" />
        </label>
        <label class="field">
          <span>切り口の理由</span>
          <input type="text" class="usecase-uc-rationale" value="${esc(uc.rationale || '')}" />
        </label>
        <label class="field">
          <span>想定読者</span>
          <input type="text" class="usecase-uc-hint" value="${esc(uc.buyerHint || '')}" />
        </label>
      </div>`
      )
      .join('');
  }

  async function propose() {
    showError('');
    const category = getCategory();
    const msg = document.getElementById('usecase-propose-msg');
    const btn = document.getElementById('usecase-propose');
    if (!rankingItems.length) {
      showError('先にランキングを読み込んでください。');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '提案中…';
    }
    if (msg) msg.textContent = 'AIが用途を提案しています…';
    try {
      const res = await fetch('/api/usecase/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          window.AiProvider
            ? window.AiProvider.withUseCaseBody({ category, items: rankingItems })
            : { category, items: rankingItems, aiProvider: 'chatgpt' }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || '提案に失敗しました');
      useCases = data.useCases || [];
      renderUseCases(useCases);
      document.getElementById('usecase-confirm-use-cases').disabled = false;
      if (msg) {
        msg.textContent = `コジマ取扱 ${data.kojimaCount ?? '—'} 件から用途を3つ提案しました。必要なら編集して「この用途で進む」を押してください。`;
      }
    } catch (err) {
      showError(err.message);
      if (msg) msg.textContent = '提案失敗';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '用途を3つ提案';
      }
    }
  }

  function renderAssignments(list) {
    const box = document.getElementById('usecase-assignments');
    if (!box) return;
    box.innerHTML = list
      .map((sec) => {
        const products = (sec.products || [])
          .map(
            (p, i) => `
          <div class="usecase-product-card" data-key="${esc(p.key)}">
            <strong>${i + 1}. ${esc(p.label || p.productName || p.key)}</strong>
            <div class="field-hint">${esc(p.manufacturer || '')} ${esc(p.modelCode || '')}</div>
            <div class="field-hint">${esc(p.reason || '')}</div>
            ${
              p.hrefKojima
                ? `<a href="${esc(p.hrefKojima)}" target="_blank" rel="noopener">コジマ商品ページ</a>`
                : '<span class="field-hint">コジマURLなし</span>'
            }
            <label class="field">
              <span>メーカー公式URL（任意・手修正）</span>
              <input type="url" class="usecase-maker-url" placeholder="https://..." value="${esc(p.manufacturerUrl || '')}" />
            </label>
          </div>`
          )
          .join('');
        return `
        <div class="usecase-assign-block" data-usecase-id="${esc(sec.useCaseId)}">
          <h3>${esc(sec.label)}</h3>
          ${sec.warning ? `<p class="field-hint">${esc(sec.warning)}</p>` : ''}
          ${products || '<p class="field-hint">商品なし</p>'}
        </div>`;
      })
      .join('');
  }

  function readAssignmentsFromDom() {
    return [...document.querySelectorAll('.usecase-assign-block')].map((block) => {
      const useCaseId = block.dataset.usecaseId;
      const base = assignments.find((a) => a.useCaseId === useCaseId) || {};
      const products = [...block.querySelectorAll('.usecase-product-card')].map((card, idx) => {
        const key = card.dataset.key;
        const orig = (base.products || []).find((p) => p.key === key) || base.products?.[idx] || {};
        return {
          ...orig,
          key,
          manufacturerUrl: card.querySelector('.usecase-maker-url')?.value.trim() || null,
        };
      });
      return {
        useCaseId,
        label: base.label,
        rationale: base.rationale || '',
        products,
      };
    });
  }

  async function assign() {
    showError('');
    const category = getCategory();
    const msg = document.getElementById('usecase-assign-msg');
    const btn = document.getElementById('usecase-confirm-use-cases');
    useCases = readUseCasesFromForm();
    if (useCases.length < 3) {
      showError('用途を3つそろえてください。');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '振り分け中…';
    }
    if (msg) msg.textContent = '用途別に商品を振り分けています…';
    try {
      const res = await fetch('/api/usecase/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          window.AiProvider
            ? window.AiProvider.withUseCaseBody({
                category,
                items: rankingItems,
                useCases,
              })
            : {
                category,
                items: rankingItems,
                useCases,
                aiProvider: 'chatgpt',
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || '振り分けに失敗しました');
      assignments = data.assignments || [];
      renderAssignments(assignments);
      document.getElementById('usecase-generate-all').disabled = false;
      if (msg) {
        msg.textContent = `コジマ取扱 ${data.kojimaCount ?? '—'} 件から各用途3選を割り当てました。メーカーURLは必要なら手修正してください。`;
      }
    } catch (err) {
      showError(err.message);
      if (msg) msg.textContent = '振り分け失敗';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'この用途で進む（商品を振り分け）';
      }
    }
  }

  async function generateAll() {
    showError('');
    const category = getCategory();
    const msg = document.getElementById('usecase-generate-msg');
    const btn = document.getElementById('usecase-generate-all');
    const sections = readAssignmentsFromDom();
    if (!sections.length) {
      showError('先に商品振り分けを完了してください。');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = '生成中…（数分かかることがあります）';
    }
    if (msg) msg.textContent = 'メーカー情報を取得し、説明文・機能表を生成しています…';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);
    try {
      const res = await fetch('/api/usecase/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          window.AiProvider
            ? window.AiProvider.withUseCaseBody({ category, sections })
            : { category, sections, aiProvider: 'chatgpt' }
        ),
        signal: controller.signal,
      });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          res.ok
            ? 'サーバー応答がJSONではありません（途中切断の可能性）。'
            : `HTTP ${res.status}: ゲートウェイ／タイムアウトの可能性。 ${raw.slice(0, 160)}`
        );
      }
      if (!res.ok) {
        throw new Error(data.details || data.error || `HTTP ${res.status}`);
      }
      generatedSections = data.sections || [];
      const html = data.html || '';
      const out = document.getElementById('usecase-html-output');
      const preview = document.getElementById('usecase-html-preview');
      if (out) out.value = html;
      if (preview) preview.innerHTML = html;
      document.getElementById('usecase-copy-html').disabled = !html;
      const genFails = generatedSections
        .flatMap((s) => s.products || [])
        .filter((p) => p.generateError)
        .length;
      const scrapeIssues = generatedSections
        .flatMap((s) => s.products || [])
        .filter((p) => p.scrapeError && !p.generateError)
        .length;
      if (genFails > 0) {
        const first = data.errors?.[0]?.error || '不明';
        showError(`一部の商品で生成失敗（${genFails}件）。最初のエラー: ${first}`);
        if (msg) msg.textContent = `一部完了（生成失敗 ${genFails} 件）`;
      } else if (msg) {
        msg.textContent = scrapeIssues
          ? `生成完了（メーカー取得失敗 ${scrapeIssues} 件。URLを直して再生成できます）`
          : '生成完了';
      }
    } catch (err) {
      const message =
        err?.name === 'AbortError'
          ? '15分でタイムアウトしました。サーバー／nginxのタイムアウト設定も確認してください。'
          : err.message || String(err);
      showError(message);
      if (msg) msg.textContent = '生成失敗';
    } finally {
      clearTimeout(timeoutId);
      if (btn) {
        btn.disabled = false;
        btn.textContent = '説明文・機能表を一括生成';
      }
    }
  }

  async function copyHtml() {
    const text = document.getElementById('usecase-html-output')?.value || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const msg = document.getElementById('usecase-generate-msg');
      if (msg) msg.textContent = 'HTMLをクリップボードにコピーしました。';
    } catch {
      showError('コピーに失敗しました。テキストエリアから手動でコピーしてください。');
    }
  }

  document.getElementById('usecase-load-ranking')?.addEventListener('click', loadRanking);
  document.getElementById('usecase-propose')?.addEventListener('click', propose);
  document.getElementById('usecase-confirm-use-cases')?.addEventListener('click', assign);
  document.getElementById('usecase-generate-all')?.addEventListener('click', generateAll);
  document.getElementById('usecase-copy-html')?.addEventListener('click', copyHtml);

  document.getElementById('usecase-category')?.addEventListener('change', () => {
    if (window.CategorySelect) {
      window.CategorySelect.syncOtherVisibility('usecase-category', 'usecase-category-other');
    }
  });
})();
