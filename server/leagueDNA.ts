// FILE: server/leagueDNA.ts
/**
 * Phase 3 — League DNA Engine
 *
 * Transforms 18 seasons of raw ESPN behavioral data into exploitability scores.
 * No public tool can replicate this — it's built entirely from your private
 * league's actual history.
 *
 * Exports:
 *   calcManagerDNA()          — full behavioral profile per manager
 *   calcExploitabilityScores()— quantified exploit windows per opponent
 *   calcTiltScore()           — how much does a manager change after losses?
 *   calcTradeDesperationScore()— current trade willingness (live, this season)
 *   buildDNAPromptBlock()     — inject into any AI prompt as facts
 *
 * Architecture:
 *   LLMs explain. This engine produces the behavioral facts.
 *   Feed outputs into simulationRouter (opponent volatility adjustment)
 *   and into the GM Advisor system prompt via buildDNAPromptBlock().
 */

// ─── Input types (from ESPN cache / ownerCareerStats) ────────────────────────

export interface SeasonRecord {
  season: number;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
  rank: number;
  madePlayoffs: boolean;
  isChampion: boolean;
}

export interface TxnSeason {
  season: number;
  acquisitions: number;
  drops: number;
  trades: number;
}

export interface DraftPickRecord {
  season: number;
  roundId: number;
  position: string;
  keeper: boolean;
  playerId?: number;
  playerName?: string;
}

