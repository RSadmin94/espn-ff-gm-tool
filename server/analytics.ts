// FILE: server/analytics.ts
/**
 * Analytics Engine — ESPN FF GM War Room
 *
 * This module is the calculated "facts" layer. All AI tools should consume
 * outputs from here rather than reasoning from raw data.
 *
 * Exports:
 *   - calcVORP: Value Over Replacement Player by position
 *   - calcPositionalScarcity: How many starters are rostered vs available
 *   - calcRosterGaps: Weakest positions per team
 *   - calcKeeperEfficiency: Keeper value vs draft cost vs ADP
 *   - calcManagerBehavior: Derived GM stats from transaction history
 *   - calcROSValue: Rest-of-season value estimate
 *   - calcTradeValue: Math-first trade value for a player or pick
 *   - calcLeagueAnalytics: Full league snapshot (all of the above combined)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlayerRow {
  playerId: number;
  playerName: string;
  position: string;        // QB, RB, WR, TE, K, D/ST
  teamId: number;
  ownerName: string;
  seasonPoints: number;    // actual total points scored
  avgPoints: number;       // average per game
  projectedTotal: number | null;
  keeperValue: number;     // round cost to keep (ESPN keeperValue)
  keeperValueFuture: number;
  injuryStatus: string;
  appliedStats: Record<string, number>;
}

export interface PickRow {
  round: number;
  pickInRound: number;
  label: string;           // e.g. "1.07"
  value: number;           // canonical pick value
  ownerName: string;
}

export interface TeamRow {
  teamId: number;
  ownerName: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface TransactionRow {
  season: number;
  teamId: number;
  type: string;           // "WAIVER", "FREE_AGENT", "TRADE", "DRAFT"
  itemType?: string;      // "ADD", "DROP"
  proposedDate?: number;
}

export interface DraftPickRow {
  season: number;
  teamId: number;
  roundId: number;
  roundPickNumber: number;
  overallPickNumber: number;
  position: string;
  keeper: boolean;
  playerId?: number;   // ESPN player ID — used for keeper efficiency cross-reference
  playerName?: string;
}

// ─── Replacement level baselines (PPR, 14-team, 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX) ──

// Replacement level = the player just outside the starting lineup at each position
// For 14 teams: QB15, RB29, WR29, TE15
const REPLACEMENT_LEVEL: Record<string, number> = {
  QB: 14,   // 14 starting QBs
  RB: 28,   // 14×2 starting RBs
  WR: 28,   // 14×2 starting WRs
  TE: 14,   // 14 starting TEs
  K: 14,
  "D/ST": 14,
};

// ─── VORP ─────────────────────────────────────────────────────────────────────

export interface VORPResult {
  playerId: number;
  playerName: string;
  position: string;
  ownerName: string;
  avgPoints: number;
  replacementLevel: number;
  vorp: number;             // avgPoints - replacementAvg
  vorpTier: "Elite" | "Starter" | "Borderline" | "Handcuff" | "Droppable";
}

/**
 * Calculates VORP for every rostered player.
 * Replacement level = average PPG of the player at rank N+1 at their position,
 * where N = number of starters at that position across the league.
 */
export function calcVORP(players: PlayerRow[]): VORPResult[] {
  const byPosition: Record<string, PlayerRow[]> = {};
  for (const p of players) {
    if (!byPosition[p.position]) byPosition[p.position] = [];
    byPosition[p.position].push(p);
  }

  const results: VORPResult[] = [];

  for (const [pos, posPlayers] of Object.entries(byPosition)) {
    const sorted = [...posPlayers].sort((a, b) => b.avgPoints - a.avgPoints);
    const replacementRank = REPLACEMENT_LEVEL[pos] ?? 14;
    // Replacement level = avg of players ranked N+1 through N+3 (buffer zone)
    const replacementPlayers = sorted.slice(replacementRank, replacementRank + 3);
    const replacementAvg = replacementPlayers.length > 0
      ? replacementPlayers.reduce((s, p) => s + p.avgPoints, 0) / replacementPlayers.length
      : 0;

    for (const player of posPlayers) {
      const vorp = Math.round((player.avgPoints - replacementAvg) * 10) / 10;
      let vorpTier: VORPResult["vorpTier"];
      if (vorp >= 8) vorpTier = "Elite";
      else if (vorp >= 3) vorpTier = "Starter";
      else if (vorp >= 0) vorpTier = "Borderline";
      else if (vorp >= -3) vorpTier = "Handcuff";
      else vorpTier = "Droppable";

      results.push({
        playerId: player.playerId,
        playerName: player.playerName,
        position: pos,
        ownerName: player.ownerName,
        avgPoints: player.avgPoints,
        replacementLevel: Math.round(replacementAvg * 10) / 10,
        vorp,
        vorpTier,
      });
    }
  }

  return results.sort((a, b) => b.vorp - a.vorp);
}

