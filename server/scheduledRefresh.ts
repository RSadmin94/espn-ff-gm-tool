import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { fetchEspnViewsHardened, fetchTradeProposals, mergeTradeProposalsIntoTransactions, resolveEspnCreds } from "./espnService";
import {
  upsertViewHealth,
  upsertCachedView,
  upsertRefreshManifest,
} from "./db";
import { upsertLeagueIdentity } from "./leagueIdentityService";
import {
  normalizeTeams,
  normalizeRosters,
  normalizeMatchups,
  normalizeDraftPicks,
  normalizeTransactions,
  validateDataQuality,
} from "./espnService";

// Seasons to refresh on every weekly trigger
const AUTO_REFRESH_SEASONS = [2025, 2026];

/**
 * POST /api/scheduled/espn-refresh
 * Called by the Manus Heartbeat platform every Monday at 06:00 UTC.
 * Authenticates the cron caller, then refreshes ESPN data for the
 * current and upcoming seasons (2025, 2026).
 */
export async function espnRefreshHandler(req: Request, res: Response) {
  const startedAt = Date.now();
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) {
      return res.status(403).json({ error: "cron-only endpoint" });
    }

    const taskUid = user.taskUid;
    const creds = await resolveEspnCreds();
    const results: Record<number, {
      status: string;
      viewHealth?: Record<string, string>;
      qualityWarnings?: string[];
      error?: string;
    }> = {};

    for (const season of AUTO_REFRESH_SEASONS) {
      try {
        const pipelineResult = await fetchEspnViewsHardened(season, undefined, creds);
        const data = pipelineResult.merged;

        // Persist per-view health records
        for (const vr of pipelineResult.viewResults) {
          await upsertViewHealth(season, vr.viewName, {
            status: vr.status === "auth_error" ? "error" : vr.status,
            errorMessage: vr.error,
            recordCount: vr.recordCount,
          });
        }

        // Enrich transactions: fetch all TRADE_PROPOSAL records via x-fantasy-filter.
        // mTransactions2 only returns ~50 recent transactions, so proposals for
        // trades accepted before the cache window are missing (2026 root cause).
        let enrichedData = data;
        try {
          const proposals = await fetchTradeProposals(season, creds);
          enrichedData = mergeTradeProposalsIntoTransactions(data, proposals);
        } catch (_e) { /* non-fatal — fall back to unmerged data */ }

        await upsertCachedView(season, "combined", enrichedData, creds.leagueId);
        // Persist static identity data (team names, draft order, settings) to league_identity table
        try { await upsertLeagueIdentity(season, enrichedData); } catch (_e) { /* non-fatal */ }

        const teams = normalizeTeams(enrichedData);
        const rosters = normalizeRosters(enrichedData);
        const matchups = normalizeMatchups(enrichedData);
        const picks = normalizeDraftPicks(enrichedData);
        const txs = normalizeTransactions(enrichedData);

        const quality = validateDataQuality(season, data);
        const overallStatus =
          pipelineResult.allViewsOk && quality.isUsable
            ? "success"
            : pipelineResult.hasPartialData || !quality.isUsable
            ? "partial"
            : "success";

        await upsertRefreshManifest(season, {
          teamCount: teams.length,
          rosterCount: rosters.length,
          matchupCount: matchups.length,
          draftPickCount: picks.length,
          transactionCount: txs.length,
          status: overallStatus,
          viewsRefreshed: pipelineResult.viewResults
            .filter((v) => v.status === "ok")
            .map((v) => v.viewName),
          errorMessage:
            quality.issues.length > 0 ? quality.issues.join("; ") : undefined,
        });

        const viewHealth: Record<string, string> = {};
        for (const vr of pipelineResult.viewResults) {
          viewHealth[vr.viewName] = vr.status;
        }

        results[season] = {
          status: overallStatus,
          viewHealth,
          qualityWarnings: [...quality.issues, ...quality.warnings],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await upsertRefreshManifest(season, {
          status: "failed",
          errorMessage: msg,
        });
        results[season] = { status: "failed", error: msg };
        console.error(`[ScheduledRefresh] Season ${season} failed:`, msg);
      }
    }

    const allOk = Object.values(results).every((r) => r.status === "success");
    const durationMs = Date.now() - startedAt;

    console.log(
      `[ScheduledRefresh] taskUid=${taskUid} completed in ${durationMs}ms allOk=${allOk}`,
      results
    );

    return res.json({ ok: true, taskUid, durationMs, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[ScheduledRefresh] Handler error:", msg);
    return res.status(500).json({
      error: msg,
      stack,
      context: {
        url: req.url,
        taskUid: req.headers["x-manus-cron-task-uid"],
      },
      timestamp: new Date().toISOString(),
    });
  }
}
