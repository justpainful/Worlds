import { useState } from "react";
import { call } from "../api";
import { ago, fmtDate, fmtNum, t, useLang } from "../i18n";
import { Button, Empty, IconButton, Row, Section, Segmented } from "../ui";
import { Failed, Loading, Toolbar, useLoad } from "./common";
import { PLATFORM_NAME } from "./Overview";

type Tab = "activity" | "versions" | "storage" | "mail" | "usage" | "downloads" | "cloudflare";
const DAY = 86_400_000;

interface Insights {
  at: number;
  versions: { platform: string; version: string; devices: number }[];
  countries: { country: string; users: number }[];
  active: { perDay: { day: number; users: number }[]; week: number; month: number };
  cohorts: { from: number; size: number; week: number; month: number | null }[];
  funnel: { codes: number; accounts: number; secondDevice: number; sharedWorkspace: number };
  email: { perDay: { day: number; kind: string; provider: string; ok: number; failed: number }[]; failures: { at: number; kind: string; error: string }[] };
  support: { byKind: { kind: string; status: string; n: number }[]; medianFirstReplyMs: number | null; solved: number; notSolved: number };
  usage: { devices: number; avgPages: number; avgBlocks: number; features: Record<string, number>; packs: Record<string, number>; languages: Record<string, number>; errors: Record<string, number> };
}

