/**
 * 個別商品ページ（記事同型・通常／新製品発売）
 */
(function () {
  let lastHtml = '';
  let optionRowSeq = 0;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  function paragraphsHtml(text) {
    return String(text || '')
      .split(/\n\n+/)
      .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function getCategory() {
    if (window.CategorySelect) {
      return window.CategorySelect.get('productlp-category', 'productlp-category-other');
    }
    return document.getElementById('productlp-category')?.value || '';
  }

  function showError(msg) {
    const el = document.getElementById('productlp-error');
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function setStatus(msg) {
    const el = document.getElementById('productlp-status');
    if (el) el.textContent = msg || '';
  }

  function addOptionRow(prefill) {
    const list = document.getElementById('productlp-options-list');
    if (!list) return;
    const id = `opt-${++optionRowSeq}`;
    const row = document.createElement('div');
    row.className = 'productlp-option-row';
    row.dataset.optionId = id;
    row.innerHTML = `
      <div class="productlp-option-grid">
        <label class="field">
          <span>オプション名</span>
          <input type="text" class="productlp-opt-name" placeholder="例: 窓用パネル" />
        </label>
        <label class="field">
          <span>型番</span>
          <input type="text" class="productlp-opt-model" placeholder="例: WP-xx" />
        </label>
        <label class="field">
          <span>商品URL</span>
          <input type="url" class="productlp-opt-url" placeholder="https://" />
        </label>
        <label class="field">
          <span>補足</span>
          <input type="text" class="productlp-opt-notes" placeholder="用途・セット内容など" />
        </label>
      </div>
      <div class="actions">
        <button type="button" class="secondary productlp-opt-remove">この行を削除</button>
      </div>
    `;
    list.appendChild(row);
    row.querySelector('.productlp-opt-remove')?.addEventListener('click', () => {
      row.remove();
    });
    if (prefill) {
      if (prefill.name) row.querySelector('.productlp-opt-name').value = prefill.name;
      if (prefill.modelCode) row.querySelector('.productlp-opt-model').value = prefill.modelCode;
      if (prefill.url) row.querySelector('.productlp-opt-url').value = prefill.url;
      if (prefill.notes) row.querySelector('.productlp-opt-notes').value = prefill.notes;
    }
  }

  function clearOptionRows() {
    const list = document.getElementById('productlp-options-list');
    if (list) list.innerHTML = '';
  }

  function collectOptions() {
    const rows = document.querySelectorAll('#productlp-options-list .productlp-option-row');
    const out = [];
    rows.forEach((row) => {
      const name = String(row.querySelector('.productlp-opt-name')?.value || '').trim();
      const modelCode = String(row.querySelector('.productlp-opt-model')?.value || '').trim();
      const url = String(row.querySelector('.productlp-opt-url')?.value || '').trim();
      const notes = String(row.querySelector('.productlp-opt-notes')?.value || '').trim();
      if (!name && !modelCode && !url) return;
      out.push({ name, modelCode, url, notes });
    });
    return out;
  }

  function fillSampleBimPa26a() {
    if (window.CategorySelect) {
      window.CategorySelect.set(
        'productlp-category',
        'productlp-category-other',
        'スポットクーラー'
      );
    }
    const tone = document.getElementById('productlp-tone');
    if (tone) tone.value = 'new_release';
    document.getElementById('productlp-manufacturer').value = 'ビックアイデア';
    document.getElementById('productlp-name').value = 'スポットクーラー';
    document.getElementById('productlp-model').value = 'BIM-PA26A';
    document.getElementById('productlp-release-date').value = '2026年夏';
    document.getElementById('productlp-reservation').checked = true;
    document.getElementById('productlp-notes').value =
      '冷風・温風・ドライ・送風の1台4役。おやすみ運転（12時間後自動停止）。工事不要。キャスター付き。本体サイズ 高さ696×幅303×奥行き290mm、重量約20.7kg、冷房能力2.3/2.6kW（50/60Hz）。';
    document.getElementById('productlp-cta-label').value =
      '新製品の詳細・ご購入はこちら';
    document.getElementById('productlp-skip-scrape').checked = false;
    document.getElementById('productlp-reference-url').value =
      'https://www.kojima.net/ec/Special/feature/reading/season/spot_cooler.html';
    clearOptionRows();
    addOptionRow({
      name: '窓用排熱パネル（別売想定）',
      modelCode: '',
      notes: '排熱ダクトを窓へ固定するためのパネル。設置環境により必要。',
    });
    setStatus(
      'BIM-PA26A（新製品発売）サンプルを入力しました。公式／参考URLがあれば入れてから生成してください。'
    );
  }

  function resetForm() {
    document.getElementById('form-productlp')?.reset();
    const tone = document.getElementById('productlp-tone');
    if (tone) tone.value = 'new_release';
    clearOptionRows();
    showError('');
    setStatus('');
  }

  function renderCtaPreview(cta, heading) {
    if (!cta?.label) return '';
    let html = `<div class="generated-block"><h3>${esc(heading)}</h3>
      <p class="product-cta">`;
    if (cta.url) {
      html += `<a class="product-cta-button" href="${esc(cta.url)}" target="_blank" rel="noopener">${esc(
        cta.label
      )}</a>`;
    } else {
      html += `<span class="product-cta-button product-cta-label">${esc(cta.label)}</span>`;
    }
    html += `</p></div>`;
    return html;
  }

  function renderResult(data) {
    const result = document.getElementById('productlp-result');
    const body = document.getElementById('productlp-body');
    const htmlOut = document.getElementById('productlp-html-output');
    const warnEl = document.getElementById('productlp-warnings');
    if (!result || !body) return;
    result.hidden = false;

    if (warnEl) {
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      if (warnings.length) {
        warnEl.hidden = false;
        warnEl.innerHTML =
          '<strong>取得警告</strong><ul>' +
          warnings
            .map((w) => `<li>${esc(w.url || '')}: ${esc(w.message || '')}</li>`)
            .join('') +
          '</ul>';
      } else {
        warnEl.hidden = true;
        warnEl.innerHTML = '';
      }
    }

    let html = '';
    if (data.seoTitle || data.metaDescription) {
      html += `<div class="generated-block"><h3><span class="pillar-tag pillar-seo">SEO</span> タイトル／メタ</h3>`;
      if (data.seoTitle) html += `<p><strong>title:</strong> ${esc(data.seoTitle)}</p>`;
      if (data.metaDescription) {
        html += `<p><strong>description:</strong> ${esc(data.metaDescription)}</p>`;
      }
      html += `</div>`;
    }
    if (data.title) {
      html += `<div class="generated-block"><h3>タイトル（H1）</h3><p>${esc(data.title)}</p></div>`;
    }
    if (data.tone) {
      html += `<p class="field-hint">トーン: ${
        data.tone === 'new_release' ? '新製品発売' : '通常'
      }</p>`;
    }
    if (data.releaseDate || data.reservationOpen) {
      html += `<div class="generated-block"><h3>発売情報</h3><ul>`;
      if (data.releaseDate) {
        html += `<li><strong>発売日:</strong> ${esc(data.releaseDate)}</li>`;
      }
      if (data.reservationOpen) {
        html += `<li><strong>予約:</strong> 予約受付中</li>`;
      }
      html += `</ul></div>`;
    }
    if (data.directAnswer) {
      html += `<div class="generated-block"><h3><span class="pillar-tag pillar-aeo">AEO</span> 直接回答</h3>
        <div class="direct-answer-block generated-text">${paragraphsHtml(data.directAnswer)}</div></div>`;
    }
    if (data.introduction) {
      html += `<div class="generated-block"><h3>導入文</h3>
        <div class="generated-text">${paragraphsHtml(data.introduction)}</div></div>`;
    }
    html += renderCtaPreview(data.cta, 'CTA（ファーストビュー）');
    const bodySections = (data.sections || []).filter(
      (sec) => !/スペック|まとめ|購入案内|よくある質問|FAQ|Ｑ＆Ａ|Q&A/i.test(sec.h2 || '')
    );
    bodySections.forEach((sec) => {
      html += `<div class="generated-block section-block"><h3>${esc(sec.h2 || '')}</h3>`;
      (sec.items || []).forEach((item) => {
        if (item.h3) html += `<h4>${esc(item.h3)}</h4>`;
        if (item.content) {
          html += `<div class="generated-text">${paragraphsHtml(item.content)}</div>`;
        }
      });
      html += `</div>`;
    });
    if ((data.specTable || []).length) {
      html += `<div class="generated-block"><h3>主なスペック</h3><table class="productlp-spec-table"><tbody>`;
      data.specTable.forEach((row) => {
        html += `<tr><th>${esc(row.label)}</th><td>${esc(row.value)}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }
    if ((data.options || []).length) {
      const hasOptionsSection = bodySections.some((s) =>
        /オプション/.test(String(s.h2 || ''))
      );
      html += `<div class="generated-block"><h3>${
        hasOptionsSection ? 'オプション品一覧' : 'オプション品'
      }</h3><ul>`;
      data.options.forEach((o) => {
        const label = [o.name, o.modelCode].filter(Boolean).join(' / ');
        html += `<li><strong>${esc(label)}</strong>`;
        if (o.notes) html += ` — ${esc(o.notes)}`;
        if (o.url) {
          html += ` <a href="${esc(o.url)}" target="_blank" rel="noopener">詳細</a>`;
        }
        html += `</li>`;
      });
      html += `</ul></div>`;
    }
    if (data.summary) {
      html += `<div class="generated-block"><h3>まとめ</h3>
        <div class="generated-text">${paragraphsHtml(data.summary)}</div></div>`;
    }
    if ((data.faq || []).length) {
      html += `<div class="generated-block"><h3>よくある質問</h3>`;
      data.faq.forEach((q) => {
        html += `<h4>${esc(q.question)}</h4><p>${esc(q.answer)}</p>`;
      });
      html += `</div>`;
    }
    html += renderCtaPreview(data.cta, 'CTA（末尾）');

    body.innerHTML = html;
    lastHtml = data.html || '';
    if (htmlOut) htmlOut.value = lastHtml;
  }

  async function generate(ev) {
    ev?.preventDefault();
    showError('');
    const productName = String(document.getElementById('productlp-name')?.value || '').trim();
    const modelCode = String(document.getElementById('productlp-model')?.value || '').trim();
    if (!productName && !modelCode) {
      showError('商品名または型番を入力してください。');
      return;
    }

    const options = collectOptions();
    const submit = document.getElementById('productlp-submit');
    if (submit) submit.disabled = true;
    const hasUrls = Boolean(
      document.getElementById('productlp-official-url')?.value ||
        document.getElementById('productlp-reference-url')?.value ||
        options.some((o) => o.url)
    );
    setStatus(
      hasUrls && !document.getElementById('productlp-skip-scrape')?.checked
        ? '生成中…（公式／参考／オプションURLを取得しています）'
        : '生成中…'
    );

    const body = window.AiProvider?.withBody
      ? window.AiProvider.withBody({})
      : { aiProvider: 'gemini' };

    Object.assign(body, {
      category: getCategory(),
      tone: document.getElementById('productlp-tone')?.value || 'new_release',
      manufacturer: document.getElementById('productlp-manufacturer')?.value || '',
      productName,
      modelCode,
      officialUrl: document.getElementById('productlp-official-url')?.value || '',
      referenceUrl: document.getElementById('productlp-reference-url')?.value || '',
      purchaseUrl: document.getElementById('productlp-purchase-url')?.value || '',
      ctaLabel: document.getElementById('productlp-cta-label')?.value || '',
      releaseDate: document.getElementById('productlp-release-date')?.value || '',
      reservationOpen: Boolean(
        document.getElementById('productlp-reservation')?.checked
      ),
      featureNotes: document.getElementById('productlp-notes')?.value || '',
      options,
      skipScrape: Boolean(document.getElementById('productlp-skip-scrape')?.checked),
    });

    try {
      const res = await fetch('/api/product-lp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.details || `HTTP ${res.status}`);
      }
      renderResult(data);
      setStatus(
        `完了（AI: ${data.aiProviderUsed || '—'} / 取得ソース: ${data.scrapedCount ?? 0}）`
      );
    } catch (err) {
      showError(err.message || String(err));
      setStatus('');
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  async function copyHtml() {
    const text =
      document.getElementById('productlp-html-output')?.value || lastHtml || '';
    const msg = document.getElementById('productlp-copy-msg');
    if (!text) {
      if (msg) {
        msg.hidden = false;
        msg.textContent = 'コピーするHTMLがありません。';
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
      if (msg) {
        msg.hidden = false;
        msg.textContent = 'コピーに失敗しました。テキストエリアから手動で選択してください。';
      }
    }
  }

  function clearResult() {
    const result = document.getElementById('productlp-result');
    const body = document.getElementById('productlp-body');
    const htmlOut = document.getElementById('productlp-html-output');
    if (result) result.hidden = true;
    if (body) body.innerHTML = '';
    if (htmlOut) htmlOut.value = '';
    lastHtml = '';
  }

  function init() {
    document
      .getElementById('productlp-add-option')
      ?.addEventListener('click', () => addOptionRow());
    document
      .getElementById('form-productlp')
      ?.addEventListener('submit', (e) => generate(e));
    document
      .getElementById('productlp-fill-sample')
      ?.addEventListener('click', () => fillSampleBimPa26a());
    document
      .getElementById('productlp-reset')
      ?.addEventListener('click', () => resetForm());
    document
      .getElementById('productlp-copy-html')
      ?.addEventListener('click', () => copyHtml());
    document
      .getElementById('productlp-clear')
      ?.addEventListener('click', () => clearResult());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
