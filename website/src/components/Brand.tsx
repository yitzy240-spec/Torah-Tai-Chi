interface BrandProps {
  size?: number;
}

export default function Brand({ size = 32 }: BrandProps) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <defs>
        <radialGradient id="cedarWoodB" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#E3B888"/>
          <stop offset="45%" stopColor="#B8823A"/>
          <stop offset="100%" stopColor="#6A4622"/>
        </radialGradient>
        <radialGradient id="linenLobeB" cx="40%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#FAF4E8"/>
          <stop offset="100%" stopColor="#E9DDC1"/>
        </radialGradient>
        <radialGradient id="navyLobeB" cx="60%" cy="60%" r="80%">
          <stop offset="0%" stopColor="#2B3A5C"/>
          <stop offset="100%" stopColor="#131E38"/>
        </radialGradient>
        <path id="arcTopB" d="M 18,60 A 42,42 0 0,1 102,60"/>
      </defs>
      <circle cx="60" cy="60" r="42" fill="url(#cedarWoodB)" stroke="#3D2A14" strokeWidth=".8"/>
      <circle cx="60" cy="60" r="34" fill="none" stroke="#3D2A14" strokeWidth=".4" opacity=".5"/>
      <g transform="translate(60 60)">
        <circle r="28" fill="url(#linenLobeB)"/>
        <path d="M 0,-28 A 28,28 0 0,0 0,28 A 14,14 0 0,1 0,0 A 14,14 0 0,0 0,-28 Z" fill="url(#navyLobeB)"/>
        <circle cx="0" cy="-14" r="3.2" fill="#FAF4E8"/>
        <circle cx="0" cy="14" r="3.2" fill="#2B3A5C"/>
        <g transform="translate(0,-14) scale(.55)">
          <polygon points="0,-8 6.93,4 -6.93,4" fill="none" stroke="#9E7A3A" strokeWidth="1.2"/>
          <polygon points="0,8 6.93,-4 -6.93,-4" fill="none" stroke="#9E7A3A" strokeWidth="1.2"/>
        </g>
      </g>
      <text fontFamily="Fraunces,serif" fontSize="9" fontWeight="600" letterSpacing="3" fill="#3D2A14">
        <textPath href="#arcTopB" startOffset="50%" textAnchor="middle">TORAH</textPath>
      </text>
      <text x="60" y="108" fontFamily="Fraunces,serif" fontSize="8" fontWeight="600" letterSpacing="3" fill="#3D2A14" textAnchor="middle">TAI CHI</text>
    </svg>
  );
}
