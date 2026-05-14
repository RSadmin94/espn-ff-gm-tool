// FILE: server/agentRouter.ts
/**
 * Phase 4 — Multi-Agent War Room tRPC Router
 *
 * Mount in routers.ts:
 *   import { agentRouter } from "./agentRouter";
 *   // inside appRouter:
 *   agents: agentRouter,
 *
 * Endpoints:
 *   agents.startSit    — 5-agent start/sit debate with Phase 1+2+3 context
 *   agents.trade       — 5-agent trade analysis debate
 *   agents.keeper      — 5-agent keeper decision debate
 *   agents.draftPick   — 5-agent draft pick debate (live draft use)
 *   agents.openQuestion— 5-agent debate on any free-form question
 */

import { z } from "zod";
import { router, subscribedProcedure } from "./_core/trpc";
import { runAgentDebate, buildAgentContext } from "./agentWarRoom";
import { getInjuries, calcInjuryScores, buildInjuryPromptBlock } from "./injuryService";
import { buildDNAPromptBlock, calcLeagueDNA } from "./leagueDNA";
import { getCachedView, getAllCachedSeasons } from "./db";

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function getInjuryBlock(playerNames: string[]): Promise<string> {
  try {
    const injuries = await getInjuries();
    const players = playerNames.map((name, i) => ({
      playerId: i,
      playerName: name,
      position: "?",
    }));
    const scores = calcInjuryScores(players, injuries);
    return buildInjuryPromptBlock(scores);
  } catch {
    return "";
  }
}

