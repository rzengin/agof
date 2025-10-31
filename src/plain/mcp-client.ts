// mcp-client.ts
import { agent, llmOpenAI, mcp } from "volcano-sdk";

// Lee config del entorno
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

if (!OPENAI_API_KEY) {
  console.error("FATAL: Falta OPENAI_API_KEY en el entorno.");
  process.exit(1);
}

// Si usas proxy para logging por fase, dejá PROXY_ORIGIN; si no, apuntá directo al server.
const USE_PROXY = true;
const SERVER_ORIGIN = "http://localhost:3211";
const PROXY_ORIGIN = "http://localhost:33211";
const LLM_URL = process.env.LLM_URL ?? "http://127.0.0.1:8000/openai";

// Helper para mostrar bonito
function hr(title: string) {
  const bar = "━".repeat(40);
  console.log(`\n${bar} ${title} ${bar}`);
}

function safeParseJson(s: string) {
  try { return JSON.parse(s); } catch { return s; }
}

function printToolCalls(stepIndex: number, toolCalls: any[] = []) {
  if (!toolCalls.length) {
    console.log(`(Paso ${stepIndex + 1}) sin toolCalls`);
    return;
  }
  hr(`toolCalls paso ${stepIndex + 1}`);
  for (const [i, call] of toolCalls.entries()) {
    const { name, arguments: args, endpoint, ms, result } = call ?? {};
    // Intenta mostrar el contenido parseado si viene como text JSON
    let renderedResult: unknown = result;
    const content = result?.content;
    if (Array.isArray(content) && content[0]?.type === "text" && typeof content[0]?.text === "string") {
      renderedResult = safeParseJson(content[0].text);
    }
    console.log(
      JSON.stringify(
        {
          idx: i + 1,
          name,
          endpoint,
          ms,
          args,
          result: renderedResult,
        },
        null,
        2
      )
    );
  }
}

async function main() {
  const llm = llmOpenAI({
    apiKey: OPENAI_API_KEY,   // si Kong NO agrega la key hacia OpenAI
    baseURL: LLM_URL,          // <<— redirige todo a tu Route /openai
    model: "gpt-4o-mini",  // deja tu model como lo tenías si corresponde
  });

  // Etiquetamos por fase para que el proxy loggee claro (si lo estás usando)
  const astroStep1 = mcp(
    USE_PROXY ? `${PROXY_ORIGIN}/mcp?phase=step1` : `${SERVER_ORIGIN}/mcp`
  );
  const astroStep2 = mcp(
    USE_PROXY ? `${PROXY_ORIGIN}/mcp?phase=step2` : `${SERVER_ORIGIN}/mcp`
  );

  console.log("🌋 Running Volcano agent", USE_PROXY ? "[with phase-tagged proxy]" : "");
  const steps = await agent({ llm })
    .then({
      prompt: "Determine the astrological sign for 1993-07-11.",
      mcps: [astroStep1], // habilita tools en este paso
    })
    .then({
      prompt: "Write a one-line fortune for that sign.",
      mcps: [astroStep2], // opcional: también habilitado y con otra fase
    })
    .run();

  // Paso 1
  const step1 = steps[0] ?? {};
  const step1Calls = step1.toolCalls ?? []; // <- evita undefined.map
  printToolCalls(0, step1Calls);

  // Paso 2
  const step2 = steps[1] ?? {};
  const step2Calls = step2.toolCalls ?? []; // este paso suele ser sólo LLM, puede venir vacío
  printToolCalls(1, step2Calls);

  // Salida LLM del paso 2
  if (typeof step2.llmOutput === "string") {
    hr("Resultado LLM paso 2");
    console.log(step2.llmOutput);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
