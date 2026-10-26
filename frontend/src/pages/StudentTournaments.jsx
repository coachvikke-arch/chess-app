import TournamentList from '../features/tournaments/TournamentList';

/* Student tournaments hub  ->  /student/tournaments */
export default function StudentTournaments() {
  return <TournamentList admin={false} />;
}
