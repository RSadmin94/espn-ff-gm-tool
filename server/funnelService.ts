/**
 * funnelService.ts
 *
 * Lightweight helper for recording the 5-event conversion funnel.
 *
 * Events:
 *   connected_league    — user successfully connected an ESPN/Sleeper/Yahoo league
 *   completed_reveal    — user saw the personalized reveal card
 *   clicked_cta         — user clicked "Unlock Your Full League DNA"
 *   clicked_checkout    — user requested a Stripe Checkout session
 *   started_checkout    — user arrived at Stripe checkout (tracked via webhook)
 *   completed_payment   — user completed payment (tracked via webhook)
 *
 * Design: fire-and-forget. Never throw — funnel tracking must never block the main flow.
 */
import { getDb } from "./db";
import { funnelEvents } from "../drizzle/schema";

export async function recordFunnelEvent(opts: {
  userId: number | null;
  event:
    | "connected_league"
    | "completed_reveal"
    | "viewed_self_profile"
    | "viewed_champion_profile"
    | "viewed_rival_profile"
    | "viewed_locked_profiles"
    | "clicked_cta"
    | "clicked_checkout"
    | "started_checkout"
    | "completed_payment";
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(funnelEvents).values({
      userId: opts.userId ?? undefined,
      event: opts.event,
      metadata: opts.metadata ?? null,
    });
  } catch (err) {
    // Never throw — funnel tracking is non-critical
    console.warn("[funnelService] Failed to record event:", opts.event, err);
  }
}
