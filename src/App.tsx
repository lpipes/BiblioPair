import { useEffect, useMemo, useState } from 'react';
import type { Article, DomainGroup, ScoringMetric } from './types';
import { SEED_ARTICLES } from './data/seedData';
import { generatePairings, type ManualPairLink } from './lib/pairing';
import { normalizeDoi } from './lib/doi';
import { fetchSameJournalYearControls } from './lib/openalex';
import {
  buildAllMatricesLongCsv,
  buildPairingsCsv,
  triggerFileDownload,
} from './lib/export';
import { buildStratumDistanceMatrices } from './lib/matrix';
import { TopBar, type ActiveTab } from './components/TopBar';
import { PairingsView } from './components/PairingsView';
import { MatricesView } from './components/MatricesView';
import { CorpusView } from './components/CorpusView';
import { ImportView } from './components/ImportView';
import { AnalyticsView } from './components/AnalyticsView';

const STORAGE_KEY = 'bibliopair_state_v1';

interface PersistedState {
  articles: Article[];
  metric: ScoringMetric;
  pairsPerTranslated: number;
  manualLinks: ManualPairLink[];
  excludedPairKeys: string[];
}

function loadInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (Array.isArray(parsed.articles)) {
        return {
          articles: parsed.articles,
          metric: parsed.metric ?? 'hybrid',
          pairsPerTranslated: parsed.pairsPerTranslated ?? 1,
          manualLinks: Array.isArray(parsed.manualLinks) ? parsed.manualLinks : [],
          excludedPairKeys: Array.isArray(parsed.excludedPairKeys) ? parsed.excludedPairKeys : [],
        };
      }
    }
  } catch {
    // Ignore storage read failures
  }
  return {
    articles: SEED_ARTICLES,
    metric: 'hybrid',
    pairsPerTranslated: 1,
    manualLinks: [],
    excludedPairKeys: [],
  };
}

