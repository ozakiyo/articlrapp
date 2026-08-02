'use strict';

/**
 * 個別商品ページ原稿生成
 * 構成・出力は既存記事コンテンツと同型（H1→導入→H2/H3→表→FAQ→まとめ＋CTA）
 * tone: standard | new_release
 */

const { parseJsonFromModelOutput } = require('./parseModelJson');

const PRODUCT_PAGE_SECTION_BLUEPRINT = [
  {
    id: 'about',
    h2Standard: '{product}とは？',
    h2NewRelease: '新製品 {product} とは？',
    h3s: ['概要', 'どんな課題を解決するか'],
  },
  {
    id: 'reasons',
    h2Standard: 'この商品が選ばれる理由',
    h2NewRelease: '発売で注目したいポイント',
    h3s: ['特長1', '特長2', '特長3', '特長4'],
  },
  {
    id: 'fit',
    h2Standard: '向いている人・向いていない人',
    h2NewRelease: 'こんな人に向いている／向かない',
    h3s: ['向いている人', '向いていない人'],
  },
  {
    id: 'options',
    h2Standard: 'あわせて使いたいオプション',
    h2NewRelease: 'あわせて使いたいオプション（別売）',
    h3s: ['オプションの役割', '本体との組み合わせ'],
  },
  {
    id: 'notes',
    h2Standard: '使うときの注意点',
    h2NewRelease: '使い始めの注意点',
    h3s: ['設置・排熱・排水', '搬入・設置スペース'],
  },
];

/** sections に載せない（専用フィールドで1回だけ出す）見出しパターン */
const CANONICAL_DEDICATED_H2 = /スペック|まとめ|購入案内|よくある質問|FAQ|Ｑ＆Ａ|Q&A/i;

function normalizeTone(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (
    v === 'new_release' ||
    v === 'new-release' ||
    v === 'launch' ||
    v === '新製品' ||
    v === '新製品発売'
  ) {
    return 'new_release';
  }
  return 'standard';
}

function productLabel(input) {
  const manufacturer = String(input.manufacturer || '').trim();
  const name = String(input.productName || input.product || '').trim();
  const model = String(input.modelCode || input.modelKey || '').trim();
  const parts = [manufacturer, name || model].filter(Boolean);
  if (name && model && !name.includes(model)) parts.push(`（${model}）`);
  return parts.join(' ') || model || name || '対象商品';
}

function ensureConclusionPrefix(content, conclusion) {
  const body = String(content || '').trim();
  const conc = String(conclusion || '').trim();
  if (!body && !conc) return '';
  if (/^結論[:：]/.test(body)) return body;
  if (conc) {
    const line = /^結論[:：]/.test(conc) ? conc : `結論: ${conc}`;
    return body ? `${line}\n\n${body}` : line;
  }
  return body;
}

async function runModelJson(getAiModel, prompt, label) {
  const model = await getAiModel();
  console.log(`🧠 [product-lp:${label}] generateContent`);
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  const raw = result.response?.text?.() || '';
  return parseJsonFromModelOutput(raw);
}

function toneInstructions(tone) {
  if (tone === 'new_release') {
    return `
# 訴求トーン: 新製品発売
- タイトルや導入で「新登場」「新発売」「いま選ぶ理由」を自然に使う
- 発売日・予約受付の入力がある場合は導入・FAQ・まとめに事実として明記する
- 発売時点で押さえるべき特長・差別化を前面に
- FAQに「いつから買えるか」「予約できるか」「旧モデルや他製品との違いは」など発売まわりを含めてよい
- 過度な煽り・根拠のない最上級表現は禁止
`;
  }
  return `
# 訴求トーン: 通常（個別商品ページ）
- 売れ筋・向き不向き・購入判断に役立つ客観的な説明
- 新製品アピールは不要（事実として新しい場合のみ簡潔に）
- 発売日や予約情報がある場合のみ簡潔に触れる
`;
}

function normalizeReleaseDate(value) {
  return String(value || '').trim();
}

function normalizeReservationOpen(value) {
  if (typeof value === 'boolean') return value;
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  return (
    value === true ||
    value === 1 ||
    v === 'true' ||
    v === '1' ||
    v === 'yes' ||
    v === 'on' ||
    v === '予約受付中' ||
    v === '予約中'
  );
}

const SAMPLE_MAIN_IMAGE_URL =
  'https://picsum.photos/seed/articleapp-product-main/1200/675';

