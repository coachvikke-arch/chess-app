/* ────────────────────────────────────────────────────────────────────────
   Game Review / Analysis — central tuning table.

   EVERY classification threshold, win% formula and engine setting lives
   here so tuning never requires touching the analysis pipelines.

   MOVE CLASSIFICATION (review pipeline) — deterministic, win% absorb based:
   The Game Review grades every move by TWO numbers (both mover's perspective):
     evalLoss    = centipawns lost vs the engine's best move (rounded ≥ 0)
     winPctDrop  = winPercent(bestM) − winPercent(playedM), floored at 0
   Severity — and therefore the badge — is driven by winPctDrop, matching the
   chess.com win%-drop banding documented in the compare/validation tooling:

       Excellent    winPctDrop ≤   WPD_EXCELLENT_MAX   (2 pp)
       Good         winPctDrop ≤   WPD_GOOD_MAX        (5 pp)
       Inaccuracy   winPctDrop ≤   WPD_INACCURACY_MAX (10 pp)
       Mistake      winPctDrop ≤   WPD_MISTAKE_MAX    (20 pp)
       Blunder      winPctDrop >   WPD_MISTAKE_MAX — or the move hands the
                    opponent a forced mate (played eval is a losing mate score).

   The win% curve itself is the chess.com formula (see reviewClassify.js):
       winPercent(cp) = 50 + 50·(2/(1 + e^(−0.00368·cp)) − 1)
   (WIN_SIGMOID_K = 0.00368 below).

   Special verdicts (checked top-to-bottom, first match wins):
       1  Book        move is inside opening theory (see ./openings.js — a live
                      Lichess Explorer lookup gated by a "sufficient game
                      frequency" rule, with the offline curated book as
                      fallback) and the game is still within the first
                      BOOK_MAX_MOVE_NUMBER fullmoves. A book move that is still
                      a real Mistake/Blunder (winPctDrop ≥ WPD_MISTAKE_MAX)
                      escapes the label.
       2  Miss        a forced mate or decisive win (≥ MISS_WIN_CP) was on the
                      board before this move, but the player played a
                      suboptimal move and let it slip (≥ MISS_MIN_LOSS_CP).
0  Brilliant     a GENUINE sacrifice that survives the full forced exchange,
                       in a sane eval window — qualifying via ONE of two legs:
                       gate = sacrifice && inBrilliantWindow && hasNetSacrifice
                               && (leg1 || leg2)
                       LEG 1 (classical): played is the engine's BEST or
                       NEAR-BEST — within BRILLIANT_NEAR_BEST_CPL (10cp) of the
                       top line. Chess.com's own definition is "best or
                       near-best", and a rank-2 move by a 2cp engine-noise gap
                       (19.Bxd5, best by a hair at depth 18) is still the move
                       a human calls brilliant; strict isBestMove is
                       deliberately NOT required.
                       LEG 2 (grand sacrifice): the engine found a
                       slightly-better NON-sacrifice line, so the played move
                       misses near-best — but the sacrifice is clearly not a
                       blunder: cpl ≤ BRILLIANT_SAC_CPL_MAX AND the played
                       position is still decisively WINNING for the sacrificer
                       (playedM ≥ BRILLIANT_PLAYED_WIN_CP, mover perspective).
                       A hanging queen / losing sac leaves playedM low or
                       negative and can never pass this. Example: 9.Qxf6!!
                       (queen takes the knight on f6, is recaptured by the
                       bishop, but the Nf7+ fork regains the rook — the queen
                       "sacrifice" nets a full rook) at cpl=108 is an
                       "inaccuracy" by CPL yet is the queen-sac that wins the
                       game outright.
                       SHARED, both legs must hold:
                       (2) GENUINE material sacrifice of AT LEAST a MINOR
                           piece — knight/bishop (3), exchange/rook (5) or queen
                           (9), never a trade — detected by sacrificeCandidate()'s
                           geometry: the moved piece is actually capturable, we
                           hold no equal-or-better defender (an equal "trade-back"
                           is not a sac), and either a non-capture landed loose
                           under an enemy attack or a capture still SPENDS net
                           material (dealt > 0, e.g. Nxf7/Bxh7/Bxd5 / rook-queen
                           sacs). Pure PAWN sacrifices (≥ 1 but < 3) NEVER
                           qualify — they fall through to Great Move or Best
                           Move;
(2b) NET-TRADE GUARD: the sacrifice must SURVIVE the
                             full forced exchange sequence — resolve the engine's
                             best continuation after the played move, walking only
                             captures/checks for ≤ BRILLIANT_SETTLED_MAX_PLIES
                             plies until it settles, and track whether the enemy
                             actually took the OFFERED piece and whether the
                             mover kept PRESSING with a follow-up capture/check
                             (settled.pressed — the walk only accepts captures/
                             checks, so any mover ply past the opponent's reply IS
                             the attack continuing). Brilliant is kept when the
                             offered piece is NEVER taken (a poisoned/declined
                             invitation like 19.Bxd5 — the offer is still
                             standing) OR the mover keeps pressing (Nxh7 after
                             Kxh7, Bxh7+ Kxh7 Ng5+ — positional attack compensa-
                             tion). Only a QUIET trade — the offer captured with
                             no pressing follow-up (e.g. Bxc6 Nxc6) — is a plain
                             trade sequence, never Brilliant;
                       (5) SANE WINDOW: −600 < eval_before < 600 — a move in a
                           dead-won/dead-lost position is never Brilliant.
                      A shallow "non-obviousness" probe (find a depth-8 move)
                      is deliberately NOT required: poisoned-piece brilliancies
                      like 19.Bxd5 (Qxd5 blunders the queen to Nxd5) ARE the
                      engine's best at every depth, yet are exactly the moves
                      chess.com marks "!!". The material count is likewise the
                      piece the opponent CAN capture (geometry deal), NOT the
                      engine's best reply — a poisoned piece is never taken in
                      the best line, so that simulation would wrongly reject
                      these very brilliancies. All engine searches stay
                      fixed-depth (deterministic).
4  Great Move  played is the engine's BEST or NEAR-BEST (within
                       BRILLIANT_NEAR_BEST_CPL) AND the runner-up is ≥
                       GREAT_MIN_GAP_CP worse — the only clearly-good option.
                      The gap must stay BELOW FORCED_SECOND_LOSS_CP (at that
                      point it is "forced", and a forced move is never Great —
                      it lands on Best instead), the position must not
                      already be lost (LOST_POSITION_CP), and — when
                      GREAT_NEEDS_SHARP_POSITION — the position must be
                      tactically dense (a real check/capture of OUR side was
                      available, so the big gap is a find, not just an
                      opponent blunder handed to a quiet move). Brilliant is
                      checked first: a qualifying sacrifice is Brilliant,
                      never Great.
       5  Best Move   played == engine best with CPL ≤ 0. A FORCED best move
                      (single legal move, or every alternative ≥
                      FORCED_SECOND_LOSS_CP worse) lands here too: Brilliant
                      required a genuine sacrifice and Great requires
                      not-forced, so a forced non-sacrifice best move is Best.

   Tie-breaking (always applied): evalLoss is a rounded integer before any
   error-band comparison (winPctDrop is left unrounded for the band cheks);
   SPECIAL VERDICT ORDER is fixed:
       1. isBrilliantMove() → Brilliant (STOP)
       2. isGreatMove()   → Great      (STOP)
       3. isBestMove()    → Best
       4. else → Excellent/Good/Inaccuracy/Mistake/Blunder bands (winPctDrop).
   (There is no separate "Only Move" verdict: a FORCED best move isn't
   Brilliant (no sacrifice) nor Great (Great requires not-forced), so it
   lands on Best. "Forced" is derived from the MultiPV runner-up gap — no
   evaluate-every-legal-move loop needed.)

   ACCURACY (review pipeline) — chess.com-compatible win%-curve model.
   Each move's quality comes from the win PERCENTAGE it LOST (not the raw
   centipawn count) — the reverse-engineered chess.com CAPS formula:
        move_accuracy = ACC_MAX · e^(−ACC_DECAY · winPctDrop) − ACC_FLOOR
   with ACC_MAX = 103.1668, ACC_DECAY = 0.04354, ACC_FLOOR = 3.1669,
   clamped to 0..100. Perfect verdicts (Best/Brilliant/Great) have
   winPctDrop 0 and land at exactly 100. The GAME number is the PLAIN MEAN of
   those per-move grades (chess.com's CAPS headline — no volatility
   re-weighting): every analysable move counts equally, so blunders pull the
   headline down by their own per-move score and a game with lots of blunders
   lands well below 90%.
        game_acc = Σ(acc_i) / n, book moves scoring a flat 100
   Rows without engine data are excluded, "avg CPL" still reports the plain
   unweighted average, and "avg WPD" the plain average win% dropped — both
   used by the chess.com comparison tool. Because the score consumes the
   same winPctDrop that produced each badge, the headline accuracy can never
   contradict the classification sheet.

   Legacy / instant-analysis (./gameAnalysis.js — Chess Profile & Analysis
   Board) still uses the win%-expected-points bands below (WPB_*). Both
   models share the same win% curve and MATE_SCORE sentinel.
   ──────────────────────────────────────────────────────────────────────── */

