import type { Article, OverlapBreakdown, ScoringMetric } from '../types';

const STOPWORDS = new Set([
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'all', 'almost', 'alone', 'along', 'already',
  'also', 'although', 'always', 'among', 'an', 'and', 'another', 'any', 'are', 'around', 'as', 'at',
  'be', 'became', 'because', 'become', 'becomes', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'data', 'did', 'do', 'does', 'done', 'during',
  'each', 'either', 'else', 'even', 'ever', 'every', 'few', 'find', 'findings', 'first', 'for', 'found', 'from', 'further',
  'had', 'has', 'have', 'having', 'here', 'high', 'higher', 'however', 'how',
  'if', 'in', 'include', 'included', 'including', 'increase', 'increased', 'increases', 'indicate', 'indicated', 'into', 'is', 'it', 'its',
  'large', 'larger', 'less', 'like', 'likely', 'low', 'lower',
  'made', 'main', 'major', 'make', 'many', 'may', 'method', 'methods', 'might', 'more', 'most', 'much', 'must',
  'need', 'new', 'no', 'non', 'nor', 'not', 'now', 'number',
  'observed', 'of', 'off', 'often', 'on', 'one', 'only', 'or', 'other', 'others', 'our', 'out', 'over', 'overall',
  'paper', 'part', 'per', 'percent', 'period', 'present', 'previous', 'provide', 'provided',
  'rate', 'rates', 'rather', 'related', 'relative', 'report', 'reported', 'research', 'result', 'results', 'reveal', 'revealed',
  'same', 'second', 'see', 'several', 'should', 'show', 'showed', 'shown', 'shows', 'significant', 'significantly', 'similar', 'since', 'small', 'so', 'some', 'study', 'studies', 'such', 'suggest', 'suggested', 'suggests',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'therefore', 'these', 'they', 'this', 'those', 'though', 'three', 'through', 'thus', 'time', 'to', 'total', 'toward', 'towards', 'two',
  'under', 'until', 'up', 'upon', 'use', 'used', 'using', 'various', 'very',
  'was', 'we', 'well', 'were', 'what', 'when', 'where', 'whereas', 'whether', 'which', 'while', 'who', 'whose', 'why', 'will', 'with', 'within', 'without', 'work', 'would', 'year', 'years',
]);

/**
 * Light domain-safe morphological normalizer (handles pluralization and common derivational suffixes
 * while preserving readable roots for scientific vocabulary).
 */
export function stemToken(token: string): string {
  let w = token.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 5) {
    w = w.slice(0, -3) + 'y';
  } else if (w.endsWith('sses') && w.length > 5) {
    w = w.slice(0, -2);
  } else if (w.endsWith('ations') && w.length > 8) {
    w = w.slice(0, -5) + 'e';
  } else if (w.endsWith('ation') && w.length > 7) {
    w = w.slice(0, -4) + 'e';
  } else if (w.endsWith('ing') && w.length > 6) {
    w = w.slice(0, -3);
  } else if (w.endsWith('ed') && w.length > 5) {
    w = w.slice(0, -2);
  } else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is') && w.length > 4) {
    w = w.slice(0, -1);
  }
  return w;
}

export interface TokenizedDoc {
  /** Normalized term -> frequency */
  counts: Map<string, number>;
  /** Normalized term -> original human-readable surface form */
  displayForms: Map<string, string>;
}

/**
 * Tokenizes scientific text into normalized unigrams and informative bigrams.
 */
export function tokenizeText(text: string): TokenizedDoc {
  const counts = new Map<string, number>();
  const displayForms = new Map<string, string>();

  const rawWords = text
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w));

  const stemmedWords: Array<{ stem: string; surface: string }> = [];

  for (const surface of rawWords) {
    const stem = stemToken(surface);
    if (stem.length < 3 || STOPWORDS.has(stem)) continue;
    stemmedWords.push({ stem, surface });
    counts.set(stem, (counts.get(stem) ?? 0) + 1);
    if (!displayForms.has(stem) || surface.length < (displayForms.get(stem)?.length ?? 99)) {
      displayForms.set(stem, surface);
    }
  }

  // Add adjacent domain bigrams with slightly lower base frequency weight
  for (let i = 0; i < stemmedWords.length - 1; i++) {
    const a = stemmedWords[i];
    const b = stemmedWords[i + 1];
    if (a.stem === b.stem) continue;
    const key = `${a.stem} ${b.stem}`;
    counts.set(key, (counts.get(key) ?? 0) + 0.6);
    if (!displayForms.has(key)) {
      displayForms.set(key, `${a.surface} ${b.surface}`);
    }
  }

  return { counts, displayForms };
}

/**
 * Builds an Inverse Document Frequency (IDF) table across the loaded corpus.
 */
