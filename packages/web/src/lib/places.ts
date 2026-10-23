/** Showing the studio's files in the system file manager, and short "Saved" notices that can do the same. */
import { ref } from 'vue';
import { api } from '../api';

const ua = navigator.userAgent;
/** What the system calls its file manager. */
export const fileManager = /Mac/i.test(ua) ? 'Finder' : /Win/i.test(ua) ? 'File Explorer' : 'Files';

export async function reveal(path: string): Promise<void> { await api('/reveal', 'POST', { path }); }

/** The last part of a path, for labels ("Author Studio", "settings.json"). */
export const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export interface Notice { text: string; path?: string; id: number }
export const notice = ref<Notice | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, path?: string): void {
  notice.value = { text, ...(path ? { path } : {}), id: Date.now() };
  clearTimeout(timer); timer = setTimeout(() => { notice.value = null; }, 8000);
}

/** The desktop app reports where each export was saved. */
type Desktop = { onSaved?(cb: (p: string) => void): void; savePdf?(): Promise<string | null>; platform?: string };
export const desktop = (window as unknown as { authorDesktop?: Desktop }).authorDesktop;
desktop?.onSaved?.((p) => notify(`Saved “${baseName(p)}”`, p));
