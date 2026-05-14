import { useState } from "react";
import { LogDecisionButton } from "@/components/LogDecisionButton";
import PaywallPrompt from "@/components/PaywallPrompt";
import { trpc } from "@/lib/trpc";
import { isPaywallError, safeErrorMessage } from "@/lib/paywall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeftRight, Target, TrendingUp, Brain, MessageSquare,
  AlertTriangle, Clock, Star, Dna, Zap, ShieldAlert, BarChart3, Info, Loader2, Plus,
} from "lucide-react";

// Flip to true once the 2026 draft is completed to unlock player trading.
const DRAFT_2026_COMPLETE = false;

function pickLabel(round: number, pick: number) {
  return `2026 Rd ${round}.${String(pick).padStart(2, "0")}`;
}

const DEAL_RATING_COLORS: Record<string, string> = {
  EXCELLENT: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  GOOD: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  FAIR: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  TOUGH: "bg-red-500/20 text-red-400 border-red-500/30",
};

const VALUE_RATIO_COLOR = (ratio: number) => {
  if (ratio >= 95 && ratio <= 110) return "text-emerald-400";
  if (ratio >= 85 && ratio < 95) return "text-yellow-400";
  if (ratio > 110) return "text-blue-400";
  return "text-red-400";
};

const VALUE_RATIO_LABEL = (ratio: number) => {
  if (ratio >= 95 && ratio <= 110) return "FAIR";
  if (ratio > 110 && ratio <= 125) return "SLIGHT OVERPAY";
  if (ratio > 125) return "OVERPAY";
  if (ratio >= 85) return "SLIGHT UNDERPAY";
  return "UNDERPAY";
};

const EXPLOIT_COLOR = (score: number) => {
  if (score >= 70) return { bar: "bg-red-500", text: "text-red-400", label: "HIGHLY EXPLOITABLE" };
  if (score >= 50) return { bar: "bg-orange-500", text: "text-orange-400", label: "MODERATELY EXPLOITABLE" };
  if (score >= 30) return { bar: "bg-yellow-500", text: "text-yellow-400", label: "MARKET-AWARE" };
  return { bar: "bg-emerald-500", text: "text-emerald-400", label: "SHARK" };
};

const TILT_COLOR = (label: string) => {
  if (label === "High Tilt Risk") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (label === "Moderate Tilt") return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  if (label === "Steady") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
};

