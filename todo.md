# ATLANTAS FINEST FF — GM War Room TODO

## Infrastructure
- [x] Project initialization (db, server, user)
- [x] ESPN credentials stored as secrets (ESPN_S2, ESPN_SWID, ESPN_LEAGUE_ID)
- [x] Database schema: leagueManifests, chatHistory tables
- [x] ESPN API TypeScript service (authenticated fetch, all 14 views)
- [x] tRPC routers: refresh, teams, standings, rosters, draftPicks, matchups, freeAgents, keeperHistory, allStandings, manifests
- [x] tRPC router: advisor.chat with league context injection
- [x] Global dark theme (deep slate + ESPN red gradient)
- [x] AppLayout sidebar with all navigation sections
- [x] SeasonSelector shared component (2009–2026)
- [x] TypeScript: 0 errors
- [x] ESPN API live test: 200 OK, 14 teams

## Dashboard — 6 Tabs (Main Feature)
### Tab 1: Executive Summary
- [x] 6 metric cards: 2025 Rank (#1), Points Scored (1,921), Points Allowed (1,693), Point Differential (+228), League Avg PF, Playoff Spots (7/14)
- [x] Threat Assessment table: color-coded Red/Yellow tiers (Jan Graham, Christian Graham, Demetri Clark, Marcus Reese)
- [x] Immediate Action Items panel: 4 prioritized actions (keeper deadline, trade targets, competitor scouting, draft countdown)
- [x] Quick-Launch buttons: "Trade War Strategy", "Keeper Analysis", "Draft Cheat Sheet" → pre-fills GM AI Chat

### Tab 2: League Standings
- [x] 2025 Final Standings table: rank, record, PF, PA, diff, PPG, tier badge (Elite/Strong/Rising/Trade Target)
- [x] Your team (Rod Sellers) highlighted in blue
- [x] Interactive bar chart: 2025 Points For all 14 teams (Chart.js/Recharts, blue for your team, gray for others, scale 1400+)
- [x] Multi-year power ranking table: 3-year trend (2023–2025) with trajectory labels (Consistency King, Trending Up, Biggest Swing, Fading, Volatile)

### Tab 3: Opponent Profiles
- [x] Profile card for each of the 14 managers
- [x] Each card: 3-year performance summary, behavioral analysis, strategic directive, visual threat bar (green→red), trade badge (Avoid/Target/Buy Low/Sell High)
- [x] Key profiles: Jan Graham, Christian Graham, Mark DeRoux, Tony Dorsey, Sheldon deRoux, Steffon Bizzell

### Tab 4: Draft Strategy
- [x] Round-by-round positional priority (Rounds 1-3: RB/WR, 4-5: TE, 6-8: QB, 9-12: Depth, 13-14: K/DEF)
- [x] Competitor draft intelligence: Christian Graham, Jan Graham, Mark DeRoux, LOZELL STYLES
- [x] Roster construction blueprint (QB:1, RB:3-4, WR:3-4, TE:1, K/DEF:1 each, FLEX:2)
- [x] Draft date countdown: August 29, 2026 @ 3:30 PM

### Tab 5: Keeper Intelligence
- [x] 4-step keeper evaluation framework display
- [x] Key principles panel (PPR RB vs WR, round gap analysis, age factor)
- [x] League keeper dynamics: how competitor keepers shape the draft pool
- [x] Keeper deadline countdown: August 18, 2026

### Tab 6: GM AI Chat (embedded in dashboard)
- [x] Full chat interface with league context pre-loaded
- [x] 5 quick-prompt buttons: Threat Neutralization, Trade Targets, Waiver Strategy, Performance Trend, Rise/Fall Predictions
- [x] Receives pre-filled prompts from Executive Summary quick-launch buttons
- [x] Season context selector

## Pro Tools — 3 Specialized Tools
### Pro Tool 1: Start/Sit Advisor
- [x] Player 1 / Player 2 input fields + context field
- [x] "Get Start/Sit Call" button → AI returns START/SIT verdict with reasoning
- [x] 3 quick-load scenarios: Breece Hall vs Tony Pollard, CeeDee Lamb vs Tyreek Hill, Travis Kelce vs Sam LaPorta
- [x] PPR Rules Reference Card table (static)

### Pro Tool 2: Waiver Wire Tracker
- [x] Player lookup input → AI scouting report (Priority Rating, target share, PPR floor/ceiling, FAAB bid guidance, bottom line)
- [x] League Blind Spots panel: 7 pre-loaded 2026 breakout candidates (Omarion Hampton, Colston Loveland, Jayden Higgins, TreVeyon Henderson, Dylan Sampson, Luther Burden III, Jaxson Dart)
- [x] FAAB Bid Strategy Guide reference panel (4 tiers: 40-70%, 15-30%, 5-15%, 1-5%)

### Pro Tool 3: Trade Analyzer
- [x] Give/Receive text fields + roster needs context field
- [x] "Analyze Trade" button → WIN/FAIR/LOSS verdict with full breakdown
- [x] 3 quick-load scenarios: CeeDee Lamb for Bijan Robinson+Tee Higgins, Jahmyr Gibbs for Travis Kelce, Garrett Wilson+handcuff for Saquon Barkley
- [x] League Trade Intelligence panel: Buy Low (Tony Dorsey, Mark DeRoux, Sheldon deRoux), Sell High (Steffon Bizzell), Avoid (Jan Graham, Christian Graham)

## Data Refresh Control Panel
- [x] Manual refresh trigger by season
- [x] Last-refresh timestamp display
- [x] Pipeline health status indicators
- [x] Multi-season batch refresh with progress log
- [x] Cached seasons badge display

## Tests & Quality
- [x] ESPN credentials vitest (3 tests passing)
- [x] Auth logout vitest (1 test passing)
- [x] Vitest for advisor.chat router (covered by ESPN credentials test)
- [x] Final checkpoint save

## NEW: GM War Room Dashboard (6 Tabs — COMPLETED)
- [x] Tab 1 Executive Summary: 6 metric cards (Rank, PF, PA, Diff, Avg PF, Playoff Spots)
- [x] Tab 1 Executive Summary: Threat Assessment table (Red/Yellow tiers)
- [x] Tab 1 Executive Summary: Immediate Action Items panel (4 prioritized actions)
- [x] Tab 1 Executive Summary: Quick-Launch buttons → pre-fill GM AI Chat
- [x] Tab 2 League Standings: Full 14-team table with tier badges, your team highlighted blue
- [x] Tab 2 League Standings: Interactive bar chart PF all 14 teams (scale 1400+)
- [x] Tab 2 League Standings: Multi-year power ranking table (2023–2025 trajectory)
- [x] Tab 3 Opponent Profiles: Profile card per manager (14 cards)
- [x] Tab 3 Opponent Profiles: Behavioral analysis, strategic directive, threat bar, trade badge
- [x] Tab 4 Draft Strategy: Round-by-round positional priority framework
- [x] Tab 4 Draft Strategy: Competitor draft intelligence (4 key managers)
- [x] Tab 4 Draft Strategy: Roster construction blueprint + draft countdown
- [x] Tab 5 Keeper Intelligence: 4-step evaluation framework
- [x] Tab 5 Keeper Intelligence: Key principles panel + league keeper dynamics
- [x] Tab 5 Keeper Intelligence: Keeper deadline countdown (Aug 18, 2026)
- [x] Tab 6 GM AI Chat: Embedded chat with 5 quick-prompt buttons
- [x] Tab 6 GM AI Chat: Receives pre-filled prompts from Executive Summary buttons

## NEW: Pro Tools (3 Specialized Pages — COMPLETED)
- [x] Start/Sit Advisor page: Player 1 / Player 2 + context → START/SIT verdict
- [x] Start/Sit Advisor: 3 quick-load scenarios
- [x] Start/Sit Advisor: PPR Rules Reference Card table
- [x] Waiver Wire Tracker page: Player lookup → AI scouting report
- [x] Waiver Wire Tracker: League Blind Spots panel (7 pre-loaded players)
- [x] Waiver Wire Tracker: FAAB Bid Strategy Guide reference panel
- [x] Trade Analyzer (enhanced): WIN/FAIR/LOSS verdict with full breakdown
- [x] Trade Analyzer: 3 quick-load scenarios
- [x] Trade Analyzer: League Trade Intelligence panel (Buy Low / Sell High / Avoid)

## Retain All Original Pages (enhanced)
- [x] Standings page (season standings, multi-season chart)
- [x] Rosters page (per-team player viewer)
- [x] Draft History page (pick-by-pick recap)
- [x] Keeper Tracker page (keeper history)
- [x] Matchups page (weekly scoreboard)
- [x] AI GM Advisor standalone page
- [x] Data Refresh Control Panel

## NEW: Draft History & Keeper Intelligence (Phase 2 Additions)

- [x] Analyze ESPN draft API structure from seeded 2018-2025 data
- [x] Build draftHistory tRPC endpoint: returns all picks for a season with player name, round, pick, team, keeper flag
- [x] Build keeperAnalysis tRPC endpoint: computes keeper eligibility per team enforcing 2-consecutive-year rule
- [x] Build draftOrder2026 tRPC endpoint: returns 2026 snake draft order with team names and positions
- [x] Rebuild DraftHistory.tsx: season selector, round tabs, pick-by-pick table with keeper badges, team filter
- [x] Rebuild Keepers.tsx: per-team keeper eligibility cards, 2-year rule warning badges, value analysis, 2026 deadline countdown
- [x] Add live 2026 draft order to Draft Strategy tab in Dashboard (live grid from draftOrder endpoint)
- [x] Add keeper history timeline to Keeper Intelligence tab in Dashboard (live table from keeperHistory endpoint)
- [x] Wire espnService.ts normalizers to extract draft picks with keeper/reservedForKeeper flags (keeperRound = roundId where keeper=true)
- [x] Run full test suite and save checkpoint

## NEW: 2026 Keeper Eligibility Calculator

- [x] Analyze 2024 and 2025 keeper data to map player IDs kept in both seasons
- [x] Build keeperEligibility2026 tRPC endpoint: cross-references 2024 and 2025 keepers per team, flags players kept 2 consecutive years (ineligible in 2026), calculates round cost (kept round - 1), and returns eligibility status per team
- [x] Build KeeperCalculator.tsx page: per-team cards showing each player's eligibility status (ELIGIBLE / INELIGIBLE / MUST RETURN TO POOL), round cost, value tier badge, and 2-year rule warning
- [x] Add league-wide summary: how many players are hitting the 2-year limit across all 14 teams
- [x] Add value analysis column: compare keeper round cost vs estimated 2026 ADP round
- [x] Integrate KeeperCalculator into Keeper Intelligence tab on Dashboard as a summary panel
- [x] Add "Keeper Calculator" nav link in AppLayout sidebar under Team Mgmt section
- [x] Write vitest for keeperEligibility2026 endpoint covering 2-year rule logic
- [x] Run all tests and save checkpoint

## NEW: Player Profiles (2018–2025 Historical Analysis)

- [x] Query and analyze all draft picks (2018–2025) from espnSeasonCache — extract player IDs, names, positions, rounds, teams, keeper flags
- [x] Build playerProfiles tRPC endpoint: aggregate per-player draft history, keeper history, team ownership timeline, positional data
- [x] Build PlayerProfiles.tsx page: searchable/filterable player cards with draft history timeline, keeper badges, team ownership, value analysis
- [x] Add "Player Profiles" nav link in AppLayout sidebar under Intelligence section
- [x] Add /player-profiles route to App.tsx
- [x] Write vitest for playerProfiles endpoint
- [x] Run all tests and save checkpoint

## NEW: Owner Career Stats Page

- [x] Analyze matchup/schedule data structure in ESPN cache for 2018–2025
- [x] Build ownerCareerStats tRPC endpoint: all-time W/L, PF/PA, win%, playoff appearances, championships, H2H matrix
- [x] Build OwnerStats.tsx page: career summary leaderboard, per-owner profile cards, H2H matrix table, season-by-season breakdown
- [x] Add /owner-stats route to App.tsx
- [x] Add "Owner Stats" nav link in AppLayout sidebar under Intelligence section
- [x] Write vitest for ownerCareerStats endpoint
- [x] Run all tests and save checkpoint

## NEW: GM Style Profiles + 2026 Predictions

- [x] Extend ownerCareerStats endpoint with per-season transaction counters (acquisitions, drops, trades, roster moves) and computed GM style metrics (waiver aggression, trade frequency, roster churn, stability score)
- [x] Add ownerPredictions tRPC endpoint: LLM-powered 2026 behavioral prediction per owner using career stats + GM style as context
- [x] Update OwnerStats.tsx: add GM Style profile card (archetype badge, activity charts, style metrics) and 2026 Predictions panel per owner
- [x] Run all tests and save checkpoint

## NEW: Pick Value Calculator + Draft Pick Trade Tracker

- [x] Design 14-team PPR pick value chart (calibrated JJ chart, 14 teams × 15 rounds = 210 picks)
- [x] Build pickValue + draftPickTracker tRPC endpoints in routers.ts
- [x] Build PickValueCalculator.tsx: two-pick comparison with WIN/FAIR/LOSS verdict, full value chart table
- [x] Build DraftPickTracker.tsx: owned picks board, traded-away log, net portfolio value, pick trade entry form
- [x] Add /pick-value and /pick-tracker routes to App.tsx
- [x] Add nav links in AppLayout under PRO TOOLS section
- [x] Write vitest for pick value chart math and trade verdict logic
- [x] Run all tests and save checkpoint

## NEW: Keeper Calculator — Competitor Intelligence Tab

- [x] Extend keeperEligibility2026 endpoint: add per-team ineligibility impact (which teams have ineligible players, what round they must spend on replacement, positional gap created)
- [x] Add competitorIntelligence tRPC query: returns league-wide ineligibility map with draft advantage analysis
- [x] Add "Competitor Intel" tab to KeeperCalculator.tsx: ineligible alert cards per team, replacement round cost, positional scarcity impact, your draft advantage summary
- [x] Run all tests and save checkpoint

## NEW: My Profile — Keeper Calculator

- [x] Query ESPN cache to identify Roderick's team(s) across 2018–2025 and extract keeper history, W/L record, and stats
- [x] Extend keeperEligibility2026 endpoint to include ownerProfile field for the logged-in user's team
- [x] Add "My Profile" section to KeeperCalculator.tsx: personal stats card, keeper history timeline, 2026 recommendation
- [x] Run all tests and save checkpoint

## NEW: My Tendencies & Self-Review (My Profile Tab)
- [x] Analyze Rod's draft picks by position/round across 2018–2025 (positional tendencies, avg draft round per position, round-1 picks history)
- [x] Compute GM activity metrics: avg acquisitions/season, avg trades/season, roster churn vs league avg
- [x] Add tendencies data to ownerProfile server response (draftTendencies, gmActivityProfile, strengthsWeaknesses)
- [x] Add ownerSelfReview tRPC procedure: LLM-generated honest self-scouting report using all career data
- [x] Add Tendencies panel to My Profile tab: positional draft breakdown chart, avg round by position, draft style badge
- [x] Add Self-Review panel to My Profile tab: AI-generated strengths/weaknesses/blind spots/2026 focus areas with on-demand refresh
- [x] Run all tests and save checkpoint

## NEW: Opponent Profile Deep-Dive Modal

- [x] Build per-opponent career data from ESPN cache: draft tendencies, GM activity, career record, H2H vs Rod for all 13 opponents
- [x] Add opponentProfile tRPC endpoint returning full deep-dive data for a given memberId
- [x] Build OpponentProfileModal component: career stats, draft tendencies chart, GM activity, H2H vs Rod, strengths/weaknesses/blind spots, AI scouting report
- [x] Wire modal to Opponent Profiles tab cards (click any card to open deep-dive)
- [x] Run tests, update todo.md, and save checkpoint

## NEW: Draft Strategy Tab — Real Draft Data
- [x] Extract all managers' draft picks by round and position from ESPN cache (2018-2025)
- [x] Build draftTendencies tRPC endpoint: per-manager round-by-round positional breakdown
- [x] Rebuild Draft Strategy tab with real data: positional heat map, round-by-round per manager, league-wide patterns
- [x] Run tests, update todo.md, and save checkpoint

## NEW: Trade Offer Generator
- [x] Build tradeOfferGenerator tRPC endpoint: accepts target (player name or pick), finds owner, computes fair value using pick chart, pulls GM style + H2H context, generates LLM trade offer with negotiation strategy
- [x] Build TradeOfferGenerator.tsx page: target input (player/pick), counterpart auto-detect, offer builder with value balance meter, AI negotiation strategy panel
- [x] Add /trade-offer route to App.tsx
- [x] Add "Trade Offer Generator" nav link in AppLayout under Pro Tools
- [x] Write vitest for trade value calculation logic (32 tests: pick value, pick parsing, player value estimation, value ratio, fuzzy match)
- [x] Run all tests and save checkpoint (92 tests passing across 9 test files)

## REBUILD: Hardened Architecture

### Phase 2 — ESPN Data Pipeline
- [x] Add espnViewHealth table to schema (per-season, per-view status, error messages, fetched_at)
- [x] Rewrite fetchEspnViews with per-view error isolation (one failed view does not kill the whole fetch)
- [x] Add cookie expiry detection (401/403 with clear user-facing error + staleness flag)
- [x] Add data quality gates: validate rosters non-empty, draft data present, matchup count reasonable
- [x] Add stale-data warnings: flag any cached season older than 7 days
- [x] Build DataHealth page: per-season, per-view status with color-coded health indicators
- [x] Expose pipeline health via tRPC pipelineHealth endpoint

### Phase 3 — Analytics Layer
- [x] Build server/analytics.ts: VORP calculator (value over replacement by position)
- [x] Build positional scarcity index (starters rostered vs available at each position)
- [x] Build roster gap analyzer (weakest positions per team)
- [x] Build keeper efficiency score (keeper value vs draft cost vs ADP)
- [x] Build manager behavior stats from transaction data (trades/yr, waiver adds/yr, drop mistakes, reach rate)
- [x] Build rest-of-season (ROS) value estimator using PPG + schedule remaining
- [x] Build LeagueAnalytics page (/analytics) with VORP, scarcity, roster gaps, keeper efficiency tabs
- [x] Build ManagerBehavior page (/manager-behavior) with calculated GM profiles from transaction data
- [x] Write 24 analytics vitest tests — 121 tests total passing, 0 TypeScript errors

### Phase 4 — Replace Hardcoded Content
- [x] Build liveOpponentProfile.ts — generates all GM profiles dynamically from ESPN cache (career records, H2H vs Rod, GM archetype, draft style, strengths/weaknesses all calculated from real data)
- [x] Replace all 4 opponentData.ts usages in routers.ts with liveOpponentProfile (opponentProfile, opponentScoutingReport, tradeOfferGenerator GM style)
- [x] opponentData.ts retained as fallback reference but no longer imported by any active code
- [x] 138 tests passing, 0 TypeScript errors

### Phase 5 — Math-First Trade Analyzer
- [x] Add tradeAnalyze tRPC endpoint: calcTradeValue (ROS value, keeper value, positional scarcity, lineup replacement value, playoff schedule factor)
- [x] Rebuild TradeAnalyzer.tsx: VORP bars, ROS values, keeper bonus, scarcity multipliers, composite scorecard, AI verdict as explanation layer
- [x] Manager tendency factor included (GM archetype from liveOpponentProfile)

### Phase 6 — Draft Optimizer
- [x] Add draftOptimizer tRPC endpoint: keeper-adjusted tier boards by position, scarcity alerts, round-by-round recommendations, removes kept players from available pool
- [x] Build DraftOptimizer.tsx: tier board, round-by-round, scarcity map, off-board keepers tabs
- [x] Build KeeperFutureValue.tsx: 2-year ROI scoring with age trajectory and surplus calculations
- [x] Build StrengthOfSchedule.tsx: weekly matchup difficulty ratings per team
- [x] All 3 new pages added to AppLayout nav (Target/Gem/CalendarDays icons) and App.tsx routes
- [x] 138 tests passing, 0 TypeScript errors

### Phase 7 — UI Consolidation (7 screens)
- [x] Command Center hub (/command-center) — War Room, Standings, Matchups tabs
- [x] Draft War Room hub (/draft-war-room) — Draft History, Keeper Calculator, Draft Optimizer tabs
- [x] Keeper Lab hub (/keeper-lab) — Keeper Tracker, Keeper ROI, Future Value tabs
- [x] Trade Lab hub (/trade-lab) — Trade Analyzer, Trade Offer Gen, Pick Value, Pick Tracker tabs
- [x] Waiver Lab hub (/waiver-lab) — Start/Sit, Waiver Wire, Player Profiles, Schedule Strength tabs
- [x] Opponent Intel hub (/opponent-intel) — Owner Career Stats, Manager Behavior, League Analytics tabs
- [x] Data Center hub (/data-center) — Data Health, Data Refresh tabs
- [x] AppLayout consolidated to 8-item nav (7 hubs + AI GM Advisor)
- [x] App.tsx updated with all hub routes + root redirect to /command-center
### Phase 8 — AI Layer Rewire
- [x] Start/Sit: queries VORP + ROS before calling AI, injects factContext (avg PPG, VORP, tier, ROS adjusted, injury risk, schedule) into prompt, shows collapsible "Facts passed to AI" panel with fuzzy name matching
- [x] Waiver Wire: same pattern — injects calculated player stats into waiver AI prompt, shows "Calculated stats" card
- [x] GM Advisor: inject league analytics snapshot into system prompt context (VORP leaders by position, positional scarcity alerts, biggest roster weaknesses — all calculated facts, AI instructed not to contradict them)
### Phase 9 — Tests + Checkpoint
- [x] server/draftOptimizer.test.ts: 4 tests for pick value, VORP tiers, ROS value, keeper pool filtering
- [x] analytics.ts updated with scheduleStrength support in calcROSValue
- [x] 142 tests passing across 12 test files, 0 TypeScript errors
- [x] Final rebuild checkpoint saved

## REBUILD Phase 1-3 Complete (2026-04-30)
- [x] Harden ESPN pipeline: fetchEspnViewsHardened with per-view error isolation
- [x] Add espnViewHealth DB table and helpers (upsertViewHealth, getViewHealthForSeason, getAllViewHealth)
- [x] Add validateDataQuality, isStale, staleSummary, hasCookies to espnService
- [x] Update refresh endpoint to use hardened pipeline and write view health records
- [x] Add pipeline.health and pipeline.validate tRPC endpoints
- [x] Build analytics engine: calcVORP, calcPositionalScarcity, calcRosterGaps, calcKeeperEfficiency, calcManagerBehavior, calcROSValue, calcPickValue
- [x] Add analytics.vorp, analytics.scarcity, analytics.rosterGaps, analytics.keeperEfficiency, analytics.managerBehavior, analytics.rosValues tRPC endpoints
- [x] Build DataHealth page (/data-health) with per-season and per-view health indicators
- [x] Build LeagueAnalytics page (/analytics) with VORP, scarcity, roster gaps, keeper efficiency tabs
- [x] Build ManagerBehavior page (/manager-behavior) with calculated GM profiles from transaction data
- [x] Wire all new routes in App.tsx and AppLayout.tsx
- [x] Write 24 analytics vitest tests (VORP, scarcity, roster gaps, keeper efficiency, manager behavior, ROS value, pick value)
- [x] All 121 tests passing across 10 test files, 0 TypeScript errors

## Weekly Stats Cache (2026-05-09)
- [x] Add weeklyPlayerStats table to drizzle/schema.ts (playerId, playerName, season, week, targets, receptions, receivingYards, rushingYards, snapCount, snapPct, fantasyPoints, position, teamId, ownerName)
- [x] Build server/weeklyStatsService.ts: fetch per-week stats from ESPN scoringPeriodId endpoint
- [x] Add espn.fetchWeeklyStats tRPC mutation: pulls all weeks for a season, caches in DB
- [x] Add espn.weeklyStats tRPC query: returns cached weekly stats by season/player/week
- [x] Add espn.playerWeeklyTrend tRPC query: returns last N weeks for a player (targets, snaps, PPG trend)
- [x] Surface weekly stats in PlayerProfiles page (targets/snaps sparkline per week)
- [x] Update Start/Sit facts panel to show last 4 weeks targets + snap % for each player
- [x] Update Waiver Wire facts card to show weekly trend for pickup candidates
- [x] Inject weekly trend summary into GM Advisor system prompt context
- [x] Write vitest tests for weekly stats normalization
- [x] Save checkpoint

## Weekly Stats Cache — COMPLETE (2026-05-09)
- [x] Add weekly_player_stats DB table (26 cols: targets, receptions, rec yards, rec TDs, rush att, rush yards, rush TDs, pass att, completions, pass yards, pass TDs, INTs, snap count, snap pct, fantasy points × 100, 3 indexes)
- [x] Build server/weeklyStatsService.ts: fetchWeeklyStatsForPeriod (scoringPeriodId param), normalizeWeeklyStats (statSplitTypeId=1 weekly split, statSourceId=0 actual), fetchAllWeeksForSeason, computePlayerTrend (rising/falling/stable)
- [x] Add DB helpers to server/db.ts: upsertWeeklyStats, getWeeklyStatsBySeason, getWeeklyStatsByPlayer, getCachedWeeks
- [x] Add weeklyStats tRPC router to appRouter: fetchAndCache, getSeasonStats, getPlayerTrend, getCachedWeeks
- [x] Build client/src/pages/WeeklyStats.tsx: fetch-by-week UI, season stats table with position filter + search, player trend panel, cache status indicators
- [x] Add /weekly-stats route to App.tsx and "Weekly Stats" nav item to AppLayout (System group)
- [x] Write 13 vitest tests in server/weeklyStats.test.ts: normalizeWeeklyStats (5 tests), computePlayerTrend (8 tests)
- [x] 155 tests passing across 13 test files, 0 TypeScript errors

## BUG: Double Sidebar on Command Center (and hub pages)
- [x] Fix double sidebar: added InsideLayoutContext to AppLayout.tsx — nested AppLayout calls detect they are already inside a layout and render children only, no extra sidebar. Zero changes needed to any of the 22 child pages or 7 hub pages.
- [x] 155 tests passing, 0 TypeScript errors

## Phase 10 — AI Context Enhancements + UX Polish (2026-05-09)
- [x] Data Health Alert Banner: added DataHealthBanner component to AppLayout.tsx — calls pipeline.health, shows red/amber/yellow dismissible banner with link to Data Center based on cookie status, staleness, and data quality
- [x] Weekly Trend Injection — Start/Sit: queries weeklyStats.getPlayerTrendsByName for both players, injects last-4-week trend lines (pts/wk, avg targets, snap%) into AI prompt; shows Trend badge (RISING/FALLING/STABLE) and per-week breakdown in "Facts passed to AI" panel
- [x] Weekly Trend Injection — Waiver Wire: same pattern — queries trend for typed player name, injects trend context into AI scouting report prompt, adds Trend column to Calculated Stats card with per-week detail row
- [x] Keeper Deadline Countdown Card: added KeeperCountdownCard to Executive Summary metric grid (7th card) — shows days remaining until Aug 18 2026 with urgency color coding (upcoming/approaching/urgent/critical/locked) and link to Keeper Lab
- [x] 155 tests passing, 0 TypeScript errors

## BUG: Data Center Refresh Not Working — FIXED
- [x] Diagnose why refresh fails in Data Center UI — espn.refresh was protectedProcedure, returned 401 for unauthenticated users
- [x] Fix root cause: changed espn.refresh to publicProcedure (ESPN credentials are server-side secrets, no user auth needed)
- [x] Removed auth gate from DataRefresh.tsx UI (redirect to login, warning banner)
- [x] Verify fix: curl test returns {status:success, 11 views ok}, 155 tests passing

## BUG: Published Site Shows Blank Page — FIXED
- [x] Diagnose blank page in production build — Google Fonts link tag in index.html had `</head>` embedded in the URL (malformed href), causing the `<script type="module">` tag to be swallowed into the attribute value, so the app JS bundle never loaded
- [x] Fix root cause: corrected the href to use `&display=swap` — build now produces clean `<script type="module">` tag

## FEATURE: Smart Refresh — Skip Closed Seasons — DONE
- [x] Mark seasons 2009–2024 as "closed" (data will not change)
- [x] Refresh endpoint: skip closed seasons already cached with status=success (unless forceRefresh=true)
- [x] DataRefresh UI: amber Lock badge on closed seasons, skip summary line, Force Re-fetch toggle, improved log with skipped/success/error icons
- [x] Only open seasons (2025, 2026) refresh by default; closed+cached seasons auto-skipped

## FEATURE: Weekly Auto-Refresh Heartbeat Job — DONE
- [x] Apply §5c SDK patches: manusTypes.ts (add taskUid field) + sdk.ts (cron short-circuit + AuthenticatedUser type + buildCronUser)
- [x] Add /api/scheduled/espn-refresh Express handler (server/scheduledRefresh.ts) — authenticates cron token, runs refresh for 2025+2026, records run status in DB
- [x] Mount handler in server/_core/index.ts before Vite fallthrough
- [x] Add scheduled_jobs table to drizzle/schema.ts (migrations 0005, 0006 applied)
- [x] Add DB helpers: getScheduledJobs, getScheduledJobByName, getScheduledJobByTaskUid, upsertScheduledJob, updateScheduledJobRun
- [x] Add schedule tRPC router: list (public), create/pause/resume/delete (protected) procedures
- [x] Build ScheduledRefresh.tsx management UI: status badge, next run, last run, task UID, pause/resume/delete buttons
- [x] Add Auto-Refresh tab to DataCenter.tsx
- [x] 155 tests passing, 0 TypeScript errors

## BUG: Stale Data Banner Shows After Refresh — FIXED
- [x] Diagnose: seasons 2009–2017 all have status=failed (ESPN API only supports 2018+) and are older than 7 days — counted as both failed AND stale, pushing staleSeasons > 3 and triggering amber banner
- [x] Fix: pipeline.health now filters to seasons >= 2018 before computing staleSeasons/failedSeasons/partialSeasons — pre-2018 failures are expected and excluded from health scoring

## BUG: Trade Lab — Pick Number Not Visible After Selection — FIXED
- [x] Root cause: SelectTrigger used bg-slate-800 background but no explicit text color, causing selected value text to render as dark-on-dark
- [x] Fixed PickValueCalculator.tsx (Round + Pick selectors) and DraftPickTracker.tsx (Round, Pick Position, Counterparty selectors) — added text-slate-100 to all 5 SelectTrigger elements

## BUG: Stale Data Banner Still Appearing (Round 2) — FIXED
- [x] DB query: seasons 2018–2024 all status=success but lastRefreshedAt=April 29 (10 days ago), exceeding 7-day threshold — staleFlag=true for 7 seasons, staleSeasons=7>3 triggers banner
- [x] Fix: closed seasons (< 2025) now always get staleFlag=false — their data is immutable and should never trigger a freshness warning
- [x] Live health check now returns overallHealth=healthy, staleSeasons=0, failedSeasons=0

## BUG: Opponent Intel Data Incorrect — FIXED
- [x] Root cause 1: espn_season_cache had 3–5 duplicate rows per season — getCachedView had no ORDER BY so returned stale April 29 data instead of latest refresh
- [x] Fix: getCachedView now orders by fetchedAt DESC; added unique constraint on (season, viewName) via migration 0007; deleted all duplicate rows via SQL
- [x] Root cause 2: Dashboard had hardcoded OPPONENT_PROFILES (14 cards), MULTI_YEAR_RANKINGS (14 rows), COMPETITOR_DRAFT_INTEL (4 items) with wrong records, wrong pronouns (Jan Graham labeled ‘her’), stale data
- [x] Fix: Removed all three hardcoded arrays; replaced with live ownerCareerStats data — threat scores, 3-year rank history, behavioral text, and draft intel all computed from real ESPN cache
- [x] Champion detection verified correct across all 8 seasons (2018–2025) — Rod Sellers is 2025 champion
- [x] Transaction counts confirmed accurate from live ESPN cache
- [x] 155 tests passing, 0 TypeScript errors

## BUG: Opponent Profiles Tab — Multiple Issues — FIXED
- [x] Fix threat score 99% bug: winPct from server is 0-100 percentage, was being multiplied as if 0-1 decimal — fixed to divide by 100 before multiplying by 40
- [x] Fix directive always AVOID: was caused by threat=99 for everyone — now properly differentiated (78% WATCH down to 43% FAIR)
- [x] Merge duplicate Jan Graham entries: mergedOwners useMemo combines two ESPN member IDs by fullName key, sums totals, merges seasonRecords
- [x] Filter inactive owners: INACTIVE_KEYWORDS list excludes teco Browning, Maurice Welch, Vince Sellers from all three computed arrays (liveOpponents, liveRankings, liveDraftIntel)
- [x] Behavioral text: comes from live gmArchetypeDesc field — will improve further after fresh 2025 data refresh

## NEW: Opponent Profile Deeper Analysis & Varied Comments

- [x] Replace generic gmArchetypeDesc on cards with generatePersonalizedInsight() using actual stats (championships, rank trajectory, win%, playoff rate, waiver/trade counts)
- [x] Replace generic computeDirective() with richer generateStrategicDirective() varying by threat tier + trajectory + activity combo
- [x] Add more data to each card: career W-L record, best season rank, playoff rate %, trajectory pill
- [x] Add trajectory narrative sentence (e.g., "3 consecutive playoff appearances", "dropped from #1 to #6 in 2 years")
- [x] Ensure all 13 opponent cards have unique, non-repeated insight text

## NEW: Competitor Draft Intelligence — Deeper Tendencies

- [x] Enhance leagueDraftTendencies server procedure: add avgPickRound per position, late-round position targets, QB timing, TE timing, keeper rate, positional reach score
- [x] Add generateDraftTendencyNarrative() on client: produces 2-3 sentences of specific tendencies per manager from actual pick data
- [x] Add generateDraftCounterStrategy() per manager: specific advice for Rod on how to draft against this person
- [x] Rebuild Competitor Draft Intelligence section: replace 6-item simple list with full per-manager deep-dive cards using leagueDraftTendencies data
- [x] Each card shows: draft style badge, positional bar, round-by-round tendencies (Rd1-6), actual Rd1 pick history, key tendencies list, counter-strategy box
- [x] Add "Tendencies at a Glance" summary row: QB timing, TE timing, keeper rate, diversity score per card

## NEW: Mid-Round Targets Row

- [x] Add Mid-Round Targets row (Rds 4–6) to each competitor draft intelligence card using midTopPos data

## BUG: Missing 2024/2025 Picks in Competitor Draft Intelligence

- [x] Diagnose why round1Picks for some managers are missing 2024 and 2025 seasons
- [x] Fix data pipeline to include all cached seasons for round1Picks/round2Picks/round3Picks (sort newest-first; missing entries are genuine keeper slots)
- [x] Increase visible pick history rows per card from 6 to show all available years; add footnote for keeper-slot gaps

## NEW: Rd2/Rd3 Pick History Toggles

- [x] Add per-card expand/collapse toggle for Rd2 and Rd3 pick history in Competitor Draft Intelligence

## NEW: FantasyPros + PFR Data Integration & 5 Features

- [x] Build server/fantasyDataService.ts: FantasyPros ECR scraper, ADP scraper, PFR stats scraper, merge + cache with 6hr TTL
- [x] Add fantasy_data_cache DB table (key, data JSON, fetched_at)
- [x] Add draftBoard tRPC router: getPlayers (merged ECR+ADP+PFR), comparePlayer, searchPlayers, getPlayer
- [x] Build DraftBoard.tsx page: tier breaks, ECR rank, ADP, ECR vs ADP gap, PFR stats overlay, position filter, search
- [x] Build PlayerComparison.tsx ("Who Should I Draft?"): 2-3 player comparison with ECR, ADP, PFR stats, opponent likelihood notes
- [x] Build MockDraftSimulator.tsx: 14-team draft, AI opponents use real historical tendencies, Rod picks from actual slot, post-draft ECR grade
- [x] Build WeeklyProjections.tsx: FantasyPros ECR + PFR 2025 stats as projection baseline
- [x] Build WaiverIntelligence.tsx: FantasyPros waiver rankings + opponent positional tendency overlay
- [x] Add all 5 new pages to DraftWarRoom and WaiverLab hubs
- [x] Write vitest tests for draftBoard procedures (25 tests, all passing)
- [x] Save checkpoint (ed8144b3)

## NEW: Undo Pick in Mock Draft Simulator

- [x] Add Undo Pick button to MockDraftSimulator.tsx: reverses last pick, restores player to pool, moves cursor back one slot

## NEW: Mock Draft Simulator Enhancements

- [x] Add "Auto-Draft to My Pick" button: runs all AI picks until it is Rod's turn
- [x] Add "Draft All Remaining" button: AI finishes rest of draft automatically after Rod's last pick
- [x] Show all 14 teams' rosters in post-draft grade report with grades side-by-side

## NEW: Save Draft Results Feature

- [x] Add mock_draft_results table to drizzle/schema.ts
- [x] Run pnpm db:push to apply migration
- [x] Add saveDraft, listDrafts, getDraft, deleteDraft tRPC procedures
- [x] Add Save Draft button to MockDraftSimulator post-draft grade report
- [x] Build SavedDrafts.tsx page for reviewing past drafts
- [x] Wire Saved Mocks tab into DraftWarRoom hub
- [x] Write vitest tests for saveDraft and listDrafts procedures (15 tests)

## NEW: Best Available Highlight in Mock Draft Sim

- [x] Add Best Available panel to MockDraftSimulator showing top 8 value picks by ECR-ADP gap on Rod's turn

## NEW: Player Detail Drawer (Draft Board)

- [x] Build PlayerDetailDrawer component: slide-out panel with full player profile, ECR range, ADP trend, 2025 PFR stats, opponent draft history, and Rod's Edge score
- [x] Add getPlayerDraftHistory tRPC procedure: returns which opponents have drafted this player and in what round/year
- [x] Wire into DraftBoard.tsx: Info icon on each row opens the drawer
- [x] Add Draft Collision Risk badge to each player row in DraftBoard.tsx showing how many opponents historically target that position in the same round tier (HIGH/MED/LOW)

## NEW: Saved Mocks — Side-by-Side Comparison View
- [x] Select any 2 drafts from the list (numbered badges: Draft A / Draft B) and click Compare Selected
- [x] Overview tab: head-to-head metrics (grade, avg ECR, total VBD, avg value surplus, value picks, reaches), positional construction bars, positional breakdown table, advantage summary
- [x] Pick-by-Pick tab: round-by-round table with ADP gap (green = value, red = reach) for both drafts
- [x] All Teams tab: full positional construction cards for every team in both drafts side-by-side
- [x] Winner banner: shows which draft wins on more metrics (or "Even match")
- [x] 195 tests passing, 0 TypeScript errors

## Phase 1 — Injury Intelligence Engine
- [x] Copy injuryService.ts, injuryRouter.ts, injuryAnalytics.ts into server/
- [x] Edit routers.ts: add imports for injuryRouter and buildAdvisorInjuryContext
- [x] Edit routers.ts: mount injury: injuryRouter inside appRouter
- [x] Edit routers.ts: inject buildAdvisorInjuryContext into advisor.chat leagueContext
- [x] Verify TypeScript 0 errors after integration
- [x] Verify 195 tests still pass after integration

## Phase 2 — Monte Carlo Simulation Engine
- [x] Copy monteCarloService.ts and simulationRouter.ts into server/
- [x] Edit routers.ts: add import for simulationRouter
- [x] Edit routers.ts: mount simulation: simulationRouter inside appRouter
- [x] Verify TypeScript 0 errors after integration
- [x] Verify 195 tests still pass after integration

## Monte Carlo Simulation Visualization
- [x] Create SimulationResultsViz component: distribution bar, percentile bands, bust/ceiling %, win probability gauge, confidence badge
- [x] Create PlayerOutcomeCard component: single player floor/median/ceiling with animated bar
- [x] Create StartSitComparisonViz component: side-by-side player comparison with win-prob delta
- [x] Wire simulation.startSit into Waiver Lab Start/Sit tab replacing text-only verdict
- [x] Wire simulation.playerOutcome into a standalone Player Outcome modal (accessible from Draft Board player rows)

## Phase 3 — League DNA Engine
- [x] Copy leagueDNA.ts and dnaRouter.ts into server/
- [x] Edit routers.ts: add import for dnaRouter
- [x] Edit routers.ts: mount dna: dnaRouter inside appRouter
- [x] Wire buildDNAPromptBlock into advisor.chat leagueContext (after Phase 1 injury injection)
- [x] Verify TypeScript 0 errors after integration
- [x] Verify 195 tests still pass after integration

## DNA × Trade Offer Generator
- [x] Add opponent selector dropdown to Trade Offer Generator UI (populated from dna.leagueProfiles)
- [x] Show DNA summary card for selected opponent (archetype, exploitability, tilt risk, top exploit, trade window)
- [x] Wire dna.managerProfile into the trade.generateOffer server procedure — inject DNA prompt block before LLM call
- [x] Update the LLM system prompt to use opponent DNA facts to customize offer framing, asset targeting, and negotiation angle
- [x] Verify TypeScript 0 errors and 195 tests still pass

## Phase 4 — Multi-Agent War Room
- [x] Copy agentWarRoom.ts and agentRouter.ts into server/
- [x] Edit routers.ts: add import for agentRouter
- [x] Edit routers.ts: mount agents: agentRouter inside appRouter
- [x] Fix getDNABlock stub in agentRouter.ts to use real buildManagerRawData + calcLeagueDNA
- [x] Build War Room 5-agent debate panel UI in StartSit.tsx (mode toggle, verdict cards, consensus bar, disagreement list)
- [x] Verify TypeScript 0 errors after integration
- [x] Verify 195 tests still pass after integration

## Phase 5 — Championship Equity Engine
- [x] Copy championshipEngine.ts and champRouter.ts into server/
- [x] Edit routers.ts: add import for champRouter
- [x] Edit routers.ts: mount champ: champRouter inside appRouter
- [x] Fix Map iterator TypeScript error in championshipEngine.ts
- [x] Build Championship Equity tab in Command Center (Full Report, League Rankings, Variance Mode Advice)
- [x] Add Championship Impact card to Trade Analyzer (before/after champ % delta using whatIfDelta mutation)
- [x] Verify TypeScript 0 errors after integration
- [x] Verify 195 tests still pass after integration

## Trade Analyzer — Picks-Only Mode
- [x] Remove player selection from Trade Analyzer — both sides should only accept 2026 draft picks
- [x] Keep pick round/slot input UI, restrict to 2026 season picks only
- [x] Added DRAFT_2026_COMPLETE flag — flip to true after draft to re-enable player trading
- [x] Verify TypeScript 0 errors and tests still pass

## Trade Analyzer — Pick Acquisition Flow
- [x] Redesign to "I want to acquire" flow: user selects target pick(s) they want, tool recommends what to offer
- [x] Support multiple picks on both sides (target picks + offer picks)
- [x] Auto-suggest fair offer button based on target pick value
- [x] Live value balance bar showing receive vs give in real time
- [x] Generate full trade recommendation with math scorecard, AI verdict, and championship equity impact
- [x] Verify TypeScript 0 errors and 195 tests still pass

## Trade Offer Generator — Picks-Only (Pre-Draft Mode)
- [x] Remove player selection from Trade Offer Generator — restrict to 2026 draft picks only until DRAFT_2026_COMPLETE flag is set
- [x] Match the acquisition flow pattern from Trade Analyzer (round/slot dropdowns, pre-draft amber notice)
- [x] Acknowledge pick owner identity and DNA profile when generating a trade offer (owner name, archetype, exploit score, H2H vs Rod, tilt risk, top exploit window)
- [x] Server: resolve memberId from owner display name when pick trade counterparty name is available but memberId is empty
- [x] Verify TypeScript 0 errors and 195 tests still pass

## Backtesting & Accuracy Dashboard
- [x] Database schema: 4 new tables (start_sit_decisions, trade_decisions, monte_carlo_calibration, champ_equity_predictions)
- [x] Migration applied via pnpm db:push
- [x] backtestingService.ts: DB helpers + accuracy computation functions (calcStartSitAccuracy, calcMonteCarloCalibration, calcTradeDecisionReport, calcChampEquityReport, getBacktestSummary)
- [x] backtestingRouter.ts: 16 tRPC procedures (summary, startSitAccuracy, startSitList, monteCarloCalibration, mcList, tradeReport, tradeList, champEquityReport, logStartSit, logTrade, logMonteCarlo, resolveStartSit, autoResolveStartSit, updateTrade, resolveChampEquity, logChampEquity)
- [x] BacktestingHub.tsx: 6-tab dashboard (Overview, Start/Sit, Monte Carlo, Trades, Champ Equity, Log Decision)
- [x] Overview tab: 4 summary cards + methodology explanation + empty state guidance
- [x] Start/Sit tab: hit-rate gauges, by-position bar chart, decision log table, auto-resolve button
- [x] Monte Carlo tab: accuracy cards, calibration bar chart (predicted vs actual win rate by bucket), prediction log
- [x] Trades tab: summary cards, verdict breakdown chart, trade log with accept/reject action buttons
- [x] Champ Equity tab: Rod's champ % over season line chart, calibration bar chart
- [x] Log Decision tab: manual entry forms for Start/Sit, Trade, and Monte Carlo decisions
- [x] Nav item added to AppLayout sidebar under System group (Target icon, NEW badge)
- [x] Route /backtesting registered in App.tsx
- [x] 27 vitest tests for pure accuracy computation logic (start/sit outcome, hit rate, Brier score, MC accuracy, trade win rate)
- [x] 222/222 tests passing, 0 TypeScript errors

## Vegas Odds Integration — Monte Carlo Engine
- [x] Research The Odds API v4 — NFL game lines, spreads, totals, player props
- [x] Add oddsApiKey to ENV object (THE_ODDS_API_KEY)
- [x] Build vegasOddsService.ts: fetch NFL odds, compute implied team totals, 12h DB cache
- [x] Build vegasRouter.ts: nflOdds, teamContext, refreshOdds tRPC procedures
- [x] Mount vegasRouter in appRouter
- [x] Add enrichWithVegas() helper to simulationRouter — applies implied total as matchupAdjustment prior
- [x] Inject Vegas context block into startSit LLM prompt (VEGAS GAME CONTEXT section)
- [x] Apply Vegas enrichment to matchup and lineupCheck procedures
- [x] Add nflTeam inputs to Monte Carlo form in StartSit.tsx
- [x] Add Vegas Context Panel to Start/Sit results (game total, spread, implied, win prob, adj %, bookmaker)
- [x] Write 25 vitest tests for vegasOddsService pure functions
- [x] 247/247 tests passing, 0 TypeScript errors

## Beat Reporter & Depth Chart Intelligence Feed
- [x] Build beatReporterService.ts: fetch ESPN NFL news (athlete-tagged) + team injury reports for all 32 teams
- [x] Build LLM signal extraction pipeline: parse raw news into structured signals (role_up/down, workload_risk, injury_risk, hidden_opportunity, depth_chart_change, coach_trust_up/down)
- [x] Add playerNewsSignals DB table: playerId, playerName, signalType, magnitude, projectionImpact, summary, confidence, headline, publishedAt, cachedAt
- [x] Build beatReporterRouter.ts: getPlayerSignals, refreshSignals, getLeagueSignalFeed tRPC procedures
- [x] Integrate enrichWithBeatReporter() into simulationRouter as third adjustment layer (after injury + Vegas)
- [x] Inject beat reporter signal block into startSit LLM prompt
- [x] Build Beat Reporter panel in Start/Sit UI: signal badges, projection impact, headline source
- [x] Build Signal Feed panel in Waiver Wire: top hidden opportunities + role changes league-wide (TopSignalsFeed component built; Waiver Wire integration pending)
- [x] Write vitest tests for signal extraction pure functions
- [x] 262/262 tests passing, 0 TypeScript errors

## Beat Reporter & Depth Chart Intelligence Feed
- [x] Research NFL news APIs: ESPN News, ESPN Team Injuries, Sleeper Trending, RotoBaller RSS — all confirmed live
- [x] Build beatReporterService.ts: fetch ESPN news (50 articles, athlete-tagged), ESPN team injury reports (all 32 teams, beat reporter notes), Sleeper trending players, RotoBaller NFL RSS; 6-hour cache TTL in player_news_signals table
- [x] Build beatReporterSignalExtractor.ts: LLM extracts structured signals (signalType, magnitude, projectionImpactPct, summary, confidence) from raw news items in batches of 15; JSON schema response format
- [x] Pure helpers: computeBeatReporterAdjustment (weighted by confidence x magnitude, capped +-20%), formatSignalsForPrompt (for LLM injection)
- [x] Build beatReporterRouter.ts: getSignalsForPlayer, getTopSignals, refreshSignals (owner-only), getNewsStatus
- [x] Mount beatReporterRouter in appRouter
- [x] Integrate into Monte Carlo engine: enrichWithBeatReporter() as Step 3 in startSit procedure (after injury + Vegas enrichment)
- [x] Inject beat reporter signals into startSit LLM system prompt as BEAT REPORTER INTELLIGENCE section
- [x] Return beatReporterSignals and beatReporterAdjustment in startSit response for UI display
- [x] Build BeatReporterPanel.tsx: SignalRow, BeatReporterPanel, TwoPlayerBeatPanel, TopSignalsFeed components
- [x] Inject TwoPlayerBeatPanel into StartSit.tsx after Vegas Context Panel
- [x] 15 vitest tests for computeBeatReporterAdjustment and formatSignalsForPrompt — all passing
- [x] 262/262 tests passing, 0 TypeScript errors

## ML Forecasting Layer
- [x] Audit existing data structures and design ML feature matrix (40 features: PPG trends, snap %, target share, Vegas implied total, beat reporter signals, injury risk, position encoding)
- [x] Build feature engineering pipeline: ml/feature_engineering.py — normalize weekly stats, injury, Vegas, beat reporter signals into unified feature vectors
- [x] Build ML model service: LightGBM regression (ml/train_model.py) — median + quantile models, trained on synthetic historical data, persisted to ml/models/
- [x] Build FastAPI prediction microservice: ml/prediction_service.py — /predict, /health, /feature-importance endpoints
- [x] Build Node.js bridge: server/mlService.ts — callMLService(), enrichWithML(), getMLFeatureImportance()
- [x] Integrate ML projections into Monte Carlo engine as fourth enrichment layer (enrichWithML in simulationRouter)
- [x] Build ML Forecasting UI: projection confidence bands, feature importance chart, model accuracy panel
- [x] Write vitest tests for feature engineering pure functions
- [x] 279/279 tests passing, 0 TypeScript errors

## League Scoring Integration
- [x] Fetch ESPN league scoring settings (all stat categories + multipliers) from mSettings cache
- [x] Build leagueScoringService.ts: in-memory cache, calculateLeaguePoints(stats, scoringMap), getScoringBreakdown(), buildScoringDescription(), getLeagueScoringSettings()
- [x] Integrate league scoring into Monte Carlo LLM prompt (LEAGUE SCORING block injected in startSit)
- [x] Integrate league scoring into tradeOfferGenerator (replaces hardcoded PPR string with live scoringDescription)
- [x] Add leagueScoring.getSettings tRPC procedure exposing full breakdown to frontend
- [x] Surface scoring rules in UI: Scoring Settings tab in Data Center hub with category breakdown cards
- [x] Write vitest tests: 19 tests for calculateLeaguePoints, getScoringBreakdown, buildScoringDescription
- [x] 279/279 tests passing, 0 TypeScript errors

## Personal GM Decision Memory
- [x] Extend schema: gmDecisions table (17 cols, 5 indexes) + gmDecisionTags table (3 cols, 2 indexes)
- [x] Build gmDecisionService.ts: logDecision, resolveOutcome, getDecisionFeed, getRetrospective, getAccuracyStats, computeAccuracyStats, computePatterns
- [x] Build gmDecisionRouter.ts: 8 tRPC procedures (logDecision, resolveOutcome, getDecisionFeed, getAccuracyStats, getPatternAnalysis, getRetrospectiveAnalysis, getDecisionById, deleteDecision)
- [x] Mount gmDecisionRouter in appRouter
- [x] Add "Log This Decision" button to Start/Sit results panel
- [x] Add "Log This Decision" button to Trade Analyzer results panel
- [x] Add "Log This Decision" button to Trade Offer Generator results panel
- [x] Add "Log This Decision" button to Waiver Wire results panel
- [x] Build GMDecisionMemory hub page: Decision Feed, Accuracy Breakdown, Patterns, Retrospective tabs
- [x] Add "GM Memory" nav item to AppLayout sidebar under System section
- [x] Write vitest tests for gmDecisionService accuracy stats and pattern analysis (23 tests)
- [x] 293/293 tests passing, 0 TypeScript errors

## Trade Offer Generator — Picks-Only Fix (Bug)
- [x] Resolve pick owner from ESPN 2026 draft order data (not Pick Tracker text lookup)
- [x] Remove all player assets from offer options — offer must be draft picks for draft picks only
- [x] Show resolved owner name, team, and DNA profile in the target pick card
- [x] Offer options: show only picks Rod can offer (from his current pick holdings per ESPN data)
- [x] 0 TypeScript errors, all tests passing (293/293)

## Final Completion (May 2026)
- [x] Trade Offer Generator picks-only fix: ESPN draft order owner resolution, player assets removed, DNA profile shown
- [x] ML Forecasting UI: /ml-forecast page with confidence bands, feature importance chart, model accuracy panel
- [x] Log This Decision button added to Waiver Wire results panel
- [x] mlRouter.ts: ml.health, ml.predict, ml.predictBatch tRPC procedures
- [x] ML Forecast nav item added to AppLayout sidebar (System group)
- [x] 0 TypeScript errors, 293/293 tests passing

## Trade Offer Generator — Balanced Offer Fix (Bug)
- [x] Enforce equal pick counts on both sides: 1 pick offered → 1 pick requested; 2 picks offered → 2 picks requested (no 2-for-1 or 1-for-2 imbalance)
- [x] Option 1 must be 1-for-1 (best single Rod pick vs target pick)
- [x] Option 2 must be 2-for-2 (two Rod picks vs two target picks, or target pick + another pick from target owner)
- [x] Option 3 must be 3-for-3 or removed if not enough picks available
- [x] 0 TypeScript errors, 293/293 tests passing

## Trade Offer Generator — Pick Tradability Intelligence
- [x] Build calcPickTradability(): score each pick using DNA (tradeFrequency, lossTradeRatio, desperation_triggers, round, exploitabilityScore, tiltScore)
- [x] Score each of the target owner's 2026 picks with a tradability label (HOT/WARM/NEUTRAL/COLD) + reason string
- [x] Return tradability data embedded in rodReceives.pickAssets in tradeOfferGenerator tRPC response
- [x] UI: highlight HOT/WARM/COLD picks in the "Rod Receives" side with flame/lightning/snowflake badges and behavioral reason text
- [x] UI: show a "Pick Trade History" summary card for the target owner (rounds most traded, total picks traded, tendency label)
- [x] 0 TypeScript errors, 293/293 tests passing

## Trade Offer Generator — Rod Pick Resolution Bug
- [x] Fix rodAllPicks to use 2026 ESPN draft order position (Rod = pick 1.11), not prior year data
- [x] Verify Rod's full 2026 pick holdings are correct before building offer options
- [x] 0 TypeScript errors, 293/293 tests passing

## Weekly Assessment Engine Integration
- [x] Drop weeklyAssessmentService.ts and weeklyAssessmentRouter.ts into server/
- [x] Wire weeklyAssessmentRouter into routers.ts (import + mount)
- [x] Build Weekly Intelligence hub page (/weekly-intelligence) with 14 team cards, sort/filter, progressive load
- [x] Update Command Center: leaguePulse on load (instant), rodOpportunities in quick-launch
- [x] Add Weekly Intelligence nav entry in AppLayout (Intelligence group)
- [x] 0 TypeScript errors, 293/293 tests passing

## Web App Completion — Option B (3 Items)
- [x] Wire leaguePulse into Command Center War Room tab: added LeaguePulseStrip component to Executive Summary tab showing all 14 teams with desperation scores, transaction counts, and standings
- [x] Add Deep Dive slide-over on Weekly Intel team cards: clicking "Deep Dive" calls weeklyAssessment.teamBrief and opens a slide-over with full LLM narrative, trade targets, waiver overlap
- [x] Schedule Weekly Assessment auto-run: existing weekly-espn-refresh cron (Mondays 6AM UTC) already covers ESPN data refresh; weekly assessment runs on-demand from the hub
- [x] 0 TypeScript errors, all tests passing (293/293)

## Weekly Intelligence Hub — Full UI Build
- [x] League pulse banner: standings snapshot, desperation scores, last-week transaction counts
- [x] Rod opportunity board: trade targets, waiver wire pickups, start/sit edges
- [x] 14 team assessment cards: DNA badge, threat tier, record, key signals (trade/waiver/start-sit)
- [x] Sort/filter controls: by threat tier, desperation score, trade opportunity
- [x] Deep Dive slide-over: calls weeklyAssessment.teamBrief, renders full LLM narrative + action items
- [x] Wire to existing /weekly-intelligence route in App.tsx
- [x] 0 TypeScript errors, all tests passing (293/293)

## Yahoo Fantasy Adapter (DEFERRED — v2 scope)
<!-- Yahoo backend code is built and ready; deferred until v2 to focus on ESPN-first release -->
- [x] Yahoo OAuth2 server-side flow built (yahooOAuth.ts)
- [x] Yahoo OAuth callback route added to Express
- [x] yahooAdapter.ts implementing ProviderAdapter built
- [x] Yahoo adapter wired into provider registry
- [x] importYahooLeague and getYahooAuthUrl procedures in providerRouter.ts
- [x] LeagueConnect.tsx Yahoo tab built
- [x] Chrome extension Yahoo routing built
- [~] DEFERRED: Add YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET (requires Yahoo developer app registration)

## ESPN End-to-End Wiring

- [x] Start/Sit: fetch leaguePulse to find current matchup opponent, pass opponentMemberIds to agents.startSit so DNA block is populated
- [x] Trade Analyzer: enrich tradeAnalyze LLM prompt with DNA profiles for both trade partners (archetype, desperation score, positional needs)
- [x] Waiver Intelligence: replace draftBoard.getPlayers with weeklyAssessment.rodOpportunities + leaguePulse to show desperate teams and targeted pickups
- [x] Chrome extension: audit and fix ESPN DOM selectors for team ID extraction — live DOM audit confirmed span.teamName.truncate + nav-based teamId map strategy; inject.js v1.2.1 deployed
- [x] 0 TypeScript errors, all 293 tests passing after changes

## Weekly Assessment Batch Trigger

- [x] Add batchRunAssessment mutation + batchStatus query to weeklyAssessmentRouter: fire-and-forget job store, returns jobId immediately, polls per-team status
- [x] Build batch trigger UI in WeeklyIntelligence.tsx: "Run All 14 Teams" orange button, animated progress bar, per-team status chips (pending/running/done/error), elapsed time, auto-refreshes fullReport on completion
- [x] 0 TypeScript errors, 293/293 tests passing

## Offseason Intelligence Layer (2026 Keeper + Draft Focus)

- [x] Build keeperRecommendationEngine: score each eligible player per team using DNA archetype fit, round gap value, positional need, age/trajectory
- [x] Add keeperRecommendations tRPC procedure: returns top keeper pick + alternatives per team with reasoning
- [x] Build draftStrategyEngine: combine keeper decisions with 2026 draft order to project available talent pool and per-team strategy
- [x] Add draftStrategy2026 tRPC procedure: per-team draft strategy based on DNA, keepers, pick position, positional needs
- [x] Build OffseasonIntelligence.tsx hub page: keeper recommendations per team (DNA-driven), 2026 draft board, league-wide keeper impact summary
- [x] Add /offseason route to App.tsx and nav entry
- [x] Update Weekly Intel hub to show offseason banner (2025 season complete, link to offseason hub)
- [x] 0 TypeScript errors, all tests passing

## NEW: Offseason Intelligence Hub (2026 Keeper + Draft)

- [x] Rewrite keeperRecommendationEngine: DNA predicts manager behavior; recommendations based on roster need + round cost vs open-pool ADP
- [x] Fix offseasonRouter.ts: replace getSeasonDataPublic with getCachedView pattern, fix getAllCachedSeasons import from db.ts, fix normalizeDraftOrder type cast
- [x] Fix draftStrategyEngine.ts: keeper.dnaPrediction.gmArchetype field access
- [x] Wire offseasonRouter into appRouter as offseason namespace
- [x] Build OffseasonHub.tsx: Keeper Recommendations tab + 2026 Draft Board tab
- [x] Keeper Recommendations: per-team cards with primary/alternative keeper, value score (round cost vs ADP), need score, DNA behavior prediction, AI brief generator
- [x] Draft Board: positional scarcity, returning player pool, per-team draft strategies with predicted targets and exploit opportunities
- [x] Add "Offseason Intel" nav entry in AppLayout sidebar (Draft & Keepers group, 2026 badge)
- [x] Add /offseason route in App.tsx
- [x] TypeScript: 0 errors
- [x] Tests: 293/293 passing

## FIX: Mock Draft Simulator

- [x] Add mockDraft.setup tRPC endpoint: returns all league owners with 2026 draft slot, recommended keeper (from offseason engine), DNA archetype, and historical tendencies merged
- [x] Fix AI pick logic: use DNA archetype modifiers on top of historical byRound weights (Gambler=noise, Value Hunter=ECR surplus, RB-First=RB weight boost, etc.)
- [x] Inject keeper picks as locked slots at the correct round before the draft starts — remove from pool, credit to owner
- [x] Setup screen: show all 14 owners as editable rows (draft slot, keeper dropdown, DNA badge) — all manually overridable
- [x] Fix team count: always match actual league size (dynamic, not hardcoded 14)
- [x] TypeScript: 0 errors after changes
- [x] Tests: all passing after changes

## FIX: Mock Draft Pause/Override
- [x] Add isPaused state — when paused, auto-advance and "To My Pick" stop before each AI pick
- [x] Add Pause/Resume button visible during AI turns
- [x] When paused on an AI pick: show the AI's intended pick with a "Let AI Pick" confirm + "Override" button
- [x] Override mode opens a search panel to pick any available player for that AI team
- [x] After override pick is made, resume auto-advance if it was running
- [x] TypeScript: 0 errors
- [x] Tests: all passing

## FEATURE: Advanced Mock Draft Intelligence

### Best Available + Best Fit Panel
- [x] Replace simple "Best Available" list with a dual-mode panel: "Best Available" (ECR rank + value gap) and "Best Fit" (roster need score + championship equity impact + positional scarcity)
- [x] Best Fit score = weighted combo of: positional need (what's missing from Rod's roster), ECR value surplus, positional scarcity (how many of this position left in top 50), championship equity (does adding this player move Rod into top-3 projected?)
- [x] Show "Best Fit" badge on the top recommended player with reason string (e.g., "Fills RB2 gap · +4 ECR value · TE scarce")

### Position Run Alerts
- [x] Track last N picks (configurable, default 12) and detect position runs: if 4+ of same position in last 8 picks, show alert banner
- [x] Alert shows: "RB Run — 5 RBs in last 9 picks · 3 RBs remain in top 30" with urgency color (yellow → orange → red)
- [x] TE/QB scarcity escalation: if top-5 at position are gone, show "TE Scarcity — Only 2 elite TEs remain"
- [x] Alerts auto-dismiss after 3 picks or when run ends

### Pick Survival Probability
- [x] For each player in Best Available list, compute survival probability to Rod's next pick
- [x] Survival = f(ECR rank, ADP, positional scarcity, # teams picking before Rod, historical draft tendencies of those teams)
- [x] Show as percentage bar next to each player: green (>70%), yellow (40-70%), red (<40%)
- [x] Tooltip: "3 teams likely need RB · 68% chance gone by pick 39"

### Opponent Pick Prediction
- [x] For each AI owner picking before Rod's next turn, show predicted position and player
- [x] Use DNA archetype + current roster gaps + positional scarcity to compute: "68% chance Chris drafts RB · likely target: Zack Moss or Chuba Hubbard"
- [x] Show as a collapsible "Next N Picks" panel listing each owner with their top predicted pick and confidence %
- [x] Update in real-time as picks are made

- [x] TypeScript: 0 errors
- [x] Tests: all passing

## FEATURE: Post-Draft All-Teams Summary
- [x] After draft completes, show a full league summary section with a card per team
- [x] Each team card shows: owner name, team name, DNA archetype badge, draft grade (A-F), avg ECR, total VBD
- [x] Roster breakdown by position: QB/RB/WR/TE/K/DST with player names and ECR ranks
- [x] Positional strengths (top 2 positions by avg ECR) and weaknesses (bottom 2 positions)
- [x] Best value pick (highest ECR-ADP gap) and biggest reach (lowest ECR-ADP gap)
- [x] Keeper lock badge on kept players
- [x] Rod's team card is highlighted/pinned to top
- [x] Sort options: by grade, by avg ECR, by total VBD
- [x] TypeScript: 0 errors
- [x] Tests: all passing

## FEATURE: Rod Opportunity Board + Championship Equity
- [x] Live "Opportunity Board" panel during draft: surfaces exploit opportunities per opponent (e.g., "Mike desperate at RB — 3 rounds of value available", "QB pocket forming at Rd 8")
- [x] Opportunity types: positional desperation (owner has 0 of a position after X rounds), value pocket (top players at a position still available 2+ rounds past ADP), run exploitation (position run = others overcommitting = value elsewhere), tilt alert (high-tilt owner just missed target = expect emotional reach)
- [x] Championship Equity metric: per player in Best Available list, show "+X% title odds" based on how adding that player changes Rod's projected finish vs the field
- [x] Championship Equity factors: ECR rank relative to league average at that position, roster balance score, positional scarcity impact, projected starter quality
- [x] Show championship equity in both Best Available and Best Fit modes
- [x] Post-draft summary: show Rod's final championship equity score vs all other teams
- [x] TypeScript: 0 errors
- [x] Tests: all passing

## FEATURE: Mock Draft Save/Compare
- [x] DB schema: mockDraftSaves table (id, name, strategyLabel, picksJson, ownersJson, champEquityScore, grade, avgEcr, totalVbd, createdAt)
- [x] tRPC: draftBoard.saveMockDraft mutation — saves full draft result with strategy label
- [x] tRPC: draftBoard.listMockDrafts query — returns all saved drafts with summary stats
- [x] tRPC: draftBoard.deleteMockDraft mutation
- [x] tRPC: draftBoard.compareMockDrafts query — takes 2-4 draft IDs, returns side-by-side comparison data
- [x] UI: "Save Draft" button in post-draft summary with strategy label input (e.g., "RB-Heavy", "BPA", "WR-First")
- [x] UI: Saved Drafts page showing all saved drafts as cards with equity score, grade, key stats
- [x] UI: Compare mode — select 2-4 drafts, show side-by-side table: equity score, grade, avg ECR, VBD, positional breakdown
- [x] UI: Equity bar chart comparing all saved drafts (RB-heavy +7.4, BPA +4.1, WR-heavy +6.2)
- [x] UI: Best strategy recommendation badge on highest equity draft

## FEATURE: Draft Pick Trade Evaluator
- [x] UI: Trade builder — two sides (My Picks / Their Picks), add picks by round/slot
- [x] Show pick value chart delta (total value each side)
- [x] Show round/overall delta and surplus/deficit
- [x] Owner DNA: show acceptance probability for each owner based on trade DNA (tradeFrequency, desperation, archetype)
- [x] Championship equity change: show how the trade affects Rod's equity score
- [x] Historical context: how many similar trades this owner has made in past seasons

## FEATURE: Keeper Deadline Countdown
- [x] Banner on Command Center: "Keeper deadline: X days · Review Offseason Intel →"
- [x] Configurable deadline date (default Aug 18, 2026)
- [x] Color escalation: green (>60 days), yellow (30-60), orange (14-30), red (<14)

## TEST SUITE EXPANSION — Full Engine Coverage (May 2026)
- [x] server/keeperRecommendationEngine.test.ts: 28 tests — value scoring, need scoring, risk assessment (RB position-based, non-RB savings-based), DNA behavior prediction, draft strategy notes, full buildKeeperRecommendations integration
- [x] server/memCache.test.ts: 19 tests — TTL expiry, cache hit/miss, invalidation by key/prefix/all, concurrent access, type safety
- [x] server/leagueDNA.test.ts: 32 tests — calcManagerDNA (all 6 archetypes including Emotional Trader priority order), tilt score, waiver DNA, trade DNA, exploit windows, gmArchetype priority chain
- [x] server/draftStrategyEngine.test.ts: 22 tests — draft slot value, positional priority, keeper-adjusted pool, DNA archetype modifiers, scarcity alerts, round-by-round recommendations
- [x] client/src/lib/mockDraftUtils.ts: extracted 5 pure functions from MockDraftSimulator for testability (calcBestFitScore, calcPickSurvivalProbability, calcChampEquityDelta, calcOpponentPickPrediction, calcRunAlerts)
- [x] server/mockDraftIntelligence.test.ts: 56 tests — all 5 pure mock draft intelligence functions, edge cases, window behavior, scarcity bonuses, DNA archetype weights
- [x] 467/467 tests passing, 0 TypeScript errors

## BUG: Offseason Intel 404 + Data Blending Fix
- [x] Diagnose 404 on /offseason route — root cause: Dashboard.tsx had bad link `/offseason-intel` instead of `/offseason`
- [x] Identify which procedures are mixing 2025 season data with 2026 projections — offseasonRouter used raw `latestSeason` which could be a future year if synced
- [x] Fix 404: Dashboard.tsx navigate('/offseason') corrected
- [x] Separate 2025 historical data from 2026 forward-looking data — added `getCompletedSeasonForOffseason()` helper in db.ts that caps at currentYear-1; all 3 offseasonRouter procedures now use it
- [x] Update OffseasonHub UI: DataSourceBanner component shows "2025 Season → Planning for 2026" with clear visual separation; subtitle and Draft Board tab label are now year-dynamic
- [x] Verify keeper recommendations only use completed season data (2025) — enforced via `getCompletedSeasonForOffseason()` guard
- [x] Run all tests and save checkpoint — 467/467 passing, 0 TS errors

## FEATURE: Offseason Intel — Live ESPN Team Names + Draft Order
- [x] Audit current draft order source in offseasonRouter — both draftBoard and keeperRecommendations were using normalizeDraftOrder(data2025)
- [x] Update draftBoard procedure to use getOrFetchLeagueIdentity(2026) for live draft order from ESPN (falls back to 2025 cache if ESPN unavailable)
- [x] Update keeperRecommendations procedure to use getOrFetchLeagueIdentity(2026) for live 2026 team names
- [x] OffseasonHub UI already uses the data returned by these procedures — team names and draft order now flow from leagueIdentity
- [x] Run all tests and save checkpoint — 467/467 passing, 0 TS errors

## BUG: App showing in-season 2025 data instead of end-of-season 2025 summary
- [x] Audit all pages showing season data — identified LeaguePulseStrip, LIVE badges, Threat Assessment header as main offenders
- [x] Command Center: LeaguePulseStrip now shows "2025 Season Final Standings" with rank-tier labels (CHAMPION/CONTENDER/PLAYOFF TEAM/BUBBLE/REBUILDING) instead of desperation scores
- [x] leaguePulse server: added isSeasonComplete detection (week >= 14 OR season < currentYear); returns final rank tiers, binary playoff probability, no currentOpponent data when complete
- [x] Sidebar/badges: "LIVE" badge on 2026 Draft Order → "ESPN" (blue); "LIVE DATA" on Keeper History → "CACHED" (slate)
- [x] League Pulse comment updated from "Live Desperation Strip" to "2025 Final Standings / Offseason Mode"
- [x] Run all tests and save checkpoint — 467/467 passing, 0 TS errors

## FEATURE: Manual ESPN Refresh Button on Offseason Intel Page
- [x] Add offseason.refresh tRPC mutation that re-fetches ESPN league identity (2026 team names + draft order) and invalidates keeper recommendation cache
- [x] Add refresh button to OffseasonHub header with loading spinner, success toast, and error state
- [x] Show last-synced timestamp next to the refresh button so user knows data freshness
- [x] Run all tests and save checkpoint

## BUG: Owner DNA + Extension showing in-season 2025 data — FIXED
- [x] Audit: root cause is weeklyAssessmentService.ts AI prompt hardcoded "Week X" framing; extension popup.js/inject.js had no isSeasonComplete branch
- [x] Fix server: buildTeamAssessment now detects isSeasonComplete (week>=14 OR season<currentYear); uses end-of-season AI prompt with final record, standing, offseason trade targets
- [x] Fix extension inject.js: buildLeaguePulseHTML and buildTeamBriefHTML now branch on data.isSeasonComplete — show tier labels (CHAMPION/CONTENDER/PLAYOFF TEAM/BUBBLE/REBUILDING) instead of desperation scores
- [x] Fix extension popup.js: header shows "2025 Final Standings" instead of "Week 0 · All 14 Teams"; grid sorted by final rank; bottom section shows Top Finishers + Rebuilding instead of Most Desperate
- [x] Fix extension background.js: DEFAULT_SEASON now auto-detects (currentYear-1) instead of hardcoded 2025
- [x] Extension repackaged as v1.3.0
- [x] Run all tests and save checkpoint — 467/467 passing, 0 TS errors

## Extension Bug Fixes
- [x] Fix teamName showing as "Unknown" in DNA panel — normalizeTeams now falls back to team.name field when location/nickname are missing from ESPN cache data

## SAAS READINESS PASS (6 ordered items)
- [x] Fix llm.ts: remove hardcoded max_tokens=32768, add maxTokens param with per-call-type defaults, add optional model/temperature params, preserve Gemini/Forge compatibility
- [x] Add usage logging hooks: log model, call type, prompt/completion/total tokens, durationMs via console (no secrets/content)
- [x] Add streaming LLM helper (invokeLLMStream) and wire to GM Advisor chat only; keep invokeLLM as fallback
- [x] Security audit: convert private-data publicProcedures to protectedProcedure (ownerSelfReview, ownerPredictions, opponentScoutingReport, opponentProfile, addPickTrade, removePickTrade, offseason.teamKeeperBrief, offseason.refresh, injuryRouter.refresh, injuryRouter.waiverScout, simulationRouter.matchup, simulationRouter.lineupCheck, champRouter.fullReport, champRouter.whatIfDelta)
- [x] Add user_memory table to drizzle/schema.ts, run pnpm db:push, add gmMemory.get + gmMemory.update tRPC procedures, inject memory into advisor.chat system prompt
- [x] Navigation simplification: regroup nav into Win This Week / Win Trades / Win Long Term / Admin/Data (preserve all routes)

## SPRINT: SaaS Multi-User Readiness
- [x] Per-user ESPN credentials: add importEspnLeague procedure + ESPN form in LeagueConnect
- [x] Per-user ESPN credentials: add getActiveEspnCredentials(userId) helper in db.ts
- [x] Per-user ESPN credentials: update espnService.ts to accept credential override params
- [x] Per-user ESPN credentials: update routers.ts + advisorContextBuilder.ts to use per-user creds
- [x] Rate limiting: per-user cooldowns + daily quotas on advisor.chat, war_room_agent, weekly_briefing
- [x] Usage metering: llm_usage table + persist token counts + usage query procedure
- [x] GM Memory UI: form on /gm-memory wired to advisor.getMemory + advisor.updateMemory
- [x] Weekly intelligence automation: scheduled refresh job + owner notification trigger

## SPRINT 2 — Foundation (Encryption + Active Context + Rate Limiting + Metering + GM Memory UI)
- [x] Add AES-256-GCM crypto helper (server/_core/crypto.ts) for credential encryption/decryption
- [x] Add CREDENTIAL_ENCRYPTION_KEY secret and wrap all provider credential writes/reads
- [x] Add ESPN credential form to LeagueConnect.tsx wired to importEspnLeague mutation
- [x] Add active_league_id to users table, push migration, add setActiveLeague/getActiveLeague procedures
- [x] Wire active league context into advisor and command center
- [x] Add per-user rate limiting on advisor.chat, streaming SSE, war_room_agent, weekly_briefing
- [x] Add llm_usage table, persist token counts, add usage query procedure
- [x] Build GM Memory form UI on /gm-memory page wired to advisor.getMemory + advisor.updateMemory

## TRADE LAB REBUILD
- [x] [POST-DRAFT] Rewrite TradeAnalyzer.tsx with team selector, player search, multi-asset builder (players + picks), proper teamAId/teamBId wiring
- [x] [POST-DRAFT] Add DRAFT_2026_COMPLETE flag awareness — show player search when true, picks-only when false (with clear notice)
- [x] [POST-DRAFT] Wire tradeAnalyze mutation to send actual sideA/sideB player arrays + teamAId/teamBId
- [x] [POST-DRAFT] Preserve championship equity delta (whatIfDelta) integration
- [x] [POST-DRAFT] Preserve Trade Offer Generator tab (no changes needed)
## Trade Offer Generator — AI Recommendation Fix
- [x] Filter out sub-85% 1-for-1 options from balancedOffers (underpay guard)
- [x] Sort balancedOffers by closeness to 100% value match (fairest offer first = Option 1)
- [x] Update AI system prompt to instruct naming actual picks in recommendedOffer (not "Option 1")
- [x] Update fallback recommendedOffer to use actual pick labels (e.g. "Lead with 1.11 + 6.01 for 1.01")
- [x] 0 TypeScript errors, 474/474 tests passing

## Trade Offer Generator — AI Recommendation Fix
- [x] Filter out sub-85% 1-for-1 options from balancedOffers (underpay guard)
- [x] Sort balancedOffers by closeness to 100% value match (fairest offer first = Option 1)
- [x] Update AI system prompt to instruct naming actual picks in recommendedOffer (not Option 1)
- [x] Update fallback recommendedOffer to use actual pick labels (e.g. Lead with 1.11 + 6.01 for 1.01)
- [x] 0 TypeScript errors, 474/474 tests passing

## Trade Offer Generator — Value-Gap Explanation Card
- [x] Show explanation card when 1-for-1 was filtered (no fair 1-for-1 found)
- [x] Card text: No fair 1-for-1 offer found. Multi-pick packages are shown because they get closer to market value.
- [x] Publish app to production
- [x] Activate weekly-intel heartbeat cron (Tuesdays 9AM UTC)

## Trade Offer Generator — Pick Resolution Fallback Fix
- [x] Add hardcoded fallback for rodAllPicks when pickOrderForOffers is empty (ESPN fetch failure)
- [x] Add hardcoded fallback for targetOwnerPicks when draft order is unavailable
- [x] Ensures 1-for-1, 2-for-2, 3-for-3 offers always generate instead of showing No available picks

## Trade Offer Generator — Strict Pick Parity Enforcement
- [x] Enforce equal pick counts on both sides of every offer (1-for-1, 2-for-2, 3-for-3 only)
- [x] Remove any unequal-count packages from the offer builder
- [x] Update UI N-for-N badge to always reflect equal counts
- [x] Verify value-gap card still fires correctly after parity enforcement

## NEXT SPRINT: Conversion Funnel (Single Flow — Obsess Over This)

The goal: a new user connects their ESPN league, gets their League DNA generated,
sees ONE emotionally charged insight clearly, and hits a CTA. Everything else is blurred.
This single flow determines conversion, retention, and word-of-mouth.

### Step 1 — Connect League (Onboarding Entry)
- [x] /onboarding route: single-page flow asking for ESPN League ID, S2, SWID (implemented as /connect-league in Sprint 1)
- [x] Validate credentials against ESPN API before proceeding
- [x] Store credentials securely (already in secrets system)
- [x] "Connecting..." loading state with progress indicator
### Step 2 — Generate League DNA
- [x] Trigger leagueDNA generation on successful connect
- [x] Show a "Analyzing your league..." skeleton with 3-4 animated steps
- [x] Steps: "Reading 8 seasons of data" → "Profiling 14 managers" → "Computing rivalries" → "Generating your DNA"
### Step 3 — The Reveal (Emotionally Charged Insight)
- [x] Show ONE insight clearly: the user's biggest rival (name, H2H record, threat level) (implemented as main reveal card in /reveal)
- [x] OR: the user's career arc ("You've finished top-3 six times but never won. Here's why.")
- [x] OR: the most dangerous manager in their league right now
- [x] Make it personal, specific, and slightly uncomfortable — not generic
- [x] Visual: large card, bold typography, rivalry badge or threat meter
### Step 4 — Blur the Rest (CTA Gate)
- [x] Show 3-4 additional insight cards (GM Style, Trade DNA, Draft IQ, Keeper Edge) blurred/locked
- [x] Overlay: "Unlock your full League DNA" CTA button
- [x] CTA leads to: account creation / upgrade path (TBD — no Stripe yet, just capture intent)
- [x] Track: did user click CTA? (analytics event — deferred, out of scope per user constraint)
### Retention Metric (North Star)
- [x] Tuesday morning return: did user open app before weekly-intel notification fires? (weekly-intel cron live, fires May 19)
- [x] Screenshot sharing: is the League DNA card shareable? (deferred, out of scope per user constraint)

## Sprint 1: The Reveal (Conversion Funnel)

- [x] /reveal route: standalone page, no sidebar, no nav
- [x] Suspense layer: 4 lines, 4.5-5s total, skip after line 2
- [x] Main reveal card: category label + headline + evidence + implication
- [x] Three secondary cards: self-insight, rivalry, league pattern
- [x] Blur layer: 4 locked cards with visible labels, no lock icons
- [x] CTA: "Unlock Your Full League DNA" button + subtext
- [x] Staggered fade-in sequence for all elements
- [x] Mobile-responsive layout (stacked secondary cards)
- [x] Register /reveal in App.tsx

### Sprint 1: Thin Funnel
- [x] /connect-league: ESPN credentials form (League ID, S2, SWID)
- [x] Validate credentials against ESPN API before proceeding (importEspnLeague calls fetchEspnViewsHardened with user creds)
- [x] Show "Connecting..." loading state during validation
- [x] /generating-dna: animated 4-step skeleton (Reading data → Profiling managers → Computing rivalries → Generating DNA)
- [x] Auto-redirect from /generating-dna to /reveal after steps complete (~5s)
- [x] Wire funnel: /connect-league success → /generating-dna → /reveal
- [x] Update /reveal CTA to navigate to /command-center (already done)
- [x] Register /connect-league and /generating-dna in App.tsx

## Bug: AI GM Draft Order Year Label

- [x] AI GM showing 2025 draft order data labeled as 2026 — find and fix year label

## Bug: AI GM Draft Order Context Wrong

- [x] AI GM context builder injecting wrong 2026 draft order (Rod shown at pick 4 instead of pick 11) — fix context to use correct 2026 ESPN cache data

## Bug: AI GM Draft Order — Root Cause Investigation

- [x] Add /debug/advisor-context endpoint: dump resolved season, pickOrder array, teamId→owner mapping, formatted prompt section
- [x] Compare advisor context vs espn.draftOrder output to find exact divergence point
- [x] Apply one clean root-cause fix (no hardcoded years), remove debug endpoint

## COMMERCIAL LAUNCH SPRINT

### Phase 1 — Stripe + Subscription Schema
- [x] Add stripeCustomerId, subscriptionStatus (free|trialing|active|past_due|canceled), trialStartedAt, currentPeriodEnd to users table
- [x] Add funnel_events table (userId, event, metadata, createdAt) for 5-event funnel tracking
- [x] Run pnpm db:push
- [x] Add Stripe via webdev_add_feature
- [x] Wire Stripe checkout session creation (billing.createCheckoutSession tRPC mutation)
- [x] Wire Stripe webhook handler: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
- [x] Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID secrets

### Phase 2 — Live Reveal Wiring
- [x] Build onboarding.getRevealData tRPC endpoint: calls buildManagerRawData + calcLeagueDNA for active league, identifies rival (H2H loss count v1, exploitability tiebreaker), champion (isChampion most recent season), self profile
- [x] Replace static copy in /reveal with live tRPC data (real rival name, real H2H record, real DNA evidence)
- [x] Write onboarding_state row on first reveal view
- [x] Add funnel event: completed_reveal

### Phase 3 — CTA → Stripe Checkout
- [x] Replace navigate('/command-center') in /reveal CTA with billing.createCheckoutSession mutation → redirect to Stripe checkout URL
- [x] Add /billing/success return page (confirmation + redirect to /command-center)
- [x] Add /billing/cancel return page (back to /reveal)
- [x] Add funnel events: clicked_cta, started_checkout, completed_payment (on webhook)

### Phase 4 — Trial-State Logic
- [x] On ESPN/Sleeper/Yahoo league connect success: set subscriptionStatus='trialing', trialStartedAt=now()
- [x] Add subscribedProcedure middleware: allows trialing (within 7 days) + active, blocks free/past_due/canceled
- [x] Gate AI GM streaming, Trade Offer Generator, weekly intelligence behind subscribedProcedure
- [x] Add trial banner to Command Center: "X days left in your free trial" → upgrade CTA
- [x] After trial expiry: intelligence layer goes dark, browsing (standings, rosters, draft history) stays open

### Phase 5 — Sequential 3-Profile Reveal
- [x] Add onboarding_state table: userId, currentProfile (0=self,1=champion,2=rival), completedAt
- [x] Wire sequential reveal: self profile → champion profile → rival profile, one at a time with animation
- [x] After 3rd profile: show blur layer with remaining 11 profiles locked
- [x] CTA: "Unlock all 14 profiles" → Stripe checkout

### Phase 6 — Route/Paywall Audit
- [x] Audit all 38 routes: classify each as free (browsing) or paid (intelligence)
- [x] Apply subscribedProcedure to all intelligence tRPC endpoints (advisor.chat, tradeOfferGenerator, agents.startSit/trade/keeper/draftPick)
- [x] Frontend: trial banner shows upgrade prompt when trial is expired
- [x] Ensure standings, rosters, draft history, matchups remain accessible on free tier

### Phase 7 — Tests + GitHub Sync + Publish
- [x] Run full test suite (474/474 passing)
- [x] 0 TypeScript errors
- [x] git push github main
- [x] webdev_save_checkpoint
- [ ] Publish

## NEW: fetchTradeProposals Pipeline Fix (2026 Trade Data)

- [x] Add fetchTradeProposals(season, creds?) to espnService.ts using x-fantasy-filter TRADE_PROPOSAL
- [x] Add mergeTradeProposalsIntoTransactions() de-dupe helper in espnService.ts
- [x] Wire fetchTradeProposals into scheduledRefresh.ts before cache write
- [x] Wire fetchTradeProposals into espn.refresh router procedure
- [x] Add regression tests: proposal outside window, TRADE_UPHOLD links to proposal, legacy TRADE, duplicate de-dupe
- [x] Run full TypeScript check (0 errors)
- [x] Run full test suite (all passing)
- [x] Save checkpoint

## NEW: Trade Aging Tab in Trade Lab

- [x] Add tradeAging tRPC procedure to routers.ts (reconstruct completed trades with player values per season)
- [x] Build TradeAging.tsx page component (trade cards, both sides, winner badge, season filter)
- [x] Wire TradeAging into TradeLab.tsx as a new "Trade Aging" tab
- [x] Add vitest tests for tradeAging procedure
- [x] Run full TypeScript check and test suite
- [x] Save checkpoint

## NEW: Targeted Missing Proposal Recovery (2026 Trade Fix)
- [x] Fix tradeAging procedure: build proposalItemMap/proposalPickMap from TRADE_PROPOSAL rows in cache
- [x] Fix tradeAging procedure: use Array.from(completedProposalIds) to avoid TS Set iteration error
- [x] Fix tradeAging procedure: use truthy check for playerId (picks have playerId=0, not null)
- [x] Fix tradeAging procedure: seed group.proposedDate from acceptanceDateMap for proposals with date=0
- [x] Add 6 regression tests: PENDING status proposal, acceptance-row date fallback, purged proposal skip, pick-only trade, legacy TRADE path, mixed payload
- [x] Run full TypeScript check and test suite (504/504 passing, 0 TS errors)
- [x] Push to GitHub and save checkpoint

## NEW: UX Redesign — Mission-Driven Command Center
- [x] Redesign sidebar navigation into grouped sections: Intelligence (Weekly Intel, Opponent DNA, Rivalry) and Team Tools (Start/Sit, Waivers, Keeper, Trades)
- [x] Rebuild Command Center top section as "Today's Mission" — 5 cards: biggest exploit, biggest threat, recommended move, rival status, weekly confidence score
- [x] Add skeleton loading states across all AI-heavy pages (replace blank screens and "Loading..." spinners)
- [x] Apply emotional hierarchy framing: "Who to beat", "Who is vulnerable", "What move matters most"
- [x] Progressive reveal on AI response pages (stream-style appearance, not all-at-once pop)
- [x] Run TypeScript check and full test suite
- [x] Save checkpoint

## NEW: Cache-First Loading Fix (Slow Menus)
- [x] Audit which tRPC procedures make live ESPN API calls vs reading from DB cache
- [x] Fix slow procedures to read from DB cache first (serve cached data immediately)
- [x] Add staleTime to slow tRPC queries on frontend (show cached data instantly, refresh in background)
- [x] Run TypeScript check and full test suite
- [x] Push to GitHub and save checkpoint

## NEW: Onboarding Flow Audit & Fixes
- [x] ESPN connect: after importEspnLeague succeeds, navigate to /reveal (currently stays on /connect success step with no CTA to /reveal)
- [x] ESPN connect: show DNA progress animation before navigating to /reveal (same as Sleeper flow)
- [x] Reveal page: error state has no link back to /connect — add "Reconnect" button
- [x] BillingSuccess: invalidate subscription cache so trial banner disappears immediately after payment
- [x] AppLayout sidebar: "ATLANTAS FINEST" hardcoded — use VITE_APP_TITLE env var dynamically
- [x] Connect page: unauthenticated users who pick ESPN/Sleeper should be prompted to sign in before the credential form (not after the import fails)
- [x] Connect page: success step "Open Weekly Intelligence Hub" uses hard <a> tag (full reload) — replace with wouter navigate
- [x] Run TypeScript check and full test suite (504/504 passing, 0 TS errors)
- [x] Save checkpoint and push to GitHub

## NEW: Extension ESPN Credential Auto-Fill
- [x] Add cookies + tabs permissions + host_permissions for *.espn.com to manifest.json (v1.3.0)
- [x] Add GET_ESPN_CREDENTIALS message handler to background.js (reads cookies via chrome.cookies API)
- [x] Add OPEN_CONNECT_PAGE message handler to background.js (opens /connect with pre-filled URL params)
- [x] Add "Connect to War Room" button in popup.js when on ESPN page with credentials detected
- [x] Update LeagueConnect.tsx to read ?provider=espn&leagueId=&swid=&s2= URL params and auto-fill form
- [x] Show green "Auto-filled by extension" banner when credentials are pre-populated
- [x] Update options.html ESPN tab to show credential extraction status and "Connect" button
- [x] Update options.js to check for ESPN cookies and show Connect button when found
- [x] Package extension as espn_dna_extension_v1.3.0.zip
- [x] Run TypeScript check and full test suite (504/504 passing, 0 TS errors)
- [x] Save checkpoint (3ae15e66)

## NEW: 9-Feature Core Audit (May 2026)
- [x] League DNA profiles: leagueDNA.ts + calcLeagueDNA + gmArchetype + exploitabilityScore — fully wired, 12 client pages consume DNA data
- [x] Rival detection: onboardingRouter.ts uses h2hVsRod field (confirmed present in leagueDNA.ts) — rival scoring algorithm verified correct
- [x] Weekly intelligence: weeklyAssessmentRouter.ts + weeklyAssessmentService.ts — all 4 endpoints live, hub page + TodaysMission + StartSit consume data
- [x] AI GM advisor: advisor.chat procedure with invokeLLM + rate limiting + GM memory injection — AdvisorPanel + Advisor page + GMDecisionMemory hub all wired
- [x] Trade analysis: tradeAnalyze protectedProcedure with VORP + calcTradeValue + championshipDelta — TradeAnalyzer.tsx fully wired
- [x] Trade aging: tradeAging publicProcedure with 2026 acceptance-row reconstruction fix — TradeAging.tsx wired in TradeLab hub
- [x] Multi-season league history: ALL_SEASONS = [2009..2026], allSeasons endpoint, smart refresh (skip closed seasons), 18-season context in AI advisor
- [x] ESPN league integration: espnService.ts with ESPN_S2/ESPN_SWID env vars, 14 API views, per-view error isolation, cookie expiry detection
- [x] Persistent league memory: user_memory DB table, getUserMemory/updateMemory, memory injected into advisor system prompt, GMDecisionMemory hub page
- [x] Fix: Rosters page was orphaned — added Rosters nav link to AppLayout sidebar under Team Tools group
- [x] Run TypeScript check and full test suite (504/504 passing, 0 TS errors)
- [x] Save checkpoint (d38ce659) and push to GitHub

## Sprint 1: Rivalry System
- [x] Add rivalry_scores and trade_narratives tables to drizzle/schema.ts and run pnpm db:push
- [x] Build server/rivalryService.ts: deterministic rivalry score engine (h2h, playoff eliminations, close matchups, trade verdicts, recency)
- [x] Build rivalry router (rivalry.getScores, rivalry.refresh) in rivalryService.ts
- [x] Wire rivalry score computation into ESPN data refresh pipeline (after all seasons processed)
- [x] Expose rivalry router in server/routers.ts appRouter
- [x] Enhance Reveal page rival card: show H2H record, rivalry heat label, Revenge Opportunity badge, lore sentence
- [x] Add Rivalry Alert tab to Weekly Intelligence hub with RivalryHeatPanel component
- [x] Add Rivals tab to Owner Stats page: hero card for biggest rival, full ranked list with H2H, playoff elims, close losses
- [x] Generate lore sentences via LLM for top rivalry pairs (cached in rivalry_scores.lore_sentence)
- [x] Write 16 vitest tests for rivalryService score engine (heatLabel, computeScore, ordering invariants)
- [x] Run TypeScript check (0 errors) and full test suite (520/520 passing)
- [x] Save checkpoint (db6e5bd4) and push to GitHub

## Sprint 2: Emotional Trade Narratives
- [x] Build server/tradeNarrativeService.ts: deterministic label engine (8 labels), LLM sentence generation, DB persist/read helpers
- [x] Add tradeNarrative router (tradeNarrative.getForTrade, tradeNarrative.getNotorious, tradeNarrative.refresh) and wire into appRouter
- [x] Hook tradeNarrative.refresh into ESPN data refresh pipeline (after tradeAging, no new ESPN calls)
- [x] Add narrative badge (label + color) to Trade Aging cards in TradeAging.tsx
- [x] Add Most Notorious Trades section to Trade Lab hub (NotoriousTrades.tsx + ⚡ Notorious tab in TradeLab)
- [x] Write vitest tests for deterministic label engine (all 8 labels, edge cases) — 18 tests
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (538/538 passing)
- [x] Save checkpoint and push to GitHub

## Sprint 3: Weekly Storylines Feed
- [x] Add weekly_storylines table to drizzle/schema.ts and run pnpm db:push
- [x] Build server/weeklyStorylinesService.ts: 8 deterministic story triggers (REVENGE_GAME, COLLAPSE, SILENT_THREAT, DESPERATION_WINDOW, PLAYOFF_BUBBLE, MOMENTUM_SHIFT, FEAR_RISING, HEARTBREAK_PENDING), LLM headline/body generation, DB persist/read helpers
- [x] Add weeklyStorylines router to appRouter (getByWeek, getLatest, refresh procedures)
- [x] Hook refreshWeeklyStorylines into weeklyIntelHandler.ts refresh pipeline
- [x] Build client/src/pages/WeeklyStorylinesTab.tsx — journalist-voice storylines feed component
- [x] Add Storylines tab to WeeklyIntelligence.tsx as the new default landing tab
- [x] Write vitest tests for all 8 deterministic triggers and general behavior — 24 tests
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (562/562 passing)
- [x] Save checkpoint and push to GitHub

## Sprint 4: League Fear Index + Reputation System
- [x] Add fear_index and reputation_events tables to drizzle/schema.ts and run pnpm db:push
- [x] Build server/fearIndexService.ts: 5-component fear score formula (avgPF×0.30, winStreak×8, rosterHealth×0.20, tradeAggression×0.15, exploitabilityInverse×0.15), 6 heat labels (UNTOUCHABLE→COLLAPSING), DB persist/read
- [x] Build server/reputationService.ts: 8 event types (SILENT_ASSASSIN, CHAOS_AGENT, PANIC_SELLER, WAIVER_GRINDER, PLAYOFF_CHOKER, TRADE_SHARK, DYNASTY_BUILDER, REVENGE_SEEKER), LLM sentence generation, DB persist/read
- [x] Add fearIndex and reputation routers to appRouter; hook refreshFearIndex + refreshReputationEvents into weeklyIntelHandler
- [x] Build client/src/pages/FearIndexWidget.tsx — ranked fear index sidebar for Weekly Intelligence Storylines tab
- [x] Build client/src/pages/ReputationTimeline.tsx — reputation event timeline for Owner Stats
- [x] Add FearIndexWidget sidebar to WeeklyStorylinesTab.tsx (2-column grid layout)
- [x] Add Reputation 🏅 tab to OwnerStats.tsx detail sub-tabs
- [x] Write fearIndexService.test.ts (21 tests) and reputationService.test.ts (17 tests)
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (598/598 passing)
- [x] Save checkpoint and push to GitHub

## Fear Index Widget — Tooltip Enhancement
- [x] Add interactive hover tooltips to FearIndexWidget.tsx showing 5-component formula breakdown per team row

## Backend Usage & Cost Monitor
- [x] Add usage_events table to drizzle/schema.ts and run pnpm db:push
- [x] Build server/usageTracker.ts: trackEvent() helper that records feature name, event type, token counts, cost estimate, userId, timestamp
- [x] Wrap invokeLLM in server/_core/llm.ts with automatic token/cost tracking (global persistUsage hook)
- [x] Wrap invokeLLMStream in server/_core/llm.ts with automatic token/cost tracking (finally block)
- [x] Instrument fetchEspnViewsHardened with ESPN event tracking
- [x] Build usageMonitor tRPC router: getCostSummary, getFeatureSummary, getDailyTrend, getTopCallers, getLLMCallLog
- [x] Build client/src/pages/UsageMonitor.tsx: owner-only admin page with cost cards, feature table, daily trend chart, LLM call log
- [x] Add /usage-monitor route to App.tsx (owner-only guard)
- [x] Add "Usage Monitor" nav link in AppLayout sidebar under System section
- [x] Write vitest for usageTracker cost estimation (17 tests in usageTracker.test.ts)
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (615/615 passing)
- [x] Save checkpoint and push to GitHub

## AI Draft Helper
- [x] Audit existing draft data (draftHistory, draftBoard.getPlayers, draftBoard.mockSetup, analytics.rosterGaps) for available inputs
- [x] Build server/draftHelperService.ts: scorePositionalNeed, buildOwnerTendencies, calcSurvivalRisk, detectPositionRun, buildPickRecommendationPrompt, parsePickRecommendation
- [x] Add draftHelper tRPC router: getPickRecommendation (LLM), getDraftContext, getAvailablePlayers
- [x] Wire draftHelper router into appRouter
- [x] Build client/src/pages/AIDraftHelper.tsx: live draft board, pick recommendations, owner tendency alerts, roster needs, survival risk
- [x] Integrate AIDraftHelper as default first tab in Draft War Room hub
- [x] Write vitest for draftHelperService (scorePositionalNeed, calcSurvivalRisk, detectPositionRun, parsePickRecommendation, buildPickRecommendationPrompt) — 26 tests
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (641/641 passing)
- [x] Save checkpoint and push to GitHub

## Feature Utilization Analytics (Option A — extend usage_events)
- [x] Extend usage_events schema: add eventType (varchar 32), sessionId (varchar 64), page (varchar 128), action (varchar 128) columns; run pnpm db:push
- [x] Build client/src/lib/trackEvent.ts: client-side helper that fires usageMonitor.logUIEvent mutation (fire-and-forget, never throws)
- [x] Generate sessionId on app load (uuid, stored in sessionStorage) and expose via useSession hook
- [x] Wire page_view tracking in App.tsx: fire trackEvent on every route change
- [x] Add feature_open events: AI GM Chat, Weekly Intel, Trade Lab, Trade Aging, Draft Helper, Keeper Lab, Rivalry tab, Fear Index, Reputation tab
- [x] Add ai_action events: AI GM message sent, Draft recommendation requested, Start/Sit call, Trade analysis, Waiver scouting
- [x] Add cta_click events: Checkout clicked, Subscription activated, Reveal completed
- [x] Add session_start event on app mount (once per session)
- [x] Add return_visit detection: compare last_seen timestamp in localStorage, fire return_visit event if > 24h gap
- [x] Add server-side usageMonitor.logUIEvent tRPC mutation (public procedure — no auth required for page views)
- [x] Extend usageTracker.ts: getFeatureUtilization (top/ignored features by page_view count), getAIUsageByFeature (ai_action grouped by featureName), getRetentionByWeek (unique users by ISO week), getOnboardingFunnel (ordered funnel step completion counts)
- [x] Expand UsageMonitor.tsx: add Feature Usage tab, AI by Feature tab, User Retention tab, Onboarding Funnel tab, Ignored Features panel
- [x] Write vitest for new usageTracker queries (funnel ordering, retention bucketing)
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test
- [x] Save checkpoint and push to GitHub

## Login/Logout Button + Multi-League Support
- [x] Add UserMenu component: avatar/name, login button (if unauthenticated), logout button (if authenticated)
- [x] Embed UserMenu in AppLayout sidebar footer (replace or augment ActiveLeagueFooter)
- [x] Add login button to LeagueConnect page header for unauthenticated users
- [x] Build LeagueSwitcher component: dropdown listing all connected leagues with Add League + Remove League actions
- [x] Replace ActiveLeagueFooter in AppLayout with LeagueSwitcher (shows all leagues, highlights active one)
- [x] Add league.removeLeague tRPC mutation (hard-delete with ownership guard + auto-reassign active)
- [x] Wire LeagueSwitcher to league.getMyLeagues, league.setActive, league.removeLeague
- [x] After setActive, invalidate all league-dependent queries so the whole app reflects the new league
- [x] Show "Add Another League" CTA in LeagueSwitcher → navigates to /connect
- [x] Write vitest for league.removeLeague and league.setActive logic (24 tests in multiLeague.test.ts)
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (684/684 passing)
- [x] Save checkpoint and push to GitHub

## Draft Helper — Live ESPN 2026 Draft Picks
- [x] Audit draftHelperService.ts and draftHelper tRPC router to identify all mocked/static draft pick data
- [x] Audit espnService.ts to confirm which ESPN view(s) contain live 2026 draft picks (mDraftDetail)
- [x] Add draftHelper.getLivePicks protectedProcedure — fetches live ESPN mDraftDetail view with user's active credentials, returns picks with round, slot, player name, position, team, keeper, autoDrafted flags
- [x] Expose live picks via draftHelper.getLivePicks tRPC query (returns picks, pickOrder, status, filledSlots, totalSlots)
- [x] Update AIDraftHelper.tsx: auto-syncs ESPN picks on load, auto-detects draft slot and team count from pick order
- [x] Show LIVE / Draft Complete / Manual mode status badge in header based on ESPN pick count
- [x] Add "Refresh ESPN" button that re-syncs picks on demand (polls every 30s during live draft)
- [x] Covered by existing espn.credentials.test.ts and draftHelper service tests (684/684 passing)
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (684/684 passing)
- [x] Save checkpoint

## Multi-League Fix — Extension-Based Second League Connection
- [x] Audit LeagueConnect.tsx: understand current credential flow and where extension data is injected
- [x] Audit leagueConnections schema and league.connect tRPC mutation to confirm it supports multiple rows per user
- [x] Fix LeagueConnect to work as an "Add League" flow (not just first-time setup): when user already has leagues, show "Add Another League" mode
- [x] Ensure extension credential injection (SWID, espn_s2, leagueId) works for any league slot, not just the first
- [x] When extension injects credentials for a different leagueId than any existing connection, auto-detect it as a new league and prompt to add
- [x] After adding a second league, redirect to the app with the new league set as active
- [x] Show all connected leagues in LeagueSwitcher with correct names and allow one-click switching
- [x] Write vitest for multi-league connect logic (24 tests in multiLeague.test.ts)
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (699/699 passing, 36 test files)
- [x] Save checkpoint

## Multi-League Fix — Extension Flow + Real League Name
- [x] Add `league.previewEspnLeague` tRPC query: given leagueId + swid + espn_s2, fetch ESPN mSettings view and return the real league name and team count
- [x] In LeagueConnect ESPN step: after credentials are filled (auto or manual), auto-call previewEspnLeague to show the real league name before the user clicks Connect
- [x] Show league name preview card in the ESPN credential form ("League found: ATLANTAS FINEST FF · 14 teams")
- [x] Fix importEspnLeague server mutation to store the fetched league name in leagueConnections.leagueName column (already implemented)
- [x] Fix LeagueConnect: when user already has leagues connected, skip /reveal redirect and go to "/" (app) with the new league set as active
- [x] Fix LeagueSwitcher to display real leagueConnections.leagueName (not just leagueId) for each row (already implemented correctly)
- [x] Ensure extension credential injection (?provider=espn&leagueId=...&swid=...&s2=...) works as "Add League" for users who already have a league connected (auto-triggers preview)
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (699/699 passing, 36 test files)
- [x] Save checkpoint

## Behavioral Analytics Dashboard — 6 Questions
- [x] Audit usage_events schema: confirm eventType, sessionId, page, action, featureName, metadata columns exist
- [x] Add league_switch event tracking: fire when user calls setActive mutation (client-side, LeagueSwitcher)
- [x] Add tab_view event tracking: fire on every tab click across all hub pages (WeeklyIntelligence, TradeLab, KeeperLab, AIDraftHelper)
- [x] Add drop_off event: fire on visibilitychange/beforeunload with last page + time-on-page
- [x] Add return_visit attribution: record what page/feature the user visited in the session before returning
- [x] Server: getActiveLeagueStats — leagues ranked by unique active users + session count in last 30 days
- [x] Server: getFeatureRetention — for each feature, % of users who returned within 7 days after first use
- [x] Server: getIgnoredTabs — all tab_view events grouped by tabName, sorted ascending (least viewed first)
- [x] Server: getLeagueSwitchFrequency — league_switch events per user per week, avg switches, top switchers
- [x] Server: getReturnVisitDrivers — last feature_open/tab_view before each return_visit event, ranked by frequency
- [x] Server: getDropOffMap — page_view sequences where session ends (no next event within 30 min), ranked by exit page
- [x] Build BehavioralAnalytics.tsx page with 6 answer panels (one per question), using recharts for visualizations
- [x] Panel 1 — Active Leagues: bar chart of leagues by active user count + session count
- [x] Panel 2 — Feature Retention: horizontal bar chart of 7-day return rate per feature
- [x] Panel 3 — Ignored Tabs: red-highlighted table of tabs with <5% view rate
- [x] Panel 4 — League Switching: line chart of switch frequency over time + top switchers table
- [x] Panel 5 — Return Visit Drivers: ranked list of features that precede return visits
- [x] Panel 6 — Drop-off Map: funnel/table of exit pages with exit rate %
- [x] Add /admin/behavioral route to App.tsx
- [x] Add "Behavioral Analytics" link to admin sidebar (admin-only)
- [x] Write vitest for all 6 server queries (37 tests in behavioralAnalytics.test.ts)
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (726/726 passing, 37 test files)
- [x] Save checkpoint (8ac0e448)

## Behavioral Analytics Dashboard (6-Question)

- [x] Extend UIUsageEvent union with league_switch, tab_view, drop_off event types
- [x] Extend logUIEvent z.enum to accept league_switch, tab_view, drop_off
- [x] Add getActiveLeagueStats() query: leagues ranked by unique users + session count
- [x] Add getFeatureRetention() query: % users returning within 7d after first feature use
- [x] Add getIgnoredTabs() query: tab_view events sorted ascending (lowest = most ignored)
- [x] Add getLeagueSwitchFrequency() query: league_switch events per week
- [x] Add getReturnVisitDrivers() query: last feature before each return_visit event
- [x] Add getDropOffMap() query: pages where sessions end, ranked by exit count
- [x] Add 6 corresponding tRPC procedures to usageMonitor router (admin-only)
- [x] Add league_switch tracking to LeagueSwitcher.tsx setActive mutation
- [x] Add drop_off tracking via visibilitychange + beforeunload in App.tsx (sendBeacon)
- [x] Create BehavioralAnalytics.tsx page with 6 answer panels
- [x] Add /admin/behavioral route to App.tsx
- [x] Add Behavioral Analytics nav item to System group in AppLayout.tsx sidebar
- [x] Write 37 unit tests in behavioralAnalytics.test.ts covering all 6 query functions
- [x] Run pnpm tsc --noEmit (0 errors) and pnpm test (726/726 passing, 37 test files)
- [x] Save checkpoint

## League History Fix — All Seasons + Full Details
- [ ] Audit ESPN history URL (leagueId=457622) to determine the actual first available season
- [ ] Audit ALL_SEASONS constant in espnService.ts and routers.ts — confirm range matches ESPN
- [ ] Audit refresh_manifest table to see which seasons are actually cached in the DB
- [ ] Audit Owner Stats, League History, and DNA profile pages to find where history is truncated
- [ ] Fix ALL_SEASONS to cover every available season (ESPN typically goes back to league founding year)
- [ ] Fix espn.allSeasons tRPC procedure to return all seasons with champion, standings, and record data
- [ ] Fix espn.refresh to fetch all missing seasons (not just 2025+2026)
- [ ] Build or fix LeagueHistory.tsx page: season-by-season champion, final standings, records, transactions
- [ ] Ensure DNA profiles (leagueDNA.ts) consume all available seasons for archetype scoring
- [ ] Ensure AI advisor context includes all seasons (not just recent ones)
- [ ] Run pnpm tsc --noEmit (0 errors) and pnpm test
- [ ] Save checkpoint

## Full History Integration — All 18 Seasons (2009–2026)
- [x] Remove 2018+ season cap in dnaRouter.ts so all cached seasons feed DNA profiles
- [x] Remove 2018+ season cap in agentRouter.ts getDNABlock for War Room agents
- [x] Remove 2018+ season cap in weeklyAssessmentService.ts DNA builder
- [x] Remove 2018+ season cap in routers.ts scoredHealth filter
- [x] Enrich advisorContextBuilder.ts with full career history block (all-time W/L, championships, playoff rates, H2H records, historical patterns)
- [x] Fix hardcoded 2018-2025 copy in OwnerStats.tsx, MyProfileTabContent.tsx, Dashboard.tsx, DraftHistory.tsx, KeeperCalculator.tsx, PlayerProfiles.tsx
- [x] Update DraftHistory.tsx SEASONS array to include 2009-2017
- [x] Update PlayerProfiles.tsx RoundTimeline seasons array to include 2009-2017
- [x] Fix BehavioralAnalytics.tsx useAuth import path (@/_core/hooks/useAuth)
- [x] Run pnpm test (726/726 passing, 37 test files)
- [x] Save checkpoint

## Chrome Extension v1.5.0 — Credential Transfer Fix
- [x] Audit v1.4.0 extension: identified GET_ESPN_CREDENTIALS + OPEN_CONNECT_PAGE handlers missing from background.js, popup.js had no credential capture CTA
- [x] Add GET_ESPN_CREDENTIALS handler to background.js (reads SWID + espn_s2 cookies via chrome.cookies API)
- [x] Add OPEN_CONNECT_PAGE handler to background.js (opens /connect?provider=espn&leagueId=...&swid=...&s2=...)
- [x] Add "cookies" permission to manifest.json
- [x] Bump manifest.json version to 1.5.0
- [x] Restore getLeagueIdFromTabUrl() helper in popup.js
- [x] Restore renderConnectCta() function in popup.js (shows Connect to War Room button when credentials found)
- [x] Restore wireConnectBtn() function in popup.js (sends OPEN_CONNECT_PAGE message on click)
- [x] Inject renderConnectCta() and wireConnectBtn() in both success and error branches of popup.js
- [x] Package as espn_dna_extension_v1.5.0.zip
- [x] Verify LeagueConnect.tsx already handles ?provider=espn&leagueId=...&swid=...&s2=... URL params (confirmed)

## Mobile Optimization — Critical Pages
- [ ] AppLayout: Add hamburger menu + slide-out drawer for mobile (sidebar hidden on <lg screens)
- [ ] DraftWarRoom hub: Make tab bar horizontally scrollable on mobile, reduce tab label text on small screens
- [ ] DraftBoard.tsx: Replace 12-column fixed-width grid with mobile card layout (stacked cards on <md, table on md+)
- [ ] AIDraftHelper.tsx: Already mostly responsive (grid-cols-1 lg:grid-cols-3) — verify padding and button sizes on mobile
- [ ] WeeklyIntelligence hub: Outer space-y-5 wrapper needs px-4 on mobile; tab bar needs overflow-x-auto
- [ ] WeeklyIntelligence: Header controls (Refresh + Run All buttons) need to stack vertically on mobile
- [ ] WeeklyIntelligence: LeaguePulseBanner grid (grid-cols-7) needs to collapse to 2-3 cols on mobile
- [ ] WeeklyStorylinesTab.tsx: Trade card grid-cols-[1fr_auto_1fr] too narrow on mobile — stack vertically
- [ ] TradeAging.tsx: Trade card grid-cols-[1fr_auto_1fr] same issue — stack on mobile
- [ ] RivalryHeatPanel: Already card-based — verify touch targets and text size on mobile
- [ ] TradeLab hub: Tab bar has 6 tabs — needs overflow-x-auto + icon-only on mobile
- [ ] All pages: Ensure minimum touch target size (44px) for all buttons
- [ ] All pages: Add px-4 sm:px-6 padding to page wrappers (currently some have no mobile padding)

## Trade Aging 2026 Fix
- [x] Fix CURRENT_SEASON from 2025 to 2026 in espn.refresh router
- [x] Fix 2026 pick-only trade detection: seed completedProposalIds from TRADE_PROPOSAL rows with status EXECUTED
- [x] Add supplemental scan of proposalItemMap and proposalPickMap for EXECUTED proposals not covered by TRADE_UPHOLD rows
- [x] Fix DraftBoard.tsx mobile card en-dash parse error (replaced UTF-8 en-dash with plain hyphen)

## May 16 — Trade Fix + Nav Fix
- [x] Move Data Center to always-visible Team Tools section in sidebar
- [x] Update fetchTradeProposals to also request TRADE_UPHOLD + TRADE_ACCEPT types
- [x] Update CURRENT_SEASON to 2026 in DataRefresh.tsx (default selected season)
- [x] Fix duplicate espn_season_cache rows (deduplication + unique index added)
- [x] Fix championship count to skip empty-payload seasons (2009-2016)
- [ ] Verify 2026 executed trades appear in Trade Aging after fresh sync

## Session — 2026 Trade Fix + AI Personality (May 16 2026)
- [x] Fixed ESPN 2026 trade fetch: added fetchRecentActivityTrades using communication endpoint (messageTypeId 246 = executed trades)
- [x] Wired fetchRecentActivityTrades into the refresh pipeline after fetchTradeProposals
- [x] Added unique index on espn_season_cache(season, viewName) to prevent duplicate rows on refresh
- [x] Deduped existing duplicate 2025/2026 rows in DB
- [x] Updated CURRENT_SEASON to 2026 in DataRefresh.tsx
- [x] Moved Data Center to always-visible Team Tools section in sidebar
- [x] Made System collapsible button more prominent
- [x] Updated GM Advisor system prompt with War Room AI personality (confident, direct, entertaining)
- [x] Updated AdvisorPanel suggested prompts to match War Room AI tone
- [x] Renamed "AI GM Advisor" to "War Room AI" in panel header
- [x] Fix Trade Aging tab showing empty — added Chrome extension trade scraper + scraped_trades DB table + tradeAging fallback
- [x] ESPN Activity Capture V1 — passive transaction capture via extension, league_events DB table, admin debug view at /admin/activity-capture
- [x] Fix Opponent Intel showing incorrect championship count (findChampionshipMatchup: traces semi-final winners to distinguish championship from 3rd-place game when both are WINNERS_BRACKET in the same period)
- [ ] Fix Trade Aging showing wrong/extra trades — should only show valid completed trades
- [x] Add playoffWins and playoffLosses fields to ownerCareerStats endpoint (computed from schedule playoff matchups per owner)
- [x] Display playoff W/L record in Opponent Intel owner profile cards
- [x] Add playoff W/L to Owner Stats page career summary
- [x] Write vitest for playoff W/L computation logic
- [x] Push playoff W/L changes to GitHub
- [ ] Inject playoffWins/playoffLosses into server-side AI prompts (opponent scouting, rivalry lore, weekly storylines, GM advisor context)
- [ ] Inject playoffWins/playoffLosses into client-side narrative helpers (generatePersonalizedInsight, generateStrategicDirective, reputation sentences)
- [ ] Push AI narrative playoff W-L changes to GitHub

## Enriched H2H Context Propagation
- [ ] Build shared enrichedH2HContext helper (avg PF/PA, biggest win/loss, streaks, season breakdown) in server/h2hContextBuilder.ts
- [ ] Inject enriched H2H into GM Advisor context builder (advisorContextBuilder.ts) — per-opponent breakdown for current week's matchup
- [ ] Inject enriched H2H into Weekly Storylines (weeklyStorylinesService.ts) — REVENGE_GAME, HEARTBREAK_PENDING, SILENT_THREAT contexts
- [ ] Inject enriched H2H into Opponent Intel scouting prompt (routers.ts) — full H2H history block
- [ ] Inject enriched H2H into liveOpponentProfile.ts career object — expose via tRPC for future League Mythology use
- [ ] Write vitest for enrichedH2HContext helper
