#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const [, , beforeDirArg, afterDirArg, diffDirArg] = process.argv;

if (!beforeDirArg || !afterDirArg || !diffDirArg) {
  console.error('Usage: node e2e/compare-screenshots.mjs <before-dir> <after-dir> <diff-dir>');
  process.exit(2);
}

const beforeDir = path.resolve(beforeDirArg);
const afterDir = path.resolve(afterDirArg);
const diffDir = path.resolve(diffDirArg);
fs.mkdirSync(diffDir, { recursive: true });

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function pngNames(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.png'))
    .sort();
}

function cropData(png, width, height) {
  if (png.width === width && png.height === height) {
    return png.data;
  }
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (y * png.width) * 4;
    const sourceEnd = sourceStart + width * 4;
    const targetStart = (y * width) * 4;
    png.data.copy(data, targetStart, sourceStart, sourceEnd);
  }
  return data;
}

const beforeNames = new Set(pngNames(beforeDir));
const afterNames = pngNames(afterDir);
const names = afterNames.filter((name) => beforeNames.has(name));
const missingBefore = afterNames.filter((name) => !beforeNames.has(name));
const missingAfter = [...beforeNames].filter((name) => !afterNames.includes(name));

if (names.length === 0) {
  console.error(`No matching PNG screenshots found between ${beforeDir} and ${afterDir}`);
  process.exit(1);
}

const results = [];
for (const name of names) {
  const before = readPng(path.join(beforeDir, name));
  const after = readPng(path.join(afterDir, name));
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);
  const beforeData = cropData(before, width, height);
  const afterData = cropData(after, width, height);
  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(
    beforeData,
    afterData,
    diff.data,
    width,
    height,
    { threshold: 0.1, includeAA: true }
  );
  const totalPixels = width * height;
  const mismatchRatio = totalPixels === 0 ? 0 : mismatchedPixels / totalPixels;
  const diffName = name.replace(/\.png$/, '.diff.png');
  fs.writeFileSync(path.join(diffDir, diffName), PNG.sync.write(diff));
  results.push({
    name,
    before: path.join(beforeDir, name),
    after: path.join(afterDir, name),
    diff: path.join(diffDir, diffName),
    width,
    height,
    mismatchedPixels,
    totalPixels,
    mismatchRatio,
    mismatchPercent: Number((mismatchRatio * 100).toFixed(3))
  });
}

const summary = {
  beforeDir,
  afterDir,
  diffDir,
  compared: results.length,
  missingBefore,
  missingAfter,
  results
};

fs.writeFileSync(path.join(diffDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(
  path.join(diffDir, 'summary.md'),
  [
    '# Android screenshot comparison',
    '',
    '| Screen | Mismatched pixels | Delta |',
    '| --- | ---: | ---: |',
    ...results.map((result) =>
      `| ${result.name} | ${result.mismatchedPixels.toLocaleString()} / ${result.totalPixels.toLocaleString()} | ${result.mismatchPercent}% |`
    ),
    missingBefore.length ? `\nMissing before screenshots: ${missingBefore.join(', ')}` : '',
    missingAfter.length ? `\nMissing after screenshots: ${missingAfter.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n') + '\n'
);

console.log(JSON.stringify(summary, null, 2));
