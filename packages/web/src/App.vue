<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { diffWords } from 'diff';
import { api, type Bible, type Character, type Finding, type Scene, type Version } from './api';
import Panel from './components/Panel.vue';
import Cta from './components/Cta.vue';

type Tab = 'studio' | 'bible' | 'scenes' | 'room' | 'muse' | 'style' | 'verify';
const tab = ref<Tab>('studio');
const menu = ref(false);
/** Dark glass by default; the choice is remembered per browser. */
const theme = ref<'dark' | 'light'>((() => { try { return localStorage.getItem('author-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } })());
function applyTheme() { document.documentElement.dataset.theme = theme.value; }
function toggleTheme() { theme.value = theme.value === 'dark' ? 'light' : 'dark'; applyTheme(); try { localStorage.setItem('author-theme', theme.value); } catch { /* private window */ } }
applyTheme();
const TABS: { id: Tab; label: string; eyebrow: string; title: string; lede: string }[] = [
  { id: 'studio', label: 'Studio', eyebrow: 'Studio', title: '', lede: 'Say what you want done. The agent reads and writes the book; every other room is the same book by hand.' },
  { id: 'bible', label: 'Bible', eyebrow: 'The book as a database', title: 'The <em>bible</em>', lede: 'Premise, world and cast. Characters are souls: what you write here is where their lives begin.' },
  { id: 'scenes', label: 'Scenes', eyebrow: 'Drafting', title: 'Scene by <em>scene</em>', lede: 'The AI proposes, you dispose. Rewrite a draft and save it: the difference teaches your writer soul.' },
  { id: 'room', label: 'Characters', eyebrow: 'Character room', title: 'Talk to <em>them</em>', lede: 'Slide the horizon to meet a character as they were at any scene. They know only what they have lived.' },
  { id: 'muse', label: 'Muse', eyebrow: "Writer's block", title: 'Throw me <em>ideas</em>', lede: 'Pressure points found in the souls. Let some characters decide for themselves; nothing here is saved.' },
  { id: 'style', label: 'Style', eyebrow: 'Writer soul', title: 'Your <em>voice</em>', lede: 'Learned from your own prose and from every AI draft you rewrite. Tell it what is you and what is not.' },
  { id: 'verify', label: 'Verify', eyebrow: 'Deterministic checks', title: 'Who is <em>right</em>', lede: 'No model decides here: continuity, timeline, point of view, length, and whether a draft still sounds like you.' },
];
const meta = computed(() => TABS.find((t) => t.id === tab.value)!);
function go(t: Tab) { menu.value = false; tab.value = t; if (t === 'style') loadStyle(); if (t === 'verify') verify(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
function ask(q: string, def: string): string | undefined { return window.prompt(q, def) ?? undefined; }
function openExport() { window.open('/api/export.md', '_blank'); }
const SUGGEST = ['Set the premise: …', 'Add a character like a burnt-out harbour pilot', 'Outline three chapters', 'Draft scene 2 and let Mara decide for herself', 'What does Jonah know as of scene 3?', "I'm stuck on the breakfast scene", 'Export the book'];
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

const glance = computed(() => {
  const b = bible.value; if (!b) return [];
  const accepted = b.scenes.filter((s) => s.status === 'accepted').length;
  return [{ n: b.characters.length, l: 'characters' }, { n: `${accepted}/${b.scenes.length}`, l: 'scenes accepted' }, { n: b.facts.length, l: 'continuity facts' }, { n: b.world.length, l: 'world entries' }];
});

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
const chapters = computed(() => {
  const m = new Map<number, Scene[]>();
  for (const s of [...(bible.value?.scenes ?? [])].sort((a, b) => a.order - b.order)) m.set(s.chapter, [...(m.get(s.chapter) ?? []), s]);
  return [...m.entries()];
});
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
type Rule = { id: string; text: string; status: 'proposed' | 'confirmed' | 'rejected'; seen: number; evidence: string[]; origin: string };
const style = ref<{ writerId: string; asOf: string | null; samples: unknown[]; edits: unknown[]; unlearnedEdits: number; stats: Record<string, unknown> | null; sheet: string; rules: Rule[]; tendencies: { text: string }[] } | null>(null); const sample = ref(''); const ownRule = ref('');
async function loadStyle() { style.value = await api('/writer'); }
async function learn() { await run('learning from your edits', () => api('/writer/learn', 'POST')); await loadStyle(); }
async function verdict(id: string, action: 'confirm' | 'reject') { await run('saving', () => api('/writer/rules', 'POST', { action, id })); await loadStyle(); }
async function addOwnRule() { await run('saving', () => api('/writer/rules', 'POST', { action: 'add', text: ownRule.value })); ownRule.value = ''; await loadStyle(); }
async function addSample() { await run('measuring', () => api('/style/sample', 'POST', { text: sample.value })); sample.value = ''; await loadStyle(); }
async function sheet() { await run('distilling', () => api('/style/sheet', 'POST')); await loadStyle(); }

// ---- verify ----
const report = ref<Record<string, Finding[]> | null>(null);
const reportCounts = computed(() => {
  const all = Object.values(report.value ?? {}).flat();
  return [{ n: all.filter((f) => f.level === 'error').length, l: 'errors' }, { n: all.filter((f) => f.level === 'warn').length, l: 'warnings' }, { n: Object.values(report.value ?? {}).filter((f) => !f.length).length, l: 'clean sections' }];
});
async function verify() { report.value = (await run('verifying', () => api<Record<string, Finding[]>>('/verify'))) ?? null; }
</script>

<template>
  <div class="mesh" aria-hidden="true" />

  <nav class="island" :class="{ open: menu }" aria-label="Rooms">
    <span class="brand">{{ bible?.project.title ?? 'Author Studio' }}</span>
    <div class="links"><button v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="go(t.id)">{{ t.label }}</button></div>
    <span v-if="busy" class="pulse"><i />{{ busy }}</span>
    <button class="theme" :aria-label="theme === 'dark' ? 'Light mode' : 'Dark mode'" :title="theme === 'dark' ? 'Light mode' : 'Dark mode'" @click="toggleTheme">
      <svg v-if="theme === 'dark'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></svg>
      <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" /></svg>
    </button>
    <button class="burger" :aria-expanded="menu" aria-label="Menu" @click="menu = !menu"><i /><i /></button>
  </nav>
  <div v-if="menu" class="sheet">
    <button v-for="(t, i) in TABS" :key="t.id" :class="{ on: tab === t.id }" :style="{ animationDelay: `${80 + i * 50}ms` }" @click="go(t.id)">{{ t.label }}</button>
  </div>

  <main class="page">
    <header :key="tab" v-reveal class="hero">
      <span class="eyebrow">{{ meta.eyebrow }}</span>
      <h1 v-if="meta.title" v-html="meta.title" />
      <h1 v-else>{{ bible?.project.title ?? 'Author Studio' }}</h1>
      <p class="lede">{{ meta.lede }}</p>
    </header>

    <p v-if="!bible" class="empty">Opening the book…</p>

    <!-- STUDIO: everything is chat; the other rooms are the manual option -->
    <div v-else-if="tab === 'studio'" class="bento">
      <Panel :span="8" eyebrow="Conversation" title="The studio agent">
        <div class="chat">
          <template v-for="(h, i) in aHistory" :key="i">
            <div class="bubble" :class="h.role === 'user' ? 'me' : 'them'">{{ h.content }}</div>
            <div v-for="(e, j) in h.events ?? []" :key="j" class="trace">▸ {{ e.text }}</div>
          </template>
          <p v-if="!aHistory.length" class="empty">Nothing said yet. Ask for anything the other rooms can do.</p>
          <div v-if="busy" class="trace">{{ busy }}…</div>
        </div>
        <div class="composer"><input v-model="aMsg" placeholder="What do you want done?" @keyup.enter="aMsg && !busy && agentSend()" /><Cta :disabled="!aMsg || !!busy" @click="agentSend">Send</Cta></div>
      </Panel>
      <div class="stack span-4">
        <Panel eyebrow="Try saying">
          <div class="chips"><button v-for="s in SUGGEST" :key="s" @click="aMsg = s">{{ s }}</button></div>
        </Panel>
        <Panel eyebrow="The book at a glance">
          <div class="stat-grid"><div v-for="g in glance" :key="g.l" class="stat"><b>{{ g.n }}</b><span>{{ g.l }}</span></div></div>
        </Panel>
      </div>
    </div>

    <!-- BIBLE -->
    <div v-else-if="tab === 'bible'" class="bento">
      <Panel :span="7" eyebrow="Project" title="Premise &amp; voice">
        <div class="field-row"><div><label>Title</label><input v-model="bible.project.title" @change="saveProject" /></div><div><label>Genre</label><input v-model="bible.project.genre" @change="saveProject" /></div></div>
        <div class="field-row">
          <div><label>Point of view</label><select v-model="bible.project.voice.pov" @change="saveProject"><option>first</option><option>third-limited</option><option>third-omniscient</option></select></div>
          <div><label>Tense</label><select v-model="bible.project.voice.tense" @change="saveProject"><option>past</option><option>present</option></select></div>
        </div>
        <label>Tone</label><input v-model="bible.project.voice.tone" @change="saveProject" />
        <label>Logline</label><textarea v-model="bible.premise.logline" @change="savePremise" />
        <div class="field-row"><div><label>Dramatic question</label><input v-model="bible.premise.dramaticQuestion" @change="savePremise" /></div><div><label>Theme</label><input v-model="bible.premise.theme" @change="savePremise" /></div></div>
        <label>Ending</label><textarea v-model="bible.premise.ending" @change="savePremise" />
      </Panel>
      <Panel :span="5" eyebrow="Cast" :title="`${bible.characters.length} souls`">
        <ul class="list">
          <li v-for="c in bible.characters" :key="c.id" @click="go('room'); openRoom(c.id)">
            <div class="who"><span class="avatar">{{ initials(c.name) }}</span><div><b>{{ c.name }}</b> <span class="muted">{{ c.role }}</span><br /><span class="muted">{{ c.summary }}</span></div></div>
          </li>
        </ul>
      </Panel>
      <Panel :span="7" eyebrow="Build by talking" :title="bId ? `Editing ${byId(bId)}` : 'A new character'">
        <template #actions><button class="pill" @click="buildStart(null)">New</button><select style="width:auto;margin:0" @change="buildStart(($event.target as HTMLSelectElement).value || null)"><option value="">Edit existing…</option><option v-for="c in bible.characters" :key="c.id" :value="c.id">{{ c.name }}</option></select></template>
        <div class="chat" style="min-height:200px;max-height:320px">
          <div v-for="(h, i) in bHistory" :key="i" class="bubble" :class="h.role === 'user' ? 'me' : 'them'">{{ h.content }}</div>
          <p v-if="!bHistory.length" class="empty">Describe who you have in mind. The agent asks, proposes, and writes the soul when you apply.</p>
        </div>
        <div class="composer"><input v-model="bMsg" placeholder="A harbour pilot, charming and quietly desperate" @keyup.enter="bMsg && !busy && buildSend()" /><Cta :disabled="!bMsg || !!busy" @click="buildSend">Send</Cta></div>
        <template v-if="bEdits.length">
          <h3>Proposed edits <span v-if="bReady" class="ok">· ready</span></h3>
          <ul class="list plain"><li v-for="(e, i) in bEdits" :key="i" class="row"><span class="status">{{ e.op }}</span> <b>{{ e.field ?? e.key ?? e.other ?? '' }}</b> → {{ e.value }} <button class="pill" @click="bEdits.splice(i, 1)">Drop</button></li></ul>
          <div class="row" style="margin-top:12px"><Cta @click="buildApply">Apply to soul</Cta></div>
        </template>
      </Panel>
      <Panel :span="5" eyebrow="World" :title="`${bible.world.length} entries`">
        <ul class="list plain"><li v-for="w in bible.world" :key="w.id"><b>{{ w.name }}</b> <span class="status">{{ w.kind }}</span><br /><span class="muted">{{ w.summary }}</span></li></ul>
        <h3>Add an entry</h3>
        <div class="row"><select v-model="newWorld.kind" style="flex:0 0 130px"><option>location</option><option>faction</option><option>rule</option><option>item</option><option>glossary</option></select><input v-model="newWorld.name" placeholder="Name" /></div>
        <input v-model="newWorld.summary" placeholder="Summary" style="margin-top:8px" /><button class="pill solid" :disabled="!newWorld.name" @click="addWorld">Add world entry</button>
      </Panel>
      <Panel :span="6" eyebrow="By hand" title="Fill the sheet directly">
        <div class="field-row"><input v-model="newChar.name" placeholder="Name" /><input v-model="newChar.role" placeholder="Role" /></div>
        <textarea v-model="newChar.summary" placeholder="Summary" />
        <div class="field-row"><input v-model="newChar.want" placeholder="Want" /><input v-model="newChar.need" placeholder="Need" /></div>
        <div class="field-row"><input v-model="newChar.wound" placeholder="Wound" /><input v-model="newChar.arc" placeholder="Arc" /></div>
        <textarea v-model="newChar.voiceSample" placeholder="Voice sample: a few lines they would say" /><input v-model="newChar.secrets" placeholder="Secrets; separated; by semicolons" />
        <button class="pill solid" :disabled="!newChar.name" @click="addCharacter">Add character</button>
      </Panel>
      <Panel :span="6" eyebrow="From a reference" title="Seed a character">
        <input v-model="seedText" placeholder="A Deckard-type burnt-out investigator, or Miss Havisham" /><input v-model="seedNotes" placeholder="Notes (optional)" />
        <Cta :disabled="!seedText || !!busy" @click="seed">Propose</Cta>
        <template v-if="seedResult"><pre class="json" style="margin-top:16px">{{ JSON.stringify(seedResult, null, 2) }}</pre><div class="row" style="margin-top:12px"><button class="pill solid" @click="keepSeed">Keep this character</button><button class="pill" @click="seedResult = null">Discard</button></div></template>
      </Panel>
    </div>

    <!-- SCENES: editorial split, the prose is the widest and calmest surface -->
    <div v-else-if="tab === 'scenes'" class="bento">
      <div class="stack span-4">
        <Panel eyebrow="Outline" title="Scenes">
          <template #actions><button class="pill" :disabled="!!busy" @click="outline">AI outline…</button></template>
          <template v-for="[ch, list] in chapters" :key="ch">
            <div class="chapter">Chapter {{ ch }}</div>
            <ul class="list"><li v-for="s in list" :key="s.id" :class="{ on: s.id === sceneId }" @click="openScene(s.id)"><b>{{ s.order }}. {{ s.title }}</b> <span class="status" :class="s.status">{{ s.status }}</span><br /><span class="muted">POV {{ byId(s.pov) }}</span></li></ul>
          </template>
        </Panel>
        <Panel eyebrow="New card" title="Add a scene">
          <input v-model="newScene.title" placeholder="Title" />
          <div class="row"><input v-model.number="newScene.chapter" type="number" placeholder="Chapter" style="flex:0 0 96px" /><select v-model="newScene.pov"><option value="">POV…</option><option v-for="c in bible.characters" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
          <label>Who is in it</label><select v-model="newScene.characters" multiple><option v-for="c in bible.characters" :key="c.id" :value="c.id">{{ c.name }}</option></select>
          <input v-model="newScene.goal" placeholder="Goal" /><input v-model="newScene.conflict" placeholder="Conflict" /><input v-model="newScene.outcome" placeholder="Outcome" />
          <div class="field-row"><input v-model="newScene.location" placeholder="Location" /><input v-model="newScene.time" placeholder="Time" /></div>
          <button class="pill solid" :disabled="!newScene.title || !newScene.pov" @click="addScene">Add scene</button>
        </Panel>
      </div>
      <div class="stack span-8" :class="{ 'first-on-phone': scene }">
        <Panel v-if="scene" :key="scene.id" :eyebrow="`Scene ${scene.order} · chapter ${scene.chapter} · ${versions.length} version(s)`" :title="scene.title">
          <p class="muted">{{ scene.goal }} → {{ scene.outcome }}</p>
          <div class="toolbar">
            <Cta :disabled="!!busy" @click="draft(false)">Draft with AI</Cta>
            <button class="pill" :disabled="!!busy || !draftAgency.length" title="The ticked characters decide first; the prose honours their choices" @click="draft(true)">Draft with agency</button>
            <label v-for="id in scene.characters" :key="id" class="check"><input v-model="draftAgency" type="checkbox" :value="id" /> {{ byId(id) }}</label>
          </div>
          <div class="prose-wrap"><textarea v-model="text" class="prose" placeholder="Write, or draft with AI and rewrite it in your voice." @mouseup="grabSelection" /></div>
          <div class="toolbar">
            <button class="pill solid" :disabled="!!busy || !text" @click="saveText">Save my text</button>
            <button class="pill yes" :disabled="!!busy || !versions.length" @click="accept">Accept · facts &amp; witness</button>
            <button class="pill" :disabled="!!busy || !text" @click="proofread">Proofread</button>
          </div>
          <div v-if="selection" class="composer"><span class="muted" style="padding-left:12px;white-space:nowrap">{{ selection.length }} chars</span><input v-model="editNote" placeholder="Note for the line editor" /><button class="pill" @click="editSel">Edit selection</button></div>
        </Panel>
        <Panel v-else eyebrow="Nothing open"><p class="empty">Pick a scene from the outline, or add a card.</p></Panel>
        <Panel v-if="scene && findings.length" eyebrow="Findings">
          <div v-for="(f, i) in findings" :key="i" class="finding" :class="'f-' + f.level"><code>{{ f.code }}</code><span>{{ f.message }}</span></div>
        </Panel>
        <Panel v-if="scene && proof.length" eyebrow="Proofreading" :title="`${proof.length} issue(s)`">
          <div v-for="(p, i) in proof" :key="i" class="finding diff"><del>{{ p.original }}</del> → <ins>{{ p.fix }}</ins> <span class="muted">{{ p.reason }}</span><button class="pill" style="margin-left:auto" @click="applyFix(p)">Apply</button></div>
        </Panel>
        <Panel v-if="scene && diff.length" eyebrow="Saving this teaches your writer soul" title="Your edits vs the AI draft" class="diff">
          <p><template v-for="(d, i) in diff" :key="i"><ins v-if="d.added">{{ d.value }}</ins><del v-else-if="d.removed">{{ d.value }}</del><span v-else>{{ d.value }}</span></template></p>
        </Panel>
      </div>
    </div>

    <!-- CHARACTER ROOM -->
    <div v-else-if="tab === 'room'" class="bento">
      <div class="stack span-4">
        <Panel eyebrow="Who">
          <ul class="list"><li v-for="c in bible.characters" :key="c.id" :class="{ on: c.id === roomId }" @click="openRoom(c.id)"><div class="who"><span class="avatar">{{ initials(c.name) }}</span><div><b>{{ c.name }}</b><br /><span class="muted">{{ c.role }}</span></div></div></li></ul>
        </Panel>
        <template v-if="roomId">
          <Panel eyebrow="Knowledge horizon" :title="asOf === null ? 'The whole story' : `As of scene ${asOf}`">
            <input type="range" :min="0" :max="maxOrder" :value="asOf ?? maxOrder" @input="asOf = Number(($event.target as HTMLInputElement).value); refreshState()" />
            <button class="pill" @click="asOf = null; refreshState()">Whole story</button>
          </Panel>
          <Panel eyebrow="Mind">
            <button class="pill" :disabled="!!busy" @click="run('building mirror', () => api(`/characters/${roomId}/mirror`, 'POST')).then(refreshState)">Build psychological mirror</button>
            <label>A situation for them to decide on</label>
            <input v-model="situation" placeholder="Jonah offers her the ledger back" /><button class="pill solid" :disabled="!situation || !!busy" @click="decideIt">Let them decide</button>
            <div v-if="decision" class="idea" style="margin-top:12px">
              <div class="idea-body">{{ decision.decision }}</div>
              <p class="muted">{{ decision.reasoning }}</p>
              <p class="muted">Rejected: {{ decision.rejected.join('; ') }} · feeling {{ decision.emotion }} · cost: {{ decision.cost }}</p>
              <span v-if="decisionSaved" class="ok">Saved to soul</span><template v-else><button class="pill yes" @click="keepDecision">Keep this decision</button> <span class="muted">scratch until kept</span></template>
            </div>
          </Panel>
          <Panel eyebrow="Soul">
            <div class="row"><button class="pill" @click="soul('save', ask('Snapshot name?', 'snapshot'))">Save</button><button class="pill" @click="soul('reset')">Reset to base</button><button class="pill" @click="api(`/characters/${roomId}/souls`).then((s) => souls = s as string[])">List</button></div>
            <ul class="list" style="margin-top:8px"><li v-for="s in souls" :key="s" @click="soul('restore', s)">Restore <b>{{ s }}</b></li></ul>
            <details v-if="state"><summary>Replayed state</summary><pre class="json">{{ JSON.stringify(state, null, 1) }}</pre></details>
          </Panel>
        </template>
      </div>
      <Panel v-if="roomId" :key="roomId" :span="8" :eyebrow="asOf === null ? 'As of the end' : `As of scene ${asOf}`" :title="`Talking to ${byId(roomId)}`">
        <div class="chat">
          <template v-for="(h, i) in history" :key="i">
            <div class="bubble" :class="h.role === 'user' ? 'me' : 'them'">{{ h.content }}</div>
            <div v-for="(f, j) in h.findings ?? []" :key="j" class="trace f-error">⚠ {{ f.message }}</div>
          </template>
          <p v-if="!history.length" class="empty">Ask them something. They answer as they are at the horizon, and a leak detector checks every reply.</p>
          <div v-if="busy" class="trace">…</div>
        </div>
        <div class="composer"><input v-model="msg" placeholder="Ask them something" @keyup.enter="msg && !busy && send()" /><Cta :disabled="!msg || !!busy" @click="send">Send</Cta></div>
      </Panel>
      <Panel v-else :span="8" eyebrow="Nobody yet"><p class="empty">Pick a character. Slide the horizon to talk to them as they were at any scene.</p></Panel>
    </div>

    <!-- MUSE -->
    <div v-else-if="tab === 'muse'" class="bento">
      <Panel :span="5" eyebrow="The scenario" title="Where are you stuck?">
        <textarea v-model="scenario" style="min-height:160px" placeholder="Optional. Leave blank and the muse finds the pressure points in the souls." />
        <div class="field-row"><div><label>As of scene</label><input v-model.number="museAsOf" type="number" :max="maxOrder" :min="0" placeholder="end" /></div></div>
        <label>Who decides for themselves (the rest follow you)</label>
        <div class="row"><label v-for="c in bible.characters" :key="c.id" class="check"><input v-model="museAgency" type="checkbox" :value="c.id" /> {{ c.name }}</label></div>
        <div class="row" style="margin-top:16px"><Cta :disabled="!!busy" @click="museIt">Throw me ideas</Cta></div>
      </Panel>
      <div class="stack span-7">
        <Panel v-if="museDecisions.length" eyebrow="Scratch · not saved to anyone's soul" title="What they would do">
          <div v-for="(d, k) in museDecisions" :key="k" class="idea"><span class="idea-kind">{{ d.name }}</span><div class="idea-body">{{ d.decision }}</div><span class="muted">{{ d.emotion }} · {{ d.reasoning }}</span></div>
        </Panel>
        <Panel v-if="ideas.length" eyebrow="Ideas" :title="`${ideas.length} ways in`">
          <div v-for="(i, k) in ideas" :key="k" class="idea"><span class="idea-kind">{{ i.kind }}</span><div class="idea-body">{{ i.idea }}</div><span class="muted">Grows from {{ i.growsFrom }} · {{ i.characters.map(byId).join(', ') }}</span></div>
        </Panel>
        <Panel v-if="!ideas.length && !museDecisions.length" eyebrow="Waiting"><p class="empty">Ideas land here, each one tied to the souls it grows from.</p></Panel>
      </div>
    </div>

    <!-- STYLE: the writer soul -->
    <div v-else-if="tab === 'style'" class="bento">
      <template v-if="style">
        <Panel :span="7" :eyebrow="`Writer soul · ${style.writerId}${style.asOf ? ' · as of ' + style.asOf.slice(0, 10) : ''}`" title="Is this you?">
          <template #actions><Cta :disabled="!!busy || !style.edits.length" @click="learn">Learn from my edits<template v-if="style.unlearnedEdits"> · {{ style.unlearnedEdits }} new</template></Cta></template>
          <p class="muted">Rules learned from your rewrites. Confirmed rules go into every draft; rejected ones never come back.</p>
          <div v-for="r in style.rules" :key="r.id" class="rule" :class="r.status">
            <div class="rule-text">{{ r.text }}</div>
            <div v-if="r.evidence.length" class="evidence">{{ r.evidence[r.evidence.length - 1] }}</div>
            <div class="row" style="margin-top:10px">
              <span class="status" :class="{ accepted: r.status === 'confirmed' }">{{ r.status }}<template v-if="r.status === 'proposed' && r.seen > 1"> · seen {{ r.seen }}×</template><template v-if="r.origin === 'author'"> · yours</template></span>
              <template v-if="r.status === 'proposed'"><button class="pill yes" @click="verdict(r.id, 'confirm')">This is me</button><button class="pill" @click="verdict(r.id, 'reject')">Not me</button></template>
            </div>
          </div>
          <p v-if="!style.rules.length" class="empty">No rules yet. They are proposed every third edit, or press Learn.</p>
          <h3>A rule of your own</h3>
          <div class="composer"><input v-model="ownRule" placeholder="Never open a chapter with weather" @keyup.enter="ownRule && addOwnRule()" /><button class="pill solid" :disabled="!ownRule" @click="addOwnRule">Add</button></div>
        </Panel>
        <div class="stack span-5">
          <Panel eyebrow="Measured from your edits" title="Your habits">
            <ul class="list plain"><li v-for="(t, k) in style.tendencies" :key="k" style="font:400 16px/1.45 var(--prose)">{{ t.text }}</li></ul>
            <p v-if="!style.tendencies.length" class="empty">Measured once you have rewritten two AI drafts ({{ style.edits.length }} so far).</p>
          </Panel>
          <Panel eyebrow="Teach it" title="Your own prose">
            <textarea v-model="sample" style="min-height:180px;font:400 16px/1.65 var(--prose)" placeholder="Paste a page you wrote." />
            <div class="row"><button class="pill solid" :disabled="!sample" @click="addSample">Add sample</button><button class="pill" :disabled="!!busy" @click="sheet">Distil style sheet</button></div>
          </Panel>
        </div>
        <Panel :span="7" eyebrow="Profile" :title="`${style.samples.length} samples · ${style.edits.length} edits`">
          <div v-if="style.stats" class="stat-grid">
            <div class="stat"><b>{{ style.stats.avgSentenceLen }}</b><span>words per sentence</span></div>
            <div class="stat"><b>{{ style.stats.avgParagraphLen }}</b><span>words per paragraph</span></div>
            <div class="stat"><b>{{ Math.round(Number(style.stats.dialogueRatio) * 100) }}%</b><span>paragraphs with dialogue</span></div>
            <div class="stat"><b>{{ style.stats.adverbRate }}</b><span>adverbs per 100 words</span></div>
            <div class="stat"><b>{{ style.stats.commaPerSentence }}</b><span>commas per sentence</span></div>
            <div class="stat"><b>{{ style.stats.words }}</b><span>words of yours</span></div>
          </div>
          <p v-else class="empty">Add a sample to measure your voice.</p>
        </Panel>
        <Panel :span="5" eyebrow="Distilled" title="Style sheet"><p style="white-space:pre-wrap;font:400 15px/1.6 var(--prose)">{{ style.sheet || 'None yet. Distil one from your samples.' }}</p></Panel>
      </template>
      <Panel v-else :span="12"><p class="empty">Opening your writer soul…</p></Panel>
    </div>

    <!-- VERIFY -->
    <div v-else-if="tab === 'verify'" class="bento">
      <Panel :span="12" eyebrow="Summary">
        <template #actions><button class="pill" :disabled="!!busy" @click="verify">Re-run</button><Cta @click="openExport">Export Markdown</Cta></template>
        <div class="stat-grid"><div v-for="c in reportCounts" :key="c.l" class="stat"><b>{{ c.n }}</b><span>{{ c.l }}</span></div></div>
      </Panel>
      <Panel v-for="(fs, key) in report ?? {}" :key="key" :span="fs.length > 2 ? 6 : 4" :eyebrow="String(key)">
        <p v-if="!fs.length" class="ok">Clean</p>
        <div v-for="(f, i) in fs" :key="i" class="finding" :class="'f-' + f.level"><code>{{ f.code }}</code><span>{{ f.message }}</span></div>
      </Panel>
    </div>
  </main>

  <div v-if="error" class="toast" role="alert">{{ error }} <button @click="error = ''">Dismiss</button></div>
</template>
