/**
 * Fantasy Data Service
 * Fetches FantasyPros ECR, ADP, and Pro Football Reference 2025 stats.
 * Merges into a unified player list and caches in DB with a 6-hour TTL.
 */

import { getDb } from "./db";
import { fantasyDataCache, adpTrendSnapshots } from "../drizzle/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let fantasyDataTablesReady = false;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FPPlayer {
  player_id: number;
  player_name: string;
  player_team_id: string;
  player_position_id: string;
  player_short_name: string;
  player_bye_week: number | null;
  player_owned_avg: number;
  rank_ecr: number;
  rank_min: string;
  rank_max: string;
  rank_ave: string;
  rank_std: string;
  pos_rank: string;
  tier: number;
}

export interface ADPPlayer {
  rank: number;
  fp_id: string;
  name: string;
  pos_rank: string;
  adp: number;
}

export interface PFRPlayer {
  player: string;
  team: string;
  fantasy_pos: string;
  age: string;
  g: string;
  rush_att: string;
  rush_yds: string;
  rush_td: string;
  targets: string;
  rec: string;
  rec_yds: string;
  rec_td: string;
  pass_att: string;
  pass_yds: string;
  pass_td: string;
  pass_int: string;
  all_td: string;
  fantasy_points: string;
  fantasy_points_ppr: string;
  vbd: string;
  fantasy_rank_pos: string;
  fantasy_rank_overall: string;
}

export interface MergedPlayer {
  // Identity
  fpId: number;
  name: string;
  shortName: string;
  team: string;
  position: string;
  byeWeek: number | null;
  // ECR
  ecrRank: number;
  ecrMin: number;
  ecrMax: number;
  ecrAvg: number;
  ecrStd: number;
  posRank: string;
  tier: number;
  // ADP
  adp: number | null;
  adpRank: number | null;
  // ECR vs ADP gap (positive = value pick, negative = reach)
  ecrAdpGap: number | null;
  // PFR 2025 stats
  pfr2025?: {
    games: number;
    rushAtt: number;
    rushYds: number;
    rushTDs: number;
    targets: number;
    receptions: number;
    recYds: number;
    recTDs: number;
    passAtt: number;
    passYds: number;
    passTDs: number;
    passInts: number;
    totalTDs: number;
    pprPoints: number;
    vbd: number;
    posRank: number;
    overallRank: number;
  };
  // Ownership
  ownedPct: number;
}

// ─── Scrapers ─────────────────────────────────────────────────────────────────

async function fetchECR(): Promise<FPPlayer[]> {
  const res = await fetch(
    "https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.fantasypros.com/",
      },
    }
  );
  if (!res.ok) throw new Error(`ECR fetch failed: ${res.status}`);
  const html = await res.text();
  const match = html.match(/var ecrData = (\{[\s\S]*?\});/);
  if (!match) throw new Error("ecrData not found in FantasyPros page");
  const data = JSON.parse(match[1]);
  return (data.players ?? []) as FPPlayer[];
}

