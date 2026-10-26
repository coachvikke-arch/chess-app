/**
 * Level 4 — Opening Coaching.
 *
 * The governing idea: a coach teaches a *plan*, never a move list. Every topic
 * is structured so the same idea has to be delivered at three levels of
 * audience (beginner / intermediate / advanced), which is the skill the level
 * is actually assessing.
 */
export default {
  n: 4,
  id: 'level-4',
  title: 'Opening Coaching',
  tagline: 'Teach a plan, not a move list.',
  description:
    'Opening principles, structures, plans and the classic families, each explained three times over: to a beginner, to an intermediate, and to an advanced student.',
  finalTask: 'Create a complete opening lesson suitable for students.',
  finalExam: { title: 'Level 4 Final Exam', passMark: 80, sections: ['theory', 'strategic', 'teaching'] },
  competency: ['Chess Knowledge', 'Teaching Quality'],
  modules: [
    {
      id: 'l4-m1',
      title: 'Opening Principles',
      description: 'The transferable ideas. If a student learns only this level, they can play any opening they meet.',
      topics: [
        {
          id: 'l4-principles',
          name: 'Opening Principles & Tempo',
          summary: 'Centre, development, king safety, rooks — plus the tempo argument for moving fast.',
          content: {
            definition:
              'The four classical principles are: control the centre, develop pieces with purpose, castle for king safety, and place rooks on open files. Tempo is the extra resource you gain by moving first, and it is why good opening play looks fast.',
            deep:
              'The professional way to teach principles is as questions, because questions produce judgement while rules produce compliance. The four questions are: what is threatening here, which piece has no job, where is my king safest, and which file is open. Add a fifth question about tempo — "can I make this move with a gain or a threat attached?" — and the student can generate openings they have never seen. Warn them explicitly about the trap of principles as a checklist: a student who mechanically castles short and loses a piece to a developing move has not applied the principle, they have satisfied it.',
            why: 'Principles are the transferable part of opening knowledge, and the ability to produce them without memorisation is what separates a club player from a memoriser.',
            when: 'Every game, from move one, and every time a student asks "what should I play".',
            whenNot: 'Never as a rigid checklist, and never as a reason to ignore a concrete tactic in the opening.',
            coachMethod:
              'Teach by rejection. Play a game against the student where you deliberately make a principle-following move with no purpose, and ask them to criticise it. Then do the reverse: make a pawn move that breaks a principle and wins material, and ask them to justify it. Students learn principles far better by defending and rejecting than by being told.',
            example: {
              student: 'I followed all four principles and I am still losing.',
              coach:
                'Following is not the same as applying. Let us look at each move you made and ask what it actually gained. One of them is probably a move that gave no threat and created no square — that is the one that cost you the tempo.',
            },
            realGame:
              'Have the student annotate the first ten moves of their last game with which principle each move served. Most find one or two moves that served nothing.',
          },
          mistakes: [
            'Treating principles as a checklist rather than as questions.',
            'Following a principle when a tactic overrides it.',
            'Developing pieces with no assigned purpose.',
            'Ignoring tempo and losing a move-by-move race.',
          ],
          board: {
            fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
            caption: 'Development principle in action: every white piece is heading somewhere, and no move has been wasted.',
            highlight: ['e4', 'e5', 'g1', 'f1'],
            arrows: [['g1', 'f3'], ['f1', 'c4']],
          },
          practice: [
            {
              fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
              prompt: 'State the five opening questions, and give the best move for White in this position.',
              solution:
                'The five questions are threats, undeveloped pieces, king safety, open files, and tempo with purpose. The best move is Nf3 — it develops with purpose, attacks e5, and keeps the king able to castle short.',
              hint: 'Answer the questions in order and the move usually names itself.',
            },
          ],
          teachBack: {
            brief: 'Teach the four principles as five questions a student can use in any opening.',
            required: [
              'centre control, purposeful development, king safety, rooks on open files',
              'tempo is gained by moving with a threat or a gain attached',
              'principles are questions, not a checklist',
            ],
            lookFor: [
              'converts each principle into a question the student can ask',
              'uses a counter-example where breaking a principle was correct',
            ],
          },
          misconception: 'The student believes that following the principles correctly guarantees a good position.',
          puzzlePrompt:
            'Create a position where the best move breaks an opening principle and wins material, and require the student to justify the exception.',
          test: [
            {
              q: 'Which of these is a principle rather than a specific opening choice?',
              options: ['The Italian Game', 'Castle early while the centre is closed', 'Play e4', 'The Sicilian Defence'],
              answer: 1,
              explain:
                'Principles describe a reason, not a move. They transfer between openings; specific choices do not.',
            },
            {
              q: 'What is the tempo principle?',
              options: [
                'Always move the same pawn',
                'Make moves that carry a threat or a material gain so that the move costs the opponent nothing',
                'Move your queen out early',
                'Play fast in time-tressed games only',
              ],
              answer: 1,
              explain:
                'A move with a purpose attached is effectively free. That is what makes good opening play look fast.',
            },
          ],
        },
        {
          id: 'l4-pieces',
          name: 'Piece Purpose & Development Order',
          summary: 'Knights, bishops and pawns each earn their place differently.',
          content: {
            definition:
              'Good opening development is not about which piece moves first but about what each piece is for. Knights want central squares and outposts, bishops want open lines, and pawns want either central control, kingside cover for the castled king, or a target.',
            deep:
              'The professional framing is functional: a knight that develops to a good square is worth two moves; a knight that develops to a passive square is worth two moves wasted. Students who only learn "knights before bishops" without the reason will apply it wrongly later, so pair the rule with the reason — a knight needs two moves to become active, a bishop needs one. Add the hardest part of this topic, which is that developing the right piece matters more than developing fast: bringing the knight to a square that no piece can dispute is the real goal, and beginners systematically undervalue that square.',
            why: 'Purpose-driven development is the difference between a student who improves quickly and one who stays stuck.',
            when: 'The first ten to fifteen moves of every game.',
            whenNot: 'Not when a pawn break or capture is urgently needed, and not when the fastest available move carries a threat.',
            coachMethod:
              'After every move ask the single question "what does this piece do now that it did not before?". If there is no answer, it was not development. Make the student answer out loud every time; it is uncomfortable at first and it becomes automatic. Then introduce the harder version: "where is the best square for that knight, and can you reach it safely?"',
            example: {
              student: 'I developed my knight but nothing happened.',
              coach:
                'Nothing happened because of where it went, not because it moved. Put it on a square no enemy piece can attack, and you will see activity. Which square is that here?',
            },
            realGame:
              'Have the student identify their best-placed piece and their worst-placed piece in their last game, and explain the difference in terms of function.',
          },
          mistakes: [
            'Developing a knight to a square that can be challenged by a pawn.',
            'Developing bishops first out of habit.',
            'Treating a pawn push as neutral when it has a purpose.',
            'Blocking your own pieces with a pawn move.',
          ],
          board: {
            fen: 'rnbqkbnr/pppp1ppp/8/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3',
            caption: 'Both knights have reached central squares. Development that matters is measured by squares controlled, not moves played.',
            highlight: ['f3', 'c4', 'f6', 'c5'],
            arrows: [['f8', 'c5']],
          },
          practice: [
            {
              fen: 'rnbqkbnr/pppp1ppp/8/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3',
              prompt: 'Where should the black knight on g8 go, and why is that square better than a4 or d7?',
              solution:
                'c5 or e7 then c5 — an outpost in the centre. From c5 the knight is safe from pawn challenges and controls b7, d7 and a4. On a4 it is cramped and takes two moves to matter.',
              hint: 'Which squares can no enemy pawn reach?',
            },
          ],
          teachBack: {
            brief: 'Teach development as a functional question rather than a piece-order rule.',
            required: [
              'every move must change what a piece can do',
              'knights need central outposts, bishops need open lines',
              'knights before bishops is a rule of thumb with a reason',
            ],
            lookFor: [
              'asks "what does this piece do now?" after every move',
              'asks for the best square for the piece, not just a legal one',
            ],
          },
          misconception: 'The student thinks development means getting pieces off the back rank, regardless of where they land.',
          puzzlePrompt:
            'Build a position with six developed pieces doing nothing and one knight on a protected outpost, and ask which side is better developed.',
          test: [
            {
              q: 'Why are knights usually developed before bishops?',
              options: [
                'Knights are more valuable',
                'A knight needs two moves to become active, a bishop only one',
                'Bishops cannot be developed early',
                'It is a rule from the Italian Game',
              ],
              answer: 1,
              explain:
                'Turn count. A knight sent to a poor square has spent two moves for nothing, which is why the destination matters as much as the move.',
            },
            {
              q: 'What makes a knight outpost valuable?',
              options: [
                'It is far from the king',
                'No enemy pawn can attack it, so it is permanently secure there',
                'It is on the edge of the board',
                'It defends a queen',
              ],
              answer: 1,
              explain:
                'An outpost is a square no enemy pawn can challenge. Security is what makes it contribute for the rest of the game.',
            },
          ],
        },
        {
          id: 'l4-castling-tim',
          name: 'Castling Sides & King Safety Plans',
          summary: 'Choosing a side, and the three ways an attack on a castled king fails.',
          content: {
            definition:
              'Castling long places the king on c1 behind a b2 shield and puts a rook on d1; castling short puts the king on g1 behind f2 and g2 with a rook on f1. The choice depends on which side your development favours and how the position is structured.',
            deep:
              'A coach needs a defensible framework here, not a preference. Castling long is right when the queenside is where your pieces are headed, when you will push c4 or d5 and need queenside space, or when the opponent has strong queenside play and you want to sidestep it. Castling short is right when you intend an attack with the king, when your king is being targeted on the kingside, or when the queenside is closed. The deeper teaching point is the three ways an attack on a castled king fails: the pawn shield is intact, the attacker has invested pieces without gaining the critical square, and the defender meets the attack with a timely counter-strike. A student who understands those three failures stops fearing attacks altogether.',
            why: 'King safety is decided in the opening and paid for in the endgame, so this is where the strategic score is actually set.',
            when: 'Usually before the centre opens, and ideally within the first ten moves.',
            whenNot: 'Not when the castling square is attacked, and not "temporarily" — an early king move is permanent.',
            coachMethod:
              'Show three positions: one where long is clearly right, one where short is clearly right, and one where the choice is a judgement call. Then present the three ways attacks fail, because that is the part students never learn and it stops them panicking. Finally, make them trace a lost game back to the moment castling was delayed.',
            example: {
              student: 'Which side should I castle to?',
              coach:
                'Do not ask me — ask your position. Where are your pieces going? Do you want queenside space? Is the king in danger on the kingside? Answer those three questions and the choice usually makes itself.',
            },
            realGame:
              'Take a student game lost to a kingside attack and have them identify the exact move at which castling should have happened.',
          },
          mistakes: [
            'Castling long with the king already weak on the queenside.',
            'Delaying castling because the position "feels fine yet".',
            'Assuming a castled king is permanently safe.',
            'Forgetting that a castled king can still be attacked.',
          ],
          board: {
            fen: 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 9',
            caption: 'Both kings have castled short. The open d-file gives White space; Black has closed lines and a bishop pair.',
            highlight: ['g1', 'f1', 'd1', 'g8', 'f8'],
            arrows: [['d1', 'd5']],
          },
          practice: [
            {
              fen: 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 9',
              prompt: 'What is the main plan for each side in this position, and which side has the more concrete one?',
              solution:
                'White has a half-open d-file and pressure on d5; Black has the bishop pair and a solid but cramped structure. The plans are named, which is what makes them teachable — neither side has a forced tactic.',
              hint: 'Name the file, the target and the piece that does the work.',
            },
          ],
          teachBack: {
            brief: 'Teach castling side choice as a three-question decision, plus the three ways an attack fails.',
            required: [
              'long for queenside space and c4/d5 plans, short for a kingside attack',
              'attacks fail when the shield holds, the critical square is denied, or a counter-strike lands first',
              'castle before the centre opens',
            ],
            lookFor: [
              'has the student answer the three questions rather than guess',
              'explains a failed attack by reference to the shield or counter-strike',
            ],
          },
          misconception: 'The student believes castling makes the king permanently safe, and so never plans around a later attack.',
          puzzlePrompt:
            'Take a game lost to a kingside attack and write out the decision tree that would have prevented it.',
          test: [
            {
              q: 'Which question is NOT part of choosing a castling side?',
              options: [
                'Where are my pieces going?',
                'Do I want queenside space?',
                'Is my king in danger on the kingside?',
                'Which side is my bishop on?',
              ],
              answer: 3,
              explain:
                'Bishop colour does not decide castling. Development direction, space plans and king exposure do.',
            },
            {
              q: 'One of the three ways a kingside attack fails is:',
              options: [
                'The attacker runs out of pieces',
                'The defender meets the attack with a timely counter-strike',
                'The pawn shield moves forward too far',
                'The king captures the attacker',
              ],
              answer: 1,
              explain:
                'Attacks need investment; if the defender counter-strikes before the attack matures, the attackers are simply lost.',
            },
          ],
        },
      ],
    },
    {
      id: 'l4-m2',
      title: 'Pawn Structures',
      description: 'The structures that determine the plans. This is where opening knowledge stops being move order and starts being chess.',
      topics: [
        {
          id: 'l4-structures',
          name: 'Pawn Structures',
          summary: 'Isolated, doubled, backward and passed — and what each one gives you.',
          content: {
            definition:
              'A pawn structure is the permanent shape of the pawns. Four kinds matter: the isolated pawn (no friendly pawns on adjacent files), the doubled pawn (two pawns on the same file), the backward pawn (one that cannot advance safely because its neighbours are gone), and the passed pawn (no enemy pawns on its file or the files beside it).',
            deep:
              'Structures determine plans more reliably than anything else in the opening, which is why a serious coach teaches them before move orders. Each structure hands you a specific target and a specific piece to use. An isolated queen\'s pawn gives you a target on c4 and a reason to bring a knight to c3; the doubled c-pawn gives Black a half-open c-file to attack and White a weakness to defend; the backward pawn gives you the square in front of it and a reason to place pieces there. The most valuable habit to build is naming the target out loud in every lesson: "your knight belongs on c3 because of the isolani, and its job is the c4 square."',
            why: 'Structure explains the plan, so it lets a coach answer "why" rather than only "what", which is the difference between teaching and instructing.',
            when: 'Immediately after the structure forms — the moment a pawn becomes isolated or doubled is the moment to explain the plan.',
            whenNot: 'Never ignore a tactic that arises in the middlegame in favour of discussing structure.',
            coachMethod:
              'Build the structure on the board in front of the student and let them find the target themselves. Draw the target square in a different colour and ask: which of my pieces can use this? Then have them name the piece and its job. That routine — structure, target, piece, job — is the backbone of positional teaching and it works at every level from club to master.',
            example: {
              student: 'Why does he keep playing b4 and b5?',
              coach:
                'Because of the structure. Look at his pawns: no pawn of his own can support that push, and no pawn of mine can stop it. That push is not a move he likes — it is the move the structure allows.',
            },
            realGame:
              'Take any master game and identify the structure, the target and the piece doing the work. Have the student do the same for one of their own games.',
          },
          mistakes: [
            'Evaluating a structure without naming the resulting plan.',
            'Creating an isolated queen pawn and having no plan for it.',
            'Forgetting that doubled pawns are often compensated by the half-open file.',
            'Trading into a worse structure without a concrete reason.',
          ],
          board: {
            fen: 'r1bq1rk1/ppp2ppp/2n5/3p4/3P4/2N5/PPP2PPP/R1BQ1RK1 w - - 0 9',
            caption: 'The pawn on d4 is isolated. The plan that follows is named: target c4, knight to c3, then pressure down the half-open c-file.',
            highlight: ['d4', 'c4', 'c3'],
            arrows: [['c3', 'c4'], ['d1', 'd7']],
          },
          practice: [
            {
              fen: 'r1bq1rk1/ppp2ppp/2n5/3p4/3P4/2N5/PPP2PPP/R1BQ1RK1 w - - 0 9',
              prompt: 'Name the structure, the target square, and the piece whose job it is to use that target.',
              solution:
                'Isolated d-pawn (isolani). Target: c4. Piece: the knight, which belongs on c3 to pressure c4 from a protected square. That is the plan, and it is teachable in one sentence.',
              hint: 'Structure, target, piece, job — in that order.',
            },
          ],
          teachBack: {
            brief: 'Teach the four pawn structures and the structure-target-piece-job routine.',
            required: [
              'isolated, doubled, backward and passed pawn definitions',
              'each structure names a target and a piece to use it',
              'the routine is structure, target, piece, job',
            ],
            lookFor: [
              'has the student name the target square unprompted',
              'uses a real game position rather than a diagram',
            ],
          },
          misconception: 'The student sees an isolated pawn as only a weakness and has no idea it also creates a target.',
          puzzlePrompt:
            'Take one position per structure and have the student write the one-sentence plan for each side.',
          test: [
            {
              q: 'What is an isolated pawn?',
              options: [
                'A pawn with no friendly pawns on the adjacent files',
                'Two pawns on the same file',
                'A pawn that cannot advance',
                'A pawn on the edge of the board',
              ],
              answer: 0,
              explain:
                'No neighbours on the adjacent files. It is both a weakness for its owner and a target for the opponent.',
            },
            {
              q: 'What does a doubled pawn set up for the opponent?',
              options: [
                'A closed centre',
                'A half-open file to attack along',
                'A bishop outpost',
                'A safe king walk',
              ],
              answer: 1,
              explain:
                'When one side doubles on a file, the other has a half-open file to press down — often with a knight and later a rook.',
            },
          ],
        },
        {
          id: 'l4-major',
          name: 'Major Openings: The Open Games',
          summary: '1.e4 e5, and the structures it produces — plus the closed Italian plan.',
          content: {
            definition:
              'The Open Games begin 1.e4 e5 2.Nf3 Nc6 (or 3.Bb5). They generally lead to fast development, an open centre, and mutual plans of attacking the king on the opposite side from the pawn structure.',
            deep:
              'Coach this family by structure rather than by lines. 1.e4 e5 2.Nf3 Nc6 3.Bb5 (the Ruy Lopez) creates a closed centre with the classic plan of manoeuvring on the queenside with c4, d4 and a knight to c3 — the lesson is that a closed centre gives you queenside play and the opponent often ends up with the kingside. The Open Italian and Scotch give the opposite lesson: an open centre means both sides can develop quickly and the tempo matters enormously. Show both students and ask them what the centre implies about where each side will attack. That transfers to every opening they will ever meet.',
            why: 'It is the most-played opening family at club level, so a coach who teaches it well improves the majority of their students immediately.',
            when: 'When a student chooses 1.e4 and needs a plan rather than a database move.',
            whenNot: 'Do not teach lines before the student can state the structural plan behind them.',
            coachMethod:
              'Teach two positions, not forty moves. Set up 1.e4 e5 2.Nf3 Nc6 3.Bb5 and have the student build the plan themselves: where do I want to attack, which pawn move prepares it, which knight supports it. Then do the same with the open Italian, and contrast the two plans. Only then, if the student asks, introduce specific variations — and always tie each move back to the plan.',
            example: {
              student: 'I play the Ruy Lopez but I do not know what I am doing after move eight.',
              coach:
                'That is because you learned moves, not a plan. In this structure your play is on the queenside: c4, then d4, then the knight to c3. Every move you learn should be justified by that plan.',
            },
            realGame:
              'Take a classical Ruy Lopez and have the student annotate which moves serve the queenside plan.',
          },
          mistakes: [
            'Memorising lines without knowing the structural plan behind them.',
            'Playing c4 in the Ruy Lopez without considering the d4 break.',
            'Opening the centre too early without development.',
            'Confusing the Open and Closed Games and their plans.',
          ],
          board: {
            fen: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3',
            caption: 'The Ruy Lopez position. The plan is queenside: c4, d4, Nc3 — and the king stays safe behind the pawns.',
            highlight: ['c4', 'd4', 'c3'],
            arrows: [['b5', 'c4']],
          },
          practice: [
            {
              fen: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3',
              prompt: 'State the plan for both sides in this position. Which side attacks where?',
              solution:
                'Black plays c3-c4 (the Breyer/Ruy counter-plan) or d6 and Nf6 to prepare e4-e5 expansion; White intends queenside play with c4 and d4. Both plans are about space and pawn structure, not tactics.',
              hint: 'Ask which side of the board each side wants to open.',
            },
          ],
          teachBack: {
            brief: 'Teach the Open Games as two structural lessons rather than as a move tree.',
            required: [
              '1.e4 e5 leads to either a closed centre (Ruy) or an open centre',
              'a closed centre gives queenside play, an open centre gives fast development',
              'every recommended move must serve the stated plan',
            ],
            lookFor: [
              'requires the student to state the plan before naming any move',
              'contrasts the open and closed lessons explicitly',
            ],
          },
          misconception: 'The student memorises opening lines and freezes when the opponent deviates from the book.',
          puzzlePrompt:
            'Give a Ruy Lopez position ten moves from a book line and ask the student to construct the plan without any theory.',
          test: [
            {
              q: 'In the Ruy Lopez structure, what is the typical plan?',
              options: [
                'A quick kingside pawn storm',
                'Queenside manoeuvring with c4, d4 and a knight to c3',
                'Trading queens immediately',
                'An immediate endgame',
              ],
              answer: 1,
              explain:
                'The closed centre in the Ruy gives queenside play; that is the plan the structure creates.',
            },
            {
              q: 'What does an open centre primarily reward?',
              options: ['Patient piece shuffling', 'Fast, purposeful development', 'Early castling queenside', 'Pawn storms'],
              answer: 1,
              explain:
                'An open centre means both sides can develop quickly, so tempo and development speed decide the game.',
            },
          ],
        },
        {
          id: 'l4-sicilian',
          name: 'Major Openings: Sicilian & Semi-Open Defences',
          summary: 'Asymmetric openings, open files, and the king-hunt plans behind them.',
          content: {
            definition:
              'Semi-open defences (1.e4 c5, 1.e4 e6, 1.e4 d6, 1.d4 Nf6) give Black a half-open file for White\'s centre pawn, while the Sicilian gives Black an immediate central counter-attack and a broad set of pawn structures.',
            deep:
              'The common thread is asymmetry, and that is the concept to teach. In the Sicilian Black is not trying to be equal — they are trying to be uncompensated, which means counter-attacking rather than mirroring. White then gets a half-open d-file and space; Black gets rapid development and a central break with d5. If a student can explain those two sentences, they can play any Sicilian mainline without knowing a single move order. The same structure applies to the French (the d5 break is the whole game) and the Caro-Kann (delayed pressure on the d-file plus a very solid king). Teach each of these as a structural story with a named break, because the break is what the student is really playing for.',
            why: 'These are the openings most of a coach\'s students will actually reach, and they are where most of their games are decided.',
            when: 'When a student adopts 1.e4 against 1...c5, or when defending 1.e4 with any semi-open move.',
            whenNot: 'Do not present the Sicilian as a move tree with fifty branches. Teach the break and let the student choose the route.',
            coachMethod:
              'Use the "two sentences" method. Ask the student to state, in two sentences: what Black wants, and what White gets in exchange. If they can, they can play the opening. Then set the position on move six and ask them to name the break (d5, or ...e5, or ...c4 in the Najdorf). Every further move they learn should be labelled as either preparing the break or restraining the opponent\'s break — that single label turns a database into an argument.',
            example: {
              student: 'The Sicilian has too many variations. Where do I start?',
              coach:
                'Forget the variations. In two sentences: Black wants to counter-attack in the centre and play d5. White gets space and the half-open d-file as compensation. Everything after move six is either preparing those two things or stopping the opponent from doing them.',
            },
            realGame:
              'Take a Sicilian game, draw the d5 square, and have the student trace every move that either prepared the break or prevented it.',
          },
          mistakes: [
            'Learning fifty Sicilian variations and no structural plan.',
            'Playing the French and not understanding why ...d5 is the point.',
            'Not knowing which break the opening is actually about before choosing a move order.',
            'Adopting a defensive opening and then playing passively instead of counter-attacking.',
          ],
          board: {
            fen: 'r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2',
            caption: 'The Open Sicilian after 1.e4 c5 2.Nf3 Nc6 3.Bb5. White has space, Black has the counter-attack — and ...d5 is the break both sides are preparing around.',
            highlight: ['d5', 'd4', 'e5', 'c5'],
            arrows: [['d2', 'd4']],
          },
          practice: [
            {
              fen: 'r1bqkbnr/pp1ppppp/2n5/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2',
              prompt: 'In one sentence each: what does Black want, and what does White get as compensation?',
              solution:
                'Black wants the ...d5 central break and a counter-attack. White gets the half-open d-file and more space. That exchange of pressure is the whole opening in one line.',
              hint: 'Half-open file for one side, central break for the other.',
            },
          ],
          teachBack: {
            brief: 'Teach the Sicilian and semi-open defences as two sentences and one break.',
            required: [
              'asymmetry: Black counters instead of mirroring',
              'White receives the half-open file and space',
              'the central break is what the moves are preparing',
            ],
            lookFor: [
              'can state both sentences without notes',
              'labels moves as preparing the break or restraining the opponent\'s break',
            ],
          },
          misconception: 'The student believes they must memorise the Sicilian move by move because it has too many variations.',
          puzzlePrompt:
            'Take the same opening two moves further and ask the student to name which move prepared the break.',
          test: [
            {
              q: 'What does White get in the Sicilian in exchange for Black\'s counter-attack?',
              options: [
                'A winning endgame',
                'The half-open file and space',
                'A bishop pair',
                'The initiative permanently',
              ],
              answer: 1,
              explain:
                'Space and the half-open d-file are White\'s compensation. If they lose that pressure, the position is often unbalanced in Black\'s favour.',
            },
            {
              q: 'What is the central break in the French Defence?',
              options: [
                '...e5', '...d5', '...c4', '...f5',
              ],
              answer: 1,
              explain:
                '...d5 challenges White\'s centre immediately and defines the whole opening — which is why the French is a race for it.',
            },
          ],
        },
        {
          id: 'l4-indian',
          name: 'Major Openings: Closed & Indian Defences',
          summary: 'Grünfeld and King\'s Indian logic, and why d5 is a move in both.',
          content: {
            definition:
              'Closed and Indian defences against 1.d4 — the Grünfeld, King\'s Indian, Queen\'s Indian and Nimzo-Indian — all accept a space-gaining centre and then undermine it, typically with ...d5 played at a specific moment.',
            deep:
              'These openings teach the most valuable strategic lesson in chess: sometimes you deliberately allow your opponent to take space, because you intend to undermine that space and gain something permanent in exchange. The Grünfeld does it hyperbolically — Black lets White grab space with c4 and d5, then plays ...d5 to create an isolated pawn and a dark hole on c4. A coach should use that as the teaching case: "White has more space and Black has more structure — which matters?" The answer, over decades of practice, is structure, and the ability to explain why is exactly what separates a strong coach from a strong player. In the King\'s Indian the same logic is applied with ...d6 followed by ...e5, and the King\'s Indian attack against it is the natural student counter-exercise, because it shows the other side of the story.',
            why: 'It is where a student learns to think structurally rather than by rule, and those defences are among the most common at strong club level.',
            when: 'When a student wants a sound defence to 1.d4 and needs to understand the reason behind it.',
            whenNot: 'Never as a set of moves. Each of these openings has a single structural story that explains all of the variations.',
            coachMethod:
              'Teach the ...d5 moment as an event. In each position, draw the d5 square and ask: should we play it now, or do we need to prepare first? The preparation varies — in the Grünfeld you need ...Nbd7 and ...c5, in the King\'s Indian ...d6, in the Queen\'s Indian ...e6 — but the question is identical. Then ask the counter-question: what does White get, and can they use it? Students who can answer that are ready to actually play the opening.',
            example: {
              student: 'Why does he let me have all that space?',
              coach:
                'Because he is buying something else. You have space; he has a structure that is easier to attack forever. Now the real question: can you use that space before he breaks?',
            },
            realGame:
              'Take a Grünfeld game and mark every move that either prepared or delayed ...d5. Then do the same for the King\'s Indian.',
          },
          mistakes: [
            'Copying opening lines without understanding the structural reason.',
            'Playing ...d5 without the necessary preparation in a sharp variation.',
            'Assuming space is always good for the side holding it.',
            'Not knowing which counter-attack the opening gives White.',
          ],
          board: {
            fen: 'rnbqkb1r/pppp1ppp/8/4n3/2PP4/8/PP2PPPP/RNBQKBNR b KQk - 0 2',
            caption: 'The Grünfeld position. White has a big pawn centre; Black plans ...d5 to attack it and create a target on c4.',
            highlight: ['d5', 'c4', 'd4', 'e5'],
            arrows: [['d7', 'd5']],
          },
          practice: [
            {
              fen: 'rnbqkb1r/pppp1ppp/8/4n3/2PP4/8/PP2PPPP/RNBQKBNR b KQk - 0 2',
              prompt: 'What does Black give up, what does Black gain, and what is the move that expresses the gain?',
              solution:
                'Black gives up space on the queenside and gains a structure to attack: the ...d5 break against the c4/d4 centre creates an isolated d-pawn and a lasting target on c4.',
              hint: 'Trade space for structure. Then name the move.',
            },
          ],
          teachBack: {
            brief: 'Teach the closed and Indian defences as the deliberate trade of space for structure.',
            required: [
              'Black allows a space-gaining centre on purpose',
              'the gain is a structure with a named target, delivered by ...d5',
              'the counter-question is whether White can use the space first',
            ],
            lookFor: [
              'can name the preparation each defence needs before ...d5',
              'asks the student what White gained in exchange',
            ],
          },
          misconception: 'The student believes more space is automatically better, and cannot explain why these defences work despite conceding space.',
          puzzlePrompt:
            'Take a Grünfeld game and have the student identify the moment the structure was decided and the moment White failed to use the space.',
          test: [
            {
              q: 'What does Black gain in the Grünfeld?',
              options: [
                'A winning endgame',
                'A structure with a lasting target on c4',
                'A bishop pair',
                'The open c-file',
              ],
              answer: 1,
              explain:
                'Black trades space for structure. The ...d5 break creates an isolani and a dark hole on c4 to attack for the rest of the game.',
            },
            {
              q: 'What is the general strategic lesson of these openings?',
              options: [
                'Never take space',
                'Space can be traded for a structure that is easier to attack',
                'Always trade queens',
                'Openings do not matter',
              ],
              answer: 1,
              explain:
                'Conceding space deliberately is a legitimate strategy — the structure has to be better enough to compensate.',
            },
          ],
        },
      ],
    },
    {
      id: 'l4-m3',
      title: 'Teaching Openings',
      description: 'The coaching craft: same opening, three students, three explanations.',
      topics: [
        {
          id: 'l4-three-levels',
          name: 'Explaining One Opening Three Ways',
          summary: 'The same position taught to a beginner, an intermediate and an advanced student.',
          content: {
            definition:
              'A coach must be able to explain one opening at three depths: the concrete moves for a beginner, the plan for an intermediate student, and the underlying structural and strategic logic for an advanced student.',
            deep:
              'This is the skill that separates a chess teacher from a chess player, and it is trainable. The beginner needs a concrete move and a one-sentence reason ("the knight goes to f3 because it threatens the pawn on e5"). The intermediate student needs the plan and the conditional logic ("if he plays d6 then we can pin the knight, if he does not then ..."). The advanced student needs the structure and the exceptions ("the c3 Sicilian trades structure for a poisoned pawn for d4, which is a different evaluation of the same position"). Notice that the coach is not simplifying a single explanation — they are giving three *different* explanations aimed at three different questions. Practise by taking one position and writing all three, out loud, including the questions each student would actually ask.',
            why: 'A student who is taught at the wrong depth either feels patronised or feels lost, and both outcomes lose the coach\'s time.',
            when: 'Every time you teach a new idea, and especially in mixed-ability groups.',
            whenNot: 'Do not give the advanced explanation to a beginner because it is shorter. Brevity is not the same as accessibility.',
            coachMethod:
              'Use a three-column worksheet. Position on the left; on the right, three columns labelled "beginner / intermediate / advanced". Fill each one in before the lesson. The act of writing forces the coach to translate, which is exactly the skill being trained. In the lesson, deliver the beginner column first and only move up when the student asks a question that belongs to the next column.',
            example: {
              student: 'Why do we play this move here?',
              coach:
                'It depends what you already know. If you are learning the opening, it is because the knight attacks e5. If you understand the plan, it is because we want the bishop on b5 before we castle. If you understand the position, it is because we accept a backwards pawn on b7 because we get an open c-file and a lead in development. Same move, three depths.',
            },
            realGame:
              'Have the coach write three explanations for a position in their own repertoire and note which depth each of their students needs most.',
          },
          mistakes: [
            'Giving the advanced explanation to a beginner.',
            'Giving only concrete moves with no plan at all.',
            'Assuming a student who has played the moves twice understands them.',
            'Skipping the "why" because the student can just copy.',
          ],
          board: {
            fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/RNBQ1RK1 w kq - 0 6',
            caption: 'One position, three explanations: the concrete move, the plan, and the structural trade-off.',
            highlight: ['c4', 'f3', 'c6', 'f6'],
            arrows: [['c6', 'c4'], ['f6', 'c4']],
          },
          practice: [
            {
              fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/RNBQ1RK1 w kq - 0 6',
              prompt: 'Give the beginner explanation, then the intermediate explanation, for this position.',
              solution:
                'Beginner: "Put your bishop on c4 — it attacks f7, which is Black\'s weakest square." Intermediate: "Both sides want c4; if Black plays c4 we can take and open the d-file, if Black plays d6 we can double on c4 and attack b7."',
              hint: 'One is a move and a reason. The other is a decision tree.',
            },
          ],
          teachBack: {
            brief: 'Have the student teach one position at three different depths.',
            required: [
              'beginner: a concrete move and a one-sentence reason',
              'intermediate: the plan and the conditional logic',
              'advanced: the structural trade-off and the exceptions',
            ],
            lookFor: [
              'gives genuinely different explanations, not one explanation simplified',
              'anticipates a question that belongs to the next level up',
            ],
          },
          misconception: 'The coach believes there is one correct explanation and that simplifying it is the only option.',
          puzzlePrompt:
            'Take a lesson you have actually taught, and rewrite the explanation at all three depths.',
          test: [
            {
              q: 'What is the beginner-level explanation of a developing move?',
              options: [
                'The structural trade-off it achieves',
                'A concrete move and a one-sentence reason it is good',
                'The engine evaluation',
                'The historical origins of the opening',
              ],
              answer: 1,
              explain:
                'A beginner needs a specific move and a reason they can act on. Abstract structure is not yet usable for them.',
            },
            {
              q: 'Why must the advanced explanation differ from the beginner one rather than merely being longer?',
              options: [
                'To save lesson time',
                'Because they answer a different question — strategy and trade-offs rather than what to play',
                'Because the advanced student is wrong',
                'Because beginners are distracted by details',
              ],
              answer: 1,
              explain:
                'Each depth answers a different question. Adding detail is not translation; only answering the right question is.',
            },
          ],
        },
        {
          id: 'l4-repertoire',
          name: 'Building a Student Repertoire',
          summary: 'Choosing a small, coherent set of openings a student can actually own.',
          content: {
            definition:
              'A repertoire is a small, deliberate set of openings a player knows well enough to execute without thinking. The coaching task is to build one that suits the student\'s level, style and time budget.',
            deep:
              'The most common coaching failure is handing a student thirty openings, which is worse than handing them none, because recall fails under pressure and they will have no plan when the line diverges. Build a repertoire instead: one solid opening against the move the student plays most, one weapon for their main black answer, and one alternative for when they are out of book. Test each candidate by asking the student to state the plan after ten moves. If they cannot, the opening is too hard for them and should be replaced regardless of how good it looks on paper. Note also the time-budget question — a repertoire the student cannot study before a tournament is not a repertoire, it is a wish.',
            why: 'Confidence in the opening compounds across a match, and the student who feels safe in the first ten moves plays better for the rest of the game.',
            when: 'When a student has enough opening knowledge to be overwhelmed, which is usually around 1400-1600.',
            whenNot: 'Not as a reason to avoid new openings entirely — variety is fine, as long as the student can still execute.',
            coachMethod:
              'Run a repertoire interview: how much time do they have, do they like open or closed positions, do they prefer to attack or manoeuvre? Then propose three openings maximum and require the student to state each plan. Test at move ten, not move one, because the plan is what matters. Then, crucially, assign one *repertoire* move they will play regardless of what happens — a move that says "I have thought about this and I am not worried", which is a real psychological tool.',
            example: {
              student: 'Should I learn the Sicilian Najdorf?',
              coach:
                'Can you state the plan after ten moves of the Najdorf? If yes, yes. If no, learn the Dragon first and add the Najdorf when you can explain what happens after 6.Bg5. Ten moves of understanding beats forty moves of recall.',
            },
            realGame:
              'Have the student list every opening they have played twice. Then have the circle the ones where they could not state the plan.',
          },
          mistakes: [
            'Teaching too many openings for the student to master.',
            'Choosing openings by rating trend rather than by the student\'s own understanding.',
            'Ignoring the time budget for preparation.',
            'Having no answer for the opponent\'s second move.',
          ],
          board: {
            fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2',
            caption: 'After 1.e4 c5 the student must have a plan for the main replies. A repertoire is a plan, not a first move.',
            highlight: ['c5', 'd4', 'e5'],
            arrows: [['d2', 'd4']],
          },
          practice: [
            {
              fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2',
              prompt: 'Name the main structural replies to 2.Nf3 against the Sicilian, and the plan each one implies.',
              solution:
                '2...Nc6 (open Sicilian, fast development and ...d5), 2...d6 (closed, flexible, usually ...e5), and 2...Nf6 (Rossolimo/Kalashnikov territory, keeping the structure flexible). Each reply names a different plan.',
              hint: 'For each reply, ask what Black\'s central break would be.',
            },
          ],
          teachBack: {
            brief: 'Have the student design a three-opening repertoire and justify each with a plan at move ten.',
            required: [
              'a repertoire is small and executable, not large and comprehensive',
              'each opening must be testable by stating the plan at move ten',
              'time budget matters as much as suitability',
            ],
            lookFor: [
              'keeps the set to three or fewer openings',
              'can state the plan after ten moves for each',
            ],
          },
          misconception: 'The student believes more openings prepared is always better preparation.',
          puzzlePrompt:
            'Give the student a position out of their repertoire and ask them to construct a plan anyway, then compare it with their preparation.',
          test: [
            {
              q: 'What is the test for whether an opening belongs in a student\'s repertoire?',
              options: [
                'It is fashionable',
                'The student can state the plan after ten moves',
                'It is rated highly',
                'It has only one main line',
              ],
              answer: 1,
              explain:
                'If the plan at move ten is clear, the opening is theirs. If not, more memorisation will not fix it.',
            },
            {
              q: 'What is the main downside of teaching a student many openings?',
              options: [
                'It takes too long to learn',
                'Under pressure they recall nothing and have no plan when the line diverges',
                'It weakens their tactics',
                'It reduces tournament enjoyment',
              ],
              answer: 1,
              explain:
                'Volume without plans produces flustered play. A small repertoire executed confidently beats a large one half-remembered.',
            },
          ],
        },
      ],
    },
  ],
};