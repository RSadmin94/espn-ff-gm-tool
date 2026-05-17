// FILE: client/src/components/TodaysMission.tsx
// "Today's Mission" — the 5-card mission briefing at the top of Command Center.
// Powered by leaguePulse (fast, no LLM) + rodOpportunities (async, LLM).
// Cards: Exploit Opportunity | Biggest Threat | Recommended Move | Rival Status | Confidence Score

import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Crosshair, AlertTriangle, Zap, Swords, BarChart3,
  ChevronRight, TrendingUp, TrendingDown, Minus,
} from "lucide-react";

// ─── Rod's team detection ────────────────────────────────────────────────────
function isRodTeam(name: string) {
  const n = name.toLowerCase();
  return n.includes("str8") || n.includes("rodzilla") || n.includes("rod sellers");
}

// ─── Confidence score from pulse data ────────────────────────────────────────
function computeConfidence(teams: Array<{
  ownerName: string; teamName: string; wins: number; losses: number;
  playoffProbability: number; pointsFor: number;
}>) {
  const rod = teams.find(t => isRodTeam(t.teamName) || isRodTeam(t.ownerName));
  if (!rod) return { score: 50, label: "UNKNOWN", color: "text-muted-foreground" };
  const score = Math.round(rod.playoffProbability);
  const label = score >= 75 ? "STRONG" : score >= 55 ? "SOLID" : score >= 40 ? "SHAKY" : "AT RISK";
  const color = score >= 75 ? "text-emerald-400" : score >= 55 ? "text-blue-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  return { score, label, color, rod };
}

// ─── Rival detection ─────────────────────────────────────────────────────────
function findRival(teams: Array<{
  teamId: number; ownerName: string; teamName: string; currentOpponentOwner: string | null;
  currentOpponentTeamId: number | null; desperationScore: number; wins: number; losses: number;
}>) {
  const rod = teams.find(t => isRodTeam(t.teamName) || isRodTeam(t.ownerName));
  if (!rod || !rod.currentOpponentTeamId) return null;
  const rival = teams.find(t => t.teamId === rod.currentOpponentTeamId);
  if (!rival) return null;
  const threat = rival.desperationScore >= 70 ? "HIGH" : rival.desperationScore >= 45 ? "MED" : "LOW";
  const threatColor = threat === "HIGH" ? "text-red-400" : threat === "MED" ? "text-amber-400" : "text-emerald-400";
  return { name: rival.ownerName || rival.teamName, threat, threatColor, wins: rival.wins, losses: rival.losses };
}

// ─── Biggest threat ───────────────────────────────────────────────────────────
function findBiggestThreat(teams: Array<{
  ownerName: string; teamName: string; desperationScore: number; wins: number; losses: number;
}>) {
  const others = teams.filter(t => !isRodTeam(t.teamName) && !isRodTeam(t.ownerName));
  const sorted = [...others].sort((a, b) => b.desperationScore - a.desperationScore);
  return sorted[0] ?? null;
}

// ─── Skeleton card ────────────────────────────────────────────────────────────
function MissionCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <Skeleton className="h-3.5 w-24 rounded" />
      <Skeleton className="h-5 w-40 rounded" />
      <Skeleton className="h-3 w-32 rounded" />
    </div>
  );
}

// ─── Individual mission card ──────────────────────────────────────────────────
interface MissionCardProps {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  href?: string;
  urgency?: "NOW" | "THIS_WEEK" | "MONITOR" | null;
  className?: string;
}

