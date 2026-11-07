//! Narrow personal automation scheduler. No external action is delivered.
use anyhow::{bail, Context, Result};
use chrono::{Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use std::path::Path;
use crate::{db, open_existing, require_personal, store};

fn next_run(trigger: &Value, now: i64) -> Result<Option<i64>> {
    let kind = trigger.get("kind").and_then(Value::as_str).context("invalid trigger")?;
    if kind == "manual" { return Ok(None); }
    if kind == "once" { let at=trigger.get("at").and_then(Value::as_i64).context("invalid once time")?; return Ok((at>now).then_some(at)); }
    let local = Local.timestamp_millis_opt(now).single().context("invalid timestamp")?;
    let raw = trigger.get("time").and_then(Value::as_str).context("missing schedule time")?;
    let time = NaiveTime::parse_from_str(raw,"%H:%M").unwrap_or_else(|_| NaiveTime::from_hms_opt(9,0,0).unwrap());
    let at = |d: NaiveDate| Local.from_local_datetime(&d.and_time(time)).earliest().map(|d|d.timestamp_millis());
    match kind {
        "daily" => Ok((0..3).filter_map(|d| at(local.date_naive()+Duration::days(d))).find(|at|*at>now)),
        "weekly" => {
            let days=trigger.get("days").and_then(Value::as_array).context("missing weekdays")?;
            if days.iter().any(|d|d.as_u64().is_none_or(|v|v>u32::MAX as u64)) { bail!("invalid weekdays") }
            Ok((0..15).filter_map(|d| { let day=local.date_naive()+Duration::days(d); days.iter().any(|v|v.as_u64()==Some(day.weekday().num_days_from_sunday() as u64)).then(||at(day)).flatten() }).find(|at|*at>now))
        }
        "monthly" => {
            let day=trigger.get("day").and_then(Value::as_u64).filter(|v|*v<=u32::MAX as u64).context("invalid day")? as u32;
            let (mut y,mut m)=(local.year(),local.month());
            for _ in 0..14 {
                let last=(28..=31).rev().find(|d|NaiveDate::from_ymd_opt(y,m,*d).is_some()).unwrap_or(28);
                if let Some(date)=NaiveDate::from_ymd_opt(y,m,day.clamp(1,last)) { if let Some(value)=at(date) {if value>now{return Ok(Some(value));}} }
                m+=1;if m>12 {m=1;y+=1;}
            }
            Ok(None)
        }
        _ => bail!("unsupported trigger"),
    }
}

/// Returns only due IDs, never executes or exposes data from shared pages.
pub fn due(path: &Path, now: i64) -> Result<Value> {
    let c = open_existing(path)?;
    let mut q=c.prepare("SELECT id,spec,next_run_at FROM automations WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=?1 ORDER BY next_run_at,id LIMIT 500")?;
    let rows=q.query_map([now],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?)))?;
    let mut result=Vec::new();
    for row in rows {
        let (id,raw,scheduled)=row?; let Ok(spec)=serde_json::from_str::<Value>(&raw) else {continue};
        let Some(page)=spec.pointer("/source/pageId").and_then(Value::as_str) else {continue};
        if require_personal(&c,page).is_ok() {result.push(json!({"id":id,"scheduledFor":scheduled}));}
    }
    Ok(json!(result))
}

/// Atomically advances the timer and either records a skipped run or queues an approval.
/// No Claude transform or network side effect is executed by this function.
pub fn claim(path:&Path, id:&str, expected_due:i64, now:i64) -> Result<Value> {
    let mut c=open_existing(path)?;
    let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row:Option<(String,String,i64)>=tx.query_row("SELECT name,spec,next_run_at FROM automations WHERE id=?1 AND enabled=1 AND next_run_at IS NOT NULL",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    let Some((name,raw,scheduled))=row else {bail!("automation is unavailable")};
    if scheduled!=expected_due || scheduled>now {bail!("conflict: schedule changed or is not due")}
    let spec:Value=serde_json::from_str(&raw)?;
    let page=spec.pointer("/source/pageId").and_then(Value::as_str).filter(|s|!s.is_empty()).context("missing source page")?;
    require_personal(&tx,page)?;
    let trigger=spec.get("trigger").context("missing trigger")?;
    if trigger.get("kind").and_then(Value::as_str)==Some("once") && trigger.get("at").and_then(Value::as_i64)!=Some(scheduled) {bail!("invalid scheduled time")}
    if let Some(policy)=spec.get("policy") {
        if !policy.is_object() || policy.get("unattended").is_some_and(|v|!v.is_boolean()) || policy.get("graceMinutes").is_some_and(|v|!v.is_null() && v.as_i64().is_none()) {bail!("invalid policy")}
    }
    if trigger.get("kind").and_then(Value::as_str)==Some("manual") {bail!("manual trigger is not scheduled")}
    let next=next_run(trigger,now)?;
    let already:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM runs WHERE automation_id=?1 AND trigger='schedule' AND scheduled_for=?2)",params![id,scheduled],|r|r.get(0))?;
    if already {bail!("conflict: scheduled run already recorded")}
    let grace=spec.pointer("/policy/graceMinutes").and_then(Value::as_i64).unwrap_or(30);
    let missed=(now as i128 - scheduled as i128) > (grace as i128)*60_000;
    let run=db::new_id();
    if missed {
        tx.execute("INSERT INTO runs(id,automation_id,status,trigger,scheduled_for,started_at,finished_at,error) VALUES(?1,?2,'skipped','schedule',?3,?4,?4,'Missed while Worlds was not running')",params![run,id,scheduled,now])?;
    } else {
        // Only prepare the original no-transform, explicitly approved Discord path.
        if spec.pointer("/policy/unattended").and_then(Value::as_bool).unwrap_or(false) {bail!("unattended actions are unavailable")}
        let transform=spec.pointer("/transform/kind").and_then(Value::as_str).unwrap_or("none");
        if transform!="none" {bail!("automation transform is unavailable")}
        let action=spec.pointer("/action/kind").and_then(Value::as_str).unwrap_or("discord.send");
        if action!="discord.send" {bail!("unsupported automation action")}
        if spec.pointer("/action/mode").and_then(Value::as_str)==Some("editLast") {bail!("editLast preparation is unavailable")}
        let destination=spec.get("destination").filter(|v|v.is_object()).context("missing destination")?;
        let dest_kind=destination.get("kind").and_then(Value::as_str).context("invalid destination")?;
        if !["channel","thread","dm"].contains(&dest_kind) || destination.get("id").and_then(Value::as_str).is_none_or(str::is_empty) {bail!("unsupported destination")}
        let version=store::snapshot(&tx,page,"automation",Some(&run),Some(&format!("Snapshot for {name}")))?;
        tx.execute("INSERT INTO runs(id,automation_id,status,trigger,scheduled_for,started_at,version_id) VALUES(?1,?2,'waiting','schedule',?3,?4,?5)",params![run,id,scheduled,now,version])?;
        let action_id=db::new_id();
        let payload=json!({"pageId":page,"destination":destination,"options":spec.pointer("/action/options").cloned().unwrap_or(Value::Null),"blocks":Value::Null,"automationId":id,"automationName":name,"runId":run});
        tx.execute("INSERT INTO pending_actions(id,kind,payload,requested_by,op_id,created_at) VALUES(?1,'discord.send',?2,'automation',?3,?4)",params![action_id,payload.to_string(),run,now])?;
        db::mark_change(&tx,Some(page),"pending","runner")?;
    }
    tx.execute("UPDATE automations SET last_run_at=?1,next_run_at=?2,enabled=?3 WHERE id=?4",params![now,next,next.is_some() as i64,id])?;
    db::mark_change(&tx,None,"automation","runner")?;
    tx.commit()?;
    Ok(json!({"runId":run,"status":if missed {"skipped"} else {"waiting"},"scheduledFor":scheduled,"nextRunAt":next}))
}

/// Decline only. Approval and Discord delivery require a separate reviewed integration.
pub fn decline(path:&Path, action_id:&str, now:i64) -> Result<Value> {
    let mut c=open_existing(path)?;let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row:Option<(String,String,String,Option<String>)>=tx.query_row("SELECT kind,payload,requested_by,op_id FROM pending_actions WHERE id=?1 AND status='pending'",[action_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    let Some((kind,raw,requested_by,op_id))=row else {bail!("action unavailable")};
    if kind!="discord.send" || requested_by!="automation" {bail!("unsupported action")}
    let payload:Value=serde_json::from_str(&raw)?;let page=payload.get("pageId").and_then(Value::as_str).context("missing page")?;
    require_personal(&tx,page)?;
    let run=payload.get("runId").and_then(Value::as_str).context("missing run")?;
    let automation=payload.get("automationId").and_then(Value::as_str).context("missing automation")?;
    if op_id.as_deref()!=Some(run) {bail!("invalid action ownership")}
    let spec_raw:Option<String>=tx.query_row("SELECT spec FROM automations WHERE id=?1",[automation],|r|r.get(0)).optional()?;
    let spec:Value=serde_json::from_str(&spec_raw.context("automation unavailable")?)?;
    if spec.pointer("/source/pageId").and_then(Value::as_str)!=Some(page) {bail!("action source changed")}
    let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM runs WHERE id=?1 AND automation_id=?2 AND status='waiting')",params![run,automation],|r|r.get(0))?;
    if !valid {bail!("run unavailable")}
    tx.execute("UPDATE pending_actions SET status='declined',result='{}',resolved_at=?1 WHERE id=?2 AND status='pending'",params![now,action_id])?;
    tx.execute("UPDATE runs SET status='cancelled',finished_at=?1,error='Declined' WHERE id=?2 AND status='waiting'",params![now,run])?;
    db::mark_change(&tx,None,"pending","ui")?;db::mark_change(&tx,None,"automation","runner")?;
    tx.commit()?;Ok(json!({"status":"declined"}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    fn fixture() -> std::path::PathBuf {
        let original=Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db");
        let copy=std::env::temp_dir().join(format!("worlds-auto-{}.db",uuid::Uuid::new_v4()));
        std::fs::copy(original,&copy).unwrap();copy
    }
    fn setup(path:&Path, due:i64, extra:Value) {
        let c=Connection::open(path).unwrap();
        let mut spec=json!({"trigger":{"kind":"once","at":due},"source":{"pageId":"fixture-page"},"action":{"kind":"discord.send"},"destination":{"kind":"channel","id":"target"},"policy":{"unattended":false}});
        if let Some(policy)=extra.get("policy") {spec["policy"]=policy.clone();}
        if let Some(transform)=extra.get("transform") {spec["transform"]=transform.clone();}
        c.execute("INSERT INTO automations(id,name,enabled,spec,next_run_at,created_at,updated_at) VALUES('a','Fixture',1,?1,?2,1,1)",params![spec.to_string(),due]).unwrap();
    }
    #[test]
    fn due_claim_survives_restart_and_cannot_duplicate() {
        let path=fixture();setup(&path,999_000,json!({}));
        assert_eq!(due(&path,1_000_000).unwrap().as_array().unwrap().len(),1);
        let run=claim(&path,"a",999_000,1_000_000).unwrap();assert_eq!(run["status"],"waiting");
        assert!(claim(&path,"a",999_000,1_000_001).is_err());
        let db=Connection::open(&path).unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM runs WHERE status='waiting'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM pending_actions WHERE status='pending'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(db.query_row("SELECT count(*) FROM versions WHERE actor='automation'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        let action:String=db.query_row("SELECT id FROM pending_actions",[],|r|r.get(0)).unwrap(); drop(db);
        decline(&path,&action,1_001_000).unwrap();assert!(decline(&path,&action,1_001_001).is_err());
        let db=Connection::open(&path).unwrap();
        assert_eq!(db.query_row("SELECT status FROM runs",[],|r|r.get::<_,String>(0)).unwrap(),"cancelled");
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn concurrent_claims_are_serialized() {
        let path=fixture();setup(&path,999_000,json!({}));
        let handles:Vec<_>=(0..2).map(|_| {let path=path.clone();std::thread::spawn(move ||claim(&path,"a",999_000,1_000_000).is_ok())}).collect();
        let success=handles.into_iter().map(|h|h.join().unwrap() as usize).sum::<usize>();assert_eq!(success,1);
        let db=Connection::open(&path).unwrap();assert_eq!(db.query_row("SELECT count(*) FROM runs",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn missed_run_is_skipped_without_approval() {
        let path=fixture();setup(&path,1_000,json!({}));
        assert_eq!(claim(&path,"a",1_000,1_801_001).unwrap()["status"],"skipped");
        let db=Connection::open(&path).unwrap();assert_eq!(db.query_row("SELECT count(*) FROM pending_actions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_shared_unattended_and_transform_without_consuming_due() {
        for extra in [json!({"policy":{"unattended":true}}),json!({"transform":{"kind":"claude"}})] {
            let path=fixture();setup(&path,999_000,extra);
            assert!(claim(&path,"a",999_000,1_000_000).is_err());
            let c=Connection::open(&path).unwrap();assert_eq!(c.query_row("SELECT next_run_at FROM automations",[],|r|r.get::<_,i64>(0)).unwrap(),999_000);drop(c);std::fs::remove_file(path).unwrap();
        }
        let path=fixture();setup(&path,999_000,json!({}));
        let c=Connection::open(&path).unwrap();c.execute("UPDATE pages SET workspace_id='team' WHERE id='fixture-page'",[]).unwrap();drop(c);
        assert!(due(&path,1_000_000).unwrap().as_array().unwrap().is_empty());
        assert!(claim(&path,"a",999_000,1_000_000).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
