interface BrandMarkProps {
  className?: string
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 12.5h3.6l2.1-6.4 4.1 12 2.4-7.2 1.6 3.3h5.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="21.2" cy="12.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}
