import { expect, test, type Page } from '@playwright/test';
import { api, idle, open, panel, run } from './helpers';

const editor = (page: Page) => page.locator('textarea.prose');
async function openScene(page: Page, title: string) {
  await open(page, 'Write');
  await panel(page, 'Scenes').locator('li', { hasText: title }).click();
  await expect(page.locator('.ph h2', { hasText: title })).toBeVisible();
}
const sceneId = async (title: string) => (await api('/bible')).scenes.find((s: { title: string }) => s.title === title).id as string;

test('add a scene card', async ({ page }) => {
  await open(page, 'Write');
  const f = panel(page, 'Add a scene');
  await f.getByPlaceholder('What happens?').fill('The Customs Desk');
  await f.getByLabel('Chapter').fill('2');
  await f.getByText('More details').click();
  await f.locator('select').first().selectOption({ label: 'Mara Voss' });
  await f.getByPlaceholder('Goal').fill('file the report');
  await f.getByPlaceholder('Conflict').fill('the form has no box for the truth');
  await f.getByPlaceholder('Outcome').fill('she writes in the margin');
  await f.getByRole('button', { name: 'Add scene' }).click();
  await expect(panel(page, 'Scenes')).toContainText('The Customs Desk');
  // the new scene opens straight away, ready to write
  await expect(page.locator('.ph h2', { hasText: 'The Customs Desk' })).toBeVisible();
});

test('a scene needs only a title; typing saves itself into one version', async ({ page }) => {
  await open(page, 'Write');
  await page.getByPlaceholder('What happens?').fill('Quick Note');
  await page.getByPlaceholder('What happens?').press('Enter');
  await expect(page.locator('.ph h2', { hasText: 'Quick Note' })).toBeVisible();
  await editor(page).pressSequentially('First line. ', { delay: 5 });
  await expect(page.locator('.save')).toContainText('Saved');
  await editor(page).pressSequentially('Second line.', { delay: 5 });
  await expect(page.locator('.save')).toContainText('Saved');
  await expect.poll(async () => (await api(`/scenes/${await sceneId('Quick Note')}/versions`)).map((v: { text: string }) => v.text)).toEqual(['First line. Second line.']);
  const s = (await api('/bible')).scenes.find((x: { title: string }) => x.title === 'Quick Note');
  expect(s.status).toBe('drafted');
  // no POV yet is not an error
  expect(Object.values(await api('/verify') as Record<string, { code: string }[]>).flat().filter((f) => f.code === 'scene.pov')).toEqual([]);
});

test('draft with AI, then the deterministic findings show', async ({ page }) => {
  await openScene(page, 'The Manifest');
  await page.getByRole('button', { name: 'Draft with AI' }).click();
  await idle(page);
  await expect(editor(page)).not.toHaveValue('');
  await expect(page.locator('.ph .micro', { hasText: '1 version(s)' })).toBeVisible();
  expect((await api('/bible')).scenes.find((s: { title: string }) => s.title === 'The Manifest').status).toBe('drafted');
});

test('rewrite the AI draft: diff shows, saving records the edit on the writer soul', async ({ page }) => {
  await openScene(page, 'The Manifest');
  await page.getByRole('button', { name: 'Draft with AI' }).click();
  await idle(page);
  const draft = await editor(page).inputValue();
  const mine = draft.replace(/ said (quietly|softly)[^.]*\./g, '."').replace(/slowly and carefully /g, '').replace(/\bThe four-way stop sat[^.]*\./, 'Four-way stop. Wet tarmac. One amber light.');
  await editor(page).fill(mine.length > 420 ? mine : mine + '\n\n' + mine);
  await expect(panel(page, 'Your edits vs the AI draft')).toBeVisible();
  const editsBefore = (await api('/writer')).edits.length;
  await expect(page.locator('.save')).toContainText('Saved');
  // autosave alone never teaches the writer soul; leaving the scene settles the rewrite
  expect((await api('/writer')).edits.length).toBe(editsBefore);
  await page.locator('.links button', { hasText: 'Read' }).click();
  await expect.poll(async () => (await api('/writer')).edits.length).toBe(editsBefore + 1);
  const versions = await api(`/scenes/${await sceneId('The Manifest')}/versions`);
  expect(versions.at(-1).source).toBe('author');
});

test('proofread finds the repeated word and Apply fixes it in the editor', async ({ page }) => {
  await openScene(page, 'Night at the Quay');
  await page.getByRole('button', { name: 'Draft with AI' }).click();
  await idle(page);
  await page.getByRole('button', { name: 'Proofread' }).click();
  await idle(page);
  const proof = page.locator('.bezel', { hasText: 'Proofreading' });
  if (!run().live) {
    await expect(proof).toContainText('repeated word');
    expect(await editor(page).inputValue()).toContain('the the');
    await proof.getByRole('button', { name: 'Apply' }).first().click();
    expect(await editor(page).inputValue()).not.toContain('the the');
  }
});

test('line-edit a selection with a note', async ({ page }) => {
  await openScene(page, 'Night at the Quay');
  const ta = editor(page);
  await expect(ta).not.toHaveValue('');
  const text = await ta.inputValue();
  const target = text.split('\n\n')[0]!;
  await ta.evaluate((el: HTMLTextAreaElement, len: number) => { el.focus(); el.setSelectionRange(0, len); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }, target.length);
  await expect(page.getByPlaceholder('Note for the line editor')).toBeVisible();
  await page.getByPlaceholder('Note for the line editor').fill('cut the adverbs');
  await page.getByRole('button', { name: 'Edit selection' }).click();
  await idle(page);
  if (!run().live) expect(await ta.inputValue()).not.toContain('slowly and carefully');
});

test('accept: facts go to the ledger and present characters witness the scene', async ({ page }) => {
  await openScene(page, 'The Manifest');
  await page.getByRole('button', { name: 'Mark done' }).click();
  await idle(page);
  await expect(page.locator('.finding', { hasText: 'facts, witnessed by' })).toBeVisible();
  const b = await api('/bible');
  expect(b.scenes.find((s: { title: string }) => s.title === 'The Manifest').status).toBe('accepted');
  expect(b.facts.length).toBeGreaterThan(0);
  const mara = await api(`/characters/${run().ids.mara}/state`);
  expect(mara.witnessed.map((w: { sceneId: string }) => w.sceneId)).toContain(await sceneId('The Manifest'));
});

test('draft with agency: the ticked character decides first, nothing is saved to their soul', async ({ page }) => {
  await openScene(page, 'Greyhaven');
  const decisionsBefore = (await api(`/characters/${run().ids.mara}/state`)).decisions.length;
  await page.locator('.toolbar label.check', { hasText: 'Mara Voss' }).locator('input').check();
  await page.getByRole('button', { name: 'Draft with agency' }).click();
  await idle(page);
  await expect(page.locator('.finding', { hasText: 'Mara Voss:' })).toBeVisible();
  expect((await api(`/characters/${run().ids.mara}/state`)).decisions.length).toBe(decisionsBefore);
});

test('AI outline proposes and adds scene cards', async ({ page }) => {
  await open(page, 'Write');
  const before = (await api('/bible')).scenes.length;
  page.once('dialog', (d) => d.accept('1'));
  await page.getByRole('button', { name: 'AI outline…' }).click();
  await idle(page);
  await expect.poll(async () => (await api('/bible')).scenes.length).toBeGreaterThan(before);
});
