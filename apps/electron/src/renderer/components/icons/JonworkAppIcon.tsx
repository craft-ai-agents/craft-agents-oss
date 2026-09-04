interface JonworkAppIconProps {
  className?: string;
}

/** JonWork product mark from the committed enterprise brand set. */
export function JonworkAppIcon({ className }: JonworkAppIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="jonwork-app-icon" x1="4" y1="3" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A78BFA" />
          <stop offset="1" stopColor="#6D4BD1" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#jonwork-app-icon)" />
      <path d="M15.8 6.3v7.1c0 3.1-1.8 4.8-4.7 4.8-2 0-3.5-.8-4.4-2.3l2.2-1.5c.5.8 1.1 1.2 2 1.2 1.2 0 1.8-.7 1.8-2.2V9H9.6V6.3h6.2Z" fill="white" />
      <circle cx="18.6" cy="5.4" r="1.5" fill="#67E8F9" />
    </svg>
  );
}
