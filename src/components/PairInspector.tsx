import { useMemo } from 'react';
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { Article, ArticlePair, ScoringMetric } from '../types';
import { getRankedCandidatesForTranslated } from '../lib/pairing';
import { ScoreBar } from './ScoreBar';

interface PairInspectorProps {
  pair: ArticlePair | null;
  translated: Article | null;
  untranslated: Article | null;
  allArticles: Article[];
  allPairs: ArticlePair[];
  metric: ScoringMetric;
  onAddManualPair: (translatedId: string, untranslatedId: string) => void;
  onRemovePair: (translatedId: string, untranslatedId: string) => void;
  onFetchMoreControls: (translated: Article) => Promise<void>;
  fetchingForId: string | null;
}

/**
 * Highlights shared topic terms inside an abstract without injecting raw HTML.
 */
function HighlightedAbstract({ text, sharedTerms }: { text: string; sharedTerms: string[] }) {
  const segments = useMemo(() => {
    if (!text) return [{ text: 'No abstract text available for this DOI.', match: false }];

    // Build stem-safe regex patterns from single words and phrases in sharedTerms
    const keywords = Array.from(
      new Set(
        sharedTerms
          .flatMap((t) => [t, ...t.split(/\s+/)])
          .map((w) => w.trim().toLowerCase())
          .filter((w) => w.length >= 4)
      )
    ).sort((a, b) => b.length - a.length);

    if (keywords.length === 0) {
      return [{ text, match: false }];
    }

    const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`\\b(${escaped.join('|')}[a-z]*)\\b`, 'gi');

    const result: Array<{ text: string; match: boolean }> = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(text)) !== null) {
      if (m.index > lastIndex) {
        result.push({ text: text.slice(lastIndex, m.index), match: false });
      }
      result.push({ text: m[0], match: true });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      result.push({ text: text.slice(lastIndex), match: false });
    }
    return result;
  }, [text, sharedTerms]);

  return (
    <p className="text-sm leading-relaxed text-slate-700">
      {segments.map((seg, idx) =>
        seg.match ? (
          <mark
            key={idx}
            className="bg-blue-50 text-blue-950 font-medium px-0.5 rounded-sm underline decoration-blue-300 underline-offset-2"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={idx}>{seg.text}</span>
        )
      )}
    </p>
  );
}

