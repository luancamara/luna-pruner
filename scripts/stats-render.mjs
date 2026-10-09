// Desenho do painel de estatísticas: puro (dados -> string). Cor ANSI truecolor opcional; sem cor vira Unicode puro.
const ESC = '\x1b[';
export const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const width = (s) => [...visible(s)].length;
const padR = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
const clip = (s, n) => { const a = [...s]; return a.length <= n ? s : a.slice(0, Math.max(0, n - 1)).join('') + '…'; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const padL = (s, n) => ' '.repeat(Math.max(0, n - width(s))) + s;

export function theme(color) {
  const sgr = (code) => (s) => (color ? `${ESC}${code}m${s}${ESC}0m` : s);
  const rgb = (r, g, b) => sgr(`38;2;${r};${g};${b}`);
  return { bold: sgr('1'), dim: sgr('2'), green: rgb(74, 222, 128), red: rgb(251, 113, 99), amber: rgb(251, 191, 36), cyan: rgb(56, 189, 248), violet: rgb(167, 139, 250), gray: rgb(148, 163, 184), color };
}

const BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
// Barra horizontal com resolução de 1/8 de célula; com cor, degradê entre dois tons.
export function bar(frac, cells, t, from = [74, 222, 128], to = [56, 189, 248]) {
  const f = Math.max(0, Math.min(1, frac)), eighths = Math.round(f * cells * 8);
  const full = Math.floor(eighths / 8), part = BLOCKS[eighths % 8];
  let out = '';
  for (let i = 0; i < full; i++) {
    const k = cells > 1 ? i / (cells - 1) : 0, c = from.map((v, j) => Math.round(v + (to[j] - v) * k));
    out += t.color ? `${ESC}38;2;${c[0]};${c[1]};${c[2]}m█${ESC}0m` : '█';
  }
  if (part) out += t.color ? `${ESC}38;2;${to[0]};${to[1]};${to[2]}m${part}${ESC}0m` : part;
  return out + t.dim('░'.repeat(Math.max(0, cells - full - (part ? 1 : 0))));
}
const SPARK = '▁▂▃▄▅▆▇█';
export const spark = (vals) => { const m = Math.max(...vals, 1e-12); return vals.map((v) => SPARK[Math.min(7, Math.floor((v / m) * 7.999))]).join(''); };

export const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2).replace('.', ',') + ' mi' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.', ',') + ' mil' : String(Math.round(n)));
export const fmtUsd = (x) => 'US$ ' + x.toLocaleString('pt-BR', { minimumFractionDigits: x < 0.1 ? 4 : 2, maximumFractionDigits: x < 0.1 ? 4 : 2 });
export const fmtBrl = (x) => 'R$ ' + x.toLocaleString('pt-BR', { minimumFractionDigits: x < 0.1 ? 4 : 2, maximumFractionDigits: x < 0.1 ? 4 : 2 });
const fmtX = (x) => (x >= 100 ? Math.round(x).toLocaleString('pt-BR') : x.toFixed(1).replace('.', ',')) + '×';

function box(lines, w, t, title = '', tone = 'gray') {
  const tl = title ? ` ${title} ` : '';
  const top = '╭─' + tl + '─'.repeat(Math.max(0, w - 3 - width(tl))) + '╮';
  const body = lines.map((l) => t[tone]('│') + ' ' + padR(l, w - 4) + ' ' + t[tone]('│'));
  return [t[tone](top), ...body, t[tone]('╰' + '─'.repeat(w - 2) + '╯')];
}
const sideBySide = (cols, gap) => {
  const h = Math.max(...cols.map((c) => c.length));
  return Array.from({ length: h }, (_, i) => cols.map((c, k) => c[i] ?? ' '.repeat(width(c[0]))).join(' '.repeat(gap)));
};

