import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, api, type ChatMessage } from "../api.ts";

function renderMarkdown(text: string): ReactNode {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```")) {
      const code = part.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
      return (
        <pre
          key={i}
          className="code-surface mt-2 overflow-x-auto rounded border border-[#1f2937] p-2 text-xs"
        >
          <code>{code}</code>
        </pre>
      );
    }
    return (
      <span key={i} className="whitespace-pre-wrap">
        {part}
      </span>
    );
  });
}

/** Embedded Director chat: transcript, SSE token streaming, markdown input. */
export function DirectorChat({ missionId }: { missionId: string }): ReactNode {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [streamed, setStreamed] = useState<ChatMessage[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const transcript = useQuery({
    queryKey: ["chat", missionId],
    queryFn: () => api.chat(missionId),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    setStreamed([]);
    setStreamError(null);
    const source = new EventSource(`/api/missions/${encodeURIComponent(missionId)}/chat/events`);
    source.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse((event as MessageEvent).data) as ChatMessage;
        if (typeof msg.text === "string") {
          setStreamed((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev.slice(-100), msg];
          });
        }
      } catch {
        // Ignore malformed frames; the next sync recovers.
      }
    });
    source.addEventListener("error", (event) => {
      const data = (event as MessageEvent).data;
      if (typeof data === "string" && data !== "") {
        try {
          const body = JSON.parse(data) as { error?: string };
          if (typeof body.error === "string") setStreamError(body.error);
        } catch {
          // Non-JSON error frame; keep the stream open.
        }
      }
    });
    source.onerror = (): void => {
      // EventSource retries on its own; only surface real failures via events.
    };
    return () => source.close();
  }, [missionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [streamed, transcript.data]);

  const send = useMutation({
    mutationFn: (message: string) => api.sendChat(missionId, message),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["chat", missionId] });
    },
  });

  const base = transcript.data?.messages ?? [];
  const seen = new Set(base.map((m) => m.id));
  const messages = [...base, ...streamed.filter((m) => !seen.has(m.id))];

  return (
    <section aria-label="Director chat" className="flex h-full min-h-0 flex-col">
      <div data-testid="chat-transcript" className="min-h-0 flex-1 overflow-y-auto p-3">
        {transcript.isError && (
          <p className="text-xs text-[#ff8fab]">
            {transcript.error instanceof ApiError ? transcript.error.message : "chat unavailable"}
          </p>
        )}
        {messages.length === 0 && !transcript.isLoading && (
          <p className="text-xs text-[#8b949e]">No messages yet. Say hello to the Director.</p>
        )}
        <ol className="flex flex-col gap-3">
          {messages.map((m) => (
            <li
              key={m.id}
              data-testid="chat-message"
              data-role={m.role}
              className={
                m.role === "user" || m.role === "human"
                  ? "self-end rounded-lg bg-[#00f0ff]/10 p-2 text-sm"
                  : "self-start rounded-lg bg-[#161b22] p-2 text-sm"
              }
            >
              <div className="mb-1 text-[10px] uppercase tracking-wider text-[#8b949e]">
                {m.role}
              </div>
              <div className="text-sm text-[#e6edf3]">{renderMarkdown(m.text)}</div>
            </li>
          ))}
        </ol>
        {streamError !== null && <p className="mt-2 text-xs text-[#ff8fab]">{streamError}</p>}
        <div ref={bottomRef} />
      </div>
      <form
        className="border-t border-[#1f2937] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() !== "") send.mutate(draft);
        }}
      >
        <textarea
          data-testid="chat-input"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          rows={2}
          placeholder="Message the Director… (markdown supported)"
          aria-label="Message the Director"
          className="w-full resize-none rounded border border-[#1f2937] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3] outline-none focus:border-[#00f0ff]"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="submit"
            data-testid="chat-send"
            disabled={send.isPending || draft.trim() === ""}
            className="rounded bg-[#00f0ff] px-3 py-1.5 text-xs font-semibold text-[#07090e] disabled:opacity-50"
          >
            Send
          </button>
          {send.isError && (
            <span className="text-xs text-[#ff8fab]">
              {send.error instanceof Error ? send.error.message : "send failed"}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
