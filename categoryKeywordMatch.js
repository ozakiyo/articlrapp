'use strict';

/**
 * ランキング抽出のキーワード一致をカテゴリ別プロファイルで切り替える。
 * 未定義カテゴリは正規化後の部分一致のみ。
 */

const { getCategorySlug, normalizeCategoryLabel } = require('./categoryRegistry');

function normalizeForKeywordMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/\s+/g, '')
    .trim();
}

function parseInchThresholdFromKeyword(keyword) {
  const normalized = normalizeForKeywordMatch(keyword);
  const match = normalized.match(/(\d+(?:\.\d+)?)インチ以上/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function includes4kSignal(text) {
  const normalized = normalizeForKeywordMatch(text);
  return (
    normalized.includes('4k') ||
    normalized.includes('3840x2160') ||
    normalized.includes('uhd')
  );
}

function extractMaxInchFromText(text) {
  const normalized = normalizeForKeywordMatch(text).replace(/ｃ/g, 'c');
  const regex = /(\d+(?:\.\d+)?)c?インチ/g;
  let max = null;
  let m;
  while ((m = regex.exec(normalized)) !== null) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    if (max === null || value > max) {
      max = value;
    }
  }
  return max;
}

function blockIncludesAny(normalizedBlock, aliases) {
  return (aliases || []).some((a) => {
    const n = normalizeForKeywordMatch(a);
    return n && normalizedBlock.includes(n);
  });
}

/** キーワード正規化語 → ブロック側の別名リスト（キーワード自身も含めてよい） */
function aliasMatcher(aliasMap) {
  return (normalizedKeyword, normalizedBlock) => {
    const aliases = aliasMap[normalizedKeyword];
    if (!aliases) return null; // この matcher では判断しない
    return blockIncludesAny(normalizedBlock, aliases);
  };
}

function displaySpecialMatchers() {
  return [
    (normalizedKeyword, normalizedBlock) => {
      if (normalizedKeyword !== '4k') return null;
      return includes4kSignal(normalizedBlock);
    },
    (normalizedKeyword, normalizedBlock) => {
      const inchThreshold = parseInchThresholdFromKeyword(normalizedKeyword);
      if (inchThreshold === null) return null;
      const maxInch = extractMaxInchFromText(normalizedBlock);
      return maxInch !== null && maxInch >= inchThreshold;
    },
  ];
}

const PROFILES = {
  display: {
    id: 'display',
    signalMatchers: [
      ...displaySpecialMatchers(),
      aliasMatcher({
        液晶: ['液晶', 'lcd'],
        oled: ['oled', '有機el', '有機ｅｌ'],
        '有機el': ['oled', '有機el', '有機ｅｌ'],
      }),
    ],
  },
  vacuum: {
    id: 'vacuum',
    signalMatchers: [
      aliasMatcher({
        紙パック: ['紙パック', 'ペーパーパック', '紙ぱっく'],
        サイクロン: ['サイクロン', '遠心分離'],
        コードレス: ['コードレス', '充電式', 'スティック'],
        ロボット: ['ロボット', 'ロボ型', 'ロボット掃除機'],
        吸引力: ['吸引力', 'パワフル吸引'],
      }),
    ],
  },
  window_ac: {
    id: 'window_ac',
    signalMatchers: [
      aliasMatcher({
        工事不要: ['工事不要', '取付簡単', '自分で取付'],
        冷房専用: ['冷房専用', '冷房のみ'],
        冷暖房: ['冷暖房', '暖房'],
        騒音: ['騒音', '静音', '低騒音'],
      }),
    ],
  },
  spot_cooler: {
    id: 'spot_cooler',
    signalMatchers: [
      aliasMatcher({
        工事不要: ['工事不要', '取付不要'],
        ダクトレス: ['ダクトレス', '排熱ダクト不要'],
        除湿: ['除湿', 'ドライ'],
        家庭用: ['家庭用', '家庭向け'],
      }),
    ],
  },
  scale: {
    id: 'scale',
    signalMatchers: [
      aliasMatcher({
        体脂肪: ['体脂肪', '体組成', '体脂肪率'],
        スマホ連動: ['スマホ連動', 'アプリ連動', 'bluetooth', 'ble', 'wifi'],
        bluetooth: ['bluetooth', 'ble', 'スマホ連動', 'アプリ連動'],
        薄型: ['薄型', 'スリム'],
      }),
    ],
  },
  default: {
    id: 'default',
    signalMatchers: [],
  },
};

/** slug / label / キーワード含有でプロファイル ID を決める */
const SLUG_TO_PROFILE = {
  soujiki: 'vacuum',
  madowindow_ac: 'window_ac',
  spot_cooler: 'spot_cooler',
  taiju_taiso: 'scale',
};

const LABEL_HINTS = [
  { profile: 'display', hints: ['テレビ', '液晶テレビ', '有機el', 'モニター', 'ディスプレイ', 'テレビ台'] },
  { profile: 'vacuum', hints: ['掃除機', 'クリーナー', 'ロボット掃除機'] },
  { profile: 'window_ac', hints: ['窓用エアコン', '窓エアコン'] },
  { profile: 'spot_cooler', hints: ['スポットクーラー', 'スポットエアコン'] },
  { profile: 'scale', hints: ['体重計', '体組成計', '体脂肪計'] },
];

function resolveMatchProfileId(category) {
  const label = normalizeCategoryLabel(category);
  if (!label) return 'default';

  const slug = getCategorySlug(label);
  if (SLUG_TO_PROFILE[slug]) return SLUG_TO_PROFILE[slug];

  const lower = label.toLowerCase();
  for (const row of LABEL_HINTS) {
    if (row.hints.some((h) => lower.includes(String(h).toLowerCase()))) {
      return row.profile;
    }
  }
  return 'default';
}

function resolveMatchProfile(category) {
  const id = resolveMatchProfileId(category);
  return PROFILES[id] || PROFILES.default;
}

/**
 * @param {string} keyword
 * @param {string} blockText
 * @param {string} [category]
 */
function keywordMatchesBlock(keyword, blockText, category) {
  const normalizedKeyword = normalizeForKeywordMatch(keyword);
  const normalizedBlock = normalizeForKeywordMatch(blockText);

  if (!normalizedKeyword) return true;

  const profile = resolveMatchProfile(category);
  for (const matcher of profile.signalMatchers || []) {
    const result = matcher(normalizedKeyword, normalizedBlock);
    if (result === null || result === undefined) continue;
    return Boolean(result);
  }

  return normalizedBlock.includes(normalizedKeyword);
}

module.exports = {
  normalizeForKeywordMatch,
  parseInchThresholdFromKeyword,
  includes4kSignal,
  extractMaxInchFromText,
  resolveMatchProfile,
  resolveMatchProfileId,
  keywordMatchesBlock,
  PROFILES,
};
