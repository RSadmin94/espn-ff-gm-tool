// FILE: server/champRouter.ts
/**
 * Phase 5 — Championship Equity tRPC Router
 *
 * Mount in routers.ts:
 *   import { champRouter } from "./champRouter";
 *   // inside appRouter:
 *   champ: champRouter,
 *
 * Endpoints:
 *   champ.equity          — Rod's championship probability + full equity report
 *   champ.leagueRankings  — championship probability for all 14 teams
 *   champ.uniqueness      — Rod's roster differentiation score
 *   champ.resilience      — Rod's injury resilience by position
 *   champ.playoffSchedule — Rod's weeks 14-17 matchup difficulty
 *   champ.fullReport      — complete championship equity report (all 5 metrics)
 */

import { z } from "zod";
import { router, subscribedProcedure } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { TRPCError } from "@trpc/server";
import {
  calcChampionshipEquity,
  calcRosterUniqueness,
  calcInjuryResilience,
  calcPlayoffScheduleStrength,
  calcChampEquityScore,
  buildChampEquityPromptBlock,
  runChampEquitySimulation,
  type TeamStanding,
} from "./championshipEngine";
import type { SimPlayer } from "./monteCarloService";
import {
  getCachedView,
  getAllCachedSeasons,
} from "./db";
import {
  normalizeTeams,
  normalizeRosters,
  normalizeMatchups,
  normalizeSettings,
} from "./espnService";

// ─── Shared input schemas ─────────────────────────────────────────────────────

const SimPlayerInput = z.object({
  playerId: z.number(),
  playerName: z.string(),
  position: z.string(),
  projectedPoints: z.number(),
  stdDev: z.number().optional(),
  volatilityMultiplier: z.number().optional(),
});

const TeamStandingInput = z.object({
  teamId: z.number(),
  ownerName: z.string(),
  wins: z.number(),
  losses: z.number(),
  pointsFor: z.number(),
  projectedLineup: z.array(SimPlayerInput),
  remainingSchedule: z.array(z.number()),
  isRod: z.boolean().default(false),
});

// ─── ESPN data helper ─────────────────────────────────────────────────────────

