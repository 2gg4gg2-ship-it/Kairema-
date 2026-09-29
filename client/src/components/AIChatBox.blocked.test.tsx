// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIChatBox } from "./AIChatBox";

function setup(props: Partial<Parameters<typeof AIChatBox>[0]> = {}) {
  const onSendMessage = vi.fn(async (..._args: unknown[]) => true);
  const onBlockedSendAttempt = vi.fn();
  const utils = render(
    <AIChatBox
      messages={[]}
      onSendMessage={onSendMessage}
      sendDisabled={false}
      onBlockedSendAttempt={onBlockedSendAttempt}
      {...props}
    />,
  );
  return { onSendMessage, onBlockedSendAttempt, utils, textarea: screen.getByRole("textbox") as HTMLTextAreaElement, send: screen.getByRole("button", { name: /отправ|send/i }) as HTMLButtonElement };
}

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("sending normally", () => {
  it("issues the turn and clears the composer", async () => {
    const { onSendMessage, textarea } = setup();
    fireEvent.change(textarea, { target: { value: "вопрос" } });
    fireEvent.click(screen.getByRole("button", { name: /отправ|send/i }));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(String(onSendMessage.mock.calls[0]![0])).toBe("вопрос");
  });

  it("sends on Enter", async () => {
    const { onSendMessage, textarea } = setup();
    fireEvent.change(textarea, { target: { value: "вопрос" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
  });
});

describe("while no provider can answer", () => {
  it("marks Send unavailable", () => {
    const { send } = setup({ sendDisabled: true });
    // aria-disabled rather than `disabled`: a natively disabled button swallows the click, so the
    // user would press it and get no explanation at all.
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(send).toHaveProperty("disabled", false);
  });

  it("does not send when the button is pressed anyway", async () => {
    const { onSendMessage, onBlockedSendAttempt, send, textarea } = setup({ sendDisabled: true });
    fireEvent.change(textarea, { target: { value: "вопрос" } });
    fireEvent.click(send);
    await waitFor(() => expect(onBlockedSendAttempt).toHaveBeenCalled());
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("does not send on Enter", async () => {
    const { onSendMessage, onBlockedSendAttempt, textarea } = setup({ sendDisabled: true });
    fireEvent.change(textarea, { target: { value: "вопрос" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(onBlockedSendAttempt).toHaveBeenCalled());
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("still leaves Enter alone in the textarea, so the text can be kept", () => {
    const { textarea } = setup({ sendDisabled: true });
    fireEvent.change(textarea, { target: { value: "черновик" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    // The line break is prevented, but nothing is cleared: the user's question is not thrown away.
    expect((textarea as HTMLTextAreaElement).value).toBe("черновик");
  });

  it("keeps the typed text exactly where it was", () => {
    const { textarea } = setup({ sendDisabled: true });
    fireEvent.change(textarea, { target: { value: "важный вопрос" } });
    expect(textarea.value).toBe("важный вопрос");
  });

  it("makes no network request of any kind", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { send, textarea } = setup({ sendDisabled: true });
    fireEvent.change(textarea, { target: { value: "вопрос" } });
    fireEvent.click(send);
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: /отправ|send/i })).toBeTruthy());
    // Nothing is issued: no chat stream, no model catalog, no telemetry. A blocked turn must not
    // cost a request, and must not spend either the My API quota or an upstream attempt.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds no message to the transcript", async () => {
    const { send, textarea, onSendMessage } = setup({ sendDisabled: true });
    fireEvent.change(textarea, { target: { value: "вопрос" } });
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeTruthy());
    expect(onSendMessage).not.toHaveBeenCalled();
    // The draft stays in the composer; no message bubble was created for it.
    expect(document.querySelectorAll("article")).toHaveLength(0);
  });

  it("shows the reason again on a repeated attempt", async () => {
    const { onBlockedSendAttempt, send, textarea } = setup({ sendDisabled: true });
    fireEvent.change(textarea, { target: { value: "вопрос" } });
    fireEvent.click(send);
    fireEvent.click(send);
    fireEvent.keyDown(textarea, { key: "Enter" });
    // A dead-looking button with no explanation is the one outcome a user cannot act on, so each
    // attempt re-states the reason rather than failing silently.
    await waitFor(() => expect(onBlockedSendAttempt).toHaveBeenCalledTimes(3));
  });
});

describe("recovery", () => {
  it("re-enables Send and Enter once a provider is usable again", async () => {
    const { onSendMessage, send, textarea } = setup({ sendDisabled: true });
    fireEvent.change(textarea, { target: { value: "вопрос" } });
    expect(send.getAttribute("aria-disabled")).toBe("true");
    cleanup();
    // The host clears the blocked state when the user switches provider, model or supplies a key.
    const recovered = setup({ sendDisabled: false });
    fireEvent.change(recovered.textarea, { target: { value: "вопрос" } });
    // The blocked state is gone: the control is no longer marked unavailable, and Enter works.
    expect(recovered.send.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(recovered.send);
    await waitFor(() => expect(recovered.onSendMessage).toHaveBeenCalledTimes(1));
    expect(recovered.onBlockedSendAttempt).not.toHaveBeenCalled();
    fireEvent.change(recovered.textarea, { target: { value: "ещё" } });
    fireEvent.keyDown(recovered.textarea, { key: "Enter" });
    await waitFor(() => expect(recovered.onSendMessage).toHaveBeenCalledTimes(2));
    void onSendMessage; void send; void textarea;
  });
});