/** Download a table as CSV (Excel opens it; a BOM keeps Arabic readable). */
export function csv(name: string, rows: (string | number | null)[][]) {
  const text = "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const bytes = (n: number) => (n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n > 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

function Bars({ values, label }: { values: { key: string; value: number; title: string }[]; label: string }) {
  const max = Math.max(1, ...values.map((v) => v.value));
  return (
    <div className="chart" dir="ltr">
      <svg viewBox="0 0 600 120" role="img" aria-label={label} preserveAspectRatio="none">
        {values.map((v, i) => {
          const w = 600 / values.length;
          const h = (v.value / max) * 112;
          return (
            <g key={v.key}>
              <title>{v.title}</title>
              {v.value > 0 && <rect x={i * w + 1} y={120 - h} width={w - 2} height={h} rx={2} className="chart-bar" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Meter({ label, value, of, sub }: { label: string; value: number; of: number; sub?: string }) {
  const p = Math.min(100, of ? (value / of) * 100 : 0);
  return (
    <div className="row survey-row">
      <span className="row-main">
        <span className="row-label">{label}</span>
        <span className={`bar ${p > 80 ? "is-hot" : ""}`} aria-hidden>
          <span style={{ width: `${p}%` }} />
        </span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      <span className="row-value">{Math.round(p)}%</span>
    </div>
  );
}

export function Insights() {
  useLang();
  const [tab, setTab] = useState<Tab>("activity");
  const data = useLoad(() => call<Insights>("GET", "/admin/insights"), []);
  return (
    <div className="view">
      <Toolbar title={t("insights")} subtitle={data.data ? t("updated", { time: ago(data.data.at) }) : undefined}>
        <IconButton icon="arrow.clockwise" label={t("refresh")} onClick={data.reload} disabled={data.loading} />
      </Toolbar>
      <div className="page">
        <div className="filters-row">
          <Segmented
            label={t("insights")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "activity", label: t("tabActivity") },
              { value: "versions", label: t("tabVersions") },
              { value: "storage", label: t("tabStorage") },
              { value: "mail", label: t("tabMail") },
              { value: "usage", label: t("tabUsage") },
              { value: "downloads", label: t("tabDownloads") },
              { value: "cloudflare", label: "Cloudflare" },
            ]}
          />
        </div>
        {tab === "storage" ? (
          <Storage />
        ) : tab === "downloads" ? (
          <Downloads />
        ) : tab === "cloudflare" ? (
          <Cloudflare />
        ) : data.error && !data.data ? (
          <Failed error={data.error} retry={data.reload} />
        ) : !data.data ? (
          <Loading />
        ) : tab === "activity" ? (
          <Activity d={data.data} />
        ) : tab === "versions" ? (
          <Versions d={data.data} />
        ) : tab === "mail" ? (
          <MailSupport d={data.data} />
        ) : (
          <Usage d={data.data} />
        )}
      </div>
    </div>
  );
}

function Activity({ d }: { d: Insights }) {
  const today = Math.floor(d.at / DAY);
  const per = new Map(d.active.perDay.map((x) => [Math.floor(x.day / DAY), x.users]));
  const days = Array.from({ length: 30 }, (_, i) => today - 29 + i);
  const dayAvg = Math.round(days.reduce((a, x) => a + (per.get(x) ?? 0), 0) / 30);
  const f = d.funnel;
  return (
    <div className="grid-2">
      <div>
        <Section title={t("activeUsers")}>
          <Row icon="clock" label={t("avgDaily")} value={fmtNum(dayAvg)} />
          <Row icon="clock" label={t("activeWeek")} value={fmtNum(d.active.week)} />
          <Row icon="clock" label={t("activeMonth")} value={fmtNum(d.active.month)} />
          <Row icon="chart.bar.xaxis" label={t("stickiness")} sub={t("stickinessLead")} value={pct(dayAvg, d.active.month)} />
          <Bars label={t("activeUsers")} values={days.map((x) => ({ key: String(x), value: per.get(x) ?? 0, title: `${fmtDate(x * DAY)}: ${per.get(x) ?? 0}` }))} />
        </Section>
        <Section title={t("funnel")} note={t("funnelLead")}>
          <Meter label={t("funnelCodes", { n: fmtNum(f.codes) })} value={f.codes} of={Math.max(f.codes, 1)} />
          <Meter label={t("funnelAccounts", { n: fmtNum(f.accounts) })} value={f.accounts} of={Math.max(f.codes, 1)} />
          <Meter label={t("funnelSecond", { n: fmtNum(f.secondDevice) })} value={f.secondDevice} of={Math.max(f.accounts, 1)} />
          <Meter label={t("funnelShared", { n: fmtNum(f.sharedWorkspace) })} value={f.sharedWorkspace} of={Math.max(f.accounts, 1)} />
        </Section>
      </div>
      <div>
        <Section
          title={t("retention")}
          note={t("retentionLead")}
          trailing={
            <Button icon="document.on.document" onClick={() => csv("retention", [["week", "accounts", "back after a week", "back after a month"], ...d.cohorts.map((c) => [fmtDate(c.from), c.size, c.week, c.month])])}>
              CSV
            </Button>
          }
        >
          {d.cohorts.map((c) => (
            <Row key={c.from} icon="calendar" label={t("weekOf", { date: fmtDate(c.from) })} sub={t("accountsN", { n: fmtNum(c.size) })} value={`${pct(c.week, c.size)} · ${c.month === null ? "-" : pct(c.month, c.size)}`} />
          ))}
        </Section>
      </div>
    </div>
  );
}

function Versions({ d }: { d: Insights }) {
  const byPlatform = new Map<string, { version: string; devices: number }[]>();
  for (const v of d.versions) byPlatform.set(v.platform, [...(byPlatform.get(v.platform) ?? []), { version: v.version, devices: v.devices }]);
  return (
    <div className="grid-2">
      <div>
        <Section
          title={t("versionsTitle")}
          note={t("versionsLead")}
          trailing={
            <Button icon="document.on.document" onClick={() => csv("versions", [["platform", "version", "devices"], ...d.versions.map((v) => [v.platform, v.version, v.devices])])}>
              CSV
            </Button>
          }
        >
          {[...byPlatform.entries()].map(([p, list]) => {
            const total = list.reduce((a, x) => a + x.devices, 0);
            return list.map((v) => <Row key={`${p}${v.version}`} label={`${PLATFORM_NAME[p] ?? p} ${v.version}`} value={`${fmtNum(v.devices)} · ${pct(v.devices, total)}`} />);
          })}
          {!d.versions.length && <Empty>{t("noData")}</Empty>}
        </Section>
      </div>
      <div>
        <Section title={t("countries")} note={t("countriesLead")}>
          {d.countries.length ? d.countries.map((c) => <Row key={c.country} label={regionName(c.country)} value={fmtNum(c.users)} />) : <Empty>{t("noData")}</Empty>}
        </Section>
      </div>
    </div>
  );
}

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames([document.documentElement.lang === "ar" ? "ar" : "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function MailSupport({ d }: { d: Insights }) {
  const byProvider = new Map<string, { ok: number; failed: number }>();
  for (const e of d.email.perDay) {
    const k = `${e.kind} · ${e.provider}`;
    const v = byProvider.get(k) ?? { ok: 0, failed: 0 };
    byProvider.set(k, { ok: v.ok + e.ok, failed: v.failed + e.failed });
  }
  const kinds = new Map<string, number>();
  for (const k of d.support.byKind) kinds.set(k.kind, (kinds.get(k.kind) ?? 0) + Number(k.n));
  return (
    <div className="grid-2">
      <div>
        <Section title={t("emailTitle")} note={t("emailLead")}>
          {[...byProvider.entries()].map(([k, v]) => (
            <Row key={k} icon="envelope" label={k} value={t("sentFailed", { ok: fmtNum(v.ok), failed: fmtNum(v.failed) })} />
          ))}
          {!byProvider.size && <Empty>{t("noData")}</Empty>}
        </Section>
        {d.email.failures.length > 0 && (
          <Section title={t("emailFailures")}>
            {d.email.failures.map((f, i) => (
              <Row key={i} icon="exclamationmark.triangle" label={f.kind} sub={<span className="mono">{f.error}</span>} value={ago(f.at)} />
            ))}
          </Section>
        )}
      </div>
      <div>
        <Section title={t("supportStats")}>
          {[...kinds.entries()].map(([k, n]) => (
            <Row key={k} label={t(`kind_${k}` as "kind_problem")} value={fmtNum(n)} />
          ))}
          <Row icon="clock" label={t("firstReply")} value={d.support.medianFirstReplyMs === null ? "-" : `${Math.round(d.support.medianFirstReplyMs / 3_600_000)} h`} />
          <Row icon="checkmark" label={t("solvedRate")} value={pct(d.support.solved, d.support.solved + d.support.notSolved)} />
        </Section>
      </div>
    </div>
  );
}

function Usage({ d }: { d: Insights }) {
  const u = d.usage;
  const list = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <p className="section-note">{t("usageLead")}</p>
      <div className="grid-2">
        <div>
          <Section title={t("usageTitle")}>
            <Row label={t("usageDevices")} value={fmtNum(u.devices)} />
            <Row label={t("avgPages")} value={fmtNum(u.avgPages)} />
            <Row label={t("avgBlocks")} value={fmtNum(u.avgBlocks)} />
          </Section>
          <Section title={t("features")}>
            {list(u.features).map(([k, n]) => (
              <Meter key={k} label={k} value={n} of={u.devices} sub={fmtNum(n)} />
            ))}
            {!u.devices && <Empty>{t("noData")}</Empty>}
          </Section>
        </div>
        <div>
          <Section title={t("packsUsed")}>{list(u.packs).length ? list(u.packs).map(([k, n]) => <Row key={k} label={k} value={fmtNum(n)} />) : <Empty>{t("noData")}</Empty>}</Section>
          <Section title={t("languages")}>{list(u.languages).map(([k, n]) => <Row key={k} label={k} value={pct(n, u.devices)} />)}</Section>
          <Section title={t("errorsByVersion")}>{list(u.errors).length ? list(u.errors).map(([k, n]) => <Row key={k} label={k} value={fmtNum(n)} />) : <Empty>{t("noData")}</Empty>}</Section>
        </div>
      </div>
    </>
  );
}

function Storage() {
  const s = useLoad(
    () =>
      call<{
        sync: { total: number; objects: number; complete: boolean } | null;
        pictures: number;
        accounts: { id: string; name: string | null; username: string | null; web: number; pictures: number; total: number }[];
        workspaces: { id: string; name: string | null; bytes: number }[];
      }>("GET", "/admin/insights/storage"),
    [],
  );
  if (s.error && !s.data) return <Failed error={s.error} retry={s.reload} />;
  if (!s.data) return <Loading />;
  const d = s.data;
  return (
    <div className="grid-2">
      <div>
        <Section title={t("storageTitle")}>
          <Row icon="tray" label={t("syncStorage")} value={d.sync ? bytes(d.sync.total) : t("unavailable")} sub={d.sync ? t("objectsN", { n: fmtNum(d.sync.objects) }) : undefined} />
          <Row icon="person.text.rectangle" label={t("profilePictures")} value={bytes(d.pictures)} />
        </Section>
        <Section title={t("topWorkspaces")}>{d.workspaces.length ? d.workspaces.map((w) => <Row key={w.id} icon="square.stack.3d.up" label={<bdi dir="auto">{w.name ?? w.id}</bdi>} value={bytes(w.bytes)} />) : <Empty>{t("noData")}</Empty>}</Section>
      </div>
      <div>
        <Section
          title={t("topAccounts")}
          trailing={
            <Button icon="document.on.document" onClick={() => csv("storage", [["account", "web copy", "pictures"], ...d.accounts.map((a) => [a.username ?? a.id, a.web, a.pictures])])}>
              CSV
            </Button>
          }
        >
          {d.accounts.length ? (
            d.accounts.map((a) => (
              <Row key={a.id} icon="person.crop.circle" label={<bdi>{a.name ?? a.id}</bdi>} sub={`${t("webCopy")} ${bytes(a.web)} · ${t("profilePictures")} ${bytes(a.pictures)}`} value={bytes(a.total)} />
            ))
          ) : (
            <Empty>{t("noData")}</Empty>
          )}
        </Section>
      </div>
    </div>
  );
}

function Downloads() {
  const r = useLoad(() => call<{ tag: string; publishedAt: string; assets: { name: string; downloads: number; size: number }[] }[]>("GET", "/admin/insights/downloads"), []);
  if (r.error && !r.data) return <Failed error={r.error} retry={r.reload} />;
  if (!r.data) return <Loading />;
  return (
    <>
      <div className="filters-row">
        <span />
        <Button icon="document.on.document" onClick={() => csv("downloads", [["release", "file", "downloads"], ...r.data!.flatMap((x) => x.assets.map((a) => [x.tag, a.name, a.downloads]))])}>
          CSV
        </Button>
      </div>
      {r.data.map((rel) => (
        <Section key={rel.tag} title={`${rel.tag} · ${fmtNum(rel.assets.reduce((a, x) => a + x.downloads, 0))} · ${fmtDate(Date.parse(rel.publishedAt))}`}>
          {rel.assets
            .filter((a) => !a.name.endsWith(".txt"))
            .map((a) => (
              <Row key={a.name} icon="arrow.up.right.square" label={<span className="mono">{a.name}</span>} sub={bytes(a.size)} value={fmtNum(a.downloads)} />
            ))}
        </Section>
      ))}
    </>
  );
}

function Cloudflare() {
  const r = useLoad(() => call<Record<string, any>>("GET", "/admin/insights/cloudflare"), []);
  if (r.error && !r.data) return <Failed error={r.error} retry={r.reload} />;
  if (!r.data) return <Loading />;
  const d = r.data;
  if (!d.configured)
    return (
      <Section title="Cloudflare">
        <Row icon="info.circle" label={t("cfNotConnected")} sub={t("cfHow")} />
      </Section>
    );
  const L = d.limits;
  return (
    <div className="grid-2">
      {(d.accounts as any[]).map((a) => {
        if (a.error || !a.data) return <Section key={a.id} title={a.id}>{<Row icon="exclamationmark.triangle" label={a.error ?? t("noData")} />}</Section>;
        const sum = (rows: any[], f: (x: any) => number) => (rows ?? []).reduce((acc, x) => acc + (f(x) || 0), 0);
        const req = sum(a.data.workers, (x) => x.sum.requests);
        const read = sum(a.data.d1, (x) => x.sum.rowsRead);
        const written = sum(a.data.d1, (x) => x.sum.rowsWritten);
        const r2 = sum(a.data.r2, (x) => x.max.payloadSize);
        const dos = sum(a.data.dos, (x) => x.sum.requests);
        return (
          <Section key={a.id} title={`${t("lastDay")} · ${a.id.slice(0, 8)}`} note={t("cfLead")}>
            <Meter label={t("cfWorkers", { n: fmtNum(req) })} value={req} of={L.workerRequests} />
            <Meter label={t("cfD1Read", { n: fmtNum(read) })} value={read} of={L.d1RowsRead} />
            <Meter label={t("cfD1Written", { n: fmtNum(written) })} value={written} of={L.d1RowsWritten} />
            <Meter label={t("cfR2", { n: bytes(r2) })} value={r2} of={L.r2Bytes} />
            <Meter label={t("cfDO", { n: fmtNum(dos) })} value={dos} of={L.doRequests} />
          </Section>
        );
      })}
      {d.zone && (
        <Section title={t("visits")}>
          {(d.zone.hosts ?? []).map((h: any) => (
            <Row key={h.dimensions.clientRequestHTTPHost} icon="globe" label={<span dir="ltr">{h.dimensions.clientRequestHTTPHost}</span>} value={fmtNum(h.count)} />
          ))}
          {(d.zone.paths ?? []).slice(0, 15).map((p: any, i: number) => (
            <Row key={i} icon="text.document" label={<span dir="ltr" className="mono">{p.dimensions.clientRequestHTTPHost + p.dimensions.clientRequestPath}</span>} value={fmtNum(p.count)} />
          ))}
        </Section>
      )}
    </div>
  );
}
