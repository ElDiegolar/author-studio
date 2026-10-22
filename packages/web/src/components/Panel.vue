<script setup lang="ts">
/** Double-bezel card: tinted shell, inner core with its own highlight and concentric radius. */
defineProps<{ span?: number; eyebrow?: string; title?: string }>();
</script>

<template>
  <section v-reveal class="bezel" :class="span ? `span-${span}` : ''">
    <div class="core">
      <header v-if="title || eyebrow || $slots.actions" class="ph">
        <div><span v-if="eyebrow" class="micro">{{ eyebrow }}</span><h2 v-if="title">{{ title }}</h2></div>
        <div v-if="$slots.actions" class="ph-actions"><slot name="actions" /></div>
      </header>
      <slot />
    </div>
  </section>
</template>
