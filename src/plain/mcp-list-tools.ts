// mcp-list-tools.ts (Volcano SDK + .env, versión estable TSX)
// Lista las tools de un MCP server (AI MCP Proxy en Kong AI Gateway)
// Lé́e .env (sin top-level await) y usa Volcano SDK con rutas compatibles.
//
// Requisitos:
//   npm i volcano-sdk dotenv
//   npm i -D tsx
//
// Ejecución:
//   MCP_ENDPOINT (opcional) | MCP_PROXY_PORT (por defecto 33211)
//   KONG_AI_GATEWAY_API_KEY (opcional)
//   npx tsx mcp-list-tools.ts

import "dotenv/config"; // carga .env automáticamente si existe
import { mcp } from "volcano-sdk";

// Preferí apuntar SIEMPRE al proxy (AI MCP Proxy), no al REAL_MCP_URL aguas arriba.
const PORT = process.env.MCP_PROXY_PORT || "33211";
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || `http://127.0.0.1:${PORT}/mcp`;
const API_KEY = process.env.KONG_AI_GATEWAY_API_KEY; // opcional

function indent(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => pad + line.replace(/\r$/, ""))
    .join("\n");
}

async function main() {
  console.log(`▶ Conectando al MCP endpoint: ${MCP_ENDPOINT}`);

  const handle: any = mcp(MCP_ENDPOINT, {
    headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
    timeoutMs: 30_000,
  });

  try {
    // A) listTools si existe
    if (typeof handle.listTools === "function") {
      const resp = await handle.listTools();
      return printTools(resp?.tools ?? resp);
    }
    // B) request genérico
    if (typeof handle.request === "function") {
      const resp = await handle.request({ type: "tools/list" });
      return printTools(resp?.tools || resp?.result?.tools || []);
    }
    // C) call()
    if (typeof handle.call === "function") {
      const resp = await handle.call({ type: "tools/list" });
      return printTools(resp?.tools || resp?.result?.tools || []);
    }

    throw new Error("La versión del Volcano SDK no expone listTools/request/call en mcp().");
  } catch (err: any) {
    console.error("Error consultando tools del MCP:", err?.message || err);
    process.exit(1);
  }
}

function printTools(tools: any[]) {
  if (!Array.isArray(tools) || tools.length === 0) {
    console.log("No se encontraron tools publicadas por el MCP.");
    return;
  }
  console.log(`\n🧰 Tools publicadas por el MCP (${tools.length}):\n`);
  for (const t of tools) {
    const name = t?.name ?? "<sin-nombre>";
    const desc = t?.description ?? "(sin descripción)";
    console.log(`- ${name}`);
    console.log(`  descripción: ${desc}`);
    const schema = t?.inputSchema ?? t?.input_schema;
    if (schema) {
      try {
        const pretty = JSON.stringify(schema, null, 2);
        console.log("  input_schema:\n" + indent(pretty, 4));
      } catch {
        console.log("  input_schema: <no serializable>");
      }
    }
    console.log("");
  }
}

main();