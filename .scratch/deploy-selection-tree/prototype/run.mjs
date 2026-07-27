// PROTOTYPE ONLY. This process can only generate a read-only Deploy Plan.
// There is deliberately no Apply import, command, or action.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  buildDeployTree,
  createPrototypeState,
  flattenVisibleTree,
  focusedNode,
  reducePrototypeState,
  selectionMarker,
  viewportForFocus,
} from './model.mjs';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');
const plan = JSON.parse(execFileSync(process.execPath, [
  cliPath,
  'deploy',
  '--dry-run',
  '--json',
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true,
}));
const homeDir = process.env.USERPROFILE || process.env.HOME || '';
const tree = buildDeployTree(plan, homeDir);
let state = createPrototypeState(tree, plan);
let closed = false;

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error('The Deploy selection prototype requires an interactive terminal.');
}

process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stdout.write('\u001b[?1049h\u001b[?25l');
render();

process.stdin.on('data', (input) => {
  const action = actionForInput(input);
  if (action === 'quit') {
    close();
    return;
  }
  if (action) {
    state = reducePrototypeState(tree, state, action);
    render();
  }
});
process.stdout.on('resize', render);
process.once('SIGINT', close);
process.once('SIGTERM', close);
process.once('exit', restoreTerminal);

function render() {
  const terminalRows = process.stdout.rows || 24;
  const terminalColumns = process.stdout.columns || 80;
  const listBudget = Math.max(terminalRows - 11, 3);
  const flatRows = flattenVisibleTree(tree, state.expandedIds);
  const viewport = viewportForFocus(flatRows, state.focusId, listBudget);
  const focused = focusedNode(tree, state);
  const selectedCount = state.selectedIds.size;
  const lines = [
    'PROTOTYPE · Deploy Selection Tree · no Apply path',
    `${plan.changes.length} changes · ${selectedCount} selected · terminal ${terminalColumns}x${terminalRows}`,
    `Focus ${viewport.start + 1}-${viewport.end}/${viewport.total} · expanded ${state.expandedIds.size} · viewport ${listBudget} rows`,
    '',
  ];

  if (viewport.above > 0) lines.push(`  ↑ ${viewport.above} above`);
  for (const row of viewport.rows) {
    const focus = row.node.id === state.focusId ? '>' : ' ';
    const disclosure = row.node.children?.length
      ? state.expandedIds.has(row.node.id) ? '▼' : '▶'
      : ' ';
    const count = row.node.kind === 'file'
      ? ''
      : ` · ${row.node.changeIds.length} ${row.node.changeIds.length === 1 ? 'file' : 'files'}`;
    lines.push(
      `${focus} ${'  '.repeat(row.depth)}${selectionMarker(row.node, state.selectedIds)} ${disclosure} ${row.node.label}${count}`,
    );
  }
  if (viewport.below > 0) lines.push(`  ↓ ${viewport.below} below`);

  lines.push(
    '',
    `Focused: ${focused?.label ?? 'none'}`,
    focused?.targetPath
      ? `Target: ${shortenHome(focused.targetPath)}`
      : `Scope: ${focused?.changeIds.length ?? 0} underlying Plan change IDs`,
    focused?.strategy
      ? `Strategy: ${focused.strategy}`
      : `Selection: ${selectionMarker(focused ?? { changeIds: [] }, state.selectedIds)}`,
    '',
    '↑↓ Move  ←→ Expand/Collapse  Space Toggle  PgUp/PgDn Page  Home/End',
    'a Advanced Cleanup  q Quit  (mouse-wheel arrows use the same viewport)',
  );

  const fitted = lines
    .slice(0, terminalRows)
    .map((line) => truncate(line, terminalColumns))
    .join('\n');
  process.stdout.write(`\u001b[2J\u001b[H${fitted}`);
}

function actionForInput(input) {
  if (input === 'q' || input === '\u0003') return 'quit';
  if (input === '\u001b[A') return { type: 'move', delta: -1 };
  if (input === '\u001b[B') return { type: 'move', delta: 1 };
  if (input === '\u001b[C') return { type: 'expand' };
  if (input === '\u001b[D') return { type: 'collapse' };
  if (input === '\u001b[5~') return { type: 'page', delta: -1, pageSize: pageSize() };
  if (input === '\u001b[6~') return { type: 'page', delta: 1, pageSize: pageSize() };
  if (input === '\u001b[H' || input === '\u001b[1~') return { type: 'home' };
  if (input === '\u001b[F' || input === '\u001b[4~') return { type: 'end' };
  if (input === ' ') return { type: 'toggle' };
  if (input === 'a') return { type: 'advanced' };
  return undefined;
}

function pageSize() {
  return Math.max((process.stdout.rows || 24) - 13, 1);
}

function shortenHome(targetPath) {
  const normalized = targetPath.replaceAll('\\', '/');
  const normalizedHome = homeDir.replaceAll('\\', '/').replace(/\/$/, '');
  return normalized.startsWith(`${normalizedHome}/`)
    ? `~/${normalized.slice(normalizedHome.length + 1)}`
    : normalized;
}

function truncate(value, columns) {
  if (value.length <= columns) return value;
  return columns <= 1 ? value.slice(0, columns) : `${value.slice(0, columns - 1)}…`;
}

function close() {
  if (closed) return;
  closed = true;
  restoreTerminal();
  process.exit(0);
}

function restoreTerminal() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write('\u001b[?25h\u001b[?1049l');
}
