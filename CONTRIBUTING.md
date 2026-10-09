# Contributing

Thanks for helping. This is a small, dependency-free project; keep it that way unless there is a strong reason.

## Setup

```
git clone https://github.com/luancamara/luna-pruner && cd luna-pruner
node --test scripts/luna.test.mjs        # unit tests, no network
claude --plugin-dir .                    # try it in a real session (needs OPENAI_API_KEY)
```

## Good first contributions

- Handle a tool-output shape that logs `unknown shape` in `luna.log` (attach the shape, never the content).
- Env overrides for the constants in `scripts/luna.mjs`.
- English (or configurable) marker text.
- Run `node scripts/audit.mjs` and `node evals/corpus.mjs` on your own transcripts and share (anonymized) numbers in Discussions: the findings so far come from one user.
- A recall benchmark for output pruning: tasks + noisy logs + expected kept lines.
- Ports of the idea to other agent hook systems.

## Pull requests

1. Open an issue first for anything bigger than a small fix.
2. Add or update a test in `scripts/luna.test.mjs` for logic changes. Pure functions (`collapse`, `chunkText`, `applyScores`) are exported for that; keep network out of tests.
3. Keep the **fail-open** rule: on any error, emit nothing.
4. Never log or commit tool output, prompts, or keys. Logs carry sizes and counts only.
5. Update README/docs if behavior changes. CI must be green.

## Reporting bugs

Use the bug template. Include Claude Code version, Node version, and the relevant `luna.log` lines. Redact anything sensitive.

By contributing you agree your work is licensed under the MIT License.
