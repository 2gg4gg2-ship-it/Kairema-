/* @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf8");

/**
 * Every `--k-*` declaration, bucketed by the selector that carries it. The theme is expressed as
 * `:root { … }` for light and `.dark { … }` for dark, and the colours are declared across more
 * than one such block, so the blocks are collected rather than sliced.
 */
function declaredTokens(): { light: Set<string>; dark: Set<string> } {
  const light = new Set<string>();
  const dark = new Set<string>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1] ?? "";
    const target = /(^|[\s,}])dark\s*$/.test(selector.trim()) || selector.includes(".dark") ? dark : /:root\s*$/.test(selector.trim()) ? light : null;
    if (!target) continue;
    for (const token of (match[2] ?? "").matchAll(/(--k-[a-z0-9-]+)\s*:/g)) target.add(token[1]!);
  }
  return { light, dark };
}

/** The body of every rule whose selector list mentions `selector`, concatenated. */
function bodies(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = [...css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escaped}[^{,]*\\{([^}]*)\\}`, "g"))].map((match) => match[1] ?? "");
  return found.join(" ");
}

/** The body of the first rule whose selector list contains `selector`. */
function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[}\\n])\\s*${escaped}[^{,]*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

/** The value of one declaration inside a rule body, or undefined when it is not there. */
function declaration(ruleBody: string, property: string): string | undefined {
  return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(ruleBody)?.[1]?.trim();
}

/** The two palettes, located by their own token list rather than by position. */
function palettes(): { light: string; dark: string } {
  const block = (scheme: string) => {
    const found = [...css.matchAll(/\{([^}]*)\}/g)].map((match) => match[1] ?? "").filter((text) => text.includes(`color-scheme: ${scheme}`) && text.includes("--k-bg:"));
    expect(found, `no ${scheme} palette block`).toHaveLength(1);
    return found[0]!;
  };
  return { light: block("light"), dark: block("dark") };
}

/**
 * Dark/light is one toggle, so a component either reads its colours from the `--k-*` tokens — in
 * which case both themes repaint together — or it hardcodes a literal and stays dark when the
 * toggle flips. jsdom resolves no cascade and computes no colours, so these assert on the source,
 * which is the only place the defect is actually visible without a browser.
 */
describe("theme tokens cover the Kairema surface", () => {
  const tokenised = [
    ".kairema-sidebar",
    ".kairema-topbar",
    ".kairema-textarea",
    ".kairema-typing",
    ".kairema-prompt",
    ".kairema-provider",
    ".kairema-history-item",
    ".kairema-footer-link",
    ".kairema-dialog",
    ".kairema-binding-select",
    ".kairema-binding-trigger",
    ".kairema-profile-grid h3",
    ".kairema-export-button",
    ".kairema-limit-card",
    ".kairema-setting-chip",
    ".kairema-chat-tools",
    ".kairema-model-pill",
  ];

  it.each(tokenised)("%s takes its colours from tokens, not literals", (selector) => {
    const declarations = bodies(selector);
    expect(declarations, `no rule found for ${selector}`).not.toBe("");
    // A hardcoded white/light literal here is exactly what stays dark after the toggle.
    expect(declarations).not.toMatch(/rgba\(255,\s*255,\s*255/i);
    expect(declarations).not.toMatch(/#fff\b|#ffffff\b/i);
  });

  it("keeps the one deliberate scrim, which is meant to be dark in both themes", () => {
    // The mobile sidebar backdrop dims the page behind it; a light scrim would do the opposite.
    // It only exists at narrow widths, where the base rule is `display: none`.
    expect(body(".kairema-backdrop")).toMatch(/display:none/);
    expect(css).toMatch(/@media\(max-width:767px\)[^@]*?\.kairema-backdrop\{[^}]*background:rgba\(0,0,0,\.56\)/);
  });

  it("never reads a --k-* colour that only exists in one theme", () => {
    // A token declared in both themes with a different literal repaints correctly. A token
    // declared only in `:root` is single-theme, and is only safe when its value is *derived*
    // (a color-mix over another token), because that follows whatever the other token becomes.
    const { light, dark } = declaredTokens();
    const derived = new Set<string>();
    for (const match of css.matchAll(/(--k-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      if (match[2]?.includes("var(--k-")) derived.add(match[1]!);
    }
    const used = new Set([...css.matchAll(/var\(--k-[a-z0-9-]+\)/g)].map((match) => match[0].slice(4, -1)));
    for (const token of used) {
      if (token.startsWith("--k-font-")) continue;
      expect(light.has(token) || dark.has(token), `${token} is never declared`).toBe(true);
      if (light.has(token) && dark.has(token)) continue;
      expect(derived.has(token), `${token} is declared in one theme only and does not adapt`).toBe(true);
    }
  });

  it("declares the two themes separately, with different values", () => {
    const { light, dark } = palettes();
    for (const token of ["--k-bg", "--k-panel", "--k-panel-2", "--k-text", "--k-muted", "--k-line", "--k-accent", "--k-focus", "--k-shadow"]) {
      expect(declaration(light, token), `${token} in light`).toBeDefined();
      expect(declaration(dark, token), `${token} in dark`).toBeDefined();
      expect(declaration(light, token), `${token} is the same in both themes`).not.toBe(declaration(dark, token));
    }
  });

  it("defines the focus halo and shadow from the theme, in both palettes", () => {
    // --k-focus and --k-shadow are derived per theme rather than shared, because the same alpha
    // over a near-white surface is invisible while the same alpha over a near-black one is not.
    const { light, dark } = palettes();
    for (const token of ["--k-focus", "--k-shadow"]) {
      for (const [name, block] of [["light", light], ["dark", dark]] as const) {
        const value = declaration(block, token);
        expect(value, `${token} in ${name}`).toBeDefined();
        expect(value, `${token} in ${name}`).toMatch(/color-mix\(/);
      }
    }
  });

  it("pairs inverted surfaces so text stays readable in both themes", () => {
    // `--k-invert` on `--k-strong` is near 1.2:1 in the dark theme, because both are dark
    // surfaces. An inverted control has to be a `--k-text` background with a `--k-invert`
    // foreground, which flips correctly in either direction.
    expect(css).not.toMatch(/color:\s*var\(--k-invert\)\s*;\s*background:\s*var\(--k-strong\)/);
    expect(css).toMatch(/color:\s*var\(--k-invert\)[^}]*background:\s*var\(--k-text\)/);
  });

  it("keeps the status colours on the reserved per-theme tokens", () => {
    for (const status of [".status-ready", ".status-quota", ".status-auth", ".status-unavailable"]) {
      expect(bodies(status), status).toMatch(/var\(--k-(ok|warn|danger)-text\)/);
    }
  });

  it("does not paint the chat surfaces with a violet or blue accent", () => {
    // The accent system is neutral; a stray brand-coloured panel is what made some controls look
    // like they belonged to a different product in the light theme.
    for (const selector of [".kairema-new-chat", ".kairema-prompt:hover", ".kairema-provider-selected", ".kairema-mode-option[aria-pressed=\"true\"]", ".kairema-guest-login"]) {
      expect(body(selector), selector).not.toMatch(/rgba\(\s*(1[0-9]{2}|2[0-5][0-9]),\s*(9[0-9]|1[0-4][0-9]),\s*2[0-9]{2}\)/);
    }
  });

  it("leaves the auth gate alone, which is intentionally a light-only screen", () => {
    expect(css).toMatch(/\.kairema-auth-gate\{[^}]*background:#f3f2ed/);
  });
});