// ─── Positional Scarcity ──────────────────────────────────────────────────────

export interface PositionalScarcityResult {
  position: string;
  totalRostered: number;
  starterSlots: number;       // how many starters across the league
  availableStarters: number;  // starters not yet rostered (free agents)
  scarcityScore: number;      // 0-100, higher = more scarce
  scarcityLabel: "Scarce" | "Tight" | "Available" | "Deep";
  topFreeAgentAvg: number;    // best available FA's avg points
}

/**
 * Calculates positional scarcity across the league.
 * Requires both rostered players and free agent pool.
 */
export function calcPositionalScarcity(
  rosteredPlayers: PlayerRow[],
  freeAgents: PlayerRow[]
): PositionalScarcityResult[] {
  const positions = ["QB", "RB", "WR", "TE", "K", "D/ST"];
  const results: PositionalScarcityResult[] = [];

  for (const pos of positions) {
    const rostered = rosteredPlayers.filter(p => p.position === pos);
    const fas = freeAgents.filter(p => p.position === pos).sort((a, b) => b.avgPoints - a.avgPoints);
    const starterSlots = REPLACEMENT_LEVEL[pos] ?? 14;
    const availableStarters = Math.max(0, starterSlots - rostered.length);
    const scarcityScore = Math.round(Math.max(0, Math.min(100,
      ((starterSlots - fas.length) / starterSlots) * 100
    )));

    let scarcityLabel: PositionalScarcityResult["scarcityLabel"];
    if (scarcityScore >= 80) scarcityLabel = "Scarce";
    else if (scarcityScore >= 60) scarcityLabel = "Tight";
    else if (scarcityScore >= 30) scarcityLabel = "Available";
    else scarcityLabel = "Deep";

    results.push({
      position: pos,
      totalRostered: rostered.length,
      starterSlots,
      availableStarters,
      scarcityScore,
      scarcityLabel,
      topFreeAgentAvg: fas[0]?.avgPoints ?? 0,
    });
  }

  return results.sort((a, b) => b.scarcityScore - a.scarcityScore);
}

// ─── Roster Gap Analyzer ──────────────────────────────────────────────────────

export interface RosterGapResult {
  teamId: number;
  ownerName: string;
  gaps: {
    position: string;
    starterCount: number;
    neededStarters: number;
    deficit: number;
    topPlayerAvg: number;
    gapSeverity: "Critical" | "Weak" | "Adequate" | "Strong";
  }[];
  overallGrade: "A" | "B" | "C" | "D" | "F";
  weakestPosition: string;
}

// Required starters per team
const REQUIRED_STARTERS: Record<string, number> = {
  QB: 1, RB: 2, WR: 2, TE: 1, K: 1, "D/ST": 1,
};

export function calcRosterGaps(players: PlayerRow[]): RosterGapResult[] {
  const byTeam: Record<number, PlayerRow[]> = {};
  for (const p of players) {
    if (!byTeam[p.teamId]) byTeam[p.teamId] = [];
    byTeam[p.teamId].push(p);
  }

  const results: RosterGapResult[] = [];

  for (const [teamIdStr, teamPlayers] of Object.entries(byTeam)) {
    const teamId = Number(teamIdStr);
    const ownerName = teamPlayers[0]?.ownerName ?? "Unknown";
    const gaps = [];
    let totalDeficit = 0;

    for (const [pos, needed] of Object.entries(REQUIRED_STARTERS)) {
      const posPlayers = teamPlayers
        .filter(p => p.position === pos)
        .sort((a, b) => b.avgPoints - a.avgPoints);
      const starterCount = posPlayers.length;
      const deficit = Math.max(0, needed - starterCount);
      totalDeficit += deficit;
      const topPlayerAvg = posPlayers[0]?.avgPoints ?? 0;

      let gapSeverity: "Critical" | "Weak" | "Adequate" | "Strong";
      if (deficit > 0) gapSeverity = "Critical";
      else if (topPlayerAvg < 8) gapSeverity = "Weak";
      else if (topPlayerAvg < 14) gapSeverity = "Adequate";
      else gapSeverity = "Strong";

      gaps.push({ position: pos, starterCount, neededStarters: needed, deficit, topPlayerAvg: Math.round(topPlayerAvg * 10) / 10, gapSeverity });
    }

    const criticalGaps = gaps.filter(g => g.gapSeverity === "Critical").length;
    const weakGaps = gaps.filter(g => g.gapSeverity === "Weak").length;
    let overallGrade: "A" | "B" | "C" | "D" | "F";
    if (criticalGaps === 0 && weakGaps === 0) overallGrade = "A";
    else if (criticalGaps === 0 && weakGaps <= 1) overallGrade = "B";
    else if (criticalGaps <= 1) overallGrade = "C";
    else if (criticalGaps <= 2) overallGrade = "D";
    else overallGrade = "F";

    const weakestPosition = gaps.sort((a, b) => a.topPlayerAvg - b.topPlayerAvg)[0]?.position ?? "N/A";

    results.push({ teamId, ownerName, gaps, overallGrade, weakestPosition });
  }

  return results.sort((a, b) => a.overallGrade.localeCompare(b.overallGrade));
}

