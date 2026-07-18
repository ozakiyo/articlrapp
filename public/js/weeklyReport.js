/**
 * 週次レポート（②-A）— API 連携と5問いの描画
 */
(function () {
  const WEEKLY_CONTEXT_KEY = 'articleappNode.weeklyContext';
  const RANKING_CONTEXT_KEY = 'articleappNode.rankingContext';
  const COMPETITOR_ANALYSIS_KEY = 'articleappNode.competitorAnalysis';
  const CHANGE_DRAFT_KEY = 'articleappNode.weeklyChangeDraft';

  let currentReport = null;
  let currentCompetitorAnalysis = null;
  let changeDraftEntries = [];

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function badgeClass(type) {
    const map = { up: 'weekly-badge-up', down: 'weekly-badge-down', new: 'weekly-badge-new' };
    return map[type] || 'weekly-badge-info';
  }

  function badgeLabel(type) {
    const map = { up: 'UP', down: 'DOWN', new: 'NEW', out: 'OUT' };
    return map[type] || type;
  }

  function statusBadge(status) {
    const map = {
      warn: ['weekly-badge-warn', '要更新'],
      ok: ['weekly-badge-ok', 'OK'],
      info: ['weekly-badge-info', '要確認'],
    };
    const [cls, label] = map[status] || ['weekly-badge-info', status];
    return `<span class="weekly-badge ${cls}">${esc(label)}</span>`;
  }

  function rankCell(v) {
    return v != null ? String(v) : '—';
  }

  function formatPv(n) {
    const v = Number(n) || 0;
    if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
    return String(v);
  }

  function formatCv(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return `¥${Number(n).toLocaleString('ja-JP')}`;
  }

  function formatBeforeAfter(before, after, pct, formatter) {
    const fmt = formatter || ((v) => (v == null ? '—' : String(v)));
    if (before == null && after == null) return '—';
    return `${fmt(before)} → ${fmt(after)} ${pvChangeCell(pct)}`;
  }

  function pvChangeCell(pct) {
    if (pct == null) return '—';
    const cls = pct > 0 ? 'weekly-trend-up' : pct < 0 ? 'weekly-trend-down' : '';
    const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
    return `<span class="${cls}">${arrow} ${Math.abs(pct)}%</span>`;
  }

  function priorityBadge(level) {
    const cls =
      level === '高' ? 'weekly-badge-warn' : level === '中' ? 'weekly-badge-info' : 'weekly-badge-ok';
    return `<span class="weekly-badge ${cls}">${esc(level)}</span>`;
  }

  function verdictBadge(verdict, label) {
    const map = {
      improved: 'weekly-badge-up',
      declined: 'weekly-badge-down',
      flat: 'weekly-badge-info',
      too_early: 'weekly-badge-ok',
    };
    return `<span class="weekly-badge ${map[verdict] || 'weekly-badge-info'}">${esc(label)}</span>`;
  }

  function collectHeadings(report) {
    const set = new Set();
    (report.priorityTasks || report.tasks || []).forEach((t) => t.headingCandidate && set.add(t.headingCandidate));
    (report.newArticles || []).forEach((a) => a.headingCandidate && set.add(a.headingCandidate));
    (report.articleChanges || [])
      .filter((c) => c.status === 'warn')
      .forEach((c) => c.headingCandidate && set.add(c.headingCandidate));
    return [...set];
  }

  function saveWeeklyContextToStorage(report, extra) {
    const headings = collectHeadings(report);
    const ctx = {
      category: report.category,
      source: 'weekly',
      weekId: report.weekId,
      pickedFeatures: headings.map((headingCandidate, i) => ({
        id: `weekly-${i + 1}`,
        label: headingCandidate,
        headingCandidate,
      })),
      savedAt: new Date().toISOString(),
      ...extra,
    };
    try {
      sessionStorage.setItem(WEEKLY_CONTEXT_KEY, JSON.stringify(ctx));
      sessionStorage.setItem(RANKING_CONTEXT_KEY, JSON.stringify(ctx));
    } catch {
      /* ignore */
    }
    return ctx;
  }

  function applyToHeadingsTab(headings) {
    const list = headings?.length ? headings : [];
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById(`headings-candidate-${i}`);
      if (el) el.value = list[i - 1] || '';
    }
    const kw = document.getElementById('headings-keyword');
    if (kw) kw.value = currentReport?.category || '掃除機';
    const hint = document.getElementById('headings-candidates-hint');
    if (hint) {
      hint.textContent = list.length
        ? `週次レポートより ${list.filter(Boolean).length} 件を入力済み（編集してから見出し生成してください）`
        : '';
    }
  }

  function goToHeadings(headings) {
    if (!currentReport) return;
    saveWeeklyContextToStorage(currentReport, { headings });
    applyToHeadingsTab(headings || collectHeadings(currentReport));
    document.querySelector('.tab-btn[data-tab="headings"]')?.click();
  }

  function updateTaskProgress() {
    const checks = document.querySelectorAll('.weekly-task-check');
    const done = [...checks].filter((c) => c.checked).length;
    const el = document.getElementById('weekly-task-progress');
    if (el) el.textContent = `${done} / ${checks.length} 完了`;
  }

  function renderTopics(report) {
    const seasonInline = document.getElementById('weekly-season-inline');
    const footnote = document.getElementById('weekly-topics-footnote');
    const wp = report.weeklyPoints || {};

    const s = wp.season || report.season || {};
    if (seasonInline) {
      const parts = [
        s.thisWeek ? `今週: ${s.thisWeek}` : null,
        s.nextWeek ? `来週: ${s.nextWeek}` : null,
        s.monthTheme ? `今月: ${s.monthTheme}` : null,
      ].filter(Boolean);
      const events = Array.isArray(s.events) ? s.events.filter(Boolean) : [];
      if (events.length) parts.push(`イベント: ${events.join(' / ')}`);
      seasonInline.textContent = parts.length ? parts.join(' ｜ ') : '—（記事マスタの season に未登録）';
    }

    const newsTbody = document.getElementById('weekly-news-tbody');
    const newsRows = report.news || [];
    if (newsTbody) {
      if (!newsRows.length) {
        newsTbody.innerHTML =
          '<tr><td colspan="4" class="weekly-empty-cell">ニュース・新製品なし（記事マスタの news に未登録）</td></tr>';
      } else {
        newsTbody.innerHTML = newsRows
          .map(
            (r) => `<tr>
            <td>${esc(r.date || '—')}</td>
            <td>${esc(r.content || r.title || '—')}</td>
            <td>${esc(r.impact || '—')}</td>
            <td>${esc(r.action || '—')}</td>
          </tr>`
          )
          .join('');
      }
    }

    const snsTbody = document.getElementById('weekly-sns-tbody');
    const snsRows = report.snsTopics || [];
    if (snsTbody) {
      if (!snsRows.length) {
        snsTbody.innerHTML =
          '<tr><td colspan="4" class="weekly-empty-cell">SNS・話題なし（記事マスタの snsTopics に未登録）</td></tr>';
      } else {
        snsTbody.innerHTML = snsRows
          .map((r) => {
            const link = r.url
              ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">参照</a>`
              : '—';
            return `<tr>
              <td>${esc(r.date || '—')}</td>
              <td>${esc(r.content || r.topic || r.title || '—')}</td>
              <td>${esc(r.source || r.platform || '—')}</td>
              <td>${link}</td>
            </tr>`;
          })
          .join('');
      }
    }

    if (footnote) {
      if (wp.footnote) {
        footnote.textContent = wp.footnote;
        footnote.hidden = false;
      } else {
        footnote.hidden = true;
        footnote.textContent = '';
      }
    }

    renderInterest(report);
  }

  function findReplacementForProduct(replacements, label) {
    if (!label) return null;
    return (replacements || []).find(
      (r) =>
        label.includes(r.fromLabel) ||
        r.fromLabel.includes(label) ||
        label.includes(r.toLabel) ||
        r.toLabel.includes(label)
    );
  }

  function replacementCell(rep) {
    if (!rep) return '—';
    return `${esc(rep.fromLabel)} → <strong>${esc(rep.toLabel)}</strong>`;
  }

  function renderProducts(report) {
    const tbody = document.getElementById('weekly-products-tbody');
    if (!tbody) return;

    const bestsellers = report.bestsellers || [];
    if (!bestsellers.length) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="weekly-empty-cell">ランキング未取得、または該当なし</td></tr>';
      return;
    }

    tbody.innerHTML = bestsellers
      .map(
        (r) => `<tr>
        <td>${r.rank ?? '—'}</td>
        <td>${esc(r.manufacturer || '—')}</td>
        <td>${esc(r.productName || r.label || '—')}</td>
        <td>${esc(r.modelCode || r.modelKey || '—')}</td>
        <td>${rankCell(r.rankAmazon)}</td>
        <td>${rankCell(r.rankRakuten)}</td>
        <td>${rankCell(r.rankYahoo)}</td>
        <td>${rankCell(r.rankKojima)}</td>
        <td>${rankCell(r.rankBic)}</td>
      </tr>`
      )
      .join('');
  }

  function renderArticles(report) {
    const tbody = document.getElementById('weekly-articles-tbody');
    if (!tbody) return;

    const newRows = (report.newArticles || []).map((r) => ({
      articleType: '新規',
      title: r.theme,
      weeklyClicks: null,
      clickChangePercent: null,
      menuWeeklyClicks: null,
      lastUpdated: null,
      status: 'info',
      recommendation: '新規記事検討',
      reason: r.reason,
      headingCandidate: r.headingCandidate,
    }));

    const updateRows = (report.sectionChanges || report.articleChanges || []).map((r) => ({
      articleType: '更新',
      title: r.title,
      weeklyClicks: r.weeklyClicks,
      clickChangePercent: r.clickChangePercent,
      menuWeeklyClicks: r.menuWeeklyClicks,
      lastUpdated: r.lastUpdated,
      status: r.status,
      recommendation: r.recommendation,
      reason: r.reason,
      headingCandidate: r.headingCandidate,
    }));

    const rows = [...newRows, ...updateRows];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="weekly-empty-cell">記事提案なし</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map(
        (r) => `<tr>
        <td><span class="weekly-badge ${r.articleType === '新規' ? 'weekly-badge-new' : 'weekly-badge-info'}">${esc(r.articleType)}</span></td>
        <td>${esc(r.title)}</td>
        <td>${r.weeklyClicks ?? '—'}</td>
        <td>${pvChangeCell(r.clickChangePercent)}</td>
        <td>${r.menuWeeklyClicks ?? '—'}</td>
        <td>${esc(r.lastUpdated || '—')}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${esc(r.recommendation)}</td>
        <td class="weekly-reason-cell">${esc(r.reason)}</td>
        <td>${
          r.headingCandidate
            ? `<button type="button" class="secondary weekly-to-headings-btn" data-heading="${esc(r.headingCandidate)}">見出しへ</button>`
            : ''
        }</td>
      </tr>`
      )
      .join('');
    bindHeadingButtons();
  }

  function filterRankingRows(type) {
    const rows = document.querySelectorAll('#weekly-ranking-tbody tr[data-type]');
    rows.forEach((row) => {
      if (type === 'all') {
        row.hidden = false;
        return;
      }
      row.hidden = row.dataset.type !== type;
    });
    document.querySelectorAll('.weekly-filter-btn').forEach((btn) => {
      btn.classList.toggle('secondary', btn.dataset.filter !== type);
    });
  }

  function getCompareMode() {
    return document.getElementById('weekly-compare')?.value || 'latest';
  }

  function renderCompareSelect(report) {
    const select = document.getElementById('weekly-compare');
    const note = document.getElementById('weekly-compare-note');
    const meta = report.comparisonMeta || {};
    const options = report.compareOptions || [];

    if (select && meta.compareMode) {
      select.value = meta.compareMode;
    }

    if (options.length && select) {
      select.innerHTML = options
        .map(
          (o) =>
            `<option value="${esc(o.id)}"${o.id === meta.compareMode ? ' selected' : ''}>${esc(o.label)}${o.available && o.fetchedAt ? `（${fmtDate(o.fetchedAt)}）` : ''}</option>`
        )
        .join('');
      if (meta.compareMode) select.value = meta.compareMode;
    }

    if (note) {
      if (meta.compareNote) {
        note.textContent = meta.compareNote;
        note.hidden = false;
      } else {
        note.hidden = true;
        note.textContent = '';
      }
    }
  }

  function renderHeader(report) {
    const weekOpt = document.getElementById('weekly-week-option');
    if (weekOpt) weekOpt.textContent = report.weekId || '—';

    const statusText = document.getElementById('weekly-status-text');
    const dot = document.getElementById('weekly-status-dot');
    const fetchMsg = document.getElementById('weekly-fetch-msg');
    const phaseBadge = document.getElementById('weekly-phase-badge');

    if (phaseBadge) {
      const phase = report.config?.articlePerformancePhase || 'phase1';
      phaseBadge.textContent =
        phase === 'hub-clicks'
          ? '柱記事PV + クリック'
          : phase === 'phase1.5'
            ? 'Phase 1.5（PV・クリック + ランキング）'
            : phase === 'phase1'
              ? 'Phase 1（ランキング+手動マスタ）'
              : 'Phase 2';
    }

    const meta = report.comparisonMeta || report.summary || {};
    if (report.status === 'empty') {
      if (statusText) statusText.textContent = 'ランキング未取得';
      if (dot) dot.style.background = '#f59e0b';
      if (fetchMsg) fetchMsg.textContent = '｜「今週のランキングを取得」を実行してください';
    } else if (!report.bestsellers?.length && report.fetchedAt) {
      if (statusText) statusText.textContent = `最終取得: ${fmtDate(report.fetchedAt)}　｜　ランキング0件`;
      if (dot) dot.style.background = '#ef4444';
      const warn =
        report.warnings?.length > 0
          ? `｜取得失敗（${report.warnings.length}件の警告 — サーバーログを確認）`
          : '｜ランキングデータが空です';
      if (fetchMsg) fetchMsg.textContent = warn;
    } else {
      if (statusText) {
        const compareLabel = meta.compareLabel || (meta.hasPrevious ? 'あり' : 'なし');
        statusText.textContent = `最終取得: ${fmtDate(report.fetchedAt)}　｜　比較: ${compareLabel}`;
      }
      if (dot) dot.style.background = report.confirmedAt ? '#22c55e' : '#3b82f6';
      if (fetchMsg) {
        fetchMsg.textContent = report.confirmedAt
          ? `｜確定済み (${fmtDate(report.confirmedAt)})`
          : '｜未確定';
      }
    }

    const csvLink = document.getElementById('weekly-csv-link');
    if (csvLink) {
      if (report.csvDownloadUrl) {
        csvLink.href = report.csvDownloadUrl;
        csvLink.hidden = false;
      } else {
        csvLink.hidden = true;
      }
    }
  }

  function renderFilterCounts(report) {
    const meta = report.comparisonMeta || report.summary || {};
    const upBtn = document.getElementById('filter-up-btn');
    const downBtn = document.getElementById('filter-down-btn');
    const newBtn = document.getElementById('filter-new-btn');
    if (upBtn) upBtn.textContent = `UP (${meta.upCount ?? 0})`;
    if (downBtn) downBtn.textContent = `DOWN (${meta.downCount ?? 0})`;
    if (newBtn) newBtn.textContent = `新入り (${meta.newCount ?? 0})`;
  }

  function renderHubPerformance(report) {
    const hub = report.hubPerformance || {};
    const hubPv = hub.hubPv || {};

    const pvValue = document.getElementById('weekly-hub-pv-value');
    const pvChange = document.getElementById('weekly-hub-pv-change');
    const pvReason = document.getElementById('weekly-hub-pv-reason');
    if (pvValue) pvValue.textContent = formatPv(hubPv.weeklyPv);
    if (pvChange) pvChange.innerHTML = pvChangeCell(hubPv.pvChangePercent);
    if (pvReason) pvReason.textContent = hubPv.reason || '';

    const menuTbody = document.getElementById('weekly-menu-clicks-tbody');
    const menuRows = hub.menuClicks || [];
    if (menuTbody) {
      if (!menuRows.length) {
        menuTbody.innerHTML = '<tr><td colspan="4" class="weekly-empty-cell">見出しクリックデータなし</td></tr>';
      } else {
        menuTbody.innerHTML = menuRows
          .map(
            (r) => `<tr>
            <td>${esc(r.label)}</td>
            <td>${r.weeklyClicks ?? '—'}</td>
            <td>${pvChangeCell(r.clickChangePercent)}</td>
            <td class="weekly-reason-cell">${esc(r.reason)}</td>
          </tr>`
          )
          .join('');
      }
    }

    const prodTbody = document.getElementById('weekly-product-clicks-tbody');
    const prodRows = hub.productClicks || [];
    if (prodTbody) {
      if (!prodRows.length) {
        prodTbody.innerHTML = '<tr><td colspan="6" class="weekly-empty-cell">商品クリックデータなし</td></tr>';
      } else {
        prodTbody.innerHTML = prodRows
          .map(
            (r) => `<tr>
            <td>${esc(r.label)}${r.isHighClick ? ' <span class="weekly-badge weekly-badge-warn">高クリック</span>' : ''}</td>
            <td>${r.position ?? '—'}位</td>
            <td>${esc(r.section)}</td>
            <td>${r.weeklyClicks ?? '—'}</td>
            <td>${pvChangeCell(r.clickChangePercent)}</td>
            <td class="weekly-reason-cell">${esc(r.reason)}</td>
          </tr>`
          )
          .join('');
      }
    }
  }

  function taskItemHtml(t, showPriority) {
    return `<li class="weekly-task-item" data-task-id="${esc(t.id)}">
      <label class="weekly-task-label">
        <input type="checkbox" class="weekly-task-check" />
        <span class="weekly-task-body">
          ${showPriority && t.priorityLevel ? `${priorityBadge(t.priorityLevel)} ` : ''}
          <strong>${esc(t.title)}</strong>
          <span class="weekly-task-detail">${esc(t.priorityReason || t.detail)}</span>
        </span>
      </label>
      ${
        t.headingCandidate
          ? `<div class="weekly-task-actions">
          <button type="button" class="secondary weekly-to-headings-btn" data-heading="${esc(t.headingCandidate)}">見出しへ</button>
        </div>`
          : ''
      }
    </li>`;
  }

  function renderTasks(report) {
    const priorityUl = document.getElementById('weekly-priority-list');
    const ul = document.getElementById('weekly-task-list');
    const priorityTasks = report.priorityTasks || [];
    const priorityIds = new Set(priorityTasks.map((t) => t.id));
    const otherTasks = (report.tasks || []).filter((t) => !priorityIds.has(t.id));

    if (priorityUl) {
      if (!priorityTasks.length) {
        priorityUl.innerHTML =
          '<li class="weekly-task-empty">ランキング取得後に優先度TOP3を表示します</li>';
      } else {
        priorityUl.innerHTML = priorityTasks.map((t) => taskItemHtml(t, true)).join('');
      }
    }

    if (!ul) {
      updateTaskProgress();
      return;
    }
    if (!otherTasks.length) {
      ul.innerHTML = '<li class="weekly-task-empty">その他のタスクはありません</li>';
    } else {
      ul.innerHTML = otherTasks.map((t) => taskItemHtml(t, false)).join('');
    }

    document.querySelectorAll('.weekly-task-check').forEach((cb) => {
      cb.addEventListener('change', updateTaskProgress);
    });
    bindHeadingButtons();
    updateTaskProgress();
  }

  function todayInputValue() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function changeDraftStorageKey(category, weekId) {
    return `${CHANGE_DRAFT_KEY}:${category || ''}:${weekId || ''}`;
  }

  function loadChangeDraft(category, weekId) {
    try {
      const raw = sessionStorage.getItem(changeDraftStorageKey(category, weekId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.entries) ? parsed.entries : [];
    } catch {
      return [];
    }
  }

  function saveChangeDraft(category, weekId, entries) {
    try {
      sessionStorage.setItem(
        changeDraftStorageKey(category, weekId),
        JSON.stringify({ category, weekId, entries, savedAt: Date.now() })
      );
    } catch {
      /* ignore */
    }
  }

  function clearChangeDraft(category, weekId) {
    try {
      sessionStorage.removeItem(changeDraftStorageKey(category, weekId));
    } catch {
      /* ignore */
    }
  }

  function parseTargetOptionValue(value) {
    const raw = String(value || 'hub|柱記事全体');
    const [meta, ...labelParts] = raw.split('|');
    const label = labelParts.join('|') || '柱記事全体';
    if (meta === 'hub' || !meta) {
      return { targetType: 'hub', targetLabel: label || '柱記事全体' };
    }
    const [kind, id] = meta.split(':');
    if (kind === 'section') {
      return { targetType: 'section', sectionId: id || null, targetLabel: label };
    }
    if (kind === 'menu') {
      return { targetType: 'menu', menuHeadingId: id || null, targetLabel: label };
    }
    if (kind === 'product') {
      return { targetType: 'product', productId: id || null, targetLabel: label };
    }
    return { targetType: 'hub', targetLabel: label };
  }

  function populateChangeTargetSelect(report) {
    const select = document.getElementById('weekly-change-target');
    if (!select) return;
    const targets = report?.changeTargets?.length
      ? report.changeTargets
      : [{ value: 'hub', label: '柱記事全体', targetType: 'hub' }];
    select.innerHTML = targets
      .map((t) => {
        const value = `${t.value}|${t.label}`;
        return `<option value="${esc(value)}">${esc(t.label)}</option>`;
      })
      .join('');
  }

  function renderChangeDraftTable() {
    const tbody = document.getElementById('weekly-change-draft-tbody');
    const msg = document.getElementById('weekly-change-draft-msg');
    if (!tbody) return;
    if (!changeDraftEntries.length) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="weekly-empty-cell">まだ登録がありません</td></tr>';
      if (msg) msg.textContent = '';
      return;
    }
    if (msg) {
      msg.textContent = `${changeDraftEntries.length} 件（確定前。週次レポート確定時に保存されます）`;
    }
    tbody.innerHTML = changeDraftEntries
      .map(
        (e, idx) => `<tr>
        <td>${esc(e.changedAt || '—')}</td>
        <td>${esc(e.targetLabel || '—')}</td>
        <td>${esc(e.description || '—')}</td>
        <td>${esc(e.expectedEffect || '—')}</td>
        <td><button type="button" class="secondary weekly-change-remove" data-index="${idx}">削除</button></td>
      </tr>`
      )
      .join('');
    tbody.querySelectorAll('.weekly-change-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.index);
        if (Number.isNaN(i)) return;
        changeDraftEntries.splice(i, 1);
        const category = currentReport?.category || getWeeklyCategory();
        const weekId = currentReport?.weekId || '';
        saveChangeDraft(category, weekId, changeDraftEntries);
        renderChangeDraftTable();
      });
    });
  }

  function addChangeDraftEntry() {
    const dateEl = document.getElementById('weekly-change-date');
    const targetEl = document.getElementById('weekly-change-target');
    const descEl = document.getElementById('weekly-change-description');
    const expectedEl = document.getElementById('weekly-change-expected');
    const description = descEl?.value.trim() || '';
    if (!description) {
      showError('改修内容を入力してください。');
      return;
    }
    showError('');
    const target = parseTargetOptionValue(targetEl?.value);
    const entry = {
      id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      changedAt: dateEl?.value || todayInputValue(),
      ...target,
      description,
      expectedEffect: expectedEl?.value.trim() || '',
    };
    changeDraftEntries.push(entry);
    const category = currentReport?.category || getWeeklyCategory();
    const weekId = currentReport?.weekId || '';
    saveChangeDraft(category, weekId, changeDraftEntries);
    if (descEl) descEl.value = '';
    if (expectedEl) expectedEl.value = '';
    renderChangeDraftTable();
  }

  function initChangeRegisterForm(report) {
    const dateEl = document.getElementById('weekly-change-date');
    if (dateEl && !dateEl.value) dateEl.value = todayInputValue();
    populateChangeTargetSelect(report);
    const category = report?.category || getWeeklyCategory();
    const weekId = report?.weekId || '';
    changeDraftEntries = loadChangeDraft(category, weekId);
    renderChangeDraftTable();
  }

  function renderChangeEffects(report) {
    const msg = document.getElementById('weekly-change-effects-msg');
    const tbody = document.getElementById('weekly-change-effects-tbody');
    if (!tbody) return;

    const effects = report.changeEffects || {};
    const rows = effects.items || [
      ...(effects.articleItems || []),
      ...(effects.productItems || []),
    ];

    if (msg) {
      msg.textContent =
        effects.message ||
        (rows.length ? `先週登録分 ${rows.length} 件の前後比` : '');
    }

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="weekly-empty-cell">${esc(
        effects.message ||
          '先週登録した改修がありません。上で登録して週次を確定すると、来週ここに結果が出ます。'
      )}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map(
        (r) => `<tr>
        <td>${verdictBadge(r.verdict, r.verdictLabel)}</td>
        <td>${esc(r.changeDescription || '—')}</td>
        <td>${esc(r.productLabel || r.menuLabel || r.articleTitle || '—')}</td>
        <td>${formatBeforeAfter(r.pvBefore, r.pvNow, r.pvChangePercent, formatPv)}</td>
        <td>${formatBeforeAfter(
          r.productClicksBefore ?? r.clicksBefore,
          r.productClicksNow ?? r.clicksNow,
          r.productClickChangePercent ?? r.clickChangePercent,
          (v) => (v == null ? '—' : String(v))
        )}</td>
        <td>${formatBeforeAfter(r.cvBefore, r.cvNow, r.cvChangePercent, formatCv)}</td>
        <td class="weekly-reason-cell">${esc(r.reason || '—')}</td>
        <td>${esc(r.changeWeekId || '—')}</td>
      </tr>`
      )
      .join('');
  }

  function renderComparison(report) {
    const tbody = document.getElementById('weekly-ranking-tbody');
    if (!tbody) return;
    const changes = report.comparison?.changes || [];
    if (!changes.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="weekly-empty-cell">変動データなし</td></tr>';
      return;
    }
    tbody.innerHTML = changes
      .map(
        (c) => `<tr data-type="${esc(c.type)}">
        <td><span class="weekly-badge ${badgeClass(c.type)}">${badgeLabel(c.type)}</span></td>
        <td>${esc(c.manufacturer || '—')}</td>
        <td>${esc(c.productName || c.label || '—')}</td>
        <td>${esc(c.modelCode || c.modelKey || '—')}</td>
        <td>${esc(c.amazonChange)}</td>
        <td>${esc(c.rakutenChange)}</td>
        <td>${esc(c.yahooChange)}</td>
        <td>${esc(c.kojimaChange)}</td>
        <td>${esc(c.bicChange)}</td>
        <td>${c.delta > 0 ? `+${c.delta}` : c.delta < 0 ? String(c.delta) : c.type === 'new' ? '新規' : '—'}</td>
      </tr>`
      )
      .join('');
  }

  function renderInterest(report) {
    const tbody = document.getElementById('weekly-interest-tbody');
    const footnote = document.getElementById('weekly-interest-footnote');
    if (!tbody) return;

    const interest = report.googleSearchInterest || {};
    const rows = interest.items || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="2" class="weekly-empty-cell">${esc(
        interest.error || '検索データを取得できませんでした'
      )}</td></tr>`;
    } else {
      tbody.innerHTML = rows
        .map(
          (r) => `<tr>
          <td>${r.rank}</td>
          <td>${esc(r.query)}</td>
        </tr>`
        )
        .join('');
    }

    if (footnote) {
      const when = interest.fetchedAt ? fmtDate(interest.fetchedAt) : '—';
      footnote.textContent = interest.error
        ? `※ ${interest.error}`
        : `※ Google サジェストから自動取得（${interest.keyword || report.category} / ${when}）`;
    }
  }

  function competitorPriorityBadge(priority) {
    if (priority === 'high') return '<span class="weekly-badge weekly-badge-warn">高</span>';
    return '<span class="weekly-badge weekly-badge-info">中</span>';
  }

  function headingChangeBadge(changeType) {
    if (changeType === 'added') {
      return '<span class="weekly-badge weekly-badge-up">追加</span>';
    }
    if (changeType === 'removed') {
      return '<span class="weekly-badge weekly-badge-down">削除</span>';
    }
    return '<span class="weekly-badge weekly-badge-info">—</span>';
  }

  function loadStoredCompetitorAnalysis(category) {
    try {
      const raw = sessionStorage.getItem(COMPETITOR_ANALYSIS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.category && category && parsed.category !== category) return null;
      return parsed.data || null;
    } catch {
      return null;
    }
  }

  async function fetchLastCompetitorAnalysis(category) {
    if (!category) return null;
    try {
      const res = await fetch(
        `/api/competitor-articles/last-analysis?category=${encodeURIComponent(category)}`
      );
      if (res.status === 404) return null;
      const data = await res.json();
      if (!res.ok) return null;
      return data;
    } catch {
      return null;
    }
  }

  function renderHeadingUpdatesTable(data) {
    const tbody = document.getElementById('weekly-heading-updates-tbody');
    const hint = document.getElementById('weekly-heading-updates-hint');
    if (!tbody) return;

    const updates = data?.headingUpdates || [];
    const summary = data?.summary || {};
    const firstFetchCount = summary.firstFetchCount ?? 0;
    const successCount = summary.successCount ?? 0;

    if (!data) {
      tbody.innerHTML = '<tr><td colspan="6" class="weekly-empty-cell">更新見出しなし</td></tr>';
      if (hint) {
        hint.textContent = '初回取得後、次回の比較から追加・削除された見出しを表示します。';
      }
      return;
    }

    if (firstFetchCount > 0 && firstFetchCount >= successCount && !updates.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="weekly-empty-cell">初回取得のため、次回から更新見出しを表示します</td></tr>';
      if (hint) {
        hint.textContent =
          '見出しスナップショットを保存しました。次回の「競合記事を取得・比較」で前回比の追加・削除が表示されます。';
      }
      return;
    }

    if (!updates.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="weekly-empty-cell">前回比で追加・削除された見出しはありません</td></tr>';
      if (hint) {
        hint.textContent = `前回取得との差分はありません${data.fetchedAt ? `（今回: ${fmtDate(data.fetchedAt)}）` : ''}`;
      }
      return;
    }

    if (hint) {
      hint.textContent = `前回比で ${updates.length} 件の見出し更新${data.fetchedAt ? ` / ${fmtDate(data.fetchedAt)}` : ''}`;
    }

    const sorted = [...updates].sort((a, b) => {
      const order = { added: 0, removed: 1 };
      return (order[a.changeType] ?? 9) - (order[b.changeType] ?? 9) ||
        String(a.site || '').localeCompare(String(b.site || ''), 'ja') ||
        String(a.heading || '').localeCompare(String(b.heading || ''), 'ja');
    });

    tbody.innerHTML = sorted
      .map(
        (u) => `<tr class="${u.changeType === 'removed' ? 'weekly-heading-removed' : 'weekly-heading-added'}">
        <td>${headingChangeBadge(u.changeType)}</td>
        <td>${esc(u.site)}</td>
        <td>${esc(u.heading)}</td>
        <td>${esc(u.level?.toUpperCase() || '')}</td>
        <td>${esc(fmtDate(u.previousFetchedAt))}</td>
        <td><a href="${esc(u.url)}" target="_blank" rel="noopener">参照</a></td>
      </tr>`
      )
      .join('');
  }

  function renderCompetitorComparison(data) {
    const msg = document.getElementById('weekly-competitor-msg');
    renderHeadingUpdatesTable(data);

    if (!data) {
      if (msg) {
        msg.textContent =
          '競合調査タブで記事 URL を保存後、「競合記事を取得・比較」を実行してください。';
      }
      return;
    }

    const summary = data.summary || {};
    if (msg) {
      msg.textContent = [
        `競合 ${summary.successCount ?? 0}/${summary.competitorCount ?? 0} 件取得`,
        `更新見出し ${summary.headingUpdateCount ?? 0}件`,
        data.fetchedAt ? fmtDate(data.fetchedAt) : null,
      ]
        .filter(Boolean)
        .join(' / ');
    }
  }

  async function resolveCompetitorAnalysis(report) {
    const category = report?.category || getWeeklyCategory();
    const fromServer = await fetchLastCompetitorAnalysis(category);
    if (fromServer) return fromServer;
    if (report?.competitorAnalysis) return report.competitorAnalysis;
    return loadStoredCompetitorAnalysis(category) || currentCompetitorAnalysis;
  }

  async function renderReport(report) {
    currentReport = report;
    renderHeader(report);
    renderCompareSelect(report);
    renderProducts(report);
    currentCompetitorAnalysis = await resolveCompetitorAnalysis(report);
    renderCompetitorComparison(currentCompetitorAnalysis);
    initChangeRegisterForm(report);
    renderChangeEffects(report);
    renderTopics(report);
  }

  function bindHeadingButtons() {
    document.querySelectorAll('.weekly-to-headings-btn').forEach((btn) => {
      btn.replaceWith(btn.cloneNode(true));
    });
    document.querySelectorAll('.weekly-to-headings-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const heading = btn.dataset.heading;
        const all = collectHeadings(currentReport || {});
        goToHeadings(heading ? [heading, ...all.filter((h) => h !== heading)] : all);
      });
    });
  }

  function showError(msg) {
    const el = document.getElementById('weekly-error');
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function getWeeklyCategory() {
    if (window.CategorySelect) {
      return (
        window.CategorySelect.get('weekly-category', 'weekly-category-other') ||
        window.CategorySelect.defaultCategory ||
        '掃除機'
      );
    }
    return document.getElementById('weekly-category')?.value || '掃除機';
  }

  async function loadReport() {
    const category = getWeeklyCategory();
    const compare = getCompareMode();
    showError('');
    try {
      const res = await fetch(
        `/api/weekly/report?category=${encodeURIComponent(category)}&compare=${encodeURIComponent(compare)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'レポートの読み込みに失敗しました');
      await renderReport(data);
    } catch (err) {
      showError(err.message);
    }
  }

  async function fetchRankings() {
    const category = getWeeklyCategory();
    const compare = getCompareMode();
    const btn = document.getElementById('weekly-fetch');
    const msg = document.getElementById('weekly-fetch-msg');
    showError('');

    if (btn) {
      btn.disabled = true;
      btn.textContent = '取得中…（数分かかることがあります）';
    }
    if (msg) msg.textContent = '｜ランキング取得中…';

    try {
      const res = await fetch('/api/weekly/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, compare }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || '取得に失敗しました');
      await renderReport(data);
    } catch (err) {
      showError(err.message);
      if (msg) msg.textContent = '｜取得失敗';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '今週のランキングを取得';
      }
    }
  }

  async function confirmReport() {
    if (!currentReport?.weekId) return;
    const category = currentReport.category || getWeeklyCategory();
    const weekId = currentReport.weekId;
    showError('');
    try {
      const res = await fetch('/api/weekly/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          weekId,
          changeEntries: changeDraftEntries,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '確定に失敗しました');
      clearChangeDraft(category, weekId);
      changeDraftEntries = [];
      renderChangeDraftTable();
      const msg = document.getElementById('weekly-confirm-msg');
      if (msg) {
        const changeNote =
          data.changeLogCount != null ? ` / 改修ログ ${data.changeLogCount} 件` : '';
        msg.textContent = `${data.weekId} の週次レポートを確定しました（${fmtDate(data.confirmedAt)}）。来週の前週比に使用されます${changeNote}。`;
        msg.classList.add('weekly-confirm-done');
      }
      await loadReport();
    } catch (err) {
      showError(err.message);
    }
  }

  document.getElementById('weekly-to-headings-main')?.addEventListener('click', () => {
    goToHeadings(collectHeadings(currentReport || {}));
  });

  document.getElementById('weekly-to-kyoso')?.addEventListener('click', () => {
    const weeklyCat = getWeeklyCategory();
    if (window.CategorySelect) {
      window.CategorySelect.set('kyoso-category', 'kyoso-category-other', weeklyCat);
    }
    document.querySelector('.tab-btn[data-tab="kyoso"]')?.click();
  });

  async function analyzeCompetitorFromWeekly() {
    const category = getWeeklyCategory();
    const btn = document.getElementById('weekly-competitor-analyze');
    const msg = document.getElementById('weekly-competitor-msg');
    showError('');

    if (btn) {
      btn.disabled = true;
      btn.textContent = '取得中…';
    }
    if (msg) msg.textContent = '競合記事を取得・比較中…';

    try {
      const res = await fetch('/api/competitor-articles/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '比較に失敗しました');
      currentCompetitorAnalysis = data;
      try {
        sessionStorage.setItem(
          COMPETITOR_ANALYSIS_KEY,
          JSON.stringify({ category, data, storedAt: Date.now() })
        );
      } catch {
        /* ignore */
      }
      renderCompetitorComparison(data);
    } catch (err) {
      showError(err.message);
      if (msg) msg.textContent = '｜比較失敗';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '競合記事を取得・比較';
      }
    }
  }

  document.getElementById('weekly-competitor-analyze')?.addEventListener('click', analyzeCompetitorFromWeekly);

  document.getElementById('weekly-competitor-setup')?.addEventListener('click', () => {
    const weeklyCat = getWeeklyCategory();
    if (window.CategorySelect) {
      window.CategorySelect.set('kyoso-category', 'kyoso-category-other', weeklyCat);
    }
    document.querySelector('.tab-btn[data-tab="kyoso"]')?.click();
    document.getElementById('kyoso-article-panel')?.scrollIntoView({ behavior: 'smooth' });
  });

  window.addEventListener('competitor-analysis-updated', (ev) => {
    const category = getWeeklyCategory();
    if (ev.detail?.category && category && ev.detail.category !== category) return;
    currentCompetitorAnalysis = ev.detail?.data || null;
    renderCompetitorComparison(currentCompetitorAnalysis);
  });

  window.addEventListener('weekly-category-changed', () => {
    loadReport();
  });

  window.addEventListener('categories-ready', () => {
    loadReport();
  });

  document.getElementById('weekly-change-add')?.addEventListener('click', addChangeDraftEntry);
  document.getElementById('weekly-change-description')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      addChangeDraftEntry();
    }
  });

  document.getElementById('weekly-fetch')?.addEventListener('click', fetchRankings);
  document.getElementById('weekly-confirm')?.addEventListener('click', confirmReport);
  document.getElementById('weekly-compare')?.addEventListener('change', loadReport);

  // categories-ready 後に loadReport する（初期は空の select になりうる）
})();
