// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    configs: [] as Array<{ provider: string; activeModel: string; keyHint: string; updatedAt: string }>,
    activeProvider: null as string | null,
    storageReady: true,
  },
  models: { data: [] as Array<{ id: string; name: string }>, isLoading: false, isError: false, isSuccess: true },
  saved: null as unknown,
}));

vi.mock("wouter", () => ({ useLocation: () => ["/settings/providers", fixtures.navigate] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ userProviders: { list: { invalidate: fixtures.invalidateList } } }),
    userProviders: {
      list: { useQuery: () => ({ data: fixtures.list, isLoading: false, isError: false, isSuccess: true }) },
      models: { useQuery: (input: unknown) => { fixtures.modelsInput.push(input); return { data: { models: fixtures.models.data }, isLoading: fixtures.models.isLoading, isError: fixtures.models.isError, isSuccess: fixtures.models.isSuccess }; } },
      test: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
      save: { useMutation: () => ({ mutateAsync: vi.fn(async (input) => { fixtures.saved = input; return {}; }), isPending: false, error: null }) },
      setActive: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
      remove: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) },
    },
  },
}));

import AIProviders from "./AIProviders";

beforeEach(() => {
  fixtures.modelsInput.length = 0;
  fixtures.saved = null;
  fixtures.list.configs = [];
  fixtures.list.activeProvider = null;
  fixtures.list.storageReady = true;
  fixtures.models = { data: [], isLoading: false, isError: false, isSuccess: true };
  fixtures.navigate.mockReset();
  fixtures.invalidateList.mockReset();
});

afterEach(() => cleanup());

describe("AI Providers screen", () => {
  it("offers a concrete provider with one active model, not four role slots", async () => {
    render(<AIProviders />);
    expect(await screen.findByText("OpenRouter")).toBeTruthy();
    // The Kairema role names must not be presented as BYOK model choices.
    for (const role of ["Flash", "Think", "Context", "Apex"]) {
      expect(document.body.textContent ?? "").not.toContain(`Kairema ${role}`);
    }
  });

  it("shows a saved key only as a mask and never as a full value", async () => {
    fixtures.list.configs = [{ provider: "openrouter", activeModel: "vendor/model-a", keyHint: "••••5678", updatedAt: new Date(0).toISOString() }];
    render(<AIProviders />);
    expect((await screen.findAllByText(/••••5678/)).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain("sk-or-v1-");
  });

  it("marks providers without a server adapter as coming soon and offers no control for them", async () => {
    render(<AIProviders />);
    expect((await screen.findAllByText("скоро")).length).toBe(2);
    expect(document.body.textContent ?? "").toContain("Адаптер ещё не реализован на сервере.");
    // The add button only exists for the implemented provider.
    expect(screen.getAllByRole("button", { name: /Добавить/ })).toHaveLength(1);
  });

  it("builds the model list from the provider catalog, with no hardcoded model ids", async () => {
    fixtures.models = { data: [{ id: "live/from-api", name: "Live From API" }], isLoading: false, isError: false, isSuccess: true };
    render(<AIProviders />);
    await userEvent.click(await screen.findByRole("button", { name: /Добавить/ }));
    expect((await screen.findByText(/Live From API/)).textContent).toContain("live/from-api");
    expect(document.body.textContent ?? "").not.toContain("minimax");
    expect(document.body.textContent ?? "").not.toContain("gpt-oss");
  });

  it("warns instead of silently pretending when server-side key storage is unconfigured", async () => {
    fixtures.list.storageReady = false;
    render(<AIProviders />);
    const notice = await screen.findByText("Сервер пока не настроен на хранение пользовательских API-ключей. Сохранение и проверка подключения будут недоступны до исправления конфигурации.");
    expect(notice).toBeTruthy();
  });

  it("states plainly that the server sees the key during a request", async () => {
    render(<AIProviders />);
    expect((await screen.findByText("Как это работает")).textContent).toBeTruthy();
    expect(document.body.textContent ?? "").toContain("Ключ шифруется на сервере");
    expect(document.body.textContent ?? "").toContain("Сервер видит ключ в момент запроса к провайдеру");
    expect(document.body.textContent ?? "").not.toContain("Kairema никогда не видит");
  });

  it("promises no silent switch to a Kairema provider", async () => {
    render(<AIProviders />);
    expect((await screen.findByText("Как это работает")).textContent).toBeTruthy();
    expect(document.body.textContent ?? "").toContain("не переключается на свои провайдеры");
  });
});
