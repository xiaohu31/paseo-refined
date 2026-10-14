export type CompatibilityWarning = (message: string, error: unknown) => void;

function warn(message: string, error: unknown) {
  console.warn(message, error);
}

/**
 * Keep one unavailable host contribution from preventing the rest of the plugin
 * from loading. This is especially important across pre-1.0 Paseo releases,
 * where a contribution can be renamed or temporarily unavailable.
 */
export function tryContribute<T>(
  label: string,
  contribute: () => T,
  onWarning: CompatibilityWarning = warn,
): T | null {
  try {
    return contribute();
  } catch (error) {
    onWarning(
      `[paseo-refined] ${label} is unavailable on this Paseo runtime; continuing without it.`,
      error,
    );
    return null;
  }
}
