// FILE: server/weeklyAssessmentRouter.ts
/**
 * Weekly Assessment tRPC Router
 *
 * Mount in routers.ts:
 *   import { weeklyAssessmentRouter } from "./weeklyAssessmentRouter";
 *   // inside appRouter:
 *   weeklyAssessment: weeklyAssessmentRouter,
 *
 * Endpoints:
 *   weeklyAssessment.fullReport      — all 14 teams, full weekly brief
 *   weeklyAssessment.teamBrief       — single team deep assessment
 *   weeklyAssessment.rodOpportunities— Rod's ranked opportunity board only
 *   weeklyAssessment.leaguePulse     — fast standings + desperation snapshot
 */

import { z } from "zod";
import { router, subscribedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  buildWeeklyAssessment,
  buildTeamAssessment,
  buildRodOpportunityBoard,
} from "./weeklyAssessmentService";
import {
  normalizeTeams, normalizeRosters, normalizeMatchups,
  normalizeTransactions, normalizeSettings,
} from "./espnService";
import { getCachedView } from "./db";
import { memCache } from "./memCache";
import { calcManagerDNA, type DraftPickRecord, type ManagerRawData } from "./leagueDNA";

// ─── Cache for expensive full reports ────────────────────────────────────────
// In-memory cache keyed by season+week — avoids re-running 14 LLM calls on
// every page load during the same week.

const reportCache = new Map<string, { report: Awaited<ReturnType<typeof buildWeeklyAssessment>>; cachedAt: number }>();
const REPORT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCacheKey(season: number, week?: number) {
  return `${season}-${week ?? "current"}`;
}

// ─── Batch job store ──────────────────────────────────────────────────────────
// Tracks in-progress batch assessment runs so the frontend can poll for status.

type TeamJobStatus = "pending" | "running" | "done" | "error";

interface BatchJob {
  jobId: string;
  season: number;
  startedAt: number;
  completedAt: number | null;
  teams: Array<{
    teamId: number;
    ownerName: string;
    status: TeamJobStatus;
    error?: string;
  }>;
  done: boolean;
  successCount: number;
  errorCount: number;
}

const batchJobs = new Map<string, BatchJob>();
const BATCH_JOB_TTL = 2 * 60 * 60 * 1000; // 2 hours

