/**
 * Calm, decorative illustration built only from design-token colours: layered glass panes
 * around a soft shield, with an orbit where the workspace's content will gather. It carries
 * no data and is hidden from assistive technology.
 */
export function WorkspaceIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 220" fill="none" aria-hidden className={className}>
      <defs>
        <radialGradient id="ws-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--isms-accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--isms-accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ws-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--isms-accent)" stopOpacity="0.72" />
          <stop offset="100%" stopColor="var(--isms-accent)" />
        </linearGradient>
      </defs>

      <circle cx="140" cy="110" r="108" fill="url(#ws-glow)" />
      <ellipse
        cx="140"
        cy="112"
        rx="118"
        ry="44"
        stroke="var(--isms-accent)"
        strokeOpacity="0.28"
        strokeDasharray="2 7"
        strokeLinecap="round"
        strokeWidth="1.5"
      />

      {/* Back panes */}
      <rect
        x="58"
        y="56"
        width="112"
        height="96"
        rx="18"
        transform="rotate(-9 114 104)"
        fill="var(--isms-surface)"
        stroke="var(--isms-control-border)"
        strokeOpacity="0.28"
      />
      <rect
        x="112"
        y="60"
        width="112"
        height="96"
        rx="18"
        transform="rotate(8 168 108)"
        fill="var(--isms-surface)"
        stroke="var(--isms-control-border)"
        strokeOpacity="0.28"
      />
      {/* Quiet content lines on the back panes (shapes only, no data) */}
      <g stroke="var(--isms-text-muted)" strokeOpacity="0.22" strokeWidth="6" strokeLinecap="round">
        <path d="M76 84h40" transform="rotate(-9 114 104)" />
        <path d="M76 100h56" transform="rotate(-9 114 104)" />
        <path d="M168 88h40" transform="rotate(8 168 108)" />
        <path d="M168 104h28" transform="rotate(8 168 108)" />
      </g>

      {/* Front pane with the shield */}
      <rect
        x="86"
        y="50"
        width="108"
        height="120"
        rx="22"
        fill="var(--isms-bg)"
        stroke="var(--isms-surface-border)"
      />
      <rect x="86" y="50" width="108" height="120" rx="22" fill="var(--isms-surface)" />
      <rect x="112" y="72" width="56" height="56" rx="16" fill="url(#ws-tile)" />
      <path
        d="M140 82 126 87.5v10c0 8.4 5.8 15.9 14 19.5 8.2-3.6 14-11.1 14-19.5v-10L140 82Z"
        fill="var(--isms-accent-text)"
        fillOpacity="0.18"
        stroke="var(--isms-accent-text)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="140" cy="99" r="4" fill="var(--isms-accent-text)" />
      <rect x="108" y="142" width="64" height="7" rx="3.5" fill="var(--isms-accent-soft)" />

      {/* Points on the orbit, in the status palette's soft tones */}
      <circle
        cx="26"
        cy="116"
        r="7"
        fill="var(--isms-info-soft)"
        stroke="var(--isms-info)"
        strokeOpacity="0.5"
      />
      <circle
        cx="250"
        cy="96"
        r="8"
        fill="var(--isms-ok-soft)"
        stroke="var(--isms-ok)"
        strokeOpacity="0.5"
      />
      <circle
        cx="196"
        cy="150"
        r="5"
        fill="var(--isms-attention-soft)"
        stroke="var(--isms-attention)"
        strokeOpacity="0.5"
      />
    </svg>
  );
}
