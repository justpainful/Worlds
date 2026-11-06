"""Private local SQLite backup and content-preservation receipt for this update."""
import hashlib,json,os,sqlite3,sys,time,shutil
from pathlib import Path

root=Path(__file__).resolve().parent.parent
source=Path(os.environ['APPDATA'])/'Worlds'/'worlds.db'
private_root=Path(os.environ['LOCALAPPDATA'])/'WorldsUpdateBackups'
pointer=private_root/'drawing-latest.json'
tables=('pages','blocks','attachments','versions','drawing_documents','drawing_operations','drawing_versions')
def connect(path):
    return sqlite3.connect('file:'+path.as_posix()+'?mode=ro',uri=True,timeout=10)
def records(conn):
    names={r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result={}
    for table in tables:
        if table not in names: continue
        cols=[r[1] for r in conn.execute(f'PRAGMA table_info("{table}")') if r[1] not in ('updated_at','search_text')]
        key='id' if 'id' in cols else 'page_id' if 'page_id' in cols else 'rowid'
        selection=','.join('"'+c+'"' for c in cols)
        result[table]={str(row[0]):hashlib.sha256(repr(tuple(row[1:])).encode()).hexdigest() for row in conn.execute(f'SELECT "{key}",{selection} FROM "{table}"')}
    return result
if sys.argv[1]=='backup':
    if not source.is_file(): raise SystemExit('The owner database is unavailable')
    target=private_root/('drawing-'+time.strftime('%Y%m%d-%H%M%S',time.gmtime()))
    target.mkdir(parents=True,exist_ok=False)
    with connect(source) as current,sqlite3.connect(target/'worlds-before.db') as backup:
        current.backup(backup)
        receipt={'source':str(source),'backup':str(target),'schemaBefore':backup.execute('PRAGMA user_version').fetchone()[0],'integrityBefore':backup.execute('PRAGMA integrity_check').fetchone()[0],'records':records(backup)}
    executable=Path(os.environ['LOCALAPPDATA'])/'Worlds'/'worlds.exe'
    if executable.exists(): shutil.copy2(executable,target/'worlds-before.exe')
    pointer.write_text(json.dumps(receipt),encoding='utf-8')
    print(json.dumps({'backup':str(target),'schemaBefore':receipt['schemaBefore'],'integrityBefore':receipt['integrityBefore'],'counts':{k:len(v) for k,v in receipt['records'].items()}}))
elif sys.argv[1]=='verify':
    before=json.loads(pointer.read_text(encoding='utf-8'))
    with connect(source) as current:
        now=records(current)
        differences={table:[key for key,digest in rows.items() if now.get(table,{}).get(key)!=digest] for table,rows in before['records'].items()}
        receipt={'verifiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'backup':before['backup'],'schemaBefore':before['schemaBefore'],'schemaAfter':current.execute('PRAGMA user_version').fetchone()[0],'integrity':current.execute('PRAGMA integrity_check').fetchone()[0],'existingRecordsPreserved':all(not ids for ids in differences.values()),'changedOrMissingCounts':{k:len(v) for k,v in differences.items()},'countsBefore':{k:len(v) for k,v in before['records'].items()},'countsAfter':{k:len(v) for k,v in now.items()}}
    (root/'docs/drawing/qa/native-owner-update.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt))
else: raise SystemExit('Choose backup or verify')