// ─── Keeper Efficiency ────────────────────────────────────────────────────────

export interface KeeperEfficiencyResult {
  playerId: number;
  playerName: string;
  position: string;
  ownerName: string;
  keeperRound: number;       // round they'd be kept in (keeperValue)
  keeperRoundFuture: number; // round cost next year
  avgPoints: number;
  vorp: number;
  // ADP-equivalent round: what round would this player go in a fresh draft?
  adpEquivRound: number;
  // Efficiency: how many rounds of value are you getting?
  roundSavings: number;      // adpEquivRound - keeperRound (positive = good deal)
  efficiencyScore: number;   // 0-100
  efficiencyLabel: "Elite Value" | "Good Value" | "Fair Value" | "Poor Value" | "Avoid";
  recommendation: string;
}

/**
 * Estimates ADP-equivalent round from average PPG.
 * Based on a 14-team PPR draft where top players go in round 1.
 */
function estimateAdpRound(avgPoints: number, position: string): number {
  // Rough PPG → draft round mapping for 14-team PPR
  const thresholds: [number, number][] = [
    [22, 1], [19, 2], [17, 3], [15, 4], [13, 5],
    [11, 6], [9, 7], [8, 8], [7, 9], [6, 10],
    [5, 11], [4, 12], [3, 13], [0, 14],
  ];
  // QBs are typically drafted later
  const adjusted = position === "QB" ? avgPoints * 0.85 : avgPoints;
  for (const [threshold, round] of thresholds) {
    if (adjusted >= threshold) return round;
  }
  return 15;
}

export function calcKeeperEfficiency(players: PlayerRow[], vorpResults: VORPResult[]): KeeperEfficiencyResult[] {
  const vorpMap = new Map(vorpResults.map(v => [v.playerId, v.vorp]));
  const results: KeeperEfficiencyResult[] = [];

  for (const player of players) {
    if (!player.keeperValue || player.keeperValue <= 0) continue;

    const keeperRound = player.keeperValue;
    const keeperRoundFuture = player.keeperValueFuture || keeperRound + 1;
    const adpEquivRound = estimateAdpRound(player.avgPoints, player.position);
    const roundSavings = adpEquivRound - keeperRound;
    const vorp = vorpMap.get(player.playerId) ?? 0;

    // Score: round savings weighted by VORP
    const rawScore = (roundSavings * 10) + (vorp * 2);
    const efficiencyScore = Math.round(Math.max(0, Math.min(100, 50 + rawScore)));

    let efficiencyLabel: KeeperEfficiencyResult["efficiencyLabel"];
    if (efficiencyScore >= 80) efficiencyLabel = "Elite Value";
    else if (efficiencyScore >= 65) efficiencyLabel = "Good Value";
    else if (efficiencyScore >= 45) efficiencyLabel = "Fair Value";
    else if (efficiencyScore >= 25) efficiencyLabel = "Poor Value";
    else efficiencyLabel = "Avoid";

    let recommendation: string;
    if (roundSavings >= 4) recommendation = `Strong keep — saving ${roundSavings} rounds vs ADP`;
    else if (roundSavings >= 2) recommendation = `Good keep — saving ${roundSavings} rounds vs ADP`;
    else if (roundSavings >= 0) recommendation = `Marginal keep — ADP and cost are close`;
    else recommendation = `Consider releasing — costing ${Math.abs(roundSavings)} rounds above ADP`;

    results.push({
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      ownerName: player.ownerName,
      keeperRound,
      keeperRoundFuture,
      avgPoints: player.avgPoints,
      vorp,
      adpEquivRound,
      roundSavings,
      efficiencyScore,
      efficiencyLabel,
      recommendation,
    });
  }

  return results.sort((a, b) => b.efficiencyScore - a.efficiencyScore);
}

