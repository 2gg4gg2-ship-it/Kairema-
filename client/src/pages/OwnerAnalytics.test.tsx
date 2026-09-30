// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  isOwner: false,
  language: "ru" as "ru" | "en",
  onlineUsers: 3 as number | null,
  onlineFails: false,
  theme: "dark" as "light" | "dark",
  download: vi.fn(),
  navigate: vi.fn(),
  toggleTheme: vi.fn(),
  heartbeat: vi.fn(),
  invalidateControls: vi.fn(),
  invalidateObservability: vi.fn(),
  qualityPanel: vi.fn(),
  qualityChart: vi.fn(),
  claimDiagnostic: vi.fn(),
  observability: vi.fn(),
  dashboard: vi.fn(),
  online: vi.fn(),
  heartbeatQuery: vi.fn(),
  providerControls: vi.fn(),
  providerControlTargets: vi.fn(),
  updateProviderControl: vi.fn(),
  capacitySnapshot: vi.fn(),
  capacityPolicy: vi.fn(),
  updateCapacityPolicy: vi.fn(),
  capacityProviderBudgets: vi.fn(),
  updateCapacityProviderBudget: vi.fn(),
  invalidateCapacity: vi.fn(),
}));

vi.mock("wouter", () => ({ useLocation: () => ["/owner-analytics", fixtures.navigate] }));
vi.mock("@/lib/chat-export", () => ({ downloadPreparedChatExport: fixtures.download }));
vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: fixtures.theme, toggleTheme: fixtures.toggleTheme, highContrast: false, switchable: true }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ owner: { providerControls: { invalidate: fixtures.invalidateControls }, observability: { invalidate: fixtures.invalidateObservability }, capacitySnapshot: { invalidate: fixtures.invalidateCapacity }, capacityPolicy: { invalidate: fixtures.invalidateCapacity }, capacityProviderBudgets: { invalidate: fixtures.invalidateCapacity } } }),
    settings: {
      get: { useQuery: () => ({ data: { language: fixtures.language } }) },
    },
    presence: {
      heartbeat: { useMutation: () => ({ mutate: fixtures.heartbeat, isPending: false, error: null }) },
    },
    owner: {
      isOwner: { useQuery: () => ({ data: fixtures.isOwner, isLoading: false, isSuccess: true }) },
      claimDiagnostic: { useQuery: (input: unknown, options: unknown) => { fixtures.claimDiagnostic(options); return { data: fixtures.isOwner ? null : { comparedClaim: "email", configured: true, expectedFingerprint: "sha256:expected", sessionFingerprint: "sha256:session", matches: false } }; } },
      observability: { useQuery: (input: unknown, options: unknown) => { fixtures.observability(options); return { data: fixtures.isOwner ? { providers: [{ provider: "DeepSeek", state: "ready", category: null, checkedAt: "2026-08-20T10:00:00.000Z" }], search: { samples24h: 4, outages24h: 1 }, memory: { facts: 8, topics: 3 }, events: [{ id: 1, title: "Provider control updated", kind: "provider_control", roleId: "smart", code: "google", createdAt: "2026-08-20T10:00:00.000Z" }] } : null }; } },
      dashboard: { useQuery: (input: unknown, options: unknown) => { fixtures.dashboard(options); return { data: fixtures.isOwner ? {
        users: { total: 12, activeLast30d: 5 },
        requestsByRole: [{ roleId: "fast", count: 9 }, { roleId: "smart", count: 4 }],
        fallbackEvents: 2,
        providerEvents: 7,
        quota: { limitPerRole: 15, windowSeconds: 60, roles: [{ roleId: "fast", label: "Kairema Flash" }, { roleId: "smart", label: "Kairema Think" }, { roleId: "context", label: "Kairema Context" }, { roleId: "flagship", label: "Kairema Apex" }] },
      } : null }; } },
      getOnlineUsersCount: { useQuery: (input: unknown, options: unknown) => { fixtures.online(options); return { data: fixtures.isOwner && !fixtures.onlineFails && fixtures.onlineUsers !== null ? { onlineUsers: fixtures.onlineUsers, ttlSeconds: 60, updatedAt: "2026-09-30T10:00:00.000Z" } : undefined, isSuccess: fixtures.isOwner && !fixtures.onlineFails && fixtures.onlineUsers !== null }; } },
      providerControls: { useQuery: (input: unknown, options: unknown) => { fixtures.providerControls(options); return { data: fixtures.isOwner ? [{ targetType: "provider", targetKey: "deepseek", disabled: false, preference: "avoid" }] : null }; } },
      providerControlTargets: { useQuery: (input: unknown, options: unknown) => { fixtures.providerControlTargets(options); return { data: fixtures.isOwner ? { providers: ["deepseek"], models: ["deepseek-chat"] } : null }; } },
      updateProviderControl: { useMutation: () => ({ mutateAsync: fixtures.updateProviderControl, isPending: false, error: null }) },
      capacitySnapshot: { useQuery: (input: unknown, options: unknown) => { fixtures.capacitySnapshot(options); return { data: fixtures.isOwner ? { policy: { enabled: true, globalCapacity: "UNKNOWN / unconfigured", searchCapacity: "UNKNOWN / unconfigured", queueScope: "disabled (safe default)" }, local: { scope: "single process only; not a global production concurrency claim", generation: { active: 0, instanceLimit: 12 }, search: { active: 0, instanceLimit: 6 }, counters: {} }, adapters: [{ id: "cloudflare-workers-ai", status: "feasibility-only" }] } : null }; } },
      capacityPolicy: { useQuery: (input: unknown, options: unknown) => { fixtures.capacityPolicy(options); return { data: fixtures.isOwner ? { enabled: true, globalGenerationWcuLimit: null, globalSearchWcuLimit: null, perUserGenerationWcuLimit: 12, perUserSearchWcuLimit: 6, perUserGenerationConcurrency: 2, perUserSearchConcurrency: 1, apexPressureReservePercent: 20, queueMaxWaitMs: 0, queueMaxDepth: 0, updatedAt: "2026-08-27T00:00:00.000Z" } : null }; } },
      updateCapacityPolicy: { useMutation: () => ({ mutateAsync: fixtures.updateCapacityPolicy, isPending: false, error: null }) },
      capacityProviderBudgets: { useQuery: (input: unknown, options: unknown) => { fixtures.capacityProviderBudgets(options); return { data: fixtures.isOwner ? [] : null }; } },
      updateCapacityProviderBudget: { useMutation: () => ({ mutateAsync: fixtures.updateCapacityProviderBudget, isPending: false, error: null }) },
    },
    search: {
      qualityPanel: { useQuery: (input: unknown, options: unknown) => { fixtures.qualityPanel(options); return { data: null }; } },
      qualityChart: { useQuery: (input: unknown, options: unknown) => { fixtures.qualityChart(options); return { data: fixtures.isOwner ? { daily: [{ date: "2026-08-20", requests: 3, success: 2, failures_by_layer: { layer_1: 1, layer_2: 1, layer_3: 0 }, p50: 120, p95: 240 }], hourlyLayers: [{ hour: "10", layer1: 1, layer2: 1, layer3: 0 }] } : null }; } },
    },
  },
}));

