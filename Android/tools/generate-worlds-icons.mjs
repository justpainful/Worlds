// Convert the existing Worlds Lucide icon geometry to Android vector drawables.
// Usage: node Android/tools/generate-worlds-icons.mjs <path-to-lucide-react>
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
if (!root) throw new Error('Provide the installed lucide-react package directory');
const names = ['file-text', 'files', 'search', 'circle-user', 'plus', 'pen-line', 'upload', 'download',
  'trash-2', 'chevron-left', 'chevron-right', 'list', 'settings-2', 'history', 'square-code', 'table-2',
  'text-quote', 'square-terminal', 'lightbulb', 'list-ordered', 'list-todo', 'pencil', 'eraser',
  'highlighter', 'undo-2', 'redo-2', 'sliders-horizontal', 'zoom-in', 'zoom-out', 'maximize',
  'refresh-cw', 'log-out', 'server', 'mail', 'key-round', 'send-horizontal', 'users', 'folder',
  'ellipsis-vertical', 'check', 'circle-check', 'lock-keyhole', 'heading-1', 'type', 'bell', 'message-circle', 'share-2', 'link', 'bold', 'italic', 'underline', 'strikethrough', 'code-2', 'image', 'align-left', 'align-center', 'align-right', 'align-justify', 'arrow-up', 'arrow-down', 'list-plus', 'list-tree', 'rows-3', 'columns-3'];
const output = resolve('Android/app/src/main/res/drawable');
await mkdir(output, { recursive: true });
const pathFor = (type, a) => {
  if (type === 'path') return a.d;
  if (type === 'line') return `M${a.x1},${a.y1} L${a.x2},${a.y2}`;
  if (type === 'circle') return `M${+a.cx - +a.r},${a.cy} a${a.r},${a.r} 0 1,0 ${2 * +a.r},0 a${a.r},${a.r} 0 1,0 ${-2 * +a.r},0`;
  if (type === 'polyline' || type === 'polygon') {
    const values = a.points.trim().split(/[\s,]+/);
    if (values.length % 2 !== 0) throw new Error('Invalid icon points');
    const pairs = [];
    for (let i = 0; i < values.length; i += 2) pairs.push(`${values[i]},${values[i + 1]}`);
    return `M${pairs.join(' L')}${type === 'polygon' ? ' Z' : ''}`;
  }
  if (type === 'rect') {
    const x = +(a.x ?? 0), y = +(a.y ?? 0), w = +a.width, h = +a.height, r = +(a.rx ?? 0);
    return r ? `M${x+r},${y} h${w-2*r} a${r},${r} 0 0,1 ${r},${r} v${h-2*r} a${r},${r} 0 0,1 ${-r},${r} h${-w+2*r} a${r},${r} 0 0,1 ${-r},${-r} v${-h+2*r} a${r},${r} 0 0,1 ${r},${-r} Z` : `M${x},${y} h${w} v${h} h${-w} Z`;
  }
  throw new Error(`Unsupported icon element ${type}`);
};
for (const name of names) {
  let source = join(resolve(root), 'dist/esm/icons', `${name}.mjs`);
  let { __iconData } = await import(pathToFileURL(source));
  if (!__iconData) {
    const alias = (await readFile(source, 'utf8')).match(/export \{ default \} from '\.\/([^']+)'/);
    if (!alias) throw new Error(`Icon geometry missing for ${name}`);
    source = join(resolve(root), 'dist/esm/icons', alias[1]);
    ({ __iconData } = await import(pathToFileURL(source)));
  }
  const paths = __iconData.node.map(([type, attributes]) =>
    `    <path android:pathData="${pathFor(type, attributes)}" android:fillColor="@android:color/transparent" android:strokeColor="#FF000000" android:strokeWidth="1.8" android:strokeLineCap="round" android:strokeLineJoin="round" />`).join('\n');
  const mirror = ['chevron-left', 'chevron-right', 'send-horizontal', 'undo-2', 'redo-2', 'log-out'].includes(name) ? ' android:autoMirrored="true"' : '';
  const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"${mirror}>\n${paths}\n</vector>\n`;
  await writeFile(join(output, `ic_${name.replaceAll('-', '_')}.xml`), xml);
}
await mkdir(resolve('Android/third_party'), { recursive: true });
await copyFile(join(resolve(root), 'LICENSE'), resolve('Android/third_party/LUCIDE_LICENSE.txt'));
await mkdir(resolve('Android/app/src/main/assets/licenses'), { recursive: true });
await copyFile(join(resolve(root), 'LICENSE'), resolve('Android/app/src/main/assets/licenses/LUCIDE_LICENSE.txt'));