const IMAGE_PLACEMENTS = [
  'after_intro',
  'after_section',
  'before_specs',
  'after_options',
  'before_summary',
  'before_faq',
  'before_end_cta',
];

function normalizePlacement(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (IMAGE_PLACEMENTS.includes(v)) return v;
  const map = {
    導入後: 'after_intro',
    導入文の後: 'after_intro',
    見出しの後: 'after_section',
    セクションの後: 'after_section',
    スペックの前: 'before_specs',
    オプションの後: 'after_options',
    まとめの前: 'before_summary',
    faqの前: 'before_faq',
    末尾: 'before_end_cta',
  };
  return map[String(value || '').trim()] || 'after_intro';
}

function normalizeMainImage(raw, productName) {
  const src = raw && typeof raw === 'object' ? raw : { url: raw };
  const url = String(src.url || src.src || '').trim() || SAMPLE_MAIN_IMAGE_URL;
  const alt =
    String(src.alt || src.caption || '').trim() ||
    String(productName || '商品画像').trim() ||
    '商品画像';
  const caption = String(src.caption || '').trim();
  return { url, alt, caption, isSample: !String(src.url || src.src || '').trim() };
}

function normalizeExtraImages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((img) => {
      const url = String(img?.url || img?.src || '').trim();
      if (!url) return null;
      return {
        url,
        alt: String(img?.alt || '').trim() || '商品関連画像',
        caption: String(img?.caption || img?.notes || '').trim(),
        placement: normalizePlacement(img?.placement),
        afterH2: String(img?.afterH2 || img?.h2Contains || img?.sectionHint || '').trim(),
      };
    })
    .filter(Boolean);
}

function normalizeOptionsInput(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => ({
      name: String(o?.name || o?.productName || '').trim(),
      modelCode: String(o?.modelCode || o?.model || '').trim(),
      url: String(o?.url || o?.purchaseUrl || '').trim(),
      notes: String(o?.notes || o?.featureNotes || '').trim(),
    }))
    .filter((o) => o.name || o.modelCode || o.url);
}

function formatOptionsForPrompt(options) {
  if (!options.length) return '（なし。オプション節は短く「別売オプションの確認を推奨」程度でよい）';
  return options
    .map((o, i) => {
      const parts = [
        `${i + 1}. 名称: ${o.name || '（未記入）'}`,
        `型番: ${o.modelCode || '（未記入）'}`,
        `URL: ${o.url || '（なし）'}`,
        `補足: ${o.notes || '（なし）'}`,
      ];
      return parts.join(' / ');
    })
    .join('\n');
}

