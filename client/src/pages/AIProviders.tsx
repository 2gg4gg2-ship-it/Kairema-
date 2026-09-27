import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Plug, Plus, Power, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

type ProviderView =
  | { id: string; displayName: string; available: true; keyUrl: string; keyEndpoint: string; modelsEndpoint: string; chatEndpoint: string }
  | { id: string; displayName: string; available: false; keyUrl?: string; note: string };

type SavedConfig = { provider: string; activeModel: string; keyHint: string; updatedAt: string; displayName: string | null; baseUrl: string | null; modelsEndpoint: string | null };

/** Server-issued ids for user-defined providers; built-in ids never carry this prefix. */
const CUSTOM_PROVIDER_PREFIX = "custom-";
/** Placeholder id for a provider that has not been stored yet, so a draft can be probed. */
const CUSTOM_DRAFT_PROVIDER = "custom-draft";

function isCustomProvider(providerId: string) {
  return providerId.startsWith(CUSTOM_PROVIDER_PREFIX);
}

/** The not-yet-stored values a user is typing into the custom provider form. */
type CustomDraft = { provider: string | null; displayName: string; baseUrl: string; apiKey: string; modelId: string };

function emptyCustomDraft(): CustomDraft {
  return { provider: null, displayName: "", baseUrl: "", apiKey: "", modelId: "" };
}

/** Only server-defined text is shown for a failure; nothing from a provider response is rendered. */
function errorText(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    const message = (error as { message: string }).message;
    if (message) return message;
  }
  return fallback;
}

function savedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

