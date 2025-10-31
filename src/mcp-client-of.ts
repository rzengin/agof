// src/mcp-client-of.ts
import { agent, llmOpenAI, mcp } from "volcano-sdk";

// === Config ===
const MCP_PROXY_URL = process.env.MCP_PROXY_URL?.trim() || "http://localhost:33211/mcp";
const LLM_URL       = process.env.LLM_URL?.trim()       || "http://127.0.0.1:8000/openai";

// Pequeña ayuda para tiempo y JSON seguro
const ts = () => new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
const safeJSON = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };

// Prompts “tool-first” para evitar verborrea del LLM
const P1_CONSENT = `
Call ONLY the MCP tools specified, then answer EXACTLY in this format:

CONSENT: {"status":"active|inactive","expiresAt":"YYYY-MM-DD|""}

Steps:
1) Call tool "cmf.consent.status" with:
   {"customerId":"cust-001","resource":"transactions","scope":"TRANSACTIONS_READ"}
2) If status is "inactive", call tool "cmf.consent.grant" with:
   {"customerId":"cust-001","resource":"transactions","scope":"TRANSACTIONS_READ","durationDays":30}
3) Call tool "cmf.consent.status" again to confirm final state.
4) Output only one line as specified above. No extra text.`.trim();

const P2_ACCOUNTS = `
Call ONLY "cmf.accounts.list" with {"customerId":"cust-001"}.
Then answer EXACTLY:
ACCOUNTS: {"accounts":[{"id":"...","alias":"...","currency":"..."}]}`.trim();

const P3_TX = `
Call ONLY "cmf.tx.search" with:
{"accountId":"acc-001","from":"2025-10-01","to":"2025-10-31"}.
Then answer EXACTLY:
TX: {"transactions":[{"id":"...","date":"YYYY-MM-DD","amount":123,"description":"..."}]}`.trim();

const P4_CF = `
Call ONLY "cmf.cashflow.compute" with:
{"customerId":"cust-001","horizonDays":30}.
Then answer EXACTLY:
CASHFLOW: {"horizonDays":30,"inflows":123,"outflows":456,"net":-333,"currency":"CLP"}`.trim();

async function preflight(cmfEndpoint: string) {
  // Descubrimiento rápido para que quede registrado en consola (opcional pero útil)
  const client = mcp(cmfEndpoint);
  console.log(`\n▶ Using MCP endpoint: ${cmfEndpoint}`);
  console.log(`▶ Using LLM baseURL: ${LLM_URL}\n`);

  // El volcano-sdk hará initialize/tools/list al empezar el workflow,
  // pero imprimimos un banner claro desde el agente también
}

async function main() {
  await preflight(MCP_PROXY_URL);

  // NO usamos OPENAI_API_KEY aquí — Konnect/Volcano enruta al modelo
  const llm = llmOpenAI({
    apiKey: "undefined",   // explícito para no leer env local
    baseURL: LLM_URL,      // tu route /openai (vía Konnect AI Gateway)
    model: "gpt-4o-mini",
  });

  const cmf = mcp(MCP_PROXY_URL);

  const startedAt = Date.now();

  try {
    const steps = await agent({ llm })
      .then({ prompt: P1_CONSENT,  mcps: [cmf] })
      .then({ prompt: P2_ACCOUNTS, mcps: [cmf] })
      .then({ prompt: P3_TX,       mcps: [cmf] })
      .then({ prompt: P4_CF,       mcps: [cmf] })
      .run();

    const totalMs = Date.now() - startedAt;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`🎉 Agent complete | Total: ${(totalMs / 1000).toFixed(1)}s`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🎉 Workflow complete!");
    console.log(`   Steps: ${steps.length} | Total: ${(totalMs / 1000).toFixed(1)}s\n`);

    // Resumen por paso
    steps.forEach((s, i) => {
      const title = s.prompt?.split("\n")[0]?.slice(0, 80) || "(no prompt)";
      console.log(`Step ${i + 1}: ${title}`);
      if (s.llmOutput) console.log(`  LLM Output:\n  ${s.llmOutput.trim()}\n`);
    });

    // Tool calls con marca temporal
    const toolCalls = steps.flatMap((s) => s.toolCalls || []);
    if (toolCalls.length) {
      console.log("━━━━━━━━ toolCalls ━━━━━━━━");
      toolCalls.forEach((c, idx) => {
        const kinds = c?.result?.content
          ? c.result.content.map((x: any) => x?.type || typeof x).join(",")
          : "(none)";
        console.log(
          `[${ts()}] #${idx + 1} ${c.name} ms=${c.ms} endpoint=${c.endpoint}\n` +
          `  args: ${safeJSON(c.arguments)}\n` +
          `  result.content: ${kinds}`
        );
      });
      console.log("");
    }

    // Última salida del LLM (tu “resultado final”)
    const lastLLM = [...steps].reverse().find((s) => !!s.llmOutput)?.llmOutput;
    if (lastLLM) {
      console.log("━━━━━━━━ Final LLM Output ━━━━━━━━");
      console.log(lastLLM.trim());
      console.log("");
    }
  } catch (e) {
    console.error("FATAL (agent):", e);
  }
}

main().catch((e) => console.error("FATAL (unhandled):", e));
