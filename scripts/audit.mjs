#!/usr/bin/env node
// Para onde vai o custo dos seus sessões do Claude Code? 100% local, sem rede.
// Uso: node scripts/audit.mjs [N sessões recentes = 60] [dir = ~/.claude/projects]
// Custo em unidades de input: input=1, cache_write=1.25, cache_read=0.1, output=5 (razões típicas da Anthropic).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const N = +process.argv[2] || 60;
const root = process.argv[3] || join(homedir(), '.claude/projects');
const files = [];
for (const d of readdirSync(root)) {
  try { for (const f of readdirSync(join(root, d))) if (f.endsWith('.jsonl')) { const p = join(root, d, f), s = statSync(p); if (s.size > 200_000 && s.size < 30_000_000) files.push({ p, m: s.mtimeMs }); } } catch {}
}
files.sort((a, b) => b.m - a.m);

const cost = (u) => 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + (u.input_tokens || 0) + 5 * (u.output_tokens || 0);
const ctxOf = (u) => (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
let total = 0, turns = 0, sessions = 0, out = 0, cread = 0, prefix = 0;
const bySize = { '<100k': 0, '100-150k': 0, '150-200k': 0, '>200k': 0 };
const att = {}, hooks = {}, tools = {}, runs = [];
for (const f of files.slice(0, N)) {
  const last = new Map(), ents = [];
  for (const l of readFileSync(f.p, 'utf8').split('\n')) { if (!l) continue; try { ents.push(JSON.parse(l)); } catch {} }
  for (const e of ents) if (e.type === 'assistant' && e.message?.id && e.message.usage && !e.isSidechain) last.set(e.message.id, e.message.usage);
  const us = [...last.values()]; if (us.length < 5) continue;
  sessions++; runs.push(us);
  const base = ctxOf(us[0]);
  us.forEach((u, i) => {
    const c = cost(u), x = ctxOf(u); total += c; turns++; out += 5 * (u.output_tokens || 0); cread += 0.1 * (u.cache_read_input_tokens || 0);
    bySize[x < 1e5 ? '<100k' : x < 1.5e5 ? '100-150k' : x < 2e5 ? '150-200k' : '>200k'] += c;
    prefix += i === 0 ? 1.25 * base : 0.1 * Math.min(base, u.cache_read_input_tokens || 0);
  });
  const names = new Map();
  for (const e of ents) {
    const c = e.message?.content;
    if (e.type === 'attachment') { const a = e.attachment || {}; const k = a.type || '?'; const n = JSON.stringify(a).length; (att[k] ??= { n: 0, ch: 0 }).n++; att[k].ch += n;
      if (a.type === 'hook_success' && a.hookEvent === 'SessionStart') { const h = (a.hookName || '') + ' | ' + (a.command || '').replace(/\s+/g, ' ').slice(0, 50); (hooks[h] ??= { n: 0, ch: 0 }).n++; hooks[h].ch += (a.content || a.stdout || '').length; } }
    if (e.type === 'assistant' && Array.isArray(c)) for (const b of c) if (b.type === 'tool_use') names.set(b.id, b.name.startsWith('mcp__') ? 'mcp' : b.name);
    if (e.type === 'user' && Array.isArray(c)) for (const b of c) if (b.type === 'tool_result') { const t = typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x.text || '').join(''); const k = names.get(b.tool_use_id) || '?'; (tools[k] ??= { n: 0, ch: 0 }).n++; tools[k].ch += t.length; }
  }
}
// simulação: compactar quando o contexto passa de T (volta a prefixo+10k)
const sim = (T) => { let s = 0; for (const us of runs) { const base = ctxOf(us[0]); let ctx = null, prev = null; for (const u of us) { const d = prev === null ? 0 : Math.max(0, ctxOf(u) - prev); prev = ctxOf(u); ctx = ctx === null ? ctxOf(u) : ctx + d; if (ctx > T) { ctx = base + 1e4; s += 25000 + 1.25 * ctx; } s += 0.1 * ctx + 1.25 * d + 5 * (u.output_tokens || 0); } } return s; };
const p = (x) => (100 * x / total).toFixed(1) + '%';
const kt = (ch) => Math.round(ch / 3.6 / 1000) + 'k tok';
console.log(`\n== ${sessions} sessões, ${turns} turnos (média ${(turns / sessions).toFixed(0)} turnos/sessão) ==`);
console.log(`\n1) Custo por tamanho do contexto no turno:`); console.table(Object.fromEntries(Object.entries(bySize).map(([k, v]) => [k, p(v)])));
console.log(`2) Releitura de cache: ${p(cread)} do custo | output: ${p(out)} | prefixo fixo (1º turno, relido todo turno): ${p(prefix)}`);
console.log(`\n3) Contexto injetado por sessão (média por sessão, anexos do transcript):`);
console.table(Object.entries(att).filter(([, v]) => v.ch / sessions > 3000).sort((a, b) => b[1].ch - a[1].ch).slice(0, 6).map(([k, v]) => ({ tipo: k, eventos: v.n, 'por sessão': kt(v.ch / sessions) })));
console.log('   Hooks de SessionStart que injetam contexto (por disparo):');
console.table(Object.entries(hooks).sort((a, b) => b[1].ch - a[1].ch).slice(0, 5).map(([k, v]) => ({ hook: k.slice(0, 70), disparos: v.n, 'por disparo': kt(v.ch / v.n) })));
const tr = Object.entries(tools).sort((a, b) => b[1].ch - a[1].ch).slice(0, 5);
console.log(`4) Maiores fontes de saída de tool (chars): ` + tr.map(([k, v]) => `${k} ${(v.ch / 1e6).toFixed(1)}M`).join(' | '));
const real = total, s150 = sim(150e3), s200 = sim(200e3);
console.log(`\n5) Simulação (modelo simples, ignora perda de informação): compactar ao passar de 150k -> custo ${(100 * s150 / real).toFixed(0)}% do atual; de 200k -> ${(100 * s200 / real).toFixed(0)}%.`);
console.log('\nAlavancas, da maior para a menor: encurtar o histórico (/compact, /clear, sessões menores), enxugar o contexto injetado (MCPs, skills e hooks de SessionStart que você não usa), só depois podar saídas de tools.\n');
