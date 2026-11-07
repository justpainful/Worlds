//! Requires a separately started local Worlds sync Worker and local identity stand-in.
//! Never point this test at a remote service or real account.
use std::collections::HashMap;
use std::net::TcpStream;
use std::time::Duration;
use tungstenite::{connect,client::IntoClientRequest,stream::MaybeTlsStream,Message,WebSocket};
use worlds_collaboration::{CollaborationDoc,store::SyncStore};
use yrs::{StateVector, updates::decoder::Decode};

const BASE: &[u8] = include_bytes!("fixtures/base.bin");
const ALICE: &[u8] = include_bytes!("fixtures/alice-diff.bin");
const BOB: &[u8] = include_bytes!("fixtures/bob-diff.bin");
fn put(mut n: u64, b: &mut Vec<u8>) { while n>=128 { b.push((n as u8 & 127)|128); n >>= 7; } b.push(n as u8); }
fn get(b:&[u8],p:&mut usize)->u64 { let(mut n,mut s)=(0,0); loop {let x=b[*p];*p+=1;n|=((x&127)as u64)<<s;if x<128{return n} s+=7;} }
fn bytes(b:&[u8],p:&mut usize)->Vec<u8>{let n=get(b,p) as usize;let v=b[*p..*p+n].to_vec();*p+=n;v}
fn frame(kind:u64, nums:&[u64], data:&[u8])->Message {let mut b=vec![];put(kind,&mut b);for n in nums {put(*n,&mut b)} put(data.len() as u64,&mut b);b.extend_from_slice(data);Message::Binary(b.into())}
type Socket=WebSocket<MaybeTlsStream<TcpStream>>;
struct Client { socket: Socket, docs: [CollaborationDoc;2], store: SyncStore, batch:u64, pending: HashMap<u64,(i64,Option<i64>)>, denied: bool }
impl Client {
 fn connect(token:&str, db:&std::path::Path, doc_id:&str, user:&str)->Self {
    let base=std::env::var("WORLDS_LIVE_SYNC_URL").expect("local sync URL");
    assert!(base == "ws://127.0.0.1:18790" || base == "ws://localhost:18790", "local-only test");
    let mut request=format!("{base}/v1/workspaces/fixture-workspace/docs/{doc_id}/sync").into_client_request().unwrap();
    request.headers_mut().insert("Authorization",format!("Bearer {token}").parse().unwrap());
    request.headers_mut().insert("Sec-WebSocket-Protocol","worlds-sync.v1".parse().unwrap());
    let (mut socket,_)=connect(request).unwrap();
    if let MaybeTlsStream::Plain(tcp)=socket.get_mut(){tcp.set_read_timeout(Some(Duration::from_secs(8))).unwrap();}
    let store=SyncStore::open(db,"fixture-page",user,"fixture-workspace").unwrap();
    let docs=[CollaborationDoc::default(),CollaborationDoc::default()];
    for ch in 0..2 {for u in store.load(ch as i64).unwrap(){docs[ch].apply(&u).unwrap();} socket.send(frame(0,&[ch as u64,0],&docs[ch].state_vector().unwrap())).unwrap();}
    Self{socket,docs,store,batch:0,pending:HashMap::new(),denied:false}
 }
 fn handshake(&mut self) {
    let(mut steps,mut acks)=(0,0);
    while steps<2 || acks<2 {
      let msg=self.socket.read().expect("service response"); let Message::Binary(data)=msg else {continue};
      let mut pos=0;let kind=get(&data,&mut pos);
      match kind {
        0 => {let ch=get(&data,&mut pos) as usize;let typ=get(&data,&mut pos);let payload=bytes(&data,&mut pos);
          if typ==0 { let upto=self.store.max_pending(ch as i64).unwrap();let diff=self.docs[ch].diff(&payload).unwrap(); self.batch+=1;self.pending.insert(self.batch,(ch as i64,upto));self.socket.send(frame(4,&[self.batch,ch as u64],&diff)).unwrap(); }
          else if typ==1 || typ==2 {self.docs[ch].apply(&payload).unwrap();self.store.append(ch as i64,&payload,false).unwrap(); if typ==1{steps+=1;}}
        },
        5 => {let id=get(&data,&mut pos);let status=get(&data,&mut pos);let reason=String::from_utf8(bytes(&data,&mut pos)).unwrap();
          if let Some((channel,upto))=self.pending.remove(&id) {if status==0 {if let Some(max)=upto {self.store.acknowledge(channel,max).unwrap()}} else {self.denied=true;let full=self.docs[channel as usize].diff(&[0]).unwrap();self.store.reject(channel,"f1f468d2-3b01-4fe0-a2de-df352089d21d",&full,&reason).unwrap();} acks+=1;}
        }, _=>{}
      }
    }
 }
}
fn fixture(suffix:&str, user:&str)->std::path::PathBuf {
 let src=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../WorldsCore/Tests/WorldsCollaborationTests/worlds-collab-v11.db");
 let p=std::env::temp_dir().join(format!("worlds-live-{}-{suffix}.db",std::process::id()));std::fs::copy(src,&p).unwrap(); let db=rusqlite::Connection::open(&p).unwrap(); db.execute("UPDATE account SET user_id=?1",[user]).unwrap(); drop(db); p
}
#[test]
#[ignore = "requires isolated local sync Worker and local fake identity"]
fn live_native_replica_offline_merge_reconnect_and_refusal() {
 let editor=std::env::var("WORLDS_LIVE_EDITOR_TOKEN").unwrap(); let viewer=std::env::var("WORLDS_LIVE_VIEWER_TOKEN").unwrap();
 let doc_id=format!("rustlive{}",std::process::id());
 let p1=fixture("alice","editor");let p2=fixture("bob","editor");let p3=fixture("viewer","viewer");
 {let mut a=SyncStore::open(&p1,"fixture-page","editor","fixture-workspace").unwrap();a.append(0,BASE,true).unwrap();a.append(0,ALICE,true).unwrap();}
 {let mut b=SyncStore::open(&p2,"fixture-page","editor","fixture-workspace").unwrap();b.append(0,BASE,true).unwrap();b.append(0,BOB,true).unwrap();}
 let mut a=Client::connect(&editor,&p1,&doc_id,"editor");a.handshake();assert!(!a.denied);drop(a);
 let mut b=Client::connect(&editor,&p2,&doc_id,"editor");b.handshake();assert!(!b.denied);let merged=b.docs[0].state_vector().unwrap();drop(b);
 let mut a=Client::connect(&editor,&p1,&doc_id,"editor");a.handshake();assert_eq!(StateVector::decode_v1(&a.docs[0].state_vector().unwrap()).unwrap(),StateVector::decode_v1(&merged).unwrap());assert_eq!(a.store.max_pending(0).unwrap(),None);drop(a);
 // Viewer starts with a write absent from server: service must refuse and store must archive it.
 {let mut v=SyncStore::open(&p3,"fixture-page","viewer","fixture-workspace").unwrap();v.append(0,BASE,true).unwrap();v.append(0,ALICE,true).unwrap();v.append(0,BOB,true).unwrap();}
 let other=format!("{doc_id}denied");let mut v=Client::connect(&viewer,&p3,&other,"viewer");v.handshake();assert!(v.denied);assert_eq!(v.store.max_pending(0).unwrap(),None);drop(v);
 for p in [p1,p2,p3] {std::fs::remove_file(p).unwrap();}
}