async function fetchADP(): Promise<ADPPlayer[]> {
  const res = await fetch(
    "https://www.fantasypros.com/nfl/adp/half-point-ppr-overall.php",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.fantasypros.com/",
      },
    }
  );
  if (!res.ok) throw new Error(`ADP fetch failed: ${res.status}`);
  const html = await res.text();

  // Parse the HTML table rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const players: ADPPlayer[] = [];
  let m: RegExpExecArray | null;

  while ((m = rowRegex.exec(html)) !== null) {
    const row = m[1];
    const rankMatch = row.match(/<td>(\d+)<\/td>/);
    const nameMatch = row.match(/fp-id-(\d+)[^"]*"[^"]*"[^"]*fp-player-name="([^"]+)"/);
    const posMatch = row.match(/<td>([A-Z]+\d+)<\/td>/);
    const adpMatches: RegExpExecArray[] = [];
    const adpRe = /<td>([\d.]+)<\/td>/g;
    let am: RegExpExecArray | null;
    while ((am = adpRe.exec(row)) !== null) adpMatches.push(am);

    if (rankMatch && nameMatch && adpMatches.length > 0) {
      const adpVal = parseFloat(adpMatches[adpMatches.length - 1][1]);
      players.push({
        rank: parseInt(rankMatch[1]),
        fp_id: nameMatch[1],
        name: nameMatch[2],
        pos_rank: posMatch ? posMatch[1] : "",
        adp: adpVal,
      });
    }
  }
  return players;
}

async function fetchPFR2025(): Promise<PFRPlayer[]> {
  const res = await fetch(
    "https://www.pro-football-reference.com/years/2025/fantasy.htm",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.pro-football-reference.com/",
      },
    }
  );
  if (!res.ok) throw new Error(`PFR fetch failed: ${res.status}`);
  const html = await res.text();

  // Check for Cloudflare block
  if (html.includes("challenge") && html.length < 10000) {
    throw new Error("PFR blocked by Cloudflare — use cached data");
  }

  // Find the fantasy table
  const tableMatch = html.match(/id="fantasy"([\s\S]*?)<\/table>/);
  if (!tableMatch) throw new Error("PFR fantasy table not found");

  const tableHtml = tableMatch[1];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const players: PFRPlayer[] = [];
  let m: RegExpExecArray | null;

  while ((m = rowRegex.exec(tableHtml)) !== null) {
    const row = m[1];
    if (!row.includes('data-stat="player"')) continue;

    const statRegex = /data-stat="([^"]+)"[^>]*>([^<]*)/g;
    const stats: Record<string, string> = {};
    let sm: RegExpExecArray | null;
    while ((sm = statRegex.exec(row)) !== null) {
      stats[sm[1]] = sm[2].trim().replace(/[*+]/g, "");
    }
    if (stats["player"]) {
      players.push(stats as unknown as PFRPlayer);
    }
  }
  return players;
}

