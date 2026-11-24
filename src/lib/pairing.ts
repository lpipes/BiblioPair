import type {
  Article,
  ArticlePair,
  DomainGroup,
  OverlapBreakdown,
  PairingResult,
  ScoringMetric,
  StratumSummary,
} from '../types';
import { buildCorpusIdf, computeTopicOverlap } from './scoring';

/**
 * Normalizes a journal title for exact same-journal matching across minor casing/punctuation differences.
 */
export function normalizeJournalKey(journal: string): string {
  return journal
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Returns true if two articles belong to the exact same journal and publication year.
 */
export function isSameJournalAndYear(a: Article, b: Article): boolean {
  if (a.year !== b.year) return false;
  if (a.doi === b.doi || a.id === b.id) return false;

  if (a.journalId && b.journalId && a.journalId === b.journalId) {
    return true;
  }
  if (a.issn && b.issn && a.issn.toLowerCase() === b.issn.toLowerCase()) {
    return true;
  }
  return normalizeJournalKey(a.journal) === normalizeJournalKey(b.journal);
}

export interface RankedCandidate {
  untranslated: Article;
  breakdown: OverlapBreakdown;
}

/**
 * Lists all valid same-journal, same-year untranslated candidates for a translated article,
 * ranked ascending by overlap distance (closest to 0 = best topic overlap first).
 */
export function getRankedCandidatesForTranslated(
  translated: Article,
  allArticles: Article[],
  metric: ScoringMetric = 'hybrid',
  precomputedIdf?: Map<string, number>
): RankedCandidate[] {
  const idf = precomputedIdf ?? buildCorpusIdf(allArticles);

  const candidates = allArticles.filter(
    (candidate) => candidate.kind === 'untranslated' && isSameJournalAndYear(translated, candidate)
  );

  return candidates
    .map((untranslated) => ({
      untranslated,
      breakdown: computeTopicOverlap(translated, untranslated, idf, metric),
    }))
    .sort((a, b) => {
      if (a.breakdown.distance !== b.breakdown.distance) {
        return a.breakdown.distance - b.breakdown.distance;
      }
      return a.untranslated.doi.localeCompare(b.untranslated.doi);
    });
}

export interface ManualPairLink {
  translatedId: string;
  untranslatedId: string;
}

export interface GeneratePairingsOptions {
  /** Number of best-matching untranslated controls to pair per translated article (minimum 1). */
  pairsPerTranslated?: number;
  /** Active topic overlap distance metric (0 = perfect overlap). */
  metric?: ScoringMetric;
  /** Optional explicit manual pairings chosen by the user. */
  manualLinks?: ManualPairLink[];
  /** Optional pair keys ("translatedId::untranslatedId") explicitly excluded by user (only respected if ≥1 pair remains). */
  excludedPairKeys?: Set<string>;
}

/**
 * Pairs every Translated abstract with at least 1 Untranslated abstract from the exact same journal
 * and same publication year, optimizing for minimal topic overlap distance (0 = perfect overlap).
 *
 * Rules enforced:
 * 1. Strict same-journal and same-year matching.
 * 2. Multiple translated articles MAY share the same untranslated article (reuse allowed).
 * 3. Every translated article with >= 1 valid same-journal, same-year candidate gets >= 1 pairing.
 * 4. Translated articles with 0 valid candidates are explicitly reported in `unpairedTranslatedIds`.
 */
export function generatePairings(
  articles: Article[],
  options: GeneratePairingsOptions = {}
): PairingResult {
  const pairsPerTranslated = Math.max(1, Math.min(10, options.pairsPerTranslated ?? 1));
  const metric: ScoringMetric = options.metric ?? 'hybrid';
  const manualLinks = options.manualLinks ?? [];
  const excludedKeys = options.excludedPairKeys ?? new Set<string>();

  const idf = buildCorpusIdf(articles);
  const articleMap = new Map(articles.map((a) => [a.id, a]));
  const translatedArticles = articles.filter((a) => a.kind === 'translated');

  const pairs: ArticlePair[] = [];
  const unpairedTranslatedIds: string[] = [];
  const untranslatedReuseCount: Record<string, number> = {};

  for (const translated of translatedArticles) {
    const ranked = getRankedCandidatesForTranslated(translated, articles, metric, idf);

    if (ranked.length === 0) {
      unpairedTranslatedIds.push(translated.id);
      continue;
    }

    const chosenIds = new Set<string>();
    const selectedForArticle: Array<{ candidate: RankedCandidate; isManual: boolean }> = [];

    // 1. Fill automatic best matches up to pairsPerTranslated using lowest distance non-excluded candidates
    for (const candidate of ranked) {
      if (selectedForArticle.length >= pairsPerTranslated) break;
      const pairKey = `${translated.id}::${candidate.untranslated.id}`;
      if (excludedKeys.has(pairKey)) continue;

      chosenIds.add(candidate.untranslated.id);
      selectedForArticle.push({ candidate, isManual: false });
    }

    // 2. Append any explicit user-added manual pairings (strictly enforcing same-journal & same-year)
    const manualForThis = manualLinks.filter((l) => l.translatedId === translated.id);
    for (const link of manualForThis) {
      const target = articleMap.get(link.untranslatedId);
      if (!target || target.kind !== 'untranslated') continue;
      if (!isSameJournalAndYear(translated, target)) continue;
      if (chosenIds.has(target.id)) continue;

      const match = ranked.find((r) => r.untranslated.id === target.id);
      if (match) {
        chosenIds.add(target.id);
        selectedForArticle.push({ candidate: match, isManual: true });
      }
    }

    // 3. Guarantee coverage invariant: every translated article with >= 1 valid candidate MUST have >= 1 pairing
    if (selectedForArticle.length === 0) {
      const bestFallback = ranked[0];
      chosenIds.add(bestFallback.untranslated.id);
      selectedForArticle.push({ candidate: bestFallback, isManual: false });
    }

    // Sort this article's pairs by overlap distance ascending so rank 1 is always best overlap
    selectedForArticle.sort((a, b) => a.candidate.breakdown.distance - b.candidate.breakdown.distance);

    selectedForArticle.forEach(({ candidate, isManual }, idx) => {
      const uId = candidate.untranslated.id;
      untranslatedReuseCount[uId] = (untranslatedReuseCount[uId] ?? 0) + 1;

      pairs.push({
        id: `${translated.id}::${uId}`,
        translatedId: translated.id,
        untranslatedId: uId,
        group: translated.group,
        journal: translated.journal,
        year: translated.year,
        isManual,
        rank: idx + 1,
        breakdown: candidate.breakdown,
      });
    });
  }

  // Sort global pairings by group, journal, year, and distance
  pairs.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    if (a.breakdown.distance !== b.breakdown.distance) return a.breakdown.distance - b.breakdown.distance;
    return a.journal.localeCompare(b.journal);
  });

  return {
    pairs,
    unpairedTranslatedIds,
    untranslatedReuseCount,
  };
}

