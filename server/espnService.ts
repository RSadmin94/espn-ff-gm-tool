/**
 * ESPN Fantasy Football API Service
 * Authenticates with SWID + espn_s2 cookies and fetches league data.
 *
 * HARDENED VERSION:
 * - Per-view error isolation: one failed view does not kill the whole fetch
 * - Cookie expiry detection with clear error messages
 * - Data quality gates: validates rosters, draft data, matchup counts
 * - Staleness detection: flags cached data older than 7 days
 * - View health tracking: persists per-view status to espn_view_health table
 */

const LEAGUE_ID = process.env.ESPN_LEAGUE_ID || "457622";
const SWID = process.env.ESPN_SWID || "";
const ESPN_S2 = process.env.ESPN_S2 || "";

/** Per-user ESPN credentials. When provided, overrides the module-level env vars. */
export interface EspnCreds {
  leagueId: string;
  swid: string;
  espnS2: string;
}

export const ALL_VIEWS = [
  "mSettings",
  "mTeam",
  "mRoster",
  "mMatchup",
  "mMatchupScore",
  "mScoreboard",
  "mSchedule",
  "mStandings",
  "mStatus",
  "mDraftDetail",
  "mTransactions2",
] as const;

export type EspnView = (typeof ALL_VIEWS)[number];

// ─── Maps ─────────────────────────────────────────────────────────────────────

export const POSITION_MAP: Record<number, string> = {
  1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K",
  7: "OP", 9: "DT", 10: "DE", 11: "LB", 12: "CB",
  13: "S", 14: "HC", 15: "D/ST", 16: "K", 17: "P",
  23: "FLEX", 24: "FLEX", 25: "FLEX",
};

export const SLOT_MAP: Record<number, string> = {
  0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "D/ST",
  17: "K", 20: "Bench", 21: "IR", 23: "FLEX",
  24: "FLEX", 25: "FLEX",
};

export const PRO_TEAM_MAP: Record<number, string> = {
  0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN",
  5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB",
  10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG",
  20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR",
  30: "JAX", 33: "BAL", 34: "HOU",
};

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve ESPN credentials for a request:
 * 1. If explicit creds are passed, use them.
 * 2. Otherwise query league_connections for the active user's stored credentials.
 * 3. Fall back to process.env.ESPN_SWID / ESPN_S2.
 */
export async function resolveEspnCreds(
  explicitCreds?: EspnCreds,
  userId?: number,
  leagueId?: string
): Promise<EspnCreds> {
  // Explicit creds always win
  if (explicitCreds?.swid && explicitCreds?.espnS2) return explicitCreds;

  // Try DB credentials first. User-scoped creds win when a user context exists;
  // cron/public refreshes fall back to the active ESPN connection.
  try {
    const { getActiveEspnCredentials, getAnyActiveEspnCredentials } = await import("./db");
    if (userId) {
      const dbCreds = await getActiveEspnCredentials(userId);
      if (dbCreds?.swid && dbCreds?.espnS2) return dbCreds;
    }
    const activeCreds = await getAnyActiveEspnCredentials(leagueId);
    if (activeCreds?.swid && activeCreds?.espnS2) return activeCreds;
  } catch { /* non-fatal — fall through to env */ }

  // Fall back to env vars
  return {
    leagueId: LEAGUE_ID,
    swid: SWID,
    espnS2: ESPN_S2,
  };
}

/**
 * Mark a user's league credentials as expired in the DB after a 401.
 */
async function markCredsExpired(userId: number): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const { leagueConnections } = await import("../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;
    await db.update(leagueConnections)
      .set({ syncStatus: "error", syncError: "ESPN credentials expired (401)", updatedAt: new Date() })
      .where(and(
        eq(leagueConnections.userId, userId),
        eq(leagueConnections.provider, "espn"),
        eq(leagueConnections.isActive, true)
      ));
  } catch { /* non-fatal */ }
}

