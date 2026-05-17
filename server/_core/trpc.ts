import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

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

const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Requires an active subscription or a non-expired trial. */
export const subscribedProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    const { subscriptionStatus, trialStartedAt } = ctx.user;
    if (subscriptionStatus === 'active') {
      return next({ ctx: { ...ctx, user: ctx.user } });
    }
    if (subscriptionStatus === 'trialing' && trialStartedAt) {
      const elapsed = Date.now() - new Date(trialStartedAt).getTime();
      if (elapsed <= TRIAL_DURATION_MS) {
        return next({ ctx: { ...ctx, user: ctx.user } });
      }
    }
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your free trial has ended. Upgrade to continue.",
    });
  }),
);

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
