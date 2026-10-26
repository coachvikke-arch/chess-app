import { useParams } from 'react-router-dom';
import GameReplay from '../components/GameReplay';
import { Page } from '../components/ui';

export default function GmGamePage() {
  const { gameId } = useParams();
  return <Page title="GM Game Replay" piece="♞" sub="Study the complete score one decision at a time."><GameReplay gameId={gameId || ''} /></Page>;
}