function buildCookieStringFor(creds?: EspnCreds): string {
  const swid = creds?.swid ?? SWID;
  const s2   = creds?.espnS2 ?? ESPN_S2;
  const parts: string[] = [];
  if (swid) parts.push(`SWID=${swid}`);
  if (s2)   parts.push(`espn_s2=${s2}`);
  return parts.join("; ");
}
function buildCookieString(): string { return buildCookieStringFor(); }
export function hasCookies(creds?: EspnCreds): boolean {
  const swid = creds?.swid ?? SWID;
  const s2   = creds?.espnS2 ?? ESPN_S2;
  return Boolean(swid && s2);
}
function getBaseUrlFor(season: number, creds?: EspnCreds): string {
  const lid = creds?.leagueId ?? LEAGUE_ID;
  return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${lid}`;
}
function getBaseUrl(season: number): string { return getBaseUrlFor(season); }

// ─── Pipeline result types ────────────────────────────────────────────────────

export type ViewFetchStatus = "ok" | "error" | "auth_error" | "empty";

export interface ViewFetchResult {
  viewName: string;
  status: ViewFetchStatus;
  data: Record<string, unknown> | null;
  error?: string;
  recordCount?: number;
}

export interface PipelineFetchResult {
  season: number;
  merged: Record<string, unknown>;
  viewResults: ViewFetchResult[];
  authError: boolean;
  hasPartialData: boolean;
  allViewsOk: boolean;
  cookiesPresent: boolean;
}

// ─── Core fetch: all views in one request (fast path) ────────────────────────

async function fetchAllViewsAtOnce(
  season: number,
  views: string[],
  creds?: EspnCreds
): Promise<{ data: Record<string, unknown>; status: number } | { status: number; error: string }> {
  const url = new URL(getBaseUrlFor(season, creds));
  for (const v of views) url.searchParams.append("view", v);

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    Accept: "application/json,text/plain,*/*",
    Referer: "https://fantasy.espn.com/football/league",
  };
  const cookieStr = buildCookieStringFor(creds);
  if (cookieStr) headers["Cookie"] = cookieStr;

  try {
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status} ${res.statusText}` };
    const data = await res.json() as Record<string, unknown>;
    return { data, status: res.status };
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message : "Network error" };
  }
}

// ─── Per-view fetch (fallback for isolation) ──────────────────────────────────

