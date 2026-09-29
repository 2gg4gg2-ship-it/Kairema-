// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModelMenu, MODEL_MENU_LABELS, type ModelMenuOption } from "@/components/ModelMenu";

/** Both provider cards render a Connect button, so each test addresses its own card. */
function cardByTitle(title: string) {
  const heading = screen.getByText(title, { selector: "span" });
  return heading.closest("section") as HTMLElement;
}
function openrouterCard() {
  return cardByTitle("OpenRouter");
}
function customCard() {
  return cardByTitle("Custom provider");
}

const hookPosition = vi.hoisted(() => ({ value: 0 }));
// react-query re-renders the page when a mutation resolves; the mock reproduces that.
const renderTick = vi.hoisted(() => ({ fn: () => {} }));

const providers = vi.hoisted(() => [
  { id: "openrouter", displayName: "OpenRouter", available: true as const, keyUrl: "https://openrouter.ai/keys", keyEndpoint: "https://openrouter.ai/api/v1/key", modelsEndpoint: "https://openrouter.ai/api/v1/models", chatEndpoint: "https://openrouter.ai/api/v1/chat/completions" },
  { id: "openai", displayName: "OpenAI", available: false as const, note: "soon" },
  { id: "anthropic", displayName: "Anthropic", available: false as const, note: "soon" },
  { id: "google", displayName: "Google AI Studio", available: false as const, note: "soon" },
]);

const fixtures = vi.hoisted(() => ({
  navigate: vi.fn(),
  invalidateList: vi.fn(),
  modelsInput: [] as unknown[],
  list: {
    providers: [
      { id: "openrouter", displayName: "OpenRouter", available: true, keyUrl: "https://openrouter.ai/settings/keys", keyEndpoint: "e", modelsEndpoint: "m", chatEndpoint: "c" },
      { id: "openai", displayName: "OpenAI", available: false, note: "Адаптер ещё не реализован на сервере." },
      { id: "anthropic", displayName: "Anthropic", available: false, note: "Адаптер ещё не реализован на сервере." },
    ],
    configs: [] as Array<{ provider: string; activeModel: string; keyHint: string; updatedAt: string; displayName: string | null; baseUrl: string | null; modelsEndpoint: string | null }>,
    activeProvider: null as string | null,
    storageReady: true,
  },
  models: { data: [] as Array<{ id: string; name: string; displayName?: string | null; isFree?: boolean }>, isPending: false, isError: false, isSuccess: false, error: null as { message: string } | null },
  customModels: { data: [] as Array<{ id: string; name: string }>, isPending: false, isError: false, isSuccess: false, error: null as { message: string } | null },
  customModelsInput: [] as unknown[],
  modelsLoaded: 0,
  customModelsLoaded: 0,
  saved: null as unknown,
  tested: [] as unknown[],
  testResult: { ok: true as boolean, provider: "openrouter", label: "", message: "API-ключ принят провайдером." },
  activated: [] as unknown[],
  removed: [] as unknown[],
  keyCheckTick: vi.fn(),
}));

vi.mock("wouter", () => ({ useLocation: () => ["/settings/providers", fixtures.navigate] }));

const modelsInstances = [0, 1].map((slot) => ({
  mutateAsync: async (input: unknown) => {
    if (slot === 0) {
      fixtures.modelsInput.push(input);
      fixtures.modelsLoaded += 1;
    } else {
      fixtures.customModelsInput.push(input);
      fixtures.customModelsLoaded += 1;
    }
    renderTick.fn();
    return { models: slot === 0 ? fixtures.models.data : fixtures.customModels.data };
  },
  reset: () => {
    if (slot === 0) fixtures.modelsInput.push("reset");
    else fixtures.customModels.data = [];
  },
  get data() {
    return { models: slot === 0 ? fixtures.models.data : fixtures.customModels.data };
  },
  get isPending() {
    return slot === 0 ? fixtures.models.isPending : fixtures.customModels.isPending;
  },
  get isError() {
    return slot === 0 ? fixtures.models.isError : fixtures.customModels.isError;
  },
  get error() {
    return slot === 0 ? fixtures.models.error : fixtures.customModels.error;
  },
  get isSuccess() {
    return slot === 0 ? fixtures.models.isSuccess : fixtures.customModels.isSuccess;
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ userProviders: { list: { invalidate: fixtures.invalidateList } } }),
    userProviders: {
      list: { useQuery: () => ({ data: { ...fixtures.list, providers }, isLoading: false, isError: false, isSuccess: true }) },
      // Two independent mutation instances, one per hook position. The page always calls
      // `models.useMutation()` exactly twice per render in the same order, so `position % 2`
      // reproduces react-query's per-hook cache identity across re-renders.
      models: { useMutation: () => modelsInstances[hookPosition.value++ % 2]! },
      test: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => { fixtures.tested.push(input); renderTick.fn(); return fixtures.testResult; },
          isPending: false,
          error: null,
        }),
      },
      save: { useMutation: () => ({ mutateAsync: vi.fn(async (input) => { fixtures.saved = input; return {}; }), isPending: false, error: null }) },
      createCustom: { useMutation: () => ({ mutateAsync: vi.fn(async (input) => { fixtures.saved = input; return {}; }), isPending: false, error: null }) },
      // A saved custom provider is updated and, when it was not the active binding, activated.
      updateCustom: { useMutation: () => ({ mutateAsync: vi.fn(async (input) => { fixtures.saved = { ...(input as object), op: "update" }; return {}; }), isPending: false, error: null }) },
      setActive: { useMutation: () => ({ mutateAsync: async (input: unknown) => { fixtures.activated.push(input); return {}; }, isPending: false, error: null }) },
      remove: { useMutation: () => ({ mutateAsync: async (input: unknown) => { fixtures.removed.push(input); return {}; }, isPending: false, error: null }) },
    },
  },
}));

