import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { safeErrorMessage } from "@/lib/paywall";

type PaywallPromptProps = {
  compact?: boolean;
  dismissible?: boolean;
};

export default function PaywallPrompt({ compact = false, dismissible = false }: PaywallPromptProps) {
  const [dismissed, setDismissed] = useState(false);
  const checkoutMutation = trpc.billing.createCheckoutSession.useMutation();

  if (dismissed) return null;

  const handleCheckout = async () => {
    try {
      const session = await checkoutMutation.mutateAsync({ origin: window.location.origin });
      window.location.href = session.url;
    } catch (error) {
      toast.error(safeErrorMessage(error, "Checkout could not be started."));
      console.error("[PaywallPrompt] checkout failed", error);
    }
  };

  return (
    <div
      className={
        compact
          ? "flex-shrink-0 border-b border-primary/30 bg-primary/10 px-6 py-3 text-sm text-foreground"
          : "rounded-2xl border border-primary/30 bg-primary/10 p-6 text-center shadow-sm"
      }
    >
      <div className={compact ? "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" : "space-y-4"}>
        <div className={compact ? "min-w-0" : ""}>
          <p className="font-semibold text-foreground">Your free weekly cycle has ended.</p>
          <p className={compact ? "text-xs text-muted-foreground mt-0.5" : "text-sm text-muted-foreground mt-2"}>
            Unlock your full League DNA, AI GM Advisor, Trade Lab, and weekly intelligence.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button
            onClick={handleCheckout}
            disabled={checkoutMutation.isPending}
            size={compact ? "sm" : "default"}
            className="espn-gradient text-white border-0"
          >
            {checkoutMutation.isPending ? "Opening..." : "Unlock Full Access"}
          </Button>
          {dismissible && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