/**
 * Computes journal x year stratum coverage summary for analytics and pairing verification.
 */
export function computeStratumSummaries(articles: Article[], pairingResult: PairingResult): StratumSummary[] {
  const map = new Map<
    string,
    {
      journal: string;
      year: number;
      groups: Set<DomainGroup>;
      translatedCount: number;
      untranslatedCount: number;
      distances: number[];
      unpairedCount: number;
    }
  >();

  const unpairedSet = new Set(pairingResult.unpairedTranslatedIds);

  for (const article of articles) {
    const key = `${normalizeJournalKey(article.journal)}::${article.year}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        journal: article.journal,
        year: article.year,
        groups: new Set<DomainGroup>(),
        translatedCount: 0,
        untranslatedCount: 0,
        distances: [],
        unpairedCount: 0,
      };
      map.set(key, entry);
    }
    entry.groups.add(article.group);
    if (article.kind === 'translated') {
      entry.translatedCount++;
      if (unpairedSet.has(article.id)) {
        entry.unpairedCount++;
      }
    } else {
      entry.untranslatedCount++;
    }
  }

  for (const pair of pairingResult.pairs) {
    const key = `${normalizeJournalKey(pair.journal)}::${pair.year}`;
    const entry = map.get(key);
    if (entry) {
      entry.distances.push(pair.breakdown.distance);
    }
  }

  return Array.from(map.entries())
    .map(([key, e]) => ({
      key,
      journal: e.journal,
      year: e.year,
      groups: Array.from(e.groups),
      translatedCount: e.translatedCount,
      untranslatedCount: e.untranslatedCount,
      pairCount: e.distances.length,
      unpairedCount: e.unpairedCount,
      meanDistance:
        e.distances.length > 0
          ? Math.round((e.distances.reduce((s, v) => s + v, 0) / e.distances.length) * 1000) / 1000
          : null,
    }))
    .sort((a, b) => b.year - a.year || a.journal.localeCompare(b.journal));
}