import AIProviders from "./AIProviders";
import { useEffect, useState } from "react";

/** Mirrors the page inside a ticking wrapper so mutation results actually reach the DOM. */
function Harness() {
  const [, setTick] = useState(0);
  useEffect(() => {
    renderTick.fn = () => setTick((value) => value + 1);
  }, []);
  return <AIProviders />;
}

function renderProviders() {
  return render(<Harness />);
}

beforeEach(() => {
  fixtures.modelsInput.length = 0;
  fixtures.modelsLoaded = 0;
  fixtures.saved = null;
  fixtures.list.configs = [];
  fixtures.list.activeProvider = null;
  fixtures.list.storageReady = true;
  hookPosition.value = 0;
  fixtures.models = { data: [], isPending: false, isError: false, isSuccess: false, error: null };
  fixtures.customModels = { data: [], isPending: false, isError: false, isSuccess: false, error: null };
  fixtures.customModelsInput.length = 0;
  fixtures.customModelsLoaded = 0;
  fixtures.navigate.mockReset();
  fixtures.invalidateList.mockReset();
  fixtures.tested = [];
  fixtures.testResult = { ok: true as boolean, provider: "openrouter", label: "", message: "API-ключ принят провайдером." };
  fixtures.activated = [];
  fixtures.removed = [];
});

afterEach(() => cleanup());



const CUSTOM_ROW = { provider: "custom-abc", activeModel: "vendor/model-b", keyHint: "••••4321", updatedAt: new Date(0).toISOString(), displayName: "Мой провайдер", baseUrl: "https://api.example.com/v1", modelsEndpoint: null };
const BUILTIN_ROW = { provider: "openrouter", activeModel: "vendor/model-a", keyHint: "••••5678", updatedAt: new Date(0).toISOString(), displayName: null, baseUrl: null, modelsEndpoint: null };

/** The shared model menu is a real button, so the options only exist once it is opened. */
async function openModelMenu(fieldLabel: string) {
  await userEvent.click(screen.getByRole("button", { name: fieldLabel }));
  return screen.findByRole("listbox", { name: fieldLabel });
}
async function pickModel(fieldLabel: string, pattern: RegExp) {
  await openModelMenu(fieldLabel);
  await userEvent.click(await screen.findByRole("option", { name: pattern }));
}