/* ---------- win% conversion (expected points) ---------- */
export const MATE_SCORE = 100000;         // eval sentinel for mate (matches engine.js)
export const WIN_SIGMOID_K = 0.00368;     // chess.com S-curve steepness (the formula's 0.00368)
export const BEST_WIN_EPS = 0.01;         // max expected-points "loss" still Best

/* ---------- legacy win%-band thresholds (instant analysis only) ---------- */
export const WPB_EXCELLENT = 0.02;        // Excellent upper bound
export const WPB_GOOD = 0.05;             // Good upper bound (= Inaccuracy lower)
export const WPB_INACCURACY = 0.10;       // Inaccuracy upper bound (= Mistake lower)
export const WPB_MISTAKE = 0.20;          // Mistake upper bound (= Blunder lower)

/* ---------- win%-drop classification bands (review) ---------- */
export const WPD_EXCELLENT_MAX = 2;       // winPctDrop ≤ 2 ⇒ Excellent
export const WPD_GOOD_MAX = 5;            // winPctDrop ≤ 5 ⇒ Good
export const WPD_INACCURACY_MAX = 10;     // winPctDrop ≤ 10 ⇒ Inaccuracy
export const WPD_MISTAKE_MAX = 20;        // winPctDrop ≤ 20 ⇒ Mistake (Blunder above)

