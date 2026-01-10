
import { HapticPatterns, HapticPatternName } from './haptics.patterns';

export type Strength = 'light' | 'medium' | 'heavy';

// Throttle configuration
const MIN_INTERVAL_MS = 80;
let lastVibeAt = 0;

/**
 * Safely triggers a haptic feedback event.
 * Now supports complex organic patterns.
 */
export function hapticTick(
  enabled: boolean,
  strengthOrPattern: Strength | HapticPatternName | number[]
): void {
  if (!enabled) return;
  if (typeof navigator === 'undefined') return;

  const now = performance.now();
  // Simple throttle to prevent hardware spamming, allowing bursts if they are part of a pattern
  if (now - lastVibeAt < MIN_INTERVAL_MS && !Array.isArray(strengthOrPattern)) {
    return;
  }
  lastVibeAt = now;

  const hasHardware = 'vibrate' in navigator;

  // --- 1. RESOLVE PATTERN ---
  let pattern: number | number[] = 0;

  if (Array.isArray(strengthOrPattern)) {
    pattern = strengthOrPattern;
  } else if (typeof strengthOrPattern === 'string') {
    if (strengthOrPattern in HapticPatterns) {
      // It's a named pattern
      pattern = [...HapticPatterns[strengthOrPattern as HapticPatternName]];
    } else {
      // It's a simple strength
      switch (strengthOrPattern as Strength) {
        case 'light': pattern = 10; break;
        case 'medium': pattern = 20; break;
        case 'heavy': pattern = 35; break;
        default: pattern = 15;
      }
    }
  }

  // --- 2. EXECUTE OR COMPENSATE ---
  if (hasHardware) {
    try {
      // Navigator.vibrate returns boolean (true if successful)
      const success = navigator.vibrate(pattern);
      if (!success) dispatchVisualCompensation(pattern);
    } catch (e) {
      // In case of any weird browser errors, fallback
      dispatchVisualCompensation(pattern);
    }
  } else {
    dispatchVisualCompensation(pattern);
  }
}

export function hapticPhase(
  enabled: boolean,
  _strength: Strength, // preserved for API compatibility
  kind: 'inhale' | 'exhale' | 'hold'
): void {
  if (!enabled) return;

  if (kind === 'inhale') {
    hapticTick(enabled, 'BREATH_IN_WAVE');
  } else if (kind === 'exhale') {
    hapticTick(enabled, 'BREATH_OUT_WAVE');
  } else if (kind === 'hold') {
    // Just a subtle heartbeat during hold
    hapticTick(enabled, 'HEARTBEAT_CALM');
  }
}

/**
 * Dispatches a custom event that UI components can listen to
 * for visual feedback (e.g., screen flash or element pulse)
 * when haptics are unavailable or disabled.
 */
function dispatchVisualCompensation(pattern: number | number[]) {
  // Calculate total duration roughly
  const duration = Array.isArray(pattern)
    ? pattern.reduce((acc, v) => acc + v, 0)
    : pattern;

  const event = new CustomEvent('zen:sensory:fallback', {
    detail: { duration, intensity: 0.5 }
  });
  window.dispatchEvent(event);
}