import OwnerAnalytics from "./OwnerAnalytics";

beforeEach(() => {
  fixtures.isOwner = false;
  fixtures.language = "ru";
  fixtures.onlineUsers = 3;
  fixtures.onlineFails = false;
  fixtures.theme = "dark";
  for (const mock of [fixtures.download, fixtures.navigate, fixtures.toggleTheme, fixtures.heartbeat, fixtures.invalidateControls, fixtures.invalidateObservability, fixtures.invalidateCapacity, fixtures.qualityPanel, fixtures.qualityChart, fixtures.claimDiagnostic, fixtures.observability, fixtures.dashboard, fixtures.online, fixtures.providerControls, fixtures.providerControlTargets, fixtures.updateProviderControl, fixtures.capacitySnapshot, fixtures.capacityPolicy, fixtures.updateCapacityPolicy, fixtures.capacityProviderBudgets, fixtures.updateCapacityProviderBudget]) mock.mockReset();
});
afterEach(() => cleanup());

describe("owner analytics", () => {
  it("does not render aggregate data to a non-owner and disables protected query paths", () => {
    render(<OwnerAnalytics />);
    expect(screen.getByText("Панель недоступна")).toBeTruthy();
    expect(screen.queryByText("Kairema — панель владельца")).toBeNull();
    expect(fixtures.qualityChart).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fixtures.observability).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fixtures.providerControls).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fixtures.capacitySnapshot).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fixtures.capacityPolicy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fixtures.capacityProviderBudgets).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    // The presence count is as protected as the rest of the panel: a non-owner must not even ask.
    expect(fixtures.online).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fixtures.claimDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    // …and must not be able to report itself as present either.
    expect(fixtures.heartbeat).not.toHaveBeenCalled();
  });

  it("renders aggregate-only 7d/24h charts and downloads local CSV/JSON", async () => {
    fixtures.isOwner = true;
    render(<OwnerAnalytics />);
    expect(screen.getByText("Kairema — панель владельца")).toBeTruthy();
    expect(screen.getByText("Аварийные правила маршрутизации")).toBeTruthy();
    expect(screen.getByLabelText("Пропускная способность AI")).toBeTruthy();
    expect(screen.getAllByText("UNKNOWN / unconfigured")).toHaveLength(2);
    expect(screen.getByText("Лимиты провайдеров и моделей")).toBeTruthy();
    expect(screen.getByLabelText("Цель лимитов")).toBeTruthy();
    expect(screen.getByText(/Настроенных лимитов пока нет/)).toBeTruthy();
    expect(screen.getByLabelText("Успешные результаты за семь дней")).toBeTruthy();
    expect(screen.getByLabelText("Отказы анонимных слоёв поиска за двадцать четыре часа")).toBeTruthy();
    expect(screen.queryByText(/https?:\/\//)).toBeNull();
    expect(fixtures.qualityChart).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, refetchInterval: 60_000 }));
    expect(fixtures.capacityProviderBudgets).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /CSV/ }));
    await user.click(screen.getByRole("button", { name: /JSON/ }));
    expect(fixtures.download).toHaveBeenCalledTimes(2);
    expect(fixtures.download.mock.calls[0]?.[0]).toMatchObject({ fileName: "kairema-search-quality-aggregate.csv", contentType: "text/csv;charset=utf-8" });
    expect(fixtures.download.mock.calls[1]?.[0]).toMatchObject({ fileName: "kairema-search-quality-aggregate.json", contentType: "application/json;charset=utf-8" });
    const csv = await (fixtures.download.mock.calls[0]?.[0].blob as Blob).text();
    const json = JSON.parse(await (fixtures.download.mock.calls[1]?.[0].blob as Blob).text()) as { daily: Array<Record<string, unknown>> };
    expect(csv).toContain("date,requests,success,failures_by_layer,p50,p95");
    expect(json.daily[0]).toEqual({ date: "2026-08-20", requests: 3, success: 2, failures_by_layer: { layer_1: 1, layer_2: 1, layer_3: 0 }, p50: 120, p95: 240 });
    expect(`${csv}\n${JSON.stringify(json)}`).not.toMatch(/userId|message|memory|chatId|attachment|https?:\/\/|provider|model/i);
  });

  it("submits provider budget metadata through the owner-only mutation without client identity fields", async () => {
    fixtures.isOwner = true;
    render(<OwnerAnalytics />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Лимиты провайдеров и моделей"));
    await user.selectOptions(screen.getByLabelText("Цель лимитов"), '{"provider":"deepseek"}');
    await user.clear(screen.getByLabelText("Лимит генерации, WCU"));
    await user.type(screen.getByLabelText("Лимит генерации, WCU"), "4");
    await user.click(screen.getByLabelText("fast"));
    await user.click(screen.getByRole("button", { name: "Сохранить лимиты" }));
    expect(fixtures.updateCapacityProviderBudget).toHaveBeenCalledWith(expect.objectContaining({
      provider: "deepseek",
      modelId: null,
      enabled: true,
      generationWcuLimit: 4,
      roleEligibility: ["fast"],
      billingSafe: false,
      quotaState: "unknown",
    }));
    expect(fixtures.updateCapacityProviderBudget.mock.calls[0]?.[0]).not.toHaveProperty("userId");
    expect(fixtures.updateCapacityProviderBudget.mock.calls[0]?.[0]).not.toHaveProperty("reservationKey");
  });
});

