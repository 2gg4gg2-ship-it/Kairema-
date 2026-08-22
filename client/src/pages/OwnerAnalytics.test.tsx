// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  isOwner: false,
  download: vi.fn(),
  navigate: vi.fn(),
  qualityPanel: vi.fn(),
  qualityChart: vi.fn(),
}));

vi.mock("wouter", () => ({ useLocation: () => ["/owner-analytics", fixtures.navigate] }));
vi.mock("@/lib/chat-export", () => ({ downloadPreparedChatExport: fixtures.download }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    owner: { isOwner: { useQuery: () => ({ data: fixtures.isOwner, isLoading: false }) } },
    search: {
      qualityPanel: { useQuery: (input: unknown, options: unknown) => { fixtures.qualityPanel(options); return { data: null }; } },
      qualityChart: { useQuery: (input: unknown, options: unknown) => { fixtures.qualityChart(options); return { data: fixtures.isOwner ? { daily: [{ date: "2026-08-20", requests: 3, success: 2, failures_by_layer: { layer_1: 1, layer_2: 1, layer_3: 0 }, p50: 120, p95: 240 }], hourlyLayers: [{ hour: "10", layer1: 1, layer2: 1, layer3: 0 }] } : null }; } },
    },
  },
}));

import OwnerAnalytics from "./OwnerAnalytics";

beforeEach(() => { fixtures.isOwner = false; fixtures.download.mockReset(); fixtures.navigate.mockReset(); fixtures.qualityPanel.mockReset(); fixtures.qualityChart.mockReset(); });
afterEach(() => cleanup());

describe("owner analytics", () => {
  it("does not render aggregate data to a non-owner and disables protected query paths", () => {
    render(<OwnerAnalytics />);
    expect(screen.getByText("Аналитика недоступна")).toBeTruthy();
    expect(screen.queryByText("Качество поиска")).toBeNull();
    expect(fixtures.qualityChart).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("renders aggregate-only 7d/24h charts and downloads local CSV/JSON", async () => {
    fixtures.isOwner = true;
    render(<OwnerAnalytics />);
    expect(screen.getByText("Качество поиска")).toBeTruthy();
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
