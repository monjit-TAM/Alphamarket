/**
 * client/src/pages/admin/admin-baskets.tsx
 *
 * Admin control panel for publishing model-portfolio baskets to brokers.
 *
 * Deliberately mirrors the interaction model of admin-broker-calls.tsx (same
 * api() helper, same fetch-then-act shape) so it feels native — but it is a
 * separate page hitting separate endpoints. It cannot touch the live
 * recommendation call path.
 *
 * Route it wherever your other admin pages are registered, e.g.
 *   <Route path="/admin/baskets" component={AdminBaskets} />
 */

import { useEffect, useState } from "react";

async function api(method: string, url: string, body?: any) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

interface ValErr { field: string; reason: string; value?: any }

interface BasketRow {
  strategyId: string;
  name: string;
  advisorName: string | null;
  status: string;
  horizon: string | null;
  version: number;
  legCount: number;
  weightBps: number;
  sellLegs: number;
  syncState: string;
  isEnabled: boolean;
  brokerVersion: number | null;
  lastSyncedVersion: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  decision: { action: string; reason: string };
  eligible: boolean;
  errors: ValErr[];
  warnings: ValErr[];
  unresolvedSymbols: string[];
  resolvedViaSuffix: Array<{ from: string; to: string }>;
}

interface BasketsResponse {
  brokerType: string;
  connectionConfigured: boolean;
  tokenConfigured: boolean;
  connectionEnabled: boolean;
  baskets: BasketRow[];
}

const SYNC_COLORS: Record<string, string> = {
  never_sent: "bg-gray-100 text-gray-700",
  created: "bg-green-100 text-green-800",
  closed: "bg-slate-200 text-slate-700",
};

const LOG_COLORS: Record<string, string> = {
  success: "text-green-700",
  terminal: "text-red-700 font-semibold",
  conflict: "text-amber-700",
  retryable: "text-orange-700",
  validation_failed: "text-red-600",
  skipped: "text-gray-500",
  pending: "text-gray-500",
};

