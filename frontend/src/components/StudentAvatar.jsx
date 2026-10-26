import ChessAvatar from './ChessAvatar';

/**
 * StudentAvatar — compatibility wrapper around <ChessAvatar/> so every
 * existing call site keeps working. Renders the layered chess-piece avatar.
 */
export default function StudentAvatar({ config, seed, size = 64, className = '', rounded = true }) {
  return (
    <ChessAvatar config={config} seed={seed} size={size} className={className} rounded={rounded} />
  );
}