<script setup lang="ts">
/**
 * Turning AI on for someone who has never done it: pick the AI you know, follow three steps to a
 * key, paste it, and the studio checks it works before keeping it. What is already on the computer
 * (Claude Code signed in, a local model app) is found and offered first. Nothing technical is asked
 * unless the writer opens Advanced.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api';
import Panel from './Panel.vue';
import Cta from './Cta.vue';
import PathLink from './PathLink.vue';

type Mode = 'anthropic' | 'claude-code' | 'local' | 'cloud' | 'studio' | 'none';
interface Ai { mode: Mode; service?: string; model?: string; cheapModel?: string; localUrl?: string; localModel?: string; hasKey: boolean; keyHint: string; keyHints: Record<string, string>; studio?: { email: string; plan: string; portalUrl?: string } }
interface S { ai: Ai; aiOn: boolean; settingsFile: string; library: string; writerHome: string }
interface Service { id: string; name: string; known: string; blurb: string; keyUrl: string; steps: string[]; keyPrefix?: string }
interface Detect { claudeCode: { installed: boolean; signedIn: boolean | null }; local: { url: string; app: string; models: string[] }[] }
/** A choice on the screen: one of the hosted services, Claude by key, Claude Code, a local app, or none. */
type Choice = { kind: 'studio' } | { kind: 'anthropic' } | { kind: 'cloud'; id: string } | { kind: 'claude-code' } | { kind: 'local' } | { kind: 'none' };

const emit = defineEmits<{ (e: 'saved', aiOn: boolean): void }>();
const s = ref<S | null>(null);
const services = ref<Service[]>([]);
const found = ref<Detect | null>(null);
const choice = ref<Choice | null>(null);
const key = ref(''); const showKey = ref(false);
const state = ref<'' | 'checking' | 'ok' | 'failed'>(''); const message = ref('');
const models = ref<string[]>([]);
const local = ref({ url: '', model: '' });
const adv = ref({ model: '', cheapModel: '' });
// Author Studio AI: the subscription, connected by device sign-in.
const studio = ref<{ available: boolean; connected: boolean; email: string; portalUrl: string } | null>(null);
const link = ref<{ code: string; verifyUrl: string } | null>(null);
const usage = ref<{ fraction: number | null } | null>(null);
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const ANTHROPIC = { name: 'Claude', known: 'Claude', blurb: 'Made by Anthropic. The studio is tuned for it: the best results for drafting and characters. Pay as you go.', keyUrl: 'https://console.anthropic.com/settings/keys',
  steps: ['Sign in at console.anthropic.com (or create an account).', 'Add a little credit under Billing.', 'Create a key, copy it, and paste it here.'], keyPrefix: 'sk-ant-' };
const FEATURED = ['openai', 'gemini'];
const featured = computed(() => services.value.filter((x) => FEATURED.includes(x.id)));
const more = computed(() => services.value.filter((x) => !FEATURED.includes(x.id)));
const current = computed<Service | typeof ANTHROPIC | null>(() => {
  const c = choice.value;
  if (c?.kind === 'anthropic') return ANTHROPIC;
  if (c?.kind === 'cloud') return services.value.find((x) => x.id === c.id) ?? null;
  return null;
});
const savedHint = computed(() => { const c = choice.value; if (!s.value || !c) return ''; return c.kind === 'anthropic' ? s.value.ai.keyHint : c.kind === 'cloud' ? s.value.ai.keyHints?.[c.id] ?? '' : ''; });
const is = (c: Choice) => choice.value?.kind === c.kind && (c.kind !== 'cloud' || (choice.value as { id?: string }).id === c.id);

/** What AI is doing right now, in words. */
const nowUsing = computed(() => {
  const a = s.value?.ai; if (!a || !s.value?.aiOn) return '';
  const svc = services.value.find((x) => x.id === a.service);
  if (a.mode === 'studio') return `Author Studio AI${a.studio?.email ? ` (${a.studio.email})` : ''}`;
  const name = a.mode === 'anthropic' ? 'Claude, with your key' : a.mode === 'claude-code' ? 'Claude, through your Claude subscription' : a.mode === 'cloud' ? `${svc?.known ?? 'a hosted AI'}${svc && svc.known !== svc.name ? ` (${svc.name})` : ''}` : `a model on this computer${a.localModel ? ` (${a.localModel})` : ''}`;
  return a.model && a.mode !== 'local' ? `${name} · ${a.model}` : name;
});

