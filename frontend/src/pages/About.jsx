import { Piece, Card, Reveal } from '../components/ui';
import usePageTitle from '../hooks/usePageTitle';

const points = [
  { icon: '♟', title: 'Complete beginners', desc: 'First moves, board vision and the rules made simple.' },
  { icon: '♘', title: 'Club players', desc: 'Openings, middle-game plans and endgame technique.' },
  { icon: '♕', title: 'Tournament players', desc: 'Deep preparation, calculation training and game analysis.' },
];

export default function About() {
  usePageTitle('About Coach');
  return (
    <div className="max-w-4xl mx-auto px-4 py-16">
      <Reveal>
        <header className="text-center mb-12">
          <span className="text-6xl inline-block piece-glyph-spin text-gold-400">♞</span>
          <h1 className="font-display text-4xl font-bold mt-4">
            About the <span className="chess-gradient-text">Coach</span>
          </h1>
        </header>
      </Reveal>

      <Reveal delay={0.1}>
        <Card hover className="p-8">
          <p className="leading-relaxed text-ivory-300 text-lg">
            Our lead coach has spent over a decade training chess players of all levels —
            from complete beginners taking their first steps to tournament players
            preparing for national events. The academy blends structured curriculum,
            live coaching, and daily practice to build strong, well-rounded players.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            {['10+', '500+', '100+'].map((n, i) => (
              <div key={i} className="rounded-xl bg-black/5 border border-ivory-700/50 py-4">
                <p className="font-display text-2xl font-bold text-gold-400">{n}</p>
                <p className="text-xs text-ivory-500 mt-1">
                  {['Years coaching', 'Students trained', 'National winners'][i]}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </Reveal>

      <div className="divider-spacer" style={{ height: 40 }} />
      <div className="grid md:grid-cols-3 gap-6">
        {points.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.12}>
            <Card hover className="h-full text-center">
              <span className="text-4xl inline-block piece-glyph-spin text-gold-400 mb-3">{p.icon}</span>
              <h3 className="font-semibold text-ivory-100">{p.title}</h3>
              <p className="text-sm text-ivory-500 mt-2">{p.desc}</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </div>
  );
}