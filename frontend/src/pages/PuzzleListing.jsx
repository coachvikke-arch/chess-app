import PuzzleListing from '../components/PuzzleListing';

/* The catalogue now lives in components/PuzzleListing so the Admin Homework
   "Assign puzzles" card can render the exact same list. This route is the
   library itself: URL-driven browsing, set management and the shared selection
   store (all of which are the component's defaults). */
export default function PuzzleListingPage() {
  return <PuzzleListing />;
}
