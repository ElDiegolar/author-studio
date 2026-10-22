<script setup lang="ts">
/** The full work out: Word, EPUB, PDF (via the print-ready page), Markdown, plain text. */
const FORMATS = [
  { id: 'docx', label: 'Word' },
  { id: 'epub', label: 'EPUB' },
  { id: 'md', label: 'Markdown' },
  { id: 'txt', label: 'Text' },
] as const;
function pdf() {
  const w = window.open('/api/export/html?inline=1', '_blank');
  // The print-ready page opens; the system print dialog saves it as a PDF.
  w?.addEventListener('load', () => setTimeout(() => w.print(), 300));
}
</script>

<template>
  <div class="row" role="group" aria-label="Export the book">
    <a v-for="f in FORMATS" :key="f.id" class="pill" :href="`/api/export/${f.id}`" download>{{ f.label }}</a>
    <button class="pill" @click="pdf">PDF</button>
  </div>
</template>
