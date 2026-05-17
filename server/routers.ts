import { z } from "zod";
import { memCache } from "./memCache";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, subscribedProcedure, router } from "./_core/trpc";
import { invokeLLM, type Message } from "./_core/llm";
import { checkRateLimit, recordUsage } from "./rateLimiter";
import { injuryRouter } from "./injuryRouter";
import { buildAdvisorInjuryContext } from "./injuryAnalytics";
import { simulationRouter } from "./simulationRouter";
import { dnaRouter } from "./dnaRouter";
import { agentRouter } from "./agentRouter";
import { champRouter } from "./champRouter";
import { backtestingRouter } from "./backtestingRouter";
import { vegasRouter } from "./vegasRouter";
import { beatReporterRouter } from "./beatReporterRouter";
import { gmDecisionRouter } from "./gmDecisionRouter";
import { mlRouter } from "./mlRouter";
import { weeklyAssessmentRouter } from "./weeklyAssessmentRouter";
import { providerRouter } from "./providerRouter";
import { billingRouter } from "./billingRouter";
import { onboardingRouter } from "./onboardingRouter";
import { offseasonRouter } from "./offseasonRouter";
import { upsertLeagueIdentity } from "./leagueIdentityService";
import { getLeagueScoringSettings, getScoringBreakdown } from "./leagueScoringService";
import { getPickTrades, addPickTrade, removePickTrade, upsertViewHealth, getViewHealthForSeason, getAllViewHealth, getScheduledJobs, upsertScheduledJob, getDb, upsertScrapedTrades, getScrapedTrades, upsertLeagueEvents, getLeagueEvents, getLeagueEventsSummary } from "./db";
import { leagueConnections as lcTable } from "../drizzle/schema";
import { eq as eqDrizzle, and as andDrizzle, desc as descDrizzle } from "drizzle-orm";
import { getDraftBoard, getPFRStats, getAdpTrend, type MergedPlayer } from "./fantasyDataService";
import { createHeartbeatJob, updateHeartbeatJob, deleteHeartbeatJob } from "./_core/heartbeat";
import { parse as parseCookie } from "cookie";
import {
  fetchEspnViews,
  fetchEspnViewsHardened,
  fetchTradeProposals,
  mergeTradeProposalsIntoTransactions,
  fetchRecentActivityTrades,
  normalizeSettings,
  normalizeTeams,
  normalizeRosters,
  normalizeDraftPicks,
  normalizeDraftOrder,
  normalizeMatchups,
  normalizeTransactions,
  resolveUnknownPlayerIds,
  validateDataQuality,
  isStale,
  staleSummary,
  hasCookies,
} from "./espnService";
import {
  calcVORP,
  calcPositionalScarcity,
  calcRosterGaps,
  calcKeeperEfficiency,
  calcManagerBehavior,
  calcROSValue,
  calcPickValue,
  type PlayerRow,
  type TeamRow,
  type TransactionRow,
  type DraftPickRow,
  type ManagerBehaviorStats,
} from "./analytics";
import {
  getCachedView,
  upsertCachedView,
  getAllCachedSeasons,
  getRefreshManifests,
  upsertRefreshManifest,
  getChatHistory,
  addChatMessage,
  clearChatHistory,
  getUserMemory,
  upsertUserMemory,
  getActiveLeagueForUser,
  setActiveLeagueForUser,
  persistLlmUsage,
  getLlmUsageSummary,
} from "./db";

const LEAGUE_ID = process.env.ESPN_LEAGUE_ID || "457622";
const ALL_SEASONS = [2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025,2026];

async function getSeasonData(season: number, leagueId?: string) {
  const lid = leagueId ?? process.env.ESPN_LEAGUE_ID ?? "default";
  return memCache(`seasonData:${lid}:${season}`, 10 * 60_000, async () => {
    const cached = await getCachedView(season, "combined", lid);
    return cached ? (cached.payload as Record<string, unknown>) : null;
  });
}

/**
 * Identify the true championship matchup from a season's schedule.
 *
 * ESPN stores both the championship game AND the 3rd-place game as
 * `playoffTierType === 'WINNERS_BRACKET'` in the same final matchup period.
 * The correct approach is to trace which teams won the semi-finals (the
 * WINNERS_BRACKET matchups in the second-to-last playoff period) and then
 * find the final-period matchup that contains exactly those two teams.
 *
 * Falls back to the last WINNERS_BRACKET matchup if tracing fails.
 */
function findChampionshipMatchup(schedule: any[]): any | null {
  const completed = schedule.filter(
    (m: any) => m.playoffTierType === 'WINNERS_BRACKET' && m.winner && m.winner !== 'UNDECIDED'
  );
  if (completed.length === 0) return null;

  // Find the highest matchup period that has WINNERS_BRACKET games
  const maxPeriod = Math.max(...completed.map((m: any) => m.matchupPeriodId as number));
  const finalRound = completed.filter((m: any) => m.matchupPeriodId === maxPeriod);

  // If only one matchup in the final round, that IS the championship
  if (finalRound.length === 1) return finalRound[0];

  // Multiple matchups in the final round (e.g. championship + 3rd-place game).
  // Identify the semi-final winners: teams that won a WINNERS_BRACKET matchup
  // in the period immediately before the final round.
  const semiFinalPeriod = maxPeriod - 1;
  const semiFinals = completed.filter((m: any) => m.matchupPeriodId === semiFinalPeriod);
  if (semiFinals.length > 0) {
    const semiFinalWinners = new Set<number>();
    for (const sf of semiFinals) {
      const winnerId = sf.winner === 'HOME' ? sf.home?.teamId : sf.away?.teamId;
      if (winnerId != null) semiFinalWinners.add(winnerId);
    }
    // The championship matchup is the one where both teams are semi-final winners
    for (const m of finalRound) {
      const homeId = m.home?.teamId;
      const awayId = m.away?.teamId;
      if (homeId != null && awayId != null &&
          semiFinalWinners.has(homeId) && semiFinalWinners.has(awayId)) {
        return m;
      }
    }
  }

  // Fallback: return the last matchup in the final round
  return finalRound[finalRound.length - 1];
}

