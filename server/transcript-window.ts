/**
 * Server-only LLM transcript policy. It never deletes or mutates stored chat
 * history: callers receive one bounded, chronological dialogue tail per request.
 */
export type TranscriptRole = "fast" | "smart" | "context" | "flagship";
export type TranscriptMessage = {
  id?: number;
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
};

export type TranscriptWindowBudget = {
  /** Hard upper bound for transcript text only; system/memory/search are separate layers. */
  maxContentChars: number;
  /** Bounded DB candidate scan; selected context may contain fewer messages. */
  maxCandidateMessages: number;
  /** Maximum number of coherent earlier user-led exchanges to retain. */
  maxPriorTurns: number;
};

/**
 * All current user messages are ingress-limited to 16,000 chars. Budgets leave
 * room for that complete active request and add role-specific coherent history.
 */
export const TRANSCRIPT_WINDOW_BUDGETS: Readonly<Record<TranscriptRole, TranscriptWindowBudget>> = {
  fast: { maxContentChars: 18_000, maxCandidateMessages: 12, maxPriorTurns: 4 },
  smart: { maxContentChars: 30_000, maxCandidateMessages: 20, maxPriorTurns: 8 },
  context: { maxContentChars: 48_000, maxCandidateMessages: 32, maxPriorTurns: 14 },
  flagship: { maxContentChars: 40_000, maxCandidateMessages: 28, maxPriorTurns: 12 },
};

function compareChronology(left: TranscriptMessage, right: TranscriptMessage) {
  const leftTime = left.createdAt?.getTime() ?? 0;
  const rightTime = right.createdAt?.getTime() ?? 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return (left.id ?? 0) - (right.id ?? 0);
}

function normalizeCandidateMessages(input: readonly TranscriptMessage[]) {
  const seenIds = new Set<number>();
  return input
    .filter((message): message is TranscriptMessage => Boolean(message)
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.trim().length > 0)
    .sort(compareChronology)
    .filter((message) => {
      if (!Number.isInteger(message.id)) return true;
      if (seenIds.has(message.id!)) return false;
      seenIds.add(message.id!);
      return true;
    });
}

function textSize(messages: readonly TranscriptMessage[]) {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function compactActiveUser(message: TranscriptMessage, budget: TranscriptWindowBudget): TranscriptMessage {
  if (message.content.length <= budget.maxContentChars) return message;
  // This does not occur on normal ingress (which caps messages at 16,000 chars),
  // but keeps the pure helper bounded if a legacy/imported record is malformed.
  return { ...message, content: message.content.slice(0, budget.maxContentChars) };
}

/**
 * Selects the active user message and then expands backwards by complete,
 * immediately-adjacent user-led exchanges. This is deliberately not arbitrary
 * top-N sampling: it preserves a contiguous conversational tail while enforcing
 * deterministic message/character/turn budgets.
 */
export function selectTranscriptWindow(role: TranscriptRole, candidates: readonly TranscriptMessage[]) {
  const budget = TRANSCRIPT_WINDOW_BUDGETS[role];
  const normalized = normalizeCandidateMessages(candidates);
  const activeUserIndex = normalized.map((message) => message.role).lastIndexOf("user");
  if (activeUserIndex < 0) {
    return { messages: [] as TranscriptMessage[], budget, candidateCount: normalized.length, selectedContentChars: 0, selectedPriorTurns: 0, truncated: normalized.length > 0 };
  }

  const activeUser = compactActiveUser(normalized[activeUserIndex]!, budget);
  const selected: TranscriptMessage[] = [activeUser];
  let selectedChars = activeUser.content.length;
  let selectedPriorTurns = 0;
  let cursor = activeUserIndex;

  while (cursor > 0 && selectedPriorTurns < budget.maxPriorTurns && selected.length < budget.maxCandidateMessages) {
    const priorUserIndex = normalized.slice(0, cursor).map((message) => message.role).lastIndexOf("user");
    if (priorUserIndex < 0) break;
    const priorTurn = normalized.slice(priorUserIndex, cursor);
    const nextCount = selected.length + priorTurn.length;
    const nextChars = selectedChars + textSize(priorTurn);
    if (nextCount > budget.maxCandidateMessages || nextChars > budget.maxContentChars) break;
    selected.unshift(...priorTurn);
    selectedChars = nextChars;
    selectedPriorTurns += 1;
    cursor = priorUserIndex;
  }

  return {
    messages: selected,
    budget,
    candidateCount: normalized.length,
    selectedContentChars: selectedChars,
    selectedPriorTurns,
    truncated: selected.length < normalized.length,
  };
}
