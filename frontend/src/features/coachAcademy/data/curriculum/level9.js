/**
 * Level 9 — Advanced Coaching & Game Analysis.
 *
 * The integration level. Levels 1-8 taught the parts; this level teaches the
 * workflow a coach actually runs on a real student game, and the vocabulary
 * needed to write a report that a student will act on rather than admire.
 */
export default {
  n: 9,
  id: 'level-9',
  title: 'Advanced Coaching & Game Analysis',
  tagline: 'Turn a game into a training plan.',
  description:
    'The full analysis workflow from complete game to personalised recommendation, plus the vocabulary of blunders, mistakes and turning points.',
  finalTask: 'Take a real student game and generate a complete professional coaching report.',
  finalExam: { title: 'Level 9 Final Exam', passMark: 80, sections: ['theory', 'tactical', 'strategic', 'teaching'] },
  competency: ['Strategic Skill', 'Teaching Quality'],
  modules: [
    {
      id: 'l9-m1',
      title: 'The Analysis Workflow',
      description: 'A repeatable process, so analysis is not a mood the coach happens to be in.',
      topics: [
        {
          id: 'l9-gameeval',
          name: 'Game Evaluation',
          summary: 'Assess the game before you analyse it, or you will analyse the wrong moves.',
          content: {
            definition:
              'Game evaluation is the deliberate assessment of a completed game against six criteria: opening, middlegame, endgame, tactics, strategy and time management. It is done before move-level analysis, so that the analysis is aimed at what actually mattered.',
            deep:
              'The reason to evaluate first is efficiency. A coach who jumps straight to engine evaluation spends the lesson on the moves the engine disliked and misses the structural decision that actually lost the game. The evaluation step answers: what was the plan, did it work, and where did it stop working? Then the criteria give the report its structure, and the structure is what makes a report actionable. The professional habit is to write the evaluation in one paragraph before touching a single move, because that paragraph is the finding, and everything after it is evidence. Also teach the honest discipline of identifying what the student did *well* — a report that lists only errors gives a student no model to imitate.',
            why: 'It decides whether the lesson produces insight or just a list of engine complaints.',
            when: 'At the start of every game review, always.',
            whenNot: 'Not while the game is still in progress, except for the 30-second habit of noting the turning point.',
            coachMethod:
              'Run the six-criteria pass first, scoring each criterion out of five with a reason. Then identify the turning point — the move where the result changed — and analyse only from there backwards and forwards. That single restriction is what makes a lesson focused. Finally, require the report to name one thing the student did well and should keep doing, because a report with no positive model is not coaching.',
            example: {
              student: 'Where do we start?',
              coach:
                'Not move one. Let us score the six criteria first, and then find the turning point. Everything after the turning point is what we will actually look at, and it is usually much later than you think.',
            },
            realGame:
              'Have the student score their own game on the six criteria before the coach says anything.',
          },
          mistakes: [
            'Starting with move one instead of the turning point.',
            'Letting engine evaluation substitute for evaluation.',
            'Reporting only errors and no positive model.',
            'Anchoring on the engine\'s first choice rather than the position.',
          ],
          board: {
            fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
            caption: 'Score opening, middlegame, endgame, tactics, strategy and clock before you analyse a single move.',
            highlight: ['c4', 'f3', 'c6', 'f6'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPPP1PPP/R1BQ1RK1 b kq - 0 8',
              prompt: 'Score this position on the six evaluation criteria. Which is already decided?',
              solution:
                'Opening: solid development by both sides. Middlegame: Black\'s c5 bishop and knight outpost are active, White\'s are not yet. Tactics: none forced. Strategy: Black has the better structure. Clock: unmeasurable here. The opening is decided, which tells you where to start.',
              hint: 'Score each criterion out of five with a reason attached.',
            },
          ],
          teachBack: {
            brief: 'Require a six-criteria evaluation in writing before any move-level analysis.',
            required: [
              'opening, middlegame, endgame, tactics, strategy, time management',
              'identify the turning point and analyse from there',
              'name one thing to keep doing',
            ],
            lookFor: [
              'writes the evaluation paragraph before looking at engine output',
              'identifies the turning point and justifies it',
            ],
          },
          misconception: 'The student believes analysis means going through every move with the engine.',
          puzzlePrompt:
            'Take a real game and ask the student to identify the turning point before any move-level analysis.',
          test: [
            {
              q: 'Why evaluate a game before analysing individual moves?',
              options: [
                'To practice notation',
                'So the analysis is aimed at what actually decided the game rather than what the engine disliked',
                'To fill in the lesson time',
                'Because moves cannot be reviewed',
              ],
              answer: 1,
              explain:
                'Evaluation gives the lesson its target. Without it you spend the hour on irrelevant moves.',
            },
            {
              q: 'What is the turning point?',
              options: [
                'The engine\'s preferred move',
                'The move where the result of the game changed',
                'The last mistake',
                'The opening blunder',
              ],
              answer: 1,
              explain:
                'Analysing from the turning point in both directions is what turns a game review into a lesson.',
            },
          ],
        },
        {
          id: 'l9-blunders',
          name: 'Mistake Classification',
          summary: 'Blunder, mistake, inaccuracy — and what each one tells you about the student.',
          content: {
            definition:
              'Chess evaluation classifies moves by how much evaluation they lose: a blunder is a decisive error, a mistake is a serious error, an inaccuracy is a small one. For coaching, the useful classification is not the evaluation lost but the *kind* of error.',
            deep:
              'The coach\'s move is to classify errors by cause, not by size, because the cause determines the lesson. The categories that work in practice are: candidate miss (they never looked), calculation error (they looked and got it wrong), defensive resource miss (they missed what the opponent could do), time-truncation error (they had no time, so it is a decision problem), and positional imprecision (no single blunder, the position leaked slowly). Each category needs a different remedy — a scan routine, a calculation method, a resource checklist, clock management, or a plan. Presenting a student with "you made a blunder at move 12" is useless; presenting "you did not look at the captures before moving, which is a scan problem" is a lesson.',
            why: 'Classifying by cause turns a list of moves into a training plan.',
            when: 'Whenever you label a move as an error in a review.',
            whenNot: 'Not for the endgame report where a full move-by-move list is appropriate.',
            coachMethod:
              'Mark every error on the game sheet with a cause code rather than a symbol, then present the summary: "three candidate misses, two defensive resource misses, one time truncation". That summary is the diagnosis and it determines the training plan. Insist that the student identify the cause themselves before you confirm it, because the act of classifying is most of the learning. Then, if there are three or more of the same cause, that is the next month\'s focus.',
            example: {
              student: 'I blundered my queen on move 22.',
              coach:
                'Let us classify it rather than just mark it. Did you not look at the captures before you moved — that is a scan miss. Did you look and miscalculated — that is a calculation error. Or did you have eight minutes and rushed — that is a clock problem. Each one has a different fix.',
            },
            realGame:
              'Have the student classify their own errors by cause before the coach reviews them.',
          },
          mistakes: [
            'Reporting only the size of the error, not its cause.',
            'Using "blunder" as a general term for anything bad.',
            'Not noticing that repeated causes point to a single training need.',
            'Ignoring time-truncated errors, which are a clock problem not a chess problem.',
          ],
          board: {
            fen: '2r3k1/pp3ppp/8/8/8/2N1P3/PP3PPP/2R3K1 w - - 0 1',
            caption: 'Every error gets a cause code. Three of the same code means that is the training focus.',
            highlight: ['c3', 'c8', 'c1'],
            arrows: [],
          },
          practice: [
            {
              fen: '2r3k1/pp3ppp/8/8/8/2N1P3/PP3PPP/2R3K1 w - - 0 1',
              prompt: 'A white knight on e2 moved to c3 and lost a piece. What are the three possible cause classifications?',
              solution:
                'Candidate miss (did not look at the rook on c8 before moving), calculation error (looked but misread the rook\'s protection), or time truncation (no time to think). Each needs a different remedy.',
              hint: 'Classify by cause, not by size.',
            },
          ],
          teachBack: {
            brief: 'Have the student classify every error by cause before the coach confirms the classification.',
            required: [
              'candidate miss, calculation error, defensive resource miss, time truncation, positional imprecision',
              'repeated causes indicate the training focus',
              'classification precedes remedy',
            ],
            lookFor: [
              'assigns cause codes without prompting',
              'identifies the dominant cause across a whole game',
            ],
          },
          misconception: 'The student thinks "blunder" is a diagnosis rather than a measurement.',
          puzzlePrompt:
            'Take a game and label every error with a cause code instead of a symbol.',
          test: [
            {
              q: 'What is the most useful classification of an error?',
              options: [
                'How much evaluation it lost',
                'Its cause — candidate miss, calculation error, defensive resource miss, time truncation',
                'Which piece was moved',
                'Whether it was in the opening',
              ],
              answer: 1,
              explain:
                'The cause determines the remedy. A missing candidate and a miscalculation are different problems with different fixes.',
            },
            {
              q: 'What does three errors of the same cause in one game suggest?',
              options: [
                'The student had a bad day',
                'That single weakness is the training priority',
                'The game was unlucky',
                'The engine was wrong',
              ],
              answer: 1,
              explain:
                'Repetition of one cause is a pattern, not noise. It tells you exactly what to work on next.',
            },
          ],
        },
        {
          id: 'l9-turning',
          name: 'Turning Points & Critical Moments',
          summary: 'Finding the move that changed the result — and why it was hard to see.',
          content: {
            definition:
              'A turning point is the move after which the game result is effectively decided. A critical moment is a move where the player had a clear, correct opportunity that was missed, and it did not change the result.',
            deep:
              'The distinction is worth teaching because it changes the lesson. A turning point usually means something structural went wrong and the student should be asked why it was acceptable-looking. A critical moment means the student found a good idea and failed to execute it, which is a different and more encouraging diagnosis. To find them, compare the evaluation before and after each move and mark the largest drops — that is the turning point. Then look for the moves where the engine saw something the student did not, because those are the critical moments. A coach who can name the difference between "you never saw it" and "you saw it and did not find it" is giving a far more actionable lesson, because the two require opposite training.',
            why: 'It focuses the lesson on the one or two moments that actually mattered.',
            when: 'After evaluating the game, before move-level analysis.',
            whenNot: 'Not in a game where several players made errors, since attribution gets ambiguous.',
            coachMethod:
              'Make a list of the three largest evaluation drops and identify which are turning points and which are critical moments. Then ask the student the diagnostic question for each: "did you not see this move, or did you see it and not find it?" The answer tells you the training. Finally, have them mark the same on their next game — the marking habit is the transferable skill.',
            example: {
              student: 'I did not see anything at move 30.',
              coach:
                'That is worth checking. "Did not see anything" can mean two very different things: the move was not in your candidate list at all, or it was there and you did not calculate it. One is a scan problem, the other is a calculation problem.',
            },
            realGame:
              'Have the student identify the turning point and one critical moment in each of five games.',
          },
          mistakes: [
            'Confusing a critical moment with a turning point.',
            'Assuming "I did not see it" means the same thing every time.',
            'Missing turning points because they are quiet moves, not blunders.',
            'Reporting many critical moments instead of one turning point.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
            caption: 'The largest evaluation drop in a game is usually a quiet structural move, not a blunder.',
            highlight: ['d5', 'c6', 'f6'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 12',
              prompt: 'Find a quiet move here that would be a turning point if played, rather than a blunder.',
              solution:
                'A quiet positional move such as ...Re8 or ...Ne7 that commits a piece to a losing square. Turning points are frequently structural and look reasonable, which is why they are hard to spot in review.',
              hint: 'Look for a move that gives up a square rather than a piece.',
            },
          ],
          teachBack: {
            brief: 'Have the student distinguish turning points from critical moments in their own game.',
            required: [
              'turning point: the result changed',
              'critical moment: a clear opportunity was missed but the result did not change',
              '"did not see it" versus "saw it and did not find it" are opposite training needs',
            ],
            lookFor: [
              'identifies the turning point by evaluation drop',
              'asks themselves the see-or-not-see question',
            ],
          },
          misconception: 'The student believes the turning point is always the biggest blunder.',
          puzzlePrompt:
            'Take a real game and find a quiet turning point that was not the biggest error.',
          test: [
            {
              q: 'How is a turning point different from a critical moment?',
              options: [
                'A turning point changes the result; a critical moment is a missed opportunity that does not',
                'A turning point is a blunder; a critical moment is not',
                'They are the same thing',
                'Critical moments only happen in the opening',
              ],
              answer: 0,
              explain:
                'The distinction matters because they need different remedies: one is a decision problem, the other is an execution or attention problem.',
            },
            {
              q: 'How do you find the turning point in a game?',
              options: [
                'Look for the biggest capture error',
                'Find the move with the largest evaluation drop',
                'Ask the player which move they regret',
                'Look at the opening only',
              ],
              answer: 1,
              explain:
                'Comparing the evaluation before and after each move and finding the largest drop is a mechanical, reliable method.',
            },
          ],
        },
      ],
    },
    {
      id: 'l9-m2',
      title: 'Analysis Tools & Reporting',
      description: 'Using an engine properly, and writing a report the student will act on.',
      topics: [
        {
          id: 'l9-engine',
          name: 'Using an Engine Properly',
          summary: 'The engine answers "what", never "why" — and reading it badly costs years.',
          content: {
            definition:
              'An engine evaluates positions and identifies the best move. It does not explain why the move is best, whether the position is playable, or what plan you should have. Using it properly means reading it for ideas and verification, not for answers.',
            deep:
              'The central professional warning is that engine output can quietly replace understanding. A student who asks the engine after every move learns nothing and improves slowly. The correct workflow is: analyse first, form a plan, then check with the engine, and if the engine disagrees ask *why* rather than accept the move. Two specific reading skills matter. First, when the engine finds nothing, the position is fine and you should stop looking — many students waste entire lessons on a level position. Second, when the engine finds a sacrifice, ask which piece becomes undefended and which square the opponent was allowed; that question is what turns an engine move into a teachable idea. Also teach the engine\'s honest limitation: it cannot see how a position feels, and human players win games in positions the engine calls equal.',
            why: 'Used badly, the engine is the main obstacle to a student becoming a strong player.',
            when: 'After the student has formed a plan, and as verification of an analysis.',
            whenNot: 'Not before the student has thought about the position.',
            coachMethod:
              'Impose a rule: no engine before the student writes a plan. Then, when the engine disagrees, require the question "why?" and a written answer before they are allowed to change the move. Teach the reading skill explicitly by taking an engine sacrifice and asking the student to identify which piece was undefended and what the opponent was given. Finish with the "engine says nothing" case, because a coach who trains students to stop there saves them years of wasted analysis.',
            example: {
              student: 'The engine says Rxd5 and I thought it was bad.',
              coach:
                'Good — do not just accept it. Ask the question: why is it good? Which piece did the rook become undefended on, and what did Black get in return? When you can answer that in words, the move is yours. Until then it is just a number.',
            },
            realGame:
              'Have the student analyse five positions with the engine and write the "why" for each engine move.',
          },
          mistakes: [
            'Opening the engine before forming a plan.',
            'Accepting an engine move without understanding it.',
            'Analysing positions the engine evaluates as balanced.',
            'Believing the engine sees how a position plays.',
          ],
          board: {
            fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 1',
            caption: 'When the engine finds nothing, the position is fine. Stop looking and play your plan.',
            highlight: ['d5', 'c3'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r2q1rk1/pp3ppp/2n2n2/3p4/3P4/2NP1N2/PP3PPP/R2Q1RK1 w - - 0 1',
              prompt: 'The engine shows no tactic. What should you do now?',
              solution:
                'Stop looking for tactics and play your plan. A balanced evaluation means the position is decided by plans and structure, which is where you should spend your time.',
              hint: 'No tactic found means no tactic exists here.',
            },
          ],
          teachBack: {
            brief: 'Impose a plan-before-engine rule and teach the "why" question.',
            required: [
              'plan first, then verify with the engine',
              'when the engine disagrees, ask why rather than accept the move',
              'when the engine finds nothing, stop analysing',
            ],
            lookFor: [
              'writes a plan before opening the engine',
              'explains an engine move in words before playing it',
            ],
          },
          misconception: 'The student treats the engine as an authority rather than a verification tool.',
          puzzlePrompt:
            'Take an engine move and ask the student to identify which piece became undefended.',
          test: [
            {
              q: 'What should happen before opening the engine?',
              options: [
                'Play a fast move to save time',
                'Form your own plan for the position',
                'Calculate three moves',
                'Nothing in particular',
              ],
              answer: 1,
              explain:
                'Plan first, then verify. Analysing first means you learn the engine\'s answer instead of your own idea.',
            },
            {
              q: 'The engine finds no tactic in a position. What does that mean?',
              options: [
                'The position is lost',
                'There is no tactic there, so the game will be decided by plans',
                'The engine is broken',
                'You should try harder',
              ],
              answer: 1,
              explain:
                'A balanced position is normal in most games. Learning to stop analysing and start planning is a major improvement.',
            },
          ],
        },
        {
          id: 'l9-report',
          name: 'Coaching Reports',
          summary: 'A report is a decision document, not a list of moves.',
          content: {
            definition:
              'A coaching report has five parts: the game summary, the evaluation of each phase, the turning point with its cause, the positive patterns to keep, and a specific training plan with exercises and next steps.',
            deep:
              'The purpose of a report is to change behaviour, so the last section matters more than the analysis. A report that ends with "you should calculate more" changes nothing; a report that ends with "before every move in the opening, run the four-category scan, and do this drill five times a week" changes something. The structure of the report should mirror the student\'s experience: start where they will read it, keep it short, use their own positions rather than model games, and name the specific exercises with dates. Also teach the coach to write the report in the student\'s own vocabulary — if you write "positional imprecision" and the student does not know the term, they cannot act on it.',
            why: 'The report is the only artefact that outlives the lesson, so its structure is what makes coaching compound.',
            when: 'After every reviewed game, and at the end of a training block.',
            whenNot: 'Not in the middle of a lesson, where it interrupts the flow.',
            coachMethod:
              'Write the report together, in five headed sections, with the student reading each section as it is written. Insist on the training plan being the longest section, with named exercises and a number of repetitions. Then, at the next session, start by asking what they actually did with the plan — because a coaching cycle with no follow-up is not coaching. Keep the tone factual: report what happened and what to do, without judgement about the player.',
            example: {
              student: 'What should I work on?',
              coach:
                'Not "think more" — that is not actionable. Here is what I will write: three errors of the same kind, so the first exercise is the scan routine before every move, five positions a week, and I will check the next game for the same error. That is what you do on Monday.',
            },
            realGame:
              'Write a full report on a student game and have the student read it and mark everything they did not understand.',
          },
          mistakes: [
            'Writing the analysis but no training plan.',
            'Prescribing general advice like "think more" instead of a named exercise.',
            'Using the coach\'s vocabulary instead of the student\'s.',
            'Writing a report with no follow-up session attached to it.',
          ],
          practice: [
            {
              fen: 'r1bq1rk1/pp2nppp/2p1pn2/3p4/3P4/1P1PN3/P1P2PPP/R1BQNRK1 b - - 0 10',
              prompt: 'Write the five headings of a coaching report for this position, then say which section would be longest.',
              solution:
                'Summary, phase evaluation, turning point with cause, positive patterns, training plan — and the training plan should be the longest, because it is the only section that changes future behaviour.',
              hint: 'Which section changes what the student does next week?',
            },
          ],
          teachBack: {
            brief: 'Write a five-part report and require the student to mark anything they do not understand.',
            required: [
              'summary, phase evaluation, turning point with cause, positive patterns, training plan',
              'the training plan must be the longest section with named exercises and repetitions',
              'write in the student\'s vocabulary, not the coach\'s',
            ],
            lookFor: [
              'produces a plan the student could follow without the coach present',
              'names specific exercises rather than general advice',
            ],
          },
          misconception: 'The student believes a coaching report is the analysis, rather than the plan that follows from it.',
          puzzlePrompt:
            'Take a real game and write the five-section report, then check whether the student could act on the plan alone.',
          test: [
            {
              q: 'Which section of a coaching report matters most?',
              options: [
                'The opening summary',
                'The training plan, because it is the only part that changes future behaviour',
                'The move list',
                'The evaluation numbers',
              ],
              answer: 1,
              explain:
                'The report exists to change behaviour. Analysis without a specific plan is a record, not coaching.',
            },
            {
              q: 'What makes a training plan actionable?',
              options: [
                'It is encouraging',
                'It names specific exercises with repetitions and dates',
                'It uses technical vocabulary',
                'It is long',
              ],
              answer: 1,
              explain:
                '"Calculate more" is not actionable. "Run the four-category scan five times a week, I will check the next game" is.',
            },
          ],
        },
        {
          id: 'l9-recommend',
          name: 'Personalised Recommendations',
          summary: 'Turning an assessment into a training plan the student will actually do.',
          content: {
            definition:
              'A personalised recommendation is a training prescription derived from the evidence in the student\'s games and tests: the specific weakness, the exercise that addresses it, the frequency, and the check for whether it worked.',
            deep:
              'The professional discipline here is that recommendations must be *prescribed*, not brainstormed. Take the evidence — the error causes from the game, the mastery gaps from the tests, the practice results — and derive the recommendation from it. Then apply the filter that makes the plan survivable: at most two priorities at a time, because a student given six priorities does none of them. Add the measurable check, because a plan without a check cannot be evaluated. Finally, teach the coach to choose exercises that match the diagnosis exactly, since the most common wasted recommendation is giving a student a tactic puzzle when the real problem is that they never look for candidates.',
            why: 'It is the step where a coach\'s diagnosis becomes a student\'s improvement, and it is where most coaching quietly fails.',
            when: 'At the end of a training block, and whenever the student asks what to work on.',
            whenNot: 'Not mid-lesson, where it distracts from the current position.',
            coachMethod:
              'Write the evidence first: the three most common error causes, the two lowest mastery scores, the practice results. Then derive at most two priorities from that evidence, name the exercise and frequency for each, and define the check. Review the check at the next session and adjust the plan rather than the student. Insist that the student writes the plan down themselves, because a plan they did not write is a plan they will not do.',
            example: {
              student: 'What should I do between now and the next tournament?',
              coach:
                'Two things, not six. Your three biggest errors were all candidate misses, so here is the scan exercise with a frequency. And your weakest test area is endgame technique, so here is one endgame position a week. We will check both in your next game, and if the candidate misses are gone we move on.',
            },
            realGame:
              'Derive a two-priority plan from a real student game and check it at the next session.',
          },
          mistakes: [
            'Prescribing more than two priorities.',
            'Giving an exercise that does not match the diagnosis.',
            'Setting no check, so the plan cannot be evaluated.',
            'Giving a plan the student never sees again.',
          ],
          board: {
            fen: 'r1bq1rk1/pp2nppp/2p1pn2/3p4/3P4/1P1PN3/P1P2PPP/R1BQNRK1 b - - 0 10',
            caption: 'Two priorities, one exercise each, one check. Six priorities means none get done.',
            highlight: ['e6', 'c6', 'e3'],
            arrows: [],
          },
          practice: [
            {
              fen: 'r1bq1rk1/pp2nppp/2p1pn2/3p4/3P4/1P1PN3/P1P2PPP/R1BQNRK1 b - - 0 10',
              prompt: 'The student\'s errors are all "candidate miss" and their endgame tests are weak. What are the two priorities?',
              solution:
                'Priority one: the four-category scan before every move, with a specified number of practice positions per week. Priority two: one endgame position a week from a specific family. Two priorities, each with a frequency, each with a check.',
              hint: 'Match the exercise to the diagnosis, and limit it to two.',
            },
          ],
          teachBack: {
            brief: 'Derive a two-priority plan from evidence and have the student write it down themselves.',
            required: [
              'evidence first: error causes, weak mastery areas, practice results',
              'at most two priorities at a time',
              'each priority needs an exercise, a frequency, and a check',
            ],
            lookFor: [
              'derives the plan from evidence rather than opinion',
              'keeps the plan to two priorities',
              'defines how the plan will be checked',
            ],
          },
          misconception: 'The student believes a longer training plan is more thorough and therefore more likely to work.',
          puzzlePrompt:
            'Take a diagnosis and write a two-priority plan, then explain what you deliberately left out.',
          test: [
            {
              q: 'How many training priorities should a plan have at once?',
              options: [
                'As many as the diagnosis suggests',
                'At most two, because a student given six priorities does none of them',
                'One, always',
                'Three, always',
              ],
              answer: 1,
              explain:
                'Survivability beats comprehensiveness. Two priorities get done; six get ignored.',
            },
            {
              q: 'Why must recommendations be derived from evidence?',
              options: [
                'To look professional',
                'Because the evidence is what tells you which exercise will actually work',
                'To fill the report',
                'Because the student will check',
              ],
              answer: 1,
              explain:
                'The error causes, weak test areas and practice results are what connect a diagnosis to a specific exercise.',
            },
          ],
        },
      ],
    },
  ],
};