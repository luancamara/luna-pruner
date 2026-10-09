# Security

## Data flow (read this before installing)

When a tool output is longer than ~6,000 characters, the plugin sends the latest user prompt (first 600 chars of up to 5 recent prompts for the compact hint) and the tool output to `https://api.openai.com/v1/decisions` using your `OPENAI_API_KEY`. Nothing else leaves your machine. The plugin never sends output matching its secret patterns (`.env`, `credentials`, `auth.json`, private keys, `token=...`/`password=...` assignments, `sk-...` keys), but pattern matching is best effort. Disable with `LUNA_PRUNER_OFF=1`.

The plugin also keeps `${CLAUDE_PLUGIN_DATA}/events.jsonl` with counts and sizes only (tokens, character counts, tool names, session ids, transcript paths); no prompt or tool-output content.

Untouched originals of pruned outputs are written to `${CLAUDE_PLUGIN_DATA}/raw/` on your disk. Delete that folder any time.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting: Security tab → "Report a vulnerability". Do not open a public issue for security problems. Expect an acknowledgement within a few days.
