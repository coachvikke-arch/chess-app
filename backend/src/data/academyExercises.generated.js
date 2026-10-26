/**
 * GENERATED exercise packs for the Academy beginner level.
 *
 * Do not hand-edit — regenerate with:
 *   node scripts/generate_academy_exercises.js
 *
 * Every `move` exercise here was machine-verified with chess.js: the FEN parses
 * and `expectedSan` is a legal move in that exact position.
 * `lessonExercises()` in academyCurriculum.js merges these AFTER the
 * hand-authored exercises, so a lesson's curated drills always come first.
 *
 * The move drills are generated rather than hand-written because the point of a
 * piece-movement lesson is repetition across the whole board: every square a
 * piece can reach teaches the same rule, and covering only three of them (as the
 * original hand-authored set did) leaves large gaps.
 */

const PACKS = {
  "board": [
    {
      "type": "move",
      "fen": "4k3/8/8/8/R7/8/8/K7 w - - 0 1",
      "expectedSan": "Ra5",
      "instruction": "Move the rook from a4 to a5 — the same file, one rank up.",
      "hints": [
        "The letter stays the same, so you moved along a rank.",
        "From a4, a5 is a legal move.",
        "Drag the piece from a4 to a5."
      ],
      "slug": "board-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/1R6/8/8/K7 w - - 0 1",
      "expectedSan": "Rb5",
      "instruction": "Move the rook from b4 to b5 — the same file, one rank up.",
      "hints": [
        "The letter stays the same, so you moved along a rank.",
        "From b4, b5 is a legal move.",
        "Drag the piece from b4 to b5."
      ],
      "slug": "board-auto-2"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/2R5/8/8/K7 w - - 0 1",
      "expectedSan": "Rc5",
      "instruction": "Move the rook from c4 to c5 — the same file, one rank up.",
      "hints": [
        "The letter stays the same, so you moved along a rank.",
        "From c4, c5 is a legal move.",
        "Drag the piece from c4 to c5."
      ],
      "slug": "board-auto-3"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rd5",
      "instruction": "Move the rook from d4 to d5 — the same file, one rank up.",
      "hints": [
        "The letter stays the same, so you moved along a rank.",
        "From d4, d5 is a legal move.",
        "Drag the piece from d4 to d5."
      ],
      "slug": "board-auto-4"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4R3/8/8/K7 w - - 0 1",
      "expectedSan": "Re5+",
      "instruction": "Move the rook from e4 to e5 — the same file, one rank up.",
      "hints": [
        "The letter stays the same, so you moved along a rank.",
        "From e4, e5 is a legal move.",
        "Drag the piece from e4 to e5."
      ],
      "slug": "board-auto-5"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/5R2/8/8/K7 w - - 0 1",
      "expectedSan": "Rf5",
      "instruction": "Move the rook from f4 to f5 — the same file, one rank up.",
      "hints": [
        "The letter stays the same, so you moved along a rank.",
        "From f4, f5 is a legal move.",
        "Drag the piece from f4 to f5."
      ],
      "slug": "board-auto-6"
    },
    {
      "slug": "board-q1",
      "type": "quiz",
      "question": "How many squares are there on a chessboard?",
      "options": [
        "32",
        "48",
        "64",
        "100"
      ],
      "correct": 2,
      "explanation": "8 files × 8 ranks = 64 squares."
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/6R1/8/8/K7 w - - 0 1",
      "expectedSan": "Rg5",
      "instruction": "Move the rook from g4 to g5 — the same file, one rank up.",
      "hints": [
        "The letter stays the same, so you moved along a rank.",
        "From g4, g5 is a legal move.",
        "Drag the piece from g4 to g5."
      ],
      "slug": "board-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/7R/8/8/K7 w - - 0 1",
      "expectedSan": "Rh5",
      "instruction": "Move the rook from h4 to h5 — the same file, one rank up.",
      "hints": [
        "The letter stays the same, so you moved along a rank.",
        "From h4, h5 is a legal move.",
        "Drag the piece from h4 to h5."
      ],
      "slug": "board-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/3R4/8/K7 w - - 0 1",
      "expectedSan": "Re3+",
      "instruction": "Move the rook from d3 to e3 — the same rank, one file right.",
      "hints": [
        "The number stays the same, so you moved along a file.",
        "From d3, e3 is a legal move.",
        "Drag the piece from d3 to e3."
      ],
      "slug": "board-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Re4+",
      "instruction": "Move the rook from d4 to e4 — the same rank, one file right.",
      "hints": [
        "The number stays the same, so you moved along a file.",
        "From d4, e4 is a legal move.",
        "Drag the piece from d4 to e4."
      ],
      "slug": "board-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/3R4/8/8/8/K7 w - - 0 1",
      "expectedSan": "Re5+",
      "instruction": "Move the rook from d5 to e5 — the same rank, one file right.",
      "hints": [
        "The number stays the same, so you moved along a file.",
        "From d5, e5 is a legal move.",
        "Drag the piece from d5 to e5."
      ],
      "slug": "board-auto-12"
    },
    {
      "type": "move",
      "fen": "4k3/8/3R4/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Re6+",
      "instruction": "Move the rook from d6 to e6 — the same rank, one file right.",
      "hints": [
        "The number stays the same, so you moved along a file.",
        "From d6, e6 is a legal move.",
        "Drag the piece from d6 to e6."
      ],
      "slug": "board-auto-13"
    },
    {
      "slug": "board-q2",
      "type": "quiz",
      "question": "Which letter is the last file on the board?",
      "options": [
        "a",
        "h",
        "g",
        "z"
      ],
      "correct": 1,
      "explanation": "Files run a–h."
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Be5",
      "instruction": "Move the bishop from d4 to e5 — a diagonal step.",
      "hints": [
        "Diagonals always change the file and the rank by the same amount.",
        "From d4, e5 is a legal move.",
        "Drag the piece from d4 to e5."
      ],
      "slug": "board-auto-15"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4B3/8/8/K7 w - - 0 1",
      "expectedSan": "Bd5",
      "instruction": "Move the bishop from e4 to d5 — a diagonal step.",
      "hints": [
        "Diagonals always change the file and the rank by the same amount.",
        "From e4, d5 is a legal move.",
        "Drag the piece from e4 to d5."
      ],
      "slug": "board-auto-16"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/BK6 w - - 0 1",
      "expectedSan": "Bb2",
      "instruction": "Move the bishop from a1 to b2 — a diagonal step.",
      "hints": [
        "Diagonals always change the file and the rank by the same amount.",
        "From a1, b2 is a legal move.",
        "Drag the piece from a1 to b2."
      ],
      "slug": "board-auto-17"
    },
    {
      "type": "move",
      "fen": "4k2B/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bg7",
      "instruction": "Move the bishop from h8 to g7 — a diagonal step.",
      "hints": [
        "Diagonals always change the file and the rank by the same amount.",
        "From h8, g7 is a legal move.",
        "Drag the piece from h8 to g7."
      ],
      "slug": "board-auto-18"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/1B6/K7 w - - 0 1",
      "expectedSan": "Bc3",
      "instruction": "Move the bishop from b2 to c3 — a diagonal step.",
      "hints": [
        "Diagonals always change the file and the rank by the same amount.",
        "From b2, c3 is a legal move.",
        "Drag the piece from b2 to c3."
      ],
      "slug": "board-auto-19"
    },
    {
      "type": "move",
      "fen": "4k3/6B1/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bf6",
      "instruction": "Move the bishop from g7 to f6 — a diagonal step.",
      "hints": [
        "Diagonals always change the file and the rank by the same amount.",
        "From g7, f6 is a legal move.",
        "Drag the piece from g7 to f6."
      ],
      "slug": "board-auto-20"
    },
    {
      "slug": "board-q3",
      "type": "quiz",
      "question": "Which number is the last rank?",
      "options": [
        "1",
        "8",
        "9",
        "0"
      ],
      "correct": 1,
      "explanation": "Ranks are numbered 1–8."
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4N3/8/8/K7 w - - 0 1",
      "expectedSan": "Nc3",
      "instruction": "Move the knight from e4 to c3 — two across, one up.",
      "hints": [
        "A knight jumps: two squares one way, one square across.",
        "From e4, c3 is a legal move.",
        "Drag the piece from e4 to c3."
      ],
      "slug": "board-auto-22"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3N4/8/8/K7 w - - 0 1",
      "expectedSan": "Nf3",
      "instruction": "Move the knight from d4 to f3 — two across, one up.",
      "hints": [
        "A knight jumps: two squares one way, one square across.",
        "From d4, f3 is a legal move.",
        "Drag the piece from d4 to f3."
      ],
      "slug": "board-auto-23"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2N5/8/K7 w - - 0 1",
      "expectedSan": "Na2",
      "instruction": "Move the knight from c3 to a2 — two across, one up.",
      "hints": [
        "A knight jumps: two squares one way, one square across.",
        "From c3, a2 is a legal move.",
        "Drag the piece from c3 to a2."
      ],
      "slug": "board-auto-24"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/K5N1 w - - 0 1",
      "expectedSan": "Nf3",
      "instruction": "Move the knight from g1 to f3 — two across, one up.",
      "hints": [
        "A knight jumps: two squares one way, one square across.",
        "From g1, f3 is a legal move.",
        "Drag the piece from g1 to f3."
      ],
      "slug": "board-auto-25"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/KN6 w - - 0 1",
      "expectedSan": "Nc3",
      "instruction": "Move the knight from b1 to c3 — two across, one up.",
      "hints": [
        "A knight jumps: two squares one way, one square across.",
        "From b1, c3 is a legal move.",
        "Drag the piece from b1 to c3."
      ],
      "slug": "board-auto-26"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/K1N5 w - - 0 1",
      "expectedSan": "Na2",
      "instruction": "Move the knight from c1 to a2 — two across, one up.",
      "hints": [
        "A knight jumps: two squares one way, one square across.",
        "From c1, a2 is a legal move.",
        "Drag the piece from c1 to a2."
      ],
      "slug": "board-auto-27"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/R7/8/8/K7 w - - 0 1",
      "expectedSan": "Ra7",
      "instruction": "Slide the rook all the way from a4 to a7.",
      "hints": [
        "A rook slides any distance along a rank or file, as long as the path is clear.",
        "From a4, a7 is a legal move.",
        "Drag the piece from a4 to a7."
      ],
      "slug": "board-auto-28"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/7R/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rh2",
      "instruction": "Slide the rook all the way from h5 to h2.",
      "hints": [
        "A rook slides any distance along a rank or file, as long as the path is clear.",
        "From h5, h2 is a legal move.",
        "Drag the piece from h5 to h2."
      ],
      "slug": "board-auto-29"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2R5/8/K7 w - - 0 1",
      "expectedSan": "Rc8+",
      "instruction": "Slide the rook all the way from c3 to c8.",
      "hints": [
        "A rook slides any distance along a rank or file, as long as the path is clear.",
        "From c3, c8 is a legal move.",
        "Drag the piece from c3 to c8."
      ],
      "slug": "board-auto-30"
    }
  ],
  "king": [
    {
      "type": "move",
      "fen": "4k3/8/8/8/2K5/8/8/8 w - - 0 1",
      "expectedSan": "Kb3",
      "instruction": "Move the King from c4 to b3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From c4, b3 is a legal move.",
        "Drag the piece from c4 to b3."
      ],
      "slug": "king-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/2K5/8/8/8 w - - 0 1",
      "expectedSan": "Kb4",
      "instruction": "Move the King from c4 to b4.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From c4, b4 is a legal move.",
        "Drag the piece from c4 to b4."
      ],
      "slug": "king-auto-2"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/2K5/8/8/8 w - - 0 1",
      "expectedSan": "Kb5",
      "instruction": "Move the King from c4 to b5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From c4, b5 is a legal move.",
        "Drag the piece from c4 to b5."
      ],
      "slug": "king-auto-3"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/2K5/8/8/8 w - - 0 1",
      "expectedSan": "Kc3",
      "instruction": "Move the King from c4 to c3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From c4, c3 is a legal move.",
        "Drag the piece from c4 to c3."
      ],
      "slug": "king-auto-4"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/2K5/8/8/8 w - - 0 1",
      "expectedSan": "Kc5",
      "instruction": "Move the King from c4 to c5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From c4, c5 is a legal move.",
        "Drag the piece from c4 to c5."
      ],
      "slug": "king-auto-5"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/2K5/8/8/8 w - - 0 1",
      "expectedSan": "Kd3",
      "instruction": "Move the King from c4 to d3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From c4, d3 is a legal move.",
        "Drag the piece from c4 to d3."
      ],
      "slug": "king-auto-6"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/2K5/8/8/8 w - - 0 1",
      "expectedSan": "Kd4",
      "instruction": "Move the King from c4 to d4.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From c4, d4 is a legal move.",
        "Drag the piece from c4 to d4."
      ],
      "slug": "king-auto-7"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/2K5/8/8/8 w - - 0 1",
      "expectedSan": "Kd5",
      "instruction": "Move the King from c4 to d5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From c4, d5 is a legal move.",
        "Drag the piece from c4 to d5."
      ],
      "slug": "king-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3K4/8/8/8 w - - 0 1",
      "expectedSan": "Kc3",
      "instruction": "Move the King from d4 to c3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From d4, c3 is a legal move.",
        "Drag the piece from d4 to c3."
      ],
      "slug": "king-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3K4/8/8/8 w - - 0 1",
      "expectedSan": "Kc4",
      "instruction": "Move the King from d4 to c4.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From d4, c4 is a legal move.",
        "Drag the piece from d4 to c4."
      ],
      "slug": "king-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3K4/8/8/8 w - - 0 1",
      "expectedSan": "Kc5",
      "instruction": "Move the King from d4 to c5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From d4, c5 is a legal move.",
        "Drag the piece from d4 to c5."
      ],
      "slug": "king-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3K4/8/8/8 w - - 0 1",
      "expectedSan": "Kd3",
      "instruction": "Move the King from d4 to d3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From d4, d3 is a legal move.",
        "Drag the piece from d4 to d3."
      ],
      "slug": "king-auto-12"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3K4/8/8/8 w - - 0 1",
      "expectedSan": "Kd5",
      "instruction": "Move the King from d4 to d5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From d4, d5 is a legal move.",
        "Drag the piece from d4 to d5."
      ],
      "slug": "king-auto-13"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3K4/8/8/8 w - - 0 1",
      "expectedSan": "Ke3",
      "instruction": "Move the King from d4 to e3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From d4, e3 is a legal move.",
        "Drag the piece from d4 to e3."
      ],
      "slug": "king-auto-14"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3K4/8/8/8 w - - 0 1",
      "expectedSan": "Ke4",
      "instruction": "Move the King from d4 to e4.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From d4, e4 is a legal move.",
        "Drag the piece from d4 to e4."
      ],
      "slug": "king-auto-15"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3K4/8/8/8 w - - 0 1",
      "expectedSan": "Ke5",
      "instruction": "Move the King from d4 to e5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From d4, e5 is a legal move.",
        "Drag the piece from d4 to e5."
      ],
      "slug": "king-auto-16"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4K3/8/8/8 w - - 0 1",
      "expectedSan": "Kd3",
      "instruction": "Move the King from e4 to d3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From e4, d3 is a legal move.",
        "Drag the piece from e4 to d3."
      ],
      "slug": "king-auto-17"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4K3/8/8/8 w - - 0 1",
      "expectedSan": "Kd4",
      "instruction": "Move the King from e4 to d4.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From e4, d4 is a legal move.",
        "Drag the piece from e4 to d4."
      ],
      "slug": "king-auto-18"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4K3/8/8/8 w - - 0 1",
      "expectedSan": "Kd5",
      "instruction": "Move the King from e4 to d5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From e4, d5 is a legal move.",
        "Drag the piece from e4 to d5."
      ],
      "slug": "king-auto-19"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4K3/8/8/8 w - - 0 1",
      "expectedSan": "Ke3",
      "instruction": "Move the King from e4 to e3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From e4, e3 is a legal move.",
        "Drag the piece from e4 to e3."
      ],
      "slug": "king-auto-20"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4K3/8/8/8 w - - 0 1",
      "expectedSan": "Ke5",
      "instruction": "Move the King from e4 to e5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From e4, e5 is a legal move.",
        "Drag the piece from e4 to e5."
      ],
      "slug": "king-auto-21"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4K3/8/8/8 w - - 0 1",
      "expectedSan": "Kf3",
      "instruction": "Move the King from e4 to f3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From e4, f3 is a legal move.",
        "Drag the piece from e4 to f3."
      ],
      "slug": "king-auto-22"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4K3/8/8/8 w - - 0 1",
      "expectedSan": "Kf4",
      "instruction": "Move the King from e4 to f4.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From e4, f4 is a legal move.",
        "Drag the piece from e4 to f4."
      ],
      "slug": "king-auto-23"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4K3/8/8/8 w - - 0 1",
      "expectedSan": "Kf5",
      "instruction": "Move the King from e4 to f5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From e4, f5 is a legal move.",
        "Drag the piece from e4 to f5."
      ],
      "slug": "king-auto-24"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/5K2/8/8/8 w - - 0 1",
      "expectedSan": "Ke3",
      "instruction": "Move the King from f4 to e3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From f4, e3 is a legal move.",
        "Drag the piece from f4 to e3."
      ],
      "slug": "king-auto-25"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/5K2/8/8/8 w - - 0 1",
      "expectedSan": "Ke4",
      "instruction": "Move the King from f4 to e4.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From f4, e4 is a legal move.",
        "Drag the piece from f4 to e4."
      ],
      "slug": "king-auto-26"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/5K2/8/8/8 w - - 0 1",
      "expectedSan": "Ke5",
      "instruction": "Move the King from f4 to e5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From f4, e5 is a legal move.",
        "Drag the piece from f4 to e5."
      ],
      "slug": "king-auto-27"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/5K2/8/8/8 w - - 0 1",
      "expectedSan": "Kf3",
      "instruction": "Move the King from f4 to f3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From f4, f3 is a legal move.",
        "Drag the piece from f4 to f3."
      ],
      "slug": "king-auto-28"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/5K2/8/8/8 w - - 0 1",
      "expectedSan": "Kf5",
      "instruction": "Move the King from f4 to f5.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From f4, f5 is a legal move.",
        "Drag the piece from f4 to f5."
      ],
      "slug": "king-auto-29"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/5K2/8/8/8 w - - 0 1",
      "expectedSan": "Kg3",
      "instruction": "Move the King from f4 to g3.",
      "hints": [
        "The King moves exactly one square in any direction.",
        "From f4, g3 is a legal move.",
        "Drag the piece from f4 to g3."
      ],
      "slug": "king-auto-30"
    }
  ],
  "queen": [
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qc3",
      "instruction": "Move the Queen from d4 to c3.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, c3 is a legal move.",
        "Drag the piece from d4 to c3."
      ],
      "slug": "queen-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qb2",
      "instruction": "Move the Queen from d4 to b2.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, b2 is a legal move.",
        "Drag the piece from d4 to b2."
      ],
      "slug": "queen-auto-2"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qc4",
      "instruction": "Move the Queen from d4 to c4.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, c4 is a legal move.",
        "Drag the piece from d4 to c4."
      ],
      "slug": "queen-auto-3"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qb4",
      "instruction": "Move the Queen from d4 to b4.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, b4 is a legal move.",
        "Drag the piece from d4 to b4."
      ],
      "slug": "queen-auto-4"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qa4+",
      "instruction": "Move the Queen from d4 to a4.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, a4 is a legal move.",
        "Drag the piece from d4 to a4."
      ],
      "slug": "queen-auto-5"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qc5",
      "instruction": "Move the Queen from d4 to c5.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, c5 is a legal move.",
        "Drag the piece from d4 to c5."
      ],
      "slug": "queen-auto-6"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qb6",
      "instruction": "Move the Queen from d4 to b6.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, b6 is a legal move.",
        "Drag the piece from d4 to b6."
      ],
      "slug": "queen-auto-7"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qa7",
      "instruction": "Move the Queen from d4 to a7.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, a7 is a legal move.",
        "Drag the piece from d4 to a7."
      ],
      "slug": "queen-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qd3",
      "instruction": "Move the Queen from d4 to d3.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, d3 is a legal move.",
        "Drag the piece from d4 to d3."
      ],
      "slug": "queen-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qd2",
      "instruction": "Move the Queen from d4 to d2.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, d2 is a legal move.",
        "Drag the piece from d4 to d2."
      ],
      "slug": "queen-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qd1",
      "instruction": "Move the Queen from d4 to d1.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, d1 is a legal move.",
        "Drag the piece from d4 to d1."
      ],
      "slug": "queen-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qd5",
      "instruction": "Move the Queen from d4 to d5.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, d5 is a legal move.",
        "Drag the piece from d4 to d5."
      ],
      "slug": "queen-auto-12"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qd6",
      "instruction": "Move the Queen from d4 to d6.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, d6 is a legal move.",
        "Drag the piece from d4 to d6."
      ],
      "slug": "queen-auto-13"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qd7+",
      "instruction": "Move the Queen from d4 to d7.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, d7 is a legal move.",
        "Drag the piece from d4 to d7."
      ],
      "slug": "queen-auto-14"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qd8+",
      "instruction": "Move the Queen from d4 to d8.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, d8 is a legal move.",
        "Drag the piece from d4 to d8."
      ],
      "slug": "queen-auto-15"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qe3+",
      "instruction": "Move the Queen from d4 to e3.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, e3 is a legal move.",
        "Drag the piece from d4 to e3."
      ],
      "slug": "queen-auto-16"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qf2",
      "instruction": "Move the Queen from d4 to f2.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, f2 is a legal move.",
        "Drag the piece from d4 to f2."
      ],
      "slug": "queen-auto-17"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qg1",
      "instruction": "Move the Queen from d4 to g1.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, g1 is a legal move.",
        "Drag the piece from d4 to g1."
      ],
      "slug": "queen-auto-18"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qe4+",
      "instruction": "Move the Queen from d4 to e4.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, e4 is a legal move.",
        "Drag the piece from d4 to e4."
      ],
      "slug": "queen-auto-19"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qf4",
      "instruction": "Move the Queen from d4 to f4.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, f4 is a legal move.",
        "Drag the piece from d4 to f4."
      ],
      "slug": "queen-auto-20"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qg4",
      "instruction": "Move the Queen from d4 to g4.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, g4 is a legal move.",
        "Drag the piece from d4 to g4."
      ],
      "slug": "queen-auto-21"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qh4",
      "instruction": "Move the Queen from d4 to h4.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, h4 is a legal move.",
        "Drag the piece from d4 to h4."
      ],
      "slug": "queen-auto-22"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qe5+",
      "instruction": "Move the Queen from d4 to e5.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, e5 is a legal move.",
        "Drag the piece from d4 to e5."
      ],
      "slug": "queen-auto-23"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qf6",
      "instruction": "Move the Queen from d4 to f6.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, f6 is a legal move.",
        "Drag the piece from d4 to f6."
      ],
      "slug": "queen-auto-24"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qg7",
      "instruction": "Move the Queen from d4 to g7.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, g7 is a legal move.",
        "Drag the piece from d4 to g7."
      ],
      "slug": "queen-auto-25"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3Q4/8/8/K7 w - - 0 1",
      "expectedSan": "Qh8+",
      "instruction": "Move the Queen from d4 to h8.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From d4, h8 is a legal move.",
        "Drag the piece from d4 to h8."
      ],
      "slug": "queen-auto-26"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4Q3/8/8/K7 w - - 0 1",
      "expectedSan": "Qd3",
      "instruction": "Move the Queen from e4 to d3.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From e4, d3 is a legal move.",
        "Drag the piece from e4 to d3."
      ],
      "slug": "queen-auto-27"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4Q3/8/8/K7 w - - 0 1",
      "expectedSan": "Qc2",
      "instruction": "Move the Queen from e4 to c2.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From e4, c2 is a legal move.",
        "Drag the piece from e4 to c2."
      ],
      "slug": "queen-auto-28"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4Q3/8/8/K7 w - - 0 1",
      "expectedSan": "Qb1",
      "instruction": "Move the Queen from e4 to b1.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From e4, b1 is a legal move.",
        "Drag the piece from e4 to b1."
      ],
      "slug": "queen-auto-29"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4Q3/8/8/K7 w - - 0 1",
      "expectedSan": "Qd4",
      "instruction": "Move the Queen from e4 to d4.",
      "hints": [
        "The Queen moves any number of squares: along a file, a rank or a diagonal.",
        "From e4, d4 is a legal move.",
        "Drag the piece from e4 to d4."
      ],
      "slug": "queen-auto-30"
    }
  ],
  "rook": [
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rc4",
      "instruction": "Move the Rook from d4 to c4.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, c4 is a legal move.",
        "Drag the piece from d4 to c4."
      ],
      "slug": "rook-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rb4",
      "instruction": "Move the Rook from d4 to b4.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, b4 is a legal move.",
        "Drag the piece from d4 to b4."
      ],
      "slug": "rook-auto-2"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Ra4",
      "instruction": "Move the Rook from d4 to a4.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, a4 is a legal move.",
        "Drag the piece from d4 to a4."
      ],
      "slug": "rook-auto-3"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rd3",
      "instruction": "Move the Rook from d4 to d3.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, d3 is a legal move.",
        "Drag the piece from d4 to d3."
      ],
      "slug": "rook-auto-4"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rd2",
      "instruction": "Move the Rook from d4 to d2.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, d2 is a legal move.",
        "Drag the piece from d4 to d2."
      ],
      "slug": "rook-auto-5"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rd1",
      "instruction": "Move the Rook from d4 to d1.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, d1 is a legal move.",
        "Drag the piece from d4 to d1."
      ],
      "slug": "rook-auto-6"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rd5",
      "instruction": "Move the Rook from d4 to d5.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, d5 is a legal move.",
        "Drag the piece from d4 to d5."
      ],
      "slug": "rook-auto-7"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rd6",
      "instruction": "Move the Rook from d4 to d6.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, d6 is a legal move.",
        "Drag the piece from d4 to d6."
      ],
      "slug": "rook-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rd7",
      "instruction": "Move the Rook from d4 to d7.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, d7 is a legal move.",
        "Drag the piece from d4 to d7."
      ],
      "slug": "rook-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rd8+",
      "instruction": "Move the Rook from d4 to d8.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, d8 is a legal move.",
        "Drag the piece from d4 to d8."
      ],
      "slug": "rook-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Re4+",
      "instruction": "Move the Rook from d4 to e4.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, e4 is a legal move.",
        "Drag the piece from d4 to e4."
      ],
      "slug": "rook-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rf4",
      "instruction": "Move the Rook from d4 to f4.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, f4 is a legal move.",
        "Drag the piece from d4 to f4."
      ],
      "slug": "rook-auto-12"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rg4",
      "instruction": "Move the Rook from d4 to g4.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, g4 is a legal move.",
        "Drag the piece from d4 to g4."
      ],
      "slug": "rook-auto-13"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3R4/8/8/K7 w - - 0 1",
      "expectedSan": "Rh4",
      "instruction": "Move the Rook from d4 to h4.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From d4, h4 is a legal move.",
        "Drag the piece from d4 to h4."
      ],
      "slug": "rook-auto-14"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/RK6 w - - 0 1",
      "expectedSan": "Ra2",
      "instruction": "Move the Rook from a1 to a2.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From a1, a2 is a legal move.",
        "Drag the piece from a1 to a2."
      ],
      "slug": "rook-auto-15"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/RK6 w - - 0 1",
      "expectedSan": "Ra3",
      "instruction": "Move the Rook from a1 to a3.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From a1, a3 is a legal move.",
        "Drag the piece from a1 to a3."
      ],
      "slug": "rook-auto-16"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/RK6 w - - 0 1",
      "expectedSan": "Ra4",
      "instruction": "Move the Rook from a1 to a4.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From a1, a4 is a legal move.",
        "Drag the piece from a1 to a4."
      ],
      "slug": "rook-auto-17"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/RK6 w - - 0 1",
      "expectedSan": "Ra5",
      "instruction": "Move the Rook from a1 to a5.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From a1, a5 is a legal move.",
        "Drag the piece from a1 to a5."
      ],
      "slug": "rook-auto-18"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/RK6 w - - 0 1",
      "expectedSan": "Ra6",
      "instruction": "Move the Rook from a1 to a6.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From a1, a6 is a legal move.",
        "Drag the piece from a1 to a6."
      ],
      "slug": "rook-auto-19"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/RK6 w - - 0 1",
      "expectedSan": "Ra7",
      "instruction": "Move the Rook from a1 to a7.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From a1, a7 is a legal move.",
        "Drag the piece from a1 to a7."
      ],
      "slug": "rook-auto-20"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/RK6 w - - 0 1",
      "expectedSan": "Ra8+",
      "instruction": "Move the Rook from a1 to a8.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From a1, a8 is a legal move.",
        "Drag the piece from a1 to a8."
      ],
      "slug": "rook-auto-21"
    },
    {
      "type": "move",
      "fen": "4k2R/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rg8+",
      "instruction": "Move the Rook from h8 to g8.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From h8, g8 is a legal move.",
        "Drag the piece from h8 to g8."
      ],
      "slug": "rook-auto-22"
    },
    {
      "type": "move",
      "fen": "4k2R/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rf8+",
      "instruction": "Move the Rook from h8 to f8.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From h8, f8 is a legal move.",
        "Drag the piece from h8 to f8."
      ],
      "slug": "rook-auto-23"
    },
    {
      "type": "move",
      "fen": "4k2R/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rxe8",
      "instruction": "Move the Rook from h8 to e8.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From h8, e8 is a legal move.",
        "Drag the piece from h8 to e8."
      ],
      "slug": "rook-auto-24"
    },
    {
      "type": "move",
      "fen": "4k2R/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rh7",
      "instruction": "Move the Rook from h8 to h7.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From h8, h7 is a legal move.",
        "Drag the piece from h8 to h7."
      ],
      "slug": "rook-auto-25"
    },
    {
      "type": "move",
      "fen": "4k2R/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rh6",
      "instruction": "Move the Rook from h8 to h6.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From h8, h6 is a legal move.",
        "Drag the piece from h8 to h6."
      ],
      "slug": "rook-auto-26"
    },
    {
      "type": "move",
      "fen": "4k2R/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rh5",
      "instruction": "Move the Rook from h8 to h5.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From h8, h5 is a legal move.",
        "Drag the piece from h8 to h5."
      ],
      "slug": "rook-auto-27"
    },
    {
      "type": "move",
      "fen": "4k2R/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rh4",
      "instruction": "Move the Rook from h8 to h4.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From h8, h4 is a legal move.",
        "Drag the piece from h8 to h4."
      ],
      "slug": "rook-auto-28"
    },
    {
      "type": "move",
      "fen": "4k2R/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rh3",
      "instruction": "Move the Rook from h8 to h3.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From h8, h3 is a legal move.",
        "Drag the piece from h8 to h3."
      ],
      "slug": "rook-auto-29"
    },
    {
      "type": "move",
      "fen": "4k2R/8/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "Rh2",
      "instruction": "Move the Rook from h8 to h2.",
      "hints": [
        "The Rook moves straight: along a file or a rank, never diagonally.",
        "From h8, h2 is a legal move.",
        "Drag the piece from h8 to h2."
      ],
      "slug": "rook-auto-30"
    }
  ],
  "bishop": [
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Bc3",
      "instruction": "Move the Bishop from d4 to c3.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, c3 is a legal move.",
        "Drag the piece from d4 to c3."
      ],
      "slug": "bishop-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Bb2",
      "instruction": "Move the Bishop from d4 to b2.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, b2 is a legal move.",
        "Drag the piece from d4 to b2."
      ],
      "slug": "bishop-auto-2"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Bc5",
      "instruction": "Move the Bishop from d4 to c5.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, c5 is a legal move.",
        "Drag the piece from d4 to c5."
      ],
      "slug": "bishop-auto-3"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Bb6",
      "instruction": "Move the Bishop from d4 to b6.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, b6 is a legal move.",
        "Drag the piece from d4 to b6."
      ],
      "slug": "bishop-auto-4"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Ba7",
      "instruction": "Move the Bishop from d4 to a7.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, a7 is a legal move.",
        "Drag the piece from d4 to a7."
      ],
      "slug": "bishop-auto-5"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Be3",
      "instruction": "Move the Bishop from d4 to e3.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, e3 is a legal move.",
        "Drag the piece from d4 to e3."
      ],
      "slug": "bishop-auto-6"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Bf2",
      "instruction": "Move the Bishop from d4 to f2.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, f2 is a legal move.",
        "Drag the piece from d4 to f2."
      ],
      "slug": "bishop-auto-7"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Bg1",
      "instruction": "Move the Bishop from d4 to g1.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, g1 is a legal move.",
        "Drag the piece from d4 to g1."
      ],
      "slug": "bishop-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Be5",
      "instruction": "Move the Bishop from d4 to e5.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, e5 is a legal move.",
        "Drag the piece from d4 to e5."
      ],
      "slug": "bishop-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Bf6",
      "instruction": "Move the Bishop from d4 to f6.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, f6 is a legal move.",
        "Drag the piece from d4 to f6."
      ],
      "slug": "bishop-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Bg7",
      "instruction": "Move the Bishop from d4 to g7.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, g7 is a legal move.",
        "Drag the piece from d4 to g7."
      ],
      "slug": "bishop-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3B4/8/8/K7 w - - 0 1",
      "expectedSan": "Bh8",
      "instruction": "Move the Bishop from d4 to h8.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From d4, h8 is a legal move.",
        "Drag the piece from d4 to h8."
      ],
      "slug": "bishop-auto-12"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Bb2",
      "instruction": "Move the Bishop from c3 to b2.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, b2 is a legal move.",
        "Drag the piece from c3 to b2."
      ],
      "slug": "bishop-auto-13"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Bb4",
      "instruction": "Move the Bishop from c3 to b4.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, b4 is a legal move.",
        "Drag the piece from c3 to b4."
      ],
      "slug": "bishop-auto-14"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Ba5",
      "instruction": "Move the Bishop from c3 to a5.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, a5 is a legal move.",
        "Drag the piece from c3 to a5."
      ],
      "slug": "bishop-auto-15"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Bd2",
      "instruction": "Move the Bishop from c3 to d2.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, d2 is a legal move.",
        "Drag the piece from c3 to d2."
      ],
      "slug": "bishop-auto-16"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Be1",
      "instruction": "Move the Bishop from c3 to e1.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, e1 is a legal move.",
        "Drag the piece from c3 to e1."
      ],
      "slug": "bishop-auto-17"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Bd4",
      "instruction": "Move the Bishop from c3 to d4.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, d4 is a legal move.",
        "Drag the piece from c3 to d4."
      ],
      "slug": "bishop-auto-18"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Be5",
      "instruction": "Move the Bishop from c3 to e5.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, e5 is a legal move.",
        "Drag the piece from c3 to e5."
      ],
      "slug": "bishop-auto-19"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Bf6",
      "instruction": "Move the Bishop from c3 to f6.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, f6 is a legal move.",
        "Drag the piece from c3 to f6."
      ],
      "slug": "bishop-auto-20"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Bg7",
      "instruction": "Move the Bishop from c3 to g7.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, g7 is a legal move.",
        "Drag the piece from c3 to g7."
      ],
      "slug": "bishop-auto-21"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2B5/8/K7 w - - 0 1",
      "expectedSan": "Bh8",
      "instruction": "Move the Bishop from c3 to h8.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From c3, h8 is a legal move.",
        "Drag the piece from c3 to h8."
      ],
      "slug": "bishop-auto-22"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4B3/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bd4",
      "instruction": "Move the Bishop from e5 to d4.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From e5, d4 is a legal move.",
        "Drag the piece from e5 to d4."
      ],
      "slug": "bishop-auto-23"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4B3/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bc3",
      "instruction": "Move the Bishop from e5 to c3.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From e5, c3 is a legal move.",
        "Drag the piece from e5 to c3."
      ],
      "slug": "bishop-auto-24"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4B3/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bb2",
      "instruction": "Move the Bishop from e5 to b2.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From e5, b2 is a legal move.",
        "Drag the piece from e5 to b2."
      ],
      "slug": "bishop-auto-25"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4B3/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bd6",
      "instruction": "Move the Bishop from e5 to d6.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From e5, d6 is a legal move.",
        "Drag the piece from e5 to d6."
      ],
      "slug": "bishop-auto-26"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4B3/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bc7",
      "instruction": "Move the Bishop from e5 to c7.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From e5, c7 is a legal move.",
        "Drag the piece from e5 to c7."
      ],
      "slug": "bishop-auto-27"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4B3/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bb8",
      "instruction": "Move the Bishop from e5 to b8.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From e5, b8 is a legal move.",
        "Drag the piece from e5 to b8."
      ],
      "slug": "bishop-auto-28"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4B3/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bf4",
      "instruction": "Move the Bishop from e5 to f4.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From e5, f4 is a legal move.",
        "Drag the piece from e5 to f4."
      ],
      "slug": "bishop-auto-29"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4B3/8/8/8/K7 w - - 0 1",
      "expectedSan": "Bg3",
      "instruction": "Move the Bishop from e5 to g3.",
      "hints": [
        "The Bishop moves diagonally only — it can never travel in a straight line.",
        "From e5, g3 is a legal move.",
        "Drag the piece from e5 to g3."
      ],
      "slug": "bishop-auto-30"
    }
  ],
  "knight": [
    {
      "type": "move",
      "fen": "4k3/8/8/8/3N4/8/8/K7 w - - 0 1",
      "expectedSan": "Ne6",
      "instruction": "Jump the Knight from d4 to e6.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From d4, e6 is a legal move.",
        "Drag the piece from d4 to e6."
      ],
      "slug": "knight-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3N4/8/8/K7 w - - 0 1",
      "expectedSan": "Nf5",
      "instruction": "Jump the Knight from d4 to f5.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From d4, f5 is a legal move.",
        "Drag the piece from d4 to f5."
      ],
      "slug": "knight-auto-2"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3N4/8/8/K7 w - - 0 1",
      "expectedSan": "Nf3",
      "instruction": "Jump the Knight from d4 to f3.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From d4, f3 is a legal move.",
        "Drag the piece from d4 to f3."
      ],
      "slug": "knight-auto-3"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3N4/8/8/K7 w - - 0 1",
      "expectedSan": "Ne2",
      "instruction": "Jump the Knight from d4 to e2.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From d4, e2 is a legal move.",
        "Drag the piece from d4 to e2."
      ],
      "slug": "knight-auto-4"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3N4/8/8/K7 w - - 0 1",
      "expectedSan": "Nc2",
      "instruction": "Jump the Knight from d4 to c2.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From d4, c2 is a legal move.",
        "Drag the piece from d4 to c2."
      ],
      "slug": "knight-auto-5"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3N4/8/8/K7 w - - 0 1",
      "expectedSan": "Nb3",
      "instruction": "Jump the Knight from d4 to b3.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From d4, b3 is a legal move.",
        "Drag the piece from d4 to b3."
      ],
      "slug": "knight-auto-6"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3N4/8/8/K7 w - - 0 1",
      "expectedSan": "Nb5",
      "instruction": "Jump the Knight from d4 to b5.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From d4, b5 is a legal move.",
        "Drag the piece from d4 to b5."
      ],
      "slug": "knight-auto-7"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3N4/8/8/K7 w - - 0 1",
      "expectedSan": "Nc6",
      "instruction": "Jump the Knight from d4 to c6.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From d4, c6 is a legal move.",
        "Drag the piece from d4 to c6."
      ],
      "slug": "knight-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4N3/8/8/K7 w - - 0 1",
      "expectedSan": "Nf6+",
      "instruction": "Jump the Knight from e4 to f6.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From e4, f6 is a legal move.",
        "Drag the piece from e4 to f6."
      ],
      "slug": "knight-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4N3/8/8/K7 w - - 0 1",
      "expectedSan": "Ng5",
      "instruction": "Jump the Knight from e4 to g5.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From e4, g5 is a legal move.",
        "Drag the piece from e4 to g5."
      ],
      "slug": "knight-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4N3/8/8/K7 w - - 0 1",
      "expectedSan": "Ng3",
      "instruction": "Jump the Knight from e4 to g3.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From e4, g3 is a legal move.",
        "Drag the piece from e4 to g3."
      ],
      "slug": "knight-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4N3/8/8/K7 w - - 0 1",
      "expectedSan": "Nf2",
      "instruction": "Jump the Knight from e4 to f2.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From e4, f2 is a legal move.",
        "Drag the piece from e4 to f2."
      ],
      "slug": "knight-auto-12"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4N3/8/8/K7 w - - 0 1",
      "expectedSan": "Nd2",
      "instruction": "Jump the Knight from e4 to d2.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From e4, d2 is a legal move.",
        "Drag the piece from e4 to d2."
      ],
      "slug": "knight-auto-13"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4N3/8/8/K7 w - - 0 1",
      "expectedSan": "Nc3",
      "instruction": "Jump the Knight from e4 to c3.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From e4, c3 is a legal move.",
        "Drag the piece from e4 to c3."
      ],
      "slug": "knight-auto-14"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4N3/8/8/K7 w - - 0 1",
      "expectedSan": "Nc5",
      "instruction": "Jump the Knight from e4 to c5.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From e4, c5 is a legal move.",
        "Drag the piece from e4 to c5."
      ],
      "slug": "knight-auto-15"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4N3/8/8/K7 w - - 0 1",
      "expectedSan": "Nd6+",
      "instruction": "Jump the Knight from e4 to d6.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From e4, d6 is a legal move.",
        "Drag the piece from e4 to d6."
      ],
      "slug": "knight-auto-16"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2N5/8/K7 w - - 0 1",
      "expectedSan": "Nd5",
      "instruction": "Jump the Knight from c3 to d5.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From c3, d5 is a legal move.",
        "Drag the piece from c3 to d5."
      ],
      "slug": "knight-auto-17"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2N5/8/K7 w - - 0 1",
      "expectedSan": "Ne4",
      "instruction": "Jump the Knight from c3 to e4.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From c3, e4 is a legal move.",
        "Drag the piece from c3 to e4."
      ],
      "slug": "knight-auto-18"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2N5/8/K7 w - - 0 1",
      "expectedSan": "Ne2",
      "instruction": "Jump the Knight from c3 to e2.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From c3, e2 is a legal move.",
        "Drag the piece from c3 to e2."
      ],
      "slug": "knight-auto-19"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2N5/8/K7 w - - 0 1",
      "expectedSan": "Nd1",
      "instruction": "Jump the Knight from c3 to d1.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From c3, d1 is a legal move.",
        "Drag the piece from c3 to d1."
      ],
      "slug": "knight-auto-20"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2N5/8/K7 w - - 0 1",
      "expectedSan": "Nb1",
      "instruction": "Jump the Knight from c3 to b1.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From c3, b1 is a legal move.",
        "Drag the piece from c3 to b1."
      ],
      "slug": "knight-auto-21"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2N5/8/K7 w - - 0 1",
      "expectedSan": "Na2",
      "instruction": "Jump the Knight from c3 to a2.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From c3, a2 is a legal move.",
        "Drag the piece from c3 to a2."
      ],
      "slug": "knight-auto-22"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2N5/8/K7 w - - 0 1",
      "expectedSan": "Na4",
      "instruction": "Jump the Knight from c3 to a4.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From c3, a4 is a legal move.",
        "Drag the piece from c3 to a4."
      ],
      "slug": "knight-auto-23"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/2N5/8/K7 w - - 0 1",
      "expectedSan": "Nb5",
      "instruction": "Jump the Knight from c3 to b5.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From c3, b5 is a legal move.",
        "Drag the piece from c3 to b5."
      ],
      "slug": "knight-auto-24"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/K5N1 w - - 0 1",
      "expectedSan": "Nh3",
      "instruction": "Jump the Knight from g1 to h3.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From g1, h3 is a legal move.",
        "Drag the piece from g1 to h3."
      ],
      "slug": "knight-auto-25"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/K5N1 w - - 0 1",
      "expectedSan": "Ne2",
      "instruction": "Jump the Knight from g1 to e2.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From g1, e2 is a legal move.",
        "Drag the piece from g1 to e2."
      ],
      "slug": "knight-auto-26"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/K5N1 w - - 0 1",
      "expectedSan": "Nf3",
      "instruction": "Jump the Knight from g1 to f3.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From g1, f3 is a legal move.",
        "Drag the piece from g1 to f3."
      ],
      "slug": "knight-auto-27"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/KN6 w - - 0 1",
      "expectedSan": "Nc3",
      "instruction": "Jump the Knight from b1 to c3.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From b1, c3 is a legal move.",
        "Drag the piece from b1 to c3."
      ],
      "slug": "knight-auto-28"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/KN6 w - - 0 1",
      "expectedSan": "Nd2",
      "instruction": "Jump the Knight from b1 to d2.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From b1, d2 is a legal move.",
        "Drag the piece from b1 to d2."
      ],
      "slug": "knight-auto-29"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/KN6 w - - 0 1",
      "expectedSan": "Na3",
      "instruction": "Jump the Knight from b1 to a3.",
      "hints": [
        "The Knight moves in an L: two squares one way, then one square across.",
        "From b1, a3 is a legal move.",
        "Drag the piece from b1 to a3."
      ],
      "slug": "knight-auto-30"
    }
  ],
  "pawn": [
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/P7/K7 w - - 0 1",
      "expectedSan": "a3",
      "instruction": "Push the pawn one square from a2 to a3.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From a2 forward is a3.",
        "Drag the pawn from a2 to a3."
      ],
      "slug": "pawn-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/P7/K7 w - - 0 1",
      "expectedSan": "a4",
      "instruction": "Push the pawn two squares from a2 to a4.",
      "hints": [
        "A pawn on its starting rank may move one OR two squares.",
        "From a2 forward is a4.",
        "Drag the pawn from a2 to a4."
      ],
      "slug": "pawn-auto-2"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/P7/8/8/K7 w - - 0 1",
      "expectedSan": "a5",
      "instruction": "Push the pawn one square from a4 to a5.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From a4 forward is a5.",
        "Drag the pawn from a4 to a5."
      ],
      "slug": "pawn-auto-3"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/P7/8/8/8/K7 w - - 0 1",
      "expectedSan": "a6",
      "instruction": "Push the pawn one square from a5 to a6.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From a5 forward is a6.",
        "Drag the pawn from a5 to a6."
      ],
      "slug": "pawn-auto-4"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/1P6/K7 w - - 0 1",
      "expectedSan": "b3",
      "instruction": "Push the pawn one square from b2 to b3.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From b2 forward is b3.",
        "Drag the pawn from b2 to b3."
      ],
      "slug": "pawn-auto-5"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/1P6/K7 w - - 0 1",
      "expectedSan": "b4",
      "instruction": "Push the pawn two squares from b2 to b4.",
      "hints": [
        "A pawn on its starting rank may move one OR two squares.",
        "From b2 forward is b4.",
        "Drag the pawn from b2 to b4."
      ],
      "slug": "pawn-auto-6"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/1P6/8/8/K7 w - - 0 1",
      "expectedSan": "b5",
      "instruction": "Push the pawn one square from b4 to b5.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From b4 forward is b5.",
        "Drag the pawn from b4 to b5."
      ],
      "slug": "pawn-auto-7"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/1P6/8/8/8/K7 w - - 0 1",
      "expectedSan": "b6",
      "instruction": "Push the pawn one square from b5 to b6.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From b5 forward is b6.",
        "Drag the pawn from b5 to b6."
      ],
      "slug": "pawn-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/2P5/K7 w - - 0 1",
      "expectedSan": "c3",
      "instruction": "Push the pawn one square from c2 to c3.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From c2 forward is c3.",
        "Drag the pawn from c2 to c3."
      ],
      "slug": "pawn-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/2P5/K7 w - - 0 1",
      "expectedSan": "c4",
      "instruction": "Push the pawn two squares from c2 to c4.",
      "hints": [
        "A pawn on its starting rank may move one OR two squares.",
        "From c2 forward is c4.",
        "Drag the pawn from c2 to c4."
      ],
      "slug": "pawn-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/2P5/8/8/K7 w - - 0 1",
      "expectedSan": "c5",
      "instruction": "Push the pawn one square from c4 to c5.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From c4 forward is c5.",
        "Drag the pawn from c4 to c5."
      ],
      "slug": "pawn-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/2P5/8/8/8/K7 w - - 0 1",
      "expectedSan": "c6",
      "instruction": "Push the pawn one square from c5 to c6.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From c5 forward is c6.",
        "Drag the pawn from c5 to c6."
      ],
      "slug": "pawn-auto-12"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/3P4/K7 w - - 0 1",
      "expectedSan": "d3",
      "instruction": "Push the pawn one square from d2 to d3.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From d2 forward is d3.",
        "Drag the pawn from d2 to d3."
      ],
      "slug": "pawn-auto-13"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/3P4/K7 w - - 0 1",
      "expectedSan": "d4",
      "instruction": "Push the pawn two squares from d2 to d4.",
      "hints": [
        "A pawn on its starting rank may move one OR two squares.",
        "From d2 forward is d4.",
        "Drag the pawn from d2 to d4."
      ],
      "slug": "pawn-auto-14"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3P4/8/8/K7 w - - 0 1",
      "expectedSan": "d5",
      "instruction": "Push the pawn one square from d4 to d5.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From d4 forward is d5.",
        "Drag the pawn from d4 to d5."
      ],
      "slug": "pawn-auto-15"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/3P4/8/8/8/K7 w - - 0 1",
      "expectedSan": "d6",
      "instruction": "Push the pawn one square from d5 to d6.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From d5 forward is d6.",
        "Drag the pawn from d5 to d6."
      ],
      "slug": "pawn-auto-16"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/4P3/K7 w - - 0 1",
      "expectedSan": "e3",
      "instruction": "Push the pawn one square from e2 to e3.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From e2 forward is e3.",
        "Drag the pawn from e2 to e3."
      ],
      "slug": "pawn-auto-17"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/4P3/K7 w - - 0 1",
      "expectedSan": "e4",
      "instruction": "Push the pawn two squares from e2 to e4.",
      "hints": [
        "A pawn on its starting rank may move one OR two squares.",
        "From e2 forward is e4.",
        "Drag the pawn from e2 to e4."
      ],
      "slug": "pawn-auto-18"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4P3/8/8/K7 w - - 0 1",
      "expectedSan": "e5",
      "instruction": "Push the pawn one square from e4 to e5.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From e4 forward is e5.",
        "Drag the pawn from e4 to e5."
      ],
      "slug": "pawn-auto-19"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4P3/8/8/8/K7 w - - 0 1",
      "expectedSan": "e6",
      "instruction": "Push the pawn one square from e5 to e6.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From e5 forward is e6.",
        "Drag the pawn from e5 to e6."
      ],
      "slug": "pawn-auto-20"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/5P2/K7 w - - 0 1",
      "expectedSan": "f3",
      "instruction": "Push the pawn one square from f2 to f3.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From f2 forward is f3.",
        "Drag the pawn from f2 to f3."
      ],
      "slug": "pawn-auto-21"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/5P2/K7 w - - 0 1",
      "expectedSan": "f4",
      "instruction": "Push the pawn two squares from f2 to f4.",
      "hints": [
        "A pawn on its starting rank may move one OR two squares.",
        "From f2 forward is f4.",
        "Drag the pawn from f2 to f4."
      ],
      "slug": "pawn-auto-22"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/5P2/8/8/K7 w - - 0 1",
      "expectedSan": "f5",
      "instruction": "Push the pawn one square from f4 to f5.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From f4 forward is f5.",
        "Drag the pawn from f4 to f5."
      ],
      "slug": "pawn-auto-23"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/5P2/8/8/8/K7 w - - 0 1",
      "expectedSan": "f6",
      "instruction": "Push the pawn one square from f5 to f6.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From f5 forward is f6.",
        "Drag the pawn from f5 to f6."
      ],
      "slug": "pawn-auto-24"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/6P1/K7 w - - 0 1",
      "expectedSan": "g3",
      "instruction": "Push the pawn one square from g2 to g3.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From g2 forward is g3.",
        "Drag the pawn from g2 to g3."
      ],
      "slug": "pawn-auto-25"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/6P1/K7 w - - 0 1",
      "expectedSan": "g4",
      "instruction": "Push the pawn two squares from g2 to g4.",
      "hints": [
        "A pawn on its starting rank may move one OR two squares.",
        "From g2 forward is g4.",
        "Drag the pawn from g2 to g4."
      ],
      "slug": "pawn-auto-26"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/6P1/8/8/K7 w - - 0 1",
      "expectedSan": "g5",
      "instruction": "Push the pawn one square from g4 to g5.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From g4 forward is g5.",
        "Drag the pawn from g4 to g5."
      ],
      "slug": "pawn-auto-27"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/6P1/8/8/8/K7 w - - 0 1",
      "expectedSan": "g6",
      "instruction": "Push the pawn one square from g5 to g6.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From g5 forward is g6.",
        "Drag the pawn from g5 to g6."
      ],
      "slug": "pawn-auto-28"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/7P/K7 w - - 0 1",
      "expectedSan": "h3",
      "instruction": "Push the pawn one square from h2 to h3.",
      "hints": [
        "Pawns move straight forward, one square at a time.",
        "From h2 forward is h3.",
        "Drag the pawn from h2 to h3."
      ],
      "slug": "pawn-auto-29"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/7P/K7 w - - 0 1",
      "expectedSan": "h4",
      "instruction": "Push the pawn two squares from h2 to h4.",
      "hints": [
        "A pawn on its starting rank may move one OR two squares.",
        "From h2 forward is h4.",
        "Drag the pawn from h2 to h4."
      ],
      "slug": "pawn-auto-30"
    }
  ],
  "special-rules": [
    {
      "type": "move",
      "fen": "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
      "expectedSan": "O-O",
      "instruction": "Castle kingside: move the king two squares to g1.",
      "hints": [
        "Castling is a special move — the king jumps two squares and the rook hops to the other side.",
        "From e1, g1 is a legal move.",
        "Drag the piece from e1 to g1."
      ],
      "slug": "special-rules-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/4K2R w K - 0 1",
      "expectedSan": "O-O",
      "instruction": "Castle kingside with only the h1 rook available.",
      "hints": [
        "Only the h-rook can castle kingside.",
        "From e1, g1 is a legal move.",
        "Drag the piece from e1 to g1."
      ],
      "slug": "special-rules-auto-2"
    },
    {
      "type": "move",
      "fen": "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
      "expectedSan": "O-O-O",
      "instruction": "Castle queenside: move the king two squares to c1.",
      "hints": [
        "Queenside castling takes the king to c1 and the a-rook to d1.",
        "From e1, c1 is a legal move.",
        "Drag the piece from e1 to c1."
      ],
      "slug": "special-rules-auto-3"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/R3K3 w Q - 0 1",
      "expectedSan": "O-O-O",
      "instruction": "Castle queenside — the b1 knight has already moved away.",
      "hints": [
        "The squares between the king and the a-rook must be empty.",
        "From e1, c1 is a legal move.",
        "Drag the piece from e1 to c1."
      ],
      "slug": "special-rules-auto-4"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2",
      "expectedSan": "exd6",
      "instruction": "Capture en passant — take the pawn that just advanced two squares.",
      "hints": [
        "A pawn on the 5th rank may capture en passant only on the very next move.",
        "From e5, d6 is a legal move.",
        "Drag the piece from e5 to d6."
      ],
      "slug": "special-rules-auto-5"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/2pP4/8/8/8/4K3 w - c6 0 2",
      "expectedSan": "dxc6",
      "instruction": "Capture en passant to the left.",
      "hints": [
        "The en-passant capture works in either direction.",
        "From d5, c6 is a legal move.",
        "Drag the piece from d5 to c6."
      ],
      "slug": "special-rules-auto-6"
    },
    {
      "slug": "special-q1",
      "type": "quiz",
      "question": "What is castling?",
      "options": [
        "Moving the king two squares to tuck it behind a rook",
        "Moving the rook to the centre",
        "A check by the bishop",
        "Sacrificing the queen"
      ],
      "correct": 0,
      "explanation": "The king moves two squares toward a rook and the rook jumps to the other side."
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4Pp2/8/8/8/K7 w - f6 0 1",
      "expectedSan": "exf6",
      "instruction": "Capture en passant to the right.",
      "hints": [
        "The en-passant capture works in either direction.",
        "From e5, f6 is a legal move.",
        "Drag the piece from e5 to f6."
      ],
      "slug": "special-rules-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/P7/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "a8=N",
      "instruction": "Push the pawn to a8 — it promotes.",
      "hints": [
        "A pawn reaching the far rank promotes immediately.",
        "From a7, a8 is a legal move.",
        "Drag the piece from a7 to a8."
      ],
      "slug": "special-rules-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/1P6/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "b8=N",
      "instruction": "Push the pawn to b8 — it promotes.",
      "hints": [
        "A pawn reaching the far rank promotes immediately.",
        "From b7, b8 is a legal move.",
        "Drag the piece from b7 to b8."
      ],
      "slug": "special-rules-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/2P5/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "c8=N",
      "instruction": "Push the pawn to c8 — it promotes.",
      "hints": [
        "A pawn reaching the far rank promotes immediately.",
        "From c7, c8 is a legal move.",
        "Drag the piece from c7 to c8."
      ],
      "slug": "special-rules-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/3P4/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "d8=N",
      "instruction": "Push the pawn to d8 — it promotes.",
      "hints": [
        "A pawn reaching the far rank promotes immediately.",
        "From d7, d8 is a legal move.",
        "Drag the piece from d7 to d8."
      ],
      "slug": "special-rules-auto-12"
    },
    {
      "type": "move",
      "fen": "3k4/4P3/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "e8=N",
      "instruction": "Push the pawn to e8 — it promotes.",
      "hints": [
        "A pawn reaching the far rank promotes immediately.",
        "From e7, e8 is a legal move.",
        "Drag the piece from e7 to e8."
      ],
      "slug": "special-rules-auto-13"
    },
    {
      "slug": "special-q2",
      "type": "quiz",
      "question": "Which pieces may castle?",
      "options": [
        "King and rook",
        "King and queen",
        "King and bishop",
        "Any piece"
      ],
      "correct": 0,
      "explanation": "Only the king and a rook castle."
    },
    {
      "type": "move",
      "fen": "4k3/5P2/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "f8=N",
      "instruction": "Push the pawn to f8 — it promotes.",
      "hints": [
        "A pawn reaching the far rank promotes immediately.",
        "From f7, f8 is a legal move.",
        "Drag the piece from f7 to f8."
      ],
      "slug": "special-rules-auto-15"
    },
    {
      "type": "move",
      "fen": "4k3/6P1/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "g8=N",
      "instruction": "Push the pawn to g8 — it promotes.",
      "hints": [
        "A pawn reaching the far rank promotes immediately.",
        "From g7, g8 is a legal move.",
        "Drag the piece from g7 to g8."
      ],
      "slug": "special-rules-auto-16"
    },
    {
      "type": "move",
      "fen": "4k3/7P/8/8/8/8/8/K7 w - - 0 1",
      "expectedSan": "h8=N",
      "instruction": "Push the pawn to h8 — it promotes.",
      "hints": [
        "A pawn reaching the far rank promotes immediately.",
        "From h7, h8 is a legal move.",
        "Drag the piece from h7 to h8."
      ],
      "slug": "special-rules-auto-17"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
      "expectedSan": "e4",
      "instruction": "Push the pawn two squares from its starting rank.",
      "hints": [
        "A pawn on its home rank may move one OR two squares.",
        "From e2, e4 is a legal move.",
        "Drag the piece from e2 to e4."
      ],
      "slug": "special-rules-auto-18"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/3n4/4P3/4K3 w - - 0 1",
      "expectedSan": "exd3",
      "instruction": "Capture the black knight sitting diagonally in front.",
      "hints": [
        "A pawn captures one square diagonally forward, never straight ahead.",
        "From e2, d3 is a legal move.",
        "Drag the piece from e2 to d3."
      ],
      "slug": "special-rules-auto-19"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/P7/4K3 w - - 0 1",
      "expectedSan": "a4",
      "instruction": "Advance the pawn two squares from a2.",
      "hints": [
        "The two-square step is only available from the starting rank.",
        "From a2, a4 is a legal move.",
        "Drag the piece from a2 to a4."
      ],
      "slug": "special-rules-auto-20"
    },
    {
      "slug": "special-q3",
      "type": "quiz",
      "question": "How many times can you castle?",
      "options": [
        "Once per side",
        "Twice per side",
        "As often as you like",
        "Never"
      ],
      "correct": 0,
      "explanation": "Once per side — afterwards the king and that rook have both moved."
    },
    {
      "type": "move",
      "fen": "5k2/8/8/8/8/8/8/4K2R w K - 0 1",
      "expectedSan": "O-O+",
      "instruction": "Castle kingside — the king lands on g1, the rook on f1.",
      "hints": [
        "Castling is one move: the king jumps two squares and the rook hops over.",
        "From e1, g1 is a legal move.",
        "Drag the piece from e1 to g1."
      ],
      "slug": "special-rules-auto-22"
    },
    {
      "type": "move",
      "fen": "6k1/8/8/8/8/8/8/4K2R w K - 0 1",
      "expectedSan": "O-O",
      "instruction": "Castle kingside — the king lands on g1, the rook on f1.",
      "hints": [
        "Castling is one move: the king jumps two squares and the rook hops over.",
        "From e1, g1 is a legal move.",
        "Drag the piece from e1 to g1."
      ],
      "slug": "special-rules-auto-23"
    },
    {
      "type": "move",
      "fen": "3rk3/8/8/8/8/8/8/4K2R w KQ - 0 1",
      "expectedSan": "O-O",
      "instruction": "Castle kingside — the king lands on g1, the rook on f1.",
      "hints": [
        "Castling is one move: the king jumps two squares and the rook hops over.",
        "From e1, g1 is a legal move.",
        "Drag the piece from e1 to g1."
      ],
      "slug": "special-rules-auto-24"
    },
    {
      "type": "move",
      "fen": "5k2/8/8/8/8/8/8/R3K3 w Q - 0 1",
      "expectedSan": "O-O-O",
      "instruction": "Castle queenside — the king lands on c1, the rook on d1.",
      "hints": [
        "Queenside castling takes the king two squares toward the a-rook.",
        "From e1, c1 is a legal move.",
        "Drag the piece from e1 to c1."
      ],
      "slug": "special-rules-auto-25"
    },
    {
      "type": "move",
      "fen": "6k1/8/8/8/8/8/8/R3K3 w Q - 0 1",
      "expectedSan": "O-O-O",
      "instruction": "Castle queenside — the king lands on c1, the rook on d1.",
      "hints": [
        "Queenside castling takes the king two squares toward the a-rook.",
        "From e1, c1 is a legal move.",
        "Drag the piece from e1 to c1."
      ],
      "slug": "special-rules-auto-26"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/1pP5/8/8/8/K7 w - b6 0 1",
      "expectedSan": "cxb6",
      "instruction": "Capture en passant - the black pawn just advanced two squares.",
      "hints": [
        "A pawn on the 5th rank may capture en passant only on the very next move.",
        "From c5, b6 is a legal move.",
        "Drag the piece from c5 to b6."
      ],
      "slug": "special-rules-auto-27"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/2pP4/8/8/8/K7 w - c6 0 1",
      "expectedSan": "dxc6",
      "instruction": "Capture en passant - the black pawn just advanced two squares.",
      "hints": [
        "A pawn on the 5th rank may capture en passant only on the very next move.",
        "From d5, c6 is a legal move.",
        "Drag the piece from d5 to c6."
      ],
      "slug": "special-rules-auto-28"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/3pP3/8/8/8/K7 w - d6 0 1",
      "expectedSan": "exd6",
      "instruction": "Capture en passant - the black pawn just advanced two squares.",
      "hints": [
        "A pawn on the 5th rank may capture en passant only on the very next move.",
        "From e5, d6 is a legal move.",
        "Drag the piece from e5 to d6."
      ],
      "slug": "special-rules-auto-29"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/4pP2/8/8/8/K7 w - e6 0 1",
      "expectedSan": "fxe6",
      "instruction": "Capture en passant - the black pawn just advanced two squares.",
      "hints": [
        "A pawn on the 5th rank may capture en passant only on the very next move.",
        "From f5, e6 is a legal move.",
        "Drag the piece from f5 to e6."
      ],
      "slug": "special-rules-auto-30"
    }
  ],
  "check": [
    {
      "type": "move",
      "fen": "4k3/8/8/8/4r3/8/8/4K3 w - - 0 1",
      "expectedSan": "Kd1",
      "instruction": "The e4 rook checks the e-file - move the king to d1.",
      "hints": [
        "The e-file is attacked, so step to any square off it.",
        "From e1, d1 is a legal move.",
        "Drag the piece from e1 to d1."
      ],
      "slug": "check-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4r3/8/8/4K3 w - - 0 1",
      "expectedSan": "Kf1",
      "instruction": "The e4 rook checks the e-file - move the king to f1.",
      "hints": [
        "The e-file is attacked, so step to any square off it.",
        "From e1, f1 is a legal move.",
        "Drag the piece from e1 to f1."
      ],
      "slug": "check-auto-2"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4r3/8/8/4K3 w - - 0 1",
      "expectedSan": "Kd2",
      "instruction": "The e4 rook checks the e-file - move the king to d2.",
      "hints": [
        "The e-file is attacked, so step to any square off it.",
        "From e1, d2 is a legal move.",
        "Drag the piece from e1 to d2."
      ],
      "slug": "check-auto-3"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/4r3/8/8/4K3 w - - 0 1",
      "expectedSan": "Kf2",
      "instruction": "The e4 rook checks the e-file - move the king to f2.",
      "hints": [
        "The e-file is attacked, so step to any square off it.",
        "From e1, f2 is a legal move.",
        "Drag the piece from e1 to f2."
      ],
      "slug": "check-auto-4"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/r3K3 w - - 0 1",
      "expectedSan": "Kd2",
      "instruction": "The a1 rook checks rank 1 - climb to d2.",
      "hints": [
        "Rank 1 is attacked, so leave the rank entirely.",
        "From e1, d2 is a legal move.",
        "Drag the piece from e1 to d2."
      ],
      "slug": "check-auto-5"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/r3K3 w - - 0 1",
      "expectedSan": "Ke2",
      "instruction": "The a1 rook checks rank 1 - climb to e2.",
      "hints": [
        "Rank 1 is attacked, so leave the rank entirely.",
        "From e1, e2 is a legal move.",
        "Drag the piece from e1 to e2."
      ],
      "slug": "check-auto-6"
    },
    {
      "slug": "check-q1",
      "type": "quiz",
      "question": "What is check?",
      "options": [
        "The king is attacked",
        "The king is captured",
        "A piece is pinned",
        "The game is drawn"
      ],
      "correct": 0,
      "explanation": "Check means the king is under attack."
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/r3K3 w - - 0 1",
      "expectedSan": "Kf2",
      "instruction": "The a1 rook checks rank 1 - climb to f2.",
      "hints": [
        "Rank 1 is attacked, so leave the rank entirely.",
        "From e1, f2 is a legal move.",
        "Drag the piece from e1 to f2."
      ],
      "slug": "check-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/1r2K3 w - - 0 1",
      "expectedSan": "Ke2",
      "instruction": "The b1 rook checks along rank 1 - climb to e2.",
      "hints": [
        "Rank 1 is attacked, so leave the rank entirely.",
        "From e1, e2 is a legal move.",
        "Drag the piece from e1 to e2."
      ],
      "slug": "check-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/2r1K3 w - - 0 1",
      "expectedSan": "Ke2",
      "instruction": "The c1 rook checks along rank 1 - climb to e2.",
      "hints": [
        "Rank 1 is attacked, so leave the rank entirely.",
        "From e1, e2 is a legal move.",
        "Drag the piece from e1 to e2."
      ],
      "slug": "check-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/3rK3 w - - 0 1",
      "expectedSan": "Ke2",
      "instruction": "The d1 rook checks along rank 1 - climb to e2.",
      "hints": [
        "Rank 1 is attacked, so leave the rank entirely.",
        "From e1, e2 is a legal move.",
        "Drag the piece from e1 to e2."
      ],
      "slug": "check-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/4Kr2 w - - 0 1",
      "expectedSan": "Ke2",
      "instruction": "The f1 rook checks along rank 1 - climb to e2.",
      "hints": [
        "Rank 1 is attacked, so leave the rank entirely.",
        "From e1, e2 is a legal move.",
        "Drag the piece from e1 to e2."
      ],
      "slug": "check-auto-12"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/b7/8/8/8/4K3 w - - 0 1",
      "expectedSan": "Kd1",
      "instruction": "The a5 bishop checks down the long diagonal - step to d1.",
      "hints": [
        "A bishop attacks diagonally only, so any off-diagonal square is safe.",
        "From e1, d1 is a legal move.",
        "Drag the piece from e1 to d1."
      ],
      "slug": "check-auto-13"
    },
    {
      "slug": "check-q2",
      "type": "quiz",
      "question": "What must you do when in check?",
      "options": [
        "Answer the check",
        "Ignore it",
        "Attack the other king",
        "Pass your move"
      ],
      "correct": 0,
      "explanation": "Check must always be answered."
    },
    {
      "type": "move",
      "fen": "8/7k/1r6/8/8/8/8/K7 b - - 0 1",
      "expectedSan": "Rb1+",
      "instruction": "Drop the rook onto the 1st rank to give check.",
      "hints": [
        "A rook checks along a rank as well as a file.",
        "From b6, b1 is a legal move.",
        "Drag the piece from b6 to b1."
      ],
      "slug": "check-auto-15"
    },
    {
      "type": "move",
      "fen": "8/7k/6r1/8/8/8/8/K7 b - - 0 1",
      "expectedSan": "Rg1+",
      "instruction": "Drop the rook onto the 1st rank - the whole rank is covered.",
      "hints": [
        "A rook on the enemy back rank checks along it.",
        "From g6, g1 is a legal move.",
        "Drag the piece from g6 to g1."
      ],
      "slug": "check-auto-16"
    },
    {
      "type": "move",
      "fen": "8/kr6/8/8/8/8/8/K7 b - - 0 1",
      "expectedSan": "Rb1+",
      "instruction": "Slide the rook down the b-file onto the 1st rank.",
      "hints": [
        "A rook checks along a rank as well as a file.",
        "From b7, b1 is a legal move.",
        "Drag the piece from b7 to b1."
      ],
      "slug": "check-auto-17"
    },
    {
      "type": "move",
      "fen": "8/7k/2r5/8/8/8/8/K7 b - - 0 1",
      "expectedSan": "Rc1+",
      "instruction": "Bring the rook to c1 for check along the back rank.",
      "hints": [
        "Any rook reaching the 1st rank with a clear line gives check.",
        "From c6, c1 is a legal move.",
        "Drag the piece from c6 to c1."
      ],
      "slug": "check-auto-18"
    },
    {
      "type": "move",
      "fen": "8/7k/r7/8/8/8/8/K7 b - - 0 1",
      "expectedSan": "Ra8+",
      "instruction": "Slide the rook up the a-file to give check.",
      "hints": [
        "A rook checks down any file that is clear of pieces.",
        "From a6, a8 is a legal move.",
        "Drag the piece from a6 to a8."
      ],
      "slug": "check-auto-19"
    },
    {
      "type": "move",
      "fen": "8/7k/8/8/r7/8/8/K7 b - - 0 1",
      "expectedSan": "Ra6+",
      "instruction": "Move the rook up the a-file so it attacks the king.",
      "hints": [
        "A rook on the same file as the enemy king is check.",
        "From a4, a6 is a legal move.",
        "Drag the piece from a4 to a6."
      ],
      "slug": "check-auto-20"
    },
    {
      "slug": "check-q3",
      "type": "quiz",
      "question": "How many ways are there to escape check?",
      "options": [
        "Three",
        "One",
        "Two",
        "Five"
      ],
      "correct": 0,
      "explanation": "Move the king, block the attack, or capture the checker."
    },
    {
      "type": "move",
      "fen": "8/7k/1q6/8/8/8/8/K7 b - - 0 1",
      "expectedSan": "Qb1+",
      "instruction": "Slide the queen onto the 1st rank to give check.",
      "hints": [
        "A queen checks along a rank, file or diagonal.",
        "From b6, b1 is a legal move.",
        "Drag the piece from b6 to b1."
      ],
      "slug": "check-auto-22"
    },
    {
      "type": "move",
      "fen": "8/k7/7q/8/8/8/8/K7 b - - 0 1",
      "expectedSan": "Qh1+",
      "instruction": "Drop the queen onto the 1st rank for check.",
      "hints": [
        "A queen checks along a rank as well as a file.",
        "From h6, h1 is a legal move.",
        "Drag the piece from h6 to h1."
      ],
      "slug": "check-auto-23"
    },
    {
      "type": "move",
      "fen": "8/7k/8/8/8/2q5/8/K7 b - - 0 1",
      "expectedSan": "Qc1+",
      "instruction": "Step the queen to c1, checking along the back rank.",
      "hints": [
        "A queen checks along a rank as well as a file.",
        "From c3, c1 is a legal move.",
        "Drag the piece from c3 to c1."
      ],
      "slug": "check-auto-24"
    },
    {
      "type": "move",
      "fen": "7b/k7/8/8/8/8/8/K7 b - - 0 1",
      "expectedSan": "Bb2+",
      "instruction": "Slide the bishop to b2, onto the a1-h8 diagonal.",
      "hints": [
        "A bishop on the long diagonal checks the corner king.",
        "From h8, b2 is a legal move.",
        "Drag the piece from h8 to b2."
      ],
      "slug": "check-auto-25"
    },
    {
      "type": "move",
      "fen": "7k/6b1/8/8/8/8/8/K7 b - - 0 1",
      "expectedSan": "Bb2+",
      "instruction": "Bring the bishop to b2 for check on the diagonal.",
      "hints": [
        "The bishop shares a diagonal with the king.",
        "From g7, b2 is a legal move.",
        "Drag the piece from g7 to b2."
      ],
      "slug": "check-auto-26"
    },
    {
      "type": "move",
      "fen": "8/7k/8/2n5/8/8/8/K7 b - - 0 1",
      "expectedSan": "Nb3+",
      "instruction": "Jump the knight to b3 - it attacks the a1 king.",
      "hints": [
        "A knight checks from an L-shape away, never along a line.",
        "From c5, b3 is a legal move.",
        "Drag the piece from c5 to b3."
      ],
      "slug": "check-auto-27"
    },
    {
      "type": "move",
      "fen": "8/7k/8/8/3n4/8/8/K7 b - - 0 1",
      "expectedSan": "Nb3+",
      "instruction": "Jump the knight to b3 to give check.",
      "hints": [
        "A knight checks from an L-shape away, never along a line.",
        "From d4, b3 is a legal move.",
        "Drag the piece from d4 to b3."
      ],
      "slug": "check-auto-28"
    }
  ],
  "checkmate": [
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/KR6 w - - 0 1",
      "expectedSan": "Rb8#",
      "instruction": "Rb1 to b8 is mate on the back rank (king on g8).",
      "hints": [
        "The black king is trapped by its own pawns; a rook on the 8th rank mates.",
        "From b1, b8 is a legal move.",
        "Drag the piece from b1 to b8."
      ],
      "slug": "checkmate-auto-1"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K1R5 w - - 0 1",
      "expectedSan": "Rc8#",
      "instruction": "Rc1 to c8 is mate on the back rank (king on g8).",
      "hints": [
        "The black king is trapped by its own pawns; a rook on the 8th rank mates.",
        "From c1, c8 is a legal move.",
        "Drag the piece from c1 to c8."
      ],
      "slug": "checkmate-auto-2"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K2R4 w - - 0 1",
      "expectedSan": "Rd8#",
      "instruction": "Rd1 to d8 is mate on the back rank (king on g8).",
      "hints": [
        "The black king is trapped by its own pawns; a rook on the 8th rank mates.",
        "From d1, d8 is a legal move.",
        "Drag the piece from d1 to d8."
      ],
      "slug": "checkmate-auto-3"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K3R3 w - - 0 1",
      "expectedSan": "Re8#",
      "instruction": "Re1 to e8 is mate on the back rank (king on g8).",
      "hints": [
        "The black king is trapped by its own pawns; a rook on the 8th rank mates.",
        "From e1, e8 is a legal move.",
        "Drag the piece from e1 to e8."
      ],
      "slug": "checkmate-auto-4"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/KQ6 w - - 0 1",
      "expectedSan": "Qb8#",
      "instruction": "Qb1 to b8 is mate on the back rank (king on g8).",
      "hints": [
        "A queen on the 8th rank mates a king boxed in by its own pawns.",
        "From b1, b8 is a legal move.",
        "Drag the piece from b1 to b8."
      ],
      "slug": "checkmate-auto-5"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K1Q5 w - - 0 1",
      "expectedSan": "Qc8#",
      "instruction": "Qc1 to c8 is mate on the back rank (king on g8).",
      "hints": [
        "A queen on the 8th rank mates a king boxed in by its own pawns.",
        "From c1, c8 is a legal move.",
        "Drag the piece from c1 to c8."
      ],
      "slug": "checkmate-auto-6"
    },
    {
      "slug": "mate-q1",
      "type": "quiz",
      "question": "What is checkmate?",
      "options": [
        "The king is in check with no legal escape",
        "The king is merely in check",
        "A draw by repetition",
        "A fork"
      ],
      "correct": 0,
      "explanation": "Check with no legal reply — the game is over."
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K2Q4 w - - 0 1",
      "expectedSan": "Qd8#",
      "instruction": "Qd1 to d8 is mate on the back rank (king on g8).",
      "hints": [
        "A queen on the 8th rank mates a king boxed in by its own pawns.",
        "From d1, d8 is a legal move.",
        "Drag the piece from d1 to d8."
      ],
      "slug": "checkmate-auto-8"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K3Q3 w - - 0 1",
      "expectedSan": "Qe8#",
      "instruction": "Qe1 to e8 is mate on the back rank (king on g8).",
      "hints": [
        "A queen on the 8th rank mates a king boxed in by its own pawns.",
        "From e1, e8 is a legal move.",
        "Drag the piece from e1 to e8."
      ],
      "slug": "checkmate-auto-9"
    },
    {
      "type": "move",
      "fen": "7k/5ppp/8/8/8/8/8/KR6 w - - 0 1",
      "expectedSan": "Rb8#",
      "instruction": "Rb1 to b8 is mate on the back rank (king on h8).",
      "hints": [
        "The black king is trapped by its own pawns; a rook on the 8th rank mates.",
        "From b1, b8 is a legal move.",
        "Drag the piece from b1 to b8."
      ],
      "slug": "checkmate-auto-10"
    },
    {
      "type": "move",
      "fen": "7k/5ppp/8/8/8/8/8/K1R5 w - - 0 1",
      "expectedSan": "Rc8#",
      "instruction": "Rc1 to c8 is mate on the back rank (king on h8).",
      "hints": [
        "The black king is trapped by its own pawns; a rook on the 8th rank mates.",
        "From c1, c8 is a legal move.",
        "Drag the piece from c1 to c8."
      ],
      "slug": "checkmate-auto-11"
    },
    {
      "type": "move",
      "fen": "7k/5ppp/8/8/8/8/8/K2R4 w - - 0 1",
      "expectedSan": "Rd8#",
      "instruction": "Rd1 to d8 is mate on the back rank (king on h8).",
      "hints": [
        "The black king is trapped by its own pawns; a rook on the 8th rank mates.",
        "From d1, d8 is a legal move.",
        "Drag the piece from d1 to d8."
      ],
      "slug": "checkmate-auto-12"
    },
    {
      "type": "move",
      "fen": "7k/5ppp/8/8/8/8/8/K3R3 w - - 0 1",
      "expectedSan": "Re8#",
      "instruction": "Re1 to e8 is mate on the back rank (king on h8).",
      "hints": [
        "The black king is trapped by its own pawns; a rook on the 8th rank mates.",
        "From e1, e8 is a legal move.",
        "Drag the piece from e1 to e8."
      ],
      "slug": "checkmate-auto-13"
    },
    {
      "slug": "mate-q2",
      "type": "quiz",
      "question": "What is the usual way to deliver mate?",
      "options": [
        "Support the attacking piece",
        "Sacrifice the queen",
        "Give away a piece",
        "Move into stalemate"
      ],
      "correct": 0,
      "explanation": "A supported mating piece cannot be captured."
    },
    {
      "type": "move",
      "fen": "7k/5ppp/8/8/8/8/8/KQ6 w - - 0 1",
      "expectedSan": "Qb8#",
      "instruction": "Qb1 to b8 is mate on the back rank (king on h8).",
      "hints": [
        "A queen on the 8th rank mates a king boxed in by its own pawns.",
        "From b1, b8 is a legal move.",
        "Drag the piece from b1 to b8."
      ],
      "slug": "checkmate-auto-15"
    },
    {
      "type": "move",
      "fen": "7k/5ppp/8/8/8/8/8/K1Q5 w - - 0 1",
      "expectedSan": "Qc8#",
      "instruction": "Qc1 to c8 is mate on the back rank (king on h8).",
      "hints": [
        "A queen on the 8th rank mates a king boxed in by its own pawns.",
        "From c1, c8 is a legal move.",
        "Drag the piece from c1 to c8."
      ],
      "slug": "checkmate-auto-16"
    },
    {
      "type": "move",
      "fen": "7k/5ppp/8/8/8/8/8/K2Q4 w - - 0 1",
      "expectedSan": "Qd8#",
      "instruction": "Qd1 to d8 is mate on the back rank (king on h8).",
      "hints": [
        "A queen on the 8th rank mates a king boxed in by its own pawns.",
        "From d1, d8 is a legal move.",
        "Drag the piece from d1 to d8."
      ],
      "slug": "checkmate-auto-17"
    },
    {
      "type": "move",
      "fen": "7k/5ppp/8/8/8/8/8/K3Q3 w - - 0 1",
      "expectedSan": "Qe8#",
      "instruction": "Qe1 to e8 is mate on the back rank (king on h8).",
      "hints": [
        "A queen on the 8th rank mates a king boxed in by its own pawns.",
        "From e1, e8 is a legal move.",
        "Drag the piece from e1 to e8."
      ],
      "slug": "checkmate-auto-18"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/R5RK w - - 0 1",
      "expectedSan": "Ra8#",
      "instruction": "Ra1 to a8 mates, with the g1 rook covering the escape squares.",
      "hints": [
        "Two rooks mate together: one checks, the other covers the flight squares.",
        "From a1, a8 is a legal move.",
        "Drag the piece from a1 to a8."
      ],
      "slug": "checkmate-auto-19"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/KR4R1 w - - 0 1",
      "expectedSan": "Rb8#",
      "instruction": "Rb1 to b8 mates, with the g1 rook covering the escape squares.",
      "hints": [
        "Two rooks mate together: one checks, the other covers the flight squares.",
        "From b1, b8 is a legal move.",
        "Drag the piece from b1 to b8."
      ],
      "slug": "checkmate-auto-20"
    },
    {
      "slug": "mate-q3",
      "type": "quiz",
      "question": "What is a back-rank mate?",
      "options": [
        "Mate along the back rank with the king trapped by its own pawns",
        "Mate on the queenside",
        "Mate by a knight",
        "Mate in the opening"
      ],
      "correct": 0,
      "explanation": "The king is hemmed in by its own pawns."
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K1R3R1 w - - 0 1",
      "expectedSan": "Rc8#",
      "instruction": "Rc1 to c8 mates, with the g1 rook covering the escape squares.",
      "hints": [
        "Two rooks mate together: one checks, the other covers the flight squares.",
        "From c1, c8 is a legal move.",
        "Drag the piece from c1 to c8."
      ],
      "slug": "checkmate-auto-22"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K2R2R1 w - - 0 1",
      "expectedSan": "Rd8#",
      "instruction": "Rd1 to d8 mates, with the g1 rook covering the escape squares.",
      "hints": [
        "Two rooks mate together: one checks, the other covers the flight squares.",
        "From d1, d8 is a legal move.",
        "Drag the piece from d1 to d8."
      ],
      "slug": "checkmate-auto-23"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/Q5RK w - - 0 1",
      "expectedSan": "Qa8#",
      "instruction": "Qa1 to a8 is mate, supported by the g1 rook.",
      "hints": [
        "A supported queen on the 8th rank mates a boxed-in king.",
        "From a1, a8 is a legal move.",
        "Drag the piece from a1 to a8."
      ],
      "slug": "checkmate-auto-24"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/KQ4R1 w - - 0 1",
      "expectedSan": "Qb8#",
      "instruction": "Qb1 to b8 is mate, supported by the g1 rook.",
      "hints": [
        "A supported queen on the 8th rank mates a boxed-in king.",
        "From b1, b8 is a legal move.",
        "Drag the piece from b1 to b8."
      ],
      "slug": "checkmate-auto-25"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K1Q3R1 w - - 0 1",
      "expectedSan": "Qc8#",
      "instruction": "Qc1 to c8 is mate, supported by the g1 rook.",
      "hints": [
        "A supported queen on the 8th rank mates a boxed-in king.",
        "From c1, c8 is a legal move.",
        "Drag the piece from c1 to c8."
      ],
      "slug": "checkmate-auto-26"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/8/8/8/8/8/K2Q2R1 w - - 0 1",
      "expectedSan": "Qd8#",
      "instruction": "Qd1 to d8 is mate, supported by the g1 rook.",
      "hints": [
        "A supported queen on the 8th rank mates a boxed-in king.",
        "From d1, d8 is a legal move.",
        "Drag the piece from d1 to d8."
      ],
      "slug": "checkmate-auto-27"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/1R6/8/8/8/8/KR6 w - - 0 1",
      "expectedSan": "Rb8#",
      "instruction": "Rb6 to b8 is mate - the rook is already deep in the position.",
      "hints": [
        "A rook that has invaded the back rank mates a king shut in by pawns.",
        "From b6, b8 is a legal move.",
        "Drag the piece from b6 to b8."
      ],
      "slug": "checkmate-auto-28"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/2R5/8/8/8/8/K1R5 w - - 0 1",
      "expectedSan": "Rc8#",
      "instruction": "Rc6 to c8 is mate - the rook is already deep in the position.",
      "hints": [
        "A rook that has invaded the back rank mates a king shut in by pawns.",
        "From c6, c8 is a legal move.",
        "Drag the piece from c6 to c8."
      ],
      "slug": "checkmate-auto-29"
    },
    {
      "type": "move",
      "fen": "6k1/5ppp/3R4/8/8/8/8/K2R4 w - - 0 1",
      "expectedSan": "Rd8#",
      "instruction": "Rd6 to d8 is mate - the rook is already deep in the position.",
      "hints": [
        "A rook that has invaded the back rank mates a king shut in by pawns.",
        "From d6, d8 is a legal move.",
        "Drag the piece from d6 to d8."
      ],
      "slug": "checkmate-auto-30"
    }
  ],
  "draw": [
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/KN6 w - - 0 1",
      "expectedSan": "Nc3",
      "instruction": "Shuffle the knight - returning here three times is a draw by repetition.",
      "hints": [
        "Threefold repetition needs the same pieces, squares and side to move.",
        "From b1, c3 is a legal move.",
        "Drag the piece from b1 to c3."
      ],
      "slug": "draw-auto-1"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/8/8/8/K5N1 w - - 0 1",
      "expectedSan": "Nf3",
      "instruction": "Shuffle the knight - returning here three times is a draw by repetition.",
      "hints": [
        "Threefold repetition needs the same pieces, squares and side to move.",
        "From g1, f3 is a legal move.",
        "Drag the piece from g1 to f3."
      ],
      "slug": "draw-auto-2"
    },
    {
      "type": "move",
      "fen": "7k/8/8/8/8/2N5/8/4K3 w - - 0 1",
      "expectedSan": "Ne4",
      "instruction": "Shuffle the knight - returning here three times is a draw by repetition.",
      "hints": [
        "Threefold repetition needs the same pieces, squares and side to move.",
        "From c3, e4 is a legal move.",
        "Drag the piece from c3 to e4."
      ],
      "slug": "draw-auto-3"
    },
    {
      "type": "move",
      "fen": "7k/8/8/8/8/5N2/8/4K3 w - - 0 1",
      "expectedSan": "Ne5",
      "instruction": "Shuffle the knight - returning here three times is a draw by repetition.",
      "hints": [
        "Threefold repetition needs the same pieces, squares and side to move.",
        "From f3, e5 is a legal move.",
        "Drag the piece from f3 to e5."
      ],
      "slug": "draw-auto-4"
    },
    {
      "type": "move",
      "fen": "1N5k/8/8/8/8/8/8/4K3 w - - 0 1",
      "expectedSan": "Nc6",
      "instruction": "Shuffle the knight - returning here three times is a draw by repetition.",
      "hints": [
        "Threefold repetition needs the same pieces, squares and side to move.",
        "From b8, c6 is a legal move.",
        "Drag the piece from b8 to c6."
      ],
      "slug": "draw-auto-5"
    },
    {
      "type": "move",
      "fen": "6Nk/8/8/8/8/8/8/4K3 w - - 0 1",
      "expectedSan": "Nf6",
      "instruction": "Shuffle the knight - returning here three times is a draw by repetition.",
      "hints": [
        "Threefold repetition needs the same pieces, squares and side to move.",
        "From g8, f6 is a legal move.",
        "Drag the piece from g8 to f6."
      ],
      "slug": "draw-auto-6"
    },
    {
      "slug": "draw-q1",
      "type": "quiz",
      "question": "Name one way a game can be drawn.",
      "options": [
        "Threefold repetition",
        "Checkmate",
        "Promotion",
        "Resignation"
      ],
      "correct": 0,
      "explanation": "Threefold repetition is one of several draw conditions."
    },
    {
      "type": "move",
      "fen": "4k3/3q4/8/8/8/8/8/K2R4 w - - 0 1",
      "expectedSan": "Rxd7",
      "instruction": "Capture the queen - that resets the fifty-move clock.",
      "hints": [
        "Any capture or pawn move resets the halfmove counter.",
        "From d1, d7 is a legal move.",
        "Drag the piece from d1 to d7."
      ],
      "slug": "draw-auto-8"
    },
    {
      "type": "move",
      "fen": "4k3/5q2/8/8/8/8/8/5R1K w - - 0 1",
      "expectedSan": "Rxf7",
      "instruction": "Capture the queen - that resets the fifty-move clock.",
      "hints": [
        "Any capture or pawn move resets the halfmove counter.",
        "From f1, f7 is a legal move.",
        "Drag the piece from f1 to f7."
      ],
      "slug": "draw-auto-9"
    },
    {
      "type": "move",
      "fen": "4k3/q7/8/8/8/8/8/R6K w - - 0 1",
      "expectedSan": "Rxa7",
      "instruction": "Capture the queen - that resets the fifty-move clock.",
      "hints": [
        "Any capture or pawn move resets the halfmove counter.",
        "From a1, a7 is a legal move.",
        "Drag the piece from a1 to a7."
      ],
      "slug": "draw-auto-10"
    },
    {
      "type": "move",
      "fen": "4k3/2q5/8/8/8/8/2P5/K7 w - - 0 1",
      "expectedSan": "c4",
      "instruction": "Push the pawn - a pawn move also resets the clock.",
      "hints": [
        "A pawn move resets the fifty-move counter just like a capture.",
        "From c2, c4 is a legal move.",
        "Drag the piece from c2 to c4."
      ],
      "slug": "draw-auto-11"
    },
    {
      "type": "move",
      "fen": "4k3/q7/8/8/8/8/1P6/7K w - - 0 1",
      "expectedSan": "b4",
      "instruction": "Push the pawn - a pawn move also resets the clock.",
      "hints": [
        "A pawn move resets the fifty-move counter just like a capture.",
        "From b2, b4 is a legal move.",
        "Drag the piece from b2 to b4."
      ],
      "slug": "draw-auto-12"
    },
    {
      "type": "move",
      "fen": "4k3/5q2/8/8/8/8/6P1/K7 w - - 0 1",
      "expectedSan": "g4",
      "instruction": "Push the pawn - a pawn move also resets the clock.",
      "hints": [
        "A pawn move resets the fifty-move counter just like a capture.",
        "From g2, g4 is a legal move.",
        "Drag the piece from g2 to g4."
      ],
      "slug": "draw-auto-13"
    },
    {
      "slug": "draw-q2",
      "type": "quiz",
      "question": "What is the fifty-move rule?",
      "options": [
        "A draw after 50 moves by each side with no capture or pawn move",
        "A win for White after 50 moves",
        "A time control",
        "A castling rule"
      ],
      "correct": 0,
      "explanation": "50 moves by each side with no capture and no pawn move."
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/3p4/3r4/8/K2R4 w - - 0 1",
      "expectedSan": "Rd2",
      "instruction": "Hold the rook close - rook endings like this are drawn.",
      "hints": [
        "Rook endings are often drawn; the defending side simply keeps the rooks near each other.",
        "From d1, d2 is a legal move.",
        "Drag the piece from d1 to d2."
      ],
      "slug": "draw-auto-15"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/5p2/4r3/8/8/4R2K w - - 0 1",
      "expectedSan": "Re2",
      "instruction": "Hold the rook close - rook endings like this are drawn.",
      "hints": [
        "Rook endings are often drawn; the defending side simply keeps the rooks near each other.",
        "From e1, e2 is a legal move.",
        "Drag the piece from e1 to e2."
      ],
      "slug": "draw-auto-16"
    },
    {
      "type": "move",
      "fen": "4k3/8/8/8/1p6/r7/8/R2K4 w - - 0 1",
      "expectedSan": "Ra2",
      "instruction": "Hold the rook close - rook endings like this are drawn.",
      "hints": [
        "Rook endings are often drawn; the defending side simply keeps the rooks near each other.",
        "From a1, a2 is a legal move.",
        "Drag the piece from a1 to a2."
      ],
      "slug": "draw-auto-17"
    },
    {
      "type": "move",
      "fen": "1n2kn2/8/8/8/8/8/8/1N2KN2 w - - 0 1",
      "expectedSan": "Nc3",
      "instruction": "Develop quietly - keep every piece on the board to avoid a dead draw.",
      "hints": [
        "Trading down to insufficient material hands the game a draw for free.",
        "From b1, c3 is a legal move.",
        "Drag the piece from b1 to c3."
      ],
      "slug": "draw-auto-18"
    },
    {
      "type": "move",
      "fen": "4k3/8/5n2/3b4/3B4/8/8/4K1N1 w - - 0 1",
      "expectedSan": "Nf3",
      "instruction": "Develop quietly - keep every piece on the board to avoid a dead draw.",
      "hints": [
        "Trading down to insufficient material hands the game a draw for free.",
        "From g1, f3 is a legal move.",
        "Drag the piece from g1 to f3."
      ],
      "slug": "draw-auto-19"
    },
    {
      "type": "move",
      "fen": "4k3/8/2pP4/3r4/8/8/8/K2R4 w - - 0 1",
      "expectedSan": "Rd2",
      "instruction": "Keep the rook active - the endgame is drawn with best play.",
      "hints": [
        "Rook endings with an even pawn count are usually drawn; hold on and do not lose the rook.",
        "From d1, d2 is a legal move.",
        "Drag the piece from d1 to d2."
      ],
      "slug": "draw-auto-20"
    },
    {
      "slug": "draw-q3",
      "type": "quiz",
      "question": "What is insufficient material?",
      "options": [
        "Neither side can possibly checkmate",
        "A draw by agreement",
        "Threefold repetition",
        "A time forfeit"
      ],
      "correct": 0,
      "explanation": "If mate is impossible, the game is drawn."
    },
    {
      "type": "move",
      "fen": "4k3/8/5Pp1/5r2/8/8/8/5R1K w - - 0 1",
      "expectedSan": "Rf2",
      "instruction": "Keep the rook active - the endgame is drawn with best play.",
      "hints": [
        "Rook endings with an even pawn count are usually drawn; hold on and do not lose the rook.",
        "From f1, f2 is a legal move.",
        "Drag the piece from f1 to f2."
      ],
      "slug": "draw-auto-22"
    },
    {
      "type": "move",
      "fen": "4k3/8/Pp6/r7/8/8/8/R3K3 w - - 0 1",
      "expectedSan": "Ra2",
      "instruction": "Keep the rook active - the endgame is drawn with best play.",
      "hints": [
        "Rook endings with an even pawn count are usually drawn; hold on and do not lose the rook.",
        "From a1, a2 is a legal move.",
        "Drag the piece from a1 to a2."
      ],
      "slug": "draw-auto-23"
    },
    {
      "type": "move",
      "fen": "4k3/8/6pP/7r/8/8/8/3K3R w - - 0 1",
      "expectedSan": "Rh2",
      "instruction": "Keep the rook active - the endgame is drawn with best play.",
      "hints": [
        "Rook endings with an even pawn count are usually drawn; hold on and do not lose the rook.",
        "From h1, h2 is a legal move.",
        "Drag the piece from h1 to h2."
      ],
      "slug": "draw-auto-24"
    },
    {
      "type": "move",
      "fen": "4k3/8/2Pp4/2r5/8/8/8/2R3K1 w - - 0 1",
      "expectedSan": "Rc2",
      "instruction": "Keep the rook active - the endgame is drawn with best play.",
      "hints": [
        "Rook endings with an even pawn count are usually drawn; hold on and do not lose the rook.",
        "From c1, c2 is a legal move.",
        "Drag the piece from c1 to c2."
      ],
      "slug": "draw-auto-25"
    },
    {
      "type": "move",
      "fen": "4k3/1np2p2/8/8/8/8/1P3P2/1NBQKN2 w - - 0 1",
      "expectedSan": "Nc3",
      "instruction": "Develop every piece - trading down would hand over a free draw.",
      "hints": [
        "Once the position is dead (too little material to mate) the game is drawn automatically.",
        "From b1, c3 is a legal move.",
        "Drag the piece from b1 to c3."
      ],
      "slug": "draw-auto-26"
    },
    {
      "type": "move",
      "fen": "4k3/1pn2p2/8/8/8/8/1P3P2/2NQKBN1 w - - 0 1",
      "expectedSan": "Nf3",
      "instruction": "Develop every piece - trading down would hand over a free draw.",
      "hints": [
        "Once the position is dead (too little material to mate) the game is drawn automatically.",
        "From g1, f3 is a legal move.",
        "Drag the piece from g1 to f3."
      ],
      "slug": "draw-auto-27"
    },
    {
      "type": "move",
      "fen": "1n2k1n1/2pp4/8/8/8/8/2PP4/1NBQKBN1 w - - 0 1",
      "expectedSan": "Nc3",
      "instruction": "Develop every piece - trading down would hand over a free draw.",
      "hints": [
        "Once the position is dead (too little material to mate) the game is drawn automatically.",
        "From b1, c3 is a legal move.",
        "Drag the piece from b1 to c3."
      ],
      "slug": "draw-auto-28"
    },
    {
      "type": "move",
      "fen": "4k3/3R4/8/8/8/8/8/3QK3 w - - 0 1",
      "expectedSan": "Qd2",
      "instruction": "Shuffle the queen - a third repetition is an automatic draw.",
      "hints": [
        "Threefold repetition is drawn without a claim in most modern rules.",
        "From d1, d2 is a legal move.",
        "Drag the piece from d1 to d2."
      ],
      "slug": "draw-auto-29"
    },
    {
      "type": "move",
      "fen": "4k3/R7/8/8/8/8/8/Q3K3 w - - 0 1",
      "expectedSan": "Qa2",
      "instruction": "Shuffle the queen - a third repetition is an automatic draw.",
      "hints": [
        "Threefold repetition is drawn without a claim in most modern rules.",
        "From a1, a2 is a legal move.",
        "Drag the piece from a1 to a2."
      ],
      "slug": "draw-auto-30"
    }
  ]
};

module.exports = { PACKS };
