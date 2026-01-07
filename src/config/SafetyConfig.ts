
export const SafetyConfig = {
  clocks: {
    controlHz: 10,
    maxFrameDtSec: 0.1,
    maxControlStepsPerFrame: 3,
  },
  vitals: {
    hrHardMin: 30,
    hrHardMax: 220,
    hrSoftMin: 40,
    hrSoftMax: 200,
  },
  tempo: {
    min: 0.8, // HARD LIMIT: Never speed up more than 20%
    max: 1.4, // HARD LIMIT: Never slow down more than 40%
    upStep: 0.002,
    downStep: 0.001,
    lowAlign: 0.35,
    highAlign: 0.8,
    deadband: 0.01,
  },
  watchdog: {
    // Resonance Check: How long (ms) can we tolerate high error while under AI control?
    maxDivergenceTimeMs: 30000, 
    divergenceThreshold: 0.6, // Prediction Error > 0.6 is considered "Diverging"
  },
  safety: {
    minSessionSecBeforeEmergency: 10,
  },
  persistence: {
    retentionMs: 7 * 24 * 60 * 60 * 1000,
  }
} as const;

export type SafetyConfigType = typeof SafetyConfig;
