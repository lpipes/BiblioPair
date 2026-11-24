import { useMemo, useState } from 'react';
import { Download, FileJson, Search } from 'lucide-react';
import type { Article, ArticlePair, DomainGroup, ScoringMetric } from '../types';
import { DOMAIN_GROUPS } from '../types';
import {
  buildStratumDistanceMatrices,
  getMatrixCellStyle,
  type StratumDistanceMatrix,
} from '../lib/matrix';
import {
  buildAllMatricesJson,
  buildAllMatricesLongCsv,
  buildSingleMatrixCsv,
  triggerFileDownload,
} from '../lib/export';
import { ScoreBar } from './ScoreBar';

interface MatricesViewProps {
  articles: Article[];
  activePairs: ArticlePair[];
  activeGroup: DomainGroup | 'All';
  onChangeGroup: (group: DomainGroup | 'All') => void;
  metric: ScoringMetric;
  onChangeMetric: (metric: ScoringMetric) => void;
  onGoToImport: () => void;
}

const SCALE_STOPS = [
  { label: '0.0', sample: 0.05 },
  { label: '0.1', sample: 0.15 },
  { label: '0.2', sample: 0.25 },
  { label: '0.3', sample: 0.35 },
  { label: '0.4', sample: 0.45 },
  { label: '0.5', sample: 0.55 },
  { label: '0.6', sample: 0.65 },
  { label: '0.7', sample: 0.75 },
  { label: '0.8', sample: 0.85 },
  { label: '0.9–1.0', sample: 0.95 },
];

function getArticleCode(articles: Article[], index: number): string {
  const target = articles[index];
  let sameKindCount = 0;
  for (let k = 0; k <= index; k++) {
    if (articles[k].kind === target.kind) sameKindCount++;
  }
  return `${target.kind === 'translated' ? 'T' : 'U'}${sameKindCount}`;
}

interface SelectedCellRef {
  matrixKey: string;
  row: number;
  col: number;
}

