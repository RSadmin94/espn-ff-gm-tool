// FILE: client/src/pages/hubs/OffseasonHub.tsx
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { safeErrorMessage } from "@/lib/paywall";
import { useState } from "react";
import { toast } from "sonner";
import {
  Trophy, AlertTriangle, TrendingUp, TrendingDown, Minus,
  Brain, Target, ChevronDown, ChevronUp, Loader2, Sparkles,
  Calendar, Users, BarChart3, RefreshCw,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  const map = {
    low: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    high: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${map[risk]}`}>
      {risk.charAt(0).toUpperCase() + risk.slice(1)} Risk
    </span>
  );
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 75 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium text-foreground">{score}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function SavingsPill({ savings }: { savings: number }) {
  if (savings >= 3) return (
    <span className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
      <TrendingUp className="w-3 h-3" />+{savings} rds
    </span>
  );
  if (savings >= 1) return (
    <span className="flex items-center gap-1 text-xs text-amber-400 font-semibold">
      <TrendingUp className="w-3 h-3" />+{savings} rd
    </span>
  );
  if (savings === 0) return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground font-semibold">
      <Minus className="w-3 h-3" />Even
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-red-400 font-semibold">
      <TrendingDown className="w-3 h-3" />{savings} rd
    </span>
  );
}

function PositionBadge({ pos }: { pos: string }) {
  const colors: Record<string, string> = {
    QB: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    RB: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    WR: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    TE: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    K: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
    DEF: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border font-bold ${colors[pos] ?? "bg-muted text-muted-foreground border-border"}`}>
      {pos}
    </span>
  );
}

// ─── Keeper Recommendations Tab ───────────────────────────────────────────────

