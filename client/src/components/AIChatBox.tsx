import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { MAX_COMPOSER_IMAGES, optimizeImageForUpload } from "@/lib/image-attachments";
import { Copy, Download, FileImage, FileText, ChevronRight, Clock3, ExternalLink, Link2, Loader2, LogIn, Paperclip, Send, Square, Trash2, Sparkles, X } from "lucide-react";
import { Drawer as DrawerPrimitive } from "vaul";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";

export type ChatAttachment = { id: string; fileName: string; mimeType: string; sizeBytes: number; kind: "image" | "document"; previewUrl?: string };
export type SourceEvidence = { title: string; url: string; publishedAt?: string };
export type ComposerUploadResult = { attachments: ChatAttachment[]; sessionId: string };
type PendingLocalAttachment = { id: string; file: File; previewUrl?: string; timedOut: boolean; failed?: boolean };
export type Message = {
  id?: string;
  role: "system" | "user" | "assistant";
  content: string;
  providerLabel?: string;
  model?: string;
  /** Фактическое название LLM, которое реально ответило. Ролевые метки (Flash/Think/Context/Apex) сюда не попадают. */
  modelLabel?: string;
  isError?: boolean;
  createdAt?: Date | string;
  searchStatus?: { state: "found" | "empty" | "degraded" | "error"; verificationStatus?: "verified" | "no_results" | "degraded" | "unavailable"; sourcesCount: number; freshnessBlocked?: boolean; staleRagOnly?: boolean; sourceDateMin?: string; sourceDateMax?: string; liveValue?: { kind: "temperature" | "conditions" | "clock" | "rate"; status: "confirmed" | "unconfirmed" | "not_found" } };
  sources?: SourceEvidence[];
  webGrounding?: { intent: "PREFERRED" | "REQUIRED"; state: "verified" | "disabled" | "empty" | "degraded" | "unavailable" | "admission_denied"; sourcesCount: number; citations: SourceEvidence[]; freshnessBlocked?: boolean };
  attachments?: ChatAttachment[];
};

type Language = "ru" | "en";
type AIChatBoxProps = {
  messages: Message[];
  onSendMessage: (content: string, options?: { attachmentIds?: string[]; attachments?: ChatAttachment[]; clientMessageId?: string }) => void | Promise<boolean>;
  onUploadFiles?: (files: File[]) => Promise<ComposerUploadResult>;
  onRemoveAttachment?: (attachment: ChatAttachment) => Promise<void> | void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  height?: string | number;
  emptyStateMessage?: string;
  guestLoginAction?: { label: string; onClick: () => void };
  aboveMessages?: React.ReactNode;
  onExportMarkdown?: () => void;
  onExportPdf?: () => void;
  canExport?: boolean;
  exportBusy?: "markdown" | "pdf" | null;
  exportError?: string;
  onCopyAssistant?: (message: Message) => void;
  onCopyUser?: (message: Message) => void;
  onCancelStream?: () => void;
  composerValue?: string;
  onComposerValueChange?: (value: string) => void;
  onOpenTemplates?: () => void;
  uploadStatus?: string;
  composerSessionId?: string;
  language?: Language;
  hasOlderHistory?: boolean;
  isLoadingOlderHistory?: boolean;
  onLoadOlderHistory?: () => void;
  /** Bumped by the host whenever a navigation surface outside the composer opens or the active chat changes. */
  navigationCloseSignal?: number;
};

