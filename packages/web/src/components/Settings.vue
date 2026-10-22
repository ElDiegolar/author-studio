<script setup lang="ts">
/** How (and whether) the studio uses AI on this machine. The key is stored locally and never shown again. */
import { onMounted, ref } from 'vue';
import { api } from '../api';
import Panel from './Panel.vue';
import Cta from './Cta.vue';

type Mode = 'anthropic' | 'claude-code' | 'local' | 'none';
interface S { ai: { mode: Mode; model?: string; cheapModel?: string; localUrl?: string; localModel?: string; hasKey: boolean; keyHint: string }; aiOn: boolean; settingsFile: string; library: string }
const emit = defineEmits<{ (e: 'saved', aiOn: boolean): void }>();

const s = ref<S | null>(null);
const form = ref({ mode: 'anthropic' as Mode, apiKey: '', model: '', cheapModel: '', localUrl: '', localModel: '', clearKey: false });
const saved = ref(false); const error = ref(''); const busy = ref(false);
const MODES: { id: Mode; title: string; body: string }[] = [
  { id: 'anthropic', title: 'Your Anthropic key', body: 'Best quality. Requests go from this machine straight to Anthropic; you pay them directly. Your book files stay here.' },
  { id: 'claude-code', title: 'Claude Code', body: 'Uses your Claude subscription through the Claude Code app, if it is installed and signed in on this machine.' },
  { id: 'local', title: 'Local model', body: 'Fully offline: any OpenAI-compatible server on this machine (llama.cpp, LM Studio, Ollama). Needs a capable GPU.' },
  { id: 'none', title: 'No AI', body: 'Write everything yourself. Every AI action is hidden; the bible, souls, versions, reader, checks and export all still work.' },
];

onMounted(async () => {
  s.value = await api<S>('/settings');
  const a = s.value.ai;
  form.value = { mode: a.mode, apiKey: '', model: a.model ?? '', cheapModel: a.cheapModel ?? '', localUrl: a.localUrl ?? 'http://127.0.0.1:8081/v1', localModel: a.localModel ?? '', clearKey: false };
});
async function save() {
  busy.value = true; error.value = ''; saved.value = false;
  try {
    const f = form.value;
    const ai: Record<string, unknown> = { mode: f.mode, ...(f.model ? { model: f.model } : {}), ...(f.cheapModel ? { cheapModel: f.cheapModel } : {}), ...(f.localUrl ? { localUrl: f.localUrl } : {}), ...(f.localModel ? { localModel: f.localModel } : {}), ...(f.apiKey ? { apiKey: f.apiKey } : {}), ...(f.clearKey ? { clearKey: true } : {}) };
    const r = await api<{ ai: S['ai']; aiOn: boolean }>('/settings', 'PUT', { ai });
    if (s.value) s.value = { ...s.value, ai: r.ai, aiOn: r.aiOn };
    form.value.apiKey = ''; form.value.clearKey = false; saved.value = true;
    emit('saved', r.aiOn);
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
</script>

<template>
  <div class="bento">
    <Panel :span="8" eyebrow="AI" title="How should the studio think?">
      <div class="modes" role="radiogroup" aria-label="AI mode">
        <label v-for="m in MODES" :key="m.id" class="mode" :class="{ on: form.mode === m.id }">
          <input v-model="form.mode" type="radio" name="mode" :value="m.id" />
          <b>{{ m.title }}</b><span class="muted">{{ m.body }}</span>
        </label>
      </div>
      <template v-if="form.mode === 'anthropic'">
        <label>Anthropic API key <span v-if="s?.ai.hasKey" class="muted">· saved ({{ s.ai.keyHint }}); leave empty to keep it</span></label>
        <input v-model="form.apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" />
        <label v-if="s?.ai.hasKey" class="check" style="margin:4px 0 0"><input v-model="form.clearKey" type="checkbox" /> Remove the saved key</label>
      </template>
      <template v-if="form.mode === 'local'">
        <div class="field-row"><div><label>Server URL</label><input v-model="form.localUrl" placeholder="http://127.0.0.1:8081/v1" /></div><div><label>Model name</label><input v-model="form.localModel" placeholder="as the server names it" /></div></div>
      </template>
      <details v-if="form.mode === 'anthropic' || form.mode === 'claude-code'" style="margin-top:12px">
        <summary>Models</summary>
        <div class="field-row"><div><label>Drafting and characters</label><input v-model="form.model" :placeholder="form.mode === 'claude-code' ? 'claude-haiku-5-5' : 'claude-opus-5-5'" /></div><div><label>Extraction and proofreading</label><input v-model="form.cheapModel" placeholder="claude-haiku-5-5" /></div></div>
      </details>
      <div class="row" style="margin-top:18px">
        <Cta :disabled="busy" @click="save">Save settings</Cta>
        <span v-if="saved" class="ok">Saved. {{ s?.aiOn ? 'AI is on.' : 'AI is off: manual mode.' }}</span>
        <span v-if="error" class="f-error">{{ error }}</span>
      </div>
    </Panel>
    <Panel :span="4" eyebrow="Where things live" title="On this machine">
      <p class="muted">Novels</p><p><code>{{ s?.library }}</code></p>
      <p class="muted">Settings (and your key)</p><p><code>{{ s?.settingsFile }}</code></p>
      <p class="muted">Your writer soul follows you across every novel and lives beside the settings. Nothing is uploaded; nothing is used for training.</p>
    </Panel>
  </div>
</template>

<style scoped>
.modes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
.mode { display: grid; gap: 6px; margin: 0; padding: 16px 18px; border-radius: 18px; cursor: pointer; background: var(--field); box-shadow: inset 0 0 0 1px var(--hair); color: var(--ink);
  font: 400 13px/1.45 var(--ui); letter-spacing: 0; transition: box-shadow 400ms var(--spring), background 400ms var(--spring); }
.mode b { font: 560 15px/1.2 var(--ui); }
.mode.on { background: var(--violet-wash); box-shadow: inset 0 0 0 1px var(--accent); }
.mode input { position: absolute; opacity: 0; pointer-events: none; }
code { font: 12px/1.4 var(--mono); color: var(--ink-2); word-break: break-all; }
@media (max-width: 768px) { .modes { grid-template-columns: 1fr; } }
</style>
