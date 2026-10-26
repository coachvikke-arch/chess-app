#!/usr/bin/env python3
"""
Chess Game Analysis Engine (Python backend).

Usage — CLI modes:
  python game_analysis.py --pgn-file  <path.pgn>               # analyze a PGN file
  python game_analysis.py --pgn       "<pgn-text>"            # analyze inline PGN
  python game_analysis.py --fen       "<fen>"                 # evaluate a single position
  python game_analysis.py --image     <board.png>             # detect FEN via vision, then eval
  python game_analysis.py --skill     10 --pgn "..."          # (future) Stockfish skill tuning

Emits JSON to stdout:
  {
    "ok": true,
    "opening":   { "eco": "...", "name": "...", "moves": n },
    "moves":     [ { "san": "...", "evaluation": 0.34, "category": "best|good|inaccuracy|mistake|blunder",
                     "lost_cp": 0, "wdl": [50, 50, 0] }, ... ],
    "accuracy":  { "white": 92.4, "black": 88.1 },
    "summary":   { "brilliant": 2, "best": 17, "good": 8, "inaccuracy": 3,
                   "mistake": 1, "blunder": 0 },
    "verdict":   { "winner": "white|black|draw", "method": "checkmate|stalemate|resign|..." }
  }

On error:
  { "ok": false, "error": "..." }
"""

from __future__ import annotations

import sys
import os
import io
import json
import re
import argparse
import math
from typing import Optional, List, Dict, Any, Tuple

# ---------------------------------------------------------------------------
# Dependencies — python-chess is required for the move-quality heuristics.
# Stockfish / UCI engine is optional (graceful degradation if missing).
# ---------------------------------------------------------------------------
try:
    import chess
    import chess.pgn
    import chess.engine
except ImportError:
    print(json.dumps({
        "ok": False,
        "error": "python-chess is required — install with: pip install chess",
    }))
    sys.exit(1)

# Try to import the sibling board-FEN detector for --image mode.
_detected_fen_func = None
try:
    import detect_fen  # type: ignore
    _detected_fen_func = detect_fen.detect_fen  # type: ignore[attr-defined]
except Exception:
    _detected_fen_func = None


# ---------------------------------------------------------------------------
# Constants & simple heuristics (pure Python, no engine needed).
# Centipawn classification thresholds (from Lichess / popular practice).
# ---------------------------------------------------------------------------
CP_CATEGORIES = [
    ("blunder",     300),   # >= 3 pawns lost
    ("mistake",     150),   # >= 1.5 pawns
    ("inaccuracy",   60),   # >= 0.6 pawns
    ("good",         20),   # minor degradation
    ("best",          0),   # within 20 cp of the engine top move
]
CATEGORY_ORDER = ["best", "good", "inaccuracy", "mistake", "blunder"]

# Very small opening book (EAN-name → name) to cover common first moves.
# Real deployments should use a polyglot book; this is a friendly fallback.
OPENING_BOOK: List[Tuple[Tuple[str, ...], str, str]] = [
    (("e4",),                  "B00", "King's Pawn Opening"),
    (("d4",),                  "A00", "Queen's Pawn Opening"),
    (("c4",),                  "A10", "English Opening"),
    (("Nf3",),                 "A05", "Réti Opening"),
    (("e4", "e5"),             "C20", "King's Knight"),
    (("e4", "e5", "Nf3"),      "C40", "King's Knight Opening"),
    (("e4", "c5"),             "B20", "Sicilian Defence"),
    (("e4", "e6"),             "B00", "French Defence"),
    (("e4", "c6"),             "B10", "Caro–Kann Defence"),
    (("e4", "d5"),             "B01", "Scandinavian Defence"),
    (("d4", "d5"),             "D00", "Closed Game"),
    (("d4", "Nf6"),            "A45", "Indian Defence"),
    (("d4", "d5", "c4"),       "D06", "Queen's Gambit"),
    (("d4", "Nf6", "c4"),      "A50", "Queen's Pawn Indian"),
    (("e4", "e5", "Nf3", "Nc6", "Bb5"), "C60", "Ruy Lopez"),
    (("e4", "e5", "Nf3", "Nc6", "Bc4"), "C50", "Italian Game"),
    (("e4", "c5", "Nf3"),      "B21", "Sicilian — Open"),
    (("d4", "d5", "c4", "e6"), "D30", "Queen's Gambit Declined"),
    (("d4", "Nf6", "c4", "g6"), "A60", "King's Indian"),
]


