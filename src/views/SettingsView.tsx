import { useEffect, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { IntelligenceControls } from "../ai/models";
import { api, errorMessage } from "../lib/api";
import { useStore } from "../state/store";
import { Segmented } from "../ui/Segmented";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Avatar, Spinner } from "../ui/misc";
import { ProductIcon } from "../ui/ProductIcon";
import { SearchField } from "../ui/SearchField";
import { ACCENTS } from "../shell/appearance";
import { BridgeCard } from "./IntegrationsView";
import { Select, DIRECTION_OPTIONS, LANGUAGE_OPTIONS } from "../ui/Select";

const SECTIONS: { id: string; label: string; tile: string; group: number; keywords: string }[] = [
  { id: "appearance", label: "Appearance", tile: "design", group: 0, keywords: "theme accent language glass transparency window motion density background liquid" },
  { id: "editor", label: "Editor", tile: "writing", group: 0, keywords: "direction rtl arabic spell check paragraph" },
  { id: "ai", label: "Claude", tile: "claude", group: 1, keywords: "ai model effort spark orbit nova instructions mcp" },
  { id: "automations", label: "Automations", tile: "automations", group: 1, keywords: "background tray startup windows schedule" },
  { id: "integrations", label: "Integrations", tile: "integrations", group: 2, keywords: "connect" },
  { id: "discord", label: "Discord", tile: "discord", group: 2, keywords: "bot bridge host tunnel" },
  { id: "storage", label: "Storage", tile: "archive", group: 3, keywords: "data folder database backup" },
  { id: "advanced", label: "Advanced", tile: "settings", group: 3, keywords: "developer lab reset layout" },
];

export function SettingsView({ section = "appearance" }: { section?: string }) {
  const [active, setActive] = useState(section);
  const [query, setQuery] = useState("");
  const open = useStore((s) => s.open);
  const profile = useStore((s) => s.profile);
  useEffect(() => setActive(section), [section]);
  const q = query.trim().toLowerCase();
  const visible = q ? SECTIONS.filter((s) => `${s.label} ${s.keywords}`.toLowerCase().includes(q)) : SECTIONS;
  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const pick = (id: string) => (id === "integrations" ? open({ kind: "integrations" }) : setActive(id));
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings">
        <SearchField className="settings-search" placeholder="Search" value={query} onChange={setQuery} onKeyDown={(e) => e.key === "Enter" && visible[0] && pick(visible[0].id)} />
        {!q && (
          <button className="settings-account" onClick={() => open({ kind: "profile" })}>
            <Avatar id={profile?.avatar} name={profile?.displayName} size={40} />
            <span className="settings-account-text">
              <span className="settings-account-name bidi">{profile?.displayName || "Your profile"}</span>
              <span className="settings-account-sub">Profile, banner and blocks</span>
            </span>
            <Icon name="forward" size={13} />
          </button>
        )}
        {visible.map((s, i) => (
          <div key={s.id} className={i > 0 && visible[i - 1].group !== s.group && !q ? "settings-nav-gap" : undefined}>
            <button className={`settings-nav-item ${active === s.id ? "is-active" : ""}`} onClick={() => pick(s.id)}>
              <ProductIcon name={s.tile} size={22} />
              <span>{s.label}</span>
            </button>
          </div>
        ))}
        {q && visible.length === 0 && <div className="settings-none">No settings match</div>}
      </nav>
      <div className="settings-body">
        <header className="settings-head">
          <ProductIcon name={current.tile} size={34} />
          <h1>{current.label}</h1>
        </header>
        {active === "appearance" && <Appearance />}
        {active === "editor" && <EditorSettings />}
        {active === "ai" && <AiSettings />}
        {active === "automations" && <AutomationSettings />}
        {active === "discord" && <BridgeCard detailed />}
        {active === "storage" && <StorageSettings />}
        {active === "advanced" && <Advanced />}
      </div>
    </div>
  );
}

