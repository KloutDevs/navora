// ANSI 256-color purple palette — gradient from dark (p1) to pale (p6)
export const c = {
  reset: '\x1b[0m',
  p1: '\x1b[38;5;57m',   // deep indigo-purple
  p2: '\x1b[38;5;93m',   // medium-dark purple
  p3: '\x1b[38;5;129m',  // medium purple
  p4: '\x1b[38;5;135m',  // medium-light purple
  p5: '\x1b[38;5;141m',  // light purple
  p6: '\x1b[38;5;147m',  // pale lavender
  ok:  '\x1b[38;5;141m', // ✓  light purple
  err: '\x1b[38;5;196m', // ✗  red
  dim: '\x1b[38;5;242m', // secondary text
} as const;