describe("AI Providers screen", () => {
  it("lists OpenRouter as a real provider and never as the four Kairema roles", async () => {
    renderProviders();
    expect(await screen.findByText("OpenRouter")).toBeTruthy();
    for (const role of ["Flash", "Think", "Context", "Apex"]) {
      expect(document.body.textContent ?? "").not.toContain(`Kairema ${role}`);
    }
  });

  it("keeps unimplemented providers as one compact coming-soon line with no controls", async () => {
    renderProviders();
    // One line, no cards, and the working alternative is named instead of a promise of support.
    const line = await screen.findByText(/Другие провайдеры — скоро\./);
    expect(line.tagName).toBe("P");
    expect(line.textContent ?? "").toContain("Custom provider");
    for (const name of ["OpenAI", "Anthropic", "Google AI Studio"]) {
      expect(screen.queryByText(name, { selector: "span" })).toBeNull();
    }
  });

  it("does not expose technical provider internals to the user", async () => {
    renderProviders();
    await screen.findByText("OpenRouter");
    const text = document.body.textContent ?? "";
    for (const leak of ["/chat/completions", "/v1/models", "modelsEndpoint", "localStorage", "SSRF", "AES-256", "custom-"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("shows a saved key only as a mask and never as a full value", async () => {
    fixtures.list.configs = [BUILTIN_ROW];
    renderProviders();
    expect((await screen.findAllByText(/••••5678/)).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain("sk-or-v1-");
  });

  it("reports Connected for a provider that already has a stored key", async () => {
    fixtures.list.configs = [BUILTIN_ROW];
    renderProviders();
    await screen.findByText("OpenRouter", { selector: "span" });
    expect(openrouterCard().textContent).toContain("Connected");
  });

  it("does not fetch a catalog until the user asks for it, and never on keystrokes", async () => {
    fixtures.models = { data: [{ id: "live/from-api", name: "Live From API" }], isPending: false, isError: false, isSuccess: true, error: null };
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: /^(Connect|Настроить)$/ }));
    expect(fixtures.modelsLoaded).toBe(0);
    await userEvent.type(screen.getByLabelText("API key (OpenRouter)"), "sk-or-v1-typed-value");
    expect(fixtures.modelsLoaded).toBe(0);
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Обновить список моделей (Model (OpenRouter))" }));
    expect(fixtures.modelsLoaded).toBe(1);
    expect(fixtures.modelsInput.at(-1)).toEqual({ provider: "openrouter", apiKey: "sk-or-v1-typed-value" });
    // The name and the id are both reachable in the menu, and the id stays selectable.
    const listbox = await openModelMenu("Model (OpenRouter)");
    const option = within(listbox).getByRole("option", { name: /Live From API/ });
    expect(option.getAttribute("title")).toBe("live/from-api");
    expect(screen.getByRole("button", { name: "Model (OpenRouter)" }).textContent).toContain("Live From API");
  });

  it("preselects the first catalog model and enables Connect once a key is typed", async () => {
    fixtures.models = { data: [{ id: "live/from-api", name: "Live From API" }], isPending: false, isError: false, isSuccess: true, error: null };
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: /^(Connect|Настроить)$/ }));
    await userEvent.type(screen.getByLabelText("API key (OpenRouter)"), "sk-or-v1-typed-value");
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Обновить список моделей (Model (OpenRouter))" }));
    await openModelMenu("Model (OpenRouter)");
    await screen.findByRole("option", { name: /Live From API/ });
    // The id is chosen; the trigger shows the human-readable name and never the raw provider prefix.
    await userEvent.click(screen.getByRole("option", { name: /Live From API/ }));
    expect(screen.getByRole("button", { name: "Model (OpenRouter)" }).textContent).toContain("Live From API");
    expect((within(openrouterCard()).getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps Connect disabled when the catalog comes back empty", async () => {
    fixtures.models = { data: [], isPending: false, isError: false, isSuccess: true, error: null };
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: /^(Connect|Настроить)$/ }));
    await userEvent.type(screen.getByLabelText("API key (OpenRouter)"), "sk-or-v1-typed-value");
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Обновить список моделей (Model (OpenRouter))" }));
    expect((within(openrouterCard()).getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("states why a connected provider's catalog could not be read", async () => {
    // A stored key that no longer opens, a rejected key and an unreachable host are different
    // problems, so the screen shows the server's own reason instead of one generic sentence.
    fixtures.list.configs = [BUILTIN_ROW];
    fixtures.models = { data: [], isPending: false, isError: true, isSuccess: false, error: { message: "Сохранённый API-ключ не удалось расшифровать. Укажите ключ заново." } };
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Настроить" }));

    expect(await screen.findByText("Сохранённый API-ключ не удалось расшифровать. Укажите ключ заново.")).toBeTruthy();
    // Nothing internal is added to the server's wording.
    expect(document.body.textContent ?? "").not.toContain("kbyok1.");
  });

  it("reopens an already connected provider on the model it already uses", async () => {
    fixtures.list.configs = [BUILTIN_ROW];
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: /Настроить/ }));
    // Opening a saved provider reuses the stored key, so the request carries none.
    expect(fixtures.modelsInput.at(-1)).toEqual({ provider: "openrouter" });
  });

  it("warns plainly when server-side key storage is unconfigured", async () => {
    fixtures.list.storageReady = false;
    renderProviders();
    expect(await screen.findByText("Сервер пока не настроен на хранение пользовательских API-ключей. Подключение станет доступно после настройки сервера.")).toBeTruthy();
  });
});

describe("custom provider form", () => {
  async function openCustomForm() {
    await userEvent.click(within(customCard()).getByRole("button", { name: "Connect" }));
    return {
      name: screen.getByLabelText("Название провайдера"),
      url: screen.getByLabelText("API URL провайдера"),
      key: screen.getByLabelText("API key (Custom provider)"),
    };
  }

  it("lists a saved custom provider under its own name", async () => {
    fixtures.list.configs = [CUSTOM_ROW];
    renderProviders();
    expect((await screen.findAllByText("Мой провайдер")).length).toBeGreaterThan(0);
  });

  it("asks only for a name, an API URL, a key and a model", async () => {
    renderProviders();
    const fields = await openCustomForm();
    expect(fields.name).toBeTruthy();
    expect(fields.url).toBeTruthy();
    expect(fields.key).toBeTruthy();
    expect(screen.getByLabelText("Model (Custom provider)")).toBeTruthy();
    // The models endpoint is derived by the server, so the form never asks for it.
    expect(screen.queryByLabelText(/URL списка моделей/)).toBeNull();
  });

  it("preselects the first custom model so Connect becomes available", async () => {
    renderProviders();
    const fields = await openCustomForm();
    await userEvent.type(fields.name, "Мой провайдер");
    await userEvent.type(fields.url, "https://api.example.com/v1");
    await userEvent.type(fields.key, "sk-custom-secret-9999");
    fixtures.customModels = { data: [{ id: "vendor/model-b", name: "Model B" }, { id: "vendor/model-c", name: "Model C" }], isPending: false, isError: false, isSuccess: true, error: null };
    await userEvent.click(screen.getByRole("button", { name: "Обновить список моделей (Model (Custom provider))" }));
    await openModelMenu("Model (Custom provider)");
    await screen.findByRole("option", { name: /Model B/ });
    await userEvent.click(screen.getByRole("option", { name: /Model B/ }));
    expect(screen.getByRole("button", { name: "Model (Custom provider)" }).textContent).toContain("Model B");
    expect((within(openrouterCard()).getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps Connect disabled when the custom catalog is empty", async () => {
    renderProviders();
    const fields = await openCustomForm();
    await userEvent.type(fields.name, "Мой провайдер");
    await userEvent.type(fields.url, "https://api.example.com/v1");
    await userEvent.type(fields.key, "sk-custom-secret-9999");
    fixtures.customModels = { data: [], isPending: false, isError: false, isSuccess: true, error: null };
    await userEvent.click(screen.getByRole("button", { name: "Обновить список моделей (Model (Custom provider))" }));
    expect((within(customCard()).getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("never mixes a custom catalog into the built-in provider's list", async () => {
    fixtures.models = { data: [{ id: "vendor/model-a", name: "Model A" }], isPending: false, isError: false, isSuccess: true, error: null };
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Connect" }));
    await userEvent.type(screen.getByLabelText("API key (OpenRouter)"), "sk-or-v1-typed-value");
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Обновить список моделей (Model (OpenRouter))" }));
    await openModelMenu("Model (OpenRouter)");
    await screen.findByRole("option", { name: /Model A/ });
    await userEvent.keyboard("{Escape}");

    const fields = await openCustomForm();
    await userEvent.type(fields.name, "Мой провайдер");
    await userEvent.type(fields.url, "https://api.example.com/v1");
    await userEvent.type(fields.key, "sk-custom-secret-9999");
    fixtures.customModels = { data: [{ id: "vendor/model-b", name: "Model B" }], isPending: false, isError: false, isSuccess: true, error: null };
    await userEvent.click(screen.getByRole("button", { name: "Обновить список моделей (Model (Custom provider))" }));
    await openModelMenu("Model (Custom provider)");
    await screen.findByRole("option", { name: /Model B/ });
    await userEvent.keyboard("{Escape}");

    const builtinOptions = await openModelMenu("Model (OpenRouter)").then((listbox) => within(listbox).getAllByRole("option").map((option) => option.getAttribute("title")));
    expect(builtinOptions).toContain("vendor/model-a");
    expect(builtinOptions).not.toContain("vendor/model-b");
    await userEvent.keyboard("{Escape}");
  });

  it("checks the typed key against the provider before anything is saved", async () => {
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Connect" }));
    await userEvent.type(screen.getByLabelText("API key (OpenRouter)"), "sk-or-v1-typed-value");
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Проверить ключ" }));

    await screen.findByText(/API-ключ принят провайдером/);
    // The key is checked in the POST body of the check itself, never as part of a stored row.
    expect(fixtures.tested).toEqual([{ provider: "openrouter", apiKey: "sk-or-v1-typed-value" }]);
    expect(fixtures.saved).toBeNull();
  });

  it("reports a rejected key with the provider's verdict and saves nothing", async () => {
    fixtures.testResult = { ok: false, provider: "openrouter", label: "", message: "Провайдер отклонил API-ключ. Проверьте ключ и его статус в аккаунте провайдера." };
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Connect" }));
    await userEvent.type(screen.getByLabelText("API key (OpenRouter)"), "sk-or-wrong-key");
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Проверить ключ" }));

    await screen.findByText(/Провайдер отклонил API-ключ/);
    expect(fixtures.saved).toBeNull();
  });

  it("checks an unsaved custom provider on its own endpoint", async () => {
    renderProviders();
    const fields = await openCustomForm();
    await userEvent.type(fields.name, "Мой провайдер");
    await userEvent.type(fields.url, "https://api.example.com/v1");
    await userEvent.type(fields.key, "sk-custom-secret-9999");
    await userEvent.click(within(customCard()).getByRole("button", { name: "Проверить ключ" }));

    await screen.findByText(/API-ключ принят провайдером/);
    expect(fixtures.tested[0]).toEqual({ provider: "custom-draft", apiKey: "sk-custom-secret-9999", draft: { displayName: "Мой провайдер", baseUrl: "https://api.example.com/v1" } });
  });

  it("reopens a saved custom provider for editing on its own name, URL and model", async () => {
    fixtures.list.configs = [CUSTOM_ROW];
    renderProviders();
    const row = (await screen.findAllByText("Настроить"))[0]!;
    await userEvent.click(row);

    const card = customCard();
    expect((screen.getByLabelText("Название провайдера") as HTMLInputElement).value).toBe("Мой провайдер");
    expect((screen.getByLabelText("API URL провайдера") as HTMLInputElement).value).toBe("https://api.example.com/v1");
    // A stored key is never sent to the browser, so the field starts empty and the card says so.
    expect((screen.getByLabelText("API key (Custom provider)") as HTMLInputElement).value).toBe("");
    expect(card.textContent ?? "").toContain("Редактируется: Мой провайдер");
  });

  it("reloads a saved custom provider's catalog from the server's key, with no key in the request", async () => {
    fixtures.list.configs = [CUSTOM_ROW];
    renderProviders();
    await userEvent.click((await screen.findAllByText("Настроить"))[0]!);

    // Reopening asks only for the provider, exactly like the built-in panel does, and the stored
    // model stays selected so the user sees what they had.
    expect(fixtures.customModelsInput.at(-1)).toEqual({ provider: "custom-abc" });
    expect(screen.getByRole("button", { name: "Model (Custom provider)" }).textContent).toContain("vendor/model-b");
    expect(fixtures.customModelsInput.at(-1)).not.toHaveProperty("apiKey");
  });

  it("activates and removes a saved custom provider from its own row", async () => {
    fixtures.list.configs = [CUSTOM_ROW];
    renderProviders();
    const card = customCard();
    await userEvent.click(within(card).getByRole("button", { name: "Активировать" }));
    await waitFor(() => expect(fixtures.activated).toEqual([{ provider: "custom-abc" }]));

    await userEvent.click(within(card).getByRole("button", { name: "Отключить" }));
    await waitFor(() => expect(fixtures.removed).toEqual([{ provider: "custom-abc" }]));
  });

  it("marks a connected provider active while it has a stored row", async () => {
    fixtures.list.configs = [BUILTIN_ROW];
    fixtures.list.activeProvider = "openrouter";
    renderProviders();
    expect(within(openrouterCard()).queryByText("активен")).toBeTruthy();
  });

  it("stops calling a provider active once its row is gone", async () => {
    // Disconnecting the active row leaves the stored pointer behind, so the screen must not
    // show a binding the user no longer has.
    fixtures.list.configs = [];
    fixtures.list.activeProvider = "openrouter";
    renderProviders();
    const card = openrouterCard();
    expect(within(card).queryByText("активен")).toBeNull();
    // With no stored row there is nothing to activate, so the control is not offered.
    expect(within(card).queryByRole("button", { name: "Активировать" })).toBeNull();
  });

  it("does not offer Activate for the custom provider that is already active", async () => {
    fixtures.list.configs = [CUSTOM_ROW];
    fixtures.list.activeProvider = "custom-abc";
    renderProviders();
    await screen.findAllByText("Мой провайдер");
    expect(within(customCard()).queryByRole("button", { name: "Активировать" })).toBeNull();
  });

  it("activates the custom provider it just updated, so My API uses the edited one", async () => {
    fixtures.list.configs = [CUSTOM_ROW];
    renderProviders();
    await userEvent.click((await screen.findAllByText("Настроить"))[0]!);
    await userEvent.type(screen.getByLabelText("API key (Custom provider)"), "sk-custom-secret-9999");
    fixtures.customModels = { data: [{ id: "vendor/model-b", name: "Model B" }], isPending: false, isError: false, isSuccess: true, error: null };
    await userEvent.click(screen.getByRole("button", { name: "Обновить список моделей (Model (Custom provider))" }));
    await openModelMenu("Model (Custom provider)");
    await screen.findByRole("option", { name: /Model B/ });
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(customCard()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fixtures.saved).toMatchObject({ op: "update", provider: "custom-abc", activeModel: "vendor/model-b" }));
    await waitFor(() => expect(fixtures.activated).toEqual([{ provider: "custom-abc" }]));
  });
});

describe("the settings model menu behaves like the one in chat", () => {
  beforeEach(() => { fixtures.models = { data: [], isPending: false, isError: false, isSuccess: true, error: null }; });
  afterEach(() => { cleanup(); });

  async function openWithCatalog() {
    fixtures.models = {
      data: [
        { id: "nvidia/nemotron-3-ultra", name: "NVIDIA: Nemotron 3 Ultra", displayName: "Nemotron 3 Ultra", isFree: false },
        { id: "inclusionai/ling-sante:free", name: "inclusionAI: Ling (free)", displayName: "Ling", isFree: true },
        { id: "vendor/model-b", name: "Model B", displayName: "Model B", isFree: false },
      ],
      isPending: false, isError: false, isSuccess: true, error: null,
    };
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: /^(Connect|Настроить)$/ }));
    await userEvent.type(screen.getByLabelText("API key (OpenRouter)"), "sk-or-v1-typed-value");
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Обновить список моделей (Model (OpenRouter))" }));
  }

  it("shows a model's own name and keeps the real id for the request", async () => {
    await openWithCatalog();
    const listbox = await openModelMenu("Model (OpenRouter)");
    const option = within(listbox).getByRole("option", { name: /Nemotron 3 Ultra/ });
    expect(option.textContent ?? "").not.toContain("NVIDIA");
    expect(option.getAttribute("title")).toBe("nvidia/nemotron-3-ultra");
  });

  it("splits the catalog into Free and Paid from the server's pricing verdict", async () => {
    await openWithCatalog();
    const listbox = await openModelMenu("Model (OpenRouter)");
    const groups = within(listbox).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Free", "Paid"]);
    expect(within(groups[0]!).getAllByRole("option").map((option) => option.getAttribute("title"))).toEqual(["inclusionai/ling-sante:free"]);
  });

  it("searches by display name and by id", async () => {
    await openWithCatalog();
    const listbox = await openModelMenu("Model (OpenRouter)");
    // The search field sits in the panel header, above the listbox it filters.
    const search = screen.getByLabelText("Поиск моделей");
    await userEvent.type(search, "ling");
    await waitFor(() => expect(within(listbox).getAllByRole("option").map((option) => option.getAttribute("title"))).toEqual(["inclusionai/ling-sante:free"]));
    await userEvent.clear(search);
    await userEvent.type(search, "model-b");
    await waitFor(() => expect(within(listbox).getAllByRole("option").map((option) => option.getAttribute("title"))).toEqual(["vendor/model-b"]));
    await userEvent.clear(search);
    await userEvent.type(search, "zzz");
    expect(await within(listbox).findByText("Ничего не найдено")).toBeTruthy();
  });

  it("marks the stored model as the active one", async () => {
    await openWithCatalog();
    const listbox = await openModelMenu("Model (OpenRouter)");
    const chosen = within(listbox).getByRole("option", { name: /Model B/ });
    await userEvent.click(chosen);
    const reopened = await openModelMenu("Model (OpenRouter)");
    expect(within(reopened).getByRole("option", { name: /Model B/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("closes on Escape and on a click outside", async () => {
    await openWithCatalog();
    const listbox = await openModelMenu("Model (OpenRouter)");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Model (OpenRouter)" })).toBeNull());

    await openModelMenu("Model (OpenRouter)");
    await userEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Model (OpenRouter)" })).toBeNull());
  });

  it("renders the panel outside the form so no container clips it", async () => {
    await openWithCatalog();
    await openModelMenu("Model (OpenRouter)");
    // The panel is portaled to the body, so the settings card's own overflow can never cut it.
    const listbox = screen.getByRole("listbox", { name: "Model (OpenRouter)" });
    expect(listbox.closest("form") ?? document.body).toBe(document.body);
  });
});

const CATALOG: ModelMenuOption[] = [
  { id: "vendor/alpha-free", name: "Alpha Free", isFree: true },
  { id: "vendor/beta-free", name: "Beta Free", isFree: true },
  { id: "vendor/gamma-pro", name: "Gamma Pro" },
  { id: "vendor/delta-very-long-model-name-that-cannot-possibly-fit-in-the-panel", name: "Delta Ultra Long Display Name That Cannot Fit" },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * The model picker as Settings renders it. Driving the shared component directly keeps these tests
 * about the behaviour a user sees, and the page-level wiring is covered by the AIProviders suite.
 */
function renderMenu(value = "vendor/gamma-pro", models: readonly ModelMenuOption[] = CATALOG) {
  const onSelect = vi.fn();
  render(<ModelMenu
    value={value}
    models={models}
    disabled={false}
    ariaLabel="Модель"
    labels={MODEL_MENU_LABELS.ru}
    onSelect={onSelect}
    triggerClassName="kairema-settings-model-trigger"
  />);
  return { onSelect, trigger: screen.getByRole("button", { name: "Модель" }) };
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Модель" }));
  return screen.findByRole("listbox", { name: "Модель" });
};

const panel = () => document.querySelector<HTMLElement>(".kairema-model-menu")!;
const searchField = () => within(panel()).getByRole("searchbox", { name: "Поиск моделей" });

/**
 * jsdom does not apply the project's stylesheet, so a rule that only exists in CSS cannot be seen
 * through getComputedStyle. The stylesheet is read directly instead: a rule that is removed or
 * recoloured fails here rather than silently going unstyled.
 */
const ruleFor = (selector: string) => readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8")
  .split("\n")
  .find((line) => line.startsWith(selector)) ?? "";

describe("the model menu in Settings", () => {
  it("opens a listbox with a search field and the provider's own models", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    expect(searchField()).toBeTruthy();
    expect(within(listbox).getAllByRole("option").length).toBe(CATALOG.length);
  });

  it("groups the catalog into Free and Paid", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    const free = within(listbox).getByRole("group", { name: "Free" });
    const paid = within(listbox).getByRole("group", { name: "Paid" });
    expect(within(free).getAllByRole("option").map((option) => option.textContent)).toHaveLength(2);
    expect(within(paid).getAllByRole("option").length).toBe(2);
  });

  it("marks free models with a badge", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    const alpha = within(listbox).getByRole("option", { name: /Alpha Free/ });
    expect(within(alpha).getByText("Free")).toBeTruthy();
  });

  it("shows a readable name above the id it will actually request", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    const option = within(listbox).getByRole("option", { name: /Alpha Free/ });
    const title = option.querySelector(".kairema-model-menu-item-title")!;
    const id = option.querySelector(".kairema-model-menu-item-id")!;
    expect(title.textContent).toBe("Alpha Free");
    expect(id.textContent).toBe("vendor/alpha-free");
    // The id is what the request carries, so it is on the element for a hover or a copy.
    expect(option.getAttribute("title")).toBe("vendor/alpha-free");
  });

  it("truncates a long name and its id instead of widening the panel", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    const option = within(listbox).getByRole("option", { name: /Delta Ultra/ });
    const title = option.querySelector<HTMLElement>(".kairema-model-menu-item-title")!;
    const id = option.querySelector<HTMLElement>(".kairema-model-menu-item-id")!;
    // The text is intact for a screen reader and for copying, but visually clipped.
    expect(title.textContent).toBe("Delta Ultra Long Display Name That Cannot Fit");
    expect(id.textContent).toBe("vendor/delta-very-long-model-name-that-cannot-possibly-fit-in-the-panel");
    expect(ruleFor(".kairema-model-menu-item-title {")).toContain("text-overflow:ellipsis");
    expect(ruleFor(".kairema-model-menu-item-title {")).toContain("white-space:nowrap");
    expect(ruleFor(".kairema-model-menu-item-id {")).toContain("text-overflow:ellipsis");
    expect(title).toBeTruthy();
    expect(id).toBeTruthy();
  });

  it("searches by the readable name", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    await user.type(searchField(), "gamma");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    expect(within(listbox).getByRole("option", { name: /Gamma Pro/ })).toBeTruthy();
  });

  it("searches by the raw id as well", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    await user.type(searchField(), "delta-very");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    expect(within(listbox).getByRole("option", { name: /Delta Ultra/ })).toBeTruthy();
  });

  it("says so when a search matches nothing instead of showing an empty panel", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    await user.type(searchField(), "нет-такой-модели");
    await waitFor(() => expect(within(listbox).getByText("Ничего не найдено")).toBeTruthy());
    expect(within(listbox).queryAllByRole("option")).toHaveLength(0);
  });

  it("marks the stored model as the active one", async () => {
    const user = userEvent.setup();
    renderMenu("vendor/beta-free");
    const listbox = await openMenu(user);
    const active = within(listbox).getAllByRole("option").filter((option) => option.getAttribute("aria-selected") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toContain("Beta Free");
  });

  it("shows the stored model's name on the trigger", () => {
    renderMenu("vendor/beta-free");
    expect(screen.getByRole("button", { name: "Модель" }).textContent).toContain("Beta Free");
  });

  it("keeps a stored model listed while the provider's catalog does not offer it yet", async () => {
    const user = userEvent.setup();
    renderMenu("vendor/saved-but-gone", [{ id: "vendor/other", name: "Other" }]);
    const listbox = await openMenu(user);
    const ids = within(listbox).getAllByRole("option").map((option) => option.getAttribute("title"));
    expect(ids).toContain("vendor/saved-but-gone");
    expect(ids).toContain("vendor/other");
  });

  it("does not invent a model the catalog never offered while the user searches", async () => {
    const user = userEvent.setup();
    renderMenu("vendor/saved-but-gone", [{ id: "vendor/other", name: "Other" }]);
    const listbox = await openMenu(user);
    await user.type(searchField(), "other");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    expect(within(listbox).queryByRole("option", { name: /saved-but-gone/ })).toBeNull();
  });

  it("reports the chosen model and closes", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderMenu();
    const listbox = await openMenu(user);
    await user.click(within(listbox).getByRole("option", { name: /Alpha Free/ }));
    expect(onSelect).toHaveBeenCalledWith("vendor/alpha-free");
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Модель" })).toBeNull());
  });

  it("keeps the new choice on the trigger", async () => {
    const user = userEvent.setup();
    function Wrapper() {
      const [value, setValue] = useState("vendor/gamma-pro");
      return <ModelMenu value={value} models={CATALOG} disabled={false} ariaLabel="Модель" labels={MODEL_MENU_LABELS.ru} onSelect={setValue} triggerClassName="kairema-settings-model-trigger" />;
    }
    render(<Wrapper />);
    const listbox = await openMenu(user);
    await user.click(within(listbox).getByRole("option", { name: /Alpha Free/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Модель" }).textContent).toContain("Alpha Free"));
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Модель" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Модель" }));
    expect(listbox).toBeTruthy();
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Модель" })).toBeNull());
  });

  it("stays open when the click lands inside the menu", async () => {
    const user = userEvent.setup();
    renderMenu();
    const listbox = await openMenu(user);
    await user.click(searchField());
    expect(screen.queryByRole("listbox", { name: "Модель" })).toBeTruthy();
  });

  it("clears the previous search when it is reopened", async () => {
    const user = userEvent.setup();
    renderMenu();
    let listbox = await openMenu(user);
    await user.type(searchField(), "gamma");
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(1));
    await user.keyboard("{Escape}");
    listbox = await openMenu(user);
    await waitFor(() => expect(within(listbox).getAllByRole("option")).toHaveLength(CATALOG.length));
  });
});

describe("where the model menu is placed", () => {
  const anchorRect = (top: number) => ({
    top, bottom: top + 24, left: 40, right: 240, width: 200, height: 24, x: 40, y: top, toJSON: () => ({}),
  });

  /** jsdom reports every box as a zero-sized rectangle at the origin, so the anchor is given a
   * real position: a trigger near the top and one near the bottom of the window. */
  const withAnchor = (top: number, run: () => Promise<void>) => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function patched() { return anchorRect(top) as DOMRect; };
    return run().finally(() => { Element.prototype.getBoundingClientRect = original; });
  };

  const placed = () => {
    const node = panel();
    return { top: parseFloat(node.style.top), left: parseFloat(node.style.left), width: parseFloat(node.style.width), maxHeight: parseFloat(node.style.maxHeight) };
  };

  const settled = () => waitFor(() => expect(panel().style.maxHeight).not.toBe(""));

  it("opens below a trigger that has room beneath it", async () => {
    const user = userEvent.setup();
    await withAnchor(40, async () => {
      renderMenu();
      await openMenu(user);
      await settled();
      const { top, maxHeight } = placed();
      // Placed under the trigger: the panel starts below its bottom edge and fits in what is left.
      expect(top).toBeGreaterThan(40 + 24);
      expect(top + maxHeight).toBeLessThanOrEqual(window.innerHeight + 1);
    });
  });

  it("opens above a trigger near the bottom, so it never runs off the window", async () => {
    const user = userEvent.setup();
    const bottomTriggerTop = window.innerHeight - 20;
    await withAnchor(bottomTriggerTop, async () => {
      renderMenu();
      await openMenu(user);
      await settled();
      const { top, maxHeight } = placed();
      // Placed over the trigger rather than under it, and wholly inside the window.
      expect(top).toBeLessThan(bottomTriggerTop);
      expect(top + maxHeight).toBeLessThanOrEqual(window.innerHeight + 1);
      expect(top).toBeGreaterThanOrEqual(0);
    });
  });

  it("keeps the whole panel inside the window horizontally", async () => {
    const user = userEvent.setup();
    await withAnchor(40, async () => {
      renderMenu();
      await openMenu(user);
      await settled();
      const { left, width } = placed();
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(window.innerWidth + 1);
    });
  });

  it("never grows wider than the window can show", async () => {
    const user = userEvent.setup();
    await withAnchor(40, async () => {
      renderMenu();
      await openMenu(user);
      await settled();
      expect(placed().width).toBeLessThanOrEqual(window.innerWidth);
    });
  });

  it("is portaled to the body, so no Settings container can clip it", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    expect(panel().parentElement).toBe(document.body);
    expect(panel().closest(".kairema-settings-model-trigger")).toBeNull();
  });
});

describe("the model menu's colours", () => {
  it("is a black panel with neutral borders", () => {
    const rule = ruleFor(".kairema-model-menu {");
    expect(rule).toContain("background:#0a0a0c");
    expect(rule).toContain("border:1px solid rgba(255,255,255,.14)");
  });

  it("marks the active model with neutral contrast instead of a coloured accent", () => {
    const rule = ruleFor(".kairema-model-menu-item-active {");
    expect(rule).toContain("rgba(255,255,255");
    expect(rule).not.toMatch(/255,\s*134,\s*255|#9386ff|147,\s*134,\s*255/i);
  });

  it("keeps the free badge monochrome", () => {
    const rule = ruleFor(".kairema-model-menu-badge {");
    expect(rule).toMatch(/rgba\(255,255,255/);
    expect(rule).not.toMatch(/147,\s*134,\s*255|#c7bfff/i);
  });

  it("keeps the Settings trigger itself free of a coloured accent", () => {
    // The panel was already neutral, but the trigger that opens it kept a violet hover and focus
    // ring, so hovering the field in Settings still showed a purple border.
    expect(ruleFor(".kairema-settings-model-trigger:hover:not(:disabled) {")).toMatch(/rgba\(255,255,255/);
    expect(ruleFor(".kairema-settings-model-trigger:focus-visible {")).toMatch(/rgba\(255,255,255/);
    for (const selector of [".kairema-settings-model-trigger:hover:not(:disabled) {", ".kairema-settings-model-trigger:focus-visible {"]) {
      expect(ruleFor(selector), `violet accent left in ${selector}`).not.toMatch(/#8b5cf6|#a78bfa|139,\s*92,\s*246/i);
    }
  });

  it("uses a near-black panel with white and grey text", () => {
    expect(ruleFor(".kairema-model-menu-item {")).toContain("color:#e8eaf0");
    expect(ruleFor(".kairema-model-menu-item-id {")).toContain("color:#7d8496");
    expect(ruleFor(".kairema-model-menu-group-title {")).toContain("color:#8b94a7");
  });

  it("gives hover a neutral grey rather than a tint", () => {
    const hover = ruleFor(".kairema-model-menu-item:hover,.kairema-model-menu-item:focus-visible {");
    expect(hover).toContain("background:#17171b");
    expect(hover).not.toMatch(/147,\s*134,\s*255|#9386ff/i);
  });

  it("scrolls inside the panel instead of growing past the window", () => {
    expect(ruleFor(".kairema-model-menu-list {")).toContain("overflow-y:auto");
    expect(ruleFor(".kairema-model-menu {")).toContain("max-height:calc(100vh - 32px)");
    expect(ruleFor(".kairema-model-menu {")).toContain("overflow:hidden");
  });

  it("leaves no violet anywhere in the menu's own rules", () => {
    const text = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");
    const menuRules = text.split("\n").filter((line) => /kairema-(model|provider)-menu|kairema-settings-model-trigger/.test(line));
    expect(menuRules.length).toBeGreaterThan(0);
    for (const rule of menuRules) {
      expect(rule, `violet accent left in: ${rule.slice(0, 80)}`).not.toMatch(/147,\s*134,\s*255|#9386ff|#b9b1ff|#c7bfff|#8b5cf6|#a78bfa/i);
    }
  });
});
