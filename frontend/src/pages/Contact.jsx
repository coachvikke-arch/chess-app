import { useState } from 'react';
import { Piece, Card, Reveal } from '../components/ui';
import Button from '../components/Button';
import usePageTitle from '../hooks/usePageTitle';

export default function Contact() {
  const [sent, setSent] = useState(false);
  usePageTitle('Contact');

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <Reveal>
        <div className="text-center mb-10">
          <span className="text-6xl inline-block piece-glyph-spin text-gold-400">♖</span>
          <h1 className="font-display text-4xl font-bold mt-4">
            Contact the <span className="chess-gradient-text">Academy</span>
          </h1>
          <p className="text-ivory-500 mt-2">Have a question? Reach out — we'll respond in a few moves.</p>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        {sent ? (
          <div className="chess-card chess-card-hover p-10 text-center">
            <span className="text-6xl inline-block text-green-600 animate-bounce">♛</span>
            <h2 className="font-display text-2xl font-bold mt-4">Message sent!</h2>
            <p className="text-ivory-500 mt-2">Thanks! We'll get back to you soon. Checkmate.</p>
          </div>
        ) : (
          <Card hover className="p-8">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSent(true);
              }}
              className="space-y-4"
            >
              <div>
                <label className="text-sm font-medium text-ivory-300">Your name</label>
                <input required placeholder="Full name" className="chess-input mt-1.5" />
              </div>
              <div>
                <label className="text-sm font-medium text-ivory-300">Your email</label>
                <input required type="email" placeholder="you@example.com" className="chess-input mt-1.5" />
              </div>
              <div>
                <label className="text-sm font-medium text-ivory-300">Message</label>
                <textarea required placeholder="Tell us how we can help…" rows={5} className="chess-input mt-1.5 resize-none" />
              </div>
              <Button variant="primary" size="md">
                <Piece p="♘" spin /> Send Message
              </Button>
            </form>
          </Card>
        )}
      </Reveal>
    </div>
  );
}