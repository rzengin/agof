import express from "express";
import type { Request, Response } from "express";
import { URL } from "url";
import { bold, dim, green, red, yellow, cyan, magenta } from "colorette";

// ===================== Config =====================
const REAL_MCP = process.env.REAL_MCP_URL || "http://127.0.0.1:8000/mcp";
const PROXY_PORT = Number(process.env.MCP_PROXY_PORT || 33211);

// Verbosidad y muestras de payload
const VERBOSE = (process.env.MCP_PROXY_VERBOSE || "1") === "1";          // líneas extra (initialize/tools/list)
const LOG_BODIES = (process.env.MCP_PROXY_LOG_BODIES || "0") === "1";    // muestra argumentos y respuestas
const MAX_BODY_CHARS = Number(process.env.MCP_PROXY_MAX_BODY || 200);    // límite de caracteres para cuerpo

// ===================== Tipos =====================
type LogEvent = {
  seq: number;
  id: string | number | null;
  method?: string;        // initialize | tools/list | tools/call
  tool?: string;          // p.ej. astro.getSign
  arguments?: unknown;
  phase?: string;         // ?phase=...
  startedAt: number;      // epoch ms
  endedAt?: number;       // epoch ms
  status?: number;
  error?: string;
  respSnippet?: string;
  reqSnippet?: string;
};

const events: LogEvent[] = [];
let seqCounter = 1;

// ===================== Helpers =====================
function now() { return Date.now(); }

function fmtMs(ms: number | undefined) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(3)} s`;
}

function snippet(obj: any): string {
  try {
    const s = typeof obj === "string" ? obj : JSON.stringify(obj);
    return s.length > MAX_BODY_CHARS ? s.slice(0, MAX_BODY_CHARS) + " …" : s;
  } catch {
    return "[unserializable]";
  }
}

function lineFor(ev: LogEvent) {
  const dur = ev.endedAt ? ev.endedAt - ev.startedAt : undefined;
  const ts = new Date(ev.startedAt).toISOString();
  const statusColor =
    ev.status == null ? yellow :
    ev.status >= 200 && ev.status < 300 ? green :
    ev.status >= 400 ? red : cyan;

  const methodColor =
    ev.method === "tools/call" ? cyan :
    ev.method === "tools/list" ? magenta :
    ev.method === "initialize" ? yellow : dim;

  const parts = [
    dim(`[${ts}]`),
    bold(`#${ev.seq}`),
    ev.phase ? `[${ev.phase}]` : "",
    methodColor(ev.method || "-"),
    ev.tool ? `${bold(ev.tool)}` : "",
    `id=${String(ev.id ?? "-")}`,
    `status=${statusColor(String(ev.status ?? "-"))}`,
    `time=${bold(fmtMs(dur))}`,
  ].filter(Boolean);

  return parts.join(" ");
}

function bodyLines(ev: LogEvent) {
  const lines: string[] = [];
  if (!LOG_BODIES) return lines;

  if (ev.reqSnippet) {
    lines.push(dim("  req: ") + ev.reqSnippet);
  }
  if (ev.respSnippet) {
    lines.push(dim("  res: ") + ev.respSnippet);
  }
  return lines;
}

// ===================== App =====================
const app = express();
app.use(express.json({ limit: "4mb" }));

app.post("/mcp", async (req: Request, res: Response) => {
  const startedAt = now();

  // Fase desde query (?phase=step1/step2/…)
  const url = new URL(req.originalUrl, `http://localhost:${PROXY_PORT}`);
  const phase = url.searchParams.get("phase") || undefined;

  // JSON-RPC
  const body = req.body ?? {};
  const id = (typeof body?.id === "string" || typeof body?.id === "number") ? body.id : null;
  const method = body?.method as string | undefined;
  const tool = body?.params?.name as string | undefined;
  const args = body?.params?.arguments;

  const ev: LogEvent = {
    seq: seqCounter++,
    id,
    method,
    tool,
    arguments: args,
    phase,
    startedAt,
    reqSnippet: LOG_BODIES ? snippet(body) : undefined,
  };
  events.push(ev);

  // Log de entrada (compacto; bodies en líneas aparte si LOG_BODIES=1)
  console.log(lineFor(ev));
  bodyLines(ev).forEach(l => console.log(l));

  try {
    const upstream = await fetch(REAL_MCP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    ev.status = upstream.status;
    ev.endedAt = now();

    // Guardar respuesta para log
    if (LOG_BODIES) {
      ev.respSnippet = snippet(text);
      console.log(dim("  res: ") + ev.respSnippet);
    }

    // Responder tal cual al cliente
    res.status(upstream.status).type("application/json").send(text);

  } catch (e: any) {
    ev.status = 502;
    ev.endedAt = now();
    ev.error = e?.message || String(e);

    // Log de error
    console.log(red(`  error: ${ev.error}`));

    res.status(502).json({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: `Proxy error: ${ev.error}` },
    });
  }
});

// Dump de eventos (y vacía el buffer)
app.get("/proxy-log", (_req, res) => {
  const snapshot = [...events];
  events.length = 0;
  res.json({ ok: true, events: snapshot });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PROXY_PORT, () => {
  const hdr = [
    "MCP logging proxy",
    `listen=http://localhost:${PROXY_PORT}/mcp?phase=...`,
    `upstream=${REAL_MCP}`,
    `verbose=${VERBOSE ? "1" : "0"}`,
    `log_bodies=${LOG_BODIES ? "1" : "0"}`,
    `max_body=${MAX_BODY_CHARS}`,
  ].join("  ");
  console.log(hdr);

  if (VERBOSE) {
    console.log(
      [
        "Examples:",
        `  curl http://localhost:${PROXY_PORT}/health`,
        `  curl -s -X POST 'http://localhost:${PROXY_PORT}/mcp?phase=test' \\`,
        `    -H 'Content-Type: application/json' \\`,
        `    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"curl","version":"0.0.1"},"protocolVersion":"2024-06-01"}}'`,
      ].join("\n")
    );
  }
});