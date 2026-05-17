import { eq, desc, and, gt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users, espnSeasonCache, refreshManifest, chatHistory,
  pickTrades, InsertPickTrade, espnViewHealth, InsertEspnViewHealth,
  weeklyPlayerStats, InsertWeeklyPlayerStats,
  scheduledJobs, ScheduledJob,
  userMemory, UserMemory,
  leagueConnections,
  llmUsage,
  scrapedTrades, InsertScrapedTrade,
  leagueEvents, InsertLeagueEvent,
} from "../drizzle/schema";
import type { EspnCreds } from "./espnService";
import { decryptCredentialsFromDb } from "./_core/crypto";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); }
    catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized; updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot get user"); return undefined; }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getCachedView(season: number, viewName: string, leagueId?: string) {
  const db = await getDb();
  if (!db) return null;
  const lid = leagueId ?? process.env.ESPN_LEAGUE_ID ?? "default";
  // ORDER BY fetchedAt DESC ensures we always get the most recent row.
  // Without this, duplicate rows (from missing unique constraint) could
  // return stale data from an earlier refresh instead of the latest one.
  const result = await db.select().from(espnSeasonCache)
    .where(and(
      eq(espnSeasonCache.leagueId, lid),
      eq(espnSeasonCache.season, season),
      eq(espnSeasonCache.viewName, viewName)
    ))
    .orderBy(desc(espnSeasonCache.fetchedAt))
    .limit(1);
  // Fallback: if no row found with leagueId, try the legacy "default" row (backward compat)
  if (!result[0] && lid !== "default") {
    const legacy = await db.select().from(espnSeasonCache)
      .where(and(
        eq(espnSeasonCache.leagueId, "default"),
        eq(espnSeasonCache.season, season),
        eq(espnSeasonCache.viewName, viewName)
      ))
      .orderBy(desc(espnSeasonCache.fetchedAt))
      .limit(1);
    return legacy[0] ?? null;
  }
  return result[0] ?? null;
}

export async function upsertCachedView(season: number, viewName: string, payload: unknown, leagueId?: string) {
  const db = await getDb();
  if (!db) return;
  const lid = leagueId ?? process.env.ESPN_LEAGUE_ID ?? "default";
  await db.insert(espnSeasonCache)
    .values({ leagueId: lid, season, viewName, payload: payload as Record<string, unknown> })
    .onDuplicateKeyUpdate({ set: { payload: payload as Record<string, unknown>, updatedAt: new Date() } });
}

export async function getAllCachedSeasons(leagueId?: string): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const lid = leagueId ?? process.env.ESPN_LEAGUE_ID ?? "default";
  // Include both the exact leagueId and "default" (legacy rows) for backward compat
  const result = await db.selectDistinct({ season: espnSeasonCache.season })
    .from(espnSeasonCache)
    .where(and(
      gt(espnSeasonCache.season, 2000),
      or(eq(espnSeasonCache.leagueId, lid), eq(espnSeasonCache.leagueId, "default"))
    ))
    .orderBy(desc(espnSeasonCache.season));
  return result.map((r) => r.season);
}

/**
 * Returns the most recently completed NFL season that should be used as the
 * historical baseline for offseason planning. This is always <= current year - 1
 * so that a partial 2026 sync never overwrites the 2025 keeper baseline.
 */
export async function getCompletedSeasonForOffseason(): Promise<number | null> {
  const currentYear = new Date().getFullYear();
  const maxCompletedSeason = currentYear - 1; // e.g. in 2026, max is 2025
  const seasons = await getAllCachedSeasons();
  // Find the highest cached season that is <= maxCompletedSeason
  const completed = seasons.filter(s => s <= maxCompletedSeason);
  return completed.length > 0 ? completed[0] : null; // already sorted desc
}

export async function getRefreshManifests() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(refreshManifest).orderBy(desc(refreshManifest.season));
}

