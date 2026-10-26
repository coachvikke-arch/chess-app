// Background layer — a full-bleed circle behind the character.
// `color` can be a hex like "#FFD966" or a named gradient
// ("gradient-sunset" | "gradient-ocean") listed in the options registry.
const GRADIENTS = {
  'gradient-sunset': ['#ffd3a5', '#ff70a6'],
  'gradient-ocean': ['#a1c4fd', '#c2e9fb'],
  'gradient-mint': ['#d4fc79', '#96e6a1'],
  'gradient-royal': ['#fbc2eb', '#a18cd1'],
};

export default function Background({ color }) {
  const id = `bg-${(color || '').replace(/[^a-zA-Z0-9]/g, '')}`;
  const grad = GRADIENTS[color];
  const fill = grad ? `url(#${id})` : color || '#ffd966';

  return (
    <g>
      {grad && (
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={grad[0]} />
            <stop offset="100%" stopColor={grad[1]} />
          </linearGradient>
        </defs>
      )}
      <circle cx={100} cy={100} r={96} fill={fill} />
      <circle cx={100} cy={100} r={96} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={3} />
      <circle cx={100} cy={100} r={90} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={2} />
    </g>
  );
}