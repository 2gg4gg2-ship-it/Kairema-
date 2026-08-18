import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { InlineMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { Loader2, Send, User, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type Message = {
  id?: string;
  role: "system" | "user" | "assistant";
  content: string;
  providerLabel?: string;
  model?: string;
  status?: string;
  isError?: boolean;
};

type AIChatBoxProps = {
  messages: Message[];
  onSendMessage: (content: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  height?: string | number;
  emptyStateMessage?: string;
  suggestedPrompts?: string[];
};

export function AIChatBox({
  messages,
  onSendMessage,
  isLoading = false,
  placeholder = "Напишите сообщение…",
  className,
  height,
  emptyStateMessage = "Начните разговор с Kairema",
  suggestedPrompts = [],
}: AIChatBoxProps) {
  const [input, setInput] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const displayMessages = messages.filter((message) => message.role !== "system");

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "smooth" });
  }, [displayMessages.length, isLoading]);

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const value = input.trim();
    if (!value || isLoading) return;
    onSendMessage(value);
    setInput("");
    textareaRef.current?.focus();
  };

  return (
    <section className={cn("kairema-chat flex min-h-0 flex-1 flex-col", className)} style={height ? { height } : undefined}>
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto">
        {displayMessages.length === 0 ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
            <div className="kairema-orb mb-6"><Sparkles className="size-7" /></div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">{emptyStateMessage}</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">Выберите одну из пяти моделей. Kairema покажет её подтверждённый статус до отправки запроса.</p>
            <div className="mt-8 flex max-w-2xl flex-wrap justify-center gap-2">
              {suggestedPrompts.map((prompt) => (
                <button key={prompt} onClick={() => onSendMessage(prompt)} disabled={isLoading} className="kairema-prompt">
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-7 sm:px-8">
            {displayMessages.map((message, index) => (
              <article key={message.id ?? `${message.role}-${index}`} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
                {message.role === "assistant" && <div className="kairema-avatar kairema-avatar-ai"><Sparkles className="size-4" /></div>}
                <div className={cn("max-w-[86%] sm:max-w-[76%]", message.role === "user" && "flex flex-col items-end")}>
                  <div className={cn("kairema-message", message.role === "user" ? "kairema-message-user" : "kairema-message-ai", message.isError && "kairema-message-error")}>
                    {message.role === "assistant" && !message.isError ? <div className="kairema-markdown whitespace-pre-wrap text-sm leading-6"><InlineMarkdown text={message.content} /></div> : <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>}
                  </div>
                  {message.role === "assistant" && message.providerLabel && (
                    <p className="mt-2 px-1 text-xs text-slate-500">{message.providerLabel} · {message.model} · {message.status}</p>
                  )}
                </div>
                {message.role === "user" && <div className="kairema-avatar"><User className="size-4" /></div>}
              </article>
            ))}
            {isLoading && <div className="flex items-center gap-3"><div className="kairema-avatar kairema-avatar-ai"><Sparkles className="size-4" /></div><div className="kairema-typing"><Loader2 className="size-4 animate-spin" /> Kairema готовит ответ</div></div>}
          </div>
        )}
      </div>
      <form onSubmit={submit} className="kairema-composer">
        <Textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder={placeholder} className="kairema-textarea" rows={1} />
        <Button type="submit" size="icon" disabled={!input.trim() || isLoading} className="kairema-send" aria-label="Отправить сообщение">
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
      <p className="px-5 pb-4 text-center text-[11px] text-slate-600">Ответы генерируются выбранной моделью. Проверяйте важные сведения.</p>
    </section>
  );
}
