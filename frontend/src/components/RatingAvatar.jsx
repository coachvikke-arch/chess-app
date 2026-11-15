import { useState } from 'react';
import StudentAvatar from './StudentAvatar';
import { profileImageFromUser } from '../utils/profileImage';

/** Profile image takes precedence over the selected in-app chess avatar. */
export default function RatingAvatar({ row = {}, name = '', size = 32, className = '' }) {
  const image = profileImageFromUser(row) || '';
  const [failedImage, setFailedImage] = useState('');
  const shape = {
    width: size,
    height: size,
    flex: `0 0 ${size}px`,
    borderRadius: '50%',
  };

  if (image && failedImage !== image) {
    return (
      <img
        src={image}
        alt={`Profile picture of ${name || 'player'}`}
        onError={() => setFailedImage(image)}
        className={className}
        style={{ ...shape, objectFit: 'cover', objectPosition: 'center', display: 'block' }}
      />
    );
  }

  if (!image && row.avatar_config) {
    return (
      <StudentAvatar
        config={row.avatar_config}
        seed={`student_${row.student_id || row.user_id || ''}`}
        size={size}
        className={className}
        alt={`Avatar of ${name || 'player'}`}
      />
    );
  }

  return (
    <span
      className={className}
      style={{ ...shape, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}
    >
      <span
        aria-hidden="true"
        style={{ color: '#fff', fontFamily: '"DejaVu Sans", "Noto Sans Symbols 2", "Segoe UI Symbol", serif', fontSize: size * 0.62, lineHeight: 1 }}
      >
        {'\u265E\uFE0E'}
      </span>
    </span>
  );
}
