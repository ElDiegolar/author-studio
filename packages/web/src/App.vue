<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { diffWords } from 'diff';
import { api, type Bible, type Character, type Finding, type Scene, type Version } from './api';

const tab = ref<'studio' | 'bible' | 'scenes' | 'room' | 'muse' | 'style' | 'verify'>('studio');
const aHistory = ref<{ role: 'user' | 'assistant'; content: string; events?: { kind: string; text: string }[] }[]>([]); const aMsg = ref('');
async function agentSend() { const m = aMsg.value; aMsg.value = ''; aHistory.value.push({ role: 'user', content: m }); const r = await run('agent working', () => api<{ reply: string; events: { kind: string; text: string }[] }>('/agent', 'POST', { history: aHistory.value.slice(0, -1).map(({ role, content }) => ({ role, content })), message: m })); if (r) { aHistory.value.push({ role: 'assistant', content: r.reply, events: r.events.filter((e) => e.kind === 'action') }); await load(); } }
const bible = ref<Bible | null>(null);
const busy = ref(''); const error = ref('');
async function load() { bible.value = await api<Bible>('/bible'); }
async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  busy.value = label; error.value = '';
  try { return await fn(); } catch (e) { error.value = (e as Error).message; return undefined; } finally { busy.value = ''; }
}
onMounted(load);
const byId = (id: string) => bible.value?.characters.find((c) => c.id === id)?.name ?? id;

// ---- bible ----
const newChar = ref({ name: '', role: '', summary: '', want: '', need: '', wound: '', arc: '', voiceSample: '', secrets: '' });
const bId = ref<string | null>(null); const bHistory = ref<{ role: 'user' | 'assistant'; content: string }[]>([]); const bMsg = ref(''); const bEdits = ref<{ op: string; field?: string; key?: string; other?: string; value: string }[]>([]); const bReady = ref(false);
async function buildSend() { const m = bMsg.value; bMsg.value = ''; const r = await run('builder thinking', () => api<{ reply: string; edits: typeof bEdits.value; ready: boolean }>('/characters/build', 'POST', { id: bId.value, history: bHistory.value, message: m })); if (r) { bHistory.value.push({ role: 'user', content: m }, { role: 'assistant', content: r.reply }); bEdits.value.push(...r.edits); bReady.value = r.ready; } }
async function buildApply() { const c = await run('writing soul', () => api<Character>('/characters/apply', 'POST', { id: bId.value, edits: bEdits.value })); if (c) { bId.value = c.id; bEdits.value = []; await load(); } }
function buildStart(id: string | null) { bId.value = id; bHistory.value = []; bEdits.value = []; bReady.value = false; }
const seedText = ref(''); const seedNotes = ref(''); const seedResult = ref<Record<string, unknown> | null>(null);
async function addCharacter() { await run('adding', () => api('/characters', 'POST', { ...newChar.value, secrets: newChar.value.secrets.split(';').map((s) => s.trim()).filter(Boolean) })); newChar.value = { name: '', role: '', summary: '', want: '', need: '', wound: '', arc: '', voiceSample: '', secrets: '' }; await load(); }
async function seed() { seedResult.value = (await run('seeding', () => api<Record<string, unknown>>('/characters/seed', 'POST', { inspiration: seedText.value, notes: seedNotes.value }))) ?? null; }
async function keepSeed() { await run('adding', () => api('/characters/seed', 'POST', { inspiration: seedText.value, notes: seedNotes.value, add: true, seed: seedResult.value })); seedResult.value = null; await load(); }
async function savePremise() { if (bible.value) await run('saving', () => api('/premise', 'PUT', bible.value!.premise)); }
async function saveProject() { if (bible.value) await run('saving', () => api('/project', 'PUT', bible.value!.project)); }
const newWorld = ref({ kind: 'location', name: '', summary: '', details: '' });
async function addWorld() { await run('adding', () => api('/world', 'POST', newWorld.value)); newWorld.value = { kind: 'location', name: '', summary: '', details: '' }; await load(); }

