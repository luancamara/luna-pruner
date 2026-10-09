#!/usr/bin/env node
// Gasto (chamadas à Luna) vs economia (tokens que deixaram de ir pro contexto), em tokens, USD e R$.
// Uso: node scripts/stats.mjs [--days N] [--brl 5.40] [--prices arquivo.json] [--plain|--color] [--width N]
// Economia = tokens podados escritos no cache 1x + relidos em cada turno seguinte (até a próxima compactação).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { render } from './stats-render.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const days = +arg('--days', 0);
const P = JSON.parse(readFileSync(arg('--prices', join(dirname(fileURLToPath(import.meta.url)), 'prices.json')), 'utf8'));
const CHARS_PER_TOKEN = 3.6;

const dataDirs = process.env.CLAUDE_PLUGIN_DATA ? [process.env.CLAUDE_PLUGIN_DATA] : [...readdirSync(join(homedir(), '.claude/plugins/data')).filter((d) => d.startsWith('luna-pruner')).map((d) => join(homedir(), '.claude/plugins/data', d))];
const events = [];
for (const d of new Set(dataDirs)) {
  const f = join(d, 'events.jsonl');
  if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n')) if (l) try { events.push(JSON.parse(l)); } catch {}
}
const since = days ? Date.now() - days * 864e5 : 0;
const ev = events.filter((e) => e.ts >= since);


let brl = +arg('--brl', 0), brlSrc = 'informado';
if (!brl) { try { const r = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL', { signal: AbortSignal.timeout(3000) }); brl = +(await r.json()).USDBRL.bid; brlSrc = 'awesomeapi (cotação de agora)'; } catch { brl = 0; } }

// Localiza o tool_result no transcript: nº de turnos seguintes até compactar e o modelo.
const cache = new Map();
function locate(path, id) {
  if (!path || !existsSync(path)) return null;
  if (!cache.has(path)) cache.set(path, readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }));
  const ents = cache.get(path);
  const at = ents.findIndex((e) => e.type === 'user' && JSON.stringify(e.message?.content ?? '').includes(id));
  if (at < 0) return null;
  const turns = new Set(); let model = null;
  for (let i = at + 1; i < ents.length; i++) {
    const e = ents[i];
    if (e.isCompactSummary || e.subtype === 'compact_boundary') break;
    if (e.type === 'assistant' && e.message?.id && !e.isSidechain) { turns.add(e.message.id); model ??= e.message.model; }
  }
  return { later: Math.max(0, turns.size - 1), model };
}

let spentTok = 0, spentCalls = 0, saved = { tok: 0, rereads: 0, usd: 0 }, nPrune = 0, nSent = 0, noTranscript = 0, warns = 0;
const byTool = {}, byDay = {};
for (const e of ev) {
  if (e.type === 'luna') { spentTok += e.tokens; spentCalls++; (byDay[new Date(e.ts).toISOString().slice(0, 10)] ??= { spent: 0, saved: 0 }).spent += e.tokens * P.luna_input / 1e6; }
  else if (e.type === 'warn') warns++;
  else if (e.type === 'prune') {
    nSent++;
    const tok = Math.max(0, e.before - e.after) / CHARS_PER_TOKEN; if (!tok) continue;
    nPrune++;
    const loc = locate(e.transcript_path, e.tool_use_id); if (!loc) noTranscript++;
    const price = P[loc?.model] ?? P[P._fallback]; const later = loc?.later ?? 0;
    const usd = tok * (price.cw + price.cr * later) / 1e6;
    saved.tok += tok; saved.rereads += tok * later; saved.usd += usd;
    const t = (byTool[e.tool] ??= { n: 0, tok: 0, usd: 0 }); t.n++; t.tok += tok; t.usd += usd;
    (byDay[new Date(e.ts).toISOString().slice(0, 10)] ??= { spent: 0, saved: 0 }).saved += usd;
  }
}
const spentUsd = spentTok * P.luna_input / 1e6;
const wantColor = process.argv.includes('--color') || (!process.argv.includes('--plain') && !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR));
const columns = +arg('--width', 0) || process.stdout.columns || 80;
const notes = [
  `${CHARS_PER_TOKEN} chars/token (estimativa)`,
  'preços de terceiros: confira scripts/prices.json',
  'cache escrito 1x + relido a cada turno até compactar',
  ...(noTranscript ? [`${noTranscript} saída(s) sem transcript, contadas 1x`] : []),
  brl ? `câmbio ${brl.toFixed(2)} (${brlSrc})` : 'sem câmbio: use --brl 5.40',
];
console.log(render({ days, calls: spentCalls, spentTok, spentUsd, nPrune, nSent, savedTok: saved.tok, rereads: saved.rereads, savedUsd: saved.usd, warns, byTool, byDay, brl, notes }, { color: wantColor, columns }));
