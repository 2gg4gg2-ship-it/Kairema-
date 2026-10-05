/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import AiTerminalCard from "./AiTerminalCard";
import type { TerminalExecutionStep } from "@/lib/ai-terminal-agent";

// Testing Library does not clean up between tests in every version, and a second render would
// double every count and every role query.
afterEach(cleanup);

const step = (over: Partial<TerminalExecutionStep>): TerminalExecutionStep => ({
  id: "s1", command: "ls -la", status: "success", preview: "total 0", exitCode: 0, timedOut: false, ...over,
});

describe("AiTerminalCard", () => {
  it("renders nothing when no command ran", () => {
    const { container } = render(<AiTerminalCard steps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the command and its state, folded by default", () => {
    render(<AiTerminalCard steps={[step({})]} />);
    expect(screen.getByTestId("ai-terminal-card")).toBeTruthy();
    expect(screen.getByText("ls -la")).toBeTruthy();
    expect(screen.getByText("готово")).toBeTruthy();
    // The preview is behind the disclosure, not in the transcript.
    expect(screen.queryByText("total 0")).toBeNull();
  });

  it("reveals output on demand", async () => {
    render(<AiTerminalCard steps={[step({})]} />);
    await userEvent.click(within(screen.getByTestId("ai-terminal-step")).getByRole("button"));
    expect(screen.getByText("total 0")).toBeTruthy();
  });

  it("surfaces a non-zero exit code and a timeout rather than hiding them", () => {
    render(<AiTerminalCard steps={[
      step({ id: "a", command: "false", status: "error", exitCode: 1, timedOut: true, preview: "" }),
    ]} />);
    expect(screen.getByText(/ошибка/).textContent).toContain("таймаут");
  });

  it("marks a command that needs confirmation", () => {
    render(<AiTerminalCard steps={[
      step({ id: "b", command: "rm -rf /", status: "confirmation", preview: "", exitCode: null }),
    ]} />);
    expect(screen.getByText("нужно подтверждение")).toBeTruthy();
  });

  it("lists every command the model ran", () => {
    render(<AiTerminalCard steps={[
      step({ id: "a", command: "cd /home/kairema", status: "success" }),
      step({ id: "b", command: "ls", status: "error", exitCode: 2, preview: "" }),
    ]} />);
    expect(screen.getAllByTestId("ai-terminal-step")).toHaveLength(2);
  });
});