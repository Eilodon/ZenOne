/**
 * SAFETY MONITOR & SHIELD - FORMAL VERIFICATION
 * ==============================================
 *
 * Implements runtime verification using simplified Linear Temporal Logic (LTL)
 * and a safety shield to prevent/correct unsafe kernel events.
 *
 * LTL Operators:
 * - G (Globally): Property must hold at all times
 * - F (Finally): Property must eventually hold
 * - X (Next): Property must hold in the next state
 * - U (Until): p U q means p holds until q becomes true
 *
 * References:
 * - Pnueli (1977): "The Temporal Logic of Programs"
 * - Bloem et al. (2015): "Synthesizing Reactive Systems from LTL"
 * - RTCA DO-178C: Software safety standard (avionics)
 */

import { KernelEvent } from '../types';
import { RuntimeState } from './PureZenBKernel';

// --- LTL FORMULA TYPES ---

export type LTLOperator = 'G' | 'F' | 'X' | 'U' | 'ATOMIC';

export interface LTLFormula {
  operator: LTLOperator;
  name: string;
  description: string;

  // For atomic propositions
  predicate?: (state: RuntimeState, event?: KernelEvent) => boolean;

  // For composite formulas
  subformula?: LTLFormula;
  left?: LTLFormula;  // For 'Until'
  right?: LTLFormula; // For 'Until'
}

// --- SAFETY PROPERTIES ---

export const SAFETY_SPECS: LTLFormula[] = [
  {
    operator: 'G',
    name: 'tempo_bounds',
    description: 'Tempo must always stay within [0.8, 1.4]',
    subformula: {
      operator: 'ATOMIC',
      name: 'tempo_in_bounds',
      description: 'Check tempo bounds',
      predicate: (state) => state.tempoScale >= 0.8 && state.tempoScale <= 1.4
    }
  },

  {
    operator: 'G',
    name: 'safety_lock_immutable',
    description: 'Once in SAFETY_LOCK, cannot start new session',
    subformula: {
      operator: 'ATOMIC',
      name: 'no_start_when_locked',
      description: 'Check safety lock',
      predicate: (state, event) => {
        if (state.status === 'SAFETY_LOCK' && event?.type === 'START_SESSION') {
          return false; // Violation
        }
        return true;
      }
    }
  },

  {
    operator: 'G',
    name: 'tempo_rate_limit',
    description: 'Tempo cannot change faster than 0.1/sec',
    subformula: {
      operator: 'ATOMIC',
      name: 'check_tempo_rate',
      description: 'Check tempo rate of change',
      predicate: (state, event) => {
        if (event?.type === 'ADJUST_TEMPO') {
          const dt = (event.timestamp - state.lastUpdateTimestamp) / 1000;
          if (dt > 0) {
            const delta = Math.abs(event.scale - state.tempoScale);
            const rate = delta / dt;
            return rate <= 0.1; // Max 0.1 per second
          }
        }
        return true;
      }
    }
  },

  {
    operator: 'G',
    name: 'panic_halt',
    description: 'High prediction error must trigger halt',
    subformula: {
      operator: 'ATOMIC',
      name: 'halt_on_panic',
      description: 'Check emergency halt',
      predicate: (state) => {
        // If prediction_error > 0.95 and session > 10s, status should be HALTED or SAFETY_LOCK
        if (
          state.belief.prediction_error > 0.95 &&
          state.sessionDuration > 10 &&
          state.status === 'RUNNING'
        ) {
          return false; // Should have halted by now
        }
        return true;
      }
    }
  }
];

// --- LIVENESS PROPERTIES (should eventually hold) ---

export const LIVENESS_SPECS: LTLFormula[] = [
  {
    operator: 'F',
    name: 'tempo_convergence',
    description: 'Tempo should eventually stabilize near 1.0',
    subformula: {
      operator: 'ATOMIC',
      name: 'tempo_near_normal',
      description: 'Tempo is close to 1.0',
      predicate: (state) => {
        // Only check if session is running for a while
        if (state.status === 'RUNNING' && state.sessionDuration > 60) {
          return Math.abs(state.tempoScale - 1.0) < 0.1;
        }
        return true; // Don't enforce early in session
      }
    }
  }
];

// --- VIOLATION RECORD ---

export interface SafetyViolation {
  timestamp: number;
  propertyName: string;
  description: string;
  severity: 'CRITICAL' | 'WARNING';
  state: RuntimeState;
  event?: KernelEvent;
}

// --- SAFETY MONITOR CLASS ---

export class SafetyMonitor {
  private violations: SafetyViolation[] = [];
  private readonly MAX_VIOLATIONS = 100;