def classify_drop(lost_cp: float) -> str:
    """Return a human-quality label for a given centipawn loss."""
    for label, threshold in CP_CATEGORIES:
        if lost_cp >= threshold:
            return label
    return "best"


def lookup_opening(moves_san: List[str]) -> Dict[str, Any]:
    """Match a move list against our tiny opening book (longest prefix wins)."""
    best_idx = -1
    best_entry = None
    for i, (seq, eco, name) in enumerate(OPENING_BOOK):
        if len(seq) <= len(moves_san) and tuple(moves_san[:len(seq)]) == seq:
            if len(seq) > best_idx:
                best_idx = len(seq)
                best_entry = (eco, name)
    if best_entry:
        return {"eco": best_entry[0], "name": best_entry[1], "moves": best_idx}
    return {"eco": "???", "name": "Uncommon opening", "moves": 0}


def accuracy_from_cpl(cpl_list: List[float]) -> float:
    """Lichess-style accuracy: weighted non-linear transform of avg centipawn loss.

    accuracy = 100 * exp(-k * cpl)   clipped to [0..100]
    """
    if not cpl_list:
        return 0.0
    mean = sum(cpl_list) / len(cpl_list)
    k = 0.0043  # ~ calibrated so cpl=100 -> 65%, cpl=20 -> 92%, cpl=0 -> 100%
    acc = 100.0 * math.exp(-k * mean)
    return max(0.0, min(100.0, round(acc, 2)))


# ---------------------------------------------------------------------------
# Lightweight "engine" evaluation without a real UCI engine.
# Produces a signed score from white's POV using only material + mobility.
# Good enough to find obvious blunders and classify moves when no Stockfish
# binary is installed.
# ---------------------------------------------------------------------------
PIECE_VAL = {
    chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
    chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0,
}
_PST_PAWN = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
]
_PST_KNIGHT = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
]

def _pst_val(sq64, color, arr):
    sq = sq64 if color else chess.square_mirror(sq64)
    return arr[sq]

def eval_position(board: chess.Board) -> int:
    """Material + simple PST — positive = white is better, units: centipawns."""
    score = 0
    for sq in chess.SQUARES:
        p = board.piece_at(sq)
        if not p:
            continue
        val = PIECE_VAL[p.piece_type]
        pst = 0
        if p.piece_type == chess.PAWN:
            pst = _pst_val(sq, p.color == chess.WHITE, _PST_PAWN)
        elif p.piece_type == chess.KNIGHT:
            pst = _pst_val(sq, p.color == chess.WHITE, _PST_KNIGHT)
        sign = 1 if p.color == chess.WHITE else -1
        score += sign * (val + pst)
    # Terminal nodes: mate / stalemate
    if board.is_checkmate():
        return -9999 if board.turn == chess.WHITE else 9999
    if board.is_stalemate() or board.is_insufficient_material():
        return 0
    return score


