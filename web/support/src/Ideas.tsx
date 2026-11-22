import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronUp } from "lucide-react";
import { call, currentEmail, onSession } from "./api";
import { errorText, fmtDate, t, useLang, type Key } from "./i18n";
import { Button, Chip, Empty, Field, Section, Segmented, Spinner, toast } from "../../admin/src/ui";

export interface Idea {
  id: string;
  number: number;
  title: string;
  body: string;
  status: "new" | "planned" | "working" | "shipped";
  shippedIn: string | null;
  teamNote: string | null;
  votes: number;
  voted: boolean;
  createdAt: number;
}

const useEmail = () => useSyncExternalStore(onSession, currentEmail);

function VoteButton({ idea, onVoted }: { idea: Idea; onVoted: (votes: number, voted: boolean) => void }) {
  const email = useEmail();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`vote ${idea.voted ? "is-on" : ""}`}
      aria-pressed={idea.voted}
      aria-label={t("vote")}
      disabled={busy}
      onClick={async () => {
        if (!email) {
          toast(t("voteSignIn"), "error");
          return;
        }
        setBusy(true);
        try {
          const r = await call<{ votes: number; voted: boolean }>("POST", `/community/suggestions/${idea.id}/vote`, { vote: !idea.voted });
          onVoted(r.votes, r.voted);
        } catch (e) {
          toast(errorText(e), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <ChevronUp size={18} strokeWidth={2.2} aria-hidden />
      <span>{idea.votes}</span>
    </button>
  );
}

export function IdeaCard({ idea, onVoted }: { idea: Idea; onVoted?: (votes: number, voted: boolean) => void }) {
  return (
    <div className="idea">
      {onVoted && <VoteButton idea={idea} onVoted={onVoted} />}
      <div className="idea-main">
        <div className="idea-title">
          <bdi dir="auto">{idea.title}</bdi>
          {idea.status !== "new" && <Chip tone={idea.status === "shipped" ? "success" : idea.status === "working" ? "warning" : "accent"}>{t(`idea_${idea.status}` as Key)}</Chip>}
          {idea.shippedIn && <Chip>Worlds {idea.shippedIn}</Chip>}
        </div>
        {idea.body && (
          <p className="idea-body" dir="auto">
            {idea.body}
          </p>
        )}
        {idea.teamNote && (
          <p className="idea-note" dir="auto">
            {t("teamNote")}: {idea.teamNote}
          </p>
        )}
      </div>
    </div>
  );
}

export function Ideas({ gate }: { gate: () => ReactNode }) {
  const lang = useLang();
  const email = useEmail();
  const [sort, setSort] = useState<"top" | "new">("top");
  const [list, setList] = useState<Idea[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setList(null);
    call<Idea[]>("GET", `/community/suggestions?sort=${sort}`)
      .then(setList)
      .catch(() => setList([]));
  }, [sort, email]);
  const add = async () => {
    setBusy(true);
    try {
      await call("POST", "/community/suggestions", { title: title.trim(), body: body.trim(), lang });
      setTitle("");
      setBody("");
      toast(t("ideaSent"));
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-col">
      <h1 className="page-title">{t("ideasTitle")}</h1>
      <p className="page-lead">{t("ideasLead")}</p>
      <Section title={t("newIdea")}>
        <div className="form">
          <Field label={t("ideaTitle")}>
            <input className="input" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
          </Field>
          <Field label={`${t("description")} (${t("optional")})`}>
            <textarea className="input" rows={3} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
          </Field>
          <div className="submit-area">
            {email ? (
              <Button variant="accent" icon="plus" busy={busy} disabled={!title.trim()} onClick={add}>
                {t("sendIdea")}
              </Button>
            ) : (
              gate()
            )}
          </div>
        </div>
      </Section>
      <div className="filters-row">
        <Segmented
          label={t("ideasTitle")}
          value={sort}
          onChange={setSort}
          options={[
            { value: "top", label: t("mostVoted") },
            { value: "new", label: t("newest") },
          ]}
        />
      </div>
      {!list ? (
        <div className="state">
          <Spinner />
        </div>
      ) : list.length ? (
        <div className="group ideas">
          {list.map((i) => (
            <IdeaCard key={i.id} idea={i} onVoted={(votes, voted) => setList(list.map((x) => (x.id === i.id ? { ...x, votes, voted } : x)))} />
          ))}
        </div>
      ) : (
        <Empty>{t("noIdeas")}</Empty>
      )}
    </div>
  );
}

export function Roadmap() {
  useLang();
  const [data, setData] = useState<{ planned: Idea[]; working: Idea[]; shipped: Idea[] } | null>(null);
  useEffect(() => {
    call("GET", "/community/roadmap")
      .then(setData)
      .catch(() => setData({ planned: [], working: [], shipped: [] }));
  }, []);
  if (!data)
    return (
      <div className="state">
        <Spinner />
      </div>
    );
  const col = (k: "planned" | "working" | "shipped") => (
    <section className="road-col">
      <h2>
        {t(`idea_${k}` as Key)} <span className="muted">{data[k].length}</span>
      </h2>
      {data[k].length ? (
        data[k].map((i) => (
          <div key={i.id} className="road-card">
            <IdeaCard idea={i} />
            <span className="road-meta">
              {t("votesN", { n: i.votes })} · {fmtDate(i.createdAt)}
            </span>
          </div>
        ))
      ) : (
        <p className="muted">{t("nothingYet")}</p>
      )}
    </section>
  );
  return (
    <div className="roadmap-page">
      <h1 className="page-title">{t("roadmap")}</h1>
      <p className="page-lead">{t("roadmapLead")}</p>
      <div className="road">
        {col("planned")}
        {col("working")}
        {col("shipped")}
      </div>
    </div>
  );
}
