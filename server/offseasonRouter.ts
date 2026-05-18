/**
 * offseasonRouter.ts
 *
 * tRPC procedures for the 2026 offseason intelligence layer.
 *
 * Procedures:
 *   offseason.keeperRecommendations  — DNA-powered keeper picks for all 14 teams
 *   offseason.draftBoard             — 2026 draft strategy board with per-team intelligence
 *   offseason.teamKeeperBrief        — LLM-generated keeper + draft brief for a single team
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { buildKeeperRecommendations } from "./keeperRecommendationEngine";
import { buildLeagueDraftBoard } from "./draftStrategyEngine";
import { getCachedView, getAllCachedSeasons, getCompletedSeasonForOffseason, upsertCachedView, upsertRefreshManifest, upsertViewHealth } from "./db";
import { normalizeDraftPicks, fetchEspnViewsHardened, normalizeTeams, normalizeRosters, normalizeMatchups, normalizeTransactions, validateDataQuality, resolveEspnCreds } from "./espnService";
import { getOrFetchLeagueIdentity, upsertLeagueIdentity } from "./leagueIdentityService";
import { memCache } from "./memCache";

async function getSeasonData(season: number) {
  const cached = await getCachedView(season, "combined");
  if (cached) return cached.payload as Record<string, unknown>;
  return null;
}

export const offseasonRouter = router({
  // ── All 14 teams: DNA-powered keeper recommendations ─────────────────────
  keeperRecommendations: protectedProcedure.query(async () => {
    const { calcLeagueDNA } = await import("./leagueDNA");
    const { buildManagerRawData } = await import("./dnaRouter");

    // Always use the last COMPLETED season as the keeper baseline.
    // getCompletedSeasonForOffseason() caps at currentYear-1, so a partial
    // 2026 sync never overwrites the 2025 keeper data.
    const completedSeason = await getCompletedSeasonForOffseason();
    if (!completedSeason) return { teams: [], leagueSummary: null };
    const planningYear = completedSeason + 1; // e.g. 2025 → 2026

    const cachedSeasons = (await getAllCachedSeasons()).sort((a: number, b: number) => a - b);
    if (cachedSeasons.length === 0) return { teams: [], leagueSummary: null };

    const latestSeason = completedSeason; // explicit alias for clarity
    const data2025 = await getSeasonData(latestSeason);
    if (!data2025) return { teams: [], leagueSummary: null };

    // Build keeper eligibility (mirrors keeperEligibility2026 logic)
    const keepersByPlayerByTeam: Record<number, Record<number, Array<{ season: number; roundId: number; playerName: string; position: string }>>> = {};
    for (const season of cachedSeasons) {
      const data = await getSeasonData(season);
      if (!data) continue;
      const picks = normalizeDraftPicks(data);
      for (const p of picks) {
        if (!p.keeper) continue;
        const tid = p.teamId as number;
        const pid = p.playerId as number;
        if (!keepersByPlayerByTeam[tid]) keepersByPlayerByTeam[tid] = {};
        if (!keepersByPlayerByTeam[tid][pid]) keepersByPlayerByTeam[tid][pid] = [];
        keepersByPlayerByTeam[tid][pid].push({
          season: p.season as number,
          roundId: p.roundId as number,
          playerName: (p.playerName as string) || `Player#${pid}`,
          position: (p.position as string) || "?",
        });
      }
    }

    // 2025 keepers
    const keepers2025: Record<number, Array<{ playerId: number; playerName: string; position: string; roundId: number }>> = {};
    const data2025picks = normalizeDraftPicks(data2025);
    for (const p of data2025picks) {
      if (!p.keeper) continue;
      const tid = p.teamId as number;
      const pid = p.playerId as number;
      if (!keepers2025[tid]) keepers2025[tid] = [];
      keepers2025[tid].push({
        playerId: pid,
        playerName: (p.playerName as string) || `Player#${pid}`,
        position: (p.position as string) || "?",
        roundId: p.roundId as number,
      });
    }

    // 2024 keepers (for consecutive check)
    const prevSeason = latestSeason - 1;
    const keepers2024: Record<number, Record<number, number>> = {};
    if (cachedSeasons.includes(prevSeason)) {
      const data2024 = await getSeasonData(prevSeason);
      if (data2024) {
        const picks2024 = normalizeDraftPicks(data2024);
        for (const p of picks2024) {
          if (!p.keeper) continue;
          const tid = p.teamId as number;
          const pid = p.playerId as number;
          if (!keepers2024[tid]) keepers2024[tid] = {};
          keepers2024[tid][pid] = p.roundId as number;
        }
      }
    }

    // Build eligibility data — use live 2026 team names from leagueIdentity when available
    const identity2026early = await getOrFetchLeagueIdentity(planningYear);
    const { normalizeTeams: _normalizeTeams } = await import("./espnService");
    const teams2025 = _normalizeTeams(data2025); // still needed for roster structure
    const teamNames: Record<number, string> = {};
    if (identity2026early?.teams?.length) {
      for (const t of identity2026early.teams) teamNames[t.teamId] = t.name;
    } else {
      for (const t of teams2025) teamNames[t.teamId as number] = (t.teamName as string) || `Team ${t.teamId}`;
    }

    const eligibilityData = teams2025.map(team => {
      const tid = team.teamId as number;
      const tname = teamNames[tid];
      const my2025Keepers = keepers2025[tid] || [];
      const my2024Keepers = keepers2024[tid] || {};

      function valueTier(position: string, roundCost: number): { tier: string; label: string } {
        const adpRound: Record<string, number> = { QB: 6, RB: 3, WR: 3, TE: 5, K: 14, DEF: 13 };
        const pos = position?.toUpperCase() || "";
        const adp = adpRound[pos] ?? 7;
        const savings = adp - roundCost;
        if (savings >= 4) return { tier: "elite", label: "Elite Value" };
        if (savings >= 2) return { tier: "good", label: "Good Value" };
        if (savings >= 0) return { tier: "fair", label: "Fair Value" };
        return { tier: "poor", label: "Poor Value" };
      }

      const players = my2025Keepers.map(k => {
        const keptIn2024 = my2024Keepers[k.playerId] !== undefined;
        const isIneligible = keptIn2024;
        const roundCost2026 = isIneligible ? null : k.roundId - 1;
        const value = isIneligible ? { tier: "ineligible", label: "Must Return" } : valueTier(k.position, roundCost2026!);
        return {
          playerId: k.playerId,
          playerName: k.playerName,
          position: k.position,
          round2025: k.roundId,
          round2024: keptIn2024 ? my2024Keepers[k.playerId] : null,
          roundCost2026,
          consecutiveYears: keptIn2024 ? 2 : 1,
          isIneligible,
          valueTier: value.tier,
          valueLabel: value.label,
        };
      });

      return {
        teamId: tid,
        teamName: tname,
        players,
        ineligibleCount: players.filter(p => p.isIneligible).length,
        eligibleCount: players.filter(p => !p.isIneligible).length,
      };
    });

    // Get DNA profiles
    const managers = await buildManagerRawData();
    const dnaProfiles = calcLeagueDNA(managers);

    // Get 2026 draft order and team names from leagueIdentity (live ESPN, cached in DB)
    const identity2026 = await getOrFetchLeagueIdentity(planningYear);
    const draftOrder = identity2026?.draftOrder?.length
      ? identity2026.draftOrder.map(p => ({
          teamId: p.teamId,
          teamName: p.teamName,
          ownerName: p.ownerName,
          pickNumber: p.position,
        }))
      : null;
    // Use live team names from identity if available, fall back to 2025 cache
    const liveTeamNames: Record<number, string> = {};
    if (identity2026?.teams?.length) {
      for (const t of identity2026.teams) liveTeamNames[t.teamId] = t.name;
    }

    // Build recommendations
    const recommendations = buildKeeperRecommendations(eligibilityData, dnaProfiles, draftOrder);

    // League summary
    const allEligible = eligibilityData.flatMap(t => t.players.filter(p => !p.isIneligible));
    const allIneligible = eligibilityData.flatMap(t => t.players.filter(p => p.isIneligible));

    return {
      completedSeason: latestSeason,    // e.g. 2025 — the historical data source
      planningYear,                     // e.g. 2026 — what we're planning for
      season: planningYear,             // kept for UI backward-compat
      deadline: `August 18, ${planningYear}`,
      rule: `Players kept in ${latestSeason - 1} AND ${latestSeason} must return to the draft pool for ${planningYear}.`,
      teams: recommendations,
      leagueSummary: {
        totalEligible: allEligible.length,
        totalIneligible: allIneligible.length,
        topValueKeepers: allEligible
          .filter(p => p.valueTier === "elite" || p.valueTier === "good")
          .sort((a, b) => (a.roundCost2026 ?? 99) - (b.roundCost2026 ?? 99))
          .slice(0, 10),
        ineligiblePlayers: allIneligible.map(p => ({
          ...p,
          teamName: eligibilityData.find(t => t.players.some(tp => tp.playerId === p.playerId))?.teamName ?? "Unknown",
        })),
      },
    };
  }),

  // ── 2026 draft strategy board ─────────────────────────────────────────────
  draftBoard: protectedProcedure.query(async () => {
    const { calcLeagueDNA } = await import("./leagueDNA");
    const { buildManagerRawData } = await import("./dnaRouter");

    // Use the same completed-season guard as keeperRecommendations
    const completedSeason = await getCompletedSeasonForOffseason();
    if (!completedSeason) return null;

    const cachedSeasons = (await getAllCachedSeasons()).sort((a: number, b: number) => a - b);
    if (cachedSeasons.length === 0) return null;

    const latestSeason = completedSeason;
    const data2025 = await getSeasonData(latestSeason);
    if (!data2025) return null;

    const managers = await buildManagerRawData();
    const dnaProfiles = calcLeagueDNA(managers);

    // Get keeper recommendations (reuse the same logic)
    const keeperResult = await offseasonRouter.createCaller({} as never).keeperRecommendations();
    const keeperRecommendations = keeperResult.teams;

    // Get 2026 draft order and team names from leagueIdentity (live ESPN, cached in DB)
    const planningYear2 = latestSeason + 1;
    const identity2026 = await getOrFetchLeagueIdentity(planningYear2);
    if (!identity2026?.draftOrder?.length) return null;
    const draftOrderRaw = identity2026.draftOrder.map(p => ({
      teamId: p.teamId,
      teamName: p.teamName,
      ownerName: p.ownerName,
      pickNumber: p.position,
    }));

    // Build returning players (ineligible keepers)
    const picks2025 = normalizeDraftPicks(data2025);
    const prevSeason = latestSeason - 1;
    const keepers2024: Record<number, Record<number, boolean>> = {};
    if (cachedSeasons.includes(prevSeason)) {
      const data2024 = await getSeasonData(prevSeason);
      if (data2024) {
        const picks2024 = normalizeDraftPicks(data2024);
        for (const p of picks2024) {
          if (!p.keeper) continue;
          const tid = p.teamId as number;
          const pid = p.playerId as number;
          if (!keepers2024[tid]) keepers2024[tid] = {};
          keepers2024[tid][pid] = true;
        }
      }
    }

    // Use live 2026 team names from identity, fall back to 2025 cache names
    const teamNames: Record<number, string> = {};
    if (identity2026?.teams?.length) {
      for (const t of identity2026.teams) teamNames[t.teamId] = t.name;
    } else {
      // fallback: parse from 2025 data
      const { normalizeTeams } = await import("./espnService");
      const teams2025 = normalizeTeams(data2025);
      for (const t of teams2025) teamNames[t.teamId as number] = (t.teamName as string) || `Team ${t.teamId}`;
    }

    const returningPlayers: Array<{ playerName: string; teamName: string; position: string; round2025: number }> = [];
    for (const p of picks2025) {
      if (!p.keeper) continue;
      const tid = p.teamId as number;
      const pid = p.playerId as number;
      if (keepers2024[tid]?.[pid]) {
        returningPlayers.push({
          playerName: (p.playerName as string) || `Player#${pid}`,
          teamName: teamNames[tid] || `Team ${tid}`,
          position: (p.position as string) || "?",
          round2025: p.roundId as number,
        });
      }
    }

    const board = buildLeagueDraftBoard(
      draftOrderRaw.map(d => ({
        teamId: d.teamId,
        teamName: d.teamName,
        ownerName: d.ownerName,
        pickNumber: d.pickNumber ?? 1,
      })),
      keeperRecommendations,
      dnaProfiles,
      returningPlayers,
    );

    return board;
  }),

  // ── Single team: LLM-generated keeper + draft brief ───────────────────────
  teamKeeperBrief: protectedProcedure
    .input(z.object({ teamId: z.number(), teamName: z.string() }))
    .mutation(async ({ input }) => {
      const { calcLeagueDNA, buildDNAPromptBlock } = await import("./leagueDNA");
      const { buildManagerRawData } = await import("./dnaRouter");

      const completedSeason = await getCompletedSeasonForOffseason();
      if (!completedSeason) return { brief: "No completed season data available." };
      const planningYear = completedSeason + 1;

      const cachedSeasons = (await getAllCachedSeasons()).sort((a: number, b: number) => a - b);
      if (cachedSeasons.length === 0) return { brief: "No data available." };

      const latestSeason = completedSeason;
      const data2025 = await getSeasonData(latestSeason);
      if (!data2025) return { brief: `No ${latestSeason} season data available.` };

      // Get this team's keepers
      const picks2025 = normalizeDraftPicks(data2025);
      const teamKeepers = picks2025.filter(p => p.keeper && p.teamId === input.teamId);

      // Get DNA — use live 2026 identity for owner name if available
      const managers = await buildManagerRawData();
      const dnaProfiles = calcLeagueDNA(managers);
      const identity2026brief = await getOrFetchLeagueIdentity(planningYear);
      const liveTeam = identity2026brief?.teams?.find(t => t.teamId === input.teamId);
      const ownerName = liveTeam?.owners ?? input.teamName;
      const teamDna = dnaProfiles.find(d =>
        d.ownerName && ownerName.toLowerCase().includes(d.ownerName.toLowerCase().split(" ")[0].toLowerCase())
      );

      // Get 2024 keepers for consecutive check
      const prevSeason = latestSeason - 1;
      const keepers2024: Record<number, number> = {};
      if (cachedSeasons.includes(prevSeason)) {
        const data2024 = await getSeasonData(prevSeason);
        if (data2024) {
          const picks2024 = normalizeDraftPicks(data2024);
          for (const p of picks2024) {
            if (p.keeper && p.teamId === input.teamId) {
              keepers2024[p.playerId as number] = p.roundId as number;
            }
          }
        }
      }

      const prevCompletedSeason = latestSeason - 1; // e.g. 2024
      const keeperSummary = teamKeepers.map(k => {
        const pid = k.playerId as number;
        const keptInPrev = keepers2024[pid] !== undefined;
        const roundCost = keptInPrev ? null : (k.roundId as number) - 1;
        return `${k.playerName} (${k.position}) — kept at round ${k.roundId} in ${latestSeason}${keptInPrev ? ` — INELIGIBLE (kept in both ${prevCompletedSeason} AND ${latestSeason}, must return to pool)` : `, costs round ${roundCost} to keep in ${planningYear}`}`;
      }).join("\n");

      const dnaBlock = teamDna ? buildDNAPromptBlock([teamDna]) : "";

      const prompt = `You are a fantasy football GM advisor preparing the ${planningYear} offseason briefing for ${input.teamName}.
Data source: ${latestSeason} completed season results.

KEEPER ELIGIBILITY (${planningYear}):
${keeperSummary || "No keepers found for this team."}

${dnaBlock ? `MANAGER DNA PROFILE:\n${dnaBlock}` : ""}

Write a concise, direct ${planningYear} offseason briefing for this team covering:
1. **Keeper Decision**: Which player(s) should they keep and why — factor in their DNA archetype and draft tendencies
2. **Draft Strategy**: Given their keeper decision and pick position, what is their optimal ${planningYear} draft approach
3. **Key Risks**: What could go wrong with their keeper choice
4. **Competitor Intelligence**: Based on their DNA, what will other managers try to do to exploit them in the draft

Be specific, use the actual player names and round numbers. Write in a direct GM-to-GM voice.`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a sharp, data-driven fantasy football GM advisor. Be direct, specific, and actionable." },
          { role: "user", content: prompt },
        ],
      });

      const brief = response.choices?.[0]?.message?.content ?? "Brief generation failed.";
      return { brief, teamName: input.teamName, ownerName };
    }),

  // ── Manual ESPN refresh for offseason planning data ──────────────────────
  refresh: protectedProcedure.mutation(async () => {
    const completedSeason = await getCompletedSeasonForOffseason();
    const planningYear = completedSeason ? completedSeason + 1 : new Date().getFullYear();
    const seasonsToRefresh = completedSeason ? [completedSeason, planningYear] : [planningYear];
    const results: Record<number, { status: string; error?: string; skipped?: boolean }> = {};
    const creds = await resolveEspnCreds();

    for (const season of seasonsToRefresh) {
      try {
        const pipelineResult = await fetchEspnViewsHardened(season, undefined, creds);
        const data = pipelineResult.merged;

        // Persist per-view health
        for (const vr of pipelineResult.viewResults) {
          await upsertViewHealth(season, vr.viewName, {
            status: vr.status === "auth_error" ? "error" : vr.status,
            errorMessage: vr.error,
            recordCount: vr.recordCount,
          });
        }

        await upsertCachedView(season, "combined", data, creds.leagueId);

        // Update league identity (team names, draft order, settings)
        try { await upsertLeagueIdentity(season, data); } catch (_e) { /* non-fatal */ }

        const teams = normalizeTeams(data);
        const rosters = normalizeRosters(data);
        const matchups = normalizeMatchups(data);
        const picks = normalizeDraftPicks(data);
        const txs = normalizeTransactions(data);
        const quality = validateDataQuality(season, data);
        const overallStatus = pipelineResult.allViewsOk && quality.isUsable ? "success"
          : pipelineResult.hasPartialData || !quality.isUsable ? "partial"
          : "success";

        await upsertRefreshManifest(season, {
          teamCount: teams.length, rosterCount: rosters.length,
          matchupCount: matchups.length, draftPickCount: picks.length,
          transactionCount: txs.length, status: overallStatus,
          viewsRefreshed: pipelineResult.viewResults.filter(v => v.status === "ok").map(v => v.viewName),
          errorMessage: quality.issues.length > 0 ? quality.issues.join("; ") : undefined,
        });

        results[season] = { status: overallStatus };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await upsertRefreshManifest(season, { status: "failed", errorMessage: msg });
        results[season] = { status: "failed", error: msg };
      }
    }

    // Bust all in-memory caches so next page load recomputes with fresh data
    memCache.invalidateAll();

    const anyFailed = Object.values(results).some(r => r.status === "failed");
    const allSuccess = Object.values(results).every(r => r.status === "success");
    return {
      status: anyFailed ? "partial" : allSuccess ? "success" : "partial",
      seasons: results,
      refreshedAt: Date.now(),
    };
  }),
});
