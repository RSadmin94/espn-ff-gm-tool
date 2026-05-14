import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Bot, Send, Trash2, User, Loader2, X, Zap } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { PAYWALL_ERR_MSG } from "@shared/const";
import { safeErrorMessage } from "@/lib/paywall";

const DAILY_BUDGET = 50_000;

function UsageQuotaBar() {
  const { data } = trpc.usage.getMyUsage.useQuery(undefined, { staleTime: 60_000 });
  const totalTokens = data?.totalTokens ?? 0;
  const pct = Math.min(100, Math.round((totalTokens / DAILY_BUDGET) * 100));
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  const textColor = pct >= 90 ? "text-red-400" : pct >= 70 ? "text-amber-400" : "text-emerald-400";
  if (!data) return null;
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center justify-between text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> AI Budget (30d)</span>
        <span className={textColor}>{totalTokens.toLocaleString()} / {DAILY_BUDGET.toLocaleString()} tokens</span>
      </div>
      <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const SUGGESTED_PROMPTS = [
  "Who are my biggest threats heading into 2026 and how do I neutralize them?",
  "Which managers should I target for trades and what offers should I make?",
  "What are the top waiver wire priorities for early-season 2026?",
  "Analyze my 2025-2026 performance trend and what it means for 2026.",
  "Who will rise and who will fall in 2026 based on 3-year trajectory?",
  "What is the current 2026 draft order?",
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

interface AdvisorPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function AdvisorPanel({ open, onClose }: AdvisorPanelProps) {
  const [season] = useState(2025);
  const [message, setMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessages, setStreamingMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const { data: history, isLoading: histLoading } = trpc.advisor.history.useQuery(
    { season },
    { enabled: isAuthenticated && open }
  );

  const clearMutation = trpc.advisor.clearHistory.useMutation({
    onSuccess: () => {
      utils.advisor.history.invalidate({ season });
      setStreamingMessages([]);
    },
  });

  useEffect(() => {
    if (history) {
      setStreamingMessages(
        (history as Array<{ role: string; content: string }>).map((h) => ({
          role: h.role as "user" | "assistant",
          content: h.content,
        }))
      );
    }
  }, [history]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingMessages]);

  const handleSend = useCallback(async () => {
    if (!message.trim() || isStreaming) return;
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }

    const userMsg = message.trim();
    setMessage("");

    setStreamingMessages((prev) => [
      ...prev,
      { role: "user", content: userMsg },
      { role: "assistant", content: "", streaming: true },
    ]);

    setIsStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const resp = await fetch("/api/advisor/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: userMsg, season }),
        signal: abort.signal,
        credentials: "include",
      });

      if (!resp.ok) {
        if (resp.status === 403) {
          throw new Error(PAYWALL_ERR_MSG);
        }
        const errText = await resp.text();
        throw new Error(errText || `HTTP ${resp.status}`);
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          try {
            const parsed = JSON.parse(data) as {
              delta?: string;
              done?: boolean;
              error?: string;
            };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.delta) {
              setStreamingMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.streaming) {
                  next[next.length - 1] = { ...last, content: last.content + parsed.delta };
                }
                return next;
              });
            }
            if (parsed.done) {
              setStreamingMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.streaming) next[next.length - 1] = { ...last, streaming: false };
                return next;
              });
            }
          } catch (parseErr) {
            const msg = (parseErr as Error).message;
            if (msg !== "Unexpected end of JSON input") throw parseErr;
          }
        }
      }

      utils.advisor.history.invalidate({ season });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      toast.error(safeErrorMessage(err, "Stream failed"));
      setStreamingMessages((prev) => prev.filter((m) => !m.streaming));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [message, isStreaming, isAuthenticated, season, utils]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" onClick={onClose} />
      )}
      <div
        className={`fixed top-0 right-0 h-full z-50 flex flex-col bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ width: "420px" }}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg espn-gradient flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-tight">AI GM Advisor</p>
              <p className="text-[10px] text-muted-foreground leading-tight">ATLANTAS FINEST FF · 2025 Season</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge className="espn-gradient text-white border-0 text-[9px] px-1.5">AI</Badge>
            {streamingMessages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearMutation.mutate()}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                title="Clear chat history"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!isAuthenticated ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <Bot className="w-10 h-10 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold text-foreground">Sign in to use GM Advisor</p>
                <p className="text-xs text-muted-foreground mt-1">Your chat history is saved per account</p>
              </div>
              <Button
                size="sm"
                onClick={() => { window.location.href = getLoginUrl(); }}
                className="espn-gradient text-white border-0"
              >
                Sign In
              </Button>
            </div>
          ) : histLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : streamingMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-5">
              <div className="w-12 h-12 rounded-2xl espn-gradient flex items-center justify-center">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">GM Advisor Ready</p>
                <p className="text-xs text-muted-foreground mt-1">Ask anything about ATLANTAS FINEST FF</p>
              </div>
              <div className="w-full space-y-2">
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => setMessage(prompt)}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-border bg-background hover:bg-accent/50 hover:border-primary/40 transition-all text-xs text-muted-foreground hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {streamingMessages.map((msg, i) => {
                const isUser = msg.role === "user";
                return (
                  <div key={i} className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
                    <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center ${isUser ? "bg-primary/20" : "espn-gradient"}`}>
                      {isUser ? <User className="w-3 h-3 text-primary" /> : <Bot className="w-3 h-3 text-white" />}
                    </div>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2.5 text-xs ${isUser ? "bg-primary/15 text-foreground" : "bg-background border border-border text-foreground"}`}>
                      {isUser ? (
                        <p>{msg.content}</p>
                      ) : (
                        <div className="prose prose-invert prose-xs max-w-none">
                          <Streamdown>{msg.content}</Streamdown>
                          {msg.streaming && (
                            <span className="inline-block w-1 h-3 bg-primary animate-pulse ml-0.5 align-middle" />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {isStreaming && streamingMessages[streamingMessages.length - 1]?.content === "" && (
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-full flex-shrink-0 espn-gradient flex items-center justify-center">
                    <Bot className="w-3 h-3 text-white" />
                  </div>
                  <div className="bg-background border border-border rounded-xl px-3 py-2.5">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input area */}
        {isAuthenticated && (
          <div className="flex-shrink-0 px-4 py-3 border-t border-border bg-card/50">
            <div className="flex gap-2 items-end">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your league, players, trades, or strategy..."
                className="flex-1 min-h-[40px] max-h-28 resize-none bg-input border-border text-foreground placeholder:text-muted-foreground text-xs"
                rows={1}
                disabled={isStreaming}
              />
              <Button
                onClick={() => void handleSend()}
                disabled={!message.trim() || isStreaming}
                className="espn-gradient text-white border-0 h-10 w-10 p-0 flex-shrink-0"
              >
                {isStreaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </Button>
            </div>
            <p className="text-[9px] text-muted-foreground text-center mt-1.5">
              Enter to send · Shift+Enter for new line
              {isStreaming && <span className="text-primary ml-2">● Streaming...</span>}
            </p>
            <UsageQuotaBar />
          </div>
        )}
      </div>
    </>
  );
}
