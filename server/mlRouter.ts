// FILE: server/mlRouter.ts
import { z } from "zod";
import { publicProcedure, router, subscribedProcedure } from "./_core/trpc";
import { getMLHealth, getMLPrediction, getMLPredictionBatch } from "./mlService";

const playerInputSchema = z.object({
  playerName: z.string(),
  position: z.string(),
  historicalPoints: z.array(z.number()).default([]),
  historicalSnaps: z.array(z.number()).default([]),
  historicalTargets: z.array(z.number()).default([]),
  historicalRushAtt: z.array(z.number()).default([]),
  impliedTeamTotal: z.number().optional(),
  gameTotal: z.number().optional(),
  spread: z.number().optional(),
  isHome: z.boolean().optional(),
  vegasAdjustment: z.number().optional(),
  injuryRiskScore: z.number().optional(),
  weekNum: z.number().optional(),
  season: z.number().optional(),
});

export const mlRouter = router({
  /** Get ML model health and metadata */
  health: publicProcedure.query(async () => {
    return getMLHealth();
  }),

  /** Get ML prediction for a single player */
  predict: subscribedProcedure
    .input(playerInputSchema)
    .query(async ({ input }) => {
      return getMLPrediction(input);
    }),

  /** Get ML predictions for multiple players */
  predictBatch: subscribedProcedure
    .input(z.object({ players: z.array(playerInputSchema) }))
    .query(async ({ input }) => {
      return getMLPredictionBatch(input.players);
    }),
});