export default function App() {
  const initial = useMemo(() => loadInitialState(), []);

  const [activeTab, setActiveTab] = useState<ActiveTab>('pairings');
  const [articles, setArticles] = useState<Article[]>(initial.articles);
  const [activeGroup, setActiveGroup] = useState<DomainGroup | 'All'>('All');
  const [metric, setMetric] = useState<ScoringMetric>(initial.metric);
  const [pairsPerTranslated, setPairsPerTranslated] = useState<number>(initial.pairsPerTranslated);
  const [manualLinks, setManualLinks] = useState<ManualPairLink[]>(initial.manualLinks);
  const [excludedPairKeys, setExcludedPairKeys] = useState<string[]>(initial.excludedPairKeys);
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [fetchingForId, setFetchingForId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab]);

  useEffect(() => {
    try {
      const state: PersistedState = {
        articles,
        metric,
        pairsPerTranslated,
        manualLinks,
        excludedPairKeys,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }, [articles, metric, pairsPerTranslated, manualLinks, excludedPairKeys]);

  const pairingResult = useMemo(() => {
    return generatePairings(articles, {
      pairsPerTranslated,
      metric,
      manualLinks,
      excludedPairKeys: new Set(excludedPairKeys),
    });
  }, [articles, pairsPerTranslated, metric, manualLinks, excludedPairKeys]);

  const handleImportArticles = (incoming: Article[]) => {
    setArticles((prev) => {
      const existingDois = new Set(prev.map((a) => normalizeDoi(a.doi)));
      const uniqueIncoming = incoming.filter((a) => !existingDois.has(normalizeDoi(a.doi)));
      return [...uniqueIncoming, ...prev];
    });
  };

  const handleAddManualPair = (translatedId: string, untranslatedId: string) => {
    const key = `${translatedId}::${untranslatedId}`;
    setExcludedPairKeys((prev) => prev.filter((k) => k !== key));
    setManualLinks((prev) => {
      if (prev.some((l) => l.translatedId === translatedId && l.untranslatedId === untranslatedId)) {
        return prev;
      }
      return [...prev, { translatedId, untranslatedId }];
    });
    setSelectedPairId(key);
  };

  const handleRemovePair = (translatedId: string, untranslatedId: string) => {
    const key = `${translatedId}::${untranslatedId}`;
    const remainingForTranslated = pairingResult.pairs.filter(
      (p) => p.translatedId === translatedId && p.untranslatedId !== untranslatedId
    );
    if (remainingForTranslated.length === 0) {
      setNotice({
        tone: 'error',
        text: 'Each translated abstract must retain at least 1 same-journal, same-year pairing.',
      });
      return;
    }

    setManualLinks((prev) =>
      prev.filter((l) => !(l.translatedId === translatedId && l.untranslatedId === untranslatedId))
    );
    setExcludedPairKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    if (selectedPairId === key) {
      setSelectedPairId(remainingForTranslated[0]?.id ?? null);
    }
  };

  const handleFetchMoreControls = async (translated: Article) => {
    setFetchingForId(translated.id);
    setNotice(null);
    const excludeDois = new Set(articles.map((a) => normalizeDoi(a.doi)));
    const result = await fetchSameJournalYearControls(translated, excludeDois, 8);
    setFetchingForId(null);

    if (result.error) {
      setNotice({ tone: 'error', text: result.error });
      return;
    }
    if (result.articles.length === 0) {
      setNotice({
        tone: 'info',
        text: `No additional OpenAlex untranslated articles with abstracts were found for ${translated.journal} (${translated.year}).`,
      });
      return;
    }

    handleImportArticles(result.articles);
    setNotice({
      tone: 'info',
      text: `Added ${result.articles.length} untranslated control article${
        result.articles.length === 1 ? '' : 's'
      } from ${translated.journal} (${translated.year}) via OpenAlex.`,
    });
  };

  const handleToggleKind = (articleId: string) => {
    setArticles((prev) =>
      prev.map((a) =>
        a.id === articleId
          ? { ...a, kind: a.kind === 'translated' ? 'untranslated' : 'translated' }
          : a
      )
    );
  };

  const handleChangeArticleGroup = (articleId: string, group: DomainGroup) => {
    setArticles((prev) => prev.map((a) => (a.id === articleId ? { ...a, group } : a)));
  };

  const handleDeleteArticle = (articleId: string) => {
    setArticles((prev) => prev.filter((a) => a.id !== articleId));
    setManualLinks((prev) =>
      prev.filter((l) => l.translatedId !== articleId && l.untranslatedId !== articleId)
    );
  };

  const handleResetManualOverrides = () => {
    setManualLinks([]);
    setExcludedPairKeys([]);
  };

  const handleResetToSeed = () => {
    setArticles(SEED_ARTICLES);
    setManualLinks([]);
    setExcludedPairKeys([]);
    setSelectedPairId(null);
    setNotice({ tone: 'info', text: 'Loaded the 24-article sample study across all three domain groups.' });
  };

  const handleClearCorpus = () => {
    setArticles([]);
    setManualLinks([]);
    setExcludedPairKeys([]);
    setSelectedPairId(null);
  };

  const handleExportCsv = () => {
    const suffix = activeGroup === 'All' ? 'all-groups' : activeGroup.toLowerCase().replace(/\s+/g, '-');
    if (activeTab === 'matrices') {
      const matrices = buildStratumDistanceMatrices(articles, metric, pairingResult.pairs).filter(
        (m) => activeGroup === 'All' || m.groups.includes(activeGroup)
      );
      const csv = buildAllMatricesLongCsv(matrices);
      triggerFileDownload(`pairwise-distance-matrices-${suffix}.csv`, csv, 'text/csv;charset=utf-8');
      return;
    }
    const scoped =
      activeGroup === 'All'
        ? pairingResult.pairs
        : pairingResult.pairs.filter((p) => p.group === activeGroup);
    const csv = buildPairingsCsv(scoped, articles);
    triggerFileDownload(`bibliopair-scores-${suffix}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onExportCsv={handleExportCsv}
        canExport={pairingResult.pairs.length > 0}
      />

      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
        {notice && (
          <div
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`mb-5 px-4 py-2.5 rounded-md border text-xs flex items-center justify-between gap-4 ${
              notice.tone === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="font-medium underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeTab === 'pairings' && (
          <PairingsView
            articles={articles}
            pairingResult={pairingResult}
            activeGroup={activeGroup}
            onChangeGroup={setActiveGroup}
            metric={metric}
            onChangeMetric={setMetric}
            pairsPerTranslated={pairsPerTranslated}
            onChangePairsPerTranslated={setPairsPerTranslated}
            selectedPairId={selectedPairId}
            onSelectPairId={setSelectedPairId}
            onAddManualPair={handleAddManualPair}
            onRemovePair={handleRemovePair}
            onFetchMoreControls={handleFetchMoreControls}
            onResetManualOverrides={handleResetManualOverrides}
            hasManualOverrides={manualLinks.length > 0 || excludedPairKeys.length > 0}
            fetchingForId={fetchingForId}
            onGoToImport={() => setActiveTab('import')}
          />
        )}

        {activeTab === 'matrices' && (
          <MatricesView
            articles={articles}
            activePairs={pairingResult.pairs}
            activeGroup={activeGroup}
            onChangeGroup={setActiveGroup}
            metric={metric}
            onChangeMetric={setMetric}
            onGoToImport={() => setActiveTab('import')}
          />
        )}

        {activeTab === 'corpus' && (
          <CorpusView
            articles={articles}
            pairingResult={pairingResult}
            onToggleKind={handleToggleKind}
            onChangeGroup={handleChangeArticleGroup}
            onDeleteArticle={handleDeleteArticle}
            onFetchMoreControls={handleFetchMoreControls}
            onResetToSeed={handleResetToSeed}
            onClearCorpus={handleClearCorpus}
            fetchingForId={fetchingForId}
            onGoToImport={() => setActiveTab('import')}
          />
        )}

        {activeTab === 'import' && (
          <ImportView
            existingArticles={articles}
            onImportArticles={handleImportArticles}
            onGoToPairings={() => setActiveTab('pairings')}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsView articles={articles} pairingResult={pairingResult} />
        )}
      </main>
    </div>
  );
}
