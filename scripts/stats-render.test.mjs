import test from 'node:test';
import assert from 'node:assert/strict';
import { render, visible, spark, bar, theme } from './stats-render.mjs';

const R = {
  days: 7, calls: 12, spentTok: 48000, spentUsd: 0.0048, nPrune: 9, nSent: 14, savedTok: 410000, rereads: 9_800_000, savedUsd: 6.1, warns: 3, brl: 5.4,
  byTool: { Bash: { n: 6, tok: 300000, usd: 4.4 }, mcp__x__y: { n: 3, tok: 110000, usd: 1.7 } },
  byDay: { '2026-10-07': { saved: 1.2, spent: 0.001 }, '2026-10-08': { saved: 4.9, spent: 0.0038 } },
  notes: ['3.6 chars/token (estimativa)', 'preços de terceiros'],
};

test('cor removida == modo plano, em qualquer largura', () => {
  for (const columns of [60, 80, 100, 140]) {
    const plain = render(R, { color: false, columns }), colored = render(R, { color: true, columns });
    assert.equal(visible(colored), plain);
    assert.ok(!/\x1b/.test(plain));
  }
});

test('linhas das caixas têm largura constante (nada estoura a borda)', () => {
  const lines = render(R, { color: false, columns: 80 }).split('\n').filter((l) => /^[╭│╰]/.test(l));
  assert.ok(lines.length >= 8);
  const w = new Set(lines.filter((l) => /^[╭╰]/.test(l) && !/─ .* ─/.test(l.slice(0, 4))).map((l) => [...l].length));
  for (const l of lines) assert.ok([...l].length <= 80, l);
});

test('estado vazio mostra orientação e não quebra', () => {
  const out = render({ ...R, calls: 0, nSent: 0, nPrune: 0, byTool: {}, byDay: {} }, { columns: 80 });
  assert.match(out, /Ainda sem eventos/);
});

test('barra e sparkline', () => {
  assert.equal([...bar(0.5, 10, theme(false))].length, 10);
  assert.equal(spark([0, 1, 2, 4, 8]).length, 5);
  assert.equal(spark([0, 8])[1], '█');
});
