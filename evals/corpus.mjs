#!/usr/bin/env node
// Mede, offline e sem rede, quanto cada estágio determinístico economiza nos seus transcripts reais.
// Uso: node evals/corpus.mjs [N sessões mais recentes = 80] [dir = ~/.claude/projects]
// Custo em "unidades de input": input=1, cache_write=1.25, cache_read=0.1, output=5.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { stripNoise, minifyJson, truncateBlobs, collapse } from './squeeze.mjs';

const N = +process.argv[2] || 80;
const root = process.argv[3] || join(homedir(), '.claude/projects');
// estimativa de tokens: texto ~3.6 chars/token; cada run de espaço/indentação ~0.7 token (aproximação, sem tokenizer)
const tok = (s) => s.replace(/\s+/g, '').length / 3.6 + (s.match(/\s+/g)?.length ?? 0) * 0.7;
const STAGES = [
  ['ansi+CR', stripNoise, true],
  ['json compacto', minifyJson, true],
  ['blobs', truncateBlobs, true],
  ['linhas similares', collapse, true],
];
const files = [];
for (const d of readdirSync(root)) {
  const dir = join(root, d);
  try { for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) { const p = join(dir, f), s = statSync(p); if (s.size > 200_000 && s.size < 30_000_000) files.push({ p, mtime: s.mtimeMs }); } } catch {}
}
files.sort((a, b) => b.mtime - a.mtime);

let total = 0;
const saved = Object.fromEntries([...STAGES.map((s) => s[0]), 'duplicadas (qualquer tool)'].map((k) => [k, 0]));
const byTool = {};
for (const f of files.slice(0, N)) {
  const ents = readFileSync(f.p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const last = new Map();
  ents.forEach((e, i) => { if (e.type === 'assistant' && e.message?.id && e.message.usage) last.set(e.message.id, { i, u: e.message.usage }); });
  for (const { u } of last.values()) total += (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 5 * (u.output_tokens || 0);
  const turnIdx = [...last.values()].map((v) => v.i);
  const bounds = ents.map((e, i) => (e.isCompactSummary || e.subtype === 'compact_boundary' ? i : -1)).filter((i) => i >= 0);
  const later = (i) => { const b = bounds.find((x) => x > i) ?? Infinity; return turnIdx.filter((t) => t > i && t < b).length; };
  const w = (i) => 1.25 + 0.1 * later(i);
  const names = new Map(); let seen = new Map(); let lastBound = -1;
  ents.forEach((e, i) => {
    if (bounds.includes(i)) { seen = new Map(); lastBound = i; }
    const c = e.message?.content;
    if (e.type === 'assistant' && Array.isArray(c)) for (const b of c) if (b.type === 'tool_use') names.set(b.id, b.name);
    if (e.type === 'user' && Array.isArray(c)) for (const b of c) if (b.type === 'tool_result') {
      let t = typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x.text || '').join('');
      const name = names.get(b.tool_use_id) || '?';
      const kind = name === 'Bash' || name === 'Grep' || name === 'WebFetch' || name.startsWith('mcp__') ? 'estágios' : 'dedupe';
      let cur = t;
      if (kind === 'estágios') for (const [label, fn] of STAGES) {
        const nxt = fn(cur); const d = Math.max(0, tok(cur) - tok(nxt)) * w(i);
        saved[label] += d; byTool[name.startsWith('mcp__') ? 'mcp' : name] = (byTool[name.startsWith('mcp__') ? 'mcp' : name] || 0) + d; cur = nxt;
      }
      if (t.length > 500) {
        if (seen.has(t)) saved['duplicadas (qualquer tool)'] += Math.max(0, tok(t) - 25) * w(i);
        else seen.set(t, i);
      }
    }
  });
}
const pct = (x) => (100 * x / total).toFixed(2) + '%';
console.log(`sessões analisadas: ${Math.min(N, files.length)} | custo total: ${(total / 1e6).toFixed(0)}M unidades-input`);
console.table(Object.entries(saved).map(([k, v]) => ({ estágio: k, 'economia (% do custo total)': pct(v) })));
console.log('soma dos estágios determinísticos:', pct(Object.values(saved).reduce((a, b) => a + b, 0)));
console.log('por tool (estágios):', Object.fromEntries(Object.entries(byTool).map(([k, v]) => [k, pct(v)])));
