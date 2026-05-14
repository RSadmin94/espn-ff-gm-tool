import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ─── Suspense layer copy ──────────────────────────────────────────────────────
const SUSPENSE_LINES = [
  "Analyzing 9 seasons of league history…",
  "Mapping rivalry patterns across 126 matchups…",
  "Detecting trade behavior and timing patterns…",
  "Identifying your most actionable opponent…",
];

const LINE_DURATION_MS = 1150; // 4 lines × 1.15s ≈ 4.6s total
const SKIP_AVAILABLE_AFTER_LINE = 1; // 0-indexed: after line 2 (index 1)

// ─── Reveal content helpers ────────────────────────────────────────────────────
type RevealProfile = {
  memberId: string;
  ownerName: string;
  gmArchetype: string;
  dnaSummary: string;
  championshipCount: number;
  mostRecentTitle: number | null;
  exploitWindows: string[];
  lossTradeRatio: number;
  h2hRecord: {
    wins: number;
    losses: number;
  };
  exploitabilityLabel: string;
};

type RevealData = {
  self: RevealProfile;
  champion: RevealProfile;
  rival: RevealProfile;
  allProfiles: RevealProfile[];
};

function firstStrongSentence(summary: string) {
  const lines = summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.find((entry) => !entry.toLowerCase().includes("seasons analyzed")) ?? lines[0];
  const normalized = (line ?? "Your league history has a clear behavioral fingerprint.").replace(/\s+/g, " ");
  const sentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? normalized;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function currentProfileStage(value: number | undefined) {
  return Math.max(0, Math.min(3, value ?? 0));
}

function buildProfileCard(stage: number, data: RevealData) {
  if (stage === 0) {
    return {
      label: "YOUR GM PROFILE",
      headline: data.self.gmArchetype,
      evidence: firstStrongSentence(data.self.dnaSummary),
      cta: "Show Me The Champion",
    };
  }

  if (stage === 1) {
    return {
      label: "LEAGUE CHAMPION",
      headline: `${data.champion.ownerName} Knows How To Win Here.`,
      evidence: `${data.champion.ownerName} has won ${data.champion.championshipCount} title(s). Most recent: ${data.champion.mostRecentTitle ?? "unknown"}. Style: ${data.champion.gmArchetype}.`,
      cta: "Show Me My Biggest Rival",
    };
  }

  return {
    label: "YOUR MOST ACTIONABLE OPPONENT",
    headline: `${data.rival.ownerName} Is Vulnerable Right Now.`,
    evidence:
      data.rival.exploitWindows[0] ??
      `${data.rival.ownerName} has a trade loss ratio of ${(data.rival.lossTradeRatio * 100).toFixed(0)}% — they consistently give up value in deals.`,
    implication: `H2H record: ${data.rival.h2hRecord.wins}W–${data.rival.h2hRecord.losses}L. Exploitability: ${data.rival.exploitabilityLabel}.`,
    cta: "Reveal The Full Intelligence Report",
  };
}

// ─── Animation helpers ────────────────────────────────────────────────────────
type Phase = "suspense" | "reveal";

export default function Reveal() {
  const [phase, setPhase] = useState<Phase>("suspense");
  const [activeLine, setActiveLine] = useState(0);
  const [showSkip, setShowSkip] = useState(false);
  const [revealVisible, setRevealVisible] = useState(false);
  const [secondaryVisible, setSecondaryVisible] = useState(false);
  const [blurVisible, setBlurVisible] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utils = trpc.useUtils();
  const revealDataQuery = trpc.onboarding.getRevealData.useQuery(undefined, {
    enabled: phase === "reveal",
  });
  const onboardingStateQuery = trpc.onboarding.getState.useQuery(undefined, {
    enabled: phase === "reveal",
  });
  const advanceProfileMutation = trpc.onboarding.advanceProfile.useMutation();
  const completeRevealMutation = trpc.onboarding.completeReveal.useMutation();
  const checkoutMutation = trpc.billing.createCheckoutSession.useMutation();

  const currentProfile = currentProfileStage(onboardingStateQuery.data?.currentProfile);
  const revealData = revealDataQuery.data;
  const activeCard =
    revealData && currentProfile < 3 ? buildProfileCard(currentProfile, revealData) : null;
  const selectedProfileIds = new Set(
    revealData ? [revealData.self.memberId, revealData.champion.memberId, revealData.rival.memberId] : []
  );
  const lockedProfiles =
    revealData?.allProfiles.filter((profile) => !selectedProfileIds.has(profile.memberId)).slice(0, 4) ?? [];

  // ── Suspense sequencing ──────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "suspense") return;

    const advance = (lineIndex: number) => {
      if (lineIndex >= SUSPENSE_LINES.length) {
        transitionToReveal();
        return;
      }
      setActiveLine(lineIndex);
      if (lineIndex >= SKIP_AVAILABLE_AFTER_LINE) {
        setShowSkip(true);
      }
      timerRef.current = setTimeout(() => advance(lineIndex + 1), LINE_DURATION_MS);
    };

    timerRef.current = setTimeout(() => advance(0), 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const transitionToReveal = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase("reveal");
    // Staggered fade-in sequence
    setTimeout(() => setRevealVisible(true), 100);
    setTimeout(() => setSecondaryVisible(true), 700);
    setTimeout(() => setBlurVisible(true), 1200);
    setTimeout(() => setCtaVisible(true), 1700);
  };

  const handleSkip = () => transitionToReveal();

  useEffect(() => {
    if (phase !== "reveal") return;

    setRevealVisible(false);
    setSecondaryVisible(false);
    setBlurVisible(false);
    setCtaVisible(false);

    const timers = [
      setTimeout(() => setRevealVisible(true), 100),
      setTimeout(() => setSecondaryVisible(true), 700),
      setTimeout(() => setBlurVisible(true), 1200),
      setTimeout(() => setCtaVisible(true), 1700),
    ];

    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [phase, currentProfile]);

  const handleAdvance = async () => {
    try {
      await advanceProfileMutation.mutateAsync();
      await utils.onboarding.getState.invalidate();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not advance reveal profile.";
      toast.error(message);
      console.error("[Reveal] advanceProfile failed", error);
    }
  };

  const handleCheckout = async () => {
    try {
      try {
        await completeRevealMutation.mutateAsync();
        await utils.onboarding.getState.invalidate();
      } catch (error) {
        console.error("[Reveal] completeReveal failed", error);
      }

      const session = await checkoutMutation.mutateAsync({ origin: window.location.origin });
      window.location.href = session.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkout could not be started.";
      toast.error(message);
      console.error("[Reveal] checkout failed", error);
    }
  };

  // ─── Suspense screen ────────────────────────────────────────────────────────
  if (phase === "suspense") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-6 relative">
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/5">
          <div
            className="h-full bg-white/30 transition-all ease-linear"
            style={{
              width: `${((activeLine + 1) / SUSPENSE_LINES.length) * 100}%`,
              transitionDuration: `${LINE_DURATION_MS}ms`,
            }}
          />
        </div>

        {/* Lines */}
        <div className="max-w-xl w-full space-y-5">
          {SUSPENSE_LINES.slice(0, activeLine + 1).map((line, i) => (
            <p
              key={i}
              className={`text-lg font-mono transition-all duration-500 ${
                i === activeLine
                  ? "text-white opacity-100"
                  : "text-white/40 opacity-100"
              }`}
              style={{
                animation: i === activeLine ? "fadeIn 0.4s ease-out" : undefined,
              }}
            >
              {line}
            </p>
          ))}
        </div>

        {/* Skip */}
        {showSkip && (
          <button
            onClick={handleSkip}
            className="absolute bottom-8 right-8 text-white/25 text-sm font-mono hover:text-white/50 transition-colors"
          >
            Skip →
          </button>
        )}

        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  if (onboardingStateQuery.isError) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6 text-center">
        <div className="max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] px-7 py-8">
          <p className="text-white text-lg font-semibold mb-2">Your reveal paused.</p>
          <p className="text-white/50 text-sm leading-relaxed">
            Refresh the page and we will pick up the profile sequence again.
          </p>
        </div>
      </div>
    );
  }

  if (revealDataQuery.isLoading || onboardingStateQuery.isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center px-6 py-16 overflow-y-auto">
        <div className="max-w-2xl w-full flex flex-col items-center gap-12">
          <div className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-8 py-12 text-center animate-pulse">
            <div className="h-3 w-36 bg-white/15 rounded mx-auto mb-6" />
            <div className="h-11 w-4/5 bg-white/15 rounded mx-auto mb-4" />
            <div className="h-4 w-full bg-white/10 rounded mb-3" />
            <div className="h-4 w-3/4 bg-white/10 rounded mx-auto" />
          </div>
          <div className="h-12 w-full sm:w-80 rounded-xl bg-white/10 animate-pulse" />
        </div>
      </div>
    );
  }

  if (revealDataQuery.isError || !revealData) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6 text-center">
        <div className="max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] px-7 py-8">
          <p className="text-white text-lg font-semibold mb-2">We could not load your league DNA.</p>
          <p className="text-white/50 text-sm leading-relaxed">
            Refresh once your league data is available.
          </p>
        </div>
      </div>
    );
  }

  // ─── Reveal screen ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center px-6 py-16 overflow-y-auto">
      <div className="max-w-2xl w-full flex flex-col items-center gap-12">
        {currentProfile < 3 && activeCard && (
          <>
            {/* ── Main Reveal Card ── */}
            <div
              className={`w-full transition-all duration-700 ${
                revealVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-8 py-12 text-center">
                <p className="text-[11px] tracking-[0.2em] uppercase text-white/40 mb-5 font-mono">
                  {activeCard.label}
                </p>
                <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-6">
                  {activeCard.headline}
                </h1>
                <div
                  className={`transition-all duration-700 ${
                    secondaryVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
                  }`}
                >
                  <p className="text-white/70 text-lg leading-relaxed mb-5">
                    {activeCard.evidence}
                  </p>
                  {"implication" in activeCard && activeCard.implication && (
                    <p className="text-white/45 text-sm italic">
                      {activeCard.implication}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Stage CTA ── */}
            <div
              className={`w-full flex flex-col items-center gap-4 transition-all duration-700 ${
                ctaVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <button
                onClick={handleAdvance}
                disabled={advanceProfileMutation.isPending}
                className="w-full sm:w-80 py-4 px-8 rounded-xl bg-white text-[#0a0a0a] font-semibold text-base tracking-wide hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-[0_0_32px_rgba(255,255,255,0.12)]"
              >
                {advanceProfileMutation.isPending ? "Loading..." : activeCard.cta}
              </button>
            </div>
          </>
        )}

        {currentProfile === 3 && (
          <>
            <div
              className={`w-full transition-all duration-700 ${
                revealVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-8 py-12 text-center">
                <p className="text-[11px] tracking-[0.2em] uppercase text-white/40 mb-5 font-mono">
                  FULL LEAGUE DNA
                </p>
                <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-6">
                  The Rest Of Your League Is Still Hidden.
                </h1>
                <p className="text-white/65 text-lg leading-relaxed">
                  You have seen your profile, the champion, and the opponent to attack first. The full report shows every manager's behavioral edge.
                </p>
              </div>
            </div>

            <div
              className={`w-full transition-all duration-700 ${
                blurVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {lockedProfiles.map((profile) => (
                  <div
                    key={profile.memberId}
                    className="rounded-xl border border-white/8 bg-white/[0.025] px-5 py-6 relative overflow-hidden"
                  >
                    <p className="text-[10px] tracking-[0.18em] uppercase text-white/35 mb-3 font-mono">
                      MANAGER PROFILE
                    </p>
                    <p className="text-white/60 text-sm font-semibold mb-4">
                      {profile.ownerName}
                    </p>
                    <div
                      className="space-y-2"
                      style={{ filter: "blur(4px)", opacity: 0.55, userSelect: "none" }}
                      aria-hidden="true"
                    >
                      <div className="h-3 bg-white/20 rounded w-full" />
                      <div className="h-3 bg-white/15 rounded w-4/5" />
                      <div className="h-3 bg-white/10 rounded w-3/5" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── CTA ── */}
            <div
              className={`w-full flex flex-col items-center gap-4 transition-all duration-700 ${
                ctaVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <button
                onClick={handleCheckout}
                disabled={checkoutMutation.isPending}
                className="w-full sm:w-80 py-4 px-8 rounded-xl bg-white text-[#0a0a0a] font-semibold text-base tracking-wide hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-[0_0_32px_rgba(255,255,255,0.12)]"
              >
                {checkoutMutation.isPending ? "Opening Checkout..." : "Unlock Your Full League DNA"}
              </button>
              <p className="text-white/30 text-xs text-center max-w-xs leading-relaxed">
                See every manager's behavioral profile, trade patterns, and your full
                championship intelligence report.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
