<script setup lang="ts">
/** Primary action: a pill with its arrow nested in its own circle (attrs and clicks fall through to the button). */
</script>

<template>
  <button class="cta">
    <span><slot /></span>
    <span class="cta-ic" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
  </button>
</template>
