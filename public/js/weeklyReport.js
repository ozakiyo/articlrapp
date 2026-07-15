/**
 * 週次レポート（②-A）— API 連携と5問いの描画
 */
(function () {
  const WEEKLY_CONTEXT_KEY = 'articleappNode.weeklyContext';
  const RANKING_CONTEXT_KEY = 'articleappNode.rankingContext';
  const COMPETITOR_ANALYSIS_KEY = 'articleappNode.competitorAnalysis';

  let currentReport = null;
  let currentCompetitorAnalysis = null;

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

  function renderWeeklyPoints(report) {
    const ul = document.getElementById('weekly-points-list');
    const seasonInline = document.getElementById('weekly-season-inline');
    const footnote = document.getElementById('weekly-points-footnote');
    const wp = report.weeklyPoints || {};
    const points = wp.points?.length ? wp.points : ['ポイントなし'];
    if (ul) ul.innerHTML = points.map((t) => `<li>${esc(t)}</li>`).join('');

    const s = wp.season || report.season || {};
    if (seasonInline) {
      const parts = [
        s.thisWeek ? `今週: ${s.thisWeek}` : null,
        s.nextWeek ? `来週: ${s.nextWeek}` : null,
        s.monthTheme ? `今月: ${s.monthTheme}` : null,
      ].filter(Boolean);
      seasonInline.textContent = parts.length ? parts.join(' ｜ ') : '—';
    }

    const newsTbody = document.getElementById('weekly-news-tbody');
    const newsRows = report.news || [];
    if (newsTbody) {
      if (!newsRows.length) {
        newsTbody.innerHTML = '<tr><td colspan="4" class="weekly-empty-cell">ニュースなし</td></tr>';
      } else {
        newsTbody.innerHTML = newsRows
          .map(
            (r) => `<tr>
            <td>${esc(r.date)}</td>
            <td>${esc(r.content)}</td>
            <td>${esc(r.impact)}</td>
            <td>${esc(r.action)}</td>
          </tr>`
          )
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

    renderTasks(report);
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

    const replacements = report.replacements || [];
    const bestsellers = report.bestsellers || [];
    const rising = report.rising || [];
    const seenLabels = new Set();
    const htmlRows = [];

    const headingBtn = (candidate) =>
      candidate
        ? `<button type="button" class="secondary weekly-to-headings-btn" data-heading="${esc(candidate)}">見出しへ</button>`
        : '';

    for (const r of bestsellers) {
      seenLabels.add(r.label);
      const rep = findReplacementForProduct(replacements, r.label);
      htmlRows.push(`<tr>
        <td><span class="weekly-badge weekly-badge-info">売れ筋</span></td>
        <td>${r.rank}</td>
        <td>${esc(r.manufacturer || '—')}</td>
        <td>${esc(r.productName || r.label || '—')}</td>
        <td>${esc(r.modelCode || r.modelKey || '—')}</td>
        <td>${rankCell(r.rankAmazon)}</td>
        <td>${rankCell(r.rankRakuten)}</td>
        <td>${rankCell(r.rankYahoo)}</td>
        <td>${rankCell(r.rankKojima)}</td>
        <td>${rankCell(r.rankBic)}</td>
        <td>${replacementCell(rep)}</td>
        <td class="weekly-reason-cell">${esc(r.reason)}</td>
        <td>${headingBtn(rep?.headingCandidate)}</td>
      </tr>`);
    }

    for (const r of rising) {
      if (seenLabels.has(r.label)) continue;
      seenLabels.add(r.label);
      const rep = findReplacementForProduct(replacements, r.label);
      htmlRows.push(`<tr>
        <td><span class="weekly-badge ${badgeClass(r.type)}">${badgeLabel(r.type)}</span></td>
        <td>${rankCell(r.compositeRank)}${r.delta > 0 ? ` (+${r.delta})` : r.type === 'new' ? ' 新規' : ''}</td>
        <td>${esc(r.manufacturer || '—')}</td>
        <td>${esc(r.productName || r.label || '—')}</td>
        <td>${esc(r.modelCode || r.modelKey || '—')}</td>
        <td>${esc(r.amazonChange)}</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td>${replacementCell(rep)}</td>
        <td class="weekly-reason-cell">${esc(r.reason)}</td>
        <td>${headingBtn(rep?.headingCandidate)}</td>
      </tr>`);
    }

    for (const rep of replacements) {
      const alreadyShown = [...seenLabels].some(
        (l) => l.includes(rep.fromLabel) || rep.fromLabel.includes(l)
      );
      if (alreadyShown) continue;
      htmlRows.push(`<tr>
        <td><span class="weekly-badge weekly-badge-warn">入替</span></td>
        <td>${rep.fromPosition ? `${rep.fromPosition}位` : '—'}</td>
        <td colspan="3">${esc(rep.fromLabel)}</td>
        <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
        <td>→ <strong>${esc(rep.toLabel)}</strong></td>
        <td class="weekly-reason-cell">${esc(rep.reason)}</td>
        <td>${headingBtn(rep.headingCandidate)}</td>
      </tr>`);
    }

    if (!htmlRows.length) {
      tbody.innerHTML =
        '<tr><td colspan="13" class="weekly-empty-cell">ランキング未取得、または該当なし</td></tr>';
      return;
    }
    tbody.innerHTML = htmlRows.join('');
    bindHeadingButtons();
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

  function renderChangeEffects(report) {
    const msg = document.getElementById('weekly-change-effects-msg');
    const articleTbody = document.getElementById('weekly-change-effects-article-tbody');
    const productTbody = document.getElementById('weekly-change-effects-product-tbody');
    const effects = report.changeEffects || {};
    if (msg) msg.textContent = effects.message || '';

    const articleRows = effects.articleItems || (effects.items || []).filter((r) => r.effectType === 'article');
    const productRows = effects.productItems || (effects.items || []).filter((r) => r.effectType === 'product');

    if (articleTbody) {
      if (!articleRows.length) {
        articleTbody.innerHTML = `<tr><td colspan="6" class="weekly-empty-cell">${esc(
          effects.hasData ? '記事の変更ログなし' : effects.message || '先週の確定データ待ち'
        )}</td></tr>`;
      } else {
        articleTbody.innerHTML = articleRows
          .map(
            (r) => `<tr>
            <td>${esc(r.articleTitle)}</td>
            <td>${esc(r.changeDescription)}</td>
            <td>${formatPv(r.pvBefore)} → ${formatPv(r.pvNow)} ${pvChangeCell(r.pvChangePercent)}</td>
            <td>${r.menuClicksBefore != null ? `${r.menuClicksBefore}→${r.menuClicksNow} ${pvChangeCell(r.menuClickChangePercent)}` : '—'}</td>
            <td>${verdictBadge(r.verdict, r.verdictLabel)}</td>
            <td class="weekly-reason-cell">${esc(r.reason)}</td>
          </tr>`
          )
          .join('');
      }
    }

    if (productTbody) {
      if (!productRows.length) {
        productTbody.innerHTML = `<tr><td colspan="5" class="weekly-empty-cell">${esc(
          effects.hasData ? '商品の変更ログなし' : effects.message || '先週の確定データ待ち'
        )}</td></tr>`;
      } else {
        productTbody.innerHTML = productRows
          .map(
            (r) => `<tr>
            <td>${esc(r.productLabel || r.articleTitle)}</td>
            <td>${esc(r.changeDescription)}</td>
            <td>${r.clicksBefore != null ? `${r.clicksBefore}→${r.clicksNow} ${pvChangeCell(r.clickChangePercent)}` : '—'}</td>
            <td>${verdictBadge(r.verdict, r.verdictLabel)}</td>
            <td class="weekly-reason-cell">${esc(r.reason)}</td>
          </tr>`
          )
          .join('');
      }
    }
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

  function renderCompetitorComparison(data) {
    const tbody = document.getElementById('weekly-competitor-tbody');
    const msg = document.getElementById('weekly-competitor-msg');
    if (!tbody) return;

    if (!data) {
      tbody.innerHTML = '<tr><td colspan="6" class="weekly-empty-cell">比較データなし</td></tr>';
      if (msg) {
        msg.textContent =
          '競合調査タブで記事 URL を保存後、「競合記事を取得・比較」を実行してください。';
      }
      return;
    }

    const proposals = data.proposals || [];
    const summary = data.summary || {};
    if (msg) {
      msg.textContent = `自社見出し ${data.ownHeadingCount ?? 0}件 / 競合 ${summary.successCount ?? 0}/${summary.competitorCount ?? 0} 件取得 / 改修候補 ${summary.proposalCount ?? 0}件（高優先 ${summary.highPriorityCount ?? 0}）${data.fetchedAt ? ` / ${fmtDate(data.fetchedAt)}` : ''}`;
    }

    if (!proposals.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="weekly-empty-cell">自社にない見出し候補はありません</td></tr>';
      return;
    }

    tbody.innerHTML = proposals
      .map(
        (p) => `<tr>
        <td>${competitorPriorityBadge(p.priority)}</td>
        <td>${esc(p.site)}</td>
        <td>${esc(p.heading)}</td>
        <td>${esc(p.level?.toUpperCase() || '')}</td>
        <td class="weekly-reason-cell">${esc(p.reason)}</td>
        <td><a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">参照</a></td>
      </tr>`
      )
      .join('');
  }

  function renderReport(report) {
    currentReport = report;
    renderHeader(report);
    renderCompareSelect(report);
    renderFilterCounts(report);
    renderWeeklyPoints(report);
    renderHubPerformance(report);
    renderProducts(report);
    renderComparison(report);
    currentCompetitorAnalysis =
      report.competitorAnalysis ||
      loadStoredCompetitorAnalysis(report.category) ||
      currentCompetitorAnalysis;
    renderCompetitorComparison(currentCompetitorAnalysis);
    renderArticles(report);
    renderInterest(report);
    renderChangeEffects(report);
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
      renderReport(data);
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
      renderReport(data);
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
    showError('');
    try {
      const res = await fetch('/api/weekly/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, weekId: currentReport.weekId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '確定に失敗しました');
      const msg = document.getElementById('weekly-confirm-msg');
      if (msg) {
        msg.textContent = `${data.weekId} の週次レポートを確定しました（${fmtDate(data.confirmedAt)}）。来週の前週比に使用されます。`;
        msg.classList.add('weekly-confirm-done');
      }
      await loadReport();
    } catch (err) {
      showError(err.message);
    }
  }

  document.querySelectorAll('.weekly-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => filterRankingRows(btn.dataset.filter));
  });

  document.getElementById('weekly-all-headings')?.addEventListener('click', () => {
    goToHeadings(collectHeadings(currentReport || {}));
  });

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

  document.getElementById('weekly-fetch')?.addEventListener('click', fetchRankings);
  document.getElementById('weekly-confirm')?.addEventListener('click', confirmReport);
  document.getElementById('weekly-compare')?.addEventListener('change', loadReport);

  // categories-ready 後に loadReport する（初期は空の select になりうる）
})();
