(function () {
  const TAB_KEY = 'articleappNode-tab';
  const panels = {
    kyoso: document.getElementById('panel-kyoso'),
    headings: document.getElementById('panel-headings'),
    article: document.getElementById('panel-article'),
  };
  const tabButtons = document.querySelectorAll('.tab-btn');

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
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  let initialTab = 'kyoso';
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved && panels[saved]) initialTab = saved;
  } catch {
    /* ignore */
  }
  showTab(initialTab);

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
      throw new Error(data.error || data.details || 'リクエストに失敗しました。');
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
  const kyosoSubmit = document.getElementById('kyoso-submit');

  formKyoso?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(kyosoError, '');

    const kakaku = document.getElementById('kyoso-kakaku-url').value.trim();
    const other = document.getElementById('kyoso-other-url').value.trim();
    if (!kakaku && !other) {
      showError(kyosoError, '価格.com または別サイトのランキングURLのどちらか一方を入力してください。');
      return;
    }
    if (kakaku && other) {
      showError(kyosoError, '両方のURLには入力できません。どちらか一方だけ入力してください。');
      return;
    }

    const k1 = document.getElementById('kyoso-kw1').value.trim();
    const k2 = document.getElementById('kyoso-kw2').value.trim();
    const keywords = [k1, k2].filter(Boolean);

    setLoading(kyosoSubmit, true, 'ランキングを取得', '取得中...');
    try {
      const data = await postJson('/api/extract-ranking-by-keywords', {
        rankingUrl: kakaku || other,
        keywords,
        keyword1: k1,
        keyword2: k2,
      });

      const items = Array.isArray(data.items)
        ? [...data.items].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
        : [];

      let meta = `対象URL: ${escapeHtml(data.rankingUrl || '')}`;
      if (data.keywords?.length) meta += ` / キーワード: ${escapeHtml(data.keywords.join('、'))}`;
      if (typeof data.count === 'number') meta += ` / ${data.count}件`;
      kyosoMeta.innerHTML = meta;

      kyosoTbody.innerHTML = items
        .map(
          (row) =>
            `<tr>
              <td>${escapeHtml(row.rank)}</td>
              <td>${escapeHtml(row.manufacturer || '')}</td>
              <td>${escapeHtml(row.model || '')}</td>
              <td>${escapeHtml(row.feature || '—')}</td>
            </tr>`
        )
        .join('');

      kyosoResult.hidden = false;
    } catch (err) {
      showError(kyosoError, err.message);
      kyosoResult.hidden = true;
    } finally {
      setLoading(kyosoSubmit, false, 'ランキングを取得', '取得中...');
    }
  });

  document.getElementById('kyoso-reset')?.addEventListener('click', () => {
    formKyoso.reset();
    showError(kyosoError, '');
    kyosoResult.hidden = true;
  });

  document.getElementById('kyoso-clear')?.addEventListener('click', () => {
    kyosoResult.hidden = true;
    showError(kyosoError, '');
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
      const data = await postJson('/api/article/generate-headings', {
        keyword,
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
          html += `<div class="generated-block"><h4>H3-${j + 1}</h4><p>${escapeHtml(h3)}</p></div>`;
        });
        html += '</div>';
      });
      headingsBody.innerHTML = html;
      headingsResult.hidden = false;
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

  // --- 記事生成 ---
  const formArticle = document.getElementById('form-article');
  const articleError = document.getElementById('article-error');
  const articleResult = document.getElementById('article-result');
  const articleBody = document.getElementById('article-body');
  const articleWarnings = document.getElementById('article-warnings');
  const articleSubmit = document.getElementById('article-submit');

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
        heading_h3_first: document.getElementById('article-h3-1').value.trim(),
        heading_h3_second: document.getElementById('article-h3-2').value.trim(),
        heading_h3_third: document.getElementById('article-h3-3').value.trim(),
        competitorUrl1: document.getElementById('article-url1').value.trim(),
        competitorUrl2: document.getElementById('article-url2').value.trim(),
        competitorUrl3: document.getElementById('article-url3').value.trim(),
        referenceUrl: document.getElementById('article-ref-url').value.trim(),
      });

      renderWarnings(articleWarnings, data.warnings);

      const body =
        data.article && typeof data.article === 'object' && !Array.isArray(data.article)
          ? data.article
          : null;
      const h3First = document.getElementById('article-h3-1').value.trim() || body?.h3_first || '';
      const h3Second = document.getElementById('article-h3-2').value.trim() || body?.h3_second || '';
      const h3Third = document.getElementById('article-h3-3').value.trim() || body?.h3_third || '';
      const blocks = [
        { title: h3First, content: body?.h3_first_content || '' },
        { title: h3Second, content: body?.h3_second_content || '' },
        { title: h3Third, content: body?.h3_third_content || '' },
      ].filter((b) => b.title || b.content);

      const intro = body?.introduction ?? data.introduction ?? '';
      const summary = body?.summary ?? data.summary ?? '';

      let html = '';
      if (intro) {
        html += `<div class="generated-block"><h3>導入文</h3><div class="generated-text">${paragraphsHtml(intro)}</div></div>`;
      }
      blocks.forEach((block, idx) => {
        html += '<div class="generated-block section-block">';
        if (block.title) html += `<h4>${escapeHtml(block.title)}</h4>`;
        if (block.content) {
          html += `<div class="generated-text">${paragraphsHtml(block.content)}</div>`;
        }
        html += '</div>';
      });
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
