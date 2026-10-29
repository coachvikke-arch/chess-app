"""Extract easy candidate puzzles from the Lichess puzzle database (CC0).

The CSV is streamed (it is ~293 MiB compressed / several GB expanded), so only
matching rows are ever held in memory. The output is a CANDIDATE POOL: the Node
builder (build_tactics_puzzles.mjs) then replays every line through chess.js and
writes the shipped puzzles.json.

Usage:
  python scripts/extract_lichess_samples.py \
      "C:/Users/MANIVEL M/Downloads/lichess_db_puzzle.csv.zst" \
      scripts/data/lichess-samples.json

Columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,...
"""
import csv
import io
import json
import sys

import zstandard

TARGET_THEMES = [
    "fork",
    "pin",
    "skewer",
    "discoveredAttack",
    "doubleCheck",
    "backRankMate",
    "mateIn1",
    "mateIn2",
    "mateIn3",
    "hangingPiece",
    "deflection",
    "attraction",
    "interference",
    "sacrifice",
    "trappedPiece",
    "intermezzo",
    "xRayAttack",
    "smotheredMate",
    "clearance",
    "promotion",
    "quietMove",
]

# Puzzle themes that describe the *source/format* rather than an idea. They
# appear on almost every row, so unlike a normal tag they must not disqualify
# a candidate — `master` rows in particular are engineered studies, which is
# the opposite of the "simple and easy" samples this pool is for.
NOISE = {"master", "masterVsMaster", "superGM"}

PER_THEME = 60          # candidate pool size per theme (builder picks 5-10)
RATING_MIN, RATING_MAX = 600, 1200
POPULARITY_MIN = 70
MIN_PLAYS = 150
# Lichess always writes an EVEN number of plies: the first move is the opponent's
# blunder that *creates* the tactic, and from there the solver and the opponent
# alternate, ending on the solver's move. So a two-ply row is "trigger + answer"
# and six plies is a three-move line. Five plies cannot exist.
MIN_PLIES, MAX_PLIES = 2, 6


def main(src, out):
    picked = {t: [] for t in TARGET_THEMES}
    # Count matches for a broad rating band so a theme that is rare at the easy
    # end can widen, rather than silently shipping an empty topic.
    seen = 0
    with open(src, "rb") as fh:
        dctx = zstandard.ZstdDecompressor()
        with dctx.stream_reader(fh) as reader:
            text = io.TextIOWrapper(reader, encoding="utf-8", newline="")
            for row in csv.reader(text):
                if not row or row[0] == "PuzzleId":
                    continue
                seen += 1
                if len(row) < 8:
                    continue
                pid, fen, moves, rating, _dev, popularity, plays, themes = row[:8]
                try:
                    rating = int(rating)
                    popularity = int(popularity)
                    plays = int(plays)
                except ValueError:
                    continue
                if not (RATING_MIN <= rating <= RATING_MAX):
                    continue
                if popularity < POPULARITY_MIN or plays < MIN_PLAYS:
                    continue
                theme_set = set(themes.split())
                if theme_set & NOISE:
                    continue
                line = moves.split()
                if len(line) < MIN_PLIES or len(line) > MAX_PLIES or len(line) % 2 != 0:
                    continue
                for theme in TARGET_THEMES:
                    if theme in theme_set and len(picked[theme]) < PER_THEME:
                        picked[theme].append({
                            "id": pid,
                            "fen": fen,
                            "moves": line,
                            "rating": rating,
                            "themes": sorted(theme_set),
                            "gameUrl": row[8] if len(row) > 8 else "",
                        })

    pool = {t: rows for t, rows in picked.items() if rows}
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(pool, fh, separators=(",", ":"))
    for theme in TARGET_THEMES:
        print(f"{theme:16s} {len(picked[theme]):3d}")
    print(f"scanned {seen} rows")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