/** An Apple-style grouped list: small heading, rounded inset rows, footnote below. */
function Group({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="set-group">
      <h2 className="set-title">{title}</h2>
      <div className="set-rows">{children}</div>
      {note && <p className="set-note">{note}</p>}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <div className="set-row-label">{label}</div>
        {hint && <div className="set-row-hint">{hint}</div>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? "is-on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  );
}

function Appearance() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSetting);
  const profile = useStore((s) => s.profile)!;
  const setProfile = useStore((s) => s.setProfile);
  return (
    <>
      <Group title="Appearance">
        <Row label="Theme" hint="A light appearance is planned.">
          <Segmented value="dark" onChange={() => {}} options={[{ value: "dark", label: "Dark" }]} label="Theme" />
        </Row>
        <Row label="Accent" hint="Used sparingly: selection, mentions, focus.">
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                className={`swatch ${(profile.accent ?? ACCENTS[0].hex) === a.hex ? "is-on" : ""}`}
                style={{ background: a.hex }}
                aria-label={a.name}
                data-tip={a.name}
                onClick={async () => setProfile(await api.updateProfile({ accent: a.hex }))}
              />
            ))}
          </div>
        </Row>
        <Row label="Language" hint="Automatic follows Windows. Pages always keep their own text direction.">
          <Select
            label="Language"
            value={profile.language}
            options={LANGUAGE_OPTIONS}
            onChange={async (v) => setProfile(await api.updateProfile({ language: v }))}
          />
        </Row>
      </Group>
      <Group title="Window" note="Let the desktop show through Worlds. Mica tints the window with your wallpaper; Acrylic blurs whatever is behind it. Text areas stay solid enough to read.">
        <Row label="Transparency">
          <Segmented
            value={(settings["appearance.transparency"] as string) ?? "off"}
            onChange={(v) => {
              useStore.setState({ settings: { ...useStore.getState().settings, "appearance.transparency": v } });
              api.setTransparency(v as "off" | "mica" | "acrylic").catch(() => {});
            }}
            label="Transparency"
            options={[
              { value: "off", label: "Off" },
              { value: "mica", label: "Subtle" },
              { value: "acrylic", label: "Glass" },
            ]}
          />
        </Row>
      </Group>
      <Group title="Glass" note="Full uses the optical pipeline: refraction, thickness-dependent blur, adaptive tint and edge light. Reduced keeps translucency with a cheaper blur. Solid uses opaque surfaces with the same hierarchy.">
        <Row label="Glass quality">
          <Segmented
            value={(settings["appearance.glass"] as string) ?? "full"}
            onChange={(v) => set("appearance.glass", v)}
            label="Glass quality"
            options={[
              { value: "full", label: "Full" },
              { value: "reduced", label: "Reduced" },
              { value: "solid", label: "Solid" },
            ]}
          />
        </Row>
        <Row label="Liquid Glass background" hint="Optional. Your banner's light sits behind the profile and Home, and the content rests on one large glass sheet.">
          <Segmented
            value={settings["appearance.glassBackground"] === true ? "on" : "off"}
            onChange={(v) => set("appearance.glassBackground", v === "on")}
            label="Liquid Glass background"
            options={[
              { value: "off", label: "Off" },
              { value: "on", label: "On" },
            ]}
          />
        </Row>
        <Row label="Motion" hint="Reduced removes material deformation and large morphs.">
          <Segmented
            value={(settings["appearance.motion"] as string) ?? "system"}
            onChange={(v) => set("appearance.motion", v)}
            label="Motion"
            options={[
              { value: "system", label: "System" },
              { value: "reduced", label: "Reduced" },
            ]}
          />
        </Row>
        <Row label="Density">
          <Segmented
            value={(settings["appearance.density"] as string) ?? "comfortable"}
            onChange={(v) => set("appearance.density", v)}
            label="Density"
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </Row>
      </Group>
    </>
  );
}

function EditorSettings() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSetting);
  const profile = useStore((s) => s.profile)!;
  const setProfile = useStore((s) => s.setProfile);
  return (
    <Group title="Editor">
      <Row label="Paragraph direction" hint="Each paragraph follows its own first letter. Mixed Arabic and English stay intact.">
        <Select
          label="Paragraph direction"
          value={profile.textDirection}
          options={DIRECTION_OPTIONS}
          onChange={async (v) => setProfile(await api.updateProfile({ textDirection: v }))}
        />
      </Row>
      <Row label="Spell check">
        <Toggle checked={(settings["editor.spellcheck"] as boolean) ?? true} onChange={(v) => set("editor.spellcheck", v)} label="Spell check" />
      </Row>
    </Group>
  );
}