export function MatricesView({
  articles,
  activePairs,
  activeGroup,
  onChangeGroup,
  metric,
  onChangeMetric,
  onGoToImport,
}: MatricesViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCell, setSelectedCell] = useState<SelectedCellRef | null>(null);

  const allMatrices = useMemo(
    () => buildStratumDistanceMatrices(articles, metric, activePairs),
    [articles, metric, activePairs]
  );

  const filteredMatrices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allMatrices.filter((m) => {
      if (activeGroup !== 'All' && !m.groups.includes(activeGroup)) return false;
      if (!q) return true;
      const haystack = [
        m.journal,
        String(m.year),
        ...m.groups,
        ...m.articles.map((a) => `${a.doi} ${a.title}`),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allMatrices, activeGroup, searchQuery]);

  // Default inspector selection to the first off-diagonal cell of the first visible matrix
  const resolvedSelection = useMemo(() => {
    if (filteredMatrices.length === 0) return null;

    if (selectedCell) {
      const m = filteredMatrices.find((item) => item.key === selectedCell.matrixKey);
      if (
        m &&
        selectedCell.row < m.articles.length &&
        selectedCell.col < m.articles.length
      ) {
        return { matrix: m, row: selectedCell.row, col: selectedCell.col };
      }
    }

    const first = filteredMatrices[0];
    const defaultCol = first.articles.length > 2 ? 2 : first.articles.length > 1 ? 1 : 0;
    return { matrix: first, row: 0, col: defaultCol };
  }, [filteredMatrices, selectedCell]);

  const handleExportSingleCsv = (m: StratumDistanceMatrix) => {
    const slug = `${m.journal.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${m.year}`;
    triggerFileDownload(
      `distance-matrix-${slug}.csv`,
      buildSingleMatrixCsv(m),
      'text/csv;charset=utf-8'
    );
  };

  const handleExportAllLongCsv = () => {
    const suffix =
      activeGroup === 'All' ? 'all-strata' : activeGroup.toLowerCase().replace(/\s+/g, '-');
    triggerFileDownload(
      `pairwise-distance-matrices-${suffix}.csv`,
      buildAllMatricesLongCsv(filteredMatrices),
      'text/csv;charset=utf-8'
    );
  };

  const handleExportAllJson = () => {
    const suffix =
      activeGroup === 'All' ? 'all-strata' : activeGroup.toLowerCase().replace(/\s+/g, '-');
    triggerFileDownload(
      `pairwise-distance-matrices-${suffix}.json`,
      buildAllMatricesJson(filteredMatrices),
      'application/json;charset=utf-8'
    );
  };

  const totalPairwiseEntries = useMemo(
    () =>
      filteredMatrices.reduce((acc, m) => {
        const n = m.articles.length;
        return acc + (n * (n - 1)) / 2;
      }, 0),
    [filteredMatrices]
  );

  return (
    <div className="space-y-6">
      {/* Page Header & Bulk Matrix Exports */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Pairwise Distance Matrices</h1>
          <p className="mt-1 text-sm text-slate-600">
            One symmetric <span className="font-mono text-slate-800">N × N</span> topic-distance
            matrix per journal and publication year (<span className="font-mono tabular-nums text-slate-900">{filteredMatrices.length}</span>{' '}
            {filteredMatrices.length === 1 ? 'matrix' : 'matrices'} ·{' '}
            <span className="font-mono tabular-nums text-slate-900">{totalPairwiseEntries}</span>{' '}
            unique article pairs). Higher values indicate less topical relatedness.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportAllLongCsv}
            disabled={filteredMatrices.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export All (CSV)</span>
          </button>
          <button
            type="button"
            onClick={handleExportAllJson}
            disabled={filteredMatrices.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <FileJson className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export All (JSON)</span>
          </button>
        </div>
      </div>

      {/* Shared Universal Scale Legend (Fixed [0.000, 1.000] across ALL matrices) */}
      <section
        aria-label="Universal distance scale legend"
        className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold text-slate-900">
              Shared Distance Scale Across All Matrices (Fixed 0.000 – 1.000)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Every matrix uses the same global corpus IDF weighting and fixed color bounds so distances are directly comparable across journals and years.
            </p>
          </div>
          <p className="text-xs text-slate-600 whitespace-nowrap shrink-0">
            <span className="font-mono font-medium text-slate-900">T</span> = Translated ·{' '}
            <span className="font-mono font-medium text-slate-900">U</span> = Untranslated ·{' '}
            <span className="inline-block w-2.5 h-2.5 align-middle border-2 border-blue-700 mr-1" aria-hidden="true" />
            Active pairing
          </p>
        </div>

        <div className="mt-3 grid grid-cols-10 gap-px bg-slate-200 border border-slate-200 rounded overflow-hidden">
          {SCALE_STOPS.map((stop) => {
            const { backgroundColor, textColor } = getMatrixCellStyle(stop.sample, false);
            return (
              <div
                key={stop.label}
                style={{ backgroundColor, color: textColor }}
                className="py-1.5 px-1 text-center font-mono text-[11px] font-medium tabular-nums"
              >
                {stop.label}
              </div>
            );
          })}
        </div>

        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
          <span className="font-medium text-emerald-700">0.000 · Identical / Closely related</span>
          <span>0.500 · Moderate topic distance</span>
          <span className="font-medium text-rose-700">1.000 · Unrelated / Disjoint topics</span>
        </div>
      </section>

      {/* Filter & Metric Bar */}
      <section
        aria-label="Matrix filters and metric controls"
        className="flex flex-col xl:flex-row xl:items-center justify-between gap-3"
      >
        <div
          role="tablist"
          aria-label="Filter matrices by domain group"
          className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg overflow-x-auto max-w-full"
        >
          {(['All', ...DOMAIN_GROUPS] as const).map((group) => {
            const count =
              group === 'All'
                ? allMatrices.length
                : allMatrices.filter((m) => m.groups.includes(group)).length;
            const active = activeGroup === group;
            return (
              <button
                key={group}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChangeGroup(group)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {group === 'All' ? 'All Groups' : group}{' '}
                <span className="font-mono tabular-nums text-slate-400 ml-1">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="whitespace-nowrap">Metric</span>
            <select
              aria-label="Matrix distance metric"
              value={metric}
              onChange={(e) => onChangeMetric(e.target.value as ScoringMetric)}
              className="h-9 px-2.5 text-xs font-medium text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="hybrid">Hybrid Cosine</option>
              <option value="jsd">Jensen-Shannon</option>
              <option value="jaccard">Jaccard Distance</option>
            </select>
          </label>

          <div className="relative flex-1 sm:flex-initial sm:w-56">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search matrices by journal, year, or DOI"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter journal, year, DOI…"
              className="w-full h-9 pl-8 pr-3 text-xs text-slate-900 bg-white border border-slate-200 rounded-md placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      </section>

      {/* Main Split: Matrices Grid + Sticky Cell Inspector */}
      {filteredMatrices.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
          <h2 className="text-base font-semibold text-slate-900">No journal-year matrices match</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            {articles.length === 0
              ? 'Import DOIs to generate pairwise distance matrices per journal and publication year.'
              : 'Try clearing your search or switching the active domain group.'}
          </p>
          <button
            type="button"
            onClick={onGoToImport}
            className="mt-4 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800"
          >
            Import DOIs
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Matrices Column */}
          <div className="xl:col-span-8 space-y-6">
            {filteredMatrices.map((matrix) => {
              const codes = matrix.articles.map((_, idx) => getArticleCode(matrix.articles, idx));

              return (
                <article
                  key={matrix.key}
                  aria-label={`${matrix.journal} ${matrix.year} pairwise distance matrix`}
                  className="bg-white border border-slate-200 rounded-lg overflow-hidden"
                >
                  {/* Matrix Card Header */}
                  <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">
                        <span>{matrix.groups.join(' · ')}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{matrix.articles.length}×{matrix.articles.length}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>
                          Mean off-diag:{' '}
                          <span className="font-mono tabular-nums font-medium text-slate-800">
                            {matrix.offDiagonalMean !== null
                              ? matrix.offDiagonalMean.toFixed(3)
                              : '—'}
                          </span>
                        </span>
                      </p>
                      <h2 className="mt-0.5 text-base font-semibold text-slate-900 truncate">
                        {matrix.journal}{' '}
                        <span className="font-mono font-medium text-slate-500 tabular-nums">
                          ({matrix.year})
                        </span>
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleExportSingleCsv(matrix)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0 self-start sm:self-center"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Matrix CSV</span>
                    </button>
                  </div>

                  {/* Symmetric N x N Heatmap Table */}
                  <div className="p-5 overflow-x-auto">
                    <table className="w-full border-separate border-spacing-[2px] text-center">
                      <thead>
                        <tr>
                          <th className="p-1.5 text-left text-[11px] font-mono font-medium text-slate-400 w-24">
                            [0.0–1.0]
                          </th>
                          {matrix.articles.map((art, colIdx) => (
                            <th
                              key={art.id}
                              scope="col"
                              title={`${codes[colIdx]} · ${art.doi} — ${art.title}`}
                              className="p-1.5 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap"
                            >
                              {codes[colIdx]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.articles.map((rowArt, rowIdx) => (
                          <tr key={rowArt.id}>
                            <th
                              scope="row"
                              title={`${codes[rowIdx]} · ${rowArt.doi} — ${rowArt.title}`}
                              className="pr-2 py-1 text-left whitespace-nowrap"
                            >
                              <span className="font-mono text-xs font-semibold text-slate-900">
                                {codes[rowIdx]}
                              </span>
                              <span className="ml-1.5 font-mono text-[11px] text-slate-400 hidden sm:inline">
                                {rowArt.doi.split('/').pop()?.slice(0, 14)}
                              </span>
                            </th>

                            {matrix.articles.map((colArt, colIdx) => {
                              const dist = matrix.distances[rowIdx][colIdx];
                              const isDiag = rowIdx === colIdx;
                              const isActivePair = matrix.activePairKeys.has(
                                `${rowArt.id}::${colArt.id}`
                              );
                              const isSelected =
                                resolvedSelection?.matrix.key === matrix.key &&
                                resolvedSelection.row === rowIdx &&
                                resolvedSelection.col === colIdx;
                              const { backgroundColor, textColor } = getMatrixCellStyle(
                                dist,
                                isDiag
                              );

                              return (
                                <td key={colArt.id} className="p-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedCell({
                                        matrixKey: matrix.key,
                                        row: rowIdx,
                                        col: colIdx,
                                      })
                                    }
                                    aria-label={`Distance between ${codes[rowIdx]} (${rowArt.doi}) and ${codes[colIdx]} (${colArt.doi}): ${dist.toFixed(3)}${isActivePair ? ', active pairing' : ''}`}
                                    style={{ backgroundColor, color: textColor }}
                                    className={`w-full min-w-[60px] h-11 font-mono text-xs font-medium tabular-nums rounded-[3px] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-1 ${
                                      isSelected
                                        ? 'ring-2 ring-slate-900 ring-offset-1 font-semibold'
                                        : isActivePair
                                          ? 'outline-2 -outline-offset-2 outline-blue-700'
                                          : 'hover:opacity-90'
                                    }`}
                                  >
                                    {dist.toFixed(3)}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Compact Article Key for Row/Column Codes */}
                    <dl className="mt-4 pt-3.5 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      {matrix.articles.map((art, idx) => (
                        <div key={art.id} className="flex items-baseline gap-2 min-w-0">
                          <dt className="font-mono font-semibold text-slate-900 shrink-0 w-7">
                            {codes[idx]}
                          </dt>
                          <dd className="min-w-0 truncate text-slate-600" title={`${art.doi} — ${art.title}`}>
                            <span className="font-mono text-[11px] text-slate-500">{art.doi}</span>
                            <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                            <span className="text-slate-700">{art.title}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Sticky Cell Pair Inspector */}
          <aside
            aria-label="Selected matrix cell breakdown"
            className="xl:col-span-4 xl:sticky xl:top-20 bg-white border border-slate-200 rounded-lg divide-y divide-slate-200"
          >
            {resolvedSelection ? (
              (() => {
                const { matrix, row, col } = resolvedSelection;
                const artA = matrix.articles[row];
                const artB = matrix.articles[col];
                const codeA = getArticleCode(matrix.articles, row);
                const codeB = getArticleCode(matrix.articles, col);
                const breakdown = matrix.breakdowns[row][col];
                const isDiag = row === col;
                const isActivePair = matrix.activePairKeys.has(`${artA.id}::${artB.id}`);

                return (
                  <>
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-500 truncate">
                            {matrix.journal} · <span className="font-mono">{matrix.year}</span>
                          </p>
                          <h2 className="mt-1 text-base font-semibold text-slate-900">
                            Cell ({codeA}, {codeB})
                          </h2>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {isDiag
                              ? 'Self-comparison (diagonal)'
                              : isActivePair
                                ? 'Active Translated ↔ Untranslated pairing'
                                : artA.kind === artB.kind
                                  ? `Within-role comparison (${artA.kind} ↔ ${artB.kind})`
                                  : 'Unpaired Translated ↔ Untranslated candidate'}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="block text-xs text-slate-500">Distance</span>
                          <span className="font-mono text-2xl font-semibold tabular-nums text-slate-900">
                            {breakdown.distance.toFixed(3)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3">
                        <ScoreBar distance={breakdown.distance} showNumeric={false} />
                      </div>

                      <dl className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <dt className="text-slate-500">Hybrid Cosine</dt>
                          <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900">
                            {breakdown.hybridDistance.toFixed(3)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Lexical TF-IDF</dt>
                          <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900">
                            {breakdown.lexicalDistance.toFixed(3)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Jensen-Shannon</dt>
                          <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900">
                            {breakdown.jsdDistance.toFixed(3)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Jaccard</dt>
                          <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900">
                            {breakdown.jaccardDistance.toFixed(3)}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="p-5 space-y-3 text-xs">
                      <div>
                        <p className="font-semibold text-slate-800">
                          Row {codeA} · {artA.kind === 'translated' ? 'Translated' : 'Untranslated'}
                        </p>
                        <p className="mt-0.5 text-sm font-medium text-slate-900 leading-snug">
                          {artA.title}
                        </p>
                        <p className="mt-0.5 font-mono text-slate-500">{artA.doi}</p>
                      </div>

                      {!isDiag && (
                        <div className="pt-3 border-t border-slate-100">
                          <p className="font-semibold text-slate-800">
                            Col {codeB} · {artB.kind === 'translated' ? 'Translated' : 'Untranslated'}
                          </p>
                          <p className="mt-0.5 text-sm font-medium text-slate-900 leading-snug">
                            {artB.title}
                          </p>
                          <p className="mt-0.5 font-mono text-slate-500">{artB.doi}</p>
                        </div>
                      )}
                    </div>

                    <div className="p-5 text-xs">
                      <h3 className="font-semibold text-slate-800">
                        Shared Topic Terms ({breakdown.sharedTerms.length})
                      </h3>
                      <p className="mt-1 leading-relaxed text-slate-600">
                        {breakdown.sharedTerms.length > 0
                          ? breakdown.sharedTerms.join(' · ')
                          : 'No overlapping topic terms detected between these two articles.'}
                      </p>
                    </div>
                  </>
                );
              })()
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}
