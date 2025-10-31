// src/mcp-astro.ts
import express from "express";
import type { Request, Response, NextFunction } from "express";

const app = express();
app.use(express.json());

// ---------- util: zodiac ----------
function zodiac(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "Unknown";
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const table: Array<[string, boolean]> = [
    ["Capricorn",   (m === 1  && day <  20) || (m === 12 && day >= 22)],
    ["Aquarius",    (m === 1  && day >= 20) || (m === 2  && day <= 18)],
    ["Pisces",      (m === 2  && day >= 19) || (m === 3  && day <= 20)],
    ["Aries",       (m === 3  && day >= 21) || (m === 4  && day <= 19)],
    ["Taurus",      (m === 4  && day >= 20) || (m === 5  && day <= 20)],
    ["Gemini",      (m === 5  && day >= 21) || (m === 6  && day <= 20)],
    ["Cancer",      (m === 6  && day >= 21) || (m === 7  && day <= 22)],
    ["Leo",         (m === 7  && day >= 23) || (m === 8  && day <= 22)],
    ["Virgo",       (m === 8  && day >= 23) || (m === 9  && day <= 22)],
    ["Libra",       (m === 9  && day >= 23) || (m === 10 && day <= 22)],
    ["Scorpio",     (m === 10 && day >= 23) || (m === 11 && day <= 21)],
    ["Sagittarius", (m === 11 && day >= 22) || (m === 12 && day <= 21)],
  ];
  return table.find(([, ok]) => ok)?.[0] ?? "Unknown";
}

// ---------- logging ----------
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ---------- health ----------
app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

/**
 * MCP JSON-RPC 2.0 endpoint (protocolVersion 2024-06-01)
 *
 * Métodos:
 *  - initialize
 *  - tools/list
 *  - tools/call
 */
app.post("/mcp", (req: Request, res: Response) => {
  const { jsonrpc, id, method, params } = req.body ?? {};

  const invalid = () =>
    res.json({
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code: -32600, message: "Invalid Request (JSON-RPC 2.0)" },
    });

  if (jsonrpc !== "2.0") return invalid();
  if (typeof method !== "string") return invalid();
  if (!(typeof id === "string" || typeof id === "number")) return invalid();

  // ----- initialize -----
  if (method === "initialize") {
    const clientPV: string | undefined = params?.protocolVersion;
    // Respondemos con el mismo protocolVersion si lo envía el cliente.
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        ...(clientPV ? { protocolVersion: clientPV } : {}),
        serverInfo: { name: "mcp-astro", version: "0.2.0" },
        capabilities: { tools: {} },
      },
    });
  }

  // ----- tools/list -----
  if (method === "tools/list") {
    // NOTA CLAVE: no declaramos outputSchema para evitar validaciones
    // “structured content” del SDK cuando devolvemos TEXT.
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "astro.getSign",
            description:
              "Returns zodiac sign for an ISO date (YYYY-MM-DD).",
            inputSchema: {
              type: "object",
              properties: {
                date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              },
              required: ["date"],
            },
          },
          {
            name: "astro.dailyFortune",
            description:
              "Returns a one-line fortune for a given zodiac sign.",
            inputSchema: {
              type: "object",
              properties: { sign: { type: "string" } },
              required: ["sign"],
            },
          },
        ],
      },
    });
  }

  // ----- tools/call -----
  if (method === "tools/call") {
    const name: string | undefined = params?.name;
    const args: any = params?.arguments ?? {};

    if (name === "astro.getSign") {
      const sign = zodiac(args?.date);
      // Devolvemos **TEXT** (no JSON estructurado) para satisfacer el SDK con outputSchema omitido
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            { type: "text", text: `{"sign":"${sign}"}` },
          ],
        },
      });
    }

    if (name === "astro.dailyFortune") {
      const sign = (args?.sign as string) || "Unknown";
      const fortune = `A lucky break awaits, ${sign}.`;
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            { type: "text", text: `{"fortune":"${fortune}"}` },
          ],
        },
      });
    }

    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown tool: ${name}` },
    });
  }

  // Método no soportado
  return res.json({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});

const PORT = 3211;
app.listen(PORT, () => {
  console.log(`MCP Astro (JSON-RPC 2.0) running at http://localhost:${PORT}`);
  console.log(`  Health:   curl http://localhost:${PORT}/health`);
  console.log(
    `  Init:     curl -s -X POST http://localhost:${PORT}/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"curl","version":"0.0.1"},"protocolVersion":"2024-06-01"}}' | jq`,
  );
  console.log(
    `  List:     curl -s -X POST http://localhost:${PORT}/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq`,
  );
  console.log(
    `  Call:     curl -s -X POST http://localhost:${PORT}/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"astro.getSign","arguments":{"date":"1993-07-11"}}}' | jq`,
  );
});
