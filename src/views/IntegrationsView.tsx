import { useEffect, useState } from "react";
import { ProductIcon } from "../ui/ProductIcon";
import { api, errorMessage } from "../lib/api";
import type { BridgeState } from "../lib/types";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { EmptyState, relTime, Spinner } from "../ui/misc";
import { BRIDGE, bridgeExplain } from "../discord/bridge";

export function IntegrationsView() {
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="view-title">Integrations</h1>
          <p className="view-sub">Everything Worlds connects to runs on your own machines.</p>
        </div>
      </header>
      <div className="integ-grid">
        <ClaudeCard />
        <BridgeCard />
      </div>
    </div>
  );
}

function ClaudeCard() {
  const open = useStore((s) => s.open);
  const [status, setStatus] = useState<{ available: boolean; version?: string; mcpRegistered?: boolean } | null>(null);
  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus({ available: false }));
  }, []);
  return (
    <div className="integ-card">
      <div className="integ-head">
        <span className="integ-icon is-product"><ProductIcon name="claude" size={40} /></span>
        <div>
          <div className="integ-name">Claude Code</div>
          <div className="integ-sub">Local AI bridge · structured Worlds tools</div>
        </div>
        <span className="grow" />
        {!status ? <Spinner /> : <span className={`status-chip ${status.available ? "status-succeeded" : "status-failed"}`}>{status.available ? "Ready" : "Unavailable"}</span>}
      </div>
      {status && !status.available ? (
        <EmptyState compact icon="disconnected" title="Unavailable integration" text="Claude Code was not found on this PC. Install it, then reopen Worlds." />
      ) : (
        <ul className="integ-facts">
          <li><Icon name="check" size={13} /> Runs with Haiku and low effort unless you choose otherwise</li>
          <li><Icon name="check" size={13} /> Only Worlds tools: no shell, no file system</li>
          <li><Icon name="check" size={13} /> Every change is recorded and can be undone</li>
          <li><Icon name={status?.mcpRegistered ? "check" : "info"} size={13} /> {status?.mcpRegistered ? "Also available in your Claude Code sessions" : "Not yet registered for Claude Code sessions"}</li>
        </ul>
      )}
      <div className="integ-foot">
        <Button variant="plain" onClick={() => open({ kind: "settings", section: "ai" })}>Settings</Button>
      </div>
    </div>
  );
}

interface BridgeConfig {
  enabled: boolean;
  host: string;
  user: string;
  remotePort: number;
  localPort: number;
  keyPath: string;
  keyHeader?: string;
}

export function BridgeCard({ detailed }: { detailed?: boolean }) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [state, setState] = useState<BridgeState>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [inventoryAt, setInventoryAt] = useState<number | null>(null);
  const [cfg, setCfg] = useState<BridgeConfig | null>(null);

  const check = async () => {
    setChecking(true);
    try {
      const s = await api.discordStatus(true);
      setState(s.state);
      setError(s.error ?? null);
      setBot(s.bot?.tag ?? null);
      setCfg(s.config as unknown as BridgeConfig);
      if (s.state === "connected") {
        const inv = await api.discordDestinations(true);
        setInventoryAt(inv.fetchedAt ?? Date.now());
      }
    } catch (e) {
      setState("error");
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const explain = bridgeExplain(state);
  const saveCfg = (next: BridgeConfig) => {
    // A host is all it takes to turn the bridge on.
    const cfgNext = { ...next, enabled: next.host.length > 0 };
    setCfg(cfgNext);
    setSetting("discord.bridge", cfgNext);
  };
  void settings;

  return (
    <div className="integ-card">
      <div className="integ-head">
        <span className="integ-icon is-product"><ProductIcon name="discord" size={40} /></span>
        <div>
          <div className="integ-name">Discord via {BRIDGE.label}</div>
          <div className="integ-sub"><bdi>{BRIDGE.host}</bdi> over {BRIDGE.network} · Components V2</div>
        </div>
        <span className="grow" />
        {checking ? <Spinner /> : <span className={`status-chip ${state === "connected" ? "status-succeeded" : state === "unknown" ? "" : "status-failed"}`}>{state === "connected" ? "Connected" : state === "module-missing" ? "Disconnected" : explain.title}</span>}
      </div>

      {state === "connected" ? (
        <ul className="integ-facts">
          <li><Icon name="check" size={13} /> <span>Bot <bdi>{bot}</bdi></span></li>
          <li><Icon name="check" size={13} /> Destinations refreshed {inventoryAt ? relTime(inventoryAt) : ""}</li>
          <li><Icon name="lock" size={13} /> <span>The bot token stays on <bdi>{BRIDGE.host}</bdi>; Worlds holds only a shared key in memory</span></li>
        </ul>
      ) : state === "unknown" ? null : (
        <EmptyState compact icon="disconnected" title={explain.title} text={explain.text} />
      )}

      {state === "module-missing" && (
        <div className="integ-install">
          <div className="integ-install-title">Install the Worlds bridge module</div>
          <p>
            It adds a loopback-only endpoint (127.0.0.1, shared key) next to your bot. No slash commands, and no changes to the bot's other features.
            The module and its instructions are in <bdi>{BRIDGE.moduleDir}</bdi> in the Worlds folder.
          </p>
        </div>
      )}

      {detailed && cfg && (
        <div className="integ-config">
          <label className="field-label">Host ({BRIDGE.network})</label>
          <input className="field" dir="ltr" value={cfg.host} onChange={(e) => saveCfg({ ...cfg, host: e.target.value.trim() })} />
          <label className="field-label">SSH user</label>
          <input className="field" dir="ltr" value={cfg.user} onChange={(e) => saveCfg({ ...cfg, user: e.target.value.trim() })} />
          <label className="field-label">Module port</label>
          <input className="field field-narrow" dir="ltr" type="number" value={cfg.remotePort} onChange={(e) => saveCfg({ ...cfg, remotePort: Number(e.target.value), localPort: Number(e.target.value) })} />
          <label className="field-label">Key file on host</label>
          <input className="field" dir="ltr" value={cfg.keyPath} onChange={(e) => saveCfg({ ...cfg, keyPath: e.target.value.trim() })} />
          {error && state !== "connected" && <div className="hint mono">{error}</div>}
        </div>
      )}

      <div className="integ-foot">
        <Button variant="plain" icon="refresh" loading={checking} onClick={check}>Check connection</Button>
      </div>
    </div>
  );
}
