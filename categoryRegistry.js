/**
 * カテゴリ一覧・スラッグ・サジェスト seeds の一元管理
 */
const weeklyReportConfig = require('./weeklyReportConfig');
const { listSavedRankingCategories } = require('./rankingUrlStore');
const { listSavedCompetitorCategories } = require('./competitorArticlesStore');

const DEFAULT_CATEGORY = weeklyReportConfig.defaultCategory || '掃除機';

const OTHER_OPTION_VALUE = '__other__';

/** @type {{ label: string, slug: string, suggestSeeds: string[] }[]} */
const BUILTIN_CATEGORIES = [
  {
    label: '掃除機',
    slug: 'soujiki',
    suggestSeeds: [
      'おすすめ',
      'ランキング',
      'コードレス',
      'ロボット',
      '一人暮らし',
      '安い',
      '紙パック',
    ],
  },
  {
    label: '窓用エアコン',
    slug: 'madowindow_ac',
    suggestSeeds: [
      'おすすめ',
      'ランキング',
      '冷房専用',
      '冷暖房',
      '工事不要',
      '騒音',
      '電気代',
    ],
  },
  {
    label: 'スポットクーラー',
    slug: 'spot_cooler',
    suggestSeeds: [
      'おすすめ',
      'ランキング',
      '工事不要',
      'ダクトレス',
      '家庭用',
      '除湿',
      '安い',
    ],
  },
];

const COMMON_SUGGEST_SEEDS =
  weeklyReportConfig.googleSuggest?.seeds ||
  ['おすすめ', 'ランキング', '安い', '一人暮らし'];

const SLUG_BY_LABEL = new Map(BUILTIN_CATEGORIES.map((c) => [c.label, c.slug]));
const SEEDS_BY_LABEL = new Map(
  BUILTIN_CATEGORIES.map((c) => [c.label, c.suggestSeeds])
);

function normalizeCategoryLabel(category) {
  return String(category || '').trim();
}

function slugifyCategory(category) {
  const label = normalizeCategoryLabel(category);
  if (!label) return 'default';
  if (SLUG_BY_LABEL.has(label)) return SLUG_BY_LABEL.get(label);

  // ASCII-safe ファイル名。日本語はそのまま許容（記事マスタ・スナップショット用）
  const slug = label
    .replace(/\s+/g, '_')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return slug || 'default';
}

function getCategorySlug(category) {
  return slugifyCategory(category);
}

function getSuggestSeeds(category) {
  const label = normalizeCategoryLabel(category);
  if (SEEDS_BY_LABEL.has(label)) return [...SEEDS_BY_LABEL.get(label)];
  return [...COMMON_SUGGEST_SEEDS];
}

function isBuiltinCategory(category) {
  const label = normalizeCategoryLabel(category);
  return BUILTIN_CATEGORIES.some((c) => c.label === label);
}

/**
 * ビルトイン + 保存済みランキングURL / 競合記事のカテゴリをマージ
 * @returns {{ id: string, label: string, slug: string, source: 'builtin' | 'saved' }[]}
 */
function listCategories() {
  const byLabel = new Map();

  for (const c of BUILTIN_CATEGORIES) {
    byLabel.set(c.label, {
      id: c.label,
      label: c.label,
      slug: c.slug,
      source: 'builtin',
    });
  }

  const pushSaved = (label) => {
    const name = normalizeCategoryLabel(label);
    if (!name || byLabel.has(name)) return;
    byLabel.set(name, {
      id: name,
      label: name,
      slug: getCategorySlug(name),
      source: 'saved',
    });
  };

  try {
    for (const row of listSavedRankingCategories()) {
      pushSaved(row.category);
    }
  } catch (err) {
    console.warn('⚠️ listCategories: ranking URLs', err.message);
  }

  try {
    for (const row of listSavedCompetitorCategories()) {
      pushSaved(row.category);
    }
  } catch (err) {
    console.warn('⚠️ listCategories: competitor articles', err.message);
  }

  const builtinOrder = BUILTIN_CATEGORIES.map((c) => c.label);
  return [...byLabel.values()].sort((a, b) => {
    const ai = builtinOrder.indexOf(a.label);
    const bi = builtinOrder.indexOf(b.label);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.label.localeCompare(b.label, 'ja');
  });
}

function getCategoriesPayload() {
  return {
    defaultCategory: DEFAULT_CATEGORY,
    otherOptionValue: OTHER_OPTION_VALUE,
    categories: listCategories(),
  };
}

module.exports = {
  DEFAULT_CATEGORY,
  OTHER_OPTION_VALUE,
  BUILTIN_CATEGORIES,
  normalizeCategoryLabel,
  getCategorySlug,
  getSuggestSeeds,
  isBuiltinCategory,
  listCategories,
  getCategoriesPayload,
};
