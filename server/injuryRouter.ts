// FILE: server/injuryRouter.ts
/**
 * Phase 1 — Injury Intelligence tRPC Router
 *
 * Mount this inside appRouter in routers.ts:
 *
 *   import { injuryRouter } from "./injuryRouter";
 *   // inside appRouter:
 *   injury: injuryRouter,
 *
 * Endpoints:
 *   injury.getAll        — return full injury report (cached)
 *   injury.refresh       — force re-fetch from ESPN, return fresh records
 *   injury.scores        — score a list of players { playerId, playerName, position }
 *   injury.startSit      — full start/sit verdict with injury context injected
 *   injury.waiverScout   — waiver intel with injury context injected
 */

import { z } from "zod";
import { router, publicProcedure, protectedProcedure, subscribedProcedure } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { TRPCError } from "@trpc/server";
import {
  getInjuries,
  fetchAndCacheInjuries,
  calcInjuryScores,
  buildInjuryPromptBlock,
  type InjuryScores,
} from "./injuryService";

// ─── Shared player input schema ───────────────────────────────────────────────

const PlayerInput = z.object({
  playerId: z.number(),
  playerName: z.string(),
  position: z.string(),
  avgPoints: z.number().optional().default(0),
  projectedPoints: z.number().optional().default(0),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const injuryRouter = router({

  /** Return full cached injury report. Fetches fresh if cache is empty. */
  getAll: publicProcedure.query(async () => {
    const injuries = await getInjuries();
    return {
      count: injuries.length,
      updatedAt: injuries[0]?.updatedAt ?? null,
      injuries,
    };
  }),

  /** Force re-fetch from ESPN and return fresh records. */
  refresh: protectedProcedure.mutation(async () => {
    const injuries = await fetchAndCacheInjuries();
    return {
      count: injuries.length,
      updatedAt: new Date().toISOString(),
      injuries,
    };
  }),

  /** Return injury scores for a list of players. */
  scores: subscribedProcedure
    .input(z.object({
      players: z.array(PlayerInput),
    }))
    .query(async ({ input }) => {
      const injuries = await getInjuries();
      const scores = calcInjuryScores(input.players, injuries);
      return scores;
    }),

  /**
   * Start/Sit Advisor — injury-aware.
   *
   * Accepts two players, fetches their injury scores, injects the data into
   * the LLM prompt as calculated facts, and returns a START/SIT verdict.
   *
   * This replaces / augments the existing start-sit logic: call this endpoint
   * from the Waiver Lab Start/Sit tab instead of the old generic advisor.
   */
  startSit: subscribedProcedure
    .input(z.object({
      playerA: PlayerInput,
      playerB: PlayerInput,
      context: z.string().optional().default(""),
      season: z.number().optional().default(2025),
    }))
    .mutation(async ({ input }) => {
      const injuries = await getInjuries();

      // Score both players
      const scores = calcInjuryScores(
        [input.playerA, input.playerB],
        injuries
      );
      const scoreA = scores[0]!;
      const scoreB = scores[1]!;

      // Apply volatility multiplier to projected points
      const adjPointsA = +(input.playerA.projectedPoints * scoreA.volatilityMultiplier).toFixed(1);
      const adjPointsB = +(input.playerB.projectedPoints * scoreB.volatilityMultiplier).toFixed(1);

      const injuryBlock = buildInjuryPromptBlock(scores);

      const systemPrompt = `You are an expert Fantasy Football analyst for the 14-team PPR keeper league "ATLANTAS FINEST FF".
The math below is pre-calculated — treat it as ground truth and do not contradict it.

${injuryBlock}

PROJECTED POINTS (after injury adjustment):
  ${input.playerA.playerName} (${input.playerA.position}): ${adjPointsA} pts (base: ${input.playerA.projectedPoints}, multiplier: ${scoreA.volatilityMultiplier.toFixed(2)}x)
  ${input.playerB.playerName} (${input.playerB.position}): ${adjPointsB} pts (base: ${input.playerB.projectedPoints}, multiplier: ${scoreB.volatilityMultiplier.toFixed(2)}x)

WORKLOAD CONFIDENCE:
  ${input.playerA.playerName}: ${scoreA.workloadConfidence}%
  ${input.playerB.playerName}: ${scoreB.workloadConfidence}%

Deliver a concise START/SIT verdict. Lead with the verdict. Explain the injury math. Give a confidence level (HIGH / MEDIUM / LOW) based on uncertainty.`;

      const userMessage = `Should I start ${input.playerA.playerName} or ${input.playerB.playerName}?${input.context ? `\n\nAdditional context: ${input.context}` : ""}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      });

      const verdict = response.choices?.[0]?.message?.content ?? "Analysis unavailable.";

      return {
        verdict,
        playerA: {
          ...input.playerA,
          injuryScore: scoreA,
          adjustedProjection: adjPointsA,
        },
        playerB: {
          ...input.playerB,
          injuryScore: scoreB,
          adjustedProjection: adjPointsB,
        },
        injuryBlock,
      };
    }),

  /**
   * Waiver Wire Scout — injury-aware.
   *
   * Given a player name, fetches their injury data, calculates scores,
   * and generates an AI scouting report grounded in the injury facts.
   */
  waiverScout: subscribedProcedure
    .input(z.object({
      player: PlayerInput,
      context: z.string().optional().default(""),
    }))
    .mutation(async ({ input }) => {
      const injuries = await getInjuries();
      const scores = calcInjuryScores([input.player], injuries);
      const score = scores[0]!;
      const injuryBlock = buildInjuryPromptBlock(scores);

      const systemPrompt = `You are an expert Fantasy Football waiver wire analyst for "ATLANTAS FINEST FF" (14-team PPR keeper league).
The injury data below is pre-calculated — treat as ground truth.

${injuryBlock}

WORKLOAD CONFIDENCE for ${input.player.playerName}: ${score.workloadConfidence}%
PROJECTION MULTIPLIER: ${score.volatilityMultiplier.toFixed(2)}x

Provide a waiver wire scouting report with:
1. PRIORITY RATING: (HIGH / MEDIUM / LOW / AVOID)
2. INJURY RISK SUMMARY: What does the injury data mean for this week and beyond?
3. TARGET SHARE OUTLOOK: Expected opportunity if active
4. FAAB RECOMMENDATION: Bid guidance (% of budget or pass)
5. BOTTOM LINE: One sentence recommendation`;

      const userMessage = `Evaluate ${input.player.playerName} (${input.player.position}) as a waiver wire pickup.${input.context ? `\n\nContext: ${input.context}` : ""}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      });

      const report = response.choices?.[0]?.message?.content ?? "Analysis unavailable.";

      return {
        report,
        player: input.player,
        injuryScore: score,
        injuryBlock,
      };
    }),
});
