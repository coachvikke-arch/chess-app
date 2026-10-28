import StudentAvatar from './StudentAvatar';

/* One player picture: the uploaded photo when there is one, else the player's
   saved chess avatar, else ChessAvatar's deterministic default. Exactly one
   image renders — never a photo stacked behind an avatar. `seed` lets a caller
   with no real player (the engine, the unknown side of an analysis board) get a
   stable placeholder instead of a blank circle. */
export default function PlayerAvatar({ player, size = 40, seed }) {
  if (!player && !seed) return null;
  if (player?.profile_image) {
    return (
      <img
        src={player.profile_image}
        alt=""
        loading="lazy"
        className="online-pick-photo"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <StudentAvatar
      config={player?.avatar_config}
      seed={seed || `user_${player?.id || ''}`}
      size={size}
    />
  );
}