export async function upsertRefreshManifest(season: number, data: {
  teamCount?: number; rosterCount?: number; matchupCount?: number;
  draftPickCount?: number; transactionCount?: number;
  status: "success" | "partial" | "failed"; errorMessage?: string; viewsRefreshed?: string[];
}) {
  const db = await getDb();
  if (!db) return;
  const updateSet = {
    lastRefreshedAt: new Date(), teamCount: data.teamCount ?? null,
    rosterCount: data.rosterCount ?? null, matchupCount: data.matchupCount ?? null,
    draftPickCount: data.draftPickCount ?? null, transactionCount: data.transactionCount ?? null,
    status: data.status, errorMessage: data.errorMessage ?? null, viewsRefreshed: data.viewsRefreshed ?? null,
  };
  await db.insert(refreshManifest).values({ season, ...updateSet })
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getChatHistory(userId: number, season?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = season
    ? and(eq(chatHistory.userId, userId), eq(chatHistory.season, season))
    : eq(chatHistory.userId, userId);
  return db.select().from(chatHistory).where(conditions).orderBy(chatHistory.createdAt).limit(100);
}

export async function addChatMessage(userId: number, role: "user" | "assistant", content: string, season?: number) {
  const db = await getDb();
  if (!db) return;
  await db.insert(chatHistory).values({ userId, role, content, season: season ?? null });
}

export async function clearChatHistory(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(chatHistory).where(eq(chatHistory.userId, userId));
}

// ── Pick Trade helpers ────────────────────────────────────────────────────────
export async function getPickTrades(draftYear: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pickTrades)
    .where(eq(pickTrades.draftYear, draftYear))
    .orderBy(pickTrades.round, pickTrades.pickInRound);
}

export async function addPickTrade(trade: InsertPickTrade) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(pickTrades).values(trade);
  return result;
}

export async function removePickTrade(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(pickTrades).where(eq(pickTrades.id, id));
}

// ── ESPN View Health helpers ──────────────────────────────────────────────────

export async function upsertViewHealth(
  season: number,
  viewName: string,
  data: { status: "ok" | "error" | "stale" | "empty"; errorMessage?: string; recordCount?: number }
) {
  const db = await getDb();
  if (!db) return;
  const updateSet = {
    status: data.status,
    errorMessage: data.errorMessage ?? null,
    recordCount: data.recordCount ?? null,
    fetchedAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(espnViewHealth)
    .values({ season, viewName, ...updateSet })
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getViewHealthForSeason(season: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(espnViewHealth)
    .where(eq(espnViewHealth.season, season))
    .orderBy(espnViewHealth.viewName);
}

export async function getAllViewHealth() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(espnViewHealth)
    .orderBy(desc(espnViewHealth.season), espnViewHealth.viewName);
}

// ── Weekly Player Stats helpers ───────────────────────────────────────────────

/** Upsert a batch of weekly stat rows (insert or replace on season+week+playerId) */
export async function upsertWeeklyStats(rows: InsertWeeklyPlayerStats[]): Promise<void> {
  const db = await getDb();
  if (!db || rows.length === 0) return;
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    for (const row of batch) {
      await db.insert(weeklyPlayerStats)
        .values(row)
        .onDuplicateKeyUpdate({
          set: {
            targets: row.targets,
            receptions: row.receptions,
            receivingYards: row.receivingYards,
            receivingTDs: row.receivingTDs,
            rushingAttempts: row.rushingAttempts,
            rushingYards: row.rushingYards,
            rushingTDs: row.rushingTDs,
            passingAttempts: row.passingAttempts,
            completions: row.completions,
            passingYards: row.passingYards,
            passingTDs: row.passingTDs,
            interceptions: row.interceptions,
            snapCount: row.snapCount,
            snapPct: row.snapPct,
            fantasyPoints: row.fantasyPoints,
            ownerName: row.ownerName,
            teamId: row.teamId,
            updatedAt: new Date(),
          },
        });
    }
  }
}