  /**
   * Check if an event is safe to execute
   * @returns null if safe, or a corrected event if fixable
   */
  checkEvent(event: KernelEvent, currentState: RuntimeState): {
    safe: boolean;
    correctedEvent?: KernelEvent;
    violation?: SafetyViolation;
  } {
    // Evaluate all safety properties
    for (const spec of SAFETY_SPECS) {
      const satisfied = this.evaluate(spec, currentState, event);

      if (!satisfied) {
        // SAFETY VIOLATION DETECTED
        const violation: SafetyViolation = {
          timestamp: Date.now(),
          propertyName: spec.name,
          description: spec.description,
          severity: 'CRITICAL',
          state: currentState,
          event: event
        };

        this.recordViolation(violation);

        // Attempt to shield (correct) the event
        const corrected = this.shield(event, currentState, spec);

        if (corrected) {
          console.warn(`[SafetyMonitor] Corrected violation of "${spec.name}"`, corrected);
          return { safe: false, correctedEvent: corrected, violation };
        } else {
          // Cannot be corrected - must reject
          console.error(`[SafetyMonitor] CRITICAL: Cannot correct "${spec.name}". Rejecting event.`, event);
          return { safe: false, violation };
        }
      }
    }

    // Check liveness properties (warnings only)
    for (const spec of LIVENESS_SPECS) {
      const satisfied = this.evaluate(spec, currentState, event);
      if (!satisfied) {
        const violation: SafetyViolation = {
          timestamp: Date.now(),
          propertyName: spec.name,
          description: spec.description,
          severity: 'WARNING',
          state: currentState,
          event: event
        };
        this.recordViolation(violation);
        console.warn(`[SafetyMonitor] Liveness warning: "${spec.name}"`);
      }
    }

    return { safe: true };
  }

  /**
   * Evaluate an LTL formula
   */
  private evaluate(formula: LTLFormula, state: RuntimeState, event?: KernelEvent): boolean {
    switch (formula.operator) {
      case 'ATOMIC':
        return formula.predicate ? formula.predicate(state, event) : true;

      case 'G': // Globally (always)
        // For runtime verification, we check the current state
        // (Full LTL would require trace history, but we simplify here)
        return formula.subformula ? this.evaluate(formula.subformula, state, event) : true;

      case 'F': // Finally (eventually)
        // For liveness, we just check current state as a heuristic
        return formula.subformula ? this.evaluate(formula.subformula, state, event) : true;

      case 'X': // Next (not implemented in this simplified version)
        return true;

      case 'U': // Until (not implemented in this simplified version)
        return true;

      default:
        return true;
    }
  }

  /**
   * Safety Shield: Attempt to correct an unsafe event
   */
  private shield(
    unsafeEvent: KernelEvent,
    state: RuntimeState,
    violatedSpec: LTLFormula
  ): KernelEvent | null {
    // Shield logic based on event type
    if (unsafeEvent.type === 'ADJUST_TEMPO') {
      const scale = unsafeEvent.scale;

      // Clamp tempo to safe bounds [0.8, 1.4]
      const safeTempo = Math.max(0.8, Math.min(1.4, scale));

      // Check rate constraint
      const dt = (unsafeEvent.timestamp - state.lastUpdateTimestamp) / 1000;
      if (dt > 0) {
        const maxDelta = 0.1 * dt; // Max change per second
        const clampedTempo = Math.max(
          state.tempoScale - maxDelta,
          Math.min(state.tempoScale + maxDelta, safeTempo)
        );

        return {
          ...unsafeEvent,
          scale: clampedTempo,
          reason: `${unsafeEvent.reason} [SHIELDED: ${violatedSpec.name}]`
        };
      }

      return {
        ...unsafeEvent,
        scale: safeTempo,
        reason: `${unsafeEvent.reason} [SHIELDED]`
      };
    }

    if (unsafeEvent.type === 'START_SESSION') {
      // Cannot shield a START_SESSION if locked
      // Must reject entirely
      return null;
    }

    // Unknown event type - cannot shield
    return null;
  }

  /**
   * Record a violation for analysis
   */
  private recordViolation(violation: SafetyViolation): void {
    this.violations.push(violation);

    // Keep only recent violations
    if (this.violations.length > this.MAX_VIOLATIONS) {
      this.violations.shift();
    }
  }

  /**
   * Get violation history (for debugging/analysis)
   */
  getViolations(): SafetyViolation[] {
    return [...this.violations];
  }

  /**
   * Clear violation history
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Get statistics
   */
  getStats() {
    const critical = this.violations.filter(v => v.severity === 'CRITICAL').length;
    const warnings = this.violations.filter(v => v.severity === 'WARNING').length;

    return {
      totalViolations: this.violations.length,
      critical,
      warnings,
      recentViolations: this.violations.slice(-10)
    };
  }
}