async function buildTeamStandings(season: number): Promise<{
  teams: TeamStanding[];
  rodTeamId: number | null;
  currentWeek: number;
  playoffWeekStart: number;
}> {
  const cached = await getCachedView(season, "combined");
  if (!cached) return { teams: [], rodTeamId: null, currentWeek: 1, playoffWeekStart: 15 };

  const data = cached.payload as Record<string, unknown>;
  const rawTeams = normalizeTeams(data);
  const rosters = normalizeRosters(data) as Record<string, unknown>[];
  const matchups = normalizeMatchups(data);
  const settings = normalizeSettings(data);

  const currentWeek = (settings.currentMatchupPeriod as number) ?? 1;
  const playoffWeekStart: number = ((settings.matchupPeriodCount as number) ?? 14) + 1;

  // Build teamId → owner name map
  const ownerMap: Record<number, string> = {};
  for (const t of rawTeams) ownerMap[t.teamId as number] = t.owners as string;

  // Build projected lineup per team from roster averages
  const teamLineups = new Map<number, SimPlayer[]>();
  for (const player of rosters) {
    const teamId = player.teamId as number;
    if (!teamLineups.has(teamId)) teamLineups.set(teamId, []);
    const lineup = teamLineups.get(teamId)!;

    const pos = player.position as string;
    if (!["QB", "RB", "WR", "TE"].includes(pos)) continue;
    if (lineup.filter(p => p.position === pos).length >= 2) continue;

    lineup.push({
      playerId: player.playerId as number,
      playerName: (player.playerName as string) || "Unknown",
      position: pos,
      projectedPoints: (player.appliedAverage as number) || 0,
      stdDev: undefined,
      volatilityMultiplier: 1.0,
    });
  }

  // Build remaining schedules from upcoming matchups
  const remainingMatchups = matchups.filter(
    m => (m.matchupPeriodId as number) >= currentWeek &&
    (!m.playoffTierType || m.playoffTierType === "NONE" || m.playoffTierType === "WINNERS_BRACKET")
  );

  const teamRemainingSchedule = new Map<number, number[]>();
  for (const m of remainingMatchups) {
    const homeId = m.homeTeamId as number;
    const awayId = m.awayTeamId as number;
    if (!homeId || !awayId) continue;
    if (!teamRemainingSchedule.has(homeId)) teamRemainingSchedule.set(homeId, []);
    if (!teamRemainingSchedule.has(awayId)) teamRemainingSchedule.set(awayId, []);
    teamRemainingSchedule.get(homeId)!.push(awayId);
    teamRemainingSchedule.get(awayId)!.push(homeId);
  }

  // Detect Rod's team
  let rodTeamId: number | null = null;
  for (const t of rawTeams) {
    const name = ((t.teamName as string) || "").toLowerCase();
    const owner = ((t.owners as string) || "").toLowerCase();
    if (name.includes("str8") || name.includes("rodzilla") ||
        owner.includes("rod") || owner.includes("sellers")) {
      rodTeamId = t.teamId as number;
      break;
    }
  }

  const teams: TeamStanding[] = rawTeams.map(t => ({
    teamId: t.teamId as number,
    ownerName: ownerMap[t.teamId as number] || "Unknown",
    wins: (t.wins as number) || 0,
    losses: (t.losses as number) || 0,
    pointsFor: (t.pointsFor as number) || 0,
    projectedLineup: teamLineups.get(t.teamId as number) ?? [],
    remainingSchedule: teamRemainingSchedule.get(t.teamId as number) ?? [],
    isRod: t.teamId === rodTeamId,
  }));

  return { teams, rodTeamId, currentWeek, playoffWeekStart };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const champRouter = router({

  /**
   * Rod's full championship equity report.
   * Runs the complete 5-metric analysis from the current season data.
   * Simulates 2,000 season paths to produce championship probability.
   */
  fullReport: subscribedProcedure
    .input(z.object({
      season: z.number().default(2025),
      simCount: z.number().min(500).max(5000).default(2000),
    }))
    .query(async ({ input }) => {
      const { teams, rodTeamId, playoffWeekStart } = await buildTeamStandings(input.season);
      if (teams.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "No data for season." });
      if (!rodTeamId) throw new TRPCError({ code: "NOT_FOUND", message: "Could not identify Rod's team." });

      const rodTeam = teams.find(t => t.teamId === rodTeamId);
      if (!rodTeam) throw new TRPCError({ code: "NOT_FOUND", message: "Rod's team not found." });

      // Separate starters (top 2 per skill position) and backups
      const starters = rodTeam.projectedLineup.slice(0, 8);
      const backups = rodTeam.projectedLineup.slice(8);

      const result = runChampEquitySimulation(
        rodTeam,
        teams,
        { starters, backups, allPlayers: rodTeam.projectedLineup.map(p => ({
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
        })) },
        input.simCount
      );

      return { ...result, season: input.season, rodTeamId };
    }),

  /**
   * League-wide championship probability rankings.
   * Shows where Rod stands vs all 13 opponents.
   */
  leagueRankings: subscribedProcedure
    .input(z.object({ season: z.number().default(2025), simCount: z.number().default(1000) }))
    .query(async ({ input }) => {
      const { teams } = await buildTeamStandings(input.season);
      if (teams.length === 0) return [];
      return calcChampionshipEquity(teams, input.simCount);
    }),

  /**
   * Variance mode advisor.
   *
   * Given Rod's current championship probability, should he play it safe
   * (floor) or swing for ceiling (variance)?
   *
   * Uses the AI to reason from the championship equity facts.
   */
  varianceModeAdvice: subscribedProcedure
    .input(z.object({
      season: z.number().default(2025),
      specificQuestion: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { teams, rodTeamId } = await buildTeamStandings(input.season);
      if (!rodTeamId || teams.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Season data unavailable." });
      }

      const rodTeam = teams.find(t => t.teamId === rodTeamId)!;
      const starters = rodTeam.projectedLineup.slice(0, 8);
      const backups = rodTeam.projectedLineup.slice(8);

      const simResult = runChampEquitySimulation(rodTeam, teams, {
        starters, backups,
        allPlayers: rodTeam.projectedLineup.map(p => ({
          playerId: p.playerId, playerName: p.playerName, position: p.position,
        })),
      }, 1000);

      const systemPrompt = `You are the Championship Equity advisor for Rod Sellers in "ATLANTAS FINEST FF" (14-team PPR keeper league).
You optimize for championship probability — NOT weekly points. These are two different objectives.

${simResult.promptBlock}

KEY PRINCIPLE: 
- If championship probability < 10%: recommend HIGH VARIANCE — only upside moves can close the gap
- If championship probability 10-20%: balanced, slight lean toward variance
- If championship probability > 20%: protect the equity, avoid unnecessary risk
- Unique roster construction matters — if Rod's roster looks like everyone else's, he can't win

Answer Rod's question using the championship equity data above as ground truth.`;

      const question = input.specificQuestion
        || "Based on my championship equity, should I be playing it safe or swinging for ceiling moves?";

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
      });

      return {
        advice: response.choices?.[0]?.message?.content ?? "Analysis unavailable.",
        equityReport: simResult,
      };
    }),

  /**
   * What-if simulator: how does a trade or keeper decision change championship probability?
   *
   * Pass the "before" and "after" roster states and get the delta in championship %.
   */
  whatIfDelta: subscribedProcedure
    .input(z.object({
      season: z.number().default(2025),
      /** Roster BEFORE the decision */
      beforeLineup: z.array(SimPlayerInput),
      /** Roster AFTER the decision */
      afterLineup: z.array(SimPlayerInput),
      decisionDescription: z.string(),
      simCount: z.number().min(200).max(2000).default(500),
    }))
    .mutation(async ({ input }) => {
      const { teams, rodTeamId } = await buildTeamStandings(input.season);
      if (!rodTeamId || teams.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Season data unavailable." });
      }

      const rodTeamBase = teams.find(t => t.teamId === rodTeamId)!;

      // Before sim
      const beforeTeam: TeamStanding = { ...rodTeamBase, projectedLineup: input.beforeLineup as SimPlayer[] };
      const teamsWithBefore = teams.map(t => t.teamId === rodTeamId ? beforeTeam : t);
      const equityBefore = calcChampionshipEquity(teamsWithBefore, input.simCount);
      const rodBefore = equityBefore.find(e => e.teamId === rodTeamId)!;

      // After sim
      const afterTeam: TeamStanding = { ...rodTeamBase, projectedLineup: input.afterLineup as SimPlayer[] };
      const teamsWithAfter = teams.map(t => t.teamId === rodTeamId ? afterTeam : t);
      const equityAfter = calcChampionshipEquity(teamsWithAfter, input.simCount);
      const rodAfter = equityAfter.find(e => e.teamId === rodTeamId)!;

      const champDelta = Math.round((rodAfter.champProbabilityAbsolute - rodBefore.champProbabilityAbsolute) * 10) / 10;
      const playoffDelta = rodAfter.playoffProbability - rodBefore.playoffProbability;

      const verdict = champDelta > 2
        ? `✓ ${input.decisionDescription} IMPROVES championship odds by ${champDelta}%`
        : champDelta < -2
        ? `✗ ${input.decisionDescription} HURTS championship odds by ${Math.abs(champDelta)}%`
        : `~ ${input.decisionDescription} has minimal impact on championship odds (${champDelta > 0 ? "+" : ""}${champDelta}%)`;

      return {
        decisionDescription: input.decisionDescription,
        before: { champProbability: rodBefore.champProbabilityAbsolute, playoffProbability: rodBefore.playoffProbability },
        after: { champProbability: rodAfter.champProbabilityAbsolute, playoffProbability: rodAfter.playoffProbability },
        champDelta,
        playoffDelta,
        verdict,
      };
    }),
});
