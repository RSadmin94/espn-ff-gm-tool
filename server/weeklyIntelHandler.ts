/**
 * weeklyIntelHandler.ts
 * ─────────────────────
 * Project-level Heartbeat handler for the weekly intelligence refresh.
 * Registered at POST /api/scheduled/weekly-intel
 *
 * Schedule: Tuesdays 09:00 UTC ("0 0 9 * * 2") — after MNF settles.
 * Created via CLI (after deploy):
 *   manus-heartbeat create \
 *     --name weekly-intel \
 *     --cron "0 0 9 * * 2" \
 *     --path /api/scheduled/weekly-intel \
 *     --description "Weekly ESPN data refresh + owner notification"
 *
 * Auth: platform POSTs with x-manus-cron-task-uid header.
 * We trust the platform gateway (which restricts /api/scheduled/* to cron callers only)
 * and read the task UID from the header for logging.
 */

import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import {
  fetchEspnViewsHardened,
  resolveEspnCreds,
  normalizeTeams,
  normalizeRosters,
  normalizeMatchups,
  normalizeDraftPicks,
  normalizeTransactions,
  validateDataQuality,
} from "./espnService";
import {
  upsertCachedView,
  upsertViewHealth,
  upsertRefreshManifest,
  getRefreshManifests,
} from "./db";
import { upsertLeagueIdentity } from "./leagueIdentityService";
import { notifyOwner } from "./_core/notification";
import { memCache } from "./memCache";

const CURRENT_SEASON = 2025;

export async function weeklyIntelHandler(req: Request, res: Response) {
  const startedAt = Date.now();
  let taskUid: string | undefined;

  try {
    // ── 0. Authenticate the cron caller ───────────────────────────────────
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) {
      return res.status(403).json({ error: "cron-only endpoint" });
    }
    taskUid = user.taskUid;

    // ── 1. Fetch ESPN data for the current season ──────────────────────────
    const creds = await resolveEspnCreds();
    const pipelineResult = await fetchEspnViewsHardened(CURRENT_SEASON, undefined, creds);
    const data = pipelineResult.merged;

    // ── 2. Persist per-view health records ────────────────────────────────
    for (const vr of pipelineResult.viewResults) {
      await upsertViewHealth(CURRENT_SEASON, vr.viewName, {
        status: vr.status === "auth_error" ? "error" : vr.status,
        errorMessage: vr.error,
        recordCount: vr.recordCount,
      });
    }

    // ── 3. Persist combined cache + league identity ────────────────────────
    await upsertCachedView(CURRENT_SEASON, "combined", data, creds.leagueId);
    try { await upsertLeagueIdentity(CURRENT_SEASON, data); } catch (_e) { /* non-fatal */ }

    // ── 4. Normalize and compute quality ──────────────────────────────────
    const teams = normalizeTeams(data);
    const rosters = normalizeRosters(data);
    const matchups = normalizeMatchups(data);
    const picks = normalizeDraftPicks(data);
    const txs = normalizeTransactions(data);
    const quality = validateDataQuality(CURRENT_SEASON, data);

    const overallStatus = pipelineResult.allViewsOk && quality.isUsable
      ? "success"
      : pipelineResult.hasPartialData || !quality.isUsable
      ? "partial"
      : "success";

    await upsertRefreshManifest(CURRENT_SEASON, {
      teamCount: teams.length,
      rosterCount: rosters.length,
      matchupCount: matchups.length,
      draftPickCount: picks.length,
      transactionCount: txs.length,
      status: overallStatus,
      viewsRefreshed: pipelineResult.viewResults
        .filter(v => v.status === "ok")
        .map(v => v.viewName),
      errorMessage: quality.issues.length > 0 ? quality.issues.join("; ") : undefined,
    });

    // ── 5. Bust in-memory caches ───────────────────────────────────────────
    memCache.invalidateAll();

    // ── 5b. Refresh weekly storylines (deterministic labels only, no LLM) ──
    try {
      const { refreshWeeklyStorylines } = await import("./weeklyStorylinesService");
      await refreshWeeklyStorylines(CURRENT_SEASON);
    } catch (_e) { /* non-fatal — storylines are supplemental */ }

    // ── 5c. Refresh fear index (deterministic, no LLM) ────────────────────
    try {
      const { refreshFearIndex } = await import("./fearIndexService");
      await refreshFearIndex(CURRENT_SEASON);
    } catch (_e) { /* non-fatal — fear index is supplemental */ }

    // ── 5d. Refresh reputation events (deterministic labels only, no LLM) ──
    try {
      const { refreshReputationEvents } = await import("./reputationService");
      await refreshReputationEvents({ generateLLM: false });
    } catch (_e) { /* non-fatal — reputation events are supplemental */ }

    // ── 6. Build owner notification ───────────────────────────────────────
    const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    const failedViews = pipelineResult.viewResults
      .filter(v => v.status !== "ok")
      .map(v => `${v.viewName}(${v.status})`)
      .join(", ");

    const notifTitle = overallStatus === "success"
      ? `✅ Weekly Intel Refresh — ${CURRENT_SEASON} Season`
      : `⚠️ Weekly Intel Refresh — Partial (${CURRENT_SEASON})`;

    const notifContent = [
      `Status: **${overallStatus}**`,
      `Teams: ${teams.length} | Rosters: ${rosters.length} | Matchups: ${matchups.length}`,
      `Transactions: ${txs.length} | Draft Picks: ${picks.length}`,
      failedViews ? `Failed views: ${failedViews}` : `All views OK`,
      quality.issues.length > 0 ? `Quality issues: ${quality.issues.join("; ")}` : "",
      `Duration: ${durationSec}s`,
      taskUid ? `Task UID: ${taskUid}` : "",
    ].filter(Boolean).join("\n");

    // Fire-and-forget — don't block the 200 response on notification delivery
    notifyOwner({ title: notifTitle, content: notifContent }).catch(() => {});

    console.log(`[weekly-intel] ${overallStatus} in ${durationSec}s (taskUid=${taskUid ?? "unknown"})`);

    return res.json({
      ok: true,
      status: overallStatus,
      season: CURRENT_SEASON,
      teams: teams.length,
      rosters: rosters.length,
      matchups: matchups.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[weekly-intel] FAILED (taskUid=${taskUid ?? "unknown"}):`, msg);

    // Notify owner of failure
    notifyOwner({
      title: `❌ Weekly Intel Refresh FAILED`,
      content: `Error: ${msg}\nTask UID: ${taskUid ?? "unknown"}`,
    }).catch(() => {});

    return res.status(500).json({
      error: msg,
      stack,
      context: { taskUid, season: CURRENT_SEASON },
      timestamp: new Date().toISOString(),
    });
  }
}
