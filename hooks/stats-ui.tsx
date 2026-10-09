// Painel nativo do /luna-stats: o comando roda scripts/stats.mjs --json e o hook de ui.render
// desenha o resultado como árvore colorida dentro da conversa (sem gastar uma volta do modelo).
import type { Register } from 'claude-code'

const NAME = 'luna-stats'
const MARK = '⟦luna-stats⟧'

type Stats = {
  days: number; calls: number; spentTok: number; spentUsd: number; nPrune: number; nSent: number
  savedTok: number; rereads: number; savedUsd: number; warns: number; brl: number
  byTool: Record<string, { n: number; tok: number; usd: number }>
  byDay: Record<string, { saved: number; spent: number }>
  notes: string[]
}

const GREEN = '#4ade80', RED = '#fb7163', CYAN = '#38bdf8', VIOLET = '#a78bfa', GRAY = '#94a3b8'

const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace('.', ',')} mil` : String(Math.round(n)))
const money = (x: number, cur: string) => `${cur} ${x.toLocaleString('pt-BR', { minimumFractionDigits: x < 0.1 ? 4 : 2, maximumFractionDigits: x < 0.1 ? 4 : 2 })}`
const times = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('pt-BR') : x.toFixed(1).replace('.', ',')) + '×'
const mix = (a: number[], b: number[], k: number) => '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('')

export const parse = (text: string): Stats | null => {
  const at = text.indexOf(MARK)
  if (at < 0) return null
  try { return JSON.parse(text.slice(at + MARK.length)) as Stats } catch { return null }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: NAME,
      description: 'Painel de gasto × economia do luna-pruner (tokens, USD, R$)',
      argumentHint: '[--days N] [--brl 5.40]',
    })
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const args = e.args.split(/\s+/).filter(Boolean)
    const run = await $.process.run(['node', `${$.plugin.root}/scripts/stats.mjs`, '--json', ...args], { timeoutMs: 15000 })
    if (run.exitCode !== 0) return { text: `luna-stats falhou (${run.exitCode}): ${run.stderr.slice(0, 200)}` }
    return { text: MARK + run.stdout.trim() }
  }).catch(() => ({ text: 'luna-stats falhou' }))

  on('ui.render', { component: 'CommandOutput', props: { command: NAME } }, ($, e, next) => {
    const s = parse(e.props.text)
    if (!s) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const cols = Math.max(60, Math.min((e.viewport?.columns ?? 80) - 4, 100))
    const net = s.savedUsd - s.spentUsd
    const fx = (usd: number) => (s.brl ? <Text dimColor>  ≈ {money(usd * s.brl, 'R$')}</Text> : null)

    const bar = (frac: number, cells: number, from = [74, 222, 128], to = [56, 189, 248]) => {
      const full = Math.max(0, Math.min(cells, Math.round(frac * cells)))
      return (
        <Text>
          {Array.from({ length: full }, (_, i) => (
            <Text color={mix(from, to, cells > 1 ? i / (cells - 1) : 0)}>█</Text>
          ))}
          <Text dimColor>{'░'.repeat(cells - full)}</Text>
        </Text>
      )
    }

    const card = (title: string, color: string, big: string, l2: string, l3: string) => (
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={color} paddingX={1}>
        <Text color={color} bold>{title}</Text>
        <Text bold color={color}>{big}</Text>
        <Text color={GRAY}>{l2}</Text>
        <Text dimColor>{l3}</Text>
      </Box>
    )

    const tools = Object.entries(s.byTool).sort((a, b) => b[1].usd - a[1].usd).slice(0, 6)
    const toolMax = Math.max(...tools.map(([, v]) => v.usd), 1e-12)
    const days = Object.entries(s.byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-7)
    const dayMax = Math.max(...days.map(([, v]) => Math.max(v.saved, v.spent)), 1e-12)
    const barW = Math.max(10, cols - 44)

    if (!s.calls && !s.nSent) {
      return (
        <Box flexDirection="column" width={cols}>
          <Box borderStyle="round" borderColor={CYAN} paddingX={1}><Text bold color={CYAN}>◆ luna-pruner</Text></Box>
          <Text color="#fbbf24">Ainda sem eventos. <Text dimColor>Use o plugin numa sessão (saídas grandes de tools) e rode de novo.</Text></Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={cols}>
        <Box borderStyle="round" borderColor={CYAN} paddingX={1}>
          <Text bold color={CYAN}>◆ luna-pruner</Text>
          <Text dimColor>  ·  gasto × economia  ·  </Text>
          <Text color={GRAY}>{s.days ? `últimos ${s.days} dias` : 'todo o período'}</Text>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text dimColor> SALDO LÍQUIDO</Text>
          <Text>
            {'   '}<Text bold color={net >= 0 ? GREEN : RED}>{money(net, 'US$')}</Text>
            {fx(net)}
            {s.spentUsd > 0 ? <Text bold color={GREEN}>{'   ▲ '}{times(s.savedUsd / s.spentUsd)}<Text dimColor> o que gastou</Text></Text> : null}
          </Text>
        </Box>

        <Box marginTop={1} gap={1}>
          {card('Economia', GREEN, `${tok(s.savedTok)} tok`, money(s.savedUsd, 'US$'), `+${tok(s.rereads)} releit.`)}
          {card('Gasto Luna', RED, `${tok(s.spentTok)} tok`, money(s.spentUsd, 'US$'), `${s.calls} ${s.calls === 1 ? 'chamada' : 'chamadas'}`)}
          {card('Podadas', VIOLET, `${s.nPrune} de ${s.nSent}`, s.nSent ? `${Math.round((100 * s.nPrune) / s.nSent)}% das grandes` : '—', `${s.warns} ${s.warns === 1 ? 'aviso' : 'avisos'} de ctx`)}
        </Box>

        {tools.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor> ECONOMIA POR FERRAMENTA</Text>
            {tools.map(([name, v]) => (
              <Text>
                {'  '}<Text bold>{name.replace(/^mcp__/, 'mcp:').slice(0, 14).padEnd(14)}</Text>{' '}
                {bar(v.usd / toolMax, barW)}{' '}
                {tok(v.tok).padStart(8)}{' '}{money(v.usd, 'US$').padStart(11)} <Text dimColor>{`${v.n}×`.padStart(4)}</Text>
              </Text>
            ))}
          </Box>
        )}

        {days.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor> POR DIA</Text>
            {days.map(([d, v]) => (
              <Text>
                {'  '}<Text color={GRAY}>{d.slice(5)}</Text>{'  '}{bar(v.saved / dayMax, barW)}{' '}
                <Text color={GREEN}>{money(v.saved, 'US$').padStart(11)}</Text>{'  '}
                <Text color={RED}>{('−' + money(v.spent, 'US$')).padStart(12)}</Text>
              </Text>
            ))}
          </Box>
        )}

        <Box marginTop={1}><Text dimColor wrap="wrap">{s.notes.join(' · ')}</Text></Box>
      </Box>
    )
  })
}
