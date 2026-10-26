/**
 * Level 5 — Positional Coaching.
 *
 * Level 4 taught plans that come from structure. Level 5 teaches the general
 * positional vocabulary that works with no pawn structure in particular:
 * activity, space, weak squares, bad pieces — and the whole framework is
 * "compare the pieces", because almost every positional judgement reduces to
 * asking whether a piece is doing its job.
 */
export default {
  n: 5,
  id: 'level-5',
  title: 'Positional Coaching',
  tagline: 'Explain why a good move is good.',
  description:
    'Structural thinking: activity, space, weak squares and pawn structures, and the discipline of finding the worst piece and a pawn break.',
  finalTask: "Analyze an unfamiliar position without relying only on engine moves and explain the strategic plan.",
  finalExam: { title: 'Level 5 Final Exam', passMark: 80, sections: ['theory', 'strategic', 'teaching'] },
  competency: ['Strategic Skill', 'Chess Knowledge'],
  modules: [
    {
      id: 'l5-m1',
      title: 'Positional Principles',
      description: 'The general principles that hold regardless of pawn structure.',
      topics: [
        {
          id: 'l5-activity',
          name: 'Activity vs Passivity',
          summary: 'A piece that does something beats a piece that could, in almost every position.',
          content: {
            definition:
              'Activity means a piece having real work: controlling squares that matter, supporting an attack, restricting the opponent. A piece with potential but no current job is passive, and in the middlegame a passive piece is usually a liability.',
            deep:
              'The judgement is not "active good, passive bad" in the abstract — it is about comparison. Two knights: the one in the centre that controls six relevant squares is worth more than the one on the rim, and if the opponent\'s knight is the active one then the comparison goes the other way. So the coaching routine is always relative: list both sides\' pieces, ask what each one is doing, and find the piece that is doing least. That "worst piece" question is the single most useful diagnostic in positional chess, and it produces better plans than staring at pawns. The trap to warn about is activity without purpose — a knight hopping between squares that change nothing is just a piece that moved, not a piece that worked.',
            why: 'Nearly every strategic mistake in club chess can be explained as letting the opponent have the better piece.',
            when: 'When choosing between two of your own pieces to place somewhere, and when you have won material and must decide where to put it.',
            whenNot: 'When the active piece would be exposed to a tactic, or when activity would abandon king safety.',
            coachMethod:
              'Run the piece audit. Write out both sides\' pieces on paper and, next to each, one line: what is it doing? Then circle the two that are doing least. Those two pieces tell you where the game will be decided. This single exercise fixes the vague feeling of "this position is good" and replaces it with a specific list of targets, which is what makes coaching possible.',
            example: {
              student: 'I have more space, so I must be better.',
              coach:
                'Who is your worst piece? Take the position apart piece by piece. If his knight is controlling four squares that matter and yours is stuck on the rim, then the space you gained bought you nothing. Space is only valuable through the pieces that use it.',
            },
            realGame:
              'Have the student do a full piece audit on their last game and identify which piece decided it.',
          },
          mistakes: [
            'Assuming activity is always better, even when it abandons king safety.',
            'Confusing pieces that moved with pieces that are active.',
            'Ignoring the opponent\'s activity when counting your own advantages.',
            'Developing a piece to a square with no plan behind it.',
          ],
          board: {
            fen: '4k3/8/8/3q4/8/8/3N4/4K3 w - - 0 1',
            caption: 'The knight on d2 controls the centre; a knight on a1 would control almost nothing. Activity is measured by what a piece reaches.',
            highlight: ['d2', 'd5', 'e4', 'c4'],
            arrows: [['d2', 'e4'], ['d2', 'c4']],
          },
          practice: [
            {
              fen: '4k3/8/8/3q4/8/8/3N4/4K3 w - - 0 1',
              prompt: 'Where should the knight go to be most active, and which squares does it reach from there?',
              solution:
                'e4 or c4 — a central knight that reaches b2, c3, c5, d2, d6, f2, f6 and g3/g5. From a rim square it reaches two or three squares. The count is the argument.',
              hint: 'Count the reachable squares from each candidate square.',
            },
          ],
          teachBack: {
            brief: 'Teach the piece audit as the way to find a position\'s real weak points.',
            required: [
              'activity means a piece is doing work now, not that it has moved',
              'judgement is comparative: both sides are audited',
              'the piece doing least is usually where the game is decided',
            ],
            lookFor: [
              'audits both sides rather than only its own',
              'identifies the worst piece without being told which one to look for',
            ],
          },
          misconception: 'The student believes a piece is active because it has moved a lot, or because it is close to the enemy king.',
          puzzlePrompt:
            'Build two positions with identical material where the active piece is on the losing side, and ask the student to explain why.',
          test: [
            {
              q: 'What is activity?',
              options: [
                'A piece that has made many moves',
                'A piece doing real work — controlling relevant squares, supporting an attack, restricting the opponent',
                'A piece that has captured something',
                'A piece close to the enemy king',
              ],
              answer: 1,
              explain:
                'Activity is about current function, not history or proximity to danger. The test is what the piece reaches and stops.',
            },
            {
              q: 'What is the first question when comparing two positions?',
              options: [
                'Who has more material?',
                'Whose pieces are more active — the piece audit',
                'Who is castled?',
                'Who has more space?',
              ],
              answer: 1,
              explain:
                'Material, space and castling all matter, but they only matter through the pieces that use them. Activity is the diagnostic.',
            },
          ],
        },
        {
          id: 'l5-space',
          name: 'Space & Open Files',
          summary: 'Space is useful through pieces; open files belong to rooks and knights.',
          content: {
            definition:
              'Space is the number of squares or ranks your pawns control, and open files are files with no pawns on them. Space is not inherently valuable — it is valuable when your pieces can occupy it without crowding each other.',
            deep:
              'The professional understanding of space is that it is a resource for mobility. Extra space means your pieces have more squares to manoeuvre on and the opponent\'s are cramped. That is worth more to a piece-heavy position (knights, and a rook with an open file) than to a position of bishops and pawns, which is why space advantages are often exaggerated by club players and discounted correctly by masters. The corollary is the trade-off: giving up space for speed of development is usually good early, and giving up space for structure is usually good late. And the honest warning: in many equal positions space counts for nothing, because neither side can use it.',
            why: 'Students often claim space as an advantage without asking whether anybody can occupy it, which leads to bad plans.',
            when: 'When you have pawns advanced on one wing, or when a file has just opened.',
            whenNot: 'Not as an argument when your pieces cannot use the extra space, and not when speed of development is more important.',
            coachMethod:
              'Use the crowding test. Set up a position where one side has more space and ask: can any of my pieces actually get into that space? If the answer is no, the space is worthless and you should say so. Then show a position where the same space advantage is worth a full piece because a knight can occupy it and outpost there. The comparison teaches the conditional rather than the slogan.',
            example: {
              student: 'I have three ranks of space and I am losing.',
              coach:
                'Then the space is not doing anything for you. Ask: which of your pieces is standing in that space? If none, you have three ranks of nothing. Realise what the space buys — mobility — and check whether you are actually getting it.',
            },
            realGame:
              'Have the student compare the space advantage and the mobility advantage in their last game separately.',
          },
          mistakes: [
            'Claiming space as an advantage without checking whether pieces can use it.',
            'Giving up space early for no compensating benefit.',
            'Opening a file that your rook cannot reach.',
            'Allowing the opponent to close your space while you do not close theirs.',
          ],
          board: {
            fen: 'r4rk1/pp3ppp/8/8/8/8/PPP2PPP/2KR3R w - - 0 1',
            caption: 'The open d-file and c-file give the rooks targets. Space here is valuable because pieces can occupy it.',
            highlight: ['d1', 'c1', 'd4', 'd5'],
            arrows: [['d1', 'd4']],
          },
          practice: [
            {
              fen: 'r4rk1/pp3ppp/8/8/8/8/PPP2PPP/2KR3R w - - 0 1',
              prompt: 'Name the open files here and say which piece is the natural one to use them.',
              solution:
                'The c-file and the d-file are open. The rook is the natural piece on an open file; a knight can also use the c-file if it lands on a protected outpost on c5 or c6.',
              hint: 'Count pawns per file, then ask which piece wants an open file.',
            },
          ],
          teachBack: {
            brief: 'Teach space as mobility rather than as a count of squares.',
            required: [
              'space is valuable only through the pieces that can occupy it',
              'space matters more to knights and open-file rooks than to bishops',
              'giving up space for speed is normal; giving it up for nothing is not',
            ],
            lookFor: [
              'applies the crowding test before claiming a space advantage',
              'can say what the space actually buys in a given position',
            ],
          },
          misconception: 'The student treats any space advantage as decisive, even when no piece can occupy the space.',
          puzzlePrompt:
            'Create two positions with the same amount of space, one where it is decisive and one where it is irrelevant, and ask which is which.',
          test: [
            {
              q: 'When is a space advantage real?',
              options: [
                'Whenever you have more pawn moves available',
                'When your pieces can actually occupy and use that extra space',
                'Only in the endgame',
                'When the opponent is weaker',
              ],
              answer: 1,
              explain:
                'Space buys mobility. If your pieces cannot get into the space, you have pawn moves and nothing more.',
            },
            {
              q: 'Which piece benefits most from an open file?',
              options: ['The rook', 'The bishop', 'The knight only', 'The queen always'],
              answer: 0,
              explain:
                'A rook is the natural piece on an open file. Bishops want diagonals and knights want outposts, though all three can use a file.',
            },
          ],
        },
        {
          id: 'l5-weak-squares',
          name: 'Weak Squares & Outposts',
          summary: 'Permanent holes, temporary outposts, and how to convert them.',
          content: {
            definition:
              'A weak square is one that cannot be defended by pawns — permanently, because of pawn structure, or temporarily, because of a minor piece that has left. An outpost is a square inside the opponent\'s position where a piece can sit and be protected by a pawn.',
            deep:
              'The distinction that matters for coaching is permanent versus temporary, because it determines whether you can build a plan around it. A permanent hole — typically a dark square in a position where the opponent\'s bishop controls all the dark squares and their pawns cannot defend — can be attacked for the rest of the game. A temporary weakness created by a piece sitting in the wrong place will be defended again and is therefore not a real target. Outposts require the same precision: a knight on a square where the opponent can challenge it with a pawn, or where it is defended only by a piece that can be exchanged, is not an outpost. A real outpost is protected by a pawn that cannot be attacked without losing something else.',
            why: 'Converting a weakness into a passed pawn or a decisive penetration is one of the main routes to a won game, and it is entirely a teaching topic.',
            when: 'When you have identified a square the opponent cannot defend with pawns and a piece that can occupy it.',
            whenNot: 'Not when the weakness is a piece the opponent can simply move back to defend, and not when a pawn could defend it.',
            coachMethod:
              'Draw the squares the opponent\'s pawns can reach, and shade them. Everything you cannot defend is a candidate. Then ask the two verification questions: can they attack the piece there with a pawn, and if they trade, does my pawn survive? If both answers hold, it is a real outpost and the attack can be planned. This visual method is dramatically faster than verbal reasoning and works with beginners immediately.',
            example: {
              student: 'Their knight is on a weak square. I will attack it.',
              coach:
                'Good instinct, but check first. Can they move it back and defend the square with a pawn? If yes, the square is not weak — it is just occupied. A real weakness is one they cannot fix.',
            },
            realGame:
              'Have the student draw the opponent\'s undefendable squares on their last game and name the piece that could use each one.',
          },
          mistakes: [
            'Attacking a square the opponent can defend with a pawn.',
            'Treating a temporary weakness as permanent.',
            'Placing an outpost piece where it can be challenged by a pawn.',
            'Building a plan on a square the opponent can still protect.',
          ],
          board: {
            fen: 'r1bqk2r/pp1n1ppp/2p1pn2/3p4/3P4/2NP1N2/PP3PPP/R1BQK2R w KQkq - 0 8',
            caption: 'The square d5 is undefended by black pawns — a permanent weakness that White can attack with a knight.',
            highlight: ['d5', 'c3', 'e7'],
            arrows: [['c3', 'd5']],
          },
          practice: [
            {
              fen: 'r1bqk2r/pp1n1ppp/2p1pn2/3p4/3P4/2NP1N2/PP3PPP/R1BQK2R w KQkq - 0 8',
              prompt: 'Which square in this position cannot be defended by a black pawn, and how would you attack it?',
              solution:
                'd5 — no black pawn covers it, and the e6 pawn cannot be challenged without weakness. White would play Ne5 and Nd7 or Nxd7 ideas to occupy it permanently with a knight.',
              hint: 'Mark every square the black pawns attack, then look at what is left.',
            },
          ],
          teachBack: {
            brief: 'Teach weak squares with the pawn-defence map, distinguishing permanent from temporary.',
            required: [
              'a weak square is one no pawn can defend',
              'permanent weaknesses are planned around; temporary ones are not',
              'an outpost needs pawn protection that survives a trade',
            ],
            lookFor: [
              'draws the opponent\'s pawn reach rather than reasoning verbally',
              'verifies whether a square is truly undefendable',
            ],
          },
          misconception: 'The student believes any square with a piece on it is weak and can be attacked indefinitely.',
          puzzlePrompt:
            'Take one position with a permanent hole and one with a temporarily undefended square, and ask the student which is worth building a plan around.',
          test: [
            {
              q: 'What makes a square permanently weak?',
              options: [
                'A piece is standing on it',
                'No pawn of the defending side can ever reach it',
                'The opponent has no knight',
                'It is a light square',
              ],
              answer: 1,
              explain:
                'If no pawn can defend it, it can be attacked for the rest of the game. That is what makes a hole exploitable.',
            },
            {
              q: 'What is an outpost?',
              options: [
                'A square near the enemy king',
                'A square inside the opponent position where a piece can sit protected by a pawn',
                'An open file',
                'A square the opponent has just abandoned',
              ],
              answer: 1,
              explain:
                'A piece on a pawn-protected square inside enemy territory, where it can operate for the rest of the game.',
            },
          ],
        },
        {
          id: 'l5-bishoppair',
          name: 'Piece Value in Practice',
          summary: 'Two bishops, two knights, and why the general rule has exceptions that matter.',
          content: {
            definition:
              'Rough values are pawn 1, knight 3, bishop 3, rook 5, queen 9. Two minor pieces are worth more than one — the bishop pair slightly so — but in the endgame two knights are often stronger than bishop and knight, and a bishop pair is strongest in open positions.',
            deep:
              'The coaching goal is to stop the numbers being used as a verdict. The knight pair wins with the opponent\'s pawns fixed on one wing, because knights attack fixed targets and bishops need them to move; the bishop pair is worth a full point in an open position because the bishops cover both square colours. So the real teaching is: the values are a language for counting, and the exceptions are the strategic content. A strong test to give students is to take a position with bishop against knight where the knight is clearly better and ask them to say why — if they can only quote numbers, the lesson has not landed.',
            why: 'Misvalued material leads to bad trades and missed opportunities in both directions.',
            when: 'When evaluating a trade, and when counting what a sacrifice actually costs.',
            whenNot: 'Not as the sole basis for accepting or refusing a trade.',
            coachMethod:
              'Play the counting game, then immediately break it. Show three trades that the numbers approve and two they do not, and have the student explain the exceptions. The pair of trades the numbers reject are the lesson: they usually involve a pawn structure or a king safety factor that the count cannot see. Finish with the endgame knight-pair lesson, because it is the most commonly misunderstood exception at club level.',
            example: {
              student: 'I won a bishop for a knight, so I am ahead.',
              coach:
                'Ahead by the smallest possible margin, and you gave up the long-term pair. Now show me where your two bishops will be aiming. If you cannot, then the trade you refused was right and you took the wrong one.',
            },
            realGame:
              'Have the student evaluate every trade in their last game using both the numbers and the exceptions.',
          },
          mistakes: [
            'Refusing a good trade because it loses half a point of the count.',
            'Trading bishop for knight to "equalise" in a position where the bishop pair wins.',
            'Assuming two knights are always weaker than bishop and knight.',
            'Giving up the bishop pair without a concrete compensating advantage.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/4B3/2B1K3 w - - 0 1',
            caption: 'Two bishops cover both square colours, which is the whole reason the pair is worth more than the sum of its parts.',
            highlight: ['c1', 'e2'],
            arrows: [['e2', 'h5']],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/8/4B3/2B1K3 w - - 0 1',
              prompt: 'Why is the bishop pair worth more than bishop-and-knight in this open position?',
              solution:
                'The bishops cover both light and dark squares, so they control squares no single piece can reach. In an open position that extra coverage cannot be challenged, so the pair is genuinely stronger rather than merely nominally.',
              hint: 'Think about square coverage rather than piece count.',
            },
          ],
          teachBack: {
            brief: 'Teach values as a counting language, with the two key exceptions made explicit.',
            required: [
              'pawn 1, minor 3, rook 5, queen 9',
              'the bishop pair is worth slightly more than bishop and knight',
              'two knights are often stronger than bishop and knight in fixed endgames',
            ],
            lookFor: [
              'explains the knight-pair exception with a concrete reason',
              'uses the numbers as a starting point rather than a conclusion',
            ],
          },
          misconception: 'The student believes knight and bishop are always equal, and that the count settles every trade.',
          puzzlePrompt:
            'Set up a fixed-pawn endgame with two knights versus bishop and knight and ask the student to reassess the count.',
          test: [
            {
              q: 'In which case are two knights often stronger than bishop and knight?',
              options: [
                'When the position is open',
                'When the opponent\'s pawns are fixed and cannot be attacked',
                'In rapid play only',
                'When both bishops are light-squared',
              ],
              answer: 1,
              explain:
                'Knights attack fixed targets. When pawns cannot move, the knight pair is often better — the classic demonstration of position over material.',
            },
            {
              q: 'Why is the bishop pair worth more than its parts?',
              options: [
                'Bishops are individually stronger than knights',
                'Two bishops cover both square colours, so they control squares neither could alone',
                'It is a rule with no reason',
                'Because bishops never get captured',
              ],
              answer: 1,
              explain:
                'Combined coverage is the reason. It matters most in open positions, where that coverage cannot be challenged.',
            },
          ],
        },
      ],
    },
    {
      id: 'l5-m2',
      title: 'Pawn Structure in Depth',
      description: 'The four structures from Level 4, now at full strategic depth.',
      topics: [
        {
          id: 'l5-isolani',
          name: 'The Isolani in Depth',
          summary: 'Play through the isolani: the d4 square, the c3 knight, the space you win back.',
          content: {
            definition:
              'The isolated queen\'s pawn (IQP/isolani) is a pawn with no friendly pawns on adjacent files. The whole game around it is the square directly in front of it, usually c4 for a white d4 pawn, and the knight that occupies that square.',
            deep:
              'Teach the isolani as a sequence, because that is how it is actually played. The plan has four stages: occupy c4 with the knight, trade on the half-open c-file, push d5 to gain space, and finally organise the pieces around the hole. Note that the pawn itself is often perfectly good — the point is not to attack the pawn but to attack the square, which is stronger and cannot be defended. Warn about the two classic student errors: attacking the pawn with the rook instead of the knight, and trading into a structure that doubles White\'s pawns and hands Black the c-file.',
            why: 'It is the most common structure in competitive chess, so a coach who teaches it well is improving most of their students\' games.',
            when: 'Immediately after the centre forms with a lone d4 or e4 pawn, and every time you move it forward.',
            whenNot: 'Not as a reason to trade pieces carelessly — the structure only creates a target if your pieces are placed for it.',
            coachMethod:
              'Build the plan in stages on the board, adding one piece at a time and asking "what does this piece do now?" That forces the student to see the plan as a sequence of placements rather than a vague idea. Then flip it: give the same position from the defending side and ask them to state the defensive plan (occupy c3, trade the active knight, exchange pieces off), because coaching means teaching both sides.',
            example: {
              student: 'Should I attack the pawn on d5?',
              coach:
                'Not the pawn — the square. Which of my pieces can stand on c4 and stay there? If the answer is the knight, then the knight\'s job is c4 and the pawn is just a reason for the square to matter.',
            },
            realGame:
              'Have the student label every move in a real isolani game as "attacking the square", "trading", or "pushing".',
          },
          mistakes: [
            'Attacking the isolani with a rook instead of occupying the square in front of it.',
            'Trading into doubled pawns and handing over the c-file.',
            'Pushing d5 too early without the knight on c3.',
            'Forgetting to bring a piece to the half-open file.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2N5/PP3PPP/R2Q1RK1 w - - 0 12',
            caption: 'The isolani plan in full: knight on c3, rook ready for the c-file, d5 to come — all built around the square c4.',
            highlight: ['c4', 'c3', 'd4', 'd5'],
            arrows: [['c3', 'c4'], ['c1', 'c4']],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2N5/PP3PPP/R2Q1RK1 w - - 0 12',
              prompt: 'Name the next three moves of the isolani plan and the square each one is aimed at.',
              solution:
                'Ne5 (or Nde1 to support d5), then d5 to gain space, then a piece to the c-file — every move serves the square c4. Naming the square explains the whole plan.',
              hint: 'Ask "which square is that move for?" after each one.',
            },
          ],
          teachBack: {
            brief: 'Teach the isolani plan as a sequence of placements, then as the defensive side.',
            required: [
              'attack the square in front of the isolani, not the pawn',
              'the knight on c3 and the half-open c-file are the pieces that do it',
              'push d5 only with the pieces already placed',
            ],
            lookFor: [
              'names the target square before naming any move',
              'can also state the defensive plan for the isolating side',
            ],
          },
          misconception: 'The student believes the isolated pawn is always bad and must immediately be traded or attacked.',
          puzzlePrompt:
            'Take a real isolani game and have the student mark every move that served the square c4.',
          test: [
            {
              q: 'What is the main target in an isolani position?',
              options: [
                'The isolated pawn itself',
                'The square directly in front of it',
                'The opposing king',
                'The open d-file',
              ],
              answer: 1,
              explain:
                'The pawn cannot be defended, so attacking it fails. The square in front of it can be occupied permanently, which is what wins.',
            },
            {
              q: 'Which piece is typically used to occupy the square in front of an isolani?',
              options: ['The rook', 'The knight', 'The bishop', 'The queen only'],
              answer: 1,
              explain:
                'A knight on c3 or c5 is secure because pawns cannot attack it and it controls the key squares. That is why knights dominate these positions.',
            },
          ],
        },
        {
          id: 'l5-pawnbreaks',
          name: 'Pawn Breaks',
          summary: 'The move that opens the position — and the moment to play it.',
          content: {
            definition:
              'A pawn break is a pawn move that opens lines and forces the position to open, typically ...d5 in the Sicilian, c4 or d4 in the centre, e4-e5 as a break, or f2-f4 in the King\'s Indian Attack. It converts a quiet structure into a mobile one.',
            deep:
              'The skill a coach has to teach is timing, because the break played one move early or late is the difference between a good opening and a lost game. The framework is: play the break when your pieces are on their best squares, when your opponent has just committed a piece and cannot take the pawn for free, and when you have something to open for yourself — not merely because the pawn is tired of standing still. Teach the counter-side too: restraining the break is often the opponent\'s real plan, and a coach must be able to explain "why can he not play d5 yet?" because that question decides many middlegames.',
            why: 'The break is the moment a positional game becomes concrete, and recognising it is how a coach explains a position moving from "slow" to "now something happens".',
            when: 'When the pawn in front of you is attacked twice, or when the position has enough space and piece placement to open.',
            whenNot: 'When it would lose a pawn without gaining anything, and not before your pieces are placed.',
            coachMethod:
              'Use the three-question timing test with a real position on the board: (1) are my pieces on their squares, (2) can he take the pawn for free, (3) what do I open? If any answer fails, the break is premature. Then flip the board and ask the student why *Black* cannot break yet — that question trains the defensive understanding a coach needs. Finally, show the same position one move earlier and later so the student feels the difference a break makes.',
            example: {
              student: 'Why can he not just play d5?',
              coach:
                'He can, but he should not yet — his knight is the only piece on that side and if I take, I am a pawn up with an open file. Look at his pieces. One more move and then the break is fine. That is what timing means.',
            },
            realGame:
              'Have the student identify the exact move of the break in a real game and explain why it was correct on that move and not the one before.',
          },
          mistakes: [
            'Playing the break before the pieces are placed.',
            'Playing the break when the pawn can be taken for free.',
            'Breaking to open lines for the opponent rather than for yourself.',
            'Missing the opponent\'s break entirely because you were counting material.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
            caption: 'The break that matters here is d4-d5, and the timing question is whether the pieces support it.',
            highlight: ['d4', 'd5', 'c6', 'f6'],
            arrows: [['d4', 'd5']],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
              prompt: 'Apply the three-question test to d4-d5 here. Should White break now?',
              solution:
                'The knight is on c3 and the bishop on f3, the position is closed but every piece supports d5, and the pawn cannot be taken for free because c6 and f6 do not control d5. All three answers support the break.',
              hint: 'Pieces placed, pawn defended, lines opened for you — three questions.',
            },
          ],
          teachBack: {
            brief: 'Teach break timing with a three-question test and the defensive counterpart.',
            required: [
              'the three questions: pieces placed, pawn not free, lines open for you',
              'restraining the opponent\'s break is often a real plan',
              'a break played early costs a pawn and gains nothing',
            ],
            lookFor: [
              'asks the test questions in order rather than guessing',
              'explains why the opponent cannot break *yet*',
            ],
          },
          misconception: 'The student believes a pawn break is good whenever a pawn is under attack, regardless of the rest of the position.',
          puzzlePrompt:
            'Take one position where the break is correct and one where it is one move early, and have the student explain the difference.',
          test: [
            {
              q: 'What is the first timing question for a pawn break?',
              options: [
                'How much material do I have?',
                'Are my pieces on their best squares?',
                'Is my king safe?',
                'What time is it?',
              ],
              answer: 1,
              explain:
                'A break only works if the pieces are placed to exploit the lines it opens. Pieces first, then the break.',
            },
            {
              q: 'Why might the opponent be unable to break yet?',
              options: [
                'They do not want to',
                'Their break pawn can be taken for free, or their pieces are not placed',
                'It is illegal',
                'They are losing material',
              ],
              answer: 1,
              explain:
                'Restraining a break is a real strategic task. If the pawn is undefended or the pieces are missing, the break loses material instead of opening the game.',
            },
          ],
        },
        {
          id: 'l5-filepairs',
          name: 'Rooks: Open Files & Rooks Behind Pawns',
          summary: 'Why a rook on an open file beats a rook behind a pawn — and the doubled-rook endgame idea.',
          content: {
            definition:
              'An open file has no pawns on it; a half-open file has enemy pawns only. A rook behind its own pawn is blocked but gains a temporary battery and the option to sacrifice for a passed pawn.',
            deep:
              'The rook rules are few but decisive, and a coach should state them cleanly. On an open file the rook attacks everything and is attacked only by pieces. Behind its own pawn it is safe from exchanges but cannot act, and that pawn is a temporary weakness rather than a wall — the standard plan is to advance it and connect the rooks on the next file. Rooks on the seventh rank are worth a special mention, because that rank cuts off enemy king retreats, which is why rooks there are often worth more than the material count suggests. Note the endgame principle too: two rooks on the seventh are stronger than the sum of the parts, and rook-and-pawn against a bare king is the classic winning method a coach must be able to teach.',
            why: 'Rook technique is where club players gain the most rating, because it is a matter of clear principles rather than intuition.',
            when: 'Whenever the centre or a flank opens, and especially in the endgame.',
            whenNot: 'Not by bringing the rooks to a file that the enemy pieces can dominate for free.',
            coachMethod:
              'Teach with three concrete positions: a rook on an open file, the same rook behind a pawn, and the same rook on the seventh rank. Have the student state the value difference each time in terms of what the rook can do. Then move to the endgame ladder — rook and pawn versus a lone king — where the technique is not intuition but a checkable procedure.',
            example: {
              student: 'Why is that rook worth more than the other one?',
              coach:
                'Not because it is a different piece. Because of what it attacks. One rook is behind a pawn, so it cannot do anything yet. The other is on the seventh, where it cuts off the whole king and covers c7. Same material, twice the work.',
            },
            realGame:
              'Have the student find a game where bringing a rook to the seventh rank decided the result.',
          },
          mistakes: [
            'Leaving a rook behind a pawn for several moves without advancing it.',
            'Forgetting that a rook on the seventh cuts off the king.',
            'Rushing the rook to a contested file where it can be attacked for nothing.',
            'Missing the rook-and-pawn technique against a bare king.',
          ],
          board: {
            fen: 'r4rk1/5ppp/8/8/8/8/5PPP/2R3RK w - - 0 1',
            caption: 'The rook on c7 cuts off the black king entirely. That is worth more than a piece in many positions.',
            highlight: ['c7', 'c8', 'f7', 'g7'],
            arrows: [['c1', 'c7']],
          },
          practice: [
            {
              fen: 'r4rk1/5ppp/8/8/8/8/5PPP/2R3RK w - - 0 1',
              prompt: 'What is the rook on c7 doing that the rook on g1 cannot?',
              solution:
                'It is cutting off the king on the eighth rank, which removes f7/g7 and any hope of counterplay, and it is attacking the c-file from a position where the pawns cannot dislodge it.',
              hint: 'Count the squares the enemy king can no longer reach.',
            },
          ],
          teachBack: {
            brief: 'Teach the three rook rules and the reason behind each.',
            required: [
              'open file: the rook attacks everything',
              'behind a pawn: safe but passive, so advance the pawn',
              'seventh rank: the rook cuts off the enemy king',
            ],
            lookFor: [
              'explains each rule by what the rook can attack rather than as a rule',
              'knows the rook-and-pawn technique against a bare king',
            ],
          },
          misconception: 'The student thinks a rook behind a pawn is safe and therefore fine where it is.',
          puzzlePrompt:
            'Set the same rook on three squares — open file, behind a pawn, seventh rank — and ask the student to rank them by usefulness.',
          test: [
            {
              q: 'What is the advantage of a rook on the seventh rank?',
              options: [
                'It is safer from exchanges',
                'It cuts off the enemy king, removing counterplay and often a source of material',
                'It can promote',
                'It controls the main diagonal',
              ],
              answer: 1,
              explain:
                'The seventh rank prevents the enemy king from escaping to its own pawns, which is why rook moves there often decide games.',
            },
            {
              q: 'What is the plan for a rook behind its own pawn?',
              options: [
                'Keep it there for safety',
                'Advance the pawn so the file opens, then activate the rook',
                'Move the rook to another flank',
                'Trade the rook',
              ],
              answer: 1,
              explain:
                'The pawn is a temporary wall, not a shelter. Advance it and the rook comes to life on the open file.',
            },
          ],
        },
      ],
    },
    {
      id: 'l5-m3',
      title: 'Explaining Positional Judgement',
      description: 'Teaching assessment without an engine — and with one.',
      topics: [
        {
          id: 'l5-explain',
          name: 'Explaining Positional Judgement',
          summary: 'Turning "this position is better" into a defensible sentence.',
          content: {
            definition:
              'Positional explanation is stating, in specific terms, which of your pieces is doing what better than the opponent\'s and what that produces. It replaces vague statements with a list of concrete advantages.',
            deep:
              'Most vague positional statements fail because they compare categories instead of pieces. "He has more space" is weak; "his knight on f5 controls the squares my bishop needs and my bishop cannot be redeployed because of the pawn structure" is strong. Coach the strong form by requiring a named piece, a named square, and a consequence for every claim. The consequence is the part students omit, and it is what turns an observation into a plan. Add the second discipline: say what the opponent could do about it, because an advantage the opponent can remove is not an advantage worth planning with.',
            why: 'Specific explanation is the difference between a student who understands a position and one who is guessing.',
            when: 'Every time you review a position with a student, in every lesson.',
            whenNot: 'Not as a substitute for calculation — a correct explanation of a position you miscalculated is still a loss.',
            coachMethod:
              'Apply the three-part rule: named piece, named square, named consequence. Reject any claim that cannot be completed. Then add the defensive check — "and what stops him doing that?" This is a hard exercise and it is the difference between a club player and a titled one, so do it every time even when it takes longer. When you disagree with a student, require the three parts from them before you give your own explanation.',
            example: {
              student: 'His bishop is better than my knight.',
              coach:
                'Why? Which squares does it control that your knight cannot reach, and what does that prevent me from doing? If you cannot finish that sentence, you do not yet know that his bishop is better — you are guessing.',
            },
            realGame:
              'Have the student re-explain a position they evaluated wrongly, this time completing all three parts.',
          },
          mistakes: [
            'Comparing categories instead of pieces.',
            'Stating an advantage without naming a consequence.',
            'Not checking what the opponent can do about it.',
            'Explaining a position after having miscalculated it.',
          ],
          board: {
            fen: '2rq1rk1/pp1n1ppp/2p1bn2/3p4/3P4/1BN1PN2/PPP2PPP/2RQ1RK1 w - - 0 12',
            caption: 'Two positions, one comparison. Ask which specific piece is doing more, and what that prevents.',
            highlight: ['d7', 'e6', 'c2', 'e3'],
            arrows: [],
          },
          practice: [
            {
              fen: '2rq1rk1/pp1n1ppp/2p1bn2/3p4/3P4/1BN1PN2/PPP2PPP/2RQ1RK1 w - - 0 12',
              prompt: 'Name one advantage of White in this position using the three-part rule.',
              solution:
                'Piece: the knight on c2. Square: d4, which it defends and attacks. Consequence: it makes the d4 pawn safe to push and removes Black\'s option of taking it, which is the whole plan for White here.',
              hint: 'Named piece, named square, named consequence.',
            },
          ],
          teachBack: {
            brief: 'Require the student to explain a positional advantage with the three-part rule.',
            required: [
              'name the specific piece, not a category',
              'name the specific square it affects',
              'name the consequence for the opponent',
            ],
            lookFor: [
              'completes all three parts without prompting',
              'checks what the opponent can do about the claimed advantage',
            ],
          },
          misconception: 'The student believes naming an advantage ("more space", "better bishop") is the same as explaining it.',
          puzzlePrompt:
            'Take a position from a student game and require three-part explanations of every advantage on the board.',
          test: [
            {
              q: 'What is the three-part rule for explaining an advantage?',
              options: [
                'Material, space, king safety',
                'Named piece, named square, named consequence',
                'Attack, defence, counter-attack',
                'Opening, middlegame, endgame',
              ],
              answer: 1,
              explain:
                'An explanation is only useful if it says which piece, on which square, and what it prevents. Categories are not explanations.',
            },
            {
              q: 'Why check what the opponent can do about an advantage?',
              options: [
                'To be polite',
                'Because an advantage the opponent can remove is not worth planning with',
                'To test their mood',
                'It is not necessary',
              ],
              answer: 1,
              explain:
                'If the opponent has a cheap fix, your plan does not exist. Checking is what stops a coach from teaching a fantasy position.',
            },
          ],
        },
      ],
    },
  ],
};