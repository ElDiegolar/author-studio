<script setup lang="ts">
/** Your novels on this machine, a new one from scratch, or one imported from a manuscript you already have. */
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import Panel from './Panel.vue';
import Cta from './Cta.vue';

interface Entry { dir: string; title: string; genre: string; scenes: number; characters: number; words: number; updatedAt: string }
interface Preview { id: string; format: string; title: string; words: number; chapters: { title: string; scenes: number; words: number }[]; scenes: number; candidates: { name: string; count: number; dialogue: number }[]; exactCast: boolean; aiOn: boolean }
interface Job { status: 'previewed' | 'running' | 'done' | 'failed'; progress: { step: string; done: number; total: number } | null; error: string | null; dir: string | null; warnings: string[] }

const props = defineProps<{ aiOn: boolean }>();
const emit = defineEmits<{ (e: 'opened'): void }>();

const lib = ref<{ dir: string; current: string | null; projects: Entry[] } | null>(null);
const busy = ref(''); const error = ref('');
const draft = ref({ title: '', genre: '', author: '' });
const drag = ref(false);
const pv = ref<Preview | null>(null);
const opts = ref({ title: '', genre: '', cast: new Set<string>(), extra: '', useAi: true, continuity: false });
const job = ref<Job | null>(null);
const FORMATS = 'Word, OpenDocument, RTF, Markdown, text, HTML, EPUB, PDF, Final Draft, Scrivener (zip the .scriv folder)';
const ACCEPT = '.docx,.odt,.rtf,.md,.markdown,.txt,.text,.html,.htm,.xhtml,.epub,.pdf,.fdx,.zip';

async function refresh() { lib.value = await api('/library'); }
onMounted(refresh);

async function guard<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  busy.value = label; error.value = '';
  try { return await fn(); } catch (e) { error.value = (e as Error).message; return undefined; } finally { busy.value = ''; }
}
async function openNovel(dir: string) { if (await guard('opening', () => api('/library/open', 'POST', { dir }))) emit('opened'); }
async function create() { if (await guard('creating', () => api('/library/create', 'POST', draft.value))) emit('opened'); }