export function buildCorpusIdf(articles: Article[]): Map<string, number> {
  const docFreq = new Map<string, number>();
  const totalDocs = Math.max(articles.length, 1);

  for (const article of articles) {
    const doc = tokenizeText(`${article.title} ${article.abstract}`);
    for (const term of doc.counts.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, df] of docFreq.entries()) {
    // Smooth IDF so even single-document or identical-pair corpora retain positive weight
    idf.set(term, Math.log((totalDocs + 1) / (df + 1)) + 1);
  }
  return idf;
}

function buildTfIdfVector(article: Article, idf: Map<string, number>): {
  vector: Map<string, number>;
  displayForms: Map<string, string>;
} {
  // Title carries slightly higher lexical topical signal than body sentences
  const titleDoc = tokenizeText(article.title);
  const abstractDoc = tokenizeText(article.abstract);

  const combined = new Map<string, number>();
  const displayForms = new Map<string, string>();

  for (const [term, count] of abstractDoc.counts.entries()) {
    combined.set(term, count);
    const display = abstractDoc.displayForms.get(term);
    if (display) displayForms.set(term, display);
  }
  for (const [term, count] of titleDoc.counts.entries()) {
    combined.set(term, (combined.get(term) ?? 0) + count * 1.4);
    const display = titleDoc.displayForms.get(term);
    if (display && !displayForms.has(term)) displayForms.set(term, display);
  }

  const vector = new Map<string, number>();
  for (const [term, tf] of combined.entries()) {
    const weight = (1 + Math.log(tf)) * (idf.get(term) ?? 1.5);
    vector.set(term, weight);
  }
  return { vector, displayForms };
}

function buildConceptVector(article: Article): {
  vector: Map<string, number>;
  displayForms: Map<string, string>;
} {
  const vector = new Map<string, number>();
  const displayForms = new Map<string, string>();

  for (const topic of article.topics) {
    const clean = topic.name.trim().toLowerCase();
    if (!clean) continue;
    const score = Math.max(0.1, Math.min(1, topic.score || 0.7));
    vector.set(clean, Math.max(vector.get(clean) ?? 0, score));
    displayForms.set(clean, topic.name.trim());

    // Also include stemmed constituent tokens of structured topics for partial concept overlap
    const parts = clean.split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !STOPWORDS.has(p));
    for (const part of parts) {
      const stem = stemToken(part);
      const tokenKey = `tok:${stem}`;
      vector.set(tokenKey, Math.max(vector.get(tokenKey) ?? 0, score * 0.45));
      if (!displayForms.has(tokenKey)) displayForms.set(tokenKey, part);
    }
  }

  return { vector, displayForms };
}

/**
 * Cosine distance in [0, 1], where 0 = identical vectors (perfect overlap) and 1 = orthogonal (no overlap).
 */
export function cosineDistance(vecA: Map<string, number>, vecB: Map<string, number>): number {
  if (vecA.size === 0 && vecB.size === 0) return 0;
  if (vecA.size === 0 || vecB.size === 0) return 1;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [k, vA] of vecA.entries()) {
    normA += vA * vA;
    const vB = vecB.get(k);
    if (vB !== undefined) {
      dot += vA * vB;
    }
  }
  for (const vB of vecB.values()) {
    normB += vB * vB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;

  const similarity = Math.max(0, Math.min(1, dot / denom));
  return clampDistance(1 - similarity);
}

/**
 * Jensen-Shannon Distance sqrt(JSD(P || Q)) using log base 2, normalized to [0, 1].
 * 0 = identical probability distributions (perfect overlap), 1 = completely disjoint support.
 */
export function jensenShannonDistance(vecA: Map<string, number>, vecB: Map<string, number>): number {
  let sumA = 0;
  let sumB = 0;
  for (const v of vecA.values()) sumA += Math.max(0, v);
  for (const v of vecB.values()) sumB += Math.max(0, v);

  if (sumA === 0 && sumB === 0) return 0;
  if (sumA === 0 || sumB === 0) return 1;

  const keys = new Set<string>([...vecA.keys(), ...vecB.keys()]);
  let jsd = 0;

  for (const k of keys) {
    const p = (Math.max(0, vecA.get(k) ?? 0)) / sumA;
    const q = (Math.max(0, vecB.get(k) ?? 0)) / sumB;
    const m = 0.5 * (p + q);
    if (p > 0) jsd += 0.5 * p * Math.log2(p / m);
    if (q > 0) jsd += 0.5 * q * Math.log2(q / m);
  }

  return clampDistance(Math.sqrt(Math.max(0, Math.min(1, jsd))));
}

/**
 * Jaccard distance 1 - |A ∩ B| / |A ∪ B| on the top-N terms of each vector.
 * 0 = identical top term sets (perfect overlap), 1 = disjoint sets.
 */
export function jaccardDistance(vecA: Map<string, number>, vecB: Map<string, number>, topK = 28): number {
  const topA = new Set(
    Array.from(vecA.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([k]) => k)
  );
  const topB = new Set(
    Array.from(vecB.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([k]) => k)
  );

  if (topA.size === 0 && topB.size === 0) return 0;
  if (topA.size === 0 || topB.size === 0) return 1;

  let intersection = 0;
  for (const k of topA) {
    if (topB.has(k)) intersection++;
  }
  const union = topA.size + topB.size - intersection;
  return clampDistance(1 - intersection / union);
}