onMounted(async () => {
  [s.value, services.value] = await Promise.all([api<S>('/settings'), api<Service[]>('/ai/services').catch(() => [])]);
  const a = s.value.ai;
  adv.value = { model: a.model ?? '', cheapModel: a.cheapModel ?? '' };
  local.value = { url: a.localUrl ?? '', model: a.localModel ?? '' };
  studio.value = await api<{ available: boolean; connected: boolean; email: string; portalUrl: string }>('/studio-ai').catch(() => null);
  if (studio.value?.available && !s.value.aiOn) pickChoice({ kind: 'studio' });
  if (s.value.ai.mode === 'studio') void loadUsage();
  found.value = await api<Detect>('/ai/detect').catch(() => null);
  if (!local.value.url && found.value?.local[0]) local.value = { url: found.value.local[0].url, model: found.value.local[0].models[0] ?? '' };
});

async function loadUsage() { usage.value = await api<{ fraction: number | null }>('/studio-ai/usage').catch(() => null); }
/** Sign in: the browser opens on the account page; this screen waits and connects by itself. */
async function studioSignIn() {
  clearTimeout(pollTimer); state.value = ''; message.value = '';
  try {
    const r = await api<{ code: string; verifyUrl: string; interval: number }>('/studio-ai/start', 'POST');
    link.value = { code: r.code, verifyUrl: r.verifyUrl };
    window.open(r.verifyUrl, '_blank', 'noopener');
    const tick = async () => {
      const p = await api<{ status: string; ai?: Ai; aiOn?: boolean }>('/studio-ai/poll', 'POST').catch(() => ({ status: 'pending' } as { status: string; ai?: Ai; aiOn?: boolean }));
      if (p.status === 'ok' && p.ai) {
        link.value = null; if (s.value) s.value = { ...s.value, ai: p.ai, aiOn: !!p.aiOn };
        studio.value = await api<NonNullable<typeof studio.value>>('/studio-ai').catch(() => studio.value);
        state.value = 'ok'; message.value = 'Connected. AI is on.'; emit('saved', !!p.aiOn); void loadUsage(); return;
      }
      if (['expired', 'consumed', 'unknown'].includes(p.status)) { link.value = null; state.value = 'failed'; message.value = 'The sign-in code expired. Press Sign in again.'; return; }
      message.value = p.status === 'needs_plan' ? 'Signed in. Waiting for you to subscribe in the browser…' : 'Waiting for you to sign in in the browser…';
      pollTimer = setTimeout(tick, (r.interval || 3) * 1000);
    };
    state.value = 'checking'; message.value = 'Waiting for you to sign in in the browser…';
    pollTimer = setTimeout(tick, (r.interval || 3) * 1000);
  } catch (e) { state.value = 'failed'; message.value = (e as Error).message; }
}
async function studioSignOut() {
  const r = await api<{ ai: Ai; aiOn: boolean }>('/studio-ai/signout', 'POST');
  if (s.value) s.value = { ...s.value, ai: r.ai, aiOn: r.aiOn };
  studio.value = studio.value ? { ...studio.value, connected: false, email: '' } : null; usage.value = null;
  state.value = 'ok'; message.value = 'Signed out of Author Studio AI on this computer.'; emit('saved', r.aiOn);
}
onBeforeUnmount(() => clearTimeout(pollTimer));
function pickChoice(c: Choice) { choice.value = c; key.value = ''; state.value = ''; message.value = ''; models.value = []; }

