import { useState } from "react";
import { ApiError, call } from "../api";
import { useAdmin } from "../App";
import { ago, errorText, fmtDate, t, useLang } from "../i18n";
import { Button, Chip, Empty, IconButton, Row, Section, Segmented, toast } from "../ui";
import { Failed, Loading, Toolbar, useLoad } from "./common";

interface Proposal {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
  status: "pending" | "approved" | "rejected";
  keyLabel: string | null;
  createdAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  result: string | null;
  call: { method: string; path: string; body: Record<string, unknown> } | null;
}
interface Key {
  id: string;
  label: string;
  owner: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** The proposal's details, for a person to judge: who, what, and the text it would send. */
function details(p: Proposal): string {
  const x = p.payload;
  const parts: string[] = [];
  for (const k of ["number", "userId", "username", "pageId", "id", "name", "days", "webCopyMb", "fileMb", "status", "priority", "subject", "reason", "note"]) if (x[k] !== undefined && x[k] !== null && x[k] !== "") parts.push(`${k}: ${String(x[k])}`);
  if (x.ban) parts.push("ban");
  return parts.join(" · ");
}

export function Claude() {
  useLang();
  const { guard, me } = useAdmin();
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const list = useLoad(() => call<Proposal[]>("GET", `/admin/proposals?status=${status}`), [status]);
  const keys = useLoad(() => call<Key[]>("GET", "/admin/keys"), []);
  const [newKey, setNewKey] = useState<string | null>(null);

  const approve = async (p: Proposal) => {
    if (!p.call) return;
    try {
      await guard(() => call(p.call!.method, p.call!.path, p.call!.body));
      await call("POST", `/admin/proposals/${p.id}/decide`, { status: "approved" });
      toast(t("approvedDone"));
      list.reload();
    } catch (e) {
      if ((e as ApiError).code !== "cancelled") toast(errorText(e), "error");
    }
  };
  const reject = async (p: Proposal) => {
    await call("POST", `/admin/proposals/${p.id}/decide`, { status: "rejected" }).catch((e) => toast(errorText(e), "error"));
    list.reload();
  };

  return (
    <div className="view">
      <Toolbar title="Claude" subtitle={t("claudeLead")} />
      <div className="page grid-2">
        <div>
          <div className="filters-row">
            <Segmented
              label={t("proposals")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "pending", label: t("pendingProposals") },
                { value: "all", label: t("st_all") },
              ]}
            />
          </div>
          {list.error && !list.data ? (
            <Failed error={list.error} retry={list.reload} />
          ) : !list.data ? (
            <Loading />
          ) : (
            <Section title={t("proposals")}>
              {list.data.length ? (
                list.data.map((p) => (
                  <div key={p.id} className="proposal">
                    <div className="proposal-head">
                      <Chip tone={p.status === "pending" ? "accent" : p.status === "approved" ? "success" : "plain"}>{t(`prop_${p.status}`)}</Chip>
                      <Chip>{t(`act_${p.action}` as "act_reply")}</Chip>
                      <span className="muted">
                        {p.keyLabel ?? "Claude"} · {ago(p.createdAt)}
                      </span>
                    </div>
                    <p className="proposal-summary" dir="auto">
                      {p.summary}
                    </p>
                    <p className="proposal-details mono" dir="ltr">
                      {details(p)}
                    </p>
                    {typeof p.payload.body === "string" && (
                      <div className="bubble bubble-team proposal-body" dir="auto">
                        {p.payload.body}
                      </div>
                    )}
                    {p.status === "pending" ? (
                      <div className="composer-actions">
                        <Button icon="xmark" onClick={() => reject(p)}>
                          {t("reject")}
                        </Button>
                        <Button variant="accent" icon="checkmark" disabled={!p.call} onClick={() => approve(p)}>
                          {t("approve")}
                        </Button>
                      </div>
                    ) : (
                      <p className="row-sub">{p.decidedBy ? `${p.decidedBy} · ${fmtDate(p.decidedAt ?? 0, true)}` : ""}</p>
                    )}
                  </div>
                ))
              ) : (
                <Empty>{t("noProposals")}</Empty>
              )}
            </Section>
          )}
        </div>
        <div>
          <Section
            title={t("claudeKeys")}
            note={t("claudeKeysLead")}
            trailing={
              me.role === "owner" && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={async () => {
                    try {
                      const r = await guard(() => call<{ key: string }>("POST", "/admin/keys", { label: "Claude" }));
                      setNewKey(r.key);
                      keys.reload();
                    } catch (e) {
                      if ((e as ApiError).code !== "cancelled") toast(errorText(e), "error");
                    }
                  }}
                >
                  {t("newKey")}
                </button>
              )
            }
          >
            {newKey && (
              <div className="row key-once">
                <span className="row-main">
                  <span className="row-label mono" dir="ltr">
                    {newKey}
                  </span>
                  <span className="row-sub">{t("keyOnce")}</span>
                  <span className="row-sub mono" dir="ltr">
                    claude mcp add worlds-admin -e WORLDS_ADMIN_KEY={newKey} -- node tools/worlds-admin-mcp/server.mjs
                  </span>
                </span>
                <IconButton
                  icon="document.on.document"
                  label={t("copyId")}
                  onClick={async () => {
                    await navigator.clipboard.writeText(newKey).catch(() => undefined);
                    toast(t("copied"));
                  }}
                />
              </div>
            )}
            {keys.data?.length ? (
              keys.data.map((k) => (
                <Row
                  key={k.id}
                  icon="key"
                  label={
                    <span className="label-chips">
                      {k.label}
                      {k.revokedAt && <Chip>{t("revoked")}</Chip>}
                    </span>
                  }
                  sub={`${k.owner} · ${fmtDate(k.createdAt)}${k.lastUsedAt ? ` · ${t("lastUsed", { time: ago(k.lastUsedAt) })}` : ""}`}
                  trailing={!k.revokedAt && <IconButton icon="trash" label={t("remove")} onClick={() => guard(() => call("DELETE", `/admin/keys/${k.id}`)).then(keys.reload, () => undefined)} />}
                />
              ))
            ) : (
              <Empty>{t("noKeys")}</Empty>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
