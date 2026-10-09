# How luna-pruner works

## Why Decisions + code instead of an LLM summary

The Decisions API (`POST /v1/decisions`, model `gpt-6-luna`) answers typed questions (`predicate`, `choice`, `score`) and bills input tokens only ($0.10 / 1M). It cannot write text. That is a feature here: the model only ranks, so the output Claude sees is always a verbatim subset of the original plus an explicit marker. No paraphrase, no hallucinated log lines.

## PostToolUse pipeline (`scripts/luna.mjs`)

1. Read the hook event from stdin. Find the tool text in `tool_response` (string, `{stdout}`, content blocks, or `{content}`/`{result}`). Unknown shape: log `unknown shape` and pass through.
2. Skip if shorter than `MIN_CHARS` (6000), if no user prompt is found in the transcript, or if the text looks like it contains secrets.
3. `collapse()`: consecutive lines identical after replacing digits with `#` become the first line plus `(… +N linhas similares)`. This stops one relevant line from being diluted inside a chunk of noise.
4. `chunkText()`: chunks of 20 lines (at most 40 chunks).
5. One Decisions call: `input` = latest user prompt + numbered chunks; one `score` question per chunk with levels 0-3.
6. `applyScores()`: keep chunk if first, last, score ≥ 0.5, or matches `KEEP_RE` (error-like words, `at file:line`). Replace dropped runs with `[… N linhas podadas por luna-pruner; original: <path>]`.
7. If the result is not at least 10% smaller, return the original untouched. Otherwise write the full original to `${CLAUDE_PLUGIN_DATA}/raw/<tool_use_id>.txt` and emit `updatedToolOutput`.
8. Any error (timeout 8s, HTTP error, bad key) is logged and nothing is emitted: fail-open.

## UserPromptSubmit

If the transcript file is over `TRANSCRIPT_LIMIT` (400 KB, roughly 100k tokens), one `predicate` question asks whether the new prompt is about a clearly different topic than the last five prompts. Above 0.8 probability it emits a `systemMessage` suggesting `/compact` or `/clear`.

## Tuning

Constants at the top of `scripts/luna.mjs` (`MIN_CHARS`, `CHUNK_LINES`, `DROP_BELOW`, `TIMEOUT_MS`, `TRANSCRIPT_LIMIT`, `KEEP_RE`, `SECRET_RE`). There is no config file yet; a PR adding env overrides is welcome.

## Known gaps

- Scoring is per chunk, so a relevant line surrounded by dissimilar noise can still score low. The error-word safety net covers the common case.
- Hook matcher excludes `Read`/`Edit`/`Write` on purpose.
- Marker text is in Portuguese; localization is a good first PR.
- Claude Code may truncate or persist very large outputs on its own before or after hooks; behavior is version dependent.
