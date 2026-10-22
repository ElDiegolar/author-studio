import { expect, test, type Page } from '@playwright/test';
import { api, idle, open, panel, run } from './helpers';

async function room(page: Page, name = 'Mara Voss') {
  await open(page, 'Characters');
  await page.locator('.bezel').filter({ hasText: 'Who' }).first().locator('li', { hasText: name }).click();
  await expect(panel(page, `Talking to ${name}`)).toBeVisible();
}
async function say(page: Page, text: string) {
  const chat = panel(page, /Talking to/);
  await chat.getByPlaceholder('Ask them something').fill(text);
  await chat.getByRole('button', { name: 'Send' }).click();
  await idle(page);
  return chat;
}

test('the knowledge horizon: asked as of scene 1 about a place introduced in scene 3, the leak is flagged', async ({ page }) => {
  await room(page);
  await page.locator('input[type=range]').fill('1');
  await expect(panel(page, 'As of scene 1')).toBeVisible();
  const chat = await say(page, 'Have you been to Greyhaven?');
  await expect(chat.locator('.bubble.them')).toHaveCount(1);
  if (!run().live) await expect(chat.locator('.trace.f-error', { hasText: 'Greyhaven' })).toBeVisible();
});

test('whole story = everything she has lived; asking about what she knows raises no leak', async ({ page }) => {
  await room(page);
  await page.getByRole('button', { name: 'Whole story' }).click();
  await expect(panel(page, 'The whole story')).toBeVisible();
  const chat = await say(page, 'Do you trust your brother?');
  await expect(chat.locator('.bubble.them')).toHaveCount(1);
  await expect(chat.locator('.trace.f-error')).toHaveCount(0);
});

test('build the psychological mirror (stored as psyche traits)', async ({ page }) => {
  await room(page);
  await page.getByRole('button', { name: 'Build psychological mirror' }).click();
  await idle(page);
  const st = await api(`/characters/${run().ids.mara}/state`);
  expect(Object.keys(st.traits).filter((k) => k.startsWith('psyche.')).length).toBeGreaterThanOrEqual(5);
});

test('let them decide: scratch until Keep, then saved to the soul', async ({ page }) => {
  await room(page);
  const before = (await api(`/characters/${run().ids.mara}/state`)).decisions.length;
  await page.getByPlaceholder('Jonah offers her the ledger back').fill('A van crashes in front of her on the way to the boat.');
  await page.getByRole('button', { name: 'Let them decide' }).click();
  await idle(page);
  await expect(page.getByText('scratch until kept')).toBeVisible();
  expect((await api(`/characters/${run().ids.mara}/state`)).decisions.length).toBe(before);
  await page.getByRole('button', { name: 'Keep this decision' }).click();
  await expect(page.getByText('Saved to soul')).toBeVisible();
  expect((await api(`/characters/${run().ids.mara}/state`)).decisions.length).toBe(before + 1);
});

test('soul snapshots: save, reset to base, restore', async ({ page }) => {
  await room(page);
  const lived = (await api(`/characters/${run().ids.mara}/state`)).eventCount;
  page.once('dialog', (d) => d.accept('e2e-snap'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await idle(page);
  await page.getByRole('button', { name: 'Reset to base' }).click();
  await idle(page);
  const reset = await api(`/characters/${run().ids.mara}/state`);
  expect(reset.eventCount).toBeLessThan(lived);
  expect(reset.witnessed).toEqual([]);
  await page.getByRole('button', { name: 'List' }).click();
  await page.locator('li', { hasText: 'Restore e2e-snap' }).click();
  await idle(page);
  expect((await api(`/characters/${run().ids.mara}/state`)).eventCount).toBe(lived);
});
