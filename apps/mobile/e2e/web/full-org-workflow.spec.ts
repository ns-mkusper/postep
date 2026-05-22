import { expect, test } from '@playwright/test';

test('full launched org UI workflow against 10 E2E org files', async ({ page }) => {
  await page.goto('/library');

  await expect(page.getByText('E2E Documents')).toBeVisible();
  await expect(page.getByText('Org Library')).toBeVisible();
  await expect(page.getByText('Local Org · 10 files')).toBeVisible();
  await expect(page.getByText('sample-01.org')).toBeVisible();

  await page.getByText('sample-01.org').click();
  await expect(page.getByText(/Morning habit 1/).first()).toBeVisible();
  await expect(page.getByText('SCHEDULED: <2026-05-01 Thu 06:30 +1d>')).toBeVisible();

  const moveButton = page.getByTestId('block-move-down-2').first();
  if (await moveButton.isVisible()) {
    await moveButton.click();
  }

  const editButton = page.getByTestId('block-edit-2').first();
  if (await editButton.isVisible()) {
    await editButton.click();
    const editor = page.getByTestId('block-editor');
    await expect(editor).toBeVisible();
    await editor.fill('* TODO [#A] Morning habit 1 edited :habit:daily:');
    await page.getByTestId('block-save').click();
    await expect(page.getByText('Morning habit 1 edited')).toBeVisible();
  }

  await page.goto('/agenda');
  await expect(page.getByTestId('agenda-screen')).toBeVisible();
  await expect(page.getByText('Agenda item 1')).toBeVisible();

  await page.goto('/habits');
  await expect(page.getByTestId('habits-list')).toBeVisible();
  await expect(page.getByText('TODO Morning habit 1', { exact: true })).toBeVisible();
});
