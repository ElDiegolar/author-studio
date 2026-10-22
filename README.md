# Author Studio

AI-assisted novel development where the book is a database, the characters are souls, the AI proposes and the author disposes.

Everything lives as plain JSON and Markdown in a project folder you own and can edit by hand (your writer soul lives beside your projects, see below):

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
- **The writer is a soul too**: your style lives in an append-only writer soul (`~/.config/author-studio/writers/<writer>/events.jsonl`, override with `AUTHOR_WRITER_HOME`) that follows you across projects. It holds your uploaded samples and, every time you rewrite an AI draft, the draft and your version side by side. From those pairs it measures your habits deterministically ("shortens sentences −40% over 5 edits", "cuts dialogue tags") and, every third edit, a model proposes rules with before → after evidence. You mark each one **This is me** or **Not me**: confirmed rules go into every draft, rejected ones never come back. Drafts are checked for style drift against your measured stats. The soul has a time horizon, so a series can pin book one's voice (`writerAsOf` in project.json), and snapshots let you keep a soul per pen name. A legacy `style.json` is folded in on open.
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

## Testing

```bash
npm test          # unit tests (core: souls, horizon, writer soul, verifier)
npm run e2e       # end-to-end: every feature through the web app, CLI and MCP server
npm run e2e:live  # the same flow against the real model in ~/.config/author-studio/env
npm run test:all  # both
```

The end-to-end flow (`e2e/`) builds a fresh fixture novel in a temp directory, starts a deterministic fake model (`e2e/fake-model.mjs`, one canned answer per AI role) and runs the real server against it, then drives every room in Chromium: navigation, theme and phone menu; bible edits, world, hand-made / seeded / chat-built characters; scene cards, drafting, rewrite-and-save (writer soul edit), proofread, line edit, accept (facts + witnessing), agency drafting, AI outline; character room horizon and leak detection, mirror, decide-then-keep, soul snapshot/reset/restore; muse with agency; style samples, learning rules, This is me / Not me, own rules, style sheet; verify and Markdown export; the studio agent; and the CLI and MCP server end to end. Your real novels and writer soul are never touched. Failures leave a screenshot and trace in `test-results/`; the HTML report is in `e2e/report/`.

## Models

Three providers: `anthropic` (API key), `claude-code` (headless `claude -p` on your Claude subscription, no key), `local` (llama-server).
Set `AUTHOR_PROVIDER=claude-code` and `AUTHOR_MODEL=claude-haiku-5-5` in `~/.config/author-studio/env` to run everything on Haiku through Claude Code.

Roles: architect, drafter, actor, editor, extractor. `packages/core/src/ai/index.ts` picks providers:
- With `ANTHROPIC_API_KEY` (or an `ant auth login` profile) the strong roles use Claude (`AUTHOR_MODEL`, default `claude-opus-5-5`); extraction stays local.
- Without, everything runs on a local OpenAI-compatible server (`AUTHOR_LOCAL_URL`, default `http://127.0.0.1:8081/v1`, model `AUTHOR_LOCAL_MODEL`). Verified end-to-end on Ternary Bonsai 2 9B.

## Later

Proofreading is in. Audiobook generation is planned: export per-scene text with POV and speaker tags, then a TTS pass (local Step-Audio or a hosted voice) per character voice.