const copy = {
  ru: { history: "История чата", markdown: "Markdown", pdf: "PDF", preparing: "Готовим…", fourRoles: "Выберите одну из четырёх ролей. Kairema покажет подтверждённый статус до отправки запроса.", copy: "Копировать", selectText: "Выбрать текст", copySelected: "Копировать выбранное", selectionInstructions: "Выделите нужный фрагмент сообщения", selectionCopied: "Выбранный фрагмент скопирован.", done: "Готово", typing: "Kairema готовит ответ", send: "Отправить сообщение", stop: "Отменить генерацию", attach: "Добавить вложение", attachPhoto: "Выбрать фото", attachFile: "Выбрать файл", remove: "Убрать вложение", preview: "Открыть предпросмотр", previewTitle: "Предпросмотр вложения", previewUnavailable: "Предпросмотр недоступен", search: "Искать в интернете", searchUnavailable: "Поиск сейчас недоступен", freshnessHint: "Запрос может зависеть от актуальных данных. При необходимости включите поиск в интернете.", disclaimer: "Ответы генерируются выбранной моделью. Проверяйте важные сведения.", uploading: "Загрузка…", uploadTimedOut: "Загрузка заняла больше 15 секунд. Проверьте сеть и повторите.", uploadFailed: "Не удалось загрузить вложение. Проверьте файл и повторите.", retryUpload: "Повторить загрузку", sourcesHeading: "Ссылки и источники", sourceOne: "источник", sourceFew: "источника", sourceMany: "источников", sourceOpen: "Открыть источник", sourcesAction: "Источники", sourcesSheetSubtitle: "Проверенные источники", closeSources: "Закрыть список источников", collapse: "Свернуть", expand: "Развернуть" },
  en: { history: "Chat history", markdown: "Markdown", pdf: "PDF", preparing: "Preparing…", fourRoles: "Choose one of four roles. Kairema shows the confirmed status before a request is sent.", copy: "Copy", selectText: "Select text", copySelected: "Copy selection", selectionInstructions: "Select the needed part of this message", selectionCopied: "Selected text copied.", done: "Done", typing: "Kairema is preparing an answer", send: "Send message", stop: "Stop generation", attach: "Add attachment", attachPhoto: "Choose photo", attachFile: "Choose file", remove: "Remove attachment", preview: "Open preview", previewTitle: "Attachment preview", previewUnavailable: "Preview unavailable", search: "Search the web", searchUnavailable: "Web search is unavailable", freshnessHint: "This request may depend on current information. Enable web search if needed.", disclaimer: "Answers are generated by the selected model. Verify important information.", uploading: "Uploading…", uploadTimedOut: "Upload is taking longer than 15 seconds. Check the connection and retry.", uploadFailed: "Attachment upload failed. Check the file and retry.", retryUpload: "Retry upload", sourcesHeading: "Links and sources", sourceOne: "source", sourceFew: "sources", sourceMany: "sources", sourceOpen: "Open source", sourcesAction: "Sources", sourcesSheetSubtitle: "Verified sources", closeSources: "Close sources", collapse: "Collapse", expand: "Expand" },
} as const;

type SourceCopy = (typeof copy)[Language];

/** Russian counts a source, two sources and five sources differently; English does not. */
function sourcesCountLabel(count: number, language: Language, t: SourceCopy) {
  if (count <= 0) return "";
  if (language !== "ru") return `${count} ${count === 1 ? t.sourceOne : t.sourceMany}`;
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${t.sourceMany}`;
  if (mod10 === 1) return `${count} ${t.sourceOne}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${t.sourceFew}`;
  return `${count} ${t.sourceMany}`;
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The date one source carries, in the same short form as the block's own range. */
function sourceDate(publishedAt: string | undefined, language: Language) {
  if (!publishedAt) return "";
  const parsed = new Date(publishedAt);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", { dateStyle: "short" }).format(parsed);
}

/** The verified sources a message actually exposes. Empty means the honest status stays text-only. */
function messageSources(message: Message): SourceEvidence[] {
  const grounded = message.webGrounding;
  if (grounded?.state === "verified") return grounded.citations;
  if (message.searchStatus?.freshnessBlocked) return [];
  return message.searchStatus?.verificationStatus === "verified" ? message.sources ?? [] : [];
}

/**
 * One source inside the sheet. The whole card is a single link, so a tap anywhere on it opens the
 * source, and the accessible name stays exactly the source title while the host, the date and the
 * URL remain readable as the link's own content. Nothing is invented: the middle line is the URL's
 * own host plus the date the source already carries.
 */
function SourceCard({ source, language, t }: { source: SourceEvidence; language: Language; t: SourceCopy }) {
  const titleId = useId();
  const host = sourceHost(source.url);
  const date = sourceDate(source.publishedAt, language);
  const meta = [host, date].filter(Boolean).join(" · ");
  const initial = (host || source.title).replace(/^www\./, "").charAt(0).toUpperCase();
  return (
    <li className="kairema-source-item">
      <a className="kairema-source-card" href={source.url} target="_blank" rel="noreferrer noopener" aria-labelledby={titleId} title={source.title}>
        <span className="kairema-source-icon" aria-hidden="true">
          <span className="kairema-source-initial">{initial}</span>
          {host ? <img className="kairema-source-favicon" src={`https://${host}/favicon.ico`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
        </span>
        <span className="kairema-source-copy">
          <span className="kairema-source-title" id={titleId}>{source.title}</span>
          {meta ? <span className="kairema-source-meta-line">{meta}</span> : null}
          <span className="kairema-source-url">{source.url}</span>
        </span>
        <span className="kairema-source-open" aria-hidden="true"><ExternalLink className="size-4" /></span>
        <span className="sr-only">{t.sourceOpen}</span>
      </a>
    </li>
  );
}

/**
 * The bottom sheet that holds the whole source list. One component, opened from both entry points:
 * the pill in the message action row and the chip at the end of the answer. It covers the chat with
 * a scrim, keeps its own fixed height so only the list scrolls, and closes on the × button, on a tap
 * outside, on a downward swipe (fast flick, or a slow drag past a third of the sheet) and on the
 * Android back gesture.
 */
