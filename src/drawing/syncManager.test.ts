import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const state = { pages: { shared: { id: "shared", kind: "drawing", deletedAt: null }, personal: { id: "personal", kind: "drawing", deletedAt: null } }, settings: {} };
  const transports: { o: any; stopped: boolean; tick: ReturnType<typeof vi.fn> }[] = [];
  return { state, transports, modes: new Map<string, boolean>(), user: "alice", callbacks: [] as (() => void)[], refresh: vi.fn(async () => {}), checkpoint: vi.fn(async (work: any) => work({ revision: 5 })), accept: vi.fn(async () => ({ status: "accepted" })), original: vi.fn(async () => null as unknown), pending: vi.fn(async () => ["pending"]) };
});
vi.mock("../sync/appConfig", () => ({}));
vi.mock("../state/store", () => ({ useStore: { getState: () => fixture.state, subscribe: vi.fn() } }));
vi.mock("../account/api", () => ({ accountApi: { pageLevel: async () => "edit" } }));
vi.mock("../sync/manager", () => ({ workspaceFor: () => "workspace", startSyncManager: vi.fn() }));
vi.mock("../sync/session", () => ({ localStore: () => ({ pageMode: async (id: string) => ({ shared: fixture.modes.get(id) ?? false, workspaceId: "workspace" }) }) }));
vi.mock("../sync/config", () => ({ configureSync: () => fixture.callbacks.forEach((fn) => fn()), onSyncConfigChange: (fn: () => void) => { fixture.callbacks.push(fn); }, syncConfig: () => ({ serverUrl: () => "https://sync.test", user: () => ({ id: fixture.user }), getToken: async () => "token" }) }));
vi.mock("../lib/api", () => ({ errorMessage: String, fileUrl: (id: string) => `http://wfile.localhost/${id}`, api: {
  drawingSyncPendingPages: fixture.pending,
  drawingSyncOpen: async (page: string, _server: string, workspaceId: string) => ({ pageId: page, workspaceId }),
  drawingSyncSnapshot: vi.fn(), drawingSyncAccept: fixture.accept, drawingSyncError: vi.fn(), drawingSyncStoreOriginal: vi.fn(), attachment: fixture.original,
} }));
vi.mock("./session", () => ({ drawingSession: () => ({ checkpoint: fixture.checkpoint, refresh: fixture.refresh, snapshot: () => ({ pending: 0, document: { revision: 0 } }), subscribe: () => () => {} }) }));
vi.mock("./collaboration", () => ({ DrawingLiveSession: class { start = async () => {}; close = async () => {}; subscribe = () => () => {}; snapshot = () => ({ ready: true, info: { state: "synced", unacked: 0 } }); } }));
vi.mock("./transport", () => ({ DrawingTransport: class {
  private record;
  constructor(o: any) { this.record = { o, stopped: false, tick: vi.fn(async () => {}) }; fixture.transports.push(this.record); }
  start() {} stop() { this.record.stopped = true; } tick() { return this.record.tick(); }
} }));

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal("window", new EventTarget()); fixture.transports.length = 0; fixture.callbacks.length = 0; fixture.modes.clear(); fixture.modes.set("shared", true); fixture.modes.set("pending", true); fixture.user = "alice"; vi.clearAllMocks(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("drawing background sync lifecycle", () => {
  it("resumes durable work without an open pane, keeps personal drawings local, and serializes checkpoints", async () => {
    const manager = await import("./syncManager"); manager.startDrawingSyncManager(); await manager.retryDrawingSync("shared"); await manager.retryDrawingSync("pending");
    expect(fixture.transports.map((t) => t.o.pageId).sort()).toEqual(["pending", "shared"]);
    const transport = fixture.transports.find((t) => t.o.pageId === "shared")!;
    await transport.o.io.checkpoint({ revision: 7 });
    expect(fixture.checkpoint).toHaveBeenCalledTimes(1); expect(fixture.accept).toHaveBeenCalledWith("shared", 5, { revision: 7 });
    fixture.original.mockResolvedValueOnce({ pageId: "another-private-page" });
    await expect(transport.o.io.readOriginal("foreign-original")).rejects.toThrow("belongs to another resource");
    window.dispatchEvent(new CustomEvent("worlds:changed", { detail: [{ pageId: "shared", kind: "drawing", origin: "mcp" }] }));
    expect(fixture.refresh).toHaveBeenCalledTimes(1);
  });
  it("retires the old identity and stops transmitting when a drawing becomes personal", async () => {
    const manager = await import("./syncManager"); manager.startDrawingSyncManager(); await manager.retryDrawingSync("shared"); await manager.retryDrawingSync("pending");
    const old = fixture.transports.find((t) => t.o.pageId === "shared")!;
    expect(await old.o.getToken()).toBe("token");
    fixture.user = "bob"; fixture.callbacks.forEach((fn) => fn());
    expect(old.stopped).toBe(true); expect(await old.o.getToken()).toBeNull();
    await manager.retryDrawingSync("shared");
    const current = fixture.transports.filter((t) => t.o.pageId === "shared").at(-1)!; expect(current.o.userId).toBe("bob");
    fixture.modes.set("shared", false); window.dispatchEvent(new CustomEvent("worlds:sync-mode", { detail: { pageId: "shared" } })); await manager.retryDrawingSync("shared");
    expect(current.stopped).toBe(true); expect(fixture.transports.filter((t) => t.o.pageId === "shared")).toHaveLength(2);
  });
});