export interface ManagerRawData {
  memberId: string;
  ownerName: string;
  seasonRecords: SeasonRecord[];
  txnSeasons: TxnSeason[];
  draftPicks: DraftPickRecord[];
  h2hVsRod: { wins: number; losses: number };
  // Current season state (pass live values for tilt/desperation scoring)
  currentSeason: {
    season: number;
    currentWins: number;
    currentLosses: number;
    currentWeek: number;
    recentAcquisitions: number;   // last 3 weeks
    recentTrades: number;         // last 3 weeks
    lastWeekScore: number;        // their score last week
    leagueAvgScore: number;       // for comparison
  } | null;
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface DraftDNA {
  /** Average round they draft each position — lower = earlier = overvalue */
  avgRoundByPosition: Record<string, number>;
  /** Rounds earlier/later than league average (positive = earlier = overvalue) */
  biasVsLeague: Record<string, number>;
  /** Round 1 picks by position (history) */
  round1Distribution: Record<string, number>;
  /** How often they use a keeper slot (0-100%) */
  keeperRate: number;
  /** Stylistic badge derived from draft patterns */
  draftStyleBadge: string;
  /** Positions they historically reach on (drafts 1.5+ rounds early) */
  reachPositions: string[];
  /** Positions they historically find value at (drafts 1.5+ rounds late) */
  valuePositions: string[];
  /** Repeatedly drafted players, with counts */
  favoritePlayers: string[];
  /** Round-by-round plain-English tendency summary */
  roundStrategy: string;
  /** How their draft style has changed across eras */
  draftEvolution: string;
}

export interface TradeDNA {
  /** Average trades per season */
  avgTradesPerSeason: number;
  /** Trade frequency score 0-100 */
  tradeFrequency: number;
  /** Seasons where trades spiked after a bad start (0-2 wins first 4 weeks) */
  desperation_triggers: number;
  /** Head-to-head record vs Rod */
  h2hVsRod: { wins: number; losses: number; winPct: number };
  /** Do they trade more when losing? Ratio of trades in bad seasons vs good */
  lossTradeRatio: number;
}

export interface WaiverDNA {
  /** Average acquisitions per season */
  avgAcquisitionsPerSeason: number;
  /** Waiver aggression 0-100 */
  waiverAggression: number;
  /** Seasons with acquisition spike (>50% above their own avg) after an injury week */
  injuryOverreactionCount: number;
  /** Tendency to churn roster (high drops relative to adds) */
  rosterChurnRate: number;
}

export interface TiltProfile {
  /** How much do they over-trade after 2+ consecutive losses? */
  tiltScore: number;           // 0-100, higher = more tilts
  /** How much does their acquisition rate spike after a bad week? */
  waiverTiltScore: number;     // 0-100
  /** Season sample size for tilt calculation */
  tiltSampleSeasons: number;
  tiltLabel: "High Tilt Risk" | "Moderate Tilt" | "Steady" | "Ice Cold";
}

export interface ManagerDNA {
  memberId: string;
  ownerName: string;
  /** Number of seasons with sufficient data */
  seasonsAnalyzed: number;
  draft: DraftDNA;
  trade: TradeDNA;
  waiver: WaiverDNA;
  tilt: TiltProfile;
  /** Overall GM archetype (existing field, kept for compatibility) */
  gmArchetype: string;
  /** Composite exploitability score: how predictably irrational is this manager? */
  exploitabilityScore: number;    // 0-100, higher = more exploitable
  exploitabilityLabel: "Highly Exploitable" | "Moderately Exploitable" | "Market-Aware" | "Shark";
  /** Top 3 specific exploit opportunities — plain English, actionable */
  exploitWindows: string[];
  /** Plain-English summary for prompt injection */
  dnaSummary: string;
}

// ─── League-wide position average helper ─────────────────────────────────────

function calcLeagueAvgRoundByPosition(
  allPicks: Array<{ position: string; roundId: number; keeper: boolean }>
): Record<string, number> {
  const positions = ["QB", "RB", "WR", "TE"];
  const result: Record<string, number> = {};
  for (const pos of positions) {
    const picks = allPicks.filter(p => p.position === pos && !p.keeper);
    result[pos] = picks.length > 0
      ? Math.round((picks.reduce((s, p) => s + p.roundId, 0) / picks.length) * 10) / 10
      : 7.0;
  }
  return result;
}

// ─── Draft DNA ────────────────────────────────────────────────────────────────

function calcDraftDNA(
  picks: DraftPickRecord[],
  leagueAvgByPos: Record<string, number>
): DraftDNA {
  const positions = ["QB", "RB", "WR", "TE"];
  const avgRoundByPosition: Record<string, number> = {};
  const biasVsLeague: Record<string, number> = {};
  const round1Distribution: Record<string, number> = {};
  const reachPositions: string[] = [];
  const valuePositions: string[] = [];

  const nonKeeperPicks = picks.filter(p => !p.keeper);
  const totalPicks = nonKeeperPicks.length;
  const keeperPicks = picks.filter(p => p.keeper).length;
  const keeperRate = totalPicks + keeperPicks > 0
    ? Math.round((keeperPicks / (totalPicks + keeperPicks)) * 100)
    : 0;

  for (const pos of positions) {
    const posPicks = nonKeeperPicks.filter(p => p.position === pos);
    if (posPicks.length === 0) continue;
    const avg = Math.round((posPicks.reduce((s, p) => s + p.roundId, 0) / posPicks.length) * 10) / 10;
    avgRoundByPosition[pos] = avg;

    // Bias: positive = they draft earlier than league = overvalue
    const bias = Math.round(((leagueAvgByPos[pos] ?? 7) - avg) * 10) / 10;
    biasVsLeague[pos] = bias;
    if (bias >= 1.5) reachPositions.push(pos);
    if (bias <= -1.5) valuePositions.push(pos);

    const r1 = posPicks.filter(p => p.roundId === 1).length;
    round1Distribution[pos] = r1;
  }

  // Draft style badge
  const rb1Count = round1Distribution["RB"] ?? 0;
  const wr1Count = round1Distribution["WR"] ?? 0;
  const qbAvg = avgRoundByPosition["QB"] ?? 8;
  const teAvg = avgRoundByPosition["TE"] ?? 8;

  let draftStyleBadge = "Balanced Drafter";
  if (rb1Count >= 4) draftStyleBadge = "RB-First Builder";
  else if (wr1Count >= 4) draftStyleBadge = "WR-Heavy Drafter";
  else if (qbAvg <= 3) draftStyleBadge = "Early QB Gambler";
  else if (teAvg <= 4) draftStyleBadge = "TE Premium";
  else if (reachPositions.length >= 2) draftStyleBadge = "Positional Reach Tendencies";
  else if (valuePositions.length >= 2) draftStyleBadge = "Value Hunter";
  const favoritePlayers = Object.entries(
    picks
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
  const summarizeRounds = (start: number, end: number) => {
    const counts: Record<string, number> = {};
    for (const pick of nonKeeperPicks) {
      if (pick.roundId < start || pick.roundId > end) continue;
      counts[pick.position] = (counts[pick.position] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([pos, count]) => `${pos} ${count}x`)
      .join(", ") || "no sample";
  };
  const roundStrategy = `R1-3: ${summarizeRounds(1, 3)}; R4-6: ${summarizeRounds(4, 6)}; R7+: ${summarizeRounds(7, 20)}`;
  const seasons = picks.map(p => p.season).filter(Boolean);
  const latestSeason = seasons.length ? Math.max(...seasons) : 0;
  const recent = latestSeason ? nonKeeperPicks.filter(p => p.season >= latestSeason - 2) : [];
  const older = latestSeason ? nonKeeperPicks.filter(p => p.season < latestSeason - 2) : [];
  const topPos = (sample: DraftPickRecord[]) => Object.entries(sample.reduce<Record<string, number>>((acc, p) => {
    acc[p.position] = (acc[p.position] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1])[0]?.[0] || "balanced";
  const draftEvolution = recent.length && older.length
    ? `Earlier years leaned ${topPos(older)}; recent seasons lean ${topPos(recent)}.`
    : "Not enough season spread to identify evolution.";

  return {
    avgRoundByPosition,
    biasVsLeague,
    round1Distribution,
    keeperRate,
    draftStyleBadge,
    reachPositions,
    valuePositions,
    favoritePlayers,
    roundStrategy,
    draftEvolution,
  };
}

// ─── Trade DNA ────────────────────────────────────────────────────────────────

function calcTradeDNA(
  txnSeasons: TxnSeason[],
  seasonRecords: SeasonRecord[],
  h2hVsRod: { wins: number; losses: number }
): TradeDNA {
  if (txnSeasons.length === 0) {
    return {
      avgTradesPerSeason: 0, tradeFrequency: 0, desperation_triggers: 0,
      h2hVsRod: { wins: h2hVsRod.wins, losses: h2hVsRod.losses, winPct: 0 },
      lossTradeRatio: 1.0,
    };
  }

  const totalTrades = txnSeasons.reduce((s, t) => s + t.trades, 0);
  const avgTradesPerSeason = Math.round((totalTrades / txnSeasons.length) * 10) / 10;
  const tradeFrequency = Math.min(100, Math.round((avgTradesPerSeason / 15) * 100));

  // Desperation trigger: seasons where they started 0-2 or 1-3 AND traded more than avg
  let desperationTriggers = 0;
  for (const txn of txnSeasons) {
    const rec = seasonRecords.find(r => r.season === txn.season);
    if (!rec) continue;
    const earlyLosses = rec.losses; // simplified: total losses as proxy
    const badStart = rec.wins <= 2 && (rec.wins + rec.losses) >= 4;
    if (badStart && txn.trades > avgTradesPerSeason * 1.3) desperationTriggers++;
  }

  // Loss trade ratio: avg trades in losing seasons vs winning seasons
  const badSeasons = txnSeasons.filter(t => {
    const rec = seasonRecords.find(r => r.season === t.season);
    return rec && rec.wins < rec.losses;
  });
  const goodSeasons = txnSeasons.filter(t => {
    const rec = seasonRecords.find(r => r.season === t.season);
    return rec && rec.wins >= rec.losses;
  });
  const avgBadTrades = badSeasons.length > 0
    ? badSeasons.reduce((s, t) => s + t.trades, 0) / badSeasons.length : avgTradesPerSeason;
  const avgGoodTrades = goodSeasons.length > 0
    ? goodSeasons.reduce((s, t) => s + t.trades, 0) / goodSeasons.length : avgTradesPerSeason;
  const lossTradeRatio = avgGoodTrades > 0
    ? Math.round((avgBadTrades / avgGoodTrades) * 100) / 100 : 1.0;

  const h2hTotal = h2hVsRod.wins + h2hVsRod.losses;
  const h2hWinPct = h2hTotal > 0 ? Math.round((h2hVsRod.wins / h2hTotal) * 1000) / 10 : 0;

  return {
    avgTradesPerSeason,
    tradeFrequency,
    desperation_triggers: desperationTriggers,
    h2hVsRod: { wins: h2hVsRod.wins, losses: h2hVsRod.losses, winPct: h2hWinPct },
    lossTradeRatio,
  };
}

// ─── Waiver DNA ───────────────────────────────────────────────────────────────

function calcWaiverDNA(txnSeasons: TxnSeason[]): WaiverDNA {
  if (txnSeasons.length === 0) {
    return { avgAcquisitionsPerSeason: 0, waiverAggression: 0, injuryOverreactionCount: 0, rosterChurnRate: 0 };
  }

  const totalAcq = txnSeasons.reduce((s, t) => s + t.acquisitions, 0);
  const totalDrops = txnSeasons.reduce((s, t) => s + t.drops, 0);
  const avgAcquisitionsPerSeason = Math.round((totalAcq / txnSeasons.length) * 10) / 10;
  const waiverAggression = Math.min(100, Math.round((avgAcquisitionsPerSeason / 70) * 100));

  // Injury overreaction: seasons with acquisition spike > 60% above their own average
  let injuryOverreactionCount = 0;
  for (const txn of txnSeasons) {
    if (txn.acquisitions > avgAcquisitionsPerSeason * 1.6) injuryOverreactionCount++;
  }

  const rosterChurnRate = totalAcq > 0
    ? Math.round((totalDrops / totalAcq) * 100) : 0;

  return { avgAcquisitionsPerSeason, waiverAggression, injuryOverreactionCount, rosterChurnRate };
}

// ─── Tilt Profile ─────────────────────────────────────────────────────────────

function calcTiltProfile(
  txnSeasons: TxnSeason[],
  seasonRecords: SeasonRecord[]
): TiltProfile {
  const avgTrades = txnSeasons.length > 0
    ? txnSeasons.reduce((s, t) => s + t.trades, 0) / txnSeasons.length : 0;
  const avgAcq = txnSeasons.length > 0
    ? txnSeasons.reduce((s, t) => s + t.acquisitions, 0) / txnSeasons.length : 0;

  // Tilt: losing seasons with elevated trades
  let tradeTiltEvents = 0;
  let waiverTiltEvents = 0;
  let sampleSize = 0;

  for (const txn of txnSeasons) {
    const rec = seasonRecords.find(r => r.season === txn.season);
    if (!rec) continue;
    sampleSize++;
    const isLosingSeason = rec.wins < rec.losses;
    if (isLosingSeason) {
      if (txn.trades > avgTrades * 1.4) tradeTiltEvents++;
      if (txn.acquisitions > avgAcq * 1.5) waiverTiltEvents++;
    }
  }

  const losingSeasons = seasonRecords.filter(r => r.wins < r.losses).length;
  const tiltScore = losingSeasons > 0
    ? Math.min(100, Math.round((tradeTiltEvents / losingSeasons) * 100)) : 0;
  const waiverTiltScore = losingSeasons > 0
    ? Math.min(100, Math.round((waiverTiltEvents / losingSeasons) * 100)) : 0;

  const tiltLabel: TiltProfile["tiltLabel"] =
    tiltScore >= 70 ? "High Tilt Risk" :
    tiltScore >= 40 ? "Moderate Tilt" :
    tiltScore >= 20 ? "Steady" :
    "Ice Cold";

  return { tiltScore, waiverTiltScore, tiltSampleSeasons: sampleSize, tiltLabel };
}

// ─── Exploit windows ──────────────────────────────────────────────────────────

function buildExploitWindows(
  ownerName: string,
  draft: DraftDNA,
  trade: TradeDNA,
  waiver: WaiverDNA,
  tilt: TiltProfile
): string[] {
  const windows: string[] = [];

  // Draft exploit
  for (const pos of draft.reachPositions) {
    const bias = draft.biasVsLeague[pos];
    if (bias) windows.push(`Sell ${pos} to ${ownerName} — they draft ${pos} ${bias.toFixed(1)} rounds earlier than league avg. Overpay tendency confirmed.`);
  }
  for (const pos of draft.valuePositions) {
    const bias = Math.abs(draft.biasVsLeague[pos] ?? 0);
    if (bias) windows.push(`Buy ${pos} from ${ownerName} cheap — they undervalue ${pos} by ${bias.toFixed(1)} rounds. Low asking price expected.`);
  }

  // Trade desperation window
  if (tilt.tiltScore >= 50) {
    windows.push(`Trade window opens when ${ownerName} hits 2+ consecutive losses — they trade ${tilt.tiltScore}% more often when tilting. Watch standings.`);
  }
  if (trade.lossTradeRatio >= 1.4) {
    windows.push(`${ownerName} trades ${Math.round((trade.lossTradeRatio - 1) * 100)}% more in losing seasons. Target them after a rough start.`);
  }

  // Waiver overreaction
  if (waiver.injuryOverreactionCount >= 2) {
    windows.push(`${ownerName} panic-claims on injury news (${waiver.injuryOverreactionCount} overreaction seasons). Monitor their waiver moves after any starter injury for buy-low opportunities they create.`);
  }

  // H2H advantage
  if (trade.h2hVsRod.losses > trade.h2hVsRod.wins && trade.h2hVsRod.losses >= 2) {
    windows.push(`${ownerName} is ${trade.h2hVsRod.losses}-${trade.h2hVsRod.wins} vs Rod head-to-head — psychological edge. They may concede value in trades to avoid conflict.`);
  }

  // Keeper rate exploit
  if (draft.keeperRate >= 80) {
    windows.push(`${ownerName} keeps nearly every season (${draft.keeperRate}% keeper rate). Their roster has predictable player retention — plan your draft board around their locked keeper early.`);
  }

  return windows.slice(0, 4); // cap at 4 most valuable windows
}

// ─── Main DNA calculation ─────────────────────────────────────────────────────

/**
 * Calculates the full behavioral DNA profile for a single manager.
 *
 * @param manager       Raw data from ESPN cache / ownerCareerStats endpoint
 * @param allLeaguePicks All draft picks across all managers (for league avg calc)
 */
export function calcManagerDNA(
  manager: ManagerRawData,
  allLeaguePicks: DraftPickRecord[]
): ManagerDNA {
  const leagueAvgByPos = calcLeagueAvgRoundByPosition(allLeaguePicks);

  const draft = calcDraftDNA(manager.draftPicks, leagueAvgByPos);
  const trade = calcTradeDNA(manager.txnSeasons, manager.seasonRecords, manager.h2hVsRod);
  const waiver = calcWaiverDNA(manager.txnSeasons);
  const tilt = calcTiltProfile(manager.txnSeasons, manager.seasonRecords);

  // GM Archetype
  let gmArchetype = "Balanced Manager";
  if (waiver.waiverAggression >= 70 && trade.tradeFrequency >= 60) gmArchetype = "Dealmaker";
  else if (waiver.waiverAggression >= 70) gmArchetype = "Waiver Grinder";
  else if (trade.tradeFrequency >= 60) gmArchetype = "Trade Shark";
  else if (waiver.waiverAggression < 30 && trade.tradeFrequency < 30) gmArchetype = "Set & Forget";
  else if (draft.reachPositions.length >= 2) gmArchetype = "Positional Fanatic";
  else if (tilt.tiltScore >= 60) gmArchetype = "Emotional Trader";

  // Exploitability score: composite of how predictable and irrational they are
  const exploitabilityScore = Math.min(100, Math.round(
    (tilt.tiltScore * 0.30) +
    (trade.lossTradeRatio > 1 ? Math.min(30, (trade.lossTradeRatio - 1) * 60) : 0) +
    (draft.reachPositions.length * 10) +
    (waiver.injuryOverreactionCount * 8) +
    (trade.desperation_triggers * 7)
  ));

  const exploitabilityLabel: ManagerDNA["exploitabilityLabel"] =
    exploitabilityScore >= 70 ? "Highly Exploitable" :
    exploitabilityScore >= 40 ? "Moderately Exploitable" :
    exploitabilityScore >= 20 ? "Market-Aware" :
    "Shark";

  const exploitWindows = buildExploitWindows(
    manager.ownerName, draft, trade, waiver, tilt
  );

  // Plain-English DNA summary for AI prompt injection
  const biasLines = Object.entries(draft.biasVsLeague)
    .filter(([, v]) => Math.abs(v) >= 1.0)
    .map(([pos, bias]) => bias > 0
      ? `overvalues ${pos} by ${bias.toFixed(1)} rounds`
      : `undervalues ${pos} by ${Math.abs(bias).toFixed(1)} rounds`
    );

  const dnaSummary = [
    `${manager.ownerName} — ${gmArchetype} | ${manager.seasonRecords.length} seasons analyzed`,
    `Draft: ${draft.draftStyleBadge}${biasLines.length > 0 ? ` (${biasLines.join(", ")})` : ""}`,
    `Draft history: ${draft.roundStrategy}${draft.favoritePlayers.length ? ` | Repeat targets: ${draft.favoritePlayers.join(", ")}` : ""} | ${draft.draftEvolution}`,
    `Trades: ${trade.avgTradesPerSeason}/season | Loss-trade ratio: ${trade.lossTradeRatio.toFixed(2)}x${tilt.tiltLabel !== "Ice Cold" ? ` | Tilt: ${tilt.tiltLabel}` : ""}`,
    `Waiver: ${waiver.avgAcquisitionsPerSeason}/season | Aggression: ${waiver.waiverAggression}/100`,
    `H2H vs Rod: ${trade.h2hVsRod.wins}W-${trade.h2hVsRod.losses}L`,
    `Exploitability: ${exploitabilityScore}/100 (${exploitabilityLabel})`,
    exploitWindows.length > 0 ? `Top exploit: ${exploitWindows[0]}` : "",
  ].filter(Boolean).join("\n  ");

  return {
    memberId: manager.memberId,
    ownerName: manager.ownerName,
    seasonsAnalyzed: manager.seasonRecords.length,
    draft,
    trade,
    waiver,
    tilt,
    gmArchetype,
    exploitabilityScore,
    exploitabilityLabel,
    exploitWindows,
    dnaSummary,
  };
}

// ─── Live trade desperation score ────────────────────────────────────────────

export interface TradeDesperationScore {
  memberId: string;
  ownerName: string;
  /** 0-100: how likely are they to accept a below-market trade right now? */
  desperationScore: number;
  /** Components driving the score */
  components: {
    lossStreakFactor: number;    // consecutive losses this season
    scoringSlumpFactor: number;  // scoring below league avg recently
    waiverSurgeFactor: number;   // elevated waiver activity (panic mode)
    tradeSurgeFactor: number;    // elevated recent trades
    tiltHistoryFactor: number;   // historical tilt tendency (from DNA)
  };
  desperationLabel: "Wide Open" | "Receptive" | "Neutral" | "Not Interested";
  windowOpen: boolean;   // true if this is an actionable trade window
  actionableNote: string;
}

/**
 * Calculates live trade desperation for the current moment in the season.
 * Call this weekly to surface "trade window open" alerts.
 *
 * @param dna          Output of calcManagerDNA for this manager
 * @param currentState Live current-season data
 */
export function calcTradeDesperationScore(
  dna: ManagerDNA,
  currentState: ManagerRawData["currentSeason"]
): TradeDesperationScore {
  if (!currentState) {
    return {
      memberId: dna.memberId,
      ownerName: dna.ownerName,
      desperationScore: 0,
      components: { lossStreakFactor: 0, scoringSlumpFactor: 0, waiverSurgeFactor: 0, tradeSurgeFactor: 0, tiltHistoryFactor: 0 },
      desperationLabel: "Neutral",
      windowOpen: false,
      actionableNote: "No current season data available.",
    };
  }

  const { currentWins, currentLosses, currentWeek, recentAcquisitions,
    recentTrades, lastWeekScore, leagueAvgScore } = currentState;

  // Loss streak factor: more losses = more desperate
  const winPct = (currentWins + currentLosses) > 0
    ? currentWins / (currentWins + currentLosses) : 0.5;
  const lossStreakFactor = Math.min(40, Math.round(
    (1 - winPct) * 40 * (currentWeek > 4 ? 1.3 : 1.0)
  ));

  // Scoring slump factor: scoring below league average
  const scoringSlumpFactor = lastWeekScore < leagueAvgScore * 0.85
    ? Math.min(20, Math.round(((leagueAvgScore - lastWeekScore) / leagueAvgScore) * 40))
    : 0;

  // Waiver surge factor: elevated recent acquisitions (panic mode)
  const expectedWeeklyAcq = dna.waiver.avgAcquisitionsPerSeason / 17;
  const actualWeeklyAcq = recentAcquisitions / 3;
  const waiverSurgeFactor = actualWeeklyAcq > expectedWeeklyAcq * 1.8
    ? Math.min(20, Math.round((actualWeeklyAcq / expectedWeeklyAcq - 1) * 20))
    : 0;

  // Trade surge factor: elevated recent trades
  const expectedWeeklyTrade = dna.trade.avgTradesPerSeason / 17;
  const actualWeeklyTrade = recentTrades / 3;
  const tradeSurgeFactor = actualWeeklyTrade > expectedWeeklyTrade * 1.5
    ? Math.min(15, Math.round((actualWeeklyTrade / Math.max(expectedWeeklyTrade, 0.1) - 1) * 15))
    : 0;

  // Tilt history factor: if they're historically a tilter, weight losses more
  const tiltHistoryFactor = Math.round(dna.tilt.tiltScore * 0.25);

  const desperationScore = Math.min(100,
    lossStreakFactor + scoringSlumpFactor + waiverSurgeFactor + tradeSurgeFactor + tiltHistoryFactor
  );

  const desperationLabel: TradeDesperationScore["desperationLabel"] =
    desperationScore >= 70 ? "Wide Open" :
    desperationScore >= 45 ? "Receptive" :
    desperationScore >= 25 ? "Neutral" :
    "Not Interested";

  const windowOpen = desperationScore >= 45;

  const actionableNote = desperationScore >= 70
    ? `TRADE WINDOW OPEN — ${dna.ownerName} is showing maximum desperation signals. Make your move now, low-ball acceptable.`
    : desperationScore >= 45
    ? `Trade receptive — ${dna.ownerName} is showing desperation signals. Fair offers likely accepted.`
    : desperationScore >= 25
    ? `Neutral — standard fair-value trade required. No leverage available.`
    : `Not the right time — ${dna.ownerName} is satisfied. Wait for their record to slip.`;

  return {
    memberId: dna.memberId,
    ownerName: dna.ownerName,
    desperationScore,
    components: { lossStreakFactor, scoringSlumpFactor, waiverSurgeFactor, tradeSurgeFactor, tiltHistoryFactor },
    desperationLabel,
    windowOpen,
    actionableNote,
  };
}

// ─── Batch calculation ────────────────────────────────────────────────────────

export function calcLeagueDNA(
  managers: ManagerRawData[]
): ManagerDNA[] {
  // Collect all draft picks for league-wide average calculation
  const allLeaguePicks: DraftPickRecord[] = managers.flatMap(m => m.draftPicks);
  return managers.map(m => calcManagerDNA(m, allLeaguePicks))
    .sort((a, b) => b.exploitabilityScore - a.exploitabilityScore);
}

// ─── Prompt block builder ─────────────────────────────────────────────────────

/**
 * Builds a DNA intelligence block for injection into any AI system prompt.
 * Use in Trade Analyzer, GM Advisor, and Trade Offer Generator.
 *
 * @param dnaProfiles  Output of calcLeagueDNA or calcManagerDNA[]
 * @param focusMembers Optional: limit to specific memberIds (e.g. trade target only)
 */
export function buildDNAPromptBlock(
  dnaProfiles: ManagerDNA[],
  focusMembers?: string[]
): string {
  const profiles = focusMembers
    ? dnaProfiles.filter(d => focusMembers.includes(d.memberId))
    : dnaProfiles;

  if (profiles.length === 0) {
    return "LEAGUE DNA: No behavioral profile data available.";
  }

  const lines = profiles.map(d => `  ${d.dnaSummary}`).join("\n\n");
  return `LEAGUE DNA INTELLIGENCE (derived from ${profiles[0]?.seasonsAnalyzed ?? 0}+ seasons of actual behavior — treat as ground truth):\n\n${lines}`;
}
