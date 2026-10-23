<script setup lang="ts">
/** A file or folder the studio keeps: one click shows it in File Explorer / Finder. */
import { ref } from 'vue';
import { fileManager, reveal } from '../lib/places';

const props = defineProps<{ path: string; label?: string }>();
const failed = ref('');
async function show() { failed.value = ''; try { await reveal(props.path); } catch (e) { failed.value = (e as Error).message; } }
</script>

<template>
  <button type="button" class="path" :title="`Show in ${fileManager}\n${path}`" @click.stop="show">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true"><path d="M1.75 4.25a1 1 0 0 1 1-1h3.1l1.4 1.5h5.999a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1Z" /></svg>
    <span class="where">{{ label ?? path }}</span>
    <span class="go">Show in {{ fileManager }}</span>
  </button>
  <span v-if="failed" class="f-warn path-err">{{ failed }}</span>
</template>

<style scoped>
.path { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; margin: 2px 0; padding: 6px 10px 6px 8px; border: 0; border-radius: 10px; cursor: pointer; text-align: left;
  background: transparent; color: var(--ink-2); font: 400 12px/1.4 var(--mono); transition: background 300ms var(--spring), color 300ms var(--spring); }
.path svg { flex: 0 0 15px; width: 15px; height: 15px; color: var(--accent); }
.where { overflow-wrap: anywhere; }
.go { flex: 0 0 auto; font: 500 11px/1 var(--ui); color: var(--accent); opacity: 0; transform: translateX(-4px); transition: opacity 300ms var(--spring), transform 300ms var(--spring); }
.path:hover, .path:focus-visible { background: var(--violet-wash); color: var(--ink); }
.path:hover .go, .path:focus-visible .go { opacity: 1; transform: none; }
@media (hover: none) { .go { opacity: 1; transform: none; } }
.path-err { display: block; font-size: 12px; margin: 0 0 6px 8px; }
</style>
