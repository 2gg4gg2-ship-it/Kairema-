// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  isOwner: false,
  download: vi.fn(),
  navigate: vi.fn(),
  invalidateControls: vi.fn(),
  invalidateObservability: vi.fn(),
  qualityPanel: vi.fn(),
  qualityChart: vi.fn(),
  claimDiagnostic: vi.fn(),
  observability: vi.fn(),
  providerControls: vi.fn(),
  providerControlTargets: vi.fn(),
  updateProviderControl: vi.fn(),
}));

vi.mock("wouter", () => ({ useLocation: () => ["/owner-analytics", fixtures.navigate] }));
vi.mock("@/lib/chat-export", () => ({ downloadPreparedChatExport: fixtures.download }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ owner: { providerControls: { invalidate: fixtures.invalidateControls }, observability: { invalidate: fixtures.invalidateObservability } } }),
    owner: {
      isOwner: { useQuery: () => ({ data: fixtures.isOwner, isLoading: false, isSuccess: true }) },
      claimDiagnostic: { useQuery: (input: unknown, options: unknown) => { fixtures.claimDiagnostic(options); return { data: fixtures.isOwner ? null : { comparedClaim: "openId", configured: true, expectedFingerprint: "sha256:expected", sessionFingerprint: "sha256:session", matches: false } }; } },
      observability: { useQuery: (input: unknown, options: unknown) => { fixtures.observability(options); return { data: fixtures.isOwner ? { providers: [{ provider: "DeepSeek", state: "ready", category: null, checkedAt: "2026-08-20T10:00:00.000Z" }], search: { samples24h: 4, outages24h: 1 }, memory: { facts: 8, topics: 3 }, events: [{ id: 1, title: "Provider control updated", kind: "provider_control", roleId: "flash", code: "MANUAL" , createdAt: "2026-08-20T10:00:00.000Z" }] } : null }; } },
      providerControls: { useQuery: (input: unknown, options: unknown) => { fixtures.providerControls(options); return { data: fixtures.isOwner ? [{ targetType: "provider", targetKey: "deepseek", disabled: false, preference: "avoid" }] : null }; } },
      providerControlTargets: { useQuery: (input: unknown, options: unknown) => { fixtures.providerControlTargets(options); return { data: fixtures.isOwner ? { providers: ["deepseek"], models: ["deepseek-chat"] } : null }; } },
      updateProviderControl: { useMutation: () => ({ mutateAsync: fixtures.updateProviderControl, isPending: false, error: null }) },
    },
    search: {
      qualityPanel: { useQuery: (input: unknown, options: unknown) => { fixtures.qualityPanel(options); return { data: null }; } },
      qualityChart: { useQuery: (input: unknown, options: unknown) => { fixtures.qualityChart(options); return { data: fixtures.isOwner ? { daily: [{ date: "2026-08-20", requests: 3, success: 2, failures_by_layer: { layer_1: 1, layer_2: 1, layer_3: 0 }, p50: 120, p95: 240 }], hourlyLayers: [{ hour: "10", layer1: 1, layer2: 1, layer3: 0 }] } : null }; } },
    },
  },
}));

import OwnerAnalytics from "./OwnerAnalytics";

beforeEach(() => { fixtures.isOwner = false; fixtures.download.mockReset(); fixtures.navigate.mockReset(); fixtures.invalidateControls.mockReset(); fixtures.invalidateObservability.mockReset(); fixtures.qualityPanel.mockReset(); fixtures.qualityChart.mockReset(); fixtures.claimDiagnostic.mockReset(); fixtures.observability.mockReset(); fixtures.providerControls.mockReset(); fixtures.providerControlTargets.mockReset(); fixtures.updateProviderControl.mockReset(); });
afterEach(() => cleanup());

describe("owner analytics", () => {
  it("does not render aggregate data to a non-owner and disables protected query paths", () => {
    render(<OwnerAnalytics />);
    expect(screen.getByText("Аналитика недоступна")).toBeTruthy();
    expect(screen.queryByText("Наблюдаемость Kairema")).toBeNull();
    expect(fixtures.qualityChart).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fixtures.observability).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fixtures.providerControls).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fixtures.claimDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it("renders aggregate-only 7d/24h charts and downloads local CSV/JSON", async () => {
    fixtures.isOwner = true;
    render(<OwnerAnalytics />);
    expect(screen.getByText("Наблюдаемость Kairema")).toBeTruthy();
    expect(screen.getByText("Fail-safe routing controls")).toBeTruthy();
    expect(screen.getByLabelText("Успешные результаты за семь дней")).toBeTruthy();
    expect(screen.getByLabelText("Отказы анонимных слоёв поиска за двадцать четыре часа")).toBeTruthy();
    expect(screen.queryByText(/https?:\/\//)).toBeNull();
    expect(fixtures.qualityChart).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, refetchInterval: 60_000 }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "CSV" }));
    await user.click(screen.getByRole("button", { name: "JSON" }));
    expect(fixtures.download).toHaveBeenCalledTimes(2);
    expect(fixtures.download.mock.calls[0]?.[0]).toMatchObject({ fileName: "kairema-search-quality-aggregate.csv", contentType: "text/csv;charset=utf-8" });
    expect(fixtures.download.mock.calls[1]?.[0]).toMatchObject({ fileName: "kairema-search-quality-aggregate.json", contentType: "application/json;charset=utf-8" });
    const csv = await (fixtures.download.mock.calls[0]?.[0].blob as Blob).text();
    const json = JSON.parse(await (fixtures.download.mock.calls[1]?.[0].blob as Blob).text()) as { daily: Array<Record<string, unknown>> };
    expect(csv).toContain("date,requests,success,failures_by_layer,p50,p95");
    expect(json.daily[0]).toEqual({ date: "2026-08-20", requests: 3, success: 2, failures_by_layer: { layer_1: 1, layer_2: 1, layer_3: 0 }, p50: 120, p95: 240 });
    expect(`${csv}\n${JSON.stringify(json)}`).not.toMatch(/userId|message|memory|chatId|attachment|https?:\/\/|provider|model/i);
  });
});
