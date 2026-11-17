// Token Radar, radar-2. Built with the Node 22 standard library only.
//
// main() takes the sealed snapshot (from /input/snapshot.json, or --input <file|dir>), scores every
// rankable pre-token protocol with the model in lib/model.ts, writes the ranked board to
// /output/board.json, and copies this repository's dashboard/ and screenshots/ into /output. It
// finishes by writing /output/dossier.json, the summary the judge reads, through the vendored
// make.fun library in vendor/makefun-board.ts.
//
// The dashboard is a static page with no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which main() writes from the same
// board the JSON carries. The board ranks all 198 rankable pre-token protocols — the 40-protocol
// watchlist plus every other pre-token protocol the snapshot can rank — each with a seven-step
// farm plan. Change the model, the page or the plan; keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue } from './lib/model.ts';
import { buildRadar } from './lib/model.ts';
import { dataScript } from './lib/model.ts';
import { parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The scorer's own caps, from reference/gate.json: the text cap shapes the bytes, the rest refuse.
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const root = fileURLToPath(new URL('.', import.meta.url));

// Read --name <value> and --name=<value> out of the arguments, with a fallback for each.
function flagValue(argv: string[], name: string, fallback: string): string {
  const prefix = `--${name}=`;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return fallback;
}

function fail(message: string, code: number): number {
  process.stderr.write(message + '\n');
  return code;
}

// Copy a directory's regular files into `to`, skipping names that start with a dot, and return
// the names that were copied.
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isFile()) continue;
    copyFileSync(join(from, entry.name), join(to, entry.name));
    copied.push(entry.name);
  }
  return copied;
}

function main(): number {
  const inputArg = flagValue(process.argv, 'input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    return fail(
      `radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`,
      2,
    );
  }
  const out = flagValue(process.argv, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) return fail(`radar: the model wrote a board the gate refuses: ${issue}`, 1);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  copyDir(join(root, 'dashboard'), join(out, 'dashboard'));
  const shots = copyDir(join(root, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    const plural = shots.length === 1 ? '' : 's';
    return fail(
      `radar: screenshots/ holds ${shots.length} image${plural}: hand in 3, the board, a detail view and a filtered view`,
      1,
    );
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) {
      return fail(
        `radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`,
        1,
      );
    }
  }
  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: DOSSIER_TEXT_CAP,
      screenshots: SHOT_LIMITS,
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );

  process.stdout.write(
    `radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
  return 0;
}

process.exit(main());
