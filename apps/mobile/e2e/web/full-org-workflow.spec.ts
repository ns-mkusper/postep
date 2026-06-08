import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const screenshotDir = 'e2e-artifacts/screenshots';

async function screenshot(page: Page, name: string) {
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage: true });
}

test('full launched org UI workflow against 10 E2E org files', async ({ page }) => {
  await page.goto('/library');

  await expect(page.getByTestId('library-search-input')).toBeVisible();
  await expect(page.getByTestId('org-library-title')).toHaveText('Local Org');
  await expect(page.getByText('10 notes')).toBeVisible();
  await expect(page.getByTestId('document-card-sample-01.org')).toBeVisible();
  await screenshot(page, '01-library-loaded');

  await page.getByText('E2E Org Sample 1', { exact: true }).click();
  await expect(page.getByTestId('new-list-item-input')).toBeVisible();
  await expect(page.getByText('open app workflow 1')).toBeVisible();
  await expect(page.getByText('render org blocks 1')).toBeVisible();
  await screenshot(page, '02-document-opened');

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
    await screenshot(page, '03-document-edited');
  }

  await page.goto('/agenda');
  await expect(page.getByTestId('agenda-screen')).toBeVisible();
  await expect(page.getByText('Agenda item 1', { exact: true })).toBeVisible();
  await screenshot(page, '04-agenda-loaded');

  await page.goto('/habits');
  await expect(page.getByTestId('habits-list')).toBeVisible();
  await expect(page.getByText('TODO Morning habit 1', { exact: true })).toBeVisible();
  await page.getByTestId('habit-title-input').fill('Hydrate');
  await page.getByTestId('habit-add-button').click();
  await expect(page.getByText('TODO Hydrate')).toBeVisible();
  await screenshot(page, '05-habit-added');

  await page.goto('/roam');
  await expect(page.getByTestId('roam-screen')).toBeVisible();
  await expect(page.getByTestId('roam-graph-mode')).toBeVisible();
  await expect(page.getByTestId('roam-selected-note')).toBeVisible();
  await page.getByTestId('roam-filter-linked').click();
  await expect(page.getByText('10 notes')).toBeVisible();
  await page.getByTestId('roam-clear-filters').click();
  await page.getByTestId('roam-search-input').fill('Sample 2');
  await expect(
    page.getByTestId('roam-node-list').getByText('E2E Org Sample 2', { exact: true })
  ).toBeVisible();
  await screenshot(page, '06-roam-graph');

  await page.getByTestId('roam-mode-tags').click();
  await expect(page.getByTestId('roam-tags-mode')).toBeVisible();
  await page.getByTestId('roam-clear-filters').click();
  await page.getByTestId('roam-tag-habit').click();
  await expect(
    page.getByTestId('roam-node-list').getByText('E2E Org Sample 1', { exact: true })
  ).toBeVisible();
  await screenshot(page, '07-roam-tags');

  await page.getByTestId('roam-mode-backlinks').click();
  await expect(page.getByTestId('roam-backlinks-mode')).toBeVisible();
  await page.getByTestId('roam-node-list').getByText('E2E Org Sample 1', { exact: true }).click();
  await expect(page.getByTestId('roam-selected-note')).toContainText('E2E Org Sample 1');
  await expect(page.getByTestId('roam-backlink-list')).toContainText('E2E Org Sample 10');
  await page.getByTestId('roam-backlink-list').getByText(/E2E Org Sample 10/).click();
  await expect(page.getByTestId('roam-selected-note')).toContainText('E2E Org Sample 10');
  await screenshot(page, '08-roam-backlinks');

  await page.getByTestId('roam-open-selected-note').click();
  await expect(page.getByTestId('back-to-notes')).toBeVisible();
  await expect(page.getByText('open app workflow 10')).toBeVisible();
});
