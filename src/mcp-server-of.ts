// src/mcp-server-of.ts
import express from "express";
import type { Request, Response, NextFunction } from "express";

/* =============================================================================
   Config de logging
============================================================================= */
type Level = "debug" | "info" | "warn" | "error";
const LOG_LEVEL: Level = (process.env.LOG_LEVEL as Level) || "info";
const LOG_TRUNCATE = Number.isFinite(Number(process.env.LOG_TRUNCATE))
  ? Number(process.env.LOG_TRUNCATE)
  : 500;

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const shouldLog = (level: Level) => LEVEL_ORDER[level] >= LEVEL_ORDER[LOG_LEVEL];
const ts = () => new Date().toISOString();
function trunc(s: string, max = LOG_TRUNCATE) {
  if (typeof s !== "string") s = String(s);
  return s.length > max ? s.slice(0, max) + `…(+${s.length - max})` : s;
}
function safe(obj: any) {
  try {
    return trunc(JSON.stringify(obj));
  } catch {
    return "<unserializable>";
  }
}
function log(level: Level, msg: string) {
  if (shouldLog(level)) console.log(`[${ts()}] [${level.toUpperCase()}] ${msg}`);
}

/* =============================================================================
   Mock data (en memoria)
============================================================================= */
type ConsentRec = { resource: string; scope: string; active: boolean; expiresAt: string };
const CONSENTS: Record<string, ConsentRec> = {};

type Account = { id: string; alias: string; currency: string };
const ACCOUNTS: Record<string, Account[]> = {
  "cust-001": [
    { id: "acc-001", alias: "Cuenta Corriente", currency: "CLP" },
    { id: "acc-002", alias: "Tarjeta Visa",        currency: "CLP" },
  ],
};

type Tx = { accountId: string; date: string; amount: number; description: string };
const TXS: Record<string, Tx[]> = {
  "cust-001": [
    { accountId: "acc-001", date: "2025-10-01", amount: 1150000, description: "Sueldo" },
    { accountId: "acc-001", date: "2025-10-03", amount: -180000, description: "Arriendo" },
    { accountId: "acc-001", date: "2025-10-05", amount: -45000,  description: "Café y snacks" },
    { accountId: "acc-001", date: "2025-10-12", amount: -60000,  description: "Internet y telefonía" },
  ],
};

/* =============================================================================
   App / Middlewares
============================================================================= */
const app = express();
app.use(express.json());

// Medición de tiempo por request
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).__start = process.hrtime.bigint();
  next();
});

// Access log básico
app.use((req: Request, _res: Response, next: NextFunction) => {
  log("debug", `HTTP ${req.method} ${req.path}`);
  next();
});

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

/* =============================================================================
   Utilidades JSON-RPC
============================================================================= */
function invalid(reqBody: any, res: Response) {
  const id = reqBody && (typeof reqBody.id === "string" || typeof reqBody.id === "number") ? reqBody.id : null;
  log("warn", `INVALID id=${String(id)} reason=Invalid JSON-RPC envelope body=${safe(reqBody)}`);
  return res.json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request (JSON-RPC 2.0)" } });
}

// >>> CLAVE: siempre text (no "json")
function okText(id: string | number, value: any) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
}

function elapsedMs(req: Request) {
  const start = (req as any).__start as bigint | undefined;
  if (!start) return 0;
  const diff = Number(process.hrtime.bigint() - start);
  return Math.round(diff / 1_000_000);
}

