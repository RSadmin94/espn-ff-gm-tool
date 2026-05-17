/**
 * Provider Router
 *
 * tRPC procedures for multi-provider league management.
 * Handles: provider listing, league connection, Sleeper league lookup,
 * and the DNA generation onboarding flow.
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getSupportedProviders, PROVIDER_INFO, getAdapter } from "./providers/registry";
import { getSleeperLeague } from "./providers/sleeperAdapter";
import { YahooAdapter, getYahooLeaguesForUser } from "./providers/yahooAdapter";
import { isYahooConfigured } from "./providers/yahooOAuth";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { leagueConnections, users } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { fetchEspnViewsHardened, normalizeTeams, normalizeSettings, type EspnCreds } from "./espnService";
import { encryptCredentialsForDb } from "./_core/crypto";

// ─── Provider info ────────────────────────────────────────────────────────────

export const providerRouter = router({
  /**
   * List all providers with their status (live / coming_soon).
   */
  listProviders: publicProcedure.query(() => {
    return PROVIDER_INFO;
  }),

  /**
   * Validate a Sleeper league ID and return basic league info.
   * No auth required — Sleeper API is public.
   */
  validateSleeperLeague: publicProcedure
    .input(z.object({ leagueId: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const res = await fetch(
          `https://api.sleeper.app/v1/league/${input.leagueId}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) {
          return { valid: false, error: `Sleeper returned ${res.status}` };
        }
        const data = await res.json() as {
          name: string;
          season: string;
          total_rosters: number;
          status: string;
          scoring_settings?: Record<string, number>;
        };
        const rec = data.scoring_settings?.["rec"] ?? 0;
        const scoringType = rec >= 1 ? "PPR" : rec >= 0.5 ? "Half PPR" : "Standard";
        return {
          valid: true,
          leagueName: data.name,
          season: data.season,
          teamCount: data.total_rosters,
          status: data.status,
          scoringType,
        };
      } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : "Network error" };
      }
    }),

  /**
   * Look up all Sleeper leagues for a given username.
   */
  getSleeperLeaguesForUser: publicProcedure
    .input(z.object({ username: z.string().min(1), season: z.number().default(2025) }))
    .query(async ({ input }) => {
      try {
        // First get user ID from username
        const userRes = await fetch(
          `https://api.sleeper.app/v1/user/${input.username}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!userRes.ok) {
          return { found: false, error: `User "${input.username}" not found on Sleeper` };
        }
        const user = await userRes.json() as { user_id: string; display_name: string };

        // Then get their leagues
        const leaguesRes = await fetch(
          `https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${input.season}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!leaguesRes.ok) {
          return { found: false, error: "Could not fetch leagues" };
        }
        const leagues = await leaguesRes.json() as Array<{
          league_id: string;
          name: string;
          season: string;
          total_rosters: number;
          status: string;
        }>;

        return {
          found: true,
          userId: user.user_id,
          displayName: user.display_name,
          leagues: leagues.map(l => ({
            leagueId: l.league_id,
            name: l.name,
            season: l.season,
            teamCount: l.total_rosters,
            status: l.status,
          })),
        };
      } catch (err) {
        return { found: false, error: err instanceof Error ? err.message : "Network error" };
      }
    }),

  /**
   * Import a Sleeper league and generate its DNA profile.
   * Returns a streaming-friendly response with progress steps.
   */
  importSleeperLeague: protectedProcedure
    .input(z.object({
      leagueId: z.string().min(1),
      season: z.number().default(2025),
    }))
    .mutation(async ({ input, ctx }) => {
      const steps: string[] = [];

      steps.push("Connecting to Sleeper API...");
      const league = await getSleeperLeague(input.leagueId);
      steps.push(`Found league: ${league.settings.leagueName} (${league.teams.length} teams)`);

      steps.push("Analyzing roster compositions...");
      const rosterSummary = league.teams.map(t => {
        const roster = league.rosters.find(r => r.teamId === t.teamId);
        return {
          team: t.teamName,
          owner: t.ownerName,
          record: `${t.wins}-${t.losses}`,
          starters: roster?.slots.filter(s => s.slotType === "starter").length ?? 0,
        };
      });

      steps.push("Detecting behavioral patterns...");
      const txByTeam = new Map<string, number>();
      for (const tx of league.transactions) {
        txByTeam.set(tx.teamId, (txByTeam.get(tx.teamId) || 0) + 1);
      }

      steps.push("Mapping trade tendencies...");
      const tradesByTeam = new Map<string, number>();
      for (const tx of league.transactions.filter(t => t.type === "TRADE")) {
        tradesByTeam.set(tx.teamId, (tradesByTeam.get(tx.teamId) || 0) + 1);
      }

      steps.push("Building exploitability models...");

      // Generate DNA profile via LLM
      steps.push("Generating League DNA Profile...");
      const teamSummaries = league.teams.map(t => {
        const trades = tradesByTeam.get(t.teamId) || 0;
        const moves = txByTeam.get(t.teamId) || 0;
        return `${t.ownerName} (${t.wins}-${t.losses}, ${t.pointsFor} PF): ${trades} trades, ${moves} total moves`;
      }).join("\n");

      const dnaResponse = await invokeLLM({
        messages: [
          {
            role: "system" as const,
            content: `You are an expert fantasy football analyst. Analyze this Sleeper league and provide a DNA profile for each manager. For each manager, identify their archetype from: Aggressive Trader, Waiver Hawk, Draft & Hold, Contrarian, Reactive, Balanced, or Data-Driven. Return JSON matching the provided schema.`,
          },
          {
            role: "user" as const,
            content: `League: ${league.settings.leagueName} (${league.settings.season} season, ${league.settings.scoringType} scoring)
Teams and activity:\n${teamSummaries}\n\nGenerate the DNA profile.`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "league_dna",
            strict: true,
            schema: {
              type: "object",
              properties: {
                leagueName: { type: "string" },
                season: { type: "number" },
                provider: { type: "string" },
                teamProfiles: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      teamId: { type: "string" },
                      ownerName: { type: "string" },
                      archetype: { type: "string" },
                      archetypeReason: { type: "string" },
                      desperationScore: { type: "number" },
                      exploitabilityScore: { type: "number" },
                      keyTrait: { type: "string" },
                    },
                    required: ["teamId", "ownerName", "archetype", "archetypeReason", "desperationScore", "exploitabilityScore", "keyTrait"],
                    additionalProperties: false,
                  },
                },
                leagueSummary: { type: "string" },
              },
              required: ["leagueName", "season", "provider", "teamProfiles", "leagueSummary"],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent = dnaResponse.choices?.[0]?.message?.content;
      const dnaContent = typeof rawContent === "string" ? rawContent : null;
      let dnaProfile: unknown = null;
      try {
        dnaProfile = JSON.parse(dnaContent || "{}");
      } catch {
        dnaProfile = { error: "Failed to parse DNA profile" };
      }

      steps.push("League DNA Profile complete.");

      return {
        success: true,
        steps,
        league: {
          leagueId: input.leagueId,
          leagueName: league.settings.leagueName,
          season: league.settings.season,
          teamCount: league.teams.length,
          scoringType: league.settings.scoringType,
          currentWeek: league.settings.currentWeek,
          provider: "sleeper" as const,
        },
        teams: league.teams,
        matchupCount: league.matchups.length,
        transactionCount: league.transactions.length,
        dnaProfile,
      };
    }),

  /**
   * Get the current user's connected leagues.
   */
  getMyLeagues: protectedProcedure.query(async ({ ctx }) => {
    const database = await getDb();
    if (!database) return [];
    const rows = await database
      .select()
      .from(leagueConnections)
      .where(eq(leagueConnections.userId, ctx.user.id));
    return rows;
  }),

  // ─── Yahoo procedures ────────────────────────────────────────────────────────────────

  /**
   * Check if Yahoo OAuth is configured on this server.
   * Returns { configured: boolean } so the frontend can show/hide the OAuth button.
   */
  isYahooConfigured: publicProcedure.query(() => {
    return { configured: isYahooConfigured() };
  }),

  /**
   * Get the Yahoo OAuth authorization URL for the current user.
   * The frontend redirects the user to this URL to grant access.
   */
  getYahooAuthUrl: protectedProcedure
    .input(z.object({ origin: z.string().url() }))
    .query(({ input, ctx }) => {
      if (!isYahooConfigured()) {
        return { url: null, reason: "Yahoo OAuth is not configured on this server." };
      }
      const url = `${input.origin}/api/yahoo/oauth/start?origin=${encodeURIComponent(input.origin)}&userId=${ctx.user.id}`;
      return { url, reason: null };
    }),

  /**
   * Check if the current user has a pending Yahoo OAuth token (post-callback).
   * Returns the token expiry and whether the user needs to pick a league.
   */
  getYahooPendingAuth: protectedProcedure.query(async ({ ctx }) => {
    const database = await getDb();
    if (!database) return { hasPendingAuth: false };

    const rows = await database
      .select()
      .from(leagueConnections)
      .where(
        and(
          eq(leagueConnections.userId, ctx.user.id),
          eq(leagueConnections.provider, "yahoo"),
          eq(leagueConnections.leagueId, "__pending__")
        )
      )
      .limit(1);

    if (!rows.length) return { hasPendingAuth: false };

    const creds = rows[0].credentials as { accessToken?: string; refreshToken?: string; expiresAt?: number } | null;
    return {
      hasPendingAuth: true,
      expiresAt: creds?.expiresAt ?? 0,
    };
  }),

  /**
   * List all Yahoo Fantasy leagues for the authenticated user.
   * Requires a pending Yahoo auth token stored in leagueConnections.
   */
  getYahooLeagues: protectedProcedure
    .input(z.object({ season: z.number().default(2025) }))
    .query(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) return { leagues: [], error: "Database unavailable" };

      // Get pending auth tokens
      const rows = await database
        .select()
        .from(leagueConnections)
        .where(
          and(
            eq(leagueConnections.userId, ctx.user.id),
            eq(leagueConnections.provider, "yahoo"),
            eq(leagueConnections.leagueId, "__pending__")
          )
        )
        .limit(1);

      if (!rows.length) {
        return { leagues: [], error: "No Yahoo authorization found. Please connect Yahoo first." };
      }

      const creds = rows[0].credentials as { accessToken: string; refreshToken: string; expiresAt: number } | null;
      if (!creds?.accessToken) {
        return { leagues: [], error: "Invalid Yahoo credentials. Please reconnect." };
      }

      try {
        const leagues = await getYahooLeaguesForUser(
          creds.accessToken,
          creds.refreshToken,
          creds.expiresAt,
          input.season
        );
        return { leagues, error: null };
      } catch (err) {
        return {
          leagues: [],
          error: err instanceof Error ? err.message : "Failed to fetch Yahoo leagues",
        };
      }
    }),

  /**
   * Import a Yahoo league and generate its DNA profile.
   * Requires a pending Yahoo auth token stored in leagueConnections.
   */
  importYahooLeague: protectedProcedure
    .input(z.object({
      leagueId: z.string().min(1),
      leagueName: z.string().default(""),
      season: z.number().default(2025),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw new Error("Database unavailable");

      // Get pending auth tokens
      const rows = await database
        .select()
        .from(leagueConnections)
        .where(
          and(
            eq(leagueConnections.userId, ctx.user.id),
            eq(leagueConnections.provider, "yahoo"),
            eq(leagueConnections.leagueId, "__pending__")
          )
        )
        .limit(1);

      if (!rows.length) throw new Error("No Yahoo authorization found. Please connect Yahoo first.");

      const creds = rows[0].credentials as { accessToken: string; refreshToken: string; expiresAt: number } | null;
      if (!creds?.accessToken) throw new Error("Invalid Yahoo credentials. Please reconnect.");

      const steps: string[] = [];
      steps.push("Connecting to Yahoo Fantasy API...");

      // Build adapter with token-refresh persistence
      const adapter = new YahooAdapter(
        {
          leagueId: input.leagueId,
          accessToken: creds.accessToken,
          refreshToken: creds.refreshToken,
          expiresAt: creds.expiresAt,
        },
        async (newTokens) => {
          // Persist refreshed tokens back to the pending connection
          await database
            .update(leagueConnections)
            .set({
              credentials: {
                accessToken: newTokens.accessToken,
                refreshToken: newTokens.refreshToken,
                expiresAt: newTokens.expiresAt,
              },
            })
            .where(
              and(
                eq(leagueConnections.userId, ctx.user.id),
                eq(leagueConnections.provider, "yahoo"),
                eq(leagueConnections.leagueId, "__pending__")
              )
            );
        }
      );

      steps.push(`Fetching league data for ${input.leagueName || input.leagueId}...`);
      const league = await adapter.fetchAndNormalize(input.leagueId, input.season);
      steps.push(`Found league: ${league.settings.leagueName} (${league.teams.length} teams)`);

      steps.push("Analyzing roster compositions...");
      steps.push("Detecting behavioral patterns...");

      const txByTeam = new Map<string, number>();
      for (const tx of league.transactions) {
        txByTeam.set(tx.teamId, (txByTeam.get(tx.teamId) || 0) + 1);
      }

      const tradesByTeam = new Map<string, number>();
      for (const tx of league.transactions.filter(t => t.type === "TRADE")) {
        tradesByTeam.set(tx.teamId, (tradesByTeam.get(tx.teamId) || 0) + 1);
      }

      steps.push("Generating League DNA Profile...");
      const teamSummaries = league.teams.map(t => {
        const trades = tradesByTeam.get(t.teamId) || 0;
        const moves = txByTeam.get(t.teamId) || 0;
        return `${t.ownerName} (${t.wins}-${t.losses}, ${t.pointsFor} PF): ${trades} trades, ${moves} total moves`;
      }).join("\n");

      const dnaResponse = await invokeLLM({
        messages: [
          {
            role: "system" as const,
            content: `You are an expert fantasy football analyst. Analyze this Yahoo Fantasy league and provide a DNA profile for each manager. For each manager, identify their archetype from: Aggressive Trader, Waiver Hawk, Draft & Hold, Contrarian, Reactive, Balanced, or Data-Driven. Return JSON matching the provided schema.`,
          },
          {
            role: "user" as const,
            content: `League: ${league.settings.leagueName} (${league.settings.season} season, ${league.settings.scoringType} scoring)\nTeams and activity:\n${teamSummaries}\n\nGenerate the DNA profile.`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "league_dna",
            strict: true,
            schema: {
              type: "object",
              properties: {
                leagueName: { type: "string" },
                season: { type: "number" },
                provider: { type: "string" },
                teamProfiles: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      teamId: { type: "string" },
                      ownerName: { type: "string" },
                      archetype: { type: "string" },
                      archetypeReason: { type: "string" },
                      desperationScore: { type: "number" },
                      exploitabilityScore: { type: "number" },
                      keyTrait: { type: "string" },
                    },
                    required: ["teamId", "ownerName", "archetype", "archetypeReason", "desperationScore", "exploitabilityScore", "keyTrait"],
                    additionalProperties: false,
                  },
                },
                leagueSummary: { type: "string" },
              },
              required: ["leagueName", "season", "provider", "teamProfiles", "leagueSummary"],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent = dnaResponse.choices?.[0]?.message?.content;
      const dnaContent = typeof rawContent === "string" ? rawContent : null;
      let dnaProfile: unknown = null;
      try {
        dnaProfile = JSON.parse(dnaContent || "{}");
      } catch {
        dnaProfile = { error: "Failed to parse DNA profile" };
      }

      steps.push("League DNA Profile complete.");
      // Persist the real league connection (replace __pending__)
      // Use the adapter's current credentials (may have been refreshed)
      const adapterCreds = (adapter as unknown as { credentials: { accessToken: string; refreshToken: string; expiresAt: number } }).credentials;
      const encryptedYahooCreds = encryptCredentialsForDb(adapterCreds as unknown as Record<string, unknown>);
      await database
        .insert(leagueConnections)
        .values({
          userId: ctx.user.id,
          provider: "yahoo",
          leagueId: input.leagueId,
          leagueName: league.settings.leagueName,
          season: input.season,
          isActive: true,
          credentials: encryptedYahooCreds,
          syncStatus: "ok",
          dnaProfile,
        })
        .onDuplicateKeyUpdate({
          set: {
            leagueName: league.settings.leagueName,
            isActive: true,
            credentials: encryptedYahooCreds,
            syncStatus: "ok",
            dnaProfile,
            lastSyncedAt: new Date(),
          },
        });
      return {
        success: true,
        steps,
        league: {
          leagueId: input.leagueId,
          leagueName: league.settings.leagueName,
          season: league.settings.season,
          teamCount: league.teams.length,
          scoringType: league.settings.scoringType,
          currentWeek: league.settings.currentWeek,
          provider: "yahoo" as const,
        },
        teams: league.teams,
        matchupCount: league.matchups.length,
        transactionCount: league.transactions.length,
        dnaProfile,
      };
    }),

  // ─── ESPN import ────────────────────────────────────────────────────────────────────────────────
  /**
   * Validate and import an ESPN league using per-user SWID + espn_s2 cookies.
   * Stores credentials in league_connections.credentials (JSON) so all subsequent
   * ESPN fetches for this user use their own cookies instead of the global env vars.
   */
  /**
   * Preview an ESPN league before connecting — fetches the real league name and team count.
   * Used by the LeagueConnect form to show a confirmation card before the user clicks Connect.
   */
  previewEspnLeague: protectedProcedure
    .input(z.object({
      leagueId: z.string().min(1),
      swid: z.string().optional(),
      espnS2: z.string().optional(),
      season: z.number().default(2025),
    }))
    .query(async ({ input }) => {
      try {
        // Use provided cookies or fall back to server-side env vars
        const creds: EspnCreds = {
          leagueId: input.leagueId,
          swid: input.swid || process.env.ESPN_SWID || "",
          espnS2: input.espnS2 || process.env.ESPN_S2 || "",
        };
        const result = await fetchEspnViewsHardened(input.season, ["mSettings", "mTeam"], creds);
        if (result.authError) {
          return { valid: false, error: "ESPN auth failed — league may be private or credentials expired." };
        }
        const rawSettings = normalizeSettings(result.merged);
        const rawTeams = normalizeTeams(result.merged);
        const leagueName = (rawSettings.leagueName as string) || `ESPN League ${input.leagueId}`;
        const teamCount = rawTeams.length;
        return { valid: true, leagueName, teamCount };
      } catch (err) {
        return {
          valid: false,
          error: err instanceof Error ? err.message : "Could not reach ESPN — check your credentials.",
        };
      }
    }),

  importEspnLeague: protectedProcedure
    .input(z.object({
      leagueId: z.string().min(1, "League ID is required"),
      swid: z.string().optional(),
      espnS2: z.string().optional(),
      season: z.number().default(2025),
    }))
    .mutation(async ({ input, ctx }) => {
      const steps: string[] = [];
      steps.push("Validating ESPN league...");

      // Use provided cookies or fall back to server-side env vars
      const creds: EspnCreds = {
        leagueId: input.leagueId,
        swid: input.swid || process.env.ESPN_SWID || "",
        espnS2: input.espnS2 || process.env.ESPN_S2 || "",
      };

      // Validate by fetching mSettings + mTeam
      let fetchResult;
      try {
        fetchResult = await fetchEspnViewsHardened(input.season, ["mSettings", "mTeam"], creds);
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? `ESPN fetch failed: ${err.message}`
            : "Could not reach ESPN — league may be private or credentials expired."
        );
      }

      if (fetchResult.authError) {
        throw new Error("ESPN auth error — this league may be private. The Chrome extension can provide credentials automatically.");
      }

      const rawSettings = normalizeSettings(fetchResult.merged);
      const rawTeams = normalizeTeams(fetchResult.merged);
      const leagueName = (rawSettings.leagueName as string) || `ESPN League ${input.leagueId}`;
      const teamCount = rawTeams.length;

      steps.push(`Connected to "${leagueName}" (${teamCount} teams, ${input.season} season)`);
      steps.push("Saving credentials...");

      // Persist to league_connections (credentials encrypted at rest)
      const db = await getDb();
      if (db) {
        const encryptedCreds = encryptCredentialsForDb({
          leagueId: input.leagueId,
          swid: input.swid,
          espnS2: input.espnS2,
        });
        await db.insert(leagueConnections)
          .values({
            userId: ctx.user.id,
            provider: "espn",
            leagueId: input.leagueId,
            leagueName,
            season: input.season,
            isActive: true,
            credentials: encryptedCreds,
            syncStatus: "ok",
          })
          .onDuplicateKeyUpdate({
            set: {
              leagueName,
              isActive: true,
              credentials: encryptedCreds,
              syncStatus: "ok",
              syncError: null,
              updatedAt: new Date(),
            },
          });
      }

      steps.push("ESPN league connected successfully.");

      // Activate 7-day trial if user is still on 'free' plan
      if (db) {
        const [userRow] = await db
          .select({ subscriptionStatus: users.subscriptionStatus, trialStartedAt: users.trialStartedAt })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1);
        if (userRow && userRow.subscriptionStatus === 'free' && !userRow.trialStartedAt) {
          await db
            .update(users)
            .set({ subscriptionStatus: 'trialing', trialStartedAt: new Date() })
            .where(eq(users.id, ctx.user.id));
          steps.push("7-day free trial activated.");
        }
      }

      return {
        success: true,
        steps,
        league: {
          leagueId: input.leagueId,
          leagueName,
          season: input.season,
          teamCount,
          provider: "espn" as const,
        },
      };
    }),
});