export function PairInspector({
  pair,
  translated,
  untranslated,
  allArticles,
  allPairs,
  metric,
  onAddManualPair,
  onRemovePair,
  onFetchMoreControls,
  fetchingForId,
}: PairInspectorProps) {
  const candidates = useMemo(() => {
    if (!translated) return [];
    return getRankedCandidatesForTranslated(translated, allArticles, metric);
  }, [translated, allArticles, metric]);

  const pairsForThisTranslated = useMemo(() => {
    if (!translated) return [];
    return allPairs.filter((p) => p.translatedId === translated.id);
  }, [translated, allPairs]);

  const pairedUntranslatedIds = useMemo(
    () => new Set(pairsForThisTranslated.map((p) => p.untranslatedId)),
    [pairsForThisTranslated]
  );

  if (!pair || !translated || !untranslated) {
    return (
      <aside className="bg-white border border-slate-200 rounded-lg p-6 text-center">
        <h2 className="text-base font-semibold text-slate-900">Pair Inspector</h2>
        <p className="mt-2 text-sm text-slate-500">
          Select any pairing row to compare abstracts side by side, inspect shared topic overlap terms, and manage same-journal controls.
        </p>
      </aside>
    );
  }

  const canRemoveCurrent = pairsForThisTranslated.length > 1;
  const isFetching = fetchingForId === translated.id;

  return (
    <aside
      aria-label="Selected pairing details"
      className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200"
    >
      {/* Header & Score Calibration */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">
              <span>{pair.group}</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>{pair.journal}</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{pair.year}</span>
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-900">
              Topic Overlap Calibration
            </h2>
          </div>

          <div className="text-right shrink-0">
            <span className="block text-xs text-slate-500">Overlap Distance</span>
            <span className="font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {pair.breakdown.distance.toFixed(3)}
            </span>
          </div>
        </div>

        <div className="mt-3">
          <ScoreBar distance={pair.breakdown.distance} showNumeric={false} />
          <p className="mt-1.5 text-xs text-slate-500">
            Scale: <span className="font-mono text-slate-700">0.000</span> = perfect topic overlap ·{' '}
            <span className="font-mono text-slate-700">1.000</span> = no shared topics
          </p>
        </div>

        {/* Sub-metric breakdown */}
        <dl className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <dt className="text-slate-500">Hybrid Cosine</dt>
            <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900">
              {pair.breakdown.hybridDistance.toFixed(3)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Lexical TF-IDF</dt>
            <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900">
              {pair.breakdown.lexicalDistance.toFixed(3)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Jensen-Shannon</dt>
            <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900">
              {pair.breakdown.jsdDistance.toFixed(3)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Jaccard</dt>
            <dd className="mt-0.5 font-mono font-medium tabular-nums text-slate-900">
              {pair.breakdown.jaccardDistance.toFixed(3)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Shared & Distinctive Topic Terms */}
      <div className="p-5 space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-slate-700">
            Shared Topic Terms ({pair.breakdown.sharedTerms.length})
          </h3>
          {pair.breakdown.sharedTerms.length > 0 ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-700">
              {pair.breakdown.sharedTerms.join(' · ')}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">No overlapping topic terms detected.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 text-xs">
          <div>
            <span className="font-medium text-slate-600">Unique to Translated</span>
            <p className="mt-0.5 text-slate-500">
              {pair.breakdown.translatedOnlyTerms.length > 0
                ? pair.breakdown.translatedOnlyTerms.join(' · ')
                : 'None'}
            </p>
          </div>
          <div>
            <span className="font-medium text-slate-600">Unique to Untranslated</span>
            <p className="mt-0.5 text-slate-500">
              {pair.breakdown.untranslatedOnlyTerms.length > 0
                ? pair.breakdown.untranslatedOnlyTerms.join(' · ')
                : 'None'}
            </p>
          </div>
        </div>
      </div>

      {/* Translated Abstract */}
      <div className="p-5 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-800">
            Translated Abstract
            {translated.originalLanguage ? ` (from ${translated.originalLanguage})` : ''}
          </span>
          <a
            href={`https://doi.org/${translated.doi}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline"
          >
            <span>{translated.doi}</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        </div>
        <h3 className="text-sm font-semibold text-slate-900 leading-snug">{translated.title}</h3>
        <HighlightedAbstract text={translated.abstract} sharedTerms={pair.breakdown.sharedTerms} />
      </div>

      {/* Untranslated Control Abstract */}
      <div className="p-5 space-y-2 bg-slate-50/60">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-800">Untranslated Control Abstract</span>
          <a
            href={`https://doi.org/${untranslated.doi}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline"
          >
            <span>{untranslated.doi}</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        </div>
        <h3 className="text-sm font-semibold text-slate-900 leading-snug">{untranslated.title}</h3>
        <HighlightedAbstract text={untranslated.abstract} sharedTerms={pair.breakdown.sharedTerms} />

        <div className="pt-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-500">
            {canRemoveCurrent
              ? `This translated article has ${pairsForThisTranslated.length} active pairings.`
              : 'Minimum 1 pairing required per translated article.'}
          </span>
          {canRemoveCurrent && (
            <button
              type="button"
              onClick={() => onRemovePair(translated.id, untranslated.id)}
              className="inline-flex items-center gap-1 text-rose-700 hover:text-rose-800 font-medium whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Remove pairing</span>
            </button>
          )}
        </div>
      </div>

      {/* Same-Journal, Same-Year Candidate Controls */}
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-slate-800">
              Same-Journal, Same-Year Controls ({candidates.length})
            </h3>
            <p className="text-xs text-slate-500">
              {translated.journal} · {translated.year}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onFetchMoreControls(translated)}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isFetching ? 'Fetching…' : 'Find via OpenAlex'}</span>
          </button>
        </div>

        <ul className="mt-3 divide-y divide-slate-100">
          {candidates.map(({ untranslated: cand, breakdown }) => {
            const isPaired = pairedUntranslatedIds.has(cand.id);
            return (
              <li key={cand.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-900 truncate">{cand.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
                    {cand.doi} · dist {breakdown.distance.toFixed(3)}
                  </p>
                </div>
                {isPaired ? (
                  <span className="text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0">
                    Paired
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAddManualPair(translated.id, cand.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200 rounded hover:bg-blue-50 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Add pair</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
