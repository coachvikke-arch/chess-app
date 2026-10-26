/**
 * AI Coach Training Academy — Level 2 (Basic Tactics Coaching).
 *
 * Level 2 has a fixed obligation: every motif must be teachable to the standard
 * of definition, recognition, why it works, how to defend it, and the mistake
 * students actually make. So each topic carries `why`, `whenNot`, `mistakes`
 * and a defence line, not just a name.
 */
export default {
  n: 2,
  id: 'level-2',
  title: 'Basic Tactics Coaching',
  tagline: 'Name the pattern, then explain it.',
  description:
    'Every everyday tactical motif, taught to the level of "definition, recognition, why, defence, common mistake" so the coach can diagnose a student mistake by name.',
  finalTask: 'Study a tactical position and explain the solution exactly as a coach would explain it to a student.',
  finalExam: { title: 'Level 2 Final Exam', passMark: 80, sections: ['theory', 'tactical', 'teaching'] },
  competency: ['Tactical Skill', 'Teaching Clarity'],
  modules: [
    {
      id: 'l2-m1',
      title: 'Pins and Attacks on Pieces',
      description: 'Attacks that depend on a piece being unable to move — and the crucial difference between absolute and relative.',
      topics: [
        {
          id: 'l2-pin',
          name: 'Pin',
          summary: 'A piece that cannot move because something behind it matters more.',
          content: {
            definition:
              'A pin is an attack on one piece by another in which the attacking line runs through to a second, more valuable target behind it. The pinned piece cannot move out of the line, because doing so exposes what is behind it.',
            deep:
              'The pin is a restriction, not a capture — and it keeps its value even after you move on. Once a piece is pinned it may be unable to defend anything, which often creates a second pin or a discovered attack. Teach the mechanism as "the piece behind is more valuable than the piece being attacked", because that is the whole condition, and everything else follows from it.',
            why: 'Pins are the commonest reason a defending piece "should" capture and cannot. Naming it turns a mystery into a mechanism.',
            when: 'When you notice an enemy piece that cannot leave the line, and it is defending something.',
            whenNot: 'Do not assume a piece is pinned because it is attacked. Check whether moving it actually exposes something valuable behind it.',
            coachMethod:
              'Use the value-ordering question out loud: "if that piece moves, what does it uncover, and is that more valuable?" Have the student point at the second piece. If they cannot find it, it is not a pin.',
            example: {
              student: 'Why can he not just take my bishop?',
              coach:
                'Look behind your bishop. What is on the same file, further back? If he captures, what does he expose? That is what a pin is — the piece behind is more valuable.',
            },
            realGame: 'Ask the student to find every pin in their last game, including pins against themselves.',
          },
          mistakes: [
            'Calling any attacked piece a pin.',
            'Forgetting that a pinned piece can still move along the pinning line.',
            'Assuming the pinned piece is captured next move — the value is in the restriction.',
          ],
          board: {
            fen: 'k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1',
            caption: 'The black rook on e8 absolutely pins the white rook on e2 to the king on e1. The pinned rook cannot leave the e-file.',
            highlight: ['e8', 'e2', 'e1'],
            arrows: [['e8', 'e2']],
          },
          practice: [
            {
              fen: '4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1',
              prompt: 'Name what is pinning what, and give White the winning idea.',
              solution:
                'The black rook on e7 pins the white bishop on e2 to the white king on e1. The bishop cannot leave the e-file. The pinned bishop still defends e7 squares in a way that constrains the rook — White gains by exploiting that constraint.',
              hint: 'Find the piece behind the attacked piece.',
            },
          ],
          teachBack: {
            brief: 'Teach the pin using a position where a piece is attacked but legally cannot move.',
            required: [
              'a pin involves three pieces on one line',
              'the piece behind must be more valuable',
              'the pinned piece cannot leave the line',
            ],
            lookFor: [
              'makes the student identify the third piece themselves',
              'explains the value as a restriction, not a capture',
            ],
          },
          misconception: 'The student thinks "attacked" and "pinned" are the same word.',
          puzzlePrompt: 'Create three positions: one pin, one attack that is not a pin, and one where the piece behind is less valuable.',
          test: [
            {
              q: 'What makes an attack a pin rather than just a threat?',
              options: [
                'The attacker is a queen',
                'The attacked piece cannot legally move because something more valuable is behind it',
                'The attack is on the king',
                'It happens in the endgame',
              ],
              answer: 1,
              explain: 'The restriction is the definition. Without a valuable piece behind, it is just an attack.',
            },
            {
              q: 'A knight attacks a bishop which is defended by a pawn. Is the knight pinned?',
              options: ['Yes', 'No — nothing is behind the knight', 'Only if the pawn is defending a king', 'Only in the opening'],
              answer: 1,
              explain: 'No third piece on the line, so it is an ordinary threat, not a pin.',
            },
          ],
        },
        {
          id: 'l2-absolute-pin',
          name: 'Absolute Pin',
          summary: 'Moving the pinned piece would lose immediately — usually the king.',
          content: {
            definition:
              'An absolute pin is a pin in which the pinned piece cannot legally move at all, because moving it would leave its own king in check.',
            deep:
              'The distinction is legality, not convenience. An absolute pin is a rule: the piece is not permitted to move. That makes it different in kind from a relative pin, where moving would merely lose material. The teaching consequence is concrete: an absolutely pinned piece can be used as a shield, and it can be attacked with complete safety because the defender cannot respond properly.',
            why: 'Absolute pins decide games more often than students expect, and the safe-attack rule is a repeatable technique they can drill.',
            when: 'When a knight, bishop or rook is frozen against its own king and you want to attack it freely.',
            whenNot: 'Do not try to "break" an absolute pin by moving the pinned piece — it is simply illegal.',
            coachMethod:
              'Drill the safety rule directly: place an absolutely pinned piece and have the student attack it three times in a row, then explain why nothing happens. Repetition of the *why* is what makes it stick.',
            example: {
              student: 'I attacked that piece twice and nothing happened.',
              coach:
                'That is the point of an absolute pin. It cannot move off the line at all, so your attacks are free. Keep attacking it and it has no legal reply.',
            },
            realGame: 'Ask the student to look for an absolute pin in their last game and count the free attacks they could have made.',
          },
          mistakes: [
            'Confusing absolute and relative pins.',
            'Trying to force the pinned piece to move.',
            'Giving up a winning attack sequence because a pinned piece "cannot escape".',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/8/q3K3 w - - 0 1',
            caption: 'Absolute pin: the white king on e1 pins nothing here, but the pattern is the same — an absolutely pinned piece cannot leave the line.',
            highlight: ['e1', 'e2'],
            arrows: [],
          },
          practice: [
            {
              fen: '4k3/4r3/8/8/8/8/8/4K2R w - - 0 1',
              prompt: 'Is the white rook on h1 pinned? What does that let Black do?',
              solution:
                'The black rook on e7 does not pin h1. But consider the reverse: if the white king were on h1 with a rook on h2, the black rook down the file would be an absolute pin, and Black could attack the rook with total safety.',
              hint: 'Look for a second piece behind the attacked one on the same line.',
            },
          ],
          teachBack: {
            brief: 'Teach the absolute pin and the safe-attack rule that follows from it.',
            required: [
              'moving an absolutely pinned piece is illegal',
              'it is usually pinned against its own king',
              'you can attack it with complete safety',
            ],
            lookFor: [
              'contrasts it explicitly with the relative pin',
              'makes the student exploit the safety rule',
            ],
          },
          misconception: 'The student believes an absolutely pinned piece can defend itself normally.',
          puzzlePrompt: 'Build a position with an absolutely pinned defender and a winning sequence of free captures.',
          test: [
            {
              q: 'Why is an absolute pin stronger than a relative pin?',
              options: [
                'It wins more material directly',
                'The pinned piece cannot legally move at all, so it cannot defend anything',
                'It always leads to mate',
                'It applies to more pieces',
              ],
              answer: 1,
              explain: 'It is about legality: the piece is forbidden to leave the line, so every attack on it is unanswered.',
            },
          ],
        },
        {
          id: 'l2-relativepin',
          name: 'Relative Pin',
          summary: 'The piece could move, but not without losing something bigger.',
          content: {
            definition:
              'A relative pin is one where moving the pinned piece would not be illegal but would lose material — the piece behind it is more valuable than the piece attacking it.',
            deep:
              'The practical consequence is what a coach should drill: a relatively pinned piece CAN defend a square, because it may legally capture there and simply lose the exchange. So it is not useless, just expensive. Students often over-apply "pinned" and assume a relatively pinned piece cannot do anything, which produces wrong plans.',
            why: 'Getting the distinction right prevents a whole family of planning errors about space and piece activity.',
            when: 'When a defender must pay a price to remove an attacker — often when deciding whether an enemy piece is really defending something.',
            whenNot: 'Do not assume the defender will refuse the trade. Sometimes the trade is correct for them.',
            coachMethod:
              'Present a position where a relatively pinned piece does defend, and ask "can this piece actually take? What does it cost?" The answer is usually yes, at a price. That single question fixes the misconception.',
            example: {
              student: 'That bishop cannot take my knight.',
              coach:
              'It can — it is only relatively pinned. It would lose the bishop to the rook afterwards. So it *can*, at a price. Now decide whether that price is worth paying.',
            },
            realGame: 'Ask the student to find a relatively pinned defender in their last game and work out whether trading was correct.',
          },
          mistakes: [
            'Saying a relatively pinned piece cannot move at all.',
            'Assuming the defender never trades even when the trade is good.',
            'Not noticing that a relatively pinned piece can still block.',
          ],
          board: {
            fen: '4k3/3r4/8/8/8/2b5/8/4K2R w - - 0 1',
            caption: 'The bishop on c3 attacks h1 along the diagonal. Is the rook actually free? Check what stands behind it.',
            highlight: ['h1', 'e1', 'c3'],
            arrows: [['c3', 'h1']],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/2b5/8/3RK3 w - - 0 1',
              prompt: 'Can the bishop take the rook on d1? Work out the cost.',
              solution:
                'The bishop on c3 attacks d1 along the diagonal, so yes it can legally capture. But the white rook on d1 is defended by nothing and the white king is not in check, so the bishop simply wins a rook — meaning Black was already better. State the cost honestly rather than assuming the pin protects the rook.',
              hint: 'Relative pin means legal but expensive, not illegal.',
            },
          ],
          teachBack: {
            brief: 'Teach the relative pin by contrasting it with the absolute pin on the same board.',
            required: [
              'the pinned piece can legally move',
              'it would lose material by moving',
              'it can still defend or capture, at a price',
            ],
            lookFor: [
              'explicitly contrasts with the absolute pin',
              'has the student price the trade',
            ],
          },
          misconception: 'The student believes a relatively pinned piece is completely unable to move.',
          puzzlePrompt: 'Create a pair of positions on the same diagram — one absolute pin, one relative — and ask the student to tell them apart.',
          test: [
            {
              q: 'How does a relative pin differ from an absolute pin?',
              options: [
                'The relative pin is on a different colour of square',
                'The relative pinned piece can move legally but would lose material',
                'The relative pin only happens in the endgame',
                'There is no difference',
              ],
              answer: 1,
              explain: 'Legality is the difference: absolute means it cannot move, relative means it can but at a cost.',
            },
          ],
        },
        {
          id: 'l2-fork',
          name: 'Fork',
          summary: 'One piece attacking two targets, so one of them falls.',
          content: {
            definition:
              'A fork is a move by which one piece simultaneously attacks two enemy pieces, so the opponent can only save one.',
            deep:
              'The value of a fork is decided by what is behind the two targets, not by the two targets themselves. A knight fork on a queen and a rook is only good if the knight survives. So teach the survival check: after the fork, is my piece still safe? That single question stops most bad forks. Knights fork best because they jump, so a fork often also removes the defender\'s ability to recapture.',
            why: 'Forks are the highest-frequency tactic beginners can learn, and the survival check makes them reliable.',
            when: 'When one move can win two things, and your piece will survive the recapture.',
            whenNot: 'When your piece is captured by the recapture — then it is a trade, not a fork, and often a bad one.',
            coachMethod:
              'Make the student say the survival check out loud every single time: "after the fork, what takes my piece?" Train the habit, not the pattern.',
            example: {
              student: 'Knight forks their queen and rook!',
              coach:
                'Good — now the important part. What attacks that knight after the fork? If anything, you have traded a knight for a queen and a rook is still safe, which is often a losing trade.',
            },
            realGame: 'Ask the student to count the forks they missed in their last game.',
          },
          mistakes: [
            'Forking without checking whether the forking piece survives.',
            'Forking two pieces of low value when a single capture was better.',
            'Forking and then failing to notice the defender wins material with the recapture.',
          ],
          board: {
            fen: '4k3/8/8/3N4/8/8/8/3QK3 w - - 0 1',
            caption: 'Nf6+ forks nothing here — but the same knight on d5 forks a king and queen when it lands with support.',
            highlight: ['d5', 'e8', 'd8'],
            arrows: [['d5', 'c7']],
          },
          practice: [
            {
              fen: '4k3/8/5N2/8/8/8/8/4K2R w - - 0 1',
              prompt: 'Find a knight fork and check whether the knight survives.',
              solution:
                'There is no immediate fork here with one knight. The training point is the habit: before playing any fork, list what attacks your piece on its destination square. If anything does, count the trade.',
              hint: 'Always list the recaptures before committing to a fork.',
            },
          ],
          teachBack: {
            brief: 'Teach the fork as "attack two, then check survival".',
            required: [
              'one piece attacks two targets simultaneously',
              'the opponent can only save one',
              'the forking piece must survive the recapture',
            ],
            lookFor: [
              'makes the survival check a spoken habit',
              'uses value comparison between the two targets',
            ],
          },
          misconception: 'The student sees a fork and plays it without checking whether their own piece is captured.',
          puzzlePrompt: 'Build three fork puzzles: safe knight fork, fork that loses the piece, and fork of two minor pieces.',
          test: [
            {
              q: 'A knight forks a queen and a pawn, and the knight can be captured. Is that a good fork?',
              options: [
                'Yes, forking is always good',
                'No — it trades a knight for a queen and a pawn, which is usually losing material',
                'It depends on the square colour',
                'It is only good in the endgame',
              ],
              answer: 1,
              explain: 'Value comparison decides. Knight (3) for queen (9) plus pawn (1) is a clear loss, so the survival check is essential.',
            },
          ],
        },
        {
          id: 'l2-knightfork',
          name: 'Knight Fork',
          summary: 'The classic knight fork, and why the knight is the best forking piece.',
          content: {
            definition:
              'A knight fork is a knight move that attacks the king and another valuable piece at the same time, or two other valuable pieces.',
            deep:
              'Two reasons the knight forks so well: it jumps, so it can reach a forking square from angles no sliding piece can, and it does not get blocked by the pieces in front of it. The most common fork in practice is king plus queen, because that is what a knight on the right square happens to hit. Teach the geometric picture — the knight lands where three lines cross — and students start finding these themselves.',
            why: 'It is the single most common winning tactic at club level and it teaches the habit of scanning for attacked squares after a jump.',
            when: 'When a knight can reach a square attacking two things.',
            whenNot: 'When the knight is captured, or when the two targets are both minor pieces and the knight is not.',
            coachMethod:
              'Have the student, after every knight move, list what the knight now attacks. That habit finds most knight forks and is genuinely transferable.',
            example: {
              student: 'Where does my knight go?',
              coach:
                'Try the centre. Then look at everything it attacks from there. If two of those are valuable, you have a fork.',
            },
            realGame: 'Have the student mark every knight fork — taken and missed — in their last game.',
          },
          mistakes: [
            'Moving the knight without listing what it attacks.',
            'Forking the king and a pawn and calling it decisive.',
            'Blocking a knight fork with an unnecessary pawn move.',
          ],
          board: {
            fen: '4k3/5q2/8/8/3N4/8/8/4K3 w - - 0 1',
            caption: 'A knight on d5 attacks e7, f6, b6 and c7 — land it where two valuable targets line up.',
            highlight: ['d5', 'e7'],
            arrows: [['d5', 'e7']],
          },
          practice: [
            {
              fen: '4k3/8/4q3/8/3N4/8/8/4K3 w - - 0 1',
              prompt: 'Find the knight fork, name both targets, and check the knight survives.',
              solution:
                'Nf6+ forks the king on e8 and the queen on e6 — both on the same diagonal with the knight. The knight on f6 is defended by nothing here, so check: does anything attack f6? If not, this is a genuine win of the queen.',
              hint: 'Land where two lines cross through your knight.',
            },
          ],
          teachBack: {
            brief: 'Teach the knight fork and the post-move "list what it attacks" habit.',
            required: [
              'a knight move attacking two valuable pieces',
              'the king is usually one of them',
              'check the knight survives',
            ],
            lookFor: [
              'installs the post-move attack scan',
              'explains why knights fork more than sliders',
            ],
          },
          misconception: 'The student moves the knight without ever checking what it attacks.',
          puzzlePrompt: 'Create a position where the knight must find the fork square, not the obvious one.',
          test: [
            {
              q: 'Why is a knight the best forking piece?',
              options: [
                'It is worth more',
                'It jumps, so it reaches forking squares no other piece can',
                'It cannot be captured',
                'It forks more often by rule',
              ],
              answer: 1,
              explain: 'Its jumping move gives it far more forking geometry than any sliding piece.',
            },
          ],
        },
        {
          id: 'l2-doubleattack',
          name: 'Double Attack',
          summary: 'Two attackers on one target — the general form of fork and battery.',
          content: {
            definition:
              'A double attack is a move that threatens two different targets at once, so as with a fork, only one can be defended.',
            deep:
              'Double attack is the umbrella under which fork, discovered attack and battery sit. The useful thing for a coach is to separate the concept from the names: first ask "is anything attacked twice?", then ask "why — is one attacker revealed, or two pieces simply pointing at the same square?". That habit generalises to patterns the coach has never named.',
            why: 'It gives the coach a single diagnostic question that finds most combinations before they are missed.',
            when: 'Whenever two pieces can be lined up on one target.',
            whenNot: 'When both attacks can be answered by one move that deals with both.',
            coachMethod:
              'Give the student a position and just ask "what is attacked twice?" before asking what the tactic is called. Name it after the discovery, so the understanding comes first.',
            example: {
              student: 'I do not know what to call this tactic.',
              coach:
                'You do not need the name yet. Tell me: what is attacked twice, and can one move defend both?',
            },
            realGame: 'Ask the student to review a game and list every double attack they saw, named or not.',
          },
          mistakes: [
            'Counting two attacks when one move defends both.',
            'Not noticing a second attacker after making the first one.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/2N5/2Q1K3 w - - 0 1',
            caption: 'Knight and queen both hit d5. What is attacked twice?',
            highlight: ['c2', 'c1', 'd5'],
            arrows: [['c2', 'd4'], ['c1', 'd5']],
          },
          practice: [
            {
              fen: '4k3/8/8/3N4/8/8/8/3QK3 w - - 0 1',
              prompt: 'Identify every square that is attacked twice in this position.',
              solution:
                'd5 is attacked by the knight and defended by the queen. e7, c7, f6, b6 are knight moves; the queen covers the d-file and the diagonal to h5. The practical lesson is to scan for the shared target before looking for named patterns.',
              hint: 'List every piece\'s attacks, then look for overlaps.',
            },
          ],
          teachBack: {
            brief: 'Teach double attack as the umbrella concept that contains fork and discovered attack.',
            required: [
              'two attackers aimed at the same target',
              'one move usually cannot answer both',
              'discover attacks before naming the tactic',
            ],
            lookFor: [
              'leads with the diagnostic question rather than the name',
              'separates the concept from the vocabulary',
            ],
          },
          misconception: 'The student learns names without learning the underlying question.',
          puzzlePrompt: 'Create a position containing two different double attacks so the student must find both.',
          test: [
            {
              q: 'What is the diagnostic question for a double attack?',
              options: [
                'Is the queen safe?',
                'What is attacked twice, and can one move defend both?',
                'How many pieces are developed?',
                'Is this an opening or endgame?',
              ],
              answer: 1,
              explain: 'Overlap of attacks plus the question of whether one reply covers both. Everything else is naming.',
            },
          ],
        },
        {
          id: 'l2-skewer',
          name: 'Skewer',
          summary: 'The reverse of a pin: the big piece is in front.',
          content: {
            definition:
              'A skewer is an attack where the more valuable piece stands in front, so when it moves the piece behind it is attacked and lost.',
            deep:
              'The geometry is inverted compared with a pin, and students mix them up constantly. Pin: small piece in front, big piece behind, small piece cannot move. Skewer: big piece in front, small piece behind, big piece must move and the small one falls. The reliable way to avoid confusion is not to remember the word but to ask, when a piece is attacked, whether what is behind it is bigger or smaller than it is. That question classifies both patterns correctly every time.',
            why: 'Confusing pin and skewer is one of the most common diagnostic errors in student games, and it is trivially fixable with the value question.',
            when: 'When you can attack a piece that is shielding something less valuable behind it.',
            whenNot: 'When the piece behind is more valuable — then it is a pin, not a skewer.',
            coachMethod:
              'Ban the words "pin" and "skewer" for one lesson. Teach only the value question: bigger or smaller behind? Once the student classifies correctly by geometry, attach the vocabulary.',
            example: {
              student: 'So is this a pin or a skewer?',
              coach:
                'Forget the words. What is behind the piece you attacked? If it is smaller than the piece you attacked, you are skewering it.',
            },
            realGame: 'Have the student find every skewer in their last game and confirm it by geometry, not by name.',
          },
          mistakes: [
            'Calling a skewer a pin.',
            'Missing a skewer because the attacked piece "just moves away" — the point is what it exposes.',
            'Assuming the smaller piece behind is defended, so no win.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/8/q3RK2 b - - 0 1',
            caption: 'Skewer geometry: the queen is in front of the rook. Move the queen and the rook falls.',
            highlight: ['a1', 'e1'],
            arrows: [['a1', 'e1']],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/8/4r3/4K2q w - - 0 1',
              prompt: 'Find the skewer and name what wins.',
              solution:
                'The rook on e2 and queen on h1. If the rook moves, something behind it is attacked — check what is on the e-file behind the rook. The lesson is the classification, not the specific line.',
              hint: 'What is behind the piece you are attacking?',
            },
          ],
          teachBack: {
            brief: 'Teach pin vs skewer by geometry first, vocabulary second.',
            required: [
              'in a pin the small piece is in front',
              'in a skewer the big piece is in front',
              'the value question classifies both correctly',
            ],
            lookFor: [
              'deliberately defers the vocabulary',
              'insists on the bigger-or-smaller question',
            ],
          },
          misconception: 'The student uses "pin" and "skewer" interchangeably.',
          puzzlePrompt: 'Create four positions — two pins, two skewers — and require the student to classify by geometry.',
          test: [
            {
              q: 'A rook attacks a queen, with a pawn behind the queen. What is this?',
              options: ['A pin', 'A skewer', 'A fork', 'A discovered attack'],
              answer: 1,
              explain: 'The bigger piece (queen) is in front and the smaller (pawn) is behind, so it is a skewer.',
            },
            {
              q: 'What is the reliable way to tell a pin from a skewer?',
              options: [
                'Count the pieces',
                'Ask whether what is behind the attacked piece is bigger or smaller',
                'Look at the board colour',
                'Check whose move it is',
              ],
              answer: 1,
              explain: 'The value relationship behind the attacked piece is the definition of both, so one question classifies each correctly.',
            },
          ],
        },
        {
          id: 'l2-discovered',
          name: 'Discovered Attack',
          summary: 'Move one piece, uncover an attack from another.',
          content: {
            definition:
              'A discovered attack occurs when moving one piece reveals a line of attack from another piece behind it.',
            deep:
              'Discovered attacks are easy to miss because nothing attacks before the move. The scan that finds them is: after any developing or blocking move, look along every line through the square you vacated. Teach it as a habit attached to a move rather than a pattern to recognise. Discovered check is the same idea applied to the king and is far more common than plain discovered attacks.',
            why: 'It teaches the coach to look for consequences of their own moves, which is a transferable discipline.',
            when: 'After any move that vacates a square with a line through it.',
            whenNot: 'When the moved piece was itself needed to hold the line.',
            coachMethod:
              'Have the student, after each move, check two squares: the square they vacated and the square they moved to. That is where discovered attacks live.',
            example: {
              student: 'I did not see that attack at all.',
              coach:
                'It was hidden. After you move a piece, look back along the line it came from — that is how you find these.',
            },
            realGame: 'Ask the student to review a game and mark every discovered attack, including the ones that were taken.',
          },
          mistakes: [
            'Not checking the line vacated by a move.',
            'Creating a discovered attack against yourself.',
            'Forgetting discovered check is the most forcing version.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/3N4/4K2R w - - 0 1',
            caption: 'Moving the knight off the d-file can reveal the rook behind it. Always check the square you vacated.',
            highlight: ['h1', 'e1'],
            arrows: [],
          },
          practice: [
            {
              fen: '4k3/4r3/8/8/8/8/8/R3K3 w - - 0 1',
              prompt: 'Find a move that creates a discovered attack.',
              solution:
                'Rook moves on the a-file that reveal an attack along the rank or file behind it — in this sparse position, moving the rook to a1 then along the first rank creates threats once the king or a piece is aligned. The habit is the lesson, not the specific move.',
              hint: 'Look along the line through the square you are about to vacate.',
            },
          ],
          teachBack: {
            brief: 'Teach discovered attack as a post-move scanning habit.',
            required: [
              'moving one piece reveals another\'s attack',
              'nothing is attacked before the move',
              'discovered check is the forcing version',
            ],
            lookFor: [
              'attaches the scan to an existing routine',
              'notes the self-inflicted version',
            ],
          },
          misconception: 'The student believes nothing can be attacked before the attacking move is played.',
          puzzlePrompt: 'Create a position where the winning move is a discovered attack on a piece the student is not currently watching.',
          test: [
            {
              q: 'What makes an attack a discovered attack?',
              options: [
                'It attacks the king',
                'It was hidden until one piece moved',
                'It uses a queen',
                'It wins a pawn',
              ],
              answer: 1,
              explain: 'The attack exists in the position before the move; the move only reveals it.',
            },
          ],
        },
        {
          id: 'l2-discoveredcheck',
          name: 'Discovered Check',
          summary: 'The forcing cousin — the most common way to open a line on a king.',
          content: {
            definition:
              'A discovered check is a discovered attack delivered against the king, which makes it forcing: the opponent must answer immediately.',
            deep:
              'Because it is check, discovered check combines the surprise of a hidden attack with the forcing power of check — which makes it the most reliable way to open a file or diagonal against a castled king. Two common sources: a knight moving off a diagonal it was blocking, and a pawn advancing to open a file. Both are worth drilling by pattern.',
            why: 'It is the mechanism behind a huge share of opening attacks against castled kings.',
            when: 'When one piece is blocking a line to the enemy king.',
            whenNot: 'Never move a piece off a line to the enemy king without checking whether that opens your own king.',
            coachMethod:
              'Show the two sources as pictures: knight off a diagonal, pawn opening a file. Then make the student find the discovered check in every position you hand them for two weeks.',
            example: {
              student: 'How did that check appear?',
              coach:
                'It was behind the knight the whole time. The knight moved and the line opened. Look for pieces standing on lines to the enemy king.',
            },
            realGame: 'Ask the student to count discovered checks they received in their last game.',
          },
          mistakes: [
            'Opening a line on your own king while delivering one on theirs.',
            'Assuming a discovered check wins material automatically.',
            'Missing the follow-up after the forced reply.',
          ],
          board: {
            fen: '2r1k3/8/8/8/8/5N2/8/4K3 w - - 0 1',
            caption: 'A knight on f3 sitting on the diagonal to e4. Moving it can reveal something behind it.',
            highlight: ['f3', 'c8'],
            arrows: [],
          },
          practice: [
            {
              fen: '6k1/8/8/8/8/2n5/4B3/4K3 w - - 0 1',
              prompt: 'Find a discovered attack and check whose king it opens.',
              solution:
                'Moving the bishop on e2 can reveal a line to the black king — but first verify it does not expose the white king to the knight on c3. The two-part check is the training content.',
              hint: 'Before the discovered attack, confirm your own king is safe.',
            },
          ],
          teachBack: {
            brief: 'Teach discovered check with its two common sources and the own-king safety check.',
            required: [
              'a discovered attack delivered as check',
              'it is forcing because check must be answered',
              'knight-off-diagonal and pawn-opening-a-file are the usual sources',
            ],
            lookFor: [
              'insists on verifying own king safety first',
              'asks the student to find them unprompted',
            ],
          },
          misconception: 'The student thinks a discovered check must be planned in advance rather than noticed.',
          puzzlePrompt: 'Create a position with a knight blocking a diagonal, where moving it gives discovered check but loses a piece if the king is exposed.',
          test: [
            {
              q: 'Why is a discovered check so useful?',
              options: [
                'It wins material immediately',
                'It is forcing, so the opponent must answer and you gain a tempo',
                'It cannot be blocked',
                'It only works in the opening',
              ],
              answer: 1,
              explain: 'Check forces a reply, so the tempo is guaranteed. The discovery adds surprise.',
            },
          ],
        },
        {
          id: 'l2-doublecheck',
          name: 'Double Check',
          summary: 'Two attackers on the king at once — always a forcing combination.',
          content: {
            definition:
              'A double check is two pieces checking the king simultaneously, usually produced by a discovered check.',
            deep:
              'Because two checkers cannot both be captured or both be blocked, only three replies are ever possible: move the king, capture one checker (leaving the other, which is still check), or block one (leaving the other). This drastically narrows the defender\'s options, which is why double check so often forces mate. The practical lesson for the coach: double check is never a direct threat of mate in itself, it is a way to restrict the king to a small set of squares so the follow-up becomes decisive.',
            why: 'It teaches the coach to recognise combinations whose follow-up is the real point.',
            when: 'After a discovered check where the moved piece also gives check.',
            whenNot: 'Never assume double check is mate — count the king\'s legal squares first.',
            coachMethod:
              'Have the student enumerate the king\'s escape squares immediately after any double check. The habit of counting squares is what stops them declaring mate too early.',
            example: {
              student: 'Double check! I win the queen.',
              coach:
                'Count first. Where can his king actually go? Then decide what comes next — double check is usually the setup, not the punch.',
            },
            realGame: 'Ask the student to find double checks in their games and check whether they found the follow-up.',
          },
          mistakes: [
            'Assuming double check means checkmate.',
            'Not checking how many squares the king has left.',
            'Missing the follow-up after the king moves.',
          ],
          board: {
            fen: '3r2k1/8/8/8/8/2N5/8/2R2K2 w - - 0 1',
            caption: 'A discovered check with the rook and a direct check with the knight. Count the king\'s squares.',
            highlight: ['g8', 'c3', 'c1'],
            arrows: [],
          },
          practice: [
            {
              fen: '3r2k1/5N2/8/8/8/8/8/R5K1 w - - 0 1',
              prompt: 'Identify the discovered check and list every escape square for the king.',
              solution:
                'The knight on f7 gives check and the rook on d8 is already checking on the 8th rank once the knight moved off it. King escapes are limited by the rook on the 8th rank and the rook on a1 — enumerate them before concluding anything.',
              hint: 'Two checkers means only three kinds of reply.',
            },
          ],
          teachBack: {
            brief: 'Teach double check as forcing-plus-restriction, with the escape-square count.',
            required: [
              'two pieces checking the king at once',
              'only three kinds of reply exist',
              'count escape squares before claiming mate',
            ],
            lookFor: [
              'makes the escape-square count a rule',
              'insists double check is usually a setup',
            ],
          },
          misconception: 'The student believes double check automatically delivers mate.',
          puzzlePrompt: 'Create a double check that looks decisive but is not mate, and ask for the correct next step.',
          test: [
            {
              q: 'After a double check, how many kinds of legal reply are there?',
              options: ['Only moving the king', 'Three: move the king, capture one checker, block one', 'Any defensive move', 'Only capturing one checker'],
              answer: 1,
              explain: 'Three kinds, but capturing or blocking only neutralises one checker so the other is still check — which is what restricts the king so tightly.',
            },
          ],
        },
        {
          id: 'l2-xray',
          name: 'X-Ray Attack',
          summary: 'Sliding through a blocking piece to see what is behind.',
          content: {
            definition:
              'An x-ray attack is one where a rook, bishop or queen attacks a piece through an intervening piece, aiming at what lies behind it.',
            deep:
              'The x-ray is not a move but a way of seeing: remove the blocking piece from your mental picture and check what the line attacks. That is why it is so useful for assessment — a position where an enemy piece blocks your rook is often one move from a real threat. Teach it as a reading exercise before it is ever a tactic.',
            why: 'It trains the coach to evaluate positions behind enemy pieces, which underpins every combination.',
            when: 'Whenever an enemy piece sits on a line between your sliding piece and something valuable.',
            whenNot: 'Never as a direct attack — you must first deal with the blocker.',
            coachMethod:
              'Give the student positions and ask them to describe what each slider "sees through" its blockers. It is a perception drill and it works.',
            example: {
              student: 'The rook does nothing here.',
              coach:
                'It sees through that knight. If the knight moves, what does the rook attack? Write it down — that is your threat.',
            },
            realGame: 'Ask the student to list the x-ray threats present in their last game.',
          },
          mistakes: [
            'Forgetting the blocker when assessing a threat.',
            'Moving the blocker for a reason and missing the x-ray behind it.',
          ],
          board: {
            fen: '4k3/8/8/3n4/8/8/8/R3K3 w - - 0 1',
            caption: 'The rook sees through the knight on d5 to the king on e8. That is the threat to create.',
            highlight: ['a1', 'd5', 'e8'],
            arrows: [['a1', 'e8']],
          },
          practice: [
            {
              fen: '4k3/4r3/8/3p4/8/8/8/R3K3 w - - 0 1',
              prompt: 'List every x-ray threat on the board.',
              solution:
                'The white rook on a1 looks along the first rank at nothing useful; the black rook on e7 looks down the e-file at the white king on e1, blocked by the pawn on d5 only in the sense of not being on that file. The disciplined answer is to enumerate every line with a blocker and name the target behind it.',
              hint: 'For each slider, look past every blocker.',
            },
          ],
          teachBack: {
            brief: 'Teach x-ray as a perception habit rather than a tactic to memorise.',
            required: [
              'a sliding piece attacking through a blocker',
              'the value is in the threat behind the blocker',
              'assess positions by removing blockers mentally',
            ],
            lookFor: [
              'frames it as a reading exercise',
              'has the student enumerate lines with blockers',
            ],
          },
          misconception: 'The student thinks a blocked slider has no threats at all.',
          puzzlePrompt: 'Create a position where an x-ray threat decides the game and the blocker move is the key.',
          test: [
            {
              q: 'What is the practical use of spotting an x-ray?',
              options: [
                'It wins material immediately',
                'It tells you what the opponent threatens once the blocker moves',
                'It is only used in the endgame',
                'It replaces calculation',
              ],
              answer: 1,
              explain: 'It exposes the threat behind the blocker, which is usually what decides the position.',
            },
          ],
        },
      ],
    },
    {
      id: 'l2-m2',
      title: 'Loose, Trapped and Defended Pieces',
      description: 'Counting with judgement: which pieces are safe, which are not, and why.',
      topics: [
        {
          id: 'l2-hanging',
          name: 'Hanging Pieces',
          summary: 'Attacked pieces and how to decide whether it is actually bad.',
          content: {
            definition:
              'A hanging piece is one that is attacked and cannot easily move to safety, so it may simply be lost.',
            deep:
              '"Attacked" is not the same as "hanging", and the difference is worth teaching properly because it is where beginners miscount. A piece is only truly hanging if it cannot defend, trade, or run. The coach\'s routine should be: attacked, then what? Can it move, trade, or is it defended? That sequence prevents both panic about harmless attacks and complacency about real ones.',
            why: 'Material accounting only works if "attacked" is not confused with "doomed".',
            when: 'Whenever an enemy piece attacks yours and cannot be defended in time.',
            whenNot: 'When the piece can move, trade, or is adequately defended — then it is only attacked.',
            coachMethod:
              'Make the student answer three questions in order for every attack they notice: can it move, can it trade, is it defended. Only after all three fail do they call it hanging.',
            example: {
              student: 'My knight is attacked, I am losing material.',
              coach:
                'Before you count anything: can the knight move? Can it trade? Is anything defending it? A piece that has an answer to any of those is not lost.',
            },
            realGame: 'Have the student recount their last game\'s material exchanges using this three-step routine.',
          },
          mistakes: [
            'Counting every attack as a loss.',
            'Forgetting to check whether the piece is defended.',
            'Not seeing the recapture when they "win" a piece.',
          ],
          board: {
            fen: '4k3/8/8/8/8/5n2/8/4K2N w - - 0 1',
            caption: 'The white knight on h1 is attacked by the black knight. Is it hanging? Check all three answers.',
            highlight: ['h1', 'f3'],
            arrows: [['f3', 'h1']],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/2n5/8/4K2N w - - 0 1',
              prompt: 'White knight on h1 is attacked by the black knight on c3. Is the white knight hanging?',
              solution:
                'No. It can move to g3 and f2, so it has an answer to the first question. An attacked piece with an escape is not hanging. This is exactly the distinction beginners lose material over.',
              hint: 'Ask the three questions in order before counting.',
            },
          ],
          teachBack: {
            brief: 'Teach the difference between attacked and hanging using the three-question routine.',
            required: [
              'hanging means attacked with no way out',
              'move, trade, or defend are the three possible answers',
              'check recaptures before claiming a win',
            ],
            lookFor: [
              'insists on the three-question order',
              'has the student re-evaluate a "win" they thought they had',
            ],
          },
          misconception: 'The student counts every attacked piece as lost material.',
          puzzlePrompt: 'Create a position with three attacked pieces where only one is genuinely hanging.',
          test: [
            {
              q: 'A piece is attacked. What must you check before calling it hanging?',
              options: [
                'Whether it is on a light square',
                'Whether it can move, trade, or is defended',
                'Whether it is a pawn',
                'Nothing — attacked means lost',
              ],
              answer: 1,
              explain: 'Attacked is a fact; hanging is a conclusion. The three checks decide it.',
            },
          ],
        },
        {
          id: 'l2-loose',
          name: 'Loose Pieces',
          summary: 'Not yet lost, but undefended and drifting into trouble.',
          content: {
            definition:
              'A loose piece is one that is undefended and not yet attacked, but is one tempo away from being a target.',
            deep:
              'Loose is a warning state, not a loss. The coaching value is teaching the student to see a piece as loose before it becomes hanging — that one tempo of foresight is what stops the game-losing blunder. Have the student define it positively: a piece that would be lost if the opponent simply moved one piece to attack it.',
            why: 'It builds the habit of counting defenders around every piece, which is the foundation of all tactics.',
            when: 'Any time a piece stands undefended in a position where the opponent has a free move.',
            whenNot: 'Do not treat a loose piece as critical if it is about to be defended or developed to safety.',
            coachMethod:
              'Ask "what defends this piece?" for every piece on the board, in a fixed order. The student who asks that automatically stops hanging pieces.',
            example: {
              student: 'I moved my queen away and then lost it.',
              coach:
                'Before it moved, what defended it? If the answer was nothing, it was loose, and a loose piece is a piece the opponent can take whenever they want.',
            },
            realGame: 'Ask the student to count defenders around every one of their pieces in a real position.',
          },
          mistakes: [
            'Not realising a piece is undefended.',
            'Assuming an undefended piece is safe because it is not attacked yet.',
            'Leaving several loose pieces at once.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/8/3QK3 w - - 0 1',
            caption: 'The queen on d1 is undefended. Not attacked yet, but loose — one enemy move changes that.',
            highlight: ['d1', 'e1'],
            arrows: [],
          },
          practice: [
            {
              fen: '4k3/8/8/8/4r3/8/8/3QK3 w - - 0 1',
              prompt: 'Which pieces are loose in this position?',
              solution:
                'The white queen on d1 is undefended, and with the black rook already on e4 and the e-file to the white king, the queen is also en prise. Name the piece, name who could take it, and that is the lesson.',
              hint: 'For each piece, ask what defends it.',
            },
          ],
          teachBack: {
            brief: 'Teach "loose" as the state just before "hanging".',
            required: [
              'loose means undefended and not yet attacked',
              'it is a one-tempo warning',
              'count defenders around every piece as a habit',
            ],
            lookFor: [
              'links loose to the defender-counting habit',
              'makes it preventive rather than reactive',
            ],
          },
          misconception: 'The student thinks a piece is safe simply because nothing attacks it right now.',
          puzzlePrompt: 'Create a position with several loose pieces where the opponent wins material by simply waiting.',
          test: [
            {
              q: 'How does a loose piece differ from a hanging piece?',
              options: [
                'Loose pieces are pawns',
                'A loose piece is undefended but not currently attacked; a hanging piece is attacked with no escape',
                'There is no difference',
                'Loose pieces are on light squares',
              ],
              answer: 1,
              explain: 'Loose is the warning state one tempo before hanging. Learning to see it early prevents the blunder.',
            },
          ],
        },
        {
          id: 'l2-trapped',
          name: 'Trapped Pieces',
          summary: 'Attacked, unable to run, and unable to trade — the worst of both.',
          content: {
            definition:
              'A trapped piece is one that is attacked and has no safe square and no way to exchange off the attacker.',
            deep:
              'Trapped is stronger than hanging because the defender has no option at all. A rook trapped on the back rank by two pawns is the classic image. The teaching point is to spot the trap before it closes: which of my pieces has few squares available, and is one of them where the opponent wants it? That is a planning question, not a tactics question.',
            why: 'It teaches the coach to look at squares available to a piece, which is the foundation of trapping and of space judgement.',
            when: 'When a piece has one or two legal squares and the opponent controls the rest.',
            whenNot: 'When the piece can simply trade with the attacker.',
            coachMethod:
              'Count the squares available to a piece, then count how many the opponent controls. Have the student do this for the enemy\'s pieces as well — that is how you spot your own piece about to become trapped.',
            example: {
              student: 'How did my rook get stuck?',
              coach:
                'Look at how few squares it had. Two pawns took away most of the back rank, and then it had nowhere to go. Count squares, not pieces.',
            },
            realGame: 'Ask the student to count available squares for one enemy piece in their last game.',
          },
          mistakes: [
            'Moving a piece without counting where it can go next.',
            'Not noticing that a pawn advanced the wrong way reduces its own mobility.',
            'Assuming a piece with three squares available is safe.',
          ],
          board: {
            fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
            caption: 'The rook on a1 has few squares and the black pawns close the rest. Trapped and heading to mate.',
            highlight: ['a1', 'f7', 'g7', 'h7'],
            arrows: [],
          },
          practice: [
            {
              fen: '6k1/5ppp/8/8/8/8/5PPP/6RK w - - 0 1',
              prompt: 'Is the black king trapped? Count its squares.',
              solution:
                'The black king on g8 has essentially no squares: f8 and h8 are behind its own pawns\' diagonal reach, and g7 is occupied by its own pawn. It is not trapped yet but it is very restricted — count squares before you assume.',
              hint: 'List every square, then subtract the ones the opponent controls.',
            },
          ],
          teachBack: {
            brief: 'Teach trapping through counting available squares, for both sides.',
            required: [
              'a trapped piece is attacked with no square and no trade',
              'count available squares, not material',
              'check both your own pieces and your opponent\'s',
            ],
            lookFor: [
              'makes square-counting a routine',
              'asks about the opponent\'s pieces as well',
            ],
          },
          misconception: 'The student thinks a piece is safe because it has not been captured yet.',
          puzzlePrompt: 'Build a trap where the victim has two squares available at the start, showing mobility shrinking over two moves.',
          test: [
            {
              q: 'What is the best way to check whether a piece is trapped?',
              options: [
                'Add up the material',
                'Count its available squares and subtract those the opponent controls',
                'Check its colour',
                'See if it is defended',
              ],
              answer: 1,
              explain: 'Trapping is a question of mobility. Available-square count answers it directly.',
            },
          ],
        },
        {
          id: 'l2-defended',
          name: 'Defended Pieces',
          summary: 'Count the attackers and the defenders before you calculate anything.',
          content: {
            definition:
              'A defended piece is one that is protected by at least one friendly piece, so capturing it loses material for the opponent.',
            deep:
              'This is the most basic and most skipped calculation in chess: attackers minus defenders. Teach it as a subtraction that happens before any tactic is considered, because most "wins" of material are actually even trades and most blunders are miscounts. The double-count trap matters too — two defenders that are themselves pinned or hanging do not count as two.',
            why: 'It is the arithmetic under every material decision, and it is where club-level games are decided.',
            when: 'Every capture decision, always.',
            whenNot: 'Never count a defender that cannot legally move or that is itself attacked and undefended.',
            coachMethod:
              'Have the student, for any capture, say out loud: "I take with X, they recapture with Y, net result is Z." Building that sentence is what prevents the blunder.',
            example: {
              student: 'I win their knight for free!',
              coach:
                'What recaptures? Say it out loud: "I take with the bishop, they recapture with the rook, net I am down a piece." Always finish the sentence.',
            },
            realGame: 'Ask the student to recount one game move by move using the full sentence.',
          },
          mistakes: [
            'Taking without checking the recapture.',
            'Counting a pinned defender as a real defender.',
            'Forgetting that the recapturing piece may itself be undefended.',
          ],
          board: {
            fen: '4k3/8/8/3N4/8/8/8/3QK3 w - - 0 1',
            caption: 'Count attackers and defenders before you move. The knight on d5 is defended by the queen.',
            highlight: ['d5', 'd1'],
            arrows: [['d1', 'd5']],
          },
          practice: [
            {
              fen: '4k3/4r3/8/8/3N4/8/8/4KQ2 w - - 0 1',
              prompt: 'White to move: Nxe6? Say the full sentence.',
              solution:
                '"I take with the knight from d5 on e6, black recaptures with the rook from e7, net I win a pawn and lose a knight — bad." The counting sentence is the whole lesson.',
              hint: 'Finish the sentence: net I am...',
            },
          ],
          teachBack: {
            brief: 'Teach attackers-minus-defenders as a spoken sentence before any tactic.',
            required: [
              'a defended piece punishes its capture',
              'count attackers and defenders before calculating',
              'a pinned or hanging defender does not count',
            ],
            lookFor: [
              'requires the full spoken sentence',
              'covers the double-count trap',
            ],
          },
          misconception: 'The student believes a piece is safe because it is defended, without checking that the defender is free to capture back.',
          puzzlePrompt: 'Create a position where the apparent defender is pinned, so the capture is actually free.',
          test: [
            {
              q: 'A knight is defended by a bishop that is absolutely pinned. Is the knight safe to capture?',
              options: [
                'Yes, it is defended',
                'No — the pinned bishop cannot legally recapture',
                'Only if the knight is on a light square',
                'It depends on the move order',
              ],
              answer: 1,
              explain: 'A defender that cannot legally recapture provides no protection. Pinned defenders must be discounted.',
            },
          ],
        },
        {
          id: 'l2-undefended',
          name: 'Undefended Pieces',
          summary: 'When nothing holds it — and when that is fine.',
          content: {
            definition:
              'An undefended piece has no friendly piece protecting it, so it can be captured without any exchange.',
            deep:
              'Undefended is a neutral fact, not a verdict. Sometimes an undefended piece is exactly right — a rook on an open file where the file is worth more than the piece, a queen that has just attacked and will move next turn, a piece that is about to be defended. The teaching discipline is to know which case you are in before you leave the piece where it is, and to say why out loud.',
            why: 'It makes the coach precise about *why* leaving material is acceptable, which is the beginning of real judgement.',
            when: 'Anytime a piece has no defender and the opponent can reach it.',
            whenNot: 'Not when it is a piece you need and cannot replace.',
            coachMethod:
              'Require a justification before allowing a piece to sit undefended: "it is undefended because..." and the acceptable answers are that it will be defended, it is about to move to safety, or its square is worth more than it is.',
            example: {
              student: 'My queen is undefended.',
              coach:
                'Is that a problem? If she is about to attack or move, no. If she is staying, then yes, and that is the move you should not have played.',
            },
            realGame: 'Ask the student to mark every undefended piece in a real position and justify each.',
          },
          mistakes: [
            'Leaving a piece undefended with no plan.',
            'Calling a piece safe because it is undefended but high-value.',
            'Not noticing your own undefended pieces.',
          ],
          board: {
            fen: '4k3/8/8/8/8/8/8/4K2Q w - - 0 1',
            caption: 'The queen on g1 is undefended. Fine if she moves immediately; a problem if she stays.',
            highlight: ['g1'],
            arrows: [['g1', 'h2']],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1',
              prompt: 'Is the queen on e2 undefended, and does it matter?',
              solution:
                'It is undefended. Whether that matters depends entirely on whether it stays there — a queen that is about to capture something is fine being undefended. The lesson is to state the reason rather than assume either way.',
              hint: 'Undefended is a fact; the plan decides if it is a problem.',
            },
          ],
          teachBack: {
            brief: 'Teach undefended as a fact the coach must justify, not a rule to obey blindly.',
            required: [
              'undefended means no friendly defender',
              'sometimes correct, when there is a reason',
              'state the reason before leaving a piece',
            ],
            lookFor: [
              'avoids dogmatism',
              'asks for justification rather than compliance',
            ],
          },
          misconception: 'The student treats "undefended" as automatically wrong, or automatically fine.',
          puzzlePrompt: 'Create two positions with identical undefended pieces where one is correct and one is a blunder.',
          test: [
            {
              q: 'When is leaving a piece undefended correct?',
              options: [
                'Never',
                'When it is about to be defended, move to safety, or holds a more valuable square',
                'Only for pawns',
                'Only in the endgame',
              ],
              answer: 1,
              explain: 'Undefended is a state, not a mistake. The justification is what makes it sound.',
            },
          ],
        },
        {
          id: 'l2-backrank',
          name: 'Back Rank Mate',
          summary: 'The most common beginner mate — and its one condition.',
          content: {
            definition:
              'A back rank checkmate is checkmate delivered by a rook or queen along the back rank, where the defending king cannot escape because its own pawns block every flight square.',
            deep:
              'The entire motif depends on one thing: the king\'s own pawns have not moved, or have not moved far enough to give it air. That is why "push the h-pawn" or "push the g-pawn" is often the losing move against an uncastled king. Teach the pattern as a checklist the coach can apply to any position with a castled king: is there a flight square? If not, the back rank is available.',
            why: 'It is the mate that beginners fall for most often, and recognising it teaches them to respect their own pawn shield.',
            when: 'Against a king that has not moved its pawns forward from its home squares.',
            whenNot: 'When the defending side has a flight square, or a piece that can interpose.',
            coachMethod:
              'Show the mate, then ask the student how to prevent it — the answer (create a flight square) teaches defence. Then show a position where the defender gave it away with a single pawn push.',
            example: {
              student: 'How did he mate me on the back rank?',
              coach:
                'Look at your own pawns. They were all still on their home squares, so your king had nowhere to go. Which pawn could you have moved earlier to give yourself a square?',
            },
            realGame: 'Ask the student to find every game they lost to a back rank mate and identify the pawn push that caused it.',
          },
          mistakes: [
            'Believing castling makes the king safe — castling with no flight square makes it vulnerable to exactly this.',
            'Pushing a pawn with no purpose and creating the back rank weakness.',
            'Not checking for a flight square before castleing.',
          ],
          board: {
            fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
            caption: 'Ra8# — the black pawns on f7 g7 h7 seal every escape square on the back rank.',
            highlight: ['g8', 'f7', 'g7', 'h7', 'a1', 'a8'],
            arrows: [['a1', 'a8']],
          },
          practice: [
            {
              fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
              prompt: 'Give mate in one and state which piece prevents the escape.',
              solution:
                'Ra8#. The check is along the 8th rank; the king cannot reach f8 or h8 because it is in check from the rook, and f7, g7 and h7 are occupied by its own pawns. Those three pawns are the whole defence.',
              hint: 'Enumerate every escape square and close each one.',
            },
          ],
          teachBack: {
            brief: 'Teach back rank mate as a pattern with one condition, and how to prevent it.',
            required: [
              'rook or queen checks along the back rank',
              'the king\'s own pawns block every flight square',
              'a flight square prevents it entirely',
            ],
            lookFor: [
              'teaches prevention, not just the pattern',
              'links it to careless pawn pushes',
            ],
          },
          misconception: 'The student believes castling protects the king from back rank mates.',
          puzzlePrompt: 'Create a game fragment where an unnecessary pawn push sets up a back rank mate.',
          test: [
            {
              q: 'What single condition makes back rank mate possible?',
              options: [
                'The king is on a light square',
                'The defending king has no flight square because its own pawns are unmoved',
                'There is no queen on the board',
                'It is White to move',
              ],
              answer: 1,
              explain: 'The mate is entirely a function of the king having nowhere to go. Give it one square and the mate is impossible.',
            },
          ],
        },
        {
          id: 'l2-removingdefender',
          name: 'Removing the Defender',
          summary: 'Make the attack work by first removing the piece that defends it.',
          content: {
            definition:
              'Removing the defender means sacrificing or deflecting a piece that protects a target, so that the target can then be captured safely.',
            deep:
              'This is the general engine behind most combinations, because it explains why a piece can suddenly be worth taking: its protection has gone. The classic sub-patterns are deflection (pull the defender away) and decoy (lure it). Teach it as the question: what is defending the piece I want, and how do I make that defender leave or get in the way?',
            why: 'It is the connective tissue of combination play and it makes the coach think in terms of targets rather than lucky captures.',
            when: 'Whenever the piece you want to win is defended.',
            whenNot: 'When the defender cannot be removed — then you need a different idea.',
            coachMethod:
              'Have the student, for every hanging piece on the board, name its defender and then ask what it would take to remove that defender. It trains target-based thinking.',
            example: {
              student: 'I want that knight but it is defended.',
              coach:
                'Fine — what is defending it? Now: how do you make that defender step away? Often the answer is a sacrifice, and the sacrifice is not really a sacrifice at all.',
            },
            realGame: 'Ask the student to identify the defender of the piece they won in their last game and how it was removed.',
          },
          mistakes: [
            'Attacking a defended piece as though it were free.',
            'Not noticing that a sacrifice was only winning because it removed a defender.',
            'Sacrificing when the defender could have been attacked instead.',
          ],
          board: {
            fen: '4k3/8/8/3N4/8/8/4r3/4K3 w - - 0 1',
            caption: 'The knight on d5 is defended by nothing here. Find the position where it is defended and see what changes.',
            highlight: ['d5', 'e2'],
            arrows: [['e2', 'd5']],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/8/4r3/3RK3 w - - 0 1',
              prompt: 'The rook on d1 is attacked by the rook on e2. What makes this interesting?',
              solution:
                'Rxd2 wins the rook only if nothing recaptures on d2. The whole lesson is that a capture is only interesting once you have checked what defends the square you are capturing onto.',
              hint: 'What defends d2?',
            },
          ],
          teachBack: {
            brief: 'Teach "remove the defender" as target-based thinking behind combinations.',
            required: [
              'a defended piece can be won once its defender is gone',
              'deflection and decoy are the common methods',
              'identify the defender before calculating the capture',
            ],
            lookFor: [
              'asks the student to name the defender first',
              'links to deflection and decoy',
            ],
          },
          misconception: 'The student believes a defended piece cannot be won, rather than that its protection must be dealt with first.',
          puzzlePrompt: 'Create a combination where winning a piece requires sacrificing a queen to deflect its defender.',
          test: [
            {
              q: 'What is the general method behind deflection and decoy?',
              options: [
                'Opening the centre',
                'Removing the piece that defends the target',
                'Castling early',
                'Trading minors',
              ],
              answer: 1,
              explain: 'Both are ways of dealing with a defender so the protected piece can be taken.',
            },
          ],
        },
        {
          id: 'l2-deflection',
          name: 'Deflection',
          summary: 'Pull the defender off the piece it is protecting.',
          content: {
            definition:
              'Deflection is a sacrifice that draws a defending piece away from the square or target it is guarding, leaving that target vulnerable.',
            deep:
              'The piece you sacrifice often cannot actually be captured — its only job is to force a reply that pulls the defender off duty. That is what confuses students, who see a queen being offered and assume something is wrong. The coach should explain that the "sacrifice" is often a decoy of attention as much as material. Recognising when a defender is doing exactly one job is the skill.',
            why: 'It is the most common structural reason a combination works, and it teaches the coach to see defenders as mobile pieces with jobs.',
            when: 'When the piece you want is guarded by one specific piece you can pull away.',
            whenNot: 'When there is no single defender to pull, or it can be defended by something else instead.',
            coachMethod:
              'Have the student point at the defender of their target and ask "what is that piece doing?" If the answer is "guarding e5", then deflection is available and the student should find the lure.',
            example: {
              student: 'You want me to give up my queen?',
              coach:
                'I want you to give that queen to pull the defender off e5. Watch what happens when they take it — and watch what is now undefended.',
            },
            realGame: 'Ask the student to find a deflection in their last game, even a quiet one.',
          },
          mistakes: [
            'Not seeing that a sacrifice is really a deflection.',
            'Deflecting the wrong piece when two defenders are present.',
            'Assuming the defender can simply refuse to be pulled.',
          ],
          board: {
            fen: '4k3/8/8/3N4/8/8/4r3/4K3 w - - 0 1',
            caption: 'If the black rook on e2 is defending something, deflect it and the target falls.',
            highlight: ['e2', 'd5'],
            arrows: [],
          },
          practice: [
            {
              fen: '4k3/8/8/8/8/2q5/8/3RK3 w - - 0 1',
              prompt: 'White wants the d-file. What is the black queen on c3 doing, and how do you remove it from duty?',
              solution:
                'The queen on c3 is defending d2 and restraining the rook. Deflect it with something it must capture, and then the rook and d-file are free. Identify the job before finding the lure.',
              hint: 'Name the defender\'s job first, then find the lure.',
            },
          ],
          teachBack: {
            brief: 'Teach deflection as "name the defender\'s job, then pull it away".',
            required: [
              'a sacrifice draws a defender from its duty',
              'the sacrificed piece may not actually be captured',
              'one defender, one job',
            ],
            lookFor: [
              'requires naming the defender\'s job first',
              'explains why an apparently odd sacrifice is sound',
            ],
          },
          misconception: 'The student thinks the sacrificed piece must genuinely be lost, and so rejects sound deflections.',
          puzzlePrompt: 'Create a position where the only winning line begins with a queen sacrifice used purely as a deflection.',
          test: [
            {
              q: 'In a deflection, why does the opponent often take the offered piece?',
              options: [
                'Because they win material',
                'Because the defender has a job elsewhere and taking the lure is the forced reply',
                'Because it is free',
                'They do not',
              ],
              answer: 1,
              explain: 'The defender is being pulled off duty. Taking the lure is usually forced, and it is the point of the combination.',
            },
          ],
        },
        {
          id: 'l2-basicthreats',
          name: 'Basic Tactical Threats',
          summary: 'The four questions that surface almost every tactic.',
          content: {
            definition:
              'Basic tactical threats are the recurring winning intentions in a position: capture something undefended, win material by a fork or pin, promote a passed pawn, checkmate, or escape from a threat.',
            deep:
              'Rather than a pattern list, teach a scanning routine that finds threats in any position. For each side ask: what does it want to attack, what does it want to move to, what is loose, and what is my king doing? Students who run those four questions every move stop missing tactics without needing to memorise dozens of motifs. This is the single highest-leverage coaching habit in the whole of Level 2.',
            why: 'A routine generalises to every position, including ones neither coach nor student has seen.',
            when: 'Every position, every move.',
            whenNot: 'Never in a time-troubled endgame where technique matters more than calculation.',
            coachMethod:
              'Teach the four questions explicitly and require them aloud for the first twenty games. Then fade the requirement gradually — the habit has to become internal.',
            example: {
              student: 'I never saw it.',
              coach:
                'Run the four: what can I attack, what can it attack, what is loose, where is my king. Run them every move and you will see it.',
            },
            realGame: 'Have the student annotate their last game writing the four questions\' answers at each critical moment.',
          },
          mistakes: [
            'Only looking at your own pieces.',
            'Forgetting to check what the opponent attacks.',
            'Not running the routine under time pressure.',
          ],
          board: {
            fen: '4k3/8/8/3N4/8/3q4/8/4K3 w - - 0 1',
            caption: 'Run all four questions: my attack, its attack, what is loose, my king. Then decide.',
            highlight: ['d5', 'd3'],
            arrows: [],
          },
          practice: [
            {
              fen: '4k3/8/8/3N4/8/3q4/8/4K3 w - - 0 1',
              prompt: 'Run the four questions and state the single most urgent threat.',
              solution:
                'White: the knight on d5 is loose. Black: the queen on d3 attacks d5 and the white king. Most urgent: the knight is attacked by the queen and is undefended — either defend it or move it. The routine produces the answer without any pattern recognition.',
              hint: 'Four questions, in order.',
            },
          ],
          teachBack: {
            brief: 'Teach the four-question scanning routine as the replacement for memorising patterns.',
            required: [
              'what can I attack',
              'what can my opponent attack',
              'what is loose on the board',
              'where is my king',
            ],
            lookFor: [
              'requires the routine aloud at first',
              'explains the fading of the requirement',
            ],
          },
          misconception: 'The student relies on pattern recognition alone and misses tactics in unfamiliar positions.',
          puzzlePrompt: 'Create a position where no named tactic applies but the four-question scan finds the move.',
          test: [
            {
              q: 'Why is the four-question routine more useful than memorising tactics?',
              options: [
                'It is faster',
                'It works in positions you have never seen before',
                'It is an official rule',
                'It applies only to tactics',
              ],
              answer: 1,
              explain: 'It generalises. A pattern list only covers what you have already seen.',
            },
          ],
        },
      ],
    },
  ],
};