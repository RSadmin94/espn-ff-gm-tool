/**
 * LogDecisionButton
 *
 * A reusable button that logs any GM decision to the decision memory system.
 * Appears in Start/Sit, Trade Analyzer, Waiver Wire, and Trade Offer Generator
 * results panels.
 */
import { useState } from "react";
import { Brain, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { safeErrorMessage } from "@/lib/paywall";

export type LogDecisionToolSource =
  | "start_sit"
  | "trade_analyzer"
  | "waiver_wire"
  | "trade_offer"
  | "keeper_lab"
  | "draft_war_room"
  | "manual";

export type LogDecisionType =
  | "start_sit"
  | "trade_accept"
  | "trade_reject"
  | "waiver_add"
  | "waiver_pass"
  | "keeper_keep"
  | "keeper_drop"
  | "draft_pick"
  | "manual";

interface LogDecisionButtonProps {
  toolSource: LogDecisionToolSource;
  decisionType: LogDecisionType;
  description: string;
  recommendation?: string;
  playersInvolved?: string[];
  counterparty?: string;
  aiContext?: string;
  season: number;
  weekNum?: number;
  tags?: string[];
  /** Pre-fill whether Rod followed the recommendation */
  followedRecommendation?: boolean;
  /** Pre-fill accepted state */
  accepted?: boolean;
  /** Custom button label */
  label?: string;
  /** Button variant */
  variant?: "default" | "outline" | "ghost" | "secondary";
  /** Button size */
  size?: "sm" | "default" | "lg";
  /** Called after successful log */
  onLogged?: (decisionId: number) => void;
}

export function LogDecisionButton({
  toolSource,
  decisionType,
  description,
  recommendation,
  playersInvolved,
  counterparty,
  aiContext,
  season,
  weekNum,
  tags,
  followedRecommendation: defaultFollowed,
  accepted: defaultAccepted = true,
  label = "Log Decision",
  variant = "outline",
  size = "sm",
  onLogged,
}: LogDecisionButtonProps) {
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(defaultAccepted);
  const [followed, setFollowed] = useState(defaultFollowed ?? true);
  const [notes, setNotes] = useState("");
  const [logged, setLogged] = useState(false);

  const logMutation = trpc.gmDecision.logDecision.useMutation({
    onSuccess: (data) => {
      setLogged(true);
      setOpen(false);
      toast.success("Decision logged to GM Memory");
      onLogged?.(data.decisionId);
    },
    onError: (err) => {
      toast.error(safeErrorMessage(err, "Failed to log decision."));
    },
  });

  const handleLog = () => {
    logMutation.mutate({
      toolSource,
      decisionType,
      description,
      recommendation,
      followedRecommendation: followed,
      accepted,
      playersInvolved,
      counterparty,
      aiContext: aiContext ? `${aiContext}\n\nNotes: ${notes}` : notes || undefined,
      season,
      weekNum,
      tags,
    });
  };

  if (logged) {
    return (
      <Button variant="ghost" size={size} disabled className="text-green-600 gap-1">
        <Check className="h-3.5 w-3.5" />
        Logged
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className="gap-1.5">
          <Brain className="h-3.5 w-3.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-500" />
            Log to GM Memory
          </DialogTitle>
          <DialogDescription>
            Record this decision so the system can track your accuracy and learn from your outcomes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Decision summary */}
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <p className="font-medium text-foreground">{description}</p>
            {recommendation && (
              <p className="mt-1 text-muted-foreground text-xs">
                <span className="font-medium">AI recommended:</span> {recommendation}
              </p>
            )}
            {playersInvolved && playersInvolved.length > 0 && (
              <p className="mt-1 text-muted-foreground text-xs">
                <span className="font-medium">Players:</span> {playersInvolved.join(", ")}
              </p>
            )}
          </div>

          {/* Did you make this move? */}
          <div className="flex items-center justify-between">
            <Label className="text-sm">Did you make this move?</Label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{accepted ? "Yes" : "No"}</span>
              <Switch checked={accepted} onCheckedChange={setAccepted} />
            </div>
          </div>

          {/* Did you follow the AI recommendation? */}
          {recommendation && (
            <div className="flex items-center justify-between">
              <Label className="text-sm">Followed AI recommendation?</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{followed ? "Yes" : "No"}</span>
                <Switch checked={followed} onCheckedChange={setFollowed} />
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-sm">Notes (optional)</Label>
            <Textarea
              placeholder="Why did you make this decision? What were you thinking?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleLog}
            disabled={logMutation.isPending}
            className="gap-1.5"
          >
            {logMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Brain className="h-3.5 w-3.5" />
            )}
            Save to Memory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