function AiSettings() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSetting);
  const [status, setStatus] = useState<{ available: boolean; version?: string; path?: string; mcpRegistered?: boolean } | null>(null);
  const [registering, setRegistering] = useState(false);
  const instructions = (settings["ai.instructions"] as string[]) ?? [];
  const [draft, setDraft] = useState("");
  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus({ available: false }));
  }, []);
  return (
    <>
      <Group title="Claude Code" note="Worlds does not call a model provider itself. It runs your local Claude Code with every built-in tool disabled and only the Worlds tools enabled.">
        <Row label="Status" hint={status?.path}>
          {!status ? <Spinner /> : status.available ? <span className="ok-text"><Icon name="success" size={14} /> {status.version}</span> : <span className="bad-text">Not found on this PC</span>}
        </Row>
        <Row label="Model and effort" hint="Spark with Glance keeps everyday edits fast and inexpensive.">
          <IntelligenceControls />
        </Row>
        <Row label="Use Worlds from Claude Code sessions" hint={status?.mcpRegistered ? "Registered. Your Claude Code sessions can read and edit pages through the same safe tools." : "Adds the Worlds tool server to your Claude Code user configuration."}>
          <Button
            variant="plain"
            loading={registering}
            disabled={!status?.available}
            onClick={async () => {
              setRegistering(true);
              try {
                await api.aiRegisterMcp();
                setStatus(await api.aiStatus());
                useStore.getState().toast({ message: "Worlds tools registered with Claude Code", tone: "success" });
              } catch (e) {
                useStore.getState().toast({ message: errorMessage(e), tone: "error" });
              } finally {
                setRegistering(false);
              }
            }}
          >
            {status?.mcpRegistered ? "Register again" : "Register"}
          </Button>
        </Row>
      </Group>
      <Group title="Global instructions" note="Rules Claude follows on every page. Page instructions are added on top.">
        <ul className="instr-list">
          {instructions.map((it, i) => (
            <li key={i} className="instr-item">
              <span className="bidi" dir="auto">{it}</span>
              <button className="icon-btn icon-btn-compact" aria-label="Remove" onClick={() => set("ai.instructions", instructions.filter((_, j) => j !== i))}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <input
          className="field bidi"
          dir="auto"
          placeholder="For example: Reply in Saudi Arabic when the page is in Arabic."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              set("ai.instructions", [...instructions, draft.trim()]);
              setDraft("");
            }
          }}
        />
      </Group>
    </>
  );
}

function AutomationSettings() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSetting);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    autostartEnabled().then(setAutostart).catch(() => setAutostart(false));
  }, []);
  return (
    <Group title="Background" note="Automations run inside Worlds on this PC. If the PC is off, runs are missed and recorded as skipped.">
      <Row label="Keep running in the tray" hint="Closing the window keeps Worlds in the notification area so schedules still run.">
        <Toggle checked={(settings["app.runInBackground"] as boolean) ?? true} onChange={(v) => set("app.runInBackground", v)} label="Keep running in the tray" />
      </Row>
      <Row label="Start with Windows" hint="Starts hidden in the tray so schedules survive a restart.">
        {autostart === null ? (
          <Spinner />
        ) : (
          <Toggle
            checked={autostart}
            label="Start with Windows"
            onChange={async (v) => {
              try {
                if (v) await enableAutostart();
                else await disableAutostart();
                setAutostart(v);
              } catch (e) {
                useStore.getState().toast({ message: errorMessage(e), tone: "error" });
              }
            }}
          />
        )}
      </Row>
    </Group>
  );
}

function StorageSettings() {
  const dataDir = useStore((s) => s.dataDir);
  return (
    <Group title="Storage" note="Everything lives in one folder on this PC: the SQLite database and your attachments. No account, no cloud.">
      <Row label="Data folder" hint={dataDir}>
        <Button variant="plain" icon="folderOpen" onClick={() => revealItemInDir(`${dataDir}\\worlds.db`)}>Show in Explorer</Button>
      </Row>
    </Group>
  );
}

function Advanced() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSetting);
  return (
    <Group title="Advanced">
      <Row label="Developer tools" hint="Adds the Material Lab to the command palette for tuning glass.">
        <Toggle checked={!!settings["advanced.developer"]} onChange={(v) => set("advanced.developer", v)} label="Developer tools" />
      </Row>
      <Row label="Reset layout" hint="Closes all tabs and panes and returns to Home.">
        <Button
          variant="plain"
          onClick={() => {
            useStore.setState({ layout: { panes: [{ id: "p0", tabs: [{ id: "t0", route: { kind: "home" }, back: [], forward: [] }], activeTabId: "t0" }], activePaneId: "p0", widths: [1] } });
          }}
        >
          Reset
        </Button>
      </Row>
    </Group>
  );
}