// ---- scenes ----
const sceneId = ref(''); const scene = computed(() => bible.value?.scenes.find((s) => s.id === sceneId.value));
const versions = ref<Version[]>([]); const text = ref(''); const findings = ref<Finding[]>([]); const draftBase = ref<string | null>(null);
const draftAgency = ref<string[]>([]);
const newScene = ref({ title: '', chapter: 1, pov: '', characters: [] as string[], goal: '', conflict: '', outcome: '', location: '', time: '', targetWords: 1500 });
async function openScene(id: string) { sceneId.value = id; versions.value = await api<Version[]>(`/scenes/${id}/versions`); text.value = versions.value[versions.value.length - 1]?.text ?? ''; draftBase.value = null; findings.value = []; }
async function addScene() { await run('adding', () => api('/scenes', 'POST', newScene.value)); await load(); }
async function draft(agency: boolean) { const r = await run(agency ? 'characters deciding, then drafting' : 'drafting', () => api<{ version: Version; findings: Finding[]; decisions?: { name: string; decision: string; emotion: string }[] }>(`/scenes/${sceneId.value}/draft`, 'POST', { agency: agency ? draftAgency.value : false })); if (r) { draftBase.value = r.version.text; text.value = r.version.text; findings.value = [...(r.decisions ?? []).map((d) => ({ level: 'ok', code: 'decided', message: `${d.name}: ${d.decision} (${d.emotion})` })), ...r.findings]; versions.value = await api(`/scenes/${sceneId.value}/versions`); await load(); } }
async function saveText() { const r = await run('saving', () => api<{ version: Version; findings: Finding[] }>(`/scenes/${sceneId.value}/text`, 'POST', { text: text.value })); if (r) { findings.value = r.findings; draftBase.value = null; versions.value = await api(`/scenes/${sceneId.value}/versions`); await load(); } }
async function accept() { const r = await run('accepting', () => api<{ facts: unknown[]; witnessed: string[]; findings: Finding[] }>(`/scenes/${sceneId.value}/accept`, 'POST')); if (r) { findings.value = [{ level: 'ok', code: 'accepted', message: `${r.facts.length} facts, witnessed by ${r.witnessed.join(', ')}` }, ...r.findings]; await load(); } }
const proof = ref<{ original: string; fix: string; reason: string }[]>([]);
async function proofread() { proof.value = (await run('proofreading', () => api<typeof proof.value>(`/scenes/${sceneId.value}/proof`, 'POST'))) ?? []; }
function applyFix(p: { original: string; fix: string }) { text.value = text.value.replace(p.original, p.fix); proof.value = proof.value.filter((x) => x !== p); }
const diff = computed(() => (draftBase.value === null ? [] : diffWords(draftBase.value, text.value)));
const editNote = ref(''); const selection = ref('');
function grabSelection() { selection.value = window.getSelection()?.toString() ?? ''; }
async function editSel() { const r = await run('editing', () => api<{ revised: string }>('/edit', 'POST', { passage: selection.value, note: editNote.value })); if (r) text.value = text.value.replace(selection.value, r.revised); }
async function outline() { const n = Number(prompt('How many chapters?', '3') ?? 0); if (n) { await run('outlining', () => api('/outline', 'POST', { chapters: n })); await load(); } }

