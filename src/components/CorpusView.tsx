import { useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { Article, ArticleKind, DomainGroup, PairingResult } from '../types';
import { DOMAIN_GROUPS } from '../types';

interface CorpusViewProps {
  articles: Article[];
  pairingResult: PairingResult;
  onToggleKind: (articleId: string) => void;
  onChangeGroup: (articleId: string, group: DomainGroup) => void;
  onDeleteArticle: (articleId: string) => void;
  onFetchMoreControls: (translated: Article) => Promise<void>;
  onResetToSeed: () => void;
  onClearCorpus: () => void;
  fetchingForId: string | null;
  onGoToImport: () => void;
}

export function CorpusView({
  articles,
  pairingResult,
  onToggleKind,
  onChangeGroup,
  onDeleteArticle,
  onFetchMoreControls,
  onResetToSeed,
  onClearCorpus,
  fetchingForId,
  onGoToImport,
}: CorpusViewProps) {
  const [groupFilter, setGroupFilter] = useState<DomainGroup | 'All'>('All');
  const [kindFilter, setKindFilter] = useState<ArticleKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const pairCountByArticle = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pairingResult.pairs) {
      counts.set(p.translatedId, (counts.get(p.translatedId) ?? 0) + 1);
      counts.set(p.untranslatedId, (counts.get(p.untranslatedId) ?? 0) + 1);
    }
    return counts;
  }, [pairingResult.pairs]);

  const unpairedSet = useMemo(
    () => new Set(pairingResult.unpairedTranslatedIds),
    [pairingResult.unpairedTranslatedIds]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (groupFilter !== 'All' && a.group !== groupFilter) return false;
      if (kindFilter !== 'all' && a.kind !== kindFilter) return false;
      if (!q) return true;
      return `${a.doi} ${a.title} ${a.journal} ${a.year} ${a.group}`.toLowerCase().includes(q);
    });
  }, [articles, groupFilter, kindFilter, query]);

  const translatedTotal = articles.filter((a) => a.kind === 'translated').length;
  const untranslatedTotal = articles.filter((a) => a.kind === 'untranslated').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">DOI Corpus Inventory</h1>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-mono tabular-nums text-slate-900">{articles.length}</span> total articles ·{' '}
            <span className="font-mono tabular-nums text-slate-900">{translatedTotal}</span> translated ·{' '}
            <span className="font-mono tabular-nums text-slate-900">{untranslatedTotal}</span> untranslated controls
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onResetToSeed}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Load Sample Study</span>
          </button>

          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={articles.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-700 bg-white border border-slate-200 rounded-md hover:bg-rose-50 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear Corpus</span>
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-md text-xs">
              <span className="text-rose-900 font-medium">Remove all {articles.length} DOIs?</span>
              <button
                type="button"
                onClick={() => {
                  onClearCorpus();
                  setConfirmClear(false);
                }}
                className="font-semibold text-rose-700 hover:underline"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="text-slate-600 hover:underline"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            aria-label="Filter corpus by domain group"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg overflow-x-auto max-w-full"
          >
            {(['All', ...DOMAIN_GROUPS] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={groupFilter === g}
                onClick={() => setGroupFilter(g)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                  groupFilter === g ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {g === 'All' ? 'All Groups' : g}
              </button>
            ))}
          </div>

          <div
            role="tablist"
            aria-label="Filter corpus by abstract role"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg"
          >
            {(
              [
                { id: 'all', label: 'All Roles' },
                { id: 'translated', label: 'Translated' },
                { id: 'untranslated', label: 'Untranslated' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={kindFilter === opt.id}
                onClick={() => setKindFilter(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                  kindFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative sm:w-64">
          <Search
            className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search corpus DOIs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search DOI, title, journal…"
            className="w-full h-9 pl-8 pr-3 text-xs bg-white border border-slate-200 rounded-md placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <h2 className="text-base font-semibold text-slate-900">No articles in view</h2>
            <p className="mt-1 text-sm text-slate-500">
              {articles.length === 0
                ? 'Import DOIs or load the sample study to populate your corpus.'
                : 'Try adjusting your domain group, role, or search filters.'}
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
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                  <th className="py-3 pl-4 pr-3">Article & DOI</th>
                  <th className="py-3 px-3 whitespace-nowrap">Domain Group</th>
                  <th className="py-3 px-3 whitespace-nowrap">Abstract Role</th>
                  <th className="py-3 px-3 whitespace-nowrap">Journal / Year</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Pairings</th>
                  <th className="py-3 pl-3 pr-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((art) => {
                  const pairCount = pairCountByArticle.get(art.id) ?? 0;
                  const isUnpairedTranslated = art.kind === 'translated' && unpairedSet.has(art.id);

                  return (
                    <tr key={art.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 pl-4 pr-3 align-top max-w-[380px]">
                        <p className="text-sm font-medium text-slate-900 leading-snug line-clamp-2">
                          {art.title}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">
                          {art.doi}
                          {art.originalLanguage ? ` · from ${art.originalLanguage}` : ''}
                        </p>
                      </td>

                      <td className="py-3.5 px-3 align-top whitespace-nowrap">
                        <select
                          aria-label={`Change domain group for ${art.doi}`}
                          value={art.group}
                          onChange={(e) => onChangeGroup(art.id, e.target.value as DomainGroup)}
                          className="h-8 px-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          {DOMAIN_GROUPS.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="py-3.5 px-3 align-top whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onToggleKind(art.id)}
                          aria-label={`Switch role for ${art.doi} (currently ${art.kind})`}
                          className="text-xs font-medium text-slate-800 underline decoration-slate-300 underline-offset-4 hover:text-blue-700 hover:decoration-blue-500"
                        >
                          {art.kind === 'translated' ? 'Translated' : 'Untranslated'}
                        </button>
                      </td>

                      <td className="py-3.5 px-3 align-top whitespace-nowrap">
                        <p className="text-xs font-medium text-slate-800 max-w-[180px] truncate" title={art.journal}>
                          {art.journal}
                        </p>
                        <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">
                          {art.year}
                        </p>
                      </td>

                      <td className="py-3.5 px-3 align-top text-right whitespace-nowrap">
                        {isUnpairedTranslated ? (
                          <span className="text-xs font-medium text-rose-700">Unpaired (0)</span>
                        ) : (
                          <span className="font-mono text-xs tabular-nums text-slate-800">
                            {pairCount}{' '}
                            <span className="font-sans text-slate-500">
                              {art.kind === 'untranslated' && pairCount > 1 ? '(shared)' : ''}
                            </span>
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 pl-3 pr-4 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-3">
                          {isUnpairedTranslated && (
                            <button
                              type="button"
                              onClick={() => onFetchMoreControls(art)}
                              disabled={fetchingForId === art.id}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline disabled:opacity-50"
                            >
                              <RefreshCw
                                className={`w-3 h-3 ${fetchingForId === art.id ? 'animate-spin' : ''}`}
                                aria-hidden="true"
                              />
                              <span>Find controls</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteArticle(art.id)}
                            aria-label={`Remove ${art.doi}`}
                            className="text-xs font-medium text-slate-500 hover:text-rose-700"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