// ─── Manager Behavior Stats ───────────────────────────────────────────────────

export interface ManagerBehaviorStats {
  teamId: number;
  ownerName: string;
  seasonsAnalyzed: number;
  // Waiver activity
  avgWaiverAddsPerSeason: number;
  avgDropsPerSeason: number;
  waiverAggressionScore: number;   // 0-100
  // Trade activity
  avgTradesPerSeason: number;
  tradeFrequencyScore: number;     // 0-100
  // Draft behavior
  avgDraftRoundByPosition: Record<string, number>;
  earlyQbTendency: boolean;        // drafts QB in rounds 1-3
  earlyTeTendency: boolean;        // drafts TE in rounds 1-4
  favoriteDraftPositions: string[];
  repeatedDraftPlayers: string[];
  draftBehaviorSummary: string;
  // Keeper behavior
  keeperEfficiencyAvg: number;     // avg pick savings on keepers: costOverallPick - adpOverallPick (positive = good value)
  // Derived archetypes
  gmArchetype: string;
  gmArchetypeDesc: string;
  // Roster stability
  rosterStabilityScore: number;    // 100 - (drops/adds ratio × 100)
}

/**
 * playerScoreMap: playerId -> { avgPoints, position } from the most recent season's roster.
 * Used to estimate current ADP for keeper efficiency calculations.
 * Without this map the function falls back to a round-based heuristic.
 */