// ---- character room ----
const roomId = ref(''); const asOf = ref<number | null>(null); const state = ref<Record<string, unknown> | null>(null);
const history = ref<{ role: 'user' | 'assistant'; content: string; findings?: Finding[] }[]>([]); const msg = ref('');
const maxOrder = computed(() => bible.value?.scenes.reduce((m, s) => Math.max(m, s.order), 0) ?? 0);
async function openRoom(id: string) { roomId.value = id; history.value = []; await refreshState(); }
async function refreshState() { state.value = await api(`/characters/${roomId.value}/state${asOf.value !== null ? `?asOf=${asOf.value}` : ''}`); }
async function send() { const m = msg.value; msg.value = ''; history.value.push({ role: 'user', content: m }); const r = await run('thinking', () => api<{ answer: string; findings: Finding[] }>(`/characters/${roomId.value}/chat`, 'POST', { message: m, asOf: asOf.value ?? undefined, history: history.value.slice(0, -1).map(({ role, content }) => ({ role, content })) })); if (r) history.value.push({ role: 'assistant', content: r.answer, findings: r.findings }); }
const souls = ref<string[]>([]);
const situation = ref(''); const decision = ref<{ decision: string; reasoning: string; rejected: string[]; emotion: string; cost: string } | null>(null);
const decisionSaved = ref(false);
async function decideIt() { decisionSaved.value = false; decision.value = (await run('deciding', () => api<typeof decision.value>(`/characters/${roomId.value}/decide`, 'POST', { situation: situation.value, asOf: asOf.value ?? undefined }))) ?? null; }
async function keepDecision() { if (!decision.value) return; await run('saving to soul', () => api(`/characters/${roomId.value}/decisions`, 'POST', { situation: situation.value, decision: decision.value, asOf: asOf.value ?? 0 })); decisionSaved.value = true; await refreshState(); }
async function soul(action: string, name?: string) { await run(action, () => api(`/characters/${roomId.value}/souls`, 'POST', { action, name })); souls.value = await api(`/characters/${roomId.value}/souls`); await refreshState(); }

// ---- muse ----
const scenario = ref(''); const museAsOf = ref<number | null>(null); const museAgency = ref<string[]>([]); const ideas = ref<{ kind: string; idea: string; growsFrom: string; characters: string[] }[]>([]); const museDecisions = ref<{ name: string; decision: string; reasoning: string; emotion: string }[]>([]);
async function museIt() { const r = await run(museAgency.value.length ? 'characters deciding, then musing' : 'musing', () => api<{ ideas: typeof ideas.value; decisions: typeof museDecisions.value }>('/muse', 'POST', { scenario: scenario.value || undefined, asOf: museAsOf.value ?? undefined, agency: museAgency.value })); ideas.value = r?.ideas ?? []; museDecisions.value = r?.decisions ?? []; }

// ---- style ----
const style = ref<{ samples: unknown[]; stats: Record<string, unknown> | null; sheet: string } | null>(null); const sample = ref('');
async function loadStyle() { style.value = await api('/style'); }
async function addSample() { await run('measuring', () => api('/style/sample', 'POST', { text: sample.value })); sample.value = ''; await loadStyle(); }
async function sheet() { await run('distilling', () => api('/style/sheet', 'POST')); await loadStyle(); }

// ---- verify ----
const report = ref<Record<string, Finding[]> | null>(null);
async function verify() { report.value = (await run('verifying', () => api<Record<string, Finding[]>>('/verify'))) ?? null; }
</script>

