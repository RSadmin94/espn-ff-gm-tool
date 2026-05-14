import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { onboardingState } from "../drizzle/schema";
import { recordFunnelEvent } from "./funnelService";
import { buildManagerRawData } from "./dnaRouter";
import { calcLeagueDNA, type ManagerDNA, type ManagerRawData } from "./leagueDNA";

type RevealProfile = {
  memberId: string;
  ownerName: string;
  gmArchetype: string;
  dnaSummary: string;
  championshipCount: number;
  mostRecentTitle: number | null;
  exploitWindows: string[];
  lossTradeRatio: number;
  h2hRecord: {
    wins: number;
    losses: number;
  };
  exploitabilityLabel: ManagerDNA["exploitabilityLabel"];
};

type ProfileStage = 0 | 1 | 2 | 3;

const PROFILE_VIEW_EVENTS = {
  0: "viewed_self_profile",
  1: "viewed_champion_profile",
  2: "viewed_rival_profile",
  3: "viewed_locked_profiles",
} as const;

function clampProfile(profile: number): ProfileStage {
  return Math.max(0, Math.min(3, profile)) as ProfileStage;
}

function normalizeName(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getChampionshipMeta(manager: ManagerRawData) {
  const titleSeasons = manager.seasonRecords
    .filter((record) => record.isChampion || record.rank === 1)
    .map((record) => record.season)
    .sort((a, b) => b - a);

  return {
    championshipCount: titleSeasons.length,
    mostRecentTitle: titleSeasons[0] ?? null,
  };
}

function toRevealProfile(dna: ManagerDNA, rawManagersById: Map<string, ManagerRawData>): RevealProfile {
  const raw = rawManagersById.get(dna.memberId);
  const championships = raw
    ? getChampionshipMeta(raw)
    : { championshipCount: 0, mostRecentTitle: null };

  return {
    memberId: dna.memberId,
    ownerName: dna.ownerName,
    gmArchetype: dna.gmArchetype,
    dnaSummary: dna.dnaSummary,
    championshipCount: championships.championshipCount,
    mostRecentTitle: championships.mostRecentTitle,
    exploitWindows: dna.exploitWindows,
    lossTradeRatio: dna.trade.lossTradeRatio,
    h2hRecord: {
      wins: dna.trade.h2hVsRod.losses,
      losses: dna.trade.h2hVsRod.wins,
    },
    exploitabilityLabel: dna.exploitabilityLabel,
  };
}

function findSelfProfile(profiles: RevealProfile[], userName: string | null | undefined) {
  const normalizedUserName = normalizeName(userName);

  if (normalizedUserName) {
    const userNameMatch = profiles.find((profile) => {
      const ownerName = normalizeName(profile.ownerName);
      return ownerName.includes(normalizedUserName) || normalizedUserName.includes(ownerName);
    });
    if (userNameMatch) return userNameMatch;
  }

  return (
    profiles.find((profile) => normalizeName(profile.ownerName).includes("rod sellers")) ??
    profiles.find((profile) => normalizeName(profile.ownerName).includes("rod")) ??
    profiles[0]
  );
}

function findChampionProfile(profiles: RevealProfile[], selfMemberId: string) {
  const candidates = profiles.filter((profile) => profile.memberId !== selfMemberId);
  return [...candidates].sort((a, b) => {
    const titleDelta = (b.mostRecentTitle ?? 0) - (a.mostRecentTitle ?? 0);
    if (titleDelta !== 0) return titleDelta;
    const countDelta = b.championshipCount - a.championshipCount;
    if (countDelta !== 0) return countDelta;
    return b.h2hRecord.losses - a.h2hRecord.losses;
  })[0] ?? profiles.find((profile) => profile.memberId !== selfMemberId) ?? profiles[0];
}

function findRivalProfile(profiles: RevealProfile[], selfMemberId: string, championMemberId: string) {
  const candidates = profiles.filter(
    (profile) => profile.memberId !== selfMemberId && profile.memberId !== championMemberId
  );
  const fallbackCandidates = profiles.filter((profile) => profile.memberId !== selfMemberId);

  return [...(candidates.length > 0 ? candidates : fallbackCandidates)].sort((a, b) => {
    const lossDelta = b.h2hRecord.losses - a.h2hRecord.losses;
    if (lossDelta !== 0) return lossDelta;
    return profileExploitabilityRank(b) - profileExploitabilityRank(a);
  })[0] ?? profiles[0];
}

function profileExploitabilityRank(profile: RevealProfile) {
  const ranks: Record<RevealProfile["exploitabilityLabel"], number> = {
    "Highly Exploitable": 4,
    "Moderately Exploitable": 3,
    "Market-Aware": 2,
    Shark: 1,
  };
  return ranks[profile.exploitabilityLabel];
}

async function getExistingState(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }

  const [state] = await db
    .select()
    .from(onboardingState)
    .where(eq(onboardingState.userId, userId))
    .limit(1);

  return { db, state };
}

async function getOrCreateState(userId: number) {
  const { db, state } = await getExistingState(userId);
  if (state) return { db, state };

  await db.insert(onboardingState).values({
    userId,
    currentProfile: 0,
  });

  await recordFunnelEvent({ userId, event: PROFILE_VIEW_EVENTS[0], metadata: { currentProfile: 0 } });

  const [created] = await db
    .select()
    .from(onboardingState)
    .where(eq(onboardingState.userId, userId))
    .limit(1);

  if (!created) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create onboarding state" });
  }

  return { db, state: created };
}

export const onboardingRouter = router({
  getState: protectedProcedure.query(async ({ ctx }) => {
    const { state } = await getOrCreateState(ctx.user.id);
    return {
      ...state,
      currentProfile: clampProfile(state.currentProfile),
    };
  }),

  advanceProfile: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const { db, state } = await getOrCreateState(userId);
    const currentProfile = clampProfile(state.currentProfile);
    const nextProfile = clampProfile(currentProfile + 1);

    if (nextProfile === currentProfile) {
      return state;
    }

    const completedAt = nextProfile === 3 ? state.completedAt ?? new Date() : state.completedAt;
    await db
      .update(onboardingState)
      .set({
        currentProfile: nextProfile,
        completedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(onboardingState.id, state.id), eq(onboardingState.userId, userId)));

    await recordFunnelEvent({
      userId,
      event: PROFILE_VIEW_EVENTS[nextProfile],
      metadata: { currentProfile: nextProfile },
    });

    if (nextProfile === 3) {
      await recordFunnelEvent({ userId, event: "completed_reveal", metadata: { currentProfile: nextProfile } });
    }

    const [updated] = await db
      .select()
      .from(onboardingState)
      .where(eq(onboardingState.userId, userId))
      .limit(1);

    return updated ?? { ...state, currentProfile: nextProfile, completedAt };
  }),

  completeReveal: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const { db, state } = await getOrCreateState(userId);

    if (clampProfile(state.currentProfile) === 3 && state.completedAt) {
      return state;
    }

    const completedAt = state.completedAt ?? new Date();
    await db
      .update(onboardingState)
      .set({
        currentProfile: 3,
        completedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(onboardingState.id, state.id), eq(onboardingState.userId, userId)));

    await recordFunnelEvent({ userId, event: "viewed_locked_profiles", metadata: { currentProfile: 3 } });
    await recordFunnelEvent({ userId, event: "completed_reveal", metadata: { currentProfile: 3 } });

    const [updated] = await db
      .select()
      .from(onboardingState)
      .where(eq(onboardingState.userId, userId))
      .limit(1);

    return updated ?? { ...state, currentProfile: 3, completedAt };
  }),

  getRevealData: protectedProcedure.query(async ({ ctx }) => {
    const rawManagers = await buildManagerRawData();
    const dnaProfiles = calcLeagueDNA(rawManagers);

    if (dnaProfiles.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No league DNA profiles are available yet." });
    }

    const rawManagersById = new Map(rawManagers.map((manager) => [manager.memberId, manager]));
    const allProfiles = dnaProfiles.map((profile) => toRevealProfile(profile, rawManagersById));
    const self = findSelfProfile(allProfiles, ctx.user.name);
    const champion = findChampionProfile(allProfiles, self.memberId);
    const rival = findRivalProfile(allProfiles, self.memberId, champion.memberId);

    return {
      self,
      champion,
      rival,
      allProfiles,
    };
  }),
});
