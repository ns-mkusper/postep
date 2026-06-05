import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { performance } from 'node:perf_hooks';

export interface ConversionOptions {
  outlineOnly: boolean;
  readerMode: boolean;
}

export interface EditorFrontendAdapter<TNode, TProjection, TBlockViewModel> {
  name: string;
  budgets: {
    projectionMs: number;
    blockMoveMs: number;
    blockEditMs: number;
  };
  syntheticNodes(raw: string): TNode[];
  createBlockViewModels(raw: string, nodes: TNode[], options: ConversionOptions): TBlockViewModel[];
  nodesToProjection(raw: string, nodes: TNode[], options: ConversionOptions): TProjection[];
  moveRawBlock(raw: string, node: TNode, direction: -1 | 1): string;
  updateRawBlock(raw: string, node: TNode, nextRawText: string): string;
  isHeading(node: TNode, textIncludes: string): boolean;
  isListItem(node: TNode, textIncludes: string): boolean;
}

export interface BenchmarkStats {
  name: string;
  iterations: number;
  warmupIterations: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

function parseBenchmarkInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const UX_BENCHMARK_ITERATIONS = parseBenchmarkInteger(process.env.UX_BENCH_RUNS, 50);
export const UX_BENCHMARK_WARMUPS = parseBenchmarkInteger(process.env.UX_BENCH_WARMUPS, 5);

export type SyntheticOrgNode =
  | {
      type: 'heading';
      depth: number;
      text: string;
      raw: string;
      line_start: number;
      line_end: number;
      todo_keyword?: string | null;
      priority?: string | null;
      tags: string[];
    }
  | { type: 'planning'; keyword: string; text: string; raw: string; line_start: number; line_end: number }
  | {
      type: 'list_item';
      depth: number;
      ordered: boolean;
      checked?: boolean | null;
      text: string;
      raw: string;
      line_start: number;
      line_end: number;
    };

export const orgSamples = Array.from({ length: 10 }, (_, idx) => {
  const day = String(idx + 1).padStart(2, '0');
  return `#+TITLE: UX Sample ${idx + 1}
* TODO [#A] Habit ${idx + 1} :habit:mobile:
SCHEDULED: <2026-05-${day} Thu +1d>
:PROPERTIES:
:STYLE: habit
:END:
:LOGBOOK:
- State "DONE" from "TODO" [2026-05-${day} Thu]
:END:
- [ ] complete app render pass
- [X] keep block edits instant

* WAITING Agenda item ${idx + 1} :agenda:
DEADLINE: <2026-06-${day} Mon 09:00>
Common agenda text with [[id:sample-${idx}]][sample link]].

* Notes ${idx + 1}
| Metric | Budget |
| Move | 8ms |
#+BEGIN_SRC shell
echo sample-${idx}
#+END_SRC
`;
});

export function syntheticOrgNodes(raw: string): SyntheticOrgNode[] {
  return raw.split('\n').flatMap((line, idx): SyntheticOrgNode[] => {
    const heading = line.match(/^(\*+)\s+(?:(TODO|WAITING|DONE)\s+)?(?:\[#([A-Z])\]\s+)?(.*?)(\s+:[^\s]+:)?$/);
    if (heading) {
      return [
        {
          type: 'heading',
          depth: heading[1].length,
          text: heading[4].trim(),
          raw: line,
          line_start: idx,
          line_end: idx,
          todo_keyword: heading[2] ?? null,
          priority: heading[3] ?? null,
          tags: (heading[5] ?? '')
            .trim()
            .split(':')
            .filter(Boolean)
        }
      ];
    }
    if (/^SCHEDULED:|^DEADLINE:/.test(line)) {
      const [keyword, ...rest] = line.split(':');
      return [{ type: 'planning', keyword, text: rest.join(':').trim(), raw: line, line_start: idx, line_end: idx }];
    }
    const list = line.match(/^\s*[-+]\s+(\[[ xX]\]\s+)?(.*)$/);
    if (list) {
      return [
        {
          type: 'list_item',
          depth: 1,
          ordered: false,
          checked: list[1] ? /x/i.test(list[1]) : null,
          text: list[2],
          raw: line,
          line_start: idx,
          line_end: idx
        }
      ];
    }
    return [];
  });
}

export function benchmark(name: string, fn: () => unknown): BenchmarkStats {
  const warmupIterations = Math.max(0, UX_BENCHMARK_WARMUPS);
  for (let idx = 0; idx < warmupIterations; idx += 1) {
    fn();
  }

  const iterations = Math.max(1, UX_BENCHMARK_ITERATIONS);
  const samples: number[] = [];
  for (let idx = 0; idx < iterations; idx += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }

  samples.sort((left, right) => left - right);
  const percentile = (rank: number) => samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * rank))];

  return {
    name,
    iterations,
    warmupIterations,
    minMs: samples[0],
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: samples[samples.length - 1]
  };
}

export function formatStats(stats: BenchmarkStats): string {
  return `${stats.name}: median=${stats.medianMs.toFixed(3)}ms p95=${stats.p95Ms.toFixed(3)}ms min=${stats.minMs.toFixed(3)}ms max=${stats.maxMs.toFixed(3)}ms n=${stats.iterations}`;
}

export function assertMedianWithinBudget(stats: BenchmarkStats, budgetMs: number): void {
  assert.ok(
    stats.medianMs <= budgetMs,
    `${formatStats(stats)} exceeded median budget ${budgetMs}ms`
  );
}

export function createEditorFrontendBenchmarkSuite<TNode, TProjection, TBlockViewModel>(
  frontend: EditorFrontendAdapter<TNode, TProjection, TBlockViewModel>
): void {
  describe(`${frontend.name} editor frontend repeated UX benchmarks`, () => {
    it('projects rendered blocks inside repeated median budget', () => {
      const stats = benchmark(`${frontend.name}:blockProjection`, () =>
        orgSamples.flatMap((raw) =>
          frontend.createBlockViewModels(raw, frontend.syntheticNodes(raw), { outlineOnly: false, readerMode: true })
        )
      );
      console.log(formatStats(stats));
      assertMedianWithinBudget(stats, frontend.budgets.projectionMs);
    });

    it('moves individual org blocks inside repeated median budget', () => {
      const raw = orgSamples[0];
      const heading = frontend.syntheticNodes(raw).find((node) => frontend.isHeading(node, 'Agenda item'));
      assert.ok(heading, 'expected agenda heading test node');
      const stats = benchmark(`${frontend.name}:blockMove`, () => frontend.moveRawBlock(raw, heading, -1));
      console.log(formatStats(stats));
      assertMedianWithinBudget(stats, frontend.budgets.blockMoveMs);
    });

    it('edits individual org blocks inside repeated median budget', () => {
      const raw = orgSamples[1];
      const listItem = frontend.syntheticNodes(raw).find((node) => frontend.isListItem(node, 'render pass'));
      assert.ok(listItem, 'expected render-pass list item test node');
      const stats = benchmark(`${frontend.name}:blockEdit`, () =>
        frontend.updateRawBlock(raw, listItem, '- [X] complete app render pass')
      );
      console.log(formatStats(stats));
      assertMedianWithinBudget(stats, frontend.budgets.blockEditMs);
    });

    it('generates read-mode projection after common toggles inside repeated median budget', () => {
      const nodes = orgSamples.flatMap((raw) => frontend.syntheticNodes(raw));
      const fallbackRaw = orgSamples.join('\n');
      const stats = benchmark(`${frontend.name}:readModeProjection`, () =>
        frontend.nodesToProjection(fallbackRaw, nodes, { outlineOnly: false, readerMode: true })
      );
      console.log(formatStats(stats));
      assertMedianWithinBudget(stats, frontend.budgets.projectionMs);
    });
  });
}
