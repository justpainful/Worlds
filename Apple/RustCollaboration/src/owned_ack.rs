//! Experimental per-connection ACK bookkeeping. The transport must authenticate
//! the peer and feed only frames received from this exact live socket.
use crate::store::{StoreError, SyncStore};

pub struct OwnedAckSession<'a> {
    store: &'a mut SyncStore,
    server: String,
    next: u64,
    pending: Option<(u64, i64, Option<i64>)>,
    valid: bool,
}

impl<'a> OwnedAckSession<'a> {
    pub fn new(store: &'a mut SyncStore, server: &str) -> Result<Self, StoreError> {
        if server.is_empty() || server.len() > 2048 { return Err(StoreError::Invalid); }
        // Randomized per-connection sequence, restricted to JS safe integers.
        let bytes = uuid::Uuid::new_v4().into_bytes();
        let next = u64::from_be_bytes(bytes[..8].try_into().unwrap()) & ((1u64 << 51) - 1);
        Ok(Self { store, server: server.into(), next, pending: None, valid: true })
    }
    /// Prepare exactly one in-flight frame. If sending fails or the socket
    /// disconnects, drop this session; no outbox row has been acknowledged.
    pub fn prepare(&mut self, channel: i64, vector: &[u8]) -> Result<(u64, Vec<u8>), StoreError> {
        if !self.valid || self.pending.is_some() { return Err(StoreError::Denied); }
        let (bytes, watermark) = self.store.owned_document_batch(channel, &self.server, vector)?;
        self.next = self.next.checked_add(1).ok_or(StoreError::Invalid)?;
        let batch = self.next;
        self.pending = Some((batch, channel, watermark));
        Ok((batch, bytes))
    }
    /// Call only for an ACK read from this session's authenticated socket.
    /// Rejection and all store failures invalidate the connection's receipt.
    pub fn acknowledge(&mut self, batch: u64, accepted: bool) -> Result<(), StoreError> {
        if !self.valid { return Err(StoreError::Denied); }
        let Some((expected, channel, watermark)) = self.pending else { return Err(StoreError::Denied); };
        if batch != expected { return Err(StoreError::Denied); }
        self.valid = false;
        if !accepted { return Err(StoreError::Denied); }
        if let Some(through) = watermark { self.store.acknowledge_owned_document(channel, &self.server, through)?; }
        self.pending = None;
        self.valid = true;
        Ok(())
    }
}
