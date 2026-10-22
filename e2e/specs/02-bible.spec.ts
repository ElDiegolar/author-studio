import { expect, test } from '@playwright/test';
import { api, idle, open, panel, run } from './helpers';

test('premise and voice edits persist to project files', async ({ page }) => {
  await open(page, 'Bible');
  const p = panel(page, 'Premise & voice');
  await p.locator('label:has-text("Tone") + input').fill('spare and cold');
  await p.locator('label:has-text("Tone") + input').blur();
  await p.locator('label:has-text("Theme") + input').fill('What a record owes the truth');
  await p.locator('label:has-text("Theme") + input').blur();
  await expect.poll(async () => (await api('/bible')).project.voice.tone).toBe('spare and cold');
  await expect.poll(async () => (await api('/bible')).premise.theme).toBe('What a record owes the truth');
});

test('add a world entry', async ({ page }) => {
  await open(page, 'Bible');
  const w = panel(page, /entries/);
  await w.locator('select').first().selectOption('faction');
  await w.getByPlaceholder('Name').fill('The Harbour Board');
  await w.getByPlaceholder('Summary').fill('Five men who own the tide tables.');
  await w.getByRole('button', { name: 'Add world entry' }).click();
  await expect(w).toContainText('The Harbour Board');
  expect((await api('/bible')).world.map((x: { name: string }) => x.name)).toContain('The Harbour Board');
});

test('fill the sheet by hand and add a character (with a base soul)', async ({ page }) => {
  await open(page, 'Bible');
  const s = panel(page, 'Fill the sheet directly');
  await s.locator('label:has-text("Name") + input').fill('Elias Thorne');
  await s.locator('label:has-text("Role") + input').fill('harbour master');
  await s.locator('label:has-text("Summary") + textarea').fill('Sixty, dying slowly, keeps the keys.');
  await s.getByRole('button', { name: 'Add character' }).click();
  await idle(page);
  await expect(panel(page, /souls/)).toContainText('Elias Thorne');
  const elias = (await api('/bible')).characters.find((c: { name: string }) => c.name === 'Elias Thorne');
  expect(await api(`/characters/${elias.id}/souls`)).toContain('base');
});

test('a seeded proposal fills the sheet; nothing is saved until Add; edits and dropped traits are honoured', async ({ page }) => {
  await open(page, 'Bible');
  const before = (await api('/bible')).characters.length;
  const seed = panel(page, 'Seed a character');
  await seed.getByPlaceholder(/Deckard/).fill('a Miss Havisham figure who keeps the lighthouse');
  await seed.getByRole('button', { name: 'Propose' }).click();
  const sheet = panel(page, /^Seeded/);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('label:has-text("Name") + input')).not.toHaveValue('');
  expect((await api('/bible')).characters.length).toBe(before); // proposing saves nothing
  await sheet.locator('label:has-text("Name") + input').fill('Constance Hale');
  const traits = seed.locator('.list.plain li');
  const n = await traits.count();
  expect(n).toBeGreaterThan(0);
  const keys = (await traits.locator('.status').allTextContents()).map((k) => k.trim());
  const dropped = keys[0]!;
  await traits.first().getByRole('button', { name: 'Drop' }).click();
  await sheet.getByRole('button', { name: 'Add this character' }).click();
  await idle(page);
  const c = (await api('/bible')).characters.find((x: { name: string }) => x.name === 'Constance Hale');
  expect(c, 'the edited name is what was saved').toBeTruthy();
  const st = await api(`/characters/${c.id}/state`);
  expect(Object.keys(st.traits)).not.toContain(dropped);
  for (const k of keys.slice(1)) expect(Object.keys(st.traits)).toContain(k);
  expect(keys.length).toBe(n);
  await expect(panel(page, 'Fill the sheet directly')).toBeVisible(); // form resets
});

test('build a character by talking, review proposed edits, apply to soul', async ({ page }) => {
  await open(page, 'Bible');
  const b = panel(page, 'A new character');
  await b.getByPlaceholder(/harbour pilot/).fill('a harbour pilot who owes everyone money');
  await b.getByRole('button', { name: 'Send' }).click();
  await idle(page);
  await expect(b.locator('.bubble.them')).toHaveCount(1);
  await expect(b.getByText('Proposed edits')).toBeVisible();
  await b.getByRole('button', { name: 'Apply to soul' }).click();
  await idle(page);
  const names = (await api('/bible')).characters.map((c: { name: string }) => c.name);
  if (!run().live) expect(names).toContain('Tobin Rake');
  expect(names.length).toBeGreaterThanOrEqual(5);
});
