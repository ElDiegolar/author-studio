import { expect, test, type Page } from '@playwright/test';
import { api, idle, open, panel, run } from './helpers';

const MANUSCRIPT = `# The Harbour Ledger

## Chapter 1

Mara counted the boats from the end of the pier. Eleven. There should have been twelve. Mara wrote the number down.

"You're late," Jonah said. Mara did not answer him. Jonah never waited long.

* * *

Later, Mara walked to the customs shed. Jonah was already there with the manifest. Mara read every line.

## Chapter 2

The customs shed smelled of diesel. Elias Thorne came in from the rain and looked at Mara, then at Jonah.

"Sign it," Jonah said. Mara read it twice. Elias Thorne said nothing. Jonah left without the copy.
`.repeat(1);

async function toLibrary(page: Page) {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await page.locator('.brand').click();
  await expect(page.locator('.hero h1')).toHaveText(/Your novels/);
}

test('the library lists the open novel with its numbers', async ({ page }) => {
  await page.goto('/');
  await page.locator('.brand').click();
  await expect(page.locator('.hero h1')).toHaveText(/Your novels/);
  const row = page.locator('.novels li', { hasText: 'The Test Road' });
  await expect(row).toContainText('words');
  await expect(row.locator('.status', { hasText: 'open' })).toBeVisible();
});

test('import a manuscript with AI: preview, choose the cast, build, and it opens', async ({ page }) => {
  await toLibrary(page);
  await page.setInputFiles('input[type=file]', { name: 'harbour-ledger.md', mimeType: 'text/markdown', buffer: Buffer.from(MANUSCRIPT) });
  const imp = panel(page, /chapters, \d+ scenes/);
  await expect(imp).toBeVisible();
  await expect(imp.locator('label:has-text("Title") + input')).toHaveValue('The Harbour Ledger');
  await expect(imp.locator('.chapters li')).toHaveCount(2);
  for (const n of ['Mara', 'Jonah']) await expect(imp.locator('label.check', { hasText: n }).first()).toBeVisible();
  // make sure the cast is exactly what we want
  for (const label of await imp.locator('label.check.on').all()) { if (!/Mara|Jonah|Elias/.test((await label.textContent()) ?? '')) await label.locator('input').uncheck(); }
  for (const n of ['Mara', 'Jonah', 'Elias Thorne']) { const l = imp.locator('label.check', { hasText: n }).first(); if (await l.count() && !(await l.locator('input').isChecked())) await l.locator('input').check(); }
  await imp.getByRole('button', { name: 'Build the novel' }).click();
  await expect(page.locator('.brand')).toHaveText('The Harbour Ledger', { timeout: run().live ? 600_000 : 20_000 });
  const b = await api('/bible');
  expect(b.project.title).toBe('The Harbour Ledger');
  expect(b.scenes.length).toBe(3);
  expect(b.characters.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Mara', 'Jonah']));
  if (!run().live) {
    expect(b.premise.logline).toContain('customs clerk');
    expect(b.world.map((w: { name: string }) => w.name)).toEqual(expect.arrayContaining(['Greyhaven', 'Customs shed']));
    expect(b.scenes.every((s: { goal: string }) => s.goal.length > 0)).toBe(true);
  }
  expect((await api('/writer')).samples.length).toBeGreaterThan(0);
});

test('the reader turns pages, keeps your place, and opens the scene to edit', async ({ page }) => {
  await open(page, 'Read');
  await expect(page.locator('.title-page h1')).toHaveText('The Harbour Ledger');
  const foot = page.locator('.reader-foot .muted');
  await expect(foot).toContainText(/Page 1–2 of \d+/);
  await page.keyboard.press('ArrowRight');
  await expect(foot).toContainText(/Page 3–4 of/);
  await page.keyboard.press('ArrowLeft');
  await expect(foot).toContainText(/Page 1–2 of/);
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.reload();
  await page.locator('.links button', { hasText: 'Read' }).click();
  await expect(foot).toContainText(/Page 3–4 of/); // remembered
  await page.getByRole('button', { name: 'Contents' }).click();
  await page.getByRole('menuitem', { name: 'Chapter 2' }).click();
  await page.getByRole('button', { name: 'Larger text' }).click();
  await page.locator('.swatch.sepia').click();
  await expect(page.locator('.reader')).toHaveClass(/sepia/);
  await page.getByRole('button', { name: 'Edit this scene' }).click();
  await expect(page.locator('.hero h1')).toHaveText(/Scene by scene/);
  await expect(page.locator('textarea.prose')).not.toHaveValue('');
});

test('phone: one page at a time, swipe to turn, no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.sheet button', { hasText: 'Read' }).click();
  const foot = page.locator('.reader-foot .muted');
  await expect(foot).toContainText(/Page \d+ of \d+/);
  await expect(foot).not.toContainText('–');
  const box = (await page.locator('.pages').boundingBox())!;
  const before = await foot.textContent();
  await page.mouse.move(box.x + box.width * 0.8, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.2, box.y + 200); await page.mouse.up();
  await expect(foot).not.toHaveText(before!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('export the whole work in every format', async () => {
  for (const [f, sig] of [['docx', 'PK'], ['epub', 'PK'], ['md', '# The Harbour Ledger'], ['txt', 'THE HARBOUR LEDGER'], ['html', '<!doctype html>']] as const) {
    const r = await fetch(`${run().base}/api/export/${f}`);
    expect(r.ok).toBe(true);
    expect(r.headers.get('content-disposition')).toContain(encodeURIComponent('The Harbour Ledger'));
    const head = Buffer.from(await r.arrayBuffer()).subarray(0, 40).toString('utf8');
    expect(head.startsWith(sig)).toBe(true);
  }
});

test('create a new novel from scratch, then switch back through the library', async ({ page }) => {
  await toLibrary(page);
  const n = panel(page, 'New novel');
  await n.locator('label:has-text("Title") + input').fill('Second Book');
  await n.getByRole('button', { name: 'Start writing' }).click();
  await expect(page.locator('.brand')).toHaveText('Second Book');
  await page.locator('.brand').click();
  await page.locator('.novels li', { hasText: 'The Test Road' }).click();
  await expect(page.locator('.brand')).toHaveText('The Test Road');
  expect((await api('/library')).projects.length).toBeGreaterThanOrEqual(3);
});

test('manual mode: No AI hides every AI action; the book still works; then AI comes back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('label.mode', { hasText: 'No AI' }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('AI is off: manual mode.')).toBeVisible();
  const rooms = await page.locator('.links button').allTextContents();
  expect(rooms).not.toContain('Studio');
  expect(rooms).not.toContain('Ideas');
  await page.locator('.links button', { hasText: 'Write' }).click();
  await panel(page, 'Scenes').locator('li:not(:has(.status.accepted))').first().click();
  await expect(page.getByRole('button', { name: 'Draft with AI' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'AI outline…' })).toHaveCount(0);
  // accepting still works without AI
  await page.locator('textarea.prose').fill('Written by hand. '.repeat(40));
  await expect(page.locator('.save')).toContainText('Saved');
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('.finding', { hasText: 'Accepted without AI' })).toBeVisible();
  await page.locator('.links button', { hasText: 'Story' }).click();
  await expect(page.getByText('Seed a character')).toHaveCount(0);
  // restore the fake model so later runs of the suite keep working
  const r = run();
  await api('/settings', 'PUT', r.live ? { ai: { mode: 'claude-code' } } : { ai: { mode: 'local', localUrl: r.fakeUrl, localModel: 'fake' } });
  expect((await api('/settings')).aiOn).toBe(true);
});
