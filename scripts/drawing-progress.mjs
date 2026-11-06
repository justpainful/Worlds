import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),source=path.join(root,'docs/drawing/requirements.json');
const record=JSON.parse(await readFile(source,'utf8')),states=['verified','implemented','partial','pending'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const scopeText=await readFile(path.join(root,record.scope),'utf8');
const planned=[...scopeText.matchAll(/^- ((?:R|F)\d+)[: ]/gm)].map(m=>m[1]);
if(new Set(planned).size!==record.groups.length||planned.some(id=>!record.groups.some(g=>g.id===id)))throw Error('The requirement ledger does not cover every PLAN axis');
const ids=new Set();
for(const item of record.items){
 if(ids.has(item.id)||!states.includes(item.status)||!record.groups.some(g=>g.id===item.group)||!item.requirement||!item.acceptance)throw Error(`Invalid requirement: ${item.id}`);
 ids.add(item.id);if(item.status==='verified'&&!item.evidence.length)throw Error(`Verified requirement needs evidence: ${item.id}`);
 for(const evidence of item.evidence)await access(path.resolve(root,evidence.split('#')[0]));
}
const fingerprint=sha(JSON.stringify({plan:sha(scopeText),items:record.items.map(({id,group,requirement})=>({id,group,requirement}))}));
if(record.scopeFingerprint!==fingerprint)throw Error('Scope changed: document the scope change and deliberately refresh scopeFingerprint; do not silently alter the denominator');
const count=items=>Object.fromEntries(states.map(state=>[state,items.filter(i=>i.status===state).length]));
const totals=count(record.items),total=record.items.length,remaining=total-totals.verified;
const groups=record.groups.map(g=>{const items=record.items.filter(i=>i.group===g.id);return{...g,total:items.length,...count(items),percent:Number((items.filter(i=>i.status==='verified').length/items.length*100).toFixed(2))};});
const summary={auditedAt:record.auditedAt,scopeFingerprint:fingerprint,total,...totals,remaining,percent:Number((totals.verified/total*100).toFixed(2)),majorAxes:groups.length,closedAxes:groups.filter(g=>g.verified===g.total).length,groups};
const labels={verified:'متحقق',implemented:'منفذ غير متحقق',partial:'جزئي',pending:'لم يبدأ'};
const lines=['# حالة تنفيذ خطة الرسم','',`آخر تدقيق: ${record.auditedAt}. المصدر: [الخطة](PLAN.md) و[سجل المتطلبات](requirements.json).`,'',`**${totals.verified} / ${total} بندًا متحققًا = ${summary.percent.toFixed(2)}٪. المتبقي ${remaining} بندًا.**`,'',`ضمن المتبقي: ${totals.implemented} منفذ يحتاج تحققًا، و${totals.partial} جزئي، و${totals.pending} لم يبدأ. المحاور الرئيسية المكتملة بالكامل: ${summary.closedAxes} / ${groups.length}.`,'','هذه نسبة تغطية بنود التحقق بأوزان متساوية، وليست تقديرًا للوقت أو جاهزية الإصدار. لا يُحتسب البند الجزئي أو الكود غير المتحقق كإنجاز كامل. اختبارات الوحدة تثبت نطاقها فقط؛ فحص التطبيق والأجهزة والأداء مدرج كبنود مستقلة. تقدير60٪ السابق كان تقديرًا ذاتيًا وقد استُبدل بهذه الحسبة.','','يتحدث هذا الملف بتشغيل `node scripts/drawing-progress.mjs` بعد تحديث حالة البنود وأدلتها. تثبّت البصمة نطاق البنود؛ لا يتغير المقام بصمت. كل تقرير تقدم لاحق يجب أن يستخدم الأرقام الناتجة من هذا السجل.','','| المحور | الإجمالي | متحقق | منفذ غير متحقق | جزئي | لم يبدأ | النسبة |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |',...groups.map(g=>`| ${g.id} ${g.title} | ${g.total} | ${g.verified} | ${g.implemented} | ${g.partial} | ${g.pending} | ${g.percent.toFixed(1)}٪ |`),'','## سجل التحقق','','رمز الحالة يتعلق بالبند المحدد فقط. الأدلة السابقة تحتفظ بنطاقها ومصدرها؛ لا تعني قبول كل المحرر الحالي. إدراج ملف كود وحده لا يثبت اكتمال سلوك الواجهة.',''];
for(const group of record.groups){lines.push(`### ${group.id} ${group.title}`,'','| البند | الحالة | المتطلب | الدليل | التحقق أو العمل التالي |','| --- | --- | --- | --- | --- |');for(const item of record.items.filter(i=>i.group===group.id))lines.push(`| ${item.id} | ${labels[item.status]} | ${item.requirement} | ${item.evidence.map(p=>`[${path.basename(p)}](../../${p})`).join(', ')} | ${item.acceptance} |`);lines.push('');}
lines.push('## نطاق الأدلة الحالي','',...Object.entries(record.verificationSnapshot).map(([key,value])=>`- ${key}: ${value}`),'');
const outputs=[['docs/drawing/STATUS.md',lines.join('\n')],['docs/drawing/progress.json',JSON.stringify(summary,null,2)+'\n']];
for(const [name,text]of outputs){const target=path.join(root,name);if(process.argv.includes('--check')){if(await readFile(target,'utf8')!==text)throw Error(`Stale progress output: ${name}`);}else await writeFile(target,text,'utf8');}
console.log(JSON.stringify({total,verified:totals.verified,remaining,implemented:totals.implemented,partial:totals.partial,pending:totals.pending,percent:summary.percent,majorAxes:summary.majorAxes,closedAxes:summary.closedAxes}));