/**
 * The panel used to be hardcoded Russian with English headings mixed in, and the theme toggle had
 * nothing to switch because every surface was a literal dark utility. These are the regressions that
 * the rewrite exists to prevent.
 */
describe("owner panel localization", () => {
  it("renders Russian copy and Russian section grouping by default", () => {
    fixtures.isOwner = true;
    render(<OwnerAnalytics />);
    expect(screen.getByText("Kairema — панель владельца")).toBeTruthy();
    expect(screen.getByText("Обзор")).toBeTruthy();
    expect(screen.getByText("Пропускная способность AI")).toBeTruthy();
    expect(screen.getByText("Потоки AI")).toBeTruthy();
    expect(screen.getByText("Поиск и события")).toBeTruthy();
    expect(screen.getByText("Провайдеры")).toBeTruthy();
    expect(screen.getByText("Сейчас в приложении")).toBeTruthy();
    expect(screen.getByText("Экспорт CSV")).toBeTruthy();
    expect(screen.getByText("Скачать технические агрегаты в CSV.")).toBeTruthy();
  });

  it("renders English copy when the user setting is English", () => {
    fixtures.isOwner = true;
    fixtures.language = "en";
    render(<OwnerAnalytics />);
    expect(screen.getByText("Kairema — owner dashboard")).toBeTruthy();
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("AI capacity")).toBeTruthy();
    expect(screen.getByText("AI streams")).toBeTruthy();
    expect(screen.getByText("Search and events")).toBeTruthy();
    expect(screen.getByText("Providers")).toBeTruthy();
    expect(screen.getByText("Currently active")).toBeTruthy();
    expect(screen.getByText("Export CSV")).toBeTruthy();
    expect(screen.queryByText("Обзор")).toBeNull();
    expect(screen.queryByText("Панель недоступна")).toBeNull();
  });

  it("localizes provider health statuses but leaves real provider ids untouched", () => {
    fixtures.isOwner = true;
    fixtures.language = "en";
    const { unmount } = render(<OwnerAnalytics />);
    expect(screen.getByText("ready")).toBeTruthy();
    // `DeepSeek` is a real value, not prose: it must not be translated.
    expect(screen.getByText("DeepSeek")).toBeTruthy();
    unmount();
    fixtures.language = "ru";
    render(<OwnerAnalytics />);
    expect(screen.getByText("готов")).toBeTruthy();
    expect(screen.getByText("DeepSeek")).toBeTruthy();
  });

  it("keeps the role slugs untranslated in both languages", () => {
    fixtures.isOwner = true;
    for (const language of ["ru", "en"] as const) {
      fixtures.language = language;
      const { unmount } = render(<OwnerAnalytics />);
      for (const role of ["fast", "smart", "context", "flagship"]) {
        expect(screen.getAllByText(role).length, `${language}:${role}`).toBeGreaterThan(0);
      }
      unmount();
    }
  });

  it("never puts owner configuration or secrets into the client bundle", () => {
    // Read the source directly: a fixture-based render cannot prove an absent import.
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/OwnerAnalytics.tsx"), "utf8");
    expect(source).not.toMatch(/OWNER_EMAIL|OWNER_OPEN_ID|ownerEmail|ownerOpenId/);
    expect(source).not.toMatch(/arbyz7874/);
    // `budgetDailyTokenLimit` is a quota counter, not a credential, so a bare "token" sweep would
    // false-positive. What must not be reachable from the client is configuration, session material
    // or credentials.
    for (const secret of ["DATABASE_URL", "password", "apiKey", "api_key", "process.env", "localStorage", "Authorization", "Bearer", "setCookie"]) {
      expect(source, secret).not.toContain(secret);
    }
  });
});

