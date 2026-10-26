const { PACKS } = require('./academyExercises.generated');

/**
 * Academy curriculum — levels, lessons and exercises.
 *
 * Level structure:
 *   beginner    → fully authored lessons + exercises (board → pieces → special rules → training)
 *   intermediate→ opening-principles + White openings (courses from opening_courses table)
 *   advanced    → advanced strategy + Black repertoires (courses from opening_courses table)
 *
 * Exercise `type`s (rendered by the academy lesson page):
 *   'info'  → reading task; user clicks "I understand"
 *   'quiz'  → multiple choice ({ question, options[], correct })
 *   'move'  → make the requested move on the board (validated by expectedSan)
 *
 * Opening lessons reference an existing course via `openingSlug` — the frontend
 * loads Learn/Follow/Practice data from `/api/openings/courses/:slug`.
 */

const LEVELS = [
  {
    slug: 'beginner',
    name: 'Beginner',
    tagline: 'Learn how every piece moves',
    icon: '🌱',
    accent: '#00C853',
    description:
      'Start here. Learn the chessboard, how each piece moves and captures, and the special rules of the game — then prove it in training mode.',
    unlockAfter: 0,
    lessons: [
      {
        slug: 'board',
        title: 'The Chess Board',
        icon: '♟️',
        kind: 'lesson',
        sections: [
          {
            heading: 'An 8 × 8 battlefield',
            body: [
              'Chess is played on a board of 64 squares, arranged in 8 files (columns, labelled a–h) and 8 ranks (rows, numbered 1–8). Every square has a name like e4 or a1.',
              'The board is always set up so that a white square is on each player’s right-hand corner.',
              'White begins on ranks 1 and 2; Black begins on ranks 7 and 8. White always moves first.',
            ],
          },
          {
            heading: 'Files, ranks and diagonals',
            body: [
              'A file is a vertical column (a–h). A rank is a horizontal row (1–8). A diagonal is any line of same-coloured squares running at a 45° angle.',
              'Pawns move forward up the board. Every other piece moves freely, so learning the geometry of files, ranks and diagonals is the first step to mastering each piece.',
            ],
          },
        ],
        tips: ['You never need to memorise all 64 squares — you only need the ones involved in a move.'],
        exercises: [
          {
            slug: 'board-understand',
            type: 'info',
            label: 'Understand the board',
            text: 'The board has 8 files and 8 ranks — that is 64 squares. White starts on ranks 1–2 and moves first. Tap “I understand” when you’re ready.',
          },
        ],
      },
      {
        slug: 'king',
        title: 'The King',
        icon: '♚',
        kind: 'lesson',
        sections: [
          {
            heading: 'The most important piece',
            body: [
              'The King is the most valuable piece on the board — if your king is captured by an attack you cannot defend, you lose the game. You must never leave your king where it could be captured.',
              'The King moves exactly one square in any direction: up, down, left, right, or diagonally.',
              'A king may never move into check — that is, a square attacked by an enemy piece. It also cannot move to a square next to the enemy king.',
            ],
          },
          {
            heading: 'Guarding the king',
            body: [
              'Because the king is always moving one square at a time, you must plan escapes ahead of time. Lead with your other pieces, keep your king protected, and castle when you can.',
            ],
          },
        ],
        tips: ['The king is slow — it takes 7 moves to cross the board. Keep it safe behind your army.'],
        exercises: [
          {
            slug: 'king-up',
            type: 'move',
            fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
            expectedSan: 'Ke2',
            instruction: 'Move the King one square forward, from e1 to e2.',
            hints: [
              'The King can move one square in any direction.',
              'One square straight up from e1 is e2.',
              'Drag the King from e1 to e2.',
            ],
          },
          {
            slug: 'king-diagonal',
            type: 'move',
            fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
            expectedSan: 'Kd1',
            instruction: 'Move the King diagonally to the left, to d1.',
            hints: [
              'The King can also move diagonally.',
              'One square down-left from e1 is d1.',
              'Drag the King from e1 to d1.',
            ],
          },
          {
            slug: 'king-capture',
            type: 'move',
            fen: '4k3/8/8/8/8/8/8/3bK3 w - - 0 1',
            expectedSan: 'Kxd1',
            instruction: 'The black Bishop on d1 is defenseless. Capture it with the King.',
            hints: [
              'The King captures the same way it moves — one square in any direction.',
              'The Bishop is directly down-left from the King.',
              'Drag the King from e1 onto the Bishop at d1.',
            ],
          },
          {
            slug: 'king-escape-check',
            type: 'move',
            fen: '4r2k/8/8/8/8/8/8/4K3 w - - 0 1',
            expectedSan: 'Kd1',
            instruction: 'Your King is in check from the Rook on e8. Move your King to safety on d1.',
            hints: [
              'The Rook attacks straight down the e-file — you cannot stay on it.',
              'Move one square diagonally down-left, to d1, where the Rook cannot reach you.',
              'Drag the King from e1 to d1.',
            ],
          },
        ],
      },
      {
        slug: 'queen',
        title: 'The Queen',
        icon: '♛',
        kind: 'lesson',
        sections: [
          {
            heading: 'The most powerful piece',
            body: [
              'The Queen combines the power of the Rook and the Bishop. She moves any number of squares in a straight line or diagonally: along ranks, files and diagonals.',
              'The Queen is worth 9 points — more than any other piece except the King (which is priceless).',
              'Bringing the queen out too early can be risky: opponents will attack her with smaller pieces and you may be forced to retreat.',
            ],
          },
          {
            heading: 'Using the queen',
            body: [
              'The queen shines in the middle of the board where she controls up to 27 squares. Deploy her after a few pieces have been developed, and keep her shielded until you have an open board.',
            ],
          },
        ],
        tips: ['A queen on the centre can guard the whole board. Trade her only for a huge advantage.'],
        exercises: [
          {
            slug: 'queen-file',
            type: 'move',
            fen: '7k/q7/8/8/8/8/8/3QK3 w - - 0 1',
            expectedSan: 'Qd7',
            instruction: 'Move the Queen straight up the d-file to d7, where she pins Black’s Queen.',
            hints: [
              'The Queen moves like a Rook AND a Bishop.',
              'She moves any number of squares straight up the file.',
              'Drag the Queen from d1 to d7.',
            ],
          },
          {
            slug: 'queen-diagonal',
            type: 'move',
            fen: 'k7/8/8/8/8/8/8/3QK3 w - - 0 1',
            expectedSan: 'Qh5',
            instruction: 'Move the Queen along the long diagonal to h5.',
            hints: [
              'The Queen also moves like a Bishop.',
              'The long diagonal runs from d1 through e2, f3, g4 to h5.',
              'Drag the Queen from d1 to h5.',
            ],
          },
          {
            slug: 'queen-capture',
            type: 'move',
            fen: 'k7/8/8/7n/8/8/8/3QK3 w - - 0 1',
            expectedSan: 'Qxh5',
            instruction: 'Capture the black Knight on h5 with your Queen.',
            hints: [
              'The Queen captures like she moves — along ranks, files and diagonals.',
              'The Knight sits on the diagonal from d1: e2, f3, g4, h5.',
              'Drag the Queen from d1 onto the Knight at h5.',
            ],
          },
        ],
      },
      {
        slug: 'rook',
        title: 'The Rook',
        icon: '♜',
        kind: 'lesson',
        sections: [
          {
            heading: 'The straight-line soldier',
            body: [
              'The Rook moves any number of squares along a rank or a file — horizontally or vertically, but never diagonally.',
              'Rooks are worth 5 points each. They are most powerful on open files and the 7th rank, where they can attack the enemy back rank.',
              'Develop rooks by moving them to open or semi-open files, and connect them behind your own pawns whenever possible.',
            ],
          },
          {
            heading: 'Castling with the rook',
            body: [
              'The Rook is the piece you use for castling — the special move where the king and a rook move at the same time. You will learn that in the special rules lesson.',
            ],
          },
        ],
        tips: ['Rooks love open files. The 7th rank is a rook’s paradise — attack pawns from behind.'],
        exercises: [
          {
            slug: 'rook-up',
            type: 'move',
            fen: '7k/8/8/8/8/8/8/R3K3 w - - 0 1',
            expectedSan: 'Ra2',
            instruction: 'Move the Rook one square up along the a-file, to a2.',
            hints: [
              'The Rook moves in straight lines only.',
              'Straight up the a-file is a2.',
              'Drag the Rook from a1 to a2.',
            ],
          },
          {
            slug: 'rook-across',
            type: 'move',
            fen: 'k7/8/8/8/8/6K1/8/R7 w - - 0 1',
            expectedSan: 'Rh1',
            instruction: 'Move the Rook all the way across the board along the first rank, to h1.',
            hints: [
              'The Rook moves any number of squares horizontally.',
              'The first rank from a1 to h1 is completely open.',
              'Drag the Rook from a1 to h1.',
            ],
          },
          {
            slug: 'rook-capture',
            type: 'move',
            fen: '7k/p7/8/8/8/8/8/R3K3 w - - 0 1',
            expectedSan: 'Rxa7',
            instruction: 'Black’s pawn on a7 is waiting to be taken. Capture it with the Rook.',
            hints: [
              'The Rook captures along files and ranks.',
              'Up the a-file you pass a2–a6 and reach the pawn on a7.',
              'Drag the Rook from a1 onto the pawn at a7.',
            ],
          },
        ],
      },
      {
        slug: 'bishop',
        title: 'The Bishop',
        icon: '♝',
        kind: 'lesson',
        sections: [
          {
            heading: 'The diagonal archer',
            body: [
              'The Bishop moves any number of squares diagonally in one direction. A bishop can only ever move on one colour of square — light-squared or dark-squared bishops.',
              'Each player starts with two bishops: one on a light square, one on a dark square.',
              'Bishops are worth 3 points, like knights, but they excel on open boards with long diagonals.',
            ],
          },
          {
            heading: 'Good and bad bishops',
            body: [
              'A “good” bishop has a clear diagonal and room to work. A bishop trapped behind its own pawns is said to be “bad”. Free your bishops early by developing them toward the centre.',
            ],
          },
        ],
        tips: ['A bishop stuck behind its own pawns is a “bad” bishop. Make sure your bishops get out early.'],
        exercises: [
          {
            slug: 'bishop-long-diagonal',
            type: 'move',
            fen: '2k5/8/8/8/8/8/8/B3K3 w - - 0 1',
            expectedSan: 'Bh8',
            instruction: 'Move the Bishop all the way up the long diagonal to h8.',
            hints: [
              'The Bishop moves diagonally in a straight line.',
              'The long diagonal runs a1–b2–c3–d4–e5–f6–g7–h8, and it is completely clear.',
              'Drag the Bishop from a1 to h8.',
            ],
          },
          {
            slug: 'bishop-short',
            type: 'move',
            fen: '7k/8/8/8/8/8/8/2B1K3 w - - 0 1',
            expectedSan: 'Bh6',
            instruction: 'Move the Bishop from c1 up along the diagonal to h6.',
            hints: [
              'From c1 the Bishop travels up one diagonal.',
              'The squares are d2, e3, f4, g5 and finally h6.',
              'Drag the Bishop from c1 to h6.',
            ],
          },
          {
            slug: 'bishop-capture',
            type: 'move',
            fen: '7k/8/8/8/5n2/8/8/2B1K3 w - - 0 1',
            expectedSan: 'Bxf4',
            instruction: 'Capture the black Knight on f4 with your Bishop.',
            hints: [
              'The Bishop captures along its diagonal.',
              'From c1 the diagonal passes d2, e3 and reaches f4.',
              'Drag the Bishop from c1 onto the Knight at f4.',
            ],
          },
        ],
      },
      {
        slug: 'knight',
        title: 'The Knight',
        icon: '♞',
        kind: 'lesson',
        sections: [
          {
            heading: 'The tricky jumper',
            body: [
              'The Knight is the only piece that can jump over other pieces. It moves in an L-shape: two squares in one direction, then one square to the side.',
              'A knight always lands on the opposite colour square from where it started.',
              'Knights are worth 3 points. They are especially powerful in closed positions where long-range pieces have no room.',
            ],
          },
          {
            heading: 'The forking machine',
            body: [
              'Because a knight attacks squares far from its landing point, it can often attack two pieces at once — that is called a fork. The knight in the centre of the board is a dangerous tactician.',
            ],
          },
        ],
        tips: ['A knight on the rim (edge of the board) is dim — keep knights active in the centre.'],
        exercises: [
          {
            slug: 'knight-g1f3',
            type: 'move',
            fen: '7k/8/8/8/8/8/8/4K1N1 w - - 0 1',
            expectedSan: 'Nf3',
            instruction: 'Develop the Knight from g1 to f3.',
            hints: [
              'The Knight moves in an L-shape: 2 squares, then 1 square sideways.',
              'From g1, f3 is the most natural knight square.',
              'Drag the Knight from g1 to f3.',
            ],
          },
          {
            slug: 'knight-e5c6',
            type: 'move',
            fen: '7k/8/8/4N3/8/8/8/6K1 w - - 0 1',
            expectedSan: 'Nc6',
            instruction: 'Jump the Knight from e5 to c6.',
            hints: [
              'L-shape: two squares left and one square down.',
              'From e5, the c6 square is two files to the left and one rank down.',
              'Drag the Knight from e5 to c6.',
            ],
          },
          {
            slug: 'knight-capture',
            type: 'move',
            fen: '7k/8/8/3n4/1N6/8/8/6K1 w - - 0 1',
            expectedSan: 'Nxd5',
            instruction: 'The black Knight on d5 is defenseless bait. Capture it.',
            hints: [
              'The Knight captures on the square where it lands.',
              'From b4, d5 is two squares right and one square up.',
              'Drag the Knight from b4 onto the Knight at d5.',
            ],
          },
        ],
      },
      {
        slug: 'pawn',
        title: 'The Pawn',
        icon: '♟️',
        kind: 'lesson',
        sections: [
          {
            heading: 'The foot soldier',
            body: [
              'Pawns are worth 1 point each and there are eight of them. They move only forward — one square at a time when moving normally, though from their starting square they may advance two squares.',
              'Pawns capture diagonally. A pawn attacks the two diagonal squares in front of it.',
              'A pawn that reaches the far end of the board is promoted — usually to a queen. This makes pawns the only piece that can become stronger.',
            ],
          },
          {
            heading: 'Pawn chains and weak pawns',
            body: [
              'Pawns can never move backwards. That makes every pawn move permanent — push them with a plan. Pawns support each other by forming chains, and they strengthen your centre when placed on d4 and e4.',
            ],
          },
        ],
        tips: ['Pawns never move backwards — every push is permanent, so think before you push.'],
        exercises: [
          {
            slug: 'pawn-one',
            type: 'move',
            fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
            expectedSan: 'e3',
            instruction: 'Advance the pawn from e2 to e3.',
            hints: [
              'Pawns move straight forward one square.',
              'From e2 forward is e3.',
              'Drag the pawn from e2 to e3.',
            ],
          },
          {
            slug: 'pawn-two',
            type: 'move',
            fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
            expectedSan: 'e4',
            instruction: 'From its starting square, the pawn may move two squares. Push it from e2 to e4.',
            hints: [
              'On its first move a pawn may advance two squares.',
              'From e2, skip e3 and land on e4.',
              'Drag the pawn from e2 to e4.',
            ],
          },
          {
            slug: 'pawn-capture',
            type: 'move',
            fen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1',
            expectedSan: 'exd5',
            instruction: 'A pawn captures diagonally. Capture the black pawn on d5.',
            hints: [
              'Pawns capture diagonally, one square forward to the side.',
              'From e4, the diagonal forward-left lands on d5.',
              'Drag the pawn from e4 onto the pawn at d5.',
            ],
          },
          {
            slug: 'pawn-promote',
            type: 'move',
            fen: '8/4P3/7k/8/8/8/8/4K3 w - - 0 1',
            expectedSan: 'e8=Q',
            instruction: 'March the pawn to the eighth rank and promote it to a queen.',
            hints: [
              'A pawn reaching the last rank must be promoted.',
              'From e7, advance to e8.',
              'Drag the pawn from e7 to e8 and pick the Queen.',
            ],
          },
        ],
      },
      {
        slug: 'special-rules',
        title: 'Special Rules',
        icon: '⚔️',
        kind: 'lesson',
        sections: [
          {
            heading: 'Castling',
            body: [
              'Once per game, you may move the king two squares toward a rook and jump that rook over the king. Castling moves your king to safety and activates your rook at the same time.',
              'You may not castle if: either piece has moved, the king is in check, the king would pass through check, or the king would land in check.',
            ],
          },
          {
            heading: 'En passant',
            body: [
              'If a pawn advances two squares and lands beside one of your pawns, you may capture it as if it had moved only one square. That is called en passant (“in passing”) and must be done immediately.',
            ],
          },
          {
            heading: 'Promotion',
            body: [
              'When a pawn reaches the eighth rank it is promoted to a queen, rook, bishop or knight of the same colour. Players almost always choose a queen — the most powerful prize.',
            ],
          },
        ],
        tips: ['Castle early and often — usually before move 10. An uncastled king is a target.'],
        exercises: [
          {
            slug: 'castle-king',
            type: 'move',
            fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
            expectedSan: 'O-O',
            instruction: 'Castle kingside: move the King two squares toward the Rook on h1.',
            hints: [
              'Keep your king safe — castle it to the kingside.',
              'The king moves two squares to g1 and the rook jumps to f1.',
              'Drag the King from e1 to g1 (the rook will follow automatically).',
            ],
          },
          {
            slug: 'castle-queen',
            type: 'move',
            fen: '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1',
            expectedSan: 'O-O-O',
            instruction: 'Castle queenside: move the King two squares toward the Rook on a1.',
            hints: [
              'Queenside castling works the same way as kingside.',
              'The king moves two squares to c1 and the rook jumps to d1.',
              'Drag the King from e1 to c1 (the rook will follow automatically).',
            ],
          },
          {
            slug: 'en-passant',
            type: 'move',
            fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
            expectedSan: 'exd6',
            instruction: 'Black just pushed d7–d5 past your pawn on e5. Capture it en passant with e×d6.',
            hints: [
              'When a pawn slips past you with a double move, you may capture it en passant.',
              'Your pawn captures diagonally onto d6, the square behind Black’s pawn.',
              'Drag the pawn from e5 to d6.',
            ],
          },
        ],
      },
      {
        slug: 'check',
        title: 'Check',
        icon: '⚠️',
        kind: 'lesson',
        sections: [
          {
            heading: 'Attacking the king',
            body: [
              'When a piece attacks the enemy king, the king is in check. Check must ALWAYS be answered — a player is never allowed to ignore a check.',
              'There are three ways to escape check: move the king away, block the attack with another piece, or capture the attacking piece.',
            ],
          },
          {
            heading: 'Check is not checkmate',
            body: [
              'Check simply means the enemy king must respond. If there is no legal way to answer the check, the game is over — that is checkmate, and the checked side loses.',
            ],
          },
        ],
        tips: ['Every check lies, but you must still answer it. Look for checks that win material (a check and a fork).'],
        exercises: [
          {
            slug: 'check-queen',
            type: 'move',
            fen: '7k/8/8/8/8/8/8/3QK3 w - - 0 1',
            expectedSan: 'Qh5+',
            instruction: 'Deliver check to the black King using your Queen.',
            hints: [
              'A check is an attack on the enemy king.',
              'The Queen gives check on the diagonals facing h8.',
              'Drag the Queen from d1 to h5 — h8 is on that diagonal.',
            ],
          },
          {
            slug: 'check-answer',
            type: 'quiz',
            question: 'Your King is in check. Which is NOT a way to escape check?',
            options: [
              'Move the king to safety',
              'Capture the attacking piece',
              'Block the attack with another piece',
              'Simply ignore it and play on',
            ],
            correct: 3,
            explanation:
              'A king in check MUST be answered. Ignoring the check is illegal — and in a real game you would have to take the move back.',
          },
        ],
      },
      {
        slug: 'checkmate',
        title: 'Checkmate',
        icon: '🏁',
        kind: 'lesson',
        sections: [
          {
            heading: 'The goal of the game',
            body: [
              'Checkmate happens when the enemy king is in check and has no legal way to escape. The game ends immediately — the checkmated player loses.',
              'You win by trapping the king, not by capturing it. The king is never actually taken: checkmate ends the game first.',
            ],
          },
          {
            heading: 'Simple checkmates',
            body: [
              'With more material you can force checkmate. Common patterns include the back-rank mate, the queen-and-rook ladder, and mate with a queen and king.',
            ],
          },
        ],
        tips: ['The back rank is a classic trap: a castled king can be mated by a rook or queen on the 8th rank.'],
        exercises: [
          {
            slug: 'mate-back-rank',
            type: 'quiz',
            question: 'Black has just played …f7–f6, weakening the 8th rank. White can mate in one. Which move is checkmate?',
            options: ['Rd1–xd7', 'Ra8#', 'Qh5', 'Be7'],
            correct: 1,
            explanation:
              'Ra8# is checkmate — the black king on e8 cannot escape along the back rank, and it cannot capture the rook since the black king cannot move to the rook’s square (the queen on d7 guards it, and Black blocked his own escape square).',
          },
          {
            slug: 'mate-scholar',
            type: 'quiz',
            question: 'This is the famous Scholar’s Mate pattern. What is the checkmating move?',
            options: ['Qh5', 'Qxf7#', 'Bc4', 'Qe2'],
            correct: 1,
            explanation:
              'Qxf7# checks the black king on e8 along the a2–g8 diagonal and the f-file at once. The king cannot capture the queen (the bishop on c4 protects f7) and has no escape square — game over.',
          },
        ],
      },
      {
        slug: 'draw',
        title: 'Draws',
        icon: '🤝',
        kind: 'lesson',
        sections: [
          {
            heading: 'How a game can end without a winner',
            body: [
              'Not every game ends in checkmate. A game is drawn when there is no way for either side to win. Common draws are:',
              '• Stalemate — the side to move is not in check but has no legal move.',
              '• Insufficient material — neither side can checkmate (e.g. king vs king).',
              '• Threefold repetition — the same position occurs three times.',
              '• The 50-move rule — 50 moves pass with no capture or pawn move.',
              '• Agreement — both players agree to a draw.',
            ],
          },
          {
            heading: 'Stalemate traps',
            body: [
              'Stalemate is a common trap for beginners: a player with a huge material advantage can accidentally stalemate the opponent, turning a sure win into a draw. Always check the opponent’s legal moves before delivering a final attack.',
            ],
          },
        ],
        tips: ['When you are winning by a lot, watch for stalemate — leave the enemy king at least one legal move before you mate it.'],
        exercises: [
          {
            slug: 'draw-stalemate',
            type: 'quiz',
            question: 'White has an overwhelming material advantage but just played a terrible move. Black is not in check but has no legal moves. The result is…',
            options: ['Checkmate — White wins', 'Draw — stalemate', 'Black wins', 'The game continues'],
            correct: 1,
            explanation:
              'That is stalemate — Black has no legal moves but is not in check. The game is an immediate draw, and White’s winning position has evaporated.',
          },
          {
            slug: 'draw-material',
            type: 'quiz',
            question: 'The position is King vs King with a few pawns that cannot move. Which outcome is guaranteed?',
            options: ['White wins', 'Black wins', 'Draw by insufficient material', 'Checkmate is forced'],
            correct: 2,
            explanation:
              'With only bare kings the game is drawn — neither side possesses enough material to checkmate the other.',
          },
        ],
      },
      {
        slug: 'training',
        title: 'Beginner Training',
        icon: '🔥',
        kind: 'training',
        sections: [
          {
            heading: 'Prove what you’ve learned',
            body: [
              'This is your Beginner exam. You will face 12 random challenges covering every piece, special rule, check, checkmate and draw concept you just studied.',
              'Answer at least 70% correctly to pass. Every correct answer earns XP and brings you one step closer to unlocking the Intermediate level.',
            ],
          },
          {
            heading: 'How it works',
            body: [
              'Each challenge shows a position and asks you to make a specific move. Use the board below — drag a piece or tap it and then tap the destination. Hints cost XP but are never penalised for your completion.',
              'Missed exercises will be repeated at the end, so you leave confident, not confused.',
            ],
          },
        ],
        pool: [
          { slug: 'tr-king-step', type: 'move', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', expectedSan: 'Ke2', instruction: 'Move the King forward one square to e2.' },
          { slug: 'tr-king-diag', type: 'move', fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', expectedSan: 'Kd1', instruction: 'Move the King diagonally to d1.' },
          { slug: 'tr-king-capture', type: 'move', fen: '4k3/8/8/8/8/8/8/3bK3 w - - 0 1', expectedSan: 'Kxd1', instruction: 'Capture the Bishop with the King.' },
          { slug: 'tr-castle-king', type: 'move', fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1', expectedSan: 'O-O', instruction: 'Castle kingside.' },
          { slug: 'tr-castle-queen', type: 'move', fen: '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', expectedSan: 'O-O-O', instruction: 'Castle queenside.' },
          { slug: 'tr-en-passant', type: 'move', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', expectedSan: 'exd6', instruction: 'Capture en passant with e5 × d6.' },
          { slug: 'tr-queen-file', type: 'move', fen: '7k/q7/8/8/8/8/8/3QK3 w - - 0 1', expectedSan: 'Qd7', instruction: 'Move the Queen up the file to d7.' },
          { slug: 'tr-queen-capture', type: 'move', fen: 'k7/8/8/7n/8/8/8/3QK3 w - - 0 1', expectedSan: 'Qxh5', instruction: 'Capture the Knight on h5.' },
          { slug: 'tr-rook-capture', type: 'move', fen: '7k/p7/8/8/8/8/8/R3K3 w - - 0 1', expectedSan: 'Rxa7', instruction: 'Capture the pawn on a7.' },
          { slug: 'tr-bishop-diag', type: 'move', fen: '2k5/8/8/8/8/8/8/B3K3 w - - 0 1', expectedSan: 'Bh8', instruction: 'Move the Bishop up the long diagonal to h8.' },
          { slug: 'tr-knight-capture', type: 'move', fen: '7k/8/8/3n4/1N6/8/8/6K1 w - - 0 1', expectedSan: 'Nxd5', instruction: 'Capture the Knight on d5.' },
          { slug: 'tr-pawn-double', type: 'move', fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', expectedSan: 'e4', instruction: 'Push the pawn two squares to e4.' },
          { slug: 'tr-pawn-capture', type: 'move', fen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', expectedSan: 'exd5', instruction: 'Capture the pawn on d5.' },
          { slug: 'tr-pawn-promote', type: 'move', fen: '8/4P3/7k/8/8/8/8/4K3 w - - 0 1', expectedSan: 'e8=Q', instruction: 'Promote the pawn to a Queen.' },
          { slug: 'tr-give-check', type: 'move', fen: '7k/8/8/8/8/8/8/3QK3 w - - 0 1', expectedSan: 'Qh5+', instruction: 'Give check with the Queen on h5.' },
          { slug: 'tr-escape-check', type: 'move', fen: '4r2k/8/8/8/8/8/8/4K3 w - - 0 1', expectedSan: 'Kd1', instruction: 'Escape the check by moving to d1.' },
        ],
      },
    ],
  },
  {
    slug: 'intermediate',
    name: 'Intermediate',
    tagline: 'Openings & principles',
    icon: '⚔️',
    accent: '#FFB300',
    description:
      'Review the fundamentals, learn the golden principles of the opening, then study three powerful White openings move by move — and prove your knowledge in practice and a final quiz.',
    unlockAfter: 80,
    lessons: [
      {
        slug: 'opening-principles',
        title: 'Opening Principles',
        icon: '📜',
        kind: 'lesson',
        sections: [
          {
            heading: 'The three golden rules',
            body: [
              'The opening is the first ten moves. Follow three golden rules and you will reach the middlegame with a good position every time:',
              '1. Control the centre — fight for the central squares d4, e4, d5 and e5 with your pawns and pieces.',
              '2. Develop your pieces — bring your knights and bishops toward the centre before your queen and rooks.',
              '3. Castle early — move your king to safety within the first ten moves.',
            ],
          },
          {
            heading: 'Don’t break the rules',
            body: [
              'Avoid moving the same piece twice, avoid moving the queen too early, and do not waste time grabbing pawns with your king or queen while your pieces sleep on their starting squares. Development is speed.',
            ],
          },
        ],
        tips: ['A rule of thumb: you want at least one pawn on d4 or e4, both knights and both bishops out, and your king castled by move ten.'],
        exercises: [
          {
            slug: 'open-better',
            type: 'quiz',
            question: 'White has played 1.e4. Black replies 1…e5. What is White’s most principled developing move?',
            options: ['Nf3', 'Qh5', 'h4', 'a3'],
            correct: 0,
            explanation:
              'Nf3 develops a knight toward the centre and attacks e5. Developing pieces is the top priority — Qh5 brings the queen out too early and can invite attack.',
          },
          {
            slug: 'open-avoid',
            type: 'quiz',
            question: 'Which of these is a mistake in the opening?',
            options: [
              'Developing knights before bishops',
              'Moving the same piece several times',
              'Castling by move ten',
              'Fighting for the centre with pawns',
            ],
            correct: 1,
            explanation:
              'Moving the same piece again while other pieces are still undeveloped wastes time. Each move should improve a new piece or strengthen your position.',
          },
        ],
      },
      { slug: 'italian', title: 'Italian Game', icon: '♞', kind: 'opening', openingSlug: 'italian-game-giuoco-piano' },
      { slug: 'queens-gambit', title: 'Queen’s Gambit', icon: '♛', kind: 'opening', openingSlug: 'queens-gambit' },
      { slug: 'london', title: 'London System', icon: '♚', kind: 'opening', openingSlug: 'london-system' },
      {
        slug: 'practice',
        title: 'Opening Practice',
        icon: '🎯',
        kind: 'training',
        sections: [
          {
            heading: 'Repertoire training',
            body: [
              'Your mission: play the main line of every Intermediate opening from memory. Each correct try locks a move into your memory and earns XP.',
              'Пractice the Italian Game, Queen’s Gambit and London System until each move comes automatically.',
            ],
          },
        ],
        pool: [],
      },
      {
        slug: 'quiz',
        title: 'Intermediate Quiz',
        icon: '📝',
        kind: 'lesson',
        sections: [
          {
            heading: 'Exam time',
            body: [
              'A final check on your understanding of the opening principles and the lines you studied in this level.',
            ],
          },
        ],
        exercises: [
          {
            slug: 'int-q1',
            type: 'quiz',
            question: 'The Italian Game begins 1.e4 e5 2.Nf3 Nc6. Which move develops the bishop to its best square?',
            options: ['Bc4', 'Be2', 'Bg5', 'Bb5'],
            correct: 0,
            explanation: 'Bc4 develops the bishop to its most active square and eyes the weak f7 square.',
          },
          {
            slug: 'int-q2',
            type: 'quiz',
            question: 'The Queen’s Gambit is a gambit because…',
            options: [
              'Black must accept the pawn',
              'White offers the c4-pawn, which Black may or may not take',
              'Black sacrifices a rook',
              'White gives up a bishop for free',
            ],
            correct: 1,
            explanation:
              'White offers the c4-pawn. If Black grabs it (the Queen’s Gambit Accepted), White gains central control; Black can also decline with e6 or c6.',
          },
          {
            slug: 'int-q3',
            type: 'quiz',
            question: 'A hallmark of the London System is that White…',
            options: [
              'Attacks with the queen early',
              'Develops the dark-squared bishop to f4 regardless of Black’s setup',
              'Castles queenside every game',
              'Sacrifices the f-pawn',
            ],
            correct: 1,
            explanation: 'The London is a system — White plays the same few moves (d4, Bf4, e3, Nf3, Bd3) against almost anything Black tries.',
          },
        ],
      },
    ],
  },
  {
    slug: 'advanced',
    name: 'Advanced',
    tagline: 'Master your repertoire',
    icon: '🏆',
    accent: '#7B1FA2',
    description:
      'Master the fundamental strategic ideas behind your openings, then build a full Black repertoire against 1.e4 and 1.d4 — and finish with an expert-level exam.',
    unlockAfter: 80,
    lessons: [
      {
        slug: 'advanced-strategy',
        title: 'Mastering Your Opening',
        icon: '🧠',
        kind: 'lesson',
        sections: [
          {
            heading: 'Ideas over moves',
            body: [
              'By the advanced level you should not be reciting moves — you should be playing ideas. Every opening has typical plans: pawn breaks, piece placement, and middlegame targets.',
              'Your repertoire is a toolbox. Study why each move is played, not just what the next move is.',
            ],
          },
          {
            heading: 'Handling variations',
            body: [
              'Opponents will not always play the main line. Learn the most critical deviations and have a principled response ready — curiosity and flexibility beat memorisation.',
            ],
          },
        ],
        tips: ['Ask “why” for every move in your repertoire. When you understand the plan, the exact order matters less.'],
        exercises: [
          {
            slug: 'adv-plan',
            type: 'quiz',
            question: 'Your opening choices should be guided first by…',
            options: [
              'Understanding the typical plans and middlegame targets',
              'Memorising 30 moves of theory',
              'Copying the highest-rated player’s database',
              'Choosing based only on the opponent’s rating',
            ],
            correct: 0,
            explanation: 'Variations are forgettable, but ideas last. Know your plans and your repertoire becomes resilient.',
          },
        ],
      },
      { slug: 'sicilian', title: 'Sicilian Defense (Najdorf)', icon: '♞', kind: 'opening', openingSlug: 'sicilian-najdorf' },
      { slug: 'caro-kann', title: 'Caro-Kann Defense', icon: '♛', kind: 'opening', openingSlug: 'caro-kann-defense' },
      { slug: 'kings-indian', title: 'King’s Indian Defense', icon: '♜', kind: 'opening', openingSlug: 'kings-indian-defense' },
      {
        slug: 'repertoire',
        title: 'Repertoire Training',
        icon: '🎯',
        kind: 'training',
        sections: [
          {
            heading: 'Master your full repertoire',
            body: [
              'Play the main line of every Advanced opening from memory — the Najdorf, the Caro-Kann and the King’s Indian. Accuracy is the enemy of randomness.',
            ],
          },
        ],
        pool: [],
      },
      {
        slug: 'exam',
        title: 'Advanced Exam',
        icon: '🏆',
        kind: 'lesson',
        sections: [
          {
            heading: 'The final test',
            body: [
              'Three questions cover the ideas behind your advanced repertoire. Score 100% to earn the Chess Opening Master badge.',
            ],
          },
        ],
        exercises: [
          {
            slug: 'adv-x1',
            type: 'quiz',
            question: 'The defining plan in the Najdorf Sicilian is Black’s …e5 break. What does this break do?',
            options: [
              'Gives Black a central pawn majority and fights for the centre',
              'Weakens Black’s kingside permanently',
              'Forces an immediate exchange of queens',
              'Loses for Black by force',
            ],
            correct: 0,
            explanation: '…e5 challenges White’s e4- and d4-pawns and is the signature pawn break of the Najdorf.',
          },
          {
            slug: 'adv-x2',
            type: 'quiz',
            question: 'A hallmark move of the Caro-Kann is Black’s second move 2…d5. What is its main idea?',
            options: [
              'Challenge the center immediately with the c6 then d5 pawn structure',
              'Trade the bishop outside the pawn chain',
              'Attack the g2 pawn',
              'Develop the queen on the fifth rank',
            ],
            correct: 0,
            explanation:
              'Black prepares d7–d5, and when White plays e5 the typical idea is to develop the c8-bishop to f5 BEFORE playing e6 — avoiding the “bad bishop” of the French Defense.',
          },
          {
            slug: 'adv-x3',
            type: 'quiz',
            question: 'In the King’s Indian Defense, Black’s typical kingside plan is…',
            options: [
              '…f5 or …g5–…h6–…g4 attacking White’s king',
              'Rushing the queen out to h4 on move two',
              'Trading queens immediately',
              'Advancing the a-pawn to a3',
            ],
            correct: 0,
            explanation:
              'Black builds a big kingside attack with pawns on f5/g5 and pieces bearing down on White’s castled king — while White counters on the queenside.',
          },
        ],
      },
    ],
  },
];

/* ── Lesson exercise shape ──────────────────────────────────────────────────
 * Every lesson is capped at MAX_EXERCISES, with at most 10% multiple-choice
 * questions. The generated packs already apply this rule, but the hand-authored
 * exercises in academyCurriculum.js are concatenated ON TOP of them, which is
 * what pushed a lesson to 34 — so the cap has to be enforced here too, on the
 * merged list, or the UI and the progress maths would disagree.
 *
 * Kept in sync with generate_academy_exercises.js, which owns the same rule for
 * the generated half. */
const MAX_EXERCISES = 30;
const MAX_QUIZ_RATIO = 0.1;

/** Which exercises belong to each lesson (computed helper). */
function lessonExercises(lesson) {
  if (lesson.kind === 'training') return (lesson.pool || []).slice(0, MAX_EXERCISES);
  const authored = lesson.exercises || [];
  // Machine-generated drill pack for this lesson (verified with chess.js).
  // Appended AFTER the curated ones so hand-authored exercises keep priority.
  const generated = PACKS[lesson.slug] || [];
  const all = authored.concat(generated);
  /* The early return must ALSO check the quiz quota, not just the total. A
     lesson can sit under 30 and still be 19% questions, which is what pushed
     Checkmate past the 10% rule. */
  const quizCap = Math.max(1, Math.ceil(MAX_EXERCISES * MAX_QUIZ_RATIO));
  const allQuiz = all.filter((e) => e.type === 'quiz');
  if (all.length <= MAX_EXERCISES && allQuiz.length <= quizCap) return all;

  const board = all.filter((e) => e.type === 'move');
  const quiz = allQuiz;
  const other = all.filter((e) => e.type !== 'move' && e.type !== 'quiz');

  // Round the quota UP so a lesson keeps a couple of concept questions rather
  // than losing them entirely; the quota is a ceiling, not a target.
  const keptQuiz = quiz.slice(0, quizCap);
  const keptBoard = board.slice(0, MAX_EXERCISES - keptQuiz.length);
  const keptOther = other.slice(0, Math.max(0, MAX_EXERCISES - keptBoard.length - keptQuiz.length));
  return keptBoard.concat(keptQuiz, keptOther);
}

module.exports = {
  LEVELS,
  lessonExercises,
};