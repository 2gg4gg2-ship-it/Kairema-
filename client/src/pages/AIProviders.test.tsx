// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookPosition = vi.hoisted(() => ({ value: 0 }));
// react-query re-renders the page when a mutation resolves; the mock reproduces that.
const renderTick = vi.hoisted(() => ({ fn: () => {} }));

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
  models: { data: [] as Array<{ id: string; name: string }>, isPending: false, isError: false, isSuccess: false },
  customModels: { data: [] as Array<{ id: string; name: string }>, isPending: false, isError: false, isSuccess: false },
  customModelsInput: [] as unknown[],
  modelsLoaded: 0,
  customModelsLoaded: 0,
  saved: null as unknown,
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
  get isSuccess() {
    return slot === 0 ? fixtures.models.isSuccess : fixtures.customModels.isSuccess;
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ userProviders: { list: { invalidate: fixtures.invalidateList } } }),
    userProviders: {
      list: { useQuery: () => ({ data: fixtures.list, isLoading: false, isError: false, isSuccess: true }) },
      // Two independent mutation instances, one per hook position. The page always calls
      // `models.useMutation()` exactly twice per render in the same order, so `position % 2`
      // reproduces react-query's per-hook cache identity across re-renders.
      models: { useMutation: () => modelsInstances[hookPosition.value++ % 2]! },
      test: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
      save: { useMutation: () => ({ mutateAsync: vi.fn(async (input) => { fixtures.saved = input; return {}; }), isPending: false, error: null }) },
      createCustom: { useMutation: () => ({ mutateAsync: vi.fn(async (input) => { fixtures.saved = input; return {}; }), isPending: false, error: null }) },
      updateCustom: { useMutation: () => ({ mutateAsync: vi.fn(async (input) => { fixtures.saved = input; return {}; }), isPending: false, error: null }) },
      setActive: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
      remove: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
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
  fixtures.models = { data: [], isPending: false, isError: false, isSuccess: false };
  fixtures.customModels = { data: [], isPending: false, isError: false, isSuccess: false };
  fixtures.customModelsInput.length = 0;
  fixtures.customModelsLoaded = 0;
  fixtures.navigate.mockReset();
  fixtures.invalidateList.mockReset();
});

afterEach(() => cleanup());

describe("AI Providers screen", () => {
  it("offers a concrete provider with one active model, not four role slots", async () => {
    renderProviders();
    expect(await screen.findByText("OpenRouter")).toBeTruthy();
    // The Kairema role names must not be presented as BYOK model choices.
    for (const role of ["Flash", "Think", "Context", "Apex"]) {
      expect(document.body.textContent ?? "").not.toContain(`Kairema ${role}`);
    }
  });

  it("shows a saved key only as a mask and never as a full value", async () => {
    fixtures.list.configs = [{ provider: "openrouter", activeModel: "vendor/model-a", keyHint: "••••5678", updatedAt: new Date(0).toISOString(), displayName: null, baseUrl: null, modelsEndpoint: null }];
    renderProviders();
    expect((await screen.findAllByText(/••••5678/)).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain("sk-or-v1-");
  });

  it("marks providers without a server adapter as coming soon and offers no control for them", async () => {
    renderProviders();
    expect((await screen.findAllByText("скоро")).length).toBe(2);
    expect(document.body.textContent ?? "").toContain("Адаптер ещё не реализован на сервере.");
    // The add button only exists for the implemented provider.
    expect(screen.getAllByRole("button", { name: /Добавить/ })).toHaveLength(1);
  });

  it("builds the model list from the provider catalog only when explicitly requested", async () => {
    fixtures.models = { data: [{ id: "live/from-api", name: "Live From API" }], isPending: false, isError: false, isSuccess: true };
    renderProviders();
    await userEvent.click(await screen.findByRole("button", { name: /Добавить/ }));
    // Nothing is fetched on its own: the catalog request only happens when the user asks for it.
    expect(fixtures.modelsLoaded).toBe(0);
    await userEvent.type(await screen.findByLabelText("API-ключ (OpenRouter)"), "sk-or-v1-typed-value");
    expect(fixtures.modelsLoaded).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: /Загрузить модели/ }));
    expect(fixtures.modelsLoaded).toBe(1);
    expect(fixtures.modelsInput.at(-1)).toEqual({ provider: "openrouter", apiKey: "sk-or-v1-typed-value" });
    expect((await screen.findByText(/Live From API/)).textContent).toContain("live/from-api");
    expect(document.body.textContent ?? "").not.toContain("minimax");
    expect(document.body.textContent ?? "").not.toContain("gpt-oss");
  });

  it("loads a saved provider's catalog without sending any key", async () => {
    fixtures.list.configs = [{ provider: "openrouter", activeModel: "vendor/model-a", keyHint: "••••5678", updatedAt: new Date(0).toISOString(), displayName: null, baseUrl: null, modelsEndpoint: null }];
    renderProviders();
    await userEvent.click(await screen.findByRole("button", { name: /Настроить/ }));
    expect(fixtures.modelsLoaded).toBe(1);
    // The server decrypts its own copy, so the request must not carry a key at all.
    expect(fixtures.modelsInput.at(-1)).toEqual({ provider: "openrouter" });
  });

  it("warns instead of silently pretending when server-side key storage is unconfigured", async () => {
    fixtures.list.storageReady = false;
    renderProviders();
    const notice = await screen.findByText("Сервер пока не настроен на хранение пользовательских API-ключей. Сохранение и проверка подключения будут недоступны до исправления конфигурации.");
    expect(notice).toBeTruthy();
  });

  it("states plainly that the server sees the key during a request", async () => {
    renderProviders();
    expect((await screen.findByText("Как это работает")).textContent).toBeTruthy();
    expect(document.body.textContent ?? "").toContain("Ключ шифруется на сервере");
    expect(document.body.textContent ?? "").toContain("Сервер видит ключ в момент запроса к провайдеру");
    expect(document.body.textContent ?? "").not.toContain("Kairema никогда не видит");
  });

  it("promises no silent switch to a Kairema provider", async () => {
    renderProviders();
    expect((await screen.findByText("Как это работает")).textContent).toBeTruthy();
    expect(document.body.textContent ?? "").toContain("не переключается на свои провайдеры");
  });
});

