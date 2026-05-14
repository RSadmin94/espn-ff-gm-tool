/**
 * server/backtestingRouter.ts
 *
 * tRPC router for the backtesting dashboard.
 *
 * Public endpoints (read-only):
 *   backtest.summary              — overall accuracy summary
 *   backtest.startSitAccuracy     — start/sit hit rate + by-position breakdown
 *   backtest.monteCarloCalibration — win-probability calibration report
 *   backtest.tradeReport          — trade decision breakdown
 *   backtest.champEquityReport    — championship equity calibration
 *   backtest.startSitList         — paginated list of start/sit decisions
 *   backtest.tradeList            — paginated list of trade decisions
 *   backtest.mcList               — paginated list of MC predictions
 *
 * Protected endpoints (write):
 *   backtest.logStartSit          — log a new start/sit recommendation
 *   backtest.resolveStartSit      — manually resolve a start/sit decision
 *   backtest.autoResolveStartSit  — auto-resolve from weekly stats cache
 *   backtest.logTrade             — log a new trade evaluation
 *   backtest.updateTrade          — update Rod's decision or outcome rating
 *   backtest.logMonteCarlo        — log a new MC win-probability prediction
 *   backtest.resolveMonteCarlo    — resolve a MC prediction with actual scores
 *   backtest.logChampEquity       — log a champ equity prediction
 *   backtest.resolveChampEquity   — resolve champ equity at season end
 */

import { z } from "zod";
import { router, subscribedProcedure } from "./_core/trpc";
import {
  getBacktestSummary,
  calcStartSitAccuracy,
  calcMonteCarloCalibration,
  calcTradeDecisionReport,
  calcChampEquityReport,
  getStartSitDecisions,
  getTradeDecisions,
  getMonteCarloPredictions,
  logStartSitDecision,
  resolveStartSitDecision,
  autoResolveStartSitFromCache,
  logTradeDecision,
  updateTradeDecision,
  logMonteCarloPrediction,
  resolveMonteCarloPrediction,
  logChampEquityPrediction,
  resolveChampEquityPrediction,
} from "./backtestingService";

