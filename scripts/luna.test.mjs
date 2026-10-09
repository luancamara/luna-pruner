import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, applyScores } from './luna.mjs';

test('chunk + corte: mantém extremos e relevantes, poda ruído com marcador', () => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const chunks = chunkText(text);
  assert.equal(chunks.length, 5);
  const out = applyScores(chunks, [0, 0, 3, 0, 0], '/raw.txt');
  assert.match(out, /line 0\b/);          // primeiro mantido mesmo com score 0
  assert.match(out, /line 99\b/);        // último mantido
  assert.match(out, /line 45\b/);         // chunk relevante mantido
  assert.doesNotMatch(out, /line 25\b/);  // ruído podado
  assert.match(out, /20 linhas podadas.*\/raw\.txt/);
});

test('collapse: linhas repetitivas viram uma + contador', async () => {
  const { collapse } = await import('./luna.mjs');
  const t = ['a 1', 'a 2', 'a 3', 'b'].join('\n');
  assert.equal(collapse(t), 'a 1\n  (… +2 linhas similares)\nb');
});