function buildProductPagePrompt({ input, scrapedTexts, tone }) {
  const label = productLabel(input);
  const category = String(input.category || '').trim() || '家電';
  const ctaUrl = String(input.purchaseUrl || input.ctaUrl || '').trim();
  const ctaLabel =
    String(input.ctaLabel || '').trim() ||
    (tone === 'new_release' ? '新製品の詳細・ご購入はこちら' : '商品詳細はこちら');
  const notes = String(input.featureNotes || input.notes || '').trim();
  const releaseDate = normalizeReleaseDate(
    input.releaseDate || input.launchDate
  );
  const reservationOpen = normalizeReservationOpen(input.reservationOpen);
  const options = normalizeOptionsInput(input.options);
  const hasOptions = options.length > 0;
  const sources = (scrapedTexts || [])
    .map(
      (s, i) =>
        `## ソース${i + 1}: ${s.role ? `[${s.role}] ` : ''}${s.url || '（URLなし）'}\n${String(s.text || '').slice(0, 6000)}`
    )
    .join('\n\n');

  const blueprintForPrompt = PRODUCT_PAGE_SECTION_BLUEPRINT.filter(
    (b) => hasOptions || b.id !== 'options'
  );
  const blueprintLines = blueprintForPrompt.map((b, i) => {
    const h2 = (tone === 'new_release' ? b.h2NewRelease : b.h2Standard).replace(
      '{product}',
      label
    );
    return `   ${i + 1}. H2「${h2}」` + (b.h3s.length ? ` / H3例: ${b.h3s.join('、')}` : '');
  }).join('\n');

  return `
あなたはコジマネットの家電記事ライターです。
既存の「読みもの特集」と同じ記事構成で、**1商品に特化した個別商品ページ**の原稿をJSONで作成してください。
カテゴリ横断の「おすすめ10選」「人気ランキング」「人気メーカー一覧」は作らないでください。

# 対象
- カテゴリ: ${category}
- 商品表示名: ${label}
- メーカー: ${String(input.manufacturer || '').trim() || '（不明）'}
- 商品名: ${String(input.productName || '').trim() || '（不明）'}
- 型番: ${String(input.modelCode || input.modelKey || '').trim() || '（不明）'}
- 発売日: ${releaseDate || '（未指定。捏造しない）'}
- 予約受付: ${reservationOpen ? '予約受付中' : '（予約受付中ではない／未指定）'}
- 補足特長・メモ: ${notes || '（なし）'}
- 購入先URL: ${ctaUrl || '（未指定・文言のみ）'}
- CTAラベル: ${ctaLabel}

# 発売・予約の扱い
${
  releaseDate || reservationOpen
    ? `- 発売日「${releaseDate || '（未記入）'}」、予約「${
        reservationOpen ? '予約受付中' : '通常販売／未指定'
      }」を導入・directAnswer・FAQ・まとめ・specTableに反映する
- 予約受付中の場合はCTAも予約・詳細確認のニュアンスでよい
- 入力にない日付や「予約開始日」を捏造しない`
    : '- 発売日・予約の入力がない場合は推測で書かない'
}

# オプション品（プラスワン／別売）
${formatOptionsForPrompt(options)}
${
  hasOptions
    ? '- 上記オプションは「あわせて使いたいオプション」節で具体的に紹介する（用途・本体との関係）。捏造しない。'
    : '- 入力がない場合、options配列は空配列 [] とし、オプション専用H2は省略してよい。'
}

${toneInstructions(tone)}

# 必須の記事構成（コジマ特集と同じ階層）
1. H1 title
2. introduction（導入）
3. directAnswer（結論1文）
4. sections: 次のH2をこの順で含める（※スペック／まとめ／FAQはここに入れない）
${blueprintLines}
5. specTable（スペック表。専用フィールドのみ。sectionsにスペックH2を作らない）
6. summary（まとめ本文。専用フィールドのみ。sectionsにまとめH2を作らない）
7. faq（3〜5件。専用フィールドのみ。sectionsにFAQのH2を作らない）
8. options（配列。入力がある場合）
9. seoTitle / metaDescription
10. releaseDate / reservationOpen
11. cta: { "label", "url" }

重要: 「主なスペック」「スペック一覧」「まとめ」「よくある質問」は sections に重複して書かないこと。必ず上記の専用フィールドだけに書く。

# 文体ルール
- 家電販売店にふさわしいフォーマルな日本語
- 各本文（introduction以外の段落コンテンツ）の先頭は必ず「結論: …」の1文から始める
- 数値はソースにあるものだけ使う。不明なら「要確認」と書く（捏造禁止）
- 出力は厳密にJSONのみ

# 参考ソース（公式・商品ページ・オプションURL等）
${sources || '（ソースなし。入力情報のみで、不明点は要確認とする）'}

# 出力JSONスキーマ
{
  "title": "H1",
  "directAnswer": "結論1文",
  "introduction": "導入文（複数段落可）",
  "sections": [
    {
      "h2": "見出し",
      "searchIntent": "おすすめ|比較|選び方|用途|FAQ|その他",
      "items": [
        {
          "h3": "小見出し",
          "content": "結論: … 本文"
        }
      ]
    }
  ],
  "specTable": [{ "label": "項目", "value": "値" }],
  "options": [{ "name": "オプション名", "modelCode": "型番", "url": "URL", "notes": "用途説明" }],
  "releaseDate": "${releaseDate || ''}",
  "reservationOpen": ${reservationOpen ? 'true' : 'false'},
  "summary": "結論: … まとめ本文（CTA誘導を含む）",
  "faq": [{ "question": "Q", "answer": "A" }],
  "seoTitle": "60字前後",
  "metaDescription": "120字前後",
  "cta": { "label": "${ctaLabel}", "url": "${ctaUrl}" },
  "sourcesNote": "根拠メモ"
}
`;
}

function ensureLaunchRowsInSpecTable(specTable, releaseDate, reservationOpen) {
  const rows = Array.isArray(specTable) ? [...specTable] : [];
  const hasLabel = (label) =>
    rows.some((r) => String(r.label || '').includes(label));
  if (releaseDate && !hasLabel('発売')) {
    rows.unshift({ label: '発売日', value: releaseDate });
  }
  if (reservationOpen && !hasLabel('予約')) {
    rows.splice(releaseDate ? 1 : 0, 0, {
      label: '予約',
      value: '予約受付中',
    });
  }
  return rows;
}

