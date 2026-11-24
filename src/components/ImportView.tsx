import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileUp, Loader2, Plus, Upload } from 'lucide-react';
import type { Article, ArticleKind, DomainGroup } from '../types';
import { DOMAIN_GROUPS } from '../types';
import {
  isValidDoi,
  normalizeDoi,
  parseDoiList,
  parseStructuredDoiFile,
  type ParsedCsvRow,
} from '../lib/doi';
import { fetchArticleByDoi, fetchSameJournalYearControls } from '../lib/openalex';
import { buildTemplateCsv, triggerFileDownload } from '../lib/export';

interface ImportViewProps {
  existingArticles: Article[];
  onImportArticles: (articles: Article[]) => void;
  onGoToPairings: () => void;
}

export function ImportView({ existingArticles, onImportArticles, onGoToPairings }: ImportViewProps) {
  // Tab inside left panel: live DOI lookup vs direct manual article input
  const [inputMode, setInputMode] = useState<'doi-batch' | 'manual'>('doi-batch');

  // Batch DOI paste state
  const [doiText, setDoiText] = useState('');
  const [batchGroup, setBatchGroup] = useState<DomainGroup>('Biodiversity');
  const [batchKind, setBatchKind] = useState<ArticleKind>('translated');
  const [batchOrigLang, setBatchOrigLang] = useState('');
  const [autoFetchControls, setAutoFetchControls] = useState(true);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [isFetchingBatch, setIsFetchingBatch] = useState(false);

  // Manual entry state
  const [mDoi, setMDoi] = useState('');
  const [mGroup, setMGroup] = useState<DomainGroup>('Biodiversity');
  const [mKind, setMKind] = useState<ArticleKind>('translated');
  const [mJournal, setMJournal] = useState('Conservation Biology');
  const [mYear, setMYear] = useState('2023');
  const [mOrigLang, setMOrigLang] = useState('');
  const [mTitle, setMTitle] = useState('');
  const [mAbstract, setMAbstract] = useState('');
  const [mTopics, setMTopics] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);

  // CSV / TSV upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvDefaultGroup, setCsvDefaultGroup] = useState<DomainGroup>('Biodiversity');
  const [csvDefaultKind, setCsvDefaultKind] = useState<ArticleKind>('translated');
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<ParsedCsvRow[]>([]);
  const [csvSkipped, setCsvSkipped] = useState(0);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvStatus, setCsvStatus] = useState<string | null>(null);
  const [resolveMissingViaOpenAlex, setResolveMissingViaOpenAlex] = useState(true);
  const [isImportingCsv, setIsImportingCsv] = useState(false);

  const handleBatchDoiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchError(null);
    setBatchStatus(null);

    const trimmed = doiText.trim();
    if (!trimmed) {
      setBatchError('Please paste at least one DOI (for example, 10.1111/cobi.14012).');
      return;
    }

    const { valid, invalid } = parseDoiList(trimmed);
    if (valid.length === 0) {
      setBatchError(
        `No valid DOIs detected. Standard DOIs start with "10." followed by a registrant code and slash (invalid entries: ${invalid.slice(0, 3).join(', ')}).`
      );
      return;
    }

    setIsFetchingBatch(true);
    const existingDois = new Set(existingArticles.map((a) => normalizeDoi(a.doi)));
    const imported: Article[] = [];
    const failed: string[] = [];
    let skippedExisting = 0;

    for (let i = 0; i < valid.length; i++) {
      const doi = valid[i];
      if (existingDois.has(doi)) {
        skippedExisting++;
        continue;
      }
      setBatchStatus(`Resolving DOI ${i + 1} of ${valid.length} (${doi})…`);
      const res = await fetchArticleByDoi(doi, batchGroup, batchKind);
      if (res.article) {
        if (batchKind === 'translated' && batchOrigLang.trim()) {
          res.article.originalLanguage = batchOrigLang.trim();
        }
        imported.push(res.article);
        existingDois.add(doi);
      } else {
        failed.push(doi);
      }
    }

    // Optionally discover same-journal, same-year untranslated controls from OpenAlex
    let controlsDiscovered = 0;
    if (autoFetchControls && batchKind === 'translated' && imported.length > 0) {
      for (const art of imported) {
        setBatchStatus(`Searching OpenAlex for ${art.journal} (${art.year}) untranslated controls…`);
        const ctrlRes = await fetchSameJournalYearControls(art, existingDois, 6);
        for (const ctrl of ctrlRes.articles) {
          imported.push(ctrl);
          existingDois.add(normalizeDoi(ctrl.doi));
          controlsDiscovered++;
        }
      }
    }

    if (imported.length > 0) {
      onImportArticles(imported);
      setDoiText('');
    }

    setIsFetchingBatch(false);

    const parts: string[] = [];
    if (imported.length > 0) {
      const primaryAdded = imported.length - controlsDiscovered;
      parts.push(`Imported ${primaryAdded} DOI${primaryAdded === 1 ? '' : 's'}`);
      if (controlsDiscovered > 0) {
        parts.push(`auto-fetched ${controlsDiscovered} same-journal, same-year control${controlsDiscovered === 1 ? '' : 's'}`);
      }
    }
    if (skippedExisting > 0) parts.push(`${skippedExisting} already in corpus`);
    if (invalid.length > 0) parts.push(`${invalid.length} malformed skipped`);
    if (failed.length > 0) parts.push(`${failed.length} unresolved (${failed.slice(0, 2).join(', ')})`);

    if (imported.length === 0 && failed.length > 0) {
      setBatchError(`Could not resolve ${failed.join(', ')} via OpenAlex or Crossref. You can add it via Manual Entry.`);
      setBatchStatus(null);
    } else {
      setBatchStatus(parts.join(' · ') + '.');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);
    setManualSuccess(null);

    const normDoi = normalizeDoi(mDoi);
    if (!normDoi || !isValidDoi(normDoi)) {
      setManualError('Enter a valid DOI starting with 10.XXXX/… (e.g., 10.1111/cobi.14999).');
      return;
    }
    if (!mTitle.trim()) {
      setManualError('Article title is required.');
      return;
    }
    if (!mJournal.trim()) {
      setManualError('Journal name is required for same-journal pairing.');
      return;
    }
    const parsedYear = Number.parseInt(mYear, 10);
    if (Number.isNaN(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
      setManualError('Enter a valid 4-digit publication year.');
      return;
    }
    if (mAbstract.trim().length < 20) {
      setManualError('Please provide an abstract (at least 20 characters) for topic overlap scoring.');
      return;
    }
    if (existingArticles.some((a) => normalizeDoi(a.doi) === normDoi)) {
      setManualError(`DOI ${normDoi} is already present in your corpus.`);
      return;
    }

    const parsedTopics = mTopics
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((name) => ({ name, score: 0.9 }));

    const newArticle: Article = {
      id: `manual-${normDoi}-${Date.now()}`,
      doi: normDoi,
      title: mTitle.trim(),
      abstract: mAbstract.trim(),
      journal: mJournal.trim(),
      year: parsedYear,
      group: mGroup,
      kind: mKind,
      language: 'en',
      originalLanguage: mKind === 'translated' && mOrigLang.trim() ? mOrigLang.trim() : undefined,
      topics: parsedTopics,
      source: 'manual',
    };

    onImportArticles([newArticle]);
    setManualSuccess(
      `Added ${mKind} article ${normDoi} (${mJournal.trim()}, ${parsedYear}) under ${mGroup}.`
    );
    setMDoi('');
    setMTitle('');
    setMAbstract('');
    setMTopics('');
  };

  const handleFileChange = async (file: File | null) => {
    setCsvError(null);
    setCsvStatus(null);
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseStructuredDoiFile(text, csvDefaultGroup, csvDefaultKind);
      if (parsed.rows.length === 0) {
        setCsvError('No valid DOIs found in this file. Ensure DOIs begin with 10.XXXX/…');
        setCsvRows([]);
        setCsvFileName(file.name);
        return;
      }
      setCsvFileName(file.name);
      setCsvRows(parsed.rows);
      setCsvSkipped(parsed.skipped);
    } catch {
      setCsvError('Could not read the uploaded file. Please use UTF-8 CSV, TSV, or TXT.');
    }
  };

  const handleConfirmCsvImport = async () => {
    if (csvRows.length === 0) return;
    setIsImportingCsv(true);
    setCsvError(null);
    setCsvStatus(null);

    const existingDois = new Set(existingArticles.map((a) => normalizeDoi(a.doi)));
    const added: Article[] = [];
    let skippedDupes = 0;

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      if (existingDois.has(row.doi)) {
        skippedDupes++;
        continue;
      }

      const hasFullLocalMetadata = Boolean(row.title && row.abstract && row.journal && row.year);
      if (hasFullLocalMetadata) {
        added.push({
          id: `csv-${row.doi}-${Date.now()}-${i}`,
          doi: row.doi,
          title: row.title!,
          abstract: row.abstract!,
          journal: row.journal!,
          year: row.year!,
          group: row.group,
          kind: row.kind,
          language: row.language ?? 'en',
          originalLanguage: row.originalLanguage,
          topics: (row.topics ?? []).map((name) => ({ name, score: 0.85 })),
          source: 'csv',
        });
        existingDois.add(row.doi);
      } else if (resolveMissingViaOpenAlex) {
        setCsvStatus(`Enriching row ${i + 1} of ${csvRows.length} (${row.doi}) from OpenAlex…`);
        const res = await fetchArticleByDoi(row.doi, row.group, row.kind);
        if (res.article) {
          // Preserve any user-provided fields from CSV
          if (row.title) res.article.title = row.title;
          if (row.abstract) res.article.abstract = row.abstract;
          if (row.journal) res.article.journal = row.journal;
          if (row.year) res.article.year = row.year;
          if (row.originalLanguage) res.article.originalLanguage = row.originalLanguage;
          added.push(res.article);
          existingDois.add(row.doi);
        }
      }
    }

    if (added.length > 0) {
      onImportArticles(added);
    }

    setIsImportingCsv(false);
    setCsvRows([]);
    setCsvFileName(null);
    setCsvStatus(
      `Imported ${added.length} article${added.length === 1 ? '' : 's'}${
        skippedDupes > 0 ? ` · ${skippedDupes} duplicate${skippedDupes === 1 ? '' : 's'} skipped` : ''
      }.`
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Import & Input DOIs</h1>
        <p className="mt-1 text-sm text-slate-600">
          Add DOIs grouped under Biodiversity, Climate Change, or Infectious Diseases. Metadata and
          same-journal, same-year untranslated controls can be resolved live via OpenAlex & Crossref,
          or supplied directly via CSV/manual entry.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Left Column: Paste DOIs or Manual Article Entry */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">Direct DOI Input</h2>
            <div
              role="tablist"
              aria-label="Direct input mode"
              className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-md"
            >
              <button
                type="button"
                role="tab"
                aria-selected={inputMode === 'doi-batch'}
                onClick={() => setInputMode('doi-batch')}
                className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                  inputMode === 'doi-batch'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Lookup DOIs
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inputMode === 'manual'}
                onClick={() => setInputMode('manual')}
                className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                  inputMode === 'manual'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Manual Abstract
              </button>
            </div>
          </div>

          {inputMode === 'doi-batch' ? (
            <form onSubmit={handleBatchDoiSubmit} className="mt-4 space-y-4 flex-1 flex flex-col">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">Domain Group</span>
                  <select
                    value={batchGroup}
                    onChange={(e) => setBatchGroup(e.target.value as DomainGroup)}
                    className="mt-1 w-full h-9 px-2.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {DOMAIN_GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">Abstract Role</span>
                  <select
                    value={batchKind}
                    onChange={(e) => setBatchKind(e.target.value as ArticleKind)}
                    className="mt-1 w-full h-9 px-2.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="translated">Translated Abstract</option>
                    <option value="untranslated">Untranslated Control</option>
                  </select>
                </label>
              </div>

              {batchKind === 'translated' && (
                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">
                    Original Language (optional)
                  </span>
                  <input
                    type="text"
                    value={batchOrigLang}
                    onChange={(e) => setBatchOrigLang(e.target.value)}
                    placeholder="e.g., Spanish, Portuguese, Chinese, Japanese"
                    className="mt-1 w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>
              )}

              <label className="block flex-1">
                <span className="block text-xs font-medium text-slate-700">
                  DOIs (one per line or comma-separated)
                </span>
                <textarea
                  rows={5}
                  value={doiText}
                  onChange={(e) => {
                    setDoiText(e.target.value);
                    if (batchError) setBatchError(null);
                  }}
                  placeholder={`10.1038/s41559-023-02001-w\nhttps://doi.org/10.1111/gcb.16500`}
                  className="mt-1 w-full p-3 font-mono text-xs bg-white border border-slate-200 rounded-md placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </label>

              {batchKind === 'translated' && (
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoFetchControls}
                    onChange={(e) => setAutoFetchControls(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span>
                    Automatically query OpenAlex for untranslated control articles from the exact
                    same journal and publication year
                  </span>
                </label>
              )}

              {batchError && (
                <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {batchError}
                </p>
              )}

              {batchStatus && (
                <div className="flex items-center justify-between gap-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{batchStatus}</span>
                  </span>
                  {!isFetchingBatch && (
                    <button
                      type="button"
                      onClick={onGoToPairings}
                      className="font-semibold text-emerald-900 underline whitespace-nowrap"
                    >
                      View pairings
                    </button>
                  )}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isFetchingBatch}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:bg-slate-400 transition-colors"
                >
                  {isFetchingBatch ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      <span>Resolving via OpenAlex…</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      <span>Fetch & Add DOIs</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleManualSubmit} className="mt-4 space-y-3.5 flex-1 flex flex-col">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">DOI</span>
                  <input
                    type="text"
                    value={mDoi}
                    onChange={(e) => {
                      setMDoi(e.target.value);
                      if (manualError) setManualError(null);
                    }}
                    placeholder="10.1111/cobi.14901"
                    className="mt-1 w-full h-9 px-3 font-mono text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">Domain Group</span>
                  <select
                    value={mGroup}
                    onChange={(e) => setMGroup(e.target.value as DomainGroup)}
                    className="mt-1 w-full h-9 px-2.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {DOMAIN_GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">Role</span>
                  <select
                    value={mKind}
                    onChange={(e) => setMKind(e.target.value as ArticleKind)}
                    className="mt-1 w-full h-9 px-2.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="translated">Translated</option>
                    <option value="untranslated">Untranslated</option>
                  </select>
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">Journal</span>
                  <input
                    type="text"
                    value={mJournal}
                    onChange={(e) => setMJournal(e.target.value)}
                    placeholder="Conservation Biology"
                    className="mt-1 w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">Year</span>
                  <input
                    type="number"
                    min={1900}
                    max={2100}
                    value={mYear}
                    onChange={(e) => setMYear(e.target.value)}
                    className="mt-1 w-full h-9 px-3 font-mono text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">Title</span>
                  <input
                    type="text"
                    value={mTitle}
                    onChange={(e) => setMTitle(e.target.value)}
                    placeholder="Article title"
                    className="mt-1 w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">
                    Topics / Keywords (semicolon-separated)
                  </span>
                  <input
                    type="text"
                    value={mTopics}
                    onChange={(e) => setMTopics(e.target.value)}
                    placeholder="Amphibian conservation; Riparian corridors"
                    className="mt-1 w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>
              </div>

              {mKind === 'translated' && (
                <label className="block">
                  <span className="block text-xs font-medium text-slate-700">
                    Original Language (optional)
                  </span>
                  <input
                    type="text"
                    value={mOrigLang}
                    onChange={(e) => setMOrigLang(e.target.value)}
                    placeholder="Spanish"
                    className="mt-1 w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </label>
              )}

              <label className="block flex-1">
                <span className="block text-xs font-medium text-slate-700">Abstract Text</span>
                <textarea
                  rows={4}
                  value={mAbstract}
                  onChange={(e) => setMAbstract(e.target.value)}
                  placeholder="Paste the English or translated abstract text…"
                  className="mt-1 w-full p-3 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </label>

              {manualError && (
                <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {manualError}
                </p>
              )}

              {manualSuccess && (
                <div className="flex items-center justify-between gap-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                  <span>{manualSuccess}</span>
                  <button
                    type="button"
                    onClick={onGoToPairings}
                    className="font-semibold text-emerald-900 underline whitespace-nowrap"
                  >
                    View pairings
                  </button>
                </div>
              )}

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Add Article to Corpus</span>
              </button>
            </form>
          )}
        </section>

        {/* Right Column: CSV / TSV Batch Upload */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">Upload CSV / TSV Dataset</h2>
            <button
              type="button"
              onClick={() =>
                triggerFileDownload('bibliopair-template.csv', buildTemplateCsv(), 'text/csv;charset=utf-8')
              }
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download Template CSV</span>
            </button>
          </div>

          <div className="mt-4 space-y-4 flex-1 flex flex-col">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-700">
                  Fallback Group (if column absent)
                </span>
                <select
                  value={csvDefaultGroup}
                  onChange={(e) => setCsvDefaultGroup(e.target.value as DomainGroup)}
                  className="mt-1 w-full h-9 px-2.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {DOMAIN_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-slate-700">
                  Fallback Role (if column absent)
                </span>
                <select
                  value={csvDefaultKind}
                  onChange={(e) => setCsvDefaultKind(e.target.value as ArticleKind)}
                  className="mt-1 w-full h-9 px-2.5 text-sm bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="translated">Translated</option>
                  <option value="untranslated">Untranslated</option>
                </select>
              </label>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files?.[0] ?? null;
                void handleFileChange(dropped);
              }}
              className="border border-dashed border-slate-300 rounded-lg p-6 text-center bg-slate-50/60"
            >
              <FileUp className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-slate-800">
                {csvFileName ? `Selected: ${csvFileName}` : 'Drop a CSV, TSV, or TXT file of DOIs'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Recognizes columns: <span className="font-mono">doi</span>,{' '}
                <span className="font-mono">group</span>, <span className="font-mono">type</span>,{' '}
                <span className="font-mono">journal</span>, <span className="font-mono">year</span>,{' '}
                <span className="font-mono">title</span>, <span className="font-mono">abstract</span>,{' '}
                <span className="font-mono">topics</span>
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                onChange={(e) => void handleFileChange(e.target.files?.[0] ?? null)}
                className="sr-only"
                aria-label="Upload DOI CSV or TSV file"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Choose File</span>
              </button>
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={resolveMissingViaOpenAlex}
                onChange={(e) => setResolveMissingViaOpenAlex(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span>
                Resolve missing titles, abstracts, journals, and years via OpenAlex when a row only
                contains a DOI
              </span>
            </label>

            {csvError && (
              <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                {csvError}
              </p>
            )}

            {csvStatus && (
              <div className="flex items-center justify-between gap-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                <span>{csvStatus}</span>
                <button
                  type="button"
                  onClick={onGoToPairings}
                  className="font-semibold text-emerald-900 underline whitespace-nowrap"
                >
                  View pairings
                </button>
              </div>
            )}

            {csvRows.length > 0 && (
              <div className="border border-slate-200 rounded-md overflow-hidden flex-1 flex flex-col">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    Parsed <strong className="font-mono text-slate-900">{csvRows.length}</strong> valid
                    rows{csvSkipped > 0 ? ` (${csvSkipped} skipped)` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCsvRows([]);
                      setCsvFileName(null);
                    }}
                    className="text-slate-500 hover:text-slate-800"
                  >
                    Clear
                  </button>
                </div>
                <div className="overflow-x-auto max-h-48">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500">
                        <th className="py-1.5 px-3">DOI</th>
                        <th className="py-1.5 px-2">Group</th>
                        <th className="py-1.5 px-2">Role</th>
                        <th className="py-1.5 px-2">Metadata</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {csvRows.slice(0, 8).map((r, i) => (
                        <tr key={`${r.doi}-${i}`}>
                          <td className="py-1.5 px-3 font-mono text-slate-800">{r.doi}</td>
                          <td className="py-1.5 px-2 text-slate-700">{r.group}</td>
                          <td className="py-1.5 px-2 text-slate-700 capitalize">{r.kind}</td>
                          <td className="py-1.5 px-2 text-slate-500">
                            {r.abstract && r.journal && r.year ? 'Local CSV' : 'OpenAlex lookup'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-auto pt-2">
              <button
                type="button"
                onClick={handleConfirmCsvImport}
                disabled={csvRows.length === 0 || isImportingCsv}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                {isImportingCsv ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Importing Dataset…</span>
                  </>
                ) : (
                  <span>
                    Import {csvRows.length > 0 ? `${csvRows.length} Parsed Rows` : 'Parsed File'}
                  </span>
                )}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
