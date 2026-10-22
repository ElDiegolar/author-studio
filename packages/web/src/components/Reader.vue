<script setup lang="ts">
/**
 * The book, page by page. The text flows into CSS columns the size of a page; turning a page
 * slides the strip by one page (two on wide screens, as a spread). Chapters start on a new page.
 * Position, type size and paper are remembered per novel in this browser.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api';

interface Book { title: string; author: string; genre: string; words: number; chapters: { n: number; title: string; scenes: { id: string; title: string; text: string; status: string }[] }[] }
const props = defineProps<{ storageKey: string }>();
const emit = defineEmits<{ (e: 'edit', sceneId: string): void }>();

const book = ref<Book | null>(null);
const error = ref('');
const page = ref(0);
const pages = ref(1);
const spread = ref(false);
const pageW = ref(480);
const GAP = 64;
const viewport = ref<HTMLElement | null>(null);
const flow = ref<HTMLElement | null>(null);
const prefs = ref<{ size: number; paper: 'paper' | 'sepia' | 'night' }>({ size: 19, paper: 'paper' });
const toc = ref(false);

const key = (k: string) => `author-reader:${props.storageKey}:${k}`;
function load<T>(k: string, d: T): T { try { const v = localStorage.getItem(key(k)); return v ? (JSON.parse(v) as T) : d; } catch { return d; } }
function save(k: string, v: unknown) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch { /* private window */ } }

const paras = (t: string) => t.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
const step = computed(() => (spread.value ? 2 : 1));
const shown = computed(() => (spread.value ? [page.value, page.value + 1] : [page.value]).filter((p) => p < pages.value));
const progress = computed(() => (pages.value <= 1 ? 1 : Math.min(1, (page.value + step.value) / pages.value)));
const strip = computed(() => ({ transform: `translate3d(${-page.value * (pageW.value + GAP)}px,0,0)`, columnWidth: `${pageW.value}px`, columnGap: `${GAP}px`, fontSize: `${prefs.value.size}px` }));

/** Fit the page to the window, then count pages from the laid-out text. */
async function layout(keepAnchor = true) {
  const vp = viewport.value; const fl = flow.value;
  if (!vp || !fl) return;
  const anchor = keepAnchor ? anchorAt(page.value) : null;
  const w = vp.clientWidth;
  spread.value = w >= 1060;
  pageW.value = Math.floor(spread.value ? (w - GAP) / 2 : w);
  await nextTick();
  pages.value = Math.max(1, Math.round((fl.scrollWidth + GAP) / (pageW.value + GAP)));
  if (anchor) goTo(pageOf(anchor));
  else page.value = Math.min(page.value, last());
}
const last = () => Math.max(0, spread.value ? pages.value - (pages.value % 2 === 0 ? 2 : 1) : pages.value - 1);
const pageOf = (el: HTMLElement) => Math.floor((el.offsetLeft + 1) / (pageW.value + GAP));
/** The first chapter or scene marker on a page, used to keep your place when the layout changes. */
function anchorAt(p: number): HTMLElement | null {
  const marks = [...(flow.value?.querySelectorAll<HTMLElement>('[data-anchor]') ?? [])];
  return marks.filter((m) => pageOf(m) <= p).pop() ?? null;
}
function goTo(p: number) {
  const target = Math.max(0, Math.min(last(), spread.value ? p - (p % 2) : p));
  page.value = target;
  save('page', target);
}
const next = () => goTo(page.value + step.value);
const prev = () => goTo(page.value - step.value);
function jump(chapterIndex: number) { const el = flow.value?.querySelector<HTMLElement>(`[data-chapter="${chapterIndex}"]`); if (el) goTo(pageOf(el)); toc.value = false; }
/** The scene under the left page, so "Edit this" opens what you are reading. */
function sceneHere(): string | null { return anchorAt(page.value + (spread.value ? 1 : 0))?.dataset.scene ?? flow.value?.querySelector<HTMLElement>('[data-scene]')?.dataset.scene ?? null; }
function editHere() { const id = sceneHere(); if (id) emit('edit', id); }

function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
  else if (e.key === 'Home') goTo(0); else if (e.key === 'End') goTo(last());
}
let touchX: number | null = null;
const onDown = (e: PointerEvent) => { touchX = e.clientX; };
function onUp(e: PointerEvent) {
  if (touchX === null) return;
  const dx = e.clientX - touchX; touchX = null;
  if (Math.abs(dx) > 40) { if (dx < 0) next(); else prev(); return; }
  if (window.getSelection()?.toString()) return;
  const r = viewport.value!.getBoundingClientRect();
  if (e.clientX > r.left + r.width * 0.66) next(); else if (e.clientX < r.left + r.width * 0.33) prev();
}
function size(d: number) { prefs.value.size = Math.min(26, Math.max(14, prefs.value.size + d)); }
function paper(p: 'paper' | 'sepia' | 'night') { prefs.value.paper = p; }
watch(() => prefs.value.size, async () => { save('prefs', prefs.value); await nextTick(); await layout(); });
watch(() => prefs.value.paper, () => save('prefs', prefs.value));

