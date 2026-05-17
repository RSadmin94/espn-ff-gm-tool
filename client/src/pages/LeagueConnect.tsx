/**
 * LeagueConnect — Multi-provider league onboarding flow
 *
 * Step 1: Choose provider (ESPN / Sleeper / coming soon)
 * Step 2: Enter league credentials
 * Step 3: DNA generation progress screen ("Analyzing 18 seasons...")
 * Step 4: Success — league profile summary
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, Circle, Loader2, ChevronRight, ArrowLeft, ExternalLink, Zap, Lock, RefreshCw } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "choose_provider" | "enter_credentials" | "yahoo_pick_league" | "generating" | "success";
type Provider = "espn" | "sleeper" | "yahoo" | "nfl" | "fleaflicker" | "fantrax";

interface ProviderCard {
  id: Provider;
  name: string;
  emoji: string;
  description: string;
  authRequired: boolean;
  status: "live" | "coming_soon";
  instructions?: string;
}

const PROVIDERS: ProviderCard[] = [
  {
    id: "sleeper",
    name: "Sleeper",
    emoji: "😴",
    description: "Modern platform with a public API. No login needed — just your league ID.",
    authRequired: false,
    status: "live",
    instructions: "Find your league ID in the Sleeper app: tap your league → Settings → League ID.",
  },
  {
    id: "espn",
    name: "ESPN Fantasy",
    emoji: "🏈",
    description: "The most popular fantasy platform. Requires SWID + espn_s2 cookies.",
    authRequired: true,
    status: "live",
    instructions: "Log into ESPN Fantasy → DevTools (F12) → Application → Cookies → copy SWID and espn_s2.",
  },
  {
    id: "yahoo",
    name: "Yahoo Fantasy",
    emoji: "🟣",
    description: "Yahoo Sports fantasy leagues. Connect via Yahoo OAuth — no cookies needed.",
    authRequired: true,
    status: "live",
    instructions: "Click \"Connect Yahoo\" to authorize via Yahoo. You'll be redirected to Yahoo to grant access, then returned here to pick your league.",
  },
  {
    id: "nfl",
    name: "NFL Fantasy",
    emoji: "🏟️",
    description: "The official NFL fantasy platform. Coming soon.",
    authRequired: true,
    status: "coming_soon",
  },
  {
    id: "fleaflicker",
    name: "Fleaflicker",
    emoji: "🦟",
    description: "Highly customizable platform with a public API. Coming soon.",
    authRequired: false,
    status: "coming_soon",
  },
  {
    id: "fantrax",
    name: "Fantrax",
    emoji: "🎯",
    description: "Advanced scoring and deep customization. Coming soon.",
    authRequired: true,
    status: "coming_soon",
  },
];

// ─── DNA progress steps ───────────────────────────────────────────────────────

const DNA_STEPS = [
  "Reading 9 seasons of league history…",
  "Profiling 14 managers…",
  "Computing rivalries and trade patterns…",
  "Generating your League DNA…",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function LeagueConnect() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("choose_provider");
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [leagueId, setLeagueId] = useState("");
  const [username, setUsername] = useState("");
  const [sleeperLeagues, setSleeperLeagues] = useState<Array<{ leagueId: string; name: string; season: string; teamCount: number; status: string }>>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [progressStep, setProgressStep] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const [result, setResult] = useState<{
    leagueName: string;
    teamCount: number;
    scoringType: string;
    matchupCount: number;
    transactionCount: number;
    dnaProfile: unknown;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Yahoo state
  const [yahooLeagues, setYahooLeagues] = useState<Array<{ leagueKey: string; leagueId: string; name: string; season: string; teamCount: number }>>([]);
  const [selectedYahooLeagueId, setSelectedYahooLeagueId] = useState("");
  const [selectedYahooLeagueName, setSelectedYahooLeagueName] = useState("");
  // ESPN state
  const [espnLeagueId, setEspnLeagueId] = useState("");
  const [espnSwid, setEspnSwid] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [espnPreviewReady, setEspnPreviewReady] = useState(false);
  // Fetch existing leagues to detect add-league vs first-time mode
  const myLeaguesQuery = trpc.league.getMyLeagues.useQuery(undefined, { enabled: !!user });
  const isAddLeagueMode = (myLeaguesQuery.data?.length ?? 0) > 0;
  // Preview ESPN league name when all 3 fields are filled
  const espnPreviewQuery = trpc.providers.previewEspnLeague.useQuery(
    { leagueId: espnLeagueId.trim(), swid: espnSwid.trim(), espnS2: espnS2.trim(), season: 2025 },
    { enabled: espnPreviewReady && !!espnLeagueId.trim() && !!espnSwid.trim() && !!espnS2.trim() }
  );
  // Check if Yahoo OAuth is configured
  const yahooConfigured = trpc.providers.isYahooConfigured.useQuery();
  // Check if we have a pending Yahoo auth (post-callback)
  const yahooPendingAuth = trpc.providers.getYahooPendingAuth.useQuery(
    undefined,
    { enabled: !!user }
  );
  // Get Yahoo auth URL
  const yahooAuthUrlQuery = trpc.providers.getYahooAuthUrl.useQuery(
    { origin: typeof window !== "undefined" ? window.location.origin : "" },
    { enabled: !!user && !!yahooConfigured.data?.configured }
  );
  // Get Yahoo leagues (after auth)
  const yahooLeaguesQuery = trpc.providers.getYahooLeagues.useQuery(
    { season: 2025 },
    { enabled: false }
  );
  // Import Yahoo league mutation
  const importYahooMutation = trpc.providers.importYahooLeague.useMutation({
    onSuccess: (data) => {
      setResult({
        leagueName: data.league.leagueName,
        teamCount: data.league.teamCount,
        scoringType: data.league.scoringType,
        matchupCount: data.matchupCount,
        transactionCount: data.transactionCount,
        dnaProfile: data.dnaProfile,
      });
      setProgressPct(100);
      setProgressStep(DNA_STEPS.length - 1);
      setTimeout(() => navigate("/reveal"), 800);
    },
    onError: (err) => {
      setError(err.message);
      setStep("yahoo_pick_league");
    },
  });
  // Detect Yahoo OAuth callback (yahoo_auth=success in URL)
  // Also detect ESPN credential auto-fill from Chrome extension (?provider=espn&leagueId=...&swid=...&s2=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("yahoo_auth") === "success") {
      setSelectedProvider("yahoo");
      setStep("yahoo_pick_league");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("yahoo_error")) {
      setError(`Yahoo authorization failed: ${params.get("yahoo_error")}`);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("provider") === "espn") {
      // Extension auto-fill: pre-populate ESPN credential fields and jump to the form
      const lid  = params.get("leagueId") || "";
      const swid = params.get("swid") || "";
      const s2   = params.get("s2") || "";
      if (lid || swid || s2) {
        setSelectedProvider("espn");
        if (lid)  setEspnLeagueId(lid);
        if (swid) setEspnSwid(swid);
        if (s2)   setEspnS2(s2);
        setStep("enter_credentials");
        // Auto-trigger preview since all fields are filled by the extension
        if (lid && swid && s2) setEspnPreviewReady(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, []);
  const handleYahooConnect = () => {
    if (!user) {
      window.location.href = getLoginUrl();
      return;
    }
    const authUrl = yahooAuthUrlQuery.data?.url;
    if (authUrl) {
      window.location.href = authUrl;
    }
  };
  const handleYahooLoadLeagues = async () => {
    const res = await yahooLeaguesQuery.refetch();
    if (res.data?.leagues) {
      setYahooLeagues(res.data.leagues);
    } else if (res.data?.error) {
      setError(res.data.error);
    }
  };
  const handleYahooImport = () => {
    const id = selectedYahooLeagueId;
    if (!id) {
      setError("Please select a league");
      return;
    }
    setError(null);
    setStep("generating");
    setProgressStep(0);
    setProgressPct(0);
    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step < DNA_STEPS.length - 1) {
        setProgressStep(step);
        setProgressPct(Math.round((step / (DNA_STEPS.length - 1)) * 85));
      } else {
        clearInterval(interval);
      }
    }, 900);
    importYahooMutation.mutate({
      leagueId: id,
      leagueName: selectedYahooLeagueName,
      season: 2025,
    });
  };
  // Sleeper username lookupp
  const sleeperUserQuery = trpc.providers.getSleeperLeaguesForUser.useQuery(
    { username, season: 2025 },
    { enabled: false }
  );

  // Sleeper league validation
  const sleeperValidate = trpc.providers.validateSleeperLeague.useQuery(
    { leagueId: selectedLeagueId || leagueId },
    { enabled: false }
  );

  // Import mutation
  const importEspnMutation = trpc.providers.importEspnLeague.useMutation({
    onSuccess: (data) => {
      setResult({
        leagueName: data.league.leagueName,
        teamCount: data.league.teamCount,
        scoringType: "ESPN",
        matchupCount: 0,
        transactionCount: 0,
        dnaProfile: null,
      });
      setProgressPct(100);
      setProgressStep(DNA_STEPS.length - 1);
      // If user already had leagues, go straight to the app (not the reveal/onboarding page)
      const hadLeagues = (myLeaguesQuery.data?.length ?? 0) > 0;
      setTimeout(() => navigate(hadLeagues ? "/" : "/reveal"), 800);
    },
    onError: (err) => {
      setError(err.message || "ESPN import failed");
      setStep("enter_credentials");
    },
  });
  const importMutation = trpc.providers.importSleeperLeague.useMutation({
    onSuccess: (data) => {
      setResult({
        leagueName: data.league.leagueName,
        teamCount: data.league.teamCount,
        scoringType: data.league.scoringType,
        matchupCount: data.matchupCount,
        transactionCount: data.transactionCount,
        dnaProfile: data.dnaProfile,
      });
      setProgressPct(100);
      setProgressStep(DNA_STEPS.length - 1);
      setTimeout(() => navigate("/reveal"), 800);
    },
    onError: (err) => {
      setError(err.message);
      setStep("enter_credentials");
    },
  });

  const handleProviderSelect = (provider: ProviderCard) => {
    if (provider.status === "coming_soon") return;
    // Require login for providers that need auth
    if (provider.authRequired && !user) {
      window.location.href = getLoginUrl();
      return;
    }
    setSelectedProvider(provider.id);
    setError(null);
    if (provider.id === "yahoo") {
      // Yahoo uses OAuth — redirect to Yahoo authorization
      if (!user) {
        window.location.href = getLoginUrl();
        return;
      }
      const authUrl = yahooAuthUrlQuery.data?.url;
      if (authUrl) {
        window.location.href = authUrl;
      } else if (!yahooConfigured.data?.configured) {
        setError("Yahoo OAuth is not yet configured on this server. Please add YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in Settings.");
      } else {
        setError("Could not get Yahoo authorization URL. Please try again.");
      }
      return;
    }
    setStep("enter_credentials");
  };

  const handleSleeperLookup = async () => {
    if (!username.trim()) return;
    const res = await sleeperUserQuery.refetch();
    if (res.data?.found && res.data.leagues) {
      setSleeperLeagues(res.data.leagues);
    } else {
      setError(res.data?.error || "User not found");
    }
  };

  const handleImport = async () => {
    const id = selectedLeagueId || leagueId;
    if (!id.trim()) {
      setError("Please enter a league ID");
      return;
    }
    setError(null);
    setStep("generating");
    setProgressStep(0);
    setProgressPct(0);

    // Animate progress steps
    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step < DNA_STEPS.length - 1) {
        setProgressStep(step);
        setProgressPct(Math.round((step / (DNA_STEPS.length - 1)) * 85));
      } else {
        clearInterval(interval);
      }
    }, 900);

    importMutation.mutate({ leagueId: id, season: 2025 });
  };

  // ── Step: Choose provider ──────────────────────────────────────────────────
  if (step === "choose_provider") {
    return (
      <div className="min-h-screen bg-background">
        {/* Top auth bar */}
        <div className="border-b border-border bg-card/50 px-6 py-2.5 flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">GM War Room</span>
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                Signed in as <strong className="text-foreground">{user.name ?? user.email}</strong>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => window.location.href = "/"}
              >
                ← Back to app
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Not signed in</span>
              <Button
                size="sm"
                className="text-xs h-7 gap-1.5"
                onClick={() => (window.location.href = getLoginUrl())}
              >
                Sign In
              </Button>
            </div>
          )}
        </div>
        <div className="max-w-4xl mx-auto px-4 py-12">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium mb-4">
              <Zap className="w-4 h-4" />
              Multi-Platform Intelligence
            </div>
            <h1 className="text-4xl font-bold tracking-tight mb-3">Connect Your League</h1>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Import your fantasy league to unlock DNA profiling, weekly assessments, trade analysis, and championship equity modeling.
            </p>
          </div>

          {/* Provider grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProviderSelect(p)}
                disabled={p.status === "coming_soon"}
                className={`
                  relative text-left rounded-xl border p-5 transition-all duration-200
                  ${p.status === "coming_soon"
                    ? "opacity-50 cursor-not-allowed border-border bg-card"
                    : "cursor-pointer border-border bg-card hover:border-primary hover:shadow-lg hover:shadow-primary/10 hover:-translate-y-0.5"
                  }
                `}
              >
                {p.status === "coming_soon" && (
                  <div className="absolute top-3 right-3">
                    <Badge variant="secondary" className="text-xs">Soon</Badge>
                  </div>
                )}
                {p.status === "live" && (
                  <div className="absolute top-3 right-3">
                    <Badge className="text-xs bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Live</Badge>
                  </div>
                )}
                <div className="text-3xl mb-3">{p.emoji}</div>
                <div className="font-semibold text-foreground mb-1">{p.name}</div>
                <div className="text-sm text-muted-foreground leading-relaxed">{p.description}</div>
                {p.authRequired && p.status === "live" && (
                  <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                    <Lock className="w-3 h-3" />
                    Credentials required
                  </div>
                )}
                {!p.authRequired && p.status === "live" && (
                  <div className="flex items-center gap-1 mt-3 text-xs text-emerald-400">
                    <CheckCircle className="w-3 h-3" />
                    No login needed
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Auth prompt */}
          {!user && (
            <Alert className="mt-8 border-primary/30 bg-primary/5">
              <AlertDescription className="flex items-center justify-between">
                <span className="text-sm">Sign in to save your league connection and access the full intelligence stack.</span>
                <Button size="sm" variant="outline" asChild>
                  <a href={getLoginUrl()}>Sign In</a>
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    );
  }

  // ── Step: Enter credentials (Sleeper) ─────────────────────────────────────
  if (step === "enter_credentials" && selectedProvider === "sleeper") {
    const provider = PROVIDERS.find(p => p.id === "sleeper")!;
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <button
            onClick={() => { setStep("choose_provider"); setError(null); }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to providers
          </button>

          <div className="flex items-center gap-3 mb-8">
            <div className="text-4xl">{provider.emoji}</div>
            <div>
              <h2 className="text-2xl font-bold">{provider.name}</h2>
              <p className="text-muted-foreground text-sm">{provider.description}</p>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Import Your Sleeper League</CardTitle>
              <CardDescription>
                {provider.instructions}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Option A: Username lookup */}
              <div>
                <div className="text-sm font-medium mb-2">Option 1 — Find by Sleeper username</div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Your Sleeper username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSleeperLookup()}
                  />
                  <Button
                    variant="outline"
                    onClick={handleSleeperLookup}
                    disabled={sleeperUserQuery.isFetching}
                  >
                    {sleeperUserQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Look up"}
                  </Button>
                </div>
              </div>

              {/* League list from username lookup */}
              {sleeperLeagues.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">Select a league:</div>
                  {sleeperLeagues.map((l) => (
                    <button
                      key={l.leagueId}
                      onClick={() => setSelectedLeagueId(l.leagueId)}
                      className={`
                        w-full text-left rounded-lg border p-3 transition-all
                        ${selectedLeagueId === l.leagueId
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50"
                        }
                      `}
                    >
                      <div className="font-medium text-sm">{l.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {l.season} · {l.teamCount} teams · {l.status}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <Separator />

              {/* Option B: Direct league ID */}
              <div>
                <div className="text-sm font-medium mb-2">Option 2 — Enter league ID directly</div>
                <Input
                  placeholder="e.g. 917324820394872832"
                  value={leagueId}
                  onChange={(e) => setLeagueId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleImport()}
                />
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleImport}
                disabled={(!leagueId.trim() && !selectedLeagueId) || importMutation.isPending}
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    Generate League DNA
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Step: ESPN enter credentials ─────────────────────────────────────────
  if (step === "enter_credentials" && selectedProvider === "espn") {
    const provider = PROVIDERS.find(p => p.id === "espn")!;

    // Extract league ID from a full ESPN URL or accept a bare ID
    const extractLeagueId = (input: string): string => {
      const trimmed = input.trim();
      // Try to extract from URL: ?leagueId=XXXXX or /league/XXXXX
      const urlMatch = trimmed.match(/[?&/]leagueId[=/](\d+)/i) || trimmed.match(/(\d{5,})/); 
      return urlMatch ? urlMatch[1] : trimmed;
    };

    const [espnUrlInput, setEspnUrlInput] = useState("");
    const derivedLeagueId = extractLeagueId(espnUrlInput || espnLeagueId);

    const handleEspnImport = () => {
      const lid = derivedLeagueId;
      if (!lid) { setError("Please enter your ESPN league URL or ID"); return; }
      setEspnLeagueId(lid);
      setError(null);
      setStep("generating");
      setProgressStep(0);
      setProgressPct(0);
      let espnStep = 0;
      const espnInterval = setInterval(() => {
        espnStep++;
        if (espnStep < DNA_STEPS.length - 1) {
          setProgressStep(espnStep);
          setProgressPct(Math.round((espnStep / (DNA_STEPS.length - 1)) * 85));
        } else {
          clearInterval(espnInterval);
        }
      }, 900);
      // Pass cookies only if auto-filled by extension; otherwise backend uses env vars
      importEspnMutation.mutate({
        leagueId: lid,
        swid: espnSwid.trim() || undefined,
        espnS2: espnS2.trim() || undefined,
        season: 2025,
      });
    };
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <button
            onClick={() => { setStep("choose_provider"); setError(null); setEspnPreviewReady(false); }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {isAddLeagueMode ? "Back to providers" : "Back to providers"}
          </button>

          {/* Add-league mode banner */}
          {isAddLeagueMode && (
            <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 text-sm text-primary flex items-start gap-2 mb-6">
              <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <strong>Adding a second league.</strong>{" "}
                Your existing leagues stay connected. After connecting, you can switch between them in the sidebar.
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 mb-8">
            <div className="text-4xl">{provider.emoji}</div>
            <div>
              <h2 className="text-2xl font-bold">{isAddLeagueMode ? "Add Another ESPN League" : provider.name}</h2>
              <p className="text-muted-foreground text-sm">{provider.description}</p>
            </div>
          </div>
          {importEspnMutation.error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{importEspnMutation.error.message}</AlertDescription>
            </Alert>
          )}
          {error && !importEspnMutation.error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{isAddLeagueMode ? "Add Another ESPN League" : "Connect Your ESPN League"}</CardTitle>
              <CardDescription>
                Paste your ESPN Fantasy Football league URL or just the league ID.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {(espnSwid || espnS2) && (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-sm text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <strong>Credentials auto-filled by the DNA Advisor extension.</strong>{" "}
                    Verify your league URL below and click Connect.
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">ESPN League URL or ID</label>
                <Input
                  placeholder="https://fantasy.espn.com/football/league?leagueId=457622"
                  value={espnUrlInput || espnLeagueId}
                  onChange={e => {
                    setEspnUrlInput(e.target.value);
                    setEspnLeagueId("");
                    setEspnPreviewReady(false);
                  }}
                  disabled={importEspnMutation.isPending}
                  className="text-sm"
                />
                {derivedLeagueId && (espnUrlInput.length > 10) && (
                  <p className="text-xs text-emerald-500 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    League ID detected: <strong>{derivedLeagueId}</strong>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Paste your full ESPN league URL or just the numeric ID (e.g. <strong>457622</strong>).
                </p>
              </div>

              <Button
                onClick={handleEspnImport}
                disabled={!derivedLeagueId || importEspnMutation.isPending}
                className="w-full"
              >
                {importEspnMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Validating & Connecting...</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" />{isAddLeagueMode ? "Add This League" : "Connect ESPN League"}</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  // ── Step: Yahoo pick league ───────────────────────────────────────────────
  if (step === "yahoo_pick_league") {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <button
            onClick={() => { setStep("choose_provider"); setError(null); }}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to providers
          </button>
          <div className="flex items-center gap-3 mb-8">
            <div className="text-4xl">🟣</div>
            <div>
              <h2 className="text-2xl font-bold">Yahoo Fantasy</h2>
              <p className="text-muted-foreground text-sm">Select the league you want to import</p>
            </div>
          </div>
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Your Yahoo Leagues</CardTitle>
              <CardDescription>
                {yahooPendingAuth.data?.hasPendingAuth
                  ? "Yahoo authorization successful. Load your leagues below."
                  : "Authorization complete. Select a league to import."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {yahooLeagues.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground mb-4">
                    Click below to fetch your Yahoo Fantasy leagues for the 2025 season.
                  </p>
                  <Button
                    onClick={handleYahooLoadLeagues}
                    disabled={yahooLeaguesQuery.isFetching}
                    variant="outline"
                  >
                    {yahooLeaguesQuery.isFetching ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading leagues...</>
                    ) : (
                      <><RefreshCw className="w-4 h-4 mr-2" />Load My Yahoo Leagues</>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground mb-3">Select a league to import:</div>
                  {yahooLeagues.map((l) => (
                    <button
                      key={l.leagueKey}
                      onClick={() => { setSelectedYahooLeagueId(l.leagueKey); setSelectedYahooLeagueName(l.name); }}
                      className={`
                        w-full text-left rounded-lg border p-3 transition-all
                        ${selectedYahooLeagueId === l.leagueKey
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50"
                        }
                      `}
                    >
                      <div className="font-medium text-sm">{l.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {l.season} · {l.teamCount} teams
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {yahooLeagues.length > 0 && (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleYahooImport}
                  disabled={!selectedYahooLeagueId || importYahooMutation.isPending}
                >
                  {importYahooMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
                  ) : (
                    <>Generate League DNA <ChevronRight className="w-4 h-4 ml-2" /></>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  // ── Step: Generating DNA ───────────────────────────────────────────────────
  if (step === "generating") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-lg w-full mx-auto px-4">
          <div className="text-center mb-10">
            <div className="text-5xl mb-4 animate-pulse">🧬</div>
            <h2 className="text-2xl font-bold mb-2">Generating League DNA</h2>
            <p className="text-muted-foreground text-sm">
              Analyzing manager behavior, trade patterns, and roster tendencies...
            </p>
          </div>

          {/* Progress bar */}
          <div className="mb-8">
            <Progress value={progressPct} className="h-2 mb-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{progressPct}% complete</span>
              <span>{DNA_STEPS.length} analysis steps</span>
            </div>
          </div>

          {/* Steps list */}
          <div className="space-y-3">
            {DNA_STEPS.map((s, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 text-sm transition-all duration-300 ${
                  i < progressStep
                    ? "text-emerald-400"
                    : i === progressStep
                    ? "text-foreground"
                    : "text-muted-foreground/40"
                }`}
              >
                {i < progressStep ? (
                  <CheckCircle className="w-4 h-4 shrink-0" />
                ) : i === progressStep ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                ) : (
                  <Circle className="w-4 h-4 shrink-0" />
                )}
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Step: Success ──────────────────────────────────────────────────────────
  if (step === "success" && result) {
    const dna = result.dnaProfile as {
      leagueSummary?: string;
      teamProfiles?: Array<{
        ownerName: string;
        archetype: string;
        desperationScore: number;
        exploitabilityScore: number;
        keyTrait: string;
      }>;
    } | null;

    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-12">
          {/* Success header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-3xl font-bold mb-2">League DNA Generated</h2>
            <p className="text-muted-foreground">
              {result.leagueName} · {result.teamCount} teams · {result.scoringType}
            </p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[
              { label: "Teams Analyzed", value: result.teamCount },
              { label: "Matchups Processed", value: result.matchupCount },
              { label: "Transactions Mapped", value: result.transactionCount },
            ].map((stat) => (
              <Card key={stat.label} className="text-center">
                <CardContent className="pt-4 pb-4">
                  <div className="text-2xl font-bold text-primary">{stat.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* League summary */}
          {dna?.leagueSummary && (
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">League Intelligence Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">{dna.leagueSummary}</p>
              </CardContent>
            </Card>
          )}

          {/* Team DNA profiles */}
          {dna?.teamProfiles && dna.teamProfiles.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Manager DNA Profiles</CardTitle>
                <CardDescription>Behavioral archetypes and exploitability scores</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dna.teamProfiles.map((t, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{t.ownerName}</div>
                        <div className="text-xs text-muted-foreground">{t.keyTrait}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <Badge variant="outline" className="text-xs whitespace-nowrap">
                          {t.archetype}
                        </Badge>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Exploit</div>
                          <div className={`text-sm font-bold ${
                            t.exploitabilityScore >= 70 ? "text-red-400" :
                            t.exploitabilityScore >= 40 ? "text-amber-400" :
                            "text-emerald-400"
                          }`}>
                            {t.exploitabilityScore}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex gap-3 mt-8">
            <Button className="flex-1" onClick={() => navigate("/weekly-intelligence")}>
              Open Weekly Intelligence Hub
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStep("choose_provider");
                setResult(null);
                setLeagueId("");
                setUsername("");
                setSelectedLeagueId("");
                setSleeperLeagues([]);
              }}
            >
              Connect Another League
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