/* ---------- chess.com accuracy model (review) ---------- */
export const ACC_MAX = 103.1668;          // move_accuracy = ACC_MAX·e^(−ACC_DECAY·wpd) − ACC_FLOOR
export const ACC_DECAY = 0.04354;         // the win%-drop decay (reverse-engineered chess.com CAPS)
export const ACC_FLOOR = 3.1669;          // subtracted so a perfect move lands on 100 exactly

/* ---------- special verdicts (review) ---------- */
export const GREAT_MIN_GAP_CP = 150;      // runner-up ≥ this much worse ⇒ Great ("only clear move", spec >= 150)
export const LOST_POSITION_CP = -300;     // evalBefore ≤ this ⇒ already losing ⇒ no Great
export const GREAT_NEEDS_SHARP_POSITION = true; // Great-4: require tactical density — quiet positions (no check/capture
                                             // available to us) whose big gap just reflects an opponent blunder get no "!"
export const BRILLIANT_NEAR_BEST_CPL = 10; // Brilliant leg-1 / Great condition (1): played within this many cp of the engine's best
                                            // ("best or near-best" — chess.com's own definition; a rank-2 sac by engine noise
                                            // like 19.Bxd5 (2cp) still qualifies, strict isBestMove is not required)
export const BRILLIANT_SAC_CPL_MAX = 150;   // Brilliant LEG-2 (grand sacrifice): played may miss near-best by up to this cpl — the
                                            // engine found a better NON-sacrifice line, but the sacrifice is NOT a blunder
export const BRILLIANT_PLAYED_WIN_CP = 200; // Brilliant LEG-2 (grand sacrifice): the played position must still be decisively
                                            // winning for the mover (playedM ≥ this, mover perspective) — a hanging piece / losing
                                            // sac leaves playedM low or negative and never passes
export const BRILLIANT_SETTLED_MAX_PLIES = 18; // Bounded engine-PV tactical settlement (never a full-game scan).
export const BRILLIANT_EVAL_MIN = -600;    // Brilliant-5: eval window — below this ⇒ dead-lost ⇒ never Brilliant
export const BRILLIANT_EVAL_MAX = 600;     // Brilliant-5: above this ⇒ dead-won ⇒ never Brilliant
export const SAFE_ALT_EVAL_CP = -300;      // Brilliant-4: a MultiPV alternative above this is a "safe" one
export const BOOK_MAX_MOVE_NUMBER = 15;   // "book" applies only within the first 15 fullmoves
export const MISS_WIN_CP = 1000;          // evalBefore ≥ this ⇒ a decisive win was on the board
export const MISS_MIN_LOSS_CP = 150;      // evalLoss ≥ this after a decisive win ⇒ Miss
export const MATE_SCORE_WINDOW = 10000;   // |score| within this of MATE_SCORE ⇒ a mate score
export const FORCED_SECOND_LOSS_CP = 300; // runner-up this much worse ⇒ forced ⇒ Best (forced is never Great; Great runs only below this)

