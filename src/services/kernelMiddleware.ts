
import { KernelEvent } from '../types';
import { RuntimeState } from './PureZenBKernel';
import { playCue, setAiDucking } from './audio';
import { hapticPhase } from './haptics';
import { useSettingsStore } from '../stores/settingsStore';
import { createTempoController } from './PIDController';

export type Middleware = (
  event: KernelEvent,
  beforeState: RuntimeState,
  afterState: RuntimeState,
  api: { queue: (cmd: KernelEvent) => void }
) => void;

function phaseToCueType(phase: string): 'inhale' | 'exhale' | 'hold' {
  if (phase === 'holdIn' || phase === 'holdOut') return 'hold';
  return phase as 'inhale' | 'exhale';
}

/**
 * Middleware to handle audio cues on phase transitions
 */
export const audioMiddleware: Middleware = (event, before, after) => {
  if (event.type === 'PHASE_TRANSITION' && after.status === 'RUNNING') {
    const cueType = phaseToCueType(after.phase);
    const settings = useSettingsStore.getState().userSettings;
    
    playCue(
      cueType,
      settings.soundEnabled,
      settings.soundPack,
      after.phaseDuration,
      settings.language
    );
  }

  // --- AUDIO DUCKING (V6.1) ---
  if (event.type === 'AI_STATUS_CHANGE' || event.type === 'AI_VOICE_MESSAGE') {
     const isSpeaking = after.aiStatus === 'speaking';
     setAiDucking(isSpeaking);
  }
};

/**
 * Middleware to handle haptic feedback
 */
export const hapticMiddleware: Middleware = (event, before, after) => {
  if (event.type === 'PHASE_TRANSITION' && after.status === 'RUNNING') {
    const settings = useSettingsStore.getState().userSettings;
    const cueType = phaseToCueType(after.phase);
    
    hapticPhase(settings.hapticEnabled, settings.hapticStrength, cueType);
  }
};

/**
 * ACTIVE INFERENCE CONTROLLER (v6.7 - PID UPGRADE)
 * ==================================================
 * This closes the biological loop. It adjusts the 'tempoScale' (breathing speed)
 * based on the user's 'rhythm_alignment' (Free Energy proxy).
 *
 * UPGRADE: Replaced proportional-only control with full PID controller
 * - Proportional: Immediate response to misalignment
 * - Integral: Eliminates steady-state error
 * - Derivative: Dampens oscillations (prevents tempo thrashing)
 *
 * Stability: Proven via Lyapunov analysis (see UPGRADE_SPECS.md)
 */

// Create singleton PID controller (persists across middleware calls)
const tempoPID = createTempoController();

// Target alignment for optimal performance
const TARGET_ALIGNMENT = 0.7;

// Tracking state for derivative calculation
let lastUpdateTime = 0;

export const biofeedbackMiddleware: Middleware = (event, before, after, api) => {
    // Check periodically or on specific events to avoid thrashing
    if (event.type === 'BELIEF_UPDATE' && after.status === 'RUNNING' && after.sessionDuration > 10) {

        const now = Date.now();
        const dt = lastUpdateTime > 0 ? (now - lastUpdateTime) / 1000 : 0.1;
        lastUpdateTime = now;

        // Guard against invalid dt (pauses, background tabs, etc.)
        if (dt > 1.0 || dt <= 0) {
            return; // Skip this update
        }

        const alignment = after.belief.rhythm_alignment;
        const currentScale = after.tempoScale;

        // PID Control: Error = Target - Measurement
        const error = TARGET_ALIGNMENT - alignment;

        // Compute control signal (tempo adjustment delta)
        const controlSignal = tempoPID.compute(error, dt);

        // Apply control signal to current tempo
        let newScale = currentScale + controlSignal;

        // Enforce system constraints [0.8, 1.4]
        newScale = Math.max(0.8, Math.min(1.4, newScale));

        // Only queue if change is significant (deadband to prevent jitter)
        const DEADBAND = 0.005;
        if (Math.abs(newScale - currentScale) > DEADBAND) {
            // Diagnostics (for monitoring)
            const diag = tempoPID.getDiagnostics();
            const reason = `PID[P:${diag.P.toFixed(4)} I:${diag.I.toFixed(4)} D:${diag.D.toFixed(4)}]`;

            api.queue({
                type: 'ADJUST_TEMPO',
                scale: newScale,
                reason: reason,
                timestamp: now
            });
        }
    }

    // Reset PID state when session starts/stops (prevents carryover)
    if (event.type === 'START_SESSION') {
        tempoPID.reset();
        lastUpdateTime = 0;
    }

    if (event.type === 'HALT' || event.type === 'INTERRUPTION') {
        tempoPID.reset();
        lastUpdateTime = 0;
    }
};
