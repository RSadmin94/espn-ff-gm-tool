/**
 * GM Decision Memory Hub
 *
 * Tracks every decision Rod has logged across all tools.
 * Shows accuracy stats, outcome timeline, pattern analysis,
 * and a full searchable decision feed with outcome resolution.
 */
import { useState, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { safeErrorMessage } from "@/lib/paywall";
import {
  Brain,
  CheckCircle,
  XCircle,
  Minus,
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  BarChart3,
  RefreshCw,
  Loader2,
  ChevronRight,
  AlertTriangle,
  Activity,
  Trophy,
  User,
  Save,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const SEASONS = [2025, 2024, 2023, 2022, 2021];

const TOOL_LABELS: Record<string, string> = {
  start_sit: "Start/Sit",
  trade_analyzer: "Trade Analyzer",
  waiver_wire: "Waiver Wire",
  trade_offer: "Trade Offer",
  keeper_lab: "Keeper Lab",
  draft_war_room: "Draft War Room",
  manual: "Manual",
};

const DECISION_TYPE_LABELS: Record<string, string> = {
  start_sit: "Start/Sit",
  trade_accept: "Trade Accept",
  trade_reject: "Trade Reject",
  waiver_add: "Waiver Add",
  waiver_pass: "Waiver Pass",
  keeper_keep: "Keeper Keep",
  keeper_drop: "Keeper Drop",
  draft_pick: "Draft Pick",
  manual: "Manual",
};

const OUTCOME_CONFIG = {
  correct: {
    label: "Correct",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    icon: <CheckCircle className="h-3.5 w-3.5" />,
  },
  incorrect: {
    label: "Incorrect",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
    icon: <XCircle className="h-3.5 w-3.5" />,
  },
  neutral: {
    label: "Neutral",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    icon: <Minus className="h-3.5 w-3.5" />,
  },
  pending: {
    label: "Pending",
    color: "text-muted-foreground",
    bg: "bg-muted/30 border-border",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
};

// ─── Types matching the server schema ────────────────────────────────────────
interface GmDecisionRow {
  id: number;
  toolSource: string;
  decisionType: string;
  description: string;
  recommendation?: string | null;
  followedRecommendation?: boolean | null;
  accepted: boolean;
  outcome: string;
  outcomeNotes?: string | null;
  playersInvolved?: string[] | string | null; // may be pre-parsed array or JSON string
  counterparty?: string | null;
  season: number;
  weekNum?: number | null;
  createdAt: Date | number;
}

interface AccuracyStats {
  total: number;
  resolved: number;
  pending: number;
  correct: number;
  incorrect: number;
  neutral: number;
  accuracyPct: number;
  followedRecommendationPct: number;
  followedAndCorrectPct: number;
  ignoredAndCorrectPct: number;
  avgOutcomeScore: number;
  byTool: Record<string, { total: number; correct: number; incorrect: number; accuracyPct: number }>;
  byDecisionType: Record<string, { total: number; correct: number; incorrect: number; accuracyPct: number }>;
}

interface DecisionPattern {
  pattern: string;
  frequency: number;
  successRate: number;
  description: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parsePlayers(raw?: string[] | string | null): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function AccuracyBar({ value, label, sub }: { value: number; label: string; sub?: string }) {
  const pct = Math.round(value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-bold ${pct >= 60 ? "text-emerald-400" : pct >= 40 ? "text-yellow-400" : "text-red-400"}`}>
          {pct}%
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${pct >= 60 ? "bg-emerald-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function DecisionCard({
  decision,
  onResolve,
}: {
  decision: GmDecisionRow;
  onResolve: (id: number, outcome: "correct" | "incorrect" | "neutral") => void;
}) {
  const [resolving, setResolving] = useState(false);
  const outcomeKey = (decision.outcome ?? "pending") as keyof typeof OUTCOME_CONFIG;
  const cfg = OUTCOME_CONFIG[outcomeKey] ?? OUTCOME_CONFIG.pending;
  const players = parsePlayers(decision.playersInvolved);
  const createdMs =
    decision.createdAt instanceof Date
      ? decision.createdAt.getTime()
      : typeof decision.createdAt === "number"
      ? decision.createdAt
      : Date.now();

  return (
    <Card className="bg-card border-border hover:border-primary/20 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] border-primary/30 text-primary shrink-0">
                {TOOL_LABELS[decision.toolSource] ?? decision.toolSource}
              </Badge>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {DECISION_TYPE_LABELS[decision.decisionType] ?? decision.decisionType}
              </Badge>
              {decision.weekNum && (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  Wk {decision.weekNum}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                {new Date(createdMs).toLocaleDateString()}
              </span>
            </div>
            <p className="text-sm font-medium text-foreground">{decision.description}</p>
            {decision.recommendation && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">AI rec:</span>{" "}
                {decision.recommendation.slice(0, 120)}
                {decision.recommendation.length > 120 ? "…" : ""}
              </p>
            )}
            {players.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {players.map((p) => (
                  <span key={p} className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground">
                    {p}
                  </span>
                ))}
              </div>
            )}
            {decision.counterparty && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Counterparty:</span> {decision.counterparty}
              </p>
            )}
            {decision.outcomeNotes && (
              <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">
                {decision.outcomeNotes}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <Badge className={`text-[10px] border flex items-center gap-1 ${cfg.bg} ${cfg.color}`}>
              {cfg.icon}
              {cfg.label}
            </Badge>
            {decision.followedRecommendation !== null &&
              decision.followedRecommendation !== undefined && (
                <span className="text-[10px] text-muted-foreground">
                  {decision.followedRecommendation ? "✓ Followed AI" : "✗ Ignored AI"}
                </span>
              )}
          </div>
        </div>

        {/* Resolve buttons — only shown if outcome is pending */}
        {decision.outcome === "pending" && (
          <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2">
            <span className="text-xs text-muted-foreground flex-1">Resolve outcome:</span>
            {resolving ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  onClick={() => {
                    setResolving(true);
                    onResolve(decision.id, "correct");
                  }}
                >
                  <CheckCircle className="h-3 w-3" /> Correct
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                  onClick={() => {
                    setResolving(true);
                    onResolve(decision.id, "incorrect");
                  }}
                >
                  <XCircle className="h-3 w-3" /> Wrong
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                  onClick={() => {
                    setResolving(true);
                    onResolve(decision.id, "neutral");
                  }}
                >
                  <Minus className="h-3 w-3" /> Neutral
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function GMDecisionMemory() {
  const [season, setSeason] = useState<number>(2025);
  const [filterTool, setFilterTool] = useState<string>("all");
  const [filterOutcome, setFilterOutcome] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("feed");

  const utils = trpc.useUtils();

  const feedQuery = trpc.gmDecision.getDecisionFeed.useQuery({
    season,
    toolSource: filterTool === "all" ? undefined : filterTool,
    outcome: filterOutcome === "all" ? undefined : filterOutcome,
    limit: 50,
  });

  const statsQuery = trpc.gmDecision.getAccuracyStats.useQuery({ season });
  const patternQuery = trpc.gmDecision.getPatternAnalysis.useQuery({ season });
  const retroQuery = trpc.gmDecision.getRetrospective.useQuery(
    { season },
    { enabled: activeTab === "retrospective" }
  );

  // ── GM Profile (user_memory) ──────────────────────────────────────────────
  const memoryQuery = trpc.advisor.getMemory.useQuery();
  const updateMemoryMutation = trpc.advisor.updateMemory.useMutation({
    onSuccess: () => toast.success("GM Profile saved — the Advisor will use this in future chats"),
    onError: (err) => toast.error(safeErrorMessage(err, "Failed to save.")),
  });
  const [memForm, setMemForm] = useState({
    riskTolerance: "moderate",
    tradePhilosophy: "",
    keeperPhilosophy: "",
    draftStyle: "",
    favoritePlayerTypes: "",
    rivalManagers: "",
    notes: "",
  });
  const [memDirty, setMemDirty] = useState(false);
  useEffect(() => {
    if (memoryQuery.data) {
      setMemForm({
        riskTolerance: memoryQuery.data.riskTolerance ?? "moderate",
        tradePhilosophy: memoryQuery.data.tradePhilosophy ?? "",
        keeperPhilosophy: memoryQuery.data.keeperPhilosophy ?? "",
        draftStyle: memoryQuery.data.draftStyle ?? "",
        favoritePlayerTypes: memoryQuery.data.favoritePlayerTypes ?? "",
        rivalManagers: memoryQuery.data.rivalManagers ?? "",
        notes: memoryQuery.data.notes ?? "",
      });
      setMemDirty(false);
    }
  }, [memoryQuery.data]);
  const handleMemChange = (field: keyof typeof memForm, value: string) => {
    setMemForm(prev => ({ ...prev, [field]: value }));
    setMemDirty(true);
  };
  const handleMemSave = () => updateMemoryMutation.mutate(memForm);

  const resolveMutation = trpc.gmDecision.resolveOutcome.useMutation({
    onSuccess: () => {
      toast.success("Outcome recorded");
      utils.gmDecision.getDecisionFeed.invalidate();
      utils.gmDecision.getAccuracyStats.invalidate();
      utils.gmDecision.getPatternAnalysis.invalidate();
    },
    onError: (err) => toast.error(safeErrorMessage(err, "Failed.")),
  });

  const handleResolve = (decisionId: number, outcome: "correct" | "incorrect" | "neutral") => {
    resolveMutation.mutate({ decisionId, outcome });
  };

  const stats = statsQuery.data as AccuracyStats | undefined;
  const patterns = (patternQuery.data ?? []) as DecisionPattern[];
  const decisions = (feedQuery.data ?? []) as unknown as GmDecisionRow[];

  const pendingCount = decisions.filter((d) => d.outcome === "pending").length;
  const resolvedCount = decisions.filter((d) => d.outcome !== "pending").length;

  return (
    <AppLayout>
      <div className="container py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Brain className="h-6 w-6 text-purple-400" />
              GM Decision Memory
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Track every decision, measure your accuracy, and learn from what worked.
            </p>
          </div>
          <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEASONS.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} Season
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statsQuery.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : stats ? (
            <>
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="text-2xl font-black text-foreground">{stats.total}</div>
                  <div className="text-xs text-muted-foreground mt-1">Total Decisions</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {pendingCount} pending · {resolvedCount} resolved
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div
                    className={`text-2xl font-black ${
                      stats.accuracyPct >= 60
                        ? "text-emerald-400"
                        : stats.accuracyPct >= 40
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {Math.round(stats.accuracyPct)}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Overall Accuracy</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {stats.correct}W · {stats.incorrect}L · {stats.neutral} neutral
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div
                    className={`text-2xl font-black ${
                      stats.followedAndCorrectPct >= 60 ? "text-emerald-400" : "text-yellow-400"
                    }`}
                  >
                    {Math.round(stats.followedAndCorrectPct)}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">When Following AI</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    vs {Math.round(stats.ignoredAndCorrectPct)}% when ignoring
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="text-2xl font-black text-foreground">
                    {Math.round(stats.followedRecommendationPct)}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">AI Follow Rate</div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Avg score: {stats.avgOutcomeScore > 0 ? "+" : ""}
                    {Math.round(stats.avgOutcomeScore)}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-8 text-xs">
            <TabsTrigger value="feed" className="text-xs">
              Decision Feed
            </TabsTrigger>
            <TabsTrigger value="accuracy" className="text-xs">
              Accuracy Breakdown
            </TabsTrigger>
            <TabsTrigger value="patterns" className="text-xs">
              Patterns
            </TabsTrigger>
            <TabsTrigger value="retrospective" className="text-xs">
              Retrospective
            </TabsTrigger>
            <TabsTrigger value="profile" className="text-xs">
              GM Profile
            </TabsTrigger>
          </TabsList>

          {/* ── Decision Feed ─────────────────────────────────────────────── */}
          <TabsContent value="feed" className="mt-4 space-y-4">
            {/* Filters */}
            <div className="flex gap-2 flex-wrap">
              <Select value={filterTool} onValueChange={setFilterTool}>
                <SelectTrigger className="w-36 h-7 text-xs">
                  <SelectValue placeholder="All tools" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tools</SelectItem>
                  {Object.entries(TOOL_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterOutcome} onValueChange={setFilterOutcome}>
                <SelectTrigger className="w-32 h-7 text-xs">
                  <SelectValue placeholder="All outcomes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All outcomes</SelectItem>
                  <SelectItem value="correct">Correct</SelectItem>
                  <SelectItem value="incorrect">Incorrect</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => {
                  utils.gmDecision.getDecisionFeed.invalidate();
                  utils.gmDecision.getAccuracyStats.invalidate();
                }}
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </Button>
            </div>

            {feedQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
            ) : decisions.length === 0 ? (
              <Card className="bg-card border-border">
                <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
                  <Brain className="h-12 w-12 text-purple-400/30" />
                  <div>
                    <p className="text-sm font-medium text-foreground">No decisions logged yet</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Use the "Log Decision" button in Start/Sit, Trade Analyzer, or Trade Offer
                      Generator to start building your GM memory.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {decisions.map((d) => (
                  <DecisionCard key={d.id} decision={d} onResolve={handleResolve} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Accuracy Breakdown ────────────────────────────────────────── */}
          <TabsContent value="accuracy" className="mt-4 space-y-4">
            {statsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 rounded-xl" />
                ))}
              </div>
            ) : stats ? (
              <>
                {/* AI follow vs ignore */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Brain className="h-4 w-4 text-purple-400" />
                      AI Recommendation Impact
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <AccuracyBar
                      value={stats.followedAndCorrectPct}
                      label="When following AI recommendation"
                    />
                    <AccuracyBar
                      value={stats.ignoredAndCorrectPct}
                      label="When ignoring AI recommendation"
                    />
                    <AccuracyBar
                      value={stats.followedRecommendationPct}
                      label="AI follow rate (how often you follow the AI)"
                    />
                    {stats.followedAndCorrectPct > stats.ignoredAndCorrectPct ? (
                      <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-400">
                        <TrendingUp className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        Following AI recommendations improves your accuracy by{" "}
                        {Math.round(stats.followedAndCorrectPct - stats.ignoredAndCorrectPct)}{" "}
                        percentage points.
                      </div>
                    ) : stats.ignoredAndCorrectPct > stats.followedAndCorrectPct ? (
                      <div className="flex items-start gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 text-xs text-yellow-400">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        Your instincts outperform AI by{" "}
                        {Math.round(stats.ignoredAndCorrectPct - stats.followedAndCorrectPct)}{" "}
                        points. Use AI as a second opinion, not a directive.
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                {/* By tool */}
                {Object.keys(stats.byTool).length > 0 && (
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-primary" />
                        Accuracy by Tool
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {Object.entries(stats.byTool).map(([tool, data]) => (
                        <AccuracyBar
                          key={tool}
                          value={data.accuracyPct}
                          label={`${TOOL_LABELS[tool] ?? tool} (${data.total} decisions)`}
                          sub={`${data.correct}W · ${data.incorrect}L`}
                        />
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* By decision type */}
                {Object.keys(stats.byDecisionType).length > 0 && (
                  <Card className="bg-card border-border">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Target className="h-4 w-4 text-primary" />
                        Accuracy by Decision Type
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {Object.entries(stats.byDecisionType).map(([type, data]) => (
                        <AccuracyBar
                          key={type}
                          value={data.accuracyPct}
                          label={`${DECISION_TYPE_LABELS[type] ?? type} (${data.total})`}
                          sub={`${data.correct}W · ${data.incorrect}L`}
                        />
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Outcome distribution */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Activity className="h-4 w-4 text-primary" />
                      Outcome Distribution
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3 text-center mb-3">
                      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
                        <div className="text-2xl font-black text-emerald-400">{stats.correct}</div>
                        <div className="text-xs text-muted-foreground mt-1">Correct</div>
                      </div>
                      <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                        <div className="text-2xl font-black text-red-400">{stats.incorrect}</div>
                        <div className="text-xs text-muted-foreground mt-1">Incorrect</div>
                      </div>
                      <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3">
                        <div className="text-2xl font-black text-yellow-400">{stats.neutral}</div>
                        <div className="text-xs text-muted-foreground mt-1">Neutral</div>
                      </div>
                    </div>
                    {stats.total > 0 && (
                      <div className="h-3 bg-muted rounded-full overflow-hidden flex">
                        <div
                          className="bg-emerald-500 h-full transition-all"
                          style={{ width: `${(stats.correct / stats.total) * 100}%` }}
                        />
                        <div
                          className="bg-red-500 h-full transition-all"
                          style={{ width: `${(stats.incorrect / stats.total) * 100}%` }}
                        />
                        <div
                          className="bg-yellow-500 h-full transition-all"
                          style={{ width: `${(stats.neutral / stats.total) * 100}%` }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="bg-card border-border">
                <CardContent className="py-12 text-center text-muted-foreground text-sm">
                  No resolved decisions yet. Log decisions and mark their outcomes to see accuracy
                  stats.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Patterns ─────────────────────────────────────────────────── */}
          <TabsContent value="patterns" className="mt-4 space-y-4">
            {patternQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 rounded-xl" />
                ))}
              </div>
            ) : patterns.length > 0 ? (
              <>
                {/* High-success patterns */}
                {patterns.filter((p) => p.successRate >= 60).length > 0 && (
                  <Card className="bg-card border-emerald-500/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-emerald-400">
                        <Trophy className="h-4 w-4" />
                        Strong Patterns (≥60% success)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {patterns
                        .filter((p) => p.successRate >= 60)
                        .map((p, i) => (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-foreground">{p.pattern}</span>
                              <Badge className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-[10px]">
                                {p.successRate}% · {p.frequency}×
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{p.description}</p>
                          </div>
                        ))}
                    </CardContent>
                  </Card>
                )}

                {/* Low-success patterns */}
                {patterns.filter((p) => p.successRate < 50).length > 0 && (
                  <Card className="bg-card border-red-500/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-red-400">
                        <TrendingDown className="h-4 w-4" />
                        Weak Patterns (&lt;50% success)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {patterns
                        .filter((p) => p.successRate < 50)
                        .map((p, i) => (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-foreground">{p.pattern}</span>
                              <Badge className="bg-red-500/10 border-red-500/30 text-red-400 text-[10px]">
                                {p.successRate}% · {p.frequency}×
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{p.description}</p>
                          </div>
                        ))}
                    </CardContent>
                  </Card>
                )}

                {/* All patterns table */}
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      All Detected Patterns
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {patterns.map((p, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                        >
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{p.pattern}</p>
                            <p className="text-[10px] text-muted-foreground">{p.description}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <div
                              className={`text-xs font-bold ${
                                p.successRate >= 60
                                  ? "text-emerald-400"
                                  : p.successRate >= 40
                                  ? "text-yellow-400"
                                  : "text-red-400"
                              }`}
                            >
                              {p.successRate}%
                            </div>
                            <div className="text-[10px] text-muted-foreground">{p.frequency}×</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="bg-card border-border">
                <CardContent className="py-12 text-center text-muted-foreground text-sm">
                  Not enough resolved decisions to identify patterns yet. Aim for at least 10
                  resolved decisions.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Retrospective ─────────────────────────────────────────────── */}
          <TabsContent value="retrospective" className="mt-4 space-y-4">
            <Card className="bg-card border-border border-purple-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Brain className="h-4 w-4 text-purple-400" />
                  AI Retrospective Analysis — {season} Season
                </CardTitle>
              </CardHeader>
              <CardContent>
                {retroQuery.isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </div>
                ) : retroQuery.data?.analysis ? (
                  <div className="prose prose-sm prose-invert max-w-none">
                    <Streamdown>{retroQuery.data.analysis}</Streamdown>
                  </div>
                ) : (
                  <div className="py-12 flex flex-col items-center gap-4 text-center">
                    <Brain className="h-12 w-12 text-purple-400/30" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        No retrospective available yet
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                        Log at least 5 decisions and resolve their outcomes to generate an AI
                        retrospective analysis of your GM decision-making.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── GM Profile ─────────────────────────────────────────────────────────────── */}
          <TabsContent value="profile" className="mt-4 space-y-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" />
                    GM Profile
                  </CardTitle>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={!memDirty || updateMemoryMutation.isPending}
                    onClick={handleMemSave}
                  >
                    {updateMemoryMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    {memDirty ? "Save Changes" : "Saved"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  This profile is injected into every AI Advisor conversation so the AI understands your
                  playstyle, priorities, and league context.
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                {memoryQuery.isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : (
                  <>
                    {/* Risk Tolerance */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Risk Tolerance</Label>
                      <Select
                        value={memForm.riskTolerance}
                        onValueChange={(v) => handleMemChange("riskTolerance", v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="conservative">Conservative — protect the floor</SelectItem>
                          <SelectItem value="moderate">Moderate — balanced approach</SelectItem>
                          <SelectItem value="aggressive">Aggressive — swing for upside</SelectItem>
                          <SelectItem value="contrarian">Contrarian — fade consensus</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Trade Philosophy */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Trade Philosophy</Label>
                      <Textarea
                        className="text-xs min-h-[72px] resize-none"
                        placeholder="e.g. I prefer selling high on WRs in October and buying RBs after injuries. I never trade away my QB."
                        value={memForm.tradePhilosophy}
                        onChange={(e) => handleMemChange("tradePhilosophy", e.target.value)}
                      />
                    </div>

                    {/* Keeper Philosophy */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Keeper Philosophy</Label>
                      <Textarea
                        className="text-xs min-h-[72px] resize-none"
                        placeholder="e.g. I always keep elite RBs regardless of round cost. I avoid keeping QBs unless they're available in round 10+."
                        value={memForm.keeperPhilosophy}
                        onChange={(e) => handleMemChange("keeperPhilosophy", e.target.value)}
                      />
                    </div>

                    {/* Draft Style */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Draft Style</Label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="e.g. Zero RB, Best Player Available, Robust RB, Positional scarcity"
                        value={memForm.draftStyle}
                        onChange={(e) => handleMemChange("draftStyle", e.target.value)}
                      />
                    </div>

                    {/* Favorite Player Types */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Favorite Player Types</Label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="e.g. Workhorse RBs, slot WRs, dual-threat QBs, high-target TEs"
                        value={memForm.favoritePlayerTypes}
                        onChange={(e) => handleMemChange("favoritePlayerTypes", e.target.value)}
                      />
                    </div>

                    {/* Rival Managers */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Rival Managers to Watch</Label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="e.g. Marcus (aggressive trader), DeShawn (waiver hawk)"
                        value={memForm.rivalManagers}
                        onChange={(e) => handleMemChange("rivalManagers", e.target.value)}
                      />
                    </div>

                    {/* Notes */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Additional Notes</Label>
                      <Textarea
                        className="text-xs min-h-[80px] resize-none"
                        placeholder="Anything else the AI should know about your league, history, or strategy..."
                        value={memForm.notes}
                        onChange={(e) => handleMemChange("notes", e.target.value)}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