def analyze_game_pgn(pgn_text: str, skill: Optional[int] = None) -> Dict[str, Any]:
    """Walk a PGN, evaluate each position, classify per-move quality."""
    moves_san: List[str] = []
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        # Fallback: push each SAN token by building a board from scratch.
        board = chess.Board()
        tokens = re.findall(
            r"([Oo0]-[Oo0](?:-[Oo0])?|[a-hxOoBNRKQ\+\=#\-\d][a-hxOoBNRKQ\+\=\-\d!?]*|0-1|1-0|1/2-1/2)",
            pgn_text,
        )
        for tok in tokens:
            if tok in {"1-0", "0-1", "1/2-1/2", "*"}:
                break
            try:
                board.push_san(tok)
                moves_san.append(tok)
            except Exception:
                # Skip non-move tokens — line numbers, annotations etc.
                pass
        # Re-create a game object from the move stack so we can re-walk it cleanly
        board2 = chess.Board()
        for san in moves_san:
            board2.push_san(san)
        node = chess.pgn.Game()
        for san in moves_san:
            node = node.add_variation(chess.Move.from_uci(board2.move_stack[len(node.move_stack)].uci()))
        game = node.game() if node else chess.pgn.Game.from_board(board2)

    # Walk the game once and score each side's moves.
    board = chess.Board()
    moves_analysis: List[Dict[str, Any]] = []
    white_cpl: List[float] = []
    black_cpl: List[float] = []
    prev_eval = 0
    white_san: List[str] = []
    black_san: List[str] = []

    # Collect the SAN sequence for opening book lookup.
    san_list: List[str] = []
    for node in game.mainline():
        san = node.san()
        san_list.append(san)
    opening = lookup_opening(san_list)

    prev_eval = eval_position(board)
    for i, node in enumerate(game.mainline()):
        san = node.san()
        board.push(node.move)
        new_eval = eval_position(board)
        # "lost_cp" from the *mover's* POV: a negative swing (for white, eval went down) = they lost CP.
        turn_was_white = (i % 2 == 0)
        # prev_eval was white-POV before the move; after move, new_eval is still white-POV.
        if turn_was_white:
            delta = new_eval - prev_eval           # positive = white gained
            lost = max(0, -delta)
            white_cpl.append(float(lost))
            white_san.append(san)
        else:
            delta = prev_eval - new_eval           # positive = black gained
            lost = max(0, -delta)
            black_cpl.append(float(lost))
            black_san.append(san)
        cat = classify_drop(lost)
        moves_analysis.append({
            "index": i,
            "san": san,
            "turn": "white" if turn_was_white else "black",
            "eval_cp": new_eval if abs(new_eval) < 9000 else None,
            "mate": (None if abs(new_eval) < 9000 else
                     ((1 if new_eval > 0 else -1) * max(1, 20 - (new_eval % 10)))),
            "lost_cp": int(lost),
            "category": cat,
        })
        prev_eval = new_eval

    # Aggregate stats.
    summary_counts: Dict[str, int] = {c: 0 for c in ["best", "good", "inaccuracy", "mistake", "blunder"]}
    for m in moves_analysis:
        summary_counts[m["category"]] = summary_counts.get(m["category"], 0) + 1

    # Brilliant = exceptional moves that *gain* material/position (very rough heuristic).
    # In our model this is a rare "best" move preceded by opponent inaccuracy, which we
    # don't track here. For stability we seed 0 and let the front-end's comparison vs
    # Stockfish override if available.
    summary = {
        "brilliant": 0,
        "best": summary_counts["best"],
        "good": summary_counts["good"],
        "inaccuracy": summary_counts["inaccuracy"],
        "mistake": summary_counts["mistake"],
        "blunder": summary_counts["blunder"],
    }
    accuracy = {
        "white": accuracy_from_cpl(white_cpl),
        "black": accuracy_from_cpl(black_cpl),
    }

    # Verdict from the final position.
    if board.is_checkmate():
        winner = "black" if board.turn == chess.WHITE else "white"
        verdict = {"winner": winner, "method": "checkmate"}
    elif board.is_stalemate():
        verdict = {"winner": "draw", "method": "stalemate"}
    elif board.is_insufficient_material():
        verdict = {"winner": "draw", "method": "insufficient material"}
    elif board.is_repetition(count=3):
        verdict = {"winner": "draw", "method": "threefold repetition"}
    elif board.is_fifty_moves():
        verdict = {"winner": "draw", "method": "fifty-move rule"}
    elif board.is_game_over():
        verdict = {"winner": "draw", "method": "game over"}
    else:
        verdict = {"winner": None, "method": None}

    return {
        "ok": True,
        "opening": opening,
        "moves": moves_analysis,
        "accuracy": accuracy,
        "summary": summary,
        "verdict": verdict,
        "engine": "python-heuristic" + (" (skill=%d)" % skill if skill else ""),
        "total_moves": len(moves_analysis),
    }


