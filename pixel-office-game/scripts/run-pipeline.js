#!/usr/bin/env node
'use strict';
/**
 * Denizen asset pipeline orchestrator.
 *
 * Runs the canonical sequence documented in `docs/SCRIPTS.md`. Each step
 * is a separate process so you can see exactly which step failed when
 * something goes wrong (instead of one giant function call swallowing
 * stack traces).
 *
 * Steps:
 *   1. extract_all_sheets.ps1   — slice raw spritesheets into per-sprite PNGs
 *   2. build_master_catalog.py  — index every sprite into assets-catalog.json
 *   3. label_sprites_ai.py      — (optional) AI-label any unlabeled sprites
 *   4. make_sprite_mosaics.py   — generate visual reference montages
 *   5. build_singles_manifest.js — write the browser-side manifest
 *
 * Flags:
 *   --dry-run    Print what would run; don't actually invoke anything.
 *   --skip-ai    Skip the AI labeling step (no API calls, faster).
 *   --only=N     Run only step N (1..5).
 *   --from=N     Start at step N.
 *
 * Exit code: 0 on success, non-zero on first failed step. The orchestrator
 * never silently continues past a broken step — each step's output
 * is required for the next.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const SCRIPTS_DIR = __dirname;
const ROOT_DIR = path.resolve(__dirname, '..');

// Each step: name, command, args. The runner picks `pwsh` for .ps1,
// `python` for .py, `node` for .js, and falls back to direct exec otherwise.
const STEPS = [
  {
    name: 'extract sprites',
    file: 'extract_all_sheets.ps1',
    skipFlag: null,
  },
  {
    name: 'build master catalog',
    file: 'build_master_catalog.py',
    skipFlag: null,
  },
  {
    name: 'AI label sprites',
    file: 'label_sprites_ai.py',
    skipFlag: '--skip-ai',
  },
  {
    name: 'make sprite mosaics',
    file: 'make_sprite_mosaics.py',
    skipFlag: null,
  },
  {
    name: 'build singles manifest',
    file: 'build_singles_manifest.js',
    skipFlag: null,
  },
];

function parseArgs(argv) {
  const flags = { dryRun: false, skipAi: false, only: null, from: 1 };
  for (const a of argv) {
    if (a === '--dry-run' || a === '-n') flags.dryRun = true;
    else if (a === '--skip-ai') flags.skipAi = true;
    else if (a.startsWith('--only=')) flags.only = parseInt(a.slice(7), 10);
    else if (a.startsWith('--from=')) flags.from = parseInt(a.slice(7), 10);
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n')
        .filter(l => l.startsWith(' *')).map(l => l.slice(3)).join('\n'));
      process.exit(0);
    }
  }
  return flags;
}

function commandFor(file) {
  const full = path.join(SCRIPTS_DIR, file);
  if (!fs.existsSync(full)) return null;
  if (file.endsWith('.ps1')) {
    return { cmd: 'pwsh', args: ['-NoProfile', '-File', full] };
  }
  if (file.endsWith('.py')) {
    // Prefer the venv if one is present, otherwise system python.
    const venvPy = process.platform === 'win32'
      ? path.join(ROOT_DIR, '..', '.venv', 'Scripts', 'python.exe')
      : path.join(ROOT_DIR, '..', '.venv', 'bin', 'python');
    const py = fs.existsSync(venvPy) ? venvPy : 'python';
    return { cmd: py, args: [full] };
  }
  if (file.endsWith('.js')) {
    return { cmd: 'node', args: [full] };
  }
  return null;
}

function runStep(step, idx, flags) {
  const label = `[${idx + 1}/${STEPS.length}] ${step.name}`;
  if (step.skipFlag === '--skip-ai' && flags.skipAi) {
    console.log(`${label}  ⏭  skipped (--skip-ai)`);
    return true;
  }
  const c = commandFor(step.file);
  if (!c) {
    console.warn(`${label}  ⚠  ${step.file} not found — skipping (treating as no-op)`);
    return true;
  }
  console.log(`${label}  ▶  ${c.cmd} ${c.args.map(a => path.basename(a)).join(' ')}`);
  if (flags.dryRun) return true;
  const result = spawnSync(c.cmd, c.args, { stdio: 'inherit', cwd: SCRIPTS_DIR });
  if (result.error) {
    console.error(`${label}  ✗  ${result.error.message}`);
    return false;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    console.error(`${label}  ✗  exit ${result.status}`);
    return false;
  }
  console.log(`${label}  ✓`);
  return true;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  console.log('Denizen asset pipeline');
  console.log('======================');
  if (flags.dryRun) console.log('(dry run — nothing will execute)');
  console.log('');

  let ran = 0;
  for (let i = 0; i < STEPS.length; i++) {
    const stepNum = i + 1;
    if (flags.only != null && stepNum !== flags.only) continue;
    if (stepNum < flags.from) continue;
    const ok = runStep(STEPS[i], i, flags);
    ran++;
    if (!ok) {
      console.error('\nPipeline halted at step ' + stepNum + '.');
      process.exit(1);
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone — ${ran} step(s) ran in ${elapsed}s.`);
}

if (require.main === module) main();
module.exports = { STEPS, commandFor };
