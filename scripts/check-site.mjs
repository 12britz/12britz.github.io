// Validates index.html before it ships: the project data has to stay parseable,
// consistent, and connected to the markup it renders into.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const failures = [];
const fail = msg => failures.push(msg);
const check = (ok, msg) => { if (!ok) fail(msg); };

/* ── Script syntax ─────────────────────────────────────── */
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  fail('no inline <script> found');
} else {
  try {
    new Function(scriptMatch[1]);
  } catch (err) {
    fail(`script does not parse: ${err.message}`);
  }
}

/* ── Project data ──────────────────────────────────────── */
const CATEGORIES = new Set(['cli', 'lists', 'ai', 'fork']);
const REQUIRED = ['n', 's', 'u', 'd', 'c'];

const arrayMatch = html.match(/const repos = \[([\s\S]*?)\n\s*\];/);
if (!arrayMatch) {
  fail('could not find the repos array');
} else {
  let repos;
  try {
    repos = new Function(`return [${arrayMatch[1]}]`)();
  } catch (err) {
    fail(`repos array does not evaluate: ${err.message}`);
  }

  if (repos) {
    check(Array.isArray(repos), 'repos is not an array');
    check(repos.length >= 20, `only ${repos.length} projects listed`);

    const names = new Set();
    repos.forEach((r, i) => {
      const where = `repos[${i}] (${r && r.n ? r.n : 'unnamed'})`;
      REQUIRED.forEach(key => check(r[key] !== undefined && r[key] !== null && r[key] !== '', `${where}: missing "${key}"`));
      check(typeof r.s === 'number' && r.s >= 0, `${where}: stars must be a non-negative number`);
      check(CATEGORIES.has(r.c), `${where}: unknown category "${r.c}"`);
      check(/^https:\/\/github\.com\/12britz\/[\w.-]+$/.test(r.u), `${where}: unexpected url ${r.u}`);
      check(!names.has(r.n), `${where}: duplicate entry`);
      names.add(r.n);
    });

    // Every filter tab must have something to show.
    const tabs = [...html.matchAll(/data-f="([a-z]+)"/g)].map(m => m[1]);
    check(tabs.length > 0, 'no filter tabs found');
    tabs.forEach(tab => {
      if (tab === 'all') return;
      check(repos.some(r => r.c === tab), `tab "${tab}" matches no projects`);
    });
  }
}

/* ── Markup wiring ─────────────────────────────────────── */
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const referenced = new Set([...html.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]));
referenced.forEach(id => check(ids.has(id), `script targets missing element id="${id}"`));

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'path', 'polyline', 'line', 'circle', 'rect', 'use', 'stop', 'polygon']);
const stack = [];
const tagPattern = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
let m;
while ((m = tagPattern.exec(html)) !== null) {
  const [, closing, rawName, selfClose] = m;
  const name = rawName.toLowerCase();
  if (name === 'script' || name === 'style') {
    const end = html.indexOf(`</${name}>`, tagPattern.lastIndex);
    if (end === -1) { fail(`unterminated <${name}>`); break; }
    tagPattern.lastIndex = end + name.length + 3;
    continue;
  }
  if (VOID.has(name) || selfClose) continue;
  if (closing) {
    const open = stack.pop();
    if (open !== name) { fail(`mismatched </${name}> (open: <${open || 'none'}>)`); break; }
  } else {
    stack.push(name);
  }
}
if (stack.length) fail(`unclosed tags: ${stack.join(', ')}`);

/* ── Report ────────────────────────────────────────────── */
if (failures.length) {
  console.error(`check-site: ${failures.length} problem(s)`);
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
}
console.log('check-site: ok');
