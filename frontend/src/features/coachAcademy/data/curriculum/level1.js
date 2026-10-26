/**
 * Level 1 — Chess Coach Foundation.
 *
 * Deliberately the most detailed level in the file set. It sets the depth
 * standard for everything after it, and it is the level where vague teaching
 * does the most damage, so the coaching-method fields carry real content
 * rather than placeholders.
 */
export default {
  n: 1,
  id: 'level-1',
  title: 'Chess Coach Foundation',
  tagline: 'Rules you can state without hesitating.',
  description:
    'The absolute foundation. A coach cannot teach what they cannot state fluently, so this level is about precise language and demonstration before any theory.',
  finalTask: 'Explain chess fundamentals as if teaching a complete beginner.',
  finalExam: { title: 'Level 1 Final Exam', passMark: 80, sections: ['theory', 'teaching', 'board'] },
  competency: ['Chess Knowledge', 'Teaching Clarity'],
  modules: [
    {
      id: 'l1-m1',
      title: 'The Rules of Chess',
      description: 'Everything the referee enforces. Get the language exact and the rest of coaching becomes easy.',
      topics: [
        {
          id: 'l1-rules',
          name: 'Complete Chess Rules',
          summary: 'The whole game in one page — and the three ways a game can end.',
          content: {
            definition:
              'Chess is a two-player game on an 8x8 board. Each player begins with 16 pieces: one king, one queen, two rooks, two bishops, two knights and eight pawns. Players alternate moves, white first. A move is one piece to a legal destination. The player who checkmates the opponent king wins.',
            deep:
              'The important part for a coach is the order of priorities. Overriding the move you want is more important than taking material, and more important than saving a piece: 1) you may not move into check, 2) you must respond to check, 3) an attacked piece is only captured if it is actually attacked, and only when that capture is legal. Most beginner games are decided by breaking rule 2 or by misreading rule 3, so those two deserve the most drill time.',
            why: 'Every position a coach will ever explain rests on this order. A student who has not internalised "the king can never be captured, only attacked" will produce illegal plans for months.',
            when: 'Always. This is the floor, not an option.',
            whenNot:
              'Never skip it because a student "seems to know it" — ask them to state en passant out loud without looking at a board. The gap is almost always there.',
            coachMethod:
              'Teach it as three questions the student asks themselves before every move, in this order: Is my king safe? What is attacking me? What is attacking them? Do not use notation until they can answer all three in words. Use a physical board for castling and promotion, because those two are physical acts, not abstract rules.',
            example: {
              student: 'So I can take his queen with my bishop?',
              coach:
                'Only after you check that your own king is safe. Show me on the board: if you take that queen, what attacks your king? Let us look at what happens three moves later, not just one.',
            },
            realGame:
              'Even at club level you see a beginner lose a won position by ignoring a check. Point them at their own games and mark every move that left a piece attacked.',
          },
          mistakes: [
            'Thinking a piece is "attacked" means it must be captured.',
            'Believing the king itself can be captured.',
            'Forgetting that a game can end by resignation or timeout, not only checkmate.',
          ],
          board: {
            fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            caption: 'The starting position. Name all 32 pieces before you teach anything else.',
            highlight: ['e1', 'e2', 'd1'],
            arrows: [],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
              prompt: 'White to move. Which three questions does a beginner ask before every move?',
              solution:
                '1) Is my king safe? 2) What is attacking me? 3) What is attacking them? Answer in that order every time.',
              hint: 'Order matters. Safety first, defence second, attack third.',
            },
          ],
          teachBack: {
            brief:
              'Teach a complete beginner how a chess game begins and ends. Assume they know nothing and have never held the pieces.',
            required: [
              'how the board and pieces are set up',
              'that players alternate moves and white moves first',
              'that the king is attacked, not captured',
              'the three ways a game ends',
            ],
            lookFor: [
              'uses "check" and "checkmate" as different things',
              'mentions draw rules at least in passing',
              'checks the student understands rather than reciting',
            ],
          },
          misconception: 'The student believes the opponent can capture the king, and that the game ends as soon as the king is taken.',
          puzzlePrompt:
            'Build a two-move puzzle where a beginner\'s natural move loses to check they did not see.',
          test: [
            {
              q: 'A king is under attack. What must the player do?',
              options: ['Capture the attacker if possible', 'Move the king or block or capture the checker', 'Nothing — it is only a warning', 'Trade pieces to compensate'],
              answer: 1,
              explain: 'Check must always be answered immediately. Every legal answer is one of: move the king, capture the checker, or block the line.',
            },
            {
              q: 'Which of these can end a game?',
              options: ['Only checkmate', 'Resignation, timeout or checkmate', 'Only resignation', 'Only stalemate'],
              answer: 1,
              explain: 'Three endings: checkmate, resignation (or timeout, which is a resignation by the clock), and a draw by agreement or rule.',
            },
          ],
        },
        {
          id: 'l1-coords',
          name: 'Board Coordinates',
          summary: 'Algebraic squares, ranks and files, so you can point and speak at once.',
          content: {
            definition:
              'Every square has a name: a file letter from a to h running left to right for White, and a rank number from 1 to 8 running from White\'s side upward. So e4 is the square on the e-file, 4th rank. Files are columns, ranks are rows.',
            deep:
              'Two details matter more than they look. First, White always views the board with rank 1 at the bottom, so the coordinates never change even when the board is flipped. Second, the bottom-left square from White\'s view is a dark square, which lets a student find "the colour of a square" without looking: if the file letter and rank number add up to an odd total, the square is dark.',
            why: 'You cannot coach fluently if you have to point and describe instead of naming. Saying "knight to f3" instead of "the horse over there" is the single biggest upgrade to a beginner\'s board reading.',
            when: 'From the very first lesson, every lesson, always.',
            whenNot: 'Do not drill coordinates in isolation for more than a few minutes. It is a tool, not a skill to admire.',
            coachMethod:
              'Use three anchors and build from them: a4, e1 and h8. Then test speed with knight jumps — "white knight on c3 to b5" — because that trains the shape as well as the name. Avoid coordinate chess drills as the main exercise; they build notation fluency without any chess understanding.',
            example: {
              student: 'Which square is a light square?',
              coach:
                'Good — instead of looking, work it out. The letter and the number: does a4 add up odd or even? Once you have that rule you never have to look again.',
            },
            realGame:
              'Notation is how a coach writes homework. Everything from "put the rook on f1" to "why did you play h4 here?" uses it.',
          },
          mistakes: [
            'Saying "the square in front of the bishop" instead of naming the square.',
            'Forgetting that coordinates are always from White\'s view even when the board is flipped.',
            'Getting the colour rule backwards on the very first square.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/8/RNBQKBNR w KQ - 0 1',
            caption: 'White\'s back rank, with Black\'s king on e8. Ranks read 1 to 8 from the bottom for White.',
            highlight: ['a1', 'h1', 'a8', 'h8'],
            arrows: [['e1', 'e4']],
          },
          practice: [
            {
              fen: '4k3/8/8/3N4/8/8/8/4K3 w - - 0 1',
              prompt: 'Name the square the white knight stands on, then name a square it can reach in one move.',
              solution:
                'The knight is on d5. From d5 it can reach b4, b6, c3, c7, e3, e7, f4 and f6 — eight options, which is the point: knights are hard to block and easy to overlook.',
              hint: 'A knight moves 2 in one direction then 1 across the other.',
            },
          ],
          teachBack: {
            brief: 'Teach a beginner the coordinate system and prove they can use it without pointing.',
            required: [
              'files are letters, ranks are numbers',
              'coordinates are always from White\'s point of view',
              'how to tell a dark square from a light square',
            ],
            lookFor: [
              'makes the student name squares back rather than just listen',
              'uses a knight jump as a speed drill',
            ],
          },
          misconception: 'The student thinks coordinates change when the board is flipped, or that you must look at the physical board to check a square colour.',
          puzzlePrompt: 'Create a "find the square" drill for a beginner and write the answer key in coordinates.',
          test: [
            {
              q: 'Which square is a dark square?',
              options: ['h1 (9)', 'a2 (3)', 'e4 (9)', 'All three are dark'],
              answer: 2,
              explain: 'Letter index plus rank: odd total means dark. h1=9, a2=3, e4=9, so e4 is dark and the others are light.',
            },
            {
              q: 'How do you name the square the black king starts on?',
              options: ['e8, always, regardless of who is looking', 'It depends on the board orientation', 'e1', 'd8'],
              answer: 0,
              explain: 'Coordinates are fixed from White\'s view. Flipping the board does not rename anything.',
            },
          ],
        },
        {
          id: 'l1-movement',
          name: 'Piece Movement',
          summary: 'What each piece can do, and the one rule that explains all of them.',
          content: {
            definition:
              'Each piece moves in a fixed way and any number of empty squares: the king one square in any direction, the queen any distance in any straight line or diagonal, the rook straight lines, the bishop diagonals only, the knight in an L shape (two squares then one), and a pawn one square forward, or two from its starting square.',
            deep:
              'A single rule organises the whole set: the knight is the only piece that jumps over other pieces, and it is the only one whose movement is not a straight or diagonal line. Tell a beginner that and they can derive the rest themselves. Then add the one exception to the "sliding" family: a rook, bishop or queen cannot move through a friendly piece but does capture the first enemy piece in its path.',
            why: 'Movement errors are not random — they almost always come from a student applying the wrong piece\'s rules under pressure. Naming the error precisely ("you moved the bishop like a queen") fixes it faster than saying "that is wrong".',
            when: 'Immediately, using the starting position and one puzzle per piece.',
            whenNot: 'Do not spend a whole lesson on movement with no purpose. Each rule should be introduced with a position where it matters.',
            coachMethod:
              'Move the piece on the board while you talk, and make the student move it back. Physical confirmation beats verbal repetition every time. Then test with "which piece can do this?" rather than "how does this piece move?" — the first is application, the second is recall.',
            example: {
              student: 'Can my rook go through my own bishop?',
              coach:
                'No. Nothing slides through anything. Now what happens if the bishop is an enemy piece on that same square? Different rule — say it out loud.',
            },
            realGame:
              'Almost every lost beginner game contains at least one movement error, usually a blocked rook or a diagonal bishop that was not on a diagonal at all.',
          },
          mistakes: [
            'Moving a rook or bishop as if it could jump.',
            'Letting a pawn move sideways.',
            'Forgetting a piece cannot pass through another piece.',
          ],
          board: {
            fen: '4k3/8/8/3N4/8/8/8/4K3 w - - 0 1',
            caption: 'From d5 the knight reaches eight squares and jumps over anything in between.',
            highlight: ['d5', 'b4', 'b6', 'c3', 'c7', 'e3', 'e7', 'f4', 'f6'],
            arrows: [['d5', 'f6'], ['d5', 'c7']],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/5N2/8/4K3 w - - 0 1',
              prompt: 'Name every square the white knight on f3 attacks.',
              solution:
                'From f3: d2, d4, e1, e5, g1, g5, h2, h4 — eight squares. If a student says fewer than eight, ask them to check for the ones behind the piece.',
              hint: 'Trace an L in all four orientations.',
            },
          ],
          teachBack: {
            brief: 'Teach piece movement to a beginner using one position and no rule list memorisation.',
            required: [
              'the movement rule for all six piece types',
              'that the knight is the only jumping piece',
              'that sliding pieces cannot pass through anything',
            ],
            lookFor: [
              'uses the knight rule to let the student derive the rest',
              'has the student demonstrate, not just watch',
            ],
          },
          misconception: 'The student believes a bishop can move along a rank or a rook along a diagonal.',
          puzzlePrompt: 'Create a "which piece can do this?" drill with six positions of increasing difficulty.',
          test: [
            {
              q: 'Which piece can jump over other pieces?',
              options: ['Bishop', 'Rook', 'Knight', 'Queen'],
              answer: 2,
              explain: 'Only the knight changes direction mid-move, which is exactly why it can jump.',
            },
            {
              q: 'A bishop on a1 wants to reach h8. What is in the way?',
              options: ['Nothing — a1 to h8 is a diagonal', 'Any piece on the a1-h8 diagonal', 'Any piece anywhere on the board', 'The bishop cannot move at all from a1'],
              answer: 1,
              explain: 'a1 to h8 is the long diagonal, so every square on it must be empty.',
            },
          ],
        },
        {
          id: 'l1-values',
          name: 'Piece Values',
          summary: 'Rough worth, why it is only rough, and what the exchange rule really is.',
          content: {
            definition:
              'A rough material scale: pawn 1, knight and bishop about 3, rook about 5, queen about 9. The exchange rule: it is usually good to trade a knight for a bishop, because bishops are worth slightly more, so the side that is up a bishop for a knight is, very slightly, ahead.',
            deep:
              'The coach\'s job is to stop students treating these as prices. The bishop pair (two bishops) is worth more than the sum of its parts; a knight pair can be worth more than a bishop pair in practice; two knights can be stronger than a bishop and a knight in the endgame and weaker in the middlegame. So the numbers are a starting point for counting, not a verdict. What the numbers are genuinely good for is deciding whether a capture is worth taking material to reach.',
            why: 'Students who do not count cannot evaluate trades, cannot see when a capture is too expensive, and cannot tell a blunder from a necessary sacrifice.',
            when: 'Introduce immediately, but always alongside "count it and then look for a reason the count could be wrong".',
            whenNot: 'Never let a student quote the numbers as if they settle a position. Ask "is the count the reason, or is there a reason behind the count?"',
            coachMethod:
              'Show a real trade: have the student count material before and after and say which side is ahead and by how much. Then find a position where the count says one thing and the position says another, and discuss it. That second part is what turns a number into judgement.',
            example: {
              student: 'So I should always take with the bishop?',
              coach:
                'Take if it is free. But if taking costs you your knight and the square — no. The number tells you what you gained. It does not tell you what you lost.',
            },
            realGame:
              'You will see strong players happily give up a bishop for two pawns when it opens the king. Ask the student to find the real reason behind the trade.',
          },
          mistakes: [
            'Taking a pawn because it is free when it exposes the king.',
            'Refusing a trade because it "loses half a point" of material when position is much better for the trade.',
            'Counting the pieces in front of the board instead of on it.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/4P3/R3K3 w - - 0 1',
            caption: 'Rook plus pawn against a bare king: material says winning, but check the king safety first.',
            highlight: ['a1', 'e2'],
            arrows: [],
          },
          practice: [
            {
              fen: '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1',
              prompt: 'White is up a rook for a queen. Count the material and say whether White should trade on d1.',
              solution:
                'White is massively ahead (rook 5 vs queen 9 is actually the only material, so the position is balanced on count), but the queen is loose on d5. White should play Rxd5 — not because of the count but because the queen is free.',
              hint: 'Do the count second. Ask what is free first.',
            },
          ],
          teachBack: {
            brief: 'Teach material counting, then immediately teach why counting is not the same as evaluating.',
            required: [
              'the rough scale for pawn through queen',
              'the exchange rule and its limits',
              'the bishop pair exception',
            ],
            lookFor: [
              'separates "what I gained" from "what it cost me"',
              'uses a real position rather than an abstract list',
            ],
          },
          misconception: 'The student believes piece values are exact prices and that any trade which wins material is therefore correct.',
          puzzlePrompt: 'Create a "count the material" worksheet with one position where the count misleads.',
          test: [
            {
              q: 'Rough value of a queen?',
              options: ['About 5', 'About 9', 'About 3', 'About 12'],
              answer: 1,
              explain: 'Roughly 9, which is why giving a queen for anything under about 9 is usually a mistake — unless you have a very concrete reason.',
            },
            {
              q: 'Why is the exchange rule only an approximation?',
              options: ['It is exact', 'Because the bishop pair and position make bishops worth more than knights', 'Because pawns are worth more', 'Because it only applies to openings'],
              answer: 1,
              explain: 'Bishops are marginally more flexible than knights, which is the whole basis — and that flexibility is position-dependent.',
            },
          ],
        },
        {
          id: 'l1-check',
          name: 'Check',
          summary: 'What check is, what it demands, and how to give it on purpose.',
          content: {
            definition:
              'Check is when a king is attacked by at least one enemy piece. The side whose king is in check must respond immediately, in exactly one of three ways: move the king, capture the attacking piece, or block the attack.',
            deep:
              'A check is a forcing move — the opponent has no choice, which makes it the strongest tool in chess for buying time. That is the lesson beneath the rule. Once a student understands that check forces a reply, check becomes something they use to disrupt a plan rather than something they play at the end of a combination. Note also that giving check does not mean you are attacking the king\'s life; it means you are attacking the king\'s safety, and every reply is legal, so a check can itself be a blunder if the reply is trivially good.',
            why: 'Check is how a weak player stops a plan, gains a tempo, and simplifies. It is also how students lose games by giving check without seeing the reply.',
            when: 'Every turn, as part of the "is anything attacking anything" scan. Deliberately when you need the opponent to spend a tempo.',
            whenNot: 'Never as a reflex. Ask "what is my opponent forced to do afterwards?" before giving a check with no follow-up.',
            coachMethod:
              'Drill it in two directions. First, give the student positions where their king is in check and make them find all legal replies. Second, hand them a position where their king is safe but they should give check anyway, and ask why. The second drill is what turns a rule into a tool.',
            example: {
              student: 'I am in check, can I also take that pawn?',
              coach:
                'You can do anything that answers the check and leaves your king safe. But you cannot do anything else first. What attacks your king right now? Answer that, then decide the rest.',
            },
            realGame:
              'Watch a strong player check and then immediately look at what the reply allows. That single habit is worth more than any opening line.',
          },
          mistakes: [
            'Answering a check with a threat instead of a defence.',
            'Giving "check" while your own king is still attacked, which is illegal.',
            'Giving check with no plan for the forced reply.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
            caption: 'Ra8+ is check along the 8th rank. Black must answer: block, capture, or move the king.',
            highlight: ['e8', 'a8'],
            arrows: [['a1', 'a8']],
          },
          practice: [
            {
              fen: '4k3/8/8/7q/8/8/8/R3K3 w - - 0 1',
              prompt: 'White is in check from the queen on h5. Give Black the best response and say why it is forced.',
              solution:
                'White must answer: the check is along the 5th rank to d1? No — the queen on h5 attacks d1 along the 5th rank, so White must block, capture, or move. That is the point: check leaves exactly three kinds of answer.',
              hint: 'Three answers only: king, capture the checker, block.',
            },
          ],
          teachBack: {
            brief: 'Teach check as a forcing move, not just as a rule to obey.',
            required: [
              'the definition of check',
              'the three legal ways to answer it',
              'that check is forcing and therefore gains a tempo',
            ],
            lookFor: [
              'explains what the opponent is forced to do next',
              'warns about giving check without a follow-up',
            ],
          },
          misconception: 'The student thinks check is a warning that can be ignored if nothing is actually captured, or thinks check always wins material.',
          puzzlePrompt: 'Create a "give check on purpose" puzzle where the forced reply is the whole point of the position.',
          test: [
            {
              q: 'How many legal ways are there to answer a check?',
              options: ['One', 'Three kinds: move the king, capture the checker, block', 'Any move that does not lose material', 'Only moving the king'],
              answer: 1,
              explain: 'Three kinds, and every legal answer falls into one of them.',
            },
            {
              q: 'Why is check useful strategically?',
              options: ['It is a winning move', 'It forces the opponent to respond, buying you a tempo', 'It cannot be blocked', 'It wins a piece'],
              answer: 1,
              explain: 'The forcing quality is the value. That is also why check with no follow-up is often wasted.',
            },
          ],
        },
        {
          id: 'l1-checkmate',
          name: 'Checkmate',
          summary: 'The win condition, and how to recognise it is coming.',
          content: {
            definition:
              'Checkmate is check with no legal escape: the king is attacked and there is no square to move to, no piece to capture the checker, and no way to block. The game ends immediately and the side that delivered mate wins.',
            deep:
              'To a coach, the teachable structure is the three-part test: is the king attacked (check), and are all three escape routes closed. Students who can run that checklist will find mate much faster than students who "just look for mate". The other half of the skill is the mating net: king on the edge, a rook or queen on the back rank cutting off the escape squares, and the defender hemmed by their own pawns. Name that net and mate stops being luck.',
            why: 'It is the win condition, and recognising mate is the difference between a draw and a win in hundreds of student games.',
            when: 'When the opponent king has no flight squares. Check for it every time you have a queen or two rooks near a king.',
            whenNot: 'Do not check for mate while your own king is weak. A "mate in one" that allows checkmate against you first is not mate in one.',
            coachMethod:
              'Build the three-part checklist into a fixed verbal routine: "check? escape squares? blocks? captures?" Then set simple mate-in-one nets and have the student narrate which part of the checklist eliminates each escape. Narrating is what generalises.',
            example: {
              student: 'I check and he blocks, so it was not mate.',
              coach:
                'Right — and now you know exactly which part was missing. Let us check each of the three parts one at a time so you can see which one was open.',
            },
            realGame:
              'Ask the student to find a game where they had mate in two and did not take it. It happens constantly and it is the highest-value lesson in a whole match.',
          },
          mistakes: [
            'Announcing mate before checking for a blocking move.',
            'Forgetting a king can capture a defended piece if it is not actually defended.',
            'Missing that a pawn blocks a flight square just as a piece does.',
          ],
          board: {
            fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
            caption: 'Back-rank mate: Ra8 is mate because the black king\'s own pawns close every flight square.',
            highlight: ['g8', 'f7', 'g7', 'h7', 'a1', 'a8'],
            arrows: [['a1', 'a8']],
          },
          practice: [
            {
              fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1',
              prompt: 'White to move. Find mate in one and state which of the three parts blocks every escape.',
              solution:
                'Re8#. It is check along the 8th rank; the king cannot go to f8, h8 (same rank), f7/g7/h7 are its own pawns, and nothing can block on the 8th rank or capture the rook from a square it can reach.',
              hint: 'Check all three parts out loud, not just the check.',
            },
          ],
          teachBack: {
            brief: 'Teach a beginner to recognise checkmate using the three-part checklist.',
            required: [
              'mate is check plus no escape',
              'the three escape routes to eliminate',
              'the back-rank mating net',
            ],
            lookFor: [
              'makes the student run the checklist aloud',
              'connects the net shape to the checklist',
            ],
          },
          misconception: 'The student thinks checkmate is just "a strong check" and announces it without checking the escapes.',
          puzzlePrompt: 'Build a ladder of four mate-in-one nets: back rank, Arabian, smothered and a ladder mate.',
          test: [
            {
              q: 'Which of these is checkmate?',
              options: [
                'King on g8, pawns on f7 g7 h7, White rook a1 — Ra8',
                'King on g8, White queen e6 — Qe6+',
                'King on h8, White rook a1 — Ra8+',
                'King on g1, White queen d1 — Qd1+',
              ],
              answer: 0,
              explain: 'The first is mate: check along the rank and the king\'s own three pawns block every flight square.',
            },
            {
              q: 'Why must you check all three escape routes before announcing mate?',
              options: ['It is faster', 'Because mate requires no escape at all — one open square means it is only check', 'To find the evaluation', 'It is not necessary'],
              answer: 1,
              explain: 'Mate is defined by the absence of every escape. One open square makes it a check, not mate.',
            },
          ],
        },
        {
          id: 'l1-stalemate',
          name: 'Stalemate',
          summary: 'A draw the player never chose, and how to avoid it when winning.',
          content: {
            definition:
              'Stalemate is when the side to move is not in check but has no legal move. The game ends immediately in a draw.',
            deep:
              'The teaching point is asymmetry: not being in check but having no move is a draw, while being in check with no move is a loss. That single contrast explains the whole rule. The practical consequence for a winning player is that when you have a huge advantage, keep a safe square available to the opponent so they are never stalemated — a rook alone against a lone king cannot mate, and careless technique produces a stalemate instead of a win.',
            why: 'Students lose won positions to stalemate far more often than beginners expect, and it feels like cheating until they see the rule.',
            when: 'When you are winning and your opponent has only a king, and again whenever you are squeezing.',
            whenNot: 'Do not push a stalemate-prone squeeze when you could simplify to something won with certainty.',
            coachMethod:
              'Give the student a won rook-versus-king position and ask them to convert it while watching for the draw. Do not explain stalemate first — let them stalemate themselves, then reveal the rule. The lesson sticks much harder that way.',
            example: {
              student: 'I completely dominated that game. Why is it a draw?',
              coach:
                'Because at some point it was your opponent\'s turn, his king was not attacked, and he had no move. You did not give him a square to pass the time in. Where exactly did that happen?',
            },
            realGame:
              'Ask a student to review their last win and find the move where they nearly stalemated. It is usually one move before they thought the game was finished.',
          },
          mistakes: [
            'Believing stalemate means the king is in check.',
            'Squeezing a lone king with no safe square and drawing a won game.',
            'Not recognising a stalemate as an immediate end — the game stops there and is not played out.',
          ],
          board: {
            fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
            caption: 'Black to move: not in check, and every square is covered. Stalemate, immediate draw.',
            highlight: ['h8', 'f7', 'g6'],
            arrows: [],
          },
          practice: [
            {
              fen: '7k/8/5K2/8/8/8/8/R7 w - - 0 1',
              prompt: 'White is winning. Find the move that keeps the win and avoids stalemate.',
              solution:
                'Ra7+ or any rook move that keeps a square free is fine — the key is to never box the king in with no legal move. Move the rook along the 1st/2nd rank and keep an escape square until the king is on the edge and the rook checks on the rank opposite.',
              hint: 'After every rook move, ask: does Black have a legal move? If not, you have drawn.',
            },
          ],
          teachBack: {
            brief: 'Teach stalemate and make the student avoid it once in a won position.',
            required: [
              'stalemate is not check',
              'it ends the game in a draw',
              'a winning player must leave the opponent a safe square',
            ],
            lookFor: [
              'contrasts checkmate and stalemate explicitly',
              'warns about squeezing with no square',
            ],
          },
          misconception: 'The student believes stalemate is a stronger version of checkmate because the king has no move.',
          puzzlePrompt: 'Create a "convert this won position without stalemating" puzzle for a beginner who has just learned the rule.',
          test: [
            {
              q: 'Which is stalemate?',
              options: ['King attacked, no escape', 'King not attacked, no legal move', 'King attacked and captured', 'Both players pass'],
              answer: 1,
              explain: 'Not attacked plus no legal move is stalemate — a draw. Attacked plus no escape is checkmate.',
            },
            {
              q: 'You are winning with a rook and the opponent has a bare king. What must you watch for?',
              options: ['Getting your rook forked', 'Stalemating them', 'Running out of moves', 'Nothing'],
              answer: 1,
              explain: 'Without a spare piece you cannot mate a bare king, so you must avoid boxing the king in with no legal move.',
            },
          ],
        },
        {
          id: 'l1-castling',
          name: 'Castling',
          summary: 'A two-piece move with surprising conditions — a favourite place for rule mistakes.',
          content: {
            definition:
              'Castling moves the king two squares toward a rook and the rook to the other side of the king, as one move. The king ends on the c or g file. It may be done only if the king has not moved, the rook has not moved, the square the king crosses and the square it lands on are not attacked, and the king is not currently in check.',
            deep:
              'The subtle condition is the "not through check" rule: the king may not start in check, pass through an attacked square, or land on an attacked square — even if the rook is fine. This is why castling can be illegal while it looks obviously safe, and it is exactly the kind of detail a coach must state precisely. Teach it as three questions: has the king moved? are the squares safe? am I in check?',
            why: 'Castling gets the king to safety in one move and is a cornerstone of nearly every early opening plan, so a student who mishandles it loses the right to castle permanently.',
            when: 'Almost always early, ideally within the first ten moves, and always after the king is safe.',
            whenNot: 'Never in the opening if the king is in the centre and queens are on the board — that is how games get lost to a back-rank mate in eight moves.',
            coachMethod:
              'Use the physical board. Pick up the king and the rook together and move them as one, because the mental model students get wrong is "two moves". Then drill the three illegal cases explicitly: king already moved, through check, rook already moved. Students reliably miss the through-check case.',
            example: {
              student: 'My king has never moved, so I can castle any time.',
              coach:
                'You still cannot castle out of check or through an attacked square. Let us look at the e-file — is anything pointing at f1 or g1 right now?',
            },
            realGame:
              'Watch a game where a student castles and immediately loses the right to castle again by king movement under pressure. Then trace it back to a move they did not understand.',
          },
          mistakes: [
            'Thinking the king must not be attacked only where it lands, forgetting the crossing square.',
            'Believing castling is two separate moves.',
            'Castling out of check.',
          ],
          board: {
            fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
            caption: 'Both sides have castling rights. White plays O-O and the king lands on g1.',
            highlight: ['e1', 'f1', 'g1', 'h1'],
            arrows: [['e1', 'g1'], ['h1', 'f1']],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1',
              prompt: 'White to move. White has castling rights. Can White castle kingside? Explain using the three conditions.',
              solution:
                'No. The black rook on f2 attacks f1, which is the square the king must cross. The king may not castle through an attacked square, so kingside castling is illegal even though g1 is safe.',
              hint: 'Check f1, not just g1.',
            },
          ],
          teachBack: {
            brief: 'Teach castling including the "through check" condition, which is the one students miss.',
            required: [
              'king and rook move together, as one move',
              'king and rook must both be unmoved',
              'no castling out of, through, or into check',
            ],
            lookFor: [
              'demonstrates it on a physical or on-screen board',
              'names the crossing square explicitly',
            ],
          },
          misconception: 'The student believes castling is only illegal if the king\'s destination square is attacked, forgetting the square it crosses.',
          puzzlePrompt: 'Create three "spot the illegal castle" positions: through check, rook moved, king moved.',
          test: [
            {
              q: 'Which castling is illegal?',
              options: [
                'White king e1, nothing attacking anything, both pieces unmoved',
                'White king e1, black bishop attacking g1',
                'White king e1, both unmoved, black rook attacking f1',
                'White king g1, both unmoved',
              ],
              answer: 2,
              explain: 'The third is illegal: the king cannot castle through the attacked f1 square. The second is also illegal, but the clearest single answer for a crossing-square rule is f1.',
            },
            {
              q: 'After castling kingside, where does the rook end up?',
              options: ['f1', 'd1', 'g1', 'h1'],
              answer: 0,
              explain: 'The rook jumps to f1, the square between the king\'s start and finish.',
            },
          ],
        },
        {
          id: 'l1-enpassant',
          name: 'En Passant',
          summary: 'A once-only capture that beginners forget and students misquote.',
          content: {
            definition:
              'En passant is a legal pawn capture of a pawn that has just passed the capturing pawn\'s position by one square as its first move. The capturing pawn moves diagonally onto the empty square the enemy pawn passed through, and the passed pawn is removed as if it had been captured normally.',
            deep:
              'Two details are the whole difficulty. The capture must be made immediately — the right is lost if the player does anything else, and it is not remembered for later. And the capture happens on the square the enemy pawn passed through, not on the enemy pawn\'s current square. A coach who can state both sentences is fully equipped to teach this.',
            why: 'It is a legal move that looks illegal, so a student who does not know it will refuse a legal recapture and assume the game is broken.',
            when: 'Immediately after an enemy pawn advances two squares from its starting square, landing beside the capturing pawn.',
            whenNot: 'Do not invent it later in the game. If you decline it, the option is gone permanently.',
            coachMethod:
              'Say the rule as a two-sentence script and never improvise it: "only right after a two-square move, only on the square it passed through." Then set the position on the board and ask the student to make the capture physically.',
            example: {
              student: 'The pawn jumped past my pawn. I cannot capture it.',
              coach:
                'You can — but only right now, and only onto the square it jumped over. Do it now, and then tell me what happens to that pawn.',
            },
            realGame:
              'Rare but decisive, and it shows up in the opening after a quick pawn advance. Worth one lesson, not five.',
          },
          mistakes: [
            'Trying to capture onto the enemy pawn\'s current square instead of the square it passed through.',
            'Trying to capture with a non-adjacent pawn.',
            'Trying to capture more than one move later.',
          ],
          board: {
            fen: '4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1',
            caption: 'Black has just played d7-d5. White may capture exd6 en passant — a capture onto an empty square.',
            highlight: ['d5', 'e5', 'd6'],
            arrows: [['e5', 'd6']],
          },
          practice: [
            {
              fen: '4k3/8/8/2PpP3/8/8/8/4K3 w - d6 0 1',
              prompt: 'White to move. What is the en passant capture, and what is the alternative you just gave up?',
              solution:
                'cxd6 en passant. The alternative was c5, keeping both pawns. Note the capture is onto d6, an empty square, and the black d5 pawn disappears.',
              hint: 'The pawn passed through d6.',
            },
          ],
          teachBack: {
            brief: 'Teach en passant as a two-sentence rule with the position demonstrated.',
            required: [
              'only immediately after a two-square pawn move',
              'capture lands on the square the pawn passed through',
              'the passed pawn is removed',
            ],
            lookFor: [
              'states both conditions without prompting',
              'demonstrates on the board rather than describing',
            ],
          },
          misconception: 'The student thinks en passant captures the pawn on its current square, or believes the right lasts the whole game.',
          puzzlePrompt: 'Create an en-passant position puzzle and state explicitly how long the right lasts.',
          test: [
            {
              q: 'When is en passant available?',
              options: [
                'Any time an enemy pawn is beside yours',
                'Immediately after an enemy pawn advances two squares past your pawn',
                'Only in the endgame',
                'Once per game, whenever you like',
              ],
              answer: 1,
              explain: 'Only immediately, and only after the double advance past your pawn.',
            },
            {
              q: 'Which square does your pawn land on?',
              options: ['The enemy pawn\'s current square', 'The empty square it passed through', 'Its own diagonal square behind', 'Any square on the rank'],
              answer: 1,
              explain: 'The empty square the pawn passed through. The captured pawn is removed from its real square.',
            },
          ],
        },
        {
          id: 'l1-promotion',
          name: 'Promotion',
          summary: 'Pawn becomes anything — the biggest material swing in the game.',
          content: {
            definition:
              'When a pawn reaches the eighth rank it must promote immediately, becoming a queen, rook, bishop or knight of the same colour. It may not stay a pawn.',
            deep:
              'The under-rated lesson is the timing of promotion. A pawn on the seventh rank is a serious threat even before it promotes, and promoting instantly is not always best — a rook or bishop promotion can avoid stalemate. Tell the coach-student that the choice exists; almost nobody is taught it. The second lesson is that promotion is forced, so a player who promotes into a stalemated position has thrown away the game.',
            why: 'Promotion converts a 1-point piece into a 9-point piece, which is the largest single swing available, and the decision about when is a real skill.',
            when: 'The instant a pawn reaches the last rank.',
            whenNot: 'Rarely into a rook or bishop promotion — but do check for it when promoting would be stalemate or when a knight promotion delivers a smothered mate.',
            coachMethod:
              'Show the value swing on the board: pawn 1 becomes queen 9, so a passed pawn is worth far more than its nominal value. Then ask the student to find a promotion that would be stalemate and find the alternative promotion that wins.',
            example: {
              student: 'It is mate if I promote to a queen.',
              coach:
                'Let us check the black king. If it has no move after your queen appears, that is stalemate and the game is drawn. What other piece could you promote to instead?',
            },
            realGame:
              'Promotion deciding a game is not rare at club level. Ask a student to look for the move that would have won it — usually a rook promotion instead of a queen promotion.',
          },
          mistakes: [
            'Promoting into stalemate and drawing a won game.',
            'Believing promotion is optional.',
            'Promoting without noticing the opponent got a new piece too — promotion happens for both sides.',
          ],
          board: {
            fen: '8/3P4/8/8/8/8/8/4K1k1 w - - 0 1',
            caption: 'd8=Q and d8=R are both wins; the point is noticing when a queen promotion would be stalemate.',
            highlight: ['d7', 'd8'],
            arrows: [['d7', 'd8']],
          },
          practice: [
            {
              fen: '8/8/8/8/8/1k6/1P6/1K6 w - - 0 1',
              prompt: 'White to move and winning. Find the promotion that does not draw.',
              solution:
                'The naive b8=Q is either stalemate or met by promotion; the correct technique is to promote in a way that keeps a safe square. Test both promotions and check whether Black has a legal move after each.',
              hint: 'Always ask "does Black have a move after I promote?"',
            },
          ],
          teachBack: {
            brief: 'Teach promotion including the choice of piece and the stalemate trap.',
            required: [
              'promotion is mandatory on the last rank',
              'the four choices of piece',
              'promoting into stalemate is a draw',
            ],
            lookFor: [
              'warns about the stalemate trap',
              'mentions a case for under-promotion',
            ],
          },
          misconception: 'The student believes promotion is optional, or that a queen promotion is always the best promotion.',
          puzzlePrompt: 'Create a promotion puzzle where the queen promotion stalemates and a rook promotion wins.',
          test: [
            {
              q: 'What happens if a pawn reaches the last rank?',
              options: [
                'It may stay a pawn',
                'It must promote immediately',
                'It is captured',
                'Nothing until the end of the game',
              ],
              answer: 1,
              explain: 'Promotion is mandatory the moment the pawn arrives.',
            },
            {
              q: 'Why might you promote to a rook instead of a queen?',
              options: [
                'To save the queen for later',
                'To avoid stalemate and still win',
                'Because rooks are stronger than queens',
                'It is never correct',
              ],
              answer: 1,
              explain: 'Under-promotion is a real technique, most often to dodge stalemate or to deliver a specific checkmate.',
            },
          ],
        },
        {
          id: 'l1-notation',
          name: 'Chess Notation',
          summary: 'Writing moves so a coach can give written homework.',
          content: {
            definition:
              'Standard chess notation records each move as: piece letter (optional for pawns), destination square, and in check or checkmate x or #. Castling is O-O or O-O-O. Captures use x, and a pawn capture names the file it came from.',
            deep:
              'For coaching, the notation that actually matters is the disambiguator: when two pieces can legally reach the same square, you must say which one, such as Nbd2 or R1e3. A coach who cannot read disambiguation will misread a student\'s game. Teach it by showing two knights that can both reach d2 and asking which move the notation refers to.',
            why: 'Notation is how instructions reach a student between lessons, and how you annotate a game they could not attend. Ambiguous notation means the coach re-explains instead of teaching.',
            when: 'Every written instruction you give, and every game you hand back.',
            whenNot: 'Do not insist on formal notation while a beginner is still learning to move pieces. Readable is better than correct when the student is brand new.',
            coachMethod:
              'Write moves as you dictate them, and read a student\'s game back move by move so they hear it. Introduce disambiguation only when a student first writes an ambiguous move — teach it as a correction, not a rule to memorise.',
            example: {
              student: 'I wrote "to d2" but there are two knights.',
              coach:
                'Then your notation is ambiguous and neither of us knows which knight moved. Which knight can reach d2? Both can. So how do we write it?',
            },
            realGame:
              'Ask the student to write their game in notation without looking. What they get wrong tells you exactly what they are not seeing on the board.',
          },
          mistakes: [
            'Leaving out the disambiguator when two pieces can reach the same square.',
            'Using + and # inconsistently.',
            'Recording a capture without the x.',
          ],
          board: {
            fen: '4k3/8/8/8/8/2N1N3/8/4K3 w - - 0 1',
            caption: 'Both knights can reach d2 — this is exactly why Ncd2 and Ned2 exist.',
            highlight: ['c3', 'e3', 'd2'],
            arrows: [['c3', 'd2'], ['e3', 'd2']],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/2N1N3/8/4K3 w - - 0 1',
              prompt: 'Write the notation for the knight move to d2 for each knight separately.',
              solution:
                'Ncd2 for the c3 knight and Ned2 for the e3 knight. Without the file or rank letter the move is ambiguous.',
              hint: 'One letter of difference is enough to disambiguate.',
            },
          ],
          teachBack: {
            brief: 'Teach enough notation to write a student\'s homework unambiguously.',
            required: [
              'piece letter plus destination',
              'x for capture, + for check, # for mate',
              'disambiguation when two pieces can reach the square',
            ],
            lookFor: [
              'uses a position with two knights to teach disambiguation',
              'explains why ambiguity matters for coaching',
            ],
          },
          misconception: 'The student writes "to d2" without noticing two knights can both reach d2.',
          puzzlePrompt: 'Create a notation-correction exercise from a short game containing at least two ambiguous moves.',
          test: [
            {
              q: 'Two knights can both reach d2. What is the correct way to distinguish them?',
              options: ['N2d2 and N3d2 only', 'Ncd2 and Ned2, or N1d2 and N3d2', 'Both are written N-d2', 'Add a question mark'],
              answer: 1,
              explain: 'You add the file letter if the knights are on different files, or the rank number if they are on the same file.',
            },
            {
              q: 'What does a move ending in # mean?',
              options: ['Check', 'Checkmate', 'The move was the best', 'The move was forced'],
              answer: 1,
              explain: '# is checkmate. + is check.',
            },
          ],
        },
        {
          id: 'l1-draws',
          name: 'Draw Rules',
          summary: 'Three ways a game ends level, and how each one is triggered.',
          content: {
            definition:
              'A game is drawn by agreement between the players, by stalemate, by insufficient material (no forced mate is possible), by the fifty-move rule, or by threefold repetition of the position.',
            deep:
              'The fifty-move rule and threefold repetition are the two students never learn properly, so state them precisely. Fifty-move: fifty moves by each side without a capture or pawn move. Threefold: the same position — same side to move, same pieces, same castling rights, same en passant availability — occurring three times. Note the details in that definition, because "same pieces" is not enough and students will fail the exact test.',
            why: 'A coach must be able to explain why a drawn game was drawn, otherwise a student concludes the app is broken or the club is cheating.',
            when: 'Whenever a game ends without a result the student expected.',
            whenNot: 'Do not teach the fifty-move rule as a timer running on the board. It is a claim, and modern rules often set an automatic 75-move limit instead.',
            coachMethod:
              'Use the student\'s own drawn game as the lesson. Ask them to reconstruct the final position and work out which rule applied. Teaching the rule in the abstract is much weaker than explaining their own draw.',
            example: {
              student: 'It said draw but I was winning.',
              coach:
                'Let us look at the position where it ended. Was your opponent in check with no moves? That is stalemate, and it is an immediate draw regardless of material.',
            },
            realGame:
              'Drawn endgames and threefold claims happen in every club session. Being able to explain them is part of the job.',
          },
          mistakes: [
            'Believing fifty moves by one player is enough (it is fifty by each side).',
            'Forgetting that repetition must be the same position including the side to move.',
            'Assuming a draw needs both players to agree when it is a rule.',
          ],
          board: {
            fen: '8/8/8/4k3/8/4K3/8/8 w - - 0 1',
            caption: 'King versus king: no legal series of moves can produce mate, so the game is drawn by insufficient material.',
            highlight: ['e3', 'e5'],
            arrows: [],
          },
          practice: [
            {
              fen: '8/8/8/4k3/8/4K3/8/8 w - - 0 1',
              prompt: 'Name the draw rule that applies to this position.',
              solution:
                'Insufficient material. King versus king can never produce checkmate, so the game is drawn the moment the last other piece is captured.',
              hint: 'What can the position ever become? Nothing that mates.',
            },
          ],
          teachBack: {
            brief: 'Teach the draw rules using a real drawn game the student played.',
            required: [
              'agreement',
              'stalemate',
              'insufficient material',
              'the fifty-move rule counted by each side',
              'threefold repetition of the same position',
            ],
            lookFor: [
              'includes the side-to-move detail in repetition',
              'uses the student\'s own game as the example',
            ],
          },
          misconception: 'The student believes a draw always requires both players to agree, or that fifty moves by one side is enough.',
          puzzlePrompt: 'Take a drawn student game and write the explanation of exactly which draw rule ended it.',
          test: [
            {
              q: 'How many moves by each side may pass without a capture or pawn move before the fifty-move rule allows a draw?',
              options: ['Fifty', 'One hundred', 'Thirty', 'Seventy-five only'],
              answer: 1,
              explain: 'Fifty moves by each player — that is one hundred half-moves, which is why players are often surprised by how long it really is.',
            },
            {
              q: 'What makes a position "the same" for threefold repetition?',
              options: [
                'The same pieces only',
                'The same pieces, side to move, castling rights and en passant availability',
                'The same pieces on the same colour squares',
                'The same player to move and the same material',
              ],
              answer: 1,
              explain: 'All of it counts: pieces, side to move, castling rights and whether an en passant capture is available.',
            },
          ],
        },
      ],
    },
    {
      id: 'l1-m2',
      title: 'Opening Principles',
      description: 'The four ideas that make every opening move sensible.',
      topics: [
        {
          id: 'l1-principles',
          name: 'Basic Opening Principles',
          summary: 'Control the centre, develop, castle, keep the king safe.',
          content: {
            definition:
              'Four principles cover almost every sensible opening move: control the centre, develop your pieces with purpose, castle early to make the king safe, and put your rooks on open files once the centre is open.',
            deep:
              'Teach these as questions, not rules, because rules invite rule-following and questions produce judgement. What are the threats here? Which piece has no job yet? Where is my king safest? Which of my pieces could be better right now? A student who asks those four questions every move does not need to memorise opening lines, because the lines are just good answers to those questions.',
            why: 'Opening principles are transferable knowledge. A student who learns principles can play any opening they have never seen; a student who learns lines can only play those lines.',
            when: 'Every game, from the first move.',
            whenNot: 'Do not apply "develop with purpose" to a pawn move that wins material or creates a threat — purpose beats routine every time.',
            coachMethod:
              'Play a game with the student where you deliberately make a "rule-following" move that has no purpose, and let them criticise it. Students learn principles far better by rejecting a bad move than by hearing a good one.',
            example: {
              student: 'I developed all my pieces and I am still losing.',
              coach:
                'Then the question is not how many you developed but what each piece is doing. Which of your pieces has no job? That is your real problem.',
            },
            realGame:
              'Ask the student to review their last game and mark, for each of the first ten moves, which principle it served. Most students discover they broke a principle with no gain.',
          },
          mistakes: [
            'Developing with no purpose because a rule says to develop.',
            'Playing the same move order regardless of what the opponent played.',
            'Moving the king in the centre before castling.',
          ],
          board: {
            fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            caption: 'Two principles on one board: control the centre (e4) and castle to safety (O-O).',
            highlight: ['d4', 'e4', 'd5', 'e5', 'g1', 'f1', 'g8'],
            arrows: [['e2', 'e4'], ['g1', 'f3']],
          },
          practice: [
            {
              fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
              prompt: 'Name four opening principles and the question that tests each one.',
              solution:
                'Centre control (what do I attack in the middle?), development (which piece has no job?), king safety (where is my king safest and cheapest?), rooks (which file is open?).',
              hint: 'Turn each principle into a question.',
            },
          ],
          teachBack: {
            brief: 'Teach opening principles as four questions a student can ask on any move.',
            required: [
              'control the centre',
              'develop pieces with purpose',
              'castle for king safety',
              'put rooks on open files',
            ],
            lookFor: [
              'expresses principles as questions',
              'demonstrates "develop with purpose" rather than "develop"',
            ],
          },
          misconception: 'The student follows principles mechanically and cannot explain why a sensible-looking move was still bad.',
          puzzlePrompt: 'Create a position where following a principle correctly is still the wrong move, and ask the student to justify the exception.',
          test: [
            {
              q: 'Which of these is NOT an opening principle?',
              options: ['Control the centre', 'Develop pieces', 'Castle early', 'Always play the Italian Game'],
              answer: 3,
              explain: 'An opening is a choice, not a principle. Principles travel between openings; a specific opening does not.',
            },
            {
              q: 'Why is "develop with purpose" better advice than "develop"?',
              options: [
                'It is shorter',
                'It forces the student to ask what the piece is for',
                'It means develop every piece before anything else',
                'It is a rule from a famous coach',
              ],
              answer: 1,
              explain: 'It makes development answer a question rather than satisfy a quota. A purposeful move can be a pawn move.',
            },
          ],
        },
        {
          id: 'l1-centre',
          name: 'Center Control',
          summary: 'Why the middle of the board is worth more than the corners.',
          content: {
            definition:
              'Control of the centre means your pawns or pieces influence d4, d5, e4 and e5. Central squares touch more pieces than edge squares, so a piece or pawn standing there affects up to eight moves.',
            deep:
              'Give the student the number: a knight on the rim controls at most four squares from the centre eight and sometimes twelve. That single statistic explains development, outposts, why rooks belong on central files, and why a central pawn is worth more than an edge pawn. Then add the strategic layer: controlling the centre is a means, not an end. Two knights dominating the centre while your pawns stand on a5 and h4 is not a good position, and the student should be able to say why.',
            why: 'Centre control is the engine behind most positional principles, and it is the easiest way to teach a beginner that chess has geometry.',
            when: 'Early, every game.',
            whenNot: 'Do not tell a student to blindly grab the centre with a pawn that blocks their own pieces or exposes the king.',
            coachMethod:
              'Have the student count the squares a knight controls from the edge and then from the middle. Then have them find the piece in their own game that is doing nothing, and explain it using the number.',
            example: {
              student: 'Why is that knight better on d5 than on a4?',
              coach:
                'Count the squares each one can reach right now. Now tell me which of those squares matter in this position.',
            },
            realGame:
              'Ask the student to find their worst-placed piece in their last game and explain the placement using central-square reach.',
          },
          mistakes: [
            'Pushing a central pawn that blocks own development.',
            'Assuming centre control is automatically good regardless of structure.',
            'Leaving a knight on the rim "because it is safe".',
          ],
          board: {
            fen: '4k3/8/8/8/3N4/8/8/4K3 w - - 0 1',
            caption: 'A knight on d5 touches the whole board; the same knight on a4 touches almost nothing.',
            highlight: ['d5', 'a4'],
            arrows: [],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/8/8/N3K3 w - - 0 1',
              prompt: 'How many squares can the white knight on a1 reach, and what does that tell you?',
              solution:
                'Two — b3 and c2. The same knight centrally would reach eight. That is the whole argument for central placement in one question.',
              hint: 'Count every L-shape from the square.',
            },
          ],
          teachBack: {
            brief: 'Teach centre control using the square-reach count rather than as a slogan.',
            required: [
              'the four central squares',
              'central squares affect more moves than edge squares',
              'centre control is a means to activity, not an end',
            ],
            lookFor: [
              'uses the count as the explanation',
              'warns against blocking own development for the centre',
            ],
          },
          misconception: 'The student believes central squares are important only because "the middle is where the fighting happens".',
          puzzlePrompt: 'Create a placement puzzle where moving one piece to the centre wins material, and have the student justify it with reach.',
          test: [
            {
              q: 'Which square gives a knight the most influence from this set?',
              options: ['a4', 'd5', 'h4', 'a1'],
              answer: 1,
              explain: 'd5 is central and reaches eight squares; the corners and rim squares reach far fewer.',
            },
            {
              q: 'Centre control is best described as:',
              options: [
                'An end in itself',
                'A means of giving your pieces more influence and options',
                'Only about pawns',
                'A middlegame concern only',
              ],
              answer: 1,
              explain: 'It is a means. The test is whether your central control actually produces activity.',
            },
          ],
        },
        {
          id: 'l1-development',
          name: 'Development',
          summary: 'Getting pieces working fast, and knowing which pieces to leave alone.',
          content: {
            definition:
              'Development is getting your pieces from their starting squares onto squares where they do something, as fast as possible, without leaving the king unsafe.',
            deep:
              'The beginner error is counting developed pieces instead of judging purpose. Development is not a headcount; it is a process where every move should improve something. That reframing handles the awkward cases: a knight that goes to a great outpost counts, a pawn move that opens a file counts, a move that develops nothing does not count even if it follows a pattern. Knights before bishops is a useful beginner heuristic for a reason — knights take two moves to matter and bishops one — but present it as a rule of thumb with a reason, not a law.',
            why: 'Fast, purposeful development is the largest practical advantage a beginner can build, and it is entirely within their control.',
            when: 'The opening, every game, until your pieces have jobs.',
            whenNot: 'Do not develop a piece that is already doing something useful, and do not develop into a lost pawn structure.',
            coachMethod:
              'After each move, ask the student one question: "what does that piece do now that it did not do before?" If they cannot answer, the move was not development. This single question fixes most opening drift.',
            example: {
              student: 'I have developed four pieces and I am behind in development.',
              coach:
                'Which four? Let us check whether each one is doing something. A developed piece that cannot reach anything is not really developed.',
            },
            realGame:
              'Have the student count their meaningful developed pieces at move 10 in their last game. The number is usually lower than they remember.',
          },
          mistakes: [
            'Counting developed pieces rather than judging their purpose.',
            'Developing the same side twice while the other wing sits idle.',
            'Blocking a bishop with a pawn "because it is safer".',
          ],
          board: {
            fen: 'rnbqkb1r/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 3',
            caption: 'Both knights and both bishops are working. Development here is purposeful, not just complete.',
            highlight: ['c4', 'f3', 'c6', 'f8'],
            arrows: [],
          },
          practice: [
            {
              fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
              prompt: 'Which two pieces still have no job, and what is the fastest way to give them one?',
              solution:
                'The knight on g1 and the bishop on f1. Nf3 and Bc4 both give them purpose and eyes the centre. The knight goes first by the two-move rule, but either order is sound here.',
              hint: 'Two moves to matter for knights, one for bishops.',
            },
          ],
          teachBack: {
            brief: 'Teach development as "every move improves something", not as a piece count.',
            required: [
              'development is about purpose, not count',
              'knights before bishops, with the reason',
              'never develop at the cost of king safety',
            ],
            lookFor: [
              'asks the student what each move changed',
              'treats a pawn move as potentially valid development',
            ],
          },
          misconception: 'The student counts pieces off their home squares and calls that development.',
          puzzlePrompt: 'Create a position with six developed but idle pieces and a seventh that is doing real work, and ask which side is better developed.',
          test: [
            {
              q: 'Which statement about development is correct?',
              options: [
                'Count developed pieces and that is the measure',
                'Every move should improve something a piece can actually use',
                'Develop all pieces before any pawn move, always',
                'Bishops should always be developed before knights',
              ],
              answer: 1,
              explain: 'Purpose, not count. A pawn move that opens a file can be better development than a routine knight move.',
            },
            {
              q: 'Why do knights usually come out before bishops?',
              options: [
                'Knights are stronger',
                'A knight needs two moves to become useful, a bishop only one',
                'Bishops are harder to move',
                'It is an opening trap',
              ],
              answer: 1,
              explain: 'Turn count. A knight developed to a dead square has spent two moves for nothing, which is why its destination matters.',
            },
          ],
        },
        {
          id: 'l1-kingsafety',
          name: 'King Safety',
          summary: 'Getting the king to safety before it matters, and not a move earlier.',
          content: {
            definition:
              'King safety means getting your king to a defended square, usually behind castled pawns, before your opponent can open lines or build an attack against it.',
            deep:
              'The most valuable lesson in this entire level is a negative one: a king move in the opening often throws away the right to castle and leaves the king exposed for the rest of the game. One unmotivated king move in move six can decide the whole game. So the coaching point is not "move the king early" — it is "castle, and only move the king when the position demands it". Add the practical checklist a student can apply: is the king on a square an enemy slider can reach? Is it defended by pawns? Is the square it would run to safe?',
            why: 'King safety failures end more student games than tactical blunders, and they are almost always a decision rather than a calculation.',
            when: 'Before the centre opens, and again any time a file or diagonal near your king is cleared.',
            whenNot: 'Never move the king early "to be safe" — that is exactly what castling is for.',
            coachMethod:
              'Show the student a game where they moved their king on move five and trace the consequences. Then ask them to find the castling move they missed. Concrete consequences beat warnings.',
            example: {
              student: 'My king feels unsafe in the centre so I moved it.',
              coach:
                'That was the moment you lost castling. Show me: where can you go, and who attacks you there? Compare that with simply castling.',
            },
            realGame:
              'Have the student scan their own games for early king moves and count how many games they went on to lose.',
          },
          mistakes: [
            'Moving the king in the opening and losing castling rights.',
            'Castling late, after the centre has opened.',
            'Castling into an open file or a weakened diagonal.',
          ],
          board: {
            fen: 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 5',
            caption: 'White has castled: the king is behind pawns on g1. Black has not and must catch up.',
            highlight: ['g1', 'f1', 'g8', 'e8'],
            arrows: [],
          },
          practice: [
            {
              fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
              prompt: 'White to move. What is the safest move for the king, and why can you not do it yet?',
              solution:
                'Castling is the goal, but the f1 bishop blocks it and the knight on g1 is in the way. Develop the knight or the bishop first — or castle kingside once they are out. You cannot castle through your own pieces.',
              hint: 'Check what is standing on the king\'s path.',
            },
          ],
          teachBack: {
            brief: 'Teach king safety so the student casts early and almost never moves the king in the centre.',
            required: [
              'castle early while the centre is still closed',
              'moving the king early forfeits castling',
              'castling safely means avoiding open files and weak diagonals',
            ],
            lookFor: [
              'treats the lost castling right as the main lesson',
              'gives a concrete check for a safe castled square',
            ],
          },
          misconception: 'The student moves the king early in the centre believing that is what king safety means.',
          puzzlePrompt: 'Take a student game lost by an early king move and write the lesson from it.',
          test: [
            {
              q: 'What is the usual cost of moving your king in the opening?',
              options: [
                'Nothing important',
                'You permanently lose the right to castle',
                'You lose a tempo only',
                'Your pawns move backwards',
              ],
              answer: 1,
              explain: 'Castling is forfeited for good, which is why the king should generally stay put until it is castled or the position forces the move.',
            },
            {
              q: 'When is the best time to castle?',
              options: [
                'When your opponent opens the centre',
                'Early, while the centre is still closed and your pawns still cover the king',
                'In the endgame',
                'Only when attacked',
              ],
              answer: 1,
              explain: 'Before the centre opens. After the pawns leave, the king is exposed and castling may not even be possible.',
            },
          ],
        },
      ],
    },
  ],
};