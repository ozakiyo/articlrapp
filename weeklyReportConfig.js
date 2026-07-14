/**
 * 週次レポート設計の確定事項（プラン合意内容をコード化）
 */
module.exports = {
  defaultCategory: '掃除機',

  bestseller: {
    topN: 15,
    compareTopN: 50,
    mallWeights: {
      amazon: 1.0,
      rakuten: 0.9,
      yahoo: 0.9,
      kojima: 1.1,
      bic: 1.0,
    },
    minMallCountForHighlight: 2,
  },

  /** 柱記事1ページPV + 商品別・見出し別クリック */
  articlePerformancePhase: 'hub-clicks',

  reasonMode: 'rule',
  weekDefinition: 'iso',

  signals: {
    rankUpMinDelta: 3,
    rankDownMinDelta: 3,
    staleArticleWeeks: 3,
    maxRisingProducts: 3,
    maxReplacements: 3,
    maxNewArticles: 2,
    maxArticleChanges: 4,
    maxPriorityTasks: 3,
  },

  performance: {
    hubPvDeclineAlertPercent: -10,
    hubPvGrowthPercent: 5,
    menuClickGrowthPercent: 10,
    highProductClickThreshold: 200,
  },

  /** 優先度 = 商品クリック + 見出しクリック + 掲載順位 + 柱記事PV変化 */
  priorityScoring: {
    productClickWeight: 0.8,
    menuClickWeight: 0.3,
    highClickBonus: 25,
    clickDeclineBonus: 15,
    hubPvDeclineBonus: 10,
    topPositionBonus: 15,
    stalePenaltyPerWeek: 3,
    highThreshold: 80,
    mediumThreshold: 40,
  },

  weeklyExportDirName: 'weekly',

  comparison: {
    defaultMode: 'latest',
    modes: [
      { id: 'latest', label: '先週の最終' },
      { id: 'prev_month', label: '前月の最終' },
    ],
  },

  /** Google サジェスト共通 seeds（カテゴリ別は categoryRegistry を優先） */
  googleSuggest: {
    topN: 10,
    seeds: ['おすすめ', 'ランキング', '安い', '一人暮らし'],
  },
};