export const appRouter = router({
  system: systemRouter,
  billing: billingRouter,
  onboarding: onboardingRouter,
  injury: injuryRouter,
  simulation: simulationRouter,
  dna: dnaRouter,
  agents: agentRouter,
  champ: champRouter,
  backtest: backtestingRouter,
  vegas: vegasRouter,
  beatReporter: beatReporterRouter,
  gmDecision: gmDecisionRouter,
  ml: mlRouter,
  weeklyAssessment: weeklyAssessmentRouter,
  providers: providerRouter,
  rivalry: router({
    /** Get cached rivalry scores for the current user (Rod) from DB */
    getScores: publicProcedure.query(async () => {
      const { getRivalryScoresFromDb } = await import("./rivalryService");
      const ROD_NAMES = ["rod sellers", "rodzilla", "str8frmhell"];
      const seasons = await getAllCachedSeasons();
      if (seasons.length === 0) return [];
      const latestSeason = Math.max(...seasons);
      const row = await getCachedView(latestSeason, "combined");
      if (!row) return [];
      const data = row.payload as Record<string, unknown>;
      const members = (data.members as Record<string, unknown>[]) || [];
      let rodMemberId: string | null = null;
      for (const m of members) {
        const name = `${m.firstName || ""} ${m.lastName || ""}`.trim() || (m.displayName as string) || "";
        if (ROD_NAMES.some(n => name.toLowerCase().includes(n))) { rodMemberId = m.id as string; break; }
      }
      if (!rodMemberId) return [];
      return getRivalryScoresFromDb(rodMemberId);
    }),
    /** Compute and persist rivalry scores (manual trigger) */
    refresh: protectedProcedure.mutation(async () => {
      const { refreshRivalryScores } = await import("./rivalryService");
      const pairs = await refreshRivalryScores();
      return { ok: true, count: pairs.length };
    }),
  }),
  tradeNarrative: router({
    /** Get narrative for a single trade by tradeId */
    getByTradeId: publicProcedure
      .input(z.object({ tradeId: z.string() }))
      .query(async ({ input }) => {
        const { getTradeNarrativeFromDb } = await import("./tradeNarrativeService");
        return getTradeNarrativeFromDb(input.tradeId);
      }),
    /** Get narratives for a batch of tradeIds */
    getBatch: publicProcedure
      .input(z.object({ tradeIds: z.array(z.string()) }))
      .query(async ({ input }) => {
        if (input.tradeIds.length === 0) return [];
        const { getTradeNarrativesFromDb } = await import("./tradeNarrativeService");
        return getTradeNarrativesFromDb(input.tradeIds);
      }),
    /** Get the most notorious trades (League-Altering, Quiet Fleece, etc.) */
    getNarratives: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(50).optional() }))
      .query(async ({ input }) => {
        const { getNotoriousTradesFromDb } = await import("./tradeNarrativeService");
        return getNotoriousTradesFromDb(input.limit ?? 20);
      }),
    /** Manually trigger narrative refresh for all cached seasons */
    refresh: publicProcedure.mutation(async () => {
      const { refreshTradeNarratives } = await import("./tradeNarrativeService");
      const result = await refreshTradeNarratives([], { generateLLM: false });
      return { ok: true, ...result };
    }),
  }),
  weeklyStorylines: router({
    /** Get cached storylines for a specific season + week */
    getByWeek: publicProcedure
      .input(z.object({ season: z.number().int(), week: z.number().int() }))
      .query(async ({ input }) => {
        const { getWeeklyStorylinesFromDb } = await import("./weeklyStorylinesService");
        return getWeeklyStorylinesFromDb(input.season, input.week);
      }),
    /** Get the latest cached storylines for a season (most recent week) */
    getLatest: publicProcedure
      .input(z.object({ season: z.number().int().optional() }))
      .query(async ({ input }) => {
        const { getLatestWeeklyStorylinesFromDb } = await import("./weeklyStorylinesService");
        const season = input.season ?? 2025;
        return getLatestWeeklyStorylinesFromDb(season);
      }),
    /** Manually trigger storylines refresh for a season (no new ESPN calls) */
    refresh: publicProcedure
      .input(z.object({ season: z.number().int().optional() }))
      .mutation(async ({ input }) => {
        const { refreshWeeklyStorylines } = await import("./weeklyStorylinesService");
        const season = input.season ?? 2025;
        const rows = await refreshWeeklyStorylines(season);
        return { ok: true, count: rows.length, season };
      }),
  }),
  fearIndex: router({
    /** Get fear index for a specific season + week */
    getByWeek: publicProcedure
      .input(z.object({ season: z.number().int(), week: z.number().int() }))
      .query(async ({ input }) => {
        const { getFearIndexFromDb } = await import("./fearIndexService");
        return getFearIndexFromDb(input.season, input.week);
      }),
    /** Get the latest fear index for a season (most recent week with data) */
    getLatest: publicProcedure
      .input(z.object({ season: z.number().int().optional() }))
      .query(async ({ input }) => {
        const { getLatestFearIndexFromDb } = await import("./fearIndexService");
        const season = input.season ?? 2025;
        return getLatestFearIndexFromDb(season);
      }),
    /** Manually trigger fear index refresh (no new ESPN calls) */
    refresh: publicProcedure
      .input(z.object({ season: z.number().int().optional() }))
      .mutation(async ({ input }) => {
        const { refreshFearIndex } = await import("./fearIndexService");
        const season = input.season ?? 2025;
        const entries = await refreshFearIndex(season);
        return { ok: true, count: entries.length, season };
      }),
  }),
  reputation: router({
    /** Get all reputation events for a specific member */
    getByMember: publicProcedure
      .input(z.object({ memberId: z.string() }))
      .query(async ({ input }) => {
        const { getReputationEventsFromDb } = await import("./reputationService");
        return getReputationEventsFromDb(input.memberId);
      }),
    /** Get all reputation events for a season */
    getBySeason: publicProcedure
      .input(z.object({ season: z.number().int() }))
      .query(async ({ input }) => {
        const { getSeasonReputationEventsFromDb } = await import("./reputationService");
        return getSeasonReputationEventsFromDb(input.season);
      }),
    /** Get all reputation events across all seasons */
    getAll: publicProcedure
      .query(async () => {
        const { getAllReputationEventsFromDb } = await import("./reputationService");
        return getAllReputationEventsFromDb();
      }),
    /** Manually trigger reputation event detection (no new ESPN calls) */
    refresh: publicProcedure
      .mutation(async () => {
        const { refreshReputationEvents } = await import("./reputationService");
        const result = await refreshReputationEvents({ generateLLM: false });
        return { ok: true, ...result };
      }),
  }),

  // ─── Usage Monitor (admin-only) ─────────────────────────────────────────────
  usageMonitor: router({
    /** Cost + call count summary for the last N days */
    getCostSummary: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getCostSummary } = await import("./usageTracker");
        return getCostSummary(input.days);
      }),
    /** Per-feature aggregated stats */
    getFeatureSummary: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getFeatureSummary } = await import("./usageTracker");
        return getFeatureSummary(input.days);
      }),
    /** Daily trend data for charts */
    getDailyTrend: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getDailyTrend } = await import("./usageTracker");
        return getDailyTrend(input.days);
      }),
    /** Top callers by cost */
    getTopCallers: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30), limit: z.number().int().min(1).max(100).default(20) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getTopCallers } = await import("./usageTracker");
        return getTopCallers(input.days, input.limit);
      }),
    /** Recent LLM call log */
    getLLMCallLog: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getLLMCallLog } = await import("./usageTracker");
        return getLLMCallLog(input.limit);
      }),

    /**
     * Public mutation — logs a client-side UI event.
     * Fire-and-forget from the client; never returns sensitive data.
     */
    logUIEvent: publicProcedure
      .input(z.object({
        eventType: z.enum(["page_view", "feature_open", "ai_action", "cta_click", "session_start", "return_visit", "league_switch", "tab_view", "drop_off"]),
        featureName: z.string().max(128),
        page: z.string().max(256).nullable().optional(),
        action: z.string().max(128).nullable().optional(),
        sessionId: z.string().max(64).nullable().optional(),
        metadata: z.string().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { trackUIEvent } = await import("./usageTracker");
        await trackUIEvent({
          eventType: input.eventType,
          featureName: input.featureName,
          page: input.page ?? null,
          action: input.action ?? null,
          sessionId: input.sessionId ?? null,
          userId: ctx.user?.openId ?? null,
          metadata: input.metadata ?? null,
        });
        return { ok: true };
      }),

    /** Feature utilization: top/ignored features by UI event count */
    getFeatureUtilization: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getFeatureUtilization } = await import("./usageTracker");
        return getFeatureUtilization(input.days);
      }),

    /** AI usage broken down by feature name */
    getAIUsageByFeature: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getAIUsageByFeature } = await import("./usageTracker");
        return getAIUsageByFeature(input.days);
      }),

    /** User retention: unique users per ISO week */
    getRetentionByWeek: protectedProcedure
      .input(z.object({ weeks: z.number().int().min(1).max(52).default(12) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getRetentionByWeek } = await import("./usageTracker");
        return getRetentionByWeek(input.weeks);
      }),

    /** Onboarding funnel: ordered step completion counts */
    getOnboardingFunnel: protectedProcedure
      .query(async ({ ctx }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getOnboardingFunnel } = await import("./usageTracker");
        return getOnboardingFunnel();
      }),

    // ── Behavioral analytics (6-question dashboard) ──────────────────────────

    /** Active leagues: ranked by unique users + session count in last N days */
    getActiveLeagueStats: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getActiveLeagueStats } = await import("./usageTracker");
        return getActiveLeagueStats(input.days);
      }),

    /** Feature retention: % of users who returned within 7 days after first use */
    getFeatureRetention: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(60) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getFeatureRetention } = await import("./usageTracker");
        return getFeatureRetention(input.days);
      }),

    /** Ignored tabs: tab_view events sorted by view count ascending */
    getIgnoredTabs: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getIgnoredTabs } = await import("./usageTracker");
        return getIgnoredTabs(input.days);
      }),

    /** League switch frequency: switches per week over last N weeks */
    getLeagueSwitchFrequency: protectedProcedure
      .input(z.object({ weeks: z.number().int().min(1).max(52).default(12) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getLeagueSwitchFrequency } = await import("./usageTracker");
        return getLeagueSwitchFrequency(input.weeks);
      }),

    /** Return visit drivers: features that precede return visits */
    getReturnVisitDrivers: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(60) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getReturnVisitDrivers } = await import("./usageTracker");
        return getReturnVisitDrivers(input.days);
      }),

    /** Drop-off map: pages where sessions end, ranked by exit count */
    getDropOffMap: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getDropOffMap } = await import("./usageTracker");
        return getDropOffMap(input.days);
      }),
  }),

  draftHelper: router({
    /**
     * Fetch live 2026 ESPN draft picks from the ESPN API.
     * Returns all picks already made in the current-year draft,
     * normalized into the DraftPick shape used by the Draft Helper.
     * Falls back to an empty array if the draft has not started yet.
     */
    getLivePicks: protectedProcedure
      .input(z.object({
        season: z.number().int().min(2020).max(2030).default(2026),
      }))
      .query(async ({ ctx, input }) => {
        try {
          // Resolve the user's active ESPN credentials so this works for any connected league
          const { getActiveEspnCredentials } = await import("./db");
          const userCreds = await getActiveEspnCredentials(ctx.user.id);
          const season = input.season;
          const raw = await fetchEspnViews(season, ["mDraftDetail", "mTeam", "mSettings"], userCreds) as Record<string, unknown>;
          const normalizedPicks = normalizeDraftPicks(raw);

          // Build teamId → owner name map from live data
          const memberMap: Record<string, string> = {};
          for (const m of (raw.members as Record<string, unknown>[]) || []) {
            memberMap[m.id as string] = `${m.firstName || ""} ${m.lastName || ""}`.trim();
          }
          const teamOwnerMap: Record<number, string> = {};
          for (const t of (raw.teams as Record<string, unknown>[]) || []) {
            const tid = t.id as number;
            const ownerId = (t.primaryOwner as string) || ((t.owners as string[])?.[0] ?? "");
            teamOwnerMap[tid] = memberMap[ownerId] || `Team ${tid}`;
          }

          // Filter to only picks that have actually been made (playerName is set)
          const madePicks = normalizedPicks
            .filter((p) => p.playerName && p.playerName.trim() !== "")
            .map((p) => ({
              overall: (p.overallPickNumber as number) ?? 0,
              round: (p.roundId as number) ?? 1,
              pickInRound: (p.roundPickNumber as number) ?? 1,
              teamId: (p.teamId as number) ?? 0,
              ownerName: teamOwnerMap[p.teamId as number] || `Team ${p.teamId}`,
              playerName: p.playerName,
              position: p.position || "?",
              keeper: !!(p.keeper),
              autoDrafted: !!(p.autoDrafted),
              proTeam: p.proTeam || "",
            }))
            .sort((a, b) => a.overall - b.overall);

          // Draft status: not_started | in_progress | complete
          const draftDetail = (raw.draftDetail as Record<string, unknown>) || {};
          const allPicks = ((draftDetail.picks as Record<string, unknown>[]) || []);
          const totalSlots = allPicks.length;
          const filledSlots = madePicks.length;
          const status: "not_started" | "in_progress" | "complete" =
            filledSlots === 0 ? "not_started" :
            filledSlots >= totalSlots && totalSlots > 0 ? "complete" :
            "in_progress";

          // Draft order (pick order for 2026)
          const draftOrder = normalizeDraftOrder(raw);
          const pickOrder = draftOrder.pickOrder.map((slot) => ({
            slot: slot.position,
            teamId: slot.teamId,
            ownerName: slot.owners || `Team ${slot.teamId}`,
            teamName: slot.name || `Team ${slot.teamId}`,
          }));

          return {
            picks: madePicks,
            totalSlots,
            filledSlots,
            status,
            pickOrder,
            draftDate: draftOrder.draftDate,
            season,
          };
        } catch (err) {
          // Draft not started yet or ESPN credentials not configured
          return {
            picks: [],
            totalSlots: 0,
            filledSlots: 0,
            status: "not_started" as const,
            pickOrder: [],
            draftDate: null,
            season: input.season,
            error: err instanceof Error ? err.message : "Failed to fetch ESPN draft data",
          };
        }
      }),

    /**
     * Get the full draft context for Rod's current pick:
     * available players, positional needs, owner tendencies, recent picks.
     */
    getDraftContext: publicProcedure
      .input(z.object({
        currentOverall: z.number().int().min(1),
        totalTeams: z.number().int().min(2).max(20).default(14),
        totalRounds: z.number().int().min(1).max(20).default(15),
        rodDraftSlot: z.number().int().min(1).max(20).default(1),
        picksAlreadyMade: z.array(z.object({
          overall: z.number(),
          round: z.number(),
          pickInRound: z.number(),
          teamId: z.number(),
          ownerName: z.string(),
          playerName: z.string(),
          position: z.string(),
        })).default([]),
        rodRoster: z.array(z.object({
          position: z.string(),
          playerName: z.string(),
          round: z.number(),
        })).default([]),
      }))
      .query(async ({ input }) => {
        const {
          scorePositionalNeed, buildOwnerTendencies, calcSurvivalRisk,
          detectPositionRun,
        } = await import("./draftHelperService");

        // 1. Get available players from the draft board
        const board = await getDraftBoard(false);
        const draftedNames = new Set(input.picksAlreadyMade.map((p: { playerName: string }) => p.playerName.toLowerCase()));
        const available = board.players
          .filter((p: MergedPlayer) => !draftedNames.has(p.name.toLowerCase()))
          .slice(0, 200);

        // 2. Get owner tendencies from DNA profiles
        const { calcLeagueDNA } = await import("./leagueDNA");
        const { buildManagerRawData } = await import("./dnaRouter");
        const managers = await buildManagerRawData();
        const dnaProfiles = calcLeagueDNA(managers);

        const cachedSeasons = (await getAllCachedSeasons()).sort((a: number, b: number) => a - b);
        const latestSeason = cachedSeasons[cachedSeasons.length - 1];
        const latestData = latestSeason ? await getSeasonData(latestSeason) : null;
        const pickOrder: Record<string, unknown>[] = latestData ? (normalizeDraftOrder(latestData)?.pickOrder ?? []) : [];

        const ownerInputs = pickOrder.map((slot: Record<string, unknown>) => {
          const tid = slot.teamId as number;
          const ownerName = (slot.owners as string) || `Team ${tid}`;
          const dna = dnaProfiles.find((d: { ownerName?: string }) =>
            d.ownerName && ownerName.toLowerCase().includes(d.ownerName.toLowerCase().split(" ")[0].toLowerCase())
          ) ?? null;
          const dnaAny = dna as Record<string, unknown> | null;
          return {
            teamId: tid,
            ownerName,
            draftSlot: slot.position as number,
            gmArchetype: (dnaAny?.gmArchetype as string) ?? "Balanced Manager",
            reachPositions: ((dnaAny?.draft as Record<string, unknown>)?.reachPositions as string[]) ?? [],
            valuePositions: ((dnaAny?.draft as Record<string, unknown>)?.valuePositions as string[]) ?? [],
            round1Distribution: ((dnaAny?.draft as Record<string, unknown>)?.round1Distribution as Record<string, number>) ?? {},
            keeperRate: ((dnaAny?.draft as Record<string, unknown>)?.keeperRate as number) ?? 0,
            tiltScore: ((dnaAny?.tilt as Record<string, unknown>)?.tiltScore as number) ?? 50,
            exploitabilityScore: (dnaAny?.exploitabilityScore as number) ?? 50,
          };
        });

        const ownerTendencies = buildOwnerTendencies(
          ownerInputs as Array<{ teamId: number; ownerName: string; draftSlot: number; gmArchetype: string; reachPositions: string[]; valuePositions: string[]; round1Distribution: Record<string, number>; keeperRate: number; tiltScore: number; exploitabilityScore: number; }>,
          input.picksAlreadyMade,
          input.currentOverall,
          input.totalTeams,
          input.totalRounds
        );

        // 3. Positional needs
        const currentRound = Math.ceil(input.currentOverall / input.totalTeams);
        const positionalNeeds = scorePositionalNeed(input.rodRoster, currentRound, input.totalRounds);

        // 4. Enrich available players with survival risk
        const picksUntilRodNext = (() => {
          const rodSlot = input.rodDraftSlot;
          let count = 0;
          let overall = input.currentOverall;
          while (overall <= input.totalTeams * input.totalRounds) {
            overall++;
            const round = Math.ceil(overall / input.totalTeams);
            const isEven = round % 2 === 0;
            const pickInRound = ((overall - 1) % input.totalTeams) + 1;
            const slot = isEven ? input.totalTeams - pickInRound + 1 : pickInRound;
            if (slot === rodSlot) break;
            count++;
          }
          return count;
        })();

        const enrichedAvailable = available.slice(0, 50).map((p: MergedPlayer) => ({
          playerName: p.name,
          position: p.position,
          ecrRank: p.ecrRank ?? 999,
          adpRank: p.adpRank ?? 999,
          ecrAdpGap: (p.adpRank ?? 999) - (p.ecrRank ?? 999),
          vbd: (p.pfr2025 as Record<string, number> | null)?.vbd ?? 0,
          survivalRisk: calcSurvivalRisk(
            p.ecrRank ?? 999,
            picksUntilRodNext,
            ownerTendencies,
            p.position
          ),
          leagueHistoryCount: 0,
          avgLeagueRound: 0,
          isLeagueFavorite: false,
        }));

        // 5. Position run detection
        const positionRun = detectPositionRun(input.picksAlreadyMade);

        return {
          currentRound,
          pickInRound: ((input.currentOverall - 1) % input.totalTeams) + 1,
          positionalNeeds,
          availablePlayers: enrichedAvailable,
          ownerTendencies,
          positionRun,
        };
      }),

    /**
     * LLM-powered pick recommendation for Rod's current draft position.
     */
    getPickRecommendation: protectedProcedure
      .input(z.object({
        currentOverall: z.number().int().min(1),
        currentRound: z.number().int().min(1),
        pickInRound: z.number().int().min(1),
        totalTeams: z.number().int().min(2).max(20).default(14),
        totalRounds: z.number().int().min(1).max(20).default(15),
        rodRoster: z.array(z.object({ position: z.string(), playerName: z.string(), round: z.number() })),
        positionalNeeds: z.array(z.object({
          position: z.string(), urgency: z.string(), urgencyScore: z.number(),
          currentCount: z.number(), targetCount: z.number(), reasoning: z.string(),
        })),
        topAvailable: z.array(z.object({
          playerName: z.string(), position: z.string(), ecrRank: z.number(),
          adpRank: z.number(), ecrAdpGap: z.number(), vbd: z.number(),
          survivalRisk: z.number(), leagueHistoryCount: z.number(),
          avgLeagueRound: z.number(), isLeagueFavorite: z.boolean(),
        })),
        ownerTendencies: z.array(z.object({
          ownerName: z.string(), teamId: z.number(), draftSlot: z.number(),
          gmArchetype: z.string(), reachPositions: z.array(z.string()),
          valuePositions: z.array(z.string()), round1Distribution: z.record(z.string(), z.number()),
          keeperRate: z.number(), tiltScore: z.number(), exploitabilityScore: z.number(),
          nextPickOverall: z.number().nullable(), predictedPositions: z.array(z.string()),
        })),
        recentPicks: z.array(z.object({
          overall: z.number(), round: z.number(), pickInRound: z.number(),
          teamId: z.number(), ownerName: z.string(), playerName: z.string(), position: z.string(),
        })),
        positionRun: z.object({ position: z.string(), count: z.number(), alert: z.string() }).nullable(),
      }))
      .mutation(async ({ input }) => {
        const { buildPickRecommendationPrompt, parsePickRecommendation } = await import("./draftHelperService");
        const { invokeLLM: llm } = await import("./_core/llm");

        const leagueContext = "14-team PPR snake draft, 15 rounds. Rod Sellers (Str8 Jacket / Rodzilla) is the user. This is the ATLANTAS FINEST FF league running since 2009. Rod has won multiple championships and is a top-tier manager.";

        const prompt = buildPickRecommendationPrompt({
          currentOverall: input.currentOverall,
          currentRound: input.currentRound,
          pickInRound: input.pickInRound,
          totalTeams: input.totalTeams,
          totalRounds: input.totalRounds,
          rodRoster: input.rodRoster,
          positionalNeeds: input.positionalNeeds as import("./draftHelperService").PositionalNeed[],
          topAvailable: input.topAvailable,
          ownerTendencies: input.ownerTendencies as import("./draftHelperService").OwnerTendency[],
          recentPicks: input.recentPicks,
          positionRun: input.positionRun,
          leagueContext,
        });

        const response = await llm({
          messages: [
            { role: "system", content: "You are an elite fantasy football draft advisor. Always respond with valid JSON only." },
            { role: "user", content: prompt },
          ],
          callType: "draft_helper",
        });

        const rawContent = response?.choices?.[0]?.message?.content ?? "";
        const raw = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
        const recommendation = parsePickRecommendation(raw);
        if (!recommendation) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to parse LLM recommendation" });
        }
        return recommendation;
      }),
  }),

  league: router({
    // Get the user's active league connection
    getActive: protectedProcedure.query(async ({ ctx }) => {
      const row = await getActiveLeagueForUser(ctx.user.id);
      if (!row) return null;
      return {
        id: row.id,
        provider: row.provider,
        leagueId: row.leagueId,
        leagueName: row.leagueName,
        season: row.season,
        syncStatus: row.syncStatus,
        lastSyncedAt: row.lastSyncedAt,
      };
    }),
    // Set the user's active league
    setActive: protectedProcedure
      .input(z.object({ leagueConnectionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const ok = await setActiveLeagueForUser(ctx.user.id, input.leagueConnectionId);
        return { success: ok };
      }),
    // List all of the user's connected leagues
    getMyLeagues: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({
          id: lcTable.id,
          provider: lcTable.provider,
          leagueId: lcTable.leagueId,
          leagueName: lcTable.leagueName,
          season: lcTable.season,
          isActive: lcTable.isActive,
          syncStatus: lcTable.syncStatus,
          lastSyncedAt: lcTable.lastSyncedAt,
        })
        .from(lcTable)
        .where(eqDrizzle(lcTable.userId, ctx.user.id))
        .orderBy(lcTable.updatedAt);
      return rows;
    }),
    // Remove a league connection (hard delete — user owns the row)
    removeLeague: protectedProcedure
      .input(z.object({ leagueConnectionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) return { success: false };
        // Only delete rows owned by this user
        await db
          .delete(lcTable)
          .where(
            andDrizzle(
              eqDrizzle(lcTable.id, input.leagueConnectionId),
              eqDrizzle(lcTable.userId, ctx.user.id)
            )
          );
        // If the deleted row was the active one, clear activeLeagueId
        const usersTable = (await import("../drizzle/schema")).users;
        const userRow = await db
          .select({ activeLeagueId: usersTable.activeLeagueId })
          .from(usersTable)
          .where(eqDrizzle(usersTable.id, ctx.user.id))
          .then(r => r[0]);
        if (userRow?.activeLeagueId === input.leagueConnectionId) {
          // Pick the next available league, or set to 0
          const remaining = await db
            .select({ id: lcTable.id })
            .from(lcTable)
            .where(eqDrizzle(lcTable.userId, ctx.user.id))
            .limit(1);
          const nextId = remaining[0]?.id ?? 0;
          await db
            .update(usersTable)
            .set({ activeLeagueId: nextId })
            .where(eqDrizzle(usersTable.id, ctx.user.id));
        }
        return { success: true };
      }),
  }),
  offseason: offseasonRouter,
  leagueScoring: router({
    getSettings: publicProcedure
      .input(z.object({ season: z.number().optional() }))
      .query(async ({ input }) => {
        const settings = await getLeagueScoringSettings(input.season);
        return {
          scoringType: settings.scoringType,
          scoringDescription: settings.scoringDescription,
          receptionPoints: settings.receptionPoints,
          passingTDPoints: settings.passingTDPoints,
          rushingTDPoints: settings.rushingTDPoints,
          receivingTDPoints: settings.receivingTDPoints,
          passingYardsPerPoint: settings.passingYardsPerPoint,
          rushingYardsPerPoint: settings.rushingYardsPerPoint,
          receivingYardsPerPoint: settings.receivingYardsPerPoint,
          interceptionPoints: settings.interceptionPoints,
          breakdown: getScoringBreakdown(settings),
          fetchedAt: settings.fetchedAt,
        };
      }),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  espn: router({
    diagnoseTrades: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return { error: "no data", season: input.season };
        const txs = (data.transactions as Record<string, unknown>[]) || [];
        const typeCounts: Record<string, number> = {};
        const statusCounts: Record<string, number> = {};
        for (const tx of txs) {
          const type = String(tx.type || "null");
          const status = String(tx.status || "null");
          typeCounts[type] = (typeCounts[type] || 0) + 1;
          statusCounts[`${type}::${status}`] = (statusCounts[`${type}::${status}`] || 0) + 1;
        }
        const sampleTrade = txs.find(t => t.type === "TRADE_PROPOSAL" || t.type === "TRADE");
        const sampleUphold = txs.find(t => t.type === "TRADE_UPHOLD" || t.type === "TRADE_ACCEPT");
        return {
          season: input.season,
          totalTxs: txs.length,
          typeCounts,
          statusCounts,
          sampleTrade: sampleTrade ? { ...sampleTrade, items: `[${((sampleTrade.items as unknown[]) || []).length} items]`, firstItem: ((sampleTrade.items as Record<string, unknown>[]) || [])[0] } : null,
          sampleUphold: sampleUphold || null,
        };
      }),

    ingestScrapedTrades: publicProcedure
      .input(z.object({
        season: z.number().int().min(2000).max(2100),
        trades: z.array(z.object({
          tradeKey: z.string(),
          executedAt: z.number(),
          sideA: z.object({
            teamId: z.number(),
            ownerName: z.string(),
            players: z.array(z.object({ playerId: z.number(), playerName: z.string(), position: z.string() })),
            picks: z.array(z.object({ label: z.string(), round: z.number(), pickInRound: z.number() })),
          }),
          sideB: z.object({
            teamId: z.number(),
            ownerName: z.string(),
            players: z.array(z.object({ playerId: z.number(), playerName: z.string(), position: z.string() })),
            picks: z.array(z.object({ label: z.string(), round: z.number(), pickInRound: z.number() })),
          }),
          rawJson: z.string().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const rows = input.trades.map(t => ({
          tradeKey: t.tradeKey,
          season: input.season,
          executedAt: t.executedAt,
          sideAJson: JSON.stringify(t.sideA),
          sideBJson: JSON.stringify(t.sideB),
          rawJson: t.rawJson ?? null,
        }));
        const count = await upsertScrapedTrades(rows);
        return { ok: true, upserted: count };
      }),

    /**
     * ESPN Activity Capture — called by the Chrome extension on every ESPN page nav.
     * Receives normalised transaction events, dedupes by espnTxId, stores in league_events.
     * No AI, no narratives — raw capture only.
     */
    captureActivity: publicProcedure
      .input(z.object({
        leagueId: z.string().max(32),
        season: z.number().int().min(2000).max(2100),
        events: z.array(z.object({
          espnTxId: z.string().max(64),
          eventType: z.enum(["TRADE", "ADD", "DROP", "WAIVER", "TRADE_PROPOSAL"]),
          processedAt: z.number(),
          teamId: z.number().int().default(0),
          ownerName: z.string().max(128).default(""),
          payloadJson: z.string(),
          rawJson: z.string().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const rows = input.events.map(e => ({
          espnTxId: e.espnTxId,
          leagueId: input.leagueId,
          season: input.season,
          eventType: e.eventType,
          processedAt: e.processedAt,
          teamId: e.teamId,
          ownerName: e.ownerName,
          payloadJson: e.payloadJson,
          rawJson: e.rawJson ?? null,
        }));
        const count = await upsertLeagueEvents(rows);
        return { ok: true, captured: input.events.length, newEvents: count };
      }),

    /** Get recent league events for a league+season (admin debug + future Activity Feed). */
    getActivityEvents: publicProcedure
      .input(z.object({
        season: z.number().int().min(2000).max(2100).optional(),
        eventType: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      }))
      .query(async ({ input }) => {
        const all = await getLeagueEvents(LEAGUE_ID, input.season, input.eventType, (input.offset + input.limit));
        const paged = all.slice(input.offset, input.offset + input.limit);
        return { events: paged, total: all.length };
      }),

    /** Summary count of events by type for a league+season (admin debug). */
    getActivitySummary: publicProcedure
      .input(z.object({
        season: z.number().int().min(2000).max(2100).optional(),
      }))
      .query(async ({ input }) => {
        const rows = await getLeagueEventsSummary(LEAGUE_ID, input.season);
        const byType: Record<string, number> = {};
        for (const row of rows) byType[row.eventType] = (byType[row.eventType] ?? 0) + 1;
        return { total: rows.length, byType };
      }),

    refresh: publicProcedure
      .input(z.object({
        season: z.number().optional(),
        seasons: z.array(z.number()).optional(),
        forceRefresh: z.boolean().optional(), // override closed-season skip
      }))
      .mutation(async ({ input }) => {
        const CURRENT_SEASON = 2026;
        const CLOSED_SEASONS = ALL_SEASONS.filter(s => s < CURRENT_SEASON); // 2009–2025 are closed
        const seasonsToRefresh = input.seasons ?? (input.season ? [input.season] : [ALL_SEASONS[ALL_SEASONS.length - 1]]);
        const results: Record<number, { status: string; error?: string; viewHealth?: Record<string, string>; qualityWarnings?: string[]; skipped?: boolean }> = {};

        // Resolve active league credentials for multi-league isolation.
        // For public procedures (no ctx.user), we read the first active ESPN connection.
        let activeCreds: import('./espnService').EspnCreds | undefined;
        try {
          const db = await getDb();
          if (db) {
            const activeRows = await db
              .select()
              .from(lcTable)
              .where(andDrizzle(eqDrizzle(lcTable.isActive, true), eqDrizzle(lcTable.provider, 'espn')))
              .orderBy(descDrizzle(lcTable.updatedAt))
              .limit(1);
            if (activeRows[0]) {
              const { decryptCredentialsFromDb } = await import('./_core/crypto');
              const rawCreds = decryptCredentialsFromDb(activeRows[0].credentials) as Record<string, string> | null;
              if (rawCreds?.swid && rawCreds?.espnS2) {
                activeCreds = {
                  leagueId: (rawCreds.leagueId as string) ?? activeRows[0].leagueId,
                  swid: rawCreds.swid,
                  espnS2: rawCreds.espnS2,
                };
              }
            }
          }
        } catch (_e) { /* non-fatal — fall back to env-var league */ }
        const activeLeagueId = activeCreds?.leagueId ?? LEAGUE_ID;

        for (const season of seasonsToRefresh) {
          // Skip closed seasons that are already successfully cached (unless forceRefresh)
          if (!input.forceRefresh && CLOSED_SEASONS.includes(season)) {
            const existing = await getRefreshManifests();
            const manifest = (existing as { season: number; status: string }[]).find(m => m.season === season);
            if (manifest?.status === "success") {
              results[season] = { status: "skipped", skipped: true };
              continue;
            }
          }
          try {
            // Use hardened pipeline with per-view error isolation
            const pipelineResult = await fetchEspnViewsHardened(season, undefined, activeCreds);
            const data = pipelineResult.merged;

            // Persist per-view health records
            for (const vr of pipelineResult.viewResults) {
              await upsertViewHealth(season, vr.viewName, {
                status: vr.status === "auth_error" ? "error" : vr.status,
                errorMessage: vr.error,
                recordCount: vr.recordCount,
              });
            }

            // Enrich transactions:
            // 1. Fetch all TRADE_PROPOSAL records via x-fantasy-filter (fills in aged-out proposals)
            // 2. Fetch executed trades from the communication/activity feed (2026+: accepted trades
            //    disappear from mTransactions2 once executed — they only exist in the activity feed
            //    as messageTypeId 246 topics, which we reconstruct into synthetic TRADE_PROPOSAL rows)
            let enrichedData = data;
            try {
              const proposals = await fetchTradeProposals(season);
              enrichedData = mergeTradeProposalsIntoTransactions(data, proposals);
            } catch (_e) { /* non-fatal — fall back to unmerged data */ }
            try {
              const activityTrades = await fetchRecentActivityTrades(season, enrichedData);
              if (activityTrades.length > 0) {
                enrichedData = mergeTradeProposalsIntoTransactions(enrichedData, activityTrades);
              }
            } catch (_e) { /* non-fatal — fall back without activity trades */ }

            await upsertCachedView(season, "combined", enrichedData, activeLeagueId);
            // Persist static identity data (team names, draft order, settings) to league_identity table.
            // All consumers (offseasonRouter, draftBoard, etc.) read from here instead of re-fetching ESPN.
            try { await upsertLeagueIdentity(season, enrichedData); } catch (_e) { /* non-fatal — don't block the refresh */ }
            const teams = normalizeTeams(enrichedData);
            const rosters = normalizeRosters(enrichedData);
            const matchups = normalizeMatchups(enrichedData);
            const picks = normalizeDraftPicks(enrichedData);
            const txs = normalizeTransactions(enrichedData);

            // Data quality validation
            const quality = validateDataQuality(season, data);

            const overallStatus = pipelineResult.allViewsOk && quality.isUsable ? "success"
              : pipelineResult.hasPartialData || !quality.isUsable ? "partial"
              : "success";

            await upsertRefreshManifest(season, {
              teamCount: teams.length, rosterCount: rosters.length,
              matchupCount: matchups.length, draftPickCount: picks.length,
              transactionCount: txs.length, status: overallStatus,
              viewsRefreshed: pipelineResult.viewResults.filter(v => v.status === "ok").map(v => v.viewName),
              errorMessage: quality.issues.length > 0 ? quality.issues.join("; ") : undefined,
            });

            const viewHealth: Record<string, string> = {};
            for (const vr of pipelineResult.viewResults) viewHealth[vr.viewName] = vr.status;

            results[season] = {
              status: overallStatus,
              viewHealth,
              qualityWarnings: [...quality.issues, ...quality.warnings],
            };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            await upsertRefreshManifest(season, { status: "failed", errorMessage: msg });
            results[season] = { status: "failed", error: msg };
          }
        }
        // Bust all in-memory caches so next page load recomputes with fresh data
        memCache.invalidateAll();
        // Recompute rivalry scores after data refresh (non-fatal)
        try {
          const { refreshRivalryScores } = await import("./rivalryService");
          await refreshRivalryScores();
        } catch (_e) { /* non-fatal — rivalry scores are a bonus layer */ }
        // Recompute trade narratives after data refresh (non-fatal, deterministic labels only — LLM deferred)
        try {
          const { refreshTradeNarratives } = await import("./tradeNarrativeService");
          // Build lightweight NarrativeTradeInput list from all cached seasons
          const narrativeInputs: import("./tradeNarrativeService").NarrativeTradeInput[] = [];
          for (const season of await getAllCachedSeasons()) {
            try {
              const raw = await getCachedView(season, "combined");
              if (!raw) continue;
              const payload = raw.payload as Record<string, unknown>;
              const teams = normalizeTeams(payload);
              type TxnRow = { type: string; transactionId: string; relatedTransactionId?: string; playerId?: number; playerName?: string; position?: string; teamId: number; fromTeamId?: number; proposedDate?: number };
              const txns = normalizeTransactions(payload) as TxnRow[];
              const ownerMap = new Map<number, { ownerName: string; teamName: string }>();
              for (const t of teams) ownerMap.set(t.teamId as number, { ownerName: (t as unknown as { ownerName?: string }).ownerName || t.owners || "", teamName: t.teamName });
              // Identify completed trades (TRADE_UPHOLD / TRADE_ACCEPT rows)
              const acceptRows = txns.filter(r => r.type === "TRADE_UPHOLD" || r.type === "TRADE_ACCEPT");
              const completedProposalIds = new Set<string>(acceptRows.map(r => r.relatedTransactionId).filter(Boolean) as string[]);
              // Build proposal item map
              const proposalItemMap = new Map<string, { playerId: number; playerName: string; position: string; teamId: number; fromTeamId: number }[]>();
              for (const r of txns) {
                if (r.type !== "TRADE_PROPOSAL") continue;
                if (!completedProposalIds.has(r.transactionId)) continue;
                const items = proposalItemMap.get(r.transactionId) || [];
                if (r.playerId) items.push({ playerId: r.playerId, playerName: r.playerName || "", position: r.position || "?", teamId: r.teamId, fromTeamId: r.fromTeamId || r.teamId });
                proposalItemMap.set(r.transactionId, items);
              }
              for (const proposalId of Array.from(completedProposalIds)) {
                const items = proposalItemMap.get(proposalId);
                if (!items || items.length === 0) continue;
                const teamsInvolved = Array.from(new Set(items.map(i => i.fromTeamId)));
                if (teamsInvolved.length < 2) continue;
                const [teamA, teamB] = teamsInvolved;
                const sideAItems = items.filter(i => i.fromTeamId === teamA);
                const sideBItems = items.filter(i => i.fromTeamId === teamB);
                const ownerA = ownerMap.get(teamA);
                const ownerB = ownerMap.get(teamB);
                if (!ownerA || !ownerB) continue;
                const acceptRow = acceptRows.find(r => r.relatedTransactionId === proposalId);
                const proposedDate = acceptRow?.proposedDate || Date.now();
                const toNarrativeSide = (sideItems: typeof sideAItems, owner: { ownerName: string; teamName: string }, teamId: number): import("./tradeNarrativeService").NarrativeTradeSide => ({
                  teamId,
                  ownerName: owner.ownerName,
                  players: sideItems.map(i => ({ playerId: i.playerId, playerName: i.playerName, position: i.position, avgPoints: 0, seasonPoints: 0, compositeValue: 0 })),
                  picks: [],
                  totalValue: 0,
                });
                narrativeInputs.push({
                  season,
                  tradeId: proposalId,
                  proposedDate: typeof proposedDate === "number" ? proposedDate : Date.now(),
                  sideA: toNarrativeSide(sideAItems, ownerA, teamA),
                  sideB: toNarrativeSide(sideBItems, ownerB, teamB),
                  verdict: "even",
                  verdictMargin: 0,
                });
              }
            } catch { /* skip season */ }
          }
          // Deterministic labels only (no LLM during auto-refresh to keep it fast)
          await refreshTradeNarratives(narrativeInputs, { generateLLM: false });
        } catch (_e) { /* non-fatal — trade narratives are a bonus layer */ }
        return results;
      }),

    manifests: publicProcedure.query(async () => getRefreshManifests()),
    cachedSeasons: publicProcedure.query(async () => getAllCachedSeasons()),
    allSeasons: publicProcedure.query(() => ALL_SEASONS),

    settings: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return null;
        return normalizeSettings(data);
      }),

    teams: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        return normalizeTeams(data);
      }),

    standings: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const teams = normalizeTeams(data);
        return teams.sort((a, b) => ((a.rankFinal as number) || 99) - ((b.rankFinal as number) || 99));
      }),

    rosters: publicProcedure
      .input(z.object({ season: z.number(), teamId: z.number().optional() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rosters = normalizeRosters(data);
        if (input.teamId !== undefined) return rosters.filter((r: unknown) => (r as Record<string, unknown>).teamId === input.teamId);
        return rosters;
      }),

    draftPicks: publicProcedure
      .input(z.object({ season: z.number(), teamId: z.number().optional() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rawPicks = normalizeDraftPicks(data) as unknown[];
        // Resolve any player IDs that weren't in the roster map
        const unknownIds = rawPicks
          .filter((p: unknown) => !(p as Record<string, unknown>).playerName)
          .map((p: unknown) => (p as Record<string, unknown>).playerId as number)
          .filter(Boolean);
        let picks: unknown[] = rawPicks;
        if (unknownIds.length > 0) {
          const resolved = await resolveUnknownPlayerIds(unknownIds);
          picks = rawPicks.map((p: unknown) => {
            const pick = p as Record<string, unknown>;
            if (!pick.playerName && resolved.has(pick.playerId as number)) {
              const info = resolved.get(pick.playerId as number)!;
              return { ...pick, playerName: info.name, position: pick.position === "?" ? info.position : pick.position };
            }
            return pick;
          });
        }
        if (input.teamId !== undefined) return picks.filter((p: unknown) => (p as Record<string, unknown>).teamId === input.teamId);
        return picks;
      }),

    matchups: publicProcedure
      .input(z.object({ season: z.number(), matchupPeriodId: z.number().optional() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const matchups = normalizeMatchups(data);
        if (input.matchupPeriodId !== undefined) return matchups.filter((m: unknown) => (m as Record<string, unknown>).matchupPeriodId === input.matchupPeriodId);
        return matchups;
      }),

    transactions: publicProcedure
      .input(z.object({ season: z.number(), teamId: z.number().optional() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const txs = normalizeTransactions(data);
        if (input.teamId !== undefined) return txs.filter((t: unknown) => (t as Record<string, unknown>).teamId === input.teamId);
        return txs;
      }),

    // ── Trade Aging ─────────────────────────────────────────────────────────────
    // Reconstructs completed trades from all cached seasons, scores each side
    // using season-specific player stats, and returns a verdict (winner).
    //
    // Data sources:
    //   - normalizeTransactions: TRADE / TRADE_PROPOSAL item rows (player movement)
    //   - normalizeRosters: season-specific avgPoints for scoring
    //   - normalizeTeams: owner names per season
    //
    // 2026 support: TRADE_PROPOSAL items (merged by fetchTradeProposals) are used
    // directly; TRADE_UPHOLD/TRADE_ACCEPT header rows are skipped (no items).
    tradeAging: publicProcedure
      .input(z.object({ season: z.number().optional() }))
      .query(async ({ input }) => {
        const { calcVORP, calcROSValue, calcPickValue } = await import("./analytics");
        // Helper: compute a single player's ROS composite value
        const playerCompositeValue = (avgPoints: number, position: string, vorp: number): number => {
          const fakePlayer = { playerId: 0, playerName: "", position, teamId: 0, ownerName: "", seasonPoints: 0, avgPoints, projectedTotal: null, keeperValue: 0, keeperValueFuture: 0, injuryStatus: "", appliedStats: {} };
          const rosResults = calcROSValue([fakePlayer], 10);
          const rosAdjusted = rosResults[0]?.rosAdjusted ?? (avgPoints * 10);
          return Math.round(rosAdjusted + (vorp * 5));
        };
        const seasons = input.season
          ? [input.season]
          : (await getAllCachedSeasons()).sort((a, b) => a - b);

        // ── Types ──────────────────────────────────────────────────────────────
        interface TradeSide {
          teamId: number;
          ownerName: string;
          players: { playerId: number; playerName: string; position: string; avgPoints: number; seasonPoints: number; compositeValue: number }[];
          picks: { label: string; round: number; pickInRound: number; value: number }[];
          totalValue: number;
        }
        interface TradeRecord {
          season: number;
          tradeId: string;         // transactionId of the TRADE / TRADE_PROPOSAL
          proposedDate: number;
          sideA: TradeSide;
          sideB: TradeSide;
          verdict: "sideA" | "sideB" | "even";  // who got more value
          verdictMargin: number;   // abs difference in composite value
        }

        const allTrades: TradeRecord[] = [];

        for (const season of seasons) {
          const data = await getSeasonData(season);
          if (!data) continue;

          // Build player value map for this season
          const rosters = normalizeRosters(data) as Record<string, unknown>[];
          const playerMap = new Map<number, { avgPoints: number; seasonPoints: number; position: string; playerName: string }>();
          for (const r of rosters) {
            const pid = r.playerId as number;
            if (pid && !playerMap.has(pid)) {
              playerMap.set(pid, {
                avgPoints: (r.appliedAverage as number) || (r.avgPoints as number) || 0,
                seasonPoints: (r.appliedTotal as number) || (r.seasonPoints as number) || 0,
                position: r.position as string || "?",
                playerName: r.playerName as string || "Unknown",
              });
            }
          }

          // Build VORP for composite scoring
          const playerRows = rosters.map(r => ({
            playerId: r.playerId as number,
            playerName: r.playerName as string || "",
            position: r.position as string || "?",
            teamId: r.teamId as number,
            ownerName: "",
            seasonPoints: (r.appliedTotal as number) || 0,
            avgPoints: (r.appliedAverage as number) || 0,
            projectedTotal: null,
            keeperValue: 0,
            keeperValueFuture: 0,
            injuryStatus: "",
            appliedStats: {},
          }));
          const vorpMap = new Map<number, number>();
          try {
            const vorpResults = calcVORP(playerRows);
            for (const v of vorpResults) { if (v.playerId) vorpMap.set(v.playerId, v.vorp); }
          } catch { /* non-fatal */ }

          // Build owner name map
          const teams = normalizeTeams(data) as Record<string, unknown>[];
          const ownerMap = new Map<number, string>();
          for (const t of teams) ownerMap.set(t.teamId as number, (t.owners as string) || `Team ${t.teamId}`);

          // Collect completed trade item rows.
          // Legacy path: type === "TRADE" && status === "EXECUTED" (or empty)
          // 2026 path: TRADE_UPHOLD/TRADE_ACCEPT rows link to TRADE_PROPOSAL via relatedTransactionId
          const txRows = normalizeTransactions(data) as Record<string, unknown>[];

          // Build lookup: proposalId → proposal item rows (may be empty if ESPN purged the proposal)
          // Note: pick items have playerId=0 (falsy), so use !playerId to detect them
          const proposalItemMap = new Map<string, Record<string, unknown>[]>();
          for (const r of txRows) {
            if (r.type === "TRADE_PROPOSAL" && r.playerId && r.itemType !== "DRAFT_TRADE") {
              const tid = r.transactionId as string;
              if (!proposalItemMap.has(tid)) proposalItemMap.set(tid, []);
              proposalItemMap.get(tid)!.push(r);
            }
          }
          // Also collect pick rows from proposals (playerId=0 or null + itemType=DRAFT_TRADE)
          const proposalPickMap = new Map<string, Record<string, unknown>[]>();
          for (const r of txRows) {
            if (r.type === "TRADE_PROPOSAL" && r.itemType === "DRAFT_TRADE") {
              const tid = r.transactionId as string;
              if (!proposalPickMap.has(tid)) proposalPickMap.set(tid, []);
              proposalPickMap.get(tid)!.push(r);
            }
          }

          // Build set of completed proposal IDs from acceptance rows
          const completedProposalIds = new Set<string>();
          // Also track acceptance row metadata (proposedDate) keyed by proposalId
          const acceptanceDateMap = new Map<string, number>();
          for (const r of txRows) {
            if (r.type === "TRADE_UPHOLD" || r.type === "TRADE_ACCEPT") {
              const relId = r.relatedTransactionId as string | null;
              if (relId) {
                completedProposalIds.add(relId);
                // Use the acceptance row's proposedDate as fallback trade date
                const d = (r.proposedDate as number) || 0;
                if (d > 0 && !acceptanceDateMap.has(relId)) acceptanceDateMap.set(relId, d);
              }
            }
            // 2026 path: ESPN may not emit TRADE_UPHOLD rows for pick-only trades.
            // Treat TRADE_PROPOSAL rows with status EXECUTED as completed directly.
            if (r.type === "TRADE_PROPOSAL" && String(r.status || "").toUpperCase() === "EXECUTED") {
              const tid = r.transactionId as string;
              if (tid) {
                completedProposalIds.add(tid);
                const d = (r.proposedDate as number) || 0;
                if (d > 0 && !acceptanceDateMap.has(tid)) acceptanceDateMap.set(tid, d);
              }
            }
          }

          const isCompletedTradeRow = (r: Record<string, unknown>) => {
            const type = r.type as string;
            const status = String(r.status || "").toUpperCase();
            if (type === "TRADE") return status === "" || status === "EXECUTED";
            if (type === "TRADE_PROPOSAL") {
              return completedProposalIds.has(r.transactionId as string) || status === "EXECUTED";
            }
            return false;
          };

          // Legacy path: collect item rows from TRADE / TRADE_PROPOSAL rows that are in cache
          // playerId=0 is a pick item (falsy), so use truthy check for player rows
          const tradeItemRows = txRows.filter(r => isCompletedTradeRow(r) && r.playerId && r.itemType !== "DRAFT_TRADE");
          const pickTradeRows = txRows.filter(r => isCompletedTradeRow(r) && r.itemType === "DRAFT_TRADE");

          // Group by transactionId (legacy path)
          // Also seed proposedDate from acceptanceDateMap so 2026 proposals with date=0 get the right date
          const tradeGroups = new Map<string, { playerRows: Record<string, unknown>[]; pickRows: Record<string, unknown>[]; proposedDate?: number }>();
          for (const row of tradeItemRows) {
            const tid = row.transactionId as string;
            if (!tradeGroups.has(tid)) tradeGroups.set(tid, { playerRows: [], pickRows: [], proposedDate: acceptanceDateMap.get(tid) });
            tradeGroups.get(tid)!.playerRows.push(row);
          }
          for (const row of pickTradeRows) {
            const tid = row.transactionId as string;
            if (!tradeGroups.has(tid)) tradeGroups.set(tid, { playerRows: [], pickRows: [], proposedDate: acceptanceDateMap.get(tid) });
            tradeGroups.get(tid)!.pickRows.push(row);
          }

          // 2026 path: for each completed proposal ID, if the proposal item rows are NOT already
          // in the cache (ESPN purged them), reconstruct from the acceptance row's relatedTransactionId.
          // If proposal IS in cache, it's already handled above via isCompletedTradeRow.
          // If proposal is NOT in cache, skip gracefully (no fake data).
          for (const proposalId of Array.from(completedProposalIds)) {
            if (tradeGroups.has(proposalId)) continue; // already covered by legacy path
            const itemRows = proposalItemMap.get(proposalId);
            const pickRows = proposalPickMap.get(proposalId);
            if (!itemRows?.length && !pickRows?.length) continue; // proposal not in cache — skip gracefully
            // Proposal IS in cache but wasn't picked up by isCompletedTradeRow (e.g. status mismatch)
            tradeGroups.set(proposalId, {
              playerRows: itemRows ?? [],
              pickRows: pickRows ?? [],
              proposedDate: acceptanceDateMap.get(proposalId),
            });
          }

          // 2026 supplemental path: scan ALL proposal maps for EXECUTED proposals that
          // were not caught by either the legacy path or the completedProposalIds loop.
          // This handles pick-only trades where ESPN emits no TRADE_UPHOLD header row.
          for (const [proposalId, itemRows] of Array.from(proposalItemMap)) {
            if (tradeGroups.has(proposalId)) continue;
            const pickRows = proposalPickMap.get(proposalId) ?? [];
            if (!itemRows.length && !pickRows.length) continue;
            tradeGroups.set(proposalId, {
              playerRows: itemRows,
              pickRows,
              proposedDate: acceptanceDateMap.get(proposalId),
            });
          }
          for (const [proposalId, pickRows] of Array.from(proposalPickMap)) {
            if (tradeGroups.has(proposalId)) continue;
            if (!pickRows.length) continue;
            tradeGroups.set(proposalId, {
              playerRows: [],
              pickRows,
              proposedDate: acceptanceDateMap.get(proposalId),
            });
          }

          // For each trade group, reconstruct both sides
          for (const [tradeId, group] of Array.from(tradeGroups)) {
            // Determine the two team IDs involved
            const teamIdsSet = new Set<number>();
            for (const r of [...group.playerRows, ...group.pickRows]) {
              if (r.fromTeamId != null && (r.fromTeamId as number) > 0) teamIdsSet.add(r.fromTeamId as number);
              if (r.toTeamId != null && (r.toTeamId as number) > 0) teamIdsSet.add(r.toTeamId as number);
            }
            if (teamIdsSet.size < 2) continue; // can't reconstruct a 1-sided trade

            const [teamAId, teamBId] = Array.from(teamIdsSet);

            // Build sides: each side receives what was sent TO them
            const buildSide = (receivingTeamId: number): TradeSide => {
              const players: TradeSide["players"] = [];
              const picks: TradeSide["picks"] = [];

              for (const r of group.playerRows) {
                if ((r.toTeamId as number) === receivingTeamId) {
                  const pid = r.playerId as number;
                  const pInfo = playerMap.get(pid);
                  const avgPts = pInfo?.avgPoints ?? 0;
                  const vorp = vorpMap.get(pid) ?? 0;
                  const pos = (r.position as string) || pInfo?.position || "?";
                  const compositeValue = playerCompositeValue(avgPts, pos, vorp);
                  players.push({
                    playerId: pid,
                    playerName: (r.playerName as string) || pInfo?.playerName || `Player ${pid}`,
                    position: (r.position as string) || pInfo?.position || "?",
                    avgPoints: avgPts,
                    seasonPoints: pInfo?.seasonPoints ?? 0,
                    compositeValue,
                  });
                }
              }

              for (const r of group.pickRows) {
                if ((r.toTeamId as number) === receivingTeamId) {
                  const round = (r.round as number) || 1;
                  const pickInRound = (r.pickInRound as number) || 7;
                  const overall = (r.overallPickNumber as number);
                  // Derive round/pickInRound from overallPickNumber if available
                  const derivedRound = overall ? Math.ceil(overall / 14) : round;
                  const derivedPick = overall ? ((overall - 1) % 14) + 1 : pickInRound;
                  const value = calcPickValue(derivedRound, derivedPick);
                  picks.push({
                    label: `${derivedRound}.${String(derivedPick).padStart(2, "0")}`,
                    round: derivedRound,
                    pickInRound: derivedPick,
                    value,
                  });
                }
              }

              const totalValue =
                players.reduce((s, p) => s + p.compositeValue, 0) +
                picks.reduce((s, p) => s + p.value, 0);

              return {
                teamId: receivingTeamId,
                ownerName: ownerMap.get(receivingTeamId) || `Team ${receivingTeamId}`,
                players,
                picks,
                totalValue,
              };
            };

            const sideA = buildSide(teamAId);
            const sideB = buildSide(teamBId);

            // Skip trades where both sides are empty (e.g. header-only rows)
            if (sideA.players.length + sideA.picks.length + sideB.players.length + sideB.picks.length === 0) continue;

            const margin = sideA.totalValue - sideB.totalValue;
            const verdict: TradeRecord["verdict"] =
              Math.abs(margin) < 50 ? "even" : margin > 0 ? "sideA" : "sideB";

            // Get proposedDate from first row, or fall back to acceptance-row date (2026 path)
            const firstRow = group.playerRows[0] || group.pickRows[0];
            const proposedDate = (firstRow?.proposedDate as number) || group.proposedDate || 0;

            allTrades.push({
              season,
              tradeId,
              proposedDate,
              sideA,
              sideB,
              verdict,
              verdictMargin: Math.abs(margin),
            });
          }
        }

        // ── Scraped trades fallback (Chrome extension data) ─────────────────
        // If the ESPN cache produced no trades for any season, pull from the
        // scraped_trades table (populated by the Chrome extension when the user
        // visits the ESPN transactions page).
        if (allTrades.length === 0) {
          const scrapedRows = await getScrapedTrades(input.season);
          for (const row of scrapedRows) {
            try {
              const sideA = JSON.parse(row.sideAJson) as { teamId: number; ownerName: string; players: { playerId: number; playerName: string; position: string; avgPoints?: number }[]; picks: { label: string; round: number; pickInRound: number }[] };
              const sideB = JSON.parse(row.sideBJson) as typeof sideA;
              const buildScrapedSide = (side: typeof sideA) => {
                const players = side.players.map(p => {
                  const pInfo = undefined; // no season data available for scraped trades
                  const avgPts = p.avgPoints ?? 0;
                  const vorp = 0;
                  const compositeValue = Math.round(avgPts * 10);
                  return { playerId: p.playerId, playerName: p.playerName, position: p.position, avgPoints: avgPts, seasonPoints: 0, compositeValue };
                });
                const picks = side.picks.map(pk => ({
                  label: pk.label,
                  round: pk.round,
                  pickInRound: pk.pickInRound,
                  value: calcPickValue(pk.round, pk.pickInRound),
                }));
                const totalValue = players.reduce((s, p) => s + p.compositeValue, 0) + picks.reduce((s, p) => s + p.value, 0);
                return { teamId: side.teamId, ownerName: side.ownerName, players, picks, totalValue };
              };
              const builtA = buildScrapedSide(sideA);
              const builtB = buildScrapedSide(sideB);
              const margin = builtA.totalValue - builtB.totalValue;
              const verdict: "sideA" | "sideB" | "even" = Math.abs(margin) < 50 ? "even" : margin > 0 ? "sideA" : "sideB";
              allTrades.push({
                season: row.season,
                tradeId: row.tradeKey,
                proposedDate: row.executedAt,
                sideA: builtA,
                sideB: builtB,
                verdict,
                verdictMargin: Math.abs(margin),
              });
            } catch {
              // skip malformed rows
            }
          }
        }

        // Sort by most recent first
        return allTrades.sort((a, b) => b.proposedDate - a.proposedDate);
      }),

    allStandings: publicProcedure.query(async () => {
      const cachedSeasons = await getAllCachedSeasons();
      const result: Record<number, unknown[]> = {};
      for (const season of cachedSeasons) {
        const data = await getSeasonData(season);
        if (data) {
          const teams = normalizeTeams(data);
          result[season] = teams.sort((a, b) => ((a.rankFinal as number) || 99) - ((b.rankFinal as number) || 99));
        }
      }
      return result;
    }),

    freeAgents: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const players = (data.players as Record<string, unknown>[]) || [];
        const POS_MAP: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
        return players
          .filter((fa) => !fa.onTeamId || fa.onTeamId === 0)
          .map((fa) => {
            const entry = (fa.playerPoolEntry as Record<string, unknown>) || fa;
            const player = (entry.player as Record<string, unknown>) || {};
            return {
              playerId: player.id || fa.id,
              playerName: player.fullName || player.name || String(fa.id),
              position: player.defaultPositionId || 0,
              positionLabel: POS_MAP[player.defaultPositionId as number] || "?",
              proTeamId: player.proTeamId,
              percentOwned: Number((entry.percentOwned as number) || 0),
              projectedTotal: null,
            };
          })
          .filter((p) => p.playerName && p.playerName !== String(p.playerId))
          .slice(0, 100);
      }),

    keeperHistory: publicProcedure.query(async () => {
      const cachedSeasons = await getAllCachedSeasons();
      const keepers: unknown[] = [];
      for (const season of cachedSeasons) {
        const data = await getSeasonData(season);
        if (!data) continue;
        const picks = normalizeDraftPicks(data);
        for (const pick of picks) {
          const p = pick as Record<string, unknown>;
          if (p.keeper) keepers.push(p);
        }
      }
      return keepers;
    }),

    draftOrder: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return null;
        return normalizeDraftOrder(data);
      }),

    keeperAnalysis: publicProcedure.query(async () => {
      // Build keeper eligibility per team with 2-consecutive-year rule
      const cachedSeasons = (await getAllCachedSeasons()).sort((a, b) => a - b);
      // Map: teamId -> list of { season, playerId, playerName, position, roundId }
      const keepersByTeam: Record<number, Array<{ season: number; playerId: number; playerName: string; position: string; roundId: number; teamName: string }>> = {};

      for (const season of cachedSeasons) {
        const data = await getSeasonData(season);
        if (!data) continue;
        const picks = normalizeDraftPicks(data);
        for (const pick of picks) {
          const p = pick as Record<string, unknown>;
          if (!p.keeper) continue;
          const tid = p.teamId as number;
          if (!keepersByTeam[tid]) keepersByTeam[tid] = [];
          keepersByTeam[tid].push({
            season: p.season as number,
            playerId: p.playerId as number,
            playerName: (p.playerName as string) || `Player #${p.playerId}`,
            position: p.position as string,
            roundId: p.roundId as number,
            teamName: p.teamName as string,
          });
        }
      }

      // For each team, determine which players were kept in consecutive years
      // A player kept in year N AND year N-1 has been kept 2 years in a row → NOT eligible in year N+1
      const latestSeason = cachedSeasons[cachedSeasons.length - 1] ?? 2025;
      const nextSeason = latestSeason + 1;

      const result: Array<{
        teamId: number;
        teamName: string;
        keeperHistory: Array<{ season: number; playerName: string; position: string; roundId: number; consecutiveYears: number }>;
        ineligibleForNext: string[];
        eligibleForNext: Array<{ playerName: string; position: string; roundId: number; consecutiveYears: number; mustReturn: boolean }>;
      }> = [];

      // Get current season rosters for eligible player list
      const currentData = await getSeasonData(latestSeason);
      const currentRosters = currentData ? normalizeRosters(currentData) : [];
      const currentTeams = currentData ? normalizeTeams(currentData) : [];

      for (const team of currentTeams) {
        const tid = team.teamId as number;
        const tname = team.teamName as string;
        const teamKeepers = (keepersByTeam[tid] || []).sort((a, b) => a.season - b.season);

        // Build consecutive year counts for each player
        const playerConsecutive: Record<number, number> = {};
        for (const k of teamKeepers) {
          const pid = k.playerId;
          // Check if this player was also kept the previous year
          const prevYearKeeper = teamKeepers.find(prev => prev.season === k.season - 1 && prev.playerId === pid);
          if (prevYearKeeper) {
            playerConsecutive[pid] = (playerConsecutive[pid] || 1) + 1;
          } else {
            playerConsecutive[pid] = 1;
          }
        }

        // Players kept in the latest season
        const latestKeepers = teamKeepers.filter(k => k.season === latestSeason);
        const ineligible: string[] = [];
        const eligible: Array<{ playerName: string; position: string; roundId: number; consecutiveYears: number; mustReturn: boolean }> = [];

        for (const k of latestKeepers) {
          const consec = playerConsecutive[k.playerId] || 1;
          if (consec >= 2) {
            ineligible.push(k.playerName);
          } else {
            eligible.push({
              playerName: k.playerName,
              position: k.position,
              roundId: k.roundId,
              consecutiveYears: consec,
              mustReturn: false,
            });
          }
        }

        result.push({
          teamId: tid,
          teamName: tname,
          keeperHistory: teamKeepers.map(k => ({
            season: k.season,
            playerName: k.playerName,
            position: k.position,
            roundId: k.roundId,
            consecutiveYears: playerConsecutive[k.playerId] || 1,
          })),
          ineligibleForNext: ineligible,
          eligibleForNext: eligible,
        });
      }

      return { latestSeason, nextSeason, teams: result };
    }),
    keeperEligibility2026: publicProcedure.query(async () => {
      // Full 2026 keeper eligibility calculator with 2-consecutive-year rule enforcement
      // Rule: a player kept in BOTH 2024 AND 2025 must return to the draft pool in 2026
      // Round cost: if kept in round R in 2025, cost to keep in 2026 = R - 1
      const cachedSeasons = (await getAllCachedSeasons()).sort((a, b) => a - b);

      // Build per-team, per-player keeper history across all seasons
      const keepersByPlayerByTeam: Record<number, Record<number, Array<{ season: number; roundId: number; playerName: string; position: string }>>> = {};
      const teamNames: Record<number, string> = {};

      for (const season of cachedSeasons) {
        const data = await getSeasonData(season);
        if (!data) continue;
        const picks = normalizeDraftPicks(data);
        for (const pick of picks) {
          const p = pick as Record<string, unknown>;
          if (!p.keeper) continue;
          const tid = p.teamId as number;
          const pid = p.playerId as number;
          if (!keepersByPlayerByTeam[tid]) keepersByPlayerByTeam[tid] = {};
          if (!keepersByPlayerByTeam[tid][pid]) keepersByPlayerByTeam[tid][pid] = [];
          keepersByPlayerByTeam[tid][pid].push({
            season: p.season as number,
            roundId: p.roundId as number,
            playerName: (p.playerName as string) || `Player#${pid}`,
            position: (p.position as string) || "?",
          });
          teamNames[tid] = (p.teamName as string) || `Team ${tid}`;
        }
      }

      // Get 2025 keepers as the baseline for 2026 eligibility
      const latestSeason = 2025;
      const data2025 = await getSeasonData(latestSeason);
      const data2024 = await getSeasonData(2024);
      const teams2025 = data2025 ? normalizeTeams(data2025) : [];

      // Build 2024 keeper set: playerId -> roundId (for consecutive check)
      const keepers2024: Record<number, Record<number, number>> = {}; // teamId -> playerId -> roundId
      if (data2024) {
        const picks2024 = normalizeDraftPicks(data2024);
        for (const pick of picks2024) {
          const p = pick as Record<string, unknown>;
          if (!p.keeper) continue;
          const tid = p.teamId as number;
          const pid = p.playerId as number;
          if (!keepers2024[tid]) keepers2024[tid] = {};
          keepers2024[tid][pid] = p.roundId as number;
        }
      }

      // Build 2025 keeper set
      const keepers2025: Record<number, Array<{ playerId: number; playerName: string; position: string; roundId: number }>> = {};
      if (data2025) {
        const picks2025 = normalizeDraftPicks(data2025);
        for (const pick of picks2025) {
          const p = pick as Record<string, unknown>;
          if (!p.keeper) continue;
          const tid = p.teamId as number;
          if (!keepers2025[tid]) keepers2025[tid] = [];
          keepers2025[tid].push({
            playerId: p.playerId as number,
            playerName: (p.playerName as string) || `Player#${p.playerId}`,
            position: (p.position as string) || "?",
            roundId: p.roundId as number,
          });
        }
      }

      // Value tier: compare keeper round cost vs estimated draft value
      function valueTier(position: string, roundCost: number): { tier: string; label: string } {
        // Rough 2026 ADP tiers by position
        const adpRound: Record<string, number> = {
          QB: 6, RB: 3, WR: 3, TE: 5, K: 14, DEF: 13,
        };
        const pos = position?.toUpperCase() || "";
        const adp = adpRound[pos] ?? 7;
        const savings = adp - roundCost;
        if (savings >= 4) return { tier: "elite", label: "Elite Value" };
        if (savings >= 2) return { tier: "good", label: "Good Value" };
        if (savings >= 0) return { tier: "fair", label: "Fair Value" };
        return { tier: "poor", label: "Poor Value" };
      }

      const teamResults = teams2025.map(team => {
        const tid = team.teamId as number;
        const tname = (team.teamName as string) || teamNames[tid] || `Team ${tid}`;
        const my2025Keepers = keepers2025[tid] || [];
        const my2024Keepers = keepers2024[tid] || {};

        const players = my2025Keepers.map(k => {
          const keptIn2024 = my2024Keepers[k.playerId] !== undefined;
          const isIneligible = keptIn2024; // kept in both 2024 and 2025 = 2 consecutive years
          const roundCost2026 = k.roundId - 1; // cost to keep = kept round - 1
          const consecutiveYears = keptIn2024 ? 2 : 1;
          const value = isIneligible ? { tier: "ineligible", label: "Must Return" } : valueTier(k.position, roundCost2026);
          return {
            playerId: k.playerId,
            playerName: k.playerName,
            position: k.position,
            round2025: k.roundId,
            round2024: keptIn2024 ? my2024Keepers[k.playerId] : null,
            roundCost2026: isIneligible ? null : roundCost2026,
            consecutiveYears,
            isIneligible,
            valueTier: value.tier,
            valueLabel: value.label,
          };
        });

        return {
          teamId: tid,
          teamName: tname,
          players,
          ineligibleCount: players.filter(p => p.isIneligible).length,
          eligibleCount: players.filter(p => !p.isIneligible).length,
        };
      });

      // League-wide summary
      const allIneligible = teamResults.flatMap(t =>
        t.players.filter(p => p.isIneligible).map(p => ({ ...p, teamName: t.teamName }))
      );
      const allEligible = teamResults.flatMap(t =>
        t.players.filter(p => !p.isIneligible).map(p => ({ ...p, teamName: t.teamName }))
      );

      // ── Competitor Intelligence ────────────────────────────────────────────
      // For each team with an ineligible player, compute:
      //   - which player is ineligible and their position
      //   - the round they were kept (= the round they'll need to spend on a replacement)
      //   - the positional gap this creates (e.g. losing a RB1 means they MUST draft a RB early)
      //   - the draft advantage this creates for other teams
      const POSITION_ADP: Record<string, { tier: string; description: string }> = {
        RB: { tier: "RB1", description: "Top running back — typically drafted rounds 1–3" },
        WR: { tier: "WR1", description: "Top wide receiver — typically drafted rounds 1–4" },
        QB: { tier: "QB1", description: "Starting quarterback — typically drafted rounds 5–8" },
        TE: { tier: "TE1", description: "Starting tight end — typically drafted rounds 3–6" },
        K:  { tier: "K",   description: "Kicker — typically drafted round 14–15" },
        DEF:{ tier: "D/ST",description: "Defense — typically drafted round 13–15" },
      };

      const competitorConstraints = teamResults
        .filter(t => t.ineligibleCount > 0)
        .map(t => {
          const ineligiblePlayers = t.players.filter(p => p.isIneligible);
          const constraints = ineligiblePlayers.map(p => {
            const pos = (p.position || "?").toUpperCase();
            const posInfo = POSITION_ADP[pos] ?? { tier: pos, description: `${pos} player` };
            // The round they kept the player in 2025 = the round they must now spend on a replacement
            const replacementRound = p.round2025;
            // Threat level: how early they must draft a replacement
            const threatLevel: "critical" | "high" | "medium" | "low" =
              replacementRound <= 2 ? "critical" :
              replacementRound <= 4 ? "high" :
              replacementRound <= 7 ? "medium" : "low";
            // Draft advantage: if they lose a round 1-2 player, they burn an early pick on replacement
            const draftAdvantage =
              replacementRound <= 2
                ? `They MUST spend a round ${replacementRound} pick on a ${posInfo.tier} replacement — their early picks are spoken for`
                : replacementRound <= 4
                ? `They need a round ${replacementRound} ${posInfo.tier} — mid-round picks are constrained`
                : `They need a round ${replacementRound} ${posInfo.tier} — limited late-round impact`;
            return {
              playerName: p.playerName,
              position: p.position,
              positionTier: posInfo.tier,
              round2024: p.round2024,
              round2025: p.round2025,
              replacementRound,
              threatLevel,
              draftAdvantage,
              yourOpportunity:
                replacementRound <= 3
                  ? `Target ${posInfo.tier}s in rounds ${replacementRound}–${replacementRound + 1} before they panic-draft`
                  : `Monitor their draft — they may reach for a ${posInfo.tier} in round ${replacementRound}`,
            };
          });
          return {
            teamId: t.teamId,
            teamName: t.teamName,
            constraints,
            overallThreat: constraints.some(c => c.threatLevel === "critical") ? "critical" :
                           constraints.some(c => c.threatLevel === "high") ? "high" : "medium",
          };
        })
        .sort((a, b) => {
          const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
          return (order[a.overallThreat] ?? 9) - (order[b.overallThreat] ?? 9);
        });

      // Positional scarcity: which positions are returning to the pool
      const returningByPosition: Record<string, Array<{ playerName: string; teamName: string; round2025: number }>> = {};
      for (const p of allIneligible) {
        const pos = (p.position || "?").toUpperCase();
        if (!returningByPosition[pos]) returningByPosition[pos] = [];
        returningByPosition[pos].push({ playerName: p.playerName, teamName: p.teamName, round2025: p.round2025 });
      }

      return {
        season: 2026,
        deadline: "August 18, 2026",
        rule: "Players kept in 2024 AND 2025 (2 consecutive years) must return to the draft pool for 2026.",
        teams: teamResults,
        leagueSummary: {
          totalIneligible: allIneligible.length,
          totalEligible: allEligible.length,
          ineligiblePlayers: allIneligible,
          topValueKeepers: allEligible
            .filter(p => p.valueTier === "elite" || p.valueTier === "good")
            .sort((a, b) => (a.roundCost2026 ?? 99) - (b.roundCost2026 ?? 99)),
        },
        competitorIntelligence: {
          constraints: competitorConstraints,
          returningByPosition,
          totalReturningPlayers: allIneligible.length,
          keyInsight: allIneligible.length > 0
            ? `${allIneligible.length} elite player${allIneligible.length > 1 ? "s" : ""} returning to the draft pool — ${competitorConstraints.filter(c => c.overallThreat === "critical").length} team${competitorConstraints.filter(c => c.overallThreat === "critical").length !== 1 ? "s" : ""} must burn early picks on replacements`
            : "No ineligible players this season",
        },
        ownerProfile: (() => {
          // Rod Sellers — Str8FrmHell / RodZilla — Team ID 11 across all seasons
          const ROD_TEAM_ID = 11;
          const ROD_TEAM_NAME = "Str8FrmHell, RodZilla";

          // Career season records (from ESPN cache, 2018–2025)
          const careerSeasons = [
            { season: 2018, wins: 5,  losses: 8,  pf: 1583.1, pa: 1788.9, seed: 13, teamName: "Str8FrmHell, Rod's Minions" },
            { season: 2019, wins: 8,  losses: 5,  pf: 1843.1, pa: 1821.4, seed: 2,  teamName: "Str8FrmHell, RodZilla" },
            { season: 2020, wins: 6,  losses: 7,  pf: 1781.8, pa: 1706.4, seed: 10, teamName: "Str8FrmHell, RodZilla" },
            { season: 2021, wins: 7,  losses: 7,  pf: 1699.2, pa: 1782.5, seed: 9,  teamName: "Str8FrmHell, RodZilla" },
            { season: 2022, wins: 3,  losses: 11, pf: 1447.1, pa: 1857.7, seed: 13, teamName: "Str8FrmHell, RodZilla" },
            { season: 2023, wins: 7,  losses: 7,  pf: 1893.6, pa: 1885.7, seed: 7,  teamName: "Str8FrmHell, RodZilla" },
            { season: 2024, wins: 5,  losses: 8,  pf: 1652.3, pa: 1680.8, seed: 10, teamName: "Str8FrmHell, RodZilla" },
            { season: 2025, wins: 9,  losses: 5,  pf: 1921.3, pa: 1693.3, seed: 3,  teamName: "Str8FrmHell, RodZilla" },
          ];

          const totalWins   = careerSeasons.reduce((s, r) => s + r.wins, 0);
          const totalLosses = careerSeasons.reduce((s, r) => s + r.losses, 0);
          const totalGames  = totalWins + totalLosses;
          const winPct      = totalGames > 0 ? (totalWins / totalGames) * 100 : 0;
          const totalPF     = careerSeasons.reduce((s, r) => s + r.pf, 0);
          const totalPA     = careerSeasons.reduce((s, r) => s + r.pa, 0);
          const avgPF       = totalPF / careerSeasons.length;
          const bestSeason  = careerSeasons.reduce((best, r) => r.wins > best.wins ? r : best, careerSeasons[0]);
          const worstSeason = careerSeasons.reduce((worst, r) => r.wins < worst.wins ? r : worst, careerSeasons[0]);
          const playoffSeasons = careerSeasons.filter(r => r.seed <= 7).length; // top 7 of 14 make playoffs

          // Keeper history (2022–2025, from ESPN data)
          const keeperHistory = [
            { season: 2022, playerName: "Derrick Henry",   position: "RB", round: 1, eligible2026: false },
            { season: 2023, playerName: "Saquon Barkley",  position: "RB", round: 2, eligible2026: false },
            { season: 2024, playerName: "Saquon Barkley",  position: "RB", round: 2, eligible2026: false },
            { season: 2025, playerName: "Breece Hall",     position: "RB", round: 5, eligible2026: true  },
          ];

          // 2026 keeper situation
          const myTeam2026 = teamResults.find(t => t.teamId === ROD_TEAM_ID);
          // Known player name map for IDs that ESPN stores without playerInfo
          const KNOWN_PLAYER_NAMES: Record<number, { name: string; position: string }> = {
            4427366: { name: "Breece Hall", position: "RB" },
            3929630: { name: "Saquon Barkley", position: "RB" },
            3043078: { name: "Derrick Henry", position: "RB" },
          };
          const resolvePlayerName = (p: { playerName: string; position: string; playerId?: number }) => {
            if (p.playerName && !p.playerName.startsWith("Player#")) return p;
            const pid = p.playerId as number | undefined;
            if (pid && KNOWN_PLAYER_NAMES[pid]) {
              return { ...p, playerName: KNOWN_PLAYER_NAMES[pid].name, position: KNOWN_PLAYER_NAMES[pid].position };
            }
            return p;
          };
          const my2026KeeperRaw = myTeam2026?.players.find(p => !p.isIneligible) ?? null;
          const my2026Keeper = my2026KeeperRaw ? resolvePlayerName(my2026KeeperRaw as unknown as { playerName: string; position: string; playerId?: number }) as typeof my2026KeeperRaw : null;
          const my2026Ineligible = myTeam2026?.players.filter(p => p.isIneligible) ?? [];

          // Trend: last 3 seasons
          const recentSeasons = careerSeasons.slice(-3);
          const recentWinPct = recentSeasons.reduce((s, r) => s + r.wins, 0) /
            (recentSeasons.reduce((s, r) => s + r.wins + r.losses, 0)) * 100;
          const trend = recentWinPct > winPct + 5 ? "improving" : recentWinPct < winPct - 5 ? "declining" : "stable";

          // ── Draft Tendencies (from 8-season analysis) ──────────────────────
          const draftTendencies = {
            totalPicks: 107,
            positionalBreakdown: [
              { position: "RB",  picks: 38, pct: 36, avgRound: 4.7, earlyPicks: 14 },
              { position: "WR",  picks: 26, pct: 24, avgRound: 6.2, earlyPicks: 7  },
              { position: "QB",  picks: 8,  pct: 7,  avgRound: 5.9, earlyPicks: 1  },
              { position: "TE",  picks: 5,  pct: 5,  avgRound: 6.8, earlyPicks: 2  },
              { position: "K",   picks: 4,  pct: 4,  avgRound: 11.5, earlyPicks: 0 },
              { position: "FLEX",picks: 4,  pct: 4,  avgRound: 10.2, earlyPicks: 0 },
            ],
            round1Breakdown: [
              { position: "RB", count: 7 },
              { position: "WR", count: 1 },
            ],
            earlyRoundSplit: [
              { position: "RB",  count: 14, pct: 52 },
              { position: "WR",  count: 7,  pct: 27 },
              { position: "TE",  count: 2,  pct: 8  },
              { position: "QB",  count: 1,  pct: 4  },
            ],
            draftStyleBadge: "RB-First Builder",
            draftStyleDesc: "7 of 8 round-1 picks have been RBs. You consistently build around elite backfields before addressing WR depth.",
            keeperPattern: "Consistent RB keeper — Henry (2022), Barkley x2 (2023-24), Hall (2025). 2026 keeper TBD — pending trade decisions.",
            notablePicks: [
              { season: 2020, pick: "Lamar Jackson Rd1 Pk13", note: "Bold QB1 in round 1 — paid off with MVP season" },
              { season: 2023, pick: "CMC Rd1 + Bijan Rd1", note: "Double RB round 1 — high upside, high variance" },
              { season: 2025, pick: "McCaffrey Rd1 + McBride Rd2", note: "RB/TE stack — injury risk but elite ceiling" },
            ],
          };

          // ── GM Activity Profile (from transaction counter data) ────────────
          const gmActivityProfile = {
            seasonActivity: [
              { season: 2018, acquisitions: 36, drops: 33, trades: 12, rosterMoves: 75 },
              { season: 2019, acquisitions: 38, drops: 34, trades: 12, rosterMoves: 69 },
              { season: 2020, acquisitions: 23, drops: 17, trades: 6,  rosterMoves: 46 },
              { season: 2021, acquisitions: 49, drops: 56, trades: 9,  rosterMoves: 71 },
              { season: 2022, acquisitions: 16, drops: 17, trades: 4,  rosterMoves: 64 },
              { season: 2023, acquisitions: 27, drops: 43, trades: 10, rosterMoves: 46 },
              { season: 2024, acquisitions: 13, drops: 26, trades: 1,  rosterMoves: 40 },
              { season: 2025, acquisitions: 26, drops: 49, trades: 4,  rosterMoves: 80 },
            ],
            averages: { acquisitions: 29, drops: 34, trades: 7.3, rosterMoves: 61 },
            gmArchetype: "Active Trader",
            gmArchetypeDesc: "7.3 trades/season is above league average. You're willing to make moves but not a waiver grinder (29 adds/season is moderate).",
            insights: [
              { label: "Most Active Season", value: "2021 (49 adds, 56 drops, 9 trades) — finished 7–7, missed playoffs" },
              { label: "Quietest Season", value: "2024 (13 adds, 1 trade) — finished 5–8" },
              { label: "Best Trade Season", value: "2018 & 2019 (12 trades each) — both playoff years" },
              { label: "Best Season Activity", value: "2025 (26 adds, 4 trades) — finished 9–5, #3 seed" },
            ],
            strengthsWeaknesses: [
              { type: "strength", text: "Consistent RB keeper identification — 4 straight years of strong RB keeper value" },
              { type: "strength", text: "Trade willingness — 7.3 trades/season shows you're not afraid to make deals" },
              { type: "strength", text: "2025 breakout — best season in 8 years shows growth and adaptation" },
              { type: "weakness", text: "RB dependency — 36% of all picks are RBs; WR depth has been inconsistent" },
              { type: "weakness", text: "High-activity seasons correlate with poor results (2021: 49 adds, 7–7)" },
              { type: "weakness", text: "2024 under-activity — 1 trade all season, missed obvious roster improvements" },
              { type: "blindspot", text: "Late-round QB value — you've drafted multiple QBs in rounds 4–6 but rarely hit" },
              { type: "blindspot", text: "TE neglect — only 5 TE picks in 8 seasons; relying on mid-tier TEs hurts PPR floors" },
            ],
          };

          return {
            ownerName: "Rod Sellers",
            teamName: ROD_TEAM_NAME,
            teamId: ROD_TEAM_ID,
            careerSeasons,
            careerStats: {
              totalWins,
              totalLosses,
              winPct: Math.round(winPct * 10) / 10,
              totalPF: Math.round(totalPF * 10) / 10,
              totalPA: Math.round(totalPA * 10) / 10,
              avgPF: Math.round(avgPF * 10) / 10,
              playoffSeasons,
              totalSeasons: careerSeasons.length,
              bestSeason,
              worstSeason,
              trend,
              recentWinPct: Math.round(recentWinPct * 10) / 10,
            },
            keeperHistory,
            keeper2026: {
              eligible: my2026Keeper ? [my2026Keeper] : [],
              ineligible: my2026Ineligible,
              recommendation: "2026 keeper is TBD — pending trade decisions. Evaluate your best round-surplus option before the Aug 18 deadline.",
              status: "pending",
            },
            draftTendencies,
            gmActivityProfile,
          };
        })(),
      };
    }),
  }),

  playerProfiles: publicProcedure.query(async () => {
    // Aggregate per-player draft + keeper + transaction history across all cached seasons
    const cachedSeasons = (await getAllCachedSeasons()).sort((a, b) => a - b);

    const POS_MAP: Record<number, string> = {
      1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST", 17: "D/ST",
    };

    // Global player info map: playerId -> { name, position, proTeam }
    const playerInfoMap = new Map<number, { name: string; position: string; proTeam: string }>();
    // Per-season team name map: season -> teamId -> { name, ownerName }
    const teamNamesBySeason: Record<number, Record<number, { name: string; ownerName: string }>> = {};

    // Collect all unique picks (deduplicated by season+overallPickNumber)
    const seenPickKeys = new Set<string>();
    const allUniquePicks: Array<{
      season: number; round: number; pick: number; overallPick: number;
      playerId: number; teamId: number; isKeeper: boolean;
    }> = [];

    // Collect all transactions
    const allTxns: Array<{
      season: number; type: string; playerId: number;
      fromTeamId: number | null; toTeamId: number | null;
    }> = [];

    for (const season of cachedSeasons) {
      const data = await getSeasonData(season);
      if (!data) continue;

      // Build team name map for this season
      teamNamesBySeason[season] = {};
      const members: Record<string, Record<string, unknown>> = {};
      for (const m of (data.members as Record<string, unknown>[]) || []) {
        members[m.id as string] = m;
      }
      for (const t of (data.teams as Record<string, unknown>[]) || []) {
        const tid = t.id as number;
        const name = `${t.location || ""} ${t.nickname || ""}`.trim() || `Team ${tid}`;
        const owners = (t.owners as string[]) || [];
        const ownerName = owners
          .map((oid) => {
            const m = members[oid] || {};
            return `${m.firstName || ""} ${m.lastName || ""}`.trim();
          })
          .filter(Boolean)
          .join(", ");
        teamNamesBySeason[season][tid] = { name, ownerName };

        // Build player info from roster entries
        const entries = ((t.roster as Record<string, unknown>)?.entries as Record<string, unknown>[]) || [];
        for (const entry of entries) {
          const poolEntry = (entry.playerPoolEntry as Record<string, unknown>) || {};
          const player = (poolEntry.player as Record<string, unknown>) || {};
          const pid = player.id as number;
          if (pid && !playerInfoMap.has(pid)) {
            playerInfoMap.set(pid, {
              name: (player.fullName as string) || `Player ${pid}`,
              position: POS_MAP[player.defaultPositionId as number] || "?",
              proTeam: String(player.proTeamId || ""),
            });
          }
        }
      }

      // Extract unique draft picks
      const draft = (data.draftDetail as Record<string, unknown>) || {};
      const picks = (draft.picks as Record<string, unknown>[]) || [];
      for (const pick of picks) {
        const key = `${season}:${pick.overallPickNumber}`;
        if (seenPickKeys.has(key)) continue;
        seenPickKeys.add(key);
        allUniquePicks.push({
          season,
          round: pick.roundId as number,
          pick: pick.roundPickNumber as number,
          overallPick: pick.overallPickNumber as number,
          playerId: pick.playerId as number,
          teamId: pick.teamId as number,
          isKeeper: pick.keeper === true || pick.reservedForKeeper === true,
        });
      }

      // Extract transactions
      const txns = (data.transactions as Record<string, unknown>[]) || [];
      for (const tx of txns) {
        const items = (tx.items as Record<string, unknown>[]) || [];
        for (const item of items) {
          const pid = (item.playerId || (item.player as Record<string, unknown>)?.id) as number;
          if (!pid) continue;
          allTxns.push({
            season,
            type: tx.type as string,
            playerId: pid,
            fromTeamId: (item.fromTeamId as number) || null,
            toTeamId: (item.toTeamId as number) || null,
          });
        }
      }
    }

    // Build per-player profiles
    const playerMap = new Map<number, {
      playerId: number;
      playerName: string;
      position: string;
      draftHistory: Array<{ season: number; round: number; pick: number; overallPick: number; teamId: number; teamName: string; ownerName: string; isKeeper: boolean }>;
      keeperSeasons: number[];
      teamsBySeason: Record<number, { teamId: number; teamName: string; ownerName: string }>;
      firstSeen: number;
      lastSeen: number;
      totalDrafts: number;
      totalKeeperYears: number;
    }>();

    for (const pick of allUniquePicks) {
      const pid = pick.playerId;
      const info = playerInfoMap.get(pid);
      const teamInfo = teamNamesBySeason[pick.season]?.[pick.teamId] || { name: `Team ${pick.teamId}`, ownerName: "" };

      if (!playerMap.has(pid)) {
        playerMap.set(pid, {
          playerId: pid,
          playerName: info?.name || `Player ${pid}`,
          position: info?.position || "?",
          draftHistory: [],
          keeperSeasons: [],
          teamsBySeason: {},
          firstSeen: pick.season,
          lastSeen: pick.season,
          totalDrafts: 0,
          totalKeeperYears: 0,
        });
      }

      const p = playerMap.get(pid)!;
      if (info?.name) { p.playerName = info.name; p.position = info.position; }

      p.draftHistory.push({
        season: pick.season,
        round: pick.round,
        pick: pick.pick,
        overallPick: pick.overallPick,
        teamId: pick.teamId,
        teamName: teamInfo.name,
        ownerName: teamInfo.ownerName,
        isKeeper: pick.isKeeper,
      });

      if (pick.isKeeper) p.keeperSeasons.push(pick.season);
      p.teamsBySeason[pick.season] = { teamId: pick.teamId, teamName: teamInfo.name, ownerName: teamInfo.ownerName };
      p.firstSeen = Math.min(p.firstSeen, pick.season);
      p.lastSeen = Math.max(p.lastSeen, pick.season);
      p.totalDrafts++;
      if (pick.isKeeper) p.totalKeeperYears++;
    }

    // Build final profiles array with computed fields
    const profiles = Array.from(playerMap.values()).map((p) => {
      const rounds = p.draftHistory.map((d) => d.round);
      const avgRound = rounds.length > 0 ? Math.round((rounds.reduce((s, r) => s + r, 0) / rounds.length) * 10) / 10 : null;
      const roundTrend = p.draftHistory.length >= 2
        ? p.draftHistory[p.draftHistory.length - 1].round - p.draftHistory[0].round
        : 0;
      const uniqueTeams = Array.from(new Set(Object.values(p.teamsBySeason).map((t) => t.teamName)));
      const uniqueOwners = Array.from(new Set(Object.values(p.teamsBySeason).map((t) => t.ownerName).filter(Boolean)));
      const transactionCount = allTxns.filter((tx) => tx.playerId === p.playerId).length;

      return {
        ...p,
        draftHistory: p.draftHistory.sort((a, b) => a.season - b.season),
        avgDraftRound: avgRound,
        minRound: rounds.length > 0 ? Math.min(...rounds) : null,
        maxRound: rounds.length > 0 ? Math.max(...rounds) : null,
        roundTrend, // negative = rising value, positive = falling
        uniqueTeams,
        uniqueOwners,
        seasonsActive: p.lastSeen - p.firstSeen + 1,
        transactionCount,
        // League-wide prominence score: keeper years * 3 + total drafts + seasons active
        prominenceScore: p.totalKeeperYears * 3 + p.totalDrafts + (p.lastSeen - p.firstSeen),
      };
    });

    // Sort by prominence (most notable players first)
    profiles.sort((a, b) => b.prominenceScore - a.prominenceScore);

    return {
      profiles,
      totalPlayers: profiles.length,
      totalKeptPlayers: profiles.filter((p) => p.totalKeeperYears > 0).length,
      leagueStaples: profiles.filter((p) => p.totalDrafts >= 3).length,
      seasons: cachedSeasons,
    };
  }),

  ownerCareerStats: publicProcedure.query(() => {
    return memCache("ownerCareerStats", 10 * 60_000, async () => {
    // Resolve active league credentials for multi-league isolation
    let ownerStatsCreds: import('./espnService').EspnCreds | undefined;
    try {
      const db = await getDb();
      if (db) {
        const activeRows = await db
          .select()
          .from(lcTable)
          .where(andDrizzle(eqDrizzle(lcTable.isActive, true), eqDrizzle(lcTable.provider, 'espn')))
          .orderBy(descDrizzle(lcTable.updatedAt))
          .limit(1);
        if (activeRows[0]) {
          const { decryptCredentialsFromDb } = await import('./_core/crypto');
          const rawCreds = decryptCredentialsFromDb(activeRows[0].credentials) as Record<string, string> | null;
          if (rawCreds?.swid && rawCreds?.espnS2) {
            ownerStatsCreds = {
              leagueId: (rawCreds.leagueId as string) ?? activeRows[0].leagueId,
              swid: rawCreds.swid,
              espnS2: rawCreds.espnS2,
            };
          }
        }
      }
    } catch (_e) { /* non-fatal — fall back to env-var league */ }
    const ownerStatsLeagueId = ownerStatsCreds?.leagueId ?? LEAGUE_ID;

    const cachedSeasons = await getAllCachedSeasons(ownerStatsLeagueId);

    // ── Per-owner aggregated stats ──────────────────────────────────────────
    // memberId → owner profile
    const ownerMap = new Map<string, {
      memberId: string;
      firstName: string;
      lastName: string;
      displayName: string;
      // career totals
      totalWins: number;
      totalLosses: number;
      totalTies: number;
      totalPF: number;
      totalPA: number;
      playoffAppearances: number;
      playoffWins: number;
      playoffLosses: number;
      championships: number;
      runnerUps: number;
      // season-by-season
      seasonRecords: Array<{
        season: number;
        teamName: string;
        wins: number;
        losses: number;
        ties: number;
        pf: number;
        pa: number;
        rank: number;
        playoffSeed: number;
        madePlayoffs: boolean;
        isChampion: boolean;
        isRunnerUp: boolean;
      }>;
      // head-to-head: opponentMemberId → { wins, losses, ties }
      h2h: Map<string, { wins: number; losses: number; ties: number }>;
      // transaction counters per season
      txnSeasons: Array<{
        season: number;
        acquisitions: number;
        drops: number;
        trades: number;
        moveToActive: number;
        moveToIR: number;
      }>;
    }>();

    // Helper: resolve member ID → owner entry, creating if needed
    function getOrCreateOwner(memberId: string, members: any[]) {
      if (!ownerMap.has(memberId)) {
        const m = members.find((x: any) => x.id === memberId) || {};
        ownerMap.set(memberId, {
          memberId,
          firstName: m.firstName || '',
          lastName: m.lastName || '',
          displayName: m.displayName || memberId,
          totalWins: 0, totalLosses: 0, totalTies: 0,
          totalPF: 0, totalPA: 0,
          playoffAppearances: 0, playoffWins: 0, playoffLosses: 0, championships: 0, runnerUps: 0,
          seasonRecords: [],
          h2h: new Map(),
          txnSeasons: [],
        });
      }
      return ownerMap.get(memberId)!;
    }

    // Fetch championship data from ESPN leagueHistory API — the ONLY reliable source
    // for pre-2018 seasons where the combined cache has empty teams arrays.
    let leagueHistoryChampMap = new Map<number, { season: number; championMemberId: string; runnerUpMemberId: string | null; championTeamName: string }>();
    try {
      const { fetchLeagueHistoryChampions } = await import('./espnService');
      leagueHistoryChampMap = await fetchLeagueHistoryChampions(cachedSeasons, ownerStatsCreds);
    } catch {
      // If the API call fails (e.g. no credentials), fall back to cache-based detection
    }

    for (const season of cachedSeasons) {
      const row = await getCachedView(season, 'combined', ownerStatsLeagueId);
      if (!row) continue;
      const data = row.payload as any;
      const members: any[] = data.members || [];
      const teams: any[] = data.teams || [];
      const hasTeamData = teams.length > 0;

      // For seasons with no team data (pre-2018 cache gap), still credit championships
      // using the leagueHistory API data, but skip W/L/record processing.
      if (!hasTeamData) {
        const histEntry = leagueHistoryChampMap.get(season);
        if (histEntry) {
          const champOwner = getOrCreateOwner(histEntry.championMemberId, []);
          champOwner.championships++;
          champOwner.seasonRecords.push({
            season, teamName: histEntry.championTeamName,
            wins: 0, losses: 0, ties: 0, pf: 0, pa: 0,
            rank: 1, playoffSeed: 0, madePlayoffs: true,
            isChampion: true, isRunnerUp: false,
          });
          if (histEntry.runnerUpMemberId) {
            const ruOwner = getOrCreateOwner(histEntry.runnerUpMemberId, []);
            ruOwner.runnerUps++;
            ruOwner.seasonRecords.push({
              season, teamName: '',
              wins: 0, losses: 0, ties: 0, pf: 0, pa: 0,
              rank: 2, playoffSeed: 0, madePlayoffs: true,
              isChampion: false, isRunnerUp: true,
            });
          }
        }
        continue;
      }

      const schedule: any[] = data.schedule || [];
      const settings: any = data.settings || {};
      const playoffMatchupPeriodStart: number =
        (settings.scheduleSettings?.matchupPeriodCount ?? 14) + 1;
      // Build teamId → memberId map for this season
      const teamToMember = new Map<number, string>();
      for (const team of teams) {
        const primaryOwner: string = team.primaryOwner || (team.owners?.[0] ?? '');
         if (primaryOwner) teamToMember.set(team.id, primaryOwner);
      }
      // Determine champion and runner-up.
      // Priority 1: rankCalculatedFinal — ESPN's authoritative final ranking
      //   (populated in leagueHistory API and in the combined cache payload).
      // Priority 2: findChampionshipMatchup — bracket-tracing from schedule data
      //   (used when rankCalculatedFinal is missing or 0 for older seasons).
      let championTeamId: number | null = null;
      let runnerUpTeamId: number | null = null;

      const champByRank = teams.find((t: any) => t.rankCalculatedFinal === 1);
      const ruByRank    = teams.find((t: any) => t.rankCalculatedFinal === 2);
      if (champByRank) {
        championTeamId = champByRank.id;
        runnerUpTeamId = ruByRank?.id ?? null;
      } else {
        // Fallback: bracket-trace the schedule to find the championship game
        const champMatchup = findChampionshipMatchup(schedule);
        if (champMatchup) {
          if (champMatchup.winner === 'HOME') {
            championTeamId = champMatchup.home?.teamId ?? null;
            runnerUpTeamId = champMatchup.away?.teamId ?? null;
          } else if (champMatchup.winner === 'AWAY') {
            championTeamId = champMatchup.away?.teamId ?? null;
            runnerUpTeamId = champMatchup.home?.teamId ?? null;
          }
        }
      }

      // Process each team's season record
      for (const team of teams) {
        const memberId = teamToMember.get(team.id);
        if (!memberId) continue;
        const owner = getOrCreateOwner(memberId, members);

        const overall = team.record?.overall || {};
        const wins = overall.wins ?? 0;
        const losses = overall.losses ?? 0;
        const ties = overall.ties ?? 0;
        const pf = team.points ?? 0;
        // PA from record.overall.pointsAgainst if available, else 0
        const pa = overall.pointsAgainst ?? 0;
        const playoffSeed = team.playoffSeed ?? 0;
        const madePlayoffs = playoffSeed > 0 && playoffSeed <= 7;
        const isChampion = team.id === championTeamId;
        const isRunnerUp = team.id === runnerUpTeamId;

        owner.totalWins += wins;
        owner.totalLosses += losses;
        owner.totalTies += ties;
        owner.totalPF += pf;
        owner.totalPA += pa;
        if (madePlayoffs) owner.playoffAppearances++;
        if (isChampion) owner.championships++;
        if (isRunnerUp) owner.runnerUps++;

        const tc = team.transactionCounter || {};
        owner.seasonRecords.push({
          season,
          teamName: team.name || team.abbrev || `Team ${team.id}`,
          wins, losses, ties, pf, pa,
          rank: team.rankCalculatedFinal ?? team.rankFinal ?? 0,
          playoffSeed,
          madePlayoffs,
          isChampion,
          isRunnerUp,
        });
        owner.txnSeasons.push({
          season,
          acquisitions: tc.acquisitions ?? 0,
          drops: tc.drops ?? 0,
          trades: tc.trades ?? 0,
          moveToActive: tc.moveToActive ?? 0,
          moveToIR: tc.moveToIR ?? 0,
        });
      }

      // Process playoff wins/losses for each owner
      // Include WINNERS_BRACKET and LOSERS_BRACKET matchups (but not BYEs)
      const playoffMatchups = schedule.filter(
        (m: any) => m.matchupPeriodId >= playoffMatchupPeriodStart &&
          m.playoffTierType && m.playoffTierType !== 'NONE' &&
          m.winner && m.winner !== 'UNDECIDED'
      );

      for (const matchup of playoffMatchups) {
        const homeTeamId: number = matchup.home?.teamId;
        const awayTeamId: number = matchup.away?.teamId;
        if (!homeTeamId || !awayTeamId) continue;

        const homeMember = teamToMember.get(homeTeamId);
        const awayMember = teamToMember.get(awayTeamId);
        if (!homeMember || !awayMember) continue;

        const homeOwner = getOrCreateOwner(homeMember, members);
        const awayOwner = getOrCreateOwner(awayMember, members);

        if (matchup.winner === 'HOME') {
          homeOwner.playoffWins++;
          awayOwner.playoffLosses++;
        } else if (matchup.winner === 'AWAY') {
          awayOwner.playoffWins++;
          homeOwner.playoffLosses++;
        }
        // TIE in playoffs is extremely rare but handle gracefully (no increment)
      }

      // Process head-to-head from regular-season matchups
      const regularSeason = schedule.filter(
        (m: any) => (!m.playoffTierType || m.playoffTierType === 'NONE') &&
          m.winner && m.winner !== 'UNDECIDED'
      );

      for (const matchup of regularSeason) {
        const homeTeamId: number = matchup.home?.teamId;
        const awayTeamId: number = matchup.away?.teamId;
        if (!homeTeamId || !awayTeamId) continue;

        const homeMember = teamToMember.get(homeTeamId);
        const awayMember = teamToMember.get(awayTeamId);
        if (!homeMember || !awayMember) continue;

        const homeOwner = getOrCreateOwner(homeMember, members);
        const awayOwner = getOrCreateOwner(awayMember, members);

        if (!homeOwner.h2h.has(awayMember)) homeOwner.h2h.set(awayMember, { wins: 0, losses: 0, ties: 0 });
        if (!awayOwner.h2h.has(homeMember)) awayOwner.h2h.set(homeMember, { wins: 0, losses: 0, ties: 0 });

        const homeH2H = homeOwner.h2h.get(awayMember)!;
        const awayH2H = awayOwner.h2h.get(homeMember)!;

        if (matchup.winner === 'HOME') {
          homeH2H.wins++; awayH2H.losses++;
        } else if (matchup.winner === 'AWAY') {
          awayH2H.wins++; homeH2H.losses++;
        } else {
          homeH2H.ties++; awayH2H.ties++;
        }
      }
    }

    // ── Serialize to plain objects ──────────────────────────────────────────
    const owners = Array.from(ownerMap.values()).map((o) => {
      const totalGames = o.totalWins + o.totalLosses + o.totalTies;
      const winPct = totalGames > 0 ? Math.round((o.totalWins / totalGames) * 1000) / 10 : 0;
      const avgPF = o.seasonRecords.length > 0
        ? Math.round((o.totalPF / o.seasonRecords.length) * 10) / 10
        : 0;
      const avgPA = o.seasonRecords.length > 0
        ? Math.round((o.totalPA / o.seasonRecords.length) * 10) / 10
        : 0;
      const h2hArray = Array.from(o.h2h.entries()).map(([oppId, rec]) => ({
        opponentMemberId: oppId,
        wins: rec.wins,
        losses: rec.losses,
        ties: rec.ties,
      }));
      // ── Transaction / GM Style metrics ──
      const totalAcquisitions = o.txnSeasons.reduce((s, t) => s + t.acquisitions, 0);
      const totalDrops = o.txnSeasons.reduce((s, t) => s + t.drops, 0);
      const totalTrades = o.txnSeasons.reduce((s, t) => s + t.trades, 0);
      const totalRosterMoves = o.txnSeasons.reduce((s, t) => s + t.moveToActive + t.moveToIR, 0);
      const txnSeasonCount = o.txnSeasons.length || 1;
      const avgAcquisitions = Math.round((totalAcquisitions / txnSeasonCount) * 10) / 10;
      const avgTrades = Math.round((totalTrades / txnSeasonCount) * 10) / 10;

      // Waiver aggression: 0–100 scale based on avg acquisitions
      // League context: ~10 = very low, ~70 = very high
      const waiverAggression = Math.min(100, Math.round((avgAcquisitions / 70) * 100));

      // Trade frequency: 0–100 scale based on avg trades per season
      // League context: ~2 = low, ~15 = very high
      const tradeFrequency = Math.min(100, Math.round((avgTrades / 15) * 100));

      // Roster stability: inverse of churn (acquisitions + drops relative to roster size ~14)
      // High stability = low churn
      const avgChurn = (totalAcquisitions + totalDrops) / txnSeasonCount;
      const rosterStability = Math.max(0, Math.round(100 - (avgChurn / 100) * 100));

      // GM Archetype based on dominant traits
      let gmArchetype: string;
      let gmArchetypeDesc: string;
      if (waiverAggression >= 70 && tradeFrequency >= 60) {
        gmArchetype = 'Dealmaker';
        gmArchetypeDesc = 'Extremely active on both the waiver wire and in trades. Never sits still — always looking for an edge.';
      } else if (waiverAggression >= 70) {
        gmArchetype = 'Waiver Grinder';
        gmArchetypeDesc = 'Dominates the waiver wire with high-volume pickups. Relies on finding hidden gems over big trades.';
      } else if (tradeFrequency >= 60) {
        gmArchetype = 'Trade Shark';
        gmArchetypeDesc = 'Prefers to build the roster through trades rather than free agency. Looks to exploit market inefficiencies.';
      } else if (rosterStability >= 70) {
        gmArchetype = 'Patient Builder';
        gmArchetypeDesc = 'Trusts the draft and rarely makes moves. Builds through the draft and keeper strategy.';
      } else if (waiverAggression >= 45) {
        gmArchetype = 'Opportunist';
        gmArchetypeDesc = 'Moderately active — makes targeted moves when the right opportunity arises.';
      } else {
        gmArchetype = 'Set & Forget';
        gmArchetypeDesc = 'Minimal roster activity. Relies heavily on draft-day decisions to carry the season.';
      }

      // Best and worst seasons by win %
      const sortedSeasons = [...o.seasonRecords].sort((a, b) => {
        const aGames = a.wins + a.losses + a.ties;
        const bGames = b.wins + b.losses + b.ties;
        const aPct = aGames > 0 ? a.wins / aGames : 0;
        const bPct = bGames > 0 ? b.wins / bGames : 0;
        return bPct - aPct;
      });
      return {
        memberId: o.memberId,
        firstName: o.firstName,
        lastName: o.lastName,
        displayName: o.displayName,
        fullName: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.displayName,
        totalWins: o.totalWins,
        totalLosses: o.totalLosses,
        totalTies: o.totalTies,
        totalGames,
        winPct,
        totalPF: Math.round(o.totalPF * 10) / 10,
        totalPA: Math.round(o.totalPA * 10) / 10,
        avgPF,
        avgPA,
        pointDiff: Math.round((o.totalPF - o.totalPA) * 10) / 10,
        playoffAppearances: o.playoffAppearances,
        playoffWins: o.playoffWins,
        playoffLosses: o.playoffLosses,
        championships: o.championships,
        runnerUps: o.runnerUps,
        seasonsActive: o.seasonRecords.length,
        playoffRate: o.seasonRecords.length > 0
          ? Math.round((o.playoffAppearances / o.seasonRecords.length) * 1000) / 10
          : 0,
        seasonRecords: o.seasonRecords.sort((a, b) => a.season - b.season),
        h2h: h2hArray,
        bestSeason: sortedSeasons[0] ?? null,
        worstSeason: sortedSeasons[sortedSeasons.length - 1] ?? null,
        // Transaction stats
        txnSeasons: o.txnSeasons.sort((a, b) => a.season - b.season),
        totalAcquisitions,
        totalDrops,
        totalTrades,
        totalRosterMoves,
        avgAcquisitions,
        avgTrades,
        waiverAggression,
        tradeFrequency,
        rosterStability,
        gmArchetype,
        gmArchetypeDesc,
      };
    });

    // Sort by all-time win % descending
    owners.sort((a, b) => b.winPct - a.winPct);

    return {
      owners,
      seasons: cachedSeasons,
      totalSeasons: cachedSeasons.length,
    };
    }); // end memCache
  }),

  ownerPredictions: protectedProcedure
    .input(z.object({ memberId: z.string() }))
    .query(async ({ input }) => {
      // Fetch the full owner stats to build context
      const cachedSeasons = await getAllCachedSeasons();

      // Collect all owner data for this member across seasons
      let ownerName = '';
      let teamNames: string[] = [];
      const seasonSummaries: string[] = [];
      let totalAcquisitions = 0;
      let totalTrades = 0;
      let totalDrops = 0;
      let totalWins = 0;
      let totalLosses = 0;
      let championships = 0;
      let playoffAppearances = 0;
      let seasonsActive = 0;

      for (const season of cachedSeasons) {
        const row = await getCachedView(season, 'combined');
        if (!row) continue;
        const data = row.payload as any;

        const members: any[] = data.members || [];
        const teams: any[] = data.teams || [];
        const schedule: any[] = data.schedule || [];

        // Find this owner's team in this season
        const team = teams.find((t: any) =>
          t.primaryOwner === input.memberId || t.owners?.includes(input.memberId)
        );
        if (!team) continue;

        // Resolve name from members
        if (!ownerName) {
          const m = members.find((x: any) => x.id === input.memberId);
          if (m) ownerName = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.displayName;
        }

        const teamName = team.name || team.abbrev || `Team ${team.id}`;
        if (!teamNames.includes(teamName)) teamNames.push(teamName);

        const tc = team.transactionCounter || {};
        const acq = tc.acquisitions ?? 0;
        const drops = tc.drops ?? 0;
        const trades = tc.trades ?? 0;
        totalAcquisitions += acq;
        totalTrades += trades;
        totalDrops += drops;

        const overall = team.record?.overall || {};
        const wins = overall.wins ?? 0;
        const losses = overall.losses ?? 0;
        totalWins += wins;
        totalLosses += losses;
        seasonsActive++;

        // Determine if champion: rankCalculatedFinal=1 is authoritative;
        // fall back to bracket-tracing if unavailable.
        let isChamp = false;
        {
          const champByRankP = teams.find((t: any) => t.rankCalculatedFinal === 1);
          if (champByRankP) {
            isChamp = champByRankP.id === team.id;
          } else {
            const champM = findChampionshipMatchup(schedule);
            if (champM) {
              const champTeamId = champM.winner === 'HOME'
                ? champM.home?.teamId
                : champM.away?.teamId;
              isChamp = champTeamId === team.id;
            }
          }
        }
        if (isChamp) championships++;

        const playoffSeed = team.playoffSeed ?? 0;
        const madePlayoffs = playoffSeed > 0 && playoffSeed <= 7;
        if (madePlayoffs) playoffAppearances++;

        const pf = team.points ?? 0;
        seasonSummaries.push(
          `${season}: ${teamName} | ${wins}-${losses} | PF: ${pf.toFixed(1)} | ` +
          `Seed: ${playoffSeed || 'Missed'} | ${isChamp ? 'CHAMPION' : madePlayoffs ? 'Playoff' : 'Missed Playoffs'} | ` +
          `Adds: ${acq}, Drops: ${drops}, Trades: ${trades}`
        );
      }

      // Guard: if no seasons found for this memberId, return NOT_FOUND
      if (seasonsActive === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No season data found for memberId: ${input.memberId}`,
        });
      }

      if (!ownerName) ownerName = input.memberId;

      const totalGames = totalWins + totalLosses;
      const winPct = totalGames > 0 ? Math.round((totalWins / totalGames) * 1000) / 10 : 0;
      const avgAcq = seasonsActive > 0 ? Math.round(totalAcquisitions / seasonsActive) : 0;
      const avgTrades = seasonsActive > 0 ? Math.round(totalTrades / seasonsActive) : 0;

      // Classify GM style
      const waiverAggression = Math.min(100, Math.round((avgAcq / 70) * 100));
      const tradeFrequency = Math.min(100, Math.round((avgTrades / 15) * 100));
      const avgChurn = (totalAcquisitions + totalDrops) / (seasonsActive || 1);
      const rosterStability = Math.max(0, Math.round(100 - (avgChurn / 100) * 100));

      let gmArchetype = 'Opportunist';
      if (waiverAggression >= 70 && tradeFrequency >= 60) gmArchetype = 'Dealmaker';
      else if (waiverAggression >= 70) gmArchetype = 'Waiver Grinder';
      else if (tradeFrequency >= 60) gmArchetype = 'Trade Shark';
      else if (rosterStability >= 70) gmArchetype = 'Patient Builder';
      else if (waiverAggression < 30 && tradeFrequency < 30) gmArchetype = 'Set & Forget';

      const prompt = `You are an expert Fantasy Football analyst for the 18-season keeper league "ATLANTAS FINEST FF" (14 teams, PPR, 1 keeper, 7-team playoffs, snake draft).

Analyze the following owner's career history and generate a detailed 2026 behavioral prediction report.

OWNER: ${ownerName}
Team names used: ${teamNames.join(', ')}
Career record: ${totalWins}-${totalLosses} (${winPct}% win rate) across ${seasonsActive} seasons
Championships: ${championships} | Playoff appearances: ${playoffAppearances}/${seasonsActive}
GM Archetype: ${gmArchetype}
Avg acquisitions/season: ${avgAcq} | Avg trades/season: ${avgTrades}
Waiver aggression score: ${waiverAggression}/100 | Trade frequency score: ${tradeFrequency}/100 | Roster stability: ${rosterStability}/100

SEASON-BY-SEASON HISTORY:
${seasonSummaries.join('\n')}

Generate a JSON prediction report with these exact fields:
{
  "ownerSummary": "2-3 sentence narrative describing this owner's career arc and management style",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "predictedBehavior2026": {
    "draftStrategy": "Predicted draft approach for 2026 (2-3 sentences)",
    "waiverApproach": "Predicted waiver wire behavior (1-2 sentences)",
    "tradeApproach": "Predicted trade behavior (1-2 sentences)",
    "keeperPrediction": "Analysis of their likely keeper strategy (1-2 sentences)",
    "overallOutlook": "Overall 2026 season prediction with confidence level (2-3 sentences)"
  },
  "dangerRating": "LOW | MEDIUM | HIGH | ELITE",
  "dangerRationale": "1-2 sentences explaining the danger rating",
  "rivalryAlert": "Identify 1-2 specific owners they tend to clash with or who exploit their weaknesses, based on the data"
}`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'You are a fantasy football analytics expert. Always respond with valid JSON only, no markdown fences.' },
          { role: 'user', content: prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'owner_prediction',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                ownerSummary: { type: 'string' },
                strengths: { type: 'array', items: { type: 'string' } },
                weaknesses: { type: 'array', items: { type: 'string' } },
                predictedBehavior2026: {
                  type: 'object',
                  properties: {
                    draftStrategy: { type: 'string' },
                    waiverApproach: { type: 'string' },
                    tradeApproach: { type: 'string' },
                    keeperPrediction: { type: 'string' },
                    overallOutlook: { type: 'string' },
                  },
                  required: ['draftStrategy', 'waiverApproach', 'tradeApproach', 'keeperPrediction', 'overallOutlook'],
                  additionalProperties: false,
                },
                dangerRating: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'ELITE'] },
                dangerRationale: { type: 'string' },
                rivalryAlert: { type: 'string' },
              },
              required: ['ownerSummary', 'strengths', 'weaknesses', 'predictedBehavior2026', 'dangerRating', 'dangerRationale', 'rivalryAlert'],
              additionalProperties: false,
            },
          },
        },
      });

      const raw = response.choices?.[0]?.message?.content;
      let parsed: unknown;
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to parse LLM prediction response',
        });
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'LLM returned an invalid prediction format',
        });
      }

      return {
        memberId: input.memberId,
        ownerName,
        gmArchetype,
        waiverAggression,
        tradeFrequency,
        rosterStability,
        prediction: parsed,
      };
    }),

  // ── Owner Self-Review (AI-generated scouting report for Rod) ────────────────
  ownerSelfReview: protectedProcedure.query(async () => {
    const prompt = `You are an expert fantasy football analyst reviewing the career of Rod Sellers, manager of "Str8FrmHell / RodZilla" in the 18-season keeper league "ATLANTAS FINEST FF" (14 teams, PPR, 1 keeper, 7-team playoffs, snake draft).

Here is Rod's complete career data:

CAREER RECORD: 50W–56L (47.2% win rate) across 8 seasons (2018–2025)
PLAYOFF APPEARANCES: 4 of 8 seasons (2019 #2 seed, 2021 #9, 2023 #7, 2025 #3)
BEST SEASON: 2025 — 9–5, #3 seed, 1921 PF (career high)
WORST SEASON: 2022 — 3–11, #13 seed, 1447 PF

DRAFT TENDENCIES (107 picks, 2018–2025):
- RB: 38 picks (36%), avg round 4.7 — 7 of 8 round-1 picks were RBs
- WR: 26 picks (24%), avg round 6.2
- QB: 8 picks (7%), avg round 5.9
- TE: 5 picks (5%), avg round 6.8
- Early rounds (1–3): 52% RB, 27% WR, 8% TE, 4% QB
- Draft style: RB-First Builder

KEEPER HISTORY: Derrick Henry 2022 (Rd1), Saquon Barkley 2023 (Rd2), Saquon Barkley 2024 (Rd2), Breece Hall 2025 (Rd5)
2026 KEEPER: TBD -- pending trade decisions before Aug 18 deadline

GM ACTIVITY (8-season averages): 29 adds/season, 34 drops/season, 7.3 trades/season
- Most active: 2021 (49 adds, 9 trades) — 7–7, missed playoffs
- Quietest: 2024 (13 adds, 1 trade) — 5–8
- Best seasons (2019, 2025) had moderate activity (26–38 adds, 4–12 trades)

NOTABLE MOMENTS:
- 2020: Drafted Lamar Jackson in Round 1 (bold QB1 call)
- 2023: Double RB round 1 (CMC + Bijan Robinson)
- 2025: Career-best season with McCaffrey Rd1 + McBride Rd2

Generate an honest, detailed self-scouting report as if you are Rod's personal analytics coach. Be direct and specific — don't be generic.

Respond with JSON in this exact format:
{
  "narrative": "3-4 sentence career narrative describing Rod's arc, style, and trajectory",
  "focusAreas2026": ["specific focus area 1", "specific focus area 2", "specific focus area 3", "specific focus area 4"],
  "draftRecommendations": "2-3 sentences of specific 2026 draft advice based on his tendencies and blind spots",
  "honestVerdict": "1-2 sentences of honest, direct assessment of where Rod stands in the league and what separates him from the top managers"
}`;

    const response = await invokeLLM({
      messages: [
        { role: 'system', content: 'You are a fantasy football analytics expert. Always respond with valid JSON only, no markdown fences.' },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'owner_self_review',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              narrative:             { type: 'string' },
              focusAreas2026:        { type: 'array', items: { type: 'string' } },
              draftRecommendations:  { type: 'string' },
              honestVerdict:         { type: 'string' },
            },
            required: ['narrative', 'focusAreas2026', 'draftRecommendations', 'honestVerdict'],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response.choices?.[0]?.message?.content;
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to parse LLM self-review response' });
    }
    return parsed as { narrative: string; focusAreas2026: string[]; draftRecommendations: string; honestVerdict: string };
  }),

  // ── League Draft Tendencies ──────────────────────────────────────────────
  // Aggregates all 14 managers' draft picks by round and position from 2018-2025
  leagueDraftTendencies: publicProcedure.query(() => {
    return memCache("leagueDraftTendencies", 10 * 60_000, async () => {
    const POS_MAP: Record<number, string> = {
      1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST", 17: "D/ST",
    };
    const cachedSeasons = (await getAllCachedSeasons()).sort((a, b) => a - b);

    // owner key -> stats
    const ownerMap = new Map<string, {
      memberId: string; name: string; seasons: Set<number>;
      byRound: Record<number, Record<string, number>>;
      byPosition: Record<string, number>;
      round1Picks: Array<{ season: number; playerName: string; position: string; isKeeper: boolean }>;
      round2Picks: Array<{ season: number; playerName: string; position: string; isKeeper: boolean }>;
      round3Picks: Array<{ season: number; playerName: string; position: string; isKeeper: boolean }>;
      totalPicks: number;
    }>();

    const seenPickKeys = new Set<string>();

    for (const season of cachedSeasons) {
      const data = await getSeasonData(season);
      if (!data) continue;

      // Build member name map
      const memberNameMap: Record<string, string> = {};
      for (const m of (data.members as Record<string, unknown>[]) || []) {
        const mid = m.id as string;
        memberNameMap[mid] = `${m.firstName || ""} ${m.lastName || ""}`.trim() || (m.displayName as string) || mid;
      }

      // Build player info from rosters
      const playerInfoMap = new Map<number, { name: string; position: string }>();
      for (const t of (data.teams as Record<string, unknown>[]) || []) {
        const entries = ((t.roster as Record<string, unknown>)?.entries as Record<string, unknown>[]) || [];
        for (const entry of entries) {
          const poolEntry = (entry.playerPoolEntry as Record<string, unknown>) || {};
          const player = (poolEntry.player as Record<string, unknown>) || {};
          const pid = player.id as number;
          if (pid && !playerInfoMap.has(pid)) {
            playerInfoMap.set(pid, {
              name: (player.fullName as string) || `Player#${pid}`,
              position: POS_MAP[player.defaultPositionId as number] || "UNK",
            });
          }
        }
      }

      // Build team -> primary owner map
      const teamOwnerMap: Record<number, string> = {};
      for (const t of (data.teams as Record<string, unknown>[]) || []) {
        const tid = t.id as number;
        const owners = (t.owners as string[]) || [];
        teamOwnerMap[tid] = t.primaryOwner as string || owners[0] || "";
      }

      // Process draft picks
      const draft = (data.draftDetail as Record<string, unknown>) || {};
      const picks = (draft.picks as Record<string, unknown>[]) || [];
      for (const pick of picks) {
        const overall = pick.overallPickNumber as number;
        const pickKey = `${season}:${overall}`;
        if (seenPickKeys.has(pickKey)) continue;
        seenPickKeys.add(pickKey);

        const teamId = pick.teamId as number;
        const ownerId = teamOwnerMap[teamId] || `team_${teamId}`;
        const ownerName = memberNameMap[ownerId] || `Team${teamId}`;
        const round = (pick.roundId as number) || Math.ceil(overall / 14) || 1;
        const isKeeper = pick.keeper === true || pick.reservedForKeeper === true;

        // Get player name and position
        const pEntry = (pick.playerPoolEntry as Record<string, unknown>) || {};
        const pPlayer = (pEntry.player as Record<string, unknown>) || {};
        const playerId = pick.playerId as number;
        const playerInfo = playerInfoMap.get(playerId);
        const playerName = (pPlayer.fullName as string) || playerInfo?.name || `Player#${playerId}`;
        const posId = pPlayer.defaultPositionId as number || 0;
        const position = POS_MAP[posId] || playerInfo?.position || "UNK";

        if (!ownerMap.has(ownerId)) {
          ownerMap.set(ownerId, {
            memberId: ownerId, name: ownerName, seasons: new Set(),
            byRound: {}, byPosition: {}, round1Picks: [], round2Picks: [], round3Picks: [], totalPicks: 0,
          });
        }
        const o = ownerMap.get(ownerId)!;
        o.seasons.add(season);
        o.totalPicks++;
        if (!o.byRound[round]) o.byRound[round] = {};
        o.byRound[round][position] = (o.byRound[round][position] || 0) + 1;
        o.byPosition[position] = (o.byPosition[position] || 0) + 1;
        const pickDetail = { season, playerName, position, isKeeper };
        if (round === 1) o.round1Picks.push(pickDetail);
        if (round === 2) o.round2Picks.push(pickDetail);
        if (round === 3) o.round3Picks.push(pickDetail);
      }
    }

    // Serialize and compute derived fields
    const owners = Array.from(ownerMap.values())
      .filter(o => o.totalPicks > 0)
      .sort((a, b) => b.seasons.size - a.seasons.size || b.totalPicks - a.totalPicks)
      .map(o => {
        const posTotal = Object.values(o.byPosition).reduce((s, v) => s + v, 0);
        const topPositions = Object.entries(o.byPosition)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([pos, count]) => ({ pos, count, pct: Math.round(count / posTotal * 100) }));
        const r1Top = Object.entries(o.byRound[1] || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "?";
        const r2Top = Object.entries(o.byRound[2] || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "?";
        const r3Top = Object.entries(o.byRound[3] || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "?";
        // Draft style badge
        const rb1 = o.byRound[1]?.["RB"] || 0;
        const wr1 = o.byRound[1]?.["WR"] || 0;
        const qb1 = o.byRound[1]?.["QB"] || 0;
        const te1 = o.byRound[1]?.["TE"] || 0;
        const r1Total = rb1 + wr1 + qb1 + te1 || 1;
        let draftStyle = "Balanced";
        if (rb1 / r1Total >= 0.6) draftStyle = "RB-First";
        else if (wr1 / r1Total >= 0.6) draftStyle = "WR-First";
        else if (qb1 / r1Total >= 0.3) draftStyle = "QB-Early";
        else if (te1 / r1Total >= 0.3) draftStyle = "TE-Premium";

        // Extended tendency metrics
        // QB timing: collect all rounds where QB was drafted
        const allQBRounds: number[] = [];
        for (const [rd, posCounts] of Object.entries(o.byRound)) {
          const rdNum = Number(rd);
          const qbCount = (posCounts as Record<string, number>)["QB"] || 0;
          for (let i = 0; i < qbCount; i++) allQBRounds.push(rdNum);
        }
        const qbEarliestRound = allQBRounds.length > 0 ? Math.min(...allQBRounds) : 99;
        const qbAvgRound = allQBRounds.length > 0 ? Math.round(allQBRounds.reduce((a, b) => a + b, 0) / allQBRounds.length) : 99;

        // TE timing
        const allTERounds: number[] = [];
        for (const [rd, posCounts] of Object.entries(o.byRound)) {
          const rdNum = Number(rd);
          const teCount = (posCounts as Record<string, number>)["TE"] || 0;
          for (let i = 0; i < teCount; i++) allTERounds.push(rdNum);
        }
        const teEarliestRound = allTERounds.length > 0 ? Math.min(...allTERounds) : 99;
        const teAvgRound = allTERounds.length > 0 ? Math.round(allTERounds.reduce((a, b) => a + b, 0) / allTERounds.length) : 99;

        // Keeper rate: % of round1 picks that are keepers
        const r1KeeperCount = o.round1Picks.filter((p: { isKeeper: boolean }) => p.isKeeper).length;
        const keeperRate = o.round1Picks.length > 0 ? Math.round(r1KeeperCount / o.round1Picks.length * 100) : 0;
        const allEarlyPicks = [...o.round1Picks, ...o.round2Picks, ...o.round3Picks];
        const totalKeeperPicks = allEarlyPicks.filter((p: { isKeeper: boolean }) => p.isKeeper).length;

        // Early rounds (1-3) positional concentration
        const earlyRoundPicks: Record<string, number> = {};
        for (let rd = 1; rd <= 3; rd++) {
          for (const [pos, cnt] of Object.entries(o.byRound[rd] || {})) {
            earlyRoundPicks[pos] = (earlyRoundPicks[pos] || 0) + (cnt as number);
          }
        }
        const earlyTotal = Object.values(earlyRoundPicks).reduce((s, v) => s + v, 0) || 1;
        const earlyRbPct = Math.round(((earlyRoundPicks["RB"] || 0) / earlyTotal) * 100);
        const earlyWrPct = Math.round(((earlyRoundPicks["WR"] || 0) / earlyTotal) * 100);
        const earlyQbPct = Math.round(((earlyRoundPicks["QB"] || 0) / earlyTotal) * 100);
        const earlyTePct = Math.round(((earlyRoundPicks["TE"] || 0) / earlyTotal) * 100);

        // Mid rounds (4-6) top positions
        const midRoundPicks: Record<string, number> = {};
        for (const [rd, posCounts] of Object.entries(o.byRound)) {
          const rdNum = Number(rd);
          if (rdNum >= 4 && rdNum <= 6) {
            for (const [pos, cnt] of Object.entries(posCounts as Record<string, number>)) {
              midRoundPicks[pos] = (midRoundPicks[pos] || 0) + cnt;
            }
          }
        }
        const midTotal = Object.values(midRoundPicks).reduce((s, v) => s + v, 0) || 1;
        const midTopPos = Object.entries(midRoundPicks).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([pos, cnt]) => ({ pos, pct: Math.round((cnt as number) / midTotal * 100) }));

        // Late rounds (10+) top positions
        const lateRoundPicks: Record<string, number> = {};
        for (const [rd, posCounts] of Object.entries(o.byRound)) {
          if (Number(rd) >= 10) {
            for (const [pos, cnt] of Object.entries(posCounts as Record<string, number>)) {
              lateRoundPicks[pos] = (lateRoundPicks[pos] || 0) + cnt;
            }
          }
        }
        const lateTotal = Object.values(lateRoundPicks).reduce((s, v) => s + v, 0) || 1;
        const lateTopPos = Object.entries(lateRoundPicks).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([pos, cnt]) => ({ pos, pct: Math.round((cnt as number) / lateTotal * 100) }));

        // Positional diversity score (0-100)
        const posEntropy = topPositions.reduce((entropy: number, p: { pct: number }) => {
          const frac = p.pct / 100;
          return entropy - (frac > 0 ? frac * Math.log2(frac) : 0);
        }, 0);
        const maxEntropy = Math.log2(5);
        const diversityScore = Math.round((posEntropy / maxEntropy) * 100);

        return {
          memberId: o.memberId,
          name: o.name,
          seasons: o.seasons.size,
          totalPicks: o.totalPicks,
          topPositions,
          byRound: o.byRound,
          round1Picks: [...o.round1Picks].sort((a, b) => b.season - a.season),
          round2Picks: [...o.round2Picks].sort((a, b) => b.season - a.season),
          round3Picks: [...o.round3Picks].sort((a, b) => b.season - a.season),
          r1Top, r2Top, r3Top,
          draftStyle,
          rb1Pct: Math.round(rb1 / r1Total * 100),
          wr1Pct: Math.round(wr1 / r1Total * 100),
          qbEarliestRound, qbAvgRound,
          teEarliestRound, teAvgRound,
          keeperRate, totalKeeperPicks,
          earlyRbPct, earlyWrPct, earlyQbPct, earlyTePct,
          midTopPos, lateTopPos,
          diversityScore,
        };
      });

    // League-wide round tendencies
    const leagueByRound: Record<number, Record<string, number>> = {};
    for (const o of Array.from(ownerMap.values())) {
      for (const [round, posCounts] of Object.entries(o.byRound)) {
        const r = Number(round);
        if (!leagueByRound[r]) leagueByRound[r] = {};
        for (const [pos, cnt] of Object.entries(posCounts)) {
          leagueByRound[r][pos] = (leagueByRound[r][pos] || 0) + cnt;
        }
      }
    }

     return { owners, leagueByRound, seasons: cachedSeasons };
    }); // end memCache
  }),
  // ── Pick Value Calculator ─────────────────────────────────────────────────
  // 14-team PPR calibrated pick value chart (210 picks, 15 rounds × 14 teams)
  // Formula: value(overall) = 3000 * e^(-0.028 * (overall - 1))
  // Calibrated so: 1.01=3000, 1.14≈2085, 2.01≈1409, 3.14≈952, 5.14≈435
  pickValueChart: publicProcedure.query(() => {
    const TEAMS = 14;
    const ROUNDS = 15;
    const BASE = 3000;
    const K = 0.028;
    const picks: Array<{ overall: number; round: number; pickInRound: number; label: string; value: number }> = [];
    for (let overall = 1; overall <= TEAMS * ROUNDS; overall++) {
      const round = Math.ceil(overall / TEAMS);
      const positionInRound = overall - (round - 1) * TEAMS;
      const pickInRound = round % 2 === 1 ? positionInRound : TEAMS + 1 - positionInRound;
      const value = Math.round(BASE * Math.exp(-K * (overall - 1)));
      picks.push({ overall, round, pickInRound, label: `${round}.${String(pickInRound).padStart(2, '0')}`, value });
    }
    return picks;
  }),

  pickTradeEval: publicProcedure
    .input(z.object({
      sideA: z.array(z.object({ round: z.number(), pickInRound: z.number() })),
      sideB: z.array(z.object({ round: z.number(), pickInRound: z.number() })),
      counterpartyMemberId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const TEAMS = 14;
      const BASE = 3000;
      const K = 0.028;
      function pickValue(round: number, pickInRound: number): number {
        const overall = (round - 1) * TEAMS + (round % 2 === 1 ? pickInRound : TEAMS + 1 - pickInRound);
        return Math.round(BASE * Math.exp(-K * (overall - 1)));
      }
      const valueA = input.sideA.reduce((s, p) => s + pickValue(p.round, p.pickInRound), 0);
      const valueB = input.sideB.reduce((s, p) => s + pickValue(p.round, p.pickInRound), 0);
      const diff = valueA - valueB;
      const pct = valueB > 0 ? Math.round((valueA / valueB) * 100) : 0;
      let verdict: 'WIN' | 'FAIR' | 'LOSS';
      if (pct >= 110) verdict = 'WIN';
      else if (pct >= 90) verdict = 'FAIR';
      else verdict = 'LOSS';

      // ── DNA-based acceptance probability ──────────────────────────────────
      let dnaAnalysis: {
        ownerName: string;
        draftStyle: string;
        tradeProfile: string;
        acceptanceProbability: number;
        reasoning: string[];
        historicalContext: string;
      } | null = null;

      if (input.counterpartyMemberId) {
        try {
          type TendencyOwner = {
            memberId: string; name: string; draftStyle: string;
            rb1Pct: number; wr1Pct: number; earlyRbPct: number;
            diversityScore: number; keeperRate: number;
            qbAvgRound: number; teAvgRound: number;
          };
          // Re-use the leagueDraftTendencies cached result by calling getSeasonData
          // Build a minimal owner profile from the most recent 3 seasons
          const recentSeasons = (await getAllCachedSeasons()).sort((a, b) => b - a).slice(0, 3);
          const ownerStats = { rb1Pct: 0, wr1Pct: 0, earlyRbPct: 0, diversityScore: 50, keeperRate: 0, qbAvgRound: 8, teAvgRound: 8, draftStyle: 'BPA', name: input.counterpartyMemberId };
          let r1Total = 0; let rb1 = 0; let wr1 = 0; let earlyRb = 0; let earlyTotal = 0; let keeperPicks = 0; let totalPicks = 0; let qbRounds: number[] = []; let teRounds: number[] = [];
          const POS_MAP2: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST', 17: 'D/ST' };
          for (const season of recentSeasons) {
            const sd = await getSeasonData(season);
            if (!sd) continue;
            const memberNameMap: Record<string, string> = {};
            for (const m of (sd.members as Record<string, unknown>[]) || []) {
              const mid = m.id as string;
              memberNameMap[mid] = `${m.firstName || ''} ${m.lastName || ''}`.trim() || (m.displayName as string) || mid;
            }
            if (memberNameMap[input.counterpartyMemberId!]) ownerStats.name = memberNameMap[input.counterpartyMemberId!];
            const draftDetail = (sd.draftDetail as Record<string, unknown>) || {};
            const draftPicks = (draftDetail.picks as Record<string, unknown>[]) || [];
            const playerInfoMap = new Map<number, { position: string }>();
            for (const t of (sd.teams as Record<string, unknown>[]) || []) {
              for (const entry of (((t.roster as Record<string, unknown>)?.entries as Record<string, unknown>[]) || [])) {
                const pl = ((entry.playerPoolEntry as Record<string, unknown>)?.player as Record<string, unknown>) || {};
                const pid = pl.id as number;
                if (pid) playerInfoMap.set(pid, { position: POS_MAP2[pl.defaultPositionId as number] || 'UNK' });
              }
            }
            for (const pick of draftPicks) {
              const memberId = pick.memberId as string;
              if (memberId !== input.counterpartyMemberId) continue;
              const round = pick.roundId as number;
              const pos = playerInfoMap.get(pick.playerId as number)?.position || 'UNK';
              const isKeeper = !!(pick.keeper as boolean);
              totalPicks++;
              if (isKeeper) keeperPicks++;
              if (round === 1) { r1Total++; if (pos === 'RB') rb1++; if (pos === 'WR') wr1++; }
              if (round <= 4) { earlyTotal++; if (pos === 'RB') earlyRb++; }
              if (pos === 'QB') qbRounds.push(round);
            }
          }
          if (r1Total > 0) { ownerStats.rb1Pct = Math.round(rb1 / r1Total * 100); ownerStats.wr1Pct = Math.round(wr1 / r1Total * 100); }
          if (earlyTotal > 0) ownerStats.earlyRbPct = Math.round(earlyRb / earlyTotal * 100);
          if (totalPicks > 0) ownerStats.keeperRate = keeperPicks / totalPicks;
          if (qbRounds.length > 0) ownerStats.qbAvgRound = qbRounds.reduce((s, r) => s + r, 0) / qbRounds.length;
          ownerStats.draftStyle = ownerStats.rb1Pct > 50 ? 'RB-First' : ownerStats.wr1Pct > 50 ? 'WR-First' : 'BPA';
          const owner: TendencyOwner | undefined = totalPicks > 0 ? { memberId: input.counterpartyMemberId!, ...ownerStats } : undefined;
          if (owner) {
            const reasoning: string[] = [];
            let acceptanceBase = 50;
            // Value ratio: are they getting more value?
            const theirValueRatio = valueB > 0 ? valueA / valueB : 1;
            if (theirValueRatio >= 1.15) { acceptanceBase += 25; reasoning.push(`Receiving ${Math.round((theirValueRatio - 1) * 100)}% more value`); }
            else if (theirValueRatio >= 1.05) { acceptanceBase += 12; reasoning.push(`Slight value advantage for them`); }
            else if (theirValueRatio < 0.90) { acceptanceBase -= 20; reasoning.push(`Giving up ${Math.round((1 - theirValueRatio) * 100)}% more value`); }
            else if (theirValueRatio < 0.95) { acceptanceBase -= 8; reasoning.push(`Slight value disadvantage for them`); }
            // Draft style adjustments
            if (owner.rb1Pct > 50) {
              const r1Picks = input.sideA.filter(p => p.round === 1);
              if (r1Picks.length > 0) { acceptanceBase += 10; reasoning.push(`${owner.name} is RB-first — early picks are premium`); }
            }
            if (owner.earlyRbPct > 60) reasoning.push(`Historically drafts RB in ${owner.earlyRbPct}% of early rounds`);
            if (owner.diversityScore < 40) { acceptanceBase += 5; reasoning.push(`Low positional diversity — likely values consolidation`); }
            if (owner.keeperRate > 0.3) { acceptanceBase -= 8; reasoning.push(`High keeper rate (${Math.round(owner.keeperRate * 100)}%) — values pick flexibility`); }
            if (owner.qbAvgRound < 4) { acceptanceBase -= 5; reasoning.push(`Early QB drafter — R1/R2 picks are premium to them`); }
            const acceptanceProbability = Math.min(95, Math.max(5, acceptanceBase));
            const tradeProfile = owner.keeperRate > 0.25 ? 'Active Trader' : owner.diversityScore > 70 ? 'BPA Purist' : 'Selective Trader';
            const historicalContext = `${owner.name} has a ${owner.draftStyle} draft style with ${owner.diversityScore}% positional diversity. They are a ${tradeProfile}.`;
            dnaAnalysis = { ownerName: owner.name, draftStyle: owner.draftStyle, tradeProfile, acceptanceProbability, reasoning, historicalContext };
          }
        } catch { /* DNA analysis is optional */ }
      }

      // ── Championship equity change ──────────────────────────────────────
      // Rod acquires sideB picks, gives away sideA picks
      const rodAcquiresRounds = input.sideB.map(p => p.round);
      const rodGivesRounds = input.sideA.map(p => p.round);
      function roundEquityImpact(round: number): number {
        if (round === 1) return 5; if (round === 2) return 3;
        if (round === 3) return 2; return 1;
      }
      const equityGained = rodAcquiresRounds.reduce((s, r) => s + roundEquityImpact(r), 0);
      const equityLost = rodGivesRounds.reduce((s, r) => s + roundEquityImpact(r), 0);
      const champEquityDelta = equityGained - equityLost;
      const champEquityLabel = champEquityDelta > 0
        ? `+${champEquityDelta}% title odds improvement`
        : champEquityDelta < 0 ? `${champEquityDelta}% title odds reduction`
        : 'Neutral championship equity impact';

      return { valueA, valueB, diff, pct, verdict, dnaAnalysis, champEquityDelta, champEquityLabel };
    }),

  // ── Draft Pick Trade Tracker ──────────────────────────────────────────────
  // Returns all logged pick trades for a given draft year
  getPickTrades: publicProcedure
    .input(z.object({ draftYear: z.number().default(2026) }))
    .query(async ({ input }) => {
      const trades = await getPickTrades(input.draftYear);
      const BASE = 3000; const K = 0.028; const TEAMS = 14;
      function pv(round: number, pir: number) {
        const overall = (round - 1) * TEAMS + (round % 2 === 1 ? pir : TEAMS + 1 - pir);
        return Math.round(BASE * Math.exp(-K * (overall - 1)));
      }
      const acquired = trades.filter((t) => t.type === 'acquired');
      const tradedAway = trades.filter((t) => t.type === 'traded_away');
      const acquiredValue = acquired.reduce((s, t) => s + t.pickValue, 0);
      const tradedValue = tradedAway.reduce((s, t) => s + t.pickValue, 0);
      return { trades, acquiredValue, tradedValue, netValue: acquiredValue - tradedValue };
    }),

  addPickTrade: protectedProcedure
    .input(z.object({
      draftYear: z.number().default(2026),
      type: z.enum(['acquired', 'traded_away']),
      round: z.number().min(1).max(15),
      pickInRound: z.number().min(1).max(14),
      counterparty: z.string().min(1).max(128),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const TEAMS = 14; const BASE = 3000; const K = 0.028;
      const overall = (input.round - 1) * TEAMS + (input.round % 2 === 1 ? input.pickInRound : TEAMS + 1 - input.pickInRound);
      const pickValue = Math.round(BASE * Math.exp(-K * (overall - 1)));
      const label = `${input.round}.${String(input.pickInRound).padStart(2, '0')}`;
      await addPickTrade({ ...input, label, pickValue, notes: input.notes ?? null });
      return { success: true };
    }),

  removePickTrade: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await removePickTrade(input.id);
      return { success: true };
    }),

  // Returns the 2026 draft order from ESPN
  draftPickPortfolio: publicProcedure.query(async () => {
    const TEAMS = 14;
    const BASE = 3000;
    const K = 0.028;
    function pickValue(round: number, pickInRound: number): number {
      const overall = (round - 1) * TEAMS + (round % 2 === 1 ? pickInRound : TEAMS + 1 - pickInRound);
      return Math.round(BASE * Math.exp(-K * (overall - 1)));
    }

    // Load 2026 draft order from ESPN cache
    let draftOrder: Array<{ teamId: number; teamName: string; round: number; pickInRound: number; overall: number }> = [];
    try {
      const cached = await getCachedView(2026, 'combined');
      if (cached?.payload) {
        const raw = cached.payload as Record<string, unknown>;
        const normalized = normalizeDraftOrder(raw);
        // normalizeDraftOrder returns { pickOrder: [{position, teamId, name, abbrev, owners}], draftDate, ... }
        // pickOrder is the snake order for round 1 only; we expand to all 15 rounds
        const pickOrder = normalized.pickOrder as Array<{ position: number; teamId: number; name?: string; abbrev?: string; owners?: string }>;
        for (let round = 1; round <= 15; round++) {
          const roundOrder = round % 2 === 1 ? pickOrder : [...pickOrder].reverse();
          roundOrder.forEach((slot, idx) => {
            const pickInRound = idx + 1;
            const overall = (round - 1) * TEAMS + (round % 2 === 1 ? pickInRound : TEAMS + 1 - pickInRound);
            draftOrder.push({
              teamId: slot.teamId,
              teamName: slot.name || `Team ${slot.teamId}`,
              round,
              pickInRound: round % 2 === 1 ? pickInRound : TEAMS + 1 - idx,
              overall,
            });
          });
        }
      }
    } catch { /* no 2026 cache yet */ }

    // If no 2026 data, generate a placeholder 14-team snake order
    if (draftOrder.length === 0) {
      for (let round = 1; round <= 15; round++) {
        for (let pos = 1; pos <= TEAMS; pos++) {
          const pickInRound = round % 2 === 1 ? pos : TEAMS + 1 - pos;
          const overall = (round - 1) * TEAMS + pos;
          draftOrder.push({
            teamId: pickInRound,
            teamName: `Team ${pickInRound}`,
            round,
            pickInRound,
            overall,
          });
        }
      }
    }

    return { draftOrder, totalPicks: draftOrder.length };
  }),

    opponentProfile: protectedProcedure
    .input(z.object({ memberId: z.string() }))
    .query(async ({ input }) => {
      const { findLiveOpponentProfile } = await import("./liveOpponentProfile");
      const data = await findLiveOpponentProfile(input.memberId);
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Opponent not found — sync ESPN data first" });
      return data;
    }),
  opponentScouting: publicProcedure
    .input(z.object({ memberId: z.string() }))
    .query(async () => {
      // Readiness check — actual generation happens via opponentScoutingReport mutation
      return { ready: true };
    }),
  opponentScoutingReport: protectedProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ input }) => {
      const { findLiveOpponentProfile } = await import("./liveOpponentProfile");
      const data = await findLiveOpponentProfile(input.memberId);
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Opponent not found — sync ESPN data first" });

      const totalW = data.career.wins;
      const totalL = data.career.losses;
      const winPct = totalW + totalL > 0 ? Math.round((totalW / (totalW + totalL)) * 100) : 0;
      const h2hW = data.h2hVsRod.wins;
      const h2hL = data.h2hVsRod.losses;
      const recentSeasons = data.seasons.slice(-3);
      const recentRecord = recentSeasons.map(s => `${s.season}: ${s.wins}-${s.losses}`).join(", ");

      const poW = (data.career as Record<string, unknown>).playoffWins as number ?? 0;
      const poL = (data.career as Record<string, unknown>).playoffLosses as number ?? 0;
      const poTotal = poW + poL;
      const poStr = poTotal > 0
        ? `Playoff Record: ${poW}W-${poL}L all-time (${Math.round(poW / poTotal * 100)}% win rate in elimination games)`
        : 'Playoff Record: No completed playoff matchup data available';

      // Build enriched H2H block
      let enrichedH2HBlock = `H2H vs Rod Sellers: ${h2hW}W-${h2hL}L (career)`;
      try {
        const { resolveRodMemberId, computeRichH2H, buildH2HPromptBlock } = await import('./h2hContextBuilder');
        const rodId = await resolveRodMemberId();
        if (rodId && input.memberId && rodId !== input.memberId) {
          const h2h = await computeRichH2H(rodId, input.memberId, 'Rod Sellers', data.ownerName);
          if (h2h.rsTotalGames > 0) {
            enrichedH2HBlock = buildH2HPromptBlock(h2h, `H2H vs Rod Sellers`);
          }
        }
      } catch { /* non-fatal */ }

      const prompt = `You are an expert fantasy football analyst scouting ${data.ownerName} for the ATLANTAS FINEST FF league (14-team PPR keeper league, 2026 season).

Career Record: ${totalW}W-${totalL}L (${winPct}% win rate) over ${data.seasons.length} seasons
${poStr}
${enrichedH2HBlock}
Recent 3 seasons: ${recentRecord}
GM Archetype: ${data.gmArchetype} — ${data.gmArchetypeDesc}
Avg Activity: ${data.avgAcquisitions} adds/season, ${data.avgTrades} trades/season
Draft Style: ${data.draftStyleBadge} — ${data.draftStyleDesc}

Strengths: ${data.strengthsWeaknesses.filter(s => s.type === "strength").map(s => s.text).join("; ")}
Weaknesses: ${data.strengthsWeaknesses.filter(s => s.type === "weakness").map(s => s.text).join("; ")}
Blind Spots: ${data.strengthsWeaknesses.filter(s => s.type === "blindspot").map(s => s.text).join("; ")}

Write a detailed scouting report for Rod Sellers to use against this opponent in 2026. Include:
1. THREAT LEVEL (Elite/High/Medium/Low) with one-sentence justification
2. CAREER NARRATIVE (2-3 sentences on their arc and what defines them)
3. HOW TO BEAT THEM (3 specific tactical recommendations for Rod)
4. TRADE STRATEGY (should Rod trade with them? What to offer? What to demand?)
5. DRAFT DAY INTEL (what positions do they prioritize? How does that affect the draft board?)
6. 2026 PREDICTION (one bold prediction about their season)

Be specific, honest, and tactical. This is a competitive scouting report, not a puff piece.`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are an expert fantasy football analyst providing competitive scouting reports. Be direct, specific, and tactical." },
          { role: "user", content: prompt },
        ],
      });

      const report = response.choices?.[0]?.message?.content ?? "Scouting report unavailable.";
      return { report, ownerName: data.ownerName };
    }),

  keeperROI: publicProcedure.query(async () => {
    // Aggregate all keeper picks across 2022-2025 with ROI analysis
    // ROI = round saved vs. what you'd have to spend in a normal draft
    // A keeper kept in round N costs round N-1 in the next draft
    // "Round surplus" = (market round - keeper cost round)
    // Market round = the round the player would realistically go in a normal draft
    // We approximate market round using: if kept in Rd X, they were worth at least Rd X-1 (the cost)
    // Better approximation: use pick value chart to compute value ratio

    const cachedSeasons = (await getAllCachedSeasons()).sort((a, b) => a - b);

    // Pick value chart (14-team PPR, same as pickValueChart endpoint)
    const TOTAL_TEAMS = 14;
    const TOTAL_ROUNDS = 15;
    const BASE_VALUE = 3000;
    const DECAY = 0.93;
    const pickValues: Record<string, number> = {};
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      for (let pick = 1; pick <= TOTAL_TEAMS; pick++) {
        const overall = (round - 1) * TOTAL_TEAMS + pick;
        const value = Math.round(BASE_VALUE * Math.pow(DECAY, overall - 1));
        pickValues[`${round}.${pick}`] = value;
        pickValues[`${round}`] = pickValues[`${round}`] ?? value; // first pick of round as round value
      }
    }
    // Round-level values (use mid-round pick, pick 7 of 14)
    const roundValue = (round: number) => {
      const overall = (round - 1) * TOTAL_TEAMS + 7;
      return Math.round(BASE_VALUE * Math.pow(DECAY, overall - 1));
    };

    // Collect all keeper picks
    type KeeperROIEntry = {
      season: number;
      teamId: number;
      teamName: string;
      playerId: number;
      playerName: string;
      position: string;
      keptRound: number;       // round they were kept AT (the draft slot used)
      costRound: number;       // round it cost to keep them (keptRound - 1, or 1 if Rd1)
      marketRound: number;     // estimated market round (keptRound - 1 = minimum value)
      roundSurplus: number;    // marketRound - costRound (positive = good value)
      keeperValue: number;     // pick chart value at keptRound
      costValue: number;       // pick chart value at costRound
      valueRatio: number;      // keeperValue / costValue
      roiLabel: string;        // ELITE / GREAT / GOOD / FAIR / POOR
      consecutiveYear: number; // 1st or 2nd year kept
    };

    const allKeepers: KeeperROIEntry[] = [];
    const playerConsecutiveTracker: Record<string, number> = {}; // `${teamId}-${playerId}` -> years kept

    for (const season of cachedSeasons) {
      const data = await getSeasonData(season);
      if (!data) continue;
      const picks = normalizeDraftPicks(data);

      for (const pick of picks) {
        const p = pick as Record<string, unknown>;
        if (!p.keeper) continue;

        const teamId = p.teamId as number;
        const playerId = p.playerId as number;
        const playerName = (p.playerName as string) || `Player#${playerId}`;
        const position = (p.position as string) || "?";
        const keptRound = p.roundId as number;
        const teamName = (p.teamName as string) || `Team ${teamId}`;

        // Cost round = keptRound - 1 (minimum 1)
        const costRound = Math.max(1, keptRound - 1);
        // Market round approximation: we treat the kept round as their minimum market value
        // If kept in Rd 5, they're worth at LEAST a Rd 4 pick (what you paid)
        // For ROI we compare: value at keptRound vs value at costRound
        const marketRound = keptRound; // conservative: worth the round they were kept at
        const roundSurplus = marketRound - costRound; // always 1 unless Rd1 keeper (0)

        const keeperVal = roundValue(keptRound);
        const costVal = roundValue(costRound);
        const valueRatio = costRound === keptRound ? 1 : keeperVal / costVal;

        // Consecutive year tracking
        const key = `${teamId}-${playerId}`;
        playerConsecutiveTracker[key] = (playerConsecutiveTracker[key] || 0) + 1;
        const consecutiveYear = playerConsecutiveTracker[key];

        // ROI label based on round and position
        let roiLabel: string;
        if (keptRound === 1) roiLabel = "ELITE";
        else if (keptRound <= 3) roiLabel = "GREAT";
        else if (keptRound <= 6) roiLabel = "GOOD";
        else if (keptRound <= 9) roiLabel = "FAIR";
        else roiLabel = "POOR";

        allKeepers.push({
          season,
          teamId,
          teamName,
          playerId,
          playerName,
          position,
          keptRound,
          costRound,
          marketRound,
          roundSurplus,
          keeperValue: keeperVal,
          costValue: costVal,
          valueRatio: Math.round(valueRatio * 100) / 100,
          roiLabel,
          consecutiveYear,
        });
      }
    }

    // Sort by season desc, then by keptRound asc
    allKeepers.sort((a, b) => b.season - a.season || a.keptRound - b.keptRound);

    // Per-team summary
    const teamSummaries = Object.values(
      allKeepers.reduce((acc, k) => {
        if (!acc[k.teamId]) {
          acc[k.teamId] = {
            teamId: k.teamId,
            teamName: k.teamName,
            totalKeepers: 0,
            eliteKeepers: 0,
            greatKeepers: 0,
            goodKeepers: 0,
            fairPoorKeepers: 0,
            avgKeptRound: 0,
            roundsSum: 0,
          };
        }
        const t = acc[k.teamId];
        t.totalKeepers++;
        t.roundsSum += k.keptRound;
        if (k.roiLabel === "ELITE") t.eliteKeepers++;
        else if (k.roiLabel === "GREAT") t.greatKeepers++;
        else if (k.roiLabel === "GOOD") t.goodKeepers++;
        else t.fairPoorKeepers++;
        return acc;
      }, {} as Record<number, { teamId: number; teamName: string; totalKeepers: number; eliteKeepers: number; greatKeepers: number; goodKeepers: number; fairPoorKeepers: number; avgKeptRound: number; roundsSum: number }>)
    ).map(t => ({
      ...t,
      avgKeptRound: Math.round((t.roundsSum / t.totalKeepers) * 10) / 10,
    })).sort((a, b) => b.totalKeepers - a.totalKeepers);

    // League-wide stats
    const totalKeepers = allKeepers.length;
    const eliteCount = allKeepers.filter(k => k.roiLabel === "ELITE").length;
    const greatCount = allKeepers.filter(k => k.roiLabel === "GREAT").length;
    const goodCount = allKeepers.filter(k => k.roiLabel === "GOOD").length;
    const fairPoorCount = allKeepers.filter(k => k.roiLabel === "FAIR" || k.roiLabel === "POOR").length;

    // Best value keepers (Rd1 kept players, or Rd2 players kept in Rd1)
    const bestValueKeepers = allKeepers
      .filter(k => k.keptRound <= 3)
      .slice(0, 10);

    // Worst value keepers (kept in late rounds, Rd 8+)
    const worstValueKeepers = allKeepers
      .filter(k => k.keptRound >= 8)
      .slice(0, 10);

    return {
      allKeepers,
      teamSummaries,
      leagueStats: { totalKeepers, eliteCount, greatCount, goodCount, fairPoorCount },
      bestValueKeepers,
      worstValueKeepers,
      seasons: cachedSeasons,
    };
  }),

  tradeOfferGenerator: subscribedProcedure
    .input(z.object({
      targetInput: z.string().min(1).max(100), // player name or pick like "2.03"
      targetType: z.enum(["player", "pick"]),
      targetOwnerId: z.string().optional(), // memberId of owner if known
    }))
    .mutation(async ({ input }) => {
      // ── 1. Load latest season data (2025) ──────────────────────────────────
      const seasonData = await getSeasonData(2025) as any;
      if (!seasonData) throw new TRPCError({ code: "NOT_FOUND", message: "Season data not available" });

      const teams: any[] = seasonData.teams || [];
      const members: any[] = seasonData.members || [];

      // Build memberId → name map
      const memberNames: Record<string, string> = {};
      for (const m of members) {
        memberNames[m.id] = `${m.firstName} ${m.lastName}`.trim();
      }

      // Build teamId → {owner, memberId, teamName, roster} map
      interface TeamInfo {
        teamId: number;
        teamName: string;
        ownerName: string;
        memberId: string;
        roster: any[];
        record: { wins: number; losses: number };
        pf: number;
      }
      const teamMap: Record<number, TeamInfo> = {};
      for (const t of teams) {
        const memberId = t.primaryOwner || (t.owners?.[0] ?? "");
        teamMap[t.id] = {
          teamId: t.id,
          teamName: t.name || `Team ${t.id}`,
          ownerName: memberNames[memberId] || `Owner ${t.id}`,
          memberId,
          roster: t.roster?.entries || [],
          record: { wins: t.record?.overall?.wins ?? 0, losses: t.record?.overall?.losses ?? 0 },
          pf: t.points ?? 0,
        };
      }

      // ── 2. League scoring settings (from leagueScoringService) ──────────────
      const leagueScoringSettings = await getLeagueScoringSettings().catch(() => null);
      const scoringMap: Record<number, number> = leagueScoringSettings?.scoringMap ?? {};
      const scoringDesc = leagueScoringSettings?.scoringDescription ?? `Half PPR (0.5/rec), 6pts/TD, 4pts/pass TD, 1pt/25 pass yds, 1pt/10 rush yds, 1pt/10 rec yds`;

      // ── 3. Build player roster index ──────────────────────────────────────
      interface PlayerInfo {
        playerId: number;
        fullName: string;
        position: string;
        teamId: number;
        ownerName: string;
        memberId: string;
        seasonPoints: number;
        avgPoints: number;
        keeperValue: number;
        keeperValueFuture: number;
        stats: Record<string, number>;
        injuryStatus: string;
      }
      const posMap: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
      const allPlayers: PlayerInfo[] = [];

      for (const t of teams) {
        const entries: any[] = t.roster?.entries || [];
        for (const entry of entries) {
          const ppe = entry.playerPoolEntry;
          if (!ppe) continue;
          const p = ppe.player;
          if (!p) continue;
          // Get season stats (statSplitTypeId=0, scoringPeriodId=0 = full season)
          const seasonStat = (p.stats || []).find((s: any) => s.scoringPeriodId === 0 && s.statSplitTypeId === 0);
          const seasonPoints = seasonStat?.appliedTotal ?? ppe.appliedStatTotal ?? 0;
          const avgPoints = seasonStat?.appliedAverage ?? (seasonPoints / 17);
          allPlayers.push({
            playerId: p.id,
            fullName: p.fullName || `Player#${p.id}`,
            position: posMap[p.defaultPositionId] || "FLEX",
            teamId: t.id,
            ownerName: teamMap[t.id]?.ownerName || "Unknown",
            memberId: teamMap[t.id]?.memberId || "",
            seasonPoints: Math.round(seasonPoints * 10) / 10,
            avgPoints: Math.round(avgPoints * 10) / 10,
            keeperValue: ppe.keeperValue ?? 0,
            keeperValueFuture: ppe.keeperValueFuture ?? 0,
            stats: seasonStat?.appliedStats || {},
            injuryStatus: entry.injuryStatus || p.injuryStatus || "ACTIVE",
          });
        }
      }

      // ── 4. Resolve target ─────────────────────────────────────────────────
      let targetPlayer: PlayerInfo | null = null;
      let targetPickLabel = "";
      let targetPickValue = 0;
      let targetPickOwnerName = "Unknown";

      // Canonical pick value formula: 14-team PPR snake draft, exponential decay
      // Matches the pickValueChart / pickTradeEval endpoints exactly
      function pickValueCanonical(round: number, pickInRound: number): number {
        const TEAMS = 14;
        const BASE = 3000;
        const K = 0.028;
        const overall = (round - 1) * TEAMS + (round % 2 === 1 ? pickInRound : TEAMS + 1 - pickInRound);
        return Math.round(BASE * Math.exp(-K * (overall - 1)));
      }

      if (input.targetType === "pick") {
        // Parse "2.03" or "round 2 pick 3" style
        const m = input.targetInput.match(/(\d+)[.\s-](\d+)/);
        if (m) {
          const round = parseInt(m[1]);
          const pick = parseInt(m[2]);
          targetPickValue = pickValueCanonical(round, pick);
          targetPickLabel = `Round ${round}.${String(pick).padStart(2, '0')} (2026 Draft)`;

          // ── Resolve pick owner from 2026 ESPN draft order ──────────────────
          // Step 1: Get the 2026 draft order from ESPN (uses 2025 season data which has 2026 draft settings)
          const draftOrderData = normalizeDraftOrder(seasonData as Record<string, unknown>);
          const pickOrder = draftOrderData.pickOrder || [];
          // Snake draft: odd rounds go 1→14, even rounds go 14→1
          // The team at position `pick` in round `round` is the original owner
          let originalOwnerTeamId: number | null = null;
          let originalOwnerName = "Unknown";
          if (pickOrder.length >= pick) {
            // For snake draft: odd round = ascending order, even round = descending order
            const slotIndex = round % 2 === 1 ? pick - 1 : pickOrder.length - pick;
            const slot = pickOrder[slotIndex];
            if (slot) {
              originalOwnerTeamId = slot.teamId;
              // Use the owners field (actual owner name) from the draft order
              originalOwnerName = slot.owners || slot.name || `Team ${slot.teamId}`;
            }
          }

          // Step 2: Check pick_trades to see if this pick has been traded
          const pickTrades2026 = await getPickTrades(2026);
          const acquiredPick = pickTrades2026.find(
            t => t.type === "acquired" && t.round === round && t.pickInRound === pick
          );
          const tradedAwayPick = pickTrades2026.find(
            t => t.type === "traded_away" && t.round === round && t.pickInRound === pick
          );

          if (acquiredPick) {
            // Rod acquired this pick — original owner is the counterparty who traded it to Rod
            // The pick is now owned by Rod, but the target of the trade offer is whoever Rod wants to trade it to
            // In this context, we're acquiring a pick, so the owner is whoever currently holds it
            targetPickOwnerName = acquiredPick.counterparty;
          } else if (tradedAwayPick) {
            // Rod traded this pick away — it now belongs to the counterparty
            targetPickOwnerName = tradedAwayPick.counterparty;
          } else {
            // No trade recorded — original owner from draft order
            targetPickOwnerName = originalOwnerName;
          }

          // Step 3: Resolve targetMemberId from owner name via teamMap
          if (!input.targetOwnerId) {
            const cleanTarget = targetPickOwnerName.toLowerCase().replace(/[^a-z0-9 ]/g, "");
            for (const [, info] of Object.entries(teamMap)) {
              const cleanOwner = info.ownerName.toLowerCase().replace(/[^a-z0-9 ]/g, "");
              const targetFirst = cleanTarget.split(" ")[0];
              const ownerFirst = cleanOwner.split(" ")[0];
              if (cleanOwner.includes(targetFirst) || cleanTarget.includes(ownerFirst) || targetFirst === ownerFirst) {
                // Set targetOwnerId via a local variable for later use
                (input as any).targetOwnerId = info.memberId;
                break;
              }
            }
          }
        } else {
          targetPickLabel = input.targetInput;
          targetPickValue = 1500; // default mid-value
          targetPickOwnerName = "Unknown";
        }
      } else {
        // targetType === "player" — not supported in pre-draft picks-only mode
        throw new TRPCError({ code: "BAD_REQUEST", message: "The Trade Offer Generator is currently in picks-only mode (pre-draft 2026). Please select a draft pick as the target." });
      }
      // Type assertion: reset targetPlayer type after the if/else block
      // (TypeScript narrows to 'never' because the else branch always throws)
      const resolvedTargetPlayer = targetPlayer as PlayerInfo | null;

      // ── 5. Determine target owner ─────────────────────────────────────────
      const targetOwnerName = resolvedTargetPlayer?.ownerName || targetPickOwnerName;
      // Resolve memberId from owner name when not directly available.
      // Pick trades store counterparty as a display name, not a memberId.
      let targetMemberId = resolvedTargetPlayer?.memberId || input.targetOwnerId || "";
      if (!targetMemberId && targetOwnerName && targetOwnerName !== "Unknown") {
        try {
          const { buildLiveOpponentProfiles } = await import("./liveOpponentProfile");
          const profiles = await buildLiveOpponentProfiles();
          const cleanTarget = targetOwnerName.toLowerCase().replace(/[^a-z0-9 ]/g, "");
          for (const [mid, prof] of Array.from(profiles.entries())) {
            const cleanProf = prof.ownerName.toLowerCase().replace(/[^a-z0-9 ]/g, "");
            // Match on first token of either name (handles "Rod Sellers" vs "Rod")
            const targetFirst = cleanTarget.split(" ")[0];
            const profFirst = cleanProf.split(" ")[0];
            if (cleanProf.includes(targetFirst) || cleanTarget.includes(profFirst)) {
              targetMemberId = mid;
              break;
            }
          }
        } catch { /* continue without memberId */ }
      }

      // ── 6. Estimate target value ──────────────────────────────────────────
      let targetValue = 0;
      let targetValueBasis = "";
      if (resolvedTargetPlayer) {
        // Value = season points * position multiplier + keeper bonus
        const posMultiplier: Record<string, number> = { QB: 1.0, RB: 1.3, WR: 1.2, TE: 1.1, K: 0.4, FLEX: 1.0 };
        const mult = posMultiplier[resolvedTargetPlayer.position] || 1.0;
        const baseValue = resolvedTargetPlayer.seasonPoints * mult;
        const keeperBonus = resolvedTargetPlayer.keeperValueFuture > 0 ? (15 - resolvedTargetPlayer.keeperValueFuture) * 80 : 0;
        targetValue = Math.round(baseValue + keeperBonus);
        targetValueBasis = `${resolvedTargetPlayer.seasonPoints} fantasy pts (2025), ${resolvedTargetPlayer.position} position multiplier ${mult}x, keeper round ${resolvedTargetPlayer.keeperValueFuture > 0 ? resolvedTargetPlayer.keeperValueFuture : "N/A"}`;
      } else {
        targetValue = targetPickValue;
        targetValueBasis = `Pick chart value for ${targetPickLabel}`;
      }

      // ── 7. Build Rod's available picks for offer ─────────────────────────
      // Pre-draft mode: offers are PICKS ONLY — no players.
      // Rod's available picks = his original draft positions (from 2026 draft order)
      //   MINUS any he has traded away
      //   PLUS any he has acquired from others.
      // Fetch live 2026 draft order from ESPN (not 2025 cache — different pick order)
      let pickOrderForOffers: { position: number; teamId: number; name?: string; abbrev?: string; owners?: string }[] = [];
      let live2026TeamMap: Record<number, { owner: string; teamId: number }> = {};
      try {
        const live2026 = await fetchEspnViews(2026, ["mDraftDetail", "mSettings", "mTeam"]) as any;
        const draftOrder2026 = normalizeDraftOrder(live2026);
        pickOrderForOffers = draftOrder2026.pickOrder || [];
        // Build teamId → owner name from live 2026 data
        const live2026Members: Record<string, string> = {};
        for (const m of (live2026.members || [])) {
          live2026Members[m.id] = `${m.firstName || ""} ${m.lastName || ""}`.trim();
        }
        for (const t of (live2026.teams || [])) {
          const ownerId = t.primaryOwner || (t.owners?.[0] ?? "");
          live2026TeamMap[t.id] = {
            owner: live2026Members[ownerId] || `Owner ${t.id}`,
            teamId: t.id,
          };
        }
      } catch {
        // Fallback: use 2025 data if 2026 fetch fails
        const draftOrderFallback = normalizeDraftOrder(seasonData as Record<string, unknown>);
        pickOrderForOffers = draftOrderFallback.pickOrder || [];
      }
      const TOTAL_ROUNDS = 14;
      const TEAMS_COUNT = 14;
      // Find Rod's team — prefer live 2026 team map, fall back to 2025 teamMap
      const rodTeamId: number = (() => {
        // First try live 2026 data
        for (const [tid, info] of Object.entries(live2026TeamMap)) {
          if (info.owner.toLowerCase().includes("rod")) return Number(tid);
        }
        // Fall back to 2025 teamMap
        const rodTeam2025 = Object.values(teamMap).find(t =>
          t.ownerName.toLowerCase().includes("rod") || t.teamId === 11
        );
        return rodTeam2025?.teamId ?? 11;
      })();
      // Collect all pick_trades for 2026
      const allPickTrades2026 = await getPickTrades(2026);
      const tradedAwayByRod = allPickTrades2026.filter(t => t.type === "traded_away");
      const acquiredByRod = allPickTrades2026.filter(t => t.type === "acquired");
      // Build Rod's original picks from the draft order
      interface PickAsset {
        label: string;
        round: number;
        pickInRound: number;
        value: number;
        source: "original" | "acquired";
        acquiredFrom?: string;
      }
      const rodOriginalPicks: PickAsset[] = [];
      for (let r = 1; r <= TOTAL_ROUNDS; r++) {
        for (let p = 1; p <= TEAMS_COUNT; p++) {
          const slotIndex = r % 2 === 1 ? p - 1 : TEAMS_COUNT - p;
          const slot = pickOrderForOffers[slotIndex];
          if (slot && slot.teamId === rodTeamId) {
            // Check if Rod has traded this pick away
            const tradedAway = tradedAwayByRod.find(t => t.round === r && t.pickInRound === p);
            if (!tradedAway) {
              rodOriginalPicks.push({
                label: `Round ${r}.${String(p).padStart(2, "0")}`,
                round: r,
                pickInRound: p,
                value: pickValueCanonical(r, p),
                source: "original",
              });
            }
          }
        }
      }
      // Add acquired picks
      const rodAcquiredPicks: PickAsset[] = acquiredByRod.map(t => ({
        label: t.label || `Round ${t.round}.${String(t.pickInRound).padStart(2, "0")}`,
        round: t.round,
        pickInRound: t.pickInRound,
        value: t.pickValue,
        source: "acquired" as const,
        acquiredFrom: t.counterparty,
      }));
      // ── Hardcoded fallback: if pickOrderForOffers was empty (ESPN fetch failed),
      // inject Rod's known 2026 picks based on his draft position (11th in 14-team snake).
      // This ensures the offer builder always has picks to work with.
      if (rodOriginalPicks.length === 0 && rodAcquiredPicks.length === 0) {
        const ROD_DRAFT_POSITION = 11; // Rod's 2026 draft position
        for (let r = 1; r <= TOTAL_ROUNDS; r++) {
          // In a 14-team snake: odd rounds pick at position P, even rounds pick at (15-P)
          const pickInRound = r % 2 === 1 ? ROD_DRAFT_POSITION : TEAMS_COUNT + 1 - ROD_DRAFT_POSITION;
          rodOriginalPicks.push({
            label: `Round ${r}.${String(pickInRound).padStart(2, "0")}`,
            round: r,
            pickInRound,
            value: pickValueCanonical(r, pickInRound),
            source: "original" as const,
          });
        }
      }
      const rodAllPicks = [...rodOriginalPicks, ...rodAcquiredPicks]
        .sort((a, b) => b.value - a.value); // highest value first

      // ── Build target owner's available picks from 2026 draft order ──────────
      // We need these so every offer is balanced: Rod gives N picks, Rod receives N picks.
      // The target pick is always the "anchor" of what Rod receives.
      // For multi-pick offers we add more of the target owner's picks to balance.
      interface OfferSide { picks: string[]; pickAssets: PickAsset[]; totalValue: number; }
      interface BalancedOffer { rodGives: OfferSide; rodReceives: OfferSide; valueRatioPct: number; }

      // Collect target owner's picks from the 2026 draft order
      const targetOwnerPicks: PickAsset[] = [];
      // Resolve target owner's teamId — prefer live 2026 team map, fall back to 2025 teamMap
      let targetTeamId: number | null = null;
      const cleanTarget = targetOwnerName.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      const targetFirst = cleanTarget.split(" ")[0];
      // Try live 2026 data first
      for (const [tid, info] of Object.entries(live2026TeamMap)) {
        const cleanOwner = info.owner.toLowerCase().replace(/[^a-z0-9 ]/g, "");
        const ownerFirst = cleanOwner.split(" ")[0];
        if (cleanOwner.includes(targetFirst) || cleanTarget.includes(ownerFirst) || targetFirst === ownerFirst) {
          targetTeamId = Number(tid);
          break;
        }
      }
      // Fall back to 2025 teamMap if not found
      if (targetTeamId === null) {
      for (const [, info] of Object.entries(teamMap)) {
        const cleanOwner = info.ownerName.toLowerCase().replace(/[^a-z0-9 ]/g, "");
        const ownerFirst = cleanOwner.split(" ")[0];
        if (cleanOwner.includes(targetFirst) || cleanTarget.includes(ownerFirst) || targetFirst === ownerFirst) {
          targetTeamId = info.teamId;
          break;
        }
      }
      if (targetTeamId !== null) {
        for (let r = 1; r <= TOTAL_ROUNDS; r++) {
          for (let p = 1; p <= TEAMS_COUNT; p++) {
            const slotIndex = r % 2 === 1 ? p - 1 : TEAMS_COUNT - p;
            const slot = pickOrderForOffers[slotIndex];
            if (slot && slot.teamId === targetTeamId) {
              // Skip the target pick itself (already the anchor of what Rod receives)
              const lbl = `Round ${r}.${String(p).padStart(2, "0")}`;
              if (lbl === targetPickLabel.replace(/ \(2026 Draft\)/, "")) continue;
              // Skip any pick the target owner has traded away
              const tradedByTarget = allPickTrades2026.find(
                t => t.type === "traded_away" && t.round === r && t.pickInRound === p
                  && t.counterparty && targetOwnerName.toLowerCase().includes(t.counterparty.toLowerCase().split(" ")[0])
              );
              if (!tradedByTarget) {
                targetOwnerPicks.push({
                  label: lbl,
                  round: r,
                  pickInRound: p,
                  value: pickValueCanonical(r, p),
                  source: "original",
                });
              }
            }
          }
        }
      }
      } // end if (targetTeamId === null) fallback

      // ── Hardcoded fallback for targetOwnerPicks when pickOrderForOffers was empty ──
      // If we couldn't resolve the target owner's picks from the draft order,
      // generate a generic set of picks at a mid-range draft position (pick 7 of 14).
      // This ensures the 2-for-2 and 3-for-3 offer builders always have bonus picks to pair.
      if (targetOwnerPicks.length === 0) {
        const FALLBACK_POSITION = 7; // mid-table position for generic target owner
        for (let r = 1; r <= TOTAL_ROUNDS; r++) {
          const pickInRound = r % 2 === 1 ? FALLBACK_POSITION : TEAMS_COUNT + 1 - FALLBACK_POSITION;
          const lbl = `Round ${r}.${String(pickInRound).padStart(2, "0")}`;
          // Skip the target pick itself
          if (lbl === targetPickLabel.replace(/ \(2026 Draft\)/, "")) continue;
          targetOwnerPicks.push({
            label: lbl,
            round: r,
            pickInRound,
            value: pickValueCanonical(r, pickInRound),
            source: "original",
          });
        }
      }

      // Sort target owner picks by value descending
      targetOwnerPicks.sort((a, b) => b.value - a.value);

      // ── Anchor: what Rod receives always starts with the target pick ─────────
      const targetPickAsset: PickAsset = {
        label: targetPickLabel,
        round: parseInt(targetPickLabel.match(/(\d+)\.(\d+)/)?.[1] ?? "1"),
        pickInRound: parseInt(targetPickLabel.match(/(\d+)\.(\d+)/)?.[2] ?? "1"),
        value: targetValue,
        source: "original",
      };

      // Helper: find best N-pick combo from a list whose total is closest to a target sum
      function bestNPickCombo(pool: PickAsset[], n: number, targetSum: number): PickAsset[] | null {
        if (pool.length < n) return null;
        let best: PickAsset[] | null = null;
        let bestDiff = Infinity;
        function recurse(start: number, chosen: PickAsset[], sum: number) {
          if (chosen.length === n) {
            const diff = Math.abs(sum - targetSum);
            if (diff < bestDiff) { bestDiff = diff; best = [...chosen]; }
            return;
          }
          const remaining = n - chosen.length;
          for (let i = start; i <= pool.length - remaining; i++) {
            recurse(i + 1, [...chosen, pool[i]], sum + pool[i].value);
          }
        }
        recurse(0, [], 0);
        return best;
      }

      // ── Build balanced offer options ─────────────────────────────────────────
      // Each option: Rod gives K picks, Rod receives K picks (target pick + K-1 more from target owner)
      const balancedOffers: BalancedOffer[] = [];

      // Option 1: 1-for-1 — Rod gives 1 pick, receives target pick only
      // Find Rod's single pick whose value is closest to targetValue (within ±40%)
      const rod1Candidates = rodAllPicks.filter(pk => pk.label !== targetPickLabel);
      const rod1Best = bestNPickCombo(rod1Candidates, 1, targetValue);
      if (rod1Best) {
        const rodGivesVal = rod1Best[0].value;
        balancedOffers.push({
          rodGives: { picks: rod1Best.map(p => p.label), pickAssets: rod1Best, totalValue: rodGivesVal },
          rodReceives: { picks: [targetPickAsset.label], pickAssets: [targetPickAsset], totalValue: targetValue },
          valueRatioPct: targetValue > 0 ? Math.round((rodGivesVal / targetValue) * 100) : 100,
        });
      }

      // Option 2: 2-for-2 — Rod gives 2 picks, receives target pick + 1 more from target owner
      // Find the best extra pick from target owner to add alongside the target pick
      // Then find 2 Rod picks whose combined value ≈ combined receive value
      if (targetOwnerPicks.length >= 1) {
        // Try each of target owner's picks as the "bonus" receive pick
        let bestOpt2: BalancedOffer | null = null;
        let bestOpt2Diff = Infinity;
        for (const bonusPick of targetOwnerPicks.slice(0, 6)) { // try top 6 bonus picks
          const receiveTotal = targetValue + bonusPick.value;
          const rod2Candidates = rodAllPicks.filter(pk => pk.label !== targetPickLabel);
          const rod2Best = bestNPickCombo(rod2Candidates, 2, receiveTotal);
          if (rod2Best) {
            const rodGivesVal = rod2Best[0].value + rod2Best[1].value;
            const diff = Math.abs(rodGivesVal - receiveTotal);
            if (diff < bestOpt2Diff) {
              bestOpt2Diff = diff;
              bestOpt2 = {
                rodGives: { picks: rod2Best.map(p => p.label), pickAssets: rod2Best, totalValue: rodGivesVal },
                rodReceives: { picks: [targetPickAsset.label, bonusPick.label], pickAssets: [targetPickAsset, bonusPick], totalValue: receiveTotal },
                valueRatioPct: receiveTotal > 0 ? Math.round((rodGivesVal / receiveTotal) * 100) : 100,
              };
            }
          }
        }
        if (bestOpt2) balancedOffers.push(bestOpt2);
      }

      // Option 3: 3-for-3 — Rod gives 3 picks, receives target pick + 2 more from target owner
      if (targetOwnerPicks.length >= 2 && rodAllPicks.length >= 3) {
        let bestOpt3: BalancedOffer | null = null;
        let bestOpt3Diff = Infinity;
        // Try combinations of 2 bonus picks from target owner
        for (let i = 0; i < Math.min(targetOwnerPicks.length, 5); i++) {
          for (let j = i + 1; j < Math.min(targetOwnerPicks.length, 6); j++) {
            const b1 = targetOwnerPicks[i];
            const b2 = targetOwnerPicks[j];
            const receiveTotal = targetValue + b1.value + b2.value;
            const rod3Candidates = rodAllPicks.filter(pk => pk.label !== targetPickLabel);
            const rod3Best = bestNPickCombo(rod3Candidates, 3, receiveTotal);
            if (rod3Best) {
              const rodGivesVal = rod3Best.reduce((s, p) => s + p.value, 0);
              const diff = Math.abs(rodGivesVal - receiveTotal);
              if (diff < bestOpt3Diff) {
                bestOpt3Diff = diff;
                bestOpt3 = {
                  rodGives: { picks: rod3Best.map(p => p.label), pickAssets: rod3Best, totalValue: rodGivesVal },
                  rodReceives: { picks: [targetPickAsset.label, b1.label, b2.label], pickAssets: [targetPickAsset, b1, b2], totalValue: receiveTotal },
                  valueRatioPct: receiveTotal > 0 ? Math.round((rodGivesVal / receiveTotal) * 100) : 100,
                };
              }
            }
          }
        }
        if (bestOpt3) balancedOffers.push(bestOpt3);
      }

      // ── Parity guard: discard any offer where give-count ≠ receive-count ──────
      // Roster spots are fixed — every trade must exchange an equal number of picks.
      const parityChecked = balancedOffers.filter(bo => {
        const giveCount = bo.rodGives.picks.length;
        const receiveCount = bo.rodReceives.picks.length;
        return giveCount === receiveCount && giveCount > 0;
      });
      balancedOffers.length = 0;
      parityChecked.forEach(o => balancedOffers.push(o));

      // ── Deduplication guard: discard offers where the same pick appears on both sides ──
      const deduped = balancedOffers.filter(bo => {
        const givesSet = new Set(bo.rodGives.picks);
        return !bo.rodReceives.picks.some(p => givesSet.has(p));
      });
      balancedOffers.length = 0;
      deduped.forEach(o => balancedOffers.push(o));

      // ── Filter: remove 1-for-1 options below 85% value match (underpay) ──────
      // If a 1-for-1 is underpay, the multi-pick options are better leads
      let noFair1for1 = false;
      const filteredOffers = balancedOffers.filter((bo, idx) => {
        // Only filter the 1-for-1 (first option, rodGives has 1 pick, rodReceives has 1 pick)
        if (idx === 0 && bo.rodGives.picks.length === 1 && bo.rodReceives.picks.length === 1) {
          if ((bo.valueRatioPct ?? 0) < 85) {
            noFair1for1 = true; // flag: 1-for-1 was filtered out as underpay
            return false;
          }
        }
        return true;
      });
      // Sort by closeness to 100% value match (fairest offer first)
      filteredOffers.sort((a, b) => {
        const aDiff = Math.abs((a.valueRatioPct ?? 0) - 100);
        const bDiff = Math.abs((b.valueRatioPct ?? 0) - 100);
        return aDiff - bDiff;
      });
      // Replace balancedOffers with filtered+sorted version
      balancedOffers.length = 0;
      filteredOffers.forEach(o => balancedOffers.push(o));

      // Fallback: if no balanced offers found after all filters, build a best-effort 2-for-2
      // using Rod's top 2 picks vs target pick + target owner's best remaining pick.
      // This guarantees at least one equal-count offer is always shown.
      if (balancedOffers.length === 0) {
        const rodTop2 = rodAllPicks.filter(pk => pk.label !== targetPickLabel).slice(0, 2);
        const targetBonus = targetOwnerPicks.find(pk => pk.label !== targetPickLabel);
        if (rodTop2.length === 2 && targetBonus) {
          const rodGivesVal = rodTop2.reduce((s, p) => s + p.value, 0);
          const receiveTotal = targetValue + targetBonus.value;
          balancedOffers.push({
            rodGives: { picks: rodTop2.map(p => p.label), pickAssets: rodTop2, totalValue: rodGivesVal },
            rodReceives: { picks: [targetPickAsset.label, targetBonus.label], pickAssets: [targetPickAsset, targetBonus], totalValue: receiveTotal },
            valueRatioPct: receiveTotal > 0 ? Math.round((rodGivesVal / receiveTotal) * 100) : 0,
          });
          noFair1for1 = true; // no 1-for-1 was viable
        } else if (rodTop2.length >= 1) {
          // Last resort: 1-for-1 with Rod's best pick, even if underpay
          const rodGivesVal = rodTop2[0].value;
          balancedOffers.push({
            rodGives: { picks: [rodTop2[0].label], pickAssets: [rodTop2[0]], totalValue: rodGivesVal },
            rodReceives: { picks: [targetPickAsset.label], pickAssets: [targetPickAsset], totalValue: targetValue },
            valueRatioPct: targetValue > 0 ? Math.round((rodGivesVal / targetValue) * 100) : 0,
          });
          noFair1for1 = true;
        }
      }

      // ── Compute pick tradability scores for target owner's picks ──────────
      // Score each of the target owner's picks based on their DNA behavior.
      // High tradability = owner has high trade frequency, trades more when losing,
      // and historically gives away picks in this round range.
      function calcPickTradability(pick: PickAsset, dna: import("./leagueDNA").ManagerDNA | null): {
        score: number; // 0-100
        label: "HOT" | "WARM" | "NEUTRAL" | "COLD";
        reason: string;
      } {
        if (!dna) return { score: 50, label: "NEUTRAL", reason: "No behavioral data" };
        let score = 50;
        const reasons: string[] = [];
        // Trade frequency: high traders are more likely to move any pick
        const tradeFreqBonus = Math.round((dna.trade.tradeFrequency - 50) * 0.4);
        score += tradeFreqBonus;
        if (dna.trade.tradeFrequency >= 70) reasons.push(`Active trader (${dna.trade.avgTradesPerSeason.toFixed(1)} trades/season)`);
        // Loss-trade ratio: if they trade more when losing, and they are currently losing, boost
        if (dna.trade.lossTradeRatio > 1.3) {
          score += 10;
          reasons.push(`Trades ${dna.trade.lossTradeRatio.toFixed(1)}x more when losing`);
        }
        // Desperation triggers: if they have a history of panic trades, boost
        if (dna.trade.desperation_triggers >= 2) {
          score += 8;
          reasons.push(`${dna.trade.desperation_triggers} desperation trade seasons`);
        }
        // Round preference: late-round picks (6+) are easier to trade away
        if (pick.round >= 6) {
          score += 12;
          reasons.push(`Late-round pick (Rd ${pick.round}) — historically easier to move`);
        } else if (pick.round >= 3) {
          score += 5;
          reasons.push(`Mid-round pick (Rd ${pick.round})`);
        } else {
          score -= 10;
          reasons.push(`Premium pick (Rd ${pick.round}) — owners rarely trade these`);
        }
        // Exploitability: highly exploitable owners are more likely to accept any deal
        if (dna.exploitabilityScore >= 70) {
          score += 8;
          reasons.push(`Highly exploitable (score: ${dna.exploitabilityScore}/100)`);
        }
        // Tilt: tilting owners are more desperate
        if (dna.tilt.tiltScore >= 60) {
          score += 8;
          reasons.push(`Currently tilting (${dna.tilt.tiltLabel})`);
        }
        score = Math.max(0, Math.min(100, score));
        const label: "HOT" | "WARM" | "NEUTRAL" | "COLD" =
          score >= 75 ? "HOT" :
          score >= 55 ? "WARM" :
          score >= 35 ? "NEUTRAL" : "COLD";
        return { score, label, reason: reasons.slice(0, 2).join(" · ") || "Average tradability" };
      }
      // Map to legacy offerOptions shape for downstream LLM + UI compatibility
      const offerOptions = balancedOffers.map(bo => ({
        players: [] as never[],
        picks: bo.rodGives.picks,           // what Rod gives (shown as "offer")
        pickAssets: bo.rodGives.pickAssets,
        totalValue: bo.rodGives.totalValue,
        // Extended balanced fields
        rodGives: bo.rodGives,
        rodReceives: bo.rodReceives,
        valueRatioPct: bo.valueRatioPct,
      }));

      // ── 8. Pull GM style context for target owner ─────────────────────────
      const { getGmStyleForTradeGenerator } = await import("./liveOpponentProfile");
      const gmStyle = await getGmStyleForTradeGenerator(targetMemberId);
      // ── 8b. Pull Phase 3 DNA profile for target owner ────────────────────
      let dnaProfile: import("./leagueDNA").ManagerDNA | null = null;
      let dnaPromptBlock = "";
      try {
        const { calcLeagueDNA } = await import("./leagueDNA");
        const { buildManagerRawData } = await import("./dnaRouter");
        const allManagers = await buildManagerRawData();
        const dnaProfiles = calcLeagueDNA(allManagers);
        const found = dnaProfiles.find(p => p.memberId === targetMemberId);
        if (found) {
          dnaProfile = found;
             const bias = (Object.entries(found.draft.biasVsLeague) as Array<[string, number]>)
            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
            .slice(0, 3)
            .map(([pos, rounds]) => `${pos} (${rounds > 0 ? "+" : ""}${rounds.toFixed(1)} rounds vs avg)`)
            .join(", ");
          dnaPromptBlock = `\n\nLEAGUE DNA INTELLIGENCE FOR ${found.ownerName.toUpperCase()} (derived from ${found.seasonsAnalyzed} seasons of actual behavior):
  GM Archetype: ${found.gmArchetype}
  Exploitability Score: ${found.exploitabilityScore}/100 — ${found.exploitabilityLabel}
  Tilt Risk: ${found.tilt.tiltLabel} (tilt score: ${found.tilt.tiltScore}/100)
  Trade Frequency: ${found.trade.avgTradesPerSeason.toFixed(1)}/season | Loss-trade ratio: ${found.trade.lossTradeRatio.toFixed(2)}x
  Draft Biases (overvalues/undervalues vs league avg): ${bias}
  Top Exploit: ${found.exploitWindows[0] ?? "No specific exploit identified"}
  H2H vs Rod: ${found.trade.h2hVsRod.wins}W-${found.trade.h2hVsRod.losses}L (Rod wins ${found.trade.h2hVsRod.winPct.toFixed(0)}% of matchups)
  INSTRUCTION: Use these behavioral facts to customize the negotiation strategy, offer framing, and closing message. If they overvalue a position, offer that. If they are tilting, apply urgency. If they are highly exploitable, be aggressive.`;
        }
      } catch {
        // DNA unavailable — continue without it
      }
      // ── 9. Generate AI trade strategy ─────────────────────────────────────
      const targetDesc = resolvedTargetPlayer
        ? `${resolvedTargetPlayer.fullName} (${resolvedTargetPlayer.position}, ${resolvedTargetPlayer.seasonPoints} fantasy pts in 2025, avg ${resolvedTargetPlayer.avgPoints} pts/game)`
        : targetPickLabel;

      const offerDesc = offerOptions.map((o, i) => {
        const gives = o.rodGives.picks.join(" + ");
        const receives = o.rodReceives.picks.join(" + ");
        const ratio = o.valueRatioPct ?? (targetValue > 0 ? Math.round((o.totalValue / targetValue) * 100) : 0);
        return `Option ${i + 1}: Rod gives [${gives}] (value: ${o.rodGives.totalValue}) in exchange for [${receives}] (value: ${o.rodReceives.totalValue}) — ${ratio}% value match`;
      }).join("\n");

      const gmContext = gmStyle
        ? `Target owner GM profile: ${gmStyle.archetype}, averages ${gmStyle.avgTrades} trades/season, H2H vs Rod: ${gmStyle.h2hVsRod.wins}W-${gmStyle.h2hVsRod.losses}L. Draft style: ${gmStyle.draftStyleBadge}.`
        : "GM profile not available for this owner.";

      const llmMessages: Message[] = [
        {
          role: "system",
          content: `You are an expert fantasy football trade negotiator for a 14-team PPR league (ATLANTAS FINEST FF). 
League scoring: ${scoringDesc}.
You analyze player stats, positional value, and GM behavioral profiles to craft winning trade strategies.
Always be specific, reference actual stats and values, and give actionable negotiation advice.
Respond in JSON with this schema: {
  "dealRating": "EXCELLENT|GOOD|FAIR|TOUGH",
  "targetAnalysis": "string (2-3 sentences on why this player/pick is worth acquiring)",
  "recommendedOffer": "string (name the ACTUAL picks in the lead offer, e.g. 'Lead with 1.11 + 6.01 for 1.01 — here is why...' — do NOT say 'Option 1' or 'Option 2')",
  "negotiationStrategy": "string (how to approach this specific GM based on their style)",
  "timing": "string (best time to make this offer based on standings/season context)",
  "redFlags": "string (risks or reasons they might decline)",
  "closingLine": "string (the actual message to send to the other manager, 2-3 sentences, casual tone)"
}`,
        },
        {
          role: "user",
          content: `I want to acquire: ${targetDesc}
Current owner: ${targetOwnerName}
Target value estimate: ${targetValue}

${gmContext}

My offer options:
${offerDesc}

LLeague context: 14-team PPR, keeper league, 2026 season. Rod Sellers (Str8FrmHell/RodZilla) went 9-5 in 2025, finished 3rd seed.${dnaPromptBlock ? "\n" + dnaPromptBlock : ""}
Generate a trade strategy and recommended approach. ${dnaPromptBlock ? "IMPORTANT: The DNA intelligence above contains behavioral facts — use them to make the negotiation strategy, timing, and closing message highly specific to this opponent." : ""}`,
        },
      ];

      let strategy: any = null;
      try {
        const llmResponse = await invokeLLM({
          messages: llmMessages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "trade_strategy",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  dealRating: { type: "string" },
                  targetAnalysis: { type: "string" },
                  recommendedOffer: { type: "string" },
                  negotiationStrategy: { type: "string" },
                  timing: { type: "string" },
                  redFlags: { type: "string" },
                  closingLine: { type: "string" },
                },
                required: ["dealRating", "targetAnalysis", "recommendedOffer", "negotiationStrategy", "timing", "redFlags", "closingLine"],
                additionalProperties: false,
              },
            },
          },
        });
        const content = llmResponse.choices?.[0]?.message?.content;
        strategy = typeof content === "string" ? JSON.parse(content) : content;
      } catch {
        strategy = {
          dealRating: "FAIR",
          targetAnalysis: `${targetDesc} is a solid acquisition target based on their 2025 performance.`,
          recommendedOffer: offerOptions[0]
            ? (() => {
                const o = offerOptions[0];
                const gives = o.rodGives.picks.map((p: string) => p.replace(/^Round /, '')).join(' + ');
                const receives = o.rodReceives.picks.map((p: string) => p.replace(/^Round /, '')).join(' + ');
                return `Lead with ${gives} for ${receives} — best value match at ${o.valueRatioPct ?? '?'}%`;
              })()
            : "Build a balanced offer matching target value.",
          negotiationStrategy: gmStyle ? `${gmStyle.archetype} — approach with a value-focused pitch.` : "Be direct and value-focused.",
          timing: "Early in the offseason before keeper decisions lock in.",
          redFlags: "Owner may not be motivated to sell if they have keeper eligibility remaining.",
          closingLine: `Hey, I'm interested in ${targetDesc}. Let me know if you'd consider a deal — I have some pieces that could help your roster.`,
        };
      }

      return {
        targetType: input.targetType,
        targetName: resolvedTargetPlayer?.fullName || targetPickLabel,
        targetOwner: targetOwnerName,
        targetMemberId,
        targetValue,
        targetValueBasis,
        targetStats: resolvedTargetPlayer ? {
          position: resolvedTargetPlayer.position,
          seasonPoints: resolvedTargetPlayer.seasonPoints,
          avgPoints: resolvedTargetPlayer.avgPoints,
          keeperValue: resolvedTargetPlayer.keeperValue,
          keeperValueFuture: resolvedTargetPlayer.keeperValueFuture,
          injuryStatus: resolvedTargetPlayer.injuryStatus,
          stats: resolvedTargetPlayer.stats,
        } : null,
        scoringDesc,
        offerOptions: offerOptions.map(o => ({
          players: [],
          picks: o.picks,
          pickAssets: o.pickAssets ?? [],
          totalValue: o.totalValue,
          valueRatio: targetValue > 0 ? Math.round((o.totalValue / targetValue) * 100) : 0,
          rodGives: o.rodGives,
          rodReceives: {
            ...o.rodReceives,
            // Enrich each received pick with a tradability score
            pickAssets: o.rodReceives.pickAssets.map(pk => ({
              ...pk,
              tradability: calcPickTradability(pk, dnaProfile),
            })),
          },
          valueRatioPct: o.valueRatioPct,
        })),
        rodAvailablePicks: rodAllPicks.map(pk => ({
          label: pk.label,
          round: pk.round,
          pickInRound: pk.pickInRound,
          value: pk.value,
          source: pk.source,
          acquiredFrom: pk.acquiredFrom,
        })),
        gmStyle,
        dnaProfile: dnaProfile ? {
          gmArchetype: dnaProfile.gmArchetype,
          exploitabilityScore: dnaProfile.exploitabilityScore,
          exploitabilityLabel: dnaProfile.exploitabilityLabel,
          tiltScore: dnaProfile.tilt.tiltScore,
          tiltLabel: dnaProfile.tilt.tiltLabel,
          avgTradesPerSeason: dnaProfile.trade.avgTradesPerSeason,
          lossTradeRatio: dnaProfile.trade.lossTradeRatio,
          h2hVsRod: dnaProfile.trade.h2hVsRod,
          biasVsLeague: dnaProfile.draft.biasVsLeague as Record<string, number>,
          exploitWindows: dnaProfile.exploitWindows,
          dnaSummary: dnaProfile.dnaSummary,
          seasonsAnalyzed: dnaProfile.seasonsAnalyzed,
        } : null,
        // Pick trade history summary for the target owner
        pickTradeHistory: (() => {
          if (!dnaProfile) return null;
          const tf = dnaProfile.trade.tradeFrequency;
          const ltr = dnaProfile.trade.lossTradeRatio;
          const dt = dnaProfile.trade.desperation_triggers;
          const avg = dnaProfile.trade.avgTradesPerSeason;
          // Determine tendency label
          const tendencyLabel =
            tf >= 70 ? "Frequent Trader" :
            tf >= 50 ? "Active Trader" :
            tf >= 30 ? "Occasional Trader" :
            "Rarely Trades";
          // Determine which rounds they are most likely to trade based on pick value bias
          // Late-round picks (6+) are easiest to move; early-round picks (1-2) are hardest
          const hotRounds = targetOwnerPicks
            .filter(p => p.round >= 5)
            .map(p => `Rd ${p.round}`);
          const coldRounds = targetOwnerPicks
            .filter(p => p.round <= 2)
            .map(p => `Rd ${p.round}`);
          return {
            tendencyLabel,
            tradeFrequencyScore: tf,
            avgTradesPerSeason: avg,
            lossTradeRatio: ltr,
            desperationTriggers: dt,
            hotRounds: Array.from(new Set(hotRounds)).slice(0, 3),
            coldRounds: Array.from(new Set(coldRounds)).slice(0, 3),
            totalPicksHeld: targetOwnerPicks.length,
            summaryLine: `${targetOwnerName} averages ${avg.toFixed(1)} trades/season (${tendencyLabel}). ` +
              (ltr > 1.3 ? `Trades ${ltr.toFixed(1)}x more when losing. ` : "") +
              (dt >= 2 ? `Has made desperation trades in ${dt} seasons. ` : "") +
              (hotRounds.length > 0 ? `Late-round picks (${Array.from(new Set(hotRounds)).join(", ")}) are most tradable.` : ""),
          };
        })(),
        noFair1for1,
        strategy,
      };
    }),
  // ── Math-First Trade Analyzerr ────────────────────────────────────────────
  tradeAnalyze: protectedProcedure
    .input(z.object({
      season: z.number(),
      sideA: z.array(z.object({
        playerId: z.number(),
        playerName: z.string(),
        position: z.string(),
        avgPoints: z.number(),
        teamId: z.number(),
      })),
      sideB: z.array(z.object({
        playerId: z.number(),
        playerName: z.string(),
        position: z.string(),
        avgPoints: z.number(),
        teamId: z.number(),
      })),
      teamAId: z.number(),
      teamBId: z.number(),
      // Optional picks in the trade
      picksA: z.array(z.object({ round: z.number(), pick: z.number().default(7) })).optional(),
      picksB: z.array(z.object({ round: z.number(), pick: z.number().default(7) })).optional(),
    }))
    .mutation(async ({ input }) => {
      const { calcVORP, calcPositionalScarcity, calcKeeperEfficiency, calcROSValue, calcTradeValue, calcPickValue } = await import("./analytics");
      const data = await getSeasonData(input.season);
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "No data for season. Sync ESPN first." });

      // Build full roster player list for context
      const rosters = normalizeRosters(data) as Record<string, unknown>[];
      const allPlayers: import("./analytics").PlayerRow[] = rosters.map(r => ({
        playerId: r.playerId as number,
        playerName: r.playerName as string,
        position: r.position as string,
        avgPoints: r.avgPoints as number,
        seasonPoints: r.seasonPoints as number,
        teamId: r.teamId as number,
        ownerName: r.ownerName as string || "",
        projectedTotal: null,
        keeperValue: 0,
        keeperValueFuture: 0,
        injuryStatus: "",
        appliedStats: {},
      }));

      // Calculate analytics context
      const vorpResults = calcVORP(allPlayers);
      const scarcityResults = calcPositionalScarcity(allPlayers, []); // no free agents in cache
      const keeperResults = calcKeeperEfficiency(allPlayers, vorpResults);

      // Weeks remaining (approximate — 14 regular season weeks, playoffs weeks 15-17)
      const weeksRemaining = 10;

      // Score each player in the trade
      const scorePlayer = (p: { playerId: number; playerName: string; position: string; avgPoints: number; teamId: number }) => {
        const playerRow: import("./analytics").PlayerRow = {
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          avgPoints: p.avgPoints,
          seasonPoints: p.avgPoints * 14,
          teamId: p.teamId,
          ownerName: "",
          projectedTotal: null,
          keeperValue: 0,
          keeperValueFuture: 0,
          injuryStatus: "",
          appliedStats: {},
        };
        const vorp = vorpResults.find(v => v.playerId === p.playerId);
        const ros = calcROSValue([playerRow], weeksRemaining)[0];
        const scarcity = scarcityResults.find(s => s.position === p.position);
        const keeper = keeperResults.find(k => k.playerId === p.playerId);
        return calcTradeValue(playerRow, vorp, ros, scarcity, keeper);
      };

      const sideAValues = input.sideA.map(scorePlayer);
      const sideBValues = input.sideB.map(scorePlayer);

      // Score picks
      const pickValueA = (input.picksA || []).reduce((sum, p) => sum + calcPickValue(p.round, p.pick), 0);
      const pickValueB = (input.picksB || []).reduce((sum, p) => sum + calcPickValue(p.round, p.pick), 0);

      const totalA = sideAValues.reduce((s, v) => s + v.compositeValue, 0) + pickValueA;
      const totalB = sideBValues.reduce((s, v) => s + v.compositeValue, 0) + pickValueB;

      const ratio = totalB > 0 ? totalA / totalB : 1;
      const fairnessGrade =
        ratio >= 0.95 && ratio <= 1.05 ? "FAIR"
        : ratio >= 0.85 ? "SLIGHT EDGE B"
        : ratio >= 0.75 ? "B WINS"
        : ratio <= 1.05 && ratio >= 1.0 ? "FAIR"
        : ratio > 1.05 && ratio <= 1.15 ? "SLIGHT EDGE A"
        : ratio > 1.15 ? "A WINS"
        : "LOPSIDED";

      // Positional needs analysis
      const teamARoster = allPlayers.filter(p => p.teamId === input.teamAId);
      const teamBRoster = allPlayers.filter(p => p.teamId === input.teamBId);
      const posCount = (roster: typeof allPlayers) => {
        const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
        for (const p of roster) if (p.position in counts) counts[p.position]++;
        return counts;
      };
      const needsA = posCount(teamARoster);
      const needsB = posCount(teamBRoster);

      // Build math summary for AI context
      const mathSummary = [
        `TRADE MATH (${input.season} Season Data):`,
        `Side A total value: ${totalA} (${sideAValues.map(v => `${v.name}: ${v.compositeValue} [${v.valueBreakdown}]`).join(", ")}${pickValueA > 0 ? `, picks: ${pickValueA}` : ""})`,
        `Side B total value: ${totalB} (${sideBValues.map(v => `${v.name}: ${v.compositeValue} [${v.valueBreakdown}]`).join(", ")}${pickValueB > 0 ? `, picks: ${pickValueB}` : ""})`,
        `Value ratio A/B: ${ratio.toFixed(2)} → ${fairnessGrade}`,
        `Team A roster depth: QB:${needsA.QB} RB:${needsA.RB} WR:${needsA.WR} TE:${needsA.TE}`,
        `Team B roster depth: QB:${needsB.QB} RB:${needsB.RB} WR:${needsB.WR} TE:${needsB.TE}`,
        `Positions changing hands: A gives ${Array.from(new Set(input.sideA.map(p => p.position))).join("+")}, B gives ${Array.from(new Set(input.sideB.map(p => p.position))).join("+")}`,
      ].join("\n");

      // Phase 3: Inject DNA profiles for both trade partners
      let dnaContext = "";
      try {
        const { calcLeagueDNA, buildDNAPromptBlock } = await import("./leagueDNA");
        const { buildManagerRawData } = await import("./dnaRouter");
        const managerRawData = await buildManagerRawData();
        if (managerRawData.length > 0) {
          const dnaProfiles = calcLeagueDNA(managerRawData);
          const teamsData = normalizeTeams(data);
          const teamAData = teamsData.find(t => (t.teamId as number) === input.teamAId);
          const teamBData = teamsData.find(t => (t.teamId as number) === input.teamBId);
          const teamAMemberIds = (teamAData?.memberIds as string[]) || [];
          const teamBMemberIds = (teamBData?.memberIds as string[]) || [];
          const focusedProfiles = dnaProfiles.filter(p =>
            teamAMemberIds.includes(p.memberId) || teamBMemberIds.includes(p.memberId)
          );
          if (focusedProfiles.length > 0) {
            dnaContext = "\n\n" + buildDNAPromptBlock(focusedProfiles);
          }
        }
      } catch {
        // DNA unavailable — continue without it
      }

      const prompt = `You are an expert fantasy football analyst. The following trade math has already been calculated — DO NOT recalculate values. Your job is to EXPLAIN and RECOMMEND based on the numbers.

${mathSummary}${dnaContext}

League context: 14-team PPR keeper league (ATLANTAS FINEST FF). Keepers cost 1 round more than previous year's draft round.${dnaContext ? "\nIMPORTANT: The DNA intelligence above contains behavioral facts about both owners — use them to make the negotiation strategy and recommendations highly specific to each owner's tendencies." : ""}

Provide:
1. VERDICT: One sentence — who wins this trade (or FAIR if balanced).
2. WHY: 2-3 sentences explaining the math in plain English.
3. ROSTER FIT: Does this trade address each team's actual positional needs?
4. KEEPER ANGLE: Any long-term keeper implications?
5. RECOMMENDATION: Should Team A accept? Should Team B accept? (YES/NO with one sentence each)${dnaContext ? "\n6. NEGOTIATION: Based on each owner's DNA profile, how should Team A approach this negotiation?" : ""}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a fantasy football trade analyst. The math is already done. Explain and recommend based on the provided numbers. Be concise and decisive." },
          { role: "user", content: prompt },
        ],
      });
      const aiVerdict = response.choices?.[0]?.message?.content ?? "Analysis unavailable.";

      return {
        sideAValues,
        sideBValues,
        totalA,
        totalB,
        pickValueA,
        pickValueB,
        ratio: Math.round(ratio * 100) / 100,
        fairnessGrade,
        aiVerdict,
        mathSummary,
        teamANeeds: needsA,
        teamBNeeds: needsB,
      };
    }),

  advisor: router({
    chat: subscribedProcedure
      .input(z.object({ message: z.string().min(1).max(2000), season: z.number().optional() }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const season = input.season ?? 2025;
        // Rate limit check
        const rl = checkRateLimit({ userId, callType: "advisor", isAdmin: ctx.user.role === "admin" });
        if (!rl.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: rl.reason ?? "Rate limit exceeded" });
        let leagueContext = `You are an expert Fantasy Football GM advisor for the league "ATLANTAS FINEST FF" (League ID: ${LEAGUE_ID}).
