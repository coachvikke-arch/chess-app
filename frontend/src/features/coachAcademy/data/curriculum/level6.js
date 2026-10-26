/**
 * Level 6 — Calculation & Advanced Tactics.
 *
 * Level 3 taught what a combination is. Level 6 teaches how to *produce* one
 * under time pressure, which means teaching a visible process: candidates,
 * forcing moves, opponent resources, verification. Everything here is about
 * making calculation reproducible rather than miraculous.
 */
export default {
  n: 6,
  id: 'level-6',
  title: 'Calculation & Advanced Tactics',
  tagline: 'Be able to show your working.',
  description:
    'Deep calculation as a teachable process: candidates, forcing moves, opponent resources, verification, and the sacrifices that justify giving up material.',
  finalTask: 'Analyze a complex position and verbally explain the complete calculation process.',
  finalExam: { title: 'Level 6 Final Exam', passMark: 80, sections: ['tactical', 'strategic', 'teaching'] },
  competency: ['Calculation', 'Tactical Skill'],
  modules: [
    {
      id: 'l6-m1',
      title: 'The Calculation Process',
      description: 'A reproducible method. A coach who can teach the method can fix almost any calculation weakness.',
      topics: [
        {
          id: 'l6-candidates',
          name: 'Candidate Moves',
          summary: 'Generate every sensible move before you calculate any of them.',
          content: {
            definition:
              'A candidate move is any move serious enough to be worth calculating: captures, checks, threats, and moves that improve your worst piece. Finding candidates is a separate skill from calculating them, and it is the step most often skipped.',
            deep:
              'The failure mode is obvious in every club game: a student sees one attractive move, calculates it, misses a defensive resource, and blames their calculation. But the real error was earlier — they never generated the alternatives. Teach candidate generation as a mechanical checklist to run before any depth: checks first, captures second, then moves that address your worst piece, then moves that create threats. Four categories, and in most tactical positions the winning move is in one of them. The second discipline is *pruning*: after generating candidates, rank them and discard the ones that are obviously refuted by a single check, which is what makes the checklist affordable in real time.',
            why: 'Calculation errors are usually candidate errors. Fix the generation step and most of the misses disappear.',
            when: 'Before calculating anything, every time you enter a sharp position.',
            whenNot: 'In positions with only one candidate, or when a check is right there and the win is obvious.',
            coachMethod:
              'Run the four-category checklist out loud with the student before they calculate. Then, critically, make them *name* the category each candidate came from — check, capture, worst-piece improvement, threat. It sounds pedantic and it is the whole lesson: the checklist becomes automatic, and when it does, students stop missing moves by accident. Follow up by reviewing games where they missed a candidate, and ask which category it belonged to.',
            example: {
              student: 'I calculated for ten minutes and still got it wrong.',
              coach:
                'That is usually not a calculation failure. Before we look at your depth, let us check your list: did you consider every check, every capture, and the move that improves your worst piece? Show me your candidates, not your calculation.',
            },
            realGame:
              'Have the student go through three games and classify every move they missed by category.',
          },
          mistakes: [
            'Calculating the first attractive move without listing alternatives.',
            'Ignoring captures because they look unfavourable.',
            'Forgetting the move that improves the worst piece.',
            'Listing too many candidates and running out of time.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
            caption: 'Four categories to scan: checks (none), captures (c6, f6), worst piece (the rook), threats (c4).',
            highlight: ['c6', 'f6', 'c1', 'c4'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
              prompt: 'Generate candidates from all four categories in this position.',
              solution:
                'Checks: none available. Captures: Nxc6, Nxf6. Worst piece: the rook on c1 wants the c-file or a7. Threats: c4 creates an outpost. Then prune the ones refuted instantly, and calculate the rest.',
              hint: 'Checks, captures, worst piece, threats — in that order.',
            },
          ],
          teachBack: {
            brief: 'Teach the four-category candidate checklist and require the student to name the category of each candidate.',
            required: [
              'checks, captures, worst-piece improvement, threats',
              'candidates are generated before any of them is calculated',
              'candidates are then pruned by instant refutation',
            ],
            lookFor: [
              'names the category for each candidate',
              'prunes rather than calculating everything equally',
            ],
          },
          misconception: 'The student believes a missed move is always a calculation error rather than a candidate-generation error.',
          puzzlePrompt:
            'Take a game where a candidate was missed and ask the student which of the four categories it belonged to.',
          test: [
            {
              q: 'What are the four candidate categories?',
              options: [
                'Pawn, knight, bishop, rook',
                'Checks, captures, moves improving your worst piece, and threats',
                'Opening, middlegame, endgame, tactic',
                'Safe, risky, quiet, aggressive',
              ],
              answer: 1,
              explain:
                'Running this list before calculating is what makes calculation reliable under time pressure.',
            },
            {
              q: 'Why prune candidates?',
              options: [
                'To look faster',
                'Because candidates refuted by a single check are not worth deep calculation',
                'Because the engine will do it',
                'To reduce the number of threats',
              ],
              answer: 1,
              explain:
                'Pruning by instant refutation spends your time only on moves that can actually work.',
            },
          ],
        },
        {
          id: 'l6-forcing',
          name: 'Forcing Moves & Trees',
          summary: 'Checks and captures remove options — calculate those first and deepest.',
          content: {
            definition:
              'A forcing move is one that restricts the opponent: a check, a capture, or a threat with a single defence. The tree of opponent replies after a forcing move is small, which makes forcing moves the cheapest moves to calculate and the most reliable foundation for a combination.',
            deep:
              'The professional hierarchy is worth teaching explicitly because it decides where you spend your clock. Checks and captures are near-forcing: a check usually has two or three replies, a capture usually has one or two. Quiet threats are the dangerous ones because they may be ignored entirely, so they must be verified, not assumed. The practical routine is therefore: calculate the forcing moves first, to full depth, then check whether the quiet move that ties the whole thing together is actually refutable — and if it can be ignored, it is not part of the combination. Teach the verification test explicitly: for every quiet move in your chain, ask "can the opponent simply play something else, and does that leave them fine?"',
            why: 'Most failed combinations include exactly one quiet move that was assumed rather than verified.',
            when: 'Always — before any deep calculation, sort your candidates into forcing and non-forcing.',
            whenNot: 'Do not assume a quiet threat works. That assumption is the single most common cause of failed combinations.',
            coachMethod:
              'Make the student label every move in their calculation as forcing or quiet. Then require a written answer to one question per quiet move: "what stops him ignoring this?" If the student cannot answer, the combination is not proven and they must either find the forcing justification or abandon it. This one habit prevents more missed tactics than any other coaching technique, and it scales from 1200 to 2200.',
            example: {
              student: 'So then I just take the queen and it is mate.',
              coach:
                'Hold on. Walk me through every move. Which of them were forcing? For the quiet one — the pawn move that opens the rook — what if he simply does not take it? If he can ignore that move, your combination only works because he helped you.',
            },
            realGame:
              'Take a real combination and have the student label each move forcing or quiet, and write the verification for each quiet move.',
          },
          mistakes: [
            'Assuming a quiet threat works without checking whether it can be ignored.',
            'Calculating quiet moves deeply before the forcing ones.',
            'Confusing a threat with a forcing threat.',
            'Ending a calculation at the first plausible mate without verifying the defence.',
          ],
          board: {
            fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 6',
            caption: 'A forcing move has a small reply tree. Spend the clock where the tree is small and verified.',
            highlight: ['f6', 'c6', 'c4'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 6',
              prompt: 'Name the forcing moves available in this position and say which one you would calculate first.',
              solution:
                'The forcing moves are the captures on e5 and any check. Calculate those first, to full depth, because their reply trees are smallest and most forced. Quiet improving moves can wait.',
              hint: 'Sort into forcing and quiet before you calculate anything.',
            },
          ],
          teachBack: {
            brief: 'Teach the forcing/quiet hierarchy and the verification question.',
            required: [
              'checks and captures have small reply trees and should be calculated first',
              'every quiet move in a chain must be verified against being ignored',
              'an unverifiable quiet move means the combination is not proven',
            ],
            lookFor: [
              'labels each move forcing or quiet',
              'answers "what stops him ignoring this?" for every quiet move',
            ],
          },
          misconception: 'The student believes that if a combination works when the opponent cooperates, it works.',
          puzzlePrompt:
            'Take a winning combination and add one quiet move to it that can be ignored, so the combination stops working. Ask the student to find the flaw.',
          test: [
            {
              q: 'Which moves should be calculated first and deepest?',
              options: [
                'The most exciting ones',
                'Forcing moves — checks and captures — because their reply trees are smallest',
                'The quiet improving moves',
                'The ones the opponent most likely plays',
              ],
              answer: 1,
              explain:
                'Forcing moves restrict the reply, so they are the cheapest to verify and the most reliable foundation for a combination.',
            },
            {
              q: 'What must you check about a quiet move in a combination?',
              options: [
                'Whether it looks nice',
                'Whether the opponent can simply ignore it and be fine',
                'Whether it develops a piece',
                'Whether it is the engine\'s first choice',
              ],
              answer: 1,
              explain:
                'A quiet move the opponent can ignore is an assumption, not a force. If it can be ignored, the combination is unproven.',
            },
          ],
        },
        {
          id: 'l6-defenders',
          name: 'Defender\'s Resources',
          summary: 'The moves the opponent has that you did not account for.',
          content: {
            definition:
              'Defender\'s resources are the replies available to the side under attack: captures of the attacking piece, checks against the attacker, flight squares, blocks, and pieces that can simply recapture. Missing one of these is the classic way a winning combination turns into a loss.',
            deep:
              'The single most useful habit in defensive calculation is to play the defence, not the attack. Most students calculate forwards only, which means they evaluate positions where their opponent has made the best moves. Train the reverse: after finding a combination, list the defender\'s *four* standard resources and check each one — can he capture the attacker, can he check, can he block, can he move the target to safety. Teach the trap specifically: if you capture on a defended square, you have given away a trade and the "combination" is simply an exchange of pieces. Then note the deeper lesson — that this habit is also how a coach defends a student, so it pays off in both directions.',
            why: 'Missing a defender\'s resource is the most common cause of a lost won game, and it is a habit, not a talent.',
            when: 'Every time you finish a line in your head, before you play it.',
            whenNot: 'Do not look for defences in a forced line where the opponent genuinely has no reply.',
            coachMethod:
              'After any calculated line, stop and ask: "name the defender\'s four resources, and check them one by one." Most mistakes appear at this step. A stronger version of the exercise is to reverse roles: give the student the attacking position and ask them to find the resource that saves Black — that is how you teach defence without lecturing about it. Add the defensive habit of always asking "what can they capture?" before you commit a piece.',
            example: {
              student: 'I capture the queen and I win a piece.',
              coach:
                'Who is defending the queen? If the answer is a pawn and you have not accounted for that pawn, then you did not win a queen — you swapped queens and then lost the exchange. Show me their resources before you show me your conclusion.',
            },
            realGame:
              'Have the student review a game where a winning combination failed and identify which resource they missed.',
          },
          mistakes: [
            'Not checking what defends the piece you are capturing.',
            'Ignoring a check against the attacking piece.',
            'Forgetting that the target can simply move to safety.',
            'Calculating only your own best moves.',
          ],
          board: {
            fen: 'r2qk2r/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2QK2R w KQkq - 0 12',
            caption: 'Every capture here has a question attached: what defends the piece, and what checks can they give?',
            highlight: ['d8', 'f8', 'c6', 'f6'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r2qk2r/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2QK2R w KQkq - 0 12',
              prompt: 'Before capturing on c6, name what defends it and whether Black can check you afterwards.',
              solution:
                'The pawn on b7 defends c6, so Nxc6 is a trade at best — and if Black captures the knight, the bishop on f8 becomes a discovered threat. The defender\'s resources must be named before the capture is scored.',
              hint: 'Ask "what defends it?" before "what does it win?".',
            },
          ],
          teachBack: {
            brief: 'Teach the four defender\'s resources as a mandatory final step in any calculation.',
            required: [
              'capture the attacker, check the attacker, block, move the target',
              'check what defends a square before you capture on it',
              'play the defence mentally, not only the attack',
            ],
            lookFor: [
              'names all four resources without prompting',
              'catches a defended capture in the student\'s own calculation',
            ],
          },
          misconception: 'The student assumes that finding a capture means winning the exchange, without checking the defender.',
          puzzlePrompt:
            'Give the student a position where a capture looks free, and have them find the resource that makes it a trade.',
          test: [
            {
              q: 'What is the first question before capturing on a defended square?',
              options: [
                'Is it the biggest piece on the board?',
                'What defends that square?',
                'Does it win material?',
                'Is it a check?',
              ],
              answer: 1,
              explain:
                'A defended capture is usually a trade at best. Counting defenders before counting captures prevents the most common tactical error.',
            },
            {
              q: 'What are the defender\'s standard resources?',
              options: [
                'Castle, promote, exchange, resign',
                'Capture the attacker, check the attacker, block, move the target',
                'Pass, repeat, claim, resign',
                'Trade, push, castle, capture',
              ],
              answer: 1,
              explain:
                'Those four cover nearly every escape from an attack. Naming and checking each one is the final step of any calculation.',
            },
          ],
        },
        {
          id: 'l6-tacticself',
          name: 'Calculation Self-Correction',
          summary: 'Finding your own error in your own calculation.',
          content: {
            definition:
              'Calculation self-correction is the ability to identify where your own line failed and why, rather than only observing that it failed. It is a debugging skill applied to your thinking.',
            deep:
              'Most improvement in calculation comes from the after-action review, not from the calculation itself. The routine is four questions: which step was first wrong, which step was first uncertain, which resource did I not check, and what question would have caught it. The interesting finding for a coach is that the *first* error is rarely the last move — students usually identify the final mistake while the real one was three moves earlier, usually an unverified quiet move. Teach them to find the first divergence, not the last. Add the habit of marking uncertainty during calculation: if a move is not forcing, say so out loud, and treat it as a question rather than a conclusion.',
            why: 'A coach who teaches self-correction produces players who improve without a coach present, which is the entire point of coaching.',
            when: 'After every game and every missed tactic, immediately.',
            whenNot: 'Not while still in the middle of a critical position — analysis afterwards, not during.',
            coachMethod:
              'Do the review together, but have the student lead it. Ask the four questions in order and let them find the first error before you point at anything. If they cannot find it, walk back move by move until you find the first move that was not forced. Then ask the question they should have asked at that moment, and have them write it down. That written question becomes their checklist for next time, which is why it must be in their words.',
            example: {
              student: 'I did not see the rook coming.',
              coach:
                'Let us find the first move that was not forced, not the last move. Walk me through it. Where did the line stop being certain? What should you have asked at that exact move?',
            },
            realGame:
              'Require a written first-error report after every game, in the student\'s own words.',
          },
          mistakes: [
            'Identifying only the last move as the error.',
            'Blaming time pressure rather than an unchecked assumption.',
            'Moving on without reviewing.',
            'Reviewing only losses.',
          ],
          board: {
            fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
            caption: 'Find the first move in your line that was not forced. Everything after that is consequence, not cause.',
            highlight: ['c6', 'f6', 'c4'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
              prompt: 'Which move in a typical line here was the first non-forcing move, and what should you have checked there?',
              solution:
                'Any non-check, non-capture move that "just opens things" is the first uncertain step. The question is: can he simply play something else and be fine? If yes, the line was a hope, not a combination.',
              hint: 'Look for the first quiet move that could have been ignored.',
            },
          ],
          teachBack: {
            brief: 'Teach the four-question after-action review and have the student lead it.',
            required: [
              'first wrong step, first uncertain step, unchecked resource, question that would have caught it',
              'find the first divergence, not the last mistake',
              'write the question in your own words for next time',
            ],
            lookFor: [
              'finds the first error rather than the last',
              'writes a specific question rather than a general intention',
            ],
          },
          misconception: 'The student believes reviewing the final mistake is the same as finding the cause.',
          puzzlePrompt:
            'Take a failed combination and have the student identify the first non-forcing move, not the final blunder.',
          test: [
            {
              q: 'Which move should a review identify as "the mistake"?',
              options: [
                'The last move played',
                'The first move that was not forced',
                'The move that lost the most material',
                'The move the engine did not like',
              ],
              answer: 1,
              explain:
                'Everything after the first unforced move is consequence. Fixing the cause requires finding where the certainty ended.',
            },
            {
              q: 'Why write the corrective question down in your own words?',
              options: [
                'For your coach to read',
                'Because it becomes a checklist you will actually remember next time',
                'To record the score',
                'It is not necessary',
              ],
              answer: 1,
              explain:
                'A question phrased in your own words is far more usable than advice phrased in the coach\'s words.',
            },
          ],
        },
      ],
    },
    {
      id: 'l6-m2',
      title: 'Complex Combinations',
      description: 'The combinations that require two ideas at once, and how to build them.',
      topics: [
        {
          id: 'l6-complex',
          name: 'Complex Combinations',
          summary: 'Two ideas, several branches, and holding the whole line in your head.',
          content: {
            definition:
              'A complex combination requires at least two independent ideas — often a decoy that weakens the defence, plus a battery that exploits the weakness — and usually at least one quiet move that must be verified.',
            deep:
              'The reason these positions defeat students is not depth but *branching*. Once a line has three opponent replies, the student holds one in their head and loses the other two. The coaching fix is structural: do not memorise the lines, memorise the *branches*. Write them as a small tree with the defender\'s resources at each node, and mark which branch is the hard one. Then recognise that in most complex combinations the hard branch is the counter-attack or the defensive check, because those are the resources a defender reaches for first. Note the professional value of these positions for a coach: they are the best material for teaching calculation because they are verifiable — the combination either survives the best defence or it does not, and there is no opinion involved.',
            why: 'They are the training ground for real calculation, and they are the positions where coaching has the most visible effect.',
            when: 'When a position offers a clear idea but the defending resources are non-obvious.',
            whenNot: 'Not while under time pressure in a real game — these are training positions first.',
            coachMethod:
              'Teach with a branch tree on paper, not in your head. Write the attack, then at each node write every defender resource, then draw the branch. Ask the student which branch they did not consider — almost always there is exactly one they missed, and once it is written down it becomes obvious. Then compress the tree into a one-line description ("decoy the queen, then the battery on b7"), because the compressed version is what a coach needs to be able to say out loud during a game.',
            example: {
              student: 'I found the idea but I did not see he could defend.',
              coach:
                'That is the normal way to lose a won game. Do not memorise the line — memorise the branches. At this move, what can he do? Write all three. Now you know which one you missed and you will look for it next time.',
            },
            realGame:
              'Have the student write a branch tree for one combination per week and mark the branch they would forget.',
          },
          mistakes: [
            'Holding one branch in your head and forgetting the others.',
            'Assuming the defence has only one reply.',
            'Memorising lines without branches.',
            'Verifying only the branch that wins and not the branch that holds.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
            caption: 'Every combination here has branches. Write them down before you calculate.',
            highlight: ['c6', 'f6', 'd5'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
              prompt: 'Write the defender\'s resources at the first node of your intended combination.',
              solution:
                'At each node: can he capture the attacking piece, can he check, can he block, can he move the target? Write all of them. The branch you forget is the one that decides the game.',
              hint: 'Four resources per node. Write them all.',
            },
          ],
          teachBack: {
            brief: 'Teach branch trees for complex combinations rather than lines.',
            required: [
              'write every defender resource at each node',
              'the missed branch is usually the counter-attack',
              'compress the tree into a one-line description you can say aloud',
            ],
            lookFor: [
              'produces a tree rather than a single line',
              'identifies their own most-forgotten branch',
            ],
          },
          misconception: 'The student thinks a combination that works against one reply is sound.',
          puzzlePrompt:
            'Give the student a combination with three defender replies and ask them to find the one they would miss under time pressure.',
          test: [
            {
              q: 'What makes a combination "complex"?',
              options: [
                'It is long',
                'It requires two independent ideas and several defender branches to verify',
                'It involves a sacrifice',
                'It ends in mate',
              ],
              answer: 1,
              explain:
                'Complexity is about branching and multiple ideas, not length. That is why lines are forgotten and branches are not.',
            },
            {
              q: 'Which defender\'s resource is most often missed?',
              options: [
                'Casting out of check',
                'The counter-attack or the checking resource',
                'Promoting a pawn',
                'Capturing with the queen',
              ],
              answer: 1,
              explain:
                'Defenders reach for counter-attacks and checks first. Those branches are also the ones that most often hold.',
            },
          ],
        },
        {
          id: 'l6-materialsac',
          name: 'Justified Material Sacrifice',
          summary: 'Sacrificing a piece for a decisive attack, and proving it.',
          content: {
            definition:
              'A justified material sacrifice gives up material where the resulting attack is forced and decisive — typically because the sacrificed piece was the last defender of the mating squares. It is proven, not asserted.',
            deep:
              'Level 3 introduced the sacrifice as a concept; Level 6 is about proving one. The test is specific: after the sacrifice, can the opponent stop the attack? If they have no move that removes the check without permitting mate, the sacrifice was free in effect — the material never entered the calculation. If they do have such a move, the sacrifice was not justified and the position is simply an exchange. The professional habit is to state the justification as a forced sequence before playing: "I give the piece, and here is the line the opponent cannot avoid, and here is where it mates." A coach should insist on this sentence, because students who cannot complete it have found a hope rather than a sacrifice.',
            why: 'Sacrifices decide most fast games, and being able to prove one is the difference between a calculated sacrifice and an intuitive one.',
            when: 'When a piece is the last defender of the mating squares and the attack is forced after removing it.',
            whenNot: 'Never to "create threats", and never when the opponent has a resource that stops the attack outright.',
            coachMethod:
              'Require the justification sentence before allowing the move: material given, forced line, reason it is forced, where it ends. If the student cannot finish it, the move is not played on the board. Then demonstrate the near-miss — a position where the same sacrifice does not work because the opponent has one resource — so the student learns the boundary, not just the pattern. This is a high-value, low-time exercise: five minutes with one position teaches more than an hour of pattern study.',
            example: {
              student: 'I take the queen and it is mate.',
              coach:
                'Say the rest of the sentence. You gave a queen — what forced sequence follows, and why can he not stop it? If the answer is "because he has no move", say which move. If you cannot name it, you have not found a sacrifice; you have found a position where the queen is loose.',
            },
            realGame:
              'Have the student find a real justified sacrifice and write the full justification sentence.',
          },
          mistakes: [
            'Calling an exchange a sacrifice because it felt like one.',
            'Sacrificing to create threats with no forcing continuation.',
            'Assuming the opponent cannot capture the sacrificed piece.',
            'Not verifying the mating net after the sacrifice.',
          ],
          board: {
            fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
            caption: 'Rd8! is a sacrifice only because the checks afterwards are forced. That is the justification, in full.',
            highlight: ['g8', 'f7', 'g7', 'h7'],
            arrows: [['d1', 'd8']],
          },
          practice: [
            {
              fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
              prompt: 'State the full justification for Rd8 here in one sentence.',
              solution:
                'I give the rook on d8 because the checks that follow are forced: after Rxd8 the rook on g8 cannot stop the sequence without allowing mate, so the material never becomes a factor.',
              hint: 'Material given, forced line, reason it is forced, where it ends.',
            },
          ],
          teachBack: {
            brief: 'Require the full justification sentence before a sacrifice is allowed on the board.',
            required: [
              'material given, forced line, reason it is forced, where it ends',
              'if the opponent has a resource that stops the attack, it is not a sacrifice',
              'the material is irrelevant only when it cannot be used',
            ],
            lookFor: [
              'completes the justification sentence unprompted',
              'can distinguish the sacrifice from the near-miss exchange',
            ],
          },
          misconception: 'The student believes any winning-looking capture of a major piece is a sacrifice.',
          puzzlePrompt:
            'Take a position where the same piece can be correctly sacrificed and give the resource that makes it incorrect.',
          test: [
            {
              q: 'What makes a material sacrifice justified?',
              options: [
                'It creates activity',
                'The attack afterwards is forced and decisive, so the material cannot be used',
                'It simplifies the position',
                'The opponent cannot refuse it',
              ],
              answer: 1,
              explain:
                'Justification is a forced attack, not an opinion. If the opponent has a resource that stops the attack, it is simply an exchange.',
            },
            {
              q: 'What should you say before playing a sacrifice?',
              options: [
                'Nothing — just play it',
                'The material given, the forced line, why it is forced, and where it ends',
                'The engine evaluation',
                'The material you gained',
              ],
              answer: 1,
              explain:
                'Stating the justification first is how a coach verifies a sacrifice instead of approving it on instinct.',
            },
          ],
        },
        {
          id: 'l6-tacticaleye',
          name: 'Tactical Awareness in Real Games',
          summary: 'Recognising tactics in time pressure, and the practical routine that makes it possible.',
          content: {
            definition:
              'Tactical awareness in play is the ability to spot a candidate pattern quickly under time pressure, using the four-category checklist, and to judge whether it is worth pursuing before committing.',
            deep:
              'Recognition in a real game is not the same as calculation on a board, and a coach must be honest about the difference. The student who can solve a diagram but misses a tactic in a game does not have a knowledge problem — they have an attention and verification problem. Two fixes work. First, a fixed scan routine before every move that costs fifteen seconds and prevents most misses: checks, captures, threats, and one look at your worst piece. Second, a decision filter for whether to pursue a tactic at all: does it win material, does it force mate, and can I verify the first three moves? If not, stay with the plan. Note that the second point is the one advanced players get wrong in the other direction — they are so eager for tactics that they abandon a good plan for a doubtful combination.',
            why: 'Tactics won on the board but missed in the game are a pattern every coach sees, and the routine fixes it.',
            when: 'Before every move in a sharp position, and especially when a capture or a fork looks available.',
            whenNot: 'Not in positions where nothing is happening — the routine is for sharp moments.',
            coachMethod:
              'Install the fifteen-second scan as a physical habit: say the four categories quietly to yourself before you move. Then review real games with the student and stop at every move where they had a tactic, asking whether it was visible under the four-category scan. Teach the pursuit filter explicitly, because students need permission to *not* chase a tactic: only pursue what wins material, mates, or can be verified in three moves.',
            example: {
              student: 'I had a fork in the game and did not see it.',
              coach:
                'That is a scan problem, not a chess problem. Before your move, did you look at your opponent\'s pieces that are loose? That is one of the four categories and it takes two seconds. Let us find the move where the scan would have caught it.',
            },
            realGame:
              'Review games move by move and count the tactics that the four-category scan would have caught.',
          },
          mistakes: [
            'Missing a capture because it was not the most attractive move.',
            'Chasing an unverified combination and abandoning a good plan.',
            'Not scanning at all before moving in a sharp position.',
            'Assuming a tactic exists because a pattern looks familiar.',
          ],
          board: {
            fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
            caption: 'A sharp position where the scan — checks, captures, threats, worst piece — takes fifteen seconds and prevents most misses.',
            highlight: ['c6', 'f6', 'd5', 'c4'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
              prompt: 'Run the four-category scan here as Black. What do you find?',
              solution:
                'Checks: none. Captures: the bishop can take. Threats: c4 and d5 both create contact points. Worst piece: the c8 bishop has no job yet. The scan gives you candidates in fifteen seconds without staring at the board.',
              hint: 'Checks, captures, threats, worst piece — in that order.',
            },
          ],
          teachBack: {
            brief: 'Teach the fifteen-second scan and the tactic-pursuit filter.',
            required: [
              'checks, captures, threats, worst piece, before every move in a sharp position',
              'pursue a tactic only if it wins material, mates, or can be verified in three moves',
              'a missed tactic in a game is usually an attention problem, not a knowledge problem',
            ],
            lookFor: [
              'runs the scan without being prompted in later games',
              'declines to chase an unverified combination',
            ],
          },
          misconception: 'The student believes they have a calculation weakness when the real problem is that they never looked.',
          puzzlePrompt:
            'Take a real game where a tactic was missed and identify the exact move where the scan would have caught it.',
          test: [
            {
              q: 'What is the four-category scan?',
              options: [
                'King, queen, rook, pawn',
                'Checks, captures, threats, and your worst piece',
                'Opening, middlegame, endgame, tactic',
                'Attack, defend, trade, castle',
              ],
              answer: 1,
              explain:
                'Fifteen seconds running this list before moving in a sharp position prevents most missed tactics.',
            },
            {
              q: 'When should you pursue a discovered tactic?',
              options: [
                'Whenever you see one',
                'When it wins material, mates, or you can verify the first three moves',
                'Only in the opening',
                'Never, because plans are better',
              ],
              answer: 1,
              explain:
                'Advanced players make the opposite error — chasing tactics that cannot be verified. The filter gives permission to stay with your plan.',
            },
          ],
        },
      ],
    },
  ],
};