async function upload(file: File) {
  pv.value = null; job.value = null;
  const r = await guard(`reading ${file.name}`, async () => {
    const res = await fetch(`/api/import/preview?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? res.statusText);
    return j as Preview;
  });
  if (!r) return;
  pv.value = r;
  // Pre-tick the names that speak or recur most; the author decides.
  const strong = r.exactCast ? r.candidates : r.candidates.filter((c) => c.dialogue > 0 || c.count >= 8);
  opts.value = { title: r.title, genre: '', cast: new Set(strong.slice(0, 10).map((c) => c.name)), extra: '', useAi: r.aiOn, continuity: false };
}
function pick(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void upload(f); (e.target as HTMLInputElement).value = ''; }
function drop(e: DragEvent) { drag.value = false; const f = e.dataTransfer?.files?.[0]; if (f) void upload(f); }
function toggle(n: string) { const s = new Set(opts.value.cast); if (s.has(n)) s.delete(n); else s.add(n); opts.value.cast = s; }
const castList = computed(() => [...opts.value.cast, ...opts.value.extra.split(',').map((x) => x.trim()).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i));

async function build() {
  if (!pv.value) return;
  const ok = await guard('starting import', () => api(`/import/${pv.value!.id}/commit`, 'POST', { title: opts.value.title, genre: opts.value.genre, characters: castList.value, useAi: opts.value.useAi && props.aiOn, continuity: opts.value.continuity }));
  if (!ok) return;
  job.value = { status: 'running', progress: null, error: null, dir: null, warnings: [] };
  for (;;) {
    await new Promise((r) => setTimeout(r, 600));
    job.value = await api<Job>(`/import/${pv.value.id}`);
    if (job.value.status === 'done') { await refresh(); if (!job.value.warnings.length) emit('opened'); return; }
    if (job.value.status === 'failed') { error.value = job.value.error ?? 'Import failed'; return; }
  }
}
const pct = computed(() => (job.value?.progress ? Math.round((job.value.progress.done / job.value.progress.total) * 100) : 0));
const ago = (iso: string) => { const d = (Date.now() - new Date(iso).getTime()) / 60000; return d < 1 ? 'just now' : d < 60 ? `${Math.round(d)} min ago` : d < 1440 ? `${Math.round(d / 60)} h ago` : new Date(iso).toLocaleDateString(); };
</script>

<template>
  <div class="bento">
    <Panel :span="7" eyebrow="On this machine" :title="lib ? `${lib.projects.length} novel${lib.projects.length === 1 ? '' : 's'}` : 'Your novels'">
      <p class="muted">Stored as plain files you own in <code>{{ lib?.dir }}</code>. Nothing is uploaded.</p>
      <ul class="list novels">
        <li v-for="p in lib?.projects ?? []" :key="p.dir" :class="{ on: p.dir === lib?.current }" @click="openNovel(p.dir)">
          <div class="who"><span class="avatar">{{ p.title.slice(0, 1).toUpperCase() }}</span>
            <div><b>{{ p.title }}</b> <span v-if="p.dir === lib?.current" class="status accepted">open</span><br />
              <span class="muted">{{ p.genre || 'No genre' }} · {{ p.words.toLocaleString() }} words · {{ p.scenes }} scenes · {{ p.characters }} characters · {{ ago(p.updatedAt) }}</span></div></div>
        </li>
      </ul>
      <p v-if="lib && !lib.projects.length" class="empty">No novels yet. Start one, or import a manuscript you already have.</p>
    </Panel>
    <div class="stack span-5">
      <Panel eyebrow="From scratch" title="New novel">
        <label>Title</label><input v-model="draft.title" placeholder="The Salt Road" @keyup.enter="draft.title && create()" />
        <div class="field-row"><div><label>Genre</label><input v-model="draft.genre" placeholder="Literary thriller" /></div><div><label>Author name</label><input v-model="draft.author" placeholder="For title pages" /></div></div>
        <Cta :disabled="!draft.title || !!busy" @click="create">Start writing</Cta>
      </Panel>
      <Panel eyebrow="Bring your book" title="Import a manuscript">
        <label class="drop" :class="{ drag }" @dragover.prevent="drag = true" @dragleave="drag = false" @drop.prevent="drop">
          <input type="file" :accept="ACCEPT" class="sr" @change="pick" />
          <b>Drop a file, or choose one</b>
          <span class="muted">{{ FORMATS }}</span>
        </label>
      </Panel>
    </div>

    <Panel v-if="pv" :span="12" :eyebrow="`Import · ${pv.format} · ${pv.words.toLocaleString()} words`" :title="`${pv.chapters.length} chapters, ${pv.scenes} scenes`">
      <div class="bento" style="gap:24px">
        <div class="span-7">
          <div class="field-row"><div><label>Title</label><input v-model="opts.title" /></div><div><label>Genre</label><input v-model="opts.genre" placeholder="optional" /></div></div>
          <label>{{ pv.exactCast ? 'Characters named in the script' : 'Who is in it? Suggested from the text; tick the real characters' }}</label>
          <div class="row">
            <label v-for="c in pv.candidates" :key="c.name" class="check" :class="{ on: opts.cast.has(c.name) }"><input type="checkbox" :checked="opts.cast.has(c.name)" @change="toggle(c.name)" /> {{ c.name }} <span v-if="c.count" class="muted">{{ c.count }}</span></label>
          </div>
          <input v-model="opts.extra" placeholder="Anyone missing? Names, comma separated" style="margin-top:10px" />
          <template v-if="aiOn">
            <label class="check" style="margin-top:12px"><input v-model="opts.useAi" type="checkbox" /> Use AI to write scene cards, character sheets, premise and world</label>
            <label v-if="opts.useAi" class="check" style="margin-top:8px"><input v-model="opts.continuity" type="checkbox" /> Also build continuity: facts and every character's memories (slower)</label>
          </template>
          <p v-else class="muted" style="margin-top:12px">AI is off: chapters, scenes, your cast and who appears where are built from the text alone. You can fill the cards in by hand, or turn AI on in Settings first.</p>
          <div class="row" style="margin-top:16px">
            <Cta :disabled="!!busy || job?.status === 'running' || !opts.title" @click="build">Build the novel</Cta>
            <button class="pill" :disabled="job?.status === 'running'" @click="pv = null; job = null">Cancel</button>
          </div>
          <div v-if="job" class="progress" role="status">
            <div class="track"><div class="fill" :style="{ transform: `scaleX(${pct / 100})` }" /></div>
            <span class="muted">{{ job.status === 'done' ? 'Done.' : job.progress?.step ?? 'Starting…' }} {{ pct }}%</span>
            <template v-if="job.status === 'done' && job.warnings.length">
              <p class="f-warn">Imported, with {{ job.warnings.length }} note(s):</p>
              <ul class="list plain"><li v-for="(w, i) in job.warnings.slice(0, 8)" :key="i" class="muted">{{ w }}</li></ul>
              <button class="pill solid" @click="emit('opened')">Open the novel</button>
            </template>
          </div>
        </div>
        <div class="span-5">
          <label>Chapters found</label>
          <ol class="chapters">
            <li v-for="(c, i) in pv.chapters" :key="i"><span>{{ c.title }}</span><span class="muted">{{ c.scenes }} scene{{ c.scenes === 1 ? '' : 's' }} · {{ c.words.toLocaleString() }} w</span></li>
          </ol>
        </div>
      </div>
    </Panel>
    <div v-if="error" class="toast" role="alert">{{ error }} <button @click="error = ''">Dismiss</button></div>
    <div v-if="busy" class="toast" style="color:var(--ink-2)">{{ busy }}…</div>
  </div>
</template>

<style scoped>
code { font: 12px var(--mono); color: var(--ink-2); }
.novels li { padding: 14px; }
.drop { display: grid; gap: 6px; place-items: center; text-align: center; padding: 34px 18px; border-radius: 20px; cursor: pointer; margin: 0; color: var(--ink);
  background: var(--field); box-shadow: inset 0 0 0 1px var(--hair-2); transition: background 400ms var(--spring), box-shadow 400ms var(--spring); font: 400 14px/1.4 var(--ui); letter-spacing: 0; }
.drop:hover, .drop.drag { background: var(--violet-wash); box-shadow: inset 0 0 0 1px var(--accent); }
.drop b { font-weight: 560; }
.sr { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.check.on { box-shadow: inset 0 0 0 1px var(--accent); background: var(--violet-wash); }
.chapters { margin: 0; padding: 0 0 0 1.2em; max-height: 340px; overflow: auto; font-size: 14px; }
.chapters li { padding: 6px 0; display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--hair); }
.progress { display: grid; gap: 8px; margin-top: 18px; }
.track { height: 3px; border-radius: 3px; background: var(--hair-2); overflow: hidden; }
.fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transform-origin: left; transition: transform 500ms var(--spring); }
</style>
