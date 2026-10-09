// Estágios determinísticos (sem rede, sem custo): rodam antes da Luna.
// Cada função é pura: string -> string, e só remove redundância (nunca reescreve conteúdo).

// ANSI/OSC e progresso com \r (o terminal mostra só o último trecho de cada linha).
export function stripNoise(text) {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .split('\n').map((l) => (l.includes('\r') ? l.split('\r').filter(Boolean).pop() ?? '' : l)).join('\n');
}

// JSON indentado -> JSON compacto (mesmo conteúdo, bem menos tokens de espaço).
export function minifyJson(text) {
  const t = text.trim();
  if (t.length < 200 || !/^[[{]/.test(t)) return text;
  try { return JSON.stringify(JSON.parse(t)); } catch { return text; }
}

// Blobs sem espaço (base64, data URI, hashes enormes): mantém o começo e marca o resto.
export function truncateBlobs(text, max = 400, keep = 120) {
  return text.replace(new RegExp(`[^\\s"',;:()<>]{${max},}`, 'g'), (m) => `${m.slice(0, keep)}[… ${m.length - keep} chars de blob omitidos]`);
}

// Linhas consecutivas de mesmo formato (só números mudam) viram a primeira + contador.
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

export const squeeze = (text) => collapse(truncateBlobs(minifyJson(stripNoise(text))));
