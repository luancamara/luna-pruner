#!/usr/bin/env node
// luna-pruner: Luna (OpenAI Decisions) decide o que é relevante; código corta.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const MIN_CHARS = 6000;
const CHUNK_LINES = 20;
const MAX_CHUNKS = 40;
const DROP_BELOW = 0.5; // score 0-3
const TIMEOUT_MS = 8000;
const WARN_TOKENS = +process.env.LUNA_PRUNER_WARN_TOKENS || 150_000; // acima disso cada turno relê um histórico caro
const RENAG_TOKENS = 75_000; // só avisa de novo depois de crescer isso
const KEEP_RE = /error|exception|traceback|fatal|fail|panic|denied|\bat .+:\d+/i; // nunca podar
const SECRET_RE = /\.env\b|credentials|auth\.json|BEGIN [A-Z ]*PRIVATE KEY|(api[_-]?key|secret|token|password)\w*\s*[=:]\s*\S{8,}|sk-[A-Za-z0-9]{20,}/i;
const DATA = process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude/plugins/data/luna-pruner');
const LEVELS = [
  { label: '0', description: 'irrelevant noise (warnings, progress, repetition)' },
  { label: '1', description: 'marginal' },
  { label: '2', description: 'relevant' },
  { label: '3', description: 'essential' },
];

const log = (m) => { try { mkdirSync(DATA, { recursive: true }); appendFileSync(join(DATA, 'luna.log'), `${new Date().toISOString()} ${m}\n`); } catch {} };

export async function decide(input, questions) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('no OPENAI_API_KEY');
  const r = await fetch('https://api.openai.com/v1/decisions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-6-luna', input, questions }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`decisions ${r.status}`);
  const j = await r.json();
  log(`usage ${j.usage?.input_tokens ?? '?'} tokens`);
  return Object.fromEntries(j.answers.map((a) => [a.name, a]));
}

// Colapsa linhas consecutivas de mesmo formato (só números mudam): evita diluir a linha relevante num chunk de ruído.
export function collapse(text) {
  const out = [];
  let prev = null, n = 0;
  const flush = () => { if (n > 1) out.push(`  (… +${n - 1} linhas similares)`); n = 0; };
  for (const l of text.split('\n')) {
    const k = l.replace(/\d+/g, '#');
    if (k === prev && l.trim()) n++;
    else { flush(); out.push(l); prev = k; n = 1; }
  }
  flush();
  return out.join('\n');
}

export function chunkText(text) {
  const lines = text.split('\n');
  const size = Math.max(CHUNK_LINES, Math.ceil(lines.length / MAX_CHUNKS));
  const out = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size).join('\n'));
  return out;
}

// scores[i] = relevância 0-3 do chunk i; primeiro e último sempre ficam.
export function applyScores(chunks, scores, rawPath) {
  const parts = [];
  let dropped = 0, droppedLines = 0;
  const flush = () => {
    if (dropped) parts.push(`[… ${droppedLines} linhas podadas por luna-pruner; original: ${rawPath}]`);
    dropped = droppedLines = 0;
  };
  chunks.forEach((c, i) => {
    const keep = i === 0 || i === chunks.length - 1 || (scores[i] ?? 3) >= DROP_BELOW || KEEP_RE.test(c);
    if (keep) { flush(); parts.push(c); } else { dropped++; droppedLines += c.split('\n').length; }
  });
  flush();
  return parts.join('\n');
}

export async function pruneText(text, prompt, id) {
  log(`tool output ${text.length} chars, prompt ${prompt ? 'ok' : 'MISSING'}`);
  if (!prompt) return text; // sem tarefa conhecida não dá pra julgar relevância
  if (text.length < MIN_CHARS || SECRET_RE.test(text.slice(0, 20000))) return text;
  const chunks = chunkText(collapse(text));
  const input = `Current task (user's latest request):\n${prompt || '(unknown)'}\n\nTool output chunks:\n` +
    chunks.map((c, i) => `--- chunk ${i} ---\n${c}`).join('\n');
  const questions = chunks.map((_, i) => ({
    type: 'score', name: `c${i}`, levels: LEVELS,
    instructions: `How relevant is chunk ${i} to completing the current task?`,
  }));
  const ans = await decide(input, questions);
  const scores = chunks.map((_, i) => ans[`c${i}`]?.score);
  const rawPath = join(DATA, 'raw', `${id}.txt`);
  const pruned = applyScores(chunks, scores, rawPath);
  if (pruned.length >= text.length * 0.9) return text; // não vale a pena
  mkdirSync(join(DATA, 'raw'), { recursive: true });
  writeFileSync(rawPath, text);
  log(`pruned ${text.length} -> ${pruned.length}`);
  return pruned;
}