function MissionCard({ icon: Icon, iconColor, label, title, subtitle, badge, badgeColor, href, urgency, className }: MissionCardProps) {
  const urgencyColor = urgency === "NOW" ? "text-red-400 bg-red-950/40 border-red-500/30"
    : urgency === "THIS_WEEK" ? "text-amber-400 bg-amber-950/40 border-amber-500/30"
    : "text-blue-400 bg-blue-950/40 border-blue-500/30";

  const inner = (
    <div className={cn(
      "rounded-xl border border-border bg-card p-4 flex flex-col gap-1.5 transition-all duration-150 h-full",
      href ? "hover:border-primary/40 hover:bg-card/80 cursor-pointer group" : "",
      className
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", iconColor)} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{label}</span>
        </div>
        {urgency && (
          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border", urgencyColor)}>{urgency.replace("_", " ")}</span>
        )}
        {badge && !urgency && (
          <Badge className={cn("text-[9px] px-1.5 py-0 h-4 border-0 font-bold", badgeColor ?? "espn-gradient text-white")}>{badge}</Badge>
        )}
      </div>
      <p className="text-sm font-semibold text-foreground leading-tight">{title}</p>
      {subtitle && <p className="text-[11px] text-muted-foreground leading-snug">{subtitle}</p>}
      {href && (
        <div className="flex items-center gap-1 mt-auto pt-1.5">
          <span className="text-[10px] text-primary font-medium group-hover:underline">View details</span>
          <ChevronRight className="w-3 h-3 text-primary" />
        </div>
      )}
    </div>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

// ─── Main component ───────────────────────────────────────────────────────────
interface TodaysMissionProps {
  season?: number;
}

export default function TodaysMission({ season = 2026 }: TodaysMissionProps) {
  const pulse = trpc.weeklyAssessment.leaguePulse.useQuery(
    { season },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: false }
  );
  const opps = trpc.weeklyAssessment.rodOpportunities.useQuery(
    { season },
    { staleTime: 10 * 60 * 1000, refetchOnWindowFocus: false, retry: false }
  );

  const isOffseason = pulse.data?.isSeasonComplete ?? false;
  const week = pulse.data?.week ?? 0;

  // Derive mission data from pulse (fast path)
  const teams = (pulse.data?.teams ?? []) as Array<{
    teamId: number; ownerName: string; teamName: string; wins: number; losses: number;
    playoffProbability: number; pointsFor: number; desperationScore: number;
    currentOpponentOwner: string | null; currentOpponentTeamId: number | null;
  }>;

  const confidence = teams.length ? computeConfidence(teams) : null;
  const rival = teams.length ? findRival(teams as Parameters<typeof findRival>[0]) : null;
  const threat = teams.length ? findBiggestThreat(teams) : null;

  // Derive exploit + move from rodOpportunities (slow path, may still be loading)
  const topOpp = opps.data?.opportunities?.[0] ?? null;
  const secondOpp = opps.data?.opportunities?.[1] ?? null;

  const headerLabel = isOffseason
    ? `Offseason ${season} — Planning Mode`
    : `Week ${week} Mission Briefing`;

  return (
    <div className="px-6 pt-5 pb-4 border-b border-border bg-gradient-to-b from-card/60 to-transparent">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-foreground tracking-tight">Today's Mission</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">{headerLabel}</p>
        </div>
        {confidence && (
          <div className="text-right">
            <p className={cn("text-2xl font-black tabular-nums leading-none", confidence.color)}>{confidence.score}</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mt-0.5">Confidence</p>
          </div>
        )}
      </div>

      {/* 5-card grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">

        {/* 1. Biggest Exploit */}
        {opps.isLoading ? (
          <MissionCardSkeleton />
        ) : topOpp ? (
          <MissionCard
            icon={Crosshair}
            iconColor="text-emerald-400"
            label="Exploit"
            title={topOpp.action}
            subtitle={topOpp.reasoning}
            urgency={topOpp.urgency as "NOW" | "THIS_WEEK" | "MONITOR"}
            href="/weekly-intelligence"
          />
        ) : (
          <MissionCard
            icon={Crosshair}
            iconColor="text-muted-foreground"
            label="Exploit"
            title="No active opportunities"
            subtitle="Run a league assessment to surface opportunities."
            href="/weekly-intelligence"
          />
        )}

        {/* 2. Biggest Threat */}
        {pulse.isLoading ? (
          <MissionCardSkeleton />
        ) : threat ? (
          <MissionCard
            icon={AlertTriangle}
            iconColor="text-red-400"
            label="Threat"
            title={threat.ownerName || threat.teamName}
            subtitle={`Desperation score ${threat.desperationScore} — ${threat.desperationScore >= 70 ? "actively hunting moves" : threat.desperationScore >= 45 ? "watching the wire" : "quiet right now"}`}
            badge={`${threat.desperationScore >= 70 ? "HIGH" : threat.desperationScore >= 45 ? "MED" : "LOW"}`}
            badgeColor={threat.desperationScore >= 70 ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-amber-500/20 text-amber-400 border border-amber-500/30"}
            href="/opponent-intel"
          />
        ) : (
          <MissionCardSkeleton />
        )}

        {/* 3. Recommended Move */}
        {opps.isLoading ? (
          <MissionCardSkeleton />
        ) : secondOpp ? (
          <MissionCard
            icon={Zap}
            iconColor="text-amber-400"
            label="Move"
            title={secondOpp.action}
            subtitle={secondOpp.reasoning}
            urgency={secondOpp.urgency as "NOW" | "THIS_WEEK" | "MONITOR"}
            href="/waiver-lab"
          />
        ) : topOpp ? (
          <MissionCard
            icon={Zap}
            iconColor="text-amber-400"
            label="Move"
            title="Check Waiver Wire"
            subtitle="No secondary opportunity flagged — scan waivers for value."
            href="/waiver-lab"
          />
        ) : (
          <MissionCard
            icon={Zap}
            iconColor="text-muted-foreground"
            label="Move"
            title="Check Waiver Wire"
            subtitle="Scan the wire for early-season value."
            href="/waiver-lab"
          />
        )}

        {/* 4. Rival Status */}
        {pulse.isLoading ? (
          <MissionCardSkeleton />
        ) : rival ? (
          <MissionCard
            icon={Swords}
            iconColor="text-purple-400"
            label={isOffseason ? "Last Rival" : "This Week"}
            title={rival.name}
            subtitle={`${rival.wins}–${rival.losses} record · Threat level ${rival.threat}`}
            badge={rival.threat}
            badgeColor={rival.threatColor.replace("text-", "bg-").replace("-400", "-500/20") + " " + rival.threatColor + " border border-current/30"}
            href="/opponent-intel"
          />
        ) : (
          <MissionCard
            icon={Swords}
            iconColor="text-muted-foreground"
            label="Rival"
            title="No matchup data"
            subtitle="Connect your league to see this week's opponent."
            href="/connect"
          />
        )}

        {/* 5. Confidence Score */}
        {pulse.isLoading ? (
          <MissionCardSkeleton />
        ) : confidence ? (
          <MissionCard
            icon={BarChart3}
            iconColor={confidence.color}
            label="Season Outlook"
            title={`${confidence.score}% Confidence`}
            subtitle={`Playoff probability · Status: ${confidence.label}`}
            badge={confidence.label}
            badgeColor={
              confidence.score >= 75 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : confidence.score >= 55 ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
              : confidence.score >= 40 ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
              : "bg-red-500/20 text-red-400 border border-red-500/30"
            }
            href="/command-center"
          />
        ) : (
          <MissionCardSkeleton />
        )}

      </div>
    </div>
  );
}