function clampDistance(val: number): number {
  const rounded = Math.round(val * 10000) / 10000;
  if (rounded <= 0.0001) return 0;
  if (rounded >= 0.9999) return 1;
  return rounded;
}

/**
 * Computes full topic overlap distance breakdown between a Translated article and an Untranslated article.
 * A score of 0.000 represents perfect topic overlap; 1.000 represents zero overlap.
 */
export function computeTopicOverlap(
  translated: Article,
  untranslated: Article,
  idf: Map<string, number>,
  metric: ScoringMetric = 'hybrid'
): OverlapBreakdown {
  const lexT = buildTfIdfVector(translated, idf);
  const lexU = buildTfIdfVector(untranslated, idf);
  const conT = buildConceptVector(translated);
  const conU = buildConceptVector(untranslated);

  const lexicalDistance = cosineDistance(lexT.vector, lexU.vector);
  const hasConcepts = conT.vector.size > 0 && conU.vector.size > 0;
  const conceptDistance = hasConcepts ? cosineDistance(conT.vector, conU.vector) : lexicalDistance;

  // Hybrid distance blends abstract TF-IDF (60%) and structured OpenAlex/keyword topics (40%)
  const hybridDistance = hasConcepts
    ? clampDistance(0.6 * lexicalDistance + 0.4 * conceptDistance)
    : lexicalDistance;

  // Build merged distribution for JSD & Jaccard (unigrams + explicit concepts)
  const mergedT = new Map<string, number>(lexT.vector);
  const mergedU = new Map<string, number>(lexU.vector);
  for (const [k, v] of conT.vector.entries()) {
    if (!k.startsWith('tok:')) mergedT.set(`topic:${k}`, v * 2.0);
  }
  for (const [k, v] of conU.vector.entries()) {
    if (!k.startsWith('tok:')) mergedU.set(`topic:${k}`, v * 2.0);
  }

  const jsdDistance = jensenShannonDistance(mergedT, mergedU);
  const jaccardDist = jaccardDistance(mergedT, mergedU);

  const distance =
    metric === 'jsd' ? jsdDistance : metric === 'jaccard' ? jaccardDist : hybridDistance;

  // Extract human-readable shared & distinctive terms for the side-by-side inspector
  const sharedScored: Array<{ label: string; score: number }> = [];
  const seenShared = new Set<string>();

  // First include exact shared structured topics
  for (const t of translated.topics) {
    const key = t.name.trim().toLowerCase();
    if (conU.vector.has(key) && !seenShared.has(key)) {
      seenShared.add(key);
      sharedScored.push({
        label: t.name.trim(),
        score: (t.score + (conU.vector.get(key) ?? 0.5)) * 2.2,
      });
    }
  }

  // Next include shared unigrams/bigrams ranked by product of TF-IDF weights
  for (const [term, wT] of lexT.vector.entries()) {
    const wU = lexU.vector.get(term);
    if (wU === undefined) continue;
    const label = lexT.displayForms.get(term) ?? lexU.displayForms.get(term) ?? term;
    const normLabel = label.toLowerCase();
    if (seenShared.has(normLabel)) continue;
    seenShared.add(normLabel);
    sharedScored.push({ label, score: wT * wU });
  }

  const sharedTerms = sharedScored
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((item) => item.label);

  const translatedOnlyTerms = Array.from(lexT.vector.entries())
    .filter(([term]) => !lexU.vector.has(term) && !term.includes(' '))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([term]) => lexT.displayForms.get(term) ?? term);

  const untranslatedOnlyTerms = Array.from(lexU.vector.entries())
    .filter(([term]) => !lexT.vector.has(term) && !term.includes(' '))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([term]) => lexU.displayForms.get(term) ?? term);

  return {
    distance,
    hybridDistance,
    lexicalDistance,
    conceptDistance,
    jsdDistance,
    jaccardDistance: jaccardDist,
    sharedTerms,
    translatedOnlyTerms,
    untranslatedOnlyTerms,
  };
}

export function classifyOverlapDistance(distance: number): {
  label: 'Perfect' | 'Strong' | 'Moderate' | 'Weak';
  toneClass: string;
  barClass: string;
} {
  if (distance <= 0.05) {
    return {
      label: 'Perfect',
      toneClass: 'text-emerald-700',
      barClass: 'bg-emerald-600',
    };
  }
  if (distance <= 0.35) {
    return {
      label: 'Strong',
      toneClass: 'text-emerald-700',
      barClass: 'bg-emerald-600',
    };
  }
  if (distance <= 0.6) {
    return {
      label: 'Moderate',
      toneClass: 'text-amber-700',
      barClass: 'bg-amber-500',
    };
  }
  return {
    label: 'Weak',
    toneClass: 'text-rose-700',
    barClass: 'bg-rose-600',
  };
}
