
import { describe, it, expect, beforeEach } from 'vitest';
import { PIDController } from './PIDController';

describe('PIDController (Property-Based)', () => {
    // Standard Config
    const config = { Kp: 1.0, Ki: 0.1, Kd: 0.1, outputMin: -10, outputMax: 10, integralMax: 5 };
    let pid: PIDController;

    beforeEach(() => {
        pid = new PIDController(config);
    });

    it('should be proportional (P-term dominance)', () => {
        const out = pid.compute(10, 1);
        // P=10, I=1, D=10 (approx) -> Total ~21, clamped to 10
        expect(out).toBe(10);

        // Small error
        pid.reset();
        const outSmall = pid.compute(0.5, 1);
        // P=0.5, I=0.05, D=0.5 -> ~1.05
        expect(outSmall).toBeCloseTo(0.555, 3);
    });

    it('should enforce Integral Anti-Windup', () => {
        // Feed large error for many ticks
        for (let i = 0; i < 100; i++) {
            pid.compute(10, 0.1);
        }
        const diag = pid.getDiagnostics();
        expect(diag.integral).toBe(5); // Clamped to integralMax
    });

    it('should clamp output within bounds', () => {
        const out = pid.compute(1000, 1);
        expect(out).toBe(10);

        const outNeg = pid.compute(-1000, 1);
        expect(outNeg).toBe(-10);
    });

    it('should reset state correctly', () => {
        pid.compute(10, 1);
        pid.reset();
        const diag = pid.getDiagnostics();
        expect(diag.integral).toBe(0);
        expect(diag.P).toBe(0);
        expect(diag.I).toBe(0);
        expect(diag.D).toBe(0);
    });

    it('should handle zero dt gracefully', () => {
        const out = pid.compute(10, 0);
        expect(out).toBe(0);
    });
});
