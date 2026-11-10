import { readFile } from 'node:fs/promises';

const file = new URL('../docs/apple-native/FEATURE_PARITY_MATRIX.md', import.meta.url);
const matrix = await readFile(file, 'utf8');
const statuses = [
  'Existing and Verified',
  'Partially Implemented',
  'Broken in Original',
  'Planned but Not Implemented',
  'Native Implementation Complete',
  'Blocked with Documented Reason',
];
const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
for (const line of matrix.split(/\r?\n/)) {
  if (!line.startsWith('| ')) continue;
  const cells = line.split('|').map((cell) => cell.trim());
  const status = cells.at(-2);
  if (status in counts) counts[status]++;
}
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
if (total === 0) throw new Error('No feature rows found in the parity matrix');
const complete = counts['Native Implementation Complete'];
console.log(JSON.stringify({
  groupedRows: total,
  completeAndVerified: complete,
  percentOfCurrentGroups: Math.round(10000 * complete / total) / 100,
  counts,
  limitation: 'The source audit is incomplete; grouped rows are not the complete project feature count.',
}, null, 2));