/** Send a choice to be tested; it is kept only if the test passes. */
async function connect(ai: Record<string, unknown>, checking: string) {
  state.value = 'checking'; message.value = checking;
  try {
    const r = await api<{ ok: boolean; reason?: string; models?: string[]; ai?: Ai; aiOn?: boolean }>('/ai/connect', 'POST', { ai });
    models.value = r.models ?? [];
    if (!r.ok) { state.value = 'failed'; message.value = r.reason ?? 'That did not work.'; return; }
    if (s.value && r.ai) s.value = { ...s.value, ai: r.ai, aiOn: !!r.aiOn };
    adv.value = { model: r.ai?.model ?? '', cheapModel: r.ai?.cheapModel ?? '' };
    key.value = ''; state.value = 'ok'; message.value = 'Connected. AI is on.';
    emit('saved', !!r.aiOn);
  } catch (e) { state.value = 'failed'; message.value = (e as Error).message; }
}
function connectKey() {
  const c = choice.value; const svc = current.value; if (!c || !svc) return;
  const ai = c.kind === 'anthropic' ? { mode: 'anthropic', apiKey: key.value } : { mode: 'cloud', service: (c as { id: string }).id, apiKey: key.value };
  void connect(ai, `Checking with ${svc.name}…`);
}
/** Pasting a whole key is the signal: check it straight away. */
function pasted(e: ClipboardEvent) {
  const t = e.clipboardData?.getData('text')?.trim() ?? '';
  if (t.length >= 20) { key.value = t; setTimeout(connectKey, 0); }
}
const useClaudeCode = () => connect({ mode: 'claude-code' }, 'Checking Claude Code… the first time can take up to a minute.');
const useLocal = () => connect({ mode: 'local', localUrl: local.value.url, localModel: local.value.model }, 'Asking the model on this computer…');
async function turnOff() {
  const r = await api<{ ai: Ai; aiOn: boolean }>('/settings', 'PUT', { ai: { ...(s.value?.ai ?? {}), mode: 'none' } });
  if (s.value) s.value = { ...s.value, ai: r.ai, aiOn: r.aiOn };
  state.value = 'ok'; message.value = 'AI is off. Everything else works as before.'; emit('saved', false);
}
async function saveModels() {
  const a = s.value?.ai; if (!a) return;
  await connect({ ...a, model: adv.value.model, cheapModel: adv.value.cheapModel }, 'Checking the models…');
}
const pickedLocal = computed(() => found.value?.local.find((l) => l.url === local.value.url));
const chosenLabel = computed(() => (choice.value?.kind === 'studio' ? 'Author Studio AI' : choice.value?.kind === 'claude-code' ? 'Claude subscription' : choice.value?.kind === 'local' ? 'This computer' : current.value?.known ?? ''));
</script>