/* ---------- opening book (Lichess Explorer + offline fallback) ---------- */
export const BOOK_EXPLORER_ENDPOINT = 'https://explorer.lichess.ovh/masters'; // masters DB — clean, community+top-game theory
export const BOOK_MIN_POSITION_GAMES = 20;    // position must appear ≥ this many times in the DB before any move is tagged
export const BOOK_MIN_MOVE_GAMES = 5;         // the played move must itself appear ≥ this many times
export const BOOK_MIN_MOVE_SHARE = 0.5;       // … and ≥ this % of the position's games ("sufficient game frequency")

/* ---------- engine search (game review) ---------- */
/* DETERMINISM CONTRACT: the review pipeline NEVER searches "for X ms" — every
   position is analysed to a FIXED depth. Time-based cuts would let CPU load
   shift the effective depth between runs and flip verdicts. Lower the depth
   for faster reviews, raise it for quality; any fixed value is reproducible.
   Depth 18 is the chess.com-grade default; REVIEW_DEPTH_DEEP (22) backs the
   "deep" review mode. */
export const REVIEW_DEPTH = 18;           // fixed search depth — same every run (chess.com standard)
export const REVIEW_DEPTH_DEEP = 22;      // "deep" review mode (engineOverrides.deep)
export const REVIEW_MULTIPV = 3;          // candidate lines searched per position — top 3 (best/great/good)
                                          // drawn as the board arrows while browsing each move of the review
export const REVIEW_MIN_TRUST_DEPTH = 7;  // searches shallower than this can't brand a move as an error
                                          // (only reachable on actual engine failure/failed search)
export const REVIEW_HASH_MB = 128;        // hash table per review worker ("Hash 128MB minimum" per chess.com spec)
export const REVIEW_THREADS = 1;          // pinned — the SF.js WASM build is single-threaded per instance; the worker
                                          // pool (REVIEW_WORKER_POOL) is the concurrency knob, kept at 1 thread/worker
                                          // so every search is byte-for-byte reproducible.

/* How many Stockfish worker instances the review may search on in PARALLEL.
   Every positioned-fixed-depth search is fully independent, so running W of
   them concurrently yields byte-for-byte the same verdicts/cpl/scores as one
   worker — it only shortens wall-clock time ~W×. Each worker is an extra wasm
   instance (~128MB hash + net); keep this small. This is the DEFAULT and the
   Node/test fallback; in a real browser the pool auto-scales to spare cores
   (REVIEW_ENGINE_POOL in ./engineConfig.js), capped at REVIEW_POOL_MAX, and
   the review pipeline's dispatch width tracks that engine pool. */
export const REVIEW_WORKER_POOL = 3;

/* Hard ceiling for the browser's auto-scaled review worker pool. More workers
   = faster reviews, but each holds the full NNUE wasm (≈113 MB) + its own
   128MB hash, so the cap balances wall-clock (cores − 1) against memory.

   The cap was 3, which on any machine with more than 4 cores left spare cores
   completely idle for the whole review. Measured on 8 cores / 7.7 GB
   (scripts/review-pool-scaling.mjs, 30-ply game, depth 14, identical
   classifications at every pool size):
       pool 2 → 65.3s min     pool 3 → 60.6s min
       pool 4 → 58.7s min     pool 6 → 44.3s min
   The engine is the only thing saturating the CPU during a review (total engine
   time is ~40x wall-clock), so pool size is the ONLY lever available without
   changing results — every other way to cut work alters a search and therefore a
   verdict. 4 is the safe step: it still fits 7 GB with room to spare
   (4 × ~240 MB ≈ 1 GB) and is what a 5-7 core desktop can actually use, while
   the low-memory clamp in engineConfig.js keeps phones and ≤4 GB laptops at 2.
   Going beyond 4 is deliberately not automatic: boot failure ("Stockfish
   WebAssembly failed to load") is the failure users actually hit, and it
   arrives with the memory, not the core count. */
export const REVIEW_POOL_MAX = 4;

/* ---------- two-stage review: fast scan, then deep only where it matters ----------
   The review used to run the FULL depth-18 MultiPV-3 search on EVERY ply, plus a
   second depth-18 search whenever the played move was not in the top 3 — about
   1.7 depth-18 searches per ply. Measured with scripts/review-bench.mjs at
   depth 18 / pool 4 that is 180 searches and 1732.6s of engine time for two
   40/56-ply games.

   Cost per ply of depth, measured per position (scripts/review-bench harness,
   pool 1, MultiPV 3): depth 12 ~625ms, depth 14 ~1436ms, depth 16 ~3090ms,
   depth 18 ~6894ms. So a depth-10 scan is roughly 16-20x cheaper than the
   depth-18 search it stands in for. The deep search dominates the review almost
   entirely, so the only lever that moves the wall clock is HOW MANY positions
   get one.

   Stage 1 (REVIEW_SCAN_DEPTH) analyses every position cheaply. Stage 2
   (REVIEW_DEPTH) is spent only on positions where the cheap answer cannot be
   trusted — see REVIEW_CRITICAL_CPL.

   These are FIXED values, never derived from a clock — see the determinism
   contract above. A slow device runs the same searches and takes longer, rather
   than returning different verdicts. */
