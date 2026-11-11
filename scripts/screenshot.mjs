// Minimal headless-Chrome screenshot driver for UI checks (no dependencies, Node >= 22, google-chrome-stable).
//   node scripts/screenshot.mjs <url> <width> <height> <steps.json>
// steps: [{ "wait": ms } | { "js": "code run in the page" } | { "shot": "/abs/out.png" }] (one object may combine them)
// Env SP = directory for the throwaway Chrome profile (default /tmp). Console errors/warnings are printed.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [url, W, H, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsFile, "utf8"));
const profile = mkdtempSync(join(process.env.SP ?? "/tmp", "chrome-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn("google-chrome-stable", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`, "about:blank",
], { stdio: "ignore", detached: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
}
if (!target) { console.error("chrome did not come up"); process.kill(-chrome.pid); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type)) {
    const msg = d.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    if (!/decoration failed to load/.test(msg)) console.log(`console.${d.params.type}: ${msg.slice(0, 300)}`);
  }
  if (d.method === "Runtime.exceptionThrown") console.log("exception:", d.params.exceptionDetails?.exception?.description?.slice(0, 300));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 500 });
await send("Page.navigate", { url });
for (const s of steps) {
  if (s.wait) await sleep(s.wait);
  if (s.js) {
    const r = await send("Runtime.evaluate", { expression: s.js, awaitPromise: true, returnByValue: true });
    console.log("js:", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null).slice(0, 300));
  }
  if (s.shot) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(s.shot, Buffer.from(r.result.data, "base64"));
    console.log("shot:", s.shot);
  }
}
ws.close();
process.kill(-chrome.pid);
await sleep(300);
rmSync(profile, { recursive: true, force: true });