// ─── Merge ────────────────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[*+'.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mergePlayers(
  ecr: FPPlayer[],
  adp: ADPPlayer[],
  pfr: PFRPlayer[]
): MergedPlayer[] {
  // Build ADP lookup by normalized name
  const adpByName = new Map<string, ADPPlayer>();
  for (const p of adp) {
    adpByName.set(normalizeName(p.name), p);
  }

  // Build PFR lookup by normalized name
  const pfrByName = new Map<string, PFRPlayer>();
  for (const p of pfr) {
    pfrByName.set(normalizeName(p.player), p);
  }

  return ecr.map((p) => {
    const normName = normalizeName(p.player_name);
    const adpEntry = adpByName.get(normName);
    const pfrEntry = pfrByName.get(normName);

    const adpVal = adpEntry?.adp ?? null;
    const ecrAdpGap = adpVal !== null ? Math.round(adpVal - p.rank_ecr) : null;

    const merged: MergedPlayer = {
      fpId: p.player_id,
      name: p.player_name,
      shortName: p.player_short_name,
      team: p.player_team_id,
      position: p.player_position_id,
      byeWeek: p.player_bye_week,
      ecrRank: p.rank_ecr,
      ecrMin: parseInt(p.rank_min) || p.rank_ecr,
      ecrMax: parseInt(p.rank_max) || p.rank_ecr,
      ecrAvg: parseFloat(p.rank_ave) || p.rank_ecr,
      ecrStd: parseFloat(p.rank_std) || 0,
      posRank: p.pos_rank,
      tier: p.tier,
      adp: adpVal,
      adpRank: adpEntry?.rank ?? null,
      ecrAdpGap,
      ownedPct: p.player_owned_avg ?? 0,
    };

    if (pfrEntry) {
      merged.pfr2025 = {
        games: parseInt(pfrEntry.g) || 0,
        rushAtt: parseInt(pfrEntry.rush_att) || 0,
        rushYds: parseInt(pfrEntry.rush_yds) || 0,
        rushTDs: parseInt(pfrEntry.rush_td) || 0,
        targets: parseInt(pfrEntry.targets) || 0,
        receptions: parseInt(pfrEntry.rec) || 0,
        recYds: parseInt(pfrEntry.rec_yds) || 0,
        recTDs: parseInt(pfrEntry.rec_td) || 0,
        passAtt: parseInt(pfrEntry.pass_att) || 0,
        passYds: parseInt(pfrEntry.pass_yds) || 0,
        passTDs: parseInt(pfrEntry.pass_td) || 0,
        passInts: parseInt(pfrEntry.pass_int) || 0,
        totalTDs: parseInt(pfrEntry.all_td) || 0,
        pprPoints: parseFloat(pfrEntry.fantasy_points_ppr) || 0,
        vbd: parseInt(pfrEntry.vbd) || 0,
        posRank: parseInt(pfrEntry.fantasy_rank_pos) || 0,
        overallRank: parseInt(pfrEntry.fantasy_rank_overall) || 0,
      };
    }

    return merged;
  });
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

async function ensureFantasyDataTables(): Promise<void> {
  if (fantasyDataTablesReady) return;
  const db = await getDb();
  if (!db) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fantasy_data_cache (
      id int AUTO_INCREMENT NOT NULL,
      cacheKey varchar(64) NOT NULL,
      payload json NOT NULL,
      fetchedAt timestamp NOT NULL DEFAULT (now()),
      updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fantasy_data_cache_id PRIMARY KEY(id),
      CONSTRAINT uq_fantasy_cache_key UNIQUE(cacheKey)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS adp_trend_snapshots (
      id int AUTO_INCREMENT NOT NULL,
      fpId int NOT NULL,
      playerName varchar(128) NOT NULL,
      position varchar(8) NOT NULL,
      adp int,
      ecrRank int NOT NULL,
      snapshotAt timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT adp_trend_snapshots_id PRIMARY KEY(id)
    )
  `);

  try { await db.execute(sql`CREATE INDEX idx_adp_trend_player ON adp_trend_snapshots (fpId)`); } catch { /* index already exists */ }
  try { await db.execute(sql`CREATE INDEX idx_adp_trend_snapshot ON adp_trend_snapshots (snapshotAt)`); } catch { /* index already exists */ }
  fantasyDataTablesReady = true;
}

async function getCached(key: string): Promise<{ data: MergedPlayer[]; fetchedAt: Date } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    await ensureFantasyDataTables();
    const rows = await db
      .select()
      .from(fantasyDataCache)
      .where(eq(fantasyDataCache.cacheKey, key))
      .limit(1);
    if (!rows.length) return null;
    const row = rows[0];
    // Check TTL
    if (Date.now() - row.fetchedAt.getTime() > CACHE_TTL_MS) return null;
    return { data: row.payload as unknown as MergedPlayer[], fetchedAt: row.fetchedAt };
  } catch (err) {
    console.warn("[DraftBoard] Cache read failed; fetching live data instead:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function setCached(key: string, data: MergedPlayer[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await ensureFantasyDataTables();
    await db
      .insert(fantasyDataCache)
      .values({ cacheKey: key, payload: data as unknown as Record<string, unknown>[] })
      .onDuplicateKeyUpdate({
        set: {
          payload: data as unknown as Record<string, unknown>[],
          fetchedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.warn("[DraftBoard] Cache write failed; returning live data without caching:", err instanceof Error ? err.message : err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const CACHE_KEY = "draft-board-2026";

export interface DraftBoardResult {
  players: MergedPlayer[];
  fetchedAt: Date;
  sources: {
    ecr: number;
    adp: number;
    pfr: number;
    merged: number;
  };
  fromCache: boolean;
}

/**
 * Get the merged draft board. Fetches fresh data if cache is stale or missing.
 * Falls back to stale cache if all sources fail.
 */
export async function getDraftBoard(forceRefresh = false): Promise<DraftBoardResult> {
  if (!forceRefresh) {
    const cached = await getCached(CACHE_KEY);
    if (cached) {
      return {
        players: cached.data,
        fetchedAt: cached.fetchedAt,
        sources: { ecr: 0, adp: 0, pfr: 0, merged: cached.data.length },
        fromCache: true,
      };
    }
  }

  // Fetch all three sources in parallel; PFR may fail (Cloudflare) — that's OK
  const [ecrResult, adpResult, pfrResult] = await Promise.allSettled([
    fetchECR(),
    fetchADP(),
    fetchPFR2025(),
  ]);

  const ecr = ecrResult.status === "fulfilled" ? ecrResult.value : [];
  const adp = adpResult.status === "fulfilled" ? adpResult.value : [];
  const pfr = pfrResult.status === "fulfilled" ? pfrResult.value : [];

  if (ecr.length === 0) {
    // ECR is mandatory — fall back to stale cache
    const dbConn = await getDb();
    const staleRows = dbConn ? await (async () => {
      try {
        await ensureFantasyDataTables();
        return await dbConn
          .select()
          .from(fantasyDataCache)
          .where(eq(fantasyDataCache.cacheKey, CACHE_KEY))
          .limit(1);
      } catch {
        return [];
      }
    })() : [];
    if (staleRows.length) {
      const stale = staleRows[0];
      return {
        players: stale.payload as unknown as MergedPlayer[],
        fetchedAt: stale.fetchedAt,
        sources: { ecr: 0, adp: 0, pfr: 0, merged: (stale.payload as unknown[]).length },
        fromCache: true,
      };
    }
    throw new Error("FantasyPros ECR unavailable and no cached data found");
  }

  const merged = mergePlayers(ecr, adp, pfr);
  await setCached(CACHE_KEY, merged);

  // Record ADP trend snapshot (fire-and-forget, don't block the response)
  recordAdpSnapshot(merged).catch(() => {});

  return {
    players: merged,
    fetchedAt: new Date(),
    sources: { ecr: ecr.length, adp: adp.length, pfr: pfr.length, merged: merged.length },
    fromCache: false,
  };
}

// ─── ADP Trend Tracking ──────────────────────────────────────────────────────

/**
 * Insert one snapshot row per player into adp_trend_snapshots.
 * Called after every fresh fetch (fire-and-forget).
 */
async function recordAdpSnapshot(players: MergedPlayer[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await ensureFantasyDataTables();
  const now = new Date();
  // Batch insert in chunks of 100 to avoid oversized queries
  const CHUNK = 100;
  for (let i = 0; i < players.length; i += CHUNK) {
    const chunk = players.slice(i, i + CHUNK);
    await db.insert(adpTrendSnapshots).values(
      chunk.map((p) => ({
        fpId: p.fpId,
        playerName: p.name,
        position: p.position,
        adp: p.adp !== null ? Math.round(p.adp * 10) : null,
        ecrRank: p.ecrRank,
        snapshotAt: now,
      }))
    );
  }
}

export interface AdpTrendEntry {
  snapshotAt: Date;
  adp: number | null;   // actual ADP (null if no ADP data)
  ecrRank: number;
}

/**
 * Return the last N snapshots for a player (by fpId), newest-first.
 * Used to compute rising/falling ADP trend on the client.
 */
export async function getAdpTrend(fpId: number, limit = 10): Promise<AdpTrendEntry[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    await ensureFantasyDataTables();
  } catch {
    return [];
  }
  // Only look at snapshots from the last 30 days
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(adpTrendSnapshots)
    .where(and(eq(adpTrendSnapshots.fpId, fpId), gte(adpTrendSnapshots.snapshotAt, since)))
    .orderBy(desc(adpTrendSnapshots.snapshotAt))
    .limit(limit);
  return rows.map((r) => ({
    snapshotAt: r.snapshotAt,
    adp: r.adp !== null ? r.adp / 10 : null,
    ecrRank: r.ecrRank,
  }));
}

/**
 * Get cached PFR stats for a specific player by name (fuzzy match).
 */
export async function getPFRStats(playerName: string): Promise<MergedPlayer | null> {
  const cached = await getCached(CACHE_KEY);
  if (!cached) return null;
  const norm = normalizeName(playerName);
  return cached.data.find((p) => normalizeName(p.name) === norm) ?? null;
}
