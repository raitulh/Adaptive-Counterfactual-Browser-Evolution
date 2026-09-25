/**
 * Motion tokens for Framer Motion. Mirrors the CSS variables in globals.css.
 * Durations are in seconds.
 */
export const duration = {
  micro: 0.12,
  standard: 0.22,
  emphasis: 0.45,
  cinematic: 0.7,
} as const;

export const ease = {
  /** Entrances and reveals. */
  outExpo: [0.16, 1, 0.3, 1] as const,
  /** Hover and state changes. */
  standard: [0.2, 0, 0, 1] as const,
  /** Exits. */
  exit: [0.4, 0, 1, 1] as const,
};

export const spring = {
  tactile: { type: "spring", stiffness: 420, damping: 32, mass: 0.8 } as const,
  gentle: { type: "spring", stiffness: 180, damping: 26 } as const,
};
