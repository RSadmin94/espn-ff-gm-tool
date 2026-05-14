/**
 * GM Decision Memory tRPC Router
 *
 * Exposes procedures for logging decisions, resolving outcomes,
 * retrieving the decision feed, and getting retrospective analysis.
 */
import { z } from "zod";
import { router, subscribedProcedure } from "./_core/trpc";
import {
  logDecision,
  resolveOutcome,
  getDecisionFeed,
  getAccuracyStats,
  getPatternAnalysis,
  getRetrospectiveAnalysis,
} from "./gmDecisionService";

export const gmDecisionRouter = router({
  // ── Log a new decision ──────────────────────────────────────────────────────
  logDecision: subscribedProcedure
    .input(
      z.object({
        toolSource: z.enum([
          "start_sit",
          "trade_analyzer",
          "waiver_wire",
          "trade_offer",
          "keeper_lab",
          "draft_war_room",
          "manual",
        ]),
        decisionType: z.enum([
          "start_sit",
          "trade_accept",
          "trade_reject",
          "waiver_add",
          "waiver_pass",
          "keeper_keep",
          "keeper_drop",
          "draft_pick",
          "manual",
        ]),
        description: z.string().min(1).max(500),
        recommendation: z.string().optional(),
        followedRecommendation: z.boolean().optional(),
        accepted: z.boolean(),
        playersInvolved: z.array(z.string()).optional(),
        counterparty: z.string().optional(),
        aiContext: z.string().optional(),
        season: z.number().int().min(2009).max(2030),
        weekNum: z.number().int().min(1).max(18).optional(),
        tags: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = await logDecision(input);
      return { success: true, decisionId: id };
    }),

  // ── Resolve outcome of a decision ──────────────────────────────────────────
  resolveOutcome: subscribedProcedure
    .input(
      z.object({
        decisionId: z.number().int().positive(),
        outcome: z.enum(["correct", "incorrect", "neutral"]),
        outcomeScore: z.number().int().min(-100).max(100).optional(),
        outcomeNotes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await resolveOutcome(input);
      return { success: true };
    }),

  // ── Get decision feed ───────────────────────────────────────────────────────
  getDecisionFeed: subscribedProcedure
    .input(
      z.object({
        season: z.number().int().optional(),
        toolSource: z.string().optional(),
        outcome: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const decisions = await getDecisionFeed(input ?? {});
      return decisions.map((d) => ({
        ...d,
        playersInvolved: d.playersInvolved ? JSON.parse(d.playersInvolved) as string[] : [],
      }));
    }),

  // ── Get accuracy stats ──────────────────────────────────────────────────────
  getAccuracyStats: subscribedProcedure
    .input(z.object({ season: z.number().int().optional() }).optional())
    .query(async ({ input }) => {
      return getAccuracyStats(input?.season);
    }),

  // ── Get pattern analysis ────────────────────────────────────────────────────
  getPatternAnalysis: subscribedProcedure
    .input(z.object({ season: z.number().int().optional() }).optional())
    .query(async ({ input }) => {
      return getPatternAnalysis(input?.season);
    }),

  // ── Get LLM retrospective analysis ─────────────────────────────────────────
  getRetrospective: subscribedProcedure
    .input(z.object({ season: z.number().int().optional() }).optional())
    .query(async ({ input }) => {
      const analysis = await getRetrospectiveAnalysis(input?.season);
      return { analysis };
    }),

  // ── Delete a decision ───────────────────────────────────────────────────────
  deleteDecision: subscribedProcedure
    .input(z.object({ decisionId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const { gmDecisions, gmDecisionTags } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.delete(gmDecisionTags).where(eq(gmDecisionTags.decisionId, input.decisionId));
      await db.delete(gmDecisions).where(eq(gmDecisions.id, input.decisionId));
      return { success: true };
    }),
});
