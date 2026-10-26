import { PageHeader } from '../components/ui';
import PuzzleAssignmentsPanel from '../components/PuzzleAssignmentsPanel';

/*
 * Admin worklist — the coach's single view of what students have been given.
 *
 * The page is now just the puzzle-assignment system: assignments by set, each
 * expanding to a per-student tracker, plus a move-by-move review. The panel
 * owns its own search/filter toolbar, so this page only supplies the heading.
 */
export default function Worklist() {
  return (
    <PageHeader title="Worklist" icon="♟" subtitle="Puzzle assignments to students — by set, with per-student progress.">
      <PuzzleAssignmentsPanel />
    </PageHeader>
  );
}

