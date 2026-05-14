// FILE: server/simulationRouter.ts
/**
 * Phase 2 — Simulation tRPC Router
 *
 * Mount in routers.ts:
 *   import { simulationRouter } from "./simulationRouter";
 *   // inside appRouter:
 *   simulation: simulationRouter,
 *
 * Endpoints:
 *   simulation.playerOutcome   — single player distribution (floor/median/ceiling)
 *   simulation.startSit        — win-probability delta between two lineup choices
 *   simulation.matchup         — full two-lineup matchup simulation
 *   simulation.lineupCheck     — full roster projected with win probability vs opponent
 */

import { z } from "zod";
import { router, subscribedProcedure } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import {
  simulatePlayer,
  simulateStartSit,
  simulateMatchup,
  calcLineupProjection,
  deriveStdDev,
  type SimPlayer,
} from "./monteCarloService";
import { getInjuries, calcInjuryScores } from "./injuryService";
import {
  getNFLOdds,
  getVegasContextForTeam,
  buildVegasPromptBlock,
  type VegasTeamContext,
} from "./vegasOddsService";
import { getCachedSignals } from "./beatReporterService";
import { getLeagueScoringSettings } from "./leagueScoringService";
import type { PlayerNewsSignal } from "../drizzle/schema";
import {
  computeBeatReporterAdjustment,
  formatSignalsForPrompt,
} from "./beatReporterSignalExtractor";

// ─── Shared input schema ──────────────────────────────────────────────────────

const SimPlayerInput = z.object({
  playerId: z.number(),
  playerName: z.string(),
  position: z.string(),
  projectedPoints: z.number(),
  stdDev: z.number().optional(),
  volatilityMultiplier: z.number().min(0).max(1).optional(),
  matchupAdjustment: z.number().min(-0.2).max(0.2).optional(),
  ecrStd: z.number().optional(), // from FantasyPros board — used to derive stdDev
  /** NFL team abbreviation (e.g. "ATL", "KC") — used to look up Vegas implied total */
  nflTeam: z.string().optional(),
});

// ─── Helper: enrich players with Vegas implied totals ───────────────────────

/** Extended SimPlayer with Vegas context and beat reporter signals attached */
export interface SimPlayerWithVegas extends SimPlayer {
  nflTeam?: string;
  vegasContext?: VegasTeamContext | null;
  beatReporterSignals?: PlayerNewsSignal[];
  beatReporterAdjustment?: number;
}

async function enrichWithVegas(
  players: SimPlayerWithVegas[]
): Promise<SimPlayerWithVegas[]> {
  try {
    const odds = await getNFLOdds();
    return players.map(p => {
      if (!p.nflTeam) return p;
      const vegasContext = getVegasContextForTeam(p.nflTeam, odds);
      if (!vegasContext) return p;
      // Apply Vegas adjustment on top of existing matchupAdjustment
      // Vegas adjustment is additive: a team implied at 27 vs avg 22.5 adds +0.20
      const existingAdj = p.matchupAdjustment ?? 0;
      const combinedAdj = Math.max(-0.30, Math.min(0.30, existingAdj + vegasContext.vegasAdjustment));
      return {
        ...p,
        matchupAdjustment: combinedAdj,
        vegasContext,
      };
    });
  } catch {
    // Vegas fetch failed — simulate without Vegas adjustment
    return players;
  }
}

// ─── Helper: enrich players with Phase 1 injury multipliers ──────────────────

async function enrichWithInjury(players: SimPlayer[]): Promise<SimPlayer[]> {
  try {
    const injuries = await getInjuries();
    const scores = calcInjuryScores(
      players.map(p => ({ playerId: p.playerId, playerName: p.playerName, position: p.position })),
      injuries
    );
    const scoreMap = new Map(scores.map(s => [s.playerId, s]));
    return players.map(p => ({
      ...p,
      // Only override if caller didn't already provide a multiplier
      volatilityMultiplier: p.volatilityMultiplier ?? scoreMap.get(p.playerId)?.volatilityMultiplier ?? 1.0,
      // Derive stdDev if not provided
      stdDev: p.stdDev ?? deriveStdDev(p.projectedPoints, p.position, p.ecrStd),
    }));
  } catch {
    // Injury fetch failed — simulate without adjustment
    return players.map(p => ({
      ...p,
      volatilityMultiplier: p.volatilityMultiplier ?? 1.0,
      stdDev: p.stdDev ?? deriveStdDev(p.projectedPoints, p.position, p.ecrStd),
    }));
  }
}