describe("owner panel theming", () => {
  it("toggles the theme from the panel without a reload", async () => {
    fixtures.isOwner = true;
    render(<OwnerAnalytics />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Светлая тема" }));
    expect(fixtures.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it("styles every surface from the shared --k-* tokens instead of hardcoded dark utilities", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/OwnerAnalytics.tsx"), "utf8");
    // The original panel was entirely `bg-slate-950` / `border-slate-800` / `text-cyan-300`, which
    // is why light mode left it dark-blue-black. No Tailwind colour utility may come back.
    expect(source).not.toMatch(/slate-|cyan-|violet-|amber-|emerald-|rose-/);
    // A tokenised page has nothing to repaint per theme, so it must not also hardcode hexes.
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("defines the owner surface classes in the stylesheet, reading only two-theme tokens", () => {
    const css = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");
    for (const selector of [".kairema-owner-page", ".kairema-owner-card", ".kairema-owner-online", ".kairema-owner-btn", ".kairema-owner-btn-primary", ".kairema-owner-field", ".kairema-owner-pill-ok", ".kairema-owner-pill-warn", ".kairema-owner-pill-danger"]) {
      expect(css, selector).toContain(selector);
    }
    // The one filled control has to invert, or it is unreadable in the dark theme.
    expect(css).toMatch(/\.kairema-owner-btn-primary\s*\{[^}]*background:\s*var\(--k-text\)[^}]*color:\s*var\(--k-invert\)/);
    // A hover that restates its base value is invisible feedback.
    expect(css).toMatch(/\.kairema-owner-btn:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--k-line\)/);
    expect(css).toMatch(/\.kairema-owner-btn\s*\{[^}]*background:\s*var\(--k-panel-3\)/);
    expect(css).toMatch(/\.kairema-owner-btn:disabled\s*\{\s*opacity:\.4;?\s*\}/);
  });
});

describe("live presence", () => {
  it("shows the owner-only aggregate count and how fresh it is", () => {
    fixtures.isOwner = true;
    fixtures.onlineUsers = 3;
    render(<OwnerAnalytics />);
    expect(screen.getByText("Сейчас в приложении")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("3 человека сейчас активны")).toBeTruthy();
    expect(screen.getByText("Обновлено несколько секунд назад")).toBeTruthy();
    // It must poll rather than fetch once, and it must not hammer.
    expect(fixtures.online).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, refetchInterval: 30_000 }));
  });

  it("uses the Russian plural forms for the active-people line", () => {
    fixtures.isOwner = true;
    for (const [count, expected] of [[1, "1 человек сейчас активен"], [2, "2 человека сейчас активны"], [5, "5 человек сейчас активны"], [11, "11 человек сейчас активны"], [0, "0 человек сейчас активны"]] as const) {
      fixtures.onlineUsers = count;
      const { unmount } = render(<OwnerAnalytics />);
      expect(screen.getByText(expected), String(count)).toBeTruthy();
      unmount();
    }
  });

  it("uses the English singular only for exactly one person", () => {
    fixtures.isOwner = true;
    fixtures.language = "en";
    for (const [count, expected] of [[1, "1 person is currently active"], [2, "2 people are currently active"]] as const) {
      fixtures.onlineUsers = count;
      const { unmount } = render(<OwnerAnalytics />);
      expect(screen.getByText(expected)).toBeTruthy();
      unmount();
    }
  });

  it("never shows a false zero while the count is still unknown", () => {
    fixtures.isOwner = true;
    fixtures.onlineFails = true;
    render(<OwnerAnalytics />);
    // "Unavailable" rather than a fabricated 0: a failed query is not an empty app.
    expect(screen.getByText("Нет данных")).toBeTruthy();
    expect(screen.queryByText("0 человек сейчас активны")).toBeNull();
    expect(screen.queryByText(/человек сейчас актив/)).toBeNull();
  });

  it("sends a presence heartbeat and keeps polling it on a timer", async () => {
    vi.useFakeTimers();
    try {
      fixtures.isOwner = true;
      render(<OwnerAnalytics />);
      expect(fixtures.heartbeat).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fixtures.heartbeat).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fixtures.heartbeat).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the heartbeat timer when the panel unmounts", async () => {
    vi.useFakeTimers();
    try {
      fixtures.isOwner = true;
      const { unmount } = render(<OwnerAnalytics />);
      expect(fixtures.heartbeat).toHaveBeenCalledTimes(1);
      unmount();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fixtures.heartbeat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes no visitor identity in the presence payload", async () => {
    fixtures.isOwner = true;
    render(<OwnerAnalytics />);
    const document_ = document.body.textContent ?? "";
    for (const leak of ["@", "guest_", "openId", "sessionFingerprint", "userId"]) {
      expect(document_, leak).not.toContain(leak);
    }
    await waitFor(() => expect(fixtures.online).toHaveBeenCalled());
  });
});
