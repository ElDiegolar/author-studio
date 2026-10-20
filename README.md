# Author Studio

AI-assisted novel development where the book is a database, the characters are souls, the AI proposes and the author disposes.

Everything lives as plain JSON and Markdown in a project folder you own and can edit by hand:

```
my-novel/
  project.json premise.json world.json characters.json scenes.json facts.json style.json
  events/<characterId>.jsonl       the character's soul: append-only, replayed into state
  souls/<characterId>/<name>.jsonl saved snapshots (base, after-ch1, before-reset-…)
  manuscript/<sceneId>/v1.md v2.md every version of every scene
```

## What it does

- **Spec**: project, premise, voice, world entries, character sheets, scene cards.
- **Souls with a knowledge horizon**: a character's state is replayed from events up to any scene, so you can talk to them "as of chapter 5" and they do not know chapter 20. A deterministic leak detector flags answers that mention things introduced later.
- **Psychological mirror**: a per-character model of values, fears, defences, attachment, moral lines, decision style, blind spot. Stored on the soul.
- **Agency, togglable per character**: ticked characters decide what they would do (from their psyche and horizon); the rest adhere to the drafter or the author. Used by the muse and by drafting.
- **Muse**: ideas for writer's block grounded in the souls and an optional scenario.
- **Drafting**: scene prose from the card, the souls as they stand, the continuity ledger and your style profile. Every AI edit is shown as a diff; you accept by saving.
- **Style developed from the writer**: measured stats plus a distilled style sheet from your samples. Every time you edit an AI draft and save, the edit becomes a sample.
- **Accept**: facts are extracted into a continuity ledger and each present character witnesses the scene (their soul grows).
- **Verify**: deterministic checks, no model: length, banned words, POV, tense, absent characters acting, continuity contradictions, timeline.
- **Proofread**, **export** to Markdown, **seed** original characters in the mould of a named reference.
- **Soul save / restore / reset to base**: snapshots of a character's whole life; reset keeps the sheet and archives the rest.
- **MCP server** so any agent can read and write the bible with the same guard rails.

## Run

```bash
npm install && npm run build
export AUTHOR_PROJECT=~/novels/my-novel

# CLI
node packages/cli/dist/main.js init "$AUTHOR_PROJECT" --title "My Novel" --genre thriller
node packages/cli/dist/main.js help

# Web app (API on :8790 serves the built UI)
AUTHOR_PROJECT=$AUTHOR_PROJECT node packages/server/dist/main.js     # http://127.0.0.1:8790

# MCP (stdio) — add to Claude Code / Hermes
AUTHOR_PROJECT=$AUTHOR_PROJECT node packages/mcp/dist/main.js
```

## Models

Three providers: `anthropic` (API key), `claude-code` (headless `claude -p` on your Claude subscription, no key), `local` (llama-server).
Set `AUTHOR_PROVIDER=claude-code` and `AUTHOR_MODEL=claude-haiku-5-5` in `~/.config/author-studio/env` to run everything on Haiku through Claude Code.

Roles: architect, drafter, actor, editor, extractor. `packages/core/src/ai/index.ts` picks providers:
- With `ANTHROPIC_API_KEY` (or an `ant auth login` profile) the strong roles use Claude (`AUTHOR_MODEL`, default `claude-opus-5-5`); extraction stays local.
- Without, everything runs on a local OpenAI-compatible server (`AUTHOR_LOCAL_URL`, default `http://127.0.0.1:8081/v1`, model `AUTHOR_LOCAL_MODEL`). Verified end-to-end on Ternary Bonsai 2 9B.

## Later

Proofreading is in. Audiobook generation is planned: export per-scene text with POV and speaker tags, then a TTS pass (local Step-Audio or a hosted voice) per character voice.
