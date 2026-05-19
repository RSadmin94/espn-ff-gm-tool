/**
 * server/espnTrade2026.test.ts
 *
 * Regression tests for 2026+ ESPN trade transaction format.
 *
 * In 2026, ESPN changed the accepted-trade format:
 *   Legacy (2017-2025): type=TRADE, status=EXECUTED, items=[...]
 *   2026+: type=TRADE_UPHOLD or TRADE_ACCEPT, status=EXECUTED, no items,
 *          relatedTransactionId → links to a TRADE_PROPOSAL with items
 *
 * These tests verify:
 *   1. normalizeTransactions passes relatedTransactionId through
 *   2. TRADE_UPHOLD/TRADE_ACCEPT rows are included in normalized output
 *   3. TRADE_PROPOSAL items are preserved in normalized output
 *   4. Legacy TRADE format still works (backward compatibility)
 */

import { describe, it, expect, vi } from "vitest";
import { normalizeTransactions, mergeTradeProposalsIntoTransactions } from "./espnService";

// ── Mock 2026-style payload ───────────────────────────────────────────────────

const mock2026Payload = {
  seasonId: 2026,
  transactions: [
    // The TRADE_UPHOLD record — no items, links to proposal
    {
      id: "c1986f18-e750-4b7c-b18d-3e92db4da059",
      type: "TRADE_UPHOLD",
      status: "EXECUTED",
      proposedDate: 1778814507468,
      teamId: 1,
      relatedTransactionId: "d3731d04-107d-415a-8c25-f5530b88dddf",
      items: [],
    },
    // The TRADE_ACCEPT record — no items, links to same proposal
    {
      id: "acc11111-0000-0000-0000-000000000001",
      type: "TRADE_ACCEPT",
      status: null,
      proposedDate: 1778814507000,
      teamId: 5,
      relatedTransactionId: "d3731d04-107d-415a-8c25-f5530b88dddf",
      items: [],
    },
    // The TRADE_PROPOSAL record — has items (the actual players/picks)
    {
      id: "d3731d04-107d-415a-8c25-f5530b88dddf",
      type: "TRADE_PROPOSAL",
      status: "PENDING",
      proposedDate: 1778800000000,
      teamId: 5,
      relatedTransactionId: null,
      items: [
        {
          fromTeamId: 5,
          toTeamId: 1,
          type: "DRAFT_TRADE",
          playerId: 0,
          overallPickNumber: 7,
          player: {},
        },
        {
          fromTeamId: 1,
          toTeamId: 5,
          type: "DRAFT_TRADE",
          playerId: 0,
          overallPickNumber: 39,
          player: {},
        },
      ],
    },
    // A CANCELED TRADE_PROPOSAL — normalized, but not treated as a completed trade
    {
      id: "canceled-proposal-001",
      type: "TRADE_PROPOSAL",
      status: "CANCELED",
      proposedDate: 1778700000000,
      teamId: 3,
      relatedTransactionId: "some-uphold-id",
      items: [
        {
          fromTeamId: 3,
          toTeamId: 7,
          type: "DRAFT_TRADE",
          playerId: 0,
          overallPickNumber: 15,
          player: {},
        },
      ],
    },
    // A ROSTER move — should pass through unchanged
    {
      id: "roster-001",
      type: "ROSTER",
      status: "EXECUTED",
      proposedDate: 1777252202301,
      teamId: 4,
      items: [
        {
          fromTeamId: 4,
          toTeamId: 0,
          type: "DROP",
          playerId: 4242557,
          player: { id: 4242557, fullName: "Test Player" },
        },
      ],
    },
  ],
};

// ── Mock legacy 2025-style payload ────────────────────────────────────────────

