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
type CustomDraft = { provider: string | null; displayName: string; baseUrl: string; modelsEndpoint: string; apiKey: string; modelId: string };

function emptyCustomDraft(): CustomDraft {
  return { provider: null, displayName: "", baseUrl: "", modelsEndpoint: "", apiKey: "", modelId: "" };
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

export default function AIProviders() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [modelId, setModelId] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
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

  const selected = providers.find((provider) => provider.id === editingProvider) ?? null;
  const selectedConfig = configs.find((config) => config.provider === editingProvider) ?? null;
  const canSubmit = Boolean(selected?.available && apiKey.trim().length >= 8 && modelId.trim().length > 0);

  // The catalog is fetched explicitly, never as a declarative query: a query would carry the
  // typed key in the GET query string, and an automatic fetch would re-send it on every
  // keystroke. A typed key is forwarded in the POST body and never stored client-side; when no
  // key is typed the server falls back to the caller's own saved key and no key is sent at all.
  // Two catalogs, two mutations: a built-in provider's list and a custom provider's list are
  // fetched from different endpoints, so one shared cache could show the wrong provider's models
  // next to the other provider's key and could preselect a model the provider does not serve.
  const modelsMutation = trpc.userProviders.models.useMutation();
  const customModelsMutation = trpc.userProviders.models.useMutation();
  const testMutation = trpc.userProviders.test.useMutation();
  const saveMutation = trpc.userProviders.save.useMutation();
  const createCustomMutation = trpc.userProviders.createCustom.useMutation();
  const updateCustomMutation = trpc.userProviders.updateCustom.useMutation();
  const setActiveMutation = trpc.userProviders.setActive.useMutation();
  const removeMutation = trpc.userProviders.remove.useMutation();
  const busy = modelsMutation.isPending || customModelsMutation.isPending || testMutation.isPending || saveMutation.isPending || createCustomMutation.isPending || updateCustomMutation.isPending || setActiveMutation.isPending || removeMutation.isPending;
  const models = modelsMutation.data?.models ?? [];
  const customModels = customModelsMutation.data?.models ?? [];
  const customReady = Boolean(customDraft && customDraft.displayName.trim() && customDraft.baseUrl.trim() && customDraft.apiKey.trim().length >= 8);
  // Saving needs a model the provider actually returned, so an empty catalog leaves it disabled.
  const customCanSave = customReady && customModels.some((model) => model.id === customDraft!.modelId) && storageReady;

  // Switching provider resets the whole form so one provider's models or result can never be
  // shown next to another provider's key.
  useEffect(() => {
    setApiKey("");
    setKeyVisible(false);
    setModelId("");
    setTestResult(null);
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

  const runTest = async () => {
    if (!selected?.available) return;
    setNotice(null);
    setTestResult(null);
    try {
      const result = await testMutation.mutateAsync({ provider: selected.id, ...(apiKey.trim().length >= 8 ? { apiKey: apiKey.trim() } : {}) });
      setTestResult({ ok: result.ok, text: result.message });
    } catch (error) {
      setTestResult({ ok: false, text: errorText(error, "Не удалось проверить подключение.") });
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
    setTestResult(null);
    // Only the custom catalog is dropped: the built-in panel keeps its own, separately loaded list.
    customModelsMutation.reset();
    setCustomDraft(
      config
        ? { provider: config.provider, displayName: config.displayName ?? "", baseUrl: config.baseUrl ?? "", modelsEndpoint: config.modelsEndpoint ?? "", apiKey: "", modelId: config.activeModel }
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
        draft: { displayName: customDraft.displayName.trim(), baseUrl: customDraft.baseUrl.trim(), ...(customDraft.modelsEndpoint.trim() ? { modelsEndpoint: customDraft.modelsEndpoint.trim() } : {}) },
      });
    } catch {
      // The form renders the classified error from the mutation state.
    }
  };

  const runCustomTest = async () => {
    if (!customDraft || !customReady) return;
    setNotice(null);
    setTestResult(null);
    try {
      // A stored provider is probed with its own saved key, so the form need not ask for it again.
      const stored = customDraft.provider && customDraft.provider !== CUSTOM_DRAFT_PROVIDER ? customDraft.provider : CUSTOM_DRAFT_PROVIDER;
      const result = await testMutation.mutateAsync({
        provider: stored,
        ...(customDraft.apiKey.trim().length >= 8 ? { apiKey: customDraft.apiKey.trim() } : {}),
        draft: { displayName: customDraft.displayName.trim(), baseUrl: customDraft.baseUrl.trim(), ...(customDraft.modelsEndpoint.trim() ? { modelsEndpoint: customDraft.modelsEndpoint.trim() } : {}) },
      });
      setTestResult({ ok: result.ok, text: result.message });
    } catch (error) {
      setTestResult({ ok: false, text: errorText(error, "Не удалось проверить подключение.") });
    }
  };

  const runCustomSave = async () => {
    if (!customDraft || !customCanSave) return;
    setNotice(null);
    const payload = { displayName: customDraft.displayName.trim(), baseUrl: customDraft.baseUrl.trim(), ...(customDraft.modelsEndpoint.trim() ? { modelsEndpoint: customDraft.modelsEndpoint.trim() } : {}), apiKey: customDraft.apiKey.trim(), activeModel: customDraft.modelId };
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
      <div className="mx-auto max-w-4xl">
        <header className="mb-5">
          <button className="mb-4 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800" onClick={() => navigate("/")}>
            <ArrowLeft className="size-4" />К чату
          </button>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-violet-300">Настройки</p>
          <h1 className="mt-1 text-2xl font-semibold">AI Providers</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Режим «Мой API» отправляет запросы напрямую выбранному вами провайдеру по выбранной вами модели и оплачивается вашим ключом. Обычный режим «Чат» продолжает использовать провайдеры Kairema.
          </p>
        </header>

        {!storageReady && (
          <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>Сервер пока не настроен на хранение пользовательских API-ключей. Сохранение и проверка подключения будут недоступны до исправления конфигурации.</span>
          </p>
        )}

        {notice && (
          <p className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${notice.tone === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`}>
            {notice.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
            <span>{notice.text}</span>
          </p>
        )}

        <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4" aria-label="Текущий провайдер">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Текущий провайдер</h2>
          <p className="mt-2 text-sm text-slate-200">
            {activeProvider ? activeName : "Не выбран"}
          </p>
          {activeProvider && (
            <p className="mt-1 break-all text-xs text-slate-500">
              Модель: {activeConfig?.activeModel ?? "—"}
            </p>
          )}
        </section>

        <section className="mb-4" aria-label="Мои провайдеры">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Мои провайдеры</h2>
          </div>
          <ul className="grid gap-2">
            {providers.map((provider) => {
              const config = configs.find((item) => item.provider === provider.id) ?? null;
              const isActive = activeProvider === provider.id;
              const expanded = editingProvider === provider.id;
              return (
                <li key={provider.id} className="rounded-2xl border border-slate-800 bg-slate-900/60">
                  <div className="flex flex-wrap items-center gap-2 p-3">
                    <span className="text-sm font-medium text-slate-100">{provider.displayName}</span>
                    {isActive && <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-semibold text-violet-200">активен</span>}
                    {!provider.available && <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[11px] text-slate-300">скоро</span>}
                    {config && <span className="text-xs text-slate-500">модель {config.activeModel} · ключ {config.keyHint}</span>}
                    <span className="ml-auto flex items-center gap-2">
                      {provider.available && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40"
                          onClick={() => openPanel(provider.id)}
                          disabled={busy}
                          aria-expanded={expanded}
                        >
                          {expanded ? <XCircle className="size-3.5" /> : <Plus className="size-3.5" />}
                          {expanded ? "Свернуть" : config ? "Настроить" : "Добавить"}
                        </button>
                      )}
                      {config && !isActive && (
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40" onClick={() => void makeActive(provider.id)} disabled={busy}>
                          <Power className="size-3.5" />Сделать активным
                        </button>
                      )}
                      {config && (
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-rose-200 transition-colors hover:bg-rose-500/15 disabled:opacity-40" onClick={() => void disconnect(provider.id)} disabled={busy}>
                          Отключить
                        </button>
                      )}
                    </span>
                  </div>

                  {!provider.available && (
                    <p className="border-t border-slate-800 px-3 py-2 text-xs text-slate-500">{provider.note}</p>
                  )}

                  {expanded && selected?.available && (
                    <div className="grid gap-3 border-t border-slate-800 p-3">
                      <label className="grid gap-1 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Провайдер ИИ</span>
                        <span className="text-sm text-slate-200">{selected.displayName}</span>
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Модель</span>
                        <select
                          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
                          value={modelId}
                          onChange={(event) => setModelId(event.target.value)}
                          disabled={modelsMutation.isPending}
                          aria-label={`Активная модель (${selected.displayName})`}
                        >
                          {modelsMutation.isPending && <option value="">Загружаем модели…</option>}
                          {!modelsMutation.isPending && !models.length && <option value="">Сначала укажите API-ключ</option>}
                          {models.map((model) => (
                            <option key={model.id} value={model.id}>{model.name} · {model.id}</option>
                          ))}
                        </select>
                        {modelsMutation.isError && <span className="text-xs text-rose-300">Каталог моделей сейчас недоступен. Проверьте подключение и повторите.</span>}
                        {modelsMutation.isSuccess && !models.length && <span className="text-xs text-slate-500">Провайдер не вернул список моделей для этого ключа.</span>}
                        <button type="button" className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40" onClick={() => void loadModels()} disabled={modelsMutation.isPending || (!apiKey.trim() && !selectedConfig)}>
                          <RefreshCw className="size-3.5" aria-hidden="true" />Загрузить модели
                        </button>
                      </label>

                      <label className="grid gap-1 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Авторизация</span>
                        <div className="flex items-center gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3">
                            <KeyRound className="size-4 shrink-0 text-slate-500" />
                            <input
                              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-100 outline-none"
                              type={keyVisible ? "text" : "password"}
                              value={apiKey}
                              onChange={(event) => setApiKey(event.target.value)}
                              placeholder={selectedConfig ? `Сохранённый ключ ${selectedConfig.keyHint} — введите, чтобы заменить` : "Вставьте API-ключ провайдера"}
                              autoComplete="off"
                              spellCheck={false}
                              aria-label={`API-ключ (${selected.displayName})`}
                            />
                            <button type="button" className="shrink-0 text-slate-500 hover:text-slate-200" onClick={() => setKeyVisible((value) => !value)} aria-label={keyVisible ? "Скрыть ключ" : "Показать ключ"}>
                              {keyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </button>
                          </div>
                        </div>
                        {selectedConfig && <span className="text-xs text-slate-500">Сохранённый ключ: {selectedConfig.keyHint} · обновлён {savedAt(selectedConfig.updatedAt)}</span>}
                        <span className="text-xs text-slate-500">Ключ хранится только в зашифрованном виде и не показывается снова после сохранения. Он не попадает в localStorage.</span>
                        {selected.keyUrl && <a className="text-xs text-violet-300 underline" href={selected.keyUrl} target="_blank" rel="noreferrer noopener">Где взять ключ провайдера</a>}
                      </label>

                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40" onClick={() => void runTest()} disabled={busy || (!apiKey.trim() && !selectedConfig)}>
                          <Plug className="size-4" />Проверить подключение
                        </button>
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40" onClick={() => void runSave()} disabled={busy || !canSubmit || !storageReady}>
                          Сохранить
                        </button>
                      </div>

                      {testResult && (
                        <p className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${testResult.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`}>
                          {testResult.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
                          <span>{testResult.text}</span>
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mb-4" aria-label="Свой провайдер">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Свой провайдер</h2>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40"
              onClick={() => openCustomDraft()}
              disabled={busy}
              aria-expanded={customDraft !== null}
            >
              {customDraft ? <XCircle className="size-3.5" /> : <Plus className="size-3.5" />}
              {customDraft ? "Свернуть форму" : "Подключить свой провайдер"}
            </button>
          </div>

          {customConfigs.length > 0 && (
            <ul className="mb-2 grid gap-2">
              {customConfigs.map((config) => {
                const isActive = activeProvider === config.provider;
                const expanded = customDraft?.provider === config.provider;
                return (
                  <li key={config.provider} className="rounded-2xl border border-slate-800 bg-slate-900/60">
                    <div className="flex flex-wrap items-center gap-2 p-3">
                      <span className="text-sm font-medium text-slate-100">{config.displayName || "Мой провайдер"}</span>
                      {isActive && <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-semibold text-violet-200">активен</span>}
                      <span className="text-xs text-slate-500">модель {config.activeModel} · ключ {config.keyHint}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40" onClick={() => (expanded ? setCustomDraft(null) : openCustomDraft(config))} disabled={busy} aria-expanded={expanded}>
                          {expanded ? <XCircle className="size-3.5" /> : <Plug className="size-3.5" />}
                          {expanded ? "Свернуть" : "Настроить"}
                        </button>
                        {!isActive && (
                          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40" onClick={() => void makeActive(config.provider)} disabled={busy}>
                            <Power className="size-3.5" />Сделать активным
                          </button>
                        )}
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-rose-200 transition-colors hover:bg-rose-500/15 disabled:opacity-40" onClick={() => void disconnect(config.provider)} disabled={busy}>
                          Отключить
                        </button>
                      </span>
                    </div>
                    {config.baseUrl && <p className="border-t border-slate-800 px-3 py-2 text-xs break-all text-slate-500">{config.baseUrl}</p>}
                  </li>
                );
              })}
            </ul>
          )}

          {customDraft && (
            <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3" aria-label="Форма своего провайдера">
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Название</span>
                <input
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
                  value={customDraft.displayName}
                  onChange={(event) => patchCustomDraft({ displayName: event.target.value })}
                  placeholder="Например, Мой провайдер"
                  maxLength={64}
                  aria-label="Название своего провайдера"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Базовый URL</span>
                <input
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
                  value={customDraft.baseUrl}
                  onChange={(event) => patchCustomDraft({ baseUrl: event.target.value })}
                  placeholder="https://api.example.com/v1"
                  inputMode="url"
                  spellCheck={false}
                  aria-label="Базовый URL провайдера"
                />
                <span className="text-xs text-slate-500">Только https на стандартном порту 443. Путь /v1 добавляется автоматически, к /chat/completions и /models.</span>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">URL списка моделей</span>
                <input
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
                  value={customDraft.modelsEndpoint}
                  onChange={(event) => patchCustomDraft({ modelsEndpoint: event.target.value })}
                  placeholder="Необязательно — https://api.example.com/v1/models"
                  inputMode="url"
                  spellCheck={false}
                  aria-label="URL списка моделей"
                />
                <span className="text-xs text-slate-500">Оставьте пустым, если каталог моделей лежит по стандартному пути /v1/models.</span>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Авторизация</span>
                <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3">
                  <KeyRound className="size-4 shrink-0 text-slate-500" />
                  <input
                    className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-100 outline-none"
                    type={keyVisible ? "text" : "password"}
                    value={customDraft.apiKey}
                    onChange={(event) => patchCustomDraft({ apiKey: event.target.value })}
                    placeholder="Вставьте API-ключ провайдера"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="API-ключ (свой провайдер)"
                  />
                  <button type="button" className="shrink-0 text-slate-500 hover:text-slate-200" onClick={() => setKeyVisible((value) => !value)} aria-label={keyVisible ? "Скрыть ключ" : "Показать ключ"}>
                    {keyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <span className="text-xs text-slate-500">Ключ шифруется на сервере и не показывается снова после сохранения. Он не попадает в localStorage.</span>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Модель</span>
                <select
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-400"
                  value={customDraft.modelId}
                  onChange={(event) => patchCustomDraft({ modelId: event.target.value })}
                  disabled={customModelsMutation.isPending}
                  aria-label="Активная модель (свой провайдер)"
                >
                  {customModelsMutation.isPending && <option value="">Загружаем модели…</option>}
                  {!customModelsMutation.isPending && !customModels.length && <option value="">Сначала укажите URL и API-ключ</option>}
                  {customModels.map((model) => (
                    <option key={model.id} value={model.id}>{model.name} · {model.id}</option>
                  ))}
                </select>
                {customModelsMutation.isError && <span className="text-xs text-rose-300">Каталог моделей сейчас недоступен. Проверьте URL и ключ.</span>}
                {customModelsMutation.isSuccess && !customModels.length && <span className="text-xs text-slate-500">Провайдер не вернул список моделей для этого ключа.</span>}
                <button type="button" className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40" onClick={() => void loadCustomModels()} disabled={busy || !customReady}>
                  <RefreshCw className="size-3.5" aria-hidden="true" />Загрузить модели
                </button>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-40" onClick={() => void runCustomTest()} disabled={busy || !customDraft.baseUrl.trim()}>
                  <Plug className="size-4" />Проверить подключение
                </button>
                <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-40" onClick={() => void runCustomSave()} disabled={busy || !customCanSave}>
                  Сохранить
                </button>
              </div>

              {testResult && (
                <p className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${testResult.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`}>
                  {testResult.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
                  <span>{testResult.text}</span>
                </p>
              )}
            </div>
          )}

          <p className="mt-2 flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>Свой провайдер доступен только в режиме «Мой API». Поиск по интернету, работа с вложениями и память на основе документов в этом режиме не используются.</span>
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4" aria-label="Как это работает">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Как это работает</h2>
          <ul className="mt-2 grid gap-1 text-xs text-slate-400">
            <li>Список моделей загружается с API провайдера, а не из фиксированного набора.</li>
            <li>Проверка подключения обращается к провайдеру без запроса к модели, поэтому не тратит токены.</li>
            <li>Ключ шифруется на сервере; в интерфейс возвращается только последние четыре символа.</li>
            <li>Сервер видит ключ в момент запроса к провайдеру: иначе отправить запрос от вашего имени невозможно.</li>
            <li>Если провайдер недоступен, Kairema не переключается на свои провайдеры — вы увидите ошибку.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
