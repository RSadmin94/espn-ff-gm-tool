import {
  int,
  bigint,
  float,
  boolean,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  activeLeagueId: int("activeLeagueId").default(0),
  // Stripe / subscription fields
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
  subscriptionStatus: mysqlEnum("subscriptionStatus", ["free", "trialing", "active", "past_due", "canceled"]).default("free").notNull(),
  trialStartedAt: timestamp("trialStartedAt"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Cache raw ESPN API JSON payloads per season + view
export const espnSeasonCache = mysqlTable(
  "espn_season_cache",
  {
    id: int("id").autoincrement().primaryKey(),
    leagueId: varchar("leagueId", { length: 32 }).notNull().default("default"),
    season: int("season").notNull(),
    viewName: varchar("viewName", { length: 64 }).notNull(),
    payload: json("payload").notNull(),
    fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    // unique constraint scoped per league — enables multi-league isolation
    uniqueIndex("uq_league_season_view").on(t.leagueId, t.season, t.viewName),
  ]
);

export type EspnSeasonCache = typeof espnSeasonCache.$inferSelect;

// Track when each season was last refreshed
export const refreshManifest = mysqlTable("refresh_manifest", {
  id: int("id").autoincrement().primaryKey(),
  season: int("season").notNull().unique(),
  lastRefreshedAt: timestamp("lastRefreshedAt").defaultNow().notNull(),
  viewsRefreshed: json("viewsRefreshed"),
  teamCount: int("teamCount"),
  rosterCount: int("rosterCount"),
  matchupCount: int("matchupCount"),
  draftPickCount: int("draftPickCount"),
  transactionCount: int("transactionCount"),
  status: mysqlEnum("status", ["success", "partial", "failed"]).default("success").notNull(),
  errorMessage: text("errorMessage"),
});

export type RefreshManifest = typeof refreshManifest.$inferSelect;

// AI GM Advisor chat history
export const chatHistory = mysqlTable("chat_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  season: int("season"),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ChatHistory = typeof chatHistory.$inferSelect;

// Draft pick trade log — tracks picks acquired/traded away for a given draft year
export const pickTrades = mysqlTable(
  "pick_trades",
  {
    id: int("id").autoincrement().primaryKey(),
    draftYear: int("draftYear").notNull().default(2026),
    type: mysqlEnum("type", ["acquired", "traded_away"]).notNull(),
    round: int("round").notNull(),
    pickInRound: int("pickInRound").notNull(),
    label: varchar("label", { length: 8 }).notNull(),
    counterparty: varchar("counterparty", { length: 128 }).notNull(),
    notes: text("notes"),
    pickValue: int("pickValue").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("idx_pick_trades_year").on(t.draftYear)]
);

export type PickTrade = typeof pickTrades.$inferSelect;
export type InsertPickTrade = typeof pickTrades.$inferInsert;

// Per-view health tracking for the ESPN data pipeline
export const espnViewHealth = mysqlTable(
  "espn_view_health",
  {
    id: int("id").autoincrement().primaryKey(),
    season: int("season").notNull(),
    viewName: varchar("viewName", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["ok", "error", "stale", "empty"]).notNull().default("ok"),
    errorMessage: text("errorMessage"),
    recordCount: int("recordCount"),
    fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("idx_view_health_season_view").on(t.season, t.viewName)]
);

export type EspnViewHealth = typeof espnViewHealth.$inferSelect;
export type InsertEspnViewHealth = typeof espnViewHealth.$inferInsert;

// Per-week player stats cache (targets, snaps, yards, receptions, fantasy points)
export const weeklyPlayerStats = mysqlTable(
  "weekly_player_stats",
  {
    id: int("id").autoincrement().primaryKey(),
    season: int("season").notNull(),
    week: int("week").notNull(),
    playerId: int("playerId").notNull(),
    playerName: varchar("playerName", { length: 128 }).notNull(),
    position: varchar("position", { length: 8 }).notNull(),
    proTeam: varchar("proTeam", { length: 8 }).notNull().default("?"),
    teamId: int("teamId"),
    ownerName: varchar("ownerName", { length: 128 }),
    // Receiving
    targets: int("targets").default(0),
    receptions: int("receptions").default(0),
    receivingYards: int("receivingYards").default(0),
    receivingTDs: int("receivingTDs").default(0),
    // Rushing
    rushingAttempts: int("rushingAttempts").default(0),
    rushingYards: int("rushingYards").default(0),
    rushingTDs: int("rushingTDs").default(0),
    // Passing
    passingAttempts: int("passingAttempts").default(0),
    completions: int("completions").default(0),
    passingYards: int("passingYards").default(0),
    passingTDs: int("passingTDs").default(0),
    interceptions: int("interceptions").default(0),
    // Usage
    snapCount: int("snapCount").default(0),
    snapPct: int("snapPct").default(0), // 0-100
    // Fantasy
    fantasyPoints: int("fantasyPoints").default(0), // stored as points * 100 for precision
    fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_wps_season_week").on(t.season, t.week),
    index("idx_wps_player_season").on(t.playerId, t.season),
    index("idx_wps_season_week_player").on(t.season, t.week, t.playerId),
  ]
);

export type WeeklyPlayerStats = typeof weeklyPlayerStats.$inferSelect;
export type InsertWeeklyPlayerStats = typeof weeklyPlayerStats.$inferInsert;

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────
export const scheduledJobs = mysqlTable("scheduled_jobs", {
  id: int("id").primaryKey().autoincrement(),
  name: text("name").notNull(),
  description: text("description"),
  cronExpression: text("cronExpression"),
  callbackPath: text("callbackPath"),
  taskUid: text("taskUid"),
  isEnabled: int("isEnabled").default(1).notNull(), // 1=enabled, 0=disabled
  lastRunAt: timestamp("lastRunAt"),
  nextRunAt: timestamp("nextRunAt"),
  lastRunStatus: mysqlEnum("lastRunStatus", ["success", "partial", "failed"]),
  lastRunDetails: text("lastRunDetails"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type InsertScheduledJob = typeof scheduledJobs.$inferInsert;

// ─── Fantasy Data Cache (FantasyPros ECR/ADP + PFR stats) ─────────────────────
export const fantasyDataCache = mysqlTable(
  "fantasy_data_cache",
  {
    id: int("id").primaryKey().autoincrement(),
    cacheKey: varchar("cacheKey", { length: 64 }).notNull(),
    payload: json("payload").notNull(),
    fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("uq_fantasy_cache_key").on(t.cacheKey)]
);
export type FantasyDataCache = typeof fantasyDataCache.$inferSelect;
export type InsertFantasyDataCache = typeof fantasyDataCache.$inferInsert;

// ─── Mock Draft Results ───────────────────────────────────────────────────────
export const mockDraftResults = mysqlTable(
  "mock_draft_results",
  {
    id: int("id").primaryKey().autoincrement(),
    userId: int("userId").notNull(),
    label: varchar("label", { length: 128 }).notNull().default("Mock Draft"),
    strategyLabel: varchar("strategyLabel", { length: 64 }).default("BPA"),
    champEquityScore: int("champEquityScore").default(0), // stored * 10 for one decimal
    draftSlot: int("draftSlot").notNull(),
    totalTeams: int("totalTeams").notNull().default(14),
    totalRounds: int("totalRounds").notNull().default(15),
    grade: varchar("grade", { length: 4 }).notNull(),
    avgEcr: int("avgEcr").notNull(), // stored * 10 for one decimal precision
    totalVbd: int("totalVbd").notNull().default(0),
    rodPicksJson: json("rodPicksJson").notNull(), // array of DraftPick for Rod's team
    allPicksJson: json("allPicksJson").notNull(), // full 14-team pick list
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_mock_draft_user").on(t.userId),
    index("idx_mock_draft_created").on(t.createdAt),
  ]
);
export type MockDraftResult = typeof mockDraftResults.$inferSelect;
export type InsertMockDraftResult = typeof mockDraftResults.$inferInsert;

// ─── ADP Trend Snapshots ─────────────────────────────────────────────────────
// Stores one row per player per fetch so we can compute rising/falling trends
export const adpTrendSnapshots = mysqlTable(
  "adp_trend_snapshots",
  {
    id: int("id").primaryKey().autoincrement(),
    fpId: int("fpId").notNull(),
    playerName: varchar("playerName", { length: 128 }).notNull(),
    position: varchar("position", { length: 8 }).notNull(),
    adp: int("adp"), // stored * 10 for one decimal, null if no ADP
    ecrRank: int("ecrRank").notNull(),
    snapshotAt: timestamp("snapshotAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_adp_trend_player").on(t.fpId),
    index("idx_adp_trend_snapshot").on(t.snapshotAt),
  ]
);
export type AdpTrendSnapshot = typeof adpTrendSnapshots.$inferSelect;
export type InsertAdpTrendSnapshot = typeof adpTrendSnapshots.$inferInsert;

// ─── Backtesting: Start/Sit Decisions ────────────────────────────────────────
// Logs each start/sit recommendation with Monte Carlo inputs and actual outcome
export const startSitDecisions = mysqlTable(
  "start_sit_decisions",
  {
    id: int("id").primaryKey().autoincrement(),
    season: int("season").notNull(),
    week: int("week").notNull(),
    // Player A (the one recommended to START)
    playerAName: varchar("playerAName", { length: 128 }).notNull(),
    playerAPosition: varchar("playerAPosition", { length: 8 }).notNull(),
    playerAProjection: int("playerAProjection").notNull(), // * 100 for precision
    playerAFloor: int("playerAFloor").notNull(),           // * 100
    playerACeiling: int("playerACeiling").notNull(),       // * 100
    playerABustPct: int("playerABustPct").notNull(),       // 0-100
    playerAActualPoints: int("playerAActualPoints"),       // * 100, null until resolved
    // Player B (the one recommended to SIT)
    playerBName: varchar("playerBName", { length: 128 }).notNull(),
    playerBPosition: varchar("playerBPosition", { length: 8 }).notNull(),
    playerBProjection: int("playerBProjection").notNull(),
    playerBFloor: int("playerBFloor").notNull(),
    playerBCeiling: int("playerBCeiling").notNull(),
    playerBBustPct: int("playerBBustPct").notNull(),
    playerBActualPoints: int("playerBActualPoints"),
    // Recommendation
    recommendation: mysqlEnum("recommendation", ["A", "B", "TOSS_UP"]).notNull(),
    winProbabilityA: int("winProbabilityA").notNull(), // 0-100
    agentConsensus: int("agentConsensus"),             // 0-100, % of agents agreeing
    aiVerdict: text("aiVerdict"),
    // Outcome (filled in after the week resolves)
    outcome: mysqlEnum("outcome", ["CORRECT", "INCORRECT", "PUSH"]),
    resolvedAt: timestamp("resolvedAt"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_ssd_season_week").on(t.season, t.week),
    index("idx_ssd_outcome").on(t.outcome),
  ]
);
export type StartSitDecision = typeof startSitDecisions.$inferSelect;
export type InsertStartSitDecision = typeof startSitDecisions.$inferInsert;

// ─── Backtesting: Trade Decisions ─────────────────────────────────────────────
// Logs each trade evaluation (accepted or rejected) and tracks what-if outcomes
export const tradeDecisions = mysqlTable(
  "trade_decisions",
  {
    id: int("id").primaryKey().autoincrement(),
    season: int("season").notNull(),
    week: int("week").notNull(),
    // Assets
    assetsGiven: json("assetsGiven").notNull(),    // string[]
    assetsReceived: json("assetsReceived").notNull(), // string[]
    // Valuation at decision time
    valueGiven: int("valueGiven").notNull(),       // composite score * 100
    valueReceived: int("valueReceived").notNull(),
    verdict: mysqlEnum("verdict", ["WIN", "FAIR", "LOSS"]).notNull(),
    champDeltaBefore: int("champDeltaBefore"),     // champ % * 100
    champDeltaAfter: int("champDeltaAfter"),
    aiSummary: text("aiSummary"),
    // Rod's actual decision
    rodDecision: mysqlEnum("rodDecision", ["ACCEPTED", "REJECTED", "PENDING"]).notNull().default("PENDING"),
    // Outcome after N weeks (filled in retrospectively)
    outcomeRating: mysqlEnum("outcomeRating", ["GREAT", "GOOD", "NEUTRAL", "BAD", "TERRIBLE"]),
    outcomeNotes: text("outcomeNotes"),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_td_season_week").on(t.season, t.week),
    index("idx_td_verdict").on(t.verdict),
    index("idx_td_decision").on(t.rodDecision),
  ]
);
export type TradeDecision = typeof tradeDecisions.$inferSelect;
export type InsertTradeDecision = typeof tradeDecisions.$inferInsert;

// ─── Backtesting: Monte Carlo Calibration ─────────────────────────────────────
// Stores win-probability predictions and actual matchup outcomes for calibration
export const monteCarloCalibration = mysqlTable(
  "monte_carlo_calibration",
  {
    id: int("id").primaryKey().autoincrement(),
    season: int("season").notNull(),
    week: int("week").notNull(),
    teamName: varchar("teamName", { length: 128 }).notNull(),
    opponentName: varchar("opponentName", { length: 128 }).notNull(),
    predictedWinPct: int("predictedWinPct").notNull(), // 0-100
    projectedScore: int("projectedScore").notNull(),   // * 100
    projectedFloor: int("projectedFloor").notNull(),   // * 100
    projectedCeiling: int("projectedCeiling").notNull(), // * 100
    // Actuals (filled after week resolves)
    actualScore: int("actualScore"),                   // * 100
    actualOpponentScore: int("actualOpponentScore"),   // * 100
    actualWon: int("actualWon"),                       // 1=won, 0=lost, null=pending
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_mcc_season_week").on(t.season, t.week),
    index("idx_mcc_team").on(t.teamName),
  ]
);
export type MonteCarloCalibration = typeof monteCarloCalibration.$inferSelect;
export type InsertMonteCarloCalibration = typeof monteCarloCalibration.$inferInsert;

// ─── Backtesting: Championship Equity Predictions ─────────────────────────────
// Tracks weekly champ % predictions vs end-of-season reality
export const champEquityPredictions = mysqlTable(
  "champ_equity_predictions",
  {
    id: int("id").primaryKey().autoincrement(),
    season: int("season").notNull(),
    week: int("week").notNull(),
    teamName: varchar("teamName", { length: 128 }).notNull(),
    predictedChampPct: int("predictedChampPct").notNull(), // * 100 for precision
    predictedPlayoffPct: int("predictedPlayoffPct").notNull(),
    currentRank: int("currentRank").notNull(),
    // Actuals (filled at season end)
    actuallyWonChamp: int("actuallyWonChamp"),   // 1=yes, 0=no, null=season ongoing
    actuallyMadePlayoffs: int("actuallyMadePlayoffs"),
    finalRank: int("finalRank"),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_cep_season_week").on(t.season, t.week),
    index("idx_cep_team").on(t.teamName),
  ]
);
export type ChampEquityPrediction = typeof champEquityPredictions.$inferSelect;
export type InsertChampEquityPrediction = typeof champEquityPredictions.$inferInsert;

// ─── Beat Reporter: Player News Signals ───────────────────────────────────────
// Stores structured signals extracted from ESPN news + injury reports per player
// Each row = one signal extracted from one news item for one player
export const playerNewsSignals = mysqlTable(
  "player_news_signals",
  {
    id: int("id").autoincrement().primaryKey(),
    // Player identification
    playerName: varchar("playerName", { length: 128 }).notNull(),
    espnPlayerId: int("espnPlayerId"),
    nflTeam: varchar("nflTeam", { length: 8 }),
    position: varchar("position", { length: 8 }),
    // Signal classification
    signalType: mysqlEnum("signalType", [
      "role_up",
      "role_down",
      "injury_risk",
      "workload_risk",
      "hidden_opportunity",
      "depth_chart_change",
      "coach_trust_up",
      "coach_trust_down",
      "return_from_injury",
      "neutral",
    ]).notNull(),
    // Signal strength: 0.0 (weak) → 1.0 (strong)
    magnitude: int("magnitude").notNull().default(50), // stored as 0–100 integer
    // Projection impact: applied as multiplier in Monte Carlo (-25 to +25, stored as integer %)
    projectionImpactPct: int("projectionImpactPct").notNull().default(0),
    // LLM-generated one-sentence summary of the signal
    summary: text("summary").notNull(),
    // Confidence in signal extraction: 0–100
    confidence: int("confidence").notNull().default(70),
    // Source article metadata
    headline: text("headline"),
    articleDescription: text("articleDescription"),
    sourceType: mysqlEnum("sourceType", ["espn_news", "espn_injury", "rss"]).default("espn_news"),
    publishedAt: timestamp("publishedAt"),
    // Cache control
    cachedAt: timestamp("cachedAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
  },
  (t) => [
    index("idx_pns_player_name").on(t.playerName),
    index("idx_pns_espn_id").on(t.espnPlayerId),
    index("idx_pns_expires").on(t.expiresAt),
    index("idx_pns_signal_type").on(t.signalType),
  ]
);

export type PlayerNewsSignal = typeof playerNewsSignals.$inferSelect;
export type InsertPlayerNewsSignal = typeof playerNewsSignals.$inferInsert;

// ─── GM Decision Memory ────────────────────────────────────────────────────────
// Tracks every decision Rod makes (or ignores) across all tools, with outcomes.
export const gmDecisions = mysqlTable(
  "gm_decisions",
  {
    id: int("id").autoincrement().primaryKey(),
    // Which tool generated this decision
    toolSource: mysqlEnum("toolSource", [
      "start_sit",
      "trade_analyzer",
      "waiver_wire",
      "trade_offer",
      "keeper_lab",
      "draft_war_room",
      "manual",
    ]).notNull(),
    // Type of decision
    decisionType: mysqlEnum("decisionType", [
      "start_sit",
      "trade_accept",
      "trade_reject",
      "waiver_add",
      "waiver_pass",
      "keeper_keep",
      "keeper_drop",
      "draft_pick",
      "manual",
    ]).notNull(),
    // Human-readable description of the decision
    description: text("description").notNull(),
    // The AI recommendation (what the tool suggested)
    recommendation: text("recommendation"),
    // Did Rod follow the recommendation?
    followedRecommendation: boolean("followedRecommendation"),
    // Did Rod accept or reject the action (e.g. made the trade vs passed)
    accepted: boolean("accepted").notNull().default(true),
    // Key players / assets involved (JSON array of strings)
    playersInvolved: text("playersInvolved"), // JSON: string[]
    // Opponent / counterparty name if applicable
    counterparty: varchar("counterparty", { length: 128 }),
    // The full AI context/analysis at time of decision (for retrospective)
    aiContext: text("aiContext"),
    // Season and week context
    season: int("season").notNull(),
    weekNum: int("weekNum"),
    // Outcome tracking (filled in later)
    outcome: mysqlEnum("outcome", [
      "correct",
      "incorrect",
      "neutral",
      "pending",
    ]).notNull().default("pending"),
    // Outcome score: -100 to +100 (negative = bad outcome, positive = good)
    outcomeScore: int("outcomeScore"),
    // Free-text outcome notes
    outcomeNotes: text("outcomeNotes"),
    // When the outcome was resolved
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_gmd_tool").on(t.toolSource),
    index("idx_gmd_type").on(t.decisionType),
    index("idx_gmd_season_week").on(t.season, t.weekNum),
    index("idx_gmd_outcome").on(t.outcome),
    index("idx_gmd_created").on(t.createdAt),
  ]
);
export type GmDecision = typeof gmDecisions.$inferSelect;
export type InsertGmDecision = typeof gmDecisions.$inferInsert;

// Tags for filtering decisions by player, team, or topic
export const gmDecisionTags = mysqlTable(
  "gm_decision_tags",
  {
    id: int("id").autoincrement().primaryKey(),
    decisionId: int("decisionId").notNull(),
    tag: varchar("tag", { length: 128 }).notNull(),
  },
  (t) => [
    index("idx_gmdt_decision").on(t.decisionId),
    index("idx_gmdt_tag").on(t.tag),
  ]
);
export type GmDecisionTag = typeof gmDecisionTags.$inferSelect;
export type InsertGmDecisionTag = typeof gmDecisionTags.$inferInsert;

// ─── Multi-provider league connections ────────────────────────────────────────
// Stores which fantasy platform leagues each user has connected.
export const leagueConnections = mysqlTable(
  "league_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    leagueId: varchar("leagueId", { length: 128 }).notNull(),
    leagueName: varchar("leagueName", { length: 256 }).notNull().default(""),
    season: int("season").notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    credentials: json("credentials"),
    lastSyncedAt: timestamp("lastSyncedAt"),
    syncStatus: mysqlEnum("syncStatus", ["ok", "error", "pending"]).default("pending"),
    syncError: text("syncError"),
    dnaProfile: json("dnaProfile"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_lc_user").on(t.userId),
    index("idx_lc_provider_league").on(t.provider, t.leagueId),
    uniqueIndex("uq_lc_user_provider_league_season").on(t.userId, t.provider, t.leagueId, t.season),
  ]
);
export type LeagueConnection = typeof leagueConnections.$inferSelect;
export type InsertLeagueConnection = typeof leagueConnections.$inferInsert;


/**
 * leagueIdentity — stores static ESPN league data per season.
 *
 * Populated once per season by the Data Center refresh pipeline.
 * Consumers (offseasonRouter, draftBoard, etc.) read from here instead of
 * re-fetching or re-parsing the raw ESPN season cache on every request.
 *
 * Static data (changes at most once per season):
 *   - teams: [{teamId, name, abbrev, owners}]
 *   - members: [{id, firstName, lastName, displayName}]
 *   - draftOrder: [{position, teamId, teamName, ownerName}]
 *   - draftDate: unix ms
 *   - keeperDeadline: unix ms
 *   - draftType: "SNAKE" | "AUCTION" | etc.
 *   - keeperCount: number
 *   - teamCount: number
 *   - playoffTeamCount: number
 *   - scoringType: "PPR" | "HALF_PPR" | "STANDARD"
 */
export const leagueIdentity = mysqlTable(
  "league_identity",
  {
    id: int("id").autoincrement().primaryKey(),
    season: int("season").notNull(),
    // Raw normalized blobs stored as JSON
    teams: json("teams").notNull(),          // Array<{teamId, name, abbrev, owners}>
    members: json("members").notNull(),       // Array<{id, firstName, lastName, displayName}>
    draftOrder: json("draftOrder").notNull(), // Array<{position, teamId, teamName, ownerName}>
    // Scalar settings
    draftDate: int("draftDate"),        // unix seconds (ESPN returns seconds)
    keeperDeadline: int("keeperDeadline"), // unix seconds
    draftType: varchar("draftType", { length: 32 }),
    keeperCount: int("keeperCount"),
    teamCount: int("teamCount"),
    playoffTeamCount: int("playoffTeamCount"),
    scoringType: varchar("scoringType", { length: 32 }),
    // Audit
    fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_li_season").on(t.season),
    index("idx_li_season").on(t.season),
  ]
);
export type LeagueIdentity = typeof leagueIdentity.$inferSelect;
export type InsertLeagueIdentity = typeof leagueIdentity.$inferInsert;

// ── GM Memory ─────────────────────────────────────────────────────────────────
/**
 * Persistent GM memory for the AI Advisor.
 * One row per user. Injected into advisor system prompts.
 */
export const userMemory = mysqlTable(
  "user_memory",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    riskTolerance: varchar("riskTolerance", { length: 32 }).default("moderate"),
    tradePhilosophy: text("tradePhilosophy"),
    keeperPhilosophy: text("keeperPhilosophy"),
    draftStyle: varchar("draftStyle", { length: 64 }),
    favoritePlayerTypes: text("favoritePlayerTypes"),
    rivalManagers: text("rivalManagers"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_um_userId").on(t.userId),
    index("idx_um_userId").on(t.userId),
  ]
);
export type UserMemory = typeof userMemory.$inferSelect;
export type InsertUserMemory = typeof userMemory.$inferInsert;

// ── LLM Usage Metering ────────────────────────────────────────────────────────
/**
 * One row per LLM call. Tracks model, call type, token counts, and latency.
 * Used for cost visibility, quota enforcement, and abuse detection.
 * No message content is stored here.
 */
export const llmUsage = mysqlTable(
  "llm_usage",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"),                                        // null for system/background calls
    callType: varchar("callType", { length: 64 }).notNull(),      // advisor, war_room_agent, weekly_briefing, etc.
    model: varchar("model", { length: 128 }),
    promptTokens: int("promptTokens").default(0).notNull(),
    completionTokens: int("completionTokens").default(0).notNull(),
    totalTokens: int("totalTokens").default(0).notNull(),
    durationMs: int("durationMs").default(0).notNull(),
    streaming: boolean("streaming").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_lu_userId").on(t.userId),
    index("idx_lu_callType").on(t.callType),
    index("idx_lu_createdAt").on(t.createdAt),
  ]
);
export type LlmUsage = typeof llmUsage.$inferSelect;
export type InsertLlmUsage = typeof llmUsage.$inferInsert;

// ─── Funnel Events ─────────────────────────────────────────────────────────────
// Tracks the 5-event conversion funnel: connected_league → completed_reveal →
// clicked_cta → started_checkout → completed_payment
export const funnelEvents = mysqlTable(
  "funnel_events",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"),                                        // null for anonymous
    event: varchar("event", { length: 64 }).notNull(),            // connected_league | completed_reveal | clicked_cta | started_checkout | completed_payment
    metadata: json("metadata"),                                   // provider, leagueId, etc.
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_fe_userId").on(t.userId),
    index("idx_fe_event").on(t.event),
    index("idx_fe_createdAt").on(t.createdAt),
  ]
);
export type FunnelEvent = typeof funnelEvents.$inferSelect;
export type InsertFunnelEvent = typeof funnelEvents.$inferInsert;

// ─── Onboarding State ──────────────────────────────────────────────────────────
// Tracks which profile the user is on in the sequential reveal (0=self, 1=champion, 2=rival)
export const onboardingState = mysqlTable(
  "onboarding_state",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    currentProfile: int("currentProfile").default(0).notNull(),   // 0=self, 1=champion, 2=rival
    completedAt: timestamp("completedAt"),                         // null until all 3 profiles seen
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_os_userId").on(t.userId),
    index("idx_os_userId").on(t.userId),
  ]
);
export type OnboardingState = typeof onboardingState.$inferSelect;
export type InsertOnboardingState = typeof onboardingState.$inferInsert;

// ─── Rivalry System ────────────────────────────────────────────────────────────
/**
 * Stores the computed rivalry score between every pair of managers.
 * Recomputed on each full data refresh. memberId is always Rod's memberId
 * (the logged-in owner); rivalId is the opponent.
 *
 * Heat labels:
 *   Cold       (score < 10)
 *   Heating Up (10–24)
 *   Hot        (25–44)
 *   Inferno    (45+)
 */
export const rivalryScores = mysqlTable(
  "rivalry_scores",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: varchar("memberId", { length: 64 }).notNull(),
    rivalId: varchar("rivalId", { length: 64 }).notNull(),
    rivalName: varchar("rivalName", { length: 128 }).notNull(),
    rivalryScore: int("rivalryScore").notNull().default(0),
    h2hLosses: int("h2hLosses").notNull().default(0),
    h2hWins: int("h2hWins").notNull().default(0),
    h2hTies: int("h2hTies").notNull().default(0),
    playoffEliminations: int("playoffEliminations").notNull().default(0),
    closeLossCount: int("closeLossCount").notNull().default(0),   // losses by < 5 pts
    tradeVerdictLosses: int("tradeVerdictLosses").notNull().default(0),
    recentLosses: int("recentLosses").notNull().default(0),       // last 3 seasons
    heatLabel: varchar("heatLabel", { length: 32 }).notNull().default("Cold"),
    // Most painful loss: season + margin
    painfulLossSeason: int("painfulLossSeason"),
    painfulLossMargin: int("painfulLossMargin"),                  // stored as integer (pts * 10)
    painfulLossOpponentScore: int("painfulLossOpponentScore"),    // pts * 10
    // Revenge status: did Rod beat this rival in the most recent season they played?
    revengeAchieved: boolean("revengeAchieved").notNull().default(false),
    lastMatchupSeason: int("lastMatchupSeason"),
    // LLM-generated lore sentence (cached, regenerated only when score changes materially)
    loreSentence: text("loreSentence"),
    loreGeneratedAt: timestamp("loreGeneratedAt"),
    computedAt: timestamp("computedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_rivalry_pair").on(t.memberId, t.rivalId),
    index("idx_rivalry_member").on(t.memberId),
    index("idx_rivalry_score").on(t.rivalryScore),
  ]
);
export type RivalryScore = typeof rivalryScores.$inferSelect;
export type InsertRivalryScore = typeof rivalryScores.$inferInsert;

// ─── Trade Narratives ──────────────────────────────────────────────────────────
/**
 * One row per completed trade. Stores the deterministic narrative label and
 * the LLM-generated narrative sentence. Populated during data refresh.
 */
export const tradeNarratives = mysqlTable(
  "trade_narratives",
  {
    id: int("id").autoincrement().primaryKey(),
    tradeId: varchar("tradeId", { length: 128 }).notNull(),
    season: int("season").notNull(),
    proposedDate: int("proposedDate").notNull(),
    sideAOwner: varchar("sideAOwner", { length: 128 }).notNull(),
    sideBOwner: varchar("sideBOwner", { length: 128 }).notNull(),
    verdict: varchar("verdict", { length: 8 }).notNull(),         // 'sideA' | 'sideB' | 'even'
    verdictMargin: int("verdictMargin").notNull().default(0),      // stored as integer (value * 10)
    narrativeLabel: varchar("narrativeLabel", { length: 64 }).notNull(),
    narrativeSentence: text("narrativeSentence"),                  // LLM-generated, cached
    sideADesperation: int("sideADesperation"),
    sideBDesperation: int("sideBDesperation"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_trade_narrative").on(t.tradeId),
    index("idx_tn_season").on(t.season),
    index("idx_tn_label").on(t.narrativeLabel),
  ]
);
export type TradeNarrative = typeof tradeNarratives.$inferSelect;
export type InsertTradeNarrative = typeof tradeNarratives.$inferInsert;

// ─── Weekly Storylines ─────────────────────────────────────────────────────────
/**
 * One row per story per week per season.
 * Deterministic trigger assigns storyType + emotionalTag; LLM generates headline + body.
 * Cached forever — only regenerated if the trigger fires again with different data.
 */
export const weeklyStorylines = mysqlTable(
  "weekly_storylines",
  {
    id: int("id").autoincrement().primaryKey(),
    season: int("season").notNull(),
    week: int("week").notNull(),
    storyType: varchar("storyType", { length: 64 }).notNull(),
    emotionalTag: varchar("emotionalTag", { length: 64 }).notNull(),
    teamId: int("teamId").notNull(),
    ownerName: varchar("ownerName", { length: 128 }).notNull(),
    record: varchar("record", { length: 16 }).notNull(),
    intensityScore: int("intensityScore").notNull().default(0),
    headline: varchar("headline", { length: 256 }),
    bodyText: text("bodyText"),
    supportingStat: varchar("supportingStat", { length: 256 }),
    opponentName: varchar("opponentName", { length: 128 }),
    generatedAt: timestamp("generatedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("idx_ws_season_week").on(t.season, t.week),
    index("idx_ws_story_type").on(t.storyType),
    index("idx_ws_intensity").on(t.intensityScore),
  ]
);
export type WeeklyStoryline = typeof weeklyStorylines.$inferSelect;
export type InsertWeeklyStoryline = typeof weeklyStorylines.$inferInsert;

// ─── Fear Index ────────────────────────────────────────────────────────────────
/**
 * One row per team per season+week. Stores the deterministic fear score and
 * heat label. Recomputed on every data refresh — no LLM required.
 *
 * fearScore = (avgPF_last4 * 0.3) + (winStreak * 8) + (rosterHealthScore * 0.2)
 *           + (tradeAggressionScore * 0.15) + (exploitabilityInverse * 0.15)
 *
 * Heat labels: UNTOUCHABLE | RISING THREAT | DANGEROUS | NEUTRAL | DECLINING | COLLAPSING
 */
export const fearIndex = mysqlTable(
  "fear_index",
  {
    id: int("id").autoincrement().primaryKey(),
    season: int("season").notNull(),
    week: int("week").notNull(),
    teamId: int("teamId").notNull(),
    memberId: varchar("memberId", { length: 64 }).notNull(),
    ownerName: varchar("ownerName", { length: 128 }).notNull(),
    fearScore: int("fearScore").notNull().default(0),
    heatLabel: varchar("heatLabel", { length: 32 }).notNull().default("NEUTRAL"),
    avgPfLast4: int("avgPfLast4").notNull().default(0),
    winStreak: int("winStreak").notNull().default(0),
    rosterHealthScore: int("rosterHealthScore").notNull().default(0),
    tradeAggressionScore: int("tradeAggressionScore").notNull().default(0),
    exploitabilityInverse: int("exploitabilityInverse").notNull().default(0),
    computedAt: timestamp("computedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_fear_team_week").on(t.season, t.week, t.teamId),
    index("idx_fi_season_week").on(t.season, t.week),
    index("idx_fi_score").on(t.fearScore),
  ]
);
export type FearIndex = typeof fearIndex.$inferSelect;
export type InsertFearIndex = typeof fearIndex.$inferInsert;

// ─── Reputation Events ─────────────────────────────────────────────────────────
/**
 * One row per reputation event per manager per season.
 * Reputation events are behaviours that modify the GM archetype label over time.
 *
 * Event types: PANIC_SELLER | SILENT_ASSASSIN | TRADE_SHARK | WAIVER_GRINDER |
 *              PLAYOFF_CHOKER | DYNASTY_BUILDER | REVENGE_SEEKER | CHAOS_AGENT
 */
export const reputationEvents = mysqlTable(
  "reputation_events",
  {
    id: int("id").autoincrement().primaryKey(),
    memberId: varchar("memberId", { length: 64 }).notNull(),
    ownerName: varchar("ownerName", { length: 128 }).notNull(),
    season: int("season").notNull(),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    eventLabel: varchar("eventLabel", { length: 128 }).notNull(),
    eventSentence: text("eventSentence"),
    supportingStat: varchar("supportingStat", { length: 256 }),
    severity: varchar("severity", { length: 16 }).notNull().default("NOTABLE"),
    detectedAt: timestamp("detectedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_rep_event").on(t.memberId, t.season, t.eventType),
    index("idx_re_member").on(t.memberId),
    index("idx_re_season").on(t.season),
    index("idx_re_type").on(t.eventType),
  ]
);
export type ReputationEvent = typeof reputationEvents.$inferSelect;
export type InsertReputationEvent = typeof reputationEvents.$inferInsert;

// ─── Usage Events ──────────────────────────────────────────────────────────────
/**
 * One row per tracked event (LLM call, ESPN fetch, tRPC procedure hit).
 * Used by the backend usage & cost monitor dashboard.
 *
 * eventCategory:  "llm" | "espn" | "trpc" | "ui"
 * eventType:      "page_view" | "feature_open" | "ai_action" | "cta_click" | "session_start" | "return_visit" (null for server-side events)
 * featureName:    human-readable feature (e.g. "advisor.chat", "weekly_intel", "trade_lab")
 * callType:       LLM callType or ESPN view name or tRPC procedure path
 * page:           URL path for UI events (null for server-side events)
 * action:         specific action label for UI events (null for server-side events)
 * sessionId:      client session UUID (null for server-side events)
 * promptTokens / completionTokens / totalTokens: LLM token counts (0 for non-LLM)
 * estimatedCostUsd: rough cost estimate based on model pricing
 * durationMs:     wall-clock time for the call
 * userId:         Manus user ID (null = unauthenticated / background job)
 * model:          LLM model name (null for non-LLM events)
 * streaming:      true if the LLM call was a streaming call
 * metadata:       JSON blob for extra context (e.g. season, week, tradeId)
 */
export const usageEvents = mysqlTable(
  "usage_events",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    eventCategory: varchar("eventCategory", { length: 16 }).notNull(),
    featureName: varchar("featureName", { length: 128 }).notNull(),
    callType: varchar("callType", { length: 64 }),
    promptTokens: int("promptTokens").notNull().default(0),
    completionTokens: int("completionTokens").notNull().default(0),
    totalTokens: int("totalTokens").notNull().default(0),
    estimatedCostUsd: float("estimatedCostUsd").notNull().default(0),
    durationMs: int("durationMs").notNull().default(0),
    userId: varchar("userId", { length: 64 }),
    model: varchar("model", { length: 64 }),
    streaming: boolean("streaming").notNull().default(false),
    // UI event fields (null for server-side LLM/ESPN/tRPC events)
    eventType: varchar("eventType", { length: 32 }),
    page: varchar("page", { length: 256 }),
    action: varchar("action", { length: 128 }),
    sessionId: varchar("sessionId", { length: 64 }),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_ue_feature").on(t.featureName),
    index("idx_ue_category").on(t.eventCategory),
    index("idx_ue_created").on(t.createdAt),
    index("idx_ue_user").on(t.userId),
    index("idx_ue_event_type").on(t.eventType),
    index("idx_ue_session").on(t.sessionId),
  ]
);
export type UsageEvent = typeof usageEvents.$inferSelect;
export type InsertUsageEvent = typeof usageEvents.$inferInsert;

// ─── Scraped Trades (from Chrome extension) ──────────────────────────────────
// Stores completed trades scraped from the ESPN transactions page via the
// Chrome extension. Each row is one trade (two sides). The extension POSTs
// raw ESPN API transaction data; the backend normalises and upserts here.
export const scrapedTrades = mysqlTable(
  "scraped_trades",
  {
    id: int("id").autoincrement().primaryKey(),
    // Stable dedup key: ESPN transaction ID or synthetic hash
    tradeKey:       varchar("tradeKey", { length: 128 }).notNull(),
    season:         int("season").notNull(),
    // Unix ms timestamp of trade execution
    executedAt:     bigint("executedAt", { mode: "number" }).notNull(),
    // JSON blobs for each side: { teamId, ownerName, players: [...], picks: [...] }
    sideAJson:      text("sideAJson").notNull(),
    sideBJson:      text("sideBJson").notNull(),
    // Raw ESPN transaction payload (for debugging / re-processing)
    rawJson:        text("rawJson"),
    scrapedAt:      timestamp("scrapedAt").defaultNow().notNull(),
  },
  (t) => [
    index("idx_st_tradeKey").on(t.tradeKey),
    index("idx_st_season").on(t.season),
    index("idx_st_executedAt").on(t.executedAt),
  ]
);
export type ScrapedTrade = typeof scrapedTrades.$inferSelect;
export type InsertScrapedTrade = typeof scrapedTrades.$inferInsert;

// ─── League Events (ESPN Activity Capture — Chrome extension passive layer) ───
// Append-only table. Each row is one ESPN transaction event (add, drop, trade,
// waiver claim) captured passively as the user browses ESPN. Deduped on
// espnTxId (ESPN's own transaction ID). No AI processing — raw capture only.
export const leagueEvents = mysqlTable(
  "league_events",
  {
    id:           int("id").autoincrement().primaryKey(),
    // ESPN's own transaction ID — primary dedup key
    espnTxId:     varchar("espnTxId", { length: 64 }).notNull(),
    leagueId:     varchar("leagueId", { length: 32 }).notNull(),
    season:       int("season").notNull(),
    // Event type: TRADE | ADD | DROP | WAIVER | TRADE_PROPOSAL
    eventType:    varchar("eventType", { length: 32 }).notNull(),
    // Unix ms timestamp from ESPN
    processedAt:  bigint("processedAt", { mode: "number" }).notNull(),
    // Team involved (primary actor)
    teamId:       int("teamId").notNull().default(0),
    ownerName:    varchar("ownerName", { length: 128 }).notNull().default(""),
    // Compact JSON summary: { players: [{id, name, pos, action}], picks: [{label}] }
    payloadJson:  text("payloadJson").notNull(),
    // Raw ESPN transaction object (for debugging / re-processing)
    rawJson:      text("rawJson"),
    capturedAt:   timestamp("capturedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_le_espnTxId").on(t.espnTxId),
    index("idx_le_league_season").on(t.leagueId, t.season),
    index("idx_le_eventType").on(t.eventType),
    index("idx_le_processedAt").on(t.processedAt),
    index("idx_le_teamId").on(t.teamId),
  ]
);
export type LeagueEvent = typeof leagueEvents.$inferSelect;
export type InsertLeagueEvent = typeof leagueEvents.$inferInsert;
