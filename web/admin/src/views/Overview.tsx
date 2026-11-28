import { call, type Stats } from "../api";
import { go } from "../App";
import { fmtDate, fmtNum, fmtTime, t } from "../i18n";
import { Chip, IconButton, Row, Section } from "../ui";
import type { SymbolName } from "../symbols";
import { Failed, Loading, Toolbar, useLoad } from "./common";

export const PLATFORM_ICON: Record<string, SymbolName> = {
  windows: "desktopcomputer",
  macos: "laptopcomputer",
  mac: "laptopcomputer",
  linux: "apple.terminal",
  ios: "iphone",
  iphone: "iphone",
  ipados: "iphone",
  android: "iphone",
  web: "globe",
  admin: "shield.lefthalf.filled",
};
export const PLATFORM_NAME: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  mac: "macOS",
  linux: "Linux",
  ios: "iPhone",
  iphone: "iPhone",
  ipados: "iPad",
  android: "Android",
  web: "Web",
  admin: "Dashboard",
  unknown: "?",
};

export function Overview() {
  const { data, error, loading, reload } = useLoad(() => call<Stats>("GET", "/admin/stats"), []);
  return (
    <div className="view">
      <Toolbar title={t("overview")} subtitle={data ? t("updated", { time: fmtTime(data.at) }) : undefined}>
        <IconButton icon="arrow.clockwise" label={t("refresh")} onClick={reload} disabled={loading} />
      </Toolbar>
      {error && !data ? <Failed error={error} retry={reload} /> : !data ? <Loading /> : <Body s={data} />}
    </div>
  );
}

function Body({ s }: { s: Stats }) {
  const n = fmtNum;
  return (
    <div className="page grid-2">
      <div>
        {s.keys && (s.keys.signingDue || s.keys.resendDue) && <KeyReminder k={s.keys} />}
        <Section title={t("accountsGroup")}>
          <Row icon="person.2" label={t("allAccounts")} value={n(s.users.total)} />
          <Row icon="calendar" label={t("newDay")} value={n(s.signups.day)} />
          <Row icon="calendar" label={t("newWeek")} value={n(s.signups.week)} />
          <Row icon="calendar" label={t("newMonth")} value={n(s.signups.month)} />
          <Row icon="pause.circle" label={t("suspendedCount")} value={n(s.users.suspended)} />
          <Row icon="nosign" label={t("bannedCount")} value={n(s.users.banned)} />
          <Row icon="key" label={t("withPasskeyCount")} value={n(s.users.withPasskey)} />
        </Section>
        <Section title={t("signupsChart")}>
          <Chart perDay={s.signups.perDay} at={s.at} />
        </Section>
      </div>
      <div>
        <Section title={t("activity")} note={t("activeNote")}>
          <Row icon="clock" label={t("activeDay")} value={n(s.active.day)} />
          <Row icon="clock" label={t("activeWeek")} value={n(s.active.week)} />
          <Row icon="clock" label={t("activeMonth")} value={n(s.active.month)} />
          <Row icon="laptopcomputer" label={t("devicesSignedIn")} value={n(s.active.devices)} />
        </Section>
        <Section title={t("platforms")}>
          {s.platforms.length ? (
            s.platforms.map((p) => (
              <Row key={p.platform} icon={PLATFORM_ICON[p.platform] ?? "globe"} label={PLATFORM_NAME[p.platform] ?? p.platform} value={t("devicesUsers", { devices: n(p.devices), users: n(p.users) })} />
            ))
          ) : (
            <Row label="0" />
          )}
        </Section>
        <Section title={t("publicGroup")}>
          <Row icon="person.text.rectangle" label={t("profiles")} value={n(s.public.profiles)} />
          <Row icon="text.document" label={t("publishedPages")} value={n(s.public.pages)} />
          <Row icon="link" label={t("shareLinks")} value={n(s.public.shares)} />
          <Row icon="square.stack.3d.up" label={t("workspaces")} sub={t("sharedWorkspaces", { shared: n(s.workspaces.shared) })} value={n(s.workspaces.total)} />
        </Section>
      </div>
    </div>
  );
}

/** The session signing key or the Resend key was replaced more than 6 months ago, or never noted. */
function KeyReminder({ k }: { k: NonNullable<Stats["keys"]> }) {
  const sub = (at: number | null) => (at ? t("keyRotatedOn", { date: fmtDate(at) }) : t("keyNotNoted"));
  return (
    <Section title={t("keysTitle")} note={t("keysReminderLead")}>
      {k.signingDue && <Row icon="key" label={t("keySigning")} sub={sub(k.signingRotatedAt)} trailing={<Chip tone="warning">{t("keyDue")}</Chip>} onClick={() => go("control")} />}
      {k.resendDue && <Row icon="envelope" label={t("keyResend")} sub={sub(k.resendRotatedAt)} trailing={<Chip tone="warning">{t("keyDue")}</Chip>} onClick={() => go("control")} />}
    </Section>
  );
}

const DAY = 86_400_000;

/** Thirty bars, one per UTC day, with today at the trailing edge. */
function Chart({ perDay, at }: { perDay: Stats["signups"]["perDay"]; at: number }) {
  const today = Math.floor(at / DAY) * DAY;
  const days = Array.from({ length: 30 }, (_, i) => today - (29 - i) * DAY);
  const counts = new Map(perDay.map((d) => [d.day, d.count]));
  const max = Math.max(1, ...days.map((d) => counts.get(d) ?? 0));
  const total = days.reduce((a, d) => a + (counts.get(d) ?? 0), 0);
  if (!total) return <div className="row row-empty">{t("noSignups")}</div>;
  const W = 600;
  const H = 120;
  const gap = 4;
  const bw = (W - gap * 29) / 30;
  return (
    // Time runs left to right in both languages, so the dates under the bars stay in place.
    <div className="chart" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={t("signupsChart")} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} className="chart-base" />
        {days.map((d, i) => {
          const c = counts.get(d) ?? 0;
          const h = c ? Math.max(3, (c / max) * (H - 8)) : 0;
          return (
            <g key={d}>
              <title>{`${fmtDate(d)}: ${c}`}</title>
              {c > 0 && <rect x={i * (bw + gap)} y={H - h} width={bw} height={h} rx={Math.min(3, bw / 2)} className="chart-bar" />}
              <rect x={i * (bw + gap)} y={0} width={bw} height={H} className="chart-hit" />
            </g>
          );
        })}
      </svg>
      <div className="chart-axis">
        <span>{fmtDate(days[0])}</span>
        <span>{fmtNum(total)}</span>
        <span>{fmtDate(days[29])}</span>
      </div>
    </div>
  );
}
