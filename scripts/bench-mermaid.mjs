// Run `npm run build` first. `--mermaid <version>` picks the release fetched from unpkg.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';

const PASSES = 5;
const MIN_SAMPLE_MS = 25;

const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const mermaidVersion = option('--mermaid', '12.1.0');
const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (typeof WebSocket === 'undefined') throw new Error('This benchmark needs Node 22 or later.');
if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}. Set CHROME to its path.`);

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const pele = readFileSync('dist/pele.global.js');
const mermaidUrl = `https://unpkg.com/mermaid@${mermaidVersion}/dist/mermaid.min.js`;
const res = await fetch(mermaidUrl);
if (!res.ok) throw new Error(`${mermaidUrl}: ${res.status}`);
const mermaid = Buffer.from(await res.arrayBuffer());
const mermaidName = `Mermaid ${mermaidVersion}`;

function tree(n) {
  let s = 'flowchart TD\n';
  for (let i = 1; i < n; i++) s += `  n${Math.floor((i - 1) / 3)}[Node ${Math.floor((i - 1) / 3)}] --> n${i}[Node ${i}]\n`;
  return s;
}

const flowchart = `flowchart TD
  A[Start] --> B{Is it working?}
  B -->|Yes| C[Ship it]
  B -->|No| D[Debug]
  D --> E[Fix]
  E --> B
  C --> F[Celebrate]
  F --> G[Done]`;

const sequence = `sequenceDiagram
  participant Alice
  participant Bob
  Alice->>Bob: Hello Bob
  loop Every minute
    Bob->>Alice: Ping
    Alice->>Bob: Pong
  end
  Bob-->>Alice: Bye`;

const classes = `classDiagram
  class Animal {
    +String name
    +int age
    +eat() void
  }
  class Dog {
    +bark() void
  }
  class Cat {
    +meow() void
  }
  class Bird {
    +bool canFly
    +fly() void
  }
  Animal <|-- Dog
  Animal <|-- Cat
  Animal <|-- Bird`;

const docs = JSON.parse(readFileSync('tests/corpus/flowchart-docs.json', 'utf8'));
const cases = [
  ['flowchart documentation examples', docs],
  ['7-node flowchart', [flowchart]],
  ['50-node flowchart', [tree(50)]],
  ['500-node flowchart', [tree(500)]],
  ['sequence diagram', [sequence]],
  ['class diagram', [classes]],
];

// Runs in the page.
function page(fixtures, minSample) {
  const host = document.getElementById('host');
  let id = 0;
  let current = [];
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

  const renderers = {
    pele: (src) => {
      host.innerHTML = pele.render(src).svg;
    },
    mermaid: async (src) => {
      const { svg } = await mermaid.render(`m${id++}`, src);
      host.innerHTML = svg;
    },
  };

  async function sample(engine, reps) {
    const render = renderers[engine];
    const t = performance.now();
    for (let r = 0; r < reps; r++) for (const src of current) await render(src);
    return (performance.now() - t) / reps;
  }

  const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];

  window.prepare = async (i) => {
    const rendered = { pele: 0, mermaid: 0 };
    current = [];
    for (const src of fixtures[i]) {
      let both = true;
      for (const engine of ['pele', 'mermaid']) {
        try {
          await renderers[engine](src);
          rendered[engine]++;
        } catch {
          both = false;
        }
      }
      if (both) current.push(src);
    }
    return { ...rendered, both: current.length };
  };

  window.time = async (passes) => {
    const reps = {};
    for (const engine of ['pele', 'mermaid']) {
      await sample(engine, 1);
      let n = 1;
      while ((await sample(engine, n)) * n < minSample) n *= 2;
      reps[engine] = n;
    }
    const samples = { pele: [], mermaid: [] };
    for (let i = 0; i < passes; i++) {
      for (const engine of i % 2 ? ['mermaid', 'pele'] : ['pele', 'mermaid']) samples[engine].push(await sample(engine, reps[engine]));
    }
    return { pele: median(samples.pele), mermaid: median(samples.mermaid) };
  };
}

const html = `<!doctype html>
<meta charset="utf-8">
<style>body { margin: 0; font-family: Arial; } #host { width: 1200px; }</style>
<div id="host"></div>
<script src="pele.js"></script>
<script src="mermaid.js"></script>
<script src="bench.js"></script>`;

const files = {
  '/': [html, 'text/html'],
  '/pele.js': [pele, 'text/javascript'],
  '/mermaid.js': [mermaid, 'text/javascript'],
  '/bench.js': [`(${page})(${JSON.stringify(cases.map(([, inputs]) => inputs))}, ${MIN_SAMPLE_MS});`, 'text/javascript'],
};
const server = createServer((req, res) => {
  const file = files[req.url];
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': `${file[1]}; charset=utf-8` }).end(file[0]);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const profile = mkdtempSync(join(tmpdir(), 'pele-bench-'));
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
const exited = new Promise((resolve) => chrome.once('exit', resolve));

let ws;
try {
  const wsUrl = await new Promise((resolve, reject) => {
    let output = '';
    chrome.stderr.on('data', (data) => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    exited.then((code) => reject(new Error(`Chrome exited (${code}): ${output}`)));
  });

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const call = pending.get(msg.id);
    if (!call) return;
    pending.delete(msg.id);
    if (msg.error) call.reject(new Error(msg.error.message));
    else call.resolve(msg.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { product } = await send('Browser.getVersion');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
  while (!(await evaluate(`document.readyState === 'complete' && typeof time === 'function'`))) await sleep(50);
  await evaluate('document.fonts.ready.then(() => true)');

  console.log(`Pele ${version} and ${mermaidName} in ${product}, median of ${PASSES} passes\n`);
  const ms = (x) => (x < 1 ? x.toFixed(3) : x.toFixed(1)) + ' ms';
  const rows = [];
  for (let i = 0; i < cases.length; i++) {
    const [name, inputs] = cases[i];
    const rendered = await evaluate(`prepare(${i})`);
    if (rendered.both < inputs.length) {
      console.log(`${name}: Pele rendered ${rendered.pele} and Mermaid ${rendered.mermaid} of ${inputs.length}; timing the ${rendered.both} both rendered`);
    }
    if (!rendered.both) continue;
    const t = await evaluate(`time(${PASSES})`);
    rows.push({ fixture: name, diagrams: rendered.both, pele: ms(t.pele), mermaid: ms(t.mermaid), speedup: Math.round(t.mermaid / t.pele) + '×' });
  }
  console.table(rows);

  const kib = (bytes) => (bytes / 1024).toFixed(1) + ' KiB';
  const size = (code) => `${kib(code.length)} minified, ${kib(gzipSync(code).length)} gzipped`;
  console.log(`dist/pele.global.js  ${size(pele)}`);
  console.log(`${mermaidName}  ${size(mermaid)}`);
  console.log(`Pele is ${(mermaid.length / pele.length).toFixed(1)}× smaller minified, ${(gzipSync(mermaid).length / gzipSync(pele).length).toFixed(1)}× gzipped`);
} finally {
  ws?.close();
  chrome.kill();
  await exited;
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