async function getDNABlock(focusMemberIds?: string[]): Promise<string> {
  try {
    const cachedSeasons = (await getAllCachedSeasons()).filter(s => s >= 2018);
    if (cachedSeasons.length === 0) return "";
    const { buildManagerRawData } = await import("./dnaRouter");
    const { calcLeagueDNA, buildDNAPromptBlock: buildBlock } = await import("./leagueDNA");
    const allManagers = await buildManagerRawData();
    if (allManagers.length === 0) return "";
    const dnaProfiles = calcLeagueDNA(allManagers);
    const focused = focusMemberIds && focusMemberIds.length > 0
      ? dnaProfiles.filter(p => focusMemberIds.includes(p.memberId))
      : dnaProfiles;
    return buildBlock(focused);
  } catch {
    return "";
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const agentRouter = router({

  /**
   * Start/Sit 5-agent debate.
   *
   * The richest endpoint — combines Phase 1 injury data, Phase 2 simulation
   * output, and Phase 3 DNA profiles into a single context block, then runs
   * all 5 agents in parallel.
   *
   * Returns: verdicts from all 5 agents + consensus + disagreements
   */
  startSit: subscribedProcedure
    .input(z.object({
      playerA: z.object({ name: z.string(), position: z.string(), projectedPoints: z.number().optional() }),
      playerB: z.object({ name: z.string(), position: z.string(), projectedPoints: z.number().optional() }),
      /** Pre-built simulation summary from Phase 2 (simulation.startSit) */
      simulationSummary: z.string().optional(),
      /** League context: Rod's record, current week, matchup */
      leagueContext: z.string().optional(),
      /** Target memberIds for DNA focus (trade opponent, current matchup opponent) */
      opponentMemberIds: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const [injuryBlock, dnaBlock] = await Promise.all([
        getInjuryBlock([input.playerA.name, input.playerB.name]),
        input.opponentMemberIds ? getDNABlock(input.opponentMemberIds) : Promise.resolve(""),
      ]);

      const extraFacts = [
        input.playerA.projectedPoints
          ? `${input.playerA.name} projected: ${input.playerA.projectedPoints} pts`
          : "",
        input.playerB.projectedPoints
          ? `${input.playerB.name} projected: ${input.playerB.projectedPoints} pts`
          : "",
      ].filter(Boolean).join("\n");

      const context = buildAgentContext({
        question: `Should I start ${input.playerA.name} or ${input.playerB.name}?`,
        optionA: `${input.playerA.name} (${input.playerA.position})`,
        optionB: `${input.playerB.name} (${input.playerB.position})`,
        injuryBlock,
        simulationBlock: input.simulationSummary,
        dnaBlock: dnaBlock || undefined,
        leagueContext: input.leagueContext,
        extraFacts: extraFacts || undefined,
      });

      return runAgentDebate(context);
    }),

  /**
   * Trade 5-agent debate.
   *
   * Agents evaluate a trade from 5 different lenses simultaneously.
   * Most useful for close trades where you're unsure — the disagreement
   * reveals the tradeoffs.
   */
  trade: subscribedProcedure
    .input(z.object({
      /** What Rod is giving up */
      giving: z.array(z.object({ name: z.string(), position: z.string() })),
      /** What Rod is receiving */
      receiving: z.array(z.object({ name: z.string(), position: z.string() })),
      /** Pre-built trade math from tradeAnalyze endpoint */
      tradeMathSummary: z.string().optional(),
      /** Target owner's memberId for DNA context */
      targetMemberId: z.string().optional(),
      leagueContext: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const allPlayerNames = [
        ...input.giving.map(p => p.name),
        ...input.receiving.map(p => p.name),
      ];

      const [injuryBlock, dnaBlock] = await Promise.all([
        getInjuryBlock(allPlayerNames),
        input.targetMemberId ? getDNABlock([input.targetMemberId]) : Promise.resolve(""),
      ]);

      const givingDesc = input.giving.map(p => `${p.name} (${p.position})`).join(" + ");
      const receivingDesc = input.receiving.map(p => `${p.name} (${p.position})`).join(" + ");

      const context = buildAgentContext({
        question: `Should Rod accept this trade? Giving: ${givingDesc} | Receiving: ${receivingDesc}`,
        optionA: `ACCEPT — receive ${receivingDesc}`,
        optionB: `DECLINE — keep ${givingDesc}`,
        injuryBlock,
        simulationBlock: input.tradeMathSummary,
        dnaBlock: dnaBlock || undefined,
        leagueContext: input.leagueContext,
      });

      return runAgentDebate(context);
    }),

  /**
   * Keeper decision 5-agent debate.
   *
   * Compares two keeper candidates (or keeper vs dropping + using the draft pick).
   * Keeper Agent has maximum weight here — but other agents ensure the
   * weekly and playoff implications aren't ignored.
   */
  keeper: subscribedProcedure
    .input(z.object({
      playerA: z.object({
        name: z.string(),
        position: z.string(),
        keeperRound: z.number(),
        avgPoints: z.number().optional(),
      }),
      playerB: z.object({
        name: z.string(),
        position: z.string(),
        keeperRound: z.number(),
        avgPoints: z.number().optional(),
      }).optional(),
      keeperROISummary: z.string().optional(),
      leagueContext: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const playerNames = [input.playerA.name];
      if (input.playerB) playerNames.push(input.playerB.name);

      const [injuryBlock] = await Promise.all([
        getInjuryBlock(playerNames),
      ]);

      const aDesc = `${input.playerA.name} (${input.playerA.position}) — keep in round ${input.playerA.keeperRound}${input.playerA.avgPoints ? `, averaged ${input.playerA.avgPoints} PPG` : ""}`;
      const bDesc = input.playerB
        ? `${input.playerB.name} (${input.playerB.position}) — keep in round ${input.playerB.keeperRound}${input.playerB.avgPoints ? `, averaged ${input.playerB.avgPoints} PPG` : ""}`
        : `Release ${input.playerA.name} and take the round ${input.playerA.keeperRound} draft pick`;

      const context = buildAgentContext({
        question: input.playerB
          ? `Which keeper is the better value: ${input.playerA.name} or ${input.playerB.name}?`
          : `Should Rod keep ${input.playerA.name} in round ${input.playerA.keeperRound}?`,
        optionA: aDesc,
        optionB: bDesc,
        injuryBlock,
        extraFacts: input.keeperROISummary,
        leagueContext: input.leagueContext,
      });

      return runAgentDebate(context);
    }),

  /**
   * Live draft pick 5-agent debate.
   *
   * Designed for use during the Mock Draft Simulator or live draft day.
   * Pass the current board state and the agents will debate the best pick.
   */
  draftPick: subscribedProcedure
    .input(z.object({
      round: z.number(),
      pickNumber: z.number(),
      /** Top 3 available options to debate */
      optionA: z.object({ name: z.string(), position: z.string(), ecrRank: z.number().optional() }),
      optionB: z.object({ name: z.string(), position: z.string(), ecrRank: z.number().optional() }),
      /** Current roster snapshot */
      currentRoster: z.string().optional(),
      /** League draft context */
      leagueContext: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [injuryBlock] = await Promise.all([
        getInjuryBlock([input.optionA.name, input.optionB.name]),
      ]);

      const aDesc = `${input.optionA.name} (${input.optionA.position})${input.optionA.ecrRank ? ` — ECR #${input.optionA.ecrRank}` : ""}`;
      const bDesc = `${input.optionB.name} (${input.optionB.position})${input.optionB.ecrRank ? ` — ECR #${input.optionB.ecrRank}` : ""}`;

      const extraFacts = input.currentRoster
        ? `ROD'S CURRENT ROSTER:\n${input.currentRoster}`
        : undefined;

      const context = buildAgentContext({
        question: `Round ${input.round}, Pick ${input.pickNumber}: ${input.optionA.name} or ${input.optionB.name}?`,
        optionA: aDesc,
        optionB: bDesc,
        injuryBlock,
        leagueContext: input.leagueContext,
        extraFacts,
      });

      return runAgentDebate(context);
    }),

  /**
   * Open-question 5-agent debate.
   *
   * Free-form — any strategic question can be debated by all 5 agents.
   * Used by the GM Advisor chat as an optional "get 5 opinions" mode.
   */
  openQuestion: subscribedProcedure
    .input(z.object({
      question: z.string().min(10).max(500),
      optionA: z.string(),
      optionB: z.string().optional().default(""),
      calculatedFacts: z.string().optional().default(""),
      leagueContext: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const context = buildAgentContext({
        question: input.question,
        optionA: input.optionA,
        optionB: input.optionB || undefined,
        extraFacts: input.calculatedFacts || undefined,
        leagueContext: input.leagueContext,
      });

      return runAgentDebate(context);
    }),
});
