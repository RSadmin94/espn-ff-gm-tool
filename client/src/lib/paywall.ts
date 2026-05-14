import { TRPCClientError } from "@trpc/client";
import { PAYWALL_ERR_MSG } from "@shared/const";

export function isPaywallError(error: unknown) {
  return (
    (error instanceof TRPCClientError && error.data?.code === "FORBIDDEN" && error.message === PAYWALL_ERR_MSG) ||
    (error instanceof Error && error.message === PAYWALL_ERR_MSG)
  );
}

export function safeErrorMessage(error: unknown, fallback: string) {
  if (isPaywallError(error)) return "Your free weekly cycle has ended.";
  if (error instanceof TRPCClientError && error.data?.code === "FORBIDDEN") {
    return "You do not have access to this action.";
  }
  return error instanceof Error ? error.message : fallback;
}
