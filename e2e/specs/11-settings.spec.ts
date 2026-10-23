import { expect, test } from '@playwright/test';
import { api, run } from './helpers';

const openSettings = async (page: import('@playwright/test').Page) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.hero h1')).toHaveText(/Your studio/);
};

test('the well-known AIs are offered in plain words, each with steps to a key', async ({ page }) => {
  await openSettings(page);
  for (const name of ['Claude', 'ChatGPT', 'Gemini']) await expect(page.locator('.choice', { hasText: name }).first()).toBeVisible();
  await page.getByText('More choices').click();
  for (const name of ['Grok', 'DeepSeek', 'Le Chat', 'OpenRouter', 'A model on this computer']) await expect(page.locator('.choice', { hasText: name }).first()).toBeVisible();
  await page.locator('.choice', { hasText: 'Gemini' }).first().click();
  await expect(page.locator('.steps li')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /aistudio\.google\.com/ })).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  await expect(page.getByLabel('Key')).toHaveAttribute('type', 'password');
});

test('a model on this computer: a wrong address is explained, the right one connects and is kept', async ({ page }) => {
  test.skip(run().live, 'uses the fake model');
  await openSettings(page);
  await page.getByText('More choices').click();
  await page.locator('.choice', { hasText: 'A model on this computer' }).click();
  const setup = page.locator('.setup');
  await setup.getByPlaceholder('http://127.0.0.1:11434/v1').fill('http://127.0.0.1:9/v1');
  await setup.getByPlaceholder('as the app names it').fill('fake');
  await page.getByRole('button', { name: 'Use this model' }).click();
  await expect(page.locator('.result.failed')).toContainText('Nothing is answering');
  await setup.getByPlaceholder('http://127.0.0.1:11434/v1').fill(run().fakeUrl!);
  await page.getByRole('button', { name: 'Use this model' }).click();
  await expect(page.locator('.result.ok')).toContainText('Connected. AI is on.');
  const s = await api('/settings');
  expect(s.ai).toMatchObject({ mode: 'local', localUrl: run().fakeUrl, localModel: 'fake' });
});

test('every place on disk is one click from the file manager, and only the studio\'s own places', async ({ page }) => {
  await openSettings(page);
  await expect(page.locator('button.path')).toHaveCount(3);
  await expect(page.locator('button.path').first()).toHaveAttribute('title', /^Show in /);
  const r = await fetch(`${run().base}/api/reveal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/etc' }) });
  expect(r.status).toBe(403);
});
