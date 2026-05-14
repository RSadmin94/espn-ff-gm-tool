import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { resetRateLimiter } from "./rateLimiter";

// Mock the LLM and DB helpers to avoid real API calls in tests
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "Mock AI response: Start Ja'Marr Chase." } }],
  }),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getChatHistory: vi.fn().mockResolvedValue([]),
    addChatMessage: vi.fn().mockResolvedValue(undefined),
    clearChatHistory: vi.fn().mockResolvedValue(undefined),
    getCachedView: vi.fn().mockResolvedValue(null),
    upsertCachedView: vi.fn().mockResolvedValue(undefined),
    getRefreshManifests: vi.fn().mockResolvedValue([]),
    upsertRefreshManifest: vi.fn().mockResolvedValue(undefined),
    getAllCachedSeasons: vi.fn().mockResolvedValue([]),
  };
});

function createAuthContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "rod@example.com",
      name: "Rod Sellers",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      activeLeagueId: 0,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionStatus: "active",
      trialStartedAt: null,
      currentPeriodEnd: null,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("advisor.chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiter(); // clear per-user cooldowns between tests
  });

  it("returns an AI message for a valid input", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.advisor.chat({ message: "Who should I start this week?", season: 2025 });
    expect(result).toHaveProperty("message");
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("defaults to season 2025 when season is omitted", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.advisor.chat({ message: "Give me a keeper recommendation." });
    expect(result).toHaveProperty("message");
    expect(typeof result.message).toBe("string");
  });

  it("rejects empty messages", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.advisor.chat({ message: "", season: 2025 })).rejects.toThrow();
  });

  it("rejects unauthenticated callers", async () => {
    const anonCtx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(anonCtx);
    await expect(caller.advisor.chat({ message: "Who should I start?", season: 2025 })).rejects.toThrow();
  });
});

describe("advisor.history", () => {
  it("returns empty array when no history exists", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.advisor.history({ season: 2025 });
    expect(Array.isArray(result)).toBe(true);
  });
});
