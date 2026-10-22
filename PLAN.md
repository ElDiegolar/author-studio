# Author Studio: AI-assisted novel development

Working name only. A tool where an author specs a novel, builds its world and cast,
drafts and revises with AI help, and can talk to the characters they have created,
in character, with those characters remembering what has happened to them.

Assumptions (change any of these and the plan adjusts):
- Solo author first, collaboration later.
- Web app, desktop-first, works on a laptop. Same stack as soulsociety / horizon-ui:
  Vue 3 + TypeScript front end, Node/TypeScript back end, Supabase (Postgres + auth +
  storage), vitest. Hosted Claude models for quality, local 9B for cheap bulk tasks.
- The author owns everything. No model is trained on their text. Export is a
  first-class feature (Markdown, DOCX, EPUB).

## 1. The core idea: the book is a database, not a document

Everything the AI needs to be consistent lives in structured records the author
controls, and the prose is generated and edited against those records.

Entities:
- Project: title, genre, audience, target length, voice sheet (POV, tense, tone,
  banned words, style exemplars).
- Premise & theme: logline, dramatic question, thematic argument, ending.
- World: locations, factions, rules (magic/tech/economy), timeline, glossary.
- Characters: identity, want vs need, wound, arc, voice sample, relationships,
  secrets, and a running MEMORY of events they have witnessed.
- Structure: acts -> chapters -> scenes. Each scene has POV, location, time,
  goal/conflict/outcome, characters present, status (outline / drafted / revised).
- Manuscript: scene text, versioned.
- Continuity ledger: every fact asserted in prose (eye colour, who knows what,
  dates) with the scene that asserted it.

## 2. Characters as souls (reuse soulsociety)

The "talk to your characters" feature is the differentiator, and it is the
soulsociety model almost unchanged:
- Each character has an append-only event log: creation, traits, every scene they
  appear in (as witnessed from their POV), every conversation with the author.
- Replay produces the character's current state: what they know, feel, want, and
  what they do NOT yet know (critical: a character must not leak plot they have not
  lived). Scene order gives a "knowledge horizon"; the author can set the character
  to "as of chapter 12".
- Chatting with a character = system prompt built from replayed state + voice
  sample + knowledge horizon, with observations the character forms about the
  author's questions appended as events ("the author asked me about my mother").
- soul-mcp already does event log + replay + observe. Fork it as `character-core`;
  drop the crypto/sync layer for v1 (local project, Supabase RLS is enough).

## 3. The AI roles (the 9B rule applies)

One orchestrator, several bounded workers, a verifier. Same architecture as the
free-harness delegation plan.
- Story architect (strong model): beat sheets, act structure, scene cards, "what
  is missing" critique. Low volume, high stakes.
- Drafter (strong model): writes a scene from its card + voice sheet + the
  continuity facts relevant to that scene. One scene per call, 1.5-3k words.
- Character actor (strong model for voice, 9B acceptable for quick chats): the
  in-character conversation, bounded by the knowledge horizon.
- Continuity checker (9B or script): extracts facts from a drafted scene, diffs
  them against the ledger, flags contradictions. Mechanical, high volume, cheap.
- Line editor (strong model): revise a paragraph/scene to notes; never rewrites
  more than the selection.
- Verifier (script): word counts, POV/tense compliance, banned words, named
  characters exist, locations exist, timeline order. Runs on every draft, no model.

Model selection lives in one config file; load the claude-api skill when wiring
it so the IDs and pricing are current. Default: strongest available for architect
and drafter, mid-tier for actor, local 9B for extraction.

## 4. Author workflow (the screens)

1. Spec: a guided interview (premise, genre, comps, ending, POV) that writes the
   Project + Premise records. The AI asks, the author answers, nothing is drafted.
2. World & cast: cards with AI "suggest / expand / stress-test" buttons. Every
   suggestion is a proposal the author accepts or edits; nothing auto-saves.
3. Structure: beat board (drag scenes between chapters). AI fills gaps on request,
   flags pacing (too many talking scenes in a row, subplot dropped for 8 chapters).
4. Draft: scene editor with the card, relevant continuity facts and character
   states in a side panel. "Draft this scene" / "Continue" / "Rewrite selection".
   Diff view for every AI edit; accept per paragraph.
5. Characters room: pick a character, set the knowledge horizon, talk. Transcript
   can be turned into scene material or into a character memory with one click.
6. Continuity & verify: ledger view, contradictions, timeline, who-knows-what matrix.
7. Export: Markdown / DOCX / EPUB with front matter; a "bible" export of world + cast.

### 4a. Design direction (run through the high-end-visual-design skill)

Skill: `.claude/skills/high-end-visual-design` (taste-skill-classics), opt-in. It is
written for marketing sites; this is a tool people write in for hours, so each rule is
kept, adapted or dropped deliberately.

