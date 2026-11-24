export type DomainGroup = 'Biodiversity' | 'Climate Change' | 'Infectious Diseases';

export const DOMAIN_GROUPS: readonly DomainGroup[] = [
  'Biodiversity',
  'Climate Change',
  'Infectious Diseases',
] as const;

export type ArticleKind = 'translated' | 'untranslated';

export type ScoringMetric = 'hybrid' | 'jsd' | 'jaccard';

export interface TopicTag {
  name: string;
  score: number; // 0..1 relevance weight
}

export interface Article {
  id: string;
  doi: string;
  title: string;
  abstract: string;
  journal: string;
  journalId?: string;
  issn?: string;
  year: number;
  group: DomainGroup;
  kind: ArticleKind;
  language?: string;
  originalLanguage?: string;
  authors?: string[];
  topics: TopicTag[];
  source: 'seed' | 'openalex' | 'crossref' | 'manual' | 'csv';
}

export interface OverlapBreakdown {
  /** Primary distance according to active metric (0 = perfect overlap, 1 = no overlap) */
  distance: number;
  /** Hybrid weighted Cosine distance (0 = perfect overlap, 1 = no overlap) */
  hybridDistance: number;
  /** Abstract TF-IDF Cosine distance (0 = perfect overlap, 1 = no overlap) */
  lexicalDistance: number;
  /** Structured topic / concept Cosine distance (0 = perfect overlap, 1 = no overlap) */
  conceptDistance: number;
  /** Jensen-Shannon distance sqrt(JSD) in [0, 1] (0 = perfect overlap) */
  jsdDistance: number;
  /** Jaccard distance 1 - |A ∩ B| / |A ∪ B| in [0, 1] (0 = perfect overlap) */
  jaccardDistance: number;
  /** Shared significant topic terms ranked by joint contribution */
  sharedTerms: string[];
  /** Distinctive terms present primarily in the translated abstract */
  translatedOnlyTerms: string[];
  /** Distinctive terms present primarily in the untranslated abstract */
  untranslatedOnlyTerms: string[];
}

export interface ArticlePair {
  id: string;
  translatedId: string;
  untranslatedId: string;
  group: DomainGroup;
  journal: string;
  year: number;
  isManual: boolean;
  rank: number; // 1 = primary best match for this translated article
  breakdown: OverlapBreakdown;
}

export interface PairingResult {
  pairs: ArticlePair[];
  unpairedTranslatedIds: string[];
  untranslatedReuseCount: Record<string, number>;
}

export interface StratumSummary {
  key: string;
  journal: string;
  year: number;
  groups: DomainGroup[];
  translatedCount: number;
  untranslatedCount: number;
  pairCount: number;
  unpairedCount: number;
  meanDistance: number | null;
}