function TeamKeeperCard({ team }: { team: NonNullable<ReturnType<typeof useKeeperData>["data"]>["teams"][number] }) {
  const [expanded, setExpanded] = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);

  const briefMutation = trpc.offseason.teamKeeperBrief.useMutation({
    onSuccess: (data) => { setBrief(typeof data.brief === 'string' ? data.brief : String(data.brief)); setBriefLoading(false); },
    onError: () => setBriefLoading(false),
  });

  const rec = team.primaryRecommendation;
  const alt = team.alternativeOption;
  const dna = team.dnaPrediction;

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base font-semibold truncate">{team.teamName}</CardTitle>
              {dna.gmArchetype !== "Unknown" && (
                <Badge variant="outline" className="text-xs shrink-0">{dna.gmArchetype}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{team.ownerName}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {rec ? (
              <div className="text-right">
                <div className="flex items-center gap-1.5 justify-end">
                  <PositionBadge pos={rec.position} />
                  <span className="text-sm font-semibold">{rec.playerName}</span>
                </div>
                <div className="flex items-center gap-2 justify-end mt-0.5">
                  <span className="text-xs text-muted-foreground">Rd {rec.roundCost2026}</span>
                  <SavingsPill savings={rec.roundSavings} />
                </div>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">No eligible keepers</span>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {/* Primary recommendation */}
          {rec && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-semibold">Recommended Keeper</span>
                </div>
                <RiskBadge risk={rec.risk} />
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">Keep Cost</div>
                  <div className="text-lg font-bold">Rd {rec.roundCost2026}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Open Pool ADP</div>
                  <div className="text-lg font-bold">Rd {rec.estimatedAdpRound}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Round Savings</div>
                  <div className={`text-lg font-bold ${rec.roundSavings >= 2 ? "text-emerald-400" : rec.roundSavings > 0 ? "text-amber-400" : "text-red-400"}`}>
                    {rec.roundSavings > 0 ? `+${rec.roundSavings}` : rec.roundSavings}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <ScoreBar score={rec.valueScore} label="Value Score (round cost vs ADP)" />
                <ScoreBar score={rec.needScore} label="Roster Need Score" />
                <ScoreBar score={rec.score} label="Overall Recommendation Score" />
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p><span className="text-foreground font-medium">Value: </span>{rec.valueReasoning}</p>
                <p><span className="text-foreground font-medium">Need: </span>{rec.needReasoning}</p>
                <p className="text-amber-400/80">{rec.riskNote}</p>
              </div>
            </div>
          )}

          {/* Alternative option */}
          {alt && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-sky-400" />
                <span className="text-sm font-medium">Alternative: {alt.playerName}</span>
                <PositionBadge pos={alt.position} />
                <span className="text-xs text-muted-foreground">Rd {alt.roundCost2026}</span>
                <SavingsPill savings={alt.roundSavings} />
              </div>
              <p className="text-xs text-muted-foreground">{alt.valueReasoning}</p>
            </div>
          )}

          {/* Ineligible players */}
          {team.ineligiblePlayers.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-amber-400">Must Return to Pool</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {team.ineligiblePlayers.map(p => (
                  <div key={p.playerId} className="flex items-center gap-1.5 text-xs bg-muted/50 rounded px-2 py-1">
                    <PositionBadge pos={p.position} />
                    <span>{p.playerName}</span>
                    <span className="text-muted-foreground">(kept Rd {p.round2025})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DNA Behavior Prediction */}
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-medium text-violet-400">DNA Behavior Prediction</span>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-muted-foreground font-medium">What they'll likely do: </span>
                <span className="text-foreground">{dna.keeperBehavior}</span>
              </div>
              <div>
                <span className="text-muted-foreground font-medium">Draft day behavior: </span>
                <span className="text-foreground">{dna.draftBehavior}</span>
              </div>
              <div>
                <span className="text-muted-foreground font-medium">Exploit opportunity: </span>
                <span className="text-sky-300">{dna.exploitabilityNote}</span>
              </div>
              {dna.biasWarnings.length > 0 && (
                <div className="space-y-1">
                  {dna.biasWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-amber-400/80">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Draft strategy note */}
          <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
            <span className="text-foreground font-medium">Draft Strategy: </span>
            {team.draftStrategyNote}
          </div>

          {/* LLM Brief */}
          <div>
            {brief ? (
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                {brief}
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs gap-2"
                disabled={briefLoading}
                onClick={() => {
                  setBriefLoading(true);
                  briefMutation.mutate({ teamId: team.teamId, teamName: team.teamName });
                }}
              >
                {briefLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Generate AI Keeper + Draft Brief
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function useKeeperData() {
  return trpc.offseason.keeperRecommendations.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

function KeeperRecommendationsTab() {
  const { data, isLoading, error } = useKeeperData();

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      <span className="ml-2 text-muted-foreground">Loading keeper data…</span>
    </div>
  );

  if (error) return (
    <div className="p-6 text-center text-destructive">
      Failed to load keeper data. Make sure your league data is synced.
    </div>
  );

  if (!data || data.teams.length === 0) return (
    <div className="p-6 text-center text-muted-foreground">
      No keeper data available. Sync your league data first.
    </div>
  );

  const summary = data.leagueSummary;

  return (
    <div className="p-4 space-y-4">
      {/* League summary banner */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-muted/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-emerald-400">{summary.totalEligible}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Eligible Keepers</div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-amber-400">{summary.totalIneligible}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Must Return to Pool</div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-sky-400">{data.season}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Draft Season</div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30 border-border">
            <CardContent className="p-3 text-center">
              <div className="text-sm font-bold text-violet-400">{data.deadline}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Keeper Deadline</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Rule callout */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
        <strong>2026 Rule: </strong>{data.rule}
      </div>

      {/* Team cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data.teams.map(team => (
          <TeamKeeperCard key={team.teamId} team={team} />
        ))}
      </div>
    </div>
  );
}

// ─── Draft Board Tab ──────────────────────────────────────────────────────────

function ThreatBadge({ threat }: { threat: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${map[threat] ?? "bg-muted text-muted-foreground border-border"}`}>
      {threat}
    </span>
  );
}

function DraftBoardTab() {
  const { data, isLoading, error } = trpc.offseason.draftBoard.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const [expandedTeam, setExpandedTeam] = useState<number | null>(null);

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      <span className="ml-2 text-muted-foreground">Building draft board…</span>
    </div>
  );

  if (error || !data) return (
    <div className="p-6 text-center text-muted-foreground">
      No draft board data available. Sync your league data first.
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {/* Positional scarcity */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold">2026 Positional Scarcity After Keepers</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.positionalScarcity).map(([pos, info]) => (
            <div key={pos} className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 border ${
              info.scarcityLevel === "scarce" ? "bg-red-500/10 border-red-500/30 text-red-300" :
              info.scarcityLevel === "normal" ? "bg-amber-500/10 border-amber-500/30 text-amber-300" :
              "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
            }`}>
              <PositionBadge pos={pos} />
              <span className="font-medium">{info.keptCount} kept</span>
              <span className="capitalize opacity-70">— {info.scarcityLevel}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Draft day tips */}
      {data.draftDayTips.length > 0 && (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-sky-400" />
            <span className="text-sm font-semibold text-sky-400">Draft Day Intelligence</span>
          </div>
          {data.draftDayTips.map((tip, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              <span className="text-sky-400 font-medium">{i + 1}. </span>{tip}
            </p>
          ))}
        </div>
      )}

      {/* Returning pool */}
      {data.returningPool.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold">Players Returning to Pool</span>
            <Badge variant="outline" className="text-xs">{data.returningPool.length}</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.returningPool.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
                <PositionBadge pos={p.position} />
                <span className="font-medium">{p.playerName}</span>
                <span className="text-muted-foreground">from {p.teamName}</span>
                <span className={`ml-auto font-medium ${
                  p.poolValue === "elite" ? "text-emerald-400" :
                  p.poolValue === "high" ? "text-sky-400" :
                  p.poolValue === "medium" ? "text-amber-400" : "text-muted-foreground"
                }`}>{p.poolValue}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team strategies */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground px-1">Team Draft Strategies</h3>
        {data.teamStrategies.map(team => (
          <Card key={team.teamId} className="bg-card border-border overflow-hidden">
            <CardHeader
              className="pb-3 cursor-pointer"
              onClick={() => setExpandedTeam(expandedTeam === team.teamId ? null : team.teamId)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-bold text-muted-foreground w-8 text-center">#{team.pickNumber}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{team.ownerName}</span>
                      <ThreatBadge threat={team.draftThreat} />
                    </div>
                    <div className="text-xs text-muted-foreground">{team.teamName} · {team.gmArchetype}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {team.lockedRounds.length > 0 ? (
                    <span className="text-xs text-amber-400">Rd {team.lockedRounds.join(", ")} locked</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No keeper</span>
                  )}
                  {expandedTeam === team.teamId ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </div>
            </CardHeader>
            {expandedTeam === team.teamId && (
              <CardContent className="pt-0 space-y-3">
                <p className="text-xs text-muted-foreground">{team.strategyBrief}</p>

                {team.predictedTargets.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-foreground">Predicted Draft Targets</div>
                    {team.predictedTargets.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-muted-foreground shrink-0">Rd {t.round}</span>
                        <PositionBadge pos={t.position} />
                        <span className="text-muted-foreground">{t.reasoning}</span>
                        <span className={`ml-auto shrink-0 ${t.confidence === "high" ? "text-emerald-400" : t.confidence === "medium" ? "text-amber-400" : "text-muted-foreground"}`}>
                          {t.confidence}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 text-xs">
                  <span className="text-sky-400 font-medium">Exploit: </span>
                  <span className="text-muted-foreground">{team.exploitOpportunity}</span>
                </div>

                {team.positionalGaps.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Positional gaps:</span>
                    {team.positionalGaps.map(p => <PositionBadge key={p} pos={p} />)}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Data Source Banner ───────────────────────────────────────────────────────

function DataSourceBanner({ completedSeason, planningYear }: { completedSeason?: number; planningYear?: number }) {
  if (!completedSeason || !planningYear) return null;
  return (
    <div className="mx-4 mt-3 mb-0 rounded-lg border border-sky-500/20 bg-sky-950/30 px-4 py-2 flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1.5 text-sky-400 font-semibold shrink-0">
        <BarChart3 className="w-3.5 h-3.5" />
        Data Source
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="px-2 py-0.5 rounded bg-muted/40 border border-border text-foreground font-medium">
          {completedSeason} Season
        </span>
        <span className="text-muted-foreground">→ Historical results &amp; keeper eligibility</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground ml-auto">
        <span className="text-muted-foreground">Planning for</span>
        <span className="px-2 py-0.5 rounded bg-primary/15 border border-primary/30 text-primary font-bold">
          {planningYear} Season
        </span>
      </div>
    </div>
  );
}

// ─── Main Hub ─────────────────────────────────────────────────────────────────

export default function OffseasonHub() {
  // Pull season metadata from the keeper query (lightest query, always runs first)
  const utils = trpc.useUtils();
  const { data: keeperMeta } = trpc.offseason.keeperRecommendations.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const completedSeason = (keeperMeta as { completedSeason?: number })?.completedSeason;
  const planningYear = (keeperMeta as { planningYear?: number })?.planningYear;
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const refreshMutation = trpc.offseason.refresh.useMutation({
    onSuccess: (result) => {
      setLastSyncedAt(result.refreshedAt);
      utils.offseason.keeperRecommendations.invalidate();
      utils.offseason.draftBoard.invalidate();
      const anyFailed = Object.values(result.seasons).some(
        (r) => (r as { status: string }).status === "failed"
      );
      if (anyFailed) {
        toast.warning("Partial refresh — some seasons failed. Check Data Center.");
      } else {
        toast.success("Offseason data refreshed successfully.");
      }
    },
    onError: (err) => {
      toast.error(safeErrorMessage(err, "Refresh failed. Check ESPN credentials."));
    },
  });

  return (
    <AppLayout
      title="Offseason Intelligence"
      subtitle={planningYear
        ? `${planningYear} keeper recommendations, draft order analysis, and manager behavior predictions`
        : "Offseason keeper recommendations, draft order analysis, and manager behavior predictions"}
    >
      {/* Refresh bar */}
      <div className="flex items-center justify-end gap-3 px-6 py-2 border-b border-border bg-card/30">
        {lastSyncedAt && (
          <span className="text-[10px] text-muted-foreground">
            Synced {new Date(lastSyncedAt).toLocaleTimeString()}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
        >
          {refreshMutation.isPending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <RefreshCw className="w-3 h-3" />}
          {refreshMutation.isPending ? "Refreshing..." : "Refresh ESPN Data"}
        </Button>
      </div>
      <DataSourceBanner completedSeason={completedSeason} planningYear={planningYear} />

      <Tabs defaultValue="keepers" className="w-full">
        <div className="px-6 pt-4 border-b border-border">
          <TabsList className="bg-transparent p-0 h-auto gap-1">
            <TabsTrigger
              value="keepers"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 text-sm font-medium"
            >
              <Trophy className="w-3.5 h-3.5 mr-1.5" />
              Keeper Recommendations
            </TabsTrigger>
            <TabsTrigger
              value="draft-board"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 text-sm font-medium"
            >
              <Calendar className="w-3.5 h-3.5 mr-1.5" />
              {planningYear ? `${planningYear} Draft Board` : "Draft Board"}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="keepers" className="mt-0">
          <KeeperRecommendationsTab />
        </TabsContent>

        <TabsContent value="draft-board" className="mt-0">
          <DraftBoardTab />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
