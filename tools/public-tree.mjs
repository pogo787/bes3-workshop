#!/usr/bin/env node
// Builds and verifies the public release tree from git-tracked files minus
// tools/public-exclude.txt, then runs check-all.mjs, check-workshop-light.mjs,
// and a privacy scan inside the output directory. Never modifies the repository.
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

function parseOutArg(argv) {
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith('--out=')) return argv[i].slice('--out='.length);
  }
  return null;
}

const outArg = parseOutArg(process.argv);
if (!outArg) {
  console.error('Usage: node tools/public-tree.mjs --out <DIR>');
  process.exit(1);
}

const outDir = path.resolve(outArg);
if (
  outDir === repo ||
  outDir.startsWith(repo + path.sep) ||
  repo.startsWith(outDir + path.sep)
) {
  console.error('Refusing to write public tree inside or above the repository: ' + outDir);
  process.exit(1);
}

const manifestPath = path.join(repo, 'tools', 'public-exclude.txt');
if (!existsSync(manifestPath)) {
  console.error('Missing exclusion manifest: tools/public-exclude.txt');
  process.exit(1);
}

const exclusions = readFileSync(manifestPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter(Boolean);

function isExcluded(relPath) {
  return exclusions.some((rule) => (rule.endsWith('/') ? relPath.startsWith(rule) : relPath === rule));
}

const trackedRaw = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' });
const tracked = trackedRaw.split('\0').filter(Boolean);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let copiedCount = 0;
let excludedCount = 0;
for (const relPath of tracked) {
  if (isExcluded(relPath)) {
    excludedCount++;
    continue;
  }
  const srcAbs = path.join(repo, relPath);
  if (!existsSync(srcAbs)) continue;
  const dstAbs = path.join(outDir, relPath);
  mkdirSync(path.dirname(dstAbs), { recursive: true });
  copyFileSync(srcAbs, dstAbs);
  copiedCount++;
}

// The public tree omits the embedded PDF photo bundle. Mark that fact so the
// loader never requests the excluded file; the private tree ships `true`.
const localMarkerRel = 'web/workshop/local-assets.js';
const localMarkerAbs = path.join(outDir, localMarkerRel);
mkdirSync(path.dirname(localMarkerAbs), { recursive: true });
writeFileSync(localMarkerAbs, '// Public tree: the embedded PDF photo bundle is not shipped.\nwindow.Bes3LocalPartPhotos = false;\n');
const markerText = readFileSync(localMarkerAbs, 'utf8');
if (!/window\.Bes3LocalPartPhotos\s*=\s*false/.test(markerText)) {
  console.error('The public tree marker does not disable the local photo bundle.');
  process.exit(1);
}

// Verify excluded paths are absent from the output tree.
for (const rule of exclusions) {
  const probe = path.join(outDir, rule.replace(/\/$/, ''));
  if (existsSync(probe)) {
    console.error('Excluded path still present in public tree: ' + rule);
    process.exit(1);
  }
}

console.log('BES3 Workshop public release tree');
console.log('  output: ' + outDir);
console.log('  files copied: ' + copiedCount);
console.log('  files excluded: ' + excludedCount);
console.log('');

function runCheck(scriptRel) {
  try {
    const out = execFileSync(process.execPath, [path.join(outDir, scriptRel)], {
      cwd: outDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    process.stdout.write(out);
  } catch (err) {
    if (err.stdout) process.stdout.write(String(err.stdout));
    if (err.stderr) process.stderr.write(String(err.stderr));
    console.error('Public tree check failed: ' + scriptRel);
    process.exit(1);
  }
}

runCheck('tools/check-all.mjs');
console.log('');
runCheck('tools/check-workshop-light.mjs');
console.log('');

// Privacy scan over all files in outDir.
function walkFiles(dir, list) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, list);
    else if (entry.isFile()) list.push(abs);
  }
}

const PRIVATE_IPV4_RE = /\b(?:10\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|172\.(?:1[6-9]|2\d|3[01])\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|192\.168\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d))\b/;
const MNT_TOKEN = '/' + 'mnt/';
const WORKSPACE_TOKEN = '/' + 'workspace';
const UNRAID_RE = new RegExp('\\b' + 'un' + 'raid' + '\\b', 'i');
const PM_ME_RE = new RegExp('\\b' + 'pm' + '\\.me\\b', 'i');
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const outFiles = [];
walkFiles(outDir, outFiles);
const privacyFindings = [];
for (const abs of outFiles) {
  const relPath = path.relative(outDir, abs).split(path.sep).join('/');
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (_) {
    continue;
  }
  if (text.includes('\u0000')) continue;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (PRIVATE_IPV4_RE.test(line)) {
      privacyFindings.push({ file: relPath, line: i + 1, kind: 'private-ipv4' });
    }
    if (line.includes(MNT_TOKEN)) {
      privacyFindings.push({ file: relPath, line: i + 1, kind: 'mnt-path' });
    }
    if (line.includes(WORKSPACE_TOKEN)) {
      privacyFindings.push({ file: relPath, line: i + 1, kind: 'workspace-path' });
    }
    if (UNRAID_RE.test(line)) {
      privacyFindings.push({ file: relPath, line: i + 1, kind: 'private-host-name' });
    }
    if (PM_ME_RE.test(line)) {
      privacyFindings.push({ file: relPath, line: i + 1, kind: 'pm-me-domain' });
    }
    if (!relPath.startsWith('web/vendor/')) {
      const emails = (line.match(EMAIL_RE) || []).filter((e) => !/noreply/i.test(e));
      if (emails.length) {
        privacyFindings.push({ file: relPath, line: i + 1, kind: 'non-noreply-email' });
      }
    }
  }
}

console.log('Privacy scan: ' + outFiles.length + ' files checked, ' + privacyFindings.length + ' finding(s)');
if (privacyFindings.length) {
  for (const f of privacyFindings) {
    console.error('  FAIL  [privacy:' + f.kind + '] ' + f.file + ':' + f.line);
  }
  process.exit(1);
}
console.log('OK — public tree verified.');
