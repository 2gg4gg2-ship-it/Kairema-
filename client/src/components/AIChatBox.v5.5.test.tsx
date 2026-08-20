// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatBox } from "./AIChatBox";

describe("AIChatBox mandatory web-search contract", () => {
  it("does not expose a client-side web-search toggle", () => {
    render(<AIChatBox messages={[]} onSendMessage={vi.fn()} emptyStateMessage="Kairema" />);
    expect(screen.queryByLabelText("Искать в интернете")).toBeNull();
  });
});
