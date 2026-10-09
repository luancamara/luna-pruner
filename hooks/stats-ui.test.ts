import { test, expect } from 'claude-code/testing'
import { parse } from './stats-ui'

const MARK = '⟦luna-stats⟧'
const STATS = {
  days: 7, calls: 12, spentTok: 48000, spentUsd: 0.0048, nPrune: 9, nSent: 14, savedTok: 410000, rereads: 9800000, savedUsd: 6.1, warns: 3, brl: 5.4,
  byTool: { Bash: { n: 6, tok: 300000, usd: 4.4 }, mcp__x__y: { n: 3, tok: 110000, usd: 1.7 } },
  byDay: { '2026-10-07': { saved: 1.2, spent: 0.001 }, '2026-10-08': { saved: 4.9, spent: 0.0038 } },
  notes: ['3.6 chars/token (estimativa)'],
}
const props = (text: string) => ({ command: 'luna-stats', args: '', text, isErrored: false, onScreen: null })

test('parse lê o JSON depois da marca e ignora texto sem marca', () => {
  expect(parse(MARK + JSON.stringify(STATS))?.calls).toBe(12)
  expect(parse('qualquer outro texto')).toBeNull()
  expect(parse(MARK + '{quebrado')).toBeNull()
})

test('painel desenha saldo, cartões e barras no terminal e no desktop', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'luna-pruner', surface, component: 'CommandOutput', props: props(MARK + JSON.stringify(STATS)) })
    expect(await ui.find({ type: 'Text', text: /SALDO LÍQUIDO/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Gasto Luna/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ECONOMIA POR FERRAMENTA/ })).toBeDefined()
    await ui.unmount()
  }
})

test('sem eventos mostra orientação em vez de painel vazio', async $ => {
  const empty = { ...STATS, calls: 0, nSent: 0, nPrune: 0, byTool: {}, byDay: {} }
  const ui = await $.ui.mount({ plugin: 'luna-pruner', surface: 'terminal', component: 'CommandOutput', props: props(MARK + JSON.stringify(empty)) })
  expect(await ui.find({ type: 'Text', text: /Ainda sem eventos/ })).toBeDefined()
  await ui.unmount()
})
