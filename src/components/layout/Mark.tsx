export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#E54D2C" />
      <circle cx="16" cy="13" r="5" fill="#fff" />
      <path d="M0 19h32" stroke="#E54D2C" strokeWidth="10" />
      <path d="M6 20.5h20" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
