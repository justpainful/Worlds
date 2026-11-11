import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { api, errorMessage } from "../lib/api";
import type { AiLocalServer, AiModelInfo, AiProvider, AiRunnerStatus } from "../lib/types";
import { useStore } from "../state/store";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Select } from "../ui/Select";
import { Spinner } from "../ui/misc";
import { IntelligenceControls, useModelSetting } from "./models";

/**
 * Model providers. Claude Code stays the default and keeps Worlds' own names
 * for its tiers (Spark, Orbit, Nova). Every other provider shows its real
 * model ids. API keys are written to Windows Credential Manager by the app
 * and never come back to the UI: only whether one is saved.
 */

export const CLAUDE_CODE = "claude-code";
export const CODEX = "codex";

/** The app's language choice, the same rule the drawing and sync screens use. */
export function useArabic(): boolean {
  const language = useStore((s) => s.profile?.language);
  return language === "ar" || (language === "auto" && typeof navigator !== "undefined" && navigator.language.startsWith("ar"));
}

export function useT() {
  const arabic = useArabic();
  return useCallback((en: string, ar: string) => (arabic ? ar : en), [arabic]);
}

/** Strips the machine prefixes Rust puts on errors so the UI can tell them apart. */
export function plainError(text: string): string {
  return text.replace(/^(provider_auth|codex_signed_out|claude_signed_out):\s*/, "");
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let presets: Promise<AiProvider[]> | null = null;

/** The provider list, loaded once per session and refreshed after a save. */
export function useProviders() {
  const [list, setList] = useState<AiProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (presets ??= api.aiProviders())
      .then((l) => live && setList(l))
      .catch((e) => {
        presets = null;
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, []);
  const update = useCallback((p: AiProvider) => {
    setList((l) => {
      const next = (l ?? []).map((x) => (x.id === p.id ? p : x));
      presets = Promise.resolve(next);
      return next;
    });
  }, []);
  return { list, error, update };
}

/** The provider and model the chat uses (saved settings `ai.provider` and `ai.models`). */
export function useProviderChoice() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSetting);
  const provider = (settings["ai.provider"] as string) || CLAUDE_CODE;
  const models = (settings["ai.models"] as Record<string, string> | undefined) ?? {};
  return {
    provider,
    model: models[provider] ?? "",
    modelFor: (id: string) => models[id] ?? "",
    setProvider: (id: string) => set("ai.provider", id),
    setModel: (id: string, model: string) => set("ai.models", { ...models, [id]: model }),
  };
}

const modelCache = new Map<string, AiModelInfo[]>();

function useModels(provider: AiProvider | undefined) {
  const [models, setModels] = useState<AiModelInfo[] | null>(provider ? (modelCache.get(provider.id) ?? null) : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!provider || provider.kind === "runner") return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.aiProviderModels(provider.id);
      modelCache.set(provider.id, list);
      setModels(list);
    } catch (e) {
      setError(plainError(errorMessage(e)));
    } finally {
      setLoading(false);
    }
  }, [provider]);
  useEffect(() => {
    setModels(provider ? (modelCache.get(provider.id) ?? null) : null);
    setError(null);
  }, [provider]);
  return { models, loading, error, load };
}

// ---------------------------------------------------------------------------
// Chat: provider, then model
// ---------------------------------------------------------------------------

/** What the model button in the composer says. */
export function useModelLabel(): { label: string; level: number } {
  const t = useT();
  const choice = useProviderChoice();
  const claude = useModelSetting();
  const { list } = useProviders();
  if (choice.provider === CLAUDE_CODE) return { label: `${claude.model.name} · ${claude.effort.name}`, level: claude.modelIndex };
  const name = list?.find((p) => p.id === choice.provider)?.name ?? choice.provider;
  const model = choice.model || (choice.provider === CODEX ? t("Default model", "النموذج الافتراضي") : t("Pick a model", "اختر نموذجًا"));
  return { label: `${name} · ${model}`, level: 1 };
}