function normalizeSections(rawSections, label, tone, hasOptions) {
  const list = Array.isArray(rawSections) ? rawSections : [];
  if (list.length) {
    return list
      .map((sec) => ({
        h2: String(sec.h2 || '').trim(),
        searchIntent: String(sec.searchIntent || '').trim() || undefined,
        items: (Array.isArray(sec.items) ? sec.items : [])
          .map((item) => ({
            h3: String(item.h3 || item.title || '').trim(),
            content: ensureConclusionPrefix(item.content, item.conclusion),
            h4_items: Array.isArray(item.h4_items)
              ? item.h4_items
                  .map((h) => ({
                    h4: String(h.h4 || '').trim(),
                    content: ensureConclusionPrefix(h.content, h.conclusion),
                  }))
                  .filter((h) => h.h4)
              : [],
          }))
          .filter((item) => item.h3 || item.content),
      }))
      .filter((sec) => sec.h2 && !CANONICAL_DEDICATED_H2.test(sec.h2))
      .filter((sec) => hasOptions || !/オプション/.test(sec.h2));
  }

  return PRODUCT_PAGE_SECTION_BLUEPRINT.filter(
    (b) => hasOptions || b.id !== 'options'
  ).map((b) => {
    const h2 = (tone === 'new_release' ? b.h2NewRelease : b.h2Standard).replace(
      '{product}',
      label
    );
    return {
      h2,
      items: (b.h3s.length ? b.h3s : ['概要']).map((h3) => ({
        h3,
        content: `結論: ${label}について確認中です。\n\n詳細は商品ページで最新情報を確認してください。`,
        h4_items: [],
      })),
    };
  });
}

function normalizeOptionsOutput(raw, fallbackInput) {
  const fromModel = normalizeOptionsInput(raw);
  if (fromModel.length) return fromModel;
  return normalizeOptionsInput(fallbackInput);
}

function normalizeSpecTable(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      label: String(row.label || row.name || row.key || '').trim(),
      value: String(row.value || row.val || '').trim(),
    }))
    .filter((row) => row.label && row.value);
}

function normalizeFaq(raw, tone) {
  const list = Array.isArray(raw) ? raw : [];
  const faq = list
    .map((q) => ({
      question: String(q.question || q.q || '').trim(),
      answer: String(q.answer || q.a || '').trim(),
    }))
    .filter((q) => q.question && q.answer)
    .slice(0, 6);
  if (faq.length) return faq;
  if (tone === 'new_release') {
    return [
      {
        question: 'いつから買えますか？',
        answer:
          '取扱店舗・通販の掲載状況によります。最新の販売開始・在庫は商品詳細ページで確認してください。',
      },
    ];
  }
  return [
    {
      question: 'どこで詳細を確認できますか？',
      answer: '最新の仕様・価格・在庫は商品詳細ページで確認してください。',
    },
  ];
}