export const backtestingRouter = router({
  // ── Read endpoints ──────────────────────────────────────────────────────────

  summary: subscribedProcedure
    .input(z.object({ season: z.number().optional() }))
    .query(async ({ input }) => {
      return getBacktestSummary(input.season);
    }),

  startSitAccuracy: subscribedProcedure
    .input(z.object({ season: z.number().optional() }))
    .query(async ({ input }) => {
      return calcStartSitAccuracy(input.season);
    }),

  monteCarloCalibration: subscribedProcedure
    .input(z.object({ season: z.number().optional() }))
    .query(async ({ input }) => {
      return calcMonteCarloCalibration(input.season);
    }),

  tradeReport: subscribedProcedure
    .input(z.object({ season: z.number().optional() }))
    .query(async ({ input }) => {
      return calcTradeDecisionReport(input.season);
    }),

  champEquityReport: subscribedProcedure
    .input(z.object({ season: z.number().optional() }))
    .query(async ({ input }) => {
      return calcChampEquityReport(input.season);
    }),

  startSitList: subscribedProcedure
    .input(z.object({ season: z.number().optional() }))
    .query(async ({ input }) => {
      return getStartSitDecisions(input.season);
    }),

  tradeList: subscribedProcedure
    .input(z.object({ season: z.number().optional() }))
    .query(async ({ input }) => {
      return getTradeDecisions(input.season);
    }),

  mcList: subscribedProcedure
    .input(z.object({ season: z.number().optional() }))
    .query(async ({ input }) => {
      return getMonteCarloPredictions(input.season);
    }),

  // ── Write endpoints ─────────────────────────────────────────────────────────

  logStartSit: subscribedProcedure
    .input(
      z.object({
        season: z.number(),
        week: z.number(),
        playerAName: z.string(),
        playerAPosition: z.string(),
        playerAProjection: z.number(),
        playerAFloor: z.number(),
        playerACeiling: z.number(),
        playerABustPct: z.number(),
        playerBName: z.string(),
        playerBPosition: z.string(),
        playerBProjection: z.number(),
        playerBFloor: z.number(),
        playerBCeiling: z.number(),
        playerBBustPct: z.number(),
        recommendation: z.enum(["A", "B", "TOSS_UP"]),
        winProbabilityA: z.number(),
        agentConsensus: z.number().optional(),
        aiVerdict: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await logStartSitDecision({
        ...input,
        playerAActualPoints: null,
        playerBActualPoints: null,
        outcome: null,
        resolvedAt: null,
        notes: null,
      });
      return { id };
    }),

  resolveStartSit: subscribedProcedure
    .input(
      z.object({
        id: z.number(),
        playerAActualPoints: z.number(),
        playerBActualPoints: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const outcome = await resolveStartSitDecision(
        input.id,
        input.playerAActualPoints,
        input.playerBActualPoints
      );
      return { outcome };
    }),

  autoResolveStartSit: subscribedProcedure
    .input(z.object({ season: z.number(), week: z.number() }))
    .mutation(async ({ input }) => {
      const resolved = await autoResolveStartSitFromCache(input.season, input.week);
      return { resolved };
    }),

  logTrade: subscribedProcedure
    .input(
      z.object({
        season: z.number(),
        week: z.number(),
        assetsGiven: z.array(z.string()),
        assetsReceived: z.array(z.string()),
        valueGiven: z.number(),
        valueReceived: z.number(),
        verdict: z.enum(["WIN", "FAIR", "LOSS"]),
        champDeltaBefore: z.number().optional(),
        champDeltaAfter: z.number().optional(),
        aiSummary: z.string().optional(),
        rodDecision: z.enum(["ACCEPTED", "REJECTED", "PENDING"]).default("PENDING"),
      })
    )
    .mutation(async ({ input }) => {
      const id = await logTradeDecision({
        ...input,
        champDeltaBefore: input.champDeltaBefore ?? null,
        champDeltaAfter: input.champDeltaAfter ?? null,
        aiSummary: input.aiSummary ?? null,
        outcomeRating: null,
        outcomeNotes: null,
        resolvedAt: null,
      });
      return { id };
    }),

  updateTrade: subscribedProcedure
    .input(
      z.object({
        id: z.number(),
        rodDecision: z.enum(["ACCEPTED", "REJECTED", "PENDING"]).optional(),
        outcomeRating: z.enum(["GREAT", "GOOD", "NEUTRAL", "BAD", "TERRIBLE"]).optional(),
        outcomeNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...update } = input;
      await updateTradeDecision(id, update);
      return { success: true };
    }),

  logMonteCarlo: subscribedProcedure
    .input(
      z.object({
        season: z.number(),
        week: z.number(),
        teamName: z.string(),
        opponentName: z.string(),
        predictedWinPct: z.number(),
        projectedScore: z.number(),
        projectedFloor: z.number(),
        projectedCeiling: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await logMonteCarloPrediction({
        ...input,
        actualScore: null,
        actualOpponentScore: null,
        actualWon: null,
        resolvedAt: null,
      });
      return { id };
    }),

  resolveMonteCarlo: subscribedProcedure
    .input(
      z.object({
        id: z.number(),
        actualScore: z.number(),
        actualOpponentScore: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const actualWon = await resolveMonteCarloPrediction(
        input.id,
        input.actualScore,
        input.actualOpponentScore
      );
      return { actualWon };
    }),

  logChampEquity: subscribedProcedure
    .input(
      z.object({
        season: z.number(),
        week: z.number(),
        teamName: z.string(),
        predictedChampPct: z.number(),
        predictedPlayoffPct: z.number(),
        currentRank: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await logChampEquityPrediction({
        ...input,
        actuallyWonChamp: null,
        actuallyMadePlayoffs: null,
        finalRank: null,
        resolvedAt: null,
      });
      return { id };
    }),

  resolveChampEquity: subscribedProcedure
    .input(
      z.object({
        season: z.number(),
        teamName: z.string(),
        actuallyWonChamp: z.boolean(),
        actuallyMadePlayoffs: z.boolean(),
        finalRank: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      await resolveChampEquityPrediction(
        input.season,
        input.teamName,
        input.actuallyWonChamp,
        input.actuallyMadePlayoffs,
        input.finalRank
      );
      return { success: true };
    }),
});
