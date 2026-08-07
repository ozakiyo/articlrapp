/**
 * 週次レポート設計（目的: CV・売上・利益）
 * 主KPI = CV（売上）、補助 = 商品詳細遷移 → 記事PV
 * 毎週の成果物 = CVを伸ばす打ち手最大3件
 *
 * 将来拡張: 粗利率が取れるようになったら CV金額 × 粗利率 で利益表示を追加可能
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

  /** 記事コンテンツ1ページPV + 商品別・見出し別クリック（CV補助指標） */
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

  /** 判定閾値（主: CV → 商品詳細遷移 → PV） */
  performance: {
    hubPvDeclineAlertPercent: -10,
    hubPvGrowthPercent: 5,
    menuClickGrowthPercent: 10,
    highProductClickThreshold: 200,
    /** CV 前週比（貼付KPI） */
    cvGrowthPercent: 5,
    cvDeclineAlertPercent: -10,
    productDetailGrowthPercent: 10,
    productDetailDeclineAlertPercent: -15,
  },

  /**
   * 優先度 = CV寄与の見込み
   * 商品詳細クリック（購入導線）> 見出しクリック > 掲載順位 > 記事PV変化
   */
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
