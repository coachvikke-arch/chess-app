/**
 * Level 3 — Advanced Tactics.
 *
 * Level 2 taught the single-move motifs. Level 3 is where motifs become
 * *combinations*: two forcing ideas in a row, where the point is that the
 * opponent cannot refuse the first one. The coaching emphasis therefore shifts
 * from "spot the pattern" to "build the chain and count it through".
 */
export default {
  n: 3,
  id: 'level-3',
  title: 'Advanced Tactics',
  tagline: 'Combinations, decoys and mating nets.',
  description:
    'The motifs that need two ideas at once, plus a working catalogue of fork patterns and mating patterns the coach can recognise instantly.',
  finalTask: 'Create and teach a 10-minute tactical lesson.',
  finalExam: { title: 'Level 3 Final Exam', passMark: 80, sections: ['theory', 'tactical', 'teaching'] },
  competency: ['Tactical Skill', 'Calculation'],
  modules: [
    {
      id: 'l3-m1',
      title: 'Building Combinations',
      description: 'The mechanics of a combination: forcing moves, checks, captures, threats and the chain that links them.',
      topics: [
        {
          id: 'l3-combo',
          name: 'Combination Basics',
          summary: 'A combination is a forced sequence, not a lucky sequence.',
          content: {
            definition:
              'A combination is a sequence of usually forcing moves — checks, captures and threats — in which every opponent reply is known or limited, so the winning idea survives whatever the defence chooses. A combination is only real if it works against the best defence.',
            deep:
              'The single most important coaching distinction is forcing versus hopeful. A forcing move removes options: check, or a capture that is genuinely there. A hopeful move just states a threat the opponent may decline. Students routinely find a good idea, play a hopeful move instead of the forcing one, and then cannot understand why it stopped working. Teach the sequence of checks: if one side has a series of checks, the opponent has almost nothing to decide, so the combination is cheap to verify. If neither side can check, then the combination only holds if you have checked every single reply, and you should be honest about that uncertainty.',
            why: 'Level 2 motifs win material. Combinations win games, because they convert a material edge into checkmate.',
            when: 'When you have a check, a capture, or a threat with only one defence and you have already counted the continuation.',
            whenNot: 'When the sequence depends on the opponent declining a threat. If the opponent has two defences, you must calculate both branches.',
            coachMethod:
              'Teach the two-question routine. Before calculating, ask: (1) what are my forcing moves, and (2) after each one, what can the opponent do? Then work the chain out loud, one branch at a time. Finally, ask the killer question — "if they play the best defence, is it still a win?" A student who answers "I did not check that branch" has found their own homework.',
            example: {
              student: 'I found a way to win their queen, so I have a combination.',
              coach:
                'You have an idea. Let us check whether it is forced. After you take the queen, what can Black do? Give me their best reply, not their worst one. If it only works because they blundered, it is not a combination — it is a coincidence.',
            },
            realGame:
              'Review a game where the student found a winning combination but played it in the wrong order. The order is usually the whole lesson.',
          },
          mistakes: [
            'Calling a lucky sequence a combination because the opponent hung a piece.',
            'Calculating only the opponent\'s worst reply.',
            'Starting a combination with a hopeful move when a forcing move was available.',
          ],
          board: {
            fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4',
            caption: 'White has a forcing sequence available; the first move decides whether it is a combination or a hope.',
            highlight: ['f3', 'f7', 'c4'],
            arrows: [['f3', 'f7'], ['c4', 'f7']],
          },
          practice: [
            {
              fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4',
              prompt: 'Name every forcing move White has in this position, in order of strength.',
              solution:
                'Qxf7# is the finish to aim for, and the forcing moves that lead to it are checks: Qxf7 is not check, but Qxf7+ is. Build the chain from forcing moves only, and verify each opponent reply.',
              hint: 'List the checks first. A chain of checks is nearly impossible to get wrong.',
            },
          ],
          teachBack: {
            brief: 'Teach a student the difference between a combination and a lucky sequence.',
            required: [
              'a combination must survive the best defence',
              'forcing moves are checks, captures and single-reply threats',
              'you must calculate every branch the opponent has',
            ],
            lookFor: [
              'makes the student state the opponent\'s best reply',
              'uses the "is it still a win after the best defence?" question',
            ],
          },
          misconception: 'The student believes that finding a winning idea automatically makes it a combination, and does not check whether the opponent can refuse it.',
          puzzlePrompt:
            'Create a position where a tempting capture is NOT a combination, and a checking sequence is. Ask the student to explain the difference.',
          test: [
            {
              q: 'What makes a sequence a real combination rather than a lucky sequence?',
              options: [
                'It wins material',
                'It works against the opponent\'s best defence, not just their worst',
                'It begins with a check',
                'It takes more than three moves',
              ],
              answer: 1,
              explain:
                'A combination must survive every legal reply. If it only works because the opponent chose badly, it was not a combination.',
            },
            {
              q: 'Which move type is forcing?',
              options: ['A quiet developing move', 'A move that creates only a threat', 'A check', 'A castle'],
              answer: 2,
              explain:
                'A check forces a reply, which removes the opponent\'s choice. That is what makes a chain of checks verifiable.',
            },
          ],
        },
        {
          id: 'l3-sac',
          name: 'Sacrificing Material',
          summary: 'When giving up material is correct, and how to teach the justification.',
          content: {
            definition:
              'A material sacrifice is giving up material — a piece for a pawn, a queen for a rook — because the resulting position is better than the material count suggests, usually because it forces checkmate or wins decisive time.',
            deep:
              'The teaching point is that a sacrifice is only ever evaluated by what comes after it. The correct question is never "am I up material?" but "what does my opponent get in exchange, and what does that buy me?". A sacrifice that leads to checkmate is not a sacrifice at all in outcome — it is a winning attack that costs nothing that mattered. Train the student to say the justification out loud: "I give the queen because the forced checks mate, so the material never came into play." That single sentence separates a real sacrifice from an unsound one, and unsound sacrifices are the single biggest source of lost games at club level.',
            why: 'Nearly all checkmate patterns are built on sacrifices, so a coach who cannot recognise a justified sacrifice cannot teach mating nets.',
            when: 'When there is a forced mate, a decisive attack, or a position where material genuinely does not matter (a perpetual check, or a king hunt).',
            whenNot: 'Never "to simplify", and never on general principle. An unjustified sacrifice is worse than not looking, because it concedes real material.',
            coachMethod:
              'Always require the justification before allowing the move on the board. Make it a rule in your lessons: "no sacrifice without a reason". Then show a position where the same piece is correctly sacrificed and a near-identical one where it is not, and ask what differs. The near-miss is what teaches; the clean example only confirms.',
            example: {
              student: 'I am giving up my queen. Is that bad?',
              coach:
                'That depends entirely on what you get for it. Where does your king go next? Show me the forced line. If the answer is "he cannot stop the checks", the queen was never really lost. If the answer is "he can trade and I am a pawn down", then yes, it was bad.',
            },
            realGame:
              'Find a game where a student (or you) sacrificed and it worked, then one where it did not. Comparing the two justifications is a complete lesson on the topic.',
          },
          mistakes: [
            'Sacrificing to "create activity" with no concrete follow-up.',
            'Giving up material to simplify instead of to attack.',
            'Assuming the opponent will decline the offered material.',
          ],
          board: {
            fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
            caption: 'A rook sacrifice on d8 leads to forced checks. The material is irrelevant once the attack is unstoppable.',
            highlight: ['g8', 'g7', 'f7', 'h7'],
            arrows: [['d1', 'd8']],
          },
          practice: [
            {
              fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
              prompt: 'State the justification for Rd8 here. What does the rook buy that the material count does not show?',
              solution:
                'Rd8! Rxd8 and then the checks begin — the rook forces Black to answer, and every answer leads to more checks and mate. The rook is spent to buy a forced sequence, which is the entire definition of a justified sacrifice.',
              hint: 'Do not count material. Trace the checks after the sacrifice.',
            },
          ],
          teachBack: {
            brief: 'Teach a student when a material sacrifice is correct, and make them state the justification.',
            required: [
              'a sacrifice is judged by what follows, not by the count',
              'the justification must be concrete: forced mate or decisive attack',
              'material only does not matter when the attack never lets the opponent use it',
            ],
            lookFor: [
              'refuses to accept a sacrifice without a stated reason',
              'shows a sacrifice that was unsound and explains why',
            ],
          },
          misconception: 'The student believes that sacrificing material is always wrong, or that it is always acceptable when "it creates threats".',
          puzzlePrompt:
            'Create a two-part puzzle: position A where the sacrifice is justified, position B where it is not, and have the student explain both.',
          test: [
            {
              q: 'What is the correct justification for a material sacrifice?',
              options: [
                'It simplifies the position',
                'It creates activity',
                'It forces checkmate or a decisive attack',
                'The opponent cannot refuse it',
              ],
              answer: 2,
              explain:
                'The justification must be concrete and verifiable: forced mate, or an attack that decides the game. Activity and simplification are not reasons.',
            },
            {
              q: 'When is material genuinely irrelevant in a position?',
              options: [
                'When you are ahead',
                'When the attack forces mate or a perpetual check before the material can be used',
                'In the endgame only',
                'When the opponent is a beginner',
              ],
              answer: 1,
              explain:
                'Material stops mattering once the opponent cannot use it — when checks are forced, or when mate is already forced.',
            },
          ],
        },
        {
          id: 'l3-deflect',
          name: 'Deflection & Interference',
          summary: 'Move the guard away, or get in the way, and the guarded piece falls.',
          content: {
            definition:
              'Deflection is forcing the defending piece away from the square or duty it is guarding, so the guarded target can be captured. Interference is placing a blocking piece in the line between the attacker and the target, preventing a capture that would otherwise stop the attack.',
            deep:
              'The coaching insight is that defenders are only strong because of what they protect. Deflection attacks the job, not the piece. Show the student that deflection and interference are the same idea seen from two sides — both insert a fact that invalidates the defender\'s plan. A strong practical habit for students: when you see an enemy piece guarding something, ask "can I make it go somewhere else?" That question generates deflection ideas automatically and is far more reliable than pattern recognition.',
            why: 'Deflection is the engine behind most mating nets and behind many combinations, because it is how you break open a defended target.',
            when: 'When the piece you want to attack is defended by another piece, or when a sliding capture is blocked.',
            whenNot: 'Do not deflect a defender who has no job, and do not deflect when the deflected piece can simply come back and win something.',
            coachMethod:
              'Teach it as a question to ask of every defender: "what is this piece protecting, and can I make it stop doing that?" Then require the student to identify the deflected piece explicitly before they play the move. The naming discipline prevents accidental deflection that achieves nothing.',
            example: {
              student: 'I want to take that queen but it is defended.',
              coach:
                'Good — the defence is the interesting part. Which piece is doing the defending? What is it also doing? Now: can you make that piece go somewhere else?',
            },
            realGame:
              'Ask the student to find a deflection in their own last game where the deflected piece had a second job. That second job is usually the game.',
          },
          mistakes: [
            'Attacking a defended piece without asking what the defender is guarding.',
            'Deflecting a piece that comes straight back with tempo.',
            'Confusing deflection with simply moving a piece out of the way.',
          ],
          board: {
            fen: '4k3/8/8/3q4/8/8/3Q4/4K3 w - - 0 1',
            caption: 'The queen on d5 is defended by the king. Attacks on it must first move the king away.',
            highlight: ['d5', 'd2', 'e8'],
            arrows: [['d2', 'e3']],
          },
          practice: [
            {
              fen: '4k3/8/8/3q4/8/8/3Q4/4K3 w - - 0 1',
              prompt: 'The white queen on d2 attacks the queen on d5, which is defended by the black king. Find a deflection.',
              solution:
                'Qe2+ deflects: the king must step away from the d-file, and then the queen on d5 is attacked with no defender. That is the whole theme — move the guard, then take the target.',
              hint: 'Ask: can I make the king go somewhere else?',
            },
          ],
          teachBack: {
            brief: 'Teach deflection as attacking the defender\'s job rather than the defender.',
            required: [
              'deflection forces a defender away from its duty',
              'interference blocks a line that would otherwise stop the attack',
              'both work by making the defence fail',
            ],
            lookFor: [
              'makes the student name the deflected piece before playing',
              'generates the idea from "what is it protecting?"',
            ],
          },
          misconception: 'The student thinks a defended piece cannot be attacked at all, instead of asking what could make the defender leave.',
          puzzlePrompt:
            'Build a deflection puzzle where the defending piece has two jobs, and the student must identify which job they are breaking.',
          test: [
            {
              q: 'What is deflection?',
              options: [
                'Capturing the defender first',
                'Forcing a defending piece away from the square or duty it is guarding',
                'Moving a piece out of the way',
                'Giving up material',
              ],
              answer: 1,
              explain:
                'Deflection attacks the job. Move the guard off its duty and the guarded piece becomes undefended.',
            },
            {
              q: 'Interference works by:',
              options: [
                'Removing the defending piece',
                'Placing a piece in the line so the capture cannot happen',
                'Giving check',
                'Attacking from two squares',
              ],
              answer: 1,
              explain:
                'Interference blocks the line between attacker and target, so the capture that would have stopped the attack never happens.',
            },
          ],
        },
        {
          id: 'l3-clearance',
          name: 'Clearance Sacrifice',
          summary: 'Give one piece up to open a line for another.',
          content: {
            definition:
              'A clearance sacrifice is the deliberate removal of a piece — often a pawn — from a line, file or diagonal so that another piece can deliver an attack or checkmate along it.',
            deep:
              'This is the specific pattern that produces most back-rank and file attacks. The reason it matters so much for coaching is that it is completely invisible to a student who is only looking for captures on the target. The student sees a strong enemy piece and thinks about taking it; they do not think about *moving* it. Teach the recognition question: "which of my pieces needs a clear line, and what is standing in the way?" That single question finds clearance sacrifices in positions a student would otherwise call quiet.',
            why: 'It is the mechanism behind the most common mating net in chess, and it is the answer when a student asks "how do I get my rook onto that rank?".',
            when: 'When a line attack exists but your own piece or pawn is blocking the attacking piece.',
            whenNot: 'When the blocking piece is the one you want to keep for the endgame, or when the line is not actually going to produce anything.',
            coachMethod:
              'Present clearance sacrifices as an answer to a blocked plan rather than as a standalone tactic. Show the position with the plan (rook to the seventh, bishop to the long diagonal) and ask why it is not working. Then ask what is in the way. The student names the blocker; you ask whether they would give it up. That sequence teaches the recognition habit rather than a list.',
            example: {
              student: 'I want to bring my rook to the seventh rank but nothing happens.',
              coach:
                'Nothing happens because of a rule, not because the plan is bad. Look along the files. Which of your own pieces is in the way? Would you give it up?',
            },
            realGame:
              'Have the student review their wins and identify the move that cleared the decisive line. It is often a pawn move they made without noticing its purpose.',
          },
          mistakes: [
            'Not seeing the blocked line because attention was only on the target piece.',
            'Giving up the blocker when a better attacking piece exists.',
            'Assuming the line attack will work after clearing when the defender can still stop it.',
          ],
          board: {
            fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
            caption: 'The pawn on f2 blocks the file. Moving it opens the 7th rank for the rook — that is a clearance idea.',
            highlight: ['e1', 'f2', 'e7', 'e8'],
            arrows: [['f2', 'f3'], ['e1', 'e7']],
          },
          practice: [
            {
              fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
              prompt: 'Identify the clearance sacrifice in this position and state what it opens.',
              solution:
                'e3! (or f3) clears the f-file for the rook to penetrate, supporting a later Re7 or Rf8#. The pawn is spent to buy the attack; that is the justification.',
              hint: 'Which of your own pieces is standing in the way?',
            },
          ],
          teachBack: {
            brief: 'Teach clearance sacrifice as the answer to a blocked plan.',
            required: [
              'a clearance sacrifice removes a blocker from a line',
              'it is usually a pawn, given for a line attack',
              'it is found by asking which line you need and what is in the way',
            ],
            lookFor: [
              'asks the student to name the blocked line first',
              'connects the idea to back-rank attacks',
            ],
          },
          misconception: 'The student only looks for moves that capture, and never considers moving their own pieces out of the way.',
          puzzlePrompt:
            'Build a puzzle where the winning move is a pawn move that nobody would think was a sacrifice, because it captures nothing.',
          test: [
            {
              q: 'What is a clearance sacrifice?',
              options: [
                'Sacrificing a piece to open a line for another piece',
                'Clearing the board for the endgame',
                'Giving up a pawn for nothing',
                'Trading off your worst piece',
              ],
              answer: 0,
              explain:
                'It removes a blocker from a file, rank or diagonal so another piece can attack along it. Usually the blocker is a pawn.',
            },
            {
              q: 'Which question best generates clearance ideas?',
              options: [
                'What can I capture?',
                'Which of my pieces needs a clear line, and what is standing in the way?',
                'How much material do I have?',
                'Is my king safe?',
              ],
              answer: 1,
              explain:
                'That question turns a blocked plan into a concrete move. Capture-first thinking misses clearance entirely.',
            },
          ],
        },
        {
          id: 'l3-betweenzug',
          name: 'Intermediate Move',
          summary: 'Play a useful move in the middle of someone else\'s combination.',
          content: {
            definition:
              'An intermediate move (zwischenzug, "in-between move") is a move played during a combination that is not part of the combination\'s sequence but improves your position — usually winning material, activating a piece, or making a threat — before you continue with the original combination.',
            deep:
              'This is the highest-value habit in all of tactics, and the reason the coach should look for it in every combination a student finds. The key insight is that the defender is compelled to answer checks and respond to threats, so they have no time to use the loose piece you just spotted. The student who checks their own found combination for a zwischenzug wins material very often; the one who plays the sequence mechanically gets the intended result and nothing more. Teach it as a mandatory pause: "before you continue, look once more — is there something better you could do right now?"',
            why: 'It converts a normal advantage into a winning one, and it is the difference between seeing tactics and capitalising on them.',
            when: 'Whenever you are in the middle of a sequence and the opponent is in check or under a forced obligation.',
            whenNot: 'When the sequence leads to immediate checkmate — then the mate is the better move. Also not when the "in-between" move allows the defence to escape.',
            coachMethod:
              'Never let a student play out a combination without stopping once for the zwischenzug check. Say it as a fixed routine: "sequence, pause, continue". Then require them to name *why* the opponent cannot answer the in-between move — usually because they are in check. That justification is what separates a real zwischenzug from a random pawn grab.',
            example: {
              student: 'So I just play my combination all the way through?',
              coach:
                'You play it — but before each step, look for something better. Right now they are in check, which means they cannot do anything about the loose piece on a7. Is taking it stronger than finishing the line?',
            },
            realGame:
              'Give a student a winning combination and hide the zwischenzug. Have them play it out, then show what they missed. Nothing teaches the habit faster.',
          },
          mistakes: [
            'Playing the sequence mechanically when a stronger in-between move existed.',
            'Assuming the opponent cannot respond because they are in check, when your move gives them a way out.',
            'Forgetting to look for one at all.',
          ],
          board: {
            fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5',
            caption: 'White has a sequence available; the question is whether something better comes first.',
            highlight: ['c6', 'a7', 'f6'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5',
              prompt: 'Before playing any combination here, check for an intermediate move. What does Black not get to do while in check?',
              solution:
                'Black is in check and therefore cannot save the loose a7 pawn or improve their position first. In a real combination, that is exactly the resource the zwischenzug exploits.',
              hint: 'A side in check cannot respond to anything else. What does that mean for the loose pieces?',
            },
          ],
          teachBack: {
            brief: 'Teach the student to check for an intermediate move before playing out any combination.',
            required: [
              'an intermediate move is played during a sequence, not as part of it',
              'the opponent is usually in check and cannot answer it',
              'you must justify why the in-between move is safe',
            ],
            lookFor: [
              'institutes a "sequence, pause, continue" routine',
              'requires the student to justify the in-between move',
            ],
          },
          misconception: 'The student believes a combination must be played exactly as found, with no deviations.',
          puzzlePrompt:
            'Give a student a combination that wins material, plus a zwischenzug that wins more, and make them find the better line.',
          test: [
            {
              q: 'An intermediate move is best described as:',
              options: [
                'The first move of a combination',
                'A move played during a combination that improves your position before you continue',
                'A quiet move made in the opening',
                'A move that gives up material',
              ],
              answer: 1,
              explain:
                'It is a detour inside a sequence that improves your position while the opponent is compelled to answer.',
            },
            {
              q: 'Why is an intermediate move often safe to play?',
              options: [
                'It is always a capture',
                'The opponent is usually in check or under a forced obligation and cannot respond',
                'It cannot be captured',
                'It gives check itself',
              ],
              answer: 1,
              explain:
                'Because the opponent has no free move while answering a check or a forced threat.',
            },
          ],
        },
        {
          id: 'l3-zugzwang',
          name: 'Zugzwang',
          summary: 'Being forced to move when every move makes things worse.',
          content: {
            definition:
              'Zugzwang is the situation where the player to move is worse off than if it were their opponent\'s turn — every legal move loses something. It is not a tactic but a positional feature, and it arises mainly from having too many pawns that have to move.',
            deep:
              'The coaching value is that zugzwang explains a huge number of positions that look equal or lost and are not. The classic case is opposite-side pawn endgames where the side with pawns on the fifth rank wins because the other side must move first. Teach the recognition pattern: count the pawn moves each side is forced to make. If one side has several pawns that must move and the other has one, whoever is to move is losing the race. Then teach the counter-play: do not rush your own pawns — that is what creates your opponent\'s zugzwang.',
            why: 'It is one of the most common reasons a position is better or worse than material suggests, so a coach who cannot see it will misjudge endgames constantly.',
            when: 'In endgames where one side has pawns that must move, and in any position where being to move is a burden.',
            whenNot: 'Do not force a zugzwang when you are already winning and can win more directly.',
            coachMethod:
              'Use a pawn-move counting drill. Set a position, ask each student to list every pawn move their side is obliged to make, then ask who is worse off. That mechanical step teaches the concept better than any explanation, and it works on beginners who otherwise cannot discuss the topic at all.',
            example: {
              student: 'We have the same material, so this should be drawn.',
              coach:
                'Equal material is not the same as an equal position. Who has more pawns that have to move? Whoever is to move in that situation is running out of useful moves first.',
            },
            realGame:
              'Point out a zugzwang in a game the student has just played and ask them to identify the exact moment it became decisive.',
          },
          mistakes: [
            'Rushing pawns forward and creating your own zugzwang.',
            'Assuming equal material means an equal position.',
            'Missing the zugzwang and simplifying into a losing endgame.',
          ],
          board: {
            fen: '8/5p2/4P3/5k2/8/8/5P2/5K2 w - - 0 1',
            caption: 'The side to move must push a pawn; the pawns that cannot advance are the ones that matter.',
            highlight: ['f7', 'e6', 'f2', 'e4'],
            arrows: [['e6', 'e7'], ['f2', 'f3']],
          },
          practice: [
            {
              fen: '8/5p2/4P3/5k2/8/8/5P2/5K2 w - - 0 1',
              prompt: 'Count the pawn moves White is forced to make here. What does that tell you about the position?',
              solution:
                'White must play e7 and then f3-f4-f5, while Black can hold f7 and then advance. White is spending moves with nothing to gain — that is zugzwang working against the side to move.',
              hint: 'List every pawn move each side must make. Count them.',
            },
          ],
          teachBack: {
            brief: 'Teach zugzwang through counting forced pawn moves.',
            required: [
              'zugzwang means it is worse to be the side to move',
              'it usually comes from too many pawns that must advance',
              'the cure is to make your opponent move, not to rush your own pawns',
            ],
            lookFor: [
              'uses the forced-pawn-move counting drill',
              'links the concept to opposite-side pawn endgames',
            ],
          },
          misconception: 'The student believes equal material means an equal position, and cannot see why an apparently quiet endgame is lost.',
          puzzlePrompt:
            'Set two positions with equal material where one is a zugzwang and one is not, and ask the student to explain the difference.',
          test: [
            {
              q: 'Zugzwang means:',
              options: [
                'The side to move is better',
                'The side to move is worse off than if the opponent had to move',
                'Neither side can make a legal move',
                'Material is equal',
              ],
              answer: 1,
              explain:
                'Being to move is a disadvantage. Every available move costs the player something.',
            },
            {
              q: 'What usually creates a zugzwang?',
              options: [
                'Having many pawns that must advance',
                'Having a queen',
                'Castling',
                'Being in check',
              ],
              answer: 0,
              explain:
                'Pawns that must move spend tempo with no gain. The side with more of them, when to move, runs out of useful moves first.',
            },
          ],
        },
      ],
    },
    {
      id: 'l3-m2',
      title: 'Mate Pattern Catalogue',
      description: 'A working recognition library. A coach who names the pattern teaches faster and diagnoses faster.',
      topics: [
        {
          id: 'l3-mate-basics',
          name: 'Anatomy of Mate',
          summary: 'Mate is check plus three closed escape routes — learn to run the checklist under time pressure.',
          content: {
            definition:
              'Checkmate requires the king to be in check with no legal escape. The escape routes to close are three: flight squares the king could move to, captures of the checker, and blocks along the checking line.',
            deep:
              'Every named mate pattern is the same three-part checklist expressed differently, so teach the checklist once and then use it to name patterns. The patterns are worth memorising not because they are rules but because they save the coach and the student from searching: a recognised pattern means you already know the plan, so you spend your attention on whether the position actually contains it. The professional habit is to name the pattern out loud — "this is a back-rank mate" — which immediately tells both of you which squares to check.',
            why: 'It converts mate detection from a search into a recognition, which is the difference between finding mate and missing it.',
            when: 'Whenever you have a queen or two rooks near the enemy king, or a king that has run out of squares.',
            whenNot: 'Do not name a pattern and stop checking. The pattern tells you where to look; it does not confirm mate.',
            coachMethod:
              'Make the student narrate the checklist in a fixed order every time: check, flight squares, blocks, captures. Then, and only then, ask them to name the pattern. Doing it in that order prevents the common error of announcing a named pattern that does not actually hold. Give them a position that looks like a known pattern but is one flight square short, and let them discover the difference.',
            example: {
              student: 'It is a back-rank mate, right?',
              coach:
                'Run the checklist before you name it. Check — yes. Flight squares — where can the king go? Blocks — can anything get in? Captures — can anything take the rook? Only when all four answers are right do you name the pattern.',
            },
            realGame:
              'Ask the student to find every position in their last game where a mating pattern existed, whether or not they saw it.',
          },
          mistakes: [
            'Naming a pattern without running the escape-square check.',
            'Forgetting that the defender\'s own pieces block flight squares — which is what creates most mates.',
            'Announcing mate and then finding a block.',
          ],
          board: {
            fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
            caption: 'Back-rank mate: check along the rank, and the king\'s own pawns close all three flight squares.',
            highlight: ['g8', 'f7', 'g7', 'h7', 'a8'],
            arrows: [['a1', 'a8']],
          },
          practice: [
            {
              fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
              prompt: 'Run the four-part checklist on Ra8 here and state each answer.',
              solution:
                'Check: yes, along the 8th rank. Flight squares: f8 and h8 are covered by the rook on the same rank; f7, g7 and h7 are occupied by Black\'s own pawns. Blocks: nothing can reach the 8th rank. Captures: nothing can reach a8. Mate.',
              hint: 'Answer all four questions before you say the word mate.',
            },
          ],
          teachBack: {
            brief: 'Teach the four-part mate checklist and require the student to run it out loud.',
            required: [
              'check, flight squares, blocks, captures',
              'the defender\'s own pieces close most flight squares',
              'the pattern name comes after the checklist, not before',
            ],
            lookFor: [
              'makes the student narrate all four answers',
              'shows a lookalike position that fails on flight squares',
            ],
          },
          misconception: 'The student treats a named pattern as proof of mate rather than as a hint about where to look.',
          puzzlePrompt:
            'Create three positions that each resemble a named mate pattern, and make the student identify the one open escape square in each.',
          test: [
            {
              q: 'What are the three escape routes from check that must all be closed for mate?',
              options: [
                'Capture, block, counter-attack',
                'Move the king to a flight square, block the line, capture the checker',
                'Trade, castle, promote',
                'Only move the king',
              ],
              answer: 1,
              explain:
                'Those three, checked one at a time, are the complete test for mate.',
            },
            {
              q: 'Why do most mates happen on the back rank?',
              options: [
                'Because rooks are strongest on that rank',
                'Because the king\'s own unmoved pawns close its flight squares',
                'Because it is check',
                'Because queens cannot work elsewhere',
              ],
              answer: 1,
              explain:
                'The pawns that were never moved are what make the back rank a cage. This is why castling matters tactically, not just strategically.',
            },
          ],
        },
        {
          id: 'l3-backrank',
          name: 'Back-Rank Mate',
          summary: 'The most common mate in chess, and the clearest argument for castling.',
          content: {
            definition:
              'A back-rank mate delivers checkmate along the first or eighth rank against a king whose own pawns are still on its second or seventh rank, leaving no flight squares.',
            deep:
              'This pattern is the strategic argument for castling made in tactical form, and that is how coaches should present it: "you did not castle, and here is what it cost you". A student who has just lost a back-rank mate after declining to castle learns king safety permanently. Note that the pattern requires the pawns to be *unmoved* — as soon as one has moved, a flight square opens, and the mate stops working. Teach the check for it: count the defender\'s unmoved pawns. Two or more on the second rank plus a rank check is usually mate.',
            why: 'It is the single most frequently missed mate at club level, and it punishes a specific and teachable opening mistake.',
            when: 'The enemy king is on its back rank, unmoved pawns are still in front of it, and you have a rook or queen with access to the rank.',
            whenNot: 'When one of those pawns has moved — that is a flight square, and the pattern is not there.',
            coachMethod:
              'Show the student a game they lost to this pattern and trace it to the move where they should have castled. Then teach the recognition count: "how many of the king\'s pawns are still home?" Two or more means the flight squares are closed. Practice the pattern from both sides so the student can create it as well as avoid it.',
            example: {
              student: 'How did he check me on the back rank? I had three pawns there.',
              coach:
                'Those three pawns were the reason he could do it. Your king had nowhere to go, and your pawns were in the way. Where was your king two moves ago? What would have happened if you had castled?',
            },
            realGame:
              'Have the student scan their last ten games for back-rank mates — wins and losses. It is almost always a repeating pattern in the same opening.',
          },
          mistakes: [
            'Not castle and staying on the back rank with unmoved pawns.',
            'Assuming the pattern works even though a pawn has moved.',
            'Checking without knowing the flight squares are closed.',
          ],
          board: {
            fen: '5rk1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
            caption: 'Ra8# — Black\'s own pawns on f7, g7, h7 seal every flight square.',
            highlight: ['f8', 'g8', 'f7', 'g7', 'h7'],
            arrows: [['a1', 'a8']],
          },
          practice: [
            {
              fen: '5rk1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
              prompt: 'Which square would Black\'s king like to flee to, and what prevents it?',
              solution:
                'The king would want f7, g7 or h7, but its own pawns occupy all three. That is the entire back-rank idea: the defence is self-inflicted.',
              hint: 'Look at the squares directly in front of the king.',
            },
          ],
          teachBack: {
            brief: 'Teach back-rank mate and link it to the castle decision.',
            required: [
              'the pattern needs the king on its back rank',
              'unmoved pawns are what close the flight squares',
              'castling is the strategic prevention',
            ],
            lookFor: [
              'counts the unmoved pawns as a recognition test',
              'connects a lost game back to a specific opening decision',
            ],
          },
          misconception: 'The student believes a back-rank mate is a lucky tactic rather than a consequence of an opening decision.',
          puzzlePrompt:
            'Take a real back-rank mate from a student game and rewrite the position to show the castle that would have prevented it.',
          test: [
            {
              q: 'What makes a back-rank mate possible?',
              options: [
                'The king is in the centre with no pawns',
                'The king is on its back rank behind its own unmoved pawns',
                'The defender has lost a rook',
                'There is a queen involved',
              ],
              answer: 1,
              explain:
                'The unmoved pawns are the cage. Remove them and the flight squares open and the pattern disappears.',
            },
            {
              q: 'What is the strategic prevention for a back-rank mate?',
              options: [
                'Trading queens early',
                'Castling, which moves the king off the back rank',
                'Playing e4 early',
                'Avoiding checks',
              ],
              answer: 1,
              explain:
                'Castling takes the king off the back rank entirely, which removes the pattern before it exists.',
            },
          ],
        },
        {
          id: 'l3-arabian',
          name: 'Arabian Mate',
          summary: 'Rook, knight and the enemy king\'s own pawns form a suffocating corner.',
          content: {
            definition:
              'The Arabian mate is delivered by a rook delivering checkmate along a rank or file while a knight covers the flight squares — often aided by the defending king\'s own pawns.',
            deep:
              'The pattern teaches something broader: two pieces can create a mate net that neither could create alone. The rook supplies the check; the knight covers the squares the king would otherwise run to. Recognising which piece does which job is the transferable skill, because the student will meet the same division of labour in the Anastasia, Morphy and Pillsbury patterns. Point out explicitly that this is a "coverage plus check" pattern, not a rook trick.',
            why: 'It shows a beginner that a knight is not just an attacking piece — it is a king-cage builder.',
            when: 'The enemy king is on the edge with its own pawns nearby, and you have a rook with a clear line plus a knight covering the escape squares.',
            whenNot: 'When the king has open squares behind it — the net does not close.',
            coachMethod:
              'Build the net in front of the student one piece at a time: first put the knight on the covering square and ask "what can the king still do?" then add the rook and ask "and now?" That construction teaches the roles far better than showing the finished mate. Then ask them to reproduce it against a lone king with the knight and rook.',
            example: {
              student: 'Why did that knight matter?',
              coach:
                'Because it closed the squares. My rook gave the check, but without the knight covering h8 and g7 the king simply walks out. Two pieces, two jobs — that is the pattern.',
            },
            realGame:
              'Have the student find an Arabian mate in a master game and identify which piece covered which square.',
          },
          mistakes: [
            'Playing the rook check without covering the flight squares first.',
            'Assuming the pattern works when the king has open space.',
            'Not recognising that the knight\'s job is coverage, not capture.',
          ],
          board: {
            fen: '5rk1/5ppp/8/8/8/8/5NPP/6K1 w - - 0 1',
            caption: 'The knight covers f1 while the rook checks on the eighth rank.',
            highlight: ['f1', 'f7', 'f8', 'g8'],
            arrows: [['a8', 'a8'], ['f2', 'f1']],
          },
          practice: [
            {
              fen: '5rk1/5ppp/8/8/8/8/5NPP/6K1 w - - 0 1',
              prompt: 'Name the piece that covers the king\'s flight squares in an Arabian mate, and say which squares it covers.',
              solution:
                'The knight covers the squares the rook cannot reach — typically g7 or h8 here. The rook checks along the rank; the knight closes the exit.',
              hint: 'One piece checks. What is the other piece for?',
            },
          ],
          teachBack: {
            brief: 'Teach the Arabian mate as a two-piece coverage pattern.',
            required: [
              'the rook delivers the check',
              'the knight covers the flight squares',
              'the king\'s own pawns often complete the cage',
            ],
            lookFor: [
              'makes the student name each piece\'s job separately',
              'has them construct the net piece by piece',
            ],
          },
          misconception: 'The student sees a rook check and assumes it is mate, without checking what the knight is actually doing.',
          puzzlePrompt:
            'Build the Arabian net in three stages on the board and have the student explain what each added piece closes.',
          test: [
            {
              q: 'Which piece covers the flight squares in an Arabian mate?',
              options: ['The rook', 'The knight', 'The bishop', 'The queen'],
              answer: 1,
              explain:
                'The rook gives the check along the rank or file; the knight covers the squares the rook cannot reach.',
            },
            {
              q: 'What general idea does the Arabian mate illustrate?',
              options: [
                'Two weak pieces are never enough',
                'Two pieces can create a net that neither could create alone',
                'Knights are stronger than rooks',
                'Mates are easier in the endgame',
              ],
              answer: 1,
              explain:
                'It is a division of labour: check from one piece, coverage from the other. The same idea drives several other mate patterns.',
            },
          ],
        },
        {
          id: 'l3-smothered',
          name: 'Smothered Mate',
          summary: 'A knight mates a king whose own pieces have built the cage.',
          content: {
            definition:
              'A smothered mate is checkmate delivered by a knight, where the enemy king is blocked in by its own pieces — typically a rook beside it — and cannot move to a square the knight does not attack.',
            deep:
              'This is the most instructive pattern in the catalogue for teaching piece purpose, because it proves that a knight is worth as much as a queen in this specific geometry. The coaching point is that the cage is usually built with sacrifices: you give up material to push the opponent\'s own pieces next to their king, and then the knight finishes. Teach it as the endpoint of a sequence rather than as a standalone motif — "the sacrifice was not a sacrifice, it was cage construction".',
            why: 'It teaches that material value is position-dependent, and it gives a concrete reason to study knight movement.',
            when: 'The enemy king is surrounded by its own pieces and a knight can deliver mate on the smothered square.',
            whenNot: 'When the king has any flight square, or when the cage has not been built yet.',
            coachMethod:
              'Build the cage first, with the student watching: push the pieces next to the king one at a time, asking after each "is this safe for Black to allow?" Then deliver the knight mate. Finally, reverse the exercise — show the finished position and ask the student to work backwards to the cage. Backwards reconstruction is how patterns become recognisable rather than merely memorable.',
            example: {
              student: 'A knight? Against a queen and rook?',
              coach:
                'Count the squares the king can move to. None. Now count the squares my knight covers. All of them. The king\'s own pieces built the cage and the knight closed it.',
            },
            realGame:
              'Show the classic Philidor smothered mate and ask the student to identify which earlier moves built the cage.',
          },
          mistakes: [
            'Delivering the knight mate before the cage is built.',
            'Not checking that the king has no flight square after the knight arrives.',
            'Assuming a knight can never mate because of its low value.',
          ],
          board: {
            fen: '6rk/5ppp/8/8/8/8/8/5N1K w - - 0 1',
            caption: 'The knight on f1 is arriving to mate; the king is boxed in by its own pawns and rook.',
            highlight: ['f1', 'g8', 'f7', 'g7', 'h7'],
            arrows: [['g1', 'f1']],
          },
          practice: [
            {
              fen: '6rk/5ppp/8/8/8/8/8/5N1K w - - 0 1',
              prompt: 'Which squares can the black king legally move to after Nf1+? Name them all.',
              solution:
                'None of the escape squares are available: the rook on g8 and the pawns on f7, g7 and h7 occupy them, and the knight covers whatever the geometry leaves. That is the definition of smothered.',
              hint: 'Check every adjacent square. The answer is the point of the pattern.',
            },
          ],
          teachBack: {
            brief: 'Teach smothered mate as cage-building with a knight finish.',
            required: [
              'a knight delivers the mate',
              'the king is blocked by its own pieces',
              'the cage is usually built by earlier sacrifices',
            ],
            lookFor: [
              'reconstructs the cage backwards from the finished position',
              'uses the pattern to challenge the idea of fixed piece values',
            ],
          },
          misconception: 'The student believes a knight can never mate because it is worth less than a queen.',
          puzzlePrompt:
            'Take a famous smothered mate and remove the cage pieces one at a time, asking the student what stops it working each time.',
          test: [
            {
              q: 'What defines a smothered mate?',
              options: [
                'A knight mates a king surrounded by its own pieces',
                'A queen mates a king on the edge',
                'A rook mates a king in the centre',
                'A bishop mates along a diagonal',
              ],
              answer: 0,
              explain:
                'The knight delivers mate and the king has no flight square because its own pieces occupy them all.',
            },
            {
              q: 'Why is a smothered mate a useful teaching pattern?',
              options: [
                'It proves piece values are wrong',
                'It shows that piece value is position-dependent and a knight can be decisive',
                'It is easy to set up',
                'It is the most common mate',
              ],
              answer: 1,
              explain:
                'A 3-point piece delivers mate to a queen. The lesson is that material value and positional value are not the same thing.',
            },
          ],
        },
        {
          id: 'l3-morphy',
          name: 'Morphy Mate',
          summary: 'A bishop cuts the king off on one side while a rook delivers on the edge.',
          content: {
            definition:
              'The Morphy mate (also called the opera mate) uses a bishop to control the flight squares on one side of the enemy king while a rook delivers checkmate along the back rank from the other side.',
            deep:
              'The teaching value is geometric: it shows how pieces on *different* lines can co-operate to seal a corner. The bishop works on the diagonal, the rook on the rank, and between them they cover every square the king could want. Ask the student to name, before each move, which squares the king loses — that habit of tracking flight squares move by move is the transferable skill, and it generalises to every net in this catalogue.',
            why: 'It is the cleanest example of two pieces covering complementary squares, which is how nets are actually built.',
            when: 'The enemy king is in the corner with a bishop able to seal the diagonal squares and a rook able to check along the rank.',
            whenNot: 'When the bishop cannot reach the sealing squares, or when the king has an open diagonal.',
            coachMethod:
              'Work outwards from the king. Draw the squares it could reach, then ask the student which of their pieces can take each one. Then ask what is left, and that residual is the check. This "cover the squares, then check" method is how a coach should think out loud, and it makes the student do the same.',
            example: {
              student: 'Which piece is the bishop for?',
              coach:
                'Watch the king\'s squares. My rook will check along the rank, so it will handle the rank squares. The bishop handles the diagonal ones. Neither piece could do the other\'s job — that is why it is a pattern and not a trick.',
            },
            realGame:
              'Show the Morphy opera game and have the student annotate every square the king was denied.',
          },
          mistakes: [
            'Delivering the rook check before the bishop covers the escape squares.',
            'Forgetting the geometry of which lines each piece controls.',
            'Assuming the pattern works from any king position.',
          ],
          board: {
            fen: '6k1/5ppp/8/8/8/8/8/4B1RK w - - 0 1',
            caption: 'The bishop seals h7 and g8 from the diagonal; the rook checks along the rank.',
            highlight: ['h8', 'h7', 'g8', 'e1'],
            arrows: [['g1', 'g8']],
          },
          practice: [
            {
              fen: '6k1/5ppp/8/8/8/8/8/4B1RK w - - 0 1',
              prompt: 'List the black king\'s flight squares and say which white piece denies each one.',
              solution:
                'h7 is denied by the bishop on e1 along the diagonal, and g7 and f7 by the pawn structure and rook coverage. Every square has an owner — that is what makes it mate.',
              hint: 'One square at a time, and name the piece that covers it.',
            },
          ],
          teachBack: {
            brief: 'Teach the Morphy mate through flight-square ownership.',
            required: [
              'the bishop covers diagonal squares',
              'the rook checks along the rank',
              'between them every flight square is covered',
            ],
            lookFor: [
              'makes the student list flight squares and name the covering piece',
              'asks why neither piece could substitute for the other',
            ],
          },
          misconception: 'The student thinks a rook check alone is mate and does not account for the diagonal escapes.',
          puzzlePrompt:
            'Build a Morphy net and then remove the bishop, so the student can see exactly which flight square opens.',
          test: [
            {
              q: 'In a Morphy mate, what does the bishop contribute?',
              options: [
                'The check',
                'Coverage of the diagonal flight squares the rook cannot control',
                'Defence against counter-attacks',
                'The mate itself',
              ],
              answer: 1,
              explain:
                'The rook gives the check along the rank; the bishop covers the diagonal squares, so nothing is left open.',
            },
            {
              q: 'What is the transferable habit in this pattern?',
              options: [
                'Memorising the opera game',
                'Naming, square by square, which of your pieces denies which flight square',
                'Counting material first',
                'Checking from behind',
              ],
              answer: 1,
              explain:
                'Tracking which piece owns which escape square is how you build any net, not just this one.',
            },
          ],
        },
        {
          id: 'l3-anastasia',
          name: 'Anastasia Mate',
          summary: 'Knight and rook together, with one loose pawn that should have moved.',
          content: {
            definition:
              'The Anastasia mate is delivered by a knight checking while a rook controls the escape square along the back rank; it only works when the defending king\'s own pawn has blocked its flight square.',
            deep:
              'This pattern is a useful corrective to a common student error: the belief that a back-rank mate is always a rook-and-queen affair. Here the check comes from a knight and the rook merely supplies the cage wall. It also reinforces the Level 1 lesson that an unmoved pawn is both a liability and, here, a wall. Present the three patterns (back rank, Anastasia, Arabian) together and ask the student to compare which piece gives the check and which piece closes the exits — the comparison is the lesson.',
            why: 'It reinforces the habit of asking what closes each flight square rather than only what gives the check.',
            when: 'The enemy king is boxed on the back rank by its own pawn, a knight can check it, and a rook controls the square behind the pawn.',
            whenNot: 'When the pawn has moved — then the flight square is open and the pattern does not exist.',
            coachMethod:
              'Teach the three back-rank-family patterns side by side on three boards, and have the student fill in a comparison table: which piece checks, which piece covers which square, what role the pawn plays. Comparison is far stickier than three separate lessons, and it makes the student able to build a net rather than only recognise one.',
            example: {
              student: 'So the knight is checking but the rook is doing the real work?',
              coach:
                'The rook supplies the wall and the knight supplies the check. Swap them and it fails. Neither wins alone — that is the whole lesson of these patterns.',
            },
            realGame:
              'Find an Anastasia mate in a master game and have the student annotate the roles of all three pieces involved, including the pawn.',
          },
          mistakes: [
            'Assuming the pattern works after the blocking pawn has moved.',
            'Misidentifying which piece is checking.',
            'Delivering the knight check before the rook is in place.',
          ],
          board: {
            fen: '5r1k/5ppp/8/8/8/8/8/4R1NK w - - 0 1',
            caption: 'The rook seals the rank behind the pawn; the knight is the piece that will deliver mate.',
            highlight: ['h8', 'h7', 'g8'],
            arrows: [['g1', 'h3']],
          },
          practice: [
            {
              fen: '5r1k/5ppp/8/8/8/8/8/4R1NK w - - 0 1',
              prompt: 'Why does the black pawn on h7 have to stay exactly where it is for this pattern to work?',
              solution:
                'It blocks the king\'s flight square. If h7 moves, that square opens and the rook alone cannot mate there. The pawn is both the defence and the reason the pattern is available.',
              hint: 'Ask what happens to the king\'s escape squares if the pawn moves.',
            },
          ],
          teachBack: {
            brief: 'Teach Anastasia mate alongside back rank and Arabian, and have the student compare them.',
            required: [
              'a knight gives the check',
              'a rook controls the square behind the blocking pawn',
              'the pattern disappears the moment the pawn moves',
            ],
            lookFor: [
              'has the student build a comparison table of the three patterns',
              'identifies which piece checks in each',
            ],
          },
          misconception: 'The student believes a back-rank mate must be delivered by a rook, so they miss the knight-and-rook versions.',
          puzzlePrompt:
            'Create the same king position three ways — rook mate, Arabian and Anastasia — and ask the student what changed in each.',
          test: [
            {
              q: 'In an Anastasia mate, which piece delivers the check?',
              options: ['The rook', 'The knight', 'The bishop', 'The queen'],
              answer: 1,
              explain:
                'The knight checks; the rook only controls the escape square behind the blocking pawn.',
            },
            {
              q: 'What makes the pattern fragile?',
              options: [
                'It requires a queen',
                'It stops working as soon as the defending pawn moves',
                'It cannot be forced',
                'It only works for White',
              ],
              answer: 1,
              explain:
                'The pawn is the wall. Move it and the king has a flight square, so the pattern is gone.',
            },
          ],
        },
        {
          id: 'l3-pillsbury',
          name: 'Pillsbury Mate & Corner Nets',
          summary: 'The bishop-based corner mate, and the general method behind every net.',
          content: {
            definition:
              'The Pillsbury mate is delivered by a bishop checking along a diagonal while a rook blocks the escape square on the adjacent rank; more generally it is one of a family of corner mates where a diagonal checker and a straight-line piece share the work.',
            deep:
              'The pedagogical decision here is to teach the *method* rather than an ever-growing list. A coach who can instruct "cover every flight square with a named piece, then check" does not need to memorise twenty names. So introduce Pillsbury as the final example of the family and then run a deliberate exercise: give the student an unfamiliar corner position and have them build the net without a name. Recognition is the outcome of the method; the name is only a label for it.',
            why: 'It converts pattern knowledge from a list to a procedure, which is what actually scales for a coach.',
            when: 'The enemy king is in a corner with a diagonal available for a bishop check and an adjacent rank square for a rook to seal.',
            whenNot: 'When the corner is open, or when your pieces cannot reach the sealing squares.',
            coachMethod:
              'Run a naming-then-building loop. Phase one: recognise and name the pattern in a known position. Phase two: given an unnamed position, build the net. Phase three: given an odd position, notice that it is not a net at all. Phase three is the one that prevents pattern-blindness, because students otherwise assume every strong position contains a known mate.',
            example: {
              student: 'Is this the Pillsbury mate?',
              coach:
                'Do not tell me the name — tell me which piece covers h7 and which piece checks. If you can do that, the name is irrelevant. If you cannot, the name will not help you.',
            },
            realGame:
              'Give the student an unfamiliar mate from a master game with no name attached and have them construct the net themselves.',
          },
          mistakes: [
            'Memorising pattern names without understanding which square each piece covers.',
            'Assuming every strong attacking position contains a known pattern.',
            'Forgetting the corner geometries that make these mates possible.',
          ],
          board: {
            fen: '6k1/5ppp/8/8/8/8/8/3R1B1K w - - 0 1',
            caption: 'Bishop and rook sharing a corner: one checks on the diagonal, the other seals the rank.',
            highlight: ['h8', 'h7', 'g8', 'f1'],
            arrows: [['d1', 'd8']],
          },
          practice: [
            {
              fen: '6k1/5ppp/8/8/8/8/8/3R1B1K w - - 0 1',
              prompt: 'Name the square the rook must deny and the square the bishop must deny, then find the check.',
              solution:
                'The rook denies h7 along the seventh rank and the bishop denies h8 or g8 from the diagonal. With both denied, the check can come from either piece — the cage is what matters, not the label.',
              hint: 'Cover the squares first. The check is the last step, not the first.',
            },
          ],
          teachBack: {
            brief: 'Teach the Pillsbury mate, then have the student build an unnamed net from scratch.',
            required: [
              'a bishop checks on the diagonal while a rook seals a rank square',
              'the transferable method is: cover every flight square, then check',
              'pattern names are labels, not the skill',
            ],
            lookFor: [
              'has the student build a net in an unnamed position',
              'can explain the corner geometry rather than just the name',
            ],
          },
          misconception: 'The student can name dozens of mating patterns but cannot construct one when the name is not given.',
          puzzlePrompt:
            'Present three corner mates without names and require the student to build each net and then name it themselves.',
          test: [
            {
              q: 'What is the general method for building a mating net?',
              options: [
                'Find a knight manoeuvre',
                'Cover every flight square with a named piece, then deliver the check',
                'Trade off the defenders',
                'Check from as many pieces as possible',
              ],
              answer: 1,
              explain:
                'Coverage first, check last. If you can name which piece denies which square, you can build any net.',
            },
            {
              q: 'In the Pillsbury mate, which piece delivers the check?',
              options: ['The rook', 'The bishop', 'The knight', 'Either, depending on position'],
              answer: 1,
              explain:
                'The bishop checks along the diagonal while the rook seals the escape square on the adjacent rank.',
            },
          ],
        },
        {
          id: 'l3-loose-squares',
          name: 'Loose Squares & Doubles',
          summary: 'Targeting the poorly defended piece, and the discipline of counting defenders.',
          content: {
            definition:
              'A loose square is one where a piece is not adequately defended. A double is two loose squares at once, where a single move attacks both. Winning material is mostly about finding doubles.',
            deep:
              'Level 2 covered loose and undefended pieces as a motif. Level 3 adds the part that actually wins material: the double. The coaching method is a counting routine — before you pick up a piece, count its defenders; if the count is one and that defender is itself loose, you have a double. Teach the student to look for *two* targets before committing, because the moment you find a double the move is usually forced and free. This is also the natural bridge into combination thinking: a double frequently forces a reply that creates a second tactical resource.',
            why: 'It converts loose-piece awareness from a spotting exercise into a material-winning method.',
            when: 'Any position where two enemy pieces are insufficiently defended.',
            whenNot: 'When the piece you are attacking is defended by a piece you cannot dislodge easily.',
            coachMethod:
              'Drill counting. Hand the student a position and ask, for each enemy piece: how many defenders does it have? Then ask which pieces are attacked. Insist on the count being said out loud before any capture is played. This one routine eliminates most missed hanging pieces, and it also produces the double automatically.',
            example: {
              student: 'I can take that bishop.',
              coach:
                'Take is the easy part. How many pieces defend it? Now — before you move, is there a second piece you can also hit with this same piece? A double is where the real material is.',
            },
            realGame:
              'Have the student review their last game and find every position where a double was available. It is usually several per game.',
          },
          mistakes: [
            'Capturing without counting defenders.',
            'Attacking a single target when a double was available.',
            'Assuming a piece is defended because another piece is near it.',
            'Forgetting to check whether the capturing piece is itself loose.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n1b3/3p4/3P4/2N1B3/PP3PPP/R2Q1RK1 w - - 0 10',
            caption: 'Two loose pieces at once. Find the double and the material is yours.',
            highlight: ['d6', 'e6', 'd8', 'e8'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n1b3/3p4/3P4/2N1B3/PP3PPP/R2Q1RK1 w - - 0 10',
              prompt: 'Name two loose pieces in this position and say which white piece attacks both.',
              solution:
                'The d6 pawn and the e6 bishop are each inadequately defended. Find a single white piece that attacks both and the double is forced and free.',
              hint: 'Count defenders on two targets before you move anything.',
            },
          ],
          teachBack: {
            brief: 'Teach the defender-count routine and the search for doubles.',
            required: [
              'count the defenders before you capture',
              'look for two loose pieces before committing',
              'a double is usually forced and free',
            ],
            lookFor: [
              'requires the count to be said out loud',
              'makes the student hunt for a double rather than a single capture',
            ],
          },
          misconception: 'The student takes the first loose piece they see instead of searching for the double that follows.',
          puzzlePrompt:
            'Create a series of positions, each with one loose piece, then a final one with a double, and ask the student what changes.',
          test: [
            {
              q: 'What is a double?',
              options: [
                'Two queens on the board',
                'A single move that attacks two loose pieces at once',
                'A double pawn push',
                'Two checks in a row',
              ],
              answer: 1,
              explain:
                'A double attacks two targets with one move, so the opponent cannot save both. It is the standard way material is won.',
            },
            {
              q: 'What should you do before capturing a loose piece?',
              options: [
                'Check it is the biggest piece on the board',
                'Count how many pieces defend it',
                'Move your king to safety first',
                'Look at the previous move',
              ],
              answer: 1,
              explain:
                'The defender count tells you whether the capture is safe and whether it is part of a bigger double.',
            },
          ],
        },
      ],
    },
  ],
};