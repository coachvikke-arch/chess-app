export default function HaloAccessory() {
  return (
    <g transform="rotate(-8 100 100)">
      {/* floating halo above the head */}
      <ellipse
        cx={100}
        cy={20}
        rx={30}
        ry={10}
        fill="none"
        stroke="#f1c40f"
        strokeWidth={8}
      />
      <ellipse
        cx={100}
        cy={20}
        rx={30}
        ry={10}
        fill="none"
        stroke="#fff3b0"
        strokeWidth={2.5}
      />
      {/* tiny sparkles */}
      <path d="M150 40 l4 9 l9 4 l-9 4 l-4 9 l-4 -9 l-9 -4 l9 -4 Z" fill="#f1c40f" opacity={0.9} />
      <path d="M56 34 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z" fill="#93c5fd" opacity={0.9} />
    </g>
  );
}