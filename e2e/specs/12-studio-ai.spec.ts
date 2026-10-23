import { expect, test } from '@playwright/test';
import { api, open, run } from './helpers';

test('Author Studio AI: sign in in the browser, come back connected, write with it, sign out', async ({ page, context }) => {
  test.skip(run().live, 'uses the fake cloud');
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const card = page.locator('.choice', { hasText: 'Author Studio AI' });
  await expect(card).toContainText('Easiest');
  await card.click();
  const popup = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await popup).url()).toContain('/link.html?code=TEST-');
  await expect(page.locator('.bigcode')).toHaveText(/^TEST-\d{4}$/);
  await expect(page.locator('.result')).toContainText('Waiting for you');
  // the writer signs in and pays in the browser
  await fetch(`${run().cloudUrl}/approve-and-pay`, { method: 'POST' });
  await expect(page.locator('.result.ok')).toContainText('Connected. AI is on.');
  await expect(page.locator('.using')).toContainText('Author Studio AI (ana@example.com)');
  await expect(page.locator('.meter')).toContainText('25% of this month');
  await expect(page.getByRole('link', { name: /Manage subscription/ })).toHaveAttribute('href', 'https://billing.example/portal');
  const s = await api('/settings');
  expect(s.ai.mode).toBe('studio');
  expect(JSON.stringify(s)).not.toContain('sk-or-test-key');

  // AI actions now go through the subscription
  await open(page, 'Write');
  await page.getByRole('button', { name: 'Draft with AI' }).click();
  await expect(page.locator('textarea.prose')).not.toHaveValue('', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('.choice', { hasText: 'Author Studio AI' }).click();
  await page.getByRole('button', { name: 'Sign out on this computer' }).click();
  await expect(page.locator('.result.ok')).toContainText('Signed out');
  expect((await api('/settings')).ai.mode).toBe('none');
  await api('/settings', 'PUT', { ai: { mode: 'local', localUrl: run().fakeUrl, localModel: 'fake' } });
});
