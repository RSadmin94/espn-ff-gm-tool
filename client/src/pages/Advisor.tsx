import { useState, useRef, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import SeasonSelector from "@/components/SeasonSelector";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Bot, Send, Trash2, User, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { safeErrorMessage } from "@/lib/paywall";

const SUGGESTED_PROMPTS = [
  "Who are my biggest threats heading into 2026 and how do I neutralize them?",
  "Which managers should I target for trades and what offers should I make?",
  "What are the top waiver wire priorities for early-season 2026?",
  "Analyze my 2025-2026 performance trend and what it means for 2026.",
  "Who will rise and who will fall in 2026 based on 3-year trajectory?",
  "What is the keeper value of [Player Name] for 2026?",
];

export default function Advisor() {
  const [season, setSeason] = useState(2025);
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { isAuthenticated } = useAuth();

  const utils = trpc.useUtils();
  const { data: history, isLoading: histLoading } = trpc.advisor.history.useQuery({ season }, { enabled: isAuthenticated });

  const chatMutation = trpc.advisor.chat.useMutation({
    onSuccess: () => {
      utils.advisor.history.invalidate({ season });
      setMessage("");
    },
    onError: (err) => toast.error(safeErrorMessage(err, "Failed to get response")),
  });

  const clearMutation = trpc.advisor.clearHistory.useMutation({
    onSuccess: () => utils.advisor.history.invalidate({ season }),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleSend = () => {
    if (!message.trim()) return;
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }
    chatMutation.mutate({ message: message.trim(), season });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const messages = history || [];

  return (
    <AppLayout title="AI GM Advisor" subtitle="Ask anything about your league — powered by live data">
      <div className="flex flex-col h-[calc(100vh-80px)]">
        {/* Season selector */}
        <div className="px-8 py-4 border-b border-border flex items-center gap-4">
          <SeasonSelector value={season} onChange={(s) => { setSeason(s); }} />
          <Badge className="espn-gradient text-white border-0 text-xs">AI Powered</Badge>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clearMutation.mutate()}
              className="ml-auto text-muted-foreground hover:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Clear
            </Button>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
          {!isAuthenticated ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <Bot className="w-16 h-16 text-primary opacity-60" />
              <p className="text-lg font-semibold text-foreground">Sign in to use the AI GM Advisor</p>
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                The AI advisor has full access to your league data and can answer any question about players, trades, matchups, and strategy.
              </p>
              <Button onClick={() => window.location.href = getLoginUrl()} className="espn-gradient text-white border-0">
                Sign In
              </Button>
            </div>
          ) : histLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6">
              <div className="w-14 h-14 rounded-2xl espn-gradient flex items-center justify-center">
                <Bot className="w-7 h-7 text-white" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-foreground">GM Advisor Ready</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ask me anything about ATLANTAS FINEST FF — {season} season
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full">
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => setMessage(prompt)}
                    className="text-left px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-primary/40 transition-all text-sm text-muted-foreground hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {(messages as Record<string, unknown>[]).map((msg, i) => {
                const isUser = msg.role === "user";
                return (
                  <div key={i} className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
                    <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${isUser ? "bg-primary/20" : "espn-gradient"}`}>
                      {isUser ? <User className="w-3.5 h-3.5 text-primary" /> : <Bot className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div className={`max-w-2xl rounded-xl px-4 py-3 ${isUser ? "bg-primary/15 text-foreground" : "bg-card border border-border text-foreground"}`}>
                      {isUser ? (
                        <p className="text-sm">{String(msg.content || "")}</p>
                      ) : (
                        <div className="text-sm prose prose-invert prose-sm max-w-none">
                          <Streamdown>{String(msg.content || "")}</Streamdown>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {chatMutation.isPending && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full flex-shrink-0 espn-gradient flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="bg-card border border-border rounded-xl px-4 py-3">
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
          <div className="px-8 py-4 border-t border-border bg-card/50">
            <div className="flex gap-3 items-end max-w-4xl mx-auto">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your league, players, trades, or strategy..."
                className="flex-1 min-h-[44px] max-h-32 resize-none bg-input border-border text-foreground placeholder:text-muted-foreground"
                rows={1}
              />
              <Button
                onClick={handleSend}
                disabled={!message.trim() || chatMutation.isPending}
                className="espn-gradient text-white border-0 h-11 w-11 p-0 flex-shrink-0"
              >
                {chatMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-2">Press Enter to send · Shift+Enter for new line</p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
