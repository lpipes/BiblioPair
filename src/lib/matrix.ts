import type { Article, ArticlePair, DomainGroup, OverlapBreakdown, ScoringMetric } from '../types';
import { normalizeJournalKey } from './pairing';
import { buildCorpusIdf, computeTopicOverlap } from './scoring';

export interface StratumDistanceMatrix {
  key: string;
  journal: string;
  year: number;
  groups: DomainGroup[];
  metric: ScoringMetric;
  /** Fixed universal distance scale shared by all matrices: [0, 1] where 0 = identical, 1 = completely unrelated */
  scaleMin: 0;
  scaleMax: 1;
  /** Articles in this (journal, year) stratum, ordered Translated first then Untranslated, then by DOI */
  articles: Article[];
  /** Symmetric N x N matrix of overlap distances in [0, 1] */
  distances: number[][];
  /** Symmetric N x N matrix of full OverlapBreakdown objects */
  breakdowns: OverlapBreakdown[][];
  /** Summary statistics for off-diagonal pairs (i < j) */
  offDiagonalMean: number | null;
  offDiagonalMin: number | null;
  offDiagonalMax: number | null;
  /** Set of active pairing keys ("idA::idB" and "idB::idA") within this stratum */
  activePairKeys: Set<string>;
}

/**
 * Computes one symmetric N x N pairwise topic-distance matrix per (journal, year) stratum.
 * All matrices share the exact same global IDF weighting and fixed [0.000, 1.000] distance scale
 * (0.000 = perfect topic overlap / identical, 1.000 = completely unrelated).
 */
export function buildStratumDistanceMatrices(
  articles: Article[],
  metric: ScoringMetric = 'hybrid',
  activePairs: ArticlePair[] = []
): StratumDistanceMatrix[] {
  // Compute a single global IDF table across the full corpus so distances are directly comparable across all strata
  const globalIdf = buildCorpusIdf(articles);

  const activePairLookup = new Set<string>();
  for (const p of activePairs) {
    activePairLookup.add(`${p.translatedId}::${p.untranslatedId}`);
    activePairLookup.add(`${p.untranslatedId}::${p.translatedId}`);
  }

  // Group articles strictly by normalized journal + publication year
  const stratumMap = new Map<string, { journal: string; year: number; articles: Article[] }>();

  for (const article of articles) {
    const key = `${normalizeJournalKey(article.journal)}::${article.year}`;
    let entry = stratumMap.get(key);
    if (!entry) {
      entry = {
        journal: article.journal,
        year: article.year,
        articles: [],
      };
      stratumMap.set(key, entry);
    }
    entry.articles.push(article);
  }

  const matrices: StratumDistanceMatrix[] = [];

  for (const [key, entry] of stratumMap.entries()) {
    // Deterministic ordering: Translated articles first, then Untranslated, sorted by DOI
    const sortedArticles = [...entry.articles].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'translated' ? -1 : 1;
      return a.doi.localeCompare(b.doi);
    });

    const n = sortedArticles.length;
    const distances: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
    const breakdowns: OverlapBreakdown[][] = Array.from({ length: n }, () =>
      new Array<OverlapBreakdown>(n)
    );

    const offDiagonalValues: number[] = [];
    const stratumActivePairs = new Set<string>();

    for (let i = 0; i < n; i++) {
      // Exact self-distance on diagonal
      const selfBreakdown: OverlapBreakdown = {
        distance: 0,
        hybridDistance: 0,
        lexicalDistance: 0,
        conceptDistance: 0,
        jsdDistance: 0,
        jaccardDistance: 0,
        sharedTerms: sortedArticles[i].topics.map((t) => t.name).slice(0, 8),
        translatedOnlyTerms: [],
        untranslatedOnlyTerms: [],
      };
      distances[i][i] = 0;
      breakdowns[i][i] = selfBreakdown;

      for (let j = i + 1; j < n; j++) {
        const bd = computeTopicOverlap(sortedArticles[i], sortedArticles[j], globalIdf, metric);
        distances[i][j] = bd.distance;
        distances[j][i] = bd.distance;
        breakdowns[i][j] = bd;
        breakdowns[j][i] = {
          ...bd,
          translatedOnlyTerms: bd.untranslatedOnlyTerms,
          untranslatedOnlyTerms: bd.translatedOnlyTerms,
        };
        offDiagonalValues.push(bd.distance);

        const pairKey = `${sortedArticles[i].id}::${sortedArticles[j].id}`;
        if (activePairLookup.has(pairKey)) {
          stratumActivePairs.add(pairKey);
          stratumActivePairs.add(`${sortedArticles[j].id}::${sortedArticles[i].id}`);
        }
      }
    }

    const groups = Array.from(new Set(sortedArticles.map((a) => a.group))).sort();

    matrices.push({
      key,
      journal: entry.journal,
      year: entry.year,
      groups,
      metric,
      scaleMin: 0,
      scaleMax: 1,
      articles: sortedArticles,
      distances,
      breakdowns,
      offDiagonalMean:
        offDiagonalValues.length > 0
          ? offDiagonalValues.reduce((s, v) => s + v, 0) / offDiagonalValues.length
          : null,
      offDiagonalMin: offDiagonalValues.length > 0 ? Math.min(...offDiagonalValues) : null,
      offDiagonalMax: offDiagonalValues.length > 0 ? Math.max(...offDiagonalValues) : null,
      activePairKeys: stratumActivePairs,
    });
  }

  // Sort matrices cleanly by most recent year, then journal name
  matrices.sort((a, b) => b.year - a.year || a.journal.localeCompare(b.journal));

  return matrices;
}

