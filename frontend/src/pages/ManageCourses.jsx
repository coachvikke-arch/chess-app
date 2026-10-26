/*
 * Admin "Courses" page — hosts the PGN/FEN Library (folder + board viewer).
 * The former document upload zone was removed; course studies now live here
 * as folders of PGN/FEN entries instead of loose files.
 */

import Library from './Library';

export default function ManageCourses() {
  return <Library />;
}