let ro: ResizeObserver | null = null;
onMounted(async () => {
  prefs.value = load('prefs', prefs.value);
  try { book.value = await api<Book>('/book'); } catch (e) { error.value = (e as Error).message; return; }
  await nextTick();
  await document.fonts?.ready;
  page.value = load('page', 0);
  await layout(false);
  goTo(page.value);
  ro = new ResizeObserver(() => { void layout(); });
  if (viewport.value) ro.observe(viewport.value);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => { ro?.disconnect(); window.removeEventListener('keydown', onKey); });
defineExpose({ next, prev, goTo, pages, page });
</script>

<template>
  <div class="reader" :class="prefs.paper">
    <div class="reader-bar">
      <div class="row">
        <button class="pill" :aria-expanded="toc" @click="toc = !toc">Contents</button>
        <div v-if="toc && book" class="toc" role="menu">
          <button v-for="(c, i) in book.chapters" :key="c.n" role="menuitem" @click="jump(i)">{{ c.title }}</button>
        </div>
      </div>
      <div class="row">
        <button class="pill" aria-label="Smaller text" @click="size(-1)">A−</button>
        <button class="pill" aria-label="Larger text" @click="size(1)">A+</button>
        <button v-for="p in (['paper', 'sepia', 'night'] as const)" :key="p" class="swatch" :class="[p, { on: prefs.paper === p }]" :aria-label="`${p} page`" :title="p" @click="paper(p)" />
        <button class="pill" :disabled="!book?.chapters.length" @click="editHere">Edit this scene</button>
      </div>
    </div>

    <p v-if="error" class="empty">{{ error }}</p>
    <p v-else-if="book && !book.chapters.length" class="empty">Nothing to read yet. Write or import a scene and it appears here, page by page.</p>
    <div v-else class="book" :class="{ spread }">
      <button class="turn prev" aria-label="Previous page" :disabled="page === 0" @click="prev">‹</button>
      <div ref="viewport" class="pages" aria-live="polite" @pointerdown="onDown" @pointerup="onUp">
        <div ref="flow" class="flow" :style="strip">
          <section v-if="book" class="title-page" data-anchor>
            <h1>{{ book.title }}</h1>
            <p v-if="book.author" class="byline">{{ book.author }}</p>
            <p class="meta">{{ book.words.toLocaleString() }} words · {{ book.chapters.length }} chapter{{ book.chapters.length === 1 ? '' : 's' }}</p>
          </section>
          <section v-for="(c, i) in book?.chapters ?? []" :key="c.n" class="r-chapter" :data-chapter="i" data-anchor>
            <h2>{{ c.title }}</h2>
            <template v-for="(s, j) in c.scenes" :key="s.id">
              <p v-if="j" class="break" aria-hidden="true">⁂</p>
              <div :data-scene="s.id" data-anchor class="scene"><p v-for="(p, k) in paras(s.text)" :key="k">{{ p }}</p></div>
            </template>
          </section>
          <section class="end-page" data-anchor><p>The end, for now.</p></section>
        </div>
        <span v-for="(p, i) in shown" :key="p" class="folio" :style="{ left: `${i * (pageW + GAP) + pageW / 2}px` }">{{ p + 1 }}</span>
      </div>
      <button class="turn next" aria-label="Next page" :disabled="page >= last()" @click="next">›</button>
    </div>
    <div v-if="book?.chapters.length" class="reader-foot">
      <div class="track"><div class="fill" :style="{ transform: `scaleX(${progress})` }" /></div>
      <span class="muted">Page {{ shown.map((p) => p + 1).join('–') }} of {{ pages }} · ← → to turn, or tap the edges</span>
    </div>
  </div>
</template>

<style scoped>
.reader { --page: #fbf8f1; --page-ink: #23201b; --page-muted: #8b8478; --page-rule: rgba(0, 0, 0, 0.08); }
.reader.sepia { --page: #f1e6cf; --page-ink: #3b2f20; --page-muted: #8c7a5f; --page-rule: rgba(60, 40, 10, 0.1); }
.reader.night { --page: #16161a; --page-ink: #d9d5cc; --page-muted: #7d7a72; --page-rule: rgba(255, 255, 255, 0.07); }
.reader-bar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; position: relative; }
.toc { position: absolute; top: 48px; left: 0; z-index: 5; max-height: 50vh; overflow: auto; min-width: 260px; padding: 8px; border-radius: 18px; background: var(--core); box-shadow: inset 0 0 0 1px var(--hair-2), var(--shadow); display: grid; }
.toc button { text-align: left; border: 0; background: none; color: var(--ink); font: 400 14px/1.3 var(--ui); padding: 10px 12px; border-radius: 12px; cursor: pointer; }
.toc button:hover { background: var(--field); }
.swatch { width: 28px; height: 28px; border-radius: 999px; border: 0; cursor: pointer; box-shadow: inset 0 0 0 1px var(--hair-2); transition: transform 300ms var(--spring); }
.swatch.paper { background: #fbf8f1; } .swatch.sepia { background: #f1e6cf; } .swatch.night { background: #16161a; }
.swatch.on { box-shadow: 0 0 0 2px var(--paper), 0 0 0 3px var(--accent); }
.swatch:active { transform: scale(0.92); }

.book { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; gap: 8px; }
.pages { position: relative; height: clamp(520px, calc(100dvh - 250px), 900px); overflow: hidden; border-radius: 6px; background: var(--page); color: var(--page-ink);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 30px 80px -30px rgba(0, 0, 0, 0.7), 0 0 0 1px var(--hair); padding: 0; touch-action: pan-y; user-select: text; }
.book.spread .pages::after { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 64px; transform: translateX(-50%); pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.06) 45%, rgba(0, 0, 0, 0.1) 50%, rgba(0, 0, 0, 0.06) 55%, transparent); }
.flow { height: 100%; column-fill: auto; padding: 56px 0 64px; box-sizing: border-box; transition: transform 650ms var(--spring); will-change: transform; font-family: var(--prose); line-height: 1.68; hyphens: auto; text-align: justify; }
.flow > section, .flow .scene { padding: 0 52px; }
.flow p { margin: 0; text-indent: 1.5em; widows: 2; orphans: 2; }
.flow h2 + .scene p:first-child, .flow .break + .scene p:first-child { text-indent: 0; }
.flow h2 + .scene p:first-child::first-letter { font-size: 3.1em; float: left; line-height: 0.85; padding: 0.06em 0.08em 0 0; font-weight: 500; }
.r-chapter { break-before: column; }
.r-chapter h2 { font: 400 1.6em/1.2 var(--prose); font-style: italic; text-align: center; margin: 3.2em 0 2em; letter-spacing: -0.01em; }
.break { text-align: center !important; text-indent: 0 !important; margin: 0.9em 0 !important; color: var(--page-muted); }
.title-page { height: calc(100% - 0px); display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: column; }
.title-page h1 { font: 400 2.6em/1.05 var(--prose); letter-spacing: -0.02em; margin: 0 0 0.5em; }
.title-page .byline { font-style: italic; text-indent: 0; } .title-page .meta { color: var(--page-muted); font: 500 11px/1 var(--ui); letter-spacing: 0.18em; text-transform: uppercase; text-indent: 0; margin-top: 3em; }
.end-page { break-before: column; text-align: center; padding-top: 40% !important; color: var(--page-muted); font-style: italic; }
.end-page p { text-indent: 0; text-align: center; }
.folio { position: absolute; bottom: 22px; transform: translateX(-50%); font: 500 11px/1 var(--ui); color: var(--page-muted); letter-spacing: 0.1em; }
.turn { height: 64px; border: 0; border-radius: 999px; background: var(--shell); color: var(--ink-2); font-size: 28px; cursor: pointer; box-shadow: inset 0 0 0 1px var(--hair); transition: background 400ms var(--spring), transform 300ms var(--spring); }
.turn:hover:not([disabled]) { background: var(--hair-2); }
.turn:active:not([disabled]) { transform: scale(0.94); }
.turn[disabled] { opacity: 0.25; cursor: default; }
.reader-foot { display: grid; gap: 10px; margin-top: 18px; justify-items: center; }
.track { width: min(520px, 100%); height: 2px; border-radius: 2px; background: var(--hair-2); overflow: hidden; }
.fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transform-origin: left; transition: transform 650ms var(--spring); }
@media (max-width: 768px) {
  .book { grid-template-columns: 1fr; }
  .turn { display: none; }
  .pages { height: calc(100dvh - 300px); }
  .flow > section, .flow .scene { padding: 0 24px; }
}
</style>
