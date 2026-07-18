const fs = require('fs');
const path = require('path');
const {
  buildCompositeRanking,
  pickUserFeaturesFromComposite,
  extractModelKey,
} = require('./categoryRanking');
const config = require('./weeklyReportConfig');
const { getCategorySlug, normalizeCategoryLabel } = require('./categoryRegistry');

const DATA_DIR = path.join(__dirname, 'data');
const WEEKLY_EXPORT_DIR = path.join(__dirname, 'exports', config.weeklyExportDirName);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeCategoryKey(category) {
  return normalizeCategoryLabel(category).replace(/\s+/g, '');
}

function getIsoWeekId(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getPreviousWeekId(weekId) {
  const m = String(weekId || '').match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week > 1) return `${year}-W${String(week - 1).padStart(2, '0')}`;
  return `${year - 1}-W52`;
}

function formatWeekLabel(weekId) {
  return weekId || getIsoWeekId();
}

function loadArticleMaster(category) {
  const label = normalizeCategoryLabel(category) || category;
  const slug = getCategorySlug(label);
  const filePath = path.join(DATA_DIR, 'articles', `${slug}.json`);
  if (!fs.existsSync(filePath)) {
    return { category: label, articles: [], interestKeywords: [], news: [], season: {} };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function snapshotDirCandidates(category) {
  const slug = getCategorySlug(category) || 'default';
  const legacy = normalizeCategoryLabel(category).replace(/\s+/g, '') || 'default';
  const dirs = [path.join(WEEKLY_EXPORT_DIR, slug)];
  if (legacy !== slug) {
    dirs.push(path.join(WEEKLY_EXPORT_DIR, legacy));
  }
  return dirs;
}

function snapshotPath(category, weekId) {
  const key = getCategorySlug(category) || 'default';
  return path.join(WEEKLY_EXPORT_DIR, key, `${weekId}.json`);
}

function loadSnapshot(category, weekId) {
  for (const dir of snapshotDirCandidates(category)) {
    const filePath = path.join(dir, `${weekId}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  }
  return null;
}

function saveSnapshot(category, weekId, data) {
  const dir = path.dirname(snapshotPath(category, weekId));
  ensureDir(dir);
  const filePath = snapshotPath(category, weekId);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function listSnapshots(category) {
  const ids = new Set();
  for (const dir of snapshotDirCandidates(category)) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) ids.add(f.replace(/\.json$/, ''));
    }
  }
  return [...ids].sort();
}

function findLatestSnapshot(category, beforeWeekId) {
  const ids = listSnapshots(category);
  if (!ids.length) return null;
  if (!beforeWeekId) return loadSnapshot(category, ids[ids.length - 1]);
  const prev = ids.filter((id) => id < beforeWeekId);
  if (!prev.length) return null;
  return loadSnapshot(category, prev[prev.length - 1]);
}

function normalizeCompareMode(compareMode) {
  const modes = (config.comparison?.modes || []).map((m) => m.id);
  const mode = String(compareMode || config.comparison?.defaultMode || 'latest').trim();
  return modes.includes(mode) ? mode : config.comparison?.defaultMode || 'latest';
}

function getSnapshotTimestamp(snapshot) {
  const raw = snapshot?.confirmedAt || snapshot?.fetchedAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function formatCompareDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric' });
}

function formatCompareLabel(modeId, snapshot) {
  const mode = (config.comparison?.modes || []).find((m) => m.id === modeId);
  const label = mode?.label || modeId;
  if (!snapshot) return null;
  const ts = snapshot.confirmedAt || snapshot.fetchedAt;
  return `${label}（${formatCompareDate(ts)} 取得）`;
}

function listSnapshotRecords(category) {
  return listSnapshots(category)
    .map((weekId) => {
      const snapshot = loadSnapshot(category, weekId);
      const timestamp = getSnapshotTimestamp(snapshot);
      if (timestamp == null) return null;
      return {
        weekId,
        timestamp,
        snapshot,
        fetchedAt: snapshot.confirmedAt || snapshot.fetchedAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function findLatestBefore(category, currentSnapshot) {
  const currentTs = getSnapshotTimestamp(currentSnapshot);
  const currentWeekId = currentSnapshot?.weekId;
  if (currentTs == null) return null;

  const records = listSnapshotRecords(category).filter((r) => {
    if (r.weekId === currentWeekId) return false;
    return r.timestamp < currentTs;
  });
  if (!records.length) return null;
  return records[records.length - 1].snapshot;
}

function findPrevMonthEnd(category, currentSnapshot) {
  const currentTs = getSnapshotTimestamp(currentSnapshot);
  if (currentTs == null) return null;

  const currentDate = new Date(currentTs);
  const prevMonth = currentDate.getMonth() === 0 ? 11 : currentDate.getMonth() - 1;
  const prevYear =
    currentDate.getMonth() === 0 ? currentDate.getFullYear() - 1 : currentDate.getFullYear();
  const currentWeekId = currentSnapshot?.weekId;

  const records = listSnapshotRecords(category).filter((r) => {
    if (r.weekId === currentWeekId) return false;
    const d = new Date(r.timestamp);
    return d.getFullYear() === prevYear && d.getMonth() === prevMonth;
  });
  if (!records.length) return null;
  return records[records.length - 1].snapshot;
}

function resolveComparisonSnapshot(category, currentSnapshot, compareMode) {
  const mode = normalizeCompareMode(compareMode);
  if (!currentSnapshot) {
    return { mode, snapshot: null };
  }
  if (mode === 'prev_month') {
    return { mode, snapshot: findPrevMonthEnd(category, currentSnapshot) };
  }
  return { mode, snapshot: findLatestBefore(category, currentSnapshot) };
}

function buildCompareOptions(category, currentSnapshot) {
  const modes = config.comparison?.modes || [
    { id: 'latest', label: '先週の最終' },
    { id: 'prev_month', label: '前月の最終' },
  ];
  return modes.map((m) => {
    const resolved = resolveComparisonSnapshot(category, currentSnapshot, m.id);
    const snap = resolved.snapshot;
    return {
      id: m.id,
      label: m.label,
      weekId: snap?.weekId || null,
      fetchedAt: snap?.confirmedAt || snap?.fetchedAt || null,
      available: Boolean(snap),
      compareLabel: formatCompareLabel(m.id, snap),
    };
  });
}

function attachComparisonFields(report, category, currentSnapshot, compareMode) {
  const mode = normalizeCompareMode(compareMode);
  const compareOptions = buildCompareOptions(category, currentSnapshot);
  const selected = compareOptions.find((o) => o.id === mode);
  const hasPrevious = Boolean(selected?.available);

  return {
    ...report,
    comparisonMeta: {
      ...report.comparisonMeta,
      compareMode: mode,
      compareLabel: hasPrevious ? selected.compareLabel : null,
      compareWeekId: selected?.weekId || null,
      compareFetchedAt: selected?.fetchedAt || null,
      hasPrevious,
      compareNote: !hasPrevious
        ? mode === 'prev_month'
          ? '前月の確定データがありません'
          : '比較用の過去データがありません'
        : null,
    },
    compareOptions,
  };
}

function mallScore(row) {
  const w = config.bestseller.mallWeights;
  const parts = [
    { rank: row.rankAmazon, weight: w.amazon },
    { rank: row.rankRakuten, weight: w.rakuten },
    { rank: row.rankYahoo, weight: w.yahoo },
    { rank: row.rankKojima, weight: w.kojima },
    { rank: row.rankBic, weight: w.bic },
  ].filter((p) => p.rank != null && p.rank > 0);
  if (!parts.length) return 0;
  return parts.reduce((sum, p) => sum + (51 - Math.min(p.rank, 50)) * p.weight, 0);
}

function formatRankChange(prev, curr) {
  if (prev == null && curr != null) return `—→${curr}`;
  if (prev != null && curr == null) return `${prev}→—`;
  if (prev == null && curr == null) return '—';
  if (prev === curr) return String(curr);
  return `${prev}→${curr}`;
}

function productLabel(row) {
  const mfr = row.manufacturer && row.manufacturer !== '不明' ? row.manufacturer : '';
  const name = row.productName || '';
  const code = row.modelCode || row.modelKey || '';
  const parts = [];
  if (mfr) parts.push(mfr);
  if (name && name !== mfr) parts.push(name);
  if (code && code !== name && code !== mfr) parts.push(code);
  if (parts.length) return parts.join(' / ');
  return row.representativeModel || row.modelKey || '不明';
}

function productParts(row) {
  return {
    manufacturer: row.manufacturer && row.manufacturer !== '不明' ? row.manufacturer : '—',
    productName: row.productName || row.representativeModel || '—',
    modelCode: row.modelCode || row.modelKey || '—',
  };
}

function buildRankMap(items, topN) {
  const map = new Map();
  (items || []).slice(0, topN).forEach((row, idx) => {
    map.set(row.modelKey, { row, compositeRank: idx + 1 });
  });
  return map;
}

/**
 * 前週スナップショットと今週の横断比較を突き合わせる
 */
function compareWeeklyRankings(currentItems, previousItems, options = {}) {
  const topN = options.topN || config.bestseller.compareTopN;
  const upMin = options.upMin || config.signals.rankUpMinDelta;
  const downMin = options.downMin || config.signals.rankDownMinDelta;

  const currMap = buildRankMap(currentItems, topN);
  const prevMap = buildRankMap(previousItems, topN);
  const allKeys = new Set([...currMap.keys(), ...prevMap.keys()]);
  const changes = [];

  for (const modelKey of allKeys) {
    const curr = currMap.get(modelKey);
    const prev = prevMap.get(modelKey);
    const row = curr?.row || prev?.row;
    if (!row) continue;

    const currRank = curr?.compositeRank ?? null;
    const prevRank = prev?.compositeRank ?? null;

    let type = 'same';
    let delta = 0;
    if (prevRank == null && currRank != null) {
      type = 'new';
    } else if (prevRank != null && currRank == null) {
      type = 'out';
      delta = topN - prevRank;
    } else if (prevRank != null && currRank != null) {
      delta = prevRank - currRank;
      if (delta >= upMin) type = 'up';
      else if (delta <= -downMin) type = 'down';
    }

    if (type === 'same' && prevRank == null && currRank == null) continue;

    changes.push({
      type,
      modelKey,
      label: productLabel(row),
      manufacturer: productParts(row).manufacturer,
      productName: productParts(row).productName,
      modelCode: productParts(row).modelCode,
      representativeModel: row.productName || row.representativeModel,
      compositeRank: currRank,
      prevCompositeRank: prevRank,
      delta,
      rankAmazon: row.rankAmazon,
      rankRakuten: row.rankRakuten,
      rankYahoo: row.rankYahoo,
      rankKojima: row.rankKojima,
      rankBic: row.rankBic,
      siteCount: row.siteCount,
      avgRank: row.avgRank,
      amazonChange: formatRankChange(
        prev?.row?.rankAmazon ?? null,
        row.rankAmazon ?? null
      ),
      rakutenChange: formatRankChange(
        prev?.row?.rankRakuten ?? null,
        row.rankRakuten ?? null
      ),
      yahooChange: formatRankChange(
        prev?.row?.rankYahoo ?? null,
        row.rankYahoo ?? null
      ),
      kojimaChange: formatRankChange(
        prev?.row?.rankKojima ?? null,
        row.rankKojima ?? null
      ),
      bicChange: formatRankChange(
        prev?.row?.rankBic ?? null,
        row.rankBic ?? null
      ),
    });
  }

  const order = { new: 0, up: 1, down: 2, out: 3, same: 4 };
  changes.sort((a, b) => {
    if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  return {
    changes,
    counts: {
      up: changes.filter((c) => c.type === 'up').length,
      down: changes.filter((c) => c.type === 'down').length,
      new: changes.filter((c) => c.type === 'new').length,
      out: changes.filter((c) => c.type === 'out').length,
    },
    hasPrevious: Boolean(previousItems?.length),
  };
}

function reasonBestseller(row, rank) {
  const malls = [];
  if (row.rankAmazon != null) malls.push(`Amazon ${row.rankAmazon}位`);
  if (row.rankRakuten != null) malls.push(`楽天 ${row.rankRakuten}位`);
  if (row.rankYahoo != null) malls.push(`Yahoo ${row.rankYahoo}位`);
  if (row.rankKojima != null) malls.push(`コジマ ${row.rankKojima}位`);
  if (row.rankBic != null) malls.push(`ビック ${row.rankBic}位`);
  const mallText = malls.join('・');
  const consistency =
    row.siteCount >= config.bestseller.minMallCountForHighlight
      ? `${row.siteCount}モールでランクイン`
      : '単一モール中心';
  return `横断${rank}位。${mallText || '順位データなし'}。${consistency}（加重スコア ${Math.round(mallScore(row))}）。`;
}

function reasonRising(change) {
  if (change.type === 'new') {
    return `TOP${config.bestseller.compareTopN}に初登場（横断${change.compositeRank}位）。Amazon ${change.amazonChange}。複数モールでの追随を来週監視。`;
  }
  return `先週比 ${change.prevCompositeRank}位→${change.compositeRank}位（+${change.delta}）。Amazon ${change.amazonChange}。上位群に食い込み中。`;
}

function findReplacementCandidate(downChange, currentItems, articleProduct) {
  const downKey = downChange.modelKey;
  const candidates = (currentItems || [])
    .filter((row) => row.modelKey !== downKey)
    .map((row) => ({ row, score: mallScore(row) }))
    .sort((a, b) => b.score - a.score);

  for (const { row } of candidates) {
    const hint = articleProduct?.modelKeyHint || '';
    const key = extractModelKey(hint) || extractModelKey(articleProduct?.label || '');
    if (key && row.modelKey === key) continue;
    return row;
  }
  return candidates[0]?.row || null;
}

function getSections(articleMaster) {
  return articleMaster.sections || articleMaster.articles || [];
}

function findSectionForProduct(articleMaster, prod) {
  return getSections(articleMaster).find((s) => s.title === prod.section) || null;
}

function buildReplacements(comparison, currentItems, articleMaster) {
  const downChanges = comparison.changes.filter((c) => c.type === 'down' || c.type === 'out');
  const replacements = [];

  for (const prod of articleMaster.products || []) {
    const hintKey = extractModelKey(prod.modelKeyHint || prod.label || '');
    const match = downChanges.find(
      (c) =>
        c.modelKey === hintKey ||
        c.label.includes(prod.label) ||
        prod.label.includes(c.representativeModel || '')
    );
    if (!match) continue;

    const replacementRow = findReplacementCandidate(match, currentItems, prod);
    if (!replacementRow) continue;

    const section = findSectionForProduct(articleMaster, prod);
    replacements.push({
      sectionId: section?.id || null,
      articleId: section?.id || null,
      articleTitle: prod.section || section?.title || '柱記事',
      productId: prod.id,
      fromLabel: prod.label,
      fromPosition: prod.position,
      toLabel: productLabel(replacementRow),
      toModelKey: replacementRow.modelKey,
      reason: `ランキング${prod.position}位「${prod.label}」は横断${match.prevCompositeRank}→${match.compositeRank ?? '圏外'}位に下落。代替「${productLabel(replacementRow)}」は横断上位（Amazon ${replacementRow.rankAmazon ?? '—'}位）。信頼性維持のため差し替え推奨。`,
      headingCandidate: section?.headingCandidate || null,
    });
    if (replacements.length >= config.signals.maxReplacements) return replacements;
  }

  for (const change of downChanges) {
    if (replacements.some((r) => r.fromLabel.includes(change.label))) continue;
    const replacementRow = findReplacementCandidate(change, currentItems, null);
    if (!replacementRow) continue;
    replacements.push({
      articleId: null,
      articleTitle: '（記事マスタ未紐づけ）',
      fromLabel: change.label,
      fromPosition: null,
      toLabel: productLabel(replacementRow),
      toModelKey: replacementRow.modelKey,
      reason: `「${change.label}」が下落（${change.prevCompositeRank}→${change.compositeRank ?? '圏外'}）。代替候補「${productLabel(replacementRow)}」を検討。`,
      headingCandidate: null,
    });
    if (replacements.length >= config.signals.maxReplacements) break;
  }

  return replacements;
}

function weeksSince(dateStr) {
  if (!dateStr) return 99;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 99;
  return Math.floor((Date.now() - d.getTime()) / (7 * 86400000));
}

function formatPv(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return String(v);
}

function pvChangePercent(current, prev) {
  const c = Number(current) || 0;
  const p = Number(prev) || 0;
  if (p === 0) return null;
  return Math.round(((c - p) / p) * 100);
}

function clickRatePercent(clicks, pv) {
  const p = Number(pv) || 0;
  if (p === 0) return 0;
  return Math.round((Number(clicks) / p) * 1000) / 10;
}

/** 問い6: 柱記事PV + 見出し別・商品別クリック */
function buildHubPerformance(articleMaster) {
  const perfCfg = config.performance || {};
  const hub = articleMaster.hubPage || {};
  const pv = hub.weeklyPv ?? 0;
  const prevPv = hub.prevWeeklyPv ?? 0;
  const pvChg = pvChangePercent(pv, prevPv);

  let hubTrend = 'flat';
  if (pvChg != null) {
    if (pvChg >= (perfCfg.hubPvGrowthPercent ?? 5)) hubTrend = 'up';
    else if (pvChg <= (perfCfg.hubPvDeclineAlertPercent ?? -10)) hubTrend = 'down';
  }

  const hubReasons = [`柱記事PV ${formatPv(pv)}`];
  if (pvChg != null) hubReasons.push(`先週比 ${pvChg > 0 ? '+' : ''}${pvChg}%`);
  if (hubTrend === 'down') hubReasons.push('流入減少 — 全体の訴求・ランキング差し替えを優先');

  const hubPv = {
    title: hub.title || '柱記事',
    url: hub.url || '',
    weeklyPv: pv,
    prevWeeklyPv: prevPv,
    pvChangePercent: pvChg,
    trend: hubTrend,
    reason: hubReasons.join('。') + '。',
  };

  const menuClicks = (articleMaster.menuHeadings || [])
    .map((menu) => {
      const clicks = menu.weeklyClicks ?? 0;
      const prevClicks = menu.prevWeeklyClicks ?? 0;
      const clickChg = pvChangePercent(clicks, prevClicks);
      const reasons = [`クリック ${clicks}件`];
      if (clickChg != null) reasons.push(`先週比 ${clickChg > 0 ? '+' : ''}${clickChg}%`);
      if (clickChg != null && clickChg >= (perfCfg.menuClickGrowthPercent ?? 10)) {
        reasons.push('見出し関心UP — 該当セクションを確認');
      } else if (clickChg != null && clickChg <= -10) {
        reasons.push('クリック減 — 見出し・掲載商品の見直し');
      }
      return {
        id: menu.id,
        label: menu.label,
        weeklyClicks: clicks,
        prevWeeklyClicks: prevClicks,
        clickChangePercent: clickChg,
        reason: reasons.join('。') + '。',
      };
    })
    .sort((a, b) => b.weeklyClicks - a.weeklyClicks);

  const productClicks = (articleMaster.products || [])
    .map((prod) => {
      const clicks = prod.weeklyClicks ?? 0;
      const prevClicks = prod.prevWeeklyClicks ?? 0;
      const clickChg = pvChangePercent(clicks, prevClicks);
      const isHighClick = clicks >= (perfCfg.highProductClickThreshold ?? 200);
      const reasons = [`掲載${prod.position}位・${prod.section}`];
      reasons.push(`クリック ${clicks}件`);
      if (clickChg != null) reasons.push(`先週比 ${clickChg > 0 ? '+' : ''}${clickChg}%`);
      if (isHighClick) reasons.push('柱記事内で高クリック商品');
      return {
        id: prod.id,
        label: prod.label,
        section: prod.section,
        position: prod.position,
        weeklyClicks: clicks,
        prevWeeklyClicks: prevClicks,
        clickChangePercent: clickChg,
        isHighClick,
        reason: reasons.join('。') + '。',
      };
    })
    .sort((a, b) => b.weeklyClicks - a.weeklyClicks);

  return { hubPv, menuClicks, productClicks };
}

function sumNumericField(rows, field) {
  return (rows || []).reduce((sum, row) => sum + (Number(row?.[field]) || 0), 0);
}

function extractHubPerformanceSnapshot(articleMaster) {
  const hub = articleMaster.hubPage || {};
  return {
    hubPagePerformance: {
      weeklyPv: hub.weeklyPv ?? 0,
      prevWeeklyPv: hub.prevWeeklyPv ?? 0,
      weeklyCv: hub.weeklyCv ?? null,
      prevWeeklyCv: hub.prevWeeklyCv ?? null,
    },
    productClicks: (articleMaster.products || []).map((p) => ({
      id: p.id,
      label: p.label,
      section: p.section,
      position: p.position,
      weeklyClicks: p.weeklyClicks ?? 0,
      prevWeeklyClicks: p.prevWeeklyClicks ?? 0,
      weeklyCv: p.weeklyCv ?? null,
      prevWeeklyCv: p.prevWeeklyCv ?? null,
    })),
    menuClicks: (articleMaster.menuHeadings || []).map((m) => ({
      id: m.id,
      label: m.label,
      weeklyClicks: m.weeklyClicks ?? 0,
      prevWeeklyClicks: m.prevWeeklyClicks ?? 0,
    })),
  };
}

/** @deprecated 後方互換 */
function buildArticlePerformance(articleMaster) {
  return buildHubPerformance(articleMaster);
}

/** @deprecated 後方互換 */
function extractArticlePerformanceSnapshot(articleMaster) {
  return extractHubPerformanceSnapshot(articleMaster);
}

function sectionClickSummary(section, articleMaster) {
  const products = (articleMaster.products || []).filter((p) => p.section === section.title);
  const weeklyClicks = products.reduce((sum, p) => sum + (p.weeklyClicks ?? 0), 0);
  const prevWeeklyClicks = products.reduce((sum, p) => sum + (p.prevWeeklyClicks ?? 0), 0);
  const menu = (articleMaster.menuHeadings || []).find((m) => m.id === section.menuHeadingId);
  return {
    weeklyClicks,
    prevWeeklyClicks,
    clickChangePercent: pvChangePercent(weeklyClicks, prevWeeklyClicks),
    menuWeeklyClicks: menu?.weeklyClicks ?? null,
    menuClickChangePercent: menu
      ? pvChangePercent(menu.weeklyClicks, menu.prevWeeklyClicks)
      : null,
  };
}

function priorityLevel(score) {
  const w = config.priorityScoring;
  if (score >= w.highThreshold) return '高';
  if (score >= w.mediumThreshold) return '中';
  return '低';
}

/** 問い7: タスクの優先度スコア（商品クリック中心） */
function computeTaskPriorityScore(task, hubPerformance, replacements, articleMaster) {
  const w = config.priorityScoring;
  let score = 0;
  const productClicks = hubPerformance?.productClicks || [];
  const menuClicks = hubPerformance?.menuClicks || [];
  const hubPvChg = hubPerformance?.hubPv?.pvChangePercent;

  if (hubPvChg != null && hubPvChg < -5) score += w.hubPvDeclineBonus;

  const rep = replacements.find(
    (r) =>
      r.sectionId === task.sectionId ||
      r.articleId === task.articleId ||
      task.id === `rep-${r.sectionId || r.articleId}` ||
      task.title?.includes(r.articleTitle)
  );
  if (rep) {
    const prod = productClicks.find(
      (p) => p.id === rep.productId || p.label === rep.fromLabel || rep.fromLabel?.includes(p.label)
    );
    if (prod) {
      score += prod.weeklyClicks * w.productClickWeight;
      if (prod.isHighClick) score += w.highClickBonus;
      if (prod.clickChangePercent != null && prod.clickChangePercent < -5) score += w.clickDeclineBonus;
    }
    if (rep.fromPosition != null && rep.fromPosition <= 3) score += w.topPositionBonus;
  }

  const sectionTitle = task.articleTitle || task.sectionTitle;
  if (sectionTitle) {
    const menu = menuClicks.find((m) => sectionTitle.includes(m.label) || m.label === sectionTitle);
    if (menu) {
      score += menu.weeklyClicks * w.menuClickWeight;
      if (menu.clickChangePercent != null && menu.clickChangePercent >= 10) score += w.highClickBonus;
    }
  }

  const section = getSections(articleMaster).find(
    (s) => s.id === task.sectionId || s.id === task.articleId || s.title === sectionTitle
  );
  if (section) {
    const stale = weeksSince(section.lastUpdated);
    score -= stale * w.stalePenaltyPerWeek;
  }

  if (task.type === 'new') score += 5;

  return Math.round(Math.max(0, score));
}

function buildPriorityReason(task, score, level, hubPerformance) {
  const parts = [`優先度: ${level}（スコア ${score}）`];
  if (task.performanceHint) parts.push(task.performanceHint);
  if (task.detail) parts.push(task.detail);
  const hubPv = hubPerformance?.hubPv;
  if (hubPv?.pvChangePercent != null && !task.performanceHint) {
    parts.push(`柱記事PV ${formatPv(hubPv.weeklyPv)}（${hubPv.pvChangePercent > 0 ? '+' : ''}${hubPv.pvChangePercent}%）`);
  }
  return parts.join(' — ');
}

/** 問い7: 優先アクション TOP3 */
function buildPriorityTasks(tasks, hubPerformance, replacements, articleMaster) {
  const scored = tasks.map((task) => {
    const score = computeTaskPriorityScore(task, hubPerformance, replacements, articleMaster);
    const level = priorityLevel(score);
    const prod = (hubPerformance?.productClicks || []).find(
      (p) => task.detail?.includes(p.label) || task.title?.includes(p.label)
    );
    const perfHint = prod
      ? `商品クリック ${prod.weeklyClicks}件${prod.clickChangePercent != null ? `（${prod.clickChangePercent > 0 ? '+' : ''}${prod.clickChangePercent}%）` : ''}`
      : null;
    return {
      ...task,
      priorityScore: score,
      priorityLevel: level,
      performanceHint: perfHint,
      priorityReason: buildPriorityReason({ ...task, performanceHint: perfHint }, score, level, hubPerformance),
    };
  });

  scored.sort((a, b) => b.priorityScore - a.priorityScore);
  return scored.slice(0, config.signals.maxPriorityTasks);
}

function formatCvValue(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}

function classifyKpiChange(chg, improveAt, declineAt) {
  if (chg == null) return null;
  if (chg >= improveAt) return 'improved';
  if (chg <= declineAt) return 'declined';
  return 'flat';
}

function resolveVerdictFromSignals(signals) {
  if (!signals.length) {
    return { verdict: 'too_early', verdictLabel: 'まだ早い' };
  }
  if (signals.some((s) => s.status === 'declined')) {
    return { verdict: 'declined', verdictLabel: '要見直し' };
  }
  if (signals.some((s) => s.status === 'improved')) {
    return { verdict: 'improved', verdictLabel: 'うまくいっている' };
  }
  return { verdict: 'flat', verdictLabel: '横ばい' };
}

/**
 * 改修効果検証（主要KPI: PV / 商品詳細遷移 / CV）
 */
function buildChangeEffectItem(log, articleMaster, context) {
  const {
    hubPvBefore,
    hubPvNow,
    hubPvChg,
    hubCvBefore,
    hubCvNow,
    hubCvChg,
    prevProducts,
    productsNow,
  } = context;
  const product = (articleMaster.products || []).find((p) => p.id === log.productId);
  const menu = (articleMaster.menuHeadings || []).find((m) => m.id === log.menuHeadingId);
  const section = getSections(articleMaster).find(
    (s) => s.id === log.sectionId || s.id === log.articleId
  );

  const isProduct = Boolean(log.productId);
  const prevProd = prevProducts.find((p) => p.id === log.productId);
  const nowProd = productsNow.find((p) => p.id === log.productId) || product;

  let productClicksBefore;
  let productClicksNow;
  if (isProduct) {
    productClicksBefore = prevProd?.weeklyClicks ?? product?.prevWeeklyClicks ?? 0;
    productClicksNow = nowProd?.weeklyClicks ?? product?.weeklyClicks ?? 0;
  } else {
    productClicksBefore =
      prevProducts.length > 0
        ? sumNumericField(prevProducts, 'weeklyClicks')
        : sumNumericField(articleMaster.products || [], 'prevWeeklyClicks');
    productClicksNow = sumNumericField(productsNow, 'weeklyClicks');
  }
  const productClickChg = pvChangePercent(productClicksNow, productClicksBefore);

  let cvBefore = hubCvBefore;
  let cvNow = hubCvNow;
  let cvChg = hubCvChg;
  if (isProduct) {
    const prodCvBefore = prevProd?.weeklyCv ?? product?.prevWeeklyCv ?? null;
    const prodCvNow = nowProd?.weeklyCv ?? product?.weeklyCv ?? null;
    if (prodCvBefore != null || prodCvNow != null) {
      cvBefore = prodCvBefore ?? 0;
      cvNow = prodCvNow ?? 0;
      cvChg = pvChangePercent(cvNow, cvBefore);
    }
  }

  const reasons = [];
  const signals = [];

  if (hubPvChg != null) {
    reasons.push(
      `PV ${formatPv(hubPvBefore)}→${formatPv(hubPvNow)}（${hubPvChg > 0 ? '+' : ''}${hubPvChg}%）`
    );
    signals.push({
      kpi: 'pv',
      status: classifyKpiChange(hubPvChg, 5, -10),
    });
  } else {
    reasons.push('比較用の前週PVデータ不足');
  }

  if (productClickChg != null) {
    reasons.push(
      `商品詳細遷移 ${productClicksBefore}→${productClicksNow}（${productClickChg > 0 ? '+' : ''}${productClickChg}%）`
    );
    signals.push({
      kpi: 'productDetail',
      status: classifyKpiChange(productClickChg, 10, -15),
    });
  } else {
    reasons.push('比較用の商品詳細遷移データ不足');
  }

  if (cvChg != null && (cvBefore != null || cvNow != null)) {
    reasons.push(
      `CV ${formatCvValue(cvBefore)}→${formatCvValue(cvNow)}（${cvChg > 0 ? '+' : ''}${cvChg}%）`
    );
    signals.push({
      kpi: 'cv',
      status: classifyKpiChange(cvChg, 5, -10),
    });
  } else {
    reasons.push('比較用のCVデータ不足（記事マスタの weeklyCv を設定）');
  }

  const { verdict, verdictLabel } = resolveVerdictFromSignals(
    signals.filter((s) => s.status)
  );

  return {
    effectType: isProduct ? 'product' : 'article',
    sectionId: log.sectionId || log.articleId || section?.id || null,
    articleId: log.sectionId || log.articleId || section?.id || null,
    articleTitle: log.sectionTitle || log.articleTitle || section?.title || product?.section || '柱記事',
    productId: log.productId || null,
    productLabel: log.productLabel || product?.label || null,
    menuHeadingId: log.menuHeadingId || null,
    menuLabel: menu?.label || null,
    changeDescription: log.description,
    changedAt: log.confirmedAt || log.changedAt || null,
    changeWeekId: log.weekId,
    pvBefore: hubPvBefore,
    pvNow: hubPvNow,
    pvChangePercent: hubPvChg,
    productClicksBefore,
    productClicksNow,
    productClickChangePercent: productClickChg,
    clicksBefore: productClicksBefore,
    clicksNow: productClicksNow,
    clickChangePercent: productClickChg,
    cvBefore,
    cvNow,
    cvChangePercent: cvChg,
    verdict,
    verdictLabel,
    reason: reasons.join('。') + '。',
  };
}

function buildChangeEffects(previousSnapshot, articleMaster) {
  const changeLog =
    previousSnapshot?.changeLog ||
    (previousSnapshot ? [] : articleMaster.changeLogSample || []);

  if (!changeLog.length) {
    return {
      items: [],
      articleItems: [],
      productItems: [],
      hasData: false,
      message:
        '先週登録した改修がありません。上で登録して週次を確定すると、来週ここに結果が出ます。',
    };
  }

  const hubNow = articleMaster.hubPage || {};
  const prevHubPerf = previousSnapshot?.hubPagePerformance;
  const hubPvBefore = prevHubPerf?.weeklyPv ?? hubNow.prevWeeklyPv ?? 0;
  const hubPvNow = hubNow.weeklyPv ?? 0;
  const hubPvChg = pvChangePercent(hubPvNow, hubPvBefore);

  const hubCvBefore =
    prevHubPerf?.weeklyCv ??
    (hubNow.prevWeeklyCv != null ? hubNow.prevWeeklyCv : null);
  const hubCvNow = hubNow.weeklyCv != null ? hubNow.weeklyCv : null;
  const hubCvChg =
    hubCvBefore != null || hubCvNow != null
      ? pvChangePercent(hubCvNow ?? 0, hubCvBefore ?? 0)
      : null;

  const productsNow = (articleMaster.products || []).map((p) => ({
    id: p.id,
    label: p.label,
    weeklyClicks: p.weeklyClicks ?? 0,
    prevWeeklyClicks: p.prevWeeklyClicks ?? 0,
    weeklyCv: p.weeklyCv ?? null,
    prevWeeklyCv: p.prevWeeklyCv ?? null,
  }));

  const context = {
    hubPvBefore,
    hubPvNow,
    hubPvChg,
    hubCvBefore,
    hubCvNow,
    hubCvChg,
    prevProducts: previousSnapshot?.productClicks || [],
    productsNow,
  };

  const items = changeLog.map((log) => buildChangeEffectItem(log, articleMaster, context));
  const productItems = items.filter((item) => item.effectType === 'product');
  const articleItems = items.filter((item) => item.effectType === 'article');

  return {
    items,
    articleItems,
    productItems,
    hasData: items.length > 0,
    message: null,
  };
}

function buildChangeLogFromTasks(tasks, weekId, confirmedAt) {
  return (tasks || [])
    .filter((t) => t.sectionId || t.articleId || t.articleTitle || t.productId)
    .map((t) => ({
      sectionId: t.sectionId || t.articleId || null,
      articleId: t.sectionId || t.articleId || null,
      sectionTitle: t.articleTitle || t.sectionTitle || null,
      articleTitle: t.articleTitle || t.sectionTitle || null,
      productId: t.productId || null,
      productLabel: t.productLabel || null,
      menuHeadingId: t.menuHeadingId || null,
      description: t.detail || t.title,
      confirmedAt,
      weekId,
    }));
}

/**
 * 手動登録した改修エントリから changeLog を生成
 * @param {object[]} entries
 */
function buildChangeLogFromEntries(entries, weekId, confirmedAt) {
  return (entries || [])
    .filter((e) => e && (e.description || e.targetLabel))
    .map((e) => {
      const targetType = String(e.targetType || 'hub');
      const targetLabel = String(e.targetLabel || e.sectionTitle || e.articleTitle || '柱記事全体').trim();
      const description = String(e.description || '').trim() || targetLabel;
      const expectedEffect = String(e.expectedEffect || '').trim() || null;
      return {
        sectionId: e.sectionId || e.articleId || null,
        articleId: e.sectionId || e.articleId || null,
        sectionTitle: targetType === 'product' ? null : targetLabel,
        articleTitle: targetType === 'product' ? null : targetLabel,
        productId: e.productId || null,
        productLabel: targetType === 'product' ? targetLabel : e.productLabel || null,
        menuHeadingId: e.menuHeadingId || null,
        description: expectedEffect ? `${description}（期待: ${expectedEffect}）` : description,
        changedAt: e.changedAt || null,
        confirmedAt,
        weekId,
      };
    });
}

/** 改修登録フォーム用の対象候補 */
function buildChangeTargets(articleMaster) {
  const targets = [{ value: 'hub', label: '柱記事全体', targetType: 'hub' }];
  for (const s of getSections(articleMaster)) {
    if (!s?.id && !s?.title) continue;
    targets.push({
      value: `section:${s.id || s.title}`,
      label: s.title || s.id,
      targetType: 'section',
      sectionId: s.id || null,
      menuHeadingId: s.menuHeadingId || null,
    });
  }
  for (const m of articleMaster?.menuHeadings || []) {
    if (!m?.id && !m?.label) continue;
    const already = targets.some((t) => t.menuHeadingId && t.menuHeadingId === m.id);
    if (already) continue;
    targets.push({
      value: `menu:${m.id || m.label}`,
      label: `見出し: ${m.label || m.id}`,
      targetType: 'menu',
      menuHeadingId: m.id || null,
    });
  }
  for (const p of articleMaster?.products || []) {
    if (!p?.id && !p?.label) continue;
    targets.push({
      value: `product:${p.id || p.label}`,
      label: `商品: ${p.label || p.id}`,
      targetType: 'product',
      productId: p.id || null,
    });
  }
  return targets;
}

function buildNewArticleProposals(currentItems, articleMaster, comparison) {
  const features = pickUserFeaturesFromComposite(currentItems, articleMaster.category, 8);
  const proposals = [];
  const covered = new Set(articleMaster.coveredThemes || []);

  for (const gap of articleMaster.gapThemeCandidates || []) {
    const themeHits = (currentItems || []).filter((row) => {
      const text = `${row.modelKey} ${row.manufacturer} ${row.representativeModel}`.toLowerCase();
      return (gap.keywords || []).some((kw) => text.includes(String(kw).toLowerCase()));
    });
    if (themeHits.length < 2) continue;
    proposals.push({
      theme: gap.label,
      reason: `ランキングに${gap.label}訴求が${themeHits.length}件。既存記事で未カバーの切り口（${gap.reason}）。`,
      headingCandidate: `${gap.label} おすすめ【${new Date().getFullYear()}年最新】`,
      productCount: themeHits.length,
    });
  }

  for (const feat of features.slice(0, 3)) {
    const id = String(feat.id || feat.label || '').toLowerCase();
    if ([...covered].some((t) => id.includes(t))) continue;
    if (proposals.some((p) => p.theme === feat.label)) continue;
    proposals.push({
      theme: feat.label,
      reason: `需要分析でスコア上位（${feat.score ?? '—'}）。ランキング商品名に頻出する切り口。`,
      headingCandidate: `${feat.label} おすすめランキング`,
      productCount: feat.matchCount ?? 0,
    });
    if (proposals.length >= config.signals.maxNewArticles) break;
  }

  if (!proposals.length && comparison.counts.new > 0) {
    proposals.push({
      theme: '新入り商品フォロー',
      reason: `今週 NEW ${comparison.counts.new}件。既存記事への追記または短尺比較の追加を検討。`,
      headingCandidate: '掃除機 新製品 おすすめ',
      productCount: comparison.counts.new,
    });
  }

  return proposals.slice(0, config.signals.maxNewArticles);
}

function buildSectionChanges(comparison, articleMaster, replacements, newProposals, hubPerformance) {
  const hubPvChg = hubPerformance?.hubPv?.pvChangePercent;
  const changes = [];

  for (const section of getSections(articleMaster)) {
    const clicks = sectionClickSummary(section, articleMaster);
    const stale = weeksSince(section.lastUpdated) >= config.signals.staleArticleWeeks;
    const relatedReplacement = replacements.find(
      (r) => r.sectionId === section.id || r.articleTitle === section.title
    );
    const relatedNew = newProposals.find((p) =>
      (section.themes || []).some((t) => String(p.theme).toLowerCase().includes(t))
    );

    let changeType = 'ok';
    let recommendation = '変更なし（来週再確認）';
    let status = 'ok';
    const reasons = [];

    if (clicks.menuClickChangePercent != null && clicks.menuClickChangePercent >= 10) {
      reasons.push(`見出しクリック +${clicks.menuClickChangePercent}%`);
    }
    if (clicks.clickChangePercent != null && clicks.clickChangePercent <= -10) {
      reasons.push(`セクション内商品クリック ${clicks.clickChangePercent}%`);
    }

    if (relatedReplacement) {
      changeType = 'replace';
      status = 'warn';
      recommendation = `${relatedReplacement.fromPosition}位を${relatedReplacement.toLabel}に差し替え`;
      reasons.push(relatedReplacement.reason);
    } else if (stale && comparison.counts.up + comparison.counts.new > 0) {
      changeType = 'update';
      status = 'warn';
      recommendation = '順位・新入りの反映（リライト）';
      reasons.push(
        `最終更新 ${section.lastUpdated}（${weeksSince(section.lastUpdated)}週前）。今週 UP ${comparison.counts.up}件・NEW ${comparison.counts.new}件。`
      );
    } else if (relatedNew) {
      changeType = 'review';
      status = 'info';
      recommendation = relatedNew.theme;
      reasons.push(relatedNew.reason);
    } else if (stale) {
      changeType = 'review';
      status = 'info';
      recommendation = '情報鮮度の確認';
      reasons.push(`最終更新から${weeksSince(section.lastUpdated)}週経過。`);
    }

    if (
      hubPvChg != null &&
      hubPvChg < -5 &&
      clicks.menuClickChangePercent != null &&
      clicks.menuClickChangePercent < 0 &&
      status === 'ok'
    ) {
      status = 'info';
      recommendation = '柱記事流入減 — 見出し・商品の見直し';
      reasons.push(`柱記事PV ${hubPvChg}%`);
    }

    changes.push({
      sectionId: section.id,
      articleId: section.id,
      title: section.title,
      lastUpdated: section.lastUpdated,
      weeklyClicks: clicks.weeklyClicks,
      prevWeeklyClicks: clicks.prevWeeklyClicks,
      clickChangePercent: clicks.clickChangePercent,
      menuWeeklyClicks: clicks.menuWeeklyClicks,
      menuClickChangePercent: clicks.menuClickChangePercent,
      changeType,
      status,
      recommendation,
      reason: reasons.join(' ') || recommendation,
      headingCandidate: section.headingCandidate,
    });
  }

  return changes
    .sort((a, b) => (b.weeklyClicks ?? 0) - (a.weeklyClicks ?? 0))
    .slice(0, config.signals.maxArticleChanges);
}

/** @deprecated 後方互換 */
function buildArticleChanges(comparison, articleMaster, replacements, newProposals, hubPerformance) {
  return buildSectionChanges(comparison, articleMaster, replacements, newProposals, hubPerformance);
}

function buildWeeklyTasks(replacements, newProposals, sectionChanges) {
  const tasks = [];
  for (const r of replacements) {
    tasks.push({
      id: `rep-${r.sectionId || r.productId || r.fromLabel}`,
      type: 'replace',
      sectionId: r.sectionId,
      articleId: r.sectionId,
      articleTitle: r.articleTitle,
      productId: r.productId,
      productLabel: r.fromLabel,
      title: r.articleTitle
        ? `「${r.articleTitle}」${r.fromPosition ? `${r.fromPosition}位` : ''}を差し替え`
        : `商品差し替え: ${r.fromLabel}`,
      detail: `${r.fromLabel} → ${r.toLabel}`,
      headingCandidate: r.headingCandidate,
    });
  }
  for (const p of newProposals) {
    tasks.push({
      id: `new-${p.theme}`,
      type: 'new',
      sectionId: null,
      articleId: null,
      articleTitle: null,
      title: `新規記事検討: ${p.theme}`,
      detail: p.reason,
      headingCandidate: p.headingCandidate,
    });
  }
  for (const c of sectionChanges.filter((x) => x.status === 'warn')) {
    if (tasks.some((t) => t.headingCandidate === c.headingCandidate)) continue;
    tasks.push({
      id: `chg-${c.sectionId}`,
      type: 'update',
      sectionId: c.sectionId,
      articleId: c.sectionId,
      articleTitle: c.title,
      title: `「${c.title}」を更新`,
      detail: c.recommendation,
      headingCandidate: c.headingCandidate,
    });
  }
  return tasks.slice(0, 8);
}

function buildWeeklyPoints(articleMaster, comparison, replacements, priorityTasks, hubPerformance) {
  const points = [...(articleMaster.weeklyPoints || [])];

  if (comparison.hasPrevious && replacements[0]) {
    const r = replacements[0];
    const auto = `ランキング${r.fromPosition ? `${r.fromPosition}位` : ''}「${r.fromLabel}」→「${r.toLabel}」差し替え検討`;
    if (!points.some((p) => p.includes(r.fromLabel))) points.push(auto);
  }

  const topMenuUp = (hubPerformance?.menuClicks || [])
    .filter((m) => m.clickChangePercent != null && m.clickChangePercent >= (config.performance?.menuClickGrowthPercent ?? 10))
    .sort((a, b) => (b.clickChangePercent ?? 0) - (a.clickChangePercent ?? 0))[0];
  if (topMenuUp && points.length < 6) {
    const auto = `「${topMenuUp.label}」見出しのクリック増 — 該当セクションを確認`;
    if (!points.some((p) => p.includes(topMenuUp.label))) points.push(auto);
  }

  if (priorityTasks?.[0] && points.length < 6) {
    const auto = `今週の最優先: ${priorityTasks[0].title}`;
    if (!points.some((p) => p.includes(priorityTasks[0].title))) points.push(auto);
  }

  return {
    points: points.slice(0, 6),
    season: articleMaster.season || {},
    footnote: comparison.hasPrevious
      ? null
      : '前週スナップショットなし。今週の取得を確定すると来週から前週比が有効になります。',
  };
}

function normalizeTopicRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      date: r.date || null,
      content: r.content || r.topic || r.title || '',
      impact: r.impact || null,
      action: r.action || null,
      source: r.source || r.platform || null,
      url: r.url || null,
    }))
    .filter((r) => r.content);
}

function pickArticleTopics(articleMaster) {
  const master = articleMaster || {};
  return {
    season: master.season && typeof master.season === 'object' ? master.season : {},
    news: normalizeTopicRows(master.news),
    snsTopics: normalizeTopicRows(master.snsTopics || master.sns || master.topics),
  };
}

/**
 * ランキング取得結果から週次レポート JSON を組み立てる
 */
function buildWeeklyReport({
  category,
  weekId,
  fetchResult,
  previousSnapshot,
  articleMaster,
  fetchedAt,
}) {
  const compositeItems = fetchResult?.compositeRanking?.items || [];
  const previousItems = previousSnapshot?.compositeRanking?.items || [];
  const comparison = compareWeeklyRankings(compositeItems, previousItems);

  const ranked = [...compositeItems]
    .map((row, idx) => ({
      row,
      score: mallScore(row),
      compositeRank: idx + 1,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.bestseller.topN);

  const bestsellers = ranked.map(({ row, compositeRank }, i) => {
    const parts = productParts(row);
    return {
      rank: i + 1,
      compositeRank,
      modelKey: row.modelKey,
      label: productLabel(row),
      manufacturer: parts.manufacturer,
      productName: parts.productName,
      modelCode: parts.modelCode,
      rankAmazon: row.rankAmazon,
      rankRakuten: row.rankRakuten,
      rankYahoo: row.rankYahoo,
      rankKojima: row.rankKojima,
      rankBic: row.rankBic,
      siteCount: row.siteCount,
      reason: reasonBestseller(row, i + 1),
    };
  });

  const rising = comparison.changes
    .filter((c) => c.type === 'new' || c.type === 'up')
    .slice(0, config.signals.maxRisingProducts)
    .map((c) => ({
      type: c.type,
      label: c.label,
      manufacturer: c.manufacturer,
      productName: c.productName,
      modelCode: c.modelCode,
      modelKey: c.modelKey,
      amazonChange: c.amazonChange,
      compositeRank: c.compositeRank,
      delta: c.delta,
      reason: reasonRising(c),
    }));

  const replacements = buildReplacements(comparison, compositeItems, articleMaster);
  const newArticles = buildNewArticleProposals(compositeItems, articleMaster, comparison);
  const hubPerformance = buildHubPerformance(articleMaster);
  const sectionChanges = buildSectionChanges(
    comparison,
    articleMaster,
    replacements,
    newArticles,
    hubPerformance
  );
  const tasks = buildWeeklyTasks(replacements, newArticles, sectionChanges);
  const priorityTasks = buildPriorityTasks(tasks, hubPerformance, replacements, articleMaster);
  const sortedTasks = [...tasks]
    .map((t) => {
      const pt = priorityTasks.find((p) => p.id === t.id);
      return (
        pt || {
          ...t,
          priorityScore: computeTaskPriorityScore(t, hubPerformance, replacements, articleMaster),
          priorityLevel: priorityLevel(
            computeTaskPriorityScore(t, hubPerformance, replacements, articleMaster)
          ),
          priorityReason: t.detail,
        }
      );
    })
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
  const changeEffects = buildChangeEffects(previousSnapshot, articleMaster);
  const weeklyPoints = buildWeeklyPoints(
    articleMaster,
    comparison,
    replacements,
    priorityTasks,
    hubPerformance
  );

  const sectionsToUpdate = sectionChanges.filter((c) => c.status === 'warn').length;

  return {
    weekId: weekId || getIsoWeekId(),
    category,
    fetchedAt: fetchedAt || new Date().toISOString(),
    config: {
      bestsellerTopN: config.bestseller.topN,
      reasonMode: config.reasonMode,
      articlePerformancePhase: config.articlePerformancePhase,
    },
    comparisonMeta: {
      upCount: comparison.counts.up,
      downCount: comparison.counts.down,
      newCount: comparison.counts.new,
      sectionsToUpdate,
      hasPrevious: comparison.hasPrevious,
    },
    weeklyPoints,
    hubPerformance,
    bestsellers,
    rising,
    replacements,
    newArticles,
    sectionChanges,
    articleChanges: sectionChanges,
    tasks: sortedTasks,
    priorityTasks,
    changeEffects,
    comparison,
    ...pickArticleTopics(articleMaster),
    changeTargets: buildChangeTargets(articleMaster),
    compositeMeta: fetchResult?.compositeRanking?.stats || {},
    warnings: fetchResult?.warnings || [],
  };
}

function buildEmptyReport(category, articleMaster, previousSnapshot) {
  const weekId = getIsoWeekId();
  const comparison = { changes: [], counts: { up: 0, down: 0, new: 0, out: 0 }, hasPrevious: false };
  const hubPerformance = buildHubPerformance(articleMaster);
  const sectionChanges = getSections(articleMaster).map((section) => {
    const clicks = sectionClickSummary(section, articleMaster);
    return {
      sectionId: section.id,
      articleId: section.id,
      title: section.title,
      lastUpdated: section.lastUpdated,
      weeklyClicks: clicks.weeklyClicks,
      prevWeeklyClicks: clicks.prevWeeklyClicks,
      clickChangePercent: clicks.clickChangePercent,
      menuWeeklyClicks: clicks.menuWeeklyClicks,
      menuClickChangePercent: clicks.menuClickChangePercent,
      changeType: 'pending',
      status: 'info',
      recommendation: 'ランキング取得後に判定',
      reason: '「今週のランキングを取得」を実行してください。',
      headingCandidate: section.headingCandidate,
    };
  });
  const changeEffects = buildChangeEffects(previousSnapshot, articleMaster);
  const weeklyPoints = buildWeeklyPoints(articleMaster, comparison, [], [], hubPerformance);

  const tasks = sectionChanges
    .filter((c) => c.clickChangePercent != null && c.clickChangePercent < -5)
    .map((c) => ({
      id: `click-${c.sectionId}`,
      type: 'update',
      sectionId: c.sectionId,
      articleId: c.sectionId,
      articleTitle: c.title,
      title: `「${c.title}」クリック低下への対応`,
      detail: `商品クリック ${c.weeklyClicks}件（${c.clickChangePercent}%）— 掲載商品の見直し`,
      headingCandidate: c.headingCandidate,
    }));
  const priorityTasks = buildPriorityTasks(tasks, hubPerformance, [], articleMaster);

  return {
    weekId,
    category,
    fetchedAt: null,
    status: 'empty',
    config: {
      bestsellerTopN: config.bestseller.topN,
      reasonMode: config.reasonMode,
      articlePerformancePhase: config.articlePerformancePhase,
    },
    comparisonMeta: {
      upCount: 0,
      downCount: 0,
      newCount: 0,
      sectionsToUpdate: 0,
      hasPrevious: false,
    },
    weeklyPoints,
    hubPerformance,
    bestsellers: [],
    rising: [],
    replacements: [],
    newArticles: [],
    sectionChanges,
    articleChanges: sectionChanges,
    tasks,
    priorityTasks,
    changeEffects,
    comparison,
    ...pickArticleTopics(articleMaster),
    changeTargets: buildChangeTargets(articleMaster),
  };
}

function enrichReportWithSalesMetrics(report, articleMaster, previousSnapshot) {
  const hubPerformance = buildHubPerformance(articleMaster);
  const changeEffects = buildChangeEffects(previousSnapshot, articleMaster);

  const sectionChanges = (report.sectionChanges || report.articleChanges || []).map((c) => {
    const section = getSections(articleMaster).find((s) => s.id === c.sectionId || s.id === c.articleId);
    if (!section) return c;
    const clicks = sectionClickSummary(section, articleMaster);
    return {
      ...c,
      weeklyClicks: clicks.weeklyClicks,
      prevWeeklyClicks: clicks.prevWeeklyClicks,
      clickChangePercent: clicks.clickChangePercent,
      menuWeeklyClicks: clicks.menuWeeklyClicks,
      menuClickChangePercent: clicks.menuClickChangePercent,
    };
  });

  let tasks = report.tasks || [];
  if (!tasks.length) {
    tasks = sectionChanges
      .filter((c) => c.clickChangePercent != null && c.clickChangePercent < -5)
      .map((c) => ({
        id: `click-${c.sectionId}`,
        type: 'update',
        sectionId: c.sectionId,
        articleId: c.sectionId,
        articleTitle: c.title,
        title: `「${c.title}」クリック低下への対応`,
        detail: `商品クリック ${c.weeklyClicks}件（${c.clickChangePercent}%）`,
        headingCandidate: c.headingCandidate,
      }));
  }

  const priorityTasks = buildPriorityTasks(
    tasks,
    hubPerformance,
    report.replacements || [],
    articleMaster
  );
  const priorityIds = new Set(priorityTasks.map((t) => t.id));
  const sortedTasks = [
    ...priorityTasks,
    ...tasks
      .filter((t) => !priorityIds.has(t.id))
      .map((t) => {
        const score = computeTaskPriorityScore(
          t,
          hubPerformance,
          report.replacements || [],
          articleMaster
        );
        return {
          ...t,
          priorityScore: score,
          priorityLevel: priorityLevel(score),
          priorityReason: t.detail,
        };
      })
      .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0)),
  ];

  const comparison = report.comparison || {
    counts: report.comparisonMeta || {},
    hasPrevious: report.comparisonMeta?.hasPrevious,
  };
  const weeklyPoints = buildWeeklyPoints(
    articleMaster,
    comparison,
    report.replacements || [],
    priorityTasks,
    hubPerformance
  );

  return {
    ...report,
    config: {
      ...report.config,
      articlePerformancePhase: config.articlePerformancePhase,
    },
    comparisonMeta: {
      upCount: comparison.counts?.up ?? report.comparisonMeta?.upCount ?? 0,
      downCount: comparison.counts?.down ?? report.comparisonMeta?.downCount ?? 0,
      newCount: comparison.counts?.new ?? report.comparisonMeta?.newCount ?? 0,
      sectionsToUpdate: sectionChanges.filter((c) => c.status === 'warn').length,
      hasPrevious: comparison.hasPrevious ?? report.comparisonMeta?.hasPrevious ?? false,
    },
    weeklyPoints,
    hubPerformance,
    sectionChanges,
    articleChanges: sectionChanges,
    changeEffects,
    priorityTasks,
    tasks: sortedTasks,
    ...pickArticleTopics(articleMaster),
    changeTargets: buildChangeTargets(articleMaster),
  };
}

function buildReportFromSnapshot(snapshot, articleMaster, compareMode = 'latest') {
  const { snapshot: previousSnapshot } = resolveComparisonSnapshot(
    snapshot.category,
    snapshot,
    compareMode
  );

  let report;
  if (snapshot.report) {
    report = enrichReportWithSalesMetrics(
      {
        ...snapshot.report,
        confirmedAt: snapshot.confirmedAt || null,
        status: 'loaded',
      },
      articleMaster,
      previousSnapshot
    );
  } else if (snapshot.compositeRanking?.items) {
    report = buildWeeklyReport({
      category: snapshot.category,
      weekId: snapshot.weekId,
      fetchResult: { compositeRanking: snapshot.compositeRanking, warnings: snapshot.warnings },
      previousSnapshot,
      articleMaster,
      fetchedAt: snapshot.fetchedAt,
    });
    report = { ...report, status: 'loaded', confirmedAt: snapshot.confirmedAt || null };
  } else {
    report = buildEmptyReport(snapshot.category || articleMaster.category, articleMaster, previousSnapshot);
  }

  return attachComparisonFields(report, snapshot.category, snapshot, compareMode);
}

function buildEmptyReportWithComparison(category, articleMaster, weekId, compareMode = 'latest') {
  const currentCtx = { category, weekId, fetchedAt: new Date().toISOString() };
  const { snapshot: previousSnapshot } = resolveComparisonSnapshot(category, currentCtx, compareMode);
  const report = buildEmptyReport(category, articleMaster, previousSnapshot);
  return attachComparisonFields(report, category, currentCtx, compareMode);
}

function buildWeeklyReportWithComparison({
  category,
  weekId,
  fetchResult,
  articleMaster,
  fetchedAt,
  compareMode = 'latest',
}) {
  const currentCtx = { category, weekId, fetchedAt: fetchedAt || new Date().toISOString() };
  const { snapshot: previousSnapshot } = resolveComparisonSnapshot(category, currentCtx, compareMode);
  const report = buildWeeklyReport({
    category,
    weekId,
    fetchResult,
    previousSnapshot,
    articleMaster,
    fetchedAt,
  });
  return attachComparisonFields(report, category, currentCtx, compareMode);
}

module.exports = {
  config,
  WEEKLY_EXPORT_DIR,
  getIsoWeekId,
  getPreviousWeekId,
  formatWeekLabel,
  loadArticleMaster,
  loadSnapshot,
  saveSnapshot,
  listSnapshots,
  findLatestSnapshot,
  normalizeCompareMode,
  resolveComparisonSnapshot,
  buildCompareOptions,
  attachComparisonFields,
  buildEmptyReportWithComparison,
  buildWeeklyReportWithComparison,
  compareWeeklyRankings,
  buildWeeklyReport,
  buildEmptyReport,
  buildReportFromSnapshot,
  buildHubPerformance,
  buildWeeklyPoints,
  buildArticlePerformance,
  buildPriorityTasks,
  buildChangeEffects,
  buildChangeLogFromTasks,
  buildChangeLogFromEntries,
  buildChangeTargets,
  extractHubPerformanceSnapshot,
  extractArticlePerformanceSnapshot,
  enrichReportWithSalesMetrics,
  buildCompositeRanking,
  productLabel,
  productParts,
  mallScore,
  formatPv,
  pvChangePercent,
};
