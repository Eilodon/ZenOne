
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SafetyMonitor, SAFETY_SPECS } from './SafetyMonitor';
import { RuntimeState } from './PureZenBKernel';
import { KernelEvent, BeliefState } from '../types';

describe('SafetyMonitor (Formal Verification)', () => {
    let monitor: SafetyMonitor;
    let mockState: any;

    beforeEach(() => {
        monitor = new SafetyMonitor();
        mockState = {
            status: 'RUNNING',
            tempoScale: 1.0,
            lastUpdateTimestamp: 1000,
            sessionDuration: 20,
            belief: { prediction_error: 0.1 } as BeliefState,
            safetyRegistry: {}
        } as any;
    });

    it('should PASS safe tempo adjustments', () => {
        const event: KernelEvent = {
            type: 'ADJUST_TEMPO', scale: 1.05, reason: 'test', timestamp: 2000
        };
        const result = monitor.checkEvent(event, mockState);
        expect(result.safe).toBe(true);
    });

    it('should SHIELD (clamp) tempo outside bounds [0.8, 1.4]', () => {
        const event: KernelEvent = {
            type: 'ADJUST_TEMPO', scale: 1.8, reason: 'unsafe', timestamp: 2000
        };
        const result = monitor.checkEvent(event, mockState);

        expect(result.safe).toBe(false);
        expect(result.correctedEvent).toBeDefined();
        // Should be clamped to max 1.4 allowed by LTL
        if (result.correctedEvent && result.correctedEvent.type === 'ADJUST_TEMPO') {
            expect(result.correctedEvent.scale).toBeCloseTo(1.4, 1); // Clamp to max 1.4 (from LTL) or rate limit logic
            // Wait, the rate limit is 0.1/sec. Delta t = 1s. Max change = 0.1. 
            // Current 1.0. Max 1.1. So it should actually be clamped to 1.1!
            expect(result.correctedEvent.scale).toBeCloseTo(1.1, 1);
        }
    });

    it('should SHIELD (rate limit) rapid tempo changes', () => {
        const event: KernelEvent = {
            type: 'ADJUST_TEMPO', scale: 1.4, reason: 'too fast', timestamp: 2000
        };
        // dt = 1s. Max rate = 0.1/s. Current=1.0. Target=1.4.
        // Allowed = 1.0 + 0.1 = 1.1

        const result = monitor.checkEvent(event, mockState);
        expect(result.safe).toBe(false);
        if (result.correctedEvent && result.correctedEvent.type === 'ADJUST_TEMPO') {
            expect(result.correctedEvent.scale).toBeCloseTo(1.1, 2);
        }
    });

    it('should BLOCK session start if in SAFETY_LOCK', () => {
        monitor = new SafetyMonitor(); // Reset violations
        mockState.status = 'SAFETY_LOCK';
        const event: KernelEvent = { type: 'START_SESSION', timestamp: 2000 };

        const result = monitor.checkEvent(event, mockState);
        expect(result.safe).toBe(false);
        expect(result.correctedEvent).toBeUndefined(); // Cannot shield, must reject
    });

    it('should detect PANIC condition', () => {
        mockState.belief.prediction_error = 0.99; // Critical error
        mockState.sessionDuration = 30;

        // Event triggers check. Any event.
        const event: KernelEvent = { type: 'TICK', dt: 0.1, observation: {}, timestamp: 2000 } as any;
        const result = monitor.checkEvent(event, mockState);

        // The LTL says: G (prediction_error > 0.95 -> X status = HALTED)
        // Since we are RUNNING and error > 0.95, this is a violation of current state safety?
        // Actually, the spec "panic_halt" in SafetyMonitor checks:
        // if (error > 0.95 && duration > 10 && status === RUNNING) -> return false

        expect(result.safe).toBe(false);
        expect(result.violation?.propertyName).toBe('panic_halt');
    });
});
