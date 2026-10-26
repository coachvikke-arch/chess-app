/**
 * Level 8 — Endgame Coaching.
 *
 * Endgame technique is the most teachable area in chess, because the winning
 * methods are checkable: if the student follows the technique, they win; if
 * they deviate, they lose. That checkability is what makes this level
 * teachable as a six-step procedure rather than as intuition.
 */
export default {
  n: 8,
  id: 'level-8',
  title: 'Endgame Coaching',
  tagline: 'Technique, not intuition.',
  description:
    'Pawn, rook, minor-piece and queen endgames organised as setup to test, so the coach can walk a student from concept to won/drawn position step by step.',
  finalTask: 'Teach an endgame from: Position Setup → Concept → Technique → Demonstration → Practice → Test.',
  finalExam: { title: 'Level 8 Final Exam', passMark: 80, sections: ['theory', 'tactical', 'teaching'] },
  competency: ['Endgame Skill', 'Teaching Quality'],
  modules: [
    {
      id: 'l8-m1',
      title: 'Basic Endgames',
      description: 'The techniques every coach must be able to demonstrate reliably.',
      topics: [
        {
          id: 'l8-kp',
          name: 'King & Pawn Endgames',
          summary: 'The opposition, the rule of the square, and when a lone king cannot hold.',
          content: {
            definition:
              'In king and pawn endings, the central idea is the rule of the square: if the defending king can reach the promotion square in time, the position is drawn. The opposition and the position of the defending king decide whether the attacker can win.',
            deep:
              'Teach the rule of the square as a *counting* technique, because it is checkable and students can practise it without a board. Count the moves the defending king needs to reach the promotion square, then count the pawn\'s distance. If the king arrives first, draw. Then teach the two things that beat a lone king: getting the king in front of the pawn, and the opposition. The opposition is best taught as a rule to *not* move into it — if the defending king is on the square directly in front of the pawn and it is the attacker\'s turn, the position is drawn, which is why the attacker must make a waiting move to hand the opposition over. Warn about the two classic student errors: moving the king to the promotion square instead of the square in front of the pawn, and pushing the pawn two squares when only one is needed, which wastes a tempo.',
            why: 'These positions decide most amateur games, and the techniques are exactly checkable, which is what makes them teachable with certainty.',
            when: 'Whenever a pawn endgame is reached with a single passer, and in rook-and-pawn endings.',
            whenNot: 'Not when the pawn is blocked by an enemy pawn that cannot be moved.',
            coachMethod:
              'Use the three-part drill. First, square of the pawn: does the defending king get there in time? Second, opposition: who has it, and do we have to hand it over with a waiting move? Third, key squares: which squares does the king need to reach, and can we get there first? Then demonstrate the technique step by step on the board, and only afterwards let the student do it unsupervised. The reason for this order is that the technique is not obvious from the position and has to be seen before it can be reproduced.',
            example: {
              student: 'My pawn is a queen away from promoting. Why is it drawn?',
              coach:
                'Square the pawn. Your king is on e5, the pawn on f5, the square is f8. Count: two moves for your king, four for the pawn. He arrives first. That is the rule of the square, and it does not care how much material you have.',
            },
            realGame:
              'Have the student square every pawn endgame in their games and see which were drawn from the start.',
          },
          mistakes: [
            'Not checking the rule of the square before starting a pawn race.',
            'Losing the opposition by moving when a waiting move was needed.',
            'Pushing the pawn two squares and wasting a tempo.',
            'Moving the king to the promotion square rather than in front of the pawn.',
            'Forgetting that the defending king can sometimes block instead of racing.',
          ],
          board: {
            fen: '8/5k2/8/5P1P/8/8/8/6K1 w - - 0 1',
            caption: 'Two pawns and the square rule: the white king must reach the key squares, and the black king must stop them.',
            highlight: ['f6', 'g7', 'f5'],
            arrows: [['g1', 'f2']],
          },
          practice: [
            {
              fen: '8/5k2/8/5P1P/8/8/8/6K1 w - - 0 1',
              prompt: 'Square the f5 pawn. Does the black king get to the promotion square in time?',
              solution:
                'The f5 pawn is two moves from promotion (f6, f7). The black king on f7 is already in the square and can reach f8 immediately. Black draws against the f-pawn, so White must use the h-pawn instead.',
              hint: 'Count pawn moves to promotion, then count the king\'s moves.',
            },
          ],
          teachBack: {
            brief: 'Teach the rule of the square as a counting method, then the opposition, then the key squares.',
            required: [
              'rule of the square decides whether a pawn race is winnable',
              'the opposition must be won or handed over with a waiting move',
              'the key squares are the squares the king needs to reach before the pawn',
            ],
            lookFor: [
              'squares the pawn before playing any move',
              'recognises when a waiting move is required',
            ],
          },
          misconception: 'The student believes material advantage decides pawn endgames, and starts a race that is already lost.',
          puzzlePrompt:
            'Give the student three pawn endgames and have them square each one before deciding anything.',
          test: [
            {
              q: 'What does the rule of the square determine?',
              options: [
                'Whether the position is legal',
                'Whether the defending king can reach the promotion square before the pawn',
                'Which promotion piece to choose',
                'Whether to trade',
              ],
              answer: 1,
              explain:
                'If the king arrives first, the pawn cannot promote and the position is drawn regardless of material.',
            },
            {
              q: 'How do you gain the opposition?',
              options: [
                'By moving the king forward',
                'By forcing the opponent to move, often with a waiting move on the pawn side',
                'By trading pieces',
                'By pushing the pawn two squares',
              ],
              answer: 1,
              explain:
                'The side with the opposition has the move advantage in the pawn race. You gain it by making the opponent be the one to move.',
            },
          ],
        },
        {
          id: 'l8-rook',
          name: 'Rook Endgame Technique',
          summary: 'Cut off the king, activate the rook, and the ladder mate.',
          content: {
            definition:
              'The core rook-endgame method is the cut-off: get the rook between the enemy king and its pawns so it cannot defend, then escort the passer. The ladder mate uses the same geometry to force the king to the edge.',
            deep:
              'Rook endgames are won by the defender far more often than students expect, so a coach must teach the defensive method too: the shoulder, the opposition, and the bridge. The attacking method is simple enough to be learned by almost any student, which is why it is a good early endgame lesson. The crucial habit is *activation*: a rook behind pawns is doing nothing, so the first move in almost every rook endgame is the one that gets the rook to the side of the board where it can work. Then the ladder — push the king to the edge by checking along a rank while cutting the escape squares — is a checkable three-move sequence that any student can learn and demonstrate, which makes it the ideal first endgame technique to certify.',
            why: 'It is the most reliably teachable endgame method in chess, and the ladder gives an early, verifiable win for the student.',
            when: 'Whenever a rook-and-pawn endgame arises, and as the first endgame technique a student should be able to demonstrate unsupervised.',
            whenNot: 'Not when the rook is the *defending* piece and the defender can shoulder or blockade.',
            coachMethod:
              'Teach in three demonstrations. First the cut-off, with the student naming the square the rook must reach. Second the activation principle, using a position where the rook is passive and asking what it should be doing. Third the ladder, as a fixed three-move sequence they must reproduce on three different positions without help. Then teach the defensive side by putting the student in the defending seat — shoulder and blockade — because a coach who only teaches the attack produces students who lose drawn positions.',
            example: {
              student: 'I have a rook and a pawn against a lone king. Now what?',
              coach:
                'Do not push the pawn yet. Where is your rook? Is it doing anything? Move it to the side of the pawn, then come back. The pawn does not move until the rook is working.',
            },
            realGame:
              'Have the student review their rook endgames and identify how many were lost to an inactive rook.',
          },
          mistakes: [
            'Pushing the pawn before activating the rook.',
            'Checking from behind the pawn instead of cutting the king off.',
            'Allowing the defending king to reach the shoulder.',
            'Not learning the defensive methods because only the attack was studied.',
          ],
          board: {
            fen: '8/8/8/8/4k3/8/4P3/4R1K1 w - - 0 1',
            caption: 'Cut-off: the rook goes to the seventh, the king stops the pawn, and the rook escorts it from the side.',
            highlight: ['e7', 'e4', 'e2'],
            arrows: [['e1', 'e7']],
          },
          practice: [
            {
              fen: '8/8/8/8/4k3/8/4P3/4R1K1 w - - 0 1',
              prompt: 'What is White\'s first move in this rook endgame, and what is the principle behind it?',
              solution:
                'Re7! — cut the king off on the eighth rank before advancing the pawn. The rook must work before the pawn moves; otherwise the king simply walks to the pawn.',
              hint: 'Activate the rook first. Then move the pawn.',
            },
          ],
          teachBack: {
            brief: 'Teach cut-off, activation, and the ladder, then the defensive shoulder.',
            required: [
              'activate the rook before advancing the pawn',
              'cut off the king from its pawns',
              'the ladder pushes the king to the edge with a fixed three-move sequence',
            ],
            lookFor: [
              'demonstrates the ladder unaided on three positions',
              'can also defend with the shoulder and blockade',
            ],
          },
          misconception: 'The student believes the pawn should always be pushed first in a rook endgame.',
          puzzlePrompt:
            'Give the student a won rook endgame where pushing the pawn first throws the win away.',
          test: [
            {
              q: 'What is the first priority in a rook-and-pawn endgame?',
              options: [
                'Push the pawn two squares',
                'Activate the rook and cut the enemy king off',
                'Trade the rook',
                'Promote immediately',
              ],
              answer: 1,
              explain:
                'A rook behind its pawns is doing nothing. Activate first, then the pawn advances on its own.',
            },
            {
              q: 'The ladder mate works by:',
              options: [
                'Checking the king along a rank while progressively removing escape squares',
                'Sacrificing the rook',
                'Trading the pawn',
                'Promoting a knight',
              ],
              answer: 0,
              explain:
                'Push the king to the edge with a sequence of checks, then deliver mate on the back rank. It is a fixed, checkable technique.',
            },
          ],
        },
        {
          id: 'l8-basic',
          name: 'Basic Endgame Technique',
          summary: 'Centralisation, opposition, diagonals, and the bridge.',
          content: {
            definition:
              'The four techniques that underlie almost every endgame are: get the king to the centre (it does more from there), take and maintain the opposition, use the right diagonal for a lone king, and use the bridge to bring a passed pawn home.',
            deep:
              'The centralisation principle is the most general and the most neglected. A king on the centre participates in play on both wings, so it should always be centralised unless the pawns demand otherwise. The opposition is the timing element, already introduced in pawn endgames, and it is worth revisiting as a general idea. The diagonal rule — a lone king can only stop a pawn when it reaches the promotion square on the correct colour, which depends on the parity of the file — is a beautiful, entirely determinable technique, and one of the best "rules are useful" lessons available. The bridge is the practical one: a passed pawn needs the cooperation of its king to cross a checking line, and a coach must be able to demonstrate it.',
            why: 'These four techniques between them explain most drawn and won endgames, so they are the highest-value endgame content.',
            when: 'In every endgame, before any specific theory.',
            whenNot: 'Centralisation is not automatic — the pawns sometimes demand the king be on a wing.',
            coachMethod:
              'Teach each as a principle with a position that demonstrates it, and require the student to state the principle before naming the move. The diagonal rule is the best teaching example because it is fully determinable: ask "what colour is the promotion square, and can the defending king reach it?" and the student can work it out themselves every time. Then combine all four in one position and ask which applies, which teaches selection as well as knowledge.',
            example: {
              student: 'Where should my king go in the endgame?',
              coach:
                'To the centre, unless the pawns say otherwise. A king in the centre touches both wings. Show me on the board which squares it can reach from here compared with from the corner.',
            },
            realGame:
              'Have the student identify which of the four techniques decided each endgame in their games.',
          },
          mistakes: [
            'Keeping the king on the wing instead of centralising.',
            'Giving away the opposition unnecessarily.',
            'Forgetting the colour rule for a lone king.',
            'Forgetting the bridge and abandoning a passed pawn.',
          ],
          board: {
            fen: '8/8/8/3k4/8/4K3/5P2/8 w - - 0 1',
            caption: 'The white king is central and needs to reach the opposition squares on the fifth rank.',
            highlight: ['e3', 'd5', 'e5'],
            arrows: [['e3', 'e4']],
          },
          practice: [
            {
              fen: '8/8/8/3k4/8/4K3/5P2/8 w - - 0 1',
              prompt: 'Which technique applies here, and what is the white king\'s target?',
              solution:
                'Opposition and centralisation. White should play Ke4 or Kd4 to reach the sixth rank and gain the opposition against the king on d5, after which the f-pawn is supported.',
              hint: 'Two of the four techniques apply at once.',
            },
          ],
          teachBack: {
            brief: 'Teach the four techniques as principles and have the student name which applies.',
            required: [
              'centralise the king',
              'take and hold the opposition',
              'the lone king must reach the promotion square on the correct colour',
              'the bridge gets a passed pawn past a checking piece',
            ],
            lookFor: [
              'names the technique before the move',
              'applies the colour rule to a new position unaided',
            ],
          },
          misconception: 'The student treats endgame technique as a list of separate facts rather than a set of principles to select from.',
          puzzlePrompt:
            'Give the student one position per technique and one position where two techniques are needed together.',
          test: [
            {
              q: 'Why does a king want to be in the centre of the board?',
              options: [
                'It is safer there',
                'It can participate in play on both wings',
                'It cannot be attacked there',
                'It protects pawns better',
              ],
              answer: 1,
              explain:
                'Centralisation is about reach. A central king touches more squares and more files than a king on the wing.',
            },
            {
              q: 'In king and pawn versus king, when can the defending king stop the pawn?',
              options: [
                'Whenever it reaches the pawn',
                'Only when it can reach the promotion square, on the correct colour',
                'Only on the second rank',
                'Whenever the pawn is on a dark square',
              ],
              answer: 1,
              explain:
                'The defending king must be on the promotion square itself, and a lone king cannot reach a promotion square of the wrong colour.',
            },
          ],
        },
        {
          id: 'l8-minorendgame',
          name: 'Minor Piece Endgames',
          summary: 'King and bishop versus king, and the knight-endgame principles.',
          content: {
            definition:
              'King and bishop versus king is drawn because the bishop covers only one colour of squares. King and two knights against a lone king can win but cannot force a mate, so it is a theoretical draw. Knight endgames are won by fixing the opponent\'s pawns.',
            deep:
              'These three facts are the whole of minor piece endgames, and they are worth teaching precisely because they are *provable* rather than positional. The bishop-versus-king draw is provable: the winning side must drive the king to the edge, and the defending king always finds the squares of the wrong colour. The two-knights result is provable too, in the sense that the mate cannot be forced, though it can be reached with the defender helping — which is a great teaching example of the difference between winning and forcing. Teach the bishop endgame first because it is the standard draw every player must recognise, then the two-knights case, then the fixed-pawns principle from Level 7 applied concretely.',
            why: 'Recognising the draw correctly prevents students from throwing away won positions, and knowing how to try saves them from bad draws.',
            when: 'Whenever a minor piece remains and the opponent has only pawns, or a lone king.',
            whenNot: 'Not as an argument for avoiding the two-knights ending — it is frequently a winning practical chance.',
            coachMethod:
              'Demonstrate each result as a proof, not as a fact. For bishop versus king, show the student driving the king to the edge and then point out the wrong-colour square they can always reach — that is the proof, and it makes the draw memorable. For two knights, show a real mate that needed the defender\'s cooperation, and use it to explain "win but not force". Then apply the fixed-pawns principle with the c- and f-files, because that is where the practical wins come from.',
            example: {
              student: 'I have bishop and knight against a lone king — I must be winning.',
              coach:
                'Unless the endgame is a knight endgame with fixed pawns, no. Bishop and knight cannot mate a lone king, because the mate square needs two bishops or one bishop plus a rook. Let us check what this position actually is.',
            },
            realGame:
              'Have the student identify every endgame in their games that fell into these three categories.',
          },
          mistakes: [
            'Trying to win bishop versus king.',
            'Thinking bishop and knight mates a lone king.',
            'Not recognising that two knights can win but cannot force.',
            'Missing the fixed-pawns win in a knight endgame.',
          ],
          board: {
            fen: '8/8/8/4k3/8/8/8/4KB2 w - - 0 1',
            caption: 'Bishop and knight against a lone king: not a forced win, because no single minor piece can mate alone.',
            highlight: ['e8', 'f1', 'e1'],
            arrows: [],
          },
          practice: [
            {
              fen: '8/8/8/4k3/8/8/8/4KB2 w - - 0 1',
              prompt: 'Can White force mate in this endgame? What is the proof that they cannot?',
              solution:
                'No. Mate requires the king to be covered by two pieces on adjacent colours, and neither a bishop nor a knight alone can cover every square the king needs. The proof is the geometry of the mate square, not a rule.',
              hint: 'Think about which squares the defending king needs covered.',
            },
          ],
          teachBack: {
            brief: 'Teach the three minor-piece endgame results as proofs rather than facts.',
            required: [
              'bishop and knight cannot force mate',
              'two knights can win but cannot force mate',
              'knight endgames are won by fixing pawns and using the c- and f-files',
            ],
            lookFor: [
              'can give the geometric proof for the bishop-and-knight draw',
              'distinguishes winning from forcing',
            ],
          },
          misconception: 'The student believes having two minors against a lone king guarantees a win.',
          puzzlePrompt:
            'Show the student a bishop-and-knight mate position and ask them to identify which square cannot be covered.',
          test: [
            {
              q: 'Why can bishop and knight not force mate against a lone king?',
              options: [
                'The king can always run away',
                'Mate needs adjacent squares covered by pieces of both colours, which one bishop and one knight cannot guarantee',
                'The bishop would be captured',
                'It takes too many moves',
              ],
              answer: 1,
              explain:
                'The mate square geometry is the proof. This is why bishop plus knight is a theoretical draw against a lone king.',
            },
            {
              q: 'How do you win a knight endgame?',
              options: [
                'By trading pieces',
                'By fixing the opponent\'s pawns so the knights have targets, using the c- and f-files',
                'By promoting quickly',
                'By keeping the king in the centre',
              ],
              answer: 1,
              explain:
                'Knights attack fixed targets. Locking the pawns creates the targets and takes away the defender\'s moves.',
            },
          ],
        },
        {
          id: 'l8-opposite',
          name: 'Pawn Endgames',
          summary: 'Outside and passed pawns, the wrong rook pawn, and the rule of the square in anger.',
          content: {
            definition:
              'The decisive features of a pawn endgame are the rule of the square, the presence of passed pawns, and whether a passed pawn is outside or inside the king\'s zone. Outside passed pawns win with correct play; inside ones are drawn with a lone king.',
            deep:
              'The outside passed pawn is the clearest "technique wins" case in chess: if a passed pawn is outside the square of the defending king, the king cannot catch it and the position is won even with a bare king. The wrong rook pawn is the opposite and equally clear: with the wrong rook pawn the defending king draws by staying in front and blocking on the correct colour square, and this is the classic example of an absolute rule. Teach these as full demonstrations with the student reproducing the technique unaided, then add the harder case of the outside passed pawn with the defending king inside the zone, where the defender sometimes gets in and draws — that is a genuine endgame subtlety and a good final exercise.',
            why: 'Pawn endgames decide the result of most amateur games, and their techniques are fully checkable.',
            when: 'Whenever the game reduces to pawns, and particularly with one or two passed pawns.',
            whenNot: 'Not when there are passed pawns on both wings and the fight is about who promotes first — that is a separate, practical race.',
            coachMethod:
              'Teach each result as a demonstration the student reproduces unaided. For the outside passed pawn, make them announce "outside the square" before playing a single move. For the wrong rook pawn, make them play out the defensive block to stalemate themselves, because a draw the student finds is a draw they will hold under time pressure.',
            example: {
              student: 'He is a long way from the square but he can still catch my pawn, right?',
              coach:
                'Square it. Count his moves to the promotion square and count your pawn moves. If the numbers say you win, he does not get in. If they say he gets in, he will draw even with a rood down. There is no judgement involved.',
            },
            realGame:
              'Have the student square every pawn endgame in their games and identify how many were drawn from the first move.',
          },
          board: {
            fen: '8/8/8/8/8/6k1/5P2/5K2 w - - 0 1',
            caption: 'The f-pawn is passed. If it is outside the square of the black king, White wins with a bare king.',
            highlight: ['f2', 'g3'],
            arrows: [['f2', 'f4']],
          },
          mistakes: [
            'Not squaring the pawn before starting the race.',
            'Assuming a passed pawn always wins.',
            'Not knowing that the wrong rook pawn draws with a bare king.',
            'Pushing a passed pawn before bringing the king.',
          ],
          practice: [
            {
              fen: '8/8/8/8/8/6k1/5P2/5K2 w - - 0 1',
              prompt: 'Is the f2 pawn passed, and is it outside the square of the black king?',
              solution:
                'It is passed — no black pawns exist. Square the pawn: f4, f5, f6, f7, f8 is five moves; the king on g3 reaches f7 or f8 in time. So the position is drawn, and White must bring the king up first.',
              hint: 'Count the pawn moves and the king moves before deciding anything.',
            },
          ],
          teachBack: {
            brief: 'Teach the square, the outside passed pawn and the wrong rook pawn as checkable results.',
            required: [
              'an outside passed pawn wins even with a bare king',
              'the wrong rook pawn draws against a bare king',
              'inside passed pawns with a lone king are drawn',
            ],
            lookFor: [
              'squares the pawn every time before acting',
              'reproduces the wrong-rook-pawn defence unaided',
            ],
          },
          practice: [
            {
              fen: '8/8/8/8/8/6k1/5P2/5K2 w - - 0 1',
              prompt: 'Is the f2 pawn passed, and is it outside the square of the black king?',
              solution:
                'It is passed — no black pawns exist. Square the pawn: f4, f5, f6, f7, f8 is five moves; the king on g3 reaches f7 or f8 in time. So the position is drawn, and White must bring the king up first.',
              hint: 'Count the pawn moves and the king moves before deciding anything.',
            },
          ],
          teachBack: {
            brief: 'Teach the square, the outside passed pawn and the wrong rook pawn as checkable results.',
            required: [
              'an outside passed pawn wins even with a bare king',
              'the wrong rook pawn draws against a bare king',
              'inside passed pawns with a lone king are drawn',
            ],
            lookFor: [
              'squares the pawn every time before acting',
              'reproduces the wrong-rook-pawn defence unaided',
            ],
          },
          misconception: 'The student believes a passed pawn is always a win.',
          puzzlePrompt:
            'Give the student an inside passed pawn position and ask them to hold the draw with the wrong rook pawn.',
          test: [
            {
              q: 'When does a passed pawn win with a bare king?',
              options: [
                'Always',
                'When it is outside the square of the defending king',
                'When it is on the h-file',
                'When the defending king is on the edge',
              ],
              answer: 1,
              explain:
                'Outside the square means the king cannot catch it. That is the definitive test and it is countable.',
            },
            {
              q: 'Why does the wrong rook pawn draw with a bare king?',
              options: [
                'The king cannot be reached',
                'The defending king can always block or reach the correct colour square to stalemate',
                'The pawn cannot promote at all',
                'It is a fifty-move rule case',
              ],
              answer: 1,
              explain:
                'The defending king gets in front and blocks on the promotion square, using the colour rule. It is an absolute result.',
            },
          ],
        },
      ],
    },
    {
      id: 'l8-m2',
      title: 'Rook, Queen & Complex Endgames',
      description: 'The endgames where technique is least obvious and most valuable to teach.',
      topics: [
        {
          id: 'l8-queen',
          name: 'Queen Endgames',
          summary: 'The checks from the wrong corner, perpetual check, and when to trade into a draw.',
          content: {
            definition:
              'Queen endgames are technical rather than positional: the winning side must give checks from a safe square and prevent the defending side from getting a perpetual check. The standard result is that queen against a lone king is won unless the queen can be stalemated or traded into a draw.',
            deep:
              'The winning technique in queen versus lone king is the classic "checks from the correct side", and teaching it correctly is the mark of a competent endgame coach. The method is a sequence: bring the queen to a square that keeps the enemy king on the edge, keep the enemy king on the opposite colour, and check from the side where the enemy king cannot run. Add the defensive side: perpetual check, and knowing when to trade the queen for a rook to reach a drawn rook endgame. Then handle the queen-and-pawn case, where the decisive facts are whether the pawn promotes with check, whether the defending king can reach the promotion square, and whether the endgame is winning even without the queen.',
            why: 'Queen endgames are decided by a technical sequence, so they are the best demonstration that the coach can actually teach technique rather than slogans.',
            when: 'Whenever a queen endgame arises, and as the first endgame where a student must manage a long technical sequence.',
            whenNot: 'Not when trading into a drawn rook endgame is available, which it often is.',
            coachMethod:
              'Teach the technique as numbered steps and have the student reproduce each step from memory on three positions. The critical detail is the *side* of the board from which the checks are given, because that is the part students get wrong and it is the whole technique. Then run the defensive exercise: put the student in the defending seat and have them find the perpetual check or the trade that saves the game.',
            example: {
              student: 'I have queen against a lone king. Why is it drawn?',
              coach:
                'Which checks were you giving? The technique requires checking from the side that keeps his king on the edge away from you. If you check from the wrong side, he steps to the centre and holds. Let us walk through the correct sequence once.',
            },
            realGame:
              'Have the student review queen endgames in their games and find the wrong-side checks.',
          },
          mistakes: [
            'Checking from the wrong side and letting the king to the centre.',
            'Allowing a perpetual check instead of taking it.',
            'Not trading into a drawn rook endgame when it is available.',
            'Stalemating the defending king.',
          ],
          board: {
            fen: '8/8/8/8/8/2k5/8/2Q1K3 w - - 0 1',
            caption: 'Queen and king against a bare king. The technique is checks from the correct side, keeping the king on the edge.',
            highlight: ['c3', 'c1', 'b2'],
            arrows: [['c1', 'c2']],
          },
          practice: [
            {
              fen: '8/8/8/8/8/2k5/8/2Q1K3 w - - 0 1',
              prompt: 'Which side should the queen check from here, and why?',
              solution:
                'From the side that keeps the black king on the edge and away from the centre — approaching with checks from c2/c1 drives the king to the edge, which is what converts a drawn-looking position into a win.',
              hint: 'The technique is about which side of the board the checks come from.',
            },
          ],
          teachBack: {
            brief: 'Teach the numbered check sequence and the wrong-side error it prevents.',
            required: [
              'bring the queen to keep the king on the edge',
              'check from the correct side — the opposite side from where the king wants to go',
              'know when to trade into a drawn rook endgame',
            ],
            lookFor: [
              'reproduces the sequence from memory',
              'identifies a wrong-side check in a real game',
            ],
          },
          misconception: 'The student thinks queen versus lone king is automatically won, and does not know the technique.',
          puzzlePrompt:
            'Give the student a queen endgame that is drawn with wrong checks and won with correct ones.',
          test: [
            {
              q: 'The winning technique in queen versus lone king depends on:',
              options: [
                'How much material the queen has left',
                'Which side of the board the checks are given from',
                'Whether the king is white or black',
                'The fifty-move rule',
              ],
              answer: 1,
              explain:
                'Checks from the correct side keep the enemy king on the edge. From the wrong side he steps to the centre and the position is held.',
            },
            {
              q: 'When the queen endgame is drawn, what should the stronger side consider?',
              options: [
                'Promoting a pawn',
                'Trading the queen for a rook to reach a drawn rook endgame',
                'Giving up the king',
                'Waiting for the fifty-move rule to claim for him',
              ],
              answer: 1,
              explain:
                'The queen trade is the standard practical draw attempt, and it is worth checking before conceding the whole game.',
            },
          ],
        },
        {
          id: 'l8-practical',
          name: 'Practical Endgames',
          summary: 'Zugzwang, corresponding squares, and endgames decided by one resource.',
          content: {
            definition:
              'Practical endgames are those decided by a single identifiable resource — a zugzwang, a set of corresponding squares, a passed pawn that cannot be stopped, or a blockade. The coach\'s job is to find the resource and name it.',
            deep:
              'This topic teaches the professional habit of looking for the *one thing* that decides a position, which is the endgame equivalent of finding a combination. Corresponding squares are the elegant example: the squares that the attacker must reach to win, and which the defender must also reach — and whichever king gets there first decides it, independent of everything else. Teach it as a map to be memorised per pawn structure, because that is genuinely how it is learned. Zugzwang has already appeared in Level 3, but here it is the decisive feature rather than a nuance, and the same counting drill applies. Add blockade and the rule that a blockade only works if it cannot be broken.',
            why: 'Naming the deciding resource is the highest-value endgame skill and transfers to every position.',
            when: 'In endgames where the position looks equal but one resource decides it.',
            whenNot: 'When a straightforward technique is available — do not over-complicate.',
            coachMethod:
              'Teach a three-step routine for practical endgames: count the forced moves, find the squares each king must reach, and ask which resource makes the position won or drawn. Require the student to name the resource in one sentence. Then memorise the corresponding squares for the two common structures, because that is a legitimate and necessary memorisation — the exception that proves the rule about not memorising openings. Finally, show a blockade that works and one that is broken, so the student knows the condition.',
            example: {
              student: 'This endgame looks equal to me.',
              coach:
                'Equal-looking endgames are decided by one thing. Find it: what must each king reach, and who gets there first? Those are the corresponding squares, and whichever king gets there first wins or holds the whole position.',
            },
            realGame:
              'Have the student take five drawn-looking endgames from their games and name the deciding resource in each.',
          },
          mistakes: [
            'Not looking for the deciding resource and playing "sensible" moves.',
            'Assuming a blockade works without checking whether it can be broken.',
            'Missing a zugzwang because the position looks quiet.',
            'Not learning the corresponding squares for the common structures.',
          ],
          board: {
            fen: '8/8/8/1p6/1P6/8/5k2/5K2 w - - 0 1',
            caption: 'A quiet-looking pawn endgame decided by one resource. Name it before you play.',
            highlight: ['b4', 'b5', 'f2', 'f3'],
            arrows: [],
          },
          practice: [
            {
              fen: '8/8/8/1p6/1P6/8/5k2/5K2 w - - 0 1',
              prompt: 'What is the single resource that decides this position?',
              solution:
                'It is a zugzwang: the side to move must push its pawn and lose the opposition, and the other king can hold. Counting the forced pawn moves reveals it immediately.',
              hint: 'Count the pawn moves each side is forced to make.',
            },
          ],
          teachBack: {
            brief: 'Teach the three-step routine and the requirement to name the deciding resource.',
            required: [
              'count the forced moves, find the target squares, name the resource',
              'corresponding squares decide by who arrives first',
              'a blockade only works if it cannot be broken',
            ],
            lookFor: [
              'names the deciding resource before playing',
              'knows the corresponding squares for the common structures',
            ],
          },
          misconception: 'The student evaluates practical endgames move by move without ever finding the deciding resource.',
          puzzlePrompt:
            'Give the student three equal-looking endgames and have them name the deciding resource in each.',
          test: [
            {
              q: 'What are corresponding squares?',
              options: [
                'Squares of the same colour',
                'Squares each king must reach, with the outcome decided by who arrives first',
                'Squares where a pawn can promote',
                'The starting squares of the kings',
              ],
              answer: 1,
              explain:
                'They are the critical squares of the pawn structure. Whoever gets there first decides the endgame, regardless of everything else.',
            },
            {
              q: 'When is a blockade sufficient?',
              options: [
                'Always',
                'When the blockading piece cannot be dislodged',
                'When the pawns are on the queenside',
                'When the defender has a bishop',
              ],
              answer: 1,
              explain:
                'A blockade that can be broken is not a blockade. The condition for it working is that it cannot be dislodged.',
            },
          ],
        },
        {
          id: 'l8-rook-pawn',
          name: 'Rook, Bishop & Knight Endgame Principles',
          summary: 'The conversion technique: bring the rook to the seventh, then the technical method.',
          content: {
            definition:
              'The general conversion method in a won rook ending is to bring the rook to the seventh rank, which prevents the defending king from escaping, then convert by cut-off and escort. Minor-piece endings follow the same shape with the appropriate method.',
            deep:
              'Almost every won endgame has a shape: put the defending king in a corner, bring your extra piece into play, then apply the specific technique. Teaching the shape makes the technique easier, because the student knows what to prepare for. Note the important caution about the seventh rank: it cuts off the king, but it can also be a blunder if the rook can simply be attacked and the endgame drawn. Add the knight-versus-bishop conversion (fix the pawns, then use the c- and f-files) and the bishop-versus-knight conversion (reach the wrong-coloured corner and use the bishop pair), and the whole of complex endgames becomes a matter of choosing the right technique for the structure in front of you.',
            why: 'A conversion method is what turns "I am up material" into a win, and it is highly repeatable.',
            when: 'Whenever the student is materially winning in a complex endgame.',
            whenNot: 'Not when the technical method is available immediately and the conversion is unnecessary.',
            coachMethod:
              'Teach the conversion as a three-part preparation: corner the king, activate the extra piece, then apply the technique. Require the student to name all three parts before starting. Then show the rook-to-the-seventh case and its failure mode, since that is where the conversion is most often mishandled. Finally, have the student choose the correct technical method for a given structure, which is the skill that actually transfers.',
            example: {
              student: 'I am a rook up, so I am winning.',
              coach:
                'You are winning if the endgame is won. Where is the defending king? Where is your rook? Bring it to the seventh to stop him escaping — then use the technical method. Being up material is the start of the process, not the end.',
            },
            realGame:
              'Have the student convert a won endgame themselves using the three-part method and then name each part.',
          },
          mistakes: [
            'Assuming material advantage means the endgame is won.',
            'Not bringing the rook to the seventh to cut the king off.',
            'Playing the technical method before the conversion is complete.',
            'Choosing the wrong technical method for the structure.',
          ],
          board: {
            fen: '2r3k1/8/8/8/8/8/4P3/2R3K1 w - - 0 1',
            caption: 'Conversion: bring the rook to the seventh, cut the king off, then escort the pawn. Three parts, in order.',
            highlight: ['c7', 'c8', 'g8'],
            arrows: [['c1', 'c7']],
          },
          practice: [
            {
              fen: '2r3k1/8/8/8/8/8/4P3/2R3K1 w - - 0 1',
              prompt: 'Name the three parts of the conversion method in this position and give the first move.',
              solution:
                'Corner the king (he is on g8), bring the rook to the seventh (Rc7! cutting him off along the rank), then escort the pawn. The first move is Rc7.',
              hint: 'Corner, activate, convert.',
            },
          ],
          teachBack: {
            brief: 'Teach the three-part conversion method and the choice of technical method.',
            required: [
              'corner the defending king',
              'activate your extra piece',
              'apply the structure-appropriate technical method',
            ],
            lookFor: [
              'names all three parts before beginning',
              'chooses the correct technical method for a given pawn structure',
            ],
          },
          misconception: 'The student believes being materially ahead means the endgame is already won.',
          puzzlePrompt:
            'Give the student a materially winning endgame that is drawn with bad technique, and one that is won with good.',
          test: [
            {
              q: 'What are the three parts of a conversion method?',
              options: [
                'Count, calculate, castle',
                'Corner the defending king, activate your extra piece, then apply the technical method',
                'Trade, centralise, promote',
                'Attack, defend, exchange',
              ],
              answer: 1,
              explain:
                'Conversion is a preparation stage. The technical method only works once the king is cornered and your extra piece is working.',
            },
            {
              q: 'Why bring the rook to the seventh rank?',
              options: [
                'To promote a pawn',
                'To prevent the defending king from escaping to its own pawns',
                'To trade the rook',
                'Because it is always safe there',
              ],
              answer: 1,
              explain:
                'The seventh rank cuts off the king, which is what makes the conversion possible. It can be attacked, so it is not automatic.',
            },
          ],
        },
      ],
    },
  ],
};