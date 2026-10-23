import { expect, test } from '@playwright/test';
import { api, idle, open, panel, run } from './helpers';

test('muse with agency: characters decide (scratch), ideas grow from the souls', async ({ page }) => {
  await open(page, 'Ideas');
  const before = (await api(`/characters/${run().ids.jonah}/state`)).decisions.length;
  await page.getByPlaceholder(/Optional/).fill('Mara and Jonah meet at the quay the night the Albatross leaves.');
  await page.locator('label.check', { hasText: 'Jonah Voss' }).locator('input').check();
  await page.getByRole('button', { name: 'Throw me ideas' }).click();
  await idle(page);
  await expect(panel(page, 'What they would do')).toContainText('Jonah Voss');
  const ideas = panel(page, /ways in/);
  await expect(ideas.locator('.idea').first()).toBeVisible();
  await expect(ideas.locator('.idea').first()).toContainText('Grows from');
  expect((await api(`/characters/${run().ids.jonah}/state`)).decisions.length).toBe(before);
});

test('muse without a scenario still finds pressure points', async ({ page }) => {
  await open(page, 'Ideas');
  await page.getByRole('button', { name: 'Throw me ideas' }).click();
  await idle(page);
  await expect(panel(page, /ways in/).locator('.idea').first()).toBeVisible();
});
