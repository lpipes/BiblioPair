import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpDown, RefreshCw, Search } from 'lucide-react';
import type { Article, ArticlePair, DomainGroup, PairingResult, ScoringMetric } from '../types';
import { DOMAIN_GROUPS } from '../types';
import { ScoreBar } from './ScoreBar';
import { PairInspector } from './PairInspector';

interface PairingsViewProps {
  articles: Article[];
  pairingResult: PairingResult;
  activeGroup: DomainGroup | 'All';
  onChangeGroup: (group: DomainGroup | 'All') => void;
  metric: ScoringMetric;
  onChangeMetric: (metric: ScoringMetric) => void;
  pairsPerTranslated: number;
  onChangePairsPerTranslated: (count: number) => void;
  selectedPairId: string | null;
  onSelectPairId: (pairId: string) => void;
  onAddManualPair: (translatedId: string, untranslatedId: string) => void;
  onRemovePair: (translatedId: string, untranslatedId: string) => void;
  onFetchMoreControls: (translated: Article) => Promise<void>;
  onResetManualOverrides: () => void;
  hasManualOverrides: boolean;
  fetchingForId: string | null;
  onGoToImport: () => void;
}

type SortKey = 'distance' | 'year' | 'journal' | 'group';

export function PairingsView({
  articles,
  pairingResult,
  activeGroup,
  onChangeGroup,
  metric,
  onChangeMetric,
  pairsPerTranslated,
  onChangePairsPerTranslated,
  selectedPairId,
  onSelectPairId,
  onAddManualPair,
  onRemovePair,
  onFetchMoreControls,
  onResetManualOverrides,
  hasManualOverrides,
  fetchingForId,
  onGoToImport,
}: PairingsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('distance');
  const [sortAsc, setSortAsc] = useState(true);

  const articleMap = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const groupTranslatedCounts = useMemo(() => {
    const counts: Record<string, number> = { All: 0 };
    for (const g of DOMAIN_GROUPS) counts[g] = 0;
    for (const a of articles) {
      if (a.kind === 'translated') {
        counts.All++;
        counts[a.group] = (counts[a.group] ?? 0) + 1;
      }
    }
    return counts;
  }, [articles]);

  const filteredPairs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pairingResult.pairs
      .filter((p) => {
        if (activeGroup !== 'All' && p.group !== activeGroup) return false;
        if (!q) return true;
        const t = articleMap.get(p.translatedId);
        const u = articleMap.get(p.untranslatedId);
        const haystack = [
          p.journal,
          String(p.year),
          p.group,
          t?.doi,
          t?.title,
          u?.doi,
          u?.title,
          ...p.breakdown.sharedTerms,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'distance') cmp = a.breakdown.distance - b.breakdown.distance;
        else if (sortKey === 'year') cmp = a.year - b.year;
        else if (sortKey === 'journal') cmp = a.journal.localeCompare(b.journal);
        else cmp = a.group.localeCompare(b.group);
        return sortAsc ? cmp : -cmp;
      });
  }, [pairingResult.pairs, activeGroup, searchQuery, articleMap, sortKey, sortAsc]);

  const scopedTranslated = useMemo(
    () =>
      articles.filter(
        (a) => a.kind === 'translated' && (activeGroup === 'All' || a.group === activeGroup)
      ),
    [articles, activeGroup]
  );

  const scopedUnpaired = useMemo(() => {
    const unpairedSet = new Set(pairingResult.unpairedTranslatedIds);
    return scopedTranslated.filter((a) => unpairedSet.has(a.id));
  }, [scopedTranslated, pairingResult.unpairedTranslatedIds]);

  const pairedTranslatedCount = scopedTranslated.length - scopedUnpaired.length;

  const meanDistance = useMemo(() => {
    if (filteredPairs.length === 0) return null;
    const sum = filteredPairs.reduce((acc, p) => acc + p.breakdown.distance, 0);
    return sum / filteredPairs.length;
  }, [filteredPairs]);

  const sharedControlsCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of filteredPairs) {
      counts.set(p.untranslatedId, (counts.get(p.untranslatedId) ?? 0) + 1);
    }
    return Array.from(counts.values()).filter((c) => c > 1).length;
  }, [filteredPairs]);

  const activePair = useMemo(() => {
    if (filteredPairs.length === 0) return null;
    return filteredPairs.find((p) => p.id === selectedPairId) ?? filteredPairs[0];
  }, [filteredPairs, selectedPairId]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'distance' || key === 'journal' || key === 'group');
    }
  };

  return (
    <div className="space-y-6">
      {/* Calibration Summary Strip (single flat surface, hairline grid dividers) */}
      <section
        aria-label="Pairing coverage summary"
        className="bg-slate-200 border border-slate-200 rounded-lg overflow-hidden grid grid-cols-2 lg:grid-cols-4 gap-px"
      >
        <div className="bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Translated Coverage</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {pairedTranslatedCount}
            <span className="text-sm font-normal text-slate-400"> / {scopedTranslated.length}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {scopedTranslated.length === 0
              ? 'No translated DOIs loaded'
              : scopedUnpaired.length === 0
                ? '100% have ≥ 1 same-journal match'
                : `${scopedUnpaired.length} awaiting same-journal control`}
          </p>
        </div>

        <div className="bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Active Pairings</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {filteredPairs.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {sharedControlsCount > 0
              ? `${sharedControlsCount} untranslated shared across ≥ 2 pairs`
              : 'All paired controls currently unique'}
          </p>
        </div>

        <div className="bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Mean Overlap Distance</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {meanDistance !== null ? meanDistance.toFixed(3) : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">0.000 = perfect topic overlap</p>
        </div>

        <div className="bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Unpaired Alerts</p>
          <p
            className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
              scopedUnpaired.length > 0 ? 'text-rose-700' : 'text-emerald-700'
            }`}
          >
            {scopedUnpaired.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {scopedUnpaired.length === 0
              ? 'Coverage rule satisfied'
              : 'Requires same-journal, same-year DOI'}
          </p>
        </div>
      </section>

      {/* Unpaired Translated Alert (only visible when coverage invariant needs controls) */}
      {scopedUnpaired.length > 0 && (
        <section
          aria-label="Unpaired translated articles"
          className="bg-amber-50/70 border border-amber-200 rounded-lg p-4 space-y-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-amber-950">
                {scopedUnpaired.length} translated{' '}
                {scopedUnpaired.length === 1 ? 'article lacks' : 'articles lack'} an untranslated
                control in the same journal and year
              </h2>
              <p className="mt-0.5 text-xs text-amber-900/80">
                Each translated abstract requires at least 1 untranslated pairing from the exact same
                journal and publication year. Fetch candidates directly from OpenAlex or upload
                matching DOIs.
              </p>
            </div>
          </div>

          <ul className="divide-y divide-amber-200/70 border-t border-amber-200/70">
            {scopedUnpaired.map((art) => (
              <li
                key={art.id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{art.title}</p>
                  <p className="text-xs text-slate-600 font-mono">
                    {art.doi} · {art.journal} ({art.year}) · {art.group}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onFetchMoreControls(art)}
                  disabled={fetchingForId === art.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-950 bg-white border border-amber-300 rounded-md hover:bg-amber-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${fetchingForId === art.id ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>
                    {fetchingForId === art.id ? 'Querying OpenAlex…' : 'Find Controls (OpenAlex)'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Workspace Controls Bar */}
      <section
        aria-label="Pairing filters and scoring parameters"
        className="flex flex-col xl:flex-row xl:items-center justify-between gap-3"
      >
        {/* Domain Group Segmented Filter */}
        <div
          role="tablist"
          aria-label="Filter by domain group"
          className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg overflow-x-auto max-w-full"
        >
          {(['All', ...DOMAIN_GROUPS] as const).map((group) => {
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
                <span className="font-mono tabular-nums text-slate-400 ml-1">
                  {groupTranslatedCounts[group] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {/* Scoring Parameters & Search */}
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="whitespace-nowrap">Metric</span>
            <select
              aria-label="Topic overlap scoring metric"
              value={metric}
              onChange={(e) => onChangeMetric(e.target.value as ScoringMetric)}
              className="h-9 px-2.5 text-xs font-medium text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="hybrid">Hybrid Cosine</option>
              <option value="jsd">Jensen-Shannon</option>
              <option value="jaccard">Jaccard Distance</option>
            </select>
          </label>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="whitespace-nowrap">Pairs</span>
            <select
              aria-label="Pairs per translated article"
              value={pairsPerTranslated}
              onChange={(e) => onChangePairsPerTranslated(Number(e.target.value))}
              className="h-9 px-2 text-xs font-mono font-medium text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value={1}>1 / article</option>
              <option value={2}>Up to 2</option>
              <option value={3}>Up to 3</option>
              <option value={4}>Up to 4</option>
            </select>
          </label>

          {hasManualOverrides && (
            <button
              type="button"
              onClick={onResetManualOverrides}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Reset Manual
            </button>
          )}

          <div className="relative flex-1 sm:flex-initial sm:w-52">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search pairings by DOI, title, journal, or topic"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter DOI, journal, topic…"
              className="w-full h-9 pl-8 pr-3 text-xs text-slate-900 bg-white border border-slate-200 rounded-md placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      </section>

      {/* Main Split Stage: Pairings Table + Side-by-Side Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          {filteredPairs.length === 0 ? (
            <div className="p-10 text-center">
              <h2 className="text-base font-semibold text-slate-900">No matching pairings</h2>
              <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
                {articles.length === 0
                  ? 'Upload a CSV or paste DOIs grouped by Biodiversity, Climate Change, or Infectious Diseases to begin pairing.'
                  : 'No pairings match your active group filter or search query.'}
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                  >
                    Clear search
                  </button>
                )}
                <button
                  type="button"
                  onClick={onGoToImport}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800"
                >
                  Import DOIs
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                    <th className="py-3 pl-4 pr-3">Translated Abstract</th>
                    <th className="py-3 px-3">Untranslated Match</th>
                    <th className="py-3 px-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('journal')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>Journal / Year</span>
                        <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </th>
                    <th className="py-3 pl-3 pr-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort('distance')}
                        className="inline-flex items-center gap-1 hover:text-slate-900"
                      >
                        <span>Overlap Dist.</span>
                        <ArrowUpDown className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredPairs.map((pair) => {
                    const t = articleMap.get(pair.translatedId);
                    const u = articleMap.get(pair.untranslatedId);
                    const reuseCount = pairingResult.untranslatedReuseCount[pair.untranslatedId] ?? 1;
                    const isSelected = activePair?.id === pair.id;

                    return (
                      <tr
                        key={pair.id}
                        className={`transition-colors ${
                          isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50/80'
                        }`}
                      >
                        <td className="py-3.5 pl-4 pr-3 align-top max-w-[260px]">
                          <button
                            type="button"
                            onClick={() => onSelectPairId(pair.id)}
                            className="text-left w-full group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                          >
                            <p className="text-xs font-medium text-slate-500">
                              <span>{pair.group}</span>
                              {t?.originalLanguage && (
                                <>
                                  <span className="mx-1" aria-hidden="true">·</span>
                                  <span>{t.originalLanguage}</span>
                                </>
                              )}
                            </p>
                            <p className="mt-0.5 text-sm font-medium text-slate-900 group-hover:text-blue-700 line-clamp-2 leading-snug">
                              {t?.title ?? pair.translatedId}
                            </p>
                            <p className="mt-1 font-mono text-xs text-slate-500 truncate">
                              {t?.doi}
                            </p>
                          </button>
                        </td>

                        <td className="py-3.5 px-3 align-top max-w-[240px]">
                          <button
                            type="button"
                            onClick={() => onSelectPairId(pair.id)}
                            className="text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                          >
                            <p className="text-xs text-slate-500">
                              <span>Match #{pair.rank}</span>
                              {pair.isManual && (
                                <>
                                  <span className="mx-1" aria-hidden="true">·</span>
                                  <span className="text-blue-700 font-medium">Manual</span>
                                </>
                              )}
                              {reuseCount > 1 && (
                                <>
                                  <span className="mx-1" aria-hidden="true">·</span>
                                  <span className="font-mono text-slate-700">
                                    Shared ×{reuseCount}
                                  </span>
                                </>
                              )}
                            </p>
                            <p className="mt-0.5 text-sm text-slate-800 line-clamp-2 leading-snug">
                              {u?.title ?? pair.untranslatedId}
                            </p>
                            <p className="mt-1 font-mono text-xs text-slate-500 truncate">
                              {u?.doi}
                            </p>
                          </button>
                        </td>

                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <p className="text-xs font-medium text-slate-800 max-w-[160px] truncate" title={pair.journal}>
                            {pair.journal}
                          </p>
                          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">
                            {pair.year}
                          </p>
                        </td>

                        <td className="py-3.5 pl-3 pr-4 align-top">
                          <ScoreBar distance={pair.breakdown.distance} compact />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="xl:col-span-5 xl:sticky xl:top-20">
          <PairInspector
            pair={activePair}
            translated={activePair ? (articleMap.get(activePair.translatedId) ?? null) : null}
            untranslated={activePair ? (articleMap.get(activePair.untranslatedId) ?? null) : null}
            allArticles={articles}
            allPairs={pairingResult.pairs}
            metric={metric}
            onAddManualPair={onAddManualPair}
            onRemovePair={onRemovePair}
            onFetchMoreControls={onFetchMoreControls}
            fetchingForId={fetchingForId}
          />
        </div>
      </div>
    </div>
  );
}