export function render(R, { color = false, columns = 80 } = {}) {
  const t = theme(color), W = Math.max(60, Math.min(columns, 100)), out = [];
  const brl = (usd) => (R.brl ? t.dim('  ≈ ' + fmtBrl(usd * R.brl)) : '');
  const period = R.days ? `últimos ${R.days} dias` : 'todo o período';

  // cabeçalho
  out.push(...box([t.bold(t.cyan('◆ luna-pruner')) + t.dim('  ·  gasto × economia  ·  ') + t.gray(period)], W, t, '', 'cyan'));
  if (!R.calls && !R.nSent) {
    out.push('', '  ' + t.amber('Ainda sem eventos.') + t.dim(' Use o plugin numa sessão (saídas grandes de tools) e rode de novo.'), '');
    return out.join('\n');
  }

  // herói: saldo
  const net = R.savedUsd - R.spentUsd;
  out.push('', ' ' + t.dim('SALDO LÍQUIDO'));
  out.push('   ' + (net >= 0 ? t.bold(t.green(fmtUsd(net))) : t.bold(t.red(fmtUsd(net)))) + brl(net) + (R.spentUsd ? '   ' + t.bold(t.green('▲ ' + fmtX(R.savedUsd / R.spentUsd))) + t.dim(' o que gastou') : ''));

  // cartões
  const cw = Math.floor((W - 2) / 3), inner = cw - 4;
  const card = (title, tone, big, l2, l3) => box([t.bold(t[tone](clip(big, inner))), t.gray(clip(l2, inner)), t.dim(clip(l3, inner))], cw, t, title, tone);
  out.push('', ...sideBySide([
    card('Economia', 'green', fmtTok(R.savedTok) + ' tok', fmtUsd(R.savedUsd), `+${fmtTok(R.rereads)} releit.`),
    card('Gasto Luna', 'red', fmtTok(R.spentTok) + ' tok', fmtUsd(R.spentUsd), plural(R.calls, 'chamada', 'chamadas')),
    card('Podadas', 'violet', `${R.nPrune} de ${R.nSent}`, R.nSent ? Math.round((100 * R.nPrune) / R.nSent) + '% das grandes' : '—', plural(R.warns, 'aviso', 'avisos') + ' de ctx'),
  ], 1));

  // por ferramenta
  const tools = Object.entries(R.byTool).sort((a, b) => b[1].usd - a[1].usd);
  if (tools.length) {
    out.push('', ' ' + t.dim('ECONOMIA POR FERRAMENTA'));
    const max = Math.max(...tools.map(([, v]) => v.usd)), bw = Math.max(10, W - 46);
    for (const [name, v] of tools.slice(0, 6)) out.push(`  ${padR(t.bold(name.replace(/^mcp__/, 'mcp:').slice(0, 14)), 14)} ${bar(v.usd / max, bw, t)} ${padL(fmtTok(v.tok), 8)} ${padL(fmtUsd(v.usd), 11)} ${t.dim(padL(v.n + '×', 4))}`);
  }

  // por dia
  const days = Object.entries(R.byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  if (days.length) {
    out.push('', ' ' + t.dim('POR DIA') + '   ' + t.green(spark(days.map(([, v]) => v.saved))) + t.dim('  economia'));
    const max = Math.max(...days.map(([, v]) => Math.max(v.saved, v.spent)), 1e-12), bw = Math.max(10, W - 40);
    for (const [d, v] of days) out.push(`  ${t.gray(d.slice(5))}  ${bar(v.saved / max, bw, t)} ${t.green(padL(fmtUsd(v.saved), 11))}  ${t.red(padL('−' + fmtUsd(v.spent), 12))}`);
  }

  // rodapé
  const foot = []; let cur = '';
  for (const n of R.notes) { if (cur && width(cur + ' · ' + n) > W - 4) { foot.push(cur); cur = n; } else cur = cur ? cur + ' · ' + n : n; }
  if (cur) foot.push(cur);
  out.push('', ...foot.map((l) => t.dim('  ' + l)));
  return out.join('\n');
}
