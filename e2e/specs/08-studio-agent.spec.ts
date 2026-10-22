import { expect, test } from '@playwright/test';
import { idle, open, panel, run } from './helpers';

test('suggestion chips fill the composer', async ({ page }) => {
  await open(page, 'Studio');
  await page.locator('.chips button', { hasText: 'Outline three chapters' }).click();
  await expect(page.getByPlaceholder('What do you want done?')).toHaveValue('Outline three chapters');
});

test('the studio agent runs tools over the book and replies', async ({ page }) => {
  await open(page, 'Studio');
  const chat = panel(page, 'The studio agent');
  await chat.getByPlaceholder('What do you want done?').fill('Who is in the cast?');
  await chat.getByRole('button', { name: 'Send' }).click();
  await idle(page);
  await expect(chat.locator('.bubble.me')).toHaveText('Who is in the cast?');
  await expect(chat.locator('.bubble.them')).toHaveCount(1);
  if (!run().live) await expect(chat.locator('.trace', { hasText: 'bible' })).toBeVisible();
});

test('the book at a glance reflects the work done in the other rooms', async ({ page }) => {
  await open(page, 'Studio');
  const glance = page.locator('.bezel', { hasText: 'The book at a glance' });
  await expect(glance.locator('.stat', { hasText: 'scenes accepted' }).locator('b')).toHaveText(/^[1-9]\d*\/\d+$/);
});
