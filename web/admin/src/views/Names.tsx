import { useState } from "react";
import { call } from "../api";
import { errorText, fmtDate, t, useLang } from "../i18n";
import { Button, Empty, IconButton, Row, Section, toast } from "../ui";
import { Failed, Loading, Toolbar, useLoad } from "./common";

interface NamesData {
  reserved: { name: string; reason: string | null; addedAt: number }[];
  banned: { word: string; addedAt: number }[];
}

function AddRow({ placeholder, action, onAdd, ltr }: { placeholder: string; action: string; onAdd: (v: string) => Promise<void>; ltr?: boolean }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!v.trim()) return;
    setBusy(true);
    try {
      await onAdd(v.trim());
      setV("");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="note-new"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <input className="input" dir={ltr ? "ltr" : "auto"} value={v} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setV(e.target.value)} maxLength={40} />
      <Button type="submit" icon="plus" busy={busy} disabled={!v.trim()}>
        {action}
      </Button>
    </form>
  );
}

export function Names() {
  useLang();
  const { data, error, loading, reload } = useLoad(() => call<NamesData>("GET", "/admin/names"), []);
  const remove = async (path: string) => {
    try {
      await call("DELETE", path);
      reload();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  return (
    <div className="view">
      <Toolbar title={t("names")}>
        <IconButton icon="arrow.clockwise" label={t("refresh")} onClick={reload} disabled={loading} />
      </Toolbar>
      <div className="page narrow">
        {error && !data ? (
          <Failed error={error} retry={reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <Section title={t("reservedNames")} note={t("reservedLead")}>
              <AddRow placeholder={t("namePlaceholder")} action={t("addName")} ltr onAdd={async (name) => (await call("POST", "/admin/names/reserved", { name }), reload())} />
              {data.reserved.length ? (
                data.reserved.map((r) => (
                  <Row
                    key={r.name}
                    icon="at"
                    label={<bdi dir="ltr">@{r.name}</bdi>}
                    sub={[r.reason, fmtDate(r.addedAt)].filter(Boolean).join(" · ")}
                    trailing={<IconButton icon="trash" label={t("remove")} onClick={() => remove(`/admin/names/reserved/${encodeURIComponent(r.name)}`)} />}
                  />
                ))
              ) : (
                <Empty>{t("noNames")}</Empty>
              )}
            </Section>
            <Section title={t("bannedWords")} note={t("bannedLead")}>
              <AddRow placeholder={t("wordPlaceholder")} action={t("addWord")} onAdd={async (word) => (await call("POST", "/admin/names/banned", { word }), reload())} />
              {data.banned.length ? (
                data.banned.map((w) => (
                  <Row
                    key={w.word}
                    icon="nosign"
                    label={<bdi dir="auto">{w.word}</bdi>}
                    sub={fmtDate(w.addedAt)}
                    trailing={<IconButton icon="trash" label={t("remove")} onClick={() => remove(`/admin/names/banned/${encodeURIComponent(w.word)}`)} />}
                  />
                ))
              ) : (
                <Empty>{t("noWords")}</Empty>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
