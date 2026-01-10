/**
 * HAPTIC PATTERNS LIBRARY for ZenOne
 * Designed for "Organic" feel using Vibrate API arrays.
 * 
 * Invariants:
 * - Patterns must shorter than the breath phase they accompany
 * - Intensity flows must mimic biological curves (sigmoid/sine)
 */

export const HapticPatterns = {
    // Mimics a resting heart rate (~60-70 BPM). "Lub-dub... Lub-dub..."
    // [Vibrate, Pause, Vibrate, Pause...]
    HEARTBEAT_CALM: [30, 200, 15],

    // Slightly faster/stronger for active states
    HEARTBEAT_ACTIVE: [45, 150, 25],

    // Gentle "swelling" wave for Inhale
    // Note: Standard Vibrate API is binary (on/off), so we simulate "swelling" 
    // by modulating pulse width and density.
    BREATH_IN_WAVE: [
        10, 50,  // Start light
        15, 45,  // ..
        20, 40,  // Building up
        30, 30,  // .
        40, 20,  // Peak density
        50       // Apex
    ],

    // "Receding" wave for Exhale
    BREATH_OUT_WAVE: [
        50, 20,  // Start strong at apex
        40, 30,
        30, 40,
        20, 45,
        15, 50,
        10       // Fade out
    ],

    // Sharp, crisp confirmation (for UI taps)
    UI_SUCCESS: [15],
    UI_WARN: [15, 50, 15],
    UI_ERROR: [15, 30, 15, 30, 50],

    // "Thinking" flutter for AI
    AI_THINKING: [5, 30, 5, 30, 5, 30, 5]
} as const;

export type HapticPatternName = keyof typeof HapticPatterns;
