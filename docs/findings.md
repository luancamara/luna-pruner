# What the data says (and what it doesn't)

Measured on one developer's real Claude Code transcripts (80 most recent sessions, ~8,400 turns, ~110 turns/session) with `scripts/audit.mjs` and `evals/corpus.mjs`. Single user, single workload, rough token estimates (about 3.6 chars/token). Run the audit on your own transcripts before believing any of this applies to you.

Cost unit: input=1, cache write=1.25, cache read=0.1, output=5 (typical ratios, not your invoice).

## Where the cost goes

| Item | Share of total cost |
|---|---|
| Cache reads (re-reading the history every turn) | ~71% |
| Turns where context was above 200k tokens | ~81-83% |
| Fixed prefix at turn 1 (system prompt, tools, MCP names, skills, hook injections), re-read every turn | ~17% (median 70k tokens) |
| Tool outputs carried in the history | ~16% |
| Output tokens | ~12% |

Takeaway: the expensive thing is not one noisy log, it is **dragging a large history through ~100 turns**.

## Levers, ranked (estimates, upper bounds)

| Lever | Estimated saving (share of total cost) | Basis |
|---|---|---|
| Compact/clear before context passes ~150k | up to ~45% | simulation on real usage data; ignores information lost in summaries |
| Slim the fixed prefix (unused MCP connectors, skills, SessionStart hook injections) | ~3-6% | prefix ~17% of cost, roughly a third of it user-controllable |
| Caveman-style terse output | ~1.4-2.8% | output is ~12% of cost; independent tests report 12-23% fewer output tokens, the project claims more |
| RTK on supported Bash commands | ~1-2% | Bash output is a few % of cost, and only some commands are covered |
| Pruning tool outputs with Luna (this plugin) | ~0.4% | 2.6% of tool-output chars removed on 3 real sessions, tool output is ~16% of cost |
| Deterministic cleanup (ANSI, JSON minify, blobs, similar lines, duplicates) | 0.29% | measured offline on 80 sessions (`evals/corpus.mjs`) |

That ranking is why the plugin now leads with a **context-size meter** rather than output pruning.

## Output pruning: what happened in practice

- Synthetic noisy logs: 33k-67k chars reduced to ~200 chars, relevant line kept.
- Real sessions (3 sessions, 63 outputs over 6k chars): only 6 pruned, 2.6% of tool-output chars saved. Most large outputs were genuinely relevant (MCP JSON, docs, code read via `sed`).
- Splitting very long lines into chunks changed nothing (same 6/63).
- 374 of 375 identifiers that Claude cited in the next turns were still present after pruning (indirect proxy, not proof).
- Cost of the Luna calls for those 3 sessions: about US$0.03.

Pruning pays off on log-heavy work (installs, test runs, builds). It is not the main lever for data- and code-heavy sessions.

## Context-size meter

`UserPromptSubmit` reads the real context size from the transcript's `usage` fields. Above 150k tokens (`LUNA_PRUNER_WARN_TOKENS`) it prints a one-line hint (shown to you, not added to Claude's context), at most once per +75k tokens. Luna then decides whether your new prompt switches topic, to suggest `/clear` instead of `/compact`.

Detector check on real prompts (small sample): 1 of 21 same-session prompt pairs flagged as a topic switch; 7 of 12 cross-session pairs flagged at the 0.5 threshold (those sessions are all about the same company, so the true rate is probably higher than it looks).

## RTK (Rust Token Killer)

RTK rewrites Bash commands through a PreToolUse hook so the output is compact at the source. Complementary to this plugin: RTK only sees Bash; MCP, WebFetch and unknown commands never pass through it. Measured on one 2,000-file repo:

| Command | native | rtk | note |
|---|---|---|---|
| `git log -30` | 33.6k | 8.0k (-76%) | |
| `git status` | 1.2k | 0.5k (-57%) | |
| `git diff HEAD~3` | 161k | 22.8k (-85%) | **lossy**: hunks dropped, only the stat remains |
| `grep -rn import` | 368k | 14.7k (-96%) | paths abbreviated (`apps/.../x.tsx`), matches grouped |
| `find -name '*.ts'` | 113k | 2.0k (-98%) | tree format; rejected `-not` and `-exec` |
| `ls -la` | 3.2k | 8 | returned `(empty)` on a populated directory |
| `cat` / `rtk read`, `npm ls` | - | 0% | no reduction |

Use it selectively (git status/log, find, grep summaries), not for `diff`, `ls`, or anything where exact text matters. It saves tokens at the source, so it should run before any post-hoc pruning.

## Caveman and other terse-output skills

They shorten Claude's own prose, which is the ~12% output slice. Independent tests report 12-23% fewer output tokens (about 1-3% of total cost), and fidelity needs checking on your tasks. Compatible with everything here; low priority unless you already like the style.

## How the pieces combine

1. Keep sessions short (the meter nudges you). Biggest lever.
2. Trim what is injected at start (audit section 3).
3. RTK for Bash at the source, selectively.
4. luna-pruner output pruning for what is left, mainly logs.
5. Terse output last.

## Limits

One user, one workload; transcript attachment sizes are not exactly what reaches the model; token counts are estimated; long-context pricing tiers, if your plan has them, are not modeled and would make long contexts costlier; the compaction simulation assumes summaries lose nothing.
