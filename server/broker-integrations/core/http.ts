/**
 * server/broker-integrations/core/http.ts
 *
 * Thin wrapper over fetch for broker HTTP calls.
 * - Sets timeout
 * - Parses JSON body safely
 * - Never throws on non-2xx — returns a structured result
 * - Captures network-level errors distinctly from HTTP errors
 */

export interface HttpResult {
  ok: boolean;
  status: number;          // 0 = network error (never reached server)
  body: any;               // parsed JSON if possible, else raw text, else null
  rawText?: string;
  networkError?: string;
}

export interface HttpRequest {
  url: string;
  method: "POST" | "GET" | "PUT" | "DELETE" | "PATCH";
  headers: Record<string, string>;
  body?: any;
  timeoutMs: number;
}

export async function httpRequest(req: HttpRequest): Promise<HttpResult> {
  let controller: AbortController | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    controller = new AbortController();
    timeoutHandle = setTimeout(() => controller!.abort(), req.timeoutMs);

    const fetchInit: any = {
      method: req.method,
      headers: req.headers,
      signal: controller.signal,
    };
    if (req.body !== undefined) {
      fetchInit.body =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(req.url, fetchInit);
    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Keep raw text for diagnostics, parsed stays null
    }

    return {
      ok: response.ok,
      status: response.status,
      body: parsed,
      rawText: parsed == null ? text : undefined,
    };
  } catch (err: any) {
    // Network-level error (DNS, connection refused, timeout, TLS)
    const isAbort = err?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      body: null,
      networkError: isAbort ? `Timeout after ${req.timeoutMs}ms` : err?.message ?? String(err),
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
