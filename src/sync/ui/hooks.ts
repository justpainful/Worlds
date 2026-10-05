import { useEffect, useState, useSyncExternalStore } from "react";
import { listPeople, listThreads, type Person, type ThreadData } from "../comments";
import type { SyncInfo } from "../provider";
import type { CollabSession } from "../session";

export function useSessionInfo(session: CollabSession | null): SyncInfo | null {
  return useSyncExternalStore(
    (fn) => session?.subscribe(fn) ?? (() => undefined),
    () => session?.info ?? null,
  );
}

export function useSessionReady(session: CollabSession | null): { ready: boolean; generation: number } {
  const ready = useSyncExternalStore(
    (fn) => session?.subscribe(fn) ?? (() => undefined),
    () => (session ? `${session.ready ? 1 : 0}:${session.generation}` : "0:0"),
  );
  const [r, g] = ready.split(":");
  return { ready: r === "1", generation: Number(g) };
}

export interface Peer extends Person {
  clientId: number;
}

/** Other people on this page right now (one entry per person). */
export function usePresence(session: CollabSession | null): Peer[] {
  const { ready, generation } = useSessionReady(session);
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    if (!session || !ready) return;
    const aw = session.provider.awareness;
    const read = () => {
      const me = aw.clientID;
      const byUser = new Map<string, Peer>();
      aw.getStates().forEach((st, clientId) => {
        const u = (st as { user?: { id?: string; name?: string; color?: string } }).user;
        if (clientId === me || !u?.id || u.id === session.user.id) return;
        byUser.set(u.id, { id: u.id, name: u.name ?? "Someone", color: u.color ?? "#64a8ff", clientId });
      });
      setPeers([...byUser.values()]);
    };
    read();
    aw.on("change", read);
    return () => aw.off("change", read);
  }, [session, ready, generation]);
  return peers;
}

/** Threads and people of the comments document, live. */
export function useComments(session: CollabSession | null): { threads: ThreadData[]; people: Person[] } {
  const { ready, generation } = useSessionReady(session);
  const [state, setState] = useState<{ threads: ThreadData[]; people: Person[] }>({ threads: [], people: [] });
  useEffect(() => {
    if (!session || !ready) return;
    const doc = session.comments;
    const read = () => setState({ threads: listThreads(doc), people: listPeople(doc) });
    read();
    doc.on("update", read);
    return () => doc.off("update", read);
  }, [session, ready, generation]);
  return state;
}
