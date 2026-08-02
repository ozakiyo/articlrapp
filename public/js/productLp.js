/**
 * 個別商品ページ（記事同型・通常／新製品発売）
 */
(function () {
  let lastHtml = '';
  let optionRowSeq = 0;
  let imageRowSeq = 0;

  const SAMPLE_MAIN_IMAGE =
    'https://picsum.photos/seed/articleapp-product-main/1200/675';
  const SAMPLE_DETAIL_IMAGE =
    'https://picsum.photos/seed/articleapp-product-detail/800/500';
  const SAMPLE_SPEC_IMAGE =
    'https://picsum.photos/seed/articleapp-product-spec/800/450';

  const PLACEMENT_OPTIONS = [
    { value: 'after_intro', label: '導入文の後' },
    { value: 'after_section', label: '指定見出し（H2）の後' },
    { value: 'before_specs', label: 'スペックの前' },
    { value: 'after_options', label: 'オプションの後' },
    { value: 'before_summary', label: 'まとめの前' },
    { value: 'before_faq', label: 'よくある質問の前' },
    { value: 'before_end_cta', label: '末尾CTAの前' },
  ];

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

  function figureHtml(img) {
    if (!img?.url) return '';
    let html = `<p class="pc_tac pc_mt15"><img src="${esc(img.url)}" alt="${esc(
      img.alt || ''
    )}" class="pc_w100per" /></p>`;
    if (img.caption) html += `<p class="pc_tac pc_fontS">${esc(img.caption)}</p>`;
    return html;
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

  function placementSelectHtml(selected) {
    return PLACEMENT_OPTIONS.map(
      (o) =>
        `<option value="${o.value}"${
          o.value === selected ? ' selected' : ''
        }>${o.label}</option>`
    ).join('');
  }

  function syncImageH2Field(row) {
    const placement = row.querySelector('.productlp-img-placement')?.value;
    const h2Wrap = row.querySelector('.productlp-img-h2-wrap');
    if (h2Wrap) h2Wrap.hidden = placement !== 'after_section';
  }

  function addImageRow(prefill) {
    const list = document.getElementById('productlp-images-list');
    if (!list) return;
    const id = `img-${++imageRowSeq}`;
    const row = document.createElement('div');
    row.className = 'productlp-option-row productlp-image-row';
    row.dataset.imageId = id;
    row.innerHTML = `
      <div class="productlp-image-grid">
        <label class="field">
          <span>画像URL</span>
          <input type="url" class="productlp-img-url" placeholder="https://" />
        </label>
        <label class="field">
          <span>代替テキスト／キャプション</span>
          <input type="text" class="productlp-img-alt" placeholder="例: 本体イメージ" />
        </label>
        <label class="field">
          <span>挿入位置</span>
          <select class="productlp-img-placement">${placementSelectHtml(
            prefill?.placement || 'after_intro'
          )}</select>
        </label>
        <label class="field productlp-img-h2-wrap" hidden>
          <span>この見出し（H2）の後に挿入（部分一致）</span>
          <input type="text" class="productlp-img-after-h2" placeholder="例: 選ばれる理由 / 注意点" />
        </label>
      </div>
      <div class="actions">
        <button type="button" class="secondary productlp-img-remove">この行を削除</button>
      </div>
    `;
    list.appendChild(row);
    row.querySelector('.productlp-img-remove')?.addEventListener('click', () => {
      row.remove();
    });
    row
      .querySelector('.productlp-img-placement')
      ?.addEventListener('change', () => syncImageH2Field(row));
    if (prefill) {
      if (prefill.url) row.querySelector('.productlp-img-url').value = prefill.url;
      if (prefill.alt) row.querySelector('.productlp-img-alt').value = prefill.alt;
      if (prefill.caption && !prefill.alt) {
        row.querySelector('.productlp-img-alt').value = prefill.caption;
      }
      if (prefill.placement) {
        row.querySelector('.productlp-img-placement').value = prefill.placement;
      }
      if (prefill.afterH2) {
        row.querySelector('.productlp-img-after-h2').value = prefill.afterH2;
      }
    }
    syncImageH2Field(row);
  }

  function clearImageRows() {
    const list = document.getElementById('productlp-images-list');
    if (list) list.innerHTML = '';
  }

  function collectImages() {
    const rows = document.querySelectorAll('#productlp-images-list .productlp-image-row');
    const out = [];
    rows.forEach((row) => {
      const url = String(row.querySelector('.productlp-img-url')?.value || '').trim();
      if (!url) return;
      const alt = String(row.querySelector('.productlp-img-alt')?.value || '').trim();
      out.push({
        url,
        alt,
        caption: alt,
        placement: row.querySelector('.productlp-img-placement')?.value || 'after_intro',
        afterH2: String(row.querySelector('.productlp-img-after-h2')?.value || '').trim(),
      });
    });
    return out;
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
    document.getElementById('productlp-main-image-url').value = SAMPLE_MAIN_IMAGE;
    document.getElementById('productlp-main-image-alt').value =
      'ビックアイデア スポットクーラー BIM-PA26A（サンプル画像）';
    clearImageRows();
    addImageRow({
      url: SAMPLE_DETAIL_IMAGE,
      alt: '使用シーンイメージ（サンプル）',
      placement: 'after_section',
      afterH2: '注目したいポイント',
    });
    addImageRow({
      url: SAMPLE_SPEC_IMAGE,
      alt: 'スペック補足イメージ（サンプル）',
      placement: 'before_specs',
    });
    clearOptionRows();
    addOptionRow({
      name: '窓用排熱パネル（別売想定）',
      modelCode: '',
      notes: '排熱ダクトを窓へ固定するためのパネル。設置環境により必要。',
    });
    setStatus(
      'BIM-PA26A（新製品発売）サンプルを入力しました。メイン／その他画像もサンプルURLを入れています。'
    );
  }

  function resetForm() {
    document.getElementById('form-productlp')?.reset();
    const tone = document.getElementById('productlp-tone');
    if (tone) tone.value = 'new_release';
    clearOptionRows();
    clearImageRows();
    showError('');
    setStatus('');
  }

  function renderCtaPreview(cta, heading) {
    if (!cta?.label) return '';
    let html = `<div class="generated-block"><h3>${esc(heading)}</h3>
      <p class="linkbtn pc_mt15 pc_w80per product-cta">`;
    if (cta.url) {
      html += `<a href="${esc(cta.url)}" class="pc_pv25" target="_blank" rel="noopener">${esc(cta.label)}</a>`;
    } else {
      html += `<span class="pc_pv25">${esc(cta.label)}</span>`;
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

    // プレビューは CMS HTML と同じ並びを優先（画像位置込み）
    if (data.html) {
      body.innerHTML = `<div class="generated-block"><h3>プレビュー（CMS用HTML）</h3>
        <div class="generated-article productlp-html-preview">${data.html}</div></div>`;
      lastHtml = data.html;
      if (htmlOut) htmlOut.value = lastHtml;
      return;
    }

    let html = '';
    if (data.title) {
      html += `<div class="generated-block"><h3>タイトル（H1）</h3><p>${esc(data.title)}</p></div>`;
    }
    if (data.mainImage?.url) {
      html += `<div class="generated-block"><h3>メイン画像（ファーストビュー）</h3>${figureHtml(
        data.mainImage
      )}</div>`;
    }
    html += renderCtaPreview(data.cta, 'CTA');
    body.innerHTML = html;
    lastHtml = '';
    if (htmlOut) htmlOut.value = '';
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
    const images = collectImages();
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
      mainImageUrl: document.getElementById('productlp-main-image-url')?.value || '',
      mainImageAlt: document.getElementById('productlp-main-image-alt')?.value || '',
      images,
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
      .getElementById('productlp-add-image')
      ?.addEventListener('click', () => addImageRow());
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
