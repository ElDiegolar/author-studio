import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

export interface Run { tmp: string; project: string; writerHome: string; live: boolean; fakeUrl: string | null; cloudUrl: string | null; base: string; ids: { mara: string; jonah: string } }
export const run = (): Run => JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.run.json'), 'utf8')) as Run;

export async function api<T = any>(p: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(run().base + '/api' + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return (r.headers.get('content-type') ?? '').includes('json') ? r.json() : (r.text() as Promise<T>);
}

/** Open the app on a room via the island nav, failing the test on any page error. */
export async function open(page: Page, room: string): Promise<void> {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await page.locator('.links button', { hasText: room }).click();
  await expect(page.locator('.links button.on')).toHaveText(room);
}

/** Wait until the app is idle (no busy pulse) and no error toast is showing. */
export async function idle(page: Page): Promise<void> {
  await expect(page.locator('.island .pulse')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
}

/** A panel (double-bezel card) by its title. */
export const panel = (page: Page, title: string | RegExp) => page.locator('.bezel').filter({ has: page.locator('h2', { hasText: title }) }).first();