describe("custom provider form", () => {
  const CUSTOM = [{ provider: "custom-abc", activeModel: "vendor/model-b", keyHint: "••••4321", updatedAt: new Date(0).toISOString(), displayName: "Мой провайдер", baseUrl: "https://api.example.com/v1", modelsEndpoint: null }];

  async function openCustomForm() {
    await userEvent.click(await screen.findByRole("button", { name: /Подключить свой провайдер/ }));
    await userEvent.type(screen.getByLabelText("Название своего провайдера"), "Мой провайдер");
    await userEvent.type(screen.getByLabelText("Базовый URL провайдера"), "https://api.example.com/v1");
    await userEvent.type(screen.getByLabelText("API-ключ (свой провайдер)"), "sk-custom-secret-9999");
  }

  it("lists a saved custom provider under its own name and URL", async () => {
    fixtures.list.configs = CUSTOM;
    renderProviders();
    expect(await screen.findByText("Мой провайдер")).toBeTruthy();
    expect(screen.getByText("https://api.example.com/v1")).toBeTruthy();
  });

  it("BUG-3: preselects the first returned model so save becomes available", async () => {
    renderProviders();
    await openCustomForm();
    fixtures.customModels = { data: [{ id: "vendor/model-b", name: "Model B" }, { id: "vendor/model-c", name: "Model C" }], isPending: false, isError: false, isSuccess: true };
    await userEvent.click(screen.getByRole("button", { name: /Загрузить модели/ }));

    // The selected value is real state, not just the first option the browser happens to show.
    const select = screen.getByLabelText("Активная модель (свой провайдер)") as HTMLSelectElement;
    await screen.findByRole("option", { name: /Model B/ });
    expect(select.value).toBe("vendor/model-b");
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("BUG-3: keeps save disabled when the catalog comes back empty", async () => {
    renderProviders();
    await openCustomForm();
    fixtures.customModels = { data: [], isPending: false, isError: false, isSuccess: true };
    await userEvent.click(screen.getByRole("button", { name: /Загрузить модели/ }));
    expect((screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("BUG-4: a custom catalog never reaches the built-in panel's model list", async () => {
    fixtures.models = { data: [{ id: "vendor/model-a", name: "Model A" }], isPending: false, isError: false, isSuccess: true };
    renderProviders();

    // Load the built-in OpenRouter catalog first, then the custom one; both panels stay open.
    await userEvent.click(await screen.findByRole("button", { name: /^Добавить$/ }));
    await userEvent.type(screen.getByLabelText(/API-ключ \(OpenRouter\)/), "sk-or-v1-secret-value-9999");
    await userEvent.click(screen.getAllByRole("button", { name: /Загрузить модели/ })[0]!);
    await screen.findByRole("option", { name: /Model A/ });

    await openCustomForm();
    fixtures.customModels = { data: [{ id: "vendor/model-b", name: "Model B" }], isPending: false, isError: false, isSuccess: true };
    await userEvent.click(screen.getAllByRole("button", { name: /Загрузить модели/ })[1]!);
    await screen.findByRole("option", { name: /Model B/ });

    // The built-in select keeps only OpenRouter's own models.
    const builtinSelect = screen.getByLabelText("Активная модель (OpenRouter)") as HTMLSelectElement;
    const builtinOptions = Array.from(builtinSelect.options).map((option) => option.value);
    expect(builtinOptions).toContain("vendor/model-a");
    expect(builtinOptions).not.toContain("vendor/model-b");
  });
});