function buildProductPageCmsHtml(data) {
  const escapeHtml = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const renderCtaBlock = () => {
    const cta = data.cta || {};
    if (!cta.label) return '';
    // zzb_special4.css .linkbtn + 縦余白を pc_pv25 で広げる
    const inner = cta.url
      ? `<a href="${escapeHtml(cta.url)}" class="pc_pv25">${escapeHtml(cta.label)}</a>`
      : `<span class="pc_pv25">${escapeHtml(cta.label)}</span>`;
    return `<p class="linkbtn pc_mt15 pc_w80per">${inner}</p>`;
  };

  const renderFigure = (img) => {
    if (!img?.url) return '';
    const cap = img.caption || '';
    return [
      `<p class="pc_tac pc_mt15"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" class="pc_w100per" /></p>`,
      cap ? `<p class="pc_tac pc_fontS">${escapeHtml(cap)}</p>` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const extras = Array.isArray(data.images) ? [...data.images] : [];
  const takeByPlacement = (placement, h2 = '') => {
    const out = [];
    for (let i = extras.length - 1; i >= 0; i -= 1) {
      const img = extras[i];
      if (img.placement !== placement) continue;
      if (placement === 'after_section') {
        const needle = String(img.afterH2 || '').trim();
        if (needle && !String(h2 || '').includes(needle)) continue;
        if (!needle) continue;
      }
      out.unshift(img);
      extras.splice(i, 1);
    }
    if (placement === 'after_section' && !out.length) {
      for (let i = 0; i < extras.length; i += 1) {
        const img = extras[i];
        if (img.placement === 'after_section' && !String(img.afterH2 || '').trim()) {
          out.push(img);
          extras.splice(i, 1);
          break;
        }
      }
    }
    return out.map((img) => renderFigure(img)).join('\n');
  };

  const parts = [];
  // CMS貼り付け前提: ページ側で zzb_special4.css が読み込まれていること。埋め込みCSSは出さない。
  parts.push('<!-- Requires zzb_special4.css (#fwCms_wrapper / #special / .top_title / .linkbtn 等) -->');
  parts.push('<div id="fwCms_wrapper">');
  parts.push('<div id="special">');
  if (data.seoTitle) parts.push(`<!-- SEO title: ${escapeHtml(data.seoTitle)} -->`);
  if (data.metaDescription) {
    parts.push(`<!-- meta description: ${escapeHtml(data.metaDescription)} -->`);
  }
  if (data.title) {
    parts.push(`<h1 class="top_title">${escapeHtml(data.title)}</h1>`);
  }

  if (data.mainImage?.url) {
    parts.push(renderFigure(data.mainImage));
  }

  if (data.releaseDate || data.reservationOpen) {
    const bits = [];
    if (data.releaseDate) bits.push(`発売日: ${escapeHtml(data.releaseDate)}`);
    if (data.reservationOpen) {
      bits.push('<span class="pc_redb">予約受付中</span>');
    }
    parts.push(`<p class="pc_blue pc_mt10"><strong>${bits.join(' ／ ')}</strong></p>`);
  }
  if (data.directAnswer) {
    parts.push(
      `<p class="pc_mt10"><strong>結論:</strong> ${escapeHtml(data.directAnswer)}</p>`
    );
  }
  if (data.introduction) {
    parts.push(
      `<p>${escapeHtml(data.introduction).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
    );
  }
  const afterIntro = takeByPlacement('after_intro');
  if (afterIntro) parts.push(afterIntro);

  const fvCta = renderCtaBlock();
  if (fvCta) parts.push(fvCta);

  const bodySections = (data.sections || []).filter(
    (sec) => !CANONICAL_DEDICATED_H2.test(String(sec.h2 || ''))
  );
  bodySections.forEach((sec) => {
    parts.push(`<h2>${escapeHtml(sec.h2 || '')}</h2>`);
    (sec.items || []).forEach((item) => {
      if (item.h3) parts.push(`<h3>${escapeHtml(item.h3)}</h3>`);
      if (item.content) {
        parts.push(
          `<p>${escapeHtml(item.content).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
        );
      }
      (item.h4_items || []).forEach((h4) => {
        parts.push(`<h4>${escapeHtml(h4.h4 || '')}</h4>`);
        if (h4.content) {
          parts.push(
            `<p>${escapeHtml(h4.content).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
          );
        }
      });
    });
    const afterSec = takeByPlacement('after_section', sec.h2 || '');
    if (afterSec) parts.push(afterSec);
  });

  const beforeSpecs = takeByPlacement('before_specs');
  if (beforeSpecs) parts.push(beforeSpecs);
  if ((data.specTable || []).length) {
    parts.push('<h2>主なスペック</h2>');
    // pickup_spec は zzb_special4 外（記事併用CSS）。クラス名のみ合わせておく。
    parts.push('<table class="pickup_spec pc_w100per"><tbody>');
    data.specTable.forEach((row) => {
      parts.push(
        `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`
      );
    });
    parts.push('</tbody></table>');
  }
  if ((data.options || []).length) {
    const hasOptionsSection = bodySections.some((s) =>
      /オプション/.test(String(s.h2 || ''))
    );
    if (!hasOptionsSection) {
      parts.push('<h2>あわせて使いたいオプション</h2>');
    }
    parts.push('<ul class="listmark_m">');
    data.options.forEach((o) => {
      const label = [o.name, o.modelCode].filter(Boolean).join(' / ');
      let li = `<li><strong>${escapeHtml(label || 'オプション')}</strong>`;
      if (o.notes) li += ` — ${escapeHtml(o.notes)}`;
      if (o.url) {
        li += ` <a href="${escapeHtml(o.url)}">詳細</a>`;
      }
      li += '</li>';
      parts.push(li);
    });
    parts.push('</ul>');
  }
  const afterOptions = takeByPlacement('after_options');
  if (afterOptions) parts.push(afterOptions);

  const beforeSummary = takeByPlacement('before_summary');
  if (beforeSummary) parts.push(beforeSummary);
  if (data.summary) {
    parts.push('<h2>まとめ</h2>');
    parts.push(
      `<p>${escapeHtml(data.summary).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
    );
  }
  const beforeFaq = takeByPlacement('before_faq');
  if (beforeFaq) parts.push(beforeFaq);
  if ((data.faq || []).length) {
    parts.push('<h2>よくある質問</h2>');
    data.faq.forEach((q) => {
      parts.push(`<h3>${escapeHtml(q.question)}</h3>`);
      parts.push(`<p>${escapeHtml(q.answer)}</p>`);
    });
  }
  const beforeEnd = takeByPlacement('before_end_cta');
  if (beforeEnd) parts.push(beforeEnd);
  extras.forEach((img) => parts.push(renderFigure(img)));

  const endCta = renderCtaBlock();
  if (endCta) parts.push(endCta);

  if (data.sourcesNote) {
    parts.push(`<p class="pc_fontS pc_mt15">${escapeHtml(data.sourcesNote)}</p>`);
  }
  parts.push('</div><!-- /#special -->');
  parts.push('</div><!-- /#fwCms_wrapper -->');
  return parts.join('\n');
}

async function generateProductPage({ input, scrapedTexts, getAiModel, tone }) {
  const normalizedTone = normalizeTone(tone || input?.tone);
  const label = productLabel(input || {});
  const inputOptions = normalizeOptionsInput(input?.options);
  const prompt = buildProductPagePrompt({
    input: { ...(input || {}), options: inputOptions },
    scrapedTexts: scrapedTexts || [],
    tone: normalizedTone,
  });
  const data = await runModelJson(getAiModel, prompt, normalizedTone);
  const ctaUrl = String(input?.purchaseUrl || input?.ctaUrl || data?.cta?.url || '').trim();
  const ctaLabel =
    String(input?.ctaLabel || data?.cta?.label || '').trim() ||
    (normalizedTone === 'new_release'
      ? '新製品の詳細・ご購入はこちら'
      : '商品詳細はこちら');
  const options = normalizeOptionsOutput(data?.options, inputOptions);
  const releaseDate =
    normalizeReleaseDate(input?.releaseDate || input?.launchDate) ||
    normalizeReleaseDate(data?.releaseDate);
  const reservationOpen = normalizeReservationOpen(input?.reservationOpen);
  const mainImage = normalizeMainImage(
    input?.mainImage || { url: input?.mainImageUrl, alt: input?.mainImageAlt },
    label
  );
  const images = normalizeExtraImages(input?.images);

  const article = {
    title: String(data?.title || '').trim() || label,
    directAnswer: String(data?.directAnswer || '').trim(),
    introduction: String(data?.introduction || '').trim(),
    sections: normalizeSections(
      data?.sections,
      label,
      normalizedTone,
      options.length > 0
    ),
    specTable: ensureLaunchRowsInSpecTable(
      normalizeSpecTable(data?.specTable),
      releaseDate,
      reservationOpen
    ),
    options,
    releaseDate,
    reservationOpen,
    mainImage,
    images,
    summary: ensureConclusionPrefix(data?.summary, data?.summaryConclusion),
    faq: normalizeFaq(data?.faq, normalizedTone),
    seoTitle: String(data?.seoTitle || '').trim(),
    metaDescription: String(data?.metaDescription || '').trim(),
    cta: { label: ctaLabel, url: ctaUrl },
    sourcesNote: String(data?.sourcesNote || '').trim(),
    tone: normalizedTone,
    productLabel: label,
  };

  return {
    ...article,
    article: {
      h1: article.title,
      introduction: article.introduction,
      summary: article.summary,
      sections: article.sections,
      directAnswer: article.directAnswer,
      faq: article.faq,
      options: article.options,
      releaseDate: article.releaseDate,
      reservationOpen: article.reservationOpen,
      mainImage: article.mainImage,
      images: article.images,
    },
    html: buildProductPageCmsHtml(article),
  };
}

module.exports = {
  PRODUCT_PAGE_SECTION_BLUEPRINT,
  normalizeTone,
  productLabel,
  normalizeOptionsInput,
  normalizeMainImage,
  normalizeExtraImages,
  SAMPLE_MAIN_IMAGE_URL,
  generateProductPage,
  buildProductPageCmsHtml,
};
