/**
 * client/src/components/upstox-eligibility-panel.tsx
 *
 * Live Upstox-eligibility checklist for the basket builder.
 *
 * DESIGN CONSTRAINTS
 *  - The builder sheet serves THREE products (intraday, multi-leg,
 *    model-portfolio). This panel must NOT change behaviour for the first two.
 *    It renders ONLY when the strategy looks like a model portfolio
 *    (non-intraday horizon), and it never blocks submission — it informs.
 *  - It validates against instrument_master server-side (via the new endpoint),
 *    NOT against the static autocomplete list that caused the ABSMARINE
 *    mismatch in the first place.
 *
 * Usage inside the builder sheet:
 *   {isModelPortfolio && (
 *     <UpstoxEligibilityPanel
 *       strategyId={strategy.id}
 *       constituents={constituents}
 *       onEligibilityChange={setUpstoxEligibility}
 *     />
 *   )}
 */

import { useEffect, useRef, useState } from "react";

export interface DraftConstituent {
  symbol: string;
  exchange?: string;
  weightPercent: string | number;
  action?: string;
  quantity?: string | number | null;
}

interface ValErr { field: string; reason: string; value?: any }

interface LegResolution {
  rawSymbol: string;
  resolved: string | null;
  exchangeToken: number | null;
  resolvedViaSuffix: boolean;
  direction: string;
  weightBps: number;
}

export interface EligibilityResult {
  eligible: boolean;
  errors: ValErr[];
  warnings: ValErr[];
  legResolution: LegResolution[];
}

export function UpstoxEligibilityPanel({
  strategyId,
  constituents,
  onEligibilityChange,
}: {
  strategyId: string;
  constituents: DraftConstituent[];
  onEligibilityChange?: (r: EligibilityResult | null) => void;
}) {
  const [result, setResult] = useState<EligibilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    // Debounce — the advisor is typing weights and symbols.
    timer.current = setTimeout(async () => {
      // Only bother once there's something worth checking.
      const usable = constituents.filter(c => c.symbol && String(c.symbol).trim());
      if (usable.length === 0) {
        setResult(null);
        onEligibilityChange?.(null);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/strategies/${strategyId}/basket/validate-eligibility`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            broker: "UPSTOX_BASKET",
            constituents: constituents.map(c => ({
              symbol: c.symbol,
              exchange: c.exchange || "NSE",
              weightPercent: c.weightPercent,
              action: c.action || "Buy",
              quantity: c.quantity ?? null,
            })),
          }),
        });
        const data = await res.json();
        const r: EligibilityResult = {
          eligible: !!data.eligible,
          errors: data.errors || [],
          warnings: data.warnings || [],
          legResolution: data.legResolution || [],
        };
        setResult(r);
        onEligibilityChange?.(r);
      } catch {
        setResult(null);
        onEligibilityChange?.(null);
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(constituents), strategyId]);

  const unresolved = result?.legResolution.filter(l => l.exchangeToken == null) ?? [];
  const suffixed = result?.legResolution.filter(l => l.resolvedViaSuffix) ?? [];

  return (
    <div className="border rounded-md p-3 mt-2 bg-slate-50 dark:bg-slate-900/40">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          Upstox publishing eligibility
          {loading && <span className="text-muted-foreground font-normal">checking…</span>}
        </span>
        {result && (
          result.eligible
            ? <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">Ready to publish</span>
            : <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">Not publishable</span>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground mt-1">
        This is a model-portfolio basket. These checks reflect what Upstox will accept.
        You can still save — but it won't be publishable to Upstox until these pass.
      </p>

      {result && (
        <div className="mt-2 space-y-2">
          {result.errors.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-red-700 dark:text-red-400 mb-1">
                Blocking ({result.errors.length})
              </div>
              <ul className="text-[11px] text-red-700 dark:text-red-400 space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i}>• {e.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {unresolved.length > 0 && (
            <div className="text-[11px] text-red-700 dark:text-red-400">
              <strong>Unresolved symbols:</strong>{" "}
              {unresolved.map(u => u.rawSymbol).join(", ")}
              <div className="text-muted-foreground">
                These don't match any tradeable NSE instrument. Check for a series suffix
                or a rename. A symbol that looks right in the search box may still not be tradeable.
              </div>
            </div>
          )}

          {suffixed.length > 0 && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400">
              <strong>Auto-resolved:</strong>{" "}
              {suffixed.map(s => `${s.rawSymbol} → ${s.resolved}`).join(", ")}
              <div className="text-muted-foreground">
                Resolved via series suffix. Confirm this is the instrument you intend.
              </div>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mb-1">
                Warnings ({result.warnings.length})
              </div>
              <ul className="text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i}>• {w.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {result.eligible && result.warnings.length === 0 && (
            <div className="text-[11px] text-green-700 dark:text-green-400">
              All checks pass. Every symbol resolves, weights sum to 100%, all BUY, minimum investment set.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