/* =============================================================================
   MCP endpoint
============================================================================= */
app.post("/mcp", (req: Request, res: Response) => {
  const t0 = Date.now();
  const { jsonrpc, id, method, params } = req.body ?? {};
  const corr = typeof id === "string" || typeof id === "number" ? id : null;

  // JSON-RPC mínimo
  if (jsonrpc !== "2.0") return invalid(req.body, res);
  if (typeof method !== "string") return invalid(req.body, res);
  if (!(typeof id === "string" || typeof id === "number") && method !== "notifications/initialized") {
    return invalid(req.body, res);
  }

  // notifications/initialized (handshake opcional de MCP)
  if (method === "notifications/initialized") {
    log("info", `NOTIFY id=null phase=notifications/initialized params=${safe(params)}`);
    log("debug", `RESP id=null phase=notifications/initialized result={}`);
    return res.json({ jsonrpc: "2.0", id: null, result: {} });
  }

  // initialize
  if (method === "initialize") {
    log("info", `INIT id=${corr} params=${safe(params)}`);
    const result = {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "mcp-open-finance", version: "0.6.0" },
      capabilities: { tools: {} },
    };
    log("debug", `RESP id=${corr} phase=initialize result=${safe(result)}`);
    return res.json({ jsonrpc: "2.0", id, result });
  }

  // tools/list (sin outputSchema ⇒ el SDK acepta "text")
  if (method === "tools/list") {
    log("info", `LIST id=${corr}`);
    const result = {
      tools: [
        {
          name: "cmf.consent.status",
          description: "Check if consent is active for a customer/resource/scope.",
          inputSchema: {
            type: "object",
            properties: { customerId: { type: "string" }, resource: { type: "string" }, scope: { type: "string" } },
            required: ["customerId", "resource", "scope"],
          },
        },
        {
          name: "cmf.consent.grant",
          description: "Grant a consent for N days.",
          inputSchema: {
            type: "object",
            properties: {
              customerId: { type: "string" },
              resource:   { type: "string" },
              scope:      { type: "string" },
              durationDays: { type: "number" },
            },
            required: ["customerId", "resource", "scope", "durationDays"],
          },
        },
        {
          name: "cmf.accounts.list",
          description: "List accounts for a given customer.",
          inputSchema: {
            type: "object",
            properties: { customerId: { type: "string" } },
            required: ["customerId"],
          }
        },
        {
          name: "cmf.tx.search",
          description: "Search transactions for an account in [from, to] (YYYY-MM-DD).",
          inputSchema: {
            type: "object",
            properties: { accountId: { type: "string" }, from: { type: "string" }, to: { type: "string" } },
            required: ["accountId", "from", "to"],
          }
        },
        {
          name: "cmf.cashflow.compute",
          description: "Compute simple cashflow over a horizon (days).",
          inputSchema: {
            type: "object",
            properties: { customerId: { type: "string" }, horizonDays: { type: "number" } },
            required: ["customerId", "horizonDays"],
          }
        },
        {
          name: "cmf.events.subscribe",
          description: "Subscribe a callback URL to a topic.",
          inputSchema: {
            type: "object",
            properties: { topic: { type: "string" }, callbackUrl: { type: "string" } },
            required: ["topic", "callbackUrl"],
          }
        },
        {
          name: "cmf.events.emit",
          description: "Emit a mock event to a topic (no-op).",
          inputSchema: {
            type: "object",
            properties: { topic: { type: "string" }, payload: { type: "object" } },
            required: ["topic", "payload"],
          }
        },
      ],
    };
    log("debug", `RESP id=${corr} phase=tools/list tools=${(result.tools || []).length}`);
    return res.json({ jsonrpc: "2.0", id, result });
  }

  // tools/call
  if (method === "tools/call") {
    const toolName: string = params?.name;
    const args: any = params?.arguments ?? {};
    log("info", `CALL id=${corr} tool=${toolName} args=${safe(args)}`);

    try {
      // cmf.consent.status
      if (toolName === "cmf.consent.status") {
        const { customerId, resource, scope } = args;
        const key = `${customerId}:${resource}:${scope}`;
        const rec = CONSENTS[key];
        const payload = rec && rec.active
          ? { status: "active",   expiresAt: rec.expiresAt }
          : { status: "inactive", expiresAt: "" };
        log("debug", `RESP id=${corr} tool=${toolName} result=${safe(payload)} ms=${Date.now() - t0}`);
        return res.json(okText(id, payload));
      }

      // cmf.consent.grant
      if (toolName === "cmf.consent.grant") {
        const { customerId, resource, scope, durationDays = 30 } = args;
        const key = `${customerId}:${resource}:${scope}`;
        const expiresAt = new Date(Date.now() + Number(durationDays) * 864e5).toISOString().slice(0, 10);
        CONSENTS[key] = { resource, scope, active: true, expiresAt };
        const payload = { granted: true, expiresAt };
        log("debug", `RESP id=${corr} tool=${toolName} result=${safe(payload)} ms=${Date.now() - t0}`);
        return res.json(okText(id, payload));
      }

      // cmf.accounts.list
      if (toolName === "cmf.accounts.list") {
        const { customerId } = args;
        const accounts = ACCOUNTS[customerId] ?? [];
        const payload = { accounts };
        log("debug", `RESP id=${corr} tool=${toolName} result=${safe(payload)} ms=${Date.now() - t0}`);
        return res.json(okText(id, payload));
      }

      // cmf.tx.search
      if (toolName === "cmf.tx.search") {
        const { accountId, from, to } = args;
        const all = Object.values(TXS).flat().filter(t => t.accountId === accountId);
        const inRange = all.filter(t => t.date >= from && t.date <= to);
        const withId = inRange.map((t, i) => ({
          id: `tx-${i + 1}`,
          date: t.date,
          amount: t.amount,
          description: t.description,
        }));
        const payload = { transactions: withId };
        log("debug", `RESP id=${corr} tool=${toolName} result=${safe(payload)} ms=${Date.now() - t0}`);
        return res.json(okText(id, payload));
      }

      // cmf.cashflow.compute
      if (toolName === "cmf.cashflow.compute") {
        const { customerId, horizonDays = 30 } = args;
        const accounts = ACCOUNTS[customerId] ?? [];
        const primary = accounts[0]?.id;
        const currency = accounts[0]?.currency ?? "CLP";

        const today = new Date();
        const from = new Date(today);
        from.setUTCDate(today.getUTCDate() - Number(horizonDays));
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = today.toISOString().slice(0, 10);

        const txs = (TXS[customerId] ?? []).filter(
          t => t.accountId === primary && t.date >= fromStr && t.date <= toStr
        );
        const inflows  = txs.filter(t => t.amount > 0).reduce((a, b) => a + b.amount, 0);
        const outflows = txs.filter(t => t.amount < 0).reduce((a, b) => a + b.amount, 0) * -1;
        const net = inflows - outflows;

        const payload = { horizonDays: Number(horizonDays), inflows, outflows, net, currency };
        log("debug", `RESP id=${corr} tool=${toolName} result=${safe(payload)} ms=${Date.now() - t0}`);
        return res.json(okText(id, payload));
      }

      // cmf.events.subscribe
      if (toolName === "cmf.events.subscribe") {
        const { topic, callbackUrl } = args;
        const payload = { subscribed: true, topic, callbackUrl };
        log("debug", `RESP id=${corr} tool=${toolName} result=${safe(payload)} ms=${Date.now() - t0}`);
        return res.json(okText(id, payload));
      }

      // cmf.events.emit
      if (toolName === "cmf.events.emit") {
        const { topic, payload: eventPayload } = args;
        const payload = { published: true, topic, size: eventPayload ? Object.keys(eventPayload).length : 0 };
        log("debug", `RESP id=${corr} tool=${toolName} result=${safe(payload)} ms=${Date.now() - t0}`);
        return res.json(okText(id, payload));
      }

      // Unknown tool
      log("warn", `CALL id=${corr} tool=${toolName} error=Unknown tool`);
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${toolName}` } });
    } catch (e: any) {
      log("error", `ERROR id=${corr} tool=${toolName} msg=${e?.message || e} stack=${e?.stack || ""}`);
      return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: "Server error" } });
    }
  }

  // Método no soportado
  log("warn", `INVALID id=${corr} method=${method} reason=Method not found`);
  return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
});

/* =============================================================================
   Boot
============================================================================= */
const PORT = Number(process.env.MCP_PORT || 3211);
app.listen(PORT, () => {
  console.log(`MCP Open Finance (JSON-RPC 2.0) running at http://localhost:${PORT}`);
  console.log(`  LOG_LEVEL=${LOG_LEVEL}  LOG_TRUNCATE=${LOG_TRUNCATE}`);
  console.log(`  Health:   curl http://localhost:${PORT}/health`);
  console.log(
    `  Init:     curl -s -X POST http://localhost:${PORT}/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"curl\",\"version\":\"0.0.1\"},\"protocolVersion\":\"2024-11-05\"}}' | jq`
  );
  console.log(
    `  List:     curl -s -X POST http://localhost:${PORT}/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}' | jq`
  );
  console.log(
    `  Call:     curl -s -X POST http://localhost:${PORT}/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"cmf.consent.status\",\"arguments\":{\"customerId\":\"cust-001\",\"resource\":\"transactions\",\"scope\":\"TRANSACTIONS_READ\"}}}' | jq`
  );
});