function tailLines(path, bytes = 200_000) {
  const size = statSync(path).size;
  const len = Math.min(size, bytes);
  const fd = openSync(path, 'r'), buf = Buffer.alloc(len);
  readSync(fd, buf, 0, len, size - len); closeSync(fd);
  return buf.toString('utf8').split('\n').filter(Boolean);
}

// Tamanho real do contexto = prompt do último turno do assistente (input + cache), vindo do campo usage.
export function ctxTokens(path) {
  for (const l of tailLines(path, 400_000).reverse()) {
    try {
      const e = JSON.parse(l), u = e.type === 'assistant' && !e.isSidechain && e.message?.usage;
      if (u) return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    } catch {}
  }
  return 0;
}

function userPrompts(path, n) {
  const size = statSync(path).size;
  for (let win = 200_000; ; win *= 4) {
    const out = [];
    for (const l of tailLines(path, win).reverse()) {
      try {
        const e = JSON.parse(l);
        const c = e.type === 'user' && e.message?.content;
        if (typeof c === 'string' && !c.startsWith('<')) out.push(c.slice(0, 600));
      } catch {}
      if (out.length >= n) break;
    }
    if (out.length || win >= size) return out.reverse();
  }
}

// Aplica fn ao texto dentro do formato da tool_response (string | {stdout} | content[] | {content[]}).
async function mapResponse(resp, fn) {
  if (typeof resp === 'string') return fn(resp);
  if (Array.isArray(resp)) {
    return Promise.all(resp.map(async (b) => (b?.type === 'text' ? { ...b, text: await fn(b.text) } : b)));
  }
  if (resp && typeof resp.stdout === 'string') return { ...resp, stdout: await fn(resp.stdout) };
  if (resp && Array.isArray(resp.content)) return { ...resp, content: await mapResponse(resp.content, fn) };
  if (resp && typeof resp.result === 'string') return { ...resp, result: await fn(resp.result) };
  log(`unknown shape: ${JSON.stringify(Object.keys(resp ?? {}))}`);
  return resp;
}

async function main() {
  if (process.env.LUNA_PRUNER_OFF === '1') return;
  const ev = JSON.parse(readFileSync(0, 'utf8'));
  let prompts = [];
  try { prompts = ev.transcript_path ? userPrompts(ev.transcript_path, 5) : []; } catch {}

  if (ev.hook_event_name === 'PostToolUse') {
    const id = ev.tool_use_id || String(Date.now());
    const last = prompts.at(-1);
    const out = await mapResponse(ev.tool_response, (t) => pruneText(t, last, id));
    if (JSON.stringify(out) !== JSON.stringify(ev.tool_response)) {
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: out } }));
    }
  } else if (ev.hook_event_name === 'UserPromptSubmit') {
    let ctx = 0;
    try { ctx = ctxTokens(ev.transcript_path); } catch {} // 1º prompt: transcript ainda não existe
    const stateFile = join(DATA, 'state', `${ev.session_id || 'x'}.json`);
    let warned = 0;
    try { warned = JSON.parse(readFileSync(stateFile, 'utf8')).warned; } catch {}
    if (ctx < warned - 20_000) warned = 0; // contexto encolheu: houve /compact ou /clear
    if (ctx < WARN_TOKENS || (warned && ctx < warned + RENAG_TOKENS)) return;
    mkdirSync(join(DATA, 'state'), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ warned: ctx }));
    let switched = false;
    try {
      const input = `Previous requests:\n${prompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nNew request:\n${ev.prompt}`;
      const ans = await decide(input, [{
        type: 'predicate', name: 'switched',
        instructions: 'Is the new request about a clearly different topic or task than the previous requests, so the earlier conversation is no longer needed?',
      }]);
      switched = (ans.switched?.probability ?? 0) > 0.5;
    } catch {} // sem Luna ainda avisa pelo tamanho
    const k = Math.round(ctx / 1000);
    console.log(JSON.stringify({ systemMessage: `luna-pruner: contexto em ${k}k tokens (cada turno relê tudo isso). ` +
      (switched ? 'O assunto mudou: `/clear` costuma ser melhor; ou `/compact`.' : 'Considere `/compact` com foco no que ainda importa.') }));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log(`fail-open: ${e.message}`); }); // fail-open: sem saída = nada muda
}
