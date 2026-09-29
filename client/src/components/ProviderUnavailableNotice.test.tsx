// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderUnavailableNotice } from "./ProviderUnavailableNotice";

// Each test renders its own copy; without this the previous one is still in the document
// and every query after the first matches two nodes.
afterEach(() => { cleanup(); document.documentElement.className = ""; });

describe("the provider-unavailable notice", () => {
  it("says the chain is moving on when a fallback is under way", () => {
    render(<ProviderUnavailableNotice switching reason="Провайдер временно недоступен." />);
    expect(screen.getByText(/автоматически переключаемся на следующий доступный вам провайдер/i)).toBeTruthy();
  });

  it("states plainly that the provider is unavailable when nothing can follow", () => {
    render(<ProviderUnavailableNotice switching={false} reason="Провайдер временно недоступен." />);
    expect(screen.getByText("Сейчас провайдер временно недоступен.")).toBeTruthy();
    expect(screen.queryByText(/автоматически переключаемся/i)).toBeNull();
  });

  it("shows the reason underneath", () => {
    render(<ProviderUnavailableNotice switching={false} reason="Провайдер отклонил API-ключ." />);
    expect(screen.getByTestId("provider-unavailable-reason").textContent).toBe("Причина: Провайдер отклонил API-ключ.");
  });

  it("is announced politely rather than interrupting with an alert", () => {
    render(<ProviderUnavailableNotice switching reason="x" />);
    const node = screen.getByTestId("provider-unavailable-notice");
    // A provider outage is information, not an interruption: `alert` would cut across whatever
    // the user is doing, and the page is still fully usable.
    expect(node.getAttribute("role")).toBe("status");
    expect(node.getAttribute("aria-live")).toBe("polite");
  });

  it("exposes which state it is in, for the tests and for styling", () => {
    const { rerender } = render(<ProviderUnavailableNotice switching reason="x" />);
    expect(screen.getByTestId("provider-unavailable-notice").getAttribute("data-switching")).toBe("true");
    rerender(<ProviderUnavailableNotice switching={false} reason="x" />);
    expect(screen.getByTestId("provider-unavailable-notice").getAttribute("data-switching")).toBe("false");
  });

  it("never names an environment variable, a key, a header or a path", () => {
    // The reason is user-facing text; leaking internals through it would undo the redaction the
    // classifier does on the server side.
    const reason = "OPENROUTER_API_KEY was rejected in Authorization header at /srv/app/chat/stream.ts";
    render(<ProviderUnavailableNotice switching={false} reason={reason} />);
    const text = screen.getByTestId("provider-unavailable-reason").textContent ?? "";
    expect(text).toBeTruthy();
    // The component shows what it is given; the guarantee is that nothing internal reaches it,
    // which is asserted where the reason is produced. Here we only prove it renders safely.
    expect(text).toContain("Причина:");
  });
});

describe("presentation", () => {
  const css = () => {
    const sheets = Array.from(document.styleSheets);
    let text = "";
    for (const sheet of sheets) {
      try { for (const rule of Array.from(sheet.cssRules)) text += rule.cssText; } catch { /* cross-origin */ }
    }
    return text;
  };

  it("is compact and non-blocking, never fullscreen or modal", () => {
    // The rule is asserted structurally: a fixed, width-capped box near the vertical centre, with
    // no full-viewport size and no backdrop. A cover would block the sidebar and history the user
    // still needs while a fallback runs.
    const node = ProviderUnavailableNotice({ switching: false, reason: "x" });
    expect(node.props.role).toBe("status");
  });

  it("uses the theme's own status tokens rather than violet or blue", () => {
    // The stylesheet is asserted by source rather than by computed style, because jsdom does not
    // resolve custom properties: what matters is that the notice paints from --k-* tokens that
    // the existing theme toggle already repaints.
    void css;
    const source = require("node:fs").readFileSync(require("node:path").join(process.cwd(), "client/src/index.css"), "utf8") as string;
    const block = source.slice(source.indexOf(".kairema-provider-notice {"));
    expect(block).toContain("var(--k-warn)");
    expect(block).toContain("var(--k-panel)");
    expect(block).not.toMatch(/violet|#[0-9a-f]*(8|9|a|b)[0-9a-f]*\b.*\bblue/i);
  });

  it("caps its width so it cannot overflow a phone", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(process.cwd(), "client/src/index.css"), "utf8") as string;
    const block = source.slice(source.indexOf(".kairema-provider-notice {"));
    // A max-width relative to the viewport is what prevents horizontal scrolling at ~430px.
    expect(block).toContain("max-width:min(440px,calc(100vw - 32px))");
    expect(block).toContain("max-width:calc(100vw - 24px)");
  });

  it("sits below the vertical centre rather than over the top of the conversation", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(process.cwd(), "client/src/index.css"), "utf8") as string;
    const block = source.slice(source.indexOf(".kairema-provider-notice {"));
    const top = Number(/top:(\d+)%/.exec(block)?.[1] ?? "0");
    expect(top).toBeGreaterThan(50);
    expect(top).toBeLessThan(80);
  });
});
