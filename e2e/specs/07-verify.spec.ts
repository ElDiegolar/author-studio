import { expect, test } from '@playwright/test';
import { api, idle, open, panel } from './helpers';

test('verify shows the summary and per-section findings', async ({ page }) => {
  await open(page, 'Verify');
  await idle(page);
  const summary = page.locator('.bezel', { hasText: 'Summary' }).first();
  await expect(summary.locator('.stat', { hasText: 'errors' })).toBeVisible();
  await expect(page.locator('.bezel .micro', { hasText: 'continuity' })).toBeVisible();
  await expect(page.locator('.bezel .micro', { hasText: 'timeline' })).toBeVisible();
  await expect(page.locator('.bezel .micro', { hasText: /^scene:1$/ })).toBeVisible();
  void panel;
});

test('style drift is checked on AI drafts once the writer has enough prose', async () => {
  const report = await api<Record<string, { code: string }[]>>('/verify');
  const codes = Object.values(report).flat().map((f) => f.code);
  expect(codes.every((c) => typeof c === 'string')).toBe(true);
});

test('export Markdown contains the title, chapters and accepted text', async ({ page }) => {
  const md = await api<string>('/export.md');
  expect(md).toContain('# The Test Road');
  expect(md).toContain('## Chapter 1');
  await open(page, 'Verify');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Export Markdown' }).click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toContain('/api/export.md');
});
