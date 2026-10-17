#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { patchLapCompletion, sha256 } from './lap-completion-patch.mjs';

const root = new URL('./', import.meta.url);
const at = name => new URL(name, root);
const baseline = JSON.parse(fs.readFileSync(at('baseline.json'), 'utf8'));
const build = JSON.parse(fs.readFileSync(at('patch-build.json'), 'utf8'));
const inputs = [
  ['plant.js', 'https://goatracer.ai/static/js/race/plant.js'],
  ['track_model.js', 'https://goatracer.ai/static/js/race/track_model.js'],
  ['race-params.json', 'https://goatracer.ai/race/params.json'],
  ['oval-model.json', 'https://goatracer.ai/tracks/Oval/model.json'],
];

async function verify() {
  fs.mkdirSync(at('private-source/'), { recursive: true });
  for (const [name, url] of inputs) {
    const target = at(`private-source/${name}`);
    const exists = fs.existsSync(target);
    let bytes;
    if (exists) bytes = fs.readFileSync(target);
    else {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Could not fetch ${name}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (sha256(bytes) !== baseline.inputs[name]) {
      throw new Error(`${name} differs from the reviewed source. Review the current implementation before porting the fix; existing files were preserved.`);
    }
    if (!exists) fs.writeFileSync(target, bytes, { flag: 'wx' });
    console.log(`PASS ${exists ? 'cached' : 'fetched'} ${name}`);
  }

  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', fileURLToPath(at('lap-completion.test.mjs'))], {
    cwd: fileURLToPath(root), stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error(`Regression tests failed: ${result.error?.message || result.status}`);

  const fixed = patchLapCompletion(fs.readFileSync(at('private-source/plant.js'), 'utf8'));
  if (sha256(fixed) !== build.patchedSha256) throw new Error('Patched output differs from the verified module.');
  fs.mkdirSync(at('fixed/'), { recursive: true });
  const target = at('fixed/plant.js');
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== fixed) {
    throw new Error('fixed/plant.js already contains different bytes; preserved for review.');
  }
  if (!fs.existsSync(target)) fs.writeFileSync(target, fixed, { flag: 'wx' });
  console.log(`PASS fixed/plant.js SHA-256 ${sha256(fixed)}`);
}

verify().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