function SourcesSheet({ message, language, t, onClose }: { message: Message | null; language: Language; t: SourceCopy; onClose: () => void }) {
  const subtitleId = useId();
  const sources = message ? messageSources(message) : [];
  const count = message ? message.searchStatus?.sourcesCount ?? message.webGrounding?.sourcesCount ?? sources.length : 0;
  const countLabel = sourcesCountLabel(count, language, t);
  return (
    <DrawerPrimitive.Root open={Boolean(message)} onOpenChange={(open) => { if (!open) onClose(); }} closeThreshold={0.35} autoFocus={false}>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="kairema-sources-sheet-overlay" />
        <DrawerPrimitive.Content className="kairema-sources-sheet" aria-describedby={sources.length ? subtitleId : undefined}>
          <DrawerPrimitive.Title className="kairema-sources-sheet-title">
            <Link2 className="size-5" aria-hidden="true" />
            {t.sourcesAction}
            <button type="button" className="kairema-sources-sheet-close" onClick={onClose} aria-label={t.closeSources}><X className="size-5" /></button>
          </DrawerPrimitive.Title>
          <DrawerPrimitive.Description className="kairema-sources-sheet-subtitle" id={subtitleId}>{t.sourcesSheetSubtitle}{countLabel ? ` · ${countLabel}` : ""}</DrawerPrimitive.Description>
          <ul className="kairema-source-list" aria-labelledby={subtitleId}>
            {sources.map((source) => <SourceCard key={source.url} source={source} language={language} t={t} />)}
          </ul>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}

/** Closes the sheet on the Android back gesture instead of letting it leave the page. */
function useAndroidBackDismiss(open: boolean, onClose: () => void) {
  const pushedRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    pushedRef.current = true;
    window.history.pushState({ ...(window.history.state as object | null), kairemaSourcesSheet: true }, "");
    const handlePopState = () => { pushedRef.current = false; onClose(); };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (pushedRef.current) { pushedRef.current = false; window.history.back(); }
    };
  }, [open, onClose]);
}