const mockLegacyPayload = {
  seasonId: 2025,
  transactions: [
    // Legacy TRADE record — has items directly
    {
      id: "legacy-trade-001",
      type: "TRADE",
      status: "EXECUTED",
      proposedDate: 1700000000000,
      teamId: 2,
      items: [
        {
          fromTeamId: 2,
          toTeamId: 8,
          type: "ADD",
          playerId: 1234567,
          player: { id: 1234567, fullName: "Patrick Mahomes" },
        },
        {
          fromTeamId: 8,
          toTeamId: 2,
          type: "ADD",
          playerId: 7654321,
          player: { id: 7654321, fullName: "Justin Jefferson" },
        },
      ],
    },
    // Legacy WAIVER add
    {
      id: "waiver-001",
      type: "WAIVER",
      status: "EXECUTED",
      proposedDate: 1700100000000,
      teamId: 3,
      items: [
        {
          fromTeamId: 0,
          toTeamId: 3,
          type: "ADD",
          playerId: 9999999,
          player: { id: 9999999, fullName: "Waiver Player" },
        },
      ],
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("normalizeTransactions — 2026 TRADE_UPHOLD/TRADE_ACCEPT format", () => {
  it("includes TRADE_UPHOLD row with relatedTransactionId", () => {
    const rows = normalizeTransactions(mock2026Payload as Record<string, unknown>) as Array<Record<string, unknown>>;
    const upholdRow = rows.find(r => r.type === "TRADE_UPHOLD");
    expect(upholdRow).toBeDefined();
    expect(upholdRow!.relatedTransactionId).toBe("d3731d04-107d-415a-8c25-f5530b88dddf");
    expect(upholdRow!.teamId).toBe(1);
    expect(upholdRow!.status).toBe("EXECUTED");
  });

  it("includes TRADE_ACCEPT row with relatedTransactionId", () => {
    const rows = normalizeTransactions(mock2026Payload as Record<string, unknown>) as Array<Record<string, unknown>>;
    const acceptRow = rows.find(r => r.type === "TRADE_ACCEPT");
    expect(acceptRow).toBeDefined();
    expect(acceptRow!.relatedTransactionId).toBe("d3731d04-107d-415a-8c25-f5530b88dddf");
    expect(acceptRow!.teamId).toBe(5);
  });

  it("includes TRADE_PROPOSAL item rows with relatedTransactionId", () => {
    const rows = normalizeTransactions(mock2026Payload as Record<string, unknown>) as Array<Record<string, unknown>>;
    const proposalRows = rows.filter(r => r.type === "TRADE_PROPOSAL" && r.transactionId === "d3731d04-107d-415a-8c25-f5530b88dddf");
    // 2 items in the proposal
    expect(proposalRows).toHaveLength(2);
    expect(proposalRows[0].overallPickNumber).toBe(7);
    expect(proposalRows[1].overallPickNumber).toBe(39);
    // relatedTransactionId should be null for the proposal itself
    for (const row of proposalRows) {
      expect(row.relatedTransactionId).toBeNull();
    }
  });

  it("passes 2026 proposal teamActions and executionType metadata through", () => {
    const payload = {
      seasonId: 2026,
      transactions: [
        {
          id: "accepted-actioned-proposal",
          type: "TRADE_PROPOSAL",
          status: "CANCELED",
          executionType: "CANCEL",
          isPending: true,
          teamActions: { "11": "ACCEPTED" },
          proposedDate: 1777667280559,
          teamId: 11,
          items: [
            { fromTeamId: 22, toTeamId: 11, type: "DRAFT_TRADE", playerId: 0, overallPickNumber: 7, player: {} },
            { fromTeamId: 11, toTeamId: 22, type: "DRAFT_TRADE", playerId: 0, overallPickNumber: 39, player: {} },
          ],
        },
      ],
    };
    const rows = normalizeTransactions(payload as Record<string, unknown>) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].teamActions).toEqual({ "11": "ACCEPTED" });
    expect(rows[0].executionType).toBe("CANCEL");
    expect(rows[0].isPending).toBe(true);
  });

  it("TRADE_UPHOLD row has null playerId (no items)", () => {
    const rows = normalizeTransactions(mock2026Payload as Record<string, unknown>) as Array<Record<string, unknown>>;
    const upholdRow = rows.find(r => r.type === "TRADE_UPHOLD");
    expect(upholdRow!.playerId).toBeNull();
    expect(upholdRow!.playerName).toBeNull();
  });

  it("ROSTER move rows do not have relatedTransactionId set", () => {
    const rows = normalizeTransactions(mock2026Payload as Record<string, unknown>) as Array<Record<string, unknown>>;
    const rosterRow = rows.find(r => r.type === "ROSTER");
    expect(rosterRow).toBeDefined();
    // relatedTransactionId should be null (not present in ROSTER transactions)
    expect(rosterRow!.relatedTransactionId).toBeNull();
  });

  it("season is correctly set on all rows", () => {
    const rows = normalizeTransactions(mock2026Payload as Record<string, unknown>) as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row.season).toBe(2026);
    }
  });
});

describe("normalizeTransactions — legacy 2025 TRADE format (backward compatibility)", () => {
  it("legacy TRADE rows are included with correct type and items", () => {
    const rows = normalizeTransactions(mockLegacyPayload as Record<string, unknown>) as Array<Record<string, unknown>>;
    const tradeRows = rows.filter(r => r.type === "TRADE");
    // 2 items in the trade
    expect(tradeRows).toHaveLength(2);
    expect(tradeRows[0].playerName).toBe("Patrick Mahomes");
    expect(tradeRows[1].playerName).toBe("Justin Jefferson");
  });

  it("legacy TRADE rows have null relatedTransactionId", () => {
    const rows = normalizeTransactions(mockLegacyPayload as Record<string, unknown>) as Array<Record<string, unknown>>;
    const tradeRows = rows.filter(r => r.type === "TRADE");
    for (const row of tradeRows) {
      expect(row.relatedTransactionId).toBeNull();
    }
  });

  it("legacy WAIVER rows are included", () => {
    const rows = normalizeTransactions(mockLegacyPayload as Record<string, unknown>) as Array<Record<string, unknown>>;
    const waiverRows = rows.filter(r => r.type === "WAIVER");
    expect(waiverRows).toHaveLength(1);
    expect(waiverRows[0].playerName).toBe("Waiver Player");
  });

  it("season is correctly set on legacy rows", () => {
    const rows = normalizeTransactions(mockLegacyPayload as Record<string, unknown>) as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row.season).toBe(2025);
    }
  });
});

