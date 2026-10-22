import { expect, test } from '@playwright/test';
import { open } from './helpers';

const ROOMS: [string, RegExp][] = [['Studio', /The Test Road/], ['Bible', /bible/i], ['Scenes', /Scene by scene/], ['Characters', /Talk to them/], ['Muse', /Throw me ideas/], ['Style', /Your voice/], ['Verify', /Who is right/]];

test('every room opens from the island nav with its own heading', async ({ page }) => {
  await open(page, 'Studio');
  for (const [room, heading] of ROOMS) {
    await page.locator('.links button', { hasText: room }).click();
    await expect(page.locator('.hero h1')).toHaveText(heading);
    await expect(page.locator('.toast')).toHaveCount(0);
  }
});

test('theme toggle switches light/dark and is remembered after reload', async ({ page }) => {
  await open(page, 'Studio');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Light mode' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('phone: hamburger opens the sheet, navigates, and the layout is one column', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.links')).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('.island')).toHaveClass(/open/);
  await page.locator('.sheet button', { hasText: 'Scenes' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.locator('.hero h1')).toHaveText(/Scene by scene/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
