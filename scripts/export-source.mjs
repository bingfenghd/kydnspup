import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Explicit files only: running data and new unreviewed files never enter an export.
export function exportSource(root, output) {
  const files = JSON.parse(readFileSync(resolve(root, 'release-files.json'), 'utf8'));
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) throw new Error('Invalid release file list');
  const sources = files.map(file => {
    if (typeof file !== 'string' || file.includes('\\') || file.startsWith('/') || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid release path');
    if (file.split('/').some(part => /^(?:\.git|node_modules|var|backups|artifacts|logs|\.tmp|\.cache|dist)$/.test(part)) || /(?:^|\/)\.env(?:\..*)?$/.test(file) && file !== '.env.example' || /\.(?:sqlite(?:-wal|-shm)?|db|key|pem|p12|pfx|log)$/i.test(file)) throw new Error(`Private release path: ${file}`);
    let path = root;
    for (const part of file.split('/')) {
      path = resolve(path, part);
      if (lstatSync(path).isSymbolicLink()) throw new Error(`Symbolic link is not allowed: ${file}`);
    }
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error(`Not a regular file: ${file}`);
    return { file, path, mode: stat.mode & 0o777, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
  });
  const within = relative(resolve(root), resolve(output));
  if (!within || within === '..' || within.startsWith(`..${sep}`) || resolve(output) === resolve(root)) throw new Error('Output must be a new directory inside the project');
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output); // Never overwrite a previous candidate or a running installation.
  for (const { file, path, mode } of sources) {
    const dest = resolve(output, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(path, dest);
    // Preserve executable deployment scripts; no ownership, xattrs or runtime data.
    chmodSync(dest, mode);
  }
  writeFileSync(resolve(output, 'SOURCE-MANIFEST.json'), JSON.stringify(sources.map(({ file, sha256 }) => ({ file, sha256 })), null, 2) + '\n');
  return sources.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid version');
  const output = resolve(root, `artifacts/releases/kydnspup-${version}-candidate`);
  console.log(JSON.stringify({ output, files: exportSource(root, output) }));
}