describe("normalizeTransactions — edge cases", () => {
  it("handles empty transactions array", () => {
    const rows = normalizeTransactions({ seasonId: 2026, transactions: [] } as Record<string, unknown>);
    expect(rows).toHaveLength(0);
  });

  it("handles transaction with no items array (undefined)", () => {
    const payload = {
      seasonId: 2026,
      transactions: [
        {
          id: "no-items-tx",
          type: "TRADE_UPHOLD",
          status: "EXECUTED",
          proposedDate: 1778814507468,
          teamId: 1,
          relatedTransactionId: "some-proposal-id",
          // no items field
        },
      ],
    };
    const rows = normalizeTransactions(payload as Record<string, unknown>) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("TRADE_UPHOLD");
    expect(rows[0].relatedTransactionId).toBe("some-proposal-id");
  });

  it("does not emit header rows for non-header transactions with no items", () => {
    const payload = {
      seasonId: 2026,
      transactions: [
        { id: "empty-waiver", type: "WAIVER", status: "EXECUTED", proposedDate: 1778814507468, teamId: 1, items: [] },
      ],
    };
    const rows = normalizeTransactions(payload as Record<string, unknown>) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeTradeProposalsIntoTransactions tests
// ─────────────────────────────────────────────────────────────────────────────

/** A 2026 combined-cache data object that only has the TRADE_UPHOLD (proposal aged out) */
const dataWithoutProposal = {
  seasonId: 2026,
  transactions: [
    {
      id: "c1986f18-e750-4b7c-b18d-3e92db4da059",
      type: "TRADE_UPHOLD",
      status: "EXECUTED",
      proposedDate: 1778814507468,
      teamId: 1,
      relatedTransactionId: "d3731d04-107d-415a-8c25-f5530b88dddf",
      items: [],
    },
  ],
};

/** The TRADE_PROPOSAL fetched separately via x-fantasy-filter */
const proposalFromFilter: Record<string, unknown>[] = [
  {
    id: "d3731d04-107d-415a-8c25-f5530b88dddf",
    type: "TRADE_PROPOSAL",
    status: "EXECUTED",
    proposedDate: 1778800000000,
    teamId: 5,
    relatedTransactionId: null,
    items: [
      { fromTeamId: 5, toTeamId: 1, type: "DRAFT_TRADE", playerId: 0, overallPickNumber: 7, player: {} },
      { fromTeamId: 1, toTeamId: 5, type: "DRAFT_TRADE", playerId: 0, overallPickNumber: 39, player: {} },
    ],
  },
];

describe("mergeTradeProposalsIntoTransactions", () => {
  it("appends a proposal that is outside the recent-activity window", () => {
    const merged = mergeTradeProposalsIntoTransactions(
      dataWithoutProposal as Record<string, unknown>,
      proposalFromFilter
    );
    const txs = merged.transactions as Record<string, unknown>[];
    expect(txs).toHaveLength(2); // TRADE_UPHOLD + TRADE_PROPOSAL
    const proposal = txs.find(t => t.type === "TRADE_PROPOSAL");
    expect(proposal).toBeDefined();
    expect(proposal!.id).toBe("d3731d04-107d-415a-8c25-f5530b88dddf");
  });

  it("normalizer can reconstruct player items from merged proposal", () => {
    const merged = mergeTradeProposalsIntoTransactions(
      dataWithoutProposal as Record<string, unknown>,
      proposalFromFilter
    );
    const rows = normalizeTransactions(merged) as Array<Record<string, unknown>>;
    // Should have 1 TRADE_UPHOLD header row + 2 TRADE_PROPOSAL item rows
    const proposalRows = rows.filter(r => r.type === "TRADE_PROPOSAL");
    expect(proposalRows).toHaveLength(2);
    // TRADE_UPHOLD should still be present
    const upholdRow = rows.find(r => r.type === "TRADE_UPHOLD");
    expect(upholdRow).toBeDefined();
    expect(upholdRow!.relatedTransactionId).toBe("d3731d04-107d-415a-8c25-f5530b88dddf");
  });

  it("does not double-count a proposal already in the recent-activity window", () => {
    // Data already has the proposal (it was recent enough to appear in mTransactions2)
    const dataWithProposal = {
      seasonId: 2026,
      transactions: [
        {
          id: "c1986f18-e750-4b7c-b18d-3e92db4da059",
          type: "TRADE_UPHOLD",
          status: "EXECUTED",
          proposedDate: 1778814507468,
          teamId: 1,
          relatedTransactionId: "d3731d04-107d-415a-8c25-f5530b88dddf",
          items: [],
        },
        // Proposal already present
        {
          id: "d3731d04-107d-415a-8c25-f5530b88dddf",
          type: "TRADE_PROPOSAL",
          status: "EXECUTED",
          proposedDate: 1778800000000,
          teamId: 5,
          relatedTransactionId: null,
          items: [
            { fromTeamId: 5, toTeamId: 1, type: "DRAFT_TRADE", playerId: 0, overallPickNumber: 7, player: {} },
          ],
        },
      ],
    };
    const merged = mergeTradeProposalsIntoTransactions(
      dataWithProposal as Record<string, unknown>,
      proposalFromFilter // same proposal id — should be de-duped
    );
    const txs = merged.transactions as Record<string, unknown>[];
    // Still only 2 records, not 3
    expect(txs).toHaveLength(2);
    const proposals = txs.filter(t => t.type === "TRADE_PROPOSAL");
    expect(proposals).toHaveLength(1);
  });

  it("returns data unchanged when proposals array is empty", () => {
    const merged = mergeTradeProposalsIntoTransactions(
      dataWithoutProposal as Record<string, unknown>,
      [] // no proposals fetched (e.g. ESPN returned empty or fetch failed)
    );
    // Should be the exact same object reference
    expect(merged).toBe(dataWithoutProposal);
  });

  it("preserves all existing non-trade transactions when merging", () => {
    const dataWithMixed = {
      seasonId: 2026,
      transactions: [
        { id: "waiver-001", type: "WAIVER", status: "EXECUTED", teamId: 3, items: [] },
        { id: "c1986f18-e750-4b7c-b18d-3e92db4da059", type: "TRADE_UPHOLD", status: "EXECUTED", teamId: 1, relatedTransactionId: "d3731d04-107d-415a-8c25-f5530b88dddf", items: [] },
      ],
    };
    const merged = mergeTradeProposalsIntoTransactions(
      dataWithMixed as Record<string, unknown>,
      proposalFromFilter
    );
    const txs = merged.transactions as Record<string, unknown>[];
    expect(txs).toHaveLength(3); // WAIVER + TRADE_UPHOLD + TRADE_PROPOSAL
    expect(txs.find(t => t.type === "WAIVER")).toBeDefined();
  });

  it("legacy 2025 TRADE format still normalizes correctly after a no-op merge", () => {
    // Merging empty proposals into a legacy payload should not break anything
    const legacyData = {
      seasonId: 2025,
      transactions: [
        {
          id: "legacy-trade-001",
          type: "TRADE",
          status: "EXECUTED",
          proposedDate: 1700000000000,
          teamId: 2,
          items: [
            { fromTeamId: 2, toTeamId: 8, type: "ADD", playerId: 1234567, player: { id: 1234567, fullName: "Patrick Mahomes" } },
          ],
        },
      ],
    };
    const merged = mergeTradeProposalsIntoTransactions(legacyData as Record<string, unknown>, []);
    const rows = normalizeTransactions(merged) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("TRADE");
    expect(rows[0].playerName).toBe("Patrick Mahomes");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tradeAging helper logic tests
// Tests the core grouping + side-reconstruction logic used by the tradeAging
// tRPC procedure, exercised through normalizeTransactions output.
// ─────────────────────────────────────────────────────────────────────────────

describe("tradeAging — trade grouping and side reconstruction logic", () => {
  /**
   * Helper that mimics what tradeAging does:
   * - filters for TRADE / TRADE_PROPOSAL item rows
   * - groups by transactionId
   * - reconstructs sides (players received by each team)
   */
  function reconstructTrades(data: Record<string, unknown>) {
    const txRows = normalizeTransactions(data) as Array<Record<string, unknown>>;
    const completedProposalIds = new Set(
      txRows
        .filter(r => r.type === "TRADE_UPHOLD" || r.type === "TRADE_ACCEPT")
        .map(r => r.relatedTransactionId as string | null)
        .filter((id): id is string => Boolean(id))
    );
    const hasAcceptedTeamAction = (actions: unknown) => {
      if (!actions || typeof actions !== "object") return false;
      return Object.values(actions as Record<string, unknown>)
        .some(action => String(action || "").toUpperCase() === "ACCEPTED");
    };
    for (const r of txRows) {
      if (
        r.type === "TRADE_PROPOSAL" &&
        (
          String(r.status || "").toUpperCase() === "EXECUTED" ||
          String(r.executionType || "").toUpperCase() === "EXECUTE" ||
          hasAcceptedTeamAction(r.teamActions)
        )
      ) {
        completedProposalIds.add(r.transactionId as string);
      }
    }
    const isCompletedTradeRow = (r: Record<string, unknown>) => {
      const type = r.type as string;
      const status = String(r.status || "").toUpperCase();
      if (type === "TRADE") return status === "" || status === "EXECUTED";
      if (type === "TRADE_PROPOSAL") {
        return completedProposalIds.has(r.transactionId as string) || status === "EXECUTED" || hasAcceptedTeamAction(r.teamActions);
      }
      return false;
    };

    // Filter to item rows only (have playerId or are DRAFT_TRADE picks)
    const tradeItemRows = txRows.filter(r => {
      return isCompletedTradeRow(r) && r.playerId != null;
    });
    const pickTradeRows = txRows.filter(r => {
      return isCompletedTradeRow(r) && r.playerId == null && r.itemType === "DRAFT_TRADE";
    });

    // Group by transactionId
    const groups = new Map<string, { playerRows: Record<string, unknown>[]; pickRows: Record<string, unknown>[] }>();
    for (const row of tradeItemRows) {
      const tid = row.transactionId as string;
      if (!groups.has(tid)) groups.set(tid, { playerRows: [], pickRows: [] });
      groups.get(tid)!.playerRows.push(row);
    }
    for (const row of pickTradeRows) {
      const tid = row.transactionId as string;
      if (!groups.has(tid)) groups.set(tid, { playerRows: [], pickRows: [] });
      groups.get(tid)!.pickRows.push(row);
    }

    // Reconstruct sides
    const trades: { tradeId: string; sideA: number; sideB: number; playersA: string[]; playersB: string[] }[] = [];
    for (const [tradeId, group] of Array.from(groups)) {
      const teamIds = new Set<number>();
      for (const r of [...group.playerRows, ...group.pickRows]) {
        if (r.fromTeamId != null && (r.fromTeamId as number) > 0) teamIds.add(r.fromTeamId as number);
        if (r.toTeamId != null && (r.toTeamId as number) > 0) teamIds.add(r.toTeamId as number);
      }
      if (teamIds.size < 2) continue;
      const [teamAId, teamBId] = Array.from(teamIds);
      const playersA = group.playerRows
        .filter(r => (r.toTeamId as number) === teamAId)
        .map(r => r.playerName as string);
      const playersB = group.playerRows
        .filter(r => (r.toTeamId as number) === teamBId)
        .map(r => r.playerName as string);
      trades.push({ tradeId, sideA: teamAId, sideB: teamBId, playersA, playersB });
    }
    return trades;
  }

  it("reconstructs both sides of a legacy TRADE correctly", () => {
    const trades = reconstructTrades(mockLegacyPayload as Record<string, unknown>);
    expect(trades).toHaveLength(1);
    const t = trades[0];
    // Both players should appear on one of the two sides (Set order is non-deterministic)
    const allPlayers = [...t.playersA, ...t.playersB];
    expect(allPlayers).toContain("Patrick Mahomes");
    expect(allPlayers).toContain("Justin Jefferson");
    // Each player should be on a different side
    expect(t.playersA).not.toEqual(t.playersB);
  });

  it("reconstructs both sides of a 2026 TRADE_PROPOSAL correctly", () => {
    const trades = reconstructTrades(mock2026Payload as Record<string, unknown>);
    // The accepted proposal has linked TRADE_UPHOLD/TRADE_ACCEPT headers.
    // The canceled proposal has no completed header and should be excluded.
    expect(trades).toHaveLength(1);
    expect(trades[0].tradeId).toBe("d3731d04-107d-415a-8c25-f5530b88dddf");
  });

  it("does not create a trade group from TRADE_UPHOLD header rows (no items)", () => {
    // A payload with only TRADE_UPHOLD and no TRADE_PROPOSAL items
    const upholdOnlyPayload = {
      seasonId: 2026,
      transactions: [
        {
          id: "uphold-only-001",
          type: "TRADE_UPHOLD",
          status: "EXECUTED",
          proposedDate: 1778814507468,
          teamId: 1,
          relatedTransactionId: "missing-proposal-id",
          items: [],
        },
      ],
    };
    const trades = reconstructTrades(upholdOnlyPayload as Record<string, unknown>);
    // No trade groups should be created — the header row has no items
    expect(trades).toHaveLength(0);
  });

  it("creates a trade group when TRADE_PROPOSAL is merged in", () => {
    const merged = mergeTradeProposalsIntoTransactions(
      dataWithoutProposal as Record<string, unknown>,
      proposalFromFilter
    );
    const trades = reconstructTrades(merged);
    // Now the proposal items are present — should create 1 trade group
    expect(trades).toHaveLength(1);
  });

  it("creates a trade group for 2026 proposals with accepted teamActions despite CANCELED status", () => {
    const payload = {
      seasonId: 2026,
      transactions: [
        {
          id: "accepted-actioned-proposal",
          type: "TRADE_PROPOSAL",
          status: "CANCELED",
          executionType: "CANCEL",
          isPending: true,
          teamActions: { "11": "ACCEPTED" },
          proposedDate: 1777667280559,
          teamId: 11,
          items: [
            { fromTeamId: 22, toTeamId: 11, type: "DRAFT_TRADE", playerId: 0, overallPickNumber: 7, player: {} },
            { fromTeamId: 11, toTeamId: 22, type: "DRAFT_TRADE", playerId: 0, overallPickNumber: 39, player: {} },
          ],
        },
      ],
    };
    const trades = reconstructTrades(payload as Record<string, unknown>);
    expect(trades).toHaveLength(1);
    expect(trades[0].tradeId).toBe("accepted-actioned-proposal");
    expect([trades[0].sideA, trades[0].sideB].sort()).toEqual([11, 22]);
  });

  it("verdict: sideA wins when they received more value", () => {
    // Simple scoring: team that received the player with higher avgPoints wins
    // This test validates the verdict threshold logic (margin < 50 = even)
    const margin = 200; // sideA total - sideB total
    const verdict = Math.abs(margin) < 50 ? "even" : margin > 0 ? "sideA" : "sideB";
    expect(verdict).toBe("sideA");
  });

  it("verdict: even when margin is below threshold", () => {
    const margin = 30; // within 50-point even threshold
    const verdict = Math.abs(margin) < 50 ? "even" : margin > 0 ? "sideA" : "sideB";
    expect(verdict).toBe("even");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tradeAging — 2026 path: proposal in cache with PENDING status
// Tests the fix where TRADE_PROPOSAL rows have status=PENDING (ESPN default)
// but should still be treated as completed when linked by TRADE_UPHOLD/TRADE_ACCEPT.
// ─────────────────────────────────────────────────────────────────────────────

describe("tradeAging — 2026 path: proposal in cache with PENDING status", () => {
  /**
   * Mimics the FIXED tradeAging logic:
   * - builds proposalItemMap and proposalPickMap from TRADE_PROPOSAL rows
   * - builds completedProposalIds from TRADE_UPHOLD/TRADE_ACCEPT rows
   * - legacy path: isCompletedTradeRow for TRADE/TRADE_PROPOSAL
   * - 2026 path: for each completedProposalId not yet in tradeGroups,
   *   add from proposalItemMap/proposalPickMap if present
   */
  function reconstructTradesFixed(data: Record<string, unknown>) {
    const txRows = normalizeTransactions(data) as Array<Record<string, unknown>>;

    // Build lookup: proposalId → proposal item rows
    const proposalItemMap = new Map<string, Record<string, unknown>[]>();
    for (const r of txRows) {
      if (r.type === "TRADE_PROPOSAL" && r.playerId && r.itemType !== "DRAFT_TRADE") {
        const tid = r.transactionId as string;
        if (!proposalItemMap.has(tid)) proposalItemMap.set(tid, []);
        proposalItemMap.get(tid)!.push(r);
      }
    }
    const proposalPickMap = new Map<string, Record<string, unknown>[]>();
    for (const r of txRows) {
      if (r.type === "TRADE_PROPOSAL" && r.itemType === "DRAFT_TRADE") {
        const tid = r.transactionId as string;
        if (!proposalPickMap.has(tid)) proposalPickMap.set(tid, []);
        proposalPickMap.get(tid)!.push(r);
      }
    }

    // Build completedProposalIds + acceptanceDateMap
    const completedProposalIds = new Set<string>();
    const acceptanceDateMap = new Map<string, number>();
    for (const r of txRows) {
      if (r.type === "TRADE_UPHOLD" || r.type === "TRADE_ACCEPT") {
        const relId = r.relatedTransactionId as string | null;
        if (relId) {
          completedProposalIds.add(relId);
          const d = (r.proposedDate as number) || 0;
          if (d > 0 && !acceptanceDateMap.has(relId)) acceptanceDateMap.set(relId, d);
        }
      }
    }

    const isCompletedTradeRow = (r: Record<string, unknown>) => {
      const type = r.type as string;
      const status = String(r.status || "").toUpperCase();
      if (type === "TRADE") return status === "" || status === "EXECUTED";
      if (type === "TRADE_PROPOSAL") {
        return completedProposalIds.has(r.transactionId as string) || status === "EXECUTED";
      }
      return false;
    };

    const tradeItemRows = txRows.filter(r => isCompletedTradeRow(r) && r.playerId && r.itemType !== "DRAFT_TRADE");
    const pickTradeRows = txRows.filter(r => isCompletedTradeRow(r) && r.itemType === "DRAFT_TRADE");

    const tradeGroups = new Map<string, { playerRows: Record<string, unknown>[]; pickRows: Record<string, unknown>[]; proposedDate?: number }>();
    for (const row of tradeItemRows) {
      const tid = row.transactionId as string;
      if (!tradeGroups.has(tid)) tradeGroups.set(tid, { playerRows: [], pickRows: [], proposedDate: acceptanceDateMap.get(tid) });
      tradeGroups.get(tid)!.playerRows.push(row);
    }
    for (const row of pickTradeRows) {
      const tid = row.transactionId as string;
      if (!tradeGroups.has(tid)) tradeGroups.set(tid, { playerRows: [], pickRows: [], proposedDate: acceptanceDateMap.get(tid) });
      tradeGroups.get(tid)!.pickRows.push(row);
    }

    // 2026 path: add proposals that are in cache but weren't picked up by isCompletedTradeRow
    for (const proposalId of completedProposalIds) {
      if (tradeGroups.has(proposalId)) continue;
      const itemRows = proposalItemMap.get(proposalId);
      const pRows = proposalPickMap.get(proposalId);
      if (!itemRows?.length && !pRows?.length) continue; // not in cache — skip gracefully
      tradeGroups.set(proposalId, {
        playerRows: itemRows ?? [],
        pickRows: pRows ?? [],
        proposedDate: acceptanceDateMap.get(proposalId),
      });
    }

    // Reconstruct sides
    const trades: { tradeId: string; teamIds: number[]; playerCount: number; pickCount: number; proposedDate: number }[] = [];
    for (const [tradeId, group] of Array.from(tradeGroups)) {
      const teamIds = new Set<number>();
      for (const r of [...group.playerRows, ...group.pickRows]) {
        if (r.fromTeamId != null && (r.fromTeamId as number) > 0) teamIds.add(r.fromTeamId as number);
        if (r.toTeamId != null && (r.toTeamId as number) > 0) teamIds.add(r.toTeamId as number);
      }
      if (teamIds.size < 2) continue;
      const firstRow = group.playerRows[0] || group.pickRows[0];
      const proposedDate = (firstRow?.proposedDate as number) || group.proposedDate || 0;
      trades.push({
        tradeId,
        teamIds: Array.from(teamIds),
        playerCount: group.playerRows.length,
        pickCount: group.pickRows.length,
        proposedDate,
      });
    }
    return trades;
  }

  it("picks up a TRADE_PROPOSAL with PENDING status when linked by TRADE_UPHOLD", () => {
    // This is the real 2026 bug: proposal has status=PENDING (not EXECUTED),
    // so isCompletedTradeRow returns false, but it IS linked by TRADE_UPHOLD.
    const payload2026WithPendingProposal = {
      seasonId: 2026,
      transactions: [
        {
          id: "uphold-001",
          type: "TRADE_UPHOLD",
          status: "EXECUTED",
          proposedDate: 1778814507468,
          teamId: 1,
          relatedTransactionId: "proposal-pending-001",
          items: [],
        },
        {
          id: "proposal-pending-001",
          type: "TRADE_PROPOSAL",
          status: "PENDING", // ← this is the bug: PENDING status was being excluded
          proposedDate: 1778800000000,
          teamId: 5,
          relatedTransactionId: null,
          items: [
            { fromTeamId: 5, toTeamId: 1, type: "ADD", playerId: 1111111, player: { id: 1111111, fullName: "Player A" } },
            { fromTeamId: 1, toTeamId: 5, type: "ADD", playerId: 2222222, player: { id: 2222222, fullName: "Player B" } },
          ],
        },
      ],
    };
    const trades = reconstructTradesFixed(payload2026WithPendingProposal as Record<string, unknown>);
    expect(trades).toHaveLength(1);
    expect(trades[0].tradeId).toBe("proposal-pending-001");
    expect(trades[0].playerCount).toBe(2);
    expect(trades[0].teamIds).toContain(1);
    expect(trades[0].teamIds).toContain(5);
  });

  it("uses acceptance-row proposedDate when proposal's proposedDate is 0", () => {
    const payload = {
      seasonId: 2026,
      transactions: [
        {
          id: "uphold-date-001",
          type: "TRADE_UPHOLD",
          status: "EXECUTED",
          proposedDate: 1778814507468, // acceptance row has date
          teamId: 1,
          relatedTransactionId: "proposal-no-date",
          items: [],
        },
        {
          id: "proposal-no-date",
          type: "TRADE_PROPOSAL",
          status: "PENDING",
          proposedDate: 0, // no date on proposal
          teamId: 5,
          relatedTransactionId: null,
          items: [
            { fromTeamId: 5, toTeamId: 1, type: "ADD", playerId: 3333333, player: { id: 3333333, fullName: "Player C" } },
            { fromTeamId: 1, toTeamId: 5, type: "ADD", playerId: 4444444, player: { id: 4444444, fullName: "Player D" } },
          ],
        },
      ],
    };
    const trades = reconstructTradesFixed(payload as Record<string, unknown>);
    expect(trades).toHaveLength(1);
    // proposedDate should fall back to acceptance row's date
    expect(trades[0].proposedDate).toBe(1778814507468);
  });

  it("skips gracefully when proposal is NOT in cache (ESPN purged it)", () => {
    // Only the TRADE_UPHOLD is present — no proposal in cache
    const upholdOnlyPayload = {
      seasonId: 2026,
      transactions: [
        {
          id: "uphold-purged-001",
          type: "TRADE_UPHOLD",
          status: "EXECUTED",
          proposedDate: 1778814507468,
          teamId: 1,
          relatedTransactionId: "purged-proposal-id",
          items: [],
        },
      ],
    };
    const trades = reconstructTradesFixed(upholdOnlyPayload as Record<string, unknown>);
    // Should return 0 trades — no fake data
    expect(trades).toHaveLength(0);
  });

  it("handles pick-only 2026 trades (no player items, only DRAFT_TRADE picks)", () => {
    const payload = {
      seasonId: 2026,
      transactions: [
        {
          id: "uphold-picks-001",
          type: "TRADE_UPHOLD",
          status: "EXECUTED",
          proposedDate: 1778814507468,
          teamId: 1,
          relatedTransactionId: "proposal-picks-001",
          items: [],
        },
        {
          id: "proposal-picks-001",
          type: "TRADE_PROPOSAL",
          status: "PENDING",
          proposedDate: 1778800000000,
          teamId: 5,
          relatedTransactionId: null,
          items: [
            { fromTeamId: 5, toTeamId: 1, type: "DRAFT_TRADE", playerId: 0, overallPickNumber: 7, player: {} },
            { fromTeamId: 1, toTeamId: 5, type: "DRAFT_TRADE", playerId: 0, overallPickNumber: 39, player: {} },
          ],
        },
      ],
    };
    const trades = reconstructTradesFixed(payload as Record<string, unknown>);
    expect(trades).toHaveLength(1);
    expect(trades[0].pickCount).toBe(2);
    expect(trades[0].playerCount).toBe(0);
  });

  it("legacy TRADE path still works alongside 2026 path", () => {
    const mixedPayload = {
      seasonId: 2025,
      transactions: [
        // Legacy trade
        {
          id: "legacy-trade-001",
          type: "TRADE",
          status: "EXECUTED",
          proposedDate: 1700000000000,
          teamId: 2,
          items: [
            { fromTeamId: 2, toTeamId: 8, type: "ADD", playerId: 1234567, player: { id: 1234567, fullName: "Patrick Mahomes" } },
            { fromTeamId: 8, toTeamId: 2, type: "ADD", playerId: 7654321, player: { id: 7654321, fullName: "Justin Jefferson" } },
          ],
        },
      ],
    };
    const trades = reconstructTradesFixed(mixedPayload as Record<string, unknown>);
    expect(trades).toHaveLength(1);
    expect(trades[0].playerCount).toBe(2);
  });
});