export function ProviderModelPicker({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const t = useT();
  const arabic = useArabic();
  const choice = useProviderChoice();
  const { list } = useProviders();
  const provider = list?.find((p) => p.id === choice.provider);
  const { models, loading, error, load } = useModels(provider);
  const [custom, setCustom] = useState(choice.model);
  useEffect(() => setCustom(choice.model), [choice.model, choice.provider]);
  const needsKey = provider?.key === "required" && !provider.hasKey;
  // Local servers answer fast; load their models as soon as they are picked.
  useEffect(() => {
    if (provider && provider.kind === "local" && !modelCache.has(provider.id)) void load();
  }, [provider, load]);

  if (!list) return <Spinner />;
  const options = list.map((p) => ({ value: p.id, label: p.name, hint: p.kind === "local" ? t("Local", "محلي") : undefined }));
  const picked = models?.find((m) => m.id === choice.model);
  return (
    <div className="intel provider-pick" dir={arabic ? "rtl" : undefined}>
      <div className="intel-block">
        <div className="intel-head">
          <span className="intel-title">{t("Provider", "المزوّد")}</span>
        </div>
        <Select value={choice.provider} options={options} onChange={choice.setProvider} label={t("Provider", "المزوّد")} className="provider-select" />
        {provider?.note && choice.provider !== CLAUDE_CODE && <p className="intel-note">{providerNote(provider, t)}</p>}
      </div>
      {choice.provider === CLAUDE_CODE ? (
        <IntelligenceControls />
      ) : (
        <div className="intel-block">
          <div className="intel-head">
            <span className="intel-title">{t("Model", "النموذج")}</span>
            {provider && provider.kind !== "runner" && (
              <Button variant="quiet" size="compact" icon="refresh" loading={loading} disabled={needsKey} onClick={() => void load()}>
                {models ? t("Reload", "إعادة التحميل") : t("Load models", "تحميل النماذج")}
              </Button>
            )}
          </div>
          {needsKey ? (
            <div className="warn warn-warn">
              <Icon name="lock" size={14} />
              <span>
                {t(`Add your ${provider?.name} API key in Settings, Providers.`, `أضف مفتاح ${provider?.name} في الإعدادات، المزوّدون.`)}{" "}
                {onOpenSettings && (
                  <button className="link-btn" onClick={onOpenSettings}>
                    {t("Open Settings", "افتح الإعدادات")}
                  </button>
                )}
              </span>
            </div>
          ) : (
            <>
              {models && models.length > 0 && (
                <Select
                  value={choice.model}
                  options={[
                    ...(picked || !choice.model ? [] : [{ value: choice.model, label: choice.model }]),
                    ...models.map((m) => ({ value: m.id, label: m.name === m.id ? m.id : `${m.name} (${m.id})`, hint: m.tools === false ? t("Chat only", "محادثة فقط") : undefined })),
                  ]}
                  onChange={(id) => choice.setModel(choice.provider, id)}
                  label={t("Model", "النموذج")}
                  className="provider-select"
                />
              )}
              {models && models.length === 0 && <p className="intel-note">{t("The server lists no models.", "لا يعرض الخادم أي نموذج.")}</p>}
              <input
                className="field provider-model-input"
                dir="ltr"
                spellCheck={false}
                aria-label={t("Model id", "معرّف النموذج")}
                placeholder={choice.provider === CODEX ? t("Codex default", "افتراضي Codex") : t("Model id, for example gpt-5", "معرّف النموذج، مثل gpt-5")}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onBlur={() => custom.trim() !== choice.model && choice.setModel(choice.provider, custom.trim())}
                onKeyDown={(e) => e.key === "Enter" && custom.trim() !== choice.model && choice.setModel(choice.provider, custom.trim())}
              />
            </>
          )}
          {error && <p className="intel-note bad-text">{error}</p>}
          {picked?.tools === false && (
            <p className="intel-note">{t("This model can chat but cannot read or change your pages.", "هذا النموذج يستطيع المحادثة لكنه لا يقرأ صفحاتك ولا يعدّلها.")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function providerNote(p: AiProvider, t: (en: string, ar: string) => string): string {
  const ar: Record<string, string> = {
    [CODEX]: "يشغّل Codex المثبّت لديك مع أدوات Worlds. سجّل الدخول بحساب ChatGPT لاستخدام اشتراكك.",
    anthropic: "نماذج Claude بمفتاح API من Claude Console.",
    litellm: "خادم LiteLLM الخاص بك. حدّد عنوانه.",
    custom: "أي خادم يدعم واجهة OpenAI للمحادثة.",
  };
  return t(p.note ?? "", ar[p.id] ?? p.note ?? "");
}

// ---------------------------------------------------------------------------
// Settings, Providers
// ---------------------------------------------------------------------------

export function ProviderSettings({ Group, Row }: { Group: GroupComponent; Row: RowComponent }) {
  const t = useT();
  const arabic = useArabic();
  const { list, error, update } = useProviders();
  if (error) return <div className="warn warn-error"><Icon name="error" size={14} /><span>{error}</span></div>;
  if (!list) return <Spinner />;
  const runners = list.filter((p) => p.kind === "runner");
  const clouds = list.filter((p) => p.kind === "cloud");
  const locals = list.filter((p) => p.kind === "local");
  return (
    // Fully translated, so the whole section reads right to left in Arabic.
    <div className="provider-settings" dir={arabic ? "rtl" : "ltr"}>
      <Group
        title={t("Sign in", "تسجيل الدخول")}
        note={t(
          "Each app signs in with its own official login in your browser. Worlds never sees or keeps those sign-ins.",
          "كل تطبيق يسجّل الدخول بطريقته الرسمية في متصفحك. لا يرى Worlds بيانات الدخول هذه ولا يحفظها.",
        )}
      >
        {runners.map((p) => (
          <RunnerRow key={p.id} provider={p} Row={Row} />
        ))}
      </Group>
      <LocalServers locals={locals} Group={Group} Row={Row} />
      <Group
        title={t("API keys", "مفاتيح API")}
        note={t(
          "Keys are kept in Windows Credential Manager and are never shown again. Claude subscription sign-in tokens are refused: use an API key from the Claude Console, or Claude Code.",
          "تُحفظ المفاتيح في مدير بيانات الاعتماد في Windows ولا تظهر مرة أخرى. رموز تسجيل دخول اشتراك Claude مرفوضة: استخدم مفتاح API من Claude Console، أو Claude Code.",
        )}
      >
        {clouds.map((p) => (
          <ApiProviderRow key={p.id} provider={p} onSaved={update} Row={Row} />
        ))}
      </Group>
      <Group title={t("Local model servers", "خوادم النماذج المحلية")}>
        {locals.map((p) => (
          <ApiProviderRow key={p.id} provider={p} onSaved={update} Row={Row} />
        ))}
      </Group>
    </div>
  );
}

/** Settings' grouped list and row, passed in so this file does not import the Settings view. */
type GroupComponent = (props: { title: string; note?: string; children: ReactNode }) => ReactElement;
type RowComponent = (props: { label: string; hint?: string; children: ReactNode }) => ReactElement;

function RunnerRow({ provider, Row }: { provider: AiProvider; Row: RowComponent }) {
  const t = useT();
  const codex = provider.id === CODEX;
  const [status, setStatus] = useState<AiRunnerStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [opened, setOpened] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await (codex ? api.aiCodexStatus() : api.aiClaudeAuthStatus()));
    } catch {
      setStatus({ installed: false, signedIn: false });
    } finally {
      setChecking(false);
    }
  }, [codex]);
  useEffect(() => {
    void check();
  }, [check]);
  const signIn = async () => {
    try {
      await (codex ? api.aiCodexLogin() : api.aiClaudeLogin());
      setOpened(true);
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    }
  };
  const hint = !status
    ? undefined
    : !status.installed
      ? codex
        ? t("Codex is not installed on this PC.", "Codex غير مثبّت على هذا الجهاز.")
        : t("Claude Code is not installed on this PC.", "Claude Code غير مثبّت على هذا الجهاز.")
      : opened && !status.signedIn
        ? t("Finish signing in in your browser, then check again.", "أكمل تسجيل الدخول في المتصفح، ثم تحقّق مرة أخرى.")
        : status.signedIn
          ? codex && status.method === "chatgpt"
            ? t("Signed in with ChatGPT.", "تم تسجيل الدخول بحساب ChatGPT.")
            : t("Signed in.", "تم تسجيل الدخول.")
          : t("Not signed in.", "لم يتم تسجيل الدخول.");
  return (
    <Row label={codex ? "Codex" : "Claude Code"} hint={hint}>
      <div className="provider-actions">
        {!status || checking ? (
          <Spinner size={14} />
        ) : status.signedIn ? (
          <span className="ok-text">
            <Icon name="success" size={14} />
            {t("Ready", "جاهز")}
          </span>
        ) : null}
        {status?.installed && (opened || status.signedIn) && (
          <Button variant="quiet" size="compact" icon="refresh" onClick={() => void check()}>
            {t("Check again", "تحقّق مرة أخرى")}
          </Button>
        )}
        {status?.installed && !status.signedIn && (
          <Button variant="tinted" size="compact" onClick={signIn}>
            {codex ? t("Sign in with ChatGPT", "تسجيل الدخول عبر ChatGPT") : t("Sign in to Claude", "تسجيل الدخول إلى Claude")}
          </Button>
        )}
      </div>
    </Row>
  );
}

function LocalServers({ locals, Group, Row }: { locals: AiProvider[]; Group: GroupComponent; Row: RowComponent }) {
  const t = useT();
  const [found, setFound] = useState<AiLocalServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const detect = useCallback(async () => {
    setBusy(true);
    try {
      const list = await api.aiLocalDetect();
      for (const s of list) if (s.running) modelCache.set(s.id, s.models);
      setFound(list);
    } catch (e) {
      useStore.getState().toast({ message: errorMessage(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void detect();
  }, [detect]);
  return (
    <Group
      title={t("Running on this PC", "يعمل على هذا الجهاز")}
      note={t("Ollama, LM Studio and llama.cpp run models on your own PC, with no key and no internet.", "Ollama وLM Studio وllama.cpp تشغّل النماذج على جهازك، بلا مفتاح وبلا إنترنت.")}
    >
      {locals.map((p) => {
        const s = found?.find((x) => x.id === p.id);
        const count = s?.models.length ?? 0;
        return (
          <Row
            key={p.id}
            label={p.name}
            hint={
              s?.running
                ? t(`${count} ${count === 1 ? "model" : "models"} at ${s.baseUrl}`, `${count} ${count === 1 ? "نموذج" : "نماذج"} على ${s.baseUrl}`)
                : s
                  ? t(`Not running at ${s.baseUrl}`, `لا يعمل على ${s.baseUrl}`)
                  : undefined
            }
          >
            {busy && !found ? (
              <Spinner size={14} />
            ) : s?.running ? (
              <span className="ok-text">
                <Icon name="success" size={14} />
                {t("Running", "يعمل")}
              </span>
            ) : (
              <span className="provider-muted">{t("Not found", "غير موجود")}</span>
            )}
          </Row>
        );
      })}
      <div className="set-row provider-detect">
        <Button variant="plain" size="compact" icon="refresh" loading={busy} onClick={() => void detect()}>
          {t("Detect again", "ابحث مرة أخرى")}
        </Button>
      </div>
    </Group>
  );
}

function ApiProviderRow({ provider, onSaved, Row }: { provider: AiProvider; onSaved: (p: AiProvider) => void; Row: RowComponent }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [base, setBase] = useState(provider.baseUrl);
  const [busy, setBusy] = useState<"key" | "base" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { models, loading, error: modelError, load } = useModels(provider);
  useEffect(() => setBase(provider.baseUrl), [provider.baseUrl]);
  const save = async (what: "key" | "base" | "remove") => {
    setBusy(what);
    setError(null);
    try {
      const next = await api.aiProviderSave(provider.id, what === "base" ? { baseUrl: base.trim() } : { apiKey: what === "remove" ? "" : key.trim() });
      onSaved(next);
      modelCache.delete(provider.id);
      if (what === "key") setKey("");
      useStore.getState().toast({
        message: what === "remove" ? t("Key removed", "تمت إزالة المفتاح") : what === "key" ? t("Key saved", "تم حفظ المفتاح") : t("Address saved", "تم حفظ العنوان"),
        tone: "success",
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const keyState =
    provider.key === "none"
      ? t("No key needed", "لا يحتاج مفتاحًا")
      : provider.hasKey
        ? t("Key saved", "المفتاح محفوظ")
        : provider.key === "required"
          ? t("No key yet", "لا يوجد مفتاح بعد")
          : t("Key optional", "المفتاح اختياري");
  return (
    <>
      <Row label={provider.name} hint={provider.baseUrl || t("No address set", "لم يُحدَّد عنوان")}>
        <div className="provider-actions">
          <span className={provider.hasKey ? "ok-text" : "provider-muted"}>
            {provider.hasKey && <Icon name="lock" size={13} />}
            {keyState}
          </span>
          <Button variant="quiet" size="compact" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t("Done", "تم") : t("Set up", "إعداد")}
          </Button>
        </div>
      </Row>
      {open && (
        <div className="set-row provider-edit">
          {provider.key !== "none" && (
            <div className="provider-line">
              <input
                className="field"
                dir="ltr"
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label={t(`${provider.name} API key`, `مفتاح ${provider.name}`)}
                placeholder={provider.hasKey ? t("A key is saved. Paste a new one to replace it", "يوجد مفتاح محفوظ. الصق مفتاحًا جديدًا لاستبداله") : t("Paste the API key", "الصق مفتاح API")}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && key.trim() && void save("key")}
              />
              <Button variant="tinted" size="compact" loading={busy === "key"} disabled={!key.trim()} onClick={() => void save("key")}>
                {t("Save key", "حفظ المفتاح")}
              </Button>
              {provider.hasKey && (
                <Button variant="quiet" size="compact" loading={busy === "remove"} onClick={() => void save("remove")}>
                  {t("Remove", "إزالة")}
                </Button>
              )}
            </div>
          )}
          {provider.editableBaseUrl && (
            <div className="provider-line">
              <input
                className="field"
                dir="ltr"
                spellCheck={false}
                aria-label={t("Server address", "عنوان الخادم")}
                placeholder={provider.defaultBaseUrl || "https://host/v1"}
                value={base}
                onChange={(e) => setBase(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && base.trim() !== provider.baseUrl && void save("base")}
              />
              <Button variant="plain" size="compact" loading={busy === "base"} disabled={base.trim() === provider.baseUrl} onClick={() => void save("base")}>
                {t("Save address", "حفظ العنوان")}
              </Button>
            </div>
          )}
          <div className="provider-line">
            <Button variant="plain" size="compact" icon="refresh" loading={loading} disabled={provider.key === "required" && !provider.hasKey} onClick={() => void load()}>
              {t("Load models", "تحميل النماذج")}
            </Button>
            {models && (
              <span className="provider-muted">
                {t(`${models.length} ${models.length === 1 ? "model" : "models"}`, `${models.length} ${models.length === 1 ? "نموذج" : "نماذج"}`)}
              </span>
            )}
          </div>
          {models && models.length > 0 && (
            <ul className="provider-models" dir="ltr">
              {models.slice(0, 60).map((m) => (
                <li key={m.id} className={m.tools === false ? "is-chat-only" : undefined} data-tip={m.tools === false ? t("Chat only", "محادثة فقط") : undefined}>
                  {m.id}
                </li>
              ))}
            </ul>
          )}
          {(error || modelError) && <div className="bad-text">{error ?? modelError}</div>}
        </div>
      )}
    </>
  );
}