export default function AdminBaskets() {
  const [broker] = useState("UPSTOX_BASKET");
  const [data, setData] = useState<BasketsResponse | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api("GET", `/api/admin/baskets?broker=${broker}`);
      setData(d);
      const l = await api("GET", `/api/admin/baskets/logs?broker=${broker}&limit=25`);
      setLogs(l.logs || []);
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [broker]);

  async function toggleEnabled(row: BasketRow) {
    setBusy(row.strategyId);
    try {
      await api("POST", `/api/admin/baskets/${row.strategyId}/enable`, {
        broker, enabled: !row.isEnabled,
      });
      await load();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally { setBusy(null); }
  }

  async function doPreview(row: BasketRow) {
    setBusy(row.strategyId);
    try {
      const p = await api("GET", `/api/admin/baskets/${row.strategyId}/preview?broker=${broker}`);
      setPreview(p);
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally { setBusy(null); }
  }

  async function doPublish(row: BasketRow) {
    const action = row.decision.action;
    if (!confirm(
      `Publish "${row.name}" to ${broker}?\n\n` +
      `Action: ${action}\nReason: ${row.decision.reason}\n` +
      `Version: ${row.version} | Legs: ${row.legCount}\n\n` +
      `This WILL send a live request to the broker.`
    )) return;

    setBusy(row.strategyId);
    try {
      const r = await api("POST", `/api/admin/baskets/${row.strategyId}/publish`, {
        broker, ignoreEnabled: false,
      });
      const ok = r?.outcome?.status === "success";
      setMsg({
        kind: ok ? "ok" : "err",
        text: `${row.name}: ${r.reason}${r.xRequestId ? ` [X-Request-Id: ${r.xRequestId}]` : ""}`,
      });
      await load();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally { setBusy(null); }
  }

  async function doClose(row: BasketRow) {
    if (!confirm(`CLOSE "${row.name}" on ${broker}?\n\nThis marks the basket inactive and unsubscribable for end investors.`)) return;
    setBusy(row.strategyId);
    try {
      const r = await api("POST", `/api/admin/baskets/${row.strategyId}/publish`, {
        broker, force: "CLOSE", ignoreEnabled: true,
      });
      setMsg({ kind: r?.outcome?.status === "success" ? "ok" : "err", text: `${row.name}: ${r.reason}` });
      await load();
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally { setBusy(null); }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading baskets…</div>;
  if (!data) return <div className="p-8 text-red-600">Failed to load.</div>;

  const eligible = data.baskets.filter(b => b.eligible);
  const ineligible = data.baskets.filter(b => !b.eligible);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-2">
        <h1 className="text-2xl font-semibold">Basket Publishing</h1>
        <button onClick={load} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">
          Refresh
        </button>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Model-portfolio (smallcase-style) baskets. Separate from multi-leg and intraday
        baskets, and separate from the individual-call webhook.
      </p>

      {/* Connection health */}
      <div className="mb-5 p-3 rounded border bg-gray-50 text-sm flex flex-wrap gap-x-6 gap-y-1">
        <span><strong>Broker:</strong> {data.brokerType}</span>
        <span>
          <strong>Connection:</strong>{" "}
          {data.connectionConfigured
            ? <span className="text-green-700">configured</span>
            : <span className="text-red-700">missing — create a broker_connections row</span>}
        </span>
        <span>
          <strong>Bearer token:</strong>{" "}
          {data.tokenConfigured
            ? <span className="text-green-700">present</span>
            : <span className="text-red-700">NOT SET — nothing can dispatch</span>}
        </span>
        <span>
          <strong>Enabled:</strong>{" "}
          {data.connectionEnabled ? "yes" : <span className="text-red-700">no</span>}
        </span>
      </div>

      {!data.tokenConfigured && (
        <div className="mb-5 p-3 rounded border border-amber-300 bg-amber-50 text-sm text-amber-900">
          <strong>No outbound Bearer token configured.</strong> The basket API authenticates
          differently from the recommendation webhook — there, Upstox authenticates to us;
          here, we authenticate to them. Upstox issues this token at vendor onboarding.
          Until <code>broker_connections.token</code> is set, every dispatch will be skipped
          rather than failing against the broker.
        </div>
      )}

      {msg && (
        <div className={`mb-4 p-3 rounded border text-sm ${
          msg.kind === "ok"
            ? "border-green-300 bg-green-50 text-green-900"
            : "border-red-300 bg-red-50 text-red-900"
        }`}>
          <div className="flex justify-between gap-4">
            <span className="break-all">{msg.text}</span>
            <button onClick={() => setMsg(null)} className="shrink-0 opacity-60 hover:opacity-100">×</button>
          </div>
        </div>
      )}

      <Section title={`Eligible (${eligible.length})`}>
        {eligible.length === 0
          ? <Empty>No baskets currently pass this broker's requirements.</Empty>
          : eligible.map(b => (
              <BasketCard
                key={b.strategyId} row={b} busy={busy === b.strategyId}
                canDispatch={data.tokenConfigured && data.connectionEnabled}
                onToggle={() => toggleEnabled(b)}
                onPreview={() => doPreview(b)}
                onPublish={() => doPublish(b)}
                onClose={() => doClose(b)}
              />
            ))}
      </Section>

      <Section title={`Not eligible (${ineligible.length})`}>
        {ineligible.length === 0
          ? <Empty>None.</Empty>
          : ineligible.map(b => (
              <BasketCard
                key={b.strategyId} row={b} busy={busy === b.strategyId}
                canDispatch={false}
                onToggle={() => toggleEnabled(b)}
                onPreview={() => doPreview(b)}
                onPublish={() => {}}
                onClose={() => doClose(b)}
              />
            ))}
      </Section>

      <Section title="Recent publish attempts">
        {logs.length === 0 ? <Empty>Nothing published yet.</Empty> : (
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <Th>When</Th><Th>Basket</Th><Th>Action</Th><Th>Ver</Th>
                  <Th>HTTP</Th><Th>Status</Th><Th>X-Request-Id</Th><Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-t">
                    <Td>{new Date(l.published_at).toLocaleString()}</Td>
                    <Td>{l.strategy_name ?? l.strategy_id?.slice(0, 8)}</Td>
                    <Td>{l.basket_status}</Td>
                    <Td>{l.version ?? "—"}</Td>
                    <Td>{l.http_status ?? "—"}</Td>
                    <Td><span className={LOG_COLORS[l.status] ?? ""}>{l.status}</span></Td>
                    <Td className="font-mono text-xs">{l.x_request_id}</Td>
                    <Td className="max-w-xs truncate" title={l.error_message ?? ""}>
                      {l.error_message ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function BasketCard({
  row, busy, canDispatch, onToggle, onPreview, onPublish, onClose,
}: {
  row: BasketRow; busy: boolean; canDispatch: boolean;
  onToggle: () => void; onPreview: () => void; onPublish: () => void; onClose: () => void;
}) {
  const weightPct = (row.weightBps / 100).toFixed(2);
  const weightOk = Math.abs(row.weightBps - 10000) <= 1;

  return (
    <div className="border rounded p-4 mb-3 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{row.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded ${SYNC_COLORS[row.syncState] ?? ""}`}>
              {row.syncState}
            </span>
            {row.isEnabled
              ? <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800">enabled</span>
              : <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">disabled</span>}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {row.advisorName ?? "—"} · {row.status} · {row.horizon ?? "—"} ·{" "}
            v{row.version}
            {row.lastSyncedVersion != null && <> (broker v{row.brokerVersion ?? "?"})</>}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {row.legCount} legs ·{" "}
            <span className={weightOk ? "" : "text-red-700 font-medium"}>{weightPct}%</span>
            {row.sellLegs > 0 && (
              <span className="text-red-700 font-medium"> · {row.sellLegs} SELL leg(s)</span>
            )}
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            onClick={onPreview} disabled={busy}
            className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Preview payload
          </button>
          <button
            onClick={onToggle} disabled={busy}
            className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {row.isEnabled ? "Disable" : "Enable"}
          </button>
          {row.syncState === "created" && (
            <button
              onClick={onClose} disabled={busy || !canDispatch}
              className="text-sm px-3 py-1.5 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-40"
            >
              Close on broker
            </button>
          )}
          <button
            onClick={onPublish}
            disabled={busy || !canDispatch || !row.eligible || !row.isEnabled || row.decision.action === "NOOP"}
            className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            title={
              !canDispatch ? "Broker connection or token not configured"
                : !row.eligible ? "Basket does not meet this broker's requirements"
                : !row.isEnabled ? "Enable this basket first"
                : row.decision.action === "NOOP" ? row.decision.reason
                : row.decision.reason
            }
          >
            {row.decision.action === "NOOP" ? "In sync" : `Publish (${row.decision.action})`}
          </button>
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-500">
        <strong>Next action:</strong> {row.decision.action} — {row.decision.reason}
      </div>

      {row.errors.length > 0 && (
        <div className="mt-3 p-2 rounded bg-red-50 border border-red-200">
          <div className="text-xs font-semibold text-red-800 mb-1">
            Blocked ({row.errors.length}) — nothing will be sent
          </div>
          <ul className="text-xs text-red-800 space-y-0.5">
            {row.errors.map((e, i) => (
              <li key={i}><code className="font-mono">{e.field}</code> — {e.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {row.warnings.length > 0 && (
        <div className="mt-2 p-2 rounded bg-amber-50 border border-amber-200">
          <div className="text-xs font-semibold text-amber-900 mb-1">
            Warnings ({row.warnings.length})
          </div>
          <ul className="text-xs text-amber-900 space-y-0.5">
            {row.warnings.map((w, i) => (
              <li key={i}><code className="font-mono">{w.field}</code> — {w.reason}</li>
            ))}
          </ul>
        </div>
      )}

      {row.lastError && (
        <div className="mt-2 text-xs text-red-700">
          <strong>Last error:</strong> {row.lastError}
        </div>
      )}
    </div>
  );
}

function PreviewModal({ preview, onClose }: { preview: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div
        className="bg-white rounded-lg max-w-4xl w-full max-h-[85vh] overflow-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-semibold">Payload preview</h2>
            <p className="text-sm text-gray-600">
              Exactly what would be sent. Nothing has been dispatched.
            </p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none opacity-60 hover:opacity-100">×</button>
        </div>

        <div className="text-sm mb-4 grid grid-cols-2 gap-2">
          <div><strong>Action:</strong> {preview.decision?.action}</div>
          <div><strong>Sync state:</strong> {preview.syncState}</div>
          <div><strong>Our version:</strong> {preview.ourVersion}</div>
          <div><strong>Last synced:</strong> {preview.lastSyncedVersion ?? "never"}</div>
          <div className="col-span-2 text-gray-600">{preview.decision?.reason}</div>
        </div>

        {!preview.eligible && (
          <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm">
            <div className="font-semibold text-red-800 mb-1">Not eligible — no payload built</div>
            <ul className="text-red-800 text-xs space-y-0.5">
              {preview.errors?.map((e: ValErr, i: number) => (
                <li key={i}><code>{e.field}</code> — {e.reason}</li>
              ))}
            </ul>
          </div>
        )}

        {preview.payload && (
          <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded overflow-auto max-h-[45vh]">
            {JSON.stringify(preview.payload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-8">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{title}</h2>
    {children}
  </div>
);
const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="text-sm text-gray-500 border rounded p-4 bg-gray-50">{children}</div>
);
const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3 py-2 font-medium text-gray-600">{children}</th>
);
const Td = ({ children, className = "", ...rest }: any) => (
  <td className={`px-3 py-2 ${className}`} {...rest}>{children}</td>
);