export function calcManagerBehavior(
  teams: TeamRow[],
  transactions: TransactionRow[],
  draftPicks: DraftPickRow[],
  ownerNameMap: Record<number, string>,  // teamId -> ownerName
  playerScoreMap?: Map<number, { avgPoints: number; position: string }>
): ManagerBehaviorStats[] {
  const results: ManagerBehaviorStats[] = [];

  for (const team of teams) {
    const ownerName = ownerNameMap[team.teamId] || team.ownerName;
    const teamTxs = transactions.filter(t => t.teamId === team.teamId);
    const teamPicks = draftPicks.filter(p => p.teamId === team.teamId);

    // Count by season
    const seasons = Array.from(new Set(teamTxs.map(t => t.season)));
    const seasonsAnalyzed = Math.max(seasons.length, 1);

    const adds = teamTxs.filter(t => t.itemType === "ADD" || t.type === "WAIVER" || t.type === "FREE_AGENT");
    const drops = teamTxs.filter(t => t.itemType === "DROP");
    // 2026+ ESPN format: accepted trades appear as TRADE_UPHOLD or TRADE_ACCEPT
    const trades = teamTxs.filter(t => t.type === "TRADE" || t.type === "TRADE_UPHOLD" || t.type === "TRADE_ACCEPT");

    const avgAdds = Math.round((adds.length / seasonsAnalyzed) * 10) / 10;
    const avgDrops = Math.round((drops.length / seasonsAnalyzed) * 10) / 10;
    const avgTrades = Math.round((trades.length / seasonsAnalyzed) * 10) / 10;

    // Aggression scores (calibrated to league averages: ~35 adds, ~5 trades per season)
    const waiverAggressionScore = Math.min(100, Math.round((avgAdds / 70) * 100));
    const tradeFrequencyScore = Math.min(100, Math.round((avgTrades / 10) * 100));
    const rosterStabilityScore = Math.max(0, 100 - Math.round((avgDrops / Math.max(avgAdds, 1)) * 100));

    // Draft tendencies
    const avgDraftRoundByPosition: Record<string, number> = {};
    const positions = ["QB", "RB", "WR", "TE", "K", "D/ST"];
    for (const pos of positions) {
      const posPicks = teamPicks.filter(p => p.position === pos && !p.keeper);
      if (posPicks.length > 0) {
        avgDraftRoundByPosition[pos] = Math.round(
          (posPicks.reduce((s, p) => s + p.roundId, 0) / posPicks.length) * 10
        ) / 10;
      }
    }

    const earlyQbTendency = (avgDraftRoundByPosition["QB"] ?? 10) <= 3;
    const earlyTeTendency = (avgDraftRoundByPosition["TE"] ?? 10) <= 4;
    const favoriteDraftPositions = Object.entries(
      teamPicks
        .filter(p => !p.keeper)
        .reduce<Record<string, number>>((acc, p) => {
          const pos = p.position || "?";
          acc[pos] = (acc[pos] || 0) + 1;
          return acc;
        }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([pos]) => pos);
    const repeatedDraftPlayers = Object.entries(
      teamPicks
        .filter(p => p.playerName)
        .reduce<Record<string, number>>((acc, p) => {
          const name = p.playerName!;
          acc[name] = (acc[name] || 0) + 1;
          return acc;
        }, {})
    )
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name} (${count}x)`);
    const earlyRounds = teamPicks.filter(p => p.roundId >= 1 && p.roundId <= 3 && !p.keeper);
    const earlyPosCounts = earlyRounds.reduce<Record<string, number>>((acc, p) => {
      const pos = p.position || "?";
      acc[pos] = (acc[pos] || 0) + 1;
      return acc;
    }, {});
    const earlyRoundPlan = Object.entries(earlyPosCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([pos, count]) => `${pos} ${count}x`)
      .join(", ") || "No early-round sample";
    const draftBehaviorSummary = teamPicks.length > 0
      ? `Draft history: ${teamPicks.length} picks. Favorite positions: ${favoriteDraftPositions.join(", ") || "none"}. Early rounds: ${earlyRoundPlan}${repeatedDraftPlayers.length ? `. Repeat targets: ${repeatedDraftPlayers.join(", ")}` : ""}.`
      : "No draft history available.";

    // GM Archetype derivation
    let gmArchetype = "Balanced Manager";
    let gmArchetypeDesc = "Moderate activity across all areas.";

    if (waiverAggressionScore >= 70 && tradeFrequencyScore >= 60) {
      gmArchetype = "Dealmaker";
      gmArchetypeDesc = "Extremely active on both waivers and trades. Never sits still.";
    } else if (waiverAggressionScore >= 70) {
      gmArchetype = "Waiver Grinder";
      gmArchetypeDesc = "Dominates the waiver wire. Relies on finding hidden gems over big trades.";
    } else if (tradeFrequencyScore >= 60) {
      gmArchetype = "Trade Shark";
      gmArchetypeDesc = "Aggressive trader who moves players frequently. Watch for low-ball offers.";
    } else if (waiverAggressionScore < 30 && tradeFrequencyScore < 30) {
      gmArchetype = "Set & Forget";
      gmArchetypeDesc = "Minimal roster moves. Either very confident in their team or disengaged.";
    } else if (earlyQbTendency) {
      gmArchetype = "QB-First Drafter";
      gmArchetypeDesc = "Prioritizes QB early in the draft. Can create positional scarcity at RB/WR.";
    } else if (rosterStabilityScore >= 80) {
      gmArchetype = "Roster Builder";
      gmArchetypeDesc = "Rarely drops players — builds through the draft and selective adds.";
    }

    // ── Keeper efficiency (pick-based formula) ──────────────────────────────────
    //
    // Keeper COST  = the overall pick number the keeper was drafted at last year.
    //   e.g. kept at round 1, pick 11 in a 12-team league → cost = overall pick 11
    //   We use overallPickNumber from the draft pick row directly.
    //
    // Keeper VALUE = estimated current ADP expressed as an overall pick number.
    //   Step 1: estimateAdpRound(avgPoints, position) → draft round
    //   Step 2: estimate pick-within-round from scoring rank at that position
    //   Step 3: adpOverallPick = (adpRound - 1) * leagueSize + pickWithinRound
    //
    // Efficiency = costOverallPick - adpOverallPick
    //   Positive → getting better pick than you paid (good value)
    //   Negative → paying more than the player is worth (bad deal)
    //
    // Example: McCaffrey kept at pick 1.11 (overall 11), current ADP = pick 2
    //   efficiency = 11 - 2 = +9 picks of value
    //
    const leagueSize = Math.max(teams.length, 10);
    const keeperPicks = teamPicks.filter(p => p.keeper);
    let keeperEfficiencyAvg = 0;

    if (keeperPicks.length > 0 && playerScoreMap && playerScoreMap.size > 0) {
      // Build position scoring rank arrays so we can estimate pick-within-round
      const positionScores = new Map<string, number[]>();
      Array.from(playerScoreMap.values()).forEach(info => {
        const arr = positionScores.get(info.position) ?? [];
        arr.push(info.avgPoints);
        positionScores.set(info.position, arr);
      });
      Array.from(positionScores.entries()).forEach(([pos, arr]) => {
        positionScores.set(pos, arr.sort((a: number, b: number) => b - a));
      });

      const pickSavings: number[] = [];
      for (const kp of keeperPicks) {
        const costOverallPick = kp.overallPickNumber;
        if (!costOverallPick || costOverallPick <= 0) continue;

        // Look up current scoring for this player
        const pinfo = kp.playerId ? playerScoreMap.get(kp.playerId) : undefined;
        const avgPoints = pinfo?.avgPoints ?? 0;
        const position = pinfo?.position ?? kp.position;
        if (avgPoints <= 0) continue; // no scoring data — skip

        // Step 1: estimate ADP round from scoring
        const adpRound = estimateAdpRound(avgPoints, position);

        // Step 2: estimate pick-within-round from position rank
        // Rank 1 at position = first pick of that position in the draft
        const posRanks = positionScores.get(position) ?? [];
        const posRankIdx = posRanks.findIndex(pts => pts <= avgPoints + 0.01);
        const posRank = posRankIdx >= 0 ? posRankIdx + 1 : posRanks.length + 1;
        // Roughly 2-3 picks of each position per round in a 12-team PPR league
        const picksPerRound = Math.max(1, Math.round(leagueSize / 4));
        const pickWithinRound = Math.min(leagueSize, Math.max(1, Math.ceil(posRank / picksPerRound)));

        // Step 3: compute ADP overall pick
        const adpOverallPick = (adpRound - 1) * leagueSize + pickWithinRound;

        // Efficiency = how many picks better is their value vs what you paid
        pickSavings.push(costOverallPick - adpOverallPick);
      }

      if (pickSavings.length > 0) {
        keeperEfficiencyAvg = Math.round(
          (pickSavings.reduce((s, v) => s + v, 0) / pickSavings.length) * 10
        ) / 10;
      }
    } else if (keeperPicks.length > 0) {
      // Fallback: no scoring data — compare keeper round vs league average round 7
      // Scale to picks so the number is comparable (rough: 1 round ≈ leagueSize/2 picks)
      const avgKeeperRound = keeperPicks.reduce((s, p) => s + p.roundId, 0) / keeperPicks.length;
      keeperEfficiencyAvg = Math.round((7 - avgKeeperRound) * (leagueSize / 2) * 10) / 10;
    }

    // Personalized archetype description using actual stats
    const tradesStr = avgTrades.toFixed(1);
    const waiverStr = avgAdds.toFixed(1);
    const keeperStr = keeperEfficiencyAvg > 0 ? `+${keeperEfficiencyAvg.toFixed(0)}` : keeperEfficiencyAvg.toFixed(0);
    const keeperLabel = keeperEfficiencyAvg >= 5 ? "elite keeper value" : keeperEfficiencyAvg >= 1 ? "smart keeper decisions" : keeperEfficiencyAvg >= -3 ? "fair keeper value" : "tends to overpay for keepers";
    const seasonsStr = seasonsAnalyzed === 1 ? "1 season" : `${seasonsAnalyzed} seasons`;

    if (gmArchetype === "Dealmaker") {
      gmArchetypeDesc = `${tradesStr} trades/yr + ${waiverStr} waiver adds/yr over ${seasonsStr}. Never sits still — always hunting an angle. High activity can be exploited when they overpay in desperation.`;
    } else if (gmArchetype === "Waiver Grinder") {
      gmArchetypeDesc = `${waiverStr} waiver adds/yr over ${seasonsStr}. Builds through the wire, not the trade market (${tradesStr} trades/yr). Keeper efficiency: ${keeperStr} picks avg — ${keeperLabel}.`;
    } else if (gmArchetype === "Trade Shark") {
      gmArchetypeDesc = `${tradesStr} trades/yr over ${seasonsStr}. Moves players constantly — watch for low-ball offers and desperation windows. Waiver activity is low (${waiverStr}/yr), so they rely on trades to improve.`;
    } else if (gmArchetype === "Set & Forget") {
      gmArchetypeDesc = `${tradesStr} trades/yr + ${waiverStr} waiver adds/yr over ${seasonsStr}. Minimal roster moves — either extremely confident in their team or checked out. Keeper efficiency: ${keeperStr} picks avg.`;
    } else if (gmArchetype === "QB-First Drafter") {
      gmArchetypeDesc = `Avg QB draft round: ${avgDraftRoundByPosition["QB"]?.toFixed(1) ?? "N/A"} over ${seasonsStr}. Prioritizes QB early — creates RB/WR scarcity that can be exploited in trades. ${tradesStr} trades/yr.`;
    } else if (gmArchetype === "Roster Builder") {
      gmArchetypeDesc = `${avgDrops.toFixed(1)} drops/yr over ${seasonsStr} — rarely releases players. Builds through the draft (keeper eff: ${keeperStr} picks). Low trade activity (${tradesStr}/yr) means patience is their strategy.`;
    } else {
      gmArchetypeDesc = `${tradesStr} trades/yr + ${waiverStr} waiver adds/yr over ${seasonsStr}. Keeper efficiency: ${keeperStr} picks avg. Balanced approach — no dominant tendency to exploit.`;
    }

    results.push({
      teamId: team.teamId,
      ownerName,
      seasonsAnalyzed,
      avgWaiverAddsPerSeason: avgAdds,
      avgDropsPerSeason: avgDrops,
      waiverAggressionScore,
      avgTradesPerSeason: avgTrades,
      tradeFrequencyScore,
      avgDraftRoundByPosition,
      earlyQbTendency,
      earlyTeTendency,
      favoriteDraftPositions,
      repeatedDraftPlayers,
      draftBehaviorSummary,
      keeperEfficiencyAvg,
      gmArchetype,
      gmArchetypeDesc,
      rosterStabilityScore,
    });
  }

  return results;
}

// ─── Rest-of-Season Value ─────────────────────────────────────────────────────

export interface ROSValueResult {
  playerId: number;
  playerName: string;
  position: string;
  ownerName: string;
  avgPoints: number;
  weeksRemaining: number;
  rosProjectedTotal: number;   // avgPoints × weeksRemaining
  rosAdjusted: number;         // adjusted for injury risk, schedule, and trend
  scheduleStrength: "Easy" | "Neutral" | "Tough";
  injuryRisk: "None" | "Low" | "Medium" | "High";
  trendLabel: "Hot" | "Stable" | "Cold" | "Unknown";
}

export function calcROSValue(
  players: PlayerRow[],
  weeksRemaining: number = 10
): ROSValueResult[] {
  return players.map(player => {
    // Injury risk from ESPN status
    let injuryRisk: ROSValueResult["injuryRisk"] = "None";
    const status = (player.injuryStatus || "").toUpperCase();
    if (status === "OUT" || status === "IR") injuryRisk = "High";
    else if (status === "DOUBTFUL") injuryRisk = "High";
    else if (status === "QUESTIONABLE") injuryRisk = "Medium";
    else if (status === "PROBABLE") injuryRisk = "Low";

    // Injury discount
    const injuryDiscount = injuryRisk === "High" ? 0.5
      : injuryRisk === "Medium" ? 0.85
      : injuryRisk === "Low" ? 0.95
      : 1.0;

    const scheduleRaw = (player as PlayerRow & { scheduleStrength?: string | number }).scheduleStrength;
    const scheduleText = String(scheduleRaw ?? "").toLowerCase();
    const scheduleNumber = typeof scheduleRaw === "number" ? scheduleRaw : 0;
    const scheduleStrength: ROSValueResult["scheduleStrength"] = scheduleText.includes("easy") || scheduleText.includes("weak") || scheduleNumber > 0.1
      ? "Easy"
      : scheduleText.includes("tough") || scheduleText.includes("hard") || scheduleNumber < -0.1
        ? "Tough"
        : "Neutral";
    const scheduleMultiplier = scheduleStrength === "Easy" ? 1.08 : scheduleStrength === "Tough" ? 0.92 : 1.0;

    const rosProjectedTotal = Math.round(player.avgPoints * weeksRemaining * 10) / 10;
    const rosAdjusted = Math.round(rosProjectedTotal * injuryDiscount * scheduleMultiplier * 10) / 10;

    return {
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      ownerName: player.ownerName,
      avgPoints: player.avgPoints,
      weeksRemaining,
      rosProjectedTotal,
      rosAdjusted,
      scheduleStrength,
      injuryRisk,
      trendLabel: "Stable" as const, // enhanced with weekly data in future
    };
  }).sort((a, b) => b.rosAdjusted - a.rosAdjusted);
}

// ─── Trade Value (Math-First) ─────────────────────────────────────────────────

export interface TradeValueResult {
  playerId?: number;
  pickLabel?: string;
  name: string;
  position: string;
  avgPoints: number;
  vorp: number;
  rosValue: number;
  keeperBonus: number;        // extra value for being keepable at good cost
  positionalScarcityBonus: number;
  compositeValue: number;     // the number to use in trade math
  valueBreakdown: string;     // human-readable explanation
}

export function calcTradeValue(
  player: PlayerRow,
  vorpResult: VORPResult | undefined,
  rosResult: ROSValueResult | undefined,
  scarcity: PositionalScarcityResult | undefined,
  keeperEfficiency: KeeperEfficiencyResult | undefined
): TradeValueResult {
  const avgPoints = player.avgPoints;
  const vorp = vorpResult?.vorp ?? 0;
  const rosValue = rosResult?.rosAdjusted ?? (avgPoints * 10);

  // Keeper bonus: if player is a good keeper deal, add value
  const keeperBonus = keeperEfficiency
    ? Math.max(0, keeperEfficiency.roundSavings * 15)
    : 0;

  // Positional scarcity bonus: scarce positions are worth more
  const scarcityBonus = scarcity
    ? Math.round(scarcity.scarcityScore * 0.3)
    : 0;

  // Composite: ROS value + VORP premium + keeper bonus + scarcity bonus
  const compositeValue = Math.round(rosValue + (vorp * 5) + keeperBonus + scarcityBonus);

  const parts: string[] = [
    `ROS: ${rosValue.toFixed(0)}pts`,
    `VORP: ${vorp > 0 ? "+" : ""}${vorp.toFixed(1)}`,
  ];
  if (keeperBonus > 0) parts.push(`Keeper bonus: +${keeperBonus}`);
  if (scarcityBonus > 0) parts.push(`Scarcity: +${scarcityBonus}`);

  return {
    playerId: player.playerId,
    name: player.playerName,
    position: player.position,
    avgPoints,
    vorp,
    rosValue,
    keeperBonus,
    positionalScarcityBonus: scarcityBonus,
    compositeValue,
    valueBreakdown: parts.join(" | "),
  };
}

// ─── Pick Value (canonical 14-team snake formula) ─────────────────────────────

const PICK_BASE = 3000;
const PICK_K = 0.028;
const PICK_TEAMS = 14;

export function calcPickValue(round: number, pickInRound: number): number {
  const overallPick = (round - 1) * PICK_TEAMS + pickInRound;
  return Math.round(PICK_BASE * Math.exp(-PICK_K * (overallPick - 1)));
}

// ─── Full League Analytics Snapshot ──────────────────────────────────────────

export interface LeagueAnalyticsSnapshot {
  season: number;
  computedAt: Date;
  vorp: VORPResult[];
  scarcity: PositionalScarcityResult[];
  rosterGaps: RosterGapResult[];
  keeperEfficiency: KeeperEfficiencyResult[];
  managerBehavior: ManagerBehaviorStats[];
  rosValues: ROSValueResult[];
  dataQuality: {
    playerCount: number;
    teamsWithRosters: number;
    hasTransactionData: boolean;
    hasDraftData: boolean;
  };
}

export function calcLeagueAnalytics(
  season: number,
  players: PlayerRow[],
  freeAgents: PlayerRow[],
  teams: TeamRow[],
  transactions: TransactionRow[],
  draftPicks: DraftPickRow[],
  ownerNameMap: Record<number, string>,
  weeksRemaining: number = 10
): LeagueAnalyticsSnapshot {
  const vorp = calcVORP(players);
  const scarcity = calcPositionalScarcity(players, freeAgents);
  const rosterGaps = calcRosterGaps(players);
  const keeperEfficiency = calcKeeperEfficiency(players, vorp);
  const managerBehavior = calcManagerBehavior(teams, transactions, draftPicks, ownerNameMap);
  const rosValues = calcROSValue(players, weeksRemaining);

  return {
    season,
    computedAt: new Date(),
    vorp,
    scarcity,
    rosterGaps,
    keeperEfficiency,
    managerBehavior,
    rosValues,
    dataQuality: {
      playerCount: players.length,
      teamsWithRosters: Array.from(new Set(players.map(p => p.teamId))).length,
      hasTransactionData: transactions.length > 0,
      hasDraftData: draftPicks.length > 0,
    },
  };
}
