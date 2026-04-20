interface BrandProps {
  size?: number;
}

/**
 * Brand mark — the photo-realistic carved-wood logo. Rendered as an <img>
 * tag pointing to /logo.png so every place that shows the brand matches
 * the favicon + social OG card (single source of truth).
 */
export default function Brand({ size = 32 }: BrandProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Torah Tai Chi"
      width={size}
      height={size}
      style={{ display: 'block', flexShrink: 0, width: size, height: size }}
    />
  );
}