function pruneBatchJobs() {
  const cutoff = Date.now() - BATCH_JOB_TTL;
  Array.from(batchJobs.entries()).forEach(([id, job]) => {
    if (job.startedAt < cutoff) batchJobs.delete(id);
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const weeklyAssessmentRouter = router({

  /**
   * Full 14-team weekly assessment report.
   *
   * Expensive — runs 14+ LLM calls sequentially. Cached for 30 minutes.
   * Use this to populate the Weekly Intelligence hub and Command Center.
   */
  fullReport: subscribedProcedure
    .input(z.object({
      season: z.number().default(2025),
      forceRefresh: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const cacheKey = getCacheKey(input.season);
      const cached = reportCache.get(cacheKey);

      if (cached && !input.forceRefresh && Date.now() - cached.cachedAt < REPORT_CACHE_TTL) {
        return { ...cached.report, fromCache: true };
      }

      const report = await buildWeeklyAssessment(input.season);
      reportCache.set(cacheKey, { report, cachedAt: Date.now() });
      return { ...report, fromCache: false };
    }),

  /**
   * Single team deep assessment.
   * Faster than fullReport — only runs one LLM call.
   * Use when user clicks into a specific opponent's profile.
   */
  teamBrief: subscribedProcedure
    .input(z.object({
      teamId: z.number(),
      season: z.number().default(2025),
    }))
    .query(async ({ input }) => {
      const cached = await getCachedView(input.season, "combined");
      if (!cached) throw new TRPCError({ code: "NOT_FOUND", message: "No data for this season." });

      const data = cached.payload as Record<string, unknown>;
      const teams = normalizeTeams(data);
      const ownerMap: Record<number, string> = {};
      const teamNameMap: Record<number, string> = {};
      for (const t of teams) {
        ownerMap[t.teamId as number] = t.owners as string;
        teamNameMap[t.teamId as number] = (t.teamName as string) || (t.owners as string) || "Unknown";
      }

      const managerRawData: ManagerRawData = {
        memberId: String(input.teamId),
        ownerName: ownerMap[input.teamId] || "Unknown",
        seasonRecords: [], txnSeasons: [], draftPicks: [],
        h2hVsRod: { wins: 0, losses: 0 }, currentSeason: null,
      };
      const dna = calcManagerDNA(managerRawData, []);
      const dnaMap = new Map([[input.teamId, dna]]);

      const rodTeamId = teams.find(t => {
        const name = ((t.teamName as string) || "").toLowerCase();
        return name.includes("str8") || name.includes("rodzilla");
      })?.teamId as number ?? null;

      const allTeamsData = {
        teams,
        rosters: normalizeRosters(data) as unknown[],
        matchups: normalizeMatchups(data),
        transactions: normalizeTransactions(data) as unknown[],
        settings: normalizeSettings(data),
        ownerMap,
        teamNameMap,
      };

      const raw = await buildTeamAssessment(input.teamId, input.season, allTeamsData, dnaMap, [], rodTeamId);

      // Map plain-English gmArchetype to ARCHETYPE_COLORS key used by the extension
      const ARCHETYPE_KEY_MAP: Record<string, string> = {
        "Dealmaker": "AGGRESSIVE_TRADER",
        "Trade Shark": "AGGRESSIVE_TRADER",
        "Waiver Grinder": "WAIVER_HAWK",
        "Waiver Hawk": "WAIVER_HAWK",
        "Set & Forget": "DRAFT_AND_HOLD",
        "Draft & Hold": "DRAFT_AND_HOLD",
        "Balanced Manager": "BALANCED_OPERATOR",
        "Opportunist": "OPPORTUNIST",
        "Ice Cold": "ICE_COLD",
      };
      const archetypeKey = ARCHETYPE_KEY_MAP[raw.gmArchetype] ?? "BALANCED_OPERATOR";

      // Compute rosterHealth from starters array
      const injuredCount = raw.starters.filter((p: { injuryStatus: string }) =>
        p.injuryStatus && p.injuryStatus !== "ACTIVE" && p.injuryStatus !== "NORMAL"
      ).length;
      const starterCount = raw.starters.length;

      return {
        ...raw,
        // Extension-compatible adapter fields
        dna: {
          archetype: archetypeKey,
          archetypeLabel: raw.gmArchetype,
          archetypeReason: raw.tiltLabel ?? "",
        },
        opportunities: (raw.rodOpportunities ?? []).map((op: { type: string; action: string; urgency: string; reasoning: string }) => ({
          type: op.type,
          description: op.action,
          urgency: op.urgency,
          reasoning: op.reasoning,
        })),
        rosterHealth: {
          injuredCount,
          byeCount: 0,
          starterCount,
        },
        playoffOdds: raw.playoffProbability ?? 0,
        record: { wins: raw.wins, losses: raw.losses },
        briefing: raw.aiGMBriefing ?? "",
      };
    }),

  /**
   * Rod's opportunity board — faster than fullReport.
   * Returns ranked cross-team opportunities without full LLM narratives.
   * Use in the Command Center war room quick-launch panel.
   */
  rodOpportunities: subscribedProcedure
    .input(z.object({ season: z.number().default(2025) }))
    .query(async ({ input }) => {
      return buildRodOpportunityBoard(input.season);
    }),

  /**
   * League pulse — fast snapshot, no LLM calls.
   * Returns standings + desperation scores + last week results for all 14 teams.
   * Use for the Command Center threat assessment board.
   */
  leaguePulse: subscribedProcedure
    .input(z.object({ season: z.number().default(2025) }))
    .query(({ input }) => {
      return memCache(`leaguePulse:${input.season}`, 5 * 60_000, async () => {
      const cached = await getCachedView(input.season, "combined");
      if (!cached) throw new TRPCError({ code: "NOT_FOUND", message: "No data." });

      const data = cached.payload as Record<string, unknown>;
      const teams = normalizeTeams(data);
      const matchups = normalizeMatchups(data);
      const transactions = normalizeTransactions(data) as unknown[];
      const settings = normalizeSettings(data);
      const currentWeek = (settings.currentMatchupPeriod as number) || 1;
      // Detect end-of-season: ESPN regular season is 14 weeks; playoffs are 15-17.
      // If currentMatchupPeriod >= 14 OR the season year < current calendar year, treat as completed.
      const calendarYear = new Date().getFullYear();
      const isSeasonComplete = currentWeek >= 14 || input.season < calendarYear;

      const ownerMap: Record<number, string> = {};
      const teamNameMap: Record<number, string> = {};
      const memberIdsMap: Record<number, string[]> = {};
      for (const t of teams) {
        ownerMap[t.teamId as number] = t.owners as string;
        teamNameMap[t.teamId as number] = (t.teamName as string) || (t.owners as string) || "Unknown";
        memberIdsMap[t.teamId as number] = (t.memberIds as string[]) || [];
      }

      const lastWeekTxMap: Record<number, number> = {};
      const lastWeekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const tx of transactions as Array<Record<string, unknown>>) {
        if ((tx.proposedDate as number) > lastWeekStart && tx.status === "EXECUTED") {
          const tid = tx.teamId as number;
          lastWeekTxMap[tid] = (lastWeekTxMap[tid] || 0) + 1;
        }
      }

      const sortedTeams = [...teams].sort((a, b) => {
        const wA = (a.wins as number) || 0;
        const wB = (b.wins as number) || 0;
        return wB !== wA ? wB - wA : ((b.pointsFor as number) || 0) - ((a.pointsFor as number) || 0);
      });

      // Build current week matchup map: teamId -> opponentTeamId
      const currentMatchupMap: Record<number, number> = {};
      for (const m of matchups) {
        if ((m.matchupPeriodId as number) === currentWeek) {
          const home = m.homeTeamId as number;
          const away = m.awayTeamId as number;
          if (home && away) {
            currentMatchupMap[home] = away;
            currentMatchupMap[away] = home;
          }
        }
      }

      return {
        week: isSeasonComplete ? 0 : currentWeek, // 0 = season complete signal
        isSeasonComplete,
        season: input.season,
        teams: sortedTeams.map((t, idx) => {
          const tid = t.teamId as number;
          const wins = (t.wins as number) || 0;
          const losses = (t.losses as number) || 0;
          const finalRank = (t.rankFinal as number) || (idx + 1);

          // For completed seasons: use final rank tier instead of desperation
          // For in-season: use win% + recent activity desperation signal
          const winPct = (wins + losses) > 0 ? wins / (wins + losses) : 0.5;
          let desperationScore: number;
          let desperationLabel: string;
          if (isSeasonComplete) {
            // Repurpose as "offseason priority" based on final rank
            desperationScore = Math.max(5, Math.round((1 - (finalRank - 1) / 14) * 85));
            desperationLabel = finalRank === 1 ? "CHAMPION" :
              finalRank <= 3 ? "CONTENDER" :
              finalRank <= 7 ? "PLAYOFF TEAM" :
              finalRank <= 10 ? "BUBBLE" : "REBUILDING";
          } else {
            const rawDesperation = Math.round((1 - winPct) * 60 + (lastWeekTxMap[tid] || 0) * 5);
            desperationScore = Math.min(100, rawDesperation);
            desperationLabel = desperationScore >= 70 ? "WIDE OPEN" :
              desperationScore >= 45 ? "RECEPTIVE" :
              desperationScore >= 25 ? "NEUTRAL" : "NOT INTERESTED";
          }

          return {
            teamId: tid,
            teamName: teamNameMap[tid] || ownerMap[tid] || "Unknown",
            ownerName: ownerMap[tid],
            standingRank: isSeasonComplete ? finalRank : idx + 1,
            wins,
            losses,
            pointsFor: Math.round(((t.pointsFor as number) || 0) * 10) / 10,
            pointsAgainst: Math.round(((t.pointsAgainst as number) || 0) * 10) / 10,
            lastWeekTransactionCount: lastWeekTxMap[tid] || 0,
            desperationScore,
            desperationLabel,
            playoffProbability: isSeasonComplete
              ? (finalRank <= 7 ? 100 : 0) // season over — binary
              : Math.min(98, Math.max(2, Math.round(50 + (winPct - 0.5) * 200))),
            memberIds: memberIdsMap[tid] ?? [],
            currentOpponentTeamId: isSeasonComplete ? null : (currentMatchupMap[tid] ?? null),
            currentOpponentOwner: isSeasonComplete ? null : (currentMatchupMap[tid] ? (ownerMap[currentMatchupMap[tid]] ?? null) : null),
            currentOpponentMemberIds: isSeasonComplete ? [] : (currentMatchupMap[tid] ? (memberIdsMap[currentMatchupMap[tid]] ?? []) : []),
          };
        }),
        currentMatchups: isSeasonComplete ? {} : currentMatchupMap,
      };
      }); // end memCache
    }),

  /**
   * Start a batch assessment run for all teams in the league.
   * Returns a jobId immediately; poll batchStatus with the jobId for progress.
   * The job runs asynchronously in the background (fire-and-forget Promise).
   */
  batchRunAssessment: subscribedProcedure
    .input(z.object({ season: z.number().default(2025) }))
    .mutation(async ({ input }) => {
      pruneBatchJobs();

      // Get team list from cached data
      const cached = await getCachedView(input.season, "combined");
      if (!cached) throw new TRPCError({ code: "NOT_FOUND", message: "No ESPN data cached for this season. Run a data refresh first." });

      const data = cached.payload as Record<string, unknown>;
      const teams = normalizeTeams(data);
      const ownerMap: Record<number, string> = {};
      for (const t of teams) {
        ownerMap[t.teamId as number] = t.owners as string;
      }

      // Create job record
      const jobId = `batch-${input.season}-${Date.now()}`;
      const job: BatchJob = {
        jobId,
        season: input.season,
        startedAt: Date.now(),
        completedAt: null,
        done: false,
        successCount: 0,
        errorCount: 0,
        teams: teams.map(t => ({
          teamId: t.teamId as number,
          ownerName: ownerMap[t.teamId as number] || "Unknown",
          status: "pending" as TeamJobStatus,
        })),
      };
      batchJobs.set(jobId, job);

      // Fire-and-forget: run assessments sequentially in the background
      (async () => {
        const teamNameMap: Record<number, string> = {};
        for (const t of teams) {
          teamNameMap[t.teamId as number] = (t.teamName as string) || (t.owners as string) || "Unknown";
        }
        const rodTeamId = teams.find(t => {
          const name = ((t.teamName as string) || "").toLowerCase();
          return name.includes("str8") || name.includes("rodzilla");
        })?.teamId as number ?? null;
        const allTeamsData = {
          teams,
          rosters: [],
          matchups: normalizeMatchups(data),
          transactions: normalizeTransactions(data) as unknown[],
          settings: normalizeSettings(data),
          ownerMap,
          teamNameMap,
        };

        for (let i = 0; i < job.teams.length; i++) {
          const entry = job.teams[i];
          entry.status = "running";
          try {
            const { calcManagerDNA: _calcDNA } = await import("./leagueDNA");
            const managerRawData: ManagerRawData = {
              memberId: String(entry.teamId),
              ownerName: entry.ownerName,
              seasonRecords: [], txnSeasons: [], draftPicks: [],
              h2hVsRod: { wins: 0, losses: 0 }, currentSeason: null,
            };
            const dna = _calcDNA(managerRawData, []);
            const dnaMap = new Map([[entry.teamId, dna]]);
            await buildTeamAssessment(entry.teamId, input.season, allTeamsData, dnaMap, [], rodTeamId);
            entry.status = "done";
            job.successCount++;
          } catch (err) {
            entry.status = "error";
            entry.error = err instanceof Error ? err.message : "Unknown error";
            job.errorCount++;
          }
        }

        job.done = true;
        job.completedAt = Date.now();

        // Also invalidate the fullReport cache so next load gets fresh data
        const cacheKey = getCacheKey(input.season);
        reportCache.delete(cacheKey);
      })().catch(() => {
        job.done = true;
        job.completedAt = Date.now();
      });

      return { jobId, teamCount: job.teams.length };
    }),

  /**
   * Poll the status of a batch assessment job.
   * Call every 2-3 seconds while the job is running.
   */
  batchStatus: subscribedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(({ input }) => {
      const job = batchJobs.get(input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found or expired." });
      const elapsedMs = Date.now() - job.startedAt;
      const completedCount = job.teams.filter(t => t.status === "done" || t.status === "error").length;
      return {
        jobId: job.jobId,
        season: job.season,
        done: job.done,
        successCount: job.successCount,
        errorCount: job.errorCount,
        totalCount: job.teams.length,
        completedCount,
        elapsedMs,
        completedAt: job.completedAt,
        teams: job.teams,
      };
    }),
});
