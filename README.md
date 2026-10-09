# luna-pruner: cut Claude Code token costs with a context-size meter, output pruning and a cost audit

**luna-pruner** is a [Claude Code](https://code.claude.com) plugin with four parts, ordered by how much they matter in real transcripts:

1. **Context-size meter** (UserPromptSubmit): reads the real context size and, past ~150k tokens, tells you to `/compact` or `/clear` (Luna decides which, from whether your new prompt switches topic). Long histories re-read every turn were ~80% of the cost in the transcripts I measured.
2. **Stats** (`/luna-pruner:luna-stats`): spent on Luna vs saved, in tokens, USD and BRL, from the plugin's own event log.
3. **Cost audit** (`node scripts/audit.mjs`): 100% local report of where your Claude Code spend goes: context size, fixed prefix, injected hooks/skills/MCP names, biggest tool outputs.
4. **Output pruning** (PostToolUse): keeps long, noisy tool output out of the context. OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions) (`gpt-6-luna`) scores relevance, plain code cuts, a marker points to the untouched original. Valuable for log-heavy work, small on data/code-heavy sessions.

Read [docs/findings.md](docs/findings.md) for the numbers, including what did **not** work and how this combines with RTK and Caveman.

[![test](https://github.com/luancamara/luna-pruner/actions/workflows/test.yml/badge.svg)](https://github.com/luancamara/luna-pruner/actions/workflows/test.yml) ![license](https://img.shields.io/badge/license-MIT-blue) ![node](https://img.shields.io/badge/node-%E2%89%A518-green) ![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

## Output pruning: before / after

A `Bash` command printing 1,600 lines (800 × `npm WARN deprecated ...`, one real error line, 800 × `progress N/800`), as Claude sees it:

```
npm WARN deprecated pkg1@1.0.1: no longer supported
  (… +799 linhas similares)
auth.ts: session.user is undefined after login redirect
progress 1/800 downloading
  (… +799 linhas similares)
```

Synthetic noisy logs: 67,731 chars → 190 chars. On 3 real sessions only 6 of 63 large outputs were prunable (2.6% of tool-output chars), because most were genuinely relevant. See [docs/findings.md](docs/findings.md).

## Install

```
/plugin marketplace add luancamara/luna-pruner
/plugin install luna-pruner@luna-pruner
```

Requirements: Node 18+ and `OPENAI_API_KEY` in the environment Claude Code starts from. To try it without installing: `claude --plugin-dir ./luna-pruner`.

Disable with `LUNA_PRUNER_OFF=1`. Cost audit: `node scripts/audit.mjs [sessions] [projects-dir]`. Stats: `/luna-pruner:luna-stats [--days N] [--brl 5.40]` or `node scripts/stats.mjs`. Logs and untouched originals are in `${CLAUDE_PLUGIN_DATA}` (`luna.log`, `raw/`).

## How it works

OpenAI Decisions returns typed answers (scores and probabilities), not text. So Luna **decides** and code **cuts**. Details in [docs/how-it-works.md](docs/how-it-works.md).

1. **PostToolUse hook** (`Bash`, `WebFetch`, `Grep`, `mcp__*`): outputs over ~6k chars are collapsed, split into 20-line chunks, and each chunk is scored 0-3 for relevance to your latest request. Low-scoring chunks are replaced by a marker pointing at the full original on disk. Returned to Claude via `updatedToolOutput`.
2. **UserPromptSubmit hook**: reads the real context size from the transcript `usage` fields; above `LUNA_PRUNER_WARN_TOKENS` (default 150000) it shows a one-line hint to you (not added to Claude's context), at most once per +75k tokens.

Cost: Decisions input is $0.10 per 1M tokens with no output charge, so a typical session costs fractions of a cent.

## FAQ

**How do I reduce token usage in Claude Code?**
Stop large tool outputs from entering the context. luna-pruner does this automatically with a `PostToolUse` hook; `/compact` and `/clear` handle old conversation.

**Can a Claude Code hook delete old messages from the context?**
No. Hooks can replace a tool's output before Claude sees it (`updatedToolOutput`) and add context, but they cannot edit history or trigger `/compact` / `/clear`. This plugin prunes new tool output and suggests compaction.

**What is the OpenAI Decisions API?**
`POST /v1/decisions`: fast classification/scoring with typed answers (`predicate`, `choice`, `score`). Only `gpt-6-luna` is available (public beta at time of writing). It does not generate text, so it cannot summarize.

**Is it safe? Does it send my data to OpenAI?**
Yes, tool output over the size threshold is sent to OpenAI for scoring. Output that looks like secrets (`.env`, `credentials`, private keys, `token=...`, `sk-...`) is never sent. See [SECURITY.md](SECURITY.md).

**What if Luna prunes something important?**
The first and last chunks and any chunk containing `error`, `exception`, `fail`, stack traces are always kept, and the marker names the untouched original so Claude can read it.

**What happens if the API is down or the key is missing?**
Fail-open: the output passes through unchanged.

**Does it work with other agents (Cursor, Codex, Gemini CLI)?**
Not today. It targets Claude Code's hook protocol. Ports are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Stats: spent vs saved

```
/luna-stats             # native colored panel drawn inside the conversation (mod API, no model turn)
/luna-stats --days 7    # last 7 days; --brl 5.40 to set the exchange rate
luna-stats              # same dashboard in a plain terminal (colors auto-detected)
/luna-pruner:luna-stats # plain-text fallback through the model (costs one turn)
```

`/luna-stats` uses Claude Code's experimental plugin "mod" API (`modules` in `hooks/hooks.json`, tested on Claude Code 2.1.295). If your build lacks it, the shell and fallback commands above still work.

Synthetic example (fixture data, not real usage):

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ ◆ luna-pruner  ·  gasto × economia  ·  todo o período                        │
╰──────────────────────────────────────────────────────────────────────────────╯

 SALDO LÍQUIDO
   US$ 0,0485  ≈ R$ 0,24   ▲ 486× o que gastou

╭─ Economia ─────────────╮ ╭─ Gasto Luna ───────────╮ ╭─ Podadas ──────────────╮
│ 9,0 mil tok            │ │ 1,0 mil tok            │ │ 1 de 1                 │
│ US$ 0,0486             │ │ US$ 0,0001             │ │ 100% das grandes       │
│ +18,0 mil releit.      │ │ 1 chamada              │ │ 1 aviso de ctx         │
╰────────────────────────╯ ╰────────────────────────╯ ╰────────────────────────╯

 ECONOMIA POR FERRAMENTA
  Bash           ██████████████████████████████████  9,0 mil  US$ 0,0486   1×

 POR DIA   █  economia
  10-09  ████████████████████████████████████████  US$ 0,0486   −US$ 0,0001

  3.6 chars/token (estimativa)
  preços de terceiros: confira scripts/prices.json
  cache escrito 1x + relido a cada turno até compactar
  câmbio 5.00 (informado)
```

Every Luna call and every large output is logged to `${CLAUDE_PLUGIN_DATA}/events.jsonl` (sizes and counts only, never content). `scripts/stats.mjs` joins that with your transcripts: tokens removed are counted once as a cache write plus once per following turn as a cache read, until the next compaction, priced from `scripts/prices.json`. Luna spend counts **every** call, including those that pruned nothing. USD to BRL uses a live rate (or `--brl`). The prices in `prices.json` come from third-party sites; check them against Anthropic's pricing page and edit. The context-size hints are not counted as savings, since that depends on you compacting.

## Limits

- Cannot clean old context (hooks cannot edit history).
- Chunk-level scoring can be wrong; mitigations above.
- Tool output leaves your machine. Check your data policy.
- Decisions is in public beta and the API may change; auth is an API key.
- Only the tools in the hook matcher are pruned; `Read` is excluded on purpose (pruning can break edits).

## Contributing

Issues and PRs are welcome: bug reports with a `luna.log` excerpt, unhandled tool-output shapes, better chunking, an evaluation set, ports to other agents. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). If you use this in research or writing, cite via [CITATION.cff](CITATION.cff).
