import { expect, test } from '@playwright/test';
import { api, idle, open, panel, run } from './helpers';

const PROSE = `The harbour smelled of diesel and old rope. Mara stood at the end of the pier and counted the boats. Eleven. There should have been twelve.

"You're late." Elias didn't turn around.

She didn't answer. She watched the water instead. Grey. Flat. Waiting.

The Albatross was gone. Nobody had seen her leave. Nobody ever did. Boats left the way people left: at night, without a word, owing money.`;

test('teach it your own prose: stats tiles are measured', async ({ page }) => {
  await open(page, 'Style');
  await panel(page, 'Your own prose').locator('textarea').fill(PROSE);
  await page.getByRole('button', { name: 'Add sample' }).click();
  await idle(page);
  const profile = panel(page, /samples ·/);
  await expect(profile.locator('.stat', { hasText: 'words per sentence' })).toBeVisible();
  expect((await api('/writer')).samples.length).toBeGreaterThanOrEqual(2); // the scene edit counts as one
});

test('learn from edits, then This is me / Not me', async ({ page }) => {
  await open(page, 'Style');
  const soul = panel(page, 'Is this you?');
  await soul.getByRole('button', { name: /Learn from my edits/ }).click();
  await idle(page);
  const proposed = soul.locator('.rule.proposed');
  await expect(proposed.first()).toBeVisible();
  const first = (await proposed.first().locator('.rule-text').textContent())!.trim();
  await proposed.first().getByRole('button', { name: 'This is me' }).click();
  await idle(page);
  await expect(soul.locator('.rule.confirmed', { hasText: first })).toBeVisible();
  if ((await soul.locator('.rule.proposed').count()) > 0) {
    const second = (await soul.locator('.rule.proposed').first().locator('.rule-text').textContent())!.trim();
    await soul.locator('.rule.proposed').first().getByRole('button', { name: 'Not me' }).click();
    await idle(page);
    await expect(soul.locator('.rule.rejected', { hasText: second })).toBeVisible();
  }
  const rules = (await api('/writer')).rules as { text: string; status: string }[];
  expect(rules.find((r) => r.text === first)?.status).toBe('confirmed');
});

test('a rule of your own is confirmed at once', async ({ page }) => {
  await open(page, 'Style');
  const soul = panel(page, 'Is this you?');
  await soul.getByPlaceholder('Never open a chapter with weather').fill('Never use the word suddenly');
  await soul.getByRole('button', { name: 'Add', exact: true }).click();
  await idle(page);
  await expect(soul.locator('.rule.confirmed', { hasText: 'Never use the word suddenly' })).toContainText('yours');
});

test('distil the style sheet', async ({ page }) => {
  await open(page, 'Style');
  await page.getByRole('button', { name: 'Distil style sheet' }).click();
  await idle(page);
  await expect(panel(page, 'Style sheet')).not.toContainText('None yet');
  expect((await api('/writer')).sheet.length).toBeGreaterThan(10);
  if (!run().live) expect((await api('/writer')).sheet).toContain('Fragments');
});

test('the writer soul lives outside the project, under the test writer home only', async () => {
  const w = await api('/writer');
  expect(w.writerId).toBe('default');
  expect(w.eventCount).toBeGreaterThan(3);
});