<template>
  <div class="bento">
    <Panel :span="8" eyebrow="AI helper" :title="s?.aiOn ? 'AI is on' : 'Add an AI helper'">
      <template v-if="s?.aiOn" #actions><button class="pill" @click="turnOff">Turn off</button></template>
      <p v-if="s?.aiOn" class="using"><span class="dot" />Using {{ nowUsing }}</p>
      <div v-if="s?.ai.mode === 'studio' && usage?.fraction != null" class="meter" :title="`${Math.round(usage.fraction * 100)}% of this month's AI allowance used`">
        <div class="bar"><div class="fill" :style="{ transform: `scaleX(${usage.fraction})` }" /></div>
        <span class="muted small">{{ Math.round(usage.fraction * 100) }}% of this month's AI used</span>
      </div>
      <p class="intro">An AI can draft scenes for you to rewrite, suggest ideas when you are stuck, and answer as your characters. It is optional: everything else works without it.</p>

      <h3 class="step-h">{{ s?.aiOn ? 'Switch to a different AI' : 'Which AI would you like to use?' }}</h3>
      <div class="choices" role="radiogroup" aria-label="AI service">
        <button v-if="studio?.available" type="button" role="radio" :aria-checked="is({ kind: 'studio' })" class="choice wide" :class="{ on: is({ kind: 'studio' }) }" @click="pickChoice({ kind: 'studio' })">
          <span class="badge found">{{ studio.connected ? 'Connected' : 'Easiest' }}</span><b>Author Studio AI</b><span class="muted">Included with a subscription. No keys and no AI accounts: sign in once and it just works.</span>
        </button>
        <button v-if="found?.claudeCode.installed" type="button" role="radio" :aria-checked="is({ kind: 'claude-code' })" class="choice" :class="{ on: is({ kind: 'claude-code' }) }" @click="pickChoice({ kind: 'claude-code' })">
          <span class="badge found">Found on this computer</span><b>Your Claude subscription</b><span class="muted">Claude Code is installed here. Uses your Claude plan: no key, nothing extra to pay.</span>
        </button>
        <button type="button" role="radio" :aria-checked="is({ kind: 'anthropic' })" class="choice" :class="{ on: is({ kind: 'anthropic' }) }" @click="pickChoice({ kind: 'anthropic' })">
          <span v-if="!found?.claudeCode.installed" class="badge">Recommended</span><b>Claude</b><span class="muted">{{ ANTHROPIC.blurb }}</span>
        </button>
        <button v-for="x in featured" :key="x.id" type="button" role="radio" :aria-checked="is({ kind: 'cloud', id: x.id })" class="choice" :class="{ on: is({ kind: 'cloud', id: x.id }) }" @click="pickChoice({ kind: 'cloud', id: x.id })">
          <span v-if="x.id === 'gemini'" class="badge free">Free to start</span><b>{{ x.known }}<span v-if="x.known !== x.name" class="muted"> · {{ x.name }}</span></b><span class="muted">{{ x.blurb }}</span>
        </button>
      </div>
      <details class="more">
        <summary>More choices: {{ more.map((x) => x.known).join(', ') }}<template v-if="found?.local.length">, a model on this computer</template></summary>
        <div class="choices">
          <button v-for="x in more" :key="x.id" type="button" role="radio" :aria-checked="is({ kind: 'cloud', id: x.id })" class="choice" :class="{ on: is({ kind: 'cloud', id: x.id }) }" @click="pickChoice({ kind: 'cloud', id: x.id })">
            <b>{{ x.known }}<span v-if="x.known !== x.name" class="muted"> · {{ x.name }}</span></b><span class="muted">{{ x.blurb }}</span>
          </button>
          <button type="button" role="radio" :aria-checked="is({ kind: 'local' })" class="choice" :class="{ on: is({ kind: 'local' }) }" @click="pickChoice({ kind: 'local' })">
            <span v-if="found?.local.length" class="badge found">Found: {{ found.local[0]!.app }}</span><b>A model on this computer</b><span class="muted">For people who already run Ollama, LM Studio or llama.cpp. Works offline; needs a strong graphics card.</span>
          </button>
          <button v-if="!found?.claudeCode.installed" type="button" role="radio" :aria-checked="is({ kind: 'claude-code' })" class="choice" :class="{ on: is({ kind: 'claude-code' }) }" @click="pickChoice({ kind: 'claude-code' })">
            <b>Claude Code</b><span class="muted">For developers who use Claude Code: the studio uses its sign-in. It was not found on this computer.</span>
          </button>
        </div>
      </details>

      <!-- the steps for the chosen AI -->
      <div v-if="choice && choice.kind !== 'none'" v-reveal class="setup" aria-live="polite">
        <span class="micro">Set up {{ chosenLabel }}</span>
        <template v-if="choice.kind === 'studio'">
          <template v-if="studio?.connected">
            <p>Signed in as <b>{{ studio.email }}</b>.</p>
            <div class="row"><a v-if="studio.portalUrl" class="pill solid" :href="studio.portalUrl" target="_blank" rel="noopener">Manage subscription ↗</a><button class="pill" @click="studioSignOut">Sign out on this computer</button></div>
          </template>
          <template v-else-if="link">
            <p>Your browser opened. Check it shows this code:</p>
            <div class="bigcode">{{ link.code }}</div>
            <p class="muted small">Browser didn't open? <a :href="link.verifyUrl" target="_blank" rel="noopener">Open the page</a></p>
          </template>
          <template v-else>
            <ol class="steps">
              <li><span>Press Sign in. Your browser opens.</span></li>
              <li><span>Sign in with your email and choose the plan.</span></li>
              <li><span>Come back here. It connects by itself.</span></li>
            </ol>
            <div class="row"><Cta :disabled="state === 'checking'" @click="studioSignIn">Sign in</Cta></div>
          </template>
        </template>
        <template v-else-if="current">
          <ol class="steps">
            <li v-for="(t, i) in current.steps" :key="i"><span>{{ t }}</span><a v-if="i === 0" class="pill" :href="current.keyUrl" target="_blank" rel="noopener">Open {{ current.keyUrl.replace(/^https:\/\//, '').split('/')[0] }} ↗</a></li>
          </ol>
          <div class="keyrow">
            <input v-model="key" :type="showKey ? 'text' : 'password'" autocomplete="off" spellcheck="false" :placeholder="savedHint ? `Saved key ${savedHint}: paste a new one to replace it` : `Paste your key here${current.keyPrefix ? ` (it starts with ${current.keyPrefix})` : ''}`" aria-label="Key" @paste="pasted" @keyup.enter="(key || savedHint) && connectKey()" />
            <button type="button" class="pill" :aria-pressed="showKey" @click="showKey = !showKey">{{ showKey ? 'Hide' : 'Show' }}</button>
          </div>
          <div class="row"><Cta :disabled="state === 'checking' || (!key && !savedHint)" @click="connectKey">{{ savedHint && !key ? 'Use saved key' : 'Connect' }}</Cta></div>
          <p class="muted small">The key is kept only on this computer. You can set a monthly spending limit on their site.</p>
        </template>
        <template v-else-if="choice.kind === 'claude-code'">
          <p v-if="found?.claudeCode.installed" class="muted">{{ found.claudeCode.signedIn === false ? 'Claude Code is installed but does not look signed in. Open Claude Code once and sign in, then come back.' : 'Nothing to paste. The studio asks Claude Code to say hello to check it works.' }}</p>
          <p v-else class="muted">Install Claude Code from claude.com/claude-code and sign in, then press Check again.</p>
          <div class="row"><Cta :disabled="state === 'checking'" @click="useClaudeCode">{{ found?.claudeCode.installed ? 'Use my Claude subscription' : 'Check again' }}</Cta></div>
        </template>
        <template v-else-if="choice.kind === 'local'">
          <template v-if="found?.local.length">
            <label>Running on this computer</label>
            <select v-model="local.url" @change="local.model = pickedLocal?.models[0] ?? ''"><option v-for="l in found.local" :key="l.url" :value="l.url">{{ l.app }} · {{ l.url.replace('http://', '') }}</option></select>
            <label>Model</label>
            <select v-if="pickedLocal?.models.length" v-model="local.model"><option v-for="m in pickedLocal.models" :key="m" :value="m">{{ m }}</option></select>
            <input v-else v-model="local.model" placeholder="The model name your app shows" />
          </template>
          <template v-else>
            <p class="muted">No model app is running right now. Open Ollama, LM Studio or llama.cpp, load a model, then come back to this page. Or enter its address:</p>
            <div class="field-row"><div><label>Address</label><input v-model="local.url" placeholder="http://127.0.0.1:11434/v1" /></div><div><label>Model</label><input v-model="local.model" placeholder="as the app names it" /></div></div>
          </template>
          <div class="row"><Cta :disabled="state === 'checking' || !local.url" @click="useLocal">Use this model</Cta></div>
        </template>
      </div>

      <p v-if="state" class="result" :class="state" role="status"><span v-if="state === 'checking'" class="spin" />{{ message }}<template v-if="state === 'ok' && s?.aiOn && nowUsing"> Using {{ nowUsing }}.</template></p>

      <details v-if="s?.aiOn && s.ai.mode !== 'local'" class="more">
        <summary>Advanced: choose the models yourself</summary>
        <div class="field-row">
          <div><label>Writing and characters</label>
            <select v-if="models.length" v-model="adv.model"><option v-for="m in models" :key="m" :value="m">{{ m }}</option></select>
            <input v-else v-model="adv.model" :placeholder="s.ai.model || 'default'" /></div>
          <div><label>Quick jobs (proofreading, facts)</label>
            <select v-if="models.length" v-model="adv.cheapModel"><option v-for="m in models" :key="m" :value="m">{{ m }}</option></select>
            <input v-else v-model="adv.cheapModel" :placeholder="s.ai.cheapModel || 'default'" /></div>
        </div>
        <button class="pill" :disabled="state === 'checking'" @click="saveModels">Check and use these models</button>
      </details>

      <p v-if="!s?.aiOn" class="muted small off-note">Not now? The studio works fully without AI. You can come back here any time.</p>
    </Panel>

    <Panel :span="4" eyebrow="Where things live" title="On this computer">
      <template v-if="s">
        <p class="muted label">Your novels</p><PathLink :path="s.library" />
        <p class="muted label">What the studio learned about your style</p><PathLink :path="s.writerHome" />
        <p class="muted label">Settings and keys</p><PathLink :path="s.settingsFile" />
      </template>
      <p class="muted small">Your book stays on this computer. When AI helps, only the passage it is working on is sent to the AI you chose. Nothing is used for training.</p>
    </Panel>
  </div>
</template>

<style scoped>
.intro { color: var(--ink-2); margin: 0 0 6px; max-width: 62ch; }
.using { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; color: var(--ink); font-size: 14px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok, #3ecf8e); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok, #3ecf8e) 20%, transparent); }
.step-h { margin: 22px 0 10px; }
.choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0 4px; }
.choice { position: relative; display: grid; gap: 6px; align-content: start; text-align: left; margin: 0; padding: 16px 18px; border: 0; border-radius: 18px; cursor: pointer; background: var(--field); box-shadow: inset 0 0 0 1px var(--hair);
  color: var(--ink); font: 400 13px/1.45 var(--ui); transition: box-shadow 400ms var(--spring), background 400ms var(--spring), transform 400ms var(--spring); }
.choice:hover { transform: translateY(-1px); }
.choice b { font: 560 15px/1.2 var(--ui); }
.choice b .muted { font-weight: 400; }
.choice.wide { grid-column: 1 / -1; }
.bigcode { display: inline-block; font: 600 26px/1 var(--mono); letter-spacing: 0.14em; padding: 14px 18px; border-radius: 14px; background: var(--paper-2); box-shadow: inset 0 0 0 1px var(--hair-2); margin: 4px 0 12px; }
.meter { display: grid; gap: 6px; margin: -4px 0 14px; max-width: 360px; }
.meter .bar { height: 4px; border-radius: 4px; background: var(--hair-2); overflow: hidden; }
.meter .fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transform-origin: left; transition: transform 600ms var(--spring); }
.choice.on { background: var(--violet-wash); box-shadow: inset 0 0 0 1px var(--accent); }
.badge { justify-self: start; font: 500 10px/1 var(--ui); letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 8px; border-radius: 99px; background: var(--violet-wash); color: var(--accent); }
.badge.found, .badge.free { background: color-mix(in srgb, var(--ok, #3ecf8e) 16%, transparent); color: var(--ok, #3ecf8e); }
.setup { margin-top: 18px; padding: 18px 20px; border-radius: 18px; background: var(--field); box-shadow: inset 0 0 0 1px var(--hair-2); }
.steps { margin: 12px 0 14px; padding-left: 1.3em; display: grid; gap: 10px; color: var(--ink-2); }
.steps li { padding-left: 4px; }
.steps li span { margin-right: 10px; }
.steps .pill { display: inline-flex; vertical-align: middle; text-decoration: none; }
.keyrow { display: flex; gap: 8px; align-items: center; }
.keyrow input { flex: 1; margin: 0; font-family: var(--mono); }
.small { font-size: 12.5px; }
.result { display: flex; align-items: center; gap: 10px; margin: 16px 0 0; padding: 12px 16px; border-radius: 14px; font-size: 14px; background: var(--field); color: var(--ink-2); }
.result.ok { color: var(--ok, #3ecf8e); }
.result.failed { color: var(--warn, #e8b04b); }
.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--hair-2); border-top-color: var(--accent); animation: spin 900ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.label { margin: 14px 0 0; font-size: 12.5px; }
.off-note { margin-top: 16px; }
@media (max-width: 768px) { .choices { grid-template-columns: 1fr; } .keyrow { flex-wrap: wrap; } }
</style>