This is an 18-season keeper league running from 2009 to 2026 with 14 teams.
Format: Head-to-Head Points, PPR (Point Per Reception), Snake Draft, 1 keeper per team.
Scoring positions: QB, RB, WR, TE, K, D/ST. Playoffs: 7 teams.
Be concise, data-driven, and specific. Reference actual team names and player names when possible.`;

        const data = await getSeasonData(season);
        if (data) {
          const teams = normalizeTeams(data);
          const settings = normalizeSettings(data);
          const teamOwnerMapAdvisor: Record<number, string> = {};
          for (const t of teams) teamOwnerMapAdvisor[t.teamId as number] = t.owners as string;
          const allPlayers: PlayerRow[] = (normalizeRosters(data) as unknown[]).map((r: unknown) => {
            const p = r as Record<string, unknown>;
            return {
              playerId: p.playerId as number,
              playerName: (p.playerName as string) || "Unknown",
              position: (p.position as string) || "?",
              teamId: p.teamId as number,
              ownerName: teamOwnerMapAdvisor[p.teamId as number] || "Unknown",
              seasonPoints: (p.appliedTotal as number) || 0,
              avgPoints: (p.appliedAverage as number) || 0,
              projectedTotal: (p.projectedTotal as number) || null,
              keeperValue: (p.keeperValue as number) || 0,
              keeperValueFuture: (p.keeperValueFuture as number) || 0,
              injuryStatus: (p.injuryStatus as string) || "",
              appliedStats: (p.appliedStats as Record<string, number>) || {},
            };
          });
          const calYear = new Date().getFullYear();
          const isSeasonComplete = (settings.currentMatchupPeriod as number || 0) >= 14 || season < calYear;
          const upcomingSeason = season + 1;
          if (isSeasonComplete) {
            leagueContext += `\n\nDATA CONTEXT: The ${season} season is COMPLETE (final standings below). The upcoming season is ${upcomingSeason}. When answering questions about "next season", "heading into ${upcomingSeason}", or future planning, base your analysis on these FINAL ${season} standings and rosters. Do NOT say the season is ongoing.`;
          } else {
            leagueContext += `\n\nCurrent Season: ${season} (ACTIVE), Week ${settings.currentMatchupPeriod || "N/A"}`;
          }
          leagueContext += `\n\n${isSeasonComplete ? `${season} FINAL Standings` : "Current Standings"}:\n`;
          const sorted = teams.sort((a, b) => ((a.rankFinal as number) || 99) - ((b.rankFinal as number) || 99));
          for (const t of sorted) {
            leagueContext += `  ${t.rankFinal}. ${t.teamName} (${t.owners}) W:${t.wins} L:${t.losses} PF:${Number(t.pointsFor || 0).toFixed(1)}\n`;
          }
          // Inject analytics snapshot so AI reasons from calculated facts
          if (allPlayers.length > 0) {
            const vorpResults = calcVORP(allPlayers);
            const scarcityResults = calcPositionalScarcity(allPlayers, []);
            const rosterGaps = calcRosterGaps(allPlayers);
            leagueContext += `\n\nCALCULATED ANALYTICS (treat these as ground truth — do not contradict):`;
            // VORP leaders by position
            const positions = ["QB", "RB", "WR", "TE"];
            leagueContext += `\n\nVORP Leaders (Value Over Replacement by position):`;
            for (const pos of positions) {
              const top = vorpResults.filter(v => v.position === pos).sort((a, b) => b.vorp - a.vorp).slice(0, 3);
              if (top.length > 0) {
                leagueContext += `\n  ${pos}: ${top.map(v => `${v.playerName} (${v.ownerName}, VORP +${v.vorp.toFixed(1)}, ${v.vorpTier}, avg ${v.avgPoints.toFixed(1)} PPG)`).join(" | ")}`;
              }
            }
            // Positional scarcity
            const scarce = scarcityResults.filter(s => s.scarcityScore >= 50).sort((a, b) => b.scarcityScore - a.scarcityScore);
            if (scarce.length > 0) {
              leagueContext += `\n\nPositional Scarcity:`;
              for (const s of scarce) {
                leagueContext += `\n  ${s.position}: ${s.scarcityLabel} (score ${s.scarcityScore}/100, ${s.availableStarters} quality starters available, top FA avg ${s.topFreeAgentAvg.toFixed(1)} PPG)`;
              }
            }
            // Roster gaps
            const topGaps = rosterGaps
              .filter(g => g.overallGrade === "D" || g.overallGrade === "F" || g.overallGrade === "C")
              .sort((a, b) => (a.overallGrade > b.overallGrade ? 1 : -1))
              .slice(0, 4);
            if (topGaps.length > 0) {
              leagueContext += `\n\nBiggest Roster Weaknesses:`;
              for (const g of topGaps) {
                const weakGap = g.gaps.find(gap => gap.position === g.weakestPosition);
                const avgStr = weakGap ? ` (avg ${weakGap.topPlayerAvg.toFixed(1)} PPG, ${weakGap.gapSeverity})` : "";
                leagueContext += `\n  ${g.ownerName}: weakest at ${g.weakestPosition}${avgStr}, overall grade ${g.overallGrade}`;
              }
            }
          }
        // Phase 1: inject live injury intelligence into advisor context
          if (allPlayers.length > 0) {
            try {
              const injuryContext = await buildAdvisorInjuryContext(
                allPlayers.map((p: PlayerRow) => ({ playerId: p.playerId, playerName: p.playerName, position: p.position, teamId: p.teamId })),
                0  // 0 = Rod's teamId placeholder
              );
              leagueContext += "\n\n" + injuryContext;
            } catch {
              // Injury fetch failed — continue without it
            }
          }

          // Phase 3: inject League DNA behavioral intelligence
          try {
            const { calcLeagueDNA, buildDNAPromptBlock } = await import("./leagueDNA");
            const { buildManagerRawData } = await import("./dnaRouter");
            const managerRawData = await buildManagerRawData();
            if (managerRawData.length > 0) {
              const dnaProfiles = calcLeagueDNA(managerRawData);
              const dnaBlock = buildDNAPromptBlock(dnaProfiles);
              leagueContext += "\n\n" + dnaBlock;
            }
          } catch {
            // DNA unavailable — continue without it
          }
          // Phase 4: inject upcoming draft order and keeper data
          try {
            // Always fetch the 2026 draft order explicitly — this is the upcoming draft
            const UPCOMING_DRAFT_YEAR = 2026;
            const upcomingDraftData = await getSeasonData(UPCOMING_DRAFT_YEAR);
            const draftData = upcomingDraftData ?? await getSeasonData(season);
            const draftLabelYear = upcomingDraftData ? UPCOMING_DRAFT_YEAR : season;
            if (draftData) {
              const draftOrderData = normalizeDraftOrder(draftData as Record<string, unknown>);
              const pickOrder = draftOrderData.pickOrder || [];
if (pickOrder.length > 0) {
                const draftDateMs = draftOrderData.draftDate as number;
                const draftDateStr = draftDateMs ? new Date(draftDateMs).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "TBD";
                leagueContext += `\n\n## GROUND TRUTH — ${draftLabelYear} DRAFT ORDER (this overrides any prior conversation)`;
                leagueContext += `\nSnake Draft, ${draftOrderData.keeperCount || 1} keeper per team. Use this EXACT order — do NOT contradict it regardless of what was said earlier.`;
                leagueContext += `\nDraft Date: ${draftDateStr}`;
                leagueContext += `\nRound 1 Pick Order: ${pickOrder.map(p => `#${p.position} ${p.owners}`).join(", ")}`;
                leagueContext += `\n(Round 2 reverses: last pick goes first, etc.)`;
              }
              // Inject current keeper picks from current season draft
              const picks2025 = normalizeDraftPicks(draftData as Record<string, unknown>);
              const keepers = (picks2025 as Array<Record<string, unknown>>).filter(p => p.keeper === true || p.keeper === 1);
              if (keepers.length > 0) {
                leagueContext += `\n\n2025 KEEPER PICKS (players kept from prior season):`;
                for (const k of keepers) {
                  leagueContext += `\n  Round ${k.roundId}: ${k.playerName} (${k.position}) → kept by ${k.ownerName || k.teamName}`;
                }
              }
            }
          } catch {
            // Draft order unavailable — continue without it
          }
        }
        // Inject GM memory into system prompt
        const gmMemory = await getUserMemory(userId);
        if (gmMemory) {
          const memParts: string[] = [];
          if (gmMemory.riskTolerance) memParts.push(`Risk Tolerance: ${gmMemory.riskTolerance}`);
          if (gmMemory.tradePhilosophy) memParts.push(`Trade Philosophy: ${gmMemory.tradePhilosophy}`);
          if (gmMemory.keeperPhilosophy) memParts.push(`Keeper Philosophy: ${gmMemory.keeperPhilosophy}`);
          if (gmMemory.draftStyle) memParts.push(`Draft Style: ${gmMemory.draftStyle}`);
          if (gmMemory.favoritePlayerTypes) memParts.push(`Favorite Player Types: ${gmMemory.favoritePlayerTypes}`);
          if (gmMemory.rivalManagers) memParts.push(`Rival Managers to Watch: ${gmMemory.rivalManagers}`);
          if (gmMemory.notes) memParts.push(`GM Notes: ${gmMemory.notes}`);
          if (memParts.length > 0) {
            leagueContext += `\n\n## GM PROFILE (Rod Sellers)\n${memParts.join("\n")}`;
          }
        }
        const history = await getChatHistory(userId, season);
        const messages: Message[] = [
          { role: "system", content: leagueContext },
          ...history.slice(-20).map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
          { role: "user", content: input.message },
        ];

        await addChatMessage(userId, "user", input.message, season);
        const response = await invokeLLM({
          messages,
          callType: "advisor",
          persistUsage: (u) => persistLlmUsage({ userId, ...u }),
        });
        const rawContent = response.choices?.[0]?.message?.content;
        const assistantMessage = typeof rawContent === "string" ? rawContent : (rawContent ? JSON.stringify(rawContent) : "I couldn't generate a response. Please try again.");
        await addChatMessage(userId, "assistant", assistantMessage, season);
        // Record usage for rate limiter
        recordUsage({ userId, callType: "advisor", tokensUsed: response.usage?.total_tokens ?? 0 });
        return { message: assistantMessage };
      }),

    history: protectedProcedure
      .input(z.object({ season: z.number().optional() }))
      .query(async ({ ctx, input }) => getChatHistory(ctx.user.id, input.season)),

    clearHistory: protectedProcedure.mutation(async ({ ctx }) => {
      await clearChatHistory(ctx.user.id);
      return { success: true };
    }),
    getMemory: protectedProcedure.query(async ({ ctx }) => {
      return getUserMemory(ctx.user.id);
    }),
    updateMemory: protectedProcedure
      .input(z.object({
        riskTolerance: z.string().max(32).optional(),
        tradePhilosophy: z.string().max(1000).optional(),
        keeperPhilosophy: z.string().max(1000).optional(),
        draftStyle: z.string().max(64).optional(),
        favoritePlayerTypes: z.string().max(500).optional(),
        rivalManagers: z.string().max(500).optional(),
        notes: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertUserMemory(ctx.user.id, input);
        return { success: true };
      }),
  }),

  // ── Usage Metering ─────────────────────────────────────────────────────────
  usage: router({
    /**
     * Get the current user's LLM usage summary for the last 30 days.
     * Used for cost visibility and quota display on the command center.
     */
    getMyUsage: protectedProcedure.query(async ({ ctx }) => {
      return getLlmUsageSummary(ctx.user.id);
    }),
  }),
  // ── Pipeline Health ────────────────────────────────────────────────────────
  pipeline: router({
    health: publicProcedure
      .input(z.object({ season: z.number().optional() }))
      .query(async ({ input }) => {
        const manifests = await getRefreshManifests();
        const cachedSeasons = await getAllCachedSeasons();
        const cookiesPresent = hasCookies();

        // Build per-season health summary
        const seasonHealth = await Promise.all(
          cachedSeasons.map(async (season) => {
            const manifest = manifests.find(m => m.season === season);
            const viewHealth = input.season === season || !input.season
              ? await getViewHealthForSeason(season)
              : [];

            // Closed seasons (< 2025) have immutable data — never stale regardless of age.
            // Only open seasons (2025+) need a freshness check.
            const isClosedSeason = season < 2025;
            const staleFlag = isClosedSeason
              ? false
              : manifest?.lastRefreshedAt
                ? isStale(new Date(manifest.lastRefreshedAt))
                : true;
            const staleAge = manifest?.lastRefreshedAt
              ? staleSummary(new Date(manifest.lastRefreshedAt))
              : "Never";

            return {
              season,
              status: manifest?.status ?? "unknown",
              lastRefreshedAt: manifest?.lastRefreshedAt ?? null,
              staleFlag,
              staleAge,
              teamCount: manifest?.teamCount ?? 0,
              rosterCount: manifest?.rosterCount ?? 0,
              matchupCount: manifest?.matchupCount ?? 0,
              draftPickCount: manifest?.draftPickCount ?? 0,
              transactionCount: manifest?.transactionCount ?? 0,
              errorMessage: manifest?.errorMessage ?? null,
              viewHealth: viewHealth.map(vh => ({
                viewName: vh.viewName,
                status: vh.status,
                recordCount: vh.recordCount,
                errorMessage: vh.errorMessage,
                fetchedAt: vh.fetchedAt,
              })),
            };
          })
        );

        const totalSeasons = cachedSeasons.length;
        // Count all cached seasons for health scoring — 2009–2026 are all now supported.
        const scoredHealth = seasonHealth;
        const staleSeasons = scoredHealth.filter(s => s.staleFlag).length;
        const failedSeasons = scoredHealth.filter(s => s.status === "failed").length;
        const partialSeasons = scoredHealth.filter(s => s.status === "partial").length;
        return {
          cookiesPresent,
          totalSeasons,
          staleSeasons,
          failedSeasons,
          partialSeasons,
          overallHealth: failedSeasons > 0 ? "critical"
            : staleSeasons > 3 ? "degraded"
            : partialSeasons > 0 ? "warning"
            : "healthy",
          seasonHealth,
        };
      }),

    validate: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        const data = await getCachedView(input.season, "combined");
        if (!data) return { isUsable: false, issues: ["No cached data for this season"], warnings: [], season: input.season };
        return validateDataQuality(input.season, data.payload as Record<string, unknown>);
      }),
  }),

  // ── Analytics ─────────────────────────────────────────────────────────────
  analytics: router({
    vorp: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        return memCache(`vorp:${input.season}`, 10 * 60_000, async () => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rosters = normalizeRosters(data) as unknown[];
        const teams = normalizeTeams(data);
        const teamOwnerMap: Record<number, string> = {};
        for (const t of teams) teamOwnerMap[t.teamId as number] = t.owners as string;

        const players: PlayerRow[] = rosters.map((r: unknown) => {
          const p = r as Record<string, unknown>;
          return {
            playerId: p.playerId as number,
            playerName: (p.playerName as string) || "Unknown",
            position: (p.position as string) || "?",
            teamId: p.teamId as number,
            ownerName: teamOwnerMap[p.teamId as number] || "Unknown",
            seasonPoints: (p.appliedTotal as number) || 0,
            avgPoints: (p.appliedAverage as number) || 0,
            projectedTotal: (p.projectedTotal as number) || null,
            keeperValue: (p.keeperValue as number) || 0,
            keeperValueFuture: (p.keeperValueFuture as number) || 0,
            injuryStatus: (p.injuryStatus as string) || "",
            appliedStats: (p.appliedStats as Record<string, number>) || {},
          };
        });

        return calcVORP(players);
        });
      }),

    scarcity: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        return memCache(`scarcity:${input.season}`, 10 * 60_000, async () => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rosters = normalizeRosters(data) as unknown[];
        const teams = normalizeTeams(data);
        const teamOwnerMap: Record<number, string> = {};
        for (const t of teams) teamOwnerMap[t.teamId as number] = t.owners as string;

        const toPlayerRow = (r: unknown): PlayerRow => {
          const p = r as Record<string, unknown>;
          return {
            playerId: p.playerId as number,
            playerName: (p.playerName as string) || "Unknown",
            position: (p.position as string) || "?",
            teamId: (p.teamId as number) || 0,
            ownerName: teamOwnerMap[p.teamId as number] || "Free Agent",
            seasonPoints: (p.appliedTotal as number) || 0,
            avgPoints: (p.appliedAverage as number) || 0,
            projectedTotal: null,
            keeperValue: 0,
            keeperValueFuture: 0,
            injuryStatus: "",
            appliedStats: {},
          };
        };

        const rosteredPlayers = rosters.map(toPlayerRow);
        const faRaw = (data.players as Record<string, unknown>[]) || [];
        const freeAgents: PlayerRow[] = faRaw
          .filter(fa => !fa.onTeamId || fa.onTeamId === 0)
          .map(fa => {
            const entry = (fa.playerPoolEntry as Record<string, unknown>) || fa;
            const player = (entry.player as Record<string, unknown>) || {};
            const stats = (player.stats as Record<string, unknown>[]) || [];
            let avg = 0;
            for (const s of stats) {
              if (s.statSourceId === 0 && s.statSplitTypeId === 0) avg = (s.appliedAverage as number) || 0;
            }
            return {
              playerId: (player.id || fa.id) as number,
              playerName: (player.fullName as string) || "Unknown",
              position: ["QB","RB","WR","TE","K","D/ST"][(player.defaultPositionId as number) - 1] || "?",
              teamId: 0,
              ownerName: "Free Agent",
              seasonPoints: 0,
              avgPoints: avg,
              projectedTotal: null,
              keeperValue: 0,
              keeperValueFuture: 0,
              injuryStatus: "",
              appliedStats: {},
            };
          });

        return calcPositionalScarcity(rosteredPlayers, freeAgents);
        });
      }),

    rosterGaps: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        return memCache(`rosterGaps:${input.season}`, 10 * 60_000, async () => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rosters = normalizeRosters(data) as unknown[];
        const teams = normalizeTeams(data);
        const teamOwnerMap: Record<number, string> = {};
        for (const t of teams) teamOwnerMap[t.teamId as number] = t.owners as string;

        const players: PlayerRow[] = rosters.map((r: unknown) => {
          const p = r as Record<string, unknown>;
          return {
            playerId: p.playerId as number,
            playerName: (p.playerName as string) || "Unknown",
            position: (p.position as string) || "?",
            teamId: p.teamId as number,
            ownerName: teamOwnerMap[p.teamId as number] || "Unknown",
            seasonPoints: (p.appliedTotal as number) || 0,
            avgPoints: (p.appliedAverage as number) || 0,
            projectedTotal: null,
            keeperValue: (p.keeperValue as number) || 0,
            keeperValueFuture: (p.keeperValueFuture as number) || 0,
            injuryStatus: (p.injuryStatus as string) || "",
            appliedStats: {},
          };
        });

        return calcRosterGaps(players);
        });
      }),

    keeperEfficiency: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        return memCache(`keeperEfficiency:${input.season}`, 10 * 60_000, async () => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rosters = normalizeRosters(data) as unknown[];
        const teams = normalizeTeams(data);
        const teamOwnerMap: Record<number, string> = {};
        for (const t of teams) teamOwnerMap[t.teamId as number] = t.owners as string;

        const players: PlayerRow[] = rosters.map((r: unknown) => {
          const p = r as Record<string, unknown>;
          return {
            playerId: p.playerId as number,
            playerName: (p.playerName as string) || "Unknown",
            position: (p.position as string) || "?",
            teamId: p.teamId as number,
            ownerName: teamOwnerMap[p.teamId as number] || "Unknown",
            seasonPoints: (p.appliedTotal as number) || 0,
            avgPoints: (p.appliedAverage as number) || 0,
            projectedTotal: null,
            keeperValue: (p.keeperValue as number) || 0,
            keeperValueFuture: (p.keeperValueFuture as number) || 0,
            injuryStatus: (p.injuryStatus as string) || "",
            appliedStats: {},
          };
        });

        const vorp = calcVORP(players);
        return calcKeeperEfficiency(players, vorp);
        });
      }),

    managerBehavior: publicProcedure
      .input(z.object({ seasons: z.array(z.number()).optional() }))
      .query(async ({ input }) => {
        const seasonKey = (input.seasons ?? []).join("-") || "all";
        return memCache(`managerBehavior:${seasonKey}`, 10 * 60_000, async () => {
        const cachedSeasons = input.seasons ?? await getAllCachedSeasons();
        // Aggregate by OWNER NAME (not teamId) to avoid cross-owner data mixing
        // ESPN reuses team slot IDs across seasons when owners change
        // Key: normalized owner name (lowercase, trimmed)
        const ownerTeamMap: Record<string, TeamRow & { canonicalName: string }> = {};
        // Maps (season, teamId) -> ownerName for transaction/pick lookup
        const seasonTeamOwnerMap: Record<string, string> = {};

        for (const season of cachedSeasons) {
          const data = await getSeasonData(season);
          if (!data) continue;
          // Skip seasons with no real data (empty payload)
          const teams = normalizeTeams(data);
          if (!teams || teams.length === 0) continue;

          for (const t of teams) {
            const tid = t.teamId as number;
            const ownerRaw = (t.owners as string) || "Unknown";
            const ownerKey = ownerRaw.toLowerCase().trim();
            seasonTeamOwnerMap[`${season}:${tid}`] = ownerKey;

            if (!ownerTeamMap[ownerKey]) {
              // Use a synthetic teamId (hash of owner name) so calcManagerBehavior can key by it
              const syntheticId = ownerKey.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
              ownerTeamMap[ownerKey] = { teamId: syntheticId, ownerName: ownerRaw, canonicalName: ownerRaw, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
            }
            ownerTeamMap[ownerKey].wins += (t.wins as number) || 0;
            ownerTeamMap[ownerKey].losses += (t.losses as number) || 0;
            ownerTeamMap[ownerKey].pointsFor += (t.pointsFor as number) || 0;
            ownerTeamMap[ownerKey].pointsAgainst += (t.pointsAgainst as number) || 0;
          }
        }

        // Build ownerNameMap: syntheticId -> canonical name
        const ownerNameMap: Record<number, string> = {};
        for (const entry of Object.values(ownerTeamMap)) {
          ownerNameMap[entry.teamId] = entry.canonicalName;
        }

        // Now collect transactions and picks, keyed to the owner's synthetic teamId
        const allTransactions: TransactionRow[] = [];
        const allDraftPicks: DraftPickRow[] = [];

        for (const season of cachedSeasons) {
          const data = await getSeasonData(season);
          if (!data) continue;
          const teams = normalizeTeams(data);
          if (!teams || teams.length === 0) continue;

          // Build season-local teamId -> syntheticId map
          const localIdToSynthetic: Record<number, number> = {};
          for (const t of teams) {
            const tid = t.teamId as number;
            const ownerKey = seasonTeamOwnerMap[`${season}:${tid}`];
            if (ownerKey && ownerTeamMap[ownerKey]) {
              localIdToSynthetic[tid] = ownerTeamMap[ownerKey].teamId;
            }
          }

          const txs = normalizeTransactions(data) as unknown[];
          for (const tx of txs) {
            const t = tx as Record<string, unknown>;
            const origTid = t.teamId as number;
            const syntheticId = localIdToSynthetic[origTid] ?? origTid;
            allTransactions.push({
              season: t.season as number,
              teamId: syntheticId,
              type: t.type as string,
              itemType: t.itemType as string,
              proposedDate: t.proposedDate as number,
            });
          }
          const picks = normalizeDraftPicks(data) as unknown[];
          for (const pick of picks) {
            const p = pick as Record<string, unknown>;
            const origTid = p.teamId as number;
            const syntheticId = localIdToSynthetic[origTid] ?? origTid;
            allDraftPicks.push({
              season: p.season as number,
              teamId: syntheticId,
              roundId: p.roundId as number,
              roundPickNumber: p.roundPickNumber as number,
              overallPickNumber: p.overallPickNumber as number,
              position: (p.position as string) || "?",
              keeper: (p.keeper as boolean) || false,
              playerId: (p.playerId as number) || undefined,
            });
          }
        }

        // Build playerScoreMap from the most recent cached season's roster data.
        // This is used by calcManagerBehavior to estimate current ADP for keeper efficiency.
        const playerScoreMap = new Map<number, { avgPoints: number; position: string }>();
        const latestCachedSeason = [...cachedSeasons].sort((a, b) => b - a)[0];
        if (latestCachedSeason) {
          const latestData = await getSeasonData(latestCachedSeason);
          if (latestData) {
            const latestRosters = normalizeRosters(latestData) as Record<string, unknown>[];
            for (const r of latestRosters) {
              const pid = r.playerId as number;
              const avg = (r.appliedAverage as number) || 0;
              const pos = (r.position as string) || "?";
              if (pid && avg > 0) {
                // Keep the highest avgPoints entry if a player appears on multiple rosters
                const existing = playerScoreMap.get(pid);
                if (!existing || avg > existing.avgPoints) {
                  playerScoreMap.set(pid, { avgPoints: avg, position: pos });
                }
              }
            }
          }
        }

        return calcManagerBehavior(
          Object.values(ownerTeamMap).map(e => ({ teamId: e.teamId, ownerName: e.canonicalName, wins: e.wins, losses: e.losses, pointsFor: e.pointsFor, pointsAgainst: e.pointsAgainst })),
          allTransactions,
          allDraftPicks,
          ownerNameMap,
          playerScoreMap
        );
        });
      }),

    rosValues: publicProcedure
      .input(z.object({ season: z.number(), weeksRemaining: z.number().optional() }))
      .query(async ({ input }) => {
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rosters = normalizeRosters(data) as unknown[];
        const teams = normalizeTeams(data);
        const teamOwnerMap: Record<number, string> = {};
        for (const t of teams) teamOwnerMap[t.teamId as number] = t.owners as string;

        const players: PlayerRow[] = rosters.map((r: unknown) => {
          const p = r as Record<string, unknown>;
          return {
            playerId: p.playerId as number,
            playerName: (p.playerName as string) || "Unknown",
            position: (p.position as string) || "?",
            teamId: p.teamId as number,
            ownerName: teamOwnerMap[p.teamId as number] || "Unknown",
            seasonPoints: (p.appliedTotal as number) || 0,
            avgPoints: (p.appliedAverage as number) || 0,
            projectedTotal: null,
            keeperValue: 0,
            keeperValueFuture: 0,
            injuryStatus: (p.injuryStatus as string) || "",
            appliedStats: {},
          };
        });

         return calcROSValue(players, input.weeksRemaining ?? 10);
      }),

    // ── 3D PROJECTIONS ──────────────────────────────────────────────────────────
    projections3D: publicProcedure
      .input(z.object({
        season: z.number(),
        weeksRemaining: z.number().optional().default(10),
        teamId: z.number().optional(),
      }))
      .query(async ({ input }) => {
        const { calc3DProjections } = await import("./analytics_additions");
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rosters = normalizeRosters(data) as Record<string, unknown>[];
        const teams = normalizeTeams(data);
        const teamOwnerMap: Record<number, string> = {};
        for (const t of teams) teamOwnerMap[t.teamId as number] = t.owners as string;
        const players: PlayerRow[] = rosters
          .filter(r => !input.teamId || r.teamId === input.teamId)
          .map(r => ({
            playerId: r.playerId as number,
            playerName: (r.playerName as string) || "Unknown",
            position: (r.position as string) || "?",
            teamId: r.teamId as number,
            ownerName: teamOwnerMap[r.teamId as number] || "Unknown",
            seasonPoints: (r.appliedTotal as number) || 0,
            avgPoints: (r.appliedAverage as number) || 0,
            projectedTotal: null,
            keeperValue: 0,
            keeperValueFuture: 0,
            injuryStatus: (r.injuryStatus as string) || "",
            appliedStats: {},
          }));
        const weeklyScoresMap = new Map<number, number[]>();
        for (const r of rosters) {
          const pid = r.playerId as number;
          const stats = r.appliedStats as Record<string, number> | undefined;
          if (stats) {
            const weekly = Object.entries(stats)
              .filter(([k]) => k.startsWith("week_"))
              .map(([, v]) => v as number)
              .filter(v => v > 0);
            if (weekly.length > 0) weeklyScoresMap.set(pid, weekly);
          }
        }
        return calc3DProjections(weeklyScoresMap, players, input.weeksRemaining);
      }),

    // ── KEEPER FUTURE VALUE ─────────────────────────────────────────────────────
    keeperFutureValue: publicProcedure
      .input(z.object({ season: z.number(), teamId: z.number().optional() }))
      .query(async ({ input }) => {
        const { calcKeeperFutureValue } = await import("./analytics_additions");
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rosters = normalizeRosters(data) as Record<string, unknown>[];
        const teams = normalizeTeams(data);
        const teamOwnerMap: Record<number, string> = {};
        for (const t of teams) teamOwnerMap[t.teamId as number] = t.owners as string;
        const draftPicks = normalizeDraftPicks(data) as Record<string, unknown>[];
        const keeperRoundMap: Record<number, number> = {};
        for (const p of draftPicks) {
          if (p.keeper === true) keeperRoundMap[p.playerId as number] = p.roundId as number;
        }
        const players: PlayerRow[] = rosters
          .filter(r => !input.teamId || r.teamId === input.teamId)
          .map(r => ({
            playerId: r.playerId as number,
            playerName: (r.playerName as string) || "Unknown",
            position: (r.position as string) || "?",
            teamId: r.teamId as number,
            ownerName: teamOwnerMap[r.teamId as number] || "Unknown",
            seasonPoints: (r.appliedTotal as number) || 0,
            avgPoints: (r.appliedAverage as number) || 0,
            projectedTotal: null,
            keeperValue: keeperRoundMap[r.playerId as number] || 0,
            keeperValueFuture: 0,
            injuryStatus: (r.injuryStatus as string) || "",
            appliedStats: {},
          }))
          .filter(p => p.keeperValue > 0);
        return calcKeeperFutureValue(players);
      }),

    // ── STRENGTH OF SCHEDULE ────────────────────────────────────────────────────
    strengthOfSchedule: publicProcedure
      .input(z.object({
        season: z.number(),
        currentWeek: z.number().optional().default(1),
        playoffStartWeek: z.number().optional().default(15),
      }))
      .query(async ({ input }) => {
        const { calcStrengthOfSchedule } = await import("./analytics_additions");
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rawTeams = normalizeTeams(data);
        const ownerNameMap: Record<number, string> = {};
        for (const t of rawTeams) ownerNameMap[t.teamId as number] = t.owners as string;
        const teams: TeamRow[] = rawTeams.map(t => ({
          teamId: t.teamId as number,
          ownerName: t.owners as string,
          wins: t.wins as number,
          losses: t.losses as number,
          pointsFor: t.pointsFor as number,
          pointsAgainst: t.pointsAgainst as number,
        }));
        const rawSchedule = ((data as Record<string, unknown>).schedule || {}) as Record<string, unknown>;
        const matchups: { week: number; homeTeamId: number; awayTeamId: number; homeScore: number; awayScore: number; winner: string; }[] = [];
        for (const [weekKey, gamesUnknown] of Object.entries(rawSchedule)) {
          const games = Array.isArray(gamesUnknown) ? gamesUnknown : [gamesUnknown];
          for (const gameUnknown of games) {
            const g = gameUnknown as Record<string, unknown>;
            const home = (g.home || {}) as Record<string, unknown>;
            const away = (g.away || {}) as Record<string, unknown>;
            const week = Number(g.week ?? g.matchupPeriodId ?? weekKey);
            const homeTeamId = Number(g.homeTeamId ?? home.teamId ?? home.id ?? 0);
            const awayTeamId = Number(g.awayTeamId ?? away.teamId ?? away.id ?? 0);
            const homeScore = Number(g.homeScore ?? home.totalPoints ?? home.points ?? 0);
            const awayScore = Number(g.awayScore ?? away.totalPoints ?? away.points ?? 0);
            if (!Number.isFinite(week) || !homeTeamId || !awayTeamId) continue;
            const winner = (g.winner as string) || (homeScore > awayScore ? "HOME" : awayScore > homeScore ? "AWAY" : "UNDECIDED");
            matchups.push({ week, homeTeamId, awayTeamId, homeScore, awayScore, winner });
          }
        }
        return calcStrengthOfSchedule(matchups, teams, ownerNameMap, input.currentWeek, input.playoffStartWeek);
      }),

    // ── OPPONENT OVERVALUATION ──────────────────────────────────────────────────
    opponentOvervaluation: publicProcedure
      .input(z.object({ seasons: z.array(z.number()).optional() }))
      .query(async ({ input }) => {
        const { calcOpponentOvervaluation } = await import("./analytics_additions");
        const seasons = input.seasons || [2023, 2024, 2025];
        const allDraftPicks: DraftPickRow[] = [];
        const teamMap: Record<number, TeamRow> = {};
        const ownerNameMap: Record<number, string> = {};
        const allTransactions: TransactionRow[] = [];
        const allDraftPickRows: DraftPickRow[] = [];
        for (const season of seasons) {
          const data = await getSeasonData(season);
          if (!data) continue;
          const picks = normalizeDraftPicks(data) as Record<string, unknown>[];
          for (const p of picks) {
            allDraftPicks.push({ season, teamId: p.teamId as number, roundId: p.roundId as number, roundPickNumber: p.roundPickNumber as number, overallPickNumber: p.overallPickNumber as number, position: (p.position as string) || "?", keeper: (p.keeper as boolean) || false });
            allDraftPickRows.push({ season, teamId: p.teamId as number, roundId: p.roundId as number, roundPickNumber: p.roundPickNumber as number, overallPickNumber: p.overallPickNumber as number, position: (p.position as string) || "?", keeper: (p.keeper as boolean) || false });
          }
          const teams = normalizeTeams(data);
          for (const t of teams) {
            const tid = t.teamId as number;
            if (!teamMap[tid]) { teamMap[tid] = { teamId: tid, ownerName: t.owners as string, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }; ownerNameMap[tid] = t.owners as string; }
            teamMap[tid].wins += (t.wins as number) || 0;
            teamMap[tid].losses += (t.losses as number) || 0;
            teamMap[tid].pointsFor += (t.pointsFor as number) || 0;
            teamMap[tid].pointsAgainst += (t.pointsAgainst as number) || 0;
          }
          const txns = normalizeTransactions(data) as Record<string, unknown>[];
          for (const tx of txns) allTransactions.push({ season, teamId: tx.teamId as number, type: tx.type as string, itemType: (tx.itemType as string) || "", proposedDate: (tx.proposedDate as number) || 0 });
        }
        const teams = Object.values(teamMap);
        const behavior = calcManagerBehavior(teams, allTransactions, allDraftPickRows, ownerNameMap) as ManagerBehaviorStats[];
        return calcOpponentOvervaluation(allDraftPicks, teams, ownerNameMap, behavior);
      }),

    // ── WAIVER REPLACEMENT COST ─────────────────────────────────────────────────
    waiverReplacementCost: publicProcedure
      .input(z.object({ season: z.number() }))
      .query(async ({ input }) => {
        const { calcWaiverReplacementCost } = await import("./analytics_additions");
        const data = await getSeasonData(input.season);
        if (!data) return [];
        const rosters = normalizeRosters(data) as Record<string, unknown>[];
        const rosteredIds = new Set(rosters.map(r => r.playerId as number));
        const allPlayers = (data as Record<string, unknown>).players as Record<string, unknown>[] || [];
        const freeAgentPlayers: PlayerRow[] = allPlayers
          .filter(p => !rosteredIds.has(p.id as number))
          .map(p => ({ playerId: p.id as number, playerName: (p.fullName as string) || "Unknown", position: (p.position as string) || "?", teamId: 0, ownerName: "Free Agent", seasonPoints: 0, avgPoints: (p.avgPoints as number) || 0, projectedTotal: null, keeperValue: 0, keeperValueFuture: 0, injuryStatus: (p.injuryStatus as string) || "", appliedStats: {} }))
          .filter(p => p.avgPoints > 0);
        return calcWaiverReplacementCost(freeAgentPlayers);
      }),

    // ── STRATEGY MODE CONTEXT ───────────────────────────────────────────────────
    strategyMode: publicProcedure
      .input(z.object({ season: z.number(), teamId: z.number(), currentWeek: z.number().optional().default(1), manualOverride: z.enum(["win_now", "long_term", "balanced"]).optional() }))
      .query(async ({ input }) => {
        const { buildStrategyModeContext } = await import("./analytics_additions");
        const data = await getSeasonData(input.season);
        if (!data) return null;
        const teams = normalizeTeams(data);
        const team = teams.find(t => t.teamId === input.teamId);
        if (!team) return null;
        return buildStrategyModeContext({ wins: (team.wins as number) || 0, losses: (team.losses as number) || 0, ties: (team.ties as number) || 0 }, input.currentWeek, 14, input.manualOverride);
      }),
  }),

  // ── DRAFT OPTIMIZER ──────────────────────────────────────────────────────────
  draftOptimizer: protectedProcedure
    .input(z.object({
      season: z.number(),
      draftSlot: z.number().optional().default(11),
      weeksRemaining: z.number().optional().default(10),
    }))
    .query(async ({ input }) => {
      const data = await getSeasonData(input.season);
      if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "No data for season. Sync ESPN first." });
      const rosters = normalizeRosters(data) as Record<string, unknown>[];
      const teams = normalizeTeams(data);
      const teamOwnerMap: Record<number, string> = {};
      for (const t of teams) teamOwnerMap[t.teamId as number] = t.owners as string;
      const allPlayers: PlayerRow[] = rosters.map(r => ({
        playerId: r.playerId as number,
        playerName: (r.playerName as string) || "Unknown",
        position: (r.position as string) || "?",
        teamId: r.teamId as number,
        ownerName: teamOwnerMap[r.teamId as number] || "Unknown",
        seasonPoints: (r.appliedTotal as number) || 0,
        avgPoints: (r.appliedAverage as number) || (r.avgPoints as number) || 0,
        projectedTotal: null,
        keeperValue: (r.keeperValue as number) || 0,
        keeperValueFuture: (r.keeperValueFuture as number) || 0,
        injuryStatus: (r.injuryStatus as string) || "",
        appliedStats: {},
      }));
      const draftPicks = normalizeDraftPicks(data) as Record<string, unknown>[];
      const keeperPlayerIds = new Set(draftPicks.filter(p => p.keeper === true).map(p => p.playerId as number));
      const availablePlayers = allPlayers.filter(p => !keeperPlayerIds.has(p.playerId));
      const removedKeepers = allPlayers.filter(p => keeperPlayerIds.has(p.playerId)).map(p => ({ playerId: p.playerId, playerName: p.playerName, position: p.position, ownerName: p.ownerName, avgPoints: p.avgPoints }));
      const vorpResults = calcVORP(availablePlayers);
      const scarcityResults = calcPositionalScarcity(availablePlayers, []);
      const rosResults = calcROSValue(availablePlayers, input.weeksRemaining);
      const enriched = availablePlayers.map(p => {
        const vorp = vorpResults.find(v => v.playerId === p.playerId);
        const ros = rosResults.find(r => r.playerId === p.playerId);
        return { playerId: p.playerId, playerName: p.playerName, position: p.position, ownerName: p.ownerName, avgPoints: Math.round(p.avgPoints * 10) / 10, vorp: vorp?.vorp ?? 0, vorpTier: vorp?.vorpTier ?? "Borderline", rosValue: ros?.rosAdjusted ?? 0, injuryRisk: ros?.injuryRisk ?? "None", compositeScore: Math.round((p.avgPoints * 2) + (vorp?.vorp ?? 0) * 1.5) };
      }).sort((a, b) => b.compositeScore - a.compositeScore);
      const positions = ["QB", "RB", "WR", "TE"];
      const tieredBoard: Record<string, { tier: number; tierLabel: string; players: typeof enriched; }[]> = {};
      for (const pos of positions) {
        const posPlayers = enriched.filter(p => p.position === pos);
        const tiers: { tier: number; tierLabel: string; players: typeof enriched; }[] = [];
        let currentTier: typeof enriched = [];
        let tierNum = 1;
        const tierLabels = ["Elite", "High-end starter", "Starter", "Borderline starter", "Depth"];
        for (let i = 0; i < posPlayers.length; i++) {
          currentTier.push(posPlayers[i]);
          const next = posPlayers[i + 1];
          const isGap = !next || (posPlayers[i].compositeScore - next.compositeScore) > 8;
          const isTierFull = currentTier.length >= 6;
          if ((isGap || isTierFull) && currentTier.length > 0) {
            tiers.push({ tier: tierNum, tierLabel: tierLabels[tierNum - 1] || `Tier ${tierNum}`, players: currentTier });
            currentTier = []; tierNum++;
            if (tierNum > 5) break;
          }
        }
        if (currentTier.length > 0) tiers.push({ tier: tierNum, tierLabel: "Depth", players: currentTier });
        tieredBoard[pos] = tiers;
      }
      const scarcePositions = scarcityResults.filter(s => s.scarcityScore >= 60).map(s => ({ position: s.position, scarcityScore: s.scarcityScore, scarcityLabel: s.scarcityLabel, topFreeAgentAvg: s.topFreeAgentAvg, alert: s.scarcityScore >= 80 ? `Only ${s.availableStarters} ${s.position} starter slots remain unclaimed` : `${s.position} depth is thinning — ${s.availableStarters} quality starters available` }));
      const TEAMS = 14;
      const rodRecommendations: { round: number; pickInRound: number; overallPick: number; pickValue: number; recommendation: string; topAvailable: { playerName: string; position: string; compositeScore: number; }[]; }[] = [];
      for (let round = 1; round <= 14; round++) {
        const pickInRound = round % 2 === 1 ? input.draftSlot : (TEAMS + 1 - input.draftSlot);
        const overallPick = (round - 1) * TEAMS + pickInRound;
        const pickValue = calcPickValue(round, pickInRound);
        const targetPos = round <= 3 ? ["RB", "WR"] : round <= 5 ? ["WR", "RB", "TE"] : round <= 8 ? ["QB", "WR", "RB"] : ["RB", "WR", "TE", "QB"];
        const stillAvailable = enriched.filter(p => targetPos.includes(p.position)).slice(overallPick - 1, overallPick + 4);
        const rec = round === 1 ? "Priority: elite RB or WR — do not reach for QB or TE" : round === 2 ? "Fill the opposite of Round 1 — RB/WR balance is critical" : round <= 4 ? "Target TE if elite option fell, otherwise best RB/WR on board" : round <= 7 ? "QB window opens here — mid-tier QBs score similarly in PPR" : round <= 10 ? "Handcuffs, upside sleepers, depth RBs" : "K and DEF in rounds 13-14 only — never earlier";
        rodRecommendations.push({ round, pickInRound, overallPick, pickValue, recommendation: rec, topAvailable: stillAvailable.slice(0, 3).map(p => ({ playerName: p.playerName, position: p.position, compositeScore: p.compositeScore })) });
      }
      const positionCounts: Record<string, number> = {};
      for (const p of availablePlayers) positionCounts[p.position] = (positionCounts[p.position] || 0) + 1;
      return { season: input.season, draftSlot: input.draftSlot, computedAt: new Date().toISOString(), totalAvailable: availablePlayers.length, removedKeepers, keeperCount: removedKeepers.length, tieredBoard, scarcePositions, rodRecommendations, scarcityResults, positionCounts };
    }),
  // ── WEEKLY STATS ─────────────────────────────────────────────────────────────
  weeklyStats: router({
  /** Fetch and cache weekly stats for a season (all weeks or a specific week) */
  fetchAndCache: protectedProcedure
    .input(z.object({
      season: z.number().int().min(2018).max(2030),
      week: z.number().int().min(1).max(18).optional(), // if omitted, fetch all weeks
      maxWeek: z.number().int().min(1).max(18).default(17),
      forceRefresh: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const { fetchWeeklyStatsForPeriod, fetchAllWeeksForSeason } = await import("./weeklyStatsService");
      const { upsertWeeklyStats, getCachedWeeksForSeason, deleteWeeklyStatsForSeason } = await import("./db");

      if (input.forceRefresh) {
        if (input.week) {
          // Delete just this week's data
          const db = await import("./db");
          const { getDb } = db;
          const { weeklyPlayerStats } = await import("../drizzle/schema");
          const { eq, and } = await import("drizzle-orm");
          const dbConn = await getDb();
          if (dbConn) await dbConn.delete(weeklyPlayerStats).where(and(eq(weeklyPlayerStats.season, input.season), eq(weeklyPlayerStats.week, input.week)));
        } else {
          await deleteWeeklyStatsForSeason(input.season);
        }
      }

      if (input.week) {
        // Fetch a single week
        const cachedWeeks = await getCachedWeeksForSeason(input.season);
        if (!input.forceRefresh && cachedWeeks.includes(input.week)) {
          return { status: "cached", weeksAttempted: 1, weeksFetched: 0, totalRows: 0, errors: [], message: `Week ${input.week} already cached` };
        }
        const result = await fetchWeeklyStatsForPeriod(input.season, input.week);
        if (result.error) return { status: "error", weeksAttempted: 1, weeksFetched: 0, totalRows: 0, errors: [{ week: input.week, error: result.error }], message: result.error };
        await upsertWeeklyStats(result.rows);
        return { status: "ok", weeksAttempted: 1, weeksFetched: 1, totalRows: result.rows.length, errors: [], message: `Week ${input.week}: ${result.rows.length} players cached` };
      } else {
        // Fetch all weeks, skip already-cached ones unless forceRefresh
        const cachedWeeks = input.forceRefresh ? [] : await getCachedWeeksForSeason(input.season);
        const result = await fetchAllWeeksForSeason(input.season, input.maxWeek);
        // Only upsert weeks not already cached
        const newRows = input.forceRefresh ? result.allRows : result.allRows.filter(r => !cachedWeeks.includes(r.week));
        if (newRows.length > 0) await upsertWeeklyStats(newRows);
        return {
          status: result.errors.length === 0 ? "ok" : "partial",
          weeksAttempted: result.weeksAttempted,
          weeksFetched: result.weeksFetched,
          totalRows: newRows.length,
          errors: result.errors,
          message: `${result.weeksFetched} weeks fetched, ${newRows.length} rows cached`,
        };
      }
    }),

  /** Get cached weekly stats for a season */
  getBySeason: protectedProcedure
    .input(z.object({ season: z.number().int().min(2018).max(2030) }))
    .query(async ({ input }) => {
      const { getWeeklyStatsBySeason, getCachedWeeksForSeason } = await import("./db");
      const rows = await getWeeklyStatsBySeason(input.season);
      const cachedWeeks = await getCachedWeeksForSeason(input.season);
      return { rows, cachedWeeks, totalRows: rows.length };
    }),

  /** Get weekly stats for a specific player */
  getByPlayer: protectedProcedure
    .input(z.object({
      season: z.number().int().min(2018).max(2030),
      playerId: z.number().int(),
    }))
    .query(async ({ input }) => {
      const { getWeeklyStatsByPlayer } = await import("./db");
      const rows = await getWeeklyStatsByPlayer(input.season, input.playerId);
      return { rows, weekCount: rows.length };
    }),

  /** Get stats for a specific week */
  getByWeek: protectedProcedure
    .input(z.object({
      season: z.number().int().min(2018).max(2030),
      week: z.number().int().min(1).max(18),
    }))
    .query(async ({ input }) => {
      const { getWeeklyStatsByWeek } = await import("./db");
      const rows = await getWeeklyStatsByWeek(input.season, input.week);
      return { rows, playerCount: rows.length };
    }),

  /** Get trend data for a player (last N weeks) */
  getPlayerTrend: protectedProcedure
    .input(z.object({
      season: z.number().int().min(2018).max(2030),
      playerId: z.number().int(),
      lastNWeeks: z.number().int().min(1).max(17).default(4),
    }))
    .query(async ({ input }) => {
      const { getWeeklyStatsByPlayer } = await import("./db");
      const { computePlayerTrend } = await import("./weeklyStatsService");
      const rawRows = await getWeeklyStatsByPlayer(input.season, input.playerId);
      if (rawRows.length === 0) return null;
      const rows = rawRows.map(r => ({ ...r, targets: r.targets ?? 0, receptions: r.receptions ?? 0, receivingYards: r.receivingYards ?? 0, receivingTDs: r.receivingTDs ?? 0, rushingAttempts: r.rushingAttempts ?? 0, rushingYards: r.rushingYards ?? 0, rushingTDs: r.rushingTDs ?? 0, passingAttempts: r.passingAttempts ?? 0, completions: r.completions ?? 0, passingYards: r.passingYards ?? 0, passingTDs: r.passingTDs ?? 0, interceptions: r.interceptions ?? 0, snapCount: r.snapCount ?? 0, snapPct: r.snapPct ?? 0, fantasyPoints: r.fantasyPoints ?? 0 }));
      return computePlayerTrend(rows, input.playerId, input.lastNWeeks);
    }),
  /** Get trend data for multiple players by name (fuzzy match) */
  getPlayerTrendsByName: protectedProcedure
    .input(z.object({
      season: z.number().int().min(2018).max(2030),
      playerNames: z.array(z.string()).max(10),
      lastNWeeks: z.number().int().min(1).max(17).default(4),
    }))
    .query(async ({ input }) => {
      const { getWeeklyStatsBySeason } = await import("./db");
      const { computePlayerTrend } = await import("./weeklyStatsService");
        const rawAllRows = await getWeeklyStatsBySeason(input.season);
      if (rawAllRows.length === 0) return [];
      const allRows = rawAllRows.map(r => ({ ...r, targets: r.targets ?? 0, receptions: r.receptions ?? 0, receivingYards: r.receivingYards ?? 0, receivingTDs: r.receivingTDs ?? 0, rushingAttempts: r.rushingAttempts ?? 0, rushingYards: r.rushingYards ?? 0, rushingTDs: r.rushingTDs ?? 0, passingAttempts: r.passingAttempts ?? 0, completions: r.completions ?? 0, passingYards: r.passingYards ?? 0, passingTDs: r.passingTDs ?? 0, interceptions: r.interceptions ?? 0, snapCount: r.snapCount ?? 0, snapPct: r.snapPct ?? 0, fantasyPoints: r.fantasyPoints ?? 0 }));
      // Build unique player list
      const playerMap = new Map<number, string>();
      for (const r of allRows) playerMap.set(r.playerId, r.playerName);
      const results = [];
      for (const name of input.playerNames) {
        const nameLower = name.toLowerCase();
        let bestId: number | null = null;
        let bestScore = 0;
        for (const [pid, pname] of Array.from(playerMap.entries())) {
          const pLower = pname.toLowerCase();
          if (pLower === nameLower) { bestId = pid; break; }
          const queryWords = nameLower.split(" ").filter(Boolean);
          const matchCount = queryWords.filter(w => pLower.includes(w)).length;
          const score = matchCount / queryWords.length;
          if (score > bestScore) { bestScore = score; bestId = pid; }
        }
        if (bestId && bestScore >= 0.5) {
          const trend = computePlayerTrend(allRows, bestId, input.lastNWeeks);
          if (trend) results.push({ searchName: name, ...trend });
        }
      }
      return results;
    }),

  /** Get which weeks are cached for a season */
  getCachedWeeks: protectedProcedure
    .input(z.object({ season: z.number().int().min(2018).max(2030) }))
    .query(async ({ input }) => {
      const { getCachedWeeksForSeason } = await import("./db");
      const weeks = await getCachedWeeksForSeason(input.season);
      return { season: input.season, cachedWeeks: weeks, weekCount: weeks.length };
    }),
  }),

  schedule: router({
    /** Get all scheduled jobs */
    list: publicProcedure.query(async () => {
      return getScheduledJobs();
    }),

    /** Create or re-register the weekly ESPN refresh Heartbeat job */
    create: protectedProcedure
      .input(z.object({
        cronExpression: z.string().default("0 0 6 * * 1"), // Monday 06:00 UTC
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        const job = await createHeartbeatJob({
          name: "weekly-espn-refresh",
          cron: input.cronExpression,
          path: "/api/scheduled/espn-refresh",
          description: input.description ?? "Weekly ESPN data refresh for seasons 2025 and 2026",
        }, sessionToken);
        await upsertScheduledJob({
          name: "weekly-espn-refresh",
          description: input.description ?? "Weekly ESPN data refresh for seasons 2025 and 2026",
          cronExpression: input.cronExpression,
          callbackPath: "/api/scheduled/espn-refresh",
          taskUid: job.taskUid,
          isEnabled: true,
          nextRunAt: job.nextExecutionAt ? new Date(job.nextExecutionAt) : undefined,
        });
        return { taskUid: job.taskUid, nextExecutionAt: job.nextExecutionAt };
      }),

    /** Pause the weekly ESPN refresh job */
    pause: protectedProcedure
      .input(z.object({ taskUid: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        await updateHeartbeatJob(input.taskUid, { enable: false }, sessionToken);
        await upsertScheduledJob({ name: "weekly-espn-refresh", taskUid: input.taskUid, isEnabled: false });
        return { ok: true };
      }),

    /** Resume the weekly ESPN refresh job */
    resume: protectedProcedure
      .input(z.object({ taskUid: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        const result = await updateHeartbeatJob(input.taskUid, { enable: true }, sessionToken);
        await upsertScheduledJob({
          name: "weekly-espn-refresh",
          taskUid: input.taskUid,
          isEnabled: true,
          nextRunAt: result.nextExecutionAt ? new Date(result.nextExecutionAt) : undefined,
        });
        return { ok: true, nextExecutionAt: result.nextExecutionAt };
      }),

    /** Delete the weekly ESPN refresh job */
    delete: protectedProcedure
      .input(z.object({ taskUid: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        await deleteHeartbeatJob(input.taskUid, sessionToken);
        await upsertScheduledJob({ name: "weekly-espn-refresh", taskUid: input.taskUid, isEnabled: false });
        return { ok: true };
      }),
  }),

  // ─── Draft Board (FantasyPros ECR + ADP + PFR stats) ─────────────────────────
  draftBoard: router({
    /**
     * Mock draft setup — returns all league owners with DNA, keeper recs, and draft order.
     * Used by MockDraftSimulator to pre-populate the setup screen.
     */
    mockSetup: publicProcedure.query(async () => {
      const { calcLeagueDNA } = await import("./leagueDNA");
      const { buildManagerRawData } = await import("./dnaRouter");
      const { buildKeeperRecommendations } = await import("./keeperRecommendationEngine");
      const cachedSeasons = (await getAllCachedSeasons()).sort((a: number, b: number) => a - b);
      if (cachedSeasons.length === 0) return { owners: [], totalTeams: 0 };
      const latestSeason = cachedSeasons[cachedSeasons.length - 1];
      const data2025 = await getSeasonData(latestSeason);
      if (!data2025) return { owners: [], totalTeams: 0 };
      // 1. Draft order
      const draftOrderRaw = normalizeDraftOrder(data2025);
      const pickOrder = draftOrderRaw?.pickOrder ?? [];
      const totalTeams = pickOrder.length || 14;
      // 2. DNA profiles
      const managers = await buildManagerRawData();
      const dnaProfiles = calcLeagueDNA(managers);
      // 3. Keeper eligibility
      const keepers2025: Record<number, Array<{ playerId: number; playerName: string; position: string; roundId: number }>> = {};
      const data2025picks = normalizeDraftPicks(data2025);
      for (const p of data2025picks) {
        if (!p.keeper) continue;
        const tid = p.teamId as number;
        const pid = p.playerId as number;
        if (!keepers2025[tid]) keepers2025[tid] = [];
        keepers2025[tid].push({
          playerId: pid,
          playerName: (p.playerName as string) || `Player#${pid}`,
          position: (p.position as string) || "?",
          roundId: p.roundId as number,
        });
      }
      const prevSeason = latestSeason - 1;
      const keepers2024: Record<number, Record<number, number>> = {};
      if (cachedSeasons.includes(prevSeason)) {
        const data2024 = await getSeasonData(prevSeason);
        if (data2024) {
          const picks2024 = normalizeDraftPicks(data2024);
          for (const p of picks2024) {
            if (!p.keeper) continue;
            const tid = p.teamId as number;
            const pid = p.playerId as number;
            if (!keepers2024[tid]) keepers2024[tid] = {};
            keepers2024[tid][pid] = p.roundId as number;
          }
        }
      }
      const teams2025 = normalizeTeams(data2025);
      const adpRoundMap: Record<string, number> = { QB: 6, RB: 3, WR: 3, TE: 5, K: 14, DEF: 13 };
      const eligibilityData = teams2025.map(team => {
        const tid = team.teamId as number;
        const tname = (team.teamName as string) || `Team ${tid}`;
        const my2025Keepers = keepers2025[tid] || [];
        const my2024Keepers = keepers2024[tid] || {};
        const players = my2025Keepers.map(k => {
          const keptIn2024 = my2024Keepers[k.playerId] !== undefined;
          const isIneligible = keptIn2024;
          const roundCost2026 = isIneligible ? null : k.roundId - 1;
          const adp = adpRoundMap[k.position?.toUpperCase()] ?? 7;
          const savings = roundCost2026 !== null ? adp - roundCost2026 : 0;
          const valueTier = isIneligible ? "ineligible" : savings >= 4 ? "elite" : savings >= 2 ? "good" : savings >= 0 ? "fair" : "poor";
          return {
            playerId: k.playerId, playerName: k.playerName, position: k.position,
            round2025: k.roundId, round2024: keptIn2024 ? my2024Keepers[k.playerId] : null,
            roundCost2026, consecutiveYears: keptIn2024 ? 2 : 1,
            isIneligible, valueTier, valueLabel: isIneligible ? "Must Return" : valueTier,
          };
        });
        return { teamId: tid, teamName: tname, players, ineligibleCount: players.filter(p => p.isIneligible).length, eligibleCount: players.filter(p => !p.isIneligible).length };
      });
      const draftOrderForEngine = pickOrder.map(p => ({
        teamId: p.teamId,
        teamName: p.name ?? `Team ${p.teamId}`,
        ownerName: p.owners,
        pickNumber: p.position,
      }));
      const keeperRecs = buildKeeperRecommendations(eligibilityData, dnaProfiles, draftOrderForEngine);
      // 4. Merge into per-owner rows
      const owners = pickOrder.map(slot => {
        const tid = slot.teamId;
        const ownerName = slot.owners || `Team ${tid}`;
        const teamName = slot.name || `Team ${tid}`;
        const dna = dnaProfiles.find(d =>
          d.ownerName && ownerName.toLowerCase().includes(d.ownerName.toLowerCase().split(" ")[0].toLowerCase())
        ) ?? null;
        const rec = keeperRecs.find(r => r.teamId === tid) ?? null;
        const isRod = teamName.toLowerCase().includes("str8") ||
          teamName.toLowerCase().includes("rodzilla") ||
          ownerName.toLowerCase().includes("rod");
        return {
          teamId: tid,
          teamName,
          ownerName,
          draftSlot: slot.position,
          isRod,
          gmArchetype: dna?.gmArchetype ?? "Balanced Manager",
          draftStyleBadge: dna?.draft.draftStyleBadge ?? "Balanced",
          reachPositions: dna?.draft.reachPositions ?? [] as string[],
          valuePositions: dna?.draft.valuePositions ?? [] as string[],
          biasVsLeague: dna?.draft.biasVsLeague ?? {} as Record<string, number>,
          round1Distribution: dna?.draft.round1Distribution ?? {} as Record<string, number>,
          keeperRate: dna?.draft.keeperRate ?? 0,
          tiltScore: dna?.tilt.tiltScore ?? 50,
          exploitabilityScore: dna?.exploitabilityScore ?? 50,
          recommendedKeeper: rec?.primaryRecommendation ? {
            playerId: rec.primaryRecommendation.playerId,
            playerName: rec.primaryRecommendation.playerName,
            position: rec.primaryRecommendation.position,
            roundCost: rec.primaryRecommendation.roundCost2026,
            roundSavings: rec.primaryRecommendation.roundSavings,
            valueTier: rec.primaryRecommendation.valueTier,
          } : null,
          allKeeperOptions: (rec?.allOptions ?? []).map(o => ({
            playerId: o.playerId,
            playerName: o.playerName,
            position: o.position,
            roundCost: o.roundCost2026,
            roundSavings: o.roundSavings,
            valueTier: o.valueTier,
          })),
          keeperPrediction: rec?.dnaPrediction.keeperBehavior ?? "",
        };
      });
      return { owners, totalTeams };
    }),
    /** Get the full merged draft board (ECR + ADP + PFR). Cached 6 hours. */
    getPlayers: publicProcedure
      .input(z.object({ forceRefresh: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        const result = await getDraftBoard(input?.forceRefresh ?? false);
        return result;
      }),

    /** Compare 2–3 players by name and return ECR, ADP, PFR stats side-by-side */
    comparePlayers: publicProcedure
      .input(z.object({ names: z.array(z.string()).min(2).max(3) }))
      .query(async ({ input }) => {
        const board = await getDraftBoard();
        const results = input.names.map((name) => {
          const norm = name.toLowerCase().replace(/[*+'.]/g, "").trim();
          const player = board.players.find(
            (p) => p.name.toLowerCase().replace(/[*+'.]/g, "").trim() === norm ||
                   p.shortName.toLowerCase().replace(/[*+'.]/g, "").trim() === norm
          );
          return { name, player: player ?? null };
        });
        return { players: results, fetchedAt: board.fetchedAt };
      }),

    /** Search players by name prefix (for autocomplete) */
    searchPlayers: publicProcedure
      .input(z.object({ query: z.string().min(1), limit: z.number().optional() }))
      .query(async ({ input }) => {
        const board = await getDraftBoard();
        const q = input.query.toLowerCase();
        const matches = board.players
          .filter((p) => p.name.toLowerCase().includes(q) || p.shortName.toLowerCase().includes(q))
          .slice(0, input.limit ?? 20);
        return matches;
      }),

    /** Get a single player's full profile (ECR + ADP + PFR) */
    getPlayer: publicProcedure
      .input(z.object({ name: z.string() }))
      .query(async ({ input }) => {
        const board = await getDraftBoard();
        const norm = input.name.toLowerCase().replace(/[*+'.]/g, "").trim();
        const player = board.players.find(
          (p) => p.name.toLowerCase().replace(/[*+'.]/g, "").trim() === norm ||
                 p.shortName.toLowerCase().replace(/[*+'.]/g, "").trim() === norm
        );
        return player ?? null;
      }),

    /** Save a completed mock draft to the database */
    saveDraft: protectedProcedure
      .input(z.object({
        label: z.string().max(128).optional(),
        strategyLabel: z.string().max(64).optional(),
        champEquityScore: z.number().optional(),
        draftSlot: z.number().int().min(1).max(14),
        totalTeams: z.number().int().default(14),
        totalRounds: z.number().int().default(15),
        grade: z.string().max(4),
        avgEcr: z.number(),
        totalVbd: z.number().default(0),
        rodPicksJson: z.array(z.any()),
        allPicksJson: z.array(z.any()),
      }))
      .mutation(async ({ ctx, input }) => {
        const dbMod = await import("./db");
        const { getDb } = dbMod;
        const { mockDraftResults } = await import("../drizzle/schema");
        const dbConn = await getDb();
        if (!dbConn) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const result = await dbConn.insert(mockDraftResults).values({
          userId: ctx.user.id,
          label: input.label ?? `Mock Draft — Slot ${input.draftSlot}`,
          strategyLabel: input.strategyLabel ?? "BPA",
          champEquityScore: Math.round((input.champEquityScore ?? 0) * 10),
          draftSlot: input.draftSlot,
          totalTeams: input.totalTeams,
          totalRounds: input.totalRounds,
          grade: input.grade,
          avgEcr: Math.round(input.avgEcr * 10),
          totalVbd: Math.round(input.totalVbd),
          rodPicksJson: input.rodPicksJson,
          allPicksJson: input.allPicksJson,
        });
        return { id: Number((result as { insertId?: unknown }).insertId ?? 0) };
      }),

    /** List all saved mock drafts for the current user */
    listDrafts: protectedProcedure
      .query(async ({ ctx }) => {
        const dbMod = await import("./db");
        const { getDb } = dbMod;
        const { mockDraftResults } = await import("../drizzle/schema");
        const { desc, eq: eqOp } = await import("drizzle-orm");
        const dbConn = await getDb();
        if (!dbConn) return [];
        const rows = await dbConn
          .select({
            id: mockDraftResults.id,
            label: mockDraftResults.label,
            strategyLabel: mockDraftResults.strategyLabel,
            champEquityScore: mockDraftResults.champEquityScore,
            draftSlot: mockDraftResults.draftSlot,
            totalTeams: mockDraftResults.totalTeams,
            totalRounds: mockDraftResults.totalRounds,
            grade: mockDraftResults.grade,
            avgEcr: mockDraftResults.avgEcr,
            totalVbd: mockDraftResults.totalVbd,
            createdAt: mockDraftResults.createdAt,
          })
          .from(mockDraftResults)
          .where(eqOp(mockDraftResults.userId, ctx.user.id))
          .orderBy(desc(mockDraftResults.createdAt))
          .limit(50);
        return rows.map((r) => ({
          ...r,
          avgEcr: r.avgEcr / 10,
          champEquityScore: (r.champEquityScore ?? 0) / 10,
        }));
      }),

    /** Get a single saved mock draft with full pick data */
    getDraft: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const dbMod = await import("./db");
        const { getDb } = dbMod;
        const { mockDraftResults } = await import("../drizzle/schema");
        const { eq: eqOp, and: andOp } = await import("drizzle-orm");
        const dbConn = await getDb();
        if (!dbConn) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await dbConn
          .select()
          .from(mockDraftResults)
          .where(andOp(eqOp(mockDraftResults.id, input.id), eqOp(mockDraftResults.userId, ctx.user.id)))
          .limit(1);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        const r = rows[0];
        return { ...r, avgEcr: r.avgEcr / 10 };
      }),

    /** Compare 2-4 saved mock drafts side-by-side */
    compareDrafts: protectedProcedure
      .input(z.object({ ids: z.array(z.number().int()).min(2).max(4) }))
      .query(async ({ ctx, input }) => {
        const dbMod = await import("./db");
        const { getDb } = dbMod;
        const { mockDraftResults } = await import("../drizzle/schema");
        const { inArray, eq: eqOp } = await import("drizzle-orm");
        const dbConn = await getDb();
        if (!dbConn) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const rows = await dbConn
          .select()
          .from(mockDraftResults)
          .where(inArray(mockDraftResults.id, input.ids))
          .limit(4);
        // Ensure all rows belong to this user
        const owned = rows.filter((r) => r.userId === ctx.user.id);
        if (owned.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
        return owned.map((r) => {
          const rodPicks = (r.rodPicksJson as Array<Record<string, unknown>>) ?? [];
          // Compute positional breakdown from Rod's picks
          const posCounts: Record<string, number> = {};
          let totalEcrSum = 0;
          let totalVbd = 0;
          let pickCount = 0;
          for (const p of rodPicks) {
            if (p.isKeeper) continue; // exclude keepers from ECR stats
            const pos = (p.position as string) ?? "?";
            posCounts[pos] = (posCounts[pos] ?? 0) + 1;
            const ecr = (p.ecrRank as number) ?? 0;
            if (ecr > 0) { totalEcrSum += ecr; pickCount++; }
            totalVbd += (p.vbd as number) ?? 0;
          }
          const computedAvgEcr = pickCount > 0 ? Math.round(totalEcrSum / pickCount * 10) / 10 : r.avgEcr / 10;
          return {
            id: r.id,
            label: r.label,
            strategyLabel: r.strategyLabel ?? "BPA",
            champEquityScore: (r.champEquityScore ?? 0) / 10,
            draftSlot: r.draftSlot,
            totalTeams: r.totalTeams,
            totalRounds: r.totalRounds,
            grade: r.grade,
            avgEcr: r.avgEcr / 10,
            computedAvgEcr,
            totalVbd: r.totalVbd,
            posCounts,
            rodPicks,
            createdAt: r.createdAt,
          };
        });
      }),

    /** Delete a saved mock draft */
    deleteDraft: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const dbMod = await import("./db");
        const { getDb } = dbMod;
        const { mockDraftResults } = await import("../drizzle/schema");
        const { eq: eqOp, and: andOp } = await import("drizzle-orm");
        const dbConn = await getDb();
        if (!dbConn) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await dbConn
          .delete(mockDraftResults)
          .where(andOp(eqOp(mockDraftResults.id, input.id), eqOp(mockDraftResults.userId, ctx.user.id)));
        return { success: true };
      }),
    /** Get ADP trend history for a player (last 10 snapshots) */
    getAdpTrend: publicProcedure
      .input(z.object({ fpId: z.number().int(), limit: z.number().int().min(2).max(30).optional() }))
      .query(async ({ input }) => {
        return getAdpTrend(input.fpId, input.limit ?? 10);
      }),
    /** Get draft history for a player across all seasons — which owners drafted them, what round/year */
    getPlayerDraftHistory: publicProcedure
      .input(z.object({ playerName: z.string().min(2) }))
      .query(async ({ input }) => {
        const seasons = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
        const normInput = input.playerName.toLowerCase().replace(/[*+'.,]/g, "").trim();
        const nameParts = normInput.split(" ").filter(Boolean);
        const results: Array<{
          season: number;
          ownerName: string;
          teamName: string;
          round: number;
          pick: number;
          isKeeper: boolean;
        }> = [];
        for (const season of seasons) {
          try {
            const [draftRow, teamsRow, membersRow] = await Promise.all([
              getCachedView(season, "draftDetail"),
              getCachedView(season, "teams"),
              getCachedView(season, "members"),
            ]);
            if (!draftRow || !teamsRow || !membersRow) continue;
            const draftPayload = draftRow.payload as Record<string, unknown>;
            const teamsPayload = teamsRow.payload as Record<string, unknown>;
            const membersPayload = membersRow.payload as Record<string, unknown>;
            if (!draftPayload?.picks) continue;
            const picks = draftPayload.picks as Array<Record<string, unknown>>;
            const teams = (Array.isArray(teamsPayload) ? teamsPayload : (teamsPayload.teams ?? [])) as Array<Record<string, unknown>>;
            const members = (Array.isArray(membersPayload) ? membersPayload : (membersPayload.members ?? [])) as Array<Record<string, unknown>>;
            // Build teamId -> owner name map
            const teamOwnerMap = new Map<number, { ownerName: string; teamName: string }>();
            for (const t of teams) {
              const tid = t.id as number;
              const tname = ((t.location as string) || "") + " " + ((t.nickname as string) || "");
              const primaryOwner = t.primaryOwner as string | undefined;
              if (primaryOwner) {
                const member = members.find((m) => (m.id as string) === primaryOwner);
                if (member) {
                  const fname = ((member.firstName as string) || "").trim();
                  const lname = ((member.lastName as string) || "").trim();
                  teamOwnerMap.set(tid, { ownerName: `${fname} ${lname}`.trim(), teamName: tname.trim() });
                }
              }
            }
            for (const pick of picks) {
              const pname = ((pick.playerName as string) || "").toLowerCase().replace(/[*+'.,]/g, "").trim();
              if (!pname) continue;
              // Match if all name parts are found in the pick name
              const matched = nameParts.length > 0 && nameParts.every(part => pname.includes(part));
              if (!matched) continue;
              const teamId = pick.teamId as number;
              const owner = teamOwnerMap.get(teamId);
              if (!owner) continue;
              results.push({
                season,
                ownerName: owner.ownerName,
                teamName: owner.teamName,
                round: (pick.roundId as number) || (pick.roundNum as number) || 0,
                pick: (pick.roundPickNumber as number) || (pick.overallPickNumber as number) || 0,
                isKeeper: !!(pick.keeper || pick.reservedForKeeper),
              });
            }
          } catch {
            // skip seasons with no data
          }
        }
        return results.sort((a, b) => b.season - a.season);
      }),
  }),
});
export type AppRouter = typeof appRouter;
