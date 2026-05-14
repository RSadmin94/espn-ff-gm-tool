/**
 * billingRouter.ts
 *
 * tRPC procedures for Stripe billing:
 *   billing.createCheckoutSession  — creates a Stripe Checkout session, returns URL
 *   billing.getSubscriptionStatus  — returns current user subscription state
 *   billing.createPortalSession    — creates a Stripe Customer Portal session for self-service
 *
 * All procedures are protected (require login).
 */
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { stripe } from "./stripe/client";
import { PRODUCTS } from "./stripe/products";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { recordFunnelEvent } from "./funnelService";

export const billingRouter = router({
  /**
   * Create a Stripe Checkout session for the monthly plan.
   * Returns the checkout URL — frontend opens it in a new tab.
   */
  createCheckoutSession: protectedProcedure
    .input(z.object({ origin: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Get or create Stripe customer
      const [userRow] = await db.select().from(users).where(eq(users.id, userId));
      if (!userRow) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      let customerId = userRow.stripeCustomerId ?? undefined;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: userRow.email ?? undefined,
          name: userRow.name ?? undefined,
          metadata: { userId: userId.toString() },
        });
        customerId = customer.id;
          await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
      }

      // Resolve price ID — from env or fallback to lookup
      let priceId = ENV.stripePriceIdMonthly || PRODUCTS.gmWarRoom.monthly.priceId;
      if (!priceId) {
        // Dynamically look up the price from Stripe if no env var is set
        const prices = await stripe.prices.list({ active: true, limit: 10 });
        const found = prices.data.find(
          (p) => p.unit_amount === PRODUCTS.gmWarRoom.monthly.amount && p.recurring?.interval === "month"
        );
        if (found) priceId = found.id;
      }

      if (!priceId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No active monthly price configured. Set STRIPE_PRICE_ID_MONTHLY.",
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        success_url: `${input.origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${input.origin}/reveal`,
        client_reference_id: userId.toString(),
        metadata: {
          user_id: userId.toString(),
          customer_email: userRow.email ?? "",
          customer_name: userRow.name ?? "",
        },
      });

      if (!session.url) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe did not return a checkout URL" });
      }

      // Track funnel events for both legacy and reveal-specific funnels.
      await recordFunnelEvent({ userId, event: "clicked_cta", metadata: { priceId } });
      await recordFunnelEvent({ userId, event: "clicked_checkout", metadata: { priceId } });

      return { url: session.url };
    }),

  /**
   * Returns the current user's subscription status and trial info.
   * Used by the frontend to show trial banners and paywall states.
   */
  getSubscriptionStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [userRow] = await db.select().from(users).where(eq(users.id, ctx.user.id));
    if (!userRow) throw new TRPCError({ code: "NOT_FOUND" });

    const now = Date.now();
    const trialStartedAt = userRow.trialStartedAt ? new Date(userRow.trialStartedAt).getTime() : null;
    const trialDaysLeft = trialStartedAt
      ? Math.max(0, Math.ceil((trialStartedAt + 7 * 24 * 60 * 60 * 1000 - now) / (24 * 60 * 60 * 1000)))
      : null;
    const isTrialExpired = trialStartedAt !== null && trialDaysLeft === 0;
    const currentPeriodEnd = userRow.currentPeriodEnd ? new Date(userRow.currentPeriodEnd).getTime() : null;

    return {
      status: userRow.subscriptionStatus,
      trialDaysLeft,
      isTrialExpired,
      currentPeriodEnd,
      hasAccess:
        userRow.subscriptionStatus === "active" ||
        (userRow.subscriptionStatus === "trialing" && !isTrialExpired),
    };
  }),

  /**
   * Create a Stripe Customer Portal session for self-service billing management.
   */
  createPortalSession: protectedProcedure
    .input(z.object({ origin: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [userRow] = await db.select().from(users).where(eq(users.id, ctx.user.id));
      if (!userRow?.stripeCustomerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No billing account found" });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: userRow.stripeCustomerId,
        return_url: `${input.origin}/command-center`,
      });

      return { url: session.url };
    }),
});
