# Overall Champion Score

The Overall Champion ladder is a single 0–100 score, computed live from records
the academy already stores. There is no `champion` table, no nightly snapshot and
no per-page variant: the leaderboard page and the student dashboard both read
`GET /students/ratings/champions`, so they cannot disagree.

## Where the numbers come from

| Metric | Source | Counting rule |
| --- | --- | --- |
| Games, wins, losses, draws | `student_game_analysis` (per-day rollups of finished online, bot and computer games) **plus** finished `online_games` and `computer_games` rows with `analysis_aggregated_at IS NULL` | Every finished game is counted exactly once. The rollup and the raw tables are disjoint by `analysis_aggregated_at`, so a game cannot be counted twice before or after the cleanup job runs. Both sides of an online board are credited. |
| Attendance | `attendance` joined to `classes` | Present and late count as attended; the percentage is over every marked row. Cancelled classes are excluded. |
| Puzzles solved | `puzzle_attempts` joined to `puzzles` | `COUNT(DISTINCT puzzle_id)` over correct attempts — replaying one puzzle cannot inflate the total. Difficulty weights: Easy 0.6, Medium 1.0, Hard 1.4. |
| Puzzle accuracy | `puzzle_attempts` | Correct attempts ÷ all attempts. |
| Streak | Distinct active days from games, puzzles and attended classes | Any one activity keeps a day alive. One day is never counted twice. A streak may end today or yesterday so it does not reset before the student has played. |
| Consistency | Active days in the last 30 days | Half regularity, half balance across games, puzzles and classes. |

Eligible students are `users.role = 'student'` with `students.active = TRUE`.
The public route additionally hides `students.hide_from_leaderboard = TRUE`; the
coach route includes opted-out students, because the opt-out is about the public
board.

## Formula

Each metric is normalised to 0–1 against a fixed cap, then multiplied by its
weight. No weight exceeds 20 of the 100 available points.

```
games       = min(games, 100) / 100                                × 20
win rate    = (wins + 0.5·draws + 1) / (wins + losses + draws + 2) × 15
attendance  = attended / marked                                    × 15
puzzles     = min(weighted solved, 60) / 60                        × 20
puzzle acc. = (correct + 1) / (attempts + 2)                       × 10
streak      = min(streak days, 30) / 30                            × 10
consistency = ½·regularity + ½·balance                             × 10

regularity  = min(active days in the last 30, 20) / 20
balance     = 3 × min(game days, puzzle days, class days) / total days
              (0 when the window has no activity)
```

The `+1 / +2` terms smooth win rate and puzzle accuracy towards 50 %, so one
lucky game cannot outrank a season-long record. They affect the score only; the
UI shows the raw win % and accuracy.

## Weights

Defaults live in `backend/src/services/overallChampionService.js`. Override them
with the `CHAMPION_WEIGHTS` environment variable — a JSON object using the same
keys:

```
CHAMPION_WEIGHTS={"games":20,"winRate":15,"attendance":15,"puzzles":20,"puzzleAccuracy":10,"streak":10,"consistency":10}
```

Overrides are normalised back to 100 points so the top of the table always means
"perfect on every metric". Invalid JSON logs a warning and falls back to the
defaults.

## Tie-breaks

Higher score, then higher win %, then more decided games, then name.

## Freshness

- The leaderboard refetches when the Overall Champion tab is opened, every 60
  seconds while it is open, and whenever the tab regains visibility.
- The dashboard card refetches on the `puzzle-solved` event and on the same
  visibility/interval schedule.
- New games, attempts and attendance rows are therefore reflected without a
  reload; nothing is cached for longer than a minute.
