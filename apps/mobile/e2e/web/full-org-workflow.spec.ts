import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const screenshotDir = 'e2e-artifacts/screenshots';

const responsivenessBudgetsMs = {
  libraryLoad: 10_000,
  documentOpen: 8_000,
  foldToggle: 1_500,
  scroll: 1_500,
  actionTap: 750,
  routeSwitch: 8_000,
};

async function measureResponsive<T>(label: string, budgetMs: number, action: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  const result = await action();
  const elapsedMs = performance.now() - startedAt;
  expect(elapsedMs, `${label} took ${elapsedMs.toFixed(1)}ms`).toBeLessThanOrEqual(budgetMs);
  return result;
}

async function measureWidget<T>(label: string, action: () => Promise<T>): Promise<T> {
  return measureResponsive(label, responsivenessBudgetsMs.actionTap, action);
}

async function screenshot(page: Page, name: string) {
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}/${name}.png`, fullPage: true });
}

test('full launched org UI workflow against 10 E2E org files', async ({ page }) => {
  await measureResponsive('library route load', responsivenessBudgetsMs.libraryLoad, async () => {
    await page.goto('/library');
    await expect(page.getByTestId('library-search-input')).toBeVisible();
  });
  await expect(page.getByTestId('org-library-title')).toHaveText('Local Org');
  await expect(page.getByText('10 notes')).toBeVisible();
  await expect(page.getByTestId('document-card-sample-01.org')).toBeVisible();
  await expect(page.getByTestId('note-rendered-preview-sample-01.org-0')).toBeVisible();
  await expect(page.getByText('* TODO [#A] Morning habit 1 :habit:mobile:')).toHaveCount(0);
  await screenshot(page, '01-library-loaded');

  await measureResponsive('document open', responsivenessBudgetsMs.documentOpen, async () => {
    await page.getByText('E2E Org Sample 1', { exact: true }).click();
    await expect(page.getByTestId('back-to-notes')).toBeVisible();
    await expect(page.getByTestId('lexical-org-document')).toBeVisible();
  });
  await expect(page.getByText('Morning habit 1', { exact: true })).toBeVisible();
  await expect(page.getByText('open app workflow 1')).toBeVisible();
  await expect(page.getByText('render org blocks 1')).toBeVisible();

  for (const actionId of [
    'document-action-cut',
    'document-action-copy',
    'document-action-paste',
    'document-action-move',
    'document-action-overflow',
    'document-bottom-archive',
    'document-bottom-schedule',
    'document-bottom-deadline',
    'document-bottom-priority',
    'document-bottom-state',
    'document-bottom-add',
  ]) {
    await expect(page.getByTestId(actionId)).toBeVisible();
  }

  for (const label of [
    'Cut selected item',
    'Copy selected item',
    'Paste item',
    'Move selected item',
    'More document actions',
    'Archive or refile item',
    'Schedule item',
    'Set item deadline',
    'Set item priority',
    'Change item state',
    'Create new item',
  ]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }

  await expect(page.getByText('* TODO [#A] Morning habit 1 :habit:mobile:')).toHaveCount(0);
  await expect(page.getByText('[[id:sample-10][Related sample 10]]')).toHaveCount(0);

  await measureWidget('select document node', async () => {
    await page.getByTestId('document-node-1').click();
  });
  await screenshot(page, '02a-document-node-selected');

  await measureWidget('copy selected document node', async () => {
    await page.getByTestId('document-action-copy').click();
  });

  await measureWidget('overflow action menu', async () => {
    await page.getByTestId('document-action-overflow').click();
    await expect(page.getByTestId('document-action-menu')).toBeVisible();
  });
  await expect(page.getByTestId('document-action-edit-source')).toBeVisible();
  await screenshot(page, '02b-document-overflow-menu');

  await page.emulateMedia({ colorScheme: 'dark' });
  await measureWidget('open dark source edit lane', async () => {
    await page.getByTestId('document-action-edit-source').click();
    await expect(page.getByTestId('document-edit-lane')).toBeVisible();
    await expect(page.getByTestId('document-edit-source-highlight')).toBeVisible();
    await expect(page.locator('[data-testid^="source-token-keyword-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="source-token-todo-"]').first()).toBeVisible();
  });
  await screenshot(page, '02c-document-dark-edit-lane');
  const editBackground = await page.getByTestId('document-edit-source').evaluate((node) =>
    window.getComputedStyle(node).backgroundColor
  );
  expect(editBackground).not.toBe('rgb(255, 255, 255)');
  for (const chromeTestId of ['document-top-bar', 'document-mode-bar', 'document-bottom-toolbar']) {
    const chromeBackground = await page.getByTestId(chromeTestId).evaluate((node) =>
      window.getComputedStyle(node).backgroundColor
    );
    expect(chromeBackground, `${chromeTestId} should follow dark document chrome`).not.toBe('rgb(250, 249, 253)');
    expect(chromeBackground, `${chromeTestId} should not use the light toolbar background`).not.toBe('rgb(236, 236, 246)');
  }
  const sourceInput = page.getByTestId('document-edit-source');
  await measureWidget('cancel source edit lane', async () => {
    await sourceInput.fill(`${await sourceInput.inputValue()}