export default function TradeOfferGenerator() {
  const [round, setRound] = useState("1");
  const [slot, setSlot] = useState("1");

  const mutation = trpc.tradeOfferGenerator.useMutation();

  const handleGenerate = () => {
    const r = parseInt(round);
    const s = parseInt(slot);
    mutation.mutate({ targetInput: pickLabel(r, s), targetType: "pick" });
  };

  const result = mutation.data;
  const strategy = result?.strategy as any;
  const dna = result?.dnaProfile as any;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/20">
            <ArrowLeftRight className="h-6 w-6 text-orange-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">Trade Offer Generator</h1>
              {dna && (
                <Badge className="bg-purple-500/20 text-purple-400 border border-purple-500/30 text-xs gap-1">
                  <Dna className="h-3 w-3" />
                  DNA-Powered
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Select a 2026 pick you want to acquire — get a fair offer, GM intel, and AI negotiation strategy
            </p>
          </div>
        </div>

        {/* Pre-draft notice */}
        {!DRAFT_2026_COMPLETE && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-200 leading-relaxed">
              <span className="font-semibold text-amber-300">Pre-draft mode — 2026 picks only.</span>{" "}
              Player trading unlocks after the 2026 draft. Use this to generate targeted pick acquisition offers before draft day.
            </div>
          </div>
        )}

        {/* Input Card */}
        <Card className="border-orange-500/20 bg-card/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-orange-400" />
              Which 2026 draft pick do you want to acquire?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3 items-end">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs text-muted-foreground">Round</label>
                <Select value={round} onValueChange={setRound}>
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Round" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 14 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>Round {i + 1}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-xs text-muted-foreground">Pick slot</label>
                <Select value={slot} onValueChange={setSlot}>
                  <SelectTrigger className="bg-background border-border text-foreground">
                    <SelectValue placeholder="Pick" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 14 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>Pick {i + 1}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleGenerate}
                disabled={mutation.isPending}
                className="bg-orange-500 hover:bg-orange-600 text-white min-w-[160px] h-10"
              >
                {mutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Generate Offer
                  </span>
                )}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs text-orange-400 border-orange-500/30 bg-orange-500/10">
                Target: {pickLabel(parseInt(round), parseInt(slot))}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Uses pick value chart, GM behavioral profiles, and Phase 3 League DNA to build a targeted offer
              </span>
            </div>

            {mutation.error && (
              isPaywallError(mutation.error) ? (
                <PaywallPrompt />
              ) : (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {safeErrorMessage(mutation.error, "Trade offer generation failed.")}
                </div>
              )
            )}
          </CardContent>
        </Card>

        {/* Results */}
        {result && (
          <div className="space-y-4">

            {/* ── Pick Owner Identity Card ─────────────────────────────── */}
            <Card className="border-orange-500/30 bg-orange-500/5">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  {/* Left: pick label + owner name + archetype */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-sm font-bold px-3 py-1">
                        {result.targetName}
                      </Badge>
                      {strategy && (
                        <Badge className={`text-xs border ${DEAL_RATING_COLORS[strategy.dealRating] || DEAL_RATING_COLORS.FAIR}`}>
                          {strategy.dealRating}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <span className="text-xs text-muted-foreground">Held by</span>
                      <span className="text-base font-bold text-foreground">{result.targetOwner}</span>
                    </div>
                    {dna && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge className="bg-purple-500/20 text-purple-400 border border-purple-500/30 text-xs">
                          {dna.gmArchetype}
                        </Badge>
                        <Badge className={`text-xs border ${TILT_COLOR(dna.tiltLabel)}`}>
                          {dna.tiltLabel}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {dna.seasonsAnalyzed} seasons analyzed
                        </Badge>
                      </div>
                    )}
                    {result.gmStyle && !dna && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge className="bg-purple-500/20 text-purple-400 border border-purple-500/30 text-xs">
                          {result.gmStyle.archetype}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {result.gmStyle.draftStyleBadge}
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Right: key intel metrics */}
                  <div className="flex gap-4 shrink-0">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-400">{result.targetValue.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Pick Value</div>
                    </div>
                    {dna && (
                      <div className="text-center">
                        <div className={`text-2xl font-bold ${EXPLOIT_COLOR(dna.exploitabilityScore).text}`}>
                          {dna.exploitabilityScore}
                        </div>
                        <div className="text-xs text-muted-foreground">Exploit Score</div>
                      </div>
                    )}
                    {(dna?.h2hVsRod || result.gmStyle?.h2hVsRod) && (
                      <div className="text-center">
                        <div className="text-2xl font-bold text-foreground">
                          {(dna?.h2hVsRod ?? result.gmStyle?.h2hVsRod)!.wins}W
                          <span className="text-muted-foreground text-base">-</span>
                          {(dna?.h2hVsRod ?? result.gmStyle?.h2hVsRod)!.losses}L
                        </div>
                        <div className="text-xs text-muted-foreground">H2H vs Rod</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Exploitability bar */}
                {dna && (
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Exploitability</span>
                      <span className={`font-semibold ${EXPLOIT_COLOR(dna.exploitabilityScore).text}`}>
                        {EXPLOIT_COLOR(dna.exploitabilityScore).label}
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${EXPLOIT_COLOR(dna.exploitabilityScore).bar}`}
                        style={{ width: `${dna.exploitabilityScore}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Top exploit window */}
                {dna?.exploitWindows?.[0] && (
                  <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <Zap className="h-3.5 w-3.5 text-yellow-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-foreground leading-relaxed">
                      <span className="font-semibold text-yellow-400">Top Exploit: </span>
                      {dna.exploitWindows[0]}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Main Tabs */}
            <Tabs defaultValue="offers">
              <TabsList className="bg-card border border-border flex-wrap h-auto">
                <TabsTrigger value="offers" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
                  Offer Options
                </TabsTrigger>
                <TabsTrigger value="strategy" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
                  AI Strategy
                </TabsTrigger>
                {dna && (
                  <TabsTrigger value="dna" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400 gap-1">
                    <Dna className="h-3.5 w-3.5" />
                    DNA Intelligence
                  </TabsTrigger>
                )}
                {result.gmStyle && (
                  <TabsTrigger value="gm" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
                    GM Profile
                  </TabsTrigger>
                )}
                <TabsTrigger value="analysis" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
                  Full Analysis
                </TabsTrigger>
              </TabsList>

              {/* Offer Options Tab */}
              <TabsContent value="offers" className="mt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Each offer is <span className="text-foreground font-medium">balanced</span>: Rod gives N picks and receives N picks in return. Values are matched using the 14-team pick value chart.
                </p>
                {(result as any).noFair1for1 && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-300">No fair 1-for-1 offer found</p>
                      <p className="text-xs text-amber-400/80 mt-0.5">
                        A straight swap would underpay by more than 15%. Multi-pick packages are shown because they get closer to market value.
                      </p>
                    </div>
                  </div>
                )}
                {result.offerOptions.length === 0 ? (
                  <Card className="border-border bg-card/50">
                    <CardContent className="pt-4 text-center text-muted-foreground">
                      No offer options generated. You may need to build a custom offer.
                    </CardContent>
                  </Card>
                ) : (
                  result.offerOptions.map((offer, i) => {
                    const gives = (offer as any).rodGives;
                    const receives = (offer as any).rodReceives;
                    const ratioPct = (offer as any).valueRatioPct ?? offer.valueRatio;
                    return (
                      <Card key={i} className={`border ${i === 0 ? "border-orange-500/40 bg-orange-500/5" : "border-border bg-card/50"}`}>
                        <CardContent className="pt-4">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm font-semibold text-foreground">Option {i + 1}</span>
                            {i === 0 && <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">Recommended</Badge>}
                            <Badge variant="outline" className="text-xs ml-auto">
                              {/* Always show N-for-N using give count — parity is enforced server-side */}
                              {gives?.picks?.length ?? 1}-for-{gives?.picks?.length ?? 1}
                            </Badge>
                          </div>

                          {/* Balanced trade layout */}
                          <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start">
                            {/* Rod Gives */}
                            <div className="space-y-1.5">
                              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Rod Gives</p>
                              {(gives?.picks ?? offer.picks).map((pick: string, j: number) => (
                                <div key={j} className="flex items-center gap-1.5">
                                  <Badge className="bg-red-500/15 text-red-400 border border-red-500/25 text-xs font-mono">GIVE</Badge>
                                  <span className="text-sm text-foreground font-medium">{pick}</span>
                                  {gives?.pickAssets?.[j] && (
                                    <span className="text-xs text-muted-foreground ml-auto">{gives.pickAssets[j].value.toLocaleString()}</span>
                                  )}
                                </div>
                              ))}
                              <div className="text-xs text-muted-foreground pt-0.5">
                                Total: <span className="font-semibold text-foreground">{(gives?.totalValue ?? offer.totalValue).toLocaleString()}</span>
                              </div>
                            </div>

                            {/* Arrow */}
                            <div className="flex items-center justify-center pt-5">
                              <ArrowLeftRight className="h-4 w-4 text-orange-400" />
                            </div>

                            {/* Rod Receives */}
                            <div className="space-y-1.5">
                              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Rod Receives</p>
                              {(receives?.picks ?? [result.targetName]).map((pick: string, j: number) => {
                                const pa = receives?.pickAssets?.[j];
                                const trad = pa?.tradability;
                                const tradBadge = trad?.label === "HOT"
                                  ? { cls: "bg-red-500/20 text-red-400 border-red-500/30", icon: "🔥" }
                                  : trad?.label === "WARM"
                                  ? { cls: "bg-orange-500/20 text-orange-400 border-orange-500/30", icon: "⚡" }
                                  : trad?.label === "COLD"
                                  ? { cls: "bg-slate-500/20 text-slate-400 border-slate-500/30", icon: "❄️" }
                                  : null;
                                return (
                                  <div key={j} className="space-y-0.5">
                                    <div className="flex items-center gap-1.5">
                                      <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 text-xs font-mono">GET</Badge>
                                      <span className="text-sm text-foreground font-medium">{pick}</span>
                                      {pa && (
                                        <span className="text-xs text-muted-foreground ml-auto">{pa.value.toLocaleString()}</span>
                                      )}
                                    </div>
                                    {tradBadge && trad && (
                                      <div className="flex items-center gap-1.5 pl-8">
                                        <Badge className={`text-[10px] border px-1.5 py-0 ${tradBadge.cls}`}>
                                          {tradBadge.icon} {trad.label}
                                        </Badge>
                                        <span className="text-[10px] text-muted-foreground truncate" title={trad.reason}>
                                          {trad.reason}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              <div className="text-xs text-muted-foreground pt-0.5">
                                Total: <span className="font-semibold text-foreground">{(receives?.totalValue ?? result.targetValue).toLocaleString()}</span>
                              </div>
                            </div>
                          </div>

                          {/* Value match bar */}
                          <div className="mt-3 space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Value match</span>
                              <span className={`font-semibold ${VALUE_RATIO_COLOR(ratioPct)}`}>
                                {ratioPct}% — {VALUE_RATIO_LABEL(ratioPct)}
                              </span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${ratioPct >= 95 && ratioPct <= 110 ? "bg-emerald-500" : ratioPct > 110 ? "bg-blue-500" : "bg-yellow-500"}`}
                                style={{ width: `${Math.min(100, ratioPct)}%` }}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </TabsContent>

              {/* AI Strategy Tab */}
              <TabsContent value="strategy" className="mt-4 space-y-4">
                {strategy ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card className="border-border bg-card/50">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Brain className="h-4 w-4 text-purple-400" />
                            Recommended Offer
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-foreground leading-relaxed">{strategy.recommendedOffer}</p>
                        </CardContent>
                      </Card>

                      <Card className="border-border bg-card/50">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-400" />
                            Timing
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-foreground leading-relaxed">{strategy.timing}</p>
                        </CardContent>
                      </Card>

                      <Card className="border-border bg-card/50">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-emerald-400" />
                            Negotiation Strategy
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-foreground leading-relaxed">{strategy.negotiationStrategy}</p>
                        </CardContent>
                      </Card>

                      <Card className="border-border bg-card/50">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-yellow-400" />
                            Red Flags
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-foreground leading-relaxed">{strategy.redFlags}</p>
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="border-emerald-500/30 bg-emerald-500/5">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-emerald-400" />
                          Message to Send
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <blockquote className="text-sm text-foreground italic border-l-2 border-emerald-500/50 pl-3 leading-relaxed">
                          "{strategy.closingLine}"
                        </blockquote>
                        <p className="text-xs text-muted-foreground mt-2">Copy this as your opening message to {result.targetOwner}</p>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <div className="text-center text-muted-foreground py-8">No strategy data available.</div>
                )}
              </TabsContent>

              {/* DNA Intelligence Tab */}
              {dna && (
                <TabsContent value="dna" className="mt-4 space-y-4">
                  {/* Header card */}
                  <Card className="border-purple-500/30 bg-purple-500/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Dna className="h-4 w-4 text-purple-400" />
                        {result.targetOwner} — League DNA Profile
                        <Badge variant="outline" className="text-xs ml-auto border-purple-500/30 text-purple-400">
                          {dna.seasonsAnalyzed} seasons analyzed
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {/* Archetype + Tilt */}
                      <div className="flex flex-wrap gap-2">
                        <Badge className="bg-purple-500/20 text-purple-400 border border-purple-500/30 text-sm px-3 py-1">
                          {dna.gmArchetype}
                        </Badge>
                        <Badge className={`border text-sm px-3 py-1 ${TILT_COLOR(dna.tiltLabel)}`}>
                          {dna.tiltLabel}
                        </Badge>
                      </div>

                      {/* Exploitability bar */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Exploitability Score</span>
                          <span className={`text-sm font-bold ${EXPLOIT_COLOR(dna.exploitabilityScore).text}`}>
                            {dna.exploitabilityScore}/100 — {dna.exploitabilityLabel}
                          </span>
                        </div>
                        <div className="h-3 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${EXPLOIT_COLOR(dna.exploitabilityScore).bar}`}
                            style={{ width: `${dna.exploitabilityScore}%` }}
                          />
                        </div>
                      </div>

                      {/* Tilt score bar */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tilt Score</span>
                          <span className="text-sm font-bold text-foreground">{dna.tiltScore}/100</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${dna.tiltScore >= 70 ? "bg-red-500" : dna.tiltScore >= 40 ? "bg-orange-500" : "bg-blue-500"}`}
                            style={{ width: `${dna.tiltScore}%` }}
                          />
                        </div>
                      </div>

                      {/* Trade stats */}
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="p-3 rounded-lg bg-muted/30">
                          <div className="text-xl font-bold text-foreground">{dna.avgTradesPerSeason.toFixed(1)}</div>
                          <div className="text-xs text-muted-foreground">Avg Trades/Season</div>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/30">
                          <div className="text-xl font-bold text-orange-400">{dna.lossTradeRatio.toFixed(2)}x</div>
                          <div className="text-xs text-muted-foreground">Loss-Trade Ratio</div>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/30">
                          <div className="text-xl font-bold text-foreground">
                            {dna.h2hVsRod.wins}W-{dna.h2hVsRod.losses}L
                          </div>
                          <div className="text-xs text-muted-foreground">H2H vs Rod</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Draft Bias Table */}
                  <Card className="border-border bg-card/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-blue-400" />
                        Draft Position Biases vs League Average
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-3">
                        Negative = drafts earlier than league avg (overvalues). Positive = drafts later (undervalues).
                      </p>
                      <div className="space-y-2">
                        {(Object.entries(dna.biasVsLeague) as Array<[string, number]>)
                          .sort((a, b) => a[1] - b[1])
                          .map(([pos, bias]) => {
                            const isOver = bias < 0;
                            const pct = Math.min(100, Math.abs(bias) * 15);
                            return (
                              <div key={pos} className="flex items-center gap-3">
                                <span className="text-xs font-bold text-foreground w-8">{pos}</span>
                                <div className="flex-1 flex items-center gap-2">
                                  {isOver ? (
                                    <>
                                      <div className="flex-1 flex justify-end">
                                        <div
                                          className="h-2 rounded-full bg-red-500/70"
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                      <div className="w-px h-4 bg-border" />
                                      <div className="flex-1" />
                                    </>
                                  ) : (
                                    <>
                                      <div className="flex-1" />
                                      <div className="w-px h-4 bg-border" />
                                      <div className="flex-1">
                                        <div
                                          className="h-2 rounded-full bg-emerald-500/70"
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </>
                                  )}
                                </div>
                                <span className={`text-xs font-semibold w-20 text-right ${isOver ? "text-red-400" : "text-emerald-400"}`}>
                                  {bias > 0 ? "+" : ""}{bias.toFixed(1)} rds
                                </span>
                                <Badge variant="outline" className={`text-xs ${isOver ? "border-red-500/30 text-red-400" : "border-emerald-500/30 text-emerald-400"}`}>
                                  {isOver ? "OVERVALUES" : "UNDERVALUES"}
                                </Badge>
                              </div>
                            );
                          })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Exploit Windows */}
                  {dna.exploitWindows?.length > 0 && (
                    <Card className="border-yellow-500/30 bg-yellow-500/5">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Zap className="h-4 w-4 text-yellow-400" />
                          Exploit Windows
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {(dna.exploitWindows as string[]).map((window, i) => (
                          <div key={i} className="flex gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <ShieldAlert className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                            <p className="text-sm text-foreground leading-relaxed">{window}</p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Pick Trade History Summary */}
                  {(result as any).pickTradeHistory && (() => {
                    const pth = (result as any).pickTradeHistory;
                    return (
                      <Card className="border-orange-500/30 bg-orange-500/5">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-orange-400" />
                            Pick Trade Behavior
                            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs ml-auto">
                              {pth.tendencyLabel}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {/* Summary line */}
                          <p className="text-sm text-foreground leading-relaxed">{pth.summaryLine}</p>

                          {/* Stats grid */}
                          <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="p-3 rounded-lg bg-muted/30">
                              <div className="text-xl font-bold text-foreground">{pth.avgTradesPerSeason.toFixed(1)}</div>
                              <div className="text-xs text-muted-foreground">Avg Trades/Season</div>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30">
                              <div className="text-xl font-bold text-orange-400">{pth.lossTradeRatio.toFixed(2)}x</div>
                              <div className="text-xs text-muted-foreground">Loss-Trade Ratio</div>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30">
                              <div className="text-xl font-bold text-foreground">{pth.totalPicksHeld}</div>
                              <div className="text-xs text-muted-foreground">2026 Picks Held</div>
                            </div>
                          </div>

                          {/* Hot / Cold rounds */}
                          <div className="grid grid-cols-2 gap-3">
                            {pth.hotRounds.length > 0 && (
                              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                                <p className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-1.5">🔥 Most Tradable</p>
                                <div className="flex flex-wrap gap-1">
                                  {(pth.hotRounds as string[]).map((r: string) => (
                                    <Badge key={r} className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">{r}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            {pth.coldRounds.length > 0 && (
                              <div className="p-3 rounded-lg bg-slate-500/10 border border-slate-500/20">
                                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">❄️ Hardest to Get</p>
                                <div className="flex flex-wrap gap-1">
                                  {(pth.coldRounds as string[]).map((r: string) => (
                                    <Badge key={r} className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-xs">{r}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Desperation triggers */}
                          {pth.desperationTriggers >= 2 && (
                            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                              <Zap className="h-3.5 w-3.5 text-yellow-400 mt-0.5 shrink-0" />
                              <p className="text-xs text-foreground">
                                <span className="font-semibold text-yellow-400">Desperation Pattern: </span>
                                Has made panic trades in {pth.desperationTriggers} seasons after a bad start. Apply pressure early in the season.
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* DNA Summary */}
                  {dna.dnaSummary && (
                    <Card className="border-border bg-card/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Brain className="h-4 w-4 text-purple-400" />
                          Full DNA Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-foreground leading-relaxed">{dna.dnaSummary}</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              )}

              {/* GM Profile Tab */}
              {result.gmStyle && (
                <TabsContent value="gm" className="mt-4 space-y-4">
                  <Card className="border-border bg-card/50">
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Star className="h-4 w-4 text-yellow-400" />
                        {result.targetOwner}'s GM Profile
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-sm px-3 py-1">
                          {result.gmStyle.archetype}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {result.gmStyle.draftStyleBadge}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="p-3 rounded-lg bg-muted/30">
                          <div className="text-xl font-bold text-foreground">{result.gmStyle.avgTrades}</div>
                          <div className="text-xs text-muted-foreground">Avg Trades/Season</div>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/30">
                          <div className="text-xl font-bold text-emerald-400">{result.gmStyle.h2hVsRod.wins}</div>
                          <div className="text-xs text-muted-foreground">Wins vs Rod</div>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/30">
                          <div className="text-xl font-bold text-red-400">{result.gmStyle.h2hVsRod.losses}</div>
                          <div className="text-xs text-muted-foreground">Losses vs Rod</div>
                        </div>
                      </div>

                      {Array.isArray(result.gmStyle.strengthsWeaknesses) && result.gmStyle.strengthsWeaknesses.length > 0 && (
                        <div className="space-y-2">
                          {(result.gmStyle.strengthsWeaknesses as Array<{type: string; text: string}>)
                            .filter(sw => sw.type === "strength").slice(0, 1)
                            .map((sw, i) => (
                              <div key={i} className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                                <div className="text-xs font-semibold text-emerald-400 mb-1">STRENGTH</div>
                                <p className="text-sm text-foreground">{sw.text}</p>
                              </div>
                            ))}
                          {(result.gmStyle.strengthsWeaknesses as Array<{type: string; text: string}>)
                            .filter(sw => sw.type === "weakness").slice(0, 1)
                            .map((sw, i) => (
                              <div key={i} className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                                <div className="text-xs font-semibold text-red-400 mb-1">WEAKNESS</div>
                                <p className="text-sm text-foreground">{sw.text}</p>
                              </div>
                            ))}
                          {(result.gmStyle.strengthsWeaknesses as Array<{type: string; text: string}>)
                            .filter(sw => sw.type === "blindspot").slice(0, 1)
                            .map((sw, i) => (
                              <div key={i} className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                                <div className="text-xs font-semibold text-yellow-400 mb-1">BLIND SPOT</div>
                                <p className="text-sm text-foreground">{sw.text}</p>
                              </div>
                            ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {/* Full Analysis Tab */}
              <TabsContent value="analysis" className="mt-4">
                <Card className="border-border bg-card/50">
                  <CardHeader>
                    <CardTitle className="text-sm">Full Target Analysis</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {strategy && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Target Analysis</div>
                        <p className="text-sm text-foreground leading-relaxed">{strategy.targetAnalysis}</p>
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Value Basis</div>
                      <p className="text-sm text-foreground leading-relaxed">{result.targetValueBasis}</p>
                    </div>
                    {result.targetStats && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">2025 Stats Breakdown</div>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(result.targetStats.stats).slice(0, 8).map(([statId, val]) => (
                            <div key={statId} className="flex justify-between text-xs p-2 rounded bg-muted/20">
                              <span className="text-muted-foreground">Stat {statId}</span>
                              <span className="text-foreground font-medium">{String(val)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Empty state */}
        {!result && !mutation.isPending && (
          <Card className="border-dashed border-border bg-card/30">
            <CardContent className="py-12 text-center">
              <ArrowLeftRight className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground text-sm mb-1">Enter a player name or draft pick above to get started</p>
              <p className="text-xs text-muted-foreground">
                Try: "Tyreek Hill", "Lamar Jackson", "1.03", "2.07"
              </p>
              {/* DNA preview */}
              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-purple-400/70">
                <Dna className="h-3.5 w-3.5" />
                <span>Phase 3 DNA Intelligence will customize the AI strategy for the target owner's behavioral profile</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
