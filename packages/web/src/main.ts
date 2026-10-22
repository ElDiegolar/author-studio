import { createApp, type Directive } from 'vue';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource-variable/geist';
import App from './App.vue';
import './style.css';

/** Fade-up once when an element first enters the viewport. Never replays on data refresh. */
const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io?.unobserve(e.target); }
}, { rootMargin: '0px 0px -8% 0px' });
const reveal: Directive<HTMLElement> = {
  mounted(el) { if (!io) return; el.classList.add('reveal'); io.observe(el); },
  unmounted(el) { io?.unobserve(el); },
};

createApp(App).directive('reveal', reveal).mount('#app');
