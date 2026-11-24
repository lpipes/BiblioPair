import type { Article, ArticlePair } from '../types';
import type { StratumDistanceMatrix } from './matrix';

function csvEscape(value: string | number | boolean | undefined): string {
  const str = value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildPairingsCsv(pairs: ArticlePair[], articles: Article[]): string {
  const articleMap = new Map(articles.map((a) => [a.id, a]));
  const headers = [
    'group',
    'journal',
    'year',
    'translated_doi',
    'translated_title',
    'translated_original_language',
    'untranslated_doi',
    'untranslated_title',
    'pair_rank',
    'pairing_mode',
    'overlap_distance_active',
    'hybrid_distance',
    'lexical_tfidf_distance',
    'concept_distance',
    'jsd_distance',
    'jaccard_distance',
    'shared_topic_terms',
  ];

  const rows = pairs.map((p) => {
    const t = articleMap.get(p.translatedId);
    const u = articleMap.get(p.untranslatedId);
    return [
      p.group,
      p.journal,
      p.year,
      t?.doi ?? '',
      t?.title ?? '',
      t?.originalLanguage ?? '',
      u?.doi ?? '',
      u?.title ?? '',
      p.rank,
      p.isManual ? 'manual' : 'auto',
      p.breakdown.distance.toFixed(4),
      p.breakdown.hybridDistance.toFixed(4),
      p.breakdown.lexicalDistance.toFixed(4),
      p.breakdown.conceptDistance.toFixed(4),
      p.breakdown.jsdDistance.toFixed(4),
      p.breakdown.jaccardDistance.toFixed(4),
      p.breakdown.sharedTerms.join('; '),
    ]
      .map(csvEscape)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Exports a single (journal, year) stratum as a standard square symmetric N x N distance matrix CSV.
 * Ready for direct import into R (read.csv(..., row.names=1)) or pandas.
 */
export function buildSingleMatrixCsv(matrix: StratumDistanceMatrix): string {
  const labels = matrix.articles.map(
    (a) => `${a.doi} [${a.kind === 'translated' ? 'T' : 'U'}]`
  );
  const header = ['doi_role', ...labels].map(csvEscape).join(',');
  const rows = matrix.articles.map((_, i) =>
    [labels[i], ...matrix.distances[i].map((d) => d.toFixed(4))]
      .map(csvEscape)
      .join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * Exports all (journal, year) pairwise distance matrices in tidy long-form CSV format on the shared [0, 1] scale.
 */
export function buildAllMatricesLongCsv(matrices: StratumDistanceMatrix[]): string {
  const headers = [
    'journal',
    'year',
    'metric',
    'distance_scale_min',
    'distance_scale_max',
    'doi_a',
    'role_a',
    'group_a',
    'doi_b',
    'role_b',
    'group_b',
    'is_active_pairing',
    'distance',
    'hybrid_distance',
    'lexical_distance',
    'concept_distance',
    'jsd_distance',
    'jaccard_distance',
  ];

  const rows: string[] = [];
  for (const m of matrices) {
    const n = m.articles.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = m.articles[i];
        const b = m.articles[j];
        const bd = m.breakdowns[i][j];
        const isActive = m.activePairKeys.has(`${a.id}::${b.id}`);
        rows.push(
          [
            m.journal,
            m.year,
            m.metric,
            m.scaleMin.toFixed(1),
            m.scaleMax.toFixed(1),
            a.doi,
            a.kind,
            a.group,
            b.doi,
            b.kind,
            b.group,
            isActive,
            bd.distance.toFixed(4),
            bd.hybridDistance.toFixed(4),
            bd.lexicalDistance.toFixed(4),
            bd.conceptDistance.toFixed(4),
            bd.jsdDistance.toFixed(4),
            bd.jaccardDistance.toFixed(4),
          ]
            .map(csvEscape)
            .join(',')
        );
      }
    }
  }

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Exports all (journal, year) matrices as a structured JSON bundle preserving exact N x N arrays and universal scale metadata.
 */
export function buildAllMatricesJson(matrices: StratumDistanceMatrix[]): string {
  const payload = {
    scale: { min: 0, max: 1, interpretation: '0.000 = perfect topic overlap, 1.000 = no topic overlap' },
    metric: matrices[0]?.metric ?? 'hybrid',
    stratumCount: matrices.length,
    matrices: matrices.map((m) => ({
      journal: m.journal,
      year: m.year,
      groups: m.groups,
      articles: m.articles.map((a) => ({
        doi: a.doi,
        role: a.kind,
        group: a.group,
        title: a.title,
      })),
      matrix: m.distances.map((row) => row.map((d) => Number(d.toFixed(4)))),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function buildTemplateCsv(): string {
  return [
    'doi,group,type,journal,year,original_language,title,abstract,topics',
    '10.1111/cobi.14012,Biodiversity,translated,Conservation Biology,2023,Spanish,"Riparian corridor restoration for Neotropical amphibians","Forest fragmentation threatens Neotropical amphibian diversity along agricultural watersheds. We evaluated riparian buffer restoration across 34 Andean streams and found higher species richness and occupancy in wider native corridors.","Amphibian conservation; Riparian corridors; Habitat fragmentation"',
    '10.1111/cobi.14088,Biodiversity,untranslated,Conservation Biology,2023,,"Buffer width effects on amphibian richness in agricultural streams","Agricultural expansion fragments stream habitats and reduces amphibian diversity. Monitoring 42 watershed corridors showed that native riparian buffers significantly increase amphibian species richness and breeding occupancy.","Amphibian conservation; Riparian corridors; Watershed ecology"',
  ].join('\n');
}

export function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