/** Get all cached weekly stats for a season */
export async function getWeeklyStatsBySeason(season: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(weeklyPlayerStats)
    .where(eq(weeklyPlayerStats.season, season))
    .orderBy(weeklyPlayerStats.week, weeklyPlayerStats.playerName);
}

/** Get all weekly stats for a specific player in a season */
export async function getWeeklyStatsByPlayer(season: number, playerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(weeklyPlayerStats)
    .where(and(eq(weeklyPlayerStats.season, season), eq(weeklyPlayerStats.playerId, playerId)))
    .orderBy(weeklyPlayerStats.week);
}

/** Get stats for a specific week */
export async function getWeeklyStatsByWeek(season: number, week: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(weeklyPlayerStats)
    .where(and(eq(weeklyPlayerStats.season, season), eq(weeklyPlayerStats.week, week)))
    .orderBy(desc(weeklyPlayerStats.fantasyPoints));
}

/** Get which weeks have already been cached for a season */
export async function getCachedWeeksForSeason(season: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ week: weeklyPlayerStats.week })
    .from(weeklyPlayerStats)
    .where(eq(weeklyPlayerStats.season, season))
    .orderBy(weeklyPlayerStats.week);
  return rows.map(r => r.week);
}

/** Delete all cached weekly stats for a season */
export async function deleteWeeklyStatsForSeason(season: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(weeklyPlayerStats).where(eq(weeklyPlayerStats.season, season));
}

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────
export async function getScheduledJobs(): Promise<ScheduledJob[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduledJobs).orderBy(scheduledJobs.name);
}
export async function getScheduledJobByName(name: string): Promise<ScheduledJob | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(scheduledJobs).where(eq(scheduledJobs.name, name)).limit(1);
  return rows[0] ?? null;
}
export async function getScheduledJobByTaskUid(taskUid: string): Promise<ScheduledJob | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(scheduledJobs).where(eq(scheduledJobs.taskUid, taskUid)).limit(1);
  return rows[0] ?? null;
}
export async function upsertScheduledJob(data: {
  name: string; description?: string; cronExpression?: string;
  callbackPath?: string; taskUid?: string; isEnabled?: boolean; nextRunAt?: Date;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const isEnabledInt = data.isEnabled === false ? 0 : 1;
  const existing = await getScheduledJobByName(data.name);
  if (existing) {
    await db.update(scheduledJobs).set({
      description: data.description ?? existing.description,
      cronExpression: data.cronExpression ?? existing.cronExpression,
      callbackPath: data.callbackPath ?? existing.callbackPath,
      taskUid: data.taskUid ?? existing.taskUid,
      isEnabled: isEnabledInt,
      nextRunAt: data.nextRunAt ?? existing.nextRunAt,
      updatedAt: new Date(),
    }).where(eq(scheduledJobs.name, data.name));
  } else {
    await db.insert(scheduledJobs).values({
      name: data.name, description: data.description ?? null,
      cronExpression: data.cronExpression ?? null, callbackPath: data.callbackPath ?? null,
      taskUid: data.taskUid ?? null, isEnabled: isEnabledInt, nextRunAt: data.nextRunAt ?? null,
    });
  }
}
export async function updateScheduledJobRun(taskUid: string, status: "success" | "partial" | "failed", details?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(scheduledJobs)
    .set({ lastRunAt: new Date(), lastRunStatus: status, lastRunDetails: details ?? null, updatedAt: new Date() })
    .where(eq(scheduledJobs.taskUid, taskUid));
}

// ── GM Memory helpers ─────────────────────────────────────────────────────────
export async function getUserMemory(userId: number): Promise<UserMemory | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(userMemory).where(eq(userMemory.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUserMemory(userId: number, data: {
  riskTolerance?: string;
  tradePhilosophy?: string;
  keeperPhilosophy?: string;
  draftStyle?: string;
  favoritePlayerTypes?: string;
  rivalManagers?: string;
  notes?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const updateSet = {
    riskTolerance: data.riskTolerance ?? null,
    tradePhilosophy: data.tradePhilosophy ?? null,
    keeperPhilosophy: data.keeperPhilosophy ?? null,
    draftStyle: data.draftStyle ?? null,
    favoritePlayerTypes: data.favoritePlayerTypes ?? null,
    rivalManagers: data.rivalManagers ?? null,
    notes: data.notes ?? null,
    updatedAt: new Date(),
  };
  await db.insert(userMemory)
    .values({ userId, ...updateSet })
    .onDuplicateKeyUpdate({ set: updateSet });
}

// ── Per-user ESPN credentials ─────────────────────────────────────────────────
/**
 * Look up the active ESPN league connection for a user and return EspnCreds.
 * Falls back gracefully (returns undefined) if no connection found.
 * Callers should fall back to env vars when undefined is returned.
 */
export async function getActiveEspnCredentials(userId: number): Promise<EspnCreds | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(leagueConnections)
    .where(and(
      eq(leagueConnections.userId, userId),
      eq(leagueConnections.provider, "espn"),
      eq(leagueConnections.isActive, true)
    ))
    .orderBy(desc(leagueConnections.updatedAt))
    .limit(1);
  if (!rows.length) return undefined;
  const row = rows[0];
  // Decrypt credentials (supports both encrypted enc:v1 and legacy plain-object formats)
  const creds = decryptCredentialsFromDb(row.credentials) as Record<string, string> | null;
  if (!creds?.swid || !creds?.espnS2) return undefined;
  return {
    leagueId: (creds.leagueId as string) ?? row.leagueId,
    swid: creds.swid,
    espnS2: creds.espnS2,
  };
}

// ─── Active League Context ─────────────────────────────────────────────────

/**
 * Get the user's active league connection record.
 * Falls back to the most recently updated active connection if activeLeagueId is 0/null.
 */
export async function getActiveLeagueForUser(userId: number) {
  const db = await getDb();
  if (!db) return null;

  // Get user's activeLeagueId
  const userRows = await db
    .select({ activeLeagueId: users.activeLeagueId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const activeId = userRows[0]?.activeLeagueId;

  if (activeId && activeId > 0) {
    const rows = await db
      .select()
      .from(leagueConnections)
      .where(and(eq(leagueConnections.id, activeId), eq(leagueConnections.userId, userId)))
      .limit(1);
    if (rows.length) return rows[0];
  }

  // Fallback: most recently updated active connection
  const rows = await db
    .select()
    .from(leagueConnections)
    .where(and(eq(leagueConnections.userId, userId), eq(leagueConnections.isActive, true)))
    .orderBy(desc(leagueConnections.updatedAt))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Set the user's active league connection.
 */
export async function setActiveLeagueForUser(userId: number, leagueConnectionId: number) {
  const db = await getDb();
  if (!db) return false;
  await db
    .update(users)
    .set({ activeLeagueId: leagueConnectionId, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return true;
}

// ─── LLM Usage Metering ────────────────────────────────────────────────────

/**
 * Persist one LLM call's usage metrics to the llm_usage table.
 * Fire-and-forget safe — errors are swallowed to never affect the caller.
 */
export async function persistLlmUsage(opts: {
  userId?: number | null;
  callType: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  streaming: boolean;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(llmUsage).values({
      userId: opts.userId ?? null,
      callType: opts.callType,
      model: opts.model,
      promptTokens: opts.promptTokens,
      completionTokens: opts.completionTokens,
      totalTokens: opts.totalTokens,
      durationMs: opts.durationMs,
      streaming: opts.streaming,
      createdAt: new Date(),
    });
  } catch {
    // Never throw — usage logging must not break the main request
  }
}

/**
 * Get LLM usage summary for a user (last 30 days).
 */
export async function getLlmUsageSummary(userId: number) {
  const db = await getDb();
  if (!db) return { totalTokens: 0, totalCalls: 0, byCallType: {} as Record<string, number> };

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(llmUsage)
    .where(and(eq(llmUsage.userId, userId), gt(llmUsage.createdAt, thirtyDaysAgo)))
    .orderBy(desc(llmUsage.createdAt))
    .limit(500);

  const totalTokens = rows.reduce((s, r) => s + (r.totalTokens ?? 0), 0);
  const totalCalls = rows.length;
  const byCallType: Record<string, number> = {};
  for (const r of rows) {
    byCallType[r.callType] = (byCallType[r.callType] ?? 0) + (r.totalTokens ?? 0);
  }
  return { totalTokens, totalCalls, byCallType };
}

// ─── Scraped Trades helpers ────────────────────────────────────────────────────

/**
 * Upsert a batch of scraped trades from the Chrome extension.
 * Deduplicates on tradeKey — safe to call multiple times with the same data.
 */
export async function upsertScrapedTrades(rows: InsertScrapedTrade[]): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  let inserted = 0;
  for (const row of rows) {
    try {
      await db.insert(scrapedTrades)
        .values(row)
        .onDuplicateKeyUpdate({
          set: {
            sideAJson: row.sideAJson,
            sideBJson: row.sideBJson,
            rawJson: row.rawJson ?? null,
            scrapedAt: new Date(),
          },
        });
      inserted++;
    } catch (err) {
      console.warn("[DB] upsertScrapedTrades row error:", err);
    }
  }
  return inserted;
}

/**
 * Get all scraped trades for a season (or all seasons if season=0).
 */
export async function getScrapedTrades(season?: number) {
  const db = await getDb();
  if (!db) return [];
  const query = db.select().from(scrapedTrades);
  if (season && season > 0) {
    return query.where(eq(scrapedTrades.season, season)).orderBy(desc(scrapedTrades.executedAt));
  }
  return query.orderBy(desc(scrapedTrades.executedAt));
}

// ── League Events helpers (ESPN Activity Capture) ────────────────────────────

/**
 * Upsert a batch of league event rows. Dedupes on espnTxId.
 * Returns the number of rows actually inserted (skips duplicates).
 */
export async function upsertLeagueEvents(rows: InsertLeagueEvent[]): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  let inserted = 0;
  for (const row of rows) {
    try {
      await db.insert(leagueEvents)
        .values(row)
        .onDuplicateKeyUpdate({
          set: {
            // On duplicate espnTxId: update payload in case we get richer data later
            payloadJson: row.payloadJson,
            rawJson: row.rawJson ?? null,
            capturedAt: new Date(),
          },
        });
      inserted++;
    } catch (err) {
      console.warn("[DB] upsertLeagueEvents row error:", err);
    }
  }
  return inserted;
}

/**
 * Get league events for a league+season, newest first.
 * Optionally filter by eventType.
 */
export async function getLeagueEvents(
  leagueId: string,
  season?: number,
  eventType?: string,
  limit = 200
) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  conditions.push(eq(leagueEvents.leagueId, leagueId));
  if (season && season > 0) conditions.push(eq(leagueEvents.season, season));
  if (eventType) conditions.push(eq(leagueEvents.eventType, eventType));
  return db.select().from(leagueEvents)
    .where(and(...conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]))
    .orderBy(desc(leagueEvents.processedAt))
    .limit(limit);
}

/**
 * Get a count summary of league events by type for a league+season.
 */
export async function getLeagueEventsSummary(leagueId: string, season?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(leagueEvents.leagueId, leagueId)];
  if (season && season > 0) conditions.push(eq(leagueEvents.season, season));
  return db.select().from(leagueEvents)
    .where(and(...conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]))
    .orderBy(desc(leagueEvents.processedAt))
    .limit(500);
}
