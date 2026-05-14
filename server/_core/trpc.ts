import { NOT_ADMIN_ERR_MSG, PAYWALL_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const TRIAL_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const requireSubscription = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  const hasActiveSubscription = ctx.user.subscriptionStatus === "active";
  const trialStartedAt = ctx.user.trialStartedAt ? new Date(ctx.user.trialStartedAt).getTime() : null;
  const hasActiveTrial =
    ctx.user.subscriptionStatus === "trialing" &&
    trialStartedAt !== null &&
    Date.now() - trialStartedAt < TRIAL_LENGTH_MS;

  if (!hasActiveSubscription && !hasActiveTrial) {
    throw new TRPCError({ code: "FORBIDDEN", message: PAYWALL_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const subscribedProcedure = t.procedure.use(requireSubscription);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
