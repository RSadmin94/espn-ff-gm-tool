/**
 * LeagueSwitcher — sidebar footer component
 *
 * Shows:
 *  - Logged-in user name + avatar initials
 *  - Active league name with a dropdown to switch between all connected leagues
 *  - "Add Another League" CTA → /connect
 *  - Remove league (trash icon per row)
 *  - Logout button
 *  - Login button when unauthenticated
 */
import { useState } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronDown,
  CheckCircle2,
  PlusCircle,
  Trash2,
  LogOut,
  LogIn,
  User,
  Loader2,
} from "lucide-react";
import { trackEvent } from "@/lib/trackEvent";

const PROVIDER_EMOJI: Record<string, string> = {
  espn: "🏈",
  sleeper: "😴",
  yahoo: "🟣",
  nfl: "🏟️",
};

export default function LeagueSwitcher() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: number; name: string } | null>(null);

  const utils = trpc.useUtils();

  const myLeagues = trpc.league.getMyLeagues.useQuery(undefined, {
    enabled: !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const setActive = trpc.league.setActive.useMutation({
    onSuccess: (_data, variables) => {
      // Track league switch event
      const switched = leagues.find(l => l.id === variables.leagueConnectionId);
      trackEvent("league_switch", "league_switcher", {
        action: "switch_league",
        metadata: {
          toLeagueId: switched?.leagueId ?? "unknown",
          toLeagueName: switched?.leagueName ?? "unknown",
          provider: switched?.provider ?? "unknown",
        },
      });
      // Invalidate all league-dependent queries so the whole app reflects the switch
      utils.league.getActive.invalidate();
      utils.league.getMyLeagues.invalidate();
      utils.pipeline.health.invalidate();
    },
  });

  const removeLeague = trpc.league.removeLeague.useMutation({
    onSuccess: () => {
      utils.league.getActive.invalidate();
      utils.league.getMyLeagues.invalidate();
      utils.pipeline.health.invalidate();
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = "/";
    },
  });

  const leagues = myLeagues.data ?? [];
  const activeLeague = leagues.find((l) => l.isActive) ?? leagues[0] ?? null;

  // ─── Unauthenticated state ────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="px-4 py-3 border-t border-border space-y-2">
        {/* League switcher placeholder — visible even when signed out */}
        <button
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-accent/40 hover:bg-accent/70 transition-colors text-left"
          onClick={() => (window.location.href = getLoginUrl())}
        >
          <span className="text-sm flex-shrink-0">🏆</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-foreground/60 truncate leading-tight">Select League</p>
            <p className="text-[9px] text-muted-foreground/50 leading-tight">Sign in to switch leagues</p>
          </div>
          <ChevronDown className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
        </button>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 text-xs font-medium"
          onClick={() => (window.location.href = getLoginUrl())}
        >
          <LogIn className="w-3.5 h-3.5" />
          Sign In
        </Button>
      </div>
    );
  }

  // ─── Authenticated state ──────────────────────────────────────────────────
  const initials = (user.name ?? user.email ?? "U")
    .split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      <div className="px-4 py-3 border-t border-border space-y-2">
        {/* User row */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-primary">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-foreground truncate leading-tight">
              {user.name ?? user.email ?? "User"}
            </p>
            <p className="text-[9px] text-muted-foreground/60 leading-tight capitalize">
              {user.role ?? "user"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 flex-shrink-0 text-muted-foreground/50 hover:text-destructive"
            title="Sign out"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            {logoutMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <LogOut className="w-3 h-3" />
            )}
          </Button>
        </div>

        {/* League switcher */}
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-accent/40 hover:bg-accent/70 transition-colors text-left group">
              <span className="text-sm flex-shrink-0">
                {PROVIDER_EMOJI[activeLeague?.provider ?? ""] ?? "🏆"}
              </span>
              <div className="flex-1 min-w-0">
                {activeLeague ? (
                  <>
                    <p className="text-[11px] font-medium text-foreground truncate leading-tight">
                      {activeLeague.leagueName || `League ${activeLeague.leagueId}`}
                    </p>
                    <p className="text-[9px] text-muted-foreground/60 leading-tight">
                      {activeLeague.provider?.toUpperCase()} · Season {activeLeague.season}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground">No league connected</p>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "w-3 h-3 text-muted-foreground/50 flex-shrink-0 transition-transform",
                  open ? "rotate-180" : ""
                )}
              />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side="top"
            align="start"
            className="w-64 mb-1"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
              My Leagues
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {myLeagues.isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {!myLeagues.isLoading && leagues.length === 0 && (
              <div className="px-3 py-3 text-center">
                <p className="text-xs text-muted-foreground">No leagues connected yet.</p>
              </div>
            )}

            {leagues.map((league) => {
              const isActive = league.isActive;
              return (
                <DropdownMenuItem
                  key={league.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 cursor-pointer group/item",
                    isActive && "bg-primary/10"
                  )}
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!isActive) {
                      setActive.mutate({ leagueConnectionId: league.id });
                    }
                    setOpen(false);
                  }}
                >
                  <span className="text-sm flex-shrink-0">
                    {PROVIDER_EMOJI[league.provider] ?? "🏆"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {league.leagueName || `League ${league.leagueId}`}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70">
                      {league.provider?.toUpperCase()} · {league.season}
                    </p>
                  </div>
                  {isActive && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  )}
                  {setActive.isPending && !isActive && (
                    <Loader2 className="w-3 h-3 animate-spin text-muted-foreground flex-shrink-0" />
                  )}
                  {/* Remove button — only shown on hover */}
                  <button
                    className="ml-auto opacity-0 group-hover/item:opacity-100 transition-opacity text-muted-foreground/50 hover:text-destructive flex-shrink-0"
                    title="Remove league"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRemoveTarget({
                        id: league.id,
                        name: league.leagueName || `League ${league.leagueId}`,
                      });
                      setOpen(false);
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </DropdownMenuItem>
              );
            })}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="flex items-center gap-2 px-3 py-2 cursor-pointer text-primary"
              onSelect={() => {
                setOpen(false);
                navigate("/connect");
              }}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Add Another League</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Confirm remove dialog */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove League?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disconnect <strong>{removeTarget?.name}</strong> from your account.
              All cached data for this league will be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removeTarget) {
                  removeLeague.mutate({ leagueConnectionId: removeTarget.id });
                  setRemoveTarget(null);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