// ─── Helper: enrich players with beat reporter signals ──────────────────────

async function enrichWithBeatReporter(
  players: SimPlayerWithVegas[]
): Promise<SimPlayerWithVegas[]> {
  try {
    // Fetch signals for all players in parallel
    const signalResults = await Promise.allSettled(
      players.map((p) => getCachedSignals(p.playerName))
    );

    return players.map((p, i) => {
      const result = signalResults[i];
      if (result?.status !== "fulfilled" || !result.value.length) return p;

      const signals = result.value;
      const adjustment = computeBeatReporterAdjustment(
        signals.map((s) => ({
          projectionImpactPct: s.projectionImpactPct,
          confidence: s.confidence,
          magnitude: s.magnitude / 100, // stored as 0–100, needs 0–1
        }))
      );

      // Apply beat reporter adjustment on top of existing matchupAdjustment
      // Convert multiplier (e.g. 1.12) to additive adjustment (e.g. +0.12)
      const beatAdj = adjustment - 1.0;
      const existingAdj = p.matchupAdjustment ?? 0;
      const combinedAdj = Math.max(-0.35, Math.min(0.35, existingAdj + beatAdj));

      return {
        ...p,
        matchupAdjustment: combinedAdj,
        beatReporterSignals: signals,
        beatReporterAdjustment: beatAdj,
      };
    });
  } catch {
    return players;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const simulationRouter = router({

  /**
   * Single player outcome distribution.
   * Returns floor/median/ceiling and bust/ceiling probabilities.
   *
   * Use on the Draft Board, Player Profiles, and Waiver Intel cards.
   */
  playerOutcome: subscribedProcedure
    .input(SimPlayerInput)
    .query(async ({ input }) => {
      const [enriched] = await enrichWithInjury([input as SimPlayer]);
      return simulatePlayer(enriched!);
    }),

  /**
   * Start/Sit win-probability simulator.
   *
   * The key Phase 2 output: "Starting Gibbs over Achane improves your
   * win probability from 54% → 61%."
   *
   * Integrates with Phase 1: injury multipliers are auto-applied if not
   * explicitly provided by the caller.
   *
   * Also calls the LLM with the simulation facts injected as ground truth,
   * producing an AI verdict grounded in the probability numbers.
   */
  startSit: subscribedProcedure
    .input(z.object({
      playerA: SimPlayerInput,
      playerB: SimPlayerInput,
      /** Rest of the lineup EXCLUDING the contested position */
      restOfLineup: z.array(SimPlayerInput).default([]),
      /** Opponent's projected lineup */
      opponentLineup: z.array(SimPlayerInput).default([]),
      context: z.string().optional().default(""),
    }))
    .mutation(async ({ input }) => {
      // Step 1: Enrich all players with injury data
      const injuryEnriched = await enrichWithInjury([
        input.playerA as SimPlayer,
        input.playerB as SimPlayer,
        ...input.restOfLineup as SimPlayer[],
        ...input.opponentLineup as SimPlayer[],
      ]);

      // Step 2: Enrich with Vegas implied totals (adds matchupAdjustment from game context)
      const vegasEnriched = await enrichWithVegas(
        injuryEnriched.map((p, i) => ({
          ...p,
          nflTeam: [
            input.playerA,
            input.playerB,
            ...input.restOfLineup,
            ...input.opponentLineup,
          ][i]?.nflTeam,
        })) as SimPlayerWithVegas[]
      );

      // Step 3: Enrich with beat reporter signals (role changes, injury risk, hidden opportunities)
      const beatEnriched = await enrichWithBeatReporter(vegasEnriched);

      const allPlayers = beatEnriched;
      const enrichedA = allPlayers[0]!;
      const enrichedB = allPlayers[1]!;
      const restOfLineup = allPlayers.slice(2, 2 + input.restOfLineup.length);
      const opponentLineup = allPlayers.slice(2 + input.restOfLineup.length);

      // Collect Vegas contexts for prompt building
      const vegasContextsForPrompt = [
        { playerName: input.playerA.playerName, teamAbbr: input.playerA.nflTeam ?? "", context: (enrichedA as SimPlayerWithVegas).vegasContext ?? null },
        { playerName: input.playerB.playerName, teamAbbr: input.playerB.nflTeam ?? "", context: (enrichedB as SimPlayerWithVegas).vegasContext ?? null },
      ].filter(c => c.teamAbbr);

      // Use a default opponent lineup if none provided
      const effectiveOpponent = opponentLineup.length > 0 ? opponentLineup : [
        { playerId: 0, playerName: "Opponent QB", position: "QB", projectedPoints: 18, volatilityMultiplier: 1.0, stdDev: 5.4 },
        { playerId: 1, playerName: "Opponent RB1", position: "RB", projectedPoints: 14, volatilityMultiplier: 1.0, stdDev: 7.7 },
        { playerId: 2, playerName: "Opponent RB2", position: "RB", projectedPoints: 10, volatilityMultiplier: 1.0, stdDev: 5.5 },
        { playerId: 3, playerName: "Opponent WR1", position: "WR", projectedPoints: 13, volatilityMultiplier: 1.0, stdDev: 6.5 },
        { playerId: 4, playerName: "Opponent WR2", position: "WR", projectedPoints: 10, volatilityMultiplier: 1.0, stdDev: 5.0 },
        { playerId: 5, playerName: "Opponent TE", position: "TE", projectedPoints: 9, volatilityMultiplier: 1.0, stdDev: 4.95 },
      ] as SimPlayer[];

      // Run 10,000 simulations
      const simResult = simulateStartSit(
        restOfLineup,
        enrichedA,
        enrichedB,
        effectiveOpponent,
        10000
      );

      // Inject simulation facts into LLM prompt — AI explains, sim decides
      const vegasBlock = vegasContextsForPrompt.length > 0
        ? "\n\n" + buildVegasPromptBlock(vegasContextsForPrompt)
        : "";

      // Build beat reporter signal blocks for both players
      const beatSignalsA = (enrichedA as SimPlayerWithVegas).beatReporterSignals ?? [];
      const beatSignalsB = (enrichedB as SimPlayerWithVegas).beatReporterSignals ?? [];
      const beatBlockA = formatSignalsForPrompt(input.playerA.playerName, beatSignalsA.map(s => ({
        signalType: s.signalType,
        summary: s.summary,
        projectionImpactPct: s.projectionImpactPct,
        confidence: s.confidence,
      })));
      const beatBlockB = formatSignalsForPrompt(input.playerB.playerName, beatSignalsB.map(s => ({
        signalType: s.signalType,
        summary: s.summary,
        projectionImpactPct: s.projectionImpactPct,
        confidence: s.confidence,
      })));
      const beatBlock = [beatBlockA, beatBlockB].filter(Boolean).join("\n\n");
      const beatSection = beatBlock ? `\n\nBEAT REPORTER INTELLIGENCE:\n${beatBlock}` : "";

      // Step 4: Load league scoring settings for LLM context
      const leagueScoring = await getLeagueScoringSettings().catch(() => null);
      const scoringLine = leagueScoring?.scoringDescription
        ? `\n\nLEAGUE SCORING: ${leagueScoring.scoringDescription}`
        : "";

      const systemPrompt = `You are an expert Fantasy Football analyst for "ATLANTAS FINEST FF" (14-team PPR keeper league).
The Monte Carlo simulation below ran 10,000 matchups — treat these numbers as ground truth. Do not contradict them.${scoringLine}
${simResult.summaryText}${vegasBlock}${beatSection}

PLAYER PROFILES:
  ${input.playerA.playerName} (${input.playerA.position}): ${simResult.playerA.adjustedProjection} pts projected | Floor: ${simResult.playerA.scoreRange.p10} | Ceiling: ${simResult.playerA.scoreRange.p90} | Bust risk: ${simResult.playerA.bustProbability}% | Injury multiplier: ${simResult.playerA.volatilityMultiplier.toFixed(2)}x
  ${input.playerB.playerName} (${input.playerB.position}): ${simResult.playerB.adjustedProjection} pts projected | Floor: ${simResult.playerB.scoreRange.p10} | Ceiling: ${simResult.playerB.scoreRange.p90} | Bust risk: ${simResult.playerB.bustProbability}% | Injury multiplier: ${simResult.playerB.volatilityMultiplier.toFixed(2)}x

Deliver a concise START/SIT verdict:
1. Lead with the recommendation (START [name]) and the win-probability improvement.
2. Explain WHY in 2-3 sentences using the simulation numbers.
3. Reference Vegas game environment if it materially affects the decision.
4. Reference any beat reporter signals (role changes, injury risk, hidden opportunities) that affect the decision.
5. Note any injury risk or confidence concern.
6. If it's a coin flip (<3% delta), say so clearly.`;

      const userMsg = `Should I start ${input.playerA.playerName} or ${input.playerB.playerName}?${input.context ? `\n\nContext: ${input.context}` : ""}`;

      let aiVerdict = "";
      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
        });
        const rawContent = response.choices?.[0]?.message?.content;
        aiVerdict = typeof rawContent === "string" ? rawContent : (rawContent ? JSON.stringify(rawContent) : "");
      } catch {
        aiVerdict = `${simResult.summaryText}\n\nRecommendation: ${simResult.recommendation === "COIN_FLIP" ? "Too close to call — consider injury risk." : `Start ${simResult.recommendation === "START_A" ? input.playerA.playerName : input.playerB.playerName}.`}`;
      }

      return {
        simResult,
        aiVerdict,
        playerA: {
          ...input.playerA,
          outcome: simResult.playerA,
          vegasContext: (enrichedA as SimPlayerWithVegas).vegasContext ?? null,
          beatReporterSignals: (enrichedA as SimPlayerWithVegas).beatReporterSignals ?? [],
          beatReporterAdjustment: (enrichedA as SimPlayerWithVegas).beatReporterAdjustment ?? 0,
        },
        playerB: {
          ...input.playerB,
          outcome: simResult.playerB,
          vegasContext: (enrichedB as SimPlayerWithVegas).vegasContext ?? null,
          beatReporterSignals: (enrichedB as SimPlayerWithVegas).beatReporterSignals ?? [],
          beatReporterAdjustment: (enrichedB as SimPlayerWithVegas).beatReporterAdjustment ?? 0,
        },
      };
    }),

  /**
   * Full two-lineup matchup simulation.
   * Used in the Command Center War Room for weekly win probability display.
   */
  matchup: subscribedProcedure
    .input(z.object({
      myLineup: z.array(SimPlayerInput),
      opponentLineup: z.array(SimPlayerInput),
    }))
    .mutation(async ({ input }) => {
      const injuryEnriched = await enrichWithInjury([
        ...input.myLineup as SimPlayer[],
        ...input.opponentLineup as SimPlayer[],
      ]);
      const vegasEnriched = await enrichWithVegas(
        injuryEnriched.map((p, i) => ({
          ...p,
          nflTeam: [...input.myLineup, ...input.opponentLineup][i]?.nflTeam,
        })) as SimPlayerWithVegas[]
      );

      const myEnriched = vegasEnriched.slice(0, input.myLineup.length);
      const oppEnriched = vegasEnriched.slice(input.myLineup.length);

      return simulateMatchup(myEnriched, oppEnriched, 10000);
    }),

  /**
   * Lineup health check — simulate a full roster to surface risky starters.
   * Returns each starter's outcome distribution + overall win probability.
   *
   * Use in the War Room for the weekly pre-lock briefing.
   */
  lineupCheck: subscribedProcedure
    .input(z.object({
      myLineup: z.array(SimPlayerInput),
      opponentLineup: z.array(SimPlayerInput).optional().default([]),
    }))
    .query(async ({ input }) => {
      const injuryEnriched = await enrichWithInjury([
        ...input.myLineup as SimPlayer[],
        ...input.opponentLineup as SimPlayer[],
      ]);
      const vegasEnriched = await enrichWithVegas(
        injuryEnriched.map((p, i) => ({
          ...p,
          nflTeam: [...input.myLineup, ...input.opponentLineup][i]?.nflTeam,
        })) as SimPlayerWithVegas[]
      );

      const myEnriched = vegasEnriched.slice(0, input.myLineup.length);
      const oppEnriched = vegasEnriched.slice(input.myLineup.length);

      const lineupOutcome = calcLineupProjection(myEnriched, 10000);

      // Flag risky starters (bust probability > 25% or low confidence)
      const riskyStarters = lineupOutcome.players
        .filter(p => p.bustProbability > 25 || p.confidenceLabel === "LOW")
        .map(p => ({
          playerName: p.playerName,
          position: p.position,
          bustProbability: p.bustProbability,
          confidenceLabel: p.confidenceLabel,
          volatilityMultiplier: p.volatilityMultiplier,
          floor: p.scoreRange.p10,
          ceiling: p.scoreRange.p90,
        }));

      let matchupResult = null;
      if (oppEnriched.length > 0) {
        matchupResult = simulateMatchup(myEnriched, oppEnriched, 10000);
      }

      return {
        lineup: lineupOutcome,
        riskyStarters,
        matchup: matchupResult,
        summary: {
          projectedScore: lineupOutcome.totalProjected,
          floor: lineupOutcome.totalP10,
          ceiling: lineupOutcome.totalP90,
          winProbability: matchupResult?.winProbability ?? null,
          riskCount: riskyStarters.length,
        },
      };
    }),
});