- Vibe: **Editorial Luxury**. Warm paper (`#FBF8F2`), espresso ink, a muted sage and a
  burnt-sienna accent; dark mode is espresso, not black. Variable serif display
  (Fraunces) for headings, Newsreader for prose, Geist for interface text. All three
  self-hosted (fontsource), so the studio still works offline and nothing about the
  author is sent to a font CDN. A fixed, pointer-events-none film grain at 3%.
- Layout: **Editorial Split** for the writing surfaces (Studio, Scenes, Character room):
  a wide prose column, a narrow column of context (card, findings, mind, soul).
  **Asymmetrical Bento** for the dashboards (Bible, Style, Verify): cards of different
  spans instead of an even grid. Everything collapses to one column under 768px.
- Components: every panel is a **double-bezel** card (tinted shell, hairline ring,
  inner core with its own top highlight and concentric radius). Primary actions are
  pills; the main call to action in each view carries the **button-in-button** arrow
  that shifts on hover. Each view opens with an **eyebrow** tag, a large serif title
  and one line saying what the view is for.
- Navigation: a **floating island** pill (detached from the top, glass blur, the only
  blurred element). On phones it becomes a hamburger that morphs into an X and opens a
  full-screen glass sheet with staggered links.
- Motion: one spring curve (`cubic-bezier(0.32,0.72,0,1)`) for everything; views and
  cards fade up from a slight blur on entry, via IntersectionObserver, transform and
  opacity only. Honour `prefers-reduced-motion`.

Adapted for a work tool:
- Macro-whitespace (the skill's py-24 to py-40) applies to each view's header, not
  between working panels; the editor needs density, not air.
- The prose editor is the calmest surface on screen: no ring, no motion, a reading
  measure of about 70 characters, 1.75 line height.
- Entry animations play when a view or card first appears, never on every data
  refresh, so typing and saving never make the screen move.
- Findings, verdicts ("This is me" / "Not me") and statuses stay plain and legible;
  colour is reserved for state (ok / warn / error), not decoration.

## 5. Data & privacy
- Supabase per-user rows, RLS on everything, manuscripts in Postgres (versioned via
  an append-only `scene_versions` table), assets in storage.
- All model calls go through the back end; keys never in the browser.
- Explicit "no training" providers only; log every prompt+response per project so
  the author can audit what the AI saw.
- Local-only mode later: same back end pointed at llama-server (the 9B does
  extraction and chat; drafting quality will drop).

## 6. Build phases

Phase 0 (1 week): spike. CLI only. One project JSON, one scene card -> drafted
scene, one character with an event log -> in-character chat with knowledge horizon.
Prove the horizon holds (character must not know chapter 20 when set to chapter 5).

Phase 1 (3-4 weeks): MVP web app. Spec interview, cast/world cards, beat board,
scene drafting with diff-accept, character chat, Markdown export. Single user.
Verifier script. Supabase auth.

Phase 2 (3 weeks): continuity ledger + checker, who-knows-what matrix, timeline,
line editor, DOCX/EPUB export, prompt audit log.

Phase 3 (3 weeks): pacing analysis, series support (multi-book, shared world),
collaboration (editor role with comments), local-model mode.

Phase 3b: audiobook. Export scenes as speaker-tagged text (narrator + per-character
lines from dialogue attribution), map characters to voices, render with a TTS engine
(local Step-Audio-EditX on the 3080 box, or a hosted voice API), stitch per chapter
with chapter markers to M4B. Proofreading pass runs first.

Phase 4: polish, pricing, beta with 5-10 authors. Measure: words drafted that
survive to final, contradictions caught per 10k words, character-chat sessions
that led to scene changes.

## 7. Risks
- Sameness: AI prose converges on a house style. Mitigation: voice sheet with
  exemplars, temperature per role, "rewrite in the author's last 2k words" mode,
  and never auto-accept.
- Leakage: a character who knows the ending ruins the chat. The horizon is the
  core invariant; test it in CI with a fixture novel.
- Cost: drafting a 90k-word novel with a frontier model is tens of dollars per
  full pass; make per-scene cost visible and route extraction to the 9B.
- Ownership/legal: terms must state the author owns outputs; keep the audit log so
  they can prove what was theirs.

## 8. Status (2026-10-20)
Built in one session: core (types, souls, horizon, mirror, decisions, style, verifier),
CLI, MCP server, HTTP server, Vue web app. Verified end-to-end on the local 9B.
See README.md.

## 9. Not in scope
- Publishing/marketing. Cover art. Audiobook. Fan interaction with characters
  (that is a different product with different safety needs).

One line: the book is a database, the characters are souls, the AI proposes and
the author disposes.