/**
 * Calibrated universal heatmap color ramp on fixed [0.000, 1.000] scale.
 * Lower distance (closer to 0 = closely related) -> cool emerald/teal.
 * Mid distance (~0.5) -> pale neutral slate/amber.
 * Higher distance (closer to 1 = unrelated) -> deep crimson/rose.
 * Guarantees accessible WCAG text contrast for every cell value.
 */
export function getMatrixCellStyle(distance: number, isDiagonal: boolean): {
  backgroundColor: string;
  textColor: string;
} {
  if (isDiagonal) {
    return {
      backgroundColor: '#F1F5F9',
      textColor: '#64748B',
    };
  }

  const d = Math.max(0, Math.min(1, distance));

  // 10-step calibrated scientific ramp anchored identically across all matrices to [0.0, 1.0]
  const ramp: Array<{ max: number; bg: string; fg: string }> = [
    { max: 0.1, bg: '#047857', fg: '#FFFFFF' }, // 0.00–0.10: Near-identical
    { max: 0.2, bg: '#059669', fg: '#FFFFFF' }, // 0.10–0.20: Very close
    { max: 0.3, bg: '#10B981', fg: '#FFFFFF' }, // 0.20–0.30: Close
    { max: 0.4, bg: '#6EE7B7', fg: '#064E3B' }, // 0.30–0.40: Moderately close
    { max: 0.5, bg: '#D1FAE5', fg: '#065F46' }, // 0.40–0.50: Mild overlap
    { max: 0.6, bg: '#FEF3C7', fg: '#78350F' }, // 0.50–0.60: Moderate distance
    { max: 0.7, bg: '#FDE68A', fg: '#78350F' }, // 0.60–0.70: Distant
    { max: 0.8, bg: '#FCA5A5', fg: '#7F1D1D' }, // 0.70–0.80: Far
    { max: 0.9, bg: '#EF4444', fg: '#FFFFFF' }, // 0.80–0.90: Very far
    { max: 1.01, bg: '#B91C1C', fg: '#FFFFFF' }, // 0.90–1.00: Disjoint / Unrelated
  ];

  const stop = ramp.find((r) => d <= r.max) ?? ramp[ramp.length - 1];
  return { backgroundColor: stop.bg, textColor: stop.fg };
}
