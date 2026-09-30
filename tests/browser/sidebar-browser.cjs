"use strict";
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = process.env.USAGE_REPO || process.cwd();
const fixture = fs.readFileSync(path.join(__dirname, "sidebar-app-shell.html"), "utf8");
const tempRoot = process.env.TMPDIR || "/data/data/com.termux/files/usr/tmp";
const profile = fs.mkdtempSync(path.join(tempRoot, "usage-layout-fixture-"));
const chrome = cp.spawn(process.env.CHROMIUM_PATH || "/data/data/com.termux/files/usr/lib/chromium/chrome", [
  "--headless", "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--user-data-dir=" + profile, "about:blank"
], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], env: { ...process.env, TMPDIR: tempRoot } });
let nextId = 1, buffer = Buffer.alloc(0), session, stderr = "", exited = false;
const waiting = new Map();
const exitPromise = new Promise(resolve => chrome.once("exit", () => { exited = true; resolve(); }));
chrome.stderr.on("data", c => { stderr = (stderr + c).slice(-4000); });
function failPending(error) { for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(error); } waiting.clear(); }
chrome.on("error", failPending);
chrome.stdio[3].on("error", failPending);
chrome.stdio[4].on("error", failPending);
function send(method, params = {}, sid) {
  return new Promise((resolve, reject) => {
    const id = nextId++, timer = setTimeout(() => { waiting.delete(id); reject(Error("CDP timeout: " + method)); }, 15000);
    waiting.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + "\0");
  });
}
chrome.stdio[4].on("data", c => {
  buffer = Buffer.concat([buffer, c]);
  while (buffer.indexOf(0) >= 0) {
    const end = buffer.indexOf(0), text = buffer.subarray(0, end).toString(); buffer = buffer.subarray(end + 1);
    if (!text) continue;
    const m = JSON.parse(text), w = waiting.get(m.id);
    if (w) { waiting.delete(m.id); clearTimeout(w.timer); m.error ? w.reject(Error(m.error.message)) : w.resolve(m.result); }
    else if (m.method === "Fetch.requestPaused") send("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "BlockedByClient" }, m.sessionId).catch(() => {});
  }
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session);
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function page(mode = "home", width = 1180) {
  if (session) await send("Target.closeTarget", { targetId: page.targetId });
  const t = await send("Target.createTarget", { url: "about:blank" }); page.targetId = t.targetId;
  session = (await send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
  await send("Page.enable", {}, session); await send("Runtime.enable", {}, session);
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, session);
  await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false }, session);
  const frameId = (await send("Page.getFrameTree", {}, session)).frameTree.frame.id;
  await send("Page.setDocumentContent", { frameId, html: fixture }, session);
  if (mode.startsWith("legacy")) await evaluate(`document.querySelector('aside').innerHTML='<div id="legacy-sidebar" style="height:100%;width:100%;display:flex;flex-direction:column"><header style="display:flex;flex-direction:column"><div><button>ChatGPT Pro</button></div><div><button aria-label="New chat">New chat</button></div></header></div>';document.querySelector('aside').style.width='${mode === "legacy-collapsed" ? 78 : 260}px'`);
  if (mode === "codex") await evaluate(`document.querySelector('.new-chat-wrap').classList.add('horizontal');document.querySelector('.new-chat-wrap').insertAdjacentHTML('beforeend','<button aria-label="New chat">✎</button>')`);
  if (mode === "collapsed") await evaluate(`document.body.classList.add('collapsed')`);
  const css = fs.readFileSync(path.join(root, "src/widget.css"), "utf8");
  await evaluate(`window.chrome={runtime:{getURL:p=>p,sendMessage:async()=>({ok:false,error:'synthetic fixture'})},storage:{local:{get:async()=>({}),set:async()=>{}}}};window.fetch=async()=>({text:async()=>${JSON.stringify(css)}});`);
  for (const file of ["usage-core.js", "layout-core.js", "content.js"]) await evaluate(fs.readFileSync(path.join(root, "src", file), "utf8"));
  await sleep(300);
}
async function snapshot() {
  return evaluate(`(()=>{const h=document.getElementById('codex-usage-bar-host'),s=h?.shadowRoot.querySelector('.cub-summary'),p=h?.parentElement;const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};const visible=e=>{if(!e||!e.getBoundingClientRect().width||!e.getBoundingClientRect().height)return false;for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n);if(c.display==='none'||c.visibility==='hidden'||c.opacity==='0')return false;}return true;};const controls=Array.from(document.querySelectorAll('button,a')).filter(visible).map(e=>({label:e.getAttribute('aria-label')||e.textContent,rect:rect(e)}));return {count:document.querySelectorAll('#codex-usage-bar-host').length,layout:h?.dataset.layout,density:h?.dataset.sidebar,visible:visible(h),rect:h?rect(h):null,summary:s?rect(s):null,parent:p?rect(p):null,inRail:!!h?.closest('[data-app-navigation-rail]'),inContent:!!h?.closest('[data-slate-sidebar-content]'),controls}})()`);
}
function noOverlap(s) {
  assert.equal(s.count, 1); assert.equal(s.visible, true); assert.equal(s.layout, "integrated");
  assert.ok(s.rect.width > 0 && s.summary.width <= s.rect.width + 1, "summary exceeds reserved host width");
  assert.ok(s.rect.left >= s.parent.left - 1 && s.rect.right <= s.parent.right + 1, "widget exceeds parent bounds");
  for (const c of s.controls) {
    const a=s.rect,b=c.rect;const overlap=Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
    assert.equal(overlap,false,"overlaps native control: "+c.label);
  }
}
const results=[];
async function test(name, action) { if(process.env.LAYOUT_CASE_FILTER && !new RegExp(process.env.LAYOUT_CASE_FILTER).test(name))return; try { await action(); results.push({name,status:"PASS"}); } catch(e) { results.push({name,status:"FAIL",error:e.message,snapshot:await snapshot().catch(()=>null)}); } }
(async()=>{
  console.log(JSON.stringify({browser:(await send("Browser.getVersion")).product,source:cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim()}));
  await test("expanded Home reserves separate row",async()=>{await page();const s=await snapshot();noOverlap(s);assert.equal(s.inContent,true);});
  await test("Codex horizontal New-chat row remains separate",async()=>{await page("codex");const s=await snapshot();noOverlap(s);const newChat=s.controls.find(c=>c.label==="New chat");assert.ok(s.rect.bottom<=newChat.rect.top+1,"widget shares New-chat row");});
  await test("initial collapsed app rail retains compact widget",async()=>{await page("collapsed");const s=await snapshot();noOverlap(s);assert.equal(s.inRail,true);assert.equal(s.density,"collapsed");});
  await test("collapse and expand remount on attributes only",async()=>{await page();await evaluate("document.body.classList.add('collapsed');document.querySelector('[data-slate-sidebar-content]').style.display='none'");await sleep(800);let s=await snapshot();noOverlap(s);assert.equal(s.inRail,true);await evaluate("document.body.classList.remove('collapsed');document.querySelector('[data-slate-sidebar-content]').style.display='flex'");await sleep(800);s=await snapshot();noOverlap(s);assert.equal(s.inContent,true);});
  await test("narrow sidebar and viewport resize remain bounded",async()=>{await page("codex");await evaluate("document.querySelector('[data-slate-sidebar-content]').style.width='160px';document.getElementById('app-shell-sidebar').style.width='212px';document.querySelector('aside').style.width='212px'");await sleep(600);noOverlap(await snapshot());await send("Emulation.setDeviceMetricsOverride",{width:700,height:600,deviceScaleFactor:1,mobile:false},session);await sleep(400);noOverlap(await snapshot());});
  await test("SPA content replacement remounts once",async()=>{await page();await evaluate("const old=document.querySelector('[data-slate-sidebar-content]');const copy=old.cloneNode(true);copy.querySelector('#codex-usage-bar-host')?.remove();old.replaceWith(copy);history.pushState({},'', '#replacement')");await sleep(800);noOverlap(await snapshot());});
  await test("transient anchor miss survives past revalidation",async()=>{await page();await evaluate("document.querySelector('.new-chat-main').textContent='Temporary label'");await sleep(2200);await evaluate("document.querySelector('.history').append(document.createElement('span'))");await sleep(500);noOverlap(await snapshot());});
  await test("sidebar absent hides and restored sidebar remounts",async()=>{await page();await evaluate("window.savedSidebar=document.querySelector('aside');savedSidebar.remove()");await sleep(500);assert.equal((await snapshot()).visible,false);await sleep(2100);await evaluate("document.body.prepend(savedSidebar)");await sleep(500);noOverlap(await snapshot());});
  await test("legacy expanded and collapsed sidebar remains supported",async()=>{for(const mode of ['legacy','legacy-collapsed']){await page(mode);const s=await snapshot();noOverlap(s);assert.equal(s.density,mode==='legacy'?'expanded':'collapsed');}});
  await test("popover opens and closes without changing layout",async()=>{await page();await evaluate("document.getElementById('codex-usage-bar-host').shadowRoot.getElementById('cub-summary').click()");await sleep(200);assert.equal(await evaluate("document.getElementById('codex-usage-bar-host').shadowRoot.getElementById('cub-popover').matches(':popover-open')"),true);noOverlap(await snapshot());await evaluate("document.getElementById('codex-usage-bar-host').shadowRoot.getElementById('cub-summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,composed:true}))");assert.equal(await evaluate("document.getElementById('codex-usage-bar-host').shadowRoot.getElementById('cub-popover').hidden"),true);});
  await test("popover fallback remains viewport positioned",async()=>{await page();await evaluate("Object.defineProperty(HTMLElement.prototype,'showPopover',{value:undefined,configurable:true});Object.defineProperty(HTMLElement.prototype,'hidePopover',{value:undefined,configurable:true});const shadow=document.getElementById('codex-usage-bar-host').shadowRoot;shadow.getElementById('cub-popover').removeAttribute('popover');shadow.getElementById('cub-summary').click()");await sleep(200);const r=await evaluate("(()=>{const p=document.getElementById('codex-usage-bar-host').shadowRoot.getElementById('cub-popover');const r=p.getBoundingClientRect();return {hidden:p.hidden,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width}})()");assert.equal(r.hidden,false);assert.ok(r.width>0&&r.left>=0&&r.right<=1180&&r.top>=0&&r.bottom<=800);});
  console.log(JSON.stringify({results,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length},null,2));
  if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
})().catch(e=>{console.error(e.stack,stderr);process.exitCode=2;}).finally(async()=>{
  try{await send("Browser.close");}catch(_){}
  await Promise.race([exitPromise,sleep(3000)]);
  if(!exited){chrome.kill();await Promise.race([exitPromise,sleep(3000)]);}
  if(exited)fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  else console.error("Test profile retained because Chromium exit was not confirmed:",profile);
  failPending(Error("Test finished"));
});
