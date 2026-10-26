/**
 * Level 7 — Strategy & Game Planning.
 *
 * The hardest thing to teach in chess, because a plan is not a move or even a
 * goal — it is a sequence with a condition attached. Every topic here is built
 * around the idea that a plan must answer "and then what?" at every step.
 */
export default {
  n: 7,
  id: 'level-7',
  title: 'Strategy & Game Planning',
  tagline: 'A plan is a sequence, not a slogan.',
  description:
    'Planning as a discipline: find the problem, read the opponent, pick the break, decide the timing, and know which exchange to cash in.',
  finalTask: 'Create a complete strategic plan for complex middlegame positions.',
  finalExam: { title: 'Level 7 Final Exam', passMark: 80, sections: ['strategic', 'theory', 'teaching'] },
  competency: ['Strategic Skill', 'Calculation'],
  modules: [
    {
      id: 'l7-m1',
      title: 'The Planning Process',
      description: 'How a coach actually builds a plan in front of a student, out loud.',
      topics: [
        {
          id: 'l7-problem',
          name: 'Identify the Problem',
          summary: 'Every position has one problem. Finding it is 80% of planning.',
          content: {
            definition:
              'A position\'s problem is the single most important thing about it — the imbalance that decides the game. Finding it means asking: what is wrong with this position? For one side, something is better; for the other, something is worse.',
            deep:
              'The coaching discipline is to state the problem as a single sentence before naming any move, and the sentence must contain a comparison of pieces or pawns. "His knight is better than mine" is a problem. "I have space" is an observation, not a problem, until you say what the space does for you. The second discipline is asking the opposite question: what is the opponent\'s problem? Because a good plan often consists in making the opponent solve yours while you never have to solve theirs. Notice that this framing connects directly to the piece audit from Level 5 — the audit finds the problem, the plan addresses it.',
            why: 'Students who cannot name the problem cannot choose a plan, so they play "reasonable" moves that achieve nothing.',
            when: 'Immediately after the opening, before planning anything, and again whenever the position changes character.',
            whenNot: 'Not while there is a tactical obligation — you do not get to have a strategy until the tactics are settled.',
            coachMethod:
              'Require the one-sentence problem statement before any plan is discussed. Make it a ritual: "this position\'s problem is X, because Y". Where Y must be a specific comparison. If the student cannot produce Y, they have an observation and should go back to the board. Then ask the inverse question — the opponent\'s problem — because a plan that creates a problem for the opponent is stronger than a plan that fixes your own.',
            example: {
              student: 'What should I do here?',
              coach:
                'Before I answer that, tell me the problem in this position. Not a plan — the problem. One sentence, with a comparison in it. "His knight on c5 is doing more than mine on a3, and I cannot redeploy mine because of the b-pawn." Now we can plan.',
            },
            realGame:
              'Have the student write the one-sentence problem for ten positions from their own games.',
          },
          mistakes: [
            'Starting with a move instead of a problem.',
            'Stating an observation ("I have space") instead of a comparison.',
            'Forgetting to ask what the opponent\'s problem is.',
            'Planning while a tactic is hanging.',
          ],
          board: {
            fen: 'r1bq1rk1/pp2nppp/2p1pn2/3p4/3P4/1P1PN3/P1P2PPP/R1BQNRK1 b - - 0 10',
            caption: 'The problem in one sentence: White\'s pieces on the second rank are passive, and Black\'s knight is active.',
            highlight: ['e6', 'e3', 'c6', 'e4'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bq1rk1/pp2nppp/2p1pn2/3p4/3P4/1P1PN3/P1P2PPP/R1BQNRK1 b - - 0 10',
              prompt: 'State the problem of this position in one sentence with a comparison in it.',
              solution:
                'The black knight on e6 is active and covers d4 and c5, while White\'s knight on e3 is tied to defending d4. The problem is White\'s restricted knight, not Black\'s material.',
              hint: 'One sentence, and it must compare two pieces.',
            },
          ],
          teachBack: {
            brief: 'Require a one-sentence problem statement with a comparison before discussing any plan.',
            required: [
              'a problem is a comparison of two pieces or pawns',
              'an observation is not a problem until you say what it does for you',
              'also ask what the opponent\'s problem is',
            ],
            lookFor: [
              'produces the sentence unprompted',
              'reframes the position as the opponent\'s problem when that is truer',
            ],
          },
          misconception: 'The student believes a plan can be chosen directly without knowing what the position\'s problem is.',
          puzzlePrompt:
            'Take three positions and have the student write the problem sentence for each before being allowed to suggest a move.',
          test: [
            {
              q: 'What is a position\'s "problem"?',
              options: [
                'Its material count',
                'The single imbalance that decides the game, usually a piece comparison',
                'The most complicated tactic available',
                'The move the engine suggests',
              ],
              answer: 1,
              explain:
                'Finding the problem is most of planning. Material count is not a problem; a comparison between two pieces is.',
            },
            {
              q: 'Why ask what the opponent\'s problem is?',
              options: [
                'To be helpful',
                'Because a plan that creates a problem for the opponent is stronger than one that fixes your own',
                'Because they will tell you',
                'It is a formality',
              ],
              answer: 1,
              explain:
                'Planning becomes much easier when you are improving your position while your opponent has to solve a growing problem.',
            },
          ],
        },
        {
          id: 'l7-sequence',
          name: 'Plans as Sequences',
          summary: 'A plan is a chain of "and then what" — and each link needs a condition.',
          content: {
            definition:
              'A strategic plan is a sequence of moves where each move prepares a later one. A complete plan states not just the goal but the ordered moves that achieve it, each with the condition under which it works.',
            deep:
              'The test of whether a student has a plan is simple and brutal: ask them to name the next three moves. If they can name the goal but not the moves, they have an intention, not a plan. Then require the harder part — the condition. "I want to play c4" is not a plan. "I want to play c4, and then bring the knight to d5, and that works as long as he does not play e5 first" is a plan, because it tells you what to do when the position changes. Teaching the conditional explicitly is what separates a club player from someone who says they know what they are doing.',
            why: 'Plans that cannot be expressed as moves are aspirations, and aspirations do not win games.',
            when: 'Whenever you tell a student what to do next, and whenever you review a game with a stated intention.',
            whenNot: 'Not in the endgame without work, where technique rather than sequence decides the result.',
            coachMethod:
              'Insist on the three-move test: name the next three moves and the condition on each. This is cheap to apply and immediately exposes whether the student actually understands the plan or has merely absorbed a slogan. Build it into lesson notes so each plan is written as "move → move → move, unless X". Then, crucially, check the plan after the first move is played, because plans die at the first move that changes the position — and that is where a coach has to intervene.',
            example: {
              student: 'My plan is to attack the king.',
              coach:
              'Name the next three moves. Not the goal — the moves. Which square does the bishop go to, which knight, in what order? And if he plays ...c5, does your plan survive? If you cannot answer, you do not have a plan.',
            },
            realGame:
              'Have the student write three-move sequences with conditions for ten positions.',
          },
          mistakes: [
            'Having a goal without a sequence of moves.',
            'Not stating what happens if the opponent interferes.',
            'Abandoning a plan at the first change of position.',
            'Confusing what you want to happen with what you will do.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
            caption: 'The plan is not "attack". It is: Ne5, then d5, then the knight to c4 — with a condition on each.',
            highlight: ['e5', 'd5', 'c4'],
            arrows: [['f3', 'e5'], ['d4', 'd5']],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
              prompt: 'Name the next three moves of your plan here, and the condition attached to each.',
              solution:
                '1. Ne5 (supported by the d-pawn; if ...dxe5, then dxe5 wins the exchange back and I keep the open file). 2. d5 (only if the knight is on e5; otherwise I gain nothing). 3. Nd7 or Nc4 to keep the outpost. Three moves, three conditions.',
              hint: 'Move → move → move, unless X.',
            },
          ],
          teachBack: {
            brief: 'Apply the three-move test to the student\'s stated plan.',
            required: [
              'name the next three moves, not just the goal',
              'attach a condition to each move',
              're-check the plan after the first move is played',
            ],
            lookFor: [
              'produces the three moves without help',
              'names the condition under which the plan fails',
            ],
          },
          misconception: 'The student believes knowing the goal is the same as having a plan.',
          puzzlePrompt:
            'Take a position where the plan changes after the first move and have the student write both branches.',
          test: [
            {
              q: 'What is the three-move test?',
              options: [
                'Calculate three moves ahead',
                'Name the next three moves of the plan and the condition attached to each',
                'Play three moves in a row',
                'Check three squares',
              ],
              answer: 1,
              explain:
                'If a student cannot name the next three moves, they have an intention rather than a plan. That is the fastest diagnostic there is.',
            },
            {
              q: 'When should a plan be re-checked?',
              options: [
                'Only at the end of the game',
                'After the first move is played, because the position will have changed',
                'Only after a capture',
                'Never — plans should be followed',
              ],
              answer: 1,
              explain:
                'Plans are conditional by nature. Re-checking after the first move is exactly when a coach prevents a plan from being followed into a worse position.',
            },
          ],
        },
      ],
    },
    {
      id: 'l7-m2',
      title: 'Strategic Operations',
      description: 'The specific strategic manoeuvres a coach must be able to name and explain.',
      topics: [
        {
          id: 'l7-exchange',
          name: 'The Exchange Up or Down',
          summary: 'Choosing to trade for the minor piece — and when it is the right trade.',
          content: {
            definition:
              'Taking the exchange (trading a minor piece for a rook) is normally bad, because a minor piece is worth more than a rook. The exceptions are structural: locked pawn chains, doubled or isolated pawns on one side, a bishop facing a knight in a favourable endgame, or bad king placement on the rook\'s side.',
            deep:
              'This is one of the most common real strategic decisions, and it is a decision, not an accident. The value order of pieces is a rule of thumb; the exchange is where it visibly fails, which is why a coach must be able to explain it precisely rather than say "exchange up when your pawns are fixed". Note also the endgame context: if the position is heading to a fixed structure, bishops can be worth much more than knights, and a rook can be trapped by its own uncastled king. Teach the decision as a question set — are our pawns fixed? are theirs doubled? is my king safe? is the endgame favourable? — and require the student to answer all four before accepting the trade. Add the counter-case: sometimes you should give the exchange *back* to reach a bishop endgame.',
            why: 'It is the decision where positional understanding shows up most clearly, and getting it wrong costs games at every level.',
            when: 'When one side has a locked pawn chain or doubled pawns, or a badly placed king.',
            whenNot: 'Not when your own pawns are fixed and your king is safe — that is the normal case for refusing the trade.',
            coachMethod:
              'Present four positions with the same trade on offer and four different answers, each justified by a different one of the conditions. That teaches the decision rather than the slogan. Then reverse it: give a position where the student should *give* the exchange to reach a bishop endgame, which is the case almost nobody teaches. Insist on the four questions, in order, before the trade is allowed.',
            example: {
              student: 'I am a rook up after trading my knight for his rook. Is that good?',
              coach:
                'Ask the four questions. Are his pawns doubled? Are they locked? Is his king stuck in the centre? What endgame is coming? If the answer is "no, no, yes, and the bishops are fixed", then yes — a rook for a knight is a good trade. If none of those, you simply gave away half a point.',
            },
            realGame:
              'Have the student review every exchange trade in their games and state the four-question answer.',
          },
          mistakes: [
            'Taking the exchange with no structural justification.',
            'Assuming rook-minor is always bad without checking the conditions.',
            'Missing the case where giving the exchange reaches a favourable endgame.',
            'Not noticing a locked structure that makes the trade good.',
          ],
          board: {
            fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
            caption: 'A locked structure decides whether the rook-minor trade is right. Count the pawns before deciding.',
            highlight: ['d4', 'd5', 'e4'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
              prompt: 'What structure would have to exist for a knight to be traded for a rook on a good exchange?',
              solution:
                'Locked pawn chains, doubled or isolated pawns on the rook side, a trapped king, or a fixed structure where bishops are strong. Without one of these the trade simply loses half a point of material.',
              hint: 'Four questions: fixed pawns, doubled pawns, king safety, endgame.',
            },
          ],
          teachBack: {
            brief: 'Teach the four-question test for trading the exchange, in both directions.',
            required: [
              'rook for minor is normally a loss of half a point',
              'locked chains, doubled pawns, trapped king, or favourable endgame justify it',
              'sometimes you should give the exchange to reach a bishop endgame',
            ],
            lookFor: [
              'answers all four questions before approving the trade',
              'recognises the case where giving the exchange is correct',
            ],
          },
          misconception: 'The student believes trading a knight for a rook is always wrong, regardless of structure.',
          puzzlePrompt:
            'Build two positions with the same trade available where one side should take and the other should refuse.',
          test: [
            {
              q: 'Which condition can make trading a minor piece for a rook correct?',
              options: [
                'It is the endgame',
                'Locked pawn chains, doubled pawns on the rook side, or a trapped king',
                'The rook is on an open file',
                'The opponent is weaker',
              ],
              answer: 1,
              explain:
                'The exchange is bad because of position, not because of piece labels. Remove the positional factors and it is simply a bad trade.',
            },
            {
              q: 'Which question is NOT part of the exchange test?',
              options: [
                'Are the pawns fixed?',
                'Are there doubled pawns?',
                'Is the king safe and out of contact?',
                'Is this the Queen\'s Gambit?',
              ],
              answer: 3,
              explain:
                'Opening name is not one of the four conditions. The test is about pawns, king placement and endgame prospects.',
            },
          ],
        },
        {
          id: 'l7-knights',
          name: 'Knight Pair vs Bishop Pair',
          summary: 'The endgame-style judgement hiding inside a middlegame decision.',
          content: {
            definition:
              'Knight pairs and bishop pairs are close to equal in the middlegame, but the endgame differs sharply. Two knights are strong against fixed pawns; the bishop pair is strong in open positions and against bad knight bishops.',
            deep:
              'The strategic content of this topic is that the value of pieces depends on the endgame you are heading toward, and a good plan accounts for that now. A player who knows the game will end with fixed pawns may prefer to trade bishops for knights early, before the pawns fix — which is a deep idea and a great coaching lesson. Warn about the three things that actually decide the knight endgame: fixing the opponent\'s pawns, keeping your own pawns mobile so they cannot be attacked, and using the c- and f-files. Note also the common beginner assumption that "two knights are weak", which is false and costs students real games.',
            why: 'It teaches long-term thinking and gives a concrete reason to consider the endgame during the middlegame.',
            when: 'When the position is heading toward fixed pawns, or when trading off pieces.',
            whenNot: 'Not when pawns will keep moving — in that case the bishop pair is the better asset.',
            coachMethod:
              'Show the endgame positions first so the student sees the effect, then walk backwards to the middlegame trade that caused it. Backwards teaching works well here because the student already believes the endgame result and can be asked "what should you have done twenty moves ago to reach it?" That question teaches planning, not memorisation. Pair it with the three knight-endgame principles so the technique is available, not just the judgement.',
            example: {
              student: 'Two knights are weaker, right?',
              coach:
                'Show me the pawns. Are they fixed? If his pawns cannot move and yours can, two knights win. "Two knights are weak" is a rule you learned without the condition attached, and the condition is the whole lesson.',
            },
            realGame:
              'Have the student identify a game where the knight endgame was decided, and work out which middlegame choice led there.',
          },
          mistakes: [
            'Believing two knights are always weak.',
            'Trading bishops for knights without checking whether the pawns will fix.',
            'Missing the role of the c-file and f-file in knight endgames.',
            'Keeping your own pawns fixed, which helps the knight pair.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/8/N3N1K1 w - - 0 1',
            caption: 'Two knights: equal material, but the endgame value depends entirely on whether the pawns are fixed.',
            highlight: ['a1', 'd1'],
            arrows: [],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/8/8/N3N1K1 w - - 0 1',
              prompt: 'What is the first thing to establish in a knight endgame?',
              solution:
                'Whether the opponent\'s pawns can move. If they are fixed, the knight pair is excellent; if they can advance, the bishop pair is usually better. The pawns decide which pair is stronger.',
              hint: 'Ask about the pawns before anything else.',
            },
          ],
          teachBack: {
            brief: 'Teach the knight pair endgame and trace it back to the middlegame decision.',
            required: [
              'fixed pawns make two knights strong, mobile pawns favour the bishop pair',
              'the c-file and f-file are the key files in knight endgames',
              'keep your own pawns mobile so they cannot be attacked',
            ],
            lookFor: [
              'checks pawn mobility before judging the pair',
              'can name the middlegame trade that led to the endgame',
            ],
          },
          misconception: 'The student believes two knights are inferior without the fixed-pawns condition attached.',
          puzzlePrompt:
            'Take one knight endgame that is drawn and one that is won by knights, and identify what changed in the pawn structure.',
          test: [
            {
              q: 'Two knights are strongest when:',
              options: [
                'The position is open',
                'The opponent\'s pawns are fixed on one wing',
                'Both bishops are lost',
                'The opponent has castled short',
              ],
              answer: 1,
              explain:
                'Knights attack fixed targets. Once the pawns cannot move, there are no targets for a bishop and permanent squares for a knight.',
            },
            {
              q: 'Which file is most important in a knight endgame?',
              options: ['The a-file', 'The c-file and the f-file', 'The g-file', 'The 4th rank only'],
              answer: 1,
              explain:
                'The c- and f-files give the knight entry squares and the passer safe promotion squares. Kings try to stop them.',
            },
          ],
        },
        {
          id: 'l7-pieces',
          name: 'Piece Placement',
          summary: 'The art of putting a piece somewhere for a reason you can name.',
          content: {
            definition:
              'Piece placement is deciding where each piece should stand given the position\'s requirements — active squares, outposts, protected advanced pawns, squares that support an attack, and squares that avoid being attacked. The question is never "where is it nice" but "what does it do there".',
            deep:
              'Every good placement has a named function, and a coach should require the name. A knight on c5 is active because it controls b7, d7 and e6; a bishop on b2 is safe but pointless; a rook on the open d-file is attacking; a pawn on b4 is a target and a space gain. The useful teaching framework is a short list of *functions* rather than a long list of squares, because squares are position-specific and functions are general. Then add the highest-level placement idea, which is to place pieces for the endgame and the attack at the same time where possible — a knight on an outpost is both an attacking piece and an endgame piece, which is why outposts are the most valuable squares in chess.',
            why: 'Strong players win most of their games through placement rather than tactics, and placement is directly teachable.',
            when: 'After every exchange and every pawn break, since the requirements change.',
            whenNot: 'Not while a tactic requires a piece elsewhere.',
            coachMethod:
              'Build a "functions" checklist for the coach\'s own board and use it in every lesson: which piece needs a better square, which square is the most valuable on the board, which of my pieces is defending an undefended piece, which of the opponent\'s pieces has nothing to do. Then require the student to name the function of each piece they place. Refusing placements without a stated function is the single most effective habit a coach can install, and it takes only a sentence.',
            example: {
              student: 'I moved my knight here.',
              coach:
                'What does it do there? Give me the function, not the square. If the answer is "it is safer", then you have moved it for a reason you have not thought about. If the answer is "it attacks d5 and is protected by the c-pawn", then that is placement.',
            },
            realGame:
              'Have the student name the function of every piece in their last game at the moment of each placement.',
          },
          mistakes: [
            'Moving pieces for aesthetic reasons with no stated function.',
            'Placing pieces passively and calling it safe.',
            'Missing the value of an outpost for both attack and endgame.',
            'Never re-evaluating placement after exchanges.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
            caption: 'The knight on c3 is doing three jobs at once: pressuring d5, controlling c5, and heading for an outpost.',
            highlight: ['c3', 'd5', 'c5'],
            arrows: [['c3', 'c4']],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
              prompt: 'Name three functions the knight on c3 is performing in this position.',
              solution:
                'It pressures d5 (attacking the isolated pawn), it controls c5 so Black cannot create an outpost there, and it heads for the c4 square as a permanent home. Three functions from one placement.',
              hint: 'Function, not square. What does it do?',
            },
          ],
          teachBack: {
            brief: 'Refuse placements that have no stated function and work through a functions checklist.',
            required: [
              'every placement needs a named function',
              'outposts serve attack and endgame simultaneously',
              'placement requirements change after exchanges and breaks',
            ],
            lookFor: [
              'names the function before making the move',
              're-evaluates placement after each major change in the position',
            ],
          },
          misconception: 'The student believes there is a list of good squares to memorise, rather than a set of functions to apply.',
          puzzlePrompt:
            'Take a position and ask the student to name the single most valuable square and what function it serves.',
          test: [
            {
              q: 'What question should you ask before placing a piece?',
              options: [
                'Is this square safe?',
                'What function does the piece serve there?',
                'Is this where the piece usually goes?',
                'Is it my favourite square?',
              ],
              answer: 1,
              explain:
                'Squares are position-specific; functions are general. Naming the function is what makes placement teachable and repeatable.',
            },
            {
              q: 'Why is an outpost the most valuable square on the board?',
              options: [
                'It is far from the action',
                'The piece there is secure, contributes to the attack, and is a permanent endgame asset',
                'It gives check',
                'It is a light square',
              ],
              answer: 1,
              explain:
                'An outpost is secure against pawn challenges, so the piece works twice — once in the attack and once in the endgame.',
            },
          ],
        },
        {
          id: 'l7-timing',
          name: 'Timing',
          summary: 'The hardest strategic skill: the right move, at the wrong time, is a mistake.',
          content: {
            definition:
              'Timing is the discipline of choosing when to make the move your position calls for — early enough to be effective, late enough to be prepared. It covers breaks, attacks, exchanges, and king walks.',
            deep:
              'Timing is where strategic understanding becomes difficult, because the same move can be right or wrong depending on when it is played, and the difference is often invisible. Teach it through a small number of paired positions: the break one move early and one move late, the exchange before the endgame is ready and after, the attack before the pieces are placed. In each pair the student should be able to say what the one-move difference cost. Then introduce the underlying discipline: before every strategic move, ask what the opponent can do if it is not prepared — because that is what "too early" means. Also teach the concept of being the last to commit, which is a real strategic advantage in many structures.',
            why: 'It is the difference between a player who knows the ideas and a player who wins them.',
            when: 'Before every break, attack, exchange and pawn-structure change.',
            whenNot: 'Not as a reason to delay forever — timing means prepared, not late.',
            coachMethod:
              'Use paired positions one move apart. Set up "break now" and "break next move" and ask what goes wrong in each. That single-move comparison makes timing concrete in a way that no definition does. Then apply the preparation question as a rule: before any strategic move, name what the opponent could do if you are not ready. If the student cannot name something, the move may be fine; if they always can, they will learn the timing themselves.',
            example: {
              student: 'Why can I not break yet?',
              coach:
                'Ask yourself what he can do. If he can take the pawn, then breaking now is early. Count what each side needs to prepare: I need my knight on c3, you need your knight on c6. Whoever is one move ahead of that is breaking on time.',
            },
            realGame:
              'Have the student identify the correctly-timed and incorrectly-timed break in each of five games.',
          },
          mistakes: [
            'Breaking before your pieces are placed.',
            'Trading before the endgame favours you.',
            'Starting an attack before the battery is assembled.',
            'Never delaying a move that is genuinely better prepared.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
            caption: 'The break d5 is right on this move because the knight supports it. One move earlier, it is a lost pawn.',
            highlight: ['d4', 'd5', 'c3', 'c6'],
            arrows: [['d4', 'd5']],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
              prompt: 'Why is d4-d5 correctly timed here but would be premature a move earlier?',
              solution:
                'Because the knight on c3 is already there to support d5 and to recapture if Black takes. A move earlier the knight was undeveloped, so d5 would have been a lost pawn.',
              hint: 'Ask what he can do if you break.',
            },
          ],
          teachBack: {
            brief: 'Teach timing through paired positions one move apart.',
            required: [
              'before a strategic move, name what the opponent can do if it is unprepared',
              'compare the move and the same move one turn earlier',
              'being prepared is the goal — being late is not',
            ],
            lookFor: [
              'explains the one-move difference rather than repeating the rule',
              'identifies what the opponent could do if the move were premature',
            ],
          },
          misconception: 'The student believes timing means always waiting, and delays moves that should be made immediately.',
          puzzlePrompt:
            'Take one break and show the position three moves before, one move before and after. Ask what each delay cost.',
          test: [
            {
              q: 'What question identifies a premature strategic move?',
              options: [
                'Is it my best move?',
                'What can the opponent do if I am not prepared for it?',
                'How much material does it win?',
                'Is it in a book?',
              ],
              answer: 1,
              explain:
                'Naming what the opponent can do against an unprepared move is the operational meaning of "too early".',
            },
            {
              q: 'Timing means:',
              options: [
                'Always playing the move later',
                'Playing the move when your pieces are prepared for it',
                'Winning the race to move first',
                'Moving pieces back to their squares',
              ],
              answer: 1,
              explain:
                'Prepared is the goal. Being the last to commit is often useful; simply being late is not.',
            },
          ],
        },
        {
          id: 'l7-attack',
          name: 'Attack Building & Defence',
          summary: 'Assembling an attack piece by piece, and dismantling one before it starts.',
          content: {
            definition:
              'Attacking a king is an assembly problem: remove the defenders of the key squares, remove the cover of the king, bring enough pieces to bear, then break through. Defending is the same problem in reverse.',
            deep:
              'A useful way to teach attack building is to count pieces. A successful attack usually needs four things bearing: a piece to open the file, a piece to occupy the key square, a piece to support the sacrifice, and one more piece for the final blow. When students attack with two pieces, they are usually hoping; with four, they are usually winning. The defensive counter is equally teachable: a defender needs to open a line, trade the attacker\'s most dangerous piece, create a counter-attack, or move the target. The most underrated defensive resource is a counter-attack on the other king, because it forces the attacker to respond to a threat rather than continue.',
            why: 'Attack building explains why some attacks feel forced and others never get going, and it gives a concrete way to fix both.',
            when: 'When the enemy king is weak, or when you have just been attacked.',
            whenNot: 'Not with insufficient pieces, and not before the pawn cover has been opened.',
            coachMethod:
              'Build the attack in front of the student, adding one piece at a time and asking after each "what does this piece now do for the attack?". When the student can add the pieces themselves, they can also recognise the same assembly in real games. Then run the defensive exercise: give them an attacking position and ask them to assemble a defence using the four defensive resources. That exercise is more instructive than any attack lesson, because it forces them to see the position from the defending side.',
            example: {
              student: 'I am attacking his king.',
              coach:
                'How many of your pieces bear on the king? Three is usually not enough. What is your key square, and who occupies it? Until you can answer those two questions, you are not attacking — you are hoping.',
            },
            realGame:
              'Have the student annotate a real attack with the pieces that bear on it, and the missing pieces.',
          },
          mistakes: [
            'Attacking with only two pieces.',
            'Ignoring the defenders of the key squares.',
            'Continuing an attack instead of answering a counter-attack.',
            'Attacking before the pawn cover has been opened.',
          ],
          board: {
            fen: '3r2k1/pp3ppp/8/8/8/8/PP3PPP/3R2RK w - - 0 1',
            caption: 'Both sides have open lines. The side whose pieces actually bear on the enemy king wins the argument.',
            highlight: ['d1', 'd8', 'g1', 'g8'],
            arrows: [['d1', 'd8']],
          },
          practice: [
            {
              fen: '3r2k1/pp3ppp/8/8/8/8/PP3PPP/3R2RK w - - 0 1',
              prompt: 'Which pieces bear on each king here, and which side has the real pressure?',
              solution:
                'The rooks bear on open files, but neither king is weak enough for that to be an attack yet. The side that brings a second and third piece and fixes the pawns in front of the king starts the real attack.',
              hint: 'Count the pieces bearing on the king, not the number of open lines.',
            },
          ],
          teachBack: {
            brief: 'Teach attack assembly with a piece count and the defensive counter-exercise.',
            required: [
              'an attack needs roughly four pieces bearing on the king',
              'key squares must be occupied and the pawn cover opened',
              'the defensive resources are: open a line, trade, counter-attack, move the target',
            ],
            lookFor: [
              'counts the pieces bearing on the king before claiming an attack',
              'can assemble a defence from the defending side',
            ],
          },
          misconception: 'The student believes one open file plus a weak king is an attack.',
          puzzlePrompt:
            'Take an attacking position where the attack fails and add the one piece that would have completed it.',
          test: [
            {
              q: 'Roughly how many pieces should bear on the king for an attack to succeed?',
              options: [
                'Two', 'Three', 'Four', 'Six',
              ],
              answer: 2,
              explain:
                'A successful attack usually needs an opener, a piece on the key square, support for the sacrifice, and a final blow. Two pieces is a hope.',
            },
            {
              q: 'What is the most underrated defensive resource?',
              options: [
                'Castling',
                'A counter-attack on the enemy king',
                'Promoting a pawn',
                'Trading queens',
              ],
              answer: 1,
              explain:
                'A counter-attack forces the attacker to spend a tempo defending rather than continuing, which is often enough to defuse the whole attack.',
            },
          ],
        },
        {
          id: 'l7-planning-weak',
          name: 'Exploiting a Weak Square',
          summary: 'Turning one static weakness into a decisive attack, step by step.',
          content: {
            definition:
              'Exploiting a weak square means converting a positional weakness — typically a hole — into material or mate by increasing the pressure until the defender must give ground.',
            deep:
              'This is the topic where planning becomes a sequence with a visible finish line, and it is the best material for teaching planning to a student who struggles with open-ended strategy. The method is four pressure steps: occupy the square with a protected piece, open a second line onto it, bring a third piece to bear, and then either force an exchange that leaves the square permanently or sacrifice for mate. Each step is a concrete move with a function, and each step is checkable by the opponent\'s answer, which makes it a plan a student can execute. Add the discipline of not giving up the pressure: the moment the square is attacked from two directions the defender will trade the piece off and repair it, so the third piece is what makes the pressure permanent.',
            why: 'It converts an abstract weakness into a teachable sequence, which is what students actually need.',
            when: 'When the opponent has a permanent weak square and you have a piece that can occupy it.',
            whenNot: 'Not when the defender can simply trade the attacking piece away in one move.',
            coachMethod:
              'Run the four-step ladder explicitly and have the student name which step each move represents. Then remove the third piece from the ladder and show how the defence repairs the square — that demonstration is what teaches why the third piece is necessary. Finally, give the student the defending side: a position with a hole and ask them to find the repair, which is the skill they will need in their own games.',
            example: {
              student: 'I am attacking the weak square but nothing happens.',
              coach:
                'How many pieces bear on it? If one, he trades it off and the square is repaired. Add a second line, then a third piece, and then he cannot repair it. Weak squares are won by pressure count, not by patience.',
            },
            realGame:
              'Have the student identify a hole in a master game and write out the four-step ladder as it was played.',
          },
          mistakes: [
            'Attacking a weak square with one piece and letting it be traded away.',
            'Never adding a second line of attack.',
            'Missing the moment to trade the attacker off and repair the square.',
            'Abandoning the pressure once it produces no immediate gain.',
          ],
          board: {
            fen: 'r1bq1rk1/pp1n1ppp/2p1pn2/3p4/3P4/2NP1N2/PP3PPP/R1BQ1RK1 w - - 0 10',
            caption: 'd5 is the weak square. White needs a protected piece on it, a second line, and then a third bearing piece.',
            highlight: ['d5', 'c3', 'e7', 'f6'],
            arrows: [['c3', 'd5']],
          },
          practice: [
            {
              fen: 'r1bq1rk1/pp1n1ppp/2p1pn2/3p4/3P4/2NP1N2/PP3PPP/R1BQ1RK1 w - - 0 10',
              prompt: 'Which square is weak here, and what is the first step of the four-step ladder?',
              solution:
                'd5 is weak because no black pawn defends it. The first step is to occupy it with a protected piece — here the knight, which black cannot challenge with a pawn.',
              hint: 'Occupied first, second line second, third piece last.',
            },
          ],
          teachBack: {
            brief: 'Teach the four-step ladder and its defensive counter.',
            required: [
              'step 1: a protected piece on the square',
              'step 2: a second line bearing on it, step 3: a third piece',
              'the defence is to trade the attacking piece and repair the square',
            ],
            lookFor: [
              'names which step a move represents',
              'can find the defensive repair from the defending side',
            ],
          },
          misconception: 'The student believes persistent pressure on a weak square alone will eventually win.',
          puzzlePrompt:
            'Take a position with a hole and remove the third bearing piece, so the student can see the defence succeed.',
          test: [
            {
              q: 'What is the first step in exploiting a weak square?',
              options: [
                'Sacrificing a piece onto it',
                'Occupying it with a protected piece',
                'Playing a check nearby',
                'Opening a second line immediately',
              ],
              answer: 1,
              explain:
                'A protected piece makes the pressure permanent. Then you add lines so it cannot simply be traded away.',
            },
            {
              q: 'How does the defender usually repair a weak square?',
              options: [
                'By trading the attacking piece off and re-defending it',
                'By castling',
                'By promoting a pawn',
                'By opening the centre',
              ],
              answer: 0,
              explain:
                'Trade the piece on the square and the weakness disappears. That is exactly why the third bearing piece matters.',
            },
          ],
        },
        {
          id: 'l7-planning-exch',
          name: 'Deciding an Exchange',
          summary: 'The two-exchange trade: giving up the exchange to reach a better endgame.',
          content: {
            definition:
              'Giving up the exchange (trading a rook for a minor piece) to reach a favourable endgame — typically to win a pawn endgame, or to activate a bishop — is a legitimate strategic choice when the endgame is clearly won even after giving up material.',
            deep:
              'This is the mirror image of Level 7\'s first topic and a valuable pairing. The decision is only sound when the endgame is not merely favourable but *won*, because you are starting two points down in rook terms. The test is concrete: can you state the winning technique in the resulting endgame, and can your opponent prevent it? If the endgame is won by a specific technique — passed pawn, king and pawn versus king, opposite-coloured bishop endgame you can draw but not lose — then the trade is sound. Warn about the trap that most often makes it unsound: taking the exchange in a position where the opponent\'s minor pieces coordinate well in the middlegame, which converts a won endgame into an uneventful draw.',
            why: 'It teaches endgame thinking during the middlegame and gives students permission to give up material deliberately.',
            when: 'When the resulting endgame is won by a known technique and the opponent cannot prevent it.',
            whenNot: 'Not when the opponent\'s minor pieces will coordinate in the open middlegame.',
            coachMethod:
              'Teach with concrete winning endgames. Set up "white to move, won pawn endgame" and ask: what would you give to reach it? Then find the middlegame position where that trade is available and correct, and the near-miss where it is wrong because the opponent coordinates. The pairing teaches the boundary. Require the student to name the winning technique before allowing the trade, exactly as with a justified sacrifice.',
            example: {
              student: 'Should I take the exchange?',
              coach:
                'You will be a pawn up in a rook endgame with a passed passer and an active king. Now — what is my winning technique? If you can name it, take the exchange. If you cannot name it, you are just giving away material.',
            },
            realGame:
              'Have the student find a real exchange-up trade and state the winning technique that justified it.',
          },
          mistakes: [
            'Taking the exchange for a merely favourable, not won, endgame.',
            'Allowing the opponent\'s minor pieces to coordinate in the open position.',
            'Being unable to name the winning technique.',
            'Taking the exchange when it improves nothing.',
          ],
          board: {
            fen: '8/5pk1/8/5p2/5P2/8/6PK/8 w - - 0 1',
            caption: 'A won pawn endgame: the passer and the king are the technique. Sometimes this is worth two rook-minor points.',
            highlight: ['f4', 'f5', 'g3'],
            arrows: [['g3', 'f4']],
          },
          practice: [
            {
              fen: '8/5pk1/8/5p2/5P2/8/6PK/8 w - - 0 1',
              prompt: 'What is the winning technique here, and would you take a rook for a knight to reach it?',
              solution:
                'The king supports the passer on f4 while Black\'s king is cut off. Yes — if a trade gets me this position with Black to move, that is a won pawn endgame worth two points in rook-minor terms.',
              hint: 'Name the technique before you decide.',
            },
          ],
          teachBack: {
            brief: 'Teach taking the exchange up with the requirement to name the winning technique first.',
            required: [
              'the exchange-up trade is only sound if the endgame is won',
              'name the winning technique before taking',
              'check that the opponent cannot coordinate in the middlegame',
            ],
            lookFor: [
              'names the technique before approving the trade',
              'recognises the near-miss where coordination saves the opponent',
            ],
          },
          misconception: 'The student believes giving up the exchange is always wrong because rook beats minor.',
          puzzlePrompt:
            'Give the student a won pawn endgame and ask what they would give to reach it.',
          test: [
            {
              q: 'When is taking the exchange up correct?',
              options: [
                'When the position is open',
                'When the resulting endgame is won by a technique you can name',
                'When you are behind in development',
                'Never',
              ],
              answer: 1,
              explain:
                'You are starting two points down, so the endgame must be clearly won and you must be able to say how.',
            },
            {
              q: 'What makes such a trade often unsound in practice?',
              options: [
                'The passer is too slow',
                'The opponent\'s minor pieces coordinate in the open middlegame before the endgame',
                'The rook is on the wrong square',
                'There is no pawn left',
              ],
              answer: 1,
              explain:
                'Two knights coordinating in the open position can hold the draw that the trade was supposed to avoid.',
            },
          ],
        },
      ],
    },
  ],
};