<template>
  <header>
    <h1>{{ bible?.project.title ?? 'Author Studio' }}</h1>
    <nav>
      <button :class="{ on: tab === 'studio' }" @click="tab = 'studio'">Studio</button>
      <button :class="{ on: tab === 'bible' }" @click="tab = 'bible'">Bible</button>
      <button :class="{ on: tab === 'scenes' }" @click="tab = 'scenes'">Scenes</button>
      <button :class="{ on: tab === 'room' }" @click="tab = 'room'">Character room</button>
      <button :class="{ on: tab === 'muse' }" @click="tab = 'muse'">Muse</button>
      <button :class="{ on: tab === 'style' }" @click="tab = 'style'; loadStyle()">Style</button>
      <button :class="{ on: tab === 'verify' }" @click="tab = 'verify'; verify()">Verify</button>
    </nav>
    <span class="muted" v-if="busy">{{ busy }}…</span>
    <span class="f-error" v-if="error">{{ error }}</span>
  </header>

  <div v-if="!bible" class="muted">loading…</div>

  <!-- STUDIO: everything is chat; the other tabs are the manual editing option -->
  <div v-else-if="tab === 'studio'" class="card">
    <h3>Studio <span class="muted">talk to the agent; it reads and writes the book. The other tabs edit by hand.</span></h3>
    <div class="chat" style="max-height:520px"><template v-for="(h, i) in aHistory" :key="i"><p :class="h.role === 'user' ? 'u' : ''">{{ h.role === 'user' ? 'You: ' : '' }}{{ h.content }}</p><p v-for="(e, j) in h.events ?? []" :key="j" class="muted" style="font:12px/1.4 monospace">▸ {{ e.text }}</p></template><p v-if="!aHistory.length" class="muted">Try: "set the premise: …", "add a character like …", "outline three chapters", "draft scene 2 and let Mara decide for herself", "what does Jonah know as of scene 3?", "I'm stuck on the breakfast scene", "export the book".</p><p v-if="busy" class="muted">{{ busy }}…</p></div>
    <div class="row"><input v-model="aMsg" placeholder="What do you want done?" style="width:85%" @keyup.enter="agentSend" /><button class="act" :disabled="!aMsg || !!busy" @click="agentSend">Send</button></div>
  </div>

  <!-- BIBLE -->
  <div v-else-if="tab === 'bible'" class="grid">
    <div class="card">
      <h3>Project</h3>
      <label>Title</label><input v-model="bible.project.title" @change="saveProject" />
      <label>Genre</label><input v-model="bible.project.genre" @change="saveProject" />
      <div class="row"><div><label>POV</label><select v-model="bible.project.voice.pov" @change="saveProject"><option>first</option><option>third-limited</option><option>third-omniscient</option></select></div>
      <div><label>Tense</label><select v-model="bible.project.voice.tense" @change="saveProject"><option>past</option><option>present</option></select></div></div>
      <label>Tone</label><input v-model="bible.project.voice.tone" @change="saveProject" />
      <h3 style="margin-top:12px">Premise</h3>
      <label>Logline</label><textarea v-model="bible.premise.logline" @change="savePremise" />
      <label>Dramatic question</label><input v-model="bible.premise.dramaticQuestion" @change="savePremise" />
      <label>Theme</label><input v-model="bible.premise.theme" @change="savePremise" />
      <label>Ending</label><textarea v-model="bible.premise.ending" @change="savePremise" />
      <h3 style="margin-top:12px">World</h3>
      <ul class="list"><li v-for="w in bible.world" :key="w.id"><b>{{ w.name }}</b> <span class="muted">{{ w.kind }}</span> — {{ w.summary }}</li></ul>
      <div class="row"><select v-model="newWorld.kind" style="width:auto"><option>location</option><option>faction</option><option>rule</option><option>item</option><option>glossary</option></select><input v-model="newWorld.name" placeholder="name" /></div>
      <input v-model="newWorld.summary" placeholder="summary" /><button class="act" @click="addWorld">Add world entry</button>
    </div>
    <div class="card">
      <h3>Cast</h3>
      <ul class="list"><li v-for="c in bible.characters" :key="c.id" @click="tab = 'room'; openRoom(c.id)"><b>{{ c.name }}</b> <span class="muted">{{ c.role }}</span><br /><span class="muted">{{ c.summary }}</span></li></ul>
      <h3 style="margin-top:12px">Build a character by talking <span class="muted">{{ bId ? 'editing ' + byId(bId) : 'new' }}</span></h3>
      <div class="row"><button class="ghost" @click="buildStart(null)">New</button><select style="width:auto" @change="buildStart(($event.target as HTMLSelectElement).value || null)"><option value="">edit existing…</option><option v-for="c in bible.characters" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
      <div class="chat" style="max-height:260px"><p v-for="(h, i) in bHistory" :key="i" :class="h.role === 'user' ? 'u' : ''">{{ h.role === 'user' ? 'You: ' : '' }}{{ h.content }}</p><p v-if="!bHistory.length" class="muted">Describe who you have in mind. The agent asks, proposes, and writes the soul when you apply.</p></div>
      <div class="row"><input v-model="bMsg" placeholder="e.g. a harbour pilot who is charming and quietly desperate" style="width:75%" @keyup.enter="buildSend" /><button class="act" :disabled="!bMsg || !!busy" @click="buildSend">Send</button></div>
      <div v-if="bEdits.length" class="card"><h3>Proposed edits <span v-if="bReady" class="ok">ready</span></h3><ul class="list"><li v-for="(e, i) in bEdits" :key="i"><b>{{ e.op }}</b> {{ e.field ?? e.key ?? e.other ?? '' }} → {{ e.value }} <button class="ghost" @click="bEdits.splice(i, 1)">drop</button></li></ul><button class="act" @click="buildApply">Apply to soul</button></div>
      <h3 style="margin-top:12px">Or fill the sheet directly</h3>
      <input v-model="newChar.name" placeholder="name" /><input v-model="newChar.role" placeholder="role" /><textarea v-model="newChar.summary" placeholder="summary" />
      <input v-model="newChar.want" placeholder="want" /><input v-model="newChar.need" placeholder="need" /><input v-model="newChar.wound" placeholder="wound" /><input v-model="newChar.arc" placeholder="arc" />
      <textarea v-model="newChar.voiceSample" placeholder="voice sample: a few lines they would say" /><input v-model="newChar.secrets" placeholder="secrets; separated; by semicolons" />
      <button class="act" :disabled="!newChar.name" @click="addCharacter">Add character</button>
      <h3 style="margin-top:12px">Seed from a reference</h3>
      <input v-model="seedText" placeholder="e.g. a Deckard-type burnt-out investigator, or Miss Havisham" /><input v-model="seedNotes" placeholder="notes (optional)" />
      <button class="act" :disabled="!seedText" @click="seed">Propose</button>
      <div v-if="seedResult" class="card" style="margin-top:8px"><pre style="white-space:pre-wrap;font:13px/1.4 monospace">{{ JSON.stringify(seedResult, null, 2) }}</pre><button class="act" @click="keepSeed">Keep this character</button><button class="ghost" @click="seedResult = null">Discard</button></div>
    </div>
  </div>

  <!-- SCENES -->
  <div v-else-if="tab === 'scenes'" class="grid" style="grid-template-columns: 1fr 2fr">
    <div class="card">
      <h3>Scenes <button class="ghost" @click="outline">AI outline…</button></h3>
      <ul class="list"><li v-for="s in bible.scenes" :key="s.id" :class="{ on: s.id === sceneId }" @click="openScene(s.id)">#{{ s.order }} ch{{ s.chapter }} <b>{{ s.title }}</b> <span class="muted">[{{ s.status }}] POV {{ byId(s.pov) }}</span></li></ul>
      <h3 style="margin-top:12px">New scene card</h3>
      <input v-model="newScene.title" placeholder="title" /><div class="row"><input v-model.number="newScene.chapter" type="number" placeholder="chapter" style="width:80px" /><select v-model="newScene.pov"><option value="">POV…</option><option v-for="c in bible.characters" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
      <select v-model="newScene.characters" multiple><option v-for="c in bible.characters" :key="c.id" :value="c.id">{{ c.name }}</option></select>
      <input v-model="newScene.goal" placeholder="goal" /><input v-model="newScene.conflict" placeholder="conflict" /><input v-model="newScene.outcome" placeholder="outcome" /><input v-model="newScene.location" placeholder="location" /><input v-model="newScene.time" placeholder="time" />
      <button class="act" :disabled="!newScene.title || !newScene.pov" @click="addScene">Add scene</button>
    </div>
    <div class="card" v-if="scene">
      <h3>#{{ scene.order }} {{ scene.title }} <span class="muted">{{ scene.goal }} → {{ scene.outcome }}</span></h3>
      <div class="row">
        <button class="act" :disabled="!!busy" @click="draft(false)">Draft with AI</button>
        <button class="act" :disabled="!!busy || !draftAgency.length" @click="draft(true)" title="The ticked characters decide first; the prose honours their choices">Draft with agency</button>
        <label v-for="id in scene.characters" :key="id" style="margin:0"><input type="checkbox" :value="id" v-model="draftAgency" style="width:auto" /> {{ byId(id) }}</label>
        <button class="act" :disabled="!!busy || !text" @click="saveText">Save my text</button>
        <button class="act" :disabled="!!busy || !versions.length" @click="accept">Accept (facts + witness)</button>
        <button class="ghost" :disabled="!!busy || !text" @click="proofread">Proofread</button>
        <span class="muted">{{ versions.length }} version(s)</span>
      </div>
      <textarea class="prose" v-model="text" @mouseup="grabSelection" />
      <div class="row" v-if="selection"><span class="muted">selection: {{ selection.length }} chars</span><input v-model="editNote" placeholder="note for the line editor" style="width:50%" /><button class="ghost" @click="editSel">Edit selection</button></div>
      <ul class="list" v-if="findings.length"><li v-for="(f, i) in findings" :key="i" :class="'f-' + f.level">{{ f.code }}: {{ f.message }}</li></ul>
      <div v-if="proof.length" class="card"><h3>Proofreading</h3><div v-for="(p, i) in proof" :key="i" class="row"><del>{{ p.original }}</del> → <ins>{{ p.fix }}</ins> <span class="muted">{{ p.reason }}</span><button class="ghost" @click="applyFix(p)">apply</button></div></div>
      <div v-if="diff.length" class="card diff"><h3>Your edits vs the AI draft <span class="muted">(saving teaches the style profile)</span></h3><p><template v-for="(d, i) in diff" :key="i"><ins v-if="d.added">{{ d.value }}</ins><del v-else-if="d.removed">{{ d.value }}</del><span v-else>{{ d.value }}</span></template></p></div>
    </div>
    <div class="card muted" v-else>Pick a scene, or add a card.</div>
  </div>

  <!-- CHARACTER ROOM -->
  <div v-else-if="tab === 'room'" class="grid" style="grid-template-columns: 1fr 2fr">
    <div class="card">
      <h3>Who</h3>
      <ul class="list"><li v-for="c in bible.characters" :key="c.id" :class="{ on: c.id === roomId }" @click="openRoom(c.id)"><b>{{ c.name }}</b> <span class="muted">{{ c.role }}</span></li></ul>
      <div v-if="roomId">
        <label>Knowledge horizon: as of scene {{ asOf ?? 'end' }}</label>
        <input type="range" :min="0" :max="maxOrder" :value="asOf ?? maxOrder" @input="asOf = Number(($event.target as HTMLInputElement).value); refreshState()" />
        <button class="ghost" @click="asOf = null; refreshState()">whole story</button>
        <h3 style="margin-top:12px">Mind</h3>
        <div class="row"><button class="ghost" :disabled="!!busy" @click="run('building mirror', () => api(`/characters/${roomId}/mirror`, 'POST')).then(refreshState)">Build psychological mirror</button></div>
        <div class="row"><input v-model="situation" placeholder="a situation for them to decide on" style="width:70%" /><button class="ghost" :disabled="!situation || !!busy" @click="decideIt">Let them decide</button></div>
        <div v-if="decision" class="idea"><b>{{ decision.decision }}</b><br /><span class="muted">{{ decision.reasoning }}</span><br /><span class="muted">rejected: {{ decision.rejected.join('; ') }} · feeling {{ decision.emotion }} · cost: {{ decision.cost }}</span><br /><span v-if="decisionSaved" class="ok">saved to soul</span><button v-else class="ghost" @click="keepDecision">Keep this decision</button> <span class="muted" v-if="!decisionSaved">(scratch until kept)</span></div>
        <h3 style="margin-top:12px">Soul</h3>
        <div class="row"><button class="ghost" @click="soul('save', prompt('Snapshot name?', 'snapshot') ?? undefined)">Save</button><button class="ghost" @click="soul('reset')">Reset to base</button><button class="ghost" @click="api(`/characters/${roomId}/souls`).then((s) => souls = s as string[])">List</button></div>
        <ul class="list"><li v-for="s in souls" :key="s" @click="soul('restore', s)">restore <b>{{ s }}</b></li></ul>
        <pre v-if="state" style="white-space:pre-wrap;font:12px/1.4 monospace" class="muted">{{ JSON.stringify(state, null, 1) }}</pre>
      </div>
    </div>
    <div class="card" v-if="roomId">
      <h3>Talking to {{ byId(roomId) }} <span class="muted">as of scene {{ asOf ?? 'end' }}</span></h3>
      <div class="chat"><template v-for="(h, i) in history" :key="i"><p :class="h.role === 'user' ? 'u' : ''">{{ h.role === 'user' ? 'You: ' : '' }}{{ h.content }}</p><p v-for="(f, j) in h.findings ?? []" :key="j" class="f-error">⚠ {{ f.message }}</p></template><p v-if="busy" class="muted">…</p></div>
      <div class="row"><input v-model="msg" placeholder="Ask them something" @keyup.enter="send" style="width:80%" /><button class="act" :disabled="!msg || !!busy" @click="send">Send</button></div>
    </div>
    <div class="card muted" v-else>Pick a character. Slide the horizon to talk to them as they were at any scene.</div>
  </div>

  <!-- MUSE -->
  <div v-else-if="tab === 'muse'" class="card">
    <h3>Writer's block</h3>
    <textarea v-model="scenario" placeholder="Optional: the scenario you are stuck on. Leave blank and the muse will find the pressure points in the souls." />
    <div class="row"><label>As of scene</label><input type="number" v-model.number="museAsOf" style="width:90px" :max="maxOrder" :min="0" /></div>
    <div class="row"><span class="muted">Who decides for themselves (the rest follow you):</span><label v-for="c in bible.characters" :key="c.id" style="margin:0"><input type="checkbox" :value="c.id" v-model="museAgency" style="width:auto" /> {{ c.name }}</label></div>
    <div class="row"><button class="act" :disabled="!!busy" @click="museIt">Throw me ideas</button></div>
    <div v-if="museDecisions.length" class="card"><h3>What they would do</h3><p class="muted">Scratch: nothing here is saved to anyone's soul.</p><div v-for="(d, k) in museDecisions" :key="k" class="idea"><b>{{ d.name }}</b>: {{ d.decision }} <span class="muted">({{ d.emotion }})</span><br /><span class="muted">{{ d.reasoning }}</span></div></div>
    <div v-for="(i, k) in ideas" :key="k" class="idea"><b>{{ i.kind }}</b> — {{ i.idea }}<br /><span class="muted">grows from: {{ i.growsFrom }} · {{ i.characters.map(byId).join(', ') }}</span></div>
  </div>

  <!-- STYLE -->
  <div v-else-if="tab === 'style'" class="grid">
    <div class="card"><h3>Teach the drafter your voice</h3><p class="muted">Paste your own prose. Every time you edit an AI draft and save it, that edit is added too.</p><textarea class="prose" v-model="sample" /><button class="act" :disabled="!sample" @click="addSample">Add sample</button><button class="ghost" @click="sheet">Distil style sheet</button></div>
    <div class="card" v-if="style"><h3>Profile · {{ style.samples.length }} sample(s)</h3><pre style="white-space:pre-wrap;font:12px/1.4 monospace" class="muted">{{ JSON.stringify(style.stats, null, 1) }}</pre><h3>Style sheet</h3><p style="white-space:pre-wrap">{{ style.sheet || '(none yet)' }}</p></div>
  </div>

  <!-- VERIFY -->
  <div v-else-if="tab === 'verify'" class="card">
    <h3>Deterministic checks <button class="ghost" @click="verify">Re-run</button> <a class="ghost" href="/api/export.md" target="_blank">Export Markdown</a></h3>
    <div v-for="(fs, key) in report ?? {}" :key="key"><b>{{ key }}</b> <span v-if="!fs.length" class="ok">clean</span><ul class="list"><li v-for="(f, i) in fs" :key="i" :class="'f-' + f.level">{{ f.code }}: {{ f.message }}</li></ul></div>
  </div>
</template>