/** One compact provider block: title, connection state, and the form only while it is open. */
function ProviderCard({ title, subtitle, connected, active, expanded, busy, disabled, onToggle, onMakeActive, onDisconnect, hasConfig, addLabel, summary, children }: {
  title: string;
  subtitle: string;
  connected: boolean;
  active: boolean;
  expanded: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  onMakeActive?: () => void;
  onDisconnect?: () => void;
  hasConfig?: boolean;
  addLabel?: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-100">{title}</span>
            {active && <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-semibold text-violet-200">активен</span>}
          </div>
          <p className="truncate text-xs text-slate-500">{connected ? `Connected · ${subtitle}` : subtitle}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40"
            onClick={onToggle}
            disabled={busy}
            aria-expanded={expanded}
          >
            {expanded ? "Свернуть" : addLabel ?? (hasConfig ? "Настроить" : "Connect")}
          </button>
          {onMakeActive && !active && (
            <button type="button" className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40" onClick={onMakeActive} disabled={busy}>
              Активировать
            </button>
          )}
          {onDisconnect && (
            <button type="button" className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-rose-200 transition-colors hover:bg-rose-500/15 disabled:opacity-40" onClick={onDisconnect} disabled={busy}>
              Отключить
            </button>
          )}
        </span>
      </div>
      {!expanded && summary && <div className="border-t border-slate-800 px-3 py-2">{summary}</div>}
      {expanded && !disabled && <div className="border-t border-slate-800 px-3 py-3">{children}</div>}
    </section>
  );
}

/** Password-style key input with a reveal toggle; the value never leaves this component. */
function KeyField({ label, fieldLabel, value, visible, onVisibleChange, onChange, placeholder }: { label: string; fieldLabel: string; value: string; visible: boolean; onVisibleChange: (value: boolean) => void; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3">
        <KeyRound className="size-4 shrink-0 text-slate-500" />
        <input
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-100 outline-none"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-label={fieldLabel}
        />
        <button type="button" className="shrink-0 text-slate-500 hover:text-slate-200" onClick={() => onVisibleChange(!visible)} aria-label={visible ? "Скрыть ключ" : "Показать ключ"}>
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </span>
    </label>
  );
}

/**
 * Model picker fed only by the provider's live catalog.
 *
 * A refresh button sits next to the select because the catalog depends on the key: it cannot be
 * fetched up front, and re-typing a key must not re-send it on every keystroke.
 */
function ModelField({ label, fieldLabel, value, models, pending, error, empty, onChange, onReload, canReload, placeholder }: { label: string; fieldLabel: string; value: string; models: Array<{ id: string; name: string }>; pending: boolean; error: boolean; empty: boolean; onChange: (value: string) => void; onReload: () => void; canReload: boolean; placeholder: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="flex items-center gap-2">
        <select
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={pending}
          aria-label={fieldLabel}
        >
          {pending && <option value="">Загружаем модели…</option>}
          {!pending && !models.length && <option value="">{placeholder}</option>}
          {models.map((model) => (
            <option key={model.id} value={model.id}>{model.name} · {model.id}</option>
          ))}
        </select>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-slate-700 p-2 text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40"
          onClick={onReload}
          disabled={pending || !canReload}
          aria-label={`Обновить список моделей (${fieldLabel})`}
          title="Обновить список моделей"
        >
          <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
        </button>
      </span>
      {error && <span className="text-xs text-rose-300">Не удалось загрузить модели. Проверьте ключ и адрес.</span>}
      {empty && <span className="text-xs text-slate-500">Провайдер не вернул список моделей для этого ключа.</span>}
    </label>
  );
}

export default function AIProviders() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [modelId, setModelId] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [customDraft, setCustomDraft] = useState<CustomDraft | null>(null);

  const listQuery = trpc.userProviders.list.useQuery(undefined, { staleTime: 30_000 });
  const providers = (listQuery.data?.providers ?? []) as ProviderView[];
  const configs = (listQuery.data?.configs ?? []) as SavedConfig[];
  const activeProvider = listQuery.data?.activeProvider ?? null;
  const storageReady = listQuery.data?.storageReady ?? false;
  // A custom provider is not part of the built-in catalog, so its rows are listed separately.
  const customConfigs = configs.filter((config) => isCustomProvider(config.provider));
  const activeConfig = configs.find((config) => config.provider === activeProvider) ?? null;
  const activeName = activeConfig?.displayName || providers.find((provider) => provider.id === activeProvider)?.displayName || activeProvider;

  const openrouter = providers.find((provider) => provider.id === "openrouter" && provider.available) ?? null;
  const openrouterConfig = configs.find((config) => config.provider === "openrouter") ?? null;
  const unavailable = providers.filter((provider) => !provider.available);
  const selected = providers.find((provider) => provider.id === editingProvider) ?? null;
  const selectedConfig = configs.find((config) => config.provider === editingProvider) ?? null;


  // The catalog is fetched explicitly, never as a declarative query: a query would carry the
  // typed key in the GET query string, and an automatic fetch would re-send it on every
  // keystroke. A typed key is forwarded in the POST body and never stored client-side; when no
  // key is typed the server falls back to the caller's own saved key and no key is sent at all.
  // Two catalogs, two mutations: a built-in provider's list and a custom provider's list are
  // fetched from different endpoints, so one shared cache could show the wrong provider's models
  // next to the other provider's key and could preselect a model the provider does not serve.
  const modelsMutation = trpc.userProviders.models.useMutation();
  const customModelsMutation = trpc.userProviders.models.useMutation();
  const saveMutation = trpc.userProviders.save.useMutation();
  const createCustomMutation = trpc.userProviders.createCustom.useMutation();
  const updateCustomMutation = trpc.userProviders.updateCustom.useMutation();
  const setActiveMutation = trpc.userProviders.setActive.useMutation();
  const removeMutation = trpc.userProviders.remove.useMutation();
  const busy = modelsMutation.isPending || customModelsMutation.isPending || saveMutation.isPending || createCustomMutation.isPending || updateCustomMutation.isPending || setActiveMutation.isPending || removeMutation.isPending;
  const models = modelsMutation.data?.models ?? [];
  const customModels = customModelsMutation.data?.models ?? [];
  const customReady = Boolean(customDraft && customDraft.displayName.trim() && customDraft.baseUrl.trim() && customDraft.apiKey.trim().length >= 8);
  // Saving needs a model the provider actually returned, so an empty catalog leaves it disabled.
  const customCanSave = customReady && customModels.some((model) => model.id === customDraft!.modelId) && storageReady;
  // A model id is only acceptable when the provider's live catalog returned it, so a stale or
  // invented selection can never be persisted and an empty catalog keeps Save disabled.
  const canSubmit = Boolean(selected?.available && apiKey.trim().length >= 8 && models.some((model) => model.id === modelId) && storageReady);

  // Switching provider resets the whole form so one provider's models or result can never be
  // shown next to another provider's key.
  useEffect(() => {
    setApiKey("");
    setKeyVisible(false);
    // An already connected provider reopens on the model it already uses; a new one starts empty
    // so the first model the catalog returns is preselected.
    setModelId(selectedConfig?.activeModel ?? "");
    setNotice(null);
    modelsMutation.reset();
    // Opening a provider that already has a saved key loads its catalog from the server's own
    // copy, so this request carries no key at all.
    if (editingProvider && selectedConfig) void modelsMutation.mutateAsync({ provider: editingProvider }).catch(() => undefined);
  }, [editingProvider]);

  useEffect(() => {
    if (!modelId && modelsMutation.data?.models.length) setModelId(modelsMutation.data.models[0]!.id);
  }, [modelsMutation.data, modelId]);

  const openPanel = (providerId: string) => setEditingProvider((current) => (current === providerId ? null : providerId));

  /** Loads the live catalog for the provider currently being edited. */
  const loadModels = async () => {
    if (!selected?.available || !editingProvider) return;
    if (apiKey.trim().length < 8 && !selectedConfig) return;
    try {
      await modelsMutation.mutateAsync({ provider: editingProvider, ...(apiKey.trim().length >= 8 ? { apiKey: apiKey.trim() } : {}) });
    } catch {
      // The panel already renders the classified error from the mutation state.
    }
  };

  const runSave = async () => {
    if (!selected?.available || !canSubmit) return;
    setNotice(null);
    try {
      await saveMutation.mutateAsync({ provider: selected.id, apiKey: apiKey.trim(), activeModel: modelId, makeActive: true });
      // The key is dropped from component state as soon as the server has it; the page then
      // shows only the masked suffix it received back.
      setApiKey("");
      setKeyVisible(false);
      await utils.userProviders.list.invalidate();
      setNotice({ tone: "ok", text: "Провайдер сохранён и назначен активным для режима «Мой API»." });
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error, "Не удалось сохранить провайдера.") });
    }
  };

  const makeActive = async (providerId: string) => {
    setNotice(null);
    try {
      await setActiveMutation.mutateAsync({ provider: providerId });
      await utils.userProviders.list.invalidate();
      setNotice({ tone: "ok", text: "Провайдер назначен активным." });
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error, "Не удалось назначить провайдера активным.") });
    }
  };

  const disconnect = async (providerId: string) => {
    setNotice(null);
    try {
      await removeMutation.mutateAsync({ provider: providerId });
      await utils.userProviders.list.invalidate();
      if (editingProvider === providerId) setEditingProvider(null);
      if (customDraft?.provider === providerId) setCustomDraft(null);
      setNotice({ tone: "ok", text: "Провайдер отключён, сохранённый ключ удалён." });
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error, "Не удалось отключить провайдера.") });
    }
  };

  /** Opens the custom form, prefilled from a saved row or empty for a new provider. */
  const openCustomDraft = (config?: SavedConfig) => {
    setNotice(null);
    // Only the custom catalog is dropped: the built-in panel keeps its own, separately loaded list.
    customModelsMutation.reset();
    setCustomDraft(
      config
        ? { provider: config.provider, displayName: config.displayName ?? "", baseUrl: config.baseUrl ?? "", apiKey: "", modelId: config.activeModel }
        : emptyCustomDraft(),
    );
  };

  const patchCustomDraft = (patch: Partial<CustomDraft>) => setCustomDraft((current) => (current ? { ...current, ...patch } : current));

  /**
   * Selects the first model the provider actually returned.
   *
   * Without this the select would display the first option while React state stayed empty, so the
   * save button could never enable: the browser reports no change when the already-shown option is
   * re-picked. Writing the id into the draft removes that mismatch entirely.
   */
  useEffect(() => {
    const first = customModelsMutation.data?.models[0]?.id;
    if (!first) return;
    setCustomDraft((current) => (current && !current.modelId ? { ...current, modelId: first } : current));
  }, [customModelsMutation.data]);

  /**
   * Probes a not-yet-saved provider. The typed key is required because there is no stored copy
   * yet, and it travels in the POST body as a draft, never in the URL.
   */
  const loadCustomModels = async () => {
    if (!customDraft || !customReady) return;
    try {
      await customModelsMutation.mutateAsync({
        provider: customDraft.provider ?? CUSTOM_DRAFT_PROVIDER,
        apiKey: customDraft.apiKey.trim(),
        draft: { displayName: customDraft.displayName.trim(), baseUrl: customDraft.baseUrl.trim() },
      });
    } catch {
      // The form renders the classified error from the mutation state.
    }
  };

  const runCustomSave = async () => {
    if (!customDraft || !customCanSave) return;
    setNotice(null);
    const payload = { displayName: customDraft.displayName.trim(), baseUrl: customDraft.baseUrl.trim(), apiKey: customDraft.apiKey.trim(), activeModel: customDraft.modelId };
    try {
      if (customDraft.provider && customDraft.provider !== CUSTOM_DRAFT_PROVIDER) {
        await updateCustomMutation.mutateAsync({ provider: customDraft.provider, ...payload });
      } else {
        await createCustomMutation.mutateAsync({ ...payload, makeActive: true });
      }
      // The key leaves component state as soon as the server holds it; only the masked hint remains.
      setCustomDraft(null);
      customModelsMutation.reset();
      await utils.userProviders.list.invalidate();
      setNotice({ tone: "ok", text: "Провайдер сохранён и назначен активным для режима «Мой API»." });
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error, "Не удалось сохранить провайдера.") });
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <header className="mb-4">
          <button className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800" onClick={() => navigate("/")}>
            <ArrowLeft className="size-4" />К чату
          </button>
          <h1 className="text-xl font-semibold">AI Providers</h1>
          <p className="mt-1 text-sm text-slate-400">Подключите свой API-ключ и используйте выбранную модель в режиме «Мой API».</p>
        </header>

        {!storageReady && (
          <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200" role="status">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>Сервер пока не настроен на хранение пользовательских API-ключей. Подключение станет доступно после настройки сервера.</span>
          </p>
        )}

        {notice && (
          <p className={`mb-3 flex items-start gap-2 rounded-xl border p-3 text-sm ${notice.tone === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`} role="status">
            {notice.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
            <span>{notice.text}</span>
          </p>
        )}

        {openrouter && (
          <ProviderCard
            title="OpenRouter"
            subtitle="Модели OpenRouter"
            connected={Boolean(openrouterConfig)}
            active={activeProvider === "openrouter"}
            expanded={editingProvider === "openrouter"}
            busy={busy}
            disabled={!storageReady}
            onToggle={() => openPanel("openrouter")}
            onMakeActive={() => void makeActive("openrouter")}
            onDisconnect={() => void disconnect("openrouter")}
            hasConfig={Boolean(openrouterConfig)}
            summary={openrouterConfig ? <p className="truncate text-xs text-slate-500">ключ {openrouterConfig.keyHint} · {openrouterConfig.activeModel}</p> : null}
          >
            <div className="grid gap-3">
              <KeyField
                label="API key"
                fieldLabel="API key (OpenRouter)"
                value={apiKey}
                visible={keyVisible}
                onVisibleChange={setKeyVisible}
                onChange={setApiKey}
                placeholder={openrouterConfig ? `Сохранённый ключ ${openrouterConfig.keyHint} — введите, чтобы заменить` : "Вставьте API-ключ OpenRouter"}
              />
              <ModelField
                label="Model"
                fieldLabel="Model (OpenRouter)"
                value={modelId}
                models={models}
                pending={modelsMutation.isPending}
                error={modelsMutation.isError}
                empty={modelsMutation.isSuccess && !models.length}
                onChange={setModelId}
                onReload={() => void loadModels()}
                canReload={apiKey.trim().length >= 8 || Boolean(openrouterConfig)}
                placeholder="Сначала укажите API-ключ"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                  onClick={() => void runSave()}
                  disabled={busy || !canSubmit}
                >
                  {openrouterConfig ? "Save" : "Connect"}
                </button>
                {openrouterConfig?.keyHint && <span className="text-xs text-slate-500">ключ {openrouterConfig.keyHint}</span>}
              </div>
            </div>
          </ProviderCard>
        )}

        <div className="mt-3">
          <ProviderCard
            title="Custom provider"
            subtitle="Любой OpenAI-совместимый API"
            connected={customConfigs.length > 0}
            active={Boolean(activeProvider && isCustomProvider(activeProvider))}
            expanded={customDraft !== null}
            busy={busy}
            disabled={!storageReady}
            onToggle={() => (customDraft ? setCustomDraft(null) : openCustomDraft())}
            addLabel="Connect"
            summary={customConfigs.length > 0 ? (
              <ul className="grid gap-1.5">
                {customConfigs.map((config) => (
                  <li key={config.provider} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{config.displayName || "Мой провайдер"}</span>
                    <span className="shrink-0 truncate text-xs text-slate-500">{config.activeModel}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          >
            {customDraft && (
              <div className="grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
                  <input
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
                    value={customDraft.displayName}
                    onChange={(event) => patchCustomDraft({ displayName: event.target.value })}
                    placeholder="My Provider"
                    maxLength={64}
                    aria-label="Название провайдера"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">API URL</span>
                  <input
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
                    value={customDraft.baseUrl}
                    onChange={(event) => patchCustomDraft({ baseUrl: event.target.value })}
                    placeholder="https://api.example.com/v1"
                    inputMode="url"
                    spellCheck={false}
                    aria-label="API URL провайдера"
                  />
                </label>

                <KeyField
                  label="API key"
                  fieldLabel="API key (Custom provider)"
                  value={customDraft.apiKey}
                  visible={keyVisible}
                  onVisibleChange={setKeyVisible}
                  onChange={(value) => patchCustomDraft({ apiKey: value })}
                  placeholder={customDraft.provider ? "Введите, чтобы заменить сохранённый ключ" : "Вставьте API-ключ провайдера"}
                />

                <ModelField
                  label="Model"
                  fieldLabel="Model (Custom provider)"
                  value={customDraft.modelId}
                  models={customModels}
                  pending={customModelsMutation.isPending}
                  error={customModelsMutation.isError}
                  empty={customModelsMutation.isSuccess && !customModels.length}
                  onChange={(value) => patchCustomDraft({ modelId: value })}
                  onReload={() => void loadCustomModels()}
                  canReload={customReady}
                  placeholder="Сначала укажите URL и API-ключ"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
                    onClick={() => void runCustomSave()}
                    disabled={busy || !customCanSave}
                  >
                    {customDraft.provider ? "Save" : "Connect"}
                  </button>
                </div>
              </div>
            )}
          </ProviderCard>
        </div>

        {unavailable.length > 0 && (
          <p className="mt-3 text-center text-xs text-slate-500">Другие провайдеры — скоро.</p>
        )}
      </div>
    </main>
  );
}
