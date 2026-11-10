const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const [checkout, output] = process.argv.slice(2);
if (!checkout || !output) throw new Error('Provide Worlds checkout and output path');
const Y = createRequire(path.join(path.resolve(checkout), 'package.json'))('yjs');
const doc = new Y.Doc(); doc.clientID = 7345;
const threads = doc.getMap('threads');
const anchor = { kind:'drawing',frameId:'frame-a',nodeId:null,u:0.5,v:0.4,region:{x:0,y:0,w:20,h:10},fallback:{x:10,y:5} };
function thread(id, data, at, comments) {
  const array = new Y.Array();
  array.push(comments.map(c => new Y.Map(Object.entries(c))));
  threads.set(id, new Y.Map([['anchor',data],['createdAt',at],['resolved',false],['comments',array]]));
}
thread('thread-a', anchor, 100, [
  {id:'c1',author:'fixture-user',body:'تعليقي 🌍',createdAt:110},
  {id:'c2',author:'other',body:'private other comment',createdAt:120},
  {id:'c3',author:'fixture-user',body:'removed',deleted:true,createdAt:130},
  {id:'c4',author:'fixture-user',body:'  ',createdAt:140},
  {id:'c5',author:'fixture-user',body:'my reply',createdAt:150}
]);
thread('thread-invalid', {...anchor,frameId:'__proto__'}, 200, [{id:'c6',author:'fixture-user',body:'invalid anchor'}]);
fs.writeFileSync(output, Buffer.from(Y.encodeStateAsUpdate(doc)));
doc.destroy();