def analyze_fen(fen: str, skill: Optional[int] = None) -> Dict[str, Any]:
    try:
        board = chess.Board(fen)
    except ValueError as e:
        return {"ok": False, "error": f"Invalid FEN: {e}"}
    score = eval_position(board)
    terminal = (
        {"winner": "black" if board.turn == chess.WHITE else "white", "method": "checkmate"}
        if board.is_checkmate() else
        {"winner": "draw", "method": "stalemate"} if board.is_stalemate() else
        {"winner": "draw", "method": "insufficient material"} if board.is_insufficient_material() else None
    )
    return {
        "ok": True,
        "fen": fen,
        "turn": "white" if board.turn else "black",
        "legal_moves": board.legal_moves.count(),
        "evaluation_cp": score if abs(score) < 9000 else None,
        "mate_in": (None if abs(score) < 9000 else
                    1 if score > 0 else -1),
        "game_over": board.is_game_over(),
        "verdict": terminal,
        "engine": "python-heuristic" + (" (skill=%d)" % skill if skill else ""),
    }


def detect_and_analyze_image(path: str) -> Dict[str, Any]:
    """Use the sibling vision module (detect_fen) to OCR a board image, then eval."""
    if _detected_fen_func is None:
        return {
            "ok": False,
            "error": "detect_fen module unavailable — check that OpenCV + numpy are installed",
        }
    if not os.path.isfile(path):
        return {"ok": False, "error": f"Image not found: {path}"}
    try:
        out = _detected_fen_func(path)
    except Exception as e:
        return {"ok": False, "error": f"Vision error: {e}"}
    fen = out.get("fen") if isinstance(out, dict) else None
    if not fen:
        return {"ok": False, "error": "Vision module did not return a FEN string", "vision": out}
    analysis = analyze_fen(fen)
    analysis["vision"] = out
    return analysis


# ---------------------------------------------------------------------------
# CLI entry.
# ---------------------------------------------------------------------------

def _cli() -> None:
    parser = argparse.ArgumentParser(description="Chess Game Analysis (Python backend)")
    parser.add_argument("--pgn", dest="pgn", default=None, help="Inline PGN text")
    parser.add_argument("--pgn-file", dest="pgn_file", default=None, help="Path to a PGN file")
    parser.add_argument("--fen", dest="fen", default=None, help="Single FEN position to evaluate")
    parser.add_argument("--image", dest="image", default=None, help="Board image → detect FEN then eval")
    parser.add_argument("--skill", dest="skill", type=int, default=None, help="Engine skill hint (1-20)")
    args = parser.parse_args()

    result: Dict[str, Any]
    try:
        if args.image:
            result = detect_and_analyze_image(args.image)
        elif args.fen:
            result = analyze_fen(args.fen, skill=args.skill)
        elif args.pgn_file:
            if not os.path.isfile(args.pgn_file):
                result = {"ok": False, "error": f"PGN file not found: {args.pgn_file}"}
            else:
                with open(args.pgn_file, "r", encoding="utf-8") as fh:
                    result = analyze_game_pgn(fh.read(), skill=args.skill)
        elif args.pgn:
            result = analyze_game_pgn(args.pgn, skill=args.skill)
        else:
            result = {
                "ok": False,
                "error": "No input — pass one of --pgn, --pgn-file, --fen, --image",
                "usage": "python game_analysis.py --pgn \"1. e4 e5 2. Nf3\"",
            }
    except Exception as exc:  # pragma: no cover — last-resort safety
        result = {"ok": False, "error": f"Unexpected: {type(exc).__name__}: {exc}"}

    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    _cli()
