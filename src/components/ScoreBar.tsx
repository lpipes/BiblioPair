import { classifyOverlapDistance } from '../lib/scoring';

interface ScoreBarProps {
  distance: number;
  compact?: boolean;
  showNumeric?: boolean;
}

/**
 * Displays calibrated topic overlap distance where 0.000 = perfect overlap and 1.000 = no overlap.
 * Visualizes overlap strength (1 - distance) on a precision meter alongside explicit text classification.
 */
export function ScoreBar({ distance, compact = false, showNumeric = true }: ScoreBarProps) {
  const { label, toneClass, barClass } = classifyOverlapDistance(distance);
  const overlapPct = Math.max(4, Math.min(100, Math.round((1 - distance) * 100)));

  return (
    <div className={compact ? 'min-w-[118px]' : 'w-full'}>
      <div className="flex items-baseline justify-between gap-2">
        {showNumeric ? (
          <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
            {distance.toFixed(3)}
          </span>
        ) : (
          <span className="text-xs text-slate-500">
            Topic similarity: <span className="font-mono font-medium text-slate-800">{Math.round((1 - distance) * 100)}%</span>
          </span>
        )}
        <span className={`text-xs font-medium ${toneClass}`}>{label}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/80"
        aria-hidden="true"
      >
        <div
          className={`h-full transition-all duration-150 ${barClass}`}
          style={{ width: `${overlapPct}%` }}
        />
      </div>
    </div>
  );
}
