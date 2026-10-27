import { useCallback, useEffect, useRef, useState } from 'react';
import { Page, Card, Chip, Spinner } from '../components/ui';
import CertificateInline from '../components/CertificateInline';
import CertificateModal from '../components/CertificateModal';
import { listMyCertificates } from '../services/certificatesApi';
import Pagination, { PAGE_SIZE } from '../components/Pagination';
import { usePagination } from '../hooks/usePagination';
import Button from '../components/Button';

const TYPE_TABS = [
  ['all', 'All'],
  ['level', 'Level'],
  ['tournament', 'Tournament'],
];

/*
 * My Certificates — the certificate section in the student's own sidebar.
 *
 * A student reads this page; they do not issue or manage certificates, and they
 * do not send them to anyone. So the actions here are deliberately just:
 *
 *   Download        — keep a copy of the PDF
 *   Show in page    — draw the certificate inside the page (preview + download)
 *
 * Preview, Open PDF and Send on WhatsApp are admin actions and stay on the Super
 * Admin screen. The list itself is fetched from /certificates/me, which resolves
 * the student from the session; there is no id in the URL to change.
 */
export default function MyCertificates() {
  const [student, setStudent] = useState(null);
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /* Which certificate is drawn inside the page (the "Show in page" toggle). */
  const [inlineId, setInlineId] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [tournamentView, setTournamentView] = useState(null);
  const listTopRef = useRef(null);

  const filtered = certificates.filter((c) => typeFilter === 'all' || c.type === typeFilter);

  const pager = usePagination(filtered, PAGE_SIZE, {
    resetKeys: [typeFilter],
    scrollRef: listTopRef,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listMyCertificates();
      setStudent(data.student);
      setCertificates(data.certificates);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Page title="Certificates" piece="♕"><Spinner text="Loading your certificates…" /></Page>;

  if (error) {
    return (
      <Page title="Certificates" piece="♕">
        <Card>
          <p className="text-sm text-red-400">{error}</p>
          <Button type="button" variant="primary" size="md" className="mt-3" onClick={load}>Try again</Button>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Certificates"
      piece="♕"
      sub="Every certificate you have earned. Download it, or show it right here on the page."
      wide
    >
      <div className="flex flex-wrap items-center gap-3">
        <Chip tone="green">{certificates.length} {certificates.length === 1 ? 'certificate' : 'certificates'}</Chip>
        {student?.name && <span className="text-xs text-ivory-500">Issued to {student.name}</span>}
      </div>

      <div className="mt-4 flex items-center gap-2 overflow-x-auto" role="tablist" aria-label="Certificate type">
        {TYPE_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={typeFilter === key}
            onClick={() => setTypeFilter(key)}
            className={`kt-tab shrink-0 ${typeFilter === key ? 'active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div ref={listTopRef} className="mt-4 space-y-3">
        {filtered.length === 0 && (
          <Card>
            <p className="chess-empty">
              {certificates.length === 0
                ? 'No certificates yet. They are issued automatically when you complete a level or finish a tournament.'
                : `No ${typeFilter} certificates yet.`}
            </p>
          </Card>
        )}

        {pager.currentItems.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display font-bold text-ivory-200">{c.title}</h3>
                <p className="text-xs text-ivory-500 mt-1">
                  {c.certificateNo} · issued {new Date(c.issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {c.type !== 'tournament' && c.preview?._badge ? ` · ${c.preview._badge}` : ''}
                  {c.type === 'tournament' && c.score ? ` · ${c.score}` : ''}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Chip tone="gold">{c.type === 'tournament' ? 'Tournament' : `Level ${c.levelNo ?? ''}`.trim()}</Chip>
                  {c.needsGeneration && <Chip tone="red">PDF not ready</Chip>}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {c.type === 'tournament' ? (
                  <Button
                    type="button"
                    variant="secondary" size="sm" className="!px-3 !py-1 text-xs"
                    onClick={() => setTournamentView(c)}
                  >
                    View certificate
                  </Button>
                ) : (
                  <>
                    {c.fileUrl && (
                      <Button variant="secondary" size="sm" className="!px-3 !py-1 text-xs" href={c.fileUrl} download>
                        Download
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant={inlineId === c.id ? 'primary' : 'secondary'}
                      size="sm"
                      className="!px-3 !py-1 text-xs"
                      aria-pressed={inlineId === c.id}
                      onClick={() => setInlineId((id) => (id === c.id ? null : c.id))}
                    >
                      {inlineId === c.id ? 'Hide from page' : 'Show in page'}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {inlineId === c.id && (
              <CertificateInline
                certificate={c}
                onHide={() => setInlineId(null)}
                showOpenPdf={false}
              />
            )}
          </Card>
        ))}
      </div>

      <Pagination
        currentPage={pager.currentPage}
        totalPages={pager.totalPages}
        totalItems={pager.totalItems}
        onPageChange={pager.setPage}
        itemLabel="certificates"
      />

      {tournamentView && (
        <CertificateModal
          open
          onClose={() => setTournamentView(null)}
          certificate={{
            playerName: tournamentView.studentName || student?.name || '',
            tournamentName: tournamentView.tournamentName || tournamentView.title,
            position: tournamentView.position ?? tournamentView.rank ?? null,
            score: tournamentView.score || '',
            date: tournamentView.issuedAt,
          }}
        />
      )}
    </Page>
  );
}