export const REVIEW_SCAN_DEPTH = 10;        // stage-1 depth for every position
export const REVIEW_SCAN_MULTIPV = 3;       // stage 1 keeps the 3-line set, so the
                                           // review's best/great/good arrows still render
export const REVIEW_SCAN_ENABLED = true;    // master switch for the two-stage pipeline

/* Centipawn loss above which a move gets a full-depth search.
   The trigger level IS the speed/accuracy dial. Measured on the parity harness
   (96 plies, depth 18, pool 4) with a depth-10 scan standing in for the rest:

     bar   deep%   engine time   wall clock (quiet-40 / tactical-56)
     200    38%      965.3s        37.5s / 30.0s
     400    11-20%   331.3s        20.1s / 16.1s   <- default
     600     7-10%   (contaminated by an engine timeout, not comparable)
     800     5%      ~170s est.    ~10s / ~8s est.

   Against the 1732.6s / 46.9s / 72.7s no-scan baseline, 400 is a 5.2x cut in
   engine time and 2.3-4.5x in wall clock.

   The review's centipawn distribution is much wider than its VERDICT
   distribution: p50 134cp, p75 228cp, p90 606cp, p95 737cp, while only 18% of
   plies are blunder-or-worse. That is why a 50cp "every mistake is critical"
   bar sends most of the game deep and saves almost nothing — the trigger keys on
   raw centipawn loss, not on the verdict.

   Raising the bar buys speed without measurably adding drift: the 4
   classification mismatches below are identical at 200 and 400, because they
   come from the depth-10 scan answers themselves, not from the bar. Never
   derived from a clock. */
export const REVIEW_CRITICAL_CPL = 400;

/* A shallow search can UNDER-estimate centipawn loss, so a move sitting just
   below the bar is exactly the one most likely to cross it at depth 18. Moves
   within this many cp below the bar are promoted to a deep search. This is a
   one-sided band, not a two-sided one: there is no cheap, safe way to tell that
   a move scored at 20cp will not be scored at 90cp, and that uncertainty is
   handled by REVIEW_CRITICAL_CPL rather than by a second search. */
export const REVIEW_CRITICAL_BAND_CP = 30;

/* Bumped whenever the engine build or the scoring path changes, so a cached
   result can never outlive the thing that produced it. Part of every cache key. */
export const REVIEW_ENGINE_VERSION = 'nnue-18-1';

/* Bumped by hand whenever CLASSIFICATION changes — a brilliant or sacrifice
   gate, the protected-sacrifice path, the CPL/accuracy formulas, the
   brilliant→sigma conversion. It is a segment of CANONICAL_ANALYSIS_VERSION, so
   a logic change invalidates every stored analysis exactly as an engine or
   depth change does. Without it, new classification logic would keep serving
   results produced by the old logic and nobody would notice for months. */
export const REVIEW_LOGIC_VERSION = 1;

/* ---------- analysis board ("Maximum Time 5 sec · 3 lines") ---------- */
export const ANALYSIS_DEPTH = 22;
export const ANALYSIS_TIME_MS = 5000;
export const ANALYSIS_MULTIPV = 3;

/* ---------- game review live engine (Advanced Engine / Analysis mode) ----------
   The "Analysis Engine" toggle on the Game Review board runs a FIXED-DEPTH
   Stockfish search on the current position (live eval bar + best-move hint)
   and grades every variation move with the same win%-drop classifier as the
   main review. Depth 16 keeps each live search snappy while staying inside
   the chess.com-grade 16–18 band; raise for quality, lower for speed. */
export const LIVE_ANALYSIS_DEPTH = 16;
export const LIVE_ANALYSIS_MULTIPV = 3; // top candidate lines → drawn as colored arrows

/* ---------- legacy accuracy model (kept only for compatibility) ---------- */
export const ACCURACY_CPL_CAP = 1000;      // display cap for the per-move CPL column
export const ACCURACY_DECAY = 0.004;       // legacy 100·e^(−0.004·cpl) fallback (accuracyFromCpl) — NOT used by reviews