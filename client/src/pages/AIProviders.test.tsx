// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  models: { data: [] as Array<{ id: string; name: string }>, isPending: false, isError: false, isSuccess: false, error: null as { message: string } | null },
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
    expect((await screen.findByText(/Live From API/)).textContent).toContain("live/from-api");
  });

  it("preselects the first catalog model and enables Connect once a key is typed", async () => {
    fixtures.models = { data: [{ id: "live/from-api", name: "Live From API" }], isPending: false, isError: false, isSuccess: true, error: null };
    renderProviders();
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: /^(Connect|Настроить)$/ }));
    await userEvent.type(screen.getByLabelText("API key (OpenRouter)"), "sk-or-v1-typed-value");
    await userEvent.click(within(openrouterCard()).getByRole("button", { name: "Обновить список моделей (Model (OpenRouter))" }));
    const select = screen.getByLabelText("Model (OpenRouter)") as HTMLSelectElement;
    await screen.findByRole("option", { name: /Live From API/ });
    expect(select.value).toBe("live/from-api");
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
    const select = screen.getByLabelText("Model (Custom provider)") as HTMLSelectElement;
    await screen.findByRole("option", { name: /Model B/ });
    expect(select.value).toBe("vendor/model-b");
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
    await screen.findByRole("option", { name: /Model A/ });

    const fields = await openCustomForm();
    await userEvent.type(fields.name, "Мой провайдер");
    await userEvent.type(fields.url, "https://api.example.com/v1");
    await userEvent.type(fields.key, "sk-custom-secret-9999");
    fixtures.customModels = { data: [{ id: "vendor/model-b", name: "Model B" }], isPending: false, isError: false, isSuccess: true, error: null };
    await userEvent.click(screen.getByRole("button", { name: "Обновить список моделей (Model (Custom provider))" }));
    await screen.findByRole("option", { name: /Model B/ });

    const builtinOptions = Array.from((screen.getByLabelText("Model (OpenRouter)") as HTMLSelectElement).options).map((option) => option.value);
    expect(builtinOptions).toContain("vendor/model-a");
    expect(builtinOptions).not.toContain("vendor/model-b");
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
    expect((screen.getByLabelText("Model (Custom provider)") as HTMLSelectElement).value).toBe("vendor/model-b");
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
    await screen.findByRole("option", { name: /Model B/ });
    await userEvent.click(within(customCard()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fixtures.saved).toMatchObject({ op: "update", provider: "custom-abc", activeModel: "vendor/model-b" }));
    await waitFor(() => expect(fixtures.activated).toEqual([{ provider: "custom-abc" }]));
  });
});
