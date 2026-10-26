/**
 * Level 10 — Master Chess Coach.
 *
 * The final level teaches the craft of coaching rather than more chess: how to
 * construct a repertoire, identify weakness classes, author lessons and
 * puzzles, and handle the psychology of teaching someone who is stuck.
 */
export default {
  n: 10,
  id: 'level-10',
  title: 'Master Chess Coach',
  tagline: 'Build the coach, not just the player.',
  description:
    'Advanced chess plus the craft of coaching: repertoire construction, weakness identification, lesson planning, puzzle authoring and coaching psychology.',
  finalTask:
    'Analyse a real student game, identify every weakness class, build a personalised training plan, create lessons and puzzles, teach, test and produce a final report.',
  finalExam: {
    title: 'Level 10 Master Coach Exam',
    passMark: 85,
    sections: ['theory', 'tactical', 'strategic', 'teaching', 'simulation', 'board'],
  },
  competency: ['Chess Knowledge', 'Tactical Skill', 'Strategic Skill', 'Endgame Skill', 'Calculation', 'Teaching Skill'],
  modules: [
    {
      id: 'l10-m1',
      title: 'Coaching Craft',
      description: 'The skills that make a strong chess player into a strong coach.',
      topics: [
        {
          id: 'l10-repertoire',
          name: 'Repertoire Construction',
          summary: 'Building a coherent opening repertoire with real preparation behind it.',
          content: {
            definition:
              'Repertoire construction is the deliberate process of choosing a small set of openings, understanding their plans and typical middlegame structures, and preparing refutations of the opponent\'s main deviations.',
            deep:
              'At the top level repertoire is not about breadth, it is about *preparedness against the specific opponent*. The professional approach has three parts: a main line per opening that you understand structurally, a set of second-choice moves for each main deviation, and a plan for the middlegame that results. The middlegame plan is what separates a prepared repertoire from a copied one — if the student can state the resulting structure and its plans after ten moves of any main line, the repertoire is genuinely owned. Then add the practical discipline: preparation has a time budget, so build the priorities first and resist adding openings that will never be studied to completion. The final test is whether the student would still be able to play the position if the opponent deviated on move six.',
            why: 'Preparation confidence is worth rating points, and a coherent repertoire is what produces it.',
            when: 'Before a tournament, and whenever a student\'s preparation has become disorganised.',
            whenNot: 'Not as an excuse to avoid new openings — variety is fine as long as the plan is understood.',
            coachMethod:
              'Build the repertoire with a three-part test per opening: state the plan after ten moves, state the structure that results, and state the plan for the resulting middlegame. If the student cannot do all three, the opening is not ready. Then rehearse the deviations: give the student a move they did not prepare and have them build a plan from principles rather than recalling a line. That last exercise is the real test, and it is what prevents the student from freezing out of book.',
            example: {
              student: 'I know my opening to move twelve and then I am lost.',
              coach:
                'Then you know a line, not a repertoire. Tell me the structure after ten moves, then tell me the plan in that structure. If you can do that, I do not care what move thirteen is — we will build it from principles.',
            },
            realGame:
              'Have the student state the plan for each of their openings after ten moves, then check the deviation exercise.',
          },
          mistakes: [
            'Copying lines without understanding the resulting structure.',
            'Having no plan for the opponent\'s main deviation.',
            'Building too many openings to prepare any of them properly.',
            'Freezing when the opponent deviates from the book.',
          ],
          board: {
            fen: 'rnbqkb1r/pp3ppp/2p2n2/4p3/3P4/2P1P3/PP3PPP/RNBQKBNR b KQkq - 0 3',
            caption: 'The Sicilian structure. Knowing the structure and its plans matters more than knowing move fourteen.',
            highlight: ['d4', 'd6', 'c6'],
            arrows: [['d7', 'd6']],
          },
          practice: [
            {
              fen: 'rnbqkb1r/pp3ppp/2p2n2/4p3/3P4/2P1P3/PP3PPP/RNBQKBNR b KQkq - 0 3',
              prompt: 'State the structure here and the plan each side should have in it.',
              solution:
                'Semi-open Sicilian with White\'s d4 and c3 pawns against Black\'s c6. White wants the half-open c-file and queenside play; Black wants ...d6 and ...b5 to create a target on the c4 square.',
              hint: 'Structure first, then plans for both sides.',
            },
          ],
          teachBack: {
            brief: 'Test the student with the three-part repertoire test and the deviation exercise.',
            required: [
              'plan after ten moves',
              'the structure that results and its targets',
              'a plan for the opponent\'s main deviation, built from principles',
            ],
            lookFor: [
              'states all three parts without notes',
              'can build a plan from principles when the book runs out',
            ],
          },
          misconception: 'The student believes a repertoire means knowing many lines, when it means understanding few structures.',
          puzzlePrompt:
            'Take an opening the student claims to know and jump to move twelve of a line they have never seen. Ask them for the plan.',
          test: [
            {
              q: 'What is the three-part repertoire test?',
              options: [
                'Opening, middlegame, endgame knowledge',
                'Plan after ten moves, the structure that results, and a plan for the opponent\'s main deviation',
                'Three main lines per opening',
                'Knowing 20 moves of theory',
              ],
              answer: 1,
              explain:
                'Those three parts are what make a repertoire owned rather than memorised. A student who passes all three can handle deviations.',
            },
            {
              q: 'Why is knowing the resulting structure more valuable than the moves?',
              options: [
                'It is easier to remember',
                'Because it lets you build a plan when the book runs out',
                'It is what the engine reports',
                'It is required by tournament rules',
              ],
              answer: 1,
              explain:
                'Structure knowledge is what you use when nobody is cooperating with your preparation.',
            },
          ],
        },
        {
          id: 'l10-weakness',
          name: 'Weakness Identification',
          summary: 'Classifying a student\'s weaknesses so the training plan targets the real ones.',
          content: {
            definition:
              'Weakness identification is the process of finding, from evidence, the specific categories of weakness a student has — such as candidate generation, calculation depth, strategic planning, endgame technique, time management, or opening preparation — and ranking them by how much rating they are costing.',
            deep:
              'The professional discipline is to work from evidence rather than impression, and the evidence hierarchy is clear: games first, tests second, self-report almost never. Games show what actually happened under time pressure; tests show what the student knows without pressure; the gap between them is itself diagnostic — a student who scores well on tests and badly in games has an execution problem, not a knowledge problem, and the training is completely different. Then rank the weaknesses by cost rather than by how easy they are to fix, because a coach\'s time is the scarce resource. Finally, watch for the compound weakness, where one gap causes several symptoms: students who never generate candidates appear to have a calculation problem, and fixing the candidate generation often fixes the calculation too.',
            why: 'It is the difference between a training plan that works and one that is merely comprehensive.',
            when: 'At the start of a coaching block, and whenever the student\'s results stall.',
            whenNot: 'Not from a single game, where a bad day can distort the picture.',
            coachMethod:
              'Build an evidence table: for each candidate weakness, the games that show it, the test score, and the estimated rating cost. Then rank by cost. Present the top two to the student with the evidence attached, because a student who can see that their games show the same error four times accepts a plan far more readily than one told to "think more". Check for compound weaknesses by asking whether the same underlying habit explains more than one symptom.',
            example: {
              student: 'I am stuck at the same rating.',
              coach:
                'Let us not guess. Here is the evidence from your last eight games: candidate misses in five, time truncations in three, and endgame errors in two. The biggest one is candidate generation, and your endgame tests are fine — so this is not an endgame problem.',
            },
            realGame:
              'Build the evidence table from ten real student games and rank the weaknesses by cost.',
          },
          mistakes: [
            'Diagnosing from impression rather than evidence.',
            'Trusting the student\'s self-assessment over the games.',
            'Treating a test/games score gap as a knowledge problem.',
            'Fixing easy weaknesses because they are easier than important ones.',
            'Missing compound weaknesses with a single root cause.',
          ],
          board: {
            fen: '2r3k1/pp3ppp/8/8/8/2N1P3/PP3PPP/2R3K1 w - - 0 1',
            caption: 'One position, several possible diagnoses. The evidence from multiple games decides which it is.',
            highlight: ['c3', 'c8', 'c1'],
            arrows: [],
          },
          practice: [
            {
              fen: '2r3k1/pp3ppp/8/8/8/2N1P3/PP3PPP/2R3K1 w - - 0 1',
              prompt: 'A student misses this rook in five of eight games but scores 90% on tactic tests. What is the diagnosis?',
              solution:
                'Execution, not knowledge. The knowledge is there; the scan under time pressure is not. The training is a scan routine, not more tactics — which is exactly the mistake a coach makes when they see a positional loss and prescribe puzzles.',
              hint: 'Compare the test score with the game evidence.',
            },
          ],
          teachBack: {
            brief: 'Build an evidence table from games and tests, then rank weaknesses by rating cost.',
            required: [
              'games first, tests second, self-report almost never',
              'the test/games gap diagnoses execution versus knowledge',
              'look for compound weaknesses with one root cause',
            ],
            lookFor: [
              'ranks by cost rather than by ease',
              'identifies compound weaknesses',
            ],
          },
          misconception: 'The student believes their weakest subject is the area they most need to study.',
          puzzlePrompt:
            'Take ten games and count the error causes. Present the table and ask the student which single habit explains most of it.',
          test: [
            {
              q: 'A student scores 90% on tactic tests but misses tactics in most games. What is the diagnosis?',
              options: [
                'They need harder puzzles',
                'Execution under time pressure, not knowledge — train the scan routine',
                'They should study more theory',
                'Their calculation is weak',
              ],
              answer: 1,
              explain:
                'The gap between tests and games is the diagnosis. Prescribing more puzzles here would treat the wrong problem.',
            },
            {
              q: 'How should weaknesses be ranked?',
              options: [
                'By how interesting they are',
                'By how much rating they are costing',
                'By how easy they are to fix',
                'By the order they appear in the syllabus',
              ],
              answer: 1,
              explain:
                'A coach\'s time is the scarce resource, so rank by cost rather than by ease.',
            },
          ],
        },
        {
          id: 'l10-lessonplan',
          name: 'Lesson Planning',
          summary: 'Structuring a lesson so the student leaves having changed a specific behaviour.',
          content: {
            definition:
              'A lesson plan specifies the objective, the single behaviour to change, the material that demonstrates it, the exercise that practices it, and the check that confirms it changed. Without all five, a lesson is a conversation.',
            deep:
              'The most common lesson failure is trying to cover too much, so the objective must be a single behaviour rather than a topic. "Learn the Sicilian" is a topic; "stop missing the defender\'s resources after your own capture" is a behaviour. Then the lesson structure follows: demonstrate on the student\'s own position, explain the principle, practise it on three positions where the error would occur, and check with a fresh position at the end. The check is what most coaches skip, and skipping it means neither party knows whether the lesson worked. Finally, leave written homework with a specific number of items, because an unspecified homework is not done.',
            why: 'It is the difference between a lesson and an hour of talking about chess.',
            when: 'Before every lesson, and for every training block.',
            whenNot: 'Never without a check step, because then nobody knows if it worked.',
            coachMethod:
              'Use the five-part template: objective, demonstration, explanation, practice, check. Fill it in before the lesson starts. During the lesson, stay in one position for longer than feels comfortable — the discomfort of repetition is where the learning happens. Finish with a fresh position as the check, and record the result so the next lesson can start from evidence rather than memory.',
            example: {
              student: 'What are we doing today?',
              coach:
                'One thing: after you capture, you check what can capture back. Not tactics, not openings — that single habit. I have three positions where it will come up, then a fresh one to see if it stuck.',
            },
            realGame:
              'Write a five-part lesson plan for a real student weakness and run the check step.',
          },
          mistakes: [
            'Setting a topic as the objective instead of a behaviour.',
            'Covering multiple ideas in one lesson.',
            'Skipping the check step.',
            'Giving unspecified homework.',
            'Moving on before the student has demonstrated the behaviour.',
          ],
          board: {
            fen: 'r2qk2r/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2QK2R w KQkq - 0 12',
            caption: 'One lesson, one behaviour: before you capture, name what defends the square. Three positions, then a check.',
            highlight: ['d5', 'c6', 'f6'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r2qk2r/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2QK2R w KQkq - 0 12',
              prompt: 'Write the five-part lesson plan for teaching "name what defends the square" using this position.',
              solution:
                'Objective: the student names defenders before capturing. Demonstration: this position on the board. Explanation: the four defender resources. Practice: three positions where Nxc6, Nxf6 or similar is on offer. Check: one fresh position. That is the whole lesson.',
              hint: 'Objective, demonstration, explanation, practice, check.',
            },
          ],
          teachBack: {
            brief: 'Have the student write a five-part lesson plan and include the check step.',
            required: [
              'objective as a single behaviour, not a topic',
              'demonstration on the student\'s own position, then three practice positions',
              'a check with a fresh position and specified homework',
            ],
            lookFor: [
              'writes an objective as a behaviour',
              'includes the check step rather than assuming success',
            ],
          },
          misconception: 'The coach believes covering more material makes a lesson more valuable.',
          puzzlePrompt:
            'Take a real student weakness and write the plan, then run only the check step to see whether the lesson worked.',
          test: [
            {
              q: 'What makes a good lesson objective?',
              options: [
                'A broad topic',
                'A single behaviour the student should change',
                'A rating gain target',
                'A list of theory',
              ],
              answer: 1,
              explain:
                'A single behaviour can be practised and checked. A topic cannot be demonstrated in one hour.',
            },
            {
              q: 'What is the check step?',
              options: [
                'Asking whether the student enjoyed the lesson',
                'A fresh position that tests whether the behaviour actually changed',
                'Homework',
                'The engine evaluation of the lesson positions',
              ],
              answer: 1,
              explain:
                'Without a check, neither the coach nor the student knows whether the lesson worked. That is the step most often skipped.',
            },
          ],
        },
        {
          id: 'l10-puzzle',
          name: 'Puzzle Authoring',
          summary: 'Creating exercises that test one idea and have one clear solution.',
          content: {
            definition:
              'Puzzle authoring means designing a position that tests a specific idea, has a single unambiguous solution, and is solvable by a student at the intended level. It is a craft with rules, not just selecting an interesting position.',
            deep:
              'The three requirements are specific idea, unique solution, and correct difficulty. To test a specific idea, start from the concept and construct the position around it rather than picking an interesting position and hoping a concept is there. To get a unique solution, add forcing moves until the alternative moves are refuted — and then actually verify the alternatives with an engine, because most amateur puzzles have two solutions and students rightly resent being told they were wrong. For difficulty, use the standard ladder: mate in one, then a one-move tactic with a recapture, then a two-move tactic, then a position requiring a quiet intermediate move, and only then a full combination. Also author the *hint* before the solution, because a hint that gives away the answer is the most common authoring failure.',
            why: 'Puzzle sets are the backbone of any training programme, and their quality determines the quality of the training.',
            when: 'Whenever a training plan needs exercises, and when building a student\'s personal puzzle set.',
            whenNot: 'Not from engine positions chosen for being hard — hard is not the same as well-designed.',
            coachMethod:
              'Author in this order: name the idea, construct the position, verify every alternative with an engine, write the hint, then set the difficulty level. Publish the position without the hint and check that a student at the target level solves it in a reasonable number of attempts — if it is too hard, the difficulty is wrong regardless of how elegant the puzzle is. Then file the puzzle with its idea attached, so the training set can be reviewed by concept rather than by difficulty.',
            example: {
              student: 'This puzzle has two solutions and the app said I was wrong.',
              coach:
                'Then the puzzle is wrong, not your answer. That is the fault of the author. A puzzle with two solutions teaches the student that correct answers can be marked incorrect, which is worse than no puzzle at all.',
            },
            realGame:
              'Author one puzzle per concept for a real student weakness and verify every alternative solution.',
          },
          mistakes: [
            'Picking an interesting position rather than constructing one for a specific idea.',
            'Publishing a puzzle with more than one solution.',
            'Setting difficulty by accident rather than by design.',
            'Writing a hint that gives away the solution.',
            'Not verifying the alternative moves.',
          ],
          board: {
            fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
            caption: 'A constructed position: one idea (the pin), one solution, one difficulty level, one hint.',
            highlight: ['c6', 'f6', 'c4'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
              prompt: 'Design a puzzle from this position testing one specific idea. What is it, and what is the hint?',
              solution:
                'Idea: the pin. Hint: "which piece cannot legally move because of the bishop on c5?" — the hint names the idea without giving the move.',
              hint: 'Name the idea first, then construct the position around it.',
            },
          ],
          teachBack: {
            brief: 'Author a puzzle and have the student critique its idea, solution, difficulty and hint.',
            required: [
              'one specific idea, constructed rather than found',
              'unique solution verified against every alternative',
              'difficulty set by design, hint written before the solution',
            ],
            lookFor: [
              'verifies alternatives with an engine',
              'writes a hint that names the idea without giving the move',
            ],
          },
          misconception: 'The coach believes that if a puzzle is hard and interesting, it is well designed.',
          puzzlePrompt:
            'Take a published puzzle, check for alternative solutions, and rebuild it with a single intended idea.',
          test: [
            {
              q: 'What is the first step in authoring a puzzle?',
              options: [
                'Find an interesting position',
                'Name the specific idea the puzzle should test, then construct the position around it',
                'Pick a difficulty level',
                'Write the hint',
              ],
              answer: 1,
              explain:
                'Constructing from the idea guarantees the puzzle tests what you intended, rather than whatever happened to be in the position.',
            },
            {
              q: 'Why verify alternative solutions?',
              options: [
                'To make the puzzle harder',
                'Because a puzzle with two solutions teaches the student that correct answers get marked wrong',
                'To check the difficulty',
                'To shorten the solution',
              ],
              answer: 1,
              explain:
                'Ambiguity destroys trust in the whole training set. Verification is part of authoring, not an afterthought.',
            },
          ],
        },
        {
          id: 'l10-psychology',
          name: 'Coaching Psychology',
          summary: 'Motivating a stuck student, managing confidence, and avoiding blame.',
          content: {
            definition:
              'Coaching psychology is the set of practical skills for keeping a student engaged: managing confidence, framing errors without blame, handling a plateau, and maintaining your own standards when the student is not improving as fast as either of you would like.',
            deep:
              'The most damaging thing a coach does is make a student afraid of being wrong, because a student who is afraid stops guessing and stops learning. The practical technique is to separate effort from outcome: praise the process — the scan they ran, the question they asked, the game they were willing to lose — and treat errors as information rather than failure. That single shift changes how a student plays. The second skill is plateau management, which is mostly about evidence: a student stuck for six weeks needs to be shown the specific evidence of their improvement, because they experience only the losses. The third is honest difficulty-setting: giving a student positions they can actually solve builds confidence, and progressing too slowly builds boredom, so the ladder has to move at the edge of their ability. Finally, be willing to say that they need a break from chess, which is real and which coaches are reluctant to admit.',
            why: 'A student who stops enjoying the game stops improving, and no amount of curriculum fixes that.',
            when: 'Throughout, and especially during plateaus and after bad results.',
            whenNot: 'Not by pretending everything is fine when it is not — false encouragement costs more later.',
            coachMethod:
              'Change the language first: replace "you missed that" with "you ran the scan and the move was not in your list — what would make it appear?" That phrasing turns an error into a puzzle and keeps the student thinking. Then, at a plateau, produce evidence of improvement from the archive rather than opinion. Finally, keep a record of the student\'s best results and moments of confidence, and refer back to them at the moment they want to quit. Also protect yourself: a coach who cannot accept that a student is not ready will push them past the point where they learn anything.',
            example: {
              student: 'I am rubbish at this and I keep losing.',
              coach:
                'Let us look at the evidence rather than your last game. In your last six games you had four positions where you found the tactic after I gave you the hint. Two months ago you had none. That is not rubbish — that is a specific skill arriving. Now, what is the one thing we fix this week?',
            },
            realGame:
              'Review the student\'s last ten results with them and produce the evidence of improvement together.',
          },
          mistakes: [
            'Making the student afraid of making errors.',
            'Judging the student\'s worth by their results.',
            'Responding to a plateau with more work rather than evidence.',
            'Setting difficulty outside the student\'s reachable range.',
            'Refusing to recommend a break when one is needed.',
          ],
          board: {
            fen: 'r2qk2r/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PPPP1PPP/R2QK2R w KQkq - 0 12',
            caption: 'Reframe the error: "the move was not in your list" rather than "you missed it".',
            highlight: ['d4', 'c6'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r2qk2r/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PPPP1PPP/R2QK2R w KQkq - 0 12',
              prompt: 'Rewrite this feedback: "you missed the knight fork on c6". How would you say it to keep the student thinking?',
              solution:
                '"The knight was not in your candidate list when you moved. Before your next move, run the four-category scan and check the loose pieces." The reframe turns the error into a specific next action rather than a verdict.',
              hint: 'Separate the process from the outcome.',
            },
          ],
          teachBack: {
            brief: 'Rewrite critical feedback so it describes a process and a next action.',
            required: [
              'separate effort from outcome',
              'treat errors as information, not failure',
              'respond to a plateau with evidence rather than more work',
            ],
            lookFor: [
              'rewrites blame as a next action',
              'produces documentary evidence of improvement for a plateau',
            ],
          },
          misconception: 'The coach believes that high standards require blunt criticism.',
          puzzlePrompt:
            'Take a session where the student lost badly and write the review in a way that keeps them playing next week.',
          test: [
            {
              q: 'What is the most damaging coaching habit?',
              options: [
                'Explaining too much',
                'Making the student afraid of being wrong',
                'Setting slow progress',
                'Reviewing games at all',
              ],
              answer: 1,
              explain:
                'A student who is afraid stops guessing, and a student who does not guess does not learn. Confidence is a precondition for improvement.',
            },
            {
              q: 'What is the best response to a six-week plateau?',
              options: [
                'Increase the workload',
                'Show the student specific documentary evidence of their improvement so far',
                'Change their opening',
                'Recommend quitting',
              ],
              answer: 1,
              explain:
                'The student experiences only the losses. Evidence from the archive shows the trend they cannot feel.',
            },
          ],
        },
      ],
    },
    {
      id: 'l10-m2',
      title: 'Synthesis & Assessment',
      description: 'The final-exam topics: using everything at once, under pressure.',
      topics: [
        {
          id: 'l10-synthesis',
          name: 'Teaching Under Pressure',
          summary: 'When the student is stuck in the lesson, when the clock is running, and when your advice is being ignored.',
          content: {
            definition:
              'Teaching under pressure means handling the three situations that derail a lesson: the student is stuck and cannot find the move, the student disagrees with your explanation, and the student is not improving at the rate you both expect.',
            deep:
              'Each situation has a trained response. When the student is stuck, the intervention ladder is: ask what they see, then what they have not considered, then give a partial hint, then show the move and work backwards to why they missed it. Skipping the ladder means the student learns nothing even though you showed them the answer. When the student disagrees, do not defend your position — make them prove it on the board, because being wrong out loud is the best possible lesson and defending a bad explanation to a confident student is how coaches lose credibility. When progress stalls, go back to the evidence table from the weakness-identification topic and check whether the plan is actually being executed, because a plan not done looks exactly like a plan that does not work.',
            why: 'These three situations account for most failed lessons, and each has a trained response rather than a personality.',
            when: 'In every lesson, and especially with stronger or more argumentative students.',
            whenNot: 'Not by escalating — the ladder always goes from least to most help.',
            coachMethod:
              'Practise the intervention ladder explicitly so it becomes automatic rather than improvised. When a student disagrees, make proving it on the board the default response; it converts a confrontation into a demonstration and it protects the student\'s dignity. When progress stalls, run a review meeting against the plan: what was assigned, what was done, and does the diagnosis still hold. Train yourself to say "I do not know" in front of a student — modelling intellectual honesty is one of the most useful things a coach can demonstrate.',
            example: {
              student: 'I think Bb5 is better here.',
              coach:
                'Then show me. What does it threaten, and what does it stop? If you can find that, you are right and I will say so. If you cannot, we have just found the thing to work on.',
            },
            realGame:
              'Run a lesson and deliberately let a student disagree with you. Practise conceding publicly when they are right.',
          },
          mistakes: [
            'Jumping straight to showing the move.',
            'Defending a bad explanation to a confident student.',
            'Escalating the intervention instead of using the ladder.',
            'Assuming a stalled plan means the plan is wrong rather than unexecuted.',
          ],
          board: {
            fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3',
            caption: 'A student who disagrees is either about to teach you something or about to teach themselves.',
            highlight: ['c6', 'f3', 'c4'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3',
              prompt: 'A student insists Bc4 is a mistake here and cannot say why. How do you respond?',
              solution:
                'Ask them to prove it on the board: what does Bc4 threaten and what does it stop? Whichever way it goes, they either demonstrate the idea or find the specific gap. Do not argue — use the board.',
              hint: 'Make them prove it. The board settles it and they learn either way.',
            },
          ],
          teachBack: {
            brief: 'Have the student walk through the intervention ladder and the disagreement protocol.',
            required: [
              'the ladder: what do you see, what have you not considered, partial hint, then show and work backwards',
              'make disagreement a demonstration on the board, not an argument',
              'when progress stalls, check whether the plan was executed before changing it',
            ],
            lookFor: [
              'stays on the ladder rather than jumping to the answer',
              'concedes publicly when the student is right',
            ],
          },
          misconception: 'The coach believes showing the answer is the fastest way to teach.',
          puzzlePrompt:
            'Take a lesson where you gave the answer immediately. Rewrite it using the ladder and compare the outcome.',
          test: [
            {
              q: 'What is the correct response when a student is completely stuck?',
              options: [
                'Show them the move',
                'Work up the ladder: what do you see, what have you not considered, partial hint, then show and work backwards',
                'Tell them to think harder',
                'Move on to the next topic',
              ],
              answer: 1,
              explain:
                'Skipping the ladder means the student learns nothing even though you showed them the answer. Each rung preserves some of the discovery.',
            },
            {
              q: 'A strong student disagrees with your explanation. What do you do?',
              options: [
                'Explain it more firmly',
                'Ask them to prove it on the board, and concede publicly if they are right',
                'Change the subject',
                'Agree with them without checking',
              ],
              answer: 1,
              explain:
                'Proving it on the board converts a confrontation into a demonstration, and conceding publicly models the intellectual honesty you want to teach.',
            },
          ],
        },
        {
          id: 'l10-final',
          name: 'Final Assessment',
          summary: 'The end-to-end coach task: game, plan, lesson, puzzle, test, report.',
          content: {
            definition:
              'The final assessment is the complete coaching workflow applied to a real student game: analyse it, classify the weaknesses, build the training plan, author the exercises, teach the lesson with the check step, and produce the report.',
            deep:
              'This is a synthesis task by design, because every earlier level is tested at once and each one can be checked. The scoring must reflect that: the candidate is scored on the analysis, the diagnosis, the plan, the material, the teaching and the report separately, because a coach who is strong at analysis but weak at planning needs to know which. The honest way to run it is to give the candidate the student\'s real game, the student\'s real results, and a real time limit, then score against the criteria rather than against an impression. The final standard is the one the whole level has been building toward: can this coach produce something the student will actually do? Everything else is preparation for that question.',
            why: 'It is the only assessment that tests whether the skills work together under realistic constraints.',
            when: 'Once, at the end of the ladder, under realistic conditions.',
            whenNot: 'Not as a written theory exam, which would test recall rather than coaching.',
            coachMethod:
              'Run it as a real assignment with a real time limit and a real student game, then score each part against explicit criteria and give written feedback on each part separately. The most useful feedback is on the weakest part, because that is where the next level of the coach\'s development lies. Then compare the candidate\'s assessment of the game with the student\'s actual subsequent results, which is the only honest measure of whether the plan worked.',
            example: {
              student: 'Is my analysis good enough?',
              coach:
                'The analysis is strong. Your plan is where the marks were lost, and I will show you exactly why — a plan that names six priorities gets none of them done. Here is what a two-priority version looks like, and here is how I would check it.',
            },
            realGame:
              'Complete the full workflow on a real student game, then check the plan against the student\'s next three results.',
          },
          mistakes: [
            'Producing a strong analysis with a vague plan.',
            'Authoring exercises that do not match the diagnosis.',
            'Skipping the check step because the lesson seemed to go well.',
            'Writing a report with no follow-up attached.',
          ],
          board: {
            fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
            caption: 'One position, six parts to the assignment: analysis, diagnosis, plan, material, teaching, report.',
            highlight: ['c6', 'f6', 'c4', 'f3'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
              prompt: 'Produce the six parts of the final assessment for this game: analysis, diagnosis, plan, material, teaching, report.',
              solution:
                'Analysis: both sides developed well, Black has the better structure. Diagnosis: candidate generation under time pressure. Plan: two priorities — the scan routine and one endgame position a week. Material: one constructed pin puzzle, one ladder endgame. Teaching: five-part plan with a check step. Report: five sections with the plan longest.',
              hint: 'All six parts, each scored separately against explicit criteria.',
            },
          ],
          teachBack: {
            brief: 'Complete the six-part workflow on a real game and have each part scored separately.',
            required: [
              'analysis of the game and identification of the turning point',
              'diagnosis of the weakness class from evidence',
              'a two-priority plan with frequencies and a check',
              'authored material matching the diagnosis',
              'a five-part lesson including the check step',
              'a five-section report with the plan longest',
            ],
            lookFor: [
              'every part connects to the one before it',
              'the exercises match the diagnosis',
              'the check step is present and specific',
            ],
          },
          misconception: 'The candidate believes a strong analysis is sufficient for a strong coaching result.',
          puzzlePrompt:
            'Take a real student game and produce all six parts, then check the plan against the student\'s next three results.',
          test: [
            {
              q: 'Why score the parts of the final assessment separately?',
              options: [
                'To make it faster',
                'So the candidate knows which specific skill to develop next',
                'Because the total is meaningless',
                'To compare candidates',
              ],
              answer: 1,
              explain:
                'A coach strong at analysis but weak at planning needs to be told which one to work on. A single total hides that.',
            },
            {
              q: 'What is the ultimate standard for the final assessment?',
              options: [
                'A correct engine analysis',
                'Whether the student can actually carry out what the plan prescribes',
                'The length of the report',
                'The number of exercises authored',
              ],
              answer: 1,
              explain:
                'Everything in the level serves that question. A plan the student does not follow is not a coaching result.',
            },
          ],
        },
      ],
    },
  ],
};