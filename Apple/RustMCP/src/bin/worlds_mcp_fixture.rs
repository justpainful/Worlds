//! Synthetic-only stdio harness. It never accepts a user database path.
#[cfg(debug_assertions)]
fn main() -> anyhow::Result<()> {
    use std::io::{BufRead,Write};
    use rusqlite::Connection;
    let root=std::env::temp_dir().join(format!("worlds-mcp-fixture-{}",uuid::Uuid::new_v4()));
    std::fs::create_dir(&root)?;
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }
    let _cleanup=Cleanup(root.clone());
    let db=root.join("fixture.db");
    std::fs::write(&db,include_bytes!("../../../RustStore/tests/fixtures/worlds-v11.db"))?;
    let mut connection=Connection::open(db)?;
    connection.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;")?;
    let stdin=std::io::stdin(); let mut stdout=std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line=line?;
        if line.len()>1024*1024 { anyhow::bail!("fixture request exceeds limit") }
        let response=worlds_mcp_compatibility::protocol::dispatch(&line,"0.1.0",worlds_mcp_compatibility::scoped_read::tools,
            |name,args| worlds_mcp_compatibility::scoped_read::call(&mut connection,"fixture-page",name,args))?;
        if let Some(response)=response { writeln!(stdout,"{response}")?; stdout.flush()?; }
    }
    Ok(())
}
#[cfg(not(debug_assertions))]
fn main() { std::process::exit(1); }
