// src/mcp-proxy.ts (passthrough + logs)
import http from "node:http";
import { URL } from "node:url";

const UPSTREAM = process.env.MCP_UPSTREAM || "http://localhost:3211/mcp";
const LISTEN  = process.env.MCP_PROXY_LISTEN || "http://localhost:33211/mcp";

const upstream = new URL(UPSTREAM);
const listen  = new URL(LISTEN);

const ts = () => new Date().toISOString().replace("T"," ").replace(/\.\d+Z$/,"Z");

function phaseFromBody(body: any): string {
  const m = body?.method;
  if (m === "initialize") return "init";
  if (m === "tools/list") return "discover";
  if (m === "tools/call") return `call:${body?.params?.name ?? "unknown"}`;
  return m || "unknown";
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== listen.pathname) {
    res.writeHead(404).end("Not Found");
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed: any;
    try { parsed = JSON.parse(body || "{}"); }
    catch {
      res.writeHead(400, {"content-type":"application/json"});
      return res.end(JSON.stringify({ ok:false, error:"invalid JSON" }));
    }

    const phase = phaseFromBody(parsed);
    const started = Date.now();
    console.log(`[${ts()}] ➡️ proxy -> upstream [${phase}] id=${parsed?.id}`);

    const ureq = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        path: upstream.pathname,
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (ures) => {
        let raw = "";
        ures.on("data", (c) => (raw += c));
        ures.on("end", () => {
          const ms = Date.now() - started;
          let obj: any;
          try { obj = JSON.parse(raw); }
          catch {
            console.log(`[${ts()}] ⛔ upstream non-JSON response`);
            res.writeHead(502, {"content-type":"application/json"});
            return res.end(JSON.stringify({ ok:false, error:"upstream non-JSON" }));
          }

          // Logs útiles sin mutar contenido
          const kinds = obj?.result?.content
            ? obj.result.content.map((c:any)=>c?.type||typeof c).join(",")
            : "(no content[])";
          console.log(`[${ts()}] ⬅️ upstream -> proxy [${phase}] id=${obj?.id} content=${kinds} ${ms}ms`);

          res.writeHead(200, {"content-type":"application/json"});
          res.end(JSON.stringify(obj)); // <-- SIN NORMALIZAR
        });
      }
    );

    ureq.on("error", (e) => {
      console.log(`[${ts()}] ⛔ proxy upstream error: ${e.message}`);
      res.writeHead(502, {"content-type":"application/json"});
      res.end(JSON.stringify({ ok:false, error:e.message }));
    });

    ureq.end(JSON.stringify(parsed));
  });
});

server.listen(+listen.port, listen.hostname, () => {
  console.log(`🛡️ MCP passthrough proxy on ${listen.href} -> ${upstream.href}`);
});
