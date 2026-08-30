import { TRPCError } from "@trpc/server";

export type TransactionalEmailInput = {
  to: string;
  subject: string;
  html: string;
};

const SUBJECT_MAX_LENGTH = 255;
const HTML_MAX_LENGTH = 1024 * 1024;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function validateEmailInput(input: TransactionalEmailInput): TransactionalEmailInput {
  if (!isNonEmptyString(input.to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Recipient email is required.",
    });
  }
  if (!isNonEmptyString(input.subject)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Email subject is required.",
    });
  }
  if (!isNonEmptyString(input.html)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Email body is required.",
    });
  }

  const to = input.to.trim();
  const subject = input.subject.trim();
  const html = input.html.trim();

  if (subject.length > SUBJECT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Email subject must be at most ${SUBJECT_MAX_LENGTH} characters.`,
    });
  }
  if (html.length > HTML_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Email body must be at most ${HTML_MAX_LENGTH} characters.`,
    });
  }

  return { to, subject, html };
}

function getResendApiKey(): string {
  return process.env.RESEND_API_KEY?.trim() ?? "";
}

const lastTestEmailAt = new Map<string, number>();
const TEST_EMAIL_COOLDOWN_MS = 60 * 1000;

export function assertTestEmailAllowed(recipient: string): void {
  const now = Date.now();
  const previous = lastTestEmailAt.get(recipient) ?? 0;
  if (now - previous < TEST_EMAIL_COOLDOWN_MS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Test email was sent too recently. Wait a minute and try again.",
    });
  }
  lastTestEmailAt.set(recipient, now);
}

/**
 * Sends a transactional email through Resend.
 * Returns `true` if the request was accepted, `false` when the upstream
 * service cannot be reached or the API key is missing.
 */
export async function sendTransactionalEmail(
  input: TransactionalEmailInput
): Promise<boolean> {
  const { to, subject, html } = validateEmailInput(input);
  const apiKey = getResendApiKey();

  if (!apiKey) {
    console.warn("[Email] Resend API key is not configured.");
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Kairema <no-reply@kairema.dev>",
        to,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Email] Resend rejected email (${response.status} ${response.statusText})${
          detail ? `: ${detail}` : ""
        }`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.warn("[Email] Error calling Resend:", error);
    return false;
  }
}

export function resetTestEmailCooldown(recipient?: string): void {
  if (recipient) {
    lastTestEmailAt.delete(recipient);
  } else {
    lastTestEmailAt.clear();
  }
}
