// Sanity checks run in CI: the manifest parses and points at files that exist, and every
// script parses as an ES module.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const src = new URL('../src/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
const files = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
];
let failed = false;
for (const f of files) {
  if (!existsSync(join(src, f))) {
    console.error(`manifest refers to a missing file: ${f}`);
    failed = true;
  }
}
const scripts = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? scripts(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
for (const f of scripts(src)) {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'], { input: readFileSync(f) });
  } catch {
    console.error(`syntax error in ${f}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`manifest ${manifest.version} OK`);