export function formatAttachmentSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "";
  if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(sizeBytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Defense in depth for legacy assistant records created before server-side source redaction. */
export function redactLegacyAssistantReferences(value: string) {
  return value
    .replace(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:ссылки\s+на\s+источники?|источники|sources?)\s*:?\s*(?=\n|$)/gim, "\n")
    .replace(/\[[^\]]+\]\(https?:\/\/[^)\s]+\)/gi, "")
    .replace(/(?:^|\n)\s*(?:[-*•]\s*)?https?:\/\/[^\s<>()\[\]{}]+/gim, "")
    .replace(/https?:\/\/[^\s<>()\[\]{}]+/gi, "")
    .replace(/\s*\[(?:(?:source|cite|citation|web|search|источник|ссылка)\b[^\]\r\n]*)\]/gi, "")
    .replace(/\s*【[^】]*(?:(?:source|cite|citation|web|search|источник|ссылка)|†)[^】]*】/gi, "")
    .replace(/\s*⟦(?:(?:source|cite|citation|web|search|источник|ссылка)\b[^⟧\r\n]*)⟧/gi, "")
    .replace(/\s*\\*\[\s*(?:[a-f0-9]{12,}(?:\s*,\s*[a-f0-9]{12,})+)\s*\\*\]/gi, "")
    .replace(/\s+\[(?:\d{1,3}(?:\s*,\s*\d{1,3})*)\](?=[.,;:!?)]?(?:[\t ]*(?:\r?\n|$)))/g, "")
    .replace(/(?:^|\n)\s*[-*•]\s*(?=\n|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function AIChatBox({
  messages, onSendMessage, onUploadFiles, isLoading = false, placeholder, className, height, emptyStateMessage,
  guestLoginAction, aboveMessages,
  onExportMarkdown, onExportPdf, canExport = false, exportBusy = null, exportError = "",
  onCopyAssistant, onCopyUser, onCancelStream, composerValue, onComposerValueChange, onOpenTemplates, uploadStatus = "", composerSessionId = "new-composer", language = "ru", onRemoveAttachment, hasOlderHistory = false, isLoadingOlderHistory = false,   onLoadOlderHistory, navigationCloseSignal = 0,
}: AIChatBoxProps) {
  const t = copy[language];
  const attachmentInputLabel = language === "ru" ? "Выбрать файл для вложения" : "Choose a file to attach";
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [pendingLocalAttachments, setPendingLocalAttachments] = useState<PendingLocalAttachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState("");
  // The "Choose photo / Choose file" popover is a native <details>; it is tracked in
  // state so it can be dismissed when the user opens any other interface.
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const attachmentMenuRef = useRef<HTMLDetailsElement | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const preserveHistoryScrollRef = useRef<{ height: number; top: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const messageTextRefs = useRef(new Map<number, HTMLDivElement>());
  const longPressTimerRef = useRef<number | null>(null);
  const [longPressMessageIndex, setLongPressMessageIndex] = useState<number | null>(null);
  const [sourcesSheetIndex, setSourcesSheetIndex] = useState<number | null>(null);
  const closeSourcesSheet = useCallback(() => setSourcesSheetIndex(null), []);
  useAndroidBackDismiss(sourcesSheetIndex !== null, closeSourcesSheet);
  const [selectionModeMessageIndex, setSelectionModeMessageIndex] = useState<number | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");
  const suppressLongPressClickRef = useRef<number | null>(null);
  const localObjectUrlsRef = useRef(new Set<string>());
  const composerSessionRef = useRef(composerSessionId);
  const previousComposerSessionRef = useRef(composerSessionId);
  const pendingLocalAttachmentsRef = useRef<PendingLocalAttachment[]>([]);
  const uploadInFlightRef = useRef(false);
  const composerInputRef = useRef("");
  composerSessionRef.current = composerSessionId;
  pendingLocalAttachmentsRef.current = pendingLocalAttachments;
  uploadInFlightRef.current = isUploading;
  const displayMessages = messages.filter((message) => message.role !== "system");
  const effectivePlaceholder = placeholder ?? (language === "ru" ? "Напишите сообщение…" : "Write a message…");
  const currentInput = composerValue ?? input;
  composerInputRef.current = currentInput;
  const setComposerInput = (value: string) => { composerInputRef.current = value; setInput(value); onComposerValueChange?.(value); };

  const clearLongPress = () => { if (longPressTimerRef.current !== null) { window.clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } };
  const openTextSelectionMenu = (index: number) => {
    if (selectionModeMessageIndex !== null) return;
    clearLongPress();
    suppressLongPressClickRef.current = index;
    setSelectedText("");
    setSelectionNotice("");
    setLongPressMessageIndex(index);
  };
  const startLongPress = (index: number, pointerType: string) => {
    if (pointerType !== "touch" || selectionModeMessageIndex !== null) return;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => { longPressTimerRef.current = null; openTextSelectionMenu(index); }, 520);
  };
  const handleMessageContextMenu = (index: number, event: React.MouseEvent<HTMLDivElement>) => {
    if (selectionModeMessageIndex !== null) return;
    event.preventDefault();
    openTextSelectionMenu(index);
  };
  const consumeLongPressClick = (index: number) => { if (suppressLongPressClickRef.current !== index) return false; suppressLongPressClickRef.current = null; return true; };
  const selectedTextInsideMessage = (index: number) => {
    const selection = window.getSelection();
    const bubble = messageTextRefs.current.get(index);
    const text = selection?.toString().trim() ?? "";
    const isInsideBubble = Boolean(bubble && selection?.anchorNode && selection?.focusNode && bubble.contains(selection.anchorNode) && bubble.contains(selection.focusNode));
    return isInsideBubble ? text : "";
  };
  const captureSelectedText = (index: number) => {
    if (selectionModeMessageIndex !== index) return;
    const text = selectedTextInsideMessage(index);
    setSelectedText(text);
    setSelectionNotice(text ? "" : t.selectionInstructions);
  };
  const selectMessageText = (index: number) => { const node = messageTextRefs.current.get(index); if (!node) return; window.getSelection()?.removeAllRanges(); setSelectedText(""); setLongPressMessageIndex(index); setSelectionModeMessageIndex(index); setSelectionNotice(t.selectionInstructions); window.requestAnimationFrame(() => node.focus()); };
  const copySelectedText = async () => {
    const activeIndex = selectionModeMessageIndex;
    const text = activeIndex === null ? "" : selectedTextInsideMessage(activeIndex) || selectedText;
    if (!text) { setSelectionNotice(t.selectionInstructions); return; }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const fallback = document.createElement("textarea");
        fallback.value = text;
        fallback.setAttribute("readonly", "");
        fallback.style.position = "fixed";
        fallback.style.opacity = "0";
        document.body.appendChild(fallback);
        fallback.select();
        const copied = document.execCommand("copy");
        fallback.remove();
        if (!copied) throw new Error("clipboard_unavailable");
      }
      setSelectedText(text);
      setSelectionNotice(t.selectionCopied);
    } catch { setSelectionNotice(language === "ru" ? "Не удалось скопировать выбранный фрагмент." : "Could not copy the selected text."); }
  };
  const closeTextSelection = () => { window.getSelection()?.removeAllRanges(); setSelectedText(""); setLongPressMessageIndex(null); setSelectionModeMessageIndex(null); setSelectionNotice(""); };

  useEffect(() => {
    // Any navigation outside the composer (history, settings, sidebar, another chat)
    // bumps the signal owned by Home, which dismisses the photo/file menu.
    setAttachmentMenuOpen(false);
  }, [navigationCloseSignal]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const pending = preserveHistoryScrollRef.current;
    if (pending) {
      if (!isLoadingOlderHistory && viewport.scrollHeight > pending.height) {
        viewport.scrollTop = pending.top + (viewport.scrollHeight - pending.height);
        preserveHistoryScrollRef.current = null;
      }
      return;
    }
    if (!isLoadingOlderHistory) viewport.scrollTo?.({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [displayMessages.length, isLoading, isLoadingOlderHistory]);
  const loadOlderHistory = () => {
    const viewport = viewportRef.current;
    if (viewport) preserveHistoryScrollRef.current = { height: viewport.scrollHeight, top: viewport.scrollTop };
    onLoadOlderHistory?.();  };
  useEffect(() => {
    const syncSelection = () => { if (selectionModeMessageIndex !== null) captureSelectedText(selectionModeMessageIndex); };
    document.addEventListener("selectionchange", syncSelection);
    return () => document.removeEventListener("selectionchange", syncSelection);
  }, [selectionModeMessageIndex, t.selectionInstructions]);
  const revokeLocalPreview = (previewUrl?: string) => {
    if (previewUrl?.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(previewUrl);
      localObjectUrlsRef.current.delete(previewUrl);
    }
  };
  useEffect(() => () => { clearLongPress(); localObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)); localObjectUrlsRef.current.clear(); }, []);
  useEffect(() => {
    const previousSessionId = previousComposerSessionRef.current;
    previousComposerSessionRef.current = composerSessionId;
    const isUploadCreatingItsOwnChat = previousSessionId === "new-composer" && composerSessionId !== "new-composer" && uploadInFlightRef.current && pendingLocalAttachmentsRef.current.length > 0;
    if (isUploadCreatingItsOwnChat) return;
    setAttachments([]); setPreviewAttachment(null); setPendingLocalAttachments((items) => { items.forEach((item) => revokeLocalPreview(item.previewUrl)); return []; }); setIsUploading(false); if (fileInputRef.current) fileInputRef.current.value = "";
  }, [composerSessionId]);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const value = currentInput.trim();
    if (!value || isLoading || isUploading || pendingLocalAttachments.length > 0) return;
    const typedValue = currentInput;
    setComposerInput("");
    const sent = await onSendMessage(value, { attachmentIds: attachments.map((attachment) => attachment.id), attachments, clientMessageId: crypto.randomUUID() });
    if (sent === false) { if (!composerInputRef.current) setComposerInput(typedValue); return; }
    setAttachments([]);
    textareaRef.current?.focus();
  };

  const uploadPendingLocalAttachments = async (localItems: PendingLocalAttachment[]) => {
    if (!onUploadFiles || !localItems.length) return;
    setIsUploading(true);
    const expectedSessionId = composerSessionId;
    try {
      const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("upload_timeout")), 15_000));
      const result = await Promise.race([onUploadFiles(localItems.map((item) => item.file)), timeout]);
      const isSameComposerSession = composerSessionRef.current === expectedSessionId && result.sessionId === expectedSessionId;
      const isUploadCreatedChat = expectedSessionId === "new-composer" && result.sessionId !== "new-composer" && (composerSessionRef.current === "new-composer" || composerSessionRef.current === result.sessionId);
      if (isSameComposerSession || isUploadCreatedChat) setAttachments((current) => [...current, ...result.attachments]);
      setPendingLocalAttachments((items) => {
        const uploaded = items.filter((item) => !localItems.some((local) => local.id === item.id));
        items.filter((item) => localItems.some((local) => local.id === item.id)).forEach((item) => revokeLocalPreview(item.previewUrl));
        return uploaded;
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "upload_timeout";
      setPendingLocalAttachments((items) => items.map((item) => localItems.some((local) => local.id === item.id) ? { ...item, timedOut, failed: !timedOut } : item));
    }
    finally {
      const remainedOnExpectedSession = composerSessionRef.current === expectedSessionId;
      const movedToUploadCreatedChat = expectedSessionId === "new-composer" && composerSessionRef.current !== "new-composer";
      if (remainedOnExpectedSession || movedToUploadCreatedChat) {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    }
  };
  const addFiles = async (files: FileList | null) => {
    if (!files?.length || !onUploadFiles || isLoading || isUploading || isPreparingAttachments) return;
    const remainingSlots = Math.max(0, MAX_COMPOSER_IMAGES - attachments.length - pendingLocalAttachments.length);
    if (!remainingSlots) { setAttachmentNotice(language === "ru" ? "Можно добавить не более четырёх вложений к одному сообщению." : "You can add up to four attachments to one message."); return; }
    const selectedFiles = Array.from(files).slice(0, remainingSlots);
    setAttachmentNotice(selectedFiles.length < files.length ? (language === "ru" ? "Добавлены первые четыре вложения." : "Only the first four attachments were added.") : "");
    setIsPreparingAttachments(true);
    let preparedFiles: File[];
    try {
      preparedFiles = await Promise.all(selectedFiles.map((file) => file.type.startsWith("image/") ? optimizeImageForUpload(file) : Promise.resolve(file)));
    } catch (error) {
      setAttachmentNotice(error instanceof Error ? error.message : (language === "ru" ? "Не удалось подготовить вложение. Выберите другое фото." : "Could not prepare the attachment. Choose another photo."));
      return;
    } finally {
      setIsPreparingAttachments(false);
    }
    const localItems = preparedFiles.map((file): PendingLocalAttachment => {
      const previewUrl = file.type.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined;
      if (previewUrl) localObjectUrlsRef.current.add(previewUrl);
      return { id: `local-${crypto.randomUUID()}`, file, previewUrl, timedOut: false };
    });
    setPendingLocalAttachments((items) => [...items, ...localItems]);
    await uploadPendingLocalAttachments(localItems);
  };
  const retryPendingLocalAttachment = async (id: string) => {
    const localItem = pendingLocalAttachments.find((item) => item.id === id);
    if (!localItem || isUploading) return;
    setPendingLocalAttachments((items) => items.map((item) => item.id === id ? { ...item, timedOut: false, failed: false } : item));
    await uploadPendingLocalAttachments([localItem]);
  };
  const removeAttachment = async (attachment: ChatAttachment) => {
    await onRemoveAttachment?.(attachment);
    setAttachments((items) => items.filter((item) => item.id !== attachment.id));
  };
  const removePendingLocalAttachment = (id: string) => setPendingLocalAttachments((items) => {
    const removed = items.find((item) => item.id === id);
    revokeLocalPreview(removed?.previewUrl);
    return items.filter((item) => item.id !== id);
  });

  return (
    <section className={cn("kairema-chat flex min-h-0 flex-1 flex-col", className)} style={height ? { height } : undefined}>
      {exportError && <p className="kairema-export-error" role="status">{exportError}</p>}
      <div ref={viewportRef} className="kairema-chat-scroll">
        <div className="kairema-chat-sticky">
          {(onExportMarkdown || onExportPdf) && <div className="kairema-chat-tools"><span className="kairema-chat-tools-label"><Clock3 className="size-3.5" />{t.history}</span><div className="kairema-export-actions"><button type="button" onClick={onExportMarkdown} disabled={!canExport || Boolean(exportBusy)} className="kairema-export-button"><FileText className="size-3.5" />{exportBusy === "markdown" ? t.preparing : t.markdown}</button><button type="button" onClick={onExportPdf} disabled={!canExport || Boolean(exportBusy)} className="kairema-export-button"><Download className="size-3.5" />{exportBusy === "pdf" ? t.preparing : t.pdf}</button></div></div>}
          {aboveMessages}
        </div>
        {displayMessages.length === 0 ? <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center"><div className="kairema-orb mb-6"><Sparkles className="size-7" /></div><h2 className="text-2xl font-semibold tracking-tight text-foreground">{emptyStateMessage}</h2><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{t.fourRoles}</p>{guestLoginAction && <button type="button" className="kairema-guest-login kairema-guest-login-empty" onClick={guestLoginAction.onClick}><LogIn className="size-4" /><span>{guestLoginAction.label}</span></button>}</div> : <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-4 sm:px-8">{hasOlderHistory && <div className="flex justify-center"><button type="button" className="kairema-export-button" onClick={loadOlderHistory} disabled={isLoadingOlderHistory}>{isLoadingOlderHistory ? (language === "ru" ? "Загрузка…" : "Loading…") : (language === "ru" ? "Загрузить более ранние сообщения" : "Load older messages")}</button></div>}{displayMessages.map((message, index) => { const hasSources = message.role === "assistant" && messageSources(message).length > 0; return (<article key={message.id ?? `${message.role}-${index}`} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
          <div onPointerDown={(event) => startLongPress(index, event.pointerType || "touch")} onPointerUp={clearLongPress} onPointerCancel={clearLongPress} onPointerMove={clearLongPress} onTouchStart={() => startLongPress(index, "touch")} onTouchEnd={clearLongPress} onTouchCancel={clearLongPress} onContextMenu={(event) => handleMessageContextMenu(index, event)} className={cn("max-w-[86%] sm:max-w-[76%]", message.role === "user" && "flex flex-col items-end")}><div ref={(node) => { if (node) messageTextRefs.current.set(index, node); else messageTextRefs.current.delete(index); }} onPointerUp={() => captureSelectedText(index)} onTouchEnd={() => captureSelectedText(index)} onContextMenu={(event) => handleMessageContextMenu(index, event)} tabIndex={selectionModeMessageIndex === index ? 0 : undefined} className={cn("kairema-message", message.role === "user" ? "kairema-message-user" : "kairema-message-ai", message.isError && "kairema-message-error", selectionModeMessageIndex === index && "kairema-message-selection-mode")}>{message.role === "assistant" && !message.isError ? <div className="kairema-markdown text-sm leading-6"><InlineMarkdown text={redactLegacyAssistantReferences(message.content)} language={language} />{hasSources && <button type="button" className="kairema-sources-chip" onClick={() => setSourcesSheetIndex(index)}><Link2 className="size-3.5" />{t.sourcesAction}<ChevronRight className="size-3.5" /></button>}</div> : <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>}</div>
          {message.role === "user" && Boolean(message.attachments?.length) && <div className="kairema-message-attachments" aria-label={language === "ru" ? "Вложения сообщения" : "Message attachments"}>{message.attachments?.map((attachment) => <button key={attachment.id} type="button" className="kairema-attachment-chip kairema-attachment-open" onClick={() => { if (!consumeLongPressClick(index)) setPreviewAttachment(attachment); }} aria-label={`${t.preview}: ${attachment.fileName}`}>{attachment.kind === "image" && attachment.previewUrl ? <img src={attachment.previewUrl} alt="" className="kairema-message-image" /> : attachment.kind === "image" ? <FileImage className="size-3.5" /> : <FileText className="size-3.5" />}{attachment.kind === "document" && <span>{attachment.fileName}{formatAttachmentSize(attachment.sizeBytes) ? ` · ${formatAttachmentSize(attachment.sizeBytes)}` : ""}</span>}</button>)}</div>}
          {message.role === "assistant" && message.modelLabel && <p className="mt-2 px-1 text-xs text-muted-foreground">{message.modelLabel}</p>}
          {message.role === "assistant" && !message.isError && <div className="kairema-message-actions" aria-label="Actions"><button type="button" onClick={() => onCopyAssistant?.({ ...message, content: redactLegacyAssistantReferences(message.content) })} className="kairema-message-action"><Copy className="size-3.5" />{t.copy}</button></div>}
          {message.role === "user" && <div className="kairema-message-actions" aria-label="Actions"><button type="button" onClick={() => onCopyUser?.(message)} className="kairema-message-action"><Copy className="size-3.5" />{t.copy}</button></div>}
          {longPressMessageIndex === index && <div className="kairema-text-selection-menu" role="menu" aria-label={language === "ru" ? "Меню выбора текста" : "Text selection menu"}><button type="button" role="menuitem" className="kairema-message-action" onClick={() => selectMessageText(index)}>{t.selectText}</button>{selectionModeMessageIndex === index && <><button type="button" role="menuitem" className="kairema-message-action" onClick={() => void copySelectedText()}>{t.copySelected}</button><button type="button" role="menuitem" className="kairema-message-action" onClick={closeTextSelection}>{t.done}</button><p role="status" className="kairema-selection-notice">{selectionNotice || t.selectionInstructions}</p></>}</div>}</div></article>); })}{isLoading && displayMessages.at(-1)?.role !== "assistant" && <div className="flex items-center"><div className="kairema-typing"><Loader2 className="size-4 animate-spin" /> {t.typing}</div></div>}</div>}
      </div>
      <form onSubmit={submit} className="kairema-composer">
        <div className="kairema-composer-main">
          {(attachments.length > 0 || pendingLocalAttachments.length > 0) && <div className="kairema-attachment-chips">{pendingLocalAttachments.map((attachment) => <span className="kairema-attachment-chip kairema-composer-attachment-chip" key={attachment.id} data-testid="local-attachment-preview"><button type="button" className="kairema-attachment-preview-trigger" title={`${t.preview}: ${attachment.file.name}`} aria-label={`${t.preview}: ${attachment.file.name}`} onClick={() => setPreviewAttachment({ id: attachment.id, fileName: attachment.file.name, mimeType: attachment.file.type, sizeBytes: attachment.file.size, kind: attachment.file.type.startsWith("image/") ? "image" : "document", previewUrl: attachment.previewUrl })}>{attachment.previewUrl ? <img src={attachment.previewUrl} alt="" className="kairema-attachment-preview" /> : <FileText className="size-3.5" />}{!attachment.file.type.startsWith("image/") && <span>{attachment.file.name}</span>}</button>{(attachment.timedOut || attachment.failed) && <button type="button" className="kairema-attachment-retry" onClick={() => void retryPendingLocalAttachment(attachment.id)} title={t.retryUpload} aria-label={`${t.retryUpload}: ${attachment.file.name}`}>{t.retryUpload}</button>}<button type="button" className="kairema-attachment-remove" title={t.remove} aria-label={`${t.remove}: ${attachment.file.name}`} onClick={() => removePendingLocalAttachment(attachment.id)}><X className="size-3.5" /></button></span>)}{attachments.map((attachment) => <span className="kairema-attachment-chip kairema-composer-attachment-chip" key={attachment.id}><button type="button" className="kairema-attachment-preview-trigger" title={`${t.preview}: ${attachment.fileName}`} aria-label={`${t.preview}: ${attachment.fileName}`} onClick={() => setPreviewAttachment(attachment)}>{attachment.kind === "image" && attachment.previewUrl ? <img src={attachment.previewUrl} alt="" className="kairema-attachment-preview" /> : attachment.kind === "image" ? <FileImage className="size-3.5" /> : <FileText className="size-3.5" />}{attachment.kind === "document" && <span>{attachment.fileName}{formatAttachmentSize(attachment.sizeBytes) ? ` · ${formatAttachmentSize(attachment.sizeBytes)}` : ""}</span>}</button><button type="button" className="kairema-attachment-remove" title={t.remove} aria-label={`${t.remove}: ${attachment.fileName}`} onClick={() => void removeAttachment(attachment)}><X className="size-3.5" /></button></span>)}</div>}
          {(attachmentNotice || uploadStatus || isPreparingAttachments || pendingLocalAttachments.some((attachment) => attachment.timedOut || attachment.failed)) && <p className="px-1 pb-2 text-xs text-muted-foreground" role="status" aria-live="polite">{attachmentNotice || (isPreparingAttachments ? (language === "ru" ? "Подготавливаем фотографию…" : "Preparing photo…") : pendingLocalAttachments.some((attachment) => attachment.timedOut) ? t.uploadTimedOut : pendingLocalAttachments.some((attachment) => attachment.failed) ? t.uploadFailed : uploadStatus)}</p>}
          <div className="kairema-composer-row">
            <input ref={fileInputRef} className="sr-only" type="file" aria-label={attachmentInputLabel} multiple accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,.md" onChange={(event) => void addFiles(event.target.files)} />
            <input ref={photoInputRef} className="sr-only" type="file" aria-label={t.attachPhoto} multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => void addFiles(event.target.files)} />
            {onOpenTemplates && <button type="button" onClick={onOpenTemplates} disabled={isLoading} className="kairema-composer-tool" title={language === "ru" ? "Шаблоны промптов" : "Prompt templates"} aria-label={language === "ru" ? "Шаблоны промптов" : "Prompt templates"}><Sparkles className="size-4" /></button>}
            <details className="kairema-attachment-menu" ref={attachmentMenuRef} open={attachmentMenuOpen} onToggle={(event) => setAttachmentMenuOpen(event.currentTarget.open)}><summary className="kairema-composer-tool" title={t.attach} aria-label={t.attach}>{isUploading || isPreparingAttachments ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}</summary><div className="kairema-attachment-menu-popover"><button type="button" onClick={() => photoInputRef.current?.click()} disabled={!onUploadFiles || isLoading || isUploading || isPreparingAttachments}>{t.attachPhoto}</button><button type="button" onClick={() => fileInputRef.current?.click()} disabled={!onUploadFiles || isLoading || isUploading || isPreparingAttachments}>{t.attachFile}</button></div></details>
            <Textarea ref={textareaRef} value={currentInput} onChange={(event) => setComposerInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder={effectivePlaceholder} className="kairema-textarea" rows={1} />
          </div>
        </div>
        {isLoading ? <Button type="button" size="icon" onClick={onCancelStream} className="kairema-cancel" aria-label={t.stop}><Square className="size-3.5 fill-current" /></Button> : <Button type="submit" size="icon" disabled={!currentInput.trim() || isUploading || pendingLocalAttachments.length > 0} className="kairema-send" aria-label={t.send}>{isUploading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</Button>}
      </form>
      <p className="px-5 pb-4 text-center text-[11px] text-muted-foreground">{t.disclaimer}</p>
      <SourcesSheet message={sourcesSheetIndex === null ? null : displayMessages[sourcesSheetIndex] ?? null} language={language} t={t} onClose={closeSourcesSheet} />
      <Dialog open={Boolean(previewAttachment)} onOpenChange={(open) => { if (!open) setPreviewAttachment(null); }}>
        <DialogContent aria-describedby={undefined} className="max-h-[86vh] max-w-3xl overflow-hidden bg-card text-card-foreground">
          <DialogHeader><DialogTitle>{previewAttachment?.fileName ?? t.previewTitle}</DialogTitle></DialogHeader>
          {previewAttachment?.previewUrl ? previewAttachment.kind === "image" ? <img src={previewAttachment.previewUrl} alt={previewAttachment.fileName} className="max-h-[68vh] w-full rounded-lg object-contain" /> : <iframe src={previewAttachment.previewUrl} title={previewAttachment.fileName} className="h-[62vh] w-full rounded-lg border border-border bg-background" sandbox="allow-downloads allow-same-origin" /> : <p className="text-sm text-muted-foreground">{t.previewUnavailable}</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
