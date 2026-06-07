# Org-roam Frontend Implementation Plan

Refs #13.

## Problem

Postep currently has an Org-roam tab, but it is closer to a raw data summary than a useful navigation surface. It shows node/link counts, a selected node, inbound backlinks, and tag counts. It does not yet provide the graph-oriented note discovery workflow expected from an Org-roam experience.

The target is inspired by [`org-roam-ui`](https://github.com/org-roam/org-roam-ui), but this should not be a direct clone. The implementation should be adapted for Postep's Expo/React Native mobile UI, Android constraints, and existing Rust/TypeScript bridge.

## Current State

### Mobile UI

- `apps/mobile/app/roam/index.tsx` loads a `RoamGraph` through `loadRoamGraphAsync(config)`.
- The screen exposes three modes: `graph`, `backlinks`, and `tags`.
- The graph mode displays aggregate counts and density rather than an interactive graph or relationship explorer.
- The backlinks mode only shows inbound links for the selected node.
- The tags mode shows tag counts, but no filtering workflow.
- Selection is local to the screen and starts on the first loaded node.
- The current query short-circuits to an empty graph when `config.roots.length === 0`, which can hide Roam data if only `roamRoots` are configured.

### Data contract

The TypeScript bridge shape is:

```ts
{
  nodes: Array<{ id: string; title: string; path: string; tags: string[] }>;
  links: Array<{ source: string; target: string }>;
}
```

The Rust `org_roam` crate currently builds a minimal graph:

- node IDs are derived from file stems;
- titles are derived from file stems;
- tags are always empty;
- link extraction scans Org text for `[[...]]` and only captures one link per line;
- edges are only added when both source and target nodes exist.

The TypeScript E2E fallback is richer than the Rust backend: it reads `:ID:`, `#+TITLE`, tags, `[[id:...]]`, and description-style links. The implementation should close that mismatch before relying on frontend behavior that only works in web fallback tests.

## Goals

- Give the Roam tab a useful mobile-first breakdown of graph relationships, backlinks, forward links, tags/topics, recent/daily notes, and related notes.
- Preserve context while moving between connected notes.
- Make search and filters first-class controls for navigating larger note graphs.
- Align Rust and TypeScript bridge behavior so Android runtime behavior matches tests.
- Keep the first implementation reliable and testable before adding heavy graph rendering dependencies.

## Non-goals

- Do not clone the full `org-roam-ui` desktop interface.
- Do not require a canvas/force-directed graph dependency in the first useful version.
- Do not block on editing Org-roam notes; this plan focuses on navigation and discovery.
- Do not introduce a new storage model beyond the existing bridge unless profiling proves it is needed.

## Product Approach

Use `org-roam-ui` as inspiration for the information architecture: graph overview, node details, backlinks, forward links, tags, search, and filtering. Adapt those ideas to phone-sized Android screens with stacked cards, sheets, chips, and list-based graph neighborhoods instead of a desktop graph canvas as the primary interaction.

The first shippable version should make the Roam tab useful without Skia or another graph renderer:

1. **Overview cards** for total notes, links, tags, isolated notes, and graph density.
2. **Search and filter bar** for title/path search, tags, and relationship filters.
3. **Selected note card** with title, path, tags, backlink/forward-link counts, and a short excerpt when available.
4. **Relationship panels** for backlinks, forward links, and related notes.
5. **Topic/tag browser** with counts and tap-to-filter behavior.
6. **Daily/recent lane** for daily notes and recently modified notes.
7. **Mobile navigation state** that keeps the selected note and active filter context while switching panels.

A visual graph can be added later once the data contract, view models, and interaction model are stable.

## Phased Implementation

### Phase 1: Fix graph loading and backend parity

- Allow Roam roots to load even when no general Org roots are configured.
- Audit bridge guards for `roots.length === 0` assumptions and treat `roamRoots` as valid Roam inputs.
- Update Rust graph parsing to match the richer TypeScript fallback:
  - read `#+TITLE` as the node title;
  - read `:ID:` as the preferred node ID;
  - support file-stem fallback IDs;
  - parse `#+FILETAGS` and headline tags;
  - extract every link on a line, not just the first;
  - support `[[id:target]]`, `[[id:target][label]]`, and file/path-style links where practical.
- Add Rust tests that cover titles, IDs, tags, multiple links per line, and description-style links.
- Add or update bridge tests so native and web fallback graph behavior stay aligned.

### Phase 2: Add a tested Roam view-model layer

Create pure TypeScript helpers, either in `apps/mobile/lib/mainFeatureWorkflows.ts` or a dedicated `apps/mobile/lib/roamViewModel.ts`, that derive all UI-ready state from `RoamGraph` and local UI state.

The view model should produce:

- graph summary metrics;
- selected note details;
- backlinks and forward links;
- related notes by shared tags and graph neighborhood;
- tag/topic groups;
- daily notes inferred from date-like filenames or metadata;
- recent notes when modified-time metadata becomes available;
- filtered node lists for search/tag/relationship filters;
- empty/loading/error display states.

Unit tests should cover small graphs, isolated notes, missing selected nodes, tag filters, search filters, and graph updates that preserve or reset selection correctly.

### Phase 3: Replace the data-dump UI with mobile-first navigation

Update `apps/mobile/app/roam/index.tsx` around the tested view model.

Recommended layout:

1. **Header and source status**
   - Roam title;
   - current root/source state;
   - refresh/loading affordance.
2. **Overview strip**
   - notes, links, tags, isolated notes, density.
3. **Search/filter controls**
   - text search;
   - tag chips;
   - quick filters such as `linked`, `unlinked`, `daily`, and `recent`.
4. **Selected note card**
   - title, path, tags, counts, excerpt;
   - actions for opening/navigating when document routing is available.
5. **Relationship sections**
   - backlinks;
   - forward links;
   - related notes;
   - tap a related note to update selection without losing active filters.
6. **Topic and daily sections**
   - tag/topic cards;
   - daily/recent horizontal lane.

Keep the existing mode test IDs where possible or provide stable replacements so Playwright screenshots remain useful.

### Phase 4: Navigation and context preservation

- Preserve selected note when switching between graph/backlinks/tags/topic panels.
- When tapping a backlink, forward link, or related note, update selection and keep the current filter context visible.
- Add a small in-memory selection history or breadcrumb so users can return to the previous note.
- Ensure empty graph, missing selected note, no backlinks, no tags, loading, and bridge error states are explicit and helpful.

### Phase 5: Tests, screenshots, and docs

- Add Rust parser tests in `crates/org_roam/src/lib.rs`.
- Add TypeScript view-model tests in `apps/mobile/__tests__/mainFeatureWorkflows.test.ts` or a new test file.
- Extend Playwright coverage in `apps/mobile/e2e/web/full-org-workflow.spec.ts` to:
  - open the Roam tab;
  - apply a tag or search filter;
  - select a related note/backlink;
  - switch panels without losing context;
  - capture updated screenshots.
- Run at minimum:
  - `npm run typecheck` from `apps/mobile`;
  - `npm run test:ux` from `apps/mobile`;
  - relevant Rust tests for `org_roam`;
  - Playwright web E2E when UI behavior changes.
- Update screenshots and user-facing docs after the UI is implemented.

## Acceptance Checklist Mapping

- [ ] Graph/backlinks/tags/related notes are presented as useful mobile sections, not only raw counts.
- [ ] Backlinks and forward links are both available for the selected note.
- [ ] Related notes are derived from graph neighborhood and/or shared tags.
- [ ] Tags/topics can filter the visible graph/node list.
- [ ] Daily/recent notes are surfaced when metadata or naming patterns support them.
- [ ] Users can navigate related notes without losing current context.
- [ ] Android phone-sized layout is covered by screenshots or E2E flows.
- [ ] Rust and TypeScript graph extraction behavior is aligned.
- [ ] Empty, loading, and error states are covered.
- [ ] Regression tests cover the view model and major UI flows.

## Risks and Open Questions

- **Graph rendering dependency:** React Native Skia may be useful later, but a list/card-based graph neighborhood should ship first to avoid adding a heavy dependency before the data model is stable.
- **Large graphs:** Search/filter derivation should stay memoized and should be profiled against larger note sets before adding visual graph layout.
- **SAF performance:** Loading excerpts or modified times may require extra file reads over Android SAF; add this incrementally and cache where possible.
- **Bridge parity:** Tests can pass against the TypeScript fallback while Android native behavior remains incomplete unless Rust parser parity is handled early.
- **Navigation destination:** Opening a selected Roam note in the Library reader/editor may need a route contract if one does not already exist.

## Suggested PR Breakdown

1. Backend/data parity PR: Roam roots loading, Rust parser parity, graph tests.
2. View-model PR: pure derived Roam model and UX tests.
3. Mobile UI PR: card/list-based Roam frontend, E2E updates, screenshots.
4. Optional visual graph PR: Skia/canvas graph exploration after the useful mobile baseline lands.