async function fetchSingleView(
  season: number,
  viewName: string,
  creds?: EspnCreds
): Promise<ViewFetchResult> {
  const url = new URL(getBaseUrlFor(season, creds));
  url.searchParams.append("view", viewName);

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    Accept: "application/json,text/plain,*/*",
    Referer: "https://fantasy.espn.com/football/league",
  };
  const cookieStr = buildCookieStringFor(creds);
  if (cookieStr) headers["Cookie"] = cookieStr;

  try {
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(15000) });

    if (res.status === 401 || res.status === 403) {
      return {
        viewName,
        status: "auth_error",
        data: null,
        error: `ESPN returned ${res.status} — cookies may be expired. Update ESPN_SWID and ESPN_S2.`,
      };
    }

    if (!res.ok) {
      return {
        viewName,
        status: "error",
        data: null,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const data = await res.json() as Record<string, unknown>;
    const recordCount = estimateRecordCount(viewName, data);

    if (recordCount === 0) {
      return { viewName, status: "empty", data, recordCount, error: `View returned empty data` };
    }

    return { viewName, status: "ok", data, recordCount };
  } catch (err) {
    return {
      viewName,
      status: "error",
      data: null,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

// ─── Record count estimator for quality gates ─────────────────────────────────

function estimateRecordCount(viewName: string, data: Record<string, unknown>): number {
  switch (viewName) {
    case "mTeam": return ((data.teams as unknown[]) || []).length;
    case "mRoster": {
      const teams = (data.teams as Record<string, unknown>[]) || [];
      return teams.reduce((sum, t) => {
        const entries = ((t.roster as Record<string, unknown>)?.entries as unknown[]) || [];
        return sum + entries.length;
      }, 0);
    }
    case "mMatchup":
    case "mMatchupScore":
    case "mSchedule": return ((data.schedule as unknown[]) || []).length;
    case "mDraftDetail": {
      const draft = (data.draftDetail as Record<string, unknown>) || {};
      return ((draft.picks as unknown[]) || []).length;
    }
    case "mTransactions2": return ((data.transactions as unknown[]) || []).length;
    case "mSettings": return data.settings ? 1 : 0;
    case "mStandings": return ((data.teams as unknown[]) || []).length;
    case "mStatus": return data.status ? 1 : 0;
    default: return 1;
  }
}

// ─── Data quality validator ───────────────────────────────────────────────────

export interface DataQualityReport {
  season: number;
  issues: string[];
  warnings: string[];
  isUsable: boolean;
}

export function validateDataQuality(
  season: number,
  data: Record<string, unknown>
): DataQualityReport {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Teams check
  const teams = (data.teams as Record<string, unknown>[]) || [];
  if (teams.length === 0) issues.push("No teams found — roster data missing");
  else if (teams.length < 10) warnings.push(`Only ${teams.length} teams found (expected 14)`);

  // Roster check
  const rosterEntries = teams.reduce((sum, t) => {
    const entries = ((t.roster as Record<string, unknown>)?.entries as unknown[]) || [];
    return sum + entries.length;
  }, 0);
  if (rosterEntries === 0) issues.push("No roster entries found — player data missing");
  else if (rosterEntries < 100) warnings.push(`Only ${rosterEntries} roster entries (expected 200+)`);

  // Matchup check
  const schedule = (data.schedule as unknown[]) || [];
  if (schedule.length === 0) warnings.push("No schedule/matchup data found");
  else if (schedule.length < 50 && season >= 2018) warnings.push(`Only ${schedule.length} matchups (expected 100+)`);

  // Draft check (only for completed seasons)
  if (season <= 2025) {
    const draft = (data.draftDetail as Record<string, unknown>) || {};
    const picks = (draft.picks as unknown[]) || [];
    if (picks.length === 0) warnings.push("No draft picks found — draft history may be missing");
    else if (picks.length < 100) warnings.push(`Only ${picks.length} draft picks (expected 180+)`);
  }

  // Transaction check
  const txs = (data.transactions as unknown[]) || [];
  if (txs.length === 0 && season >= 2018) warnings.push("No transactions found — waiver/trade history missing");

  return {
    season,
    issues,
    warnings,
    isUsable: issues.length === 0,
  };
}

// ─── Staleness check ──────────────────────────────────────────────────────────

export function isStale(fetchedAt: Date, maxAgeHours = 168): boolean {
  const ageMs = Date.now() - fetchedAt.getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

export function staleSummary(fetchedAt: Date): string {
  const ageMs = Date.now() - fetchedAt.getTime();
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Main hardened fetch ──────────────────────────────────────────────────────

/**
 * Fetches all ESPN views for a season with per-view error isolation.
 * First attempts a single bulk request. If that fails due to auth, throws immediately.
 * If partial views fail, falls back to per-view fetching for those views.
 * Returns a PipelineFetchResult with merged data and per-view health status.
 */
export async function fetchEspnViewsHardened(
  season: number,
  views: string[] = [...ALL_VIEWS],
  creds?: EspnCreds,
  userId?: number
): Promise<PipelineFetchResult> {
  const _espnStartMs = Date.now();
  const cookiesPresent = hasCookies(creds);
  const viewResults: ViewFetchResult[] = [];

  // Fast path: try all views in one request
  const bulkResult = await fetchAllViewsAtOnce(season, views, creds);

  if ("data" in bulkResult) {
    // Bulk succeeded — validate each view's data quality
    for (const viewName of views) {
      const count = estimateRecordCount(viewName, bulkResult.data);
      viewResults.push({
        viewName,
        status: count === 0 ? "empty" : "ok",
        data: bulkResult.data,
        recordCount: count,
        error: count === 0 ? "View returned empty data" : undefined,
      });
    }
    const result: PipelineFetchResult = {
      season,
      merged: bulkResult.data,
      viewResults,
      authError: false,
      hasPartialData: viewResults.some(v => v.status !== "ok"),
      allViewsOk: viewResults.every(v => v.status === "ok"),
      cookiesPresent,
    };
    // Fire-and-forget usage tracking
    try {
      const { trackEspnEvent } = await import("./usageTracker");
      trackEspnEvent({ featureName: "espn.fetchViews", viewNames: [...views], season, durationMs: Date.now() - _espnStartMs });
    } catch { /* never block */ }
    return result;
  }

  // Bulk failed — check if auth error
  if (bulkResult.status === 401 || bulkResult.status === 403) {
    if (userId) markCredsExpired(userId); // fire-and-forget
    throw new Error(
      `ESPN API returned ${bulkResult.status}. Cookies may be expired. Please update ESPN_SWID and ESPN_S2 in your secrets.`
    );
  }

  // Bulk failed for other reason — fall back to per-view isolation
  const merged: Record<string, unknown> = {};
  let authError = false;

  await Promise.allSettled(
    views.map(async (viewName) => {
      const result = await fetchSingleView(season, viewName, creds);
      viewResults.push(result);
      if (result.status === "auth_error") authError = true;
      if (result.data) {
        // Merge view data into the combined object
        Object.assign(merged, result.data);
      }
    })
  );

  if (authError) {
    if (userId) markCredsExpired(userId); // fire-and-forget
    throw new Error(
      `ESPN API authentication failed. Cookies may be expired. Please update ESPN_SWID and ESPN_S2 in your secrets.`
    );
  }

  const fallbackResult: PipelineFetchResult = {
    season,
    merged,
    viewResults,
    authError: false,
    hasPartialData: viewResults.some(v => v.status !== "ok"),
    allViewsOk: viewResults.every(v => v.status === "ok"),
    cookiesPresent,
  };
  // Fire-and-forget usage tracking
  try {
    const { trackEspnEvent } = await import("./usageTracker");
    trackEspnEvent({ featureName: "espn.fetchViews", viewNames: [...views], season, durationMs: Date.now() - _espnStartMs });
  } catch { /* never block */ }
  return fallbackResult;
}

/**
 * Legacy fetch function — maintained for backward compatibility.
 * Internally uses the hardened fetch but returns the merged data directly.
 */
export async function fetchEspnViews(
  season: number,
  views: string[] = [...ALL_VIEWS],
  creds?: EspnCreds
): Promise<Record<string, unknown>> {
  const result = await fetchEspnViewsHardened(season, views, creds);
  return result.merged;
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

export function normalizeSettings(data: Record<string, unknown>) {
  const settings = (data.settings as Record<string, unknown>) || {};
  const status = (data.status as Record<string, unknown>) || {};
  const schedSettings = (settings.scheduleSettings as Record<string, unknown>) || {};
  const scoringSettings = (settings.scoringSettings as Record<string, unknown>) || {};
  const rosterSettings = (settings.rosterSettings as Record<string, unknown>) || {};
  const tradeSettings = (settings.tradeSettings as Record<string, unknown>) || {};
  const draftSettings = (settings.draftSettings as Record<string, unknown>) || {};

  return {
    leagueId: data.id,
    seasonId: data.seasonId,
    leagueName: settings.name,
    size: settings.size,
    scoringType: scoringSettings.scoringType,
    playoffTeamCount: schedSettings.playoffTeamCount,
    matchupPeriodCount: schedSettings.matchupPeriodCount,
    currentMatchupPeriod: status.currentMatchupPeriod,
    latestScoringPeriod: status.latestScoringPeriod,
    isActive: status.isActive,
    tradeDeadline: tradeSettings.deadlineDate,
    draftType: draftSettings.type,
    keeperCount: settings.keeperCount,
    rosterPositions: rosterSettings.lineupSlotCounts,
    scoringItems: scoringSettings.scoringItems,
  };
}

export function normalizeTeams(data: Record<string, unknown>) {
  const season = data.seasonId as number;
  const members: Record<string, Record<string, unknown>> = {};
  for (const m of (data.members as Record<string, unknown>[]) || []) {
    members[m.id as string] = m;
  }

  return ((data.teams as Record<string, unknown>[]) || []).map((team) => {
    const owners = (team.owners as string[]) || [];
    const ownerNames = owners.map((oid) => {
      const m = members[oid] || {};
      return `${m.firstName || ""} ${m.lastName || ""}`.trim() || oid;
    });
    const record = ((team.record as Record<string, unknown>)?.overall as Record<string, unknown>) || {};

    return {
      season,
      teamId: team.id,
      abbrev: team.abbrev,
      teamName: `${team.location || ""} ${team.nickname || ""}`.trim() || (team.name as string) || "",
      location: team.location,
      nickname: team.nickname,
      owners: ownerNames.join("; "),
      memberIds: owners,
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      pointsFor: record.pointsFor,
      pointsAgainst: record.pointsAgainst,
      percentage: record.percentage,
      rankFinal: team.rankCalculatedFinal,
      playoffSeed: team.playoffSeed,
      draftDayProjectedRank: team.draftDayProjectedRank,
      currentProjectedRank: team.currentProjectedRank,
      logoUrl: team.logo,
      primaryColor: team.primaryColor,
    };
  });
}

export function normalizeRosters(data: Record<string, unknown>) {
  const season = data.seasonId as number;
  const rosters: unknown[] = [];

  for (const team of (data.teams as Record<string, unknown>[]) || []) {
    const teamId = team.id;
    const teamName = `${team.location || ""} ${team.nickname || ""}`.trim() || (team.name as string) || "";
    const entries = ((team.roster as Record<string, unknown>)?.entries as Record<string, unknown>[]) || [];

    for (const entry of entries) {
      const poolEntry = (entry.playerPoolEntry as Record<string, unknown>) || {};
      const player = (poolEntry.player as Record<string, unknown>) || {};
      const stats = (player.stats as Record<string, unknown>[]) || [];
      const ownership = (player.ownership as Record<string, unknown>) || {};

      let appliedTotal: number | null = null;
      let projectedTotal: number | null = null;
      let appliedAverage: number | null = null;
      let appliedStats: Record<string, number> = {};

      for (const stat of stats) {
        // statSourceId 0 = actual, 1 = projected; statSplitTypeId 0 = season total
        if (stat.statSourceId === 0 && stat.statSplitTypeId === 0) {
          appliedTotal = stat.appliedTotal as number;
          appliedAverage = stat.appliedAverage as number;
          appliedStats = (stat.appliedStats as Record<string, number>) || {};
        }
        if (stat.statSourceId === 1 && stat.statSplitTypeId === 0) {
          projectedTotal = stat.appliedTotal as number;
        }
      }

      rosters.push({
        season,
        teamId,
        teamName,
        playerId: player.id || poolEntry.id,
        playerName: player.fullName,
        positionId: player.defaultPositionId,
        position: POSITION_MAP[player.defaultPositionId as number] || "?",
        proTeamId: player.proTeamId,
        proTeam: PRO_TEAM_MAP[player.proTeamId as number] || "?",
        lineupSlotId: entry.lineupSlotId,
        lineupSlot: SLOT_MAP[entry.lineupSlotId as number] || "Bench",
        acquisitionType: poolEntry.acquisitionType,
        acquisitionDate: poolEntry.acquisitionDate,
        injuryStatus: player.injuryStatus,
        percentOwned: ownership.percentOwned,
        percentStarted: ownership.percentStarted,
        appliedTotal,
        appliedAverage,
        projectedTotal,
        appliedStats,
        keeperValue: poolEntry.keeperValue,
        keeperValueFuture: poolEntry.keeperValueFuture,
      });
    }
  }
  return rosters;
}

export function buildPlayerIdMap(data: Record<string, unknown>): Map<number, { name: string; position: string; positionId: number; proTeam: string }> {
  const map = new Map<number, { name: string; position: string; positionId: number; proTeam: string }>();
  // Build from roster entries (most reliable source)
  for (const team of (data.teams as Record<string, unknown>[]) || []) {
    for (const entry of ((team.roster as Record<string, unknown>)?.entries as Record<string, unknown>[]) || []) {
      const poolEntry = (entry.playerPoolEntry as Record<string, unknown>) || {};
      const player = (poolEntry.player as Record<string, unknown>) || {};
      const pid = player.id as number;
      if (pid && !map.has(pid)) {
        map.set(pid, {
          name: (player.fullName as string) || "",
          position: POSITION_MAP[player.defaultPositionId as number] || "?",
          positionId: player.defaultPositionId as number,
          proTeam: PRO_TEAM_MAP[player.proTeamId as number] || "?",
        });
      }
    }
  }
  // Also try players array if present
  for (const fa of (data.players as Record<string, unknown>[]) || []) {
    const poolEntry = (fa.playerPoolEntry as Record<string, unknown>) || fa;
    const player = (poolEntry.player as Record<string, unknown>) || {};
    const pid = (player.id || fa.id) as number;
    if (pid && !map.has(pid)) {
      map.set(pid, {
        name: (player.fullName as string) || "",
        position: POSITION_MAP[player.defaultPositionId as number] || "?",
        positionId: player.defaultPositionId as number,
        proTeam: PRO_TEAM_MAP[player.proTeamId as number] || "?",
      });
    }
  }
  return map;
}

/**
 * Resolve player names for IDs not found in the roster map
 * by calling the ESPN public athlete API.
 */
export async function resolveUnknownPlayerIds(
  unknownIds: number[]
): Promise<Map<number, { name: string; position: string }>> {
  const result = new Map<number, { name: string; position: string }>();
  const POS_MAP: Record<string, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", "D/ST": "D/ST" };
  await Promise.allSettled(
    unknownIds.map(async (pid) => {
      try {
        const url = `https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${pid}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const d = (await res.json()) as Record<string, unknown>;
        const athlete = (d.athlete as Record<string, unknown>) || {};
        const name = (athlete.displayName as string) || (athlete.fullName as string) || "";
        const posAbbr = ((athlete.position as Record<string, unknown>)?.abbreviation as string) || "?";
        if (name) result.set(pid, { name, position: POS_MAP[posAbbr] || posAbbr });
      } catch { /* ignore */ }
    })
  );
  return result;
}

export function normalizeDraftPicks(data: Record<string, unknown>) {
  const season = data.seasonId as number;
  const draft = (data.draftDetail as Record<string, unknown>) || {};
  const picks = (draft.picks as Record<string, unknown>[]) || [];
  const playerMap = buildPlayerIdMap(data);

  // Build teamId -> teamName map
  const teamNameMap: Record<number, string> = {};
  for (const t of (data.teams as Record<string, unknown>[]) || []) {
    const tid = t.id as number;
    teamNameMap[tid] = `${t.location || ""} ${t.nickname || ""}`.trim() || (t.name as string) || `Team ${tid}`;
  }

  return picks.map((pick) => {
    const playerId = pick.playerId as number;
    const pinfo = playerMap.get(playerId) || { name: "", position: "?", positionId: 0, proTeam: "?" };
    return {
      season,
      roundId: pick.roundId,
      roundPickNumber: pick.roundPickNumber,
      overallPickNumber: pick.overallPickNumber,
      teamId: pick.teamId,
      teamName: teamNameMap[pick.teamId as number] || `Team ${pick.teamId}`,
      playerId,
      playerName: pinfo.name,
      positionId: pinfo.positionId,
      position: pinfo.position,
      proTeam: pinfo.proTeam,
      keeper: pick.keeper,
      reservedForKeeper: pick.reservedForKeeper,
      autoDrafted: (pick.autoDraftTypeId as number) > 0,
    };
  });
}

export function normalizeDraftOrder(data: Record<string, unknown>) {
  const settings = (data.settings as Record<string, unknown>) || {};
  const draftSettings = (settings.draftSettings as Record<string, unknown>) || {};
  const pickOrder = (draftSettings.pickOrder as number[]) || [];
  const draftDate = draftSettings.date as number;
  const keeperDeadline = draftSettings.keeperDeadlineDate as number;

  const teamNameMap: Record<number, { name: string; abbrev: string; owners: string }> = {};
  const members: Record<string, Record<string, unknown>> = {};
  for (const m of (data.members as Record<string, unknown>[]) || []) {
    members[m.id as string] = m;
  }
  for (const t of (data.teams as Record<string, unknown>[]) || []) {
    const tid = t.id as number;
    const owners = (t.owners as string[]) || [];
    const ownerNames = owners.map((oid) => {
      const m = members[oid] || {};
      return `${m.firstName || ""} ${m.lastName || ""}`.trim() || oid;
    });
    teamNameMap[tid] = {
      name: `${t.location || ""} ${t.nickname || ""}`.trim() || (t.name as string) || `Team ${tid}`,
      abbrev: (t.abbrev as string) || "",
      owners: ownerNames.join("; "),
    };
  }

  return {
    pickOrder: pickOrder.map((teamId, idx) => ({
      position: idx + 1,
      teamId,
      ...teamNameMap[teamId],
    })),
    draftDate,
    keeperDeadline,
    draftType: draftSettings.orderType,
    keeperCount: draftSettings.keeperCount,
  };
}

export function normalizeMatchups(data: Record<string, unknown>) {
  const season = data.seasonId as number;
  const schedule = (data.schedule as Record<string, unknown>[]) || [];

  return schedule.map((item) => {
    const home = (item.home as Record<string, unknown>) || {};
    const away = (item.away as Record<string, unknown>) || {};
    return {
      season,
      matchupPeriodId: item.matchupPeriodId,
      scoringPeriodId: item.scoringPeriodId,
      winner: item.winner,
      playoffTierType: item.playoffTierType,
      homeTeamId: home.teamId,
      homeTotalPoints: home.totalPoints,
      homeProjectedPoints: home.totalProjectedPoints,
      awayTeamId: away.teamId,
      awayTotalPoints: away.totalPoints,
      awayProjectedPoints: away.totalProjectedPoints,
    };
  });
}

// ─── Trade Proposal Enrichment ──────────────────────────────────────────────

/**
 * Fetches ALL trade-related transaction records for a season using ESPN's x-fantasy-filter.
 * This is a supplemental call — the standard mTransactions2 view only returns the
 * most recent ~50 transactions, so accepted proposals may have aged out of the window.
 *
 * ESPN 2026+ behavior change: once a trade is accepted, the TRADE_PROPOSAL record
 * disappears from the standard feed. Only a TRADE_UPHOLD/TRADE_ACCEPT header row
 * remains, linking back to the original proposal via relatedTransactionId. We therefore
 * fetch ALL trade-related types in one call so nothing is missed.
 *
 * ESPN filter syntax:
 *   x-fantasy-filter: {"transactions":{"filterType":{"value":["TRADE_PROPOSAL","TRADE_UPHOLD","TRADE_ACCEPT"]}}}
 *
 * Returns the raw transactions array from the ESPN response, or [] on failure.
 */
export async function fetchTradeProposals(
  season: number,
  creds?: EspnCreds
): Promise<Record<string, unknown>[]> {
  const url = new URL(getBaseUrlFor(season, creds));
  url.searchParams.append("view", "mTransactions2");

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    Accept: "application/json,text/plain,*/*",
    Referer: "https://fantasy.espn.com/football/league",
    // Fetch all trade-related types: proposals (pending/canceled) + uphold/accept (executed)
    // In 2026+, executed trades only appear as TRADE_UPHOLD rows, not TRADE_PROPOSAL rows
    "x-fantasy-filter": JSON.stringify({
      transactions: { filterType: { value: ["TRADE_PROPOSAL", "TRADE_UPHOLD", "TRADE_ACCEPT"] } },
    }),
  };
  const cookieStr = buildCookieStringFor(creds);
  if (cookieStr) headers["Cookie"] = cookieStr;

  try {
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    return (data.transactions as Record<string, unknown>[]) || [];
  } catch {
    return [];
  }
}

/**
 * Merges supplemental TRADE_PROPOSAL records into the combined data object's
 * transactions array, de-duplicating by transaction id.
 *
 * Strategy:
 *   1. Build a Set of existing transaction ids from data.transactions.
 *   2. Append any proposal record whose id is NOT already present.
 *   3. Leave the original array untouched if proposals is empty.
 *
 * This is a pure in-memory merge — it does not mutate the DB cache row.
 * The caller (scheduledRefresh / espn.refresh) should call this before
 * upsertCachedView so the enriched payload is persisted.
 */
export function mergeTradeProposalsIntoTransactions(
  data: Record<string, unknown>,
  proposals: Record<string, unknown>[]
): Record<string, unknown> {
  if (!proposals.length) return data;

  const existing = (data.transactions as Record<string, unknown>[]) || [];
  const existingIds = new Set(existing.map((tx) => tx.id as string));

  const newProposals = proposals.filter((p) => !existingIds.has(p.id as string));
  if (!newProposals.length) return data; // nothing to add — already de-duped

  return {
    ...data,
    transactions: [...existing, ...newProposals],
  };
}

export function normalizeTransactions(data: Record<string, unknown>) {
  const season = data.seasonId as number;
  const txs = (data.transactions as Record<string, unknown>[]) || [];
  const rows: unknown[] = [];
  const headerTransactionTypes = new Set(["TRADE_UPHOLD", "TRADE_ACCEPT"]);

  for (const tx of txs) {
    const items = (tx.items as Record<string, unknown>[]) || [];
    if (items.length === 0) {
      if (!headerTransactionTypes.has(String(tx.type || "").toUpperCase())) continue;
      rows.push({
        season,
        transactionId: tx.id,
        type: tx.type,
        status: tx.status,
        proposedDate: tx.proposedDate,
        teamId: tx.teamId,
        playerId: null,
        playerName: null,
        fromTeamId: null,
        toTeamId: null,
        // 2026+: TRADE_UPHOLD/TRADE_ACCEPT records have no items but link to a TRADE_PROPOSAL
        relatedTransactionId: tx.relatedTransactionId ?? null,
      });
      continue;
    }
    for (const item of items) {
      const player = (item.player as Record<string, unknown>) || {};
      rows.push({
        season,
        transactionId: tx.id,
        type: tx.type,
        status: tx.status,
        proposedDate: tx.proposedDate,
        teamId: tx.teamId,
        playerId: player.id || item.playerId,
        playerName: player.fullName,
        fromTeamId: item.fromTeamId,
        toTeamId: item.toTeamId,
        itemType: item.type,
        overallPickNumber: item.overallPickNumber ?? null,
        round: item.round ?? item.roundId ?? null,
        pickInRound: item.pickInRound ?? item.roundPickNumber ?? null,
        // 2026+: pass relatedTransactionId on item rows too (for TRADE_PROPOSAL items)
        relatedTransactionId: tx.relatedTransactionId ?? null,
      });
    }
  }
  return rows;
}

// ─── Recent Activity trade reconstruction (2026+) ────────────────────────────
//
// ESPN 2026 changed the transaction model: once a trade is accepted, the
// TRADE_PROPOSAL record disappears from mTransactions2. Accepted trades are
// only visible in the league communication endpoint as ACTIVITY_TRANSACTIONS
// topics where messageTypeId === 246 (executed trade).
//
// This function fetches those topics, cross-references the targetId (pick slot
// ID) against the mDraftDetail picks array, and synthesises TRADE_PROPOSAL
// records with status="EXECUTED" that the Trade Aging router can process.

export async function fetchRecentActivityTrades(
  season: number,
  combinedData: Record<string, unknown>,
  creds?: EspnCreds
): Promise<Record<string, unknown>[]> {
  const lid = creds?.leagueId ?? LEAGUE_ID;
  const commUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${lid}/communication/?view=kona_league_messageboard&limit=200`;

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    Accept: "application/json,text/plain,*/*",
    Referer: "https://fantasy.espn.com/football/league",
  };
  const cookieStr = buildCookieStringFor(creds);
  if (cookieStr) headers["Cookie"] = cookieStr;

  try {
    const res = await fetch(commUrl, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const commData = await res.json() as Record<string, unknown>;
    const topics = (commData.topicsByType as Record<string, unknown[]>) || {};
    const actTx = (topics.ACTIVITY_TRANSACTIONS as Record<string, unknown>[]) || [];

    // Build pick slot ID → pick info map from mDraftDetail
    const draftDetail = (combinedData.draftDetail as Record<string, unknown>) || {};
    const draftPicks = (draftDetail.picks as Record<string, unknown>[]) || [];
    const pickMap = new Map<number, { round: number; pickInRound: number; teamId: number }>();
    for (const p of draftPicks) {
      pickMap.set(p.id as number, {
        round: p.roundId as number,
        pickInRound: p.roundPickNumber as number,
        teamId: p.teamId as number,
      });
    }

    // messageTypeId 246 = trade executed
    // Each topic with a 246 message represents one completed trade.
    // Messages in the topic: each message has from=teamId, to=teamId, targetId=pickSlotId
    const syntheticTrades: Record<string, unknown>[] = [];

    for (const topic of actTx) {
      const msgs = (topic.messages as Record<string, unknown>[]) || [];
      const executedMsgs = msgs.filter(m => m.messageTypeId === 246);
      if (executedMsgs.length === 0) continue;

      const topicDate = topic.date as number;
      // Derive a stable synthetic transaction ID from the topic id
      const syntheticId = `activity_trade_${topic.id as string}`;

      // Group messages by from team to reconstruct items
      const items: Record<string, unknown>[] = [];
      for (const m of executedMsgs) {
        const fromTeamId = m.from as number;
        const toTeamId = m.to as number;
        const targetId = m.targetId as number;

        // Look up pick info
        const pickInfo = pickMap.get(targetId);
        items.push({
          type: "DRAFT_TRADE",
          fromTeamId,
          toTeamId,
          // Use targetId as a synthetic playerId so the normalizer can process it
          playerId: null,
          playerName: null,
          overallPickNumber: targetId,
          round: pickInfo?.round ?? null,
          pickInRound: pickInfo?.pickInRound ?? null,
          // Store original pick owner for display
          originalTeamId: pickInfo?.teamId ?? null,
        });
      }

      if (items.length === 0) continue;

      // Determine the primary teamId (the team that initiated — use the 'from' of the first item)
      const primaryTeamId = (executedMsgs[0]?.from as number) ?? null;

      syntheticTrades.push({
        id: syntheticId,
        type: "TRADE_PROPOSAL",
        status: "EXECUTED",
        proposedDate: topicDate,
        executionDate: topicDate,
        teamId: primaryTeamId,
        items,
        // Mark as reconstructed from activity feed so we can distinguish if needed
        _source: "activity_feed",
      });
    }

    return syntheticTrades;
  } catch {
    return [];
  }
}

// ─── League History Champions ─────────────────────────────────────────────────
/**
 * Fetches the ESPN leagueHistory API for all given seasons and returns a map
 * of season → { championMemberId, runnerUpMemberId, championTeamName }.
 *
 * The leagueHistory endpoint is the ONLY reliable source for rankCalculatedFinal
 * in pre-2018 seasons where the per-season combined cache has empty teams arrays.
 *
 * URL: https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/{leagueId}?seasonId={season}&view=mTeam
 */
export interface SeasonChampion {
  season: number;
  championMemberId: string;
  runnerUpMemberId: string | null;
  championTeamName: string;
}

export async function fetchLeagueHistoryChampions(
  seasons: number[],
  creds?: EspnCreds
): Promise<Map<number, SeasonChampion>> {
  const lid    = creds?.leagueId ?? LEAGUE_ID;
  const cookie = buildCookieStringFor(creds);
  const result = new Map<number, SeasonChampion>();

  for (const season of seasons) {
    try {
      const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/${lid}?seasonId=${season}&view=mTeam`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          Cookie: cookie,
          "X-Fantasy-Source": "kona",
          "X-Fantasy-Platform": "kona-PROD-m.fantasy.espn.com",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const data = await res.json() as unknown;
      const league = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
      const teams  = (league?.teams as Record<string, unknown>[]) ?? [];

      const champion = teams.find((t) => (t.rankCalculatedFinal as number) === 1);
      const runnerUp = teams.find((t) => (t.rankCalculatedFinal as number) === 2);
      if (!champion) continue;

      const champOwner = (champion.primaryOwner as string) || ((champion.owners as string[])?.[0] ?? "");
      const ruOwner    = runnerUp
        ? ((runnerUp.primaryOwner as string) || ((runnerUp.owners as string[])?.[0] ?? ""))
        : null;

      result.set(season, {
        season,
        championMemberId: champOwner,
        runnerUpMemberId: ruOwner || null,
        championTeamName: (champion.name as string) ?? "",
      });
    } catch {
      // Network error for this season — skip silently
    }
  }

  return result;
}