* Added from edit lane`);
    await page.getByTestId('document-edit-cancel').click();
    await expect(page.getByText('Added from edit lane')).toHaveCount(0);
  });

  await measureWidget('reopen source edit lane', async () => {
    await page.getByTestId('document-action-overflow').click();
    await page.getByTestId('document-action-edit-source').click();
    await expect(page.getByTestId('document-edit-lane')).toBeVisible();
  });
  await measureWidget('save source edit lane', async () => {
    await sourceInput.fill(`${await sourceInput.inputValue()}
* Added from edit lane`);
    await page.getByTestId('document-edit-save').click();
    await expect(page.getByText('Added from edit lane')).toBeVisible();
  });
  await screenshot(page, '02d-document-edit-saved');

  await measureWidget('paste placement menu', async () => {
    await page.getByTestId('document-action-paste').click();
    await expect(page.getByTestId('document-paste-menu')).toBeVisible();
  });
  await screenshot(page, '02e-document-paste-menu');
  await measureWidget('paste copied item below', async () => {
    await page.getByTestId('document-paste-below').click();
    await expect(page.getByText('Morning habit 1', { exact: true })).toHaveCount(2);
  });

  await measureWidget('move item menu', async () => {
    await page.getByTestId('document-action-move').click();
    await expect(page.getByTestId('document-move-menu')).toBeVisible();
  });
  await screenshot(page, '02f-document-move-menu');
  await measureWidget('demote selected item', async () => {
    await page.getByTestId('document-move-demote').click();
    await expect(page.getByTestId('document-move-menu')).toHaveCount(0);
  });

  await measureWidget('schedule item menu', async () => {
    await page.getByTestId('document-bottom-schedule').click();
    await expect(page.getByTestId('document-schedule-menu')).toBeVisible();
  });
  await screenshot(page, '02g-document-schedule-menu');
  await measureWidget('schedule item today', async () => {
    await page.getByTestId('document-schedule-today').click();
    await expect(page.getByText(/Scheduled \d{4}-|\d{4}-/).first()).toBeVisible();
  });

  await measureWidget('deadline item menu', async () => {
    await page.getByTestId('document-bottom-deadline').click();
    await expect(page.getByTestId('document-deadline-menu')).toBeVisible();
  });
  await screenshot(page, '02h-document-deadline-menu');
  await measureWidget('deadline item tomorrow', async () => {
    await page.getByTestId('document-deadline-tomorrow').click();
    await expect(page.getByText(/Deadline|Due|\d{4}-/).first()).toBeVisible();
  });

  await measureWidget('priority item menu', async () => {
    await page.getByTestId('document-bottom-priority').click();
    await expect(page.getByTestId('document-priority-menu')).toBeVisible();
  });
  await screenshot(page, '02i-document-priority-menu');
  await measureWidget('set item priority', async () => {
    await page.getByTestId('document-priority-b').click();
    await expect(page.getByText('#B').first()).toBeVisible();
  });

  await measureWidget('state item menu', async () => {
    await page.getByTestId('document-bottom-state').click();
    await expect(page.getByTestId('document-state-menu')).toBeVisible();
  });
  await screenshot(page, '02j-document-state-menu');
  await measureWidget('set item state', async () => {
    await page.getByTestId('document-state-next').click();
    await expect(page.getByText('NEXT').first()).toBeVisible();
  });

  await measureWidget('add heading menu', async () => {
    await page.getByTestId('document-bottom-add').click();
    await expect(page.getByTestId('document-add-menu')).toBeVisible();
  });
  await screenshot(page, '02k-document-add-menu');
  await measureWidget('add heading below', async () => {
    await page.getByTestId('document-add-title').fill('Action added heading');
    await page.getByTestId('document-add-below').click();
    await expect(page.getByText('Action added heading')).toBeVisible();
  });

  await measureWidget('archive/refile menu', async () => {
    await page.getByTestId('document-bottom-archive').click();
    await expect(page.getByTestId('document-refile-menu')).toBeVisible();
  });
  await screenshot(page, '02l-document-refile-menu');
  await measureWidget('archive selected item', async () => {
    await page.getByTestId('document-refile-archive').click();
    await expect(page.getByText('#ARCHIVE').first()).toBeVisible();
  });

  await measureWidget('cut selected item', async () => {
    await page.getByTestId('document-action-cut').click();
    await expect(page.getByText('Morning habit 1', { exact: true }).first()).toBeVisible();
  });
  await screenshot(page, '02m-document-actions-result');

  const firstFold = page.getByLabel('Collapse item').first();
  await expect(firstFold).toBeVisible();
  await expect(firstFold).toContainText('−');
  await measureResponsive('fold collapse', responsivenessBudgetsMs.foldToggle, async () => {
    await firstFold.click();
    await expect(page.getByLabel('Expand item').first()).toContainText('+');
    await expect(page.getByText('open app workflow 1')).toBeHidden();
  });
  await measureResponsive('fold expand', responsivenessBudgetsMs.foldToggle, async () => {
    await page.getByLabel('Expand item').first().click();
    await expect(page.getByLabel('Collapse item').first()).toContainText('−');
    await expect(page.getByText('open app workflow 1')).toBeVisible();
  });

  await screenshot(page, '02-document-org-rendered');

  await measureResponsive('document scroll', responsivenessBudgetsMs.scroll, async () => {
    await page.getByTestId('document-scroll').evaluate((node) => {
      node.scrollTo({ top: 360 });
    });
    await expect(page.getByText('Agenda item 1', { exact: true })).toBeVisible();
  });
  await screenshot(page, '03-document-org-scrolled');

  await measureResponsive('agenda route load', responsivenessBudgetsMs.routeSwitch, async () => {
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-screen')).toBeVisible();
  });
  await expect(page.getByText('Agenda item 1', { exact: true })).toBeVisible();
  await screenshot(page, '04-agenda-loaded');

  await measureResponsive('habits route load', responsivenessBudgetsMs.routeSwitch, async () => {
    await page.goto('/habits');
    await expect(page.getByTestId('habits-list')).toBeVisible();
  });
  await expect(page.getByText('TODO Morning habit 1', { exact: true })).toBeVisible();
  await page.getByTestId('habit-title-input').fill('Hydrate');
  await page.getByTestId('habit-add-button').click();
  await expect(page.getByText('TODO Hydrate')).toBeVisible();
  await screenshot(page, '05-habit-added');

  await measureResponsive('roam route load', responsivenessBudgetsMs.routeSwitch, async () => {
    await page.goto('/roam');
    await expect(page.getByTestId('roam-screen')).toBeVisible();
  });
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
  await expect(page.getByTestId('lexical-org-document')).toBeVisible();
  await expect(page.getByText('open app workflow 10')).toBeVisible();
  await screenshot(page, '09-note-opened-from-roam');

  await page.getByTestId('back-to-notes').click();
  await expect(page.getByTestId('document-chip-list')).toBeVisible();
  await expect(
    page.getByTestId('documents-screen').getByText('10 notes')
  ).toBeVisible();
  await screenshot(page, '10-back-to-grid-after-roam');
});
