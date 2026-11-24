import { useMemo, useState } from 'react';
import type { Article, DomainGroup, PairingResult } from '../types';
import { DOMAIN_GROUPS } from '../types';
import { computeStratumSummaries } from '../lib/pairing';

interface AnalyticsViewProps {
  articles: Article[];
  pairingResult: PairingResult;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function AnalyticsView({ articles, pairingResult }: AnalyticsViewProps) {
  const [selectedGroup, setSelectedGroup] = useState<DomainGroup | 'All'>('All');
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);

  const scopedPairs = useMemo(
    () =>
      selectedGroup === 'All'
        ? pairingResult.pairs
        : pairingResult.pairs.filter((p) => p.group === selectedGroup),
    [pairingResult.pairs, selectedGroup]
  );

  // 10 histogram bins: [0.0, 0.1), [0.1, 0.2), ..., [0.9, 1.0]
  const histogramBins = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, idx) => ({
      index: idx,
      start: idx / 10,
      end: (idx + 1) / 10,
      label: `${(idx / 10).toFixed(1)}–${((idx + 1) / 10).toFixed(1)}`,
      count: 0,
    }));
    for (const pair of scopedPairs) {
      const idx = Math.min(9, Math.max(0, Math.floor(pair.breakdown.distance * 10)));
      bins[idx].count++;
    }
    return bins;
  }, [scopedPairs]);

  const maxBinCount = Math.max(1, ...histogramBins.map((b) => b.count));

  const meanScoped = useMemo(() => {
    if (scopedPairs.length === 0) return null;
    return scopedPairs.reduce((s, p) => s + p.breakdown.distance, 0) / scopedPairs.length;
  }, [scopedPairs]);

  const medianScoped = useMemo(
    () => median(scopedPairs.map((p) => p.breakdown.distance)),
    [scopedPairs]
  );

  const groupRows = useMemo(() => {
    const unpairedSet = new Set(pairingResult.unpairedTranslatedIds);
    return DOMAIN_GROUPS.map((group) => {
      const groupArticles = articles.filter((a) => a.group === group);
      const translated = groupArticles.filter((a) => a.kind === 'translated');
      const untranslated = groupArticles.filter((a) => a.kind === 'untranslated');
      const pairs = pairingResult.pairs.filter((p) => p.group === group);
      const distances = pairs.map((p) => p.breakdown.distance);
      const unpairedCount = translated.filter((t) => unpairedSet.has(t.id)).length;

      const uReuse = new Map<string, number>();
      for (const p of pairs) uReuse.set(p.untranslatedId, (uReuse.get(p.untranslatedId) ?? 0) + 1);
      const sharedControls = Array.from(uReuse.values()).filter((c) => c > 1).length;

      return {
        group,
        translatedCount: translated.length,
        untranslatedCount: untranslated.length,
        pairCount: pairs.length,
        coveragePct:
          translated.length > 0
            ? Math.round(((translated.length - unpairedCount) / translated.length) * 100)
            : 0,
        sharedControls,
        mean:
          distances.length > 0
            ? distances.reduce((s, d) => s + d, 0) / distances.length
            : null,
        med: median(distances),
        min: distances.length > 0 ? Math.min(...distances) : null,
        max: distances.length > 0 ? Math.max(...distances) : null,
      };
    });
  }, [articles, pairingResult]);

  const strata = useMemo(
    () => computeStratumSummaries(articles, pairingResult),
    [articles, pairingResult]
  );

  const chartWidth = 680;
  const chartHeight = 250;
  const padLeft = 42;
  const padRight = 20;
  const padTop = 38;
  const padBottom = 38;
  const plotW = chartWidth - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Topic Overlap Analytics</h1>
        <p className="mt-1 text-sm text-slate-600">
          Distribution of topic overlap distance scores (<span className="font-mono text-slate-800">0.000</span> =
          perfect overlap) across Biodiversity, Climate Change, and Infectious Diseases strata.
        </p>
      </div>

      {/* Overlap Distance Histogram + Domain Comparison */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Overlap Distance Distribution
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {scopedPairs.length} pairings · Mean{' '}
                <span className="font-mono text-slate-800">
                  {meanScoped !== null ? meanScoped.toFixed(3) : '—'}
                </span>{' '}
                · Median{' '}
                <span className="font-mono text-slate-800">
                  {medianScoped !== null ? medianScoped.toFixed(3) : '—'}
                </span>
              </p>
            </div>

            <div
              role="tablist"
              aria-label="Filter histogram by group"
              className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-md overflow-x-auto max-w-full"
            >
              {(['All', ...DOMAIN_GROUPS] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  role="tab"
                  aria-selected={selectedGroup === g}
                  onClick={() => setSelectedGroup(g)}
                  className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                    selectedGroup === g
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {g === 'All' ? 'All' : g.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              role="img"
              aria-label="Histogram of topic overlap distance scores from 0.0 to 1.0"
              className="w-full h-auto min-w-[460px]"
            >
              {/* Horizontal gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                const y = padTop + plotH * (1 - frac);
                const val = Math.round(maxBinCount * frac);
                return (
                  <g key={frac}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={padLeft + plotW}
                      y2={y}
                      stroke="#E2E8F0"
                      strokeWidth={1}
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-400 font-mono text-[10px]"
                    >
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Bars */}
              {histogramBins.map((bin, i) => {
                const barSlot = plotW / 10;
                const barW = barSlot - 8;
                const x = padLeft + i * barSlot + 4;
                const barH = (bin.count / maxBinCount) * plotH;
                const y = padTop + plotH - barH;
                const fill =
                  bin.start < 0.35
                    ? '#059669'
                    : bin.start < 0.6
                      ? '#D97706'
                      : '#DC2626';
                const isHovered = hoveredBin === i;

                return (
                  <g
                    key={bin.index}
                    onMouseEnter={() => setHoveredBin(i)}
                    onMouseLeave={() => setHoveredBin(null)}
                  >
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(barH, bin.count > 0 ? 3 : 0)}
                      rx={2}
                      fill={fill}
                      fillOpacity={isHovered ? 0.95 : 0.78}
                    />
                    {bin.count > 0 && (
                      <text
                        x={x + barW / 2}
                        y={y - 5}
                        textAnchor="middle"
                        className="fill-slate-700 font-mono text-[10px] font-medium"
                      >
                        {bin.count}
                      </text>
                    )}
                    <text
                      x={x + barW / 2}
                      y={padTop + plotH + 16}
                      textAnchor="middle"
                      className="fill-slate-500 font-mono text-[10px]"
                    >
                      {bin.start.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {/* Mean vertical reference line */}
              {meanScoped !== null && (
                <g>
                  <line
                    x1={padLeft + meanScoped * plotW}
                    y1={padTop - 16}
                    x2={padLeft + meanScoped * plotW}
                    y2={padTop + plotH}
                    stroke="#1D4ED8"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={Math.min(padLeft + plotW - 44, Math.max(padLeft + 44, padLeft + meanScoped * plotW))}
                    y={14}
                    textAnchor="middle"
                    stroke="#FFFFFF"
                    strokeWidth={4}
                    paintOrder="stroke"
                    className="fill-blue-700 font-mono text-[11px] font-semibold"
                  >
                    Mean {meanScoped.toFixed(3)}
                  </text>
                </g>
              )}

              {/* Axis captions */}
              <text
                x={padLeft}
                y={chartHeight - 4}
                className="fill-emerald-700 text-[10px] font-medium"
              >
                0.0 Perfect overlap
              </text>
              <text
                x={padLeft + plotW}
                y={chartHeight - 4}
                textAnchor="end"
                className="fill-rose-700 text-[10px] font-medium"
              >
                1.0 No overlap
              </text>
            </svg>
          </div>

          {hoveredBin !== null && (
            <p className="mt-2 text-xs font-mono text-slate-600">
              Bin [{histogramBins[hoveredBin].label}]: {histogramBins[hoveredBin].count} pairing
              {histogramBins[hoveredBin].count === 1 ? '' : 's'}
            </p>
          )}
        </section>

        {/* Domain Group Comparison Table */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">Comparison by Domain Group</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Pairing coverage and overlap distance statistics per thematic group
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                  <th className="py-2.5 pl-4 pr-2">Group</th>
                  <th className="py-2.5 px-2 text-right">Pairs</th>
                  <th className="py-2.5 px-2 text-right">Shared</th>
                  <th className="py-2.5 px-2 text-right">Mean</th>
                  <th className="py-2.5 pl-2 pr-4 text-right">Range</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupRows.map((row) => (
                  <tr key={row.group}>
                    <td className="py-3 pl-4 pr-2">
                      <p className="font-medium text-slate-900">{row.group}</p>
                      <p className="text-slate-500 font-mono tabular-nums">
                        {row.translatedCount}T / {row.untranslatedCount}U · {row.coveragePct}%
                      </p>
                    </td>
                    <td className="py-3 px-2 text-right font-mono tabular-nums text-slate-900">
                      {row.pairCount}
                    </td>
                    <td className="py-3 px-2 text-right font-mono tabular-nums text-slate-700">
                      {row.sharedControls}
                    </td>
                    <td className="py-3 px-2 text-right font-mono font-semibold tabular-nums text-slate-900">
                      {row.mean !== null ? row.mean.toFixed(3) : '—'}
                    </td>
                    <td className="py-3 pl-2 pr-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {row.min !== null && row.max !== null
                        ? `${row.min.toFixed(2)}–${row.max.toFixed(2)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Journal x Year Stratum Coverage Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Journal × Year Stratum Coverage</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Every pairing strictly occurs within a single journal and publication year row below.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                <th className="py-3 pl-4 pr-3">Journal</th>
                <th className="py-3 px-3 text-right">Year</th>
                <th className="py-3 px-3">Domain Group(s)</th>
                <th className="py-3 px-3 text-right">Translated</th>
                <th className="py-3 px-3 text-right">Untranslated Pool</th>
                <th className="py-3 px-3 text-right">Pairings</th>
                <th className="py-3 pl-3 pr-4 text-right">Mean Distance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {strata.map((s) => (
                <tr key={s.key} className="hover:bg-slate-50/70">
                  <td className="py-3 pl-4 pr-3 font-medium text-slate-900">{s.journal}</td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                    {s.year}
                  </td>
                  <td className="py-3 px-3 text-slate-600">{s.groups.join(' · ')}</td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                    {s.translatedCount}
                    {s.unpairedCount > 0 && (
                      <span className="ml-1.5 text-rose-700">({s.unpairedCount} unpaired)</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                    {s.untranslatedCount}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                    {s.pairCount}
                  </td>
                  <td className="py-3 pl-3 pr-4 text-right font-mono font-semibold tabular-nums text-slate-900">
                    {s.meanDistance !== null ? s.meanDistance.toFixed(3) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
