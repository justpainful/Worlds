const path = require('path');
const fs = require('fs');
const os = require('os');
const tools = path.join(os.tmpdir(), 'worlds-reference-tools', 'node_modules');
const esbuild = require(path.join(tools,'esbuild'));
const {chromium} = require(path.join(tools,'playwright-core'));
(async () => {
 const dir = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(),'worlds-shape-ref-'));
 await esbuild.build({entryPoints:[path.join(dir,'docs/apple-native/canvas-reference-generator/entry.ts')],bundle:true,format:'iife',platform:'browser',outfile:path.join(temp,'bundle.js'),plugins:[{name:'stub',setup(build){build.onResolve({filter:/\.\.\/lib\/api$/},()=>({path:path.join(dir,'docs/apple-native/canvas-reference-generator/api-stub.ts')}));}}]});
 const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox','--allow-file-access-from-files']});
 const page = await browser.newPage();
 await page.setContent('<html><body></body></html>'); await page.addScriptTag({path:path.join(temp,'bundle.js')});
 const data = await page.evaluate(()=>{Object.defineProperty(crypto,"randomUUID",{value:()=>"fixture-"+Math.random().toString(36).slice(2)});const scene=newScene(), layer=scene.layerOrder[0], frame=scene.defaultFrameId;scene.frames[frame].w=64;scene.frames[frame].h=64;const node=newNode('shape',layer,frame,{x:10,y:7,w:44,h:40});node.rotation=18;node.shape='right-triangle';node.points=[{x:4,y:4},{x:4,y:35},{x:39,y:35}];node.paint.fill='transparent';node.paint.stroke='#202023';node.paint.strokeWidth=3;scene.nodes[node.id]=node;scene.nodeOrder=[node.id];const stroke=newNode('stroke',layer,frame,{x:0,y:0,w:64,h:64});stroke.brush={...DEFAULT_BRUSH,kind:'hard',size:10,opacity:.6,flow:.7,spacing:.25,pressureSize:true,pressureOpacity:true};stroke.samples=[{x:8,y:20,pressure:.25,tiltX:0,tiltY:0,time:0},{x:30,y:28,pressure:.8,tiltX:0,tiltY:0,time:1},{x:55,y:20,pressure:1,tiltX:0,tiltY:0,time:2}];stroke.seed=123;stroke.erase=false;stroke.alphaLock=false;scene.nodes[stroke.id]=stroke;scene.nodeOrder.push(stroke.id);const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;new DrawingRenderer({tileBackend:'canvas',viewportCache:false}).render(canvas,scene,{x:0,y:0,w:64,h:64,scale:4},{frameId:frame,background:false,uncached:true});return canvas.toDataURL('image/png').split(',')[1];});
 fs.writeFileSync(path.join(dir,'Apple/WorldsCore/Tests/WorldsDrawingVisualComparisonTests/CanvasReferences/right-triangle-mixed-4x.png'),Buffer.from(data,'base64')); await browser.close(); console.log('Created source renderer right-triangle-mixed-4x.png');
})().catch(e=>{console.error(e);process.exit(1)});
