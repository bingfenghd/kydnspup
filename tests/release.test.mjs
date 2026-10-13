import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { exportSource } from '../scripts/export-source.mjs';

function fixture(t, files = ['README.md', 'scripts/run.sh']) {
  const tmp = resolve(import.meta.dirname, '../.tmp'); mkdirSync(tmp, { recursive: true });
  const root = mkdtempSync(join(tmp, 'release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'README.md'), 'Public source\n');
  writeFileSync(join(root, 'scripts/run.sh'), '#!/bin/sh\nexit 0\n'); chmodSync(join(root, 'scripts/run.sh'), 0o755);
  writeFileSync(join(root, 'release-files.json'), JSON.stringify(files));
  return { root, output: join(root, 'out') };
}

test('release exports only reviewed files, preserves executable scripts and never overwrites', t => {
  const { root, output } = fixture(t);
  writeFileSync(join(root, '.env'), 'fixture-private-token');
  mkdirSync(join(root, 'var')); writeFileSync(join(root, 'var/site.sqlite'), 'fixture-private-data');
  writeFileSync(join(root, 'unreviewed.md'), 'fixture-private-note');
  assert.equal(exportSource(root, output), 2);
  for (const file of ['.env', 'var', 'unreviewed.md']) assert.equal(existsSync(join(output, file)), false);
  assert.equal(statSync(join(output, 'scripts/run.sh')).mode & 0o111, 0o111);
  assert.equal(JSON.parse(readFileSync(join(output, 'SOURCE-MANIFEST.json'))).length, 2);
  assert.throws(() => exportSource(root, output), /EEXIST/);
});

test('release refuses private paths, traversal, duplicates and non-files before copying', async t => {
  for (const file of ['../private', '/private', '.env', '.env.production', 'var/site.sqlite', 'cert.key', 'scripts']) {
    await t.test(file, t => {
      const { root, output } = fixture(t, [file]);
      assert.throws(() => exportSource(root, output)); assert.equal(existsSync(output), false);
    });
  }
  const { root, output } = fixture(t, ['README.md', 'README.md']);
  assert.throws(() => exportSource(root, output), /Invalid release file list/);
});

test('release refuses a symlink file and a symlink ancestor', t => {
  const { root, output } = fixture(t, ['link.md']);
  symlinkSync(join(root, 'README.md'), join(root, 'link.md'));
  assert.throws(() => exportSource(root, output), /Symbolic link/);
  symlinkSync(join(root, 'scripts'), join(root, 'linked'));
  writeFileSync(join(root, 'release-files.json'), JSON.stringify(['linked/run.sh']));
  assert.throws(() => exportSource(root, output), /Symbolic link/);
  assert.equal(existsSync(output), false);
});
