# luna-pruner

A [Claude Code](https://code.claude.com) plugin that keeps noisy tool output out of Claude's context, using OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions) (`gpt-6-luna`) as the relevance judge.

Long `npm install` logs, `ls` dumps, scraped pages and verbose MCP responses burn tokens and bury the one line that matters. This plugin cuts the noise **before Claude reads it**.

## How it works

Decisions returns typed answers (scores, probabilities), not text. So Luna **decides** and plain code **cuts**:

1. **PostToolUse** (`Bash`, `WebFetch`, `Grep`, `mcp__*`): outputs over ~6k chars are collapsed (runs of same-shaped lines become `… +N similar lines`), split into 20-line chunks, and Luna scores each chunk 0-3 for relevance to your latest request. Chunks scoring below 0.5 are replaced by a marker pointing at the full original, saved on disk. The first and last chunks and any chunk mentioning `error`/`exception`/`fail`/stack traces are always kept.
2. **UserPromptSubmit**: when the transcript is large and your new prompt is about a clearly different topic, it shows a hint to run `/compact` or `/clear`.

Measured in live Claude Code sessions: a 67k-char log became 190 chars (the relevant line kept, ~300 tokens sent to Luna); a 99k-char `ls` listing became 57k and Claude recovered the answer via the original-file path in the marker. Decisions input costs $0.10 per 1M tokens, so this is typically fractions of a cent per session.

## Install

```
/plugin marketplace add luancamara/luna-pruner
/plugin install luna-pruner@luna-pruner
```

Requires Node 18+ and `OPENAI_API_KEY` in the environment Claude Code starts from. Try without installing: `claude --plugin-dir ./luna-pruner`.

Set `LUNA_PRUNER_OFF=1` to disable. Logs and originals live in `${CLAUDE_PLUGIN_DATA}` (`luna.log`, `raw/`).

## Limits (read these)

- **Hooks cannot edit history.** Claude Code gives no hook that deletes past messages or runs `/compact` / `/clear` for you. This plugin prunes *new* tool output and suggests compaction; it does not clean old context.
- **Pruning can be wrong.** Chunk scoring can hide a relevant line. Mitigations: error-keyword safety net, first/last chunks kept, and the marker always points to the untouched original. If Claude seems to be missing something, ask it to read that file.
- **Privacy.** Tool output is sent to OpenAI. Outputs that look like secrets (`.env`, `credentials`, private keys, `token=...` assignments, `sk-...`) are never sent, but check this fits your data policy.
- **Fail-open.** Timeout (8s), API error, missing key or unknown output shape: the output passes through unchanged.
- Decisions is in public beta; the API may change. Auth is an API key (ChatGPT login is not documented for this endpoint).

## Develop

```
node --test scripts/luna.test.mjs
```

One dependency-free script: `scripts/luna.mjs`. PRs welcome, especially: tool-output shapes that aren't handled (see `unknown shape` in `luna.log`), better chunking, an eval set.

## License

MIT
