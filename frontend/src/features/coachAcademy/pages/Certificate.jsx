/**
 * AI Coach Training Academy — certificate.
 *
 * This is an INTERNAL training achievement, and the wording is deliberate: it
 * records that a coach completed this academy's training, nothing more. It is
 * not a title, an accreditation, or a licence to teach — anyone could copy this
 * wording in an afternoon, and it should not be able to.
 *
 * It is issued only when Level 10's final exam is passed, which is the same
 * condition that unlocks it (`isCertified`), so there is no second rule to keep
 * in sync.
 */

import { Page, Card, Spinner, Chip } from '../../../components/ui';
import { APP_NAME } from '../../../config/brand';
import Button from '../../../components/Button';
import useAcademyProgress from '../hooks/useAcademyProgress';
import { CURRICULUM } from '../services/academyStore';
import { formatDate, formatDuration } from '../utils/format';
import { Empty } from '../components/AcademyUI';

export default function CoachAcademyCertificate() {
  const p = useAcademyProgress();

  if (!p.user) return <Spinner text="Preparing your record…" />;

  if (!p.certified) {
    const last = CURRICULUM[CURRICULUM.length - 1];
    const done = p.assessments.filter((a) => a.passed).length;
    return (
      <Page title="Certificate" piece="♛" sub="Issued on completing the full ten-level training ladder.">
        <Card title="Not yet earned" piece="🔒">
          <Empty hint={`Pass the Level ${last.n} final exam at ${last.finalExam.passMark}% or above.`}>
            You have passed {done} of {CURRICULUM.length} level exams.
          </Empty>
          <div className="text-center">
            <Button
              to={`/coach/ai-coach-training/level/${p.level}`}
              variant="primary"
              size="md"
            >
              Continue at Level {p.level}
            </Button>
          </div>
        </Card>
      </Page>
    );
  }

  const finalAssessment = p.state.assessments?.[String(CURRICULUM[CURRICULUM.length - 1].n)];
  const name = p.user.name || p.user.email || 'Coach';
  const issued = finalAssessment?.takenAt;

  return (
    <Page title="Certificate" piece="♛" sub={`Internal training record — ${APP_NAME}.`}>
      <div className="max-w-3xl mx-auto">
        <div className="rounded-3xl border-2 border-gold-500/40 bg-gradient-to-br from-gold-500/[0.08] to-transparent p-8 sm:p-12 text-center">
          <p className="text-5xl mb-4" aria-hidden="true">
            ♛
          </p>
          <p className="text-xs uppercase tracking-[0.3em] text-gold-400 mb-3">Certificate of Training Completion</p>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-ivory-100 mb-2">{name}</h2>
          <p className="text-sm text-ivory-300 mb-6">
            has completed the AI Coach Training Academy, all {CURRICULUM.length} levels, including the Level{' '}
            {CURRICULUM[CURRICULUM.length - 1].n} Master Coach final examination with a score of{' '}
            <span className="font-semibold text-gold-600">{finalAssessment?.best ?? finalAssessment?.score}%</span>.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 text-left">
            {p.assessments.map((a) => (
              <div key={a.level} className="rounded-xl bg-black/[0.03] border border-ivory-700/30 p-2.5">
                <p className="text-[0.6rem] uppercase tracking-wider text-ivory-500">Level {a.level}</p>
                <p className="text-sm font-semibold text-ivory-100">{a.best}%</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-3 text-xs text-ivory-500 mb-6">
            <Chip>Issued {formatDate(issued)}</Chip>
            <Chip>Training time {formatDuration(p.trainingMs)}</Chip>
            <Chip>Overall mastery {p.overall}%</Chip>
          </div>

          <p className="text-[0.65rem] text-ivory-700 leading-relaxed max-w-xl mx-auto">
            This certificate records completion of internal coach training at {APP_NAME}. It is
            not a chess title, a rating, or an external accreditation, and it does not certify or authorise
            anyone to teach chess. Records are stored locally on the training device.
          </p>
        </div>

        <Card title="What was covered" piece="♜">
          <ol className="space-y-1.5">
            {CURRICULUM.map((l) => (
              <li key={l.n} className="text-sm text-ivory-300">
                <span className="text-gold-400 font-semibold mr-2">{l.n}.</span>
                {l.title} — <span className="text-ivory-500">{l.tagline}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </Page>
  );
}