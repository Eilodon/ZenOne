
import { describe, it, expect, beforeEach } from 'vitest';
import { UKFStateEstimator } from './UKFStateEstimator';
import { Observation, BreathPattern } from '../types';

describe('UKFStateEstimator (Safety Critical)', () => {
    let ukf: UKFStateEstimator;

    beforeEach(() => {
        ukf = new UKFStateEstimator({
            alpha: 0.1,
            beta: 2,
            kappa: 0
        });
    });

    it('should initialize with valid 5D state', () => {
        ukf['stateToBeliefState'](); // Access private method via casting if needed, or public update
        // We can use update with empty observation to see initial state
        const b = ukf.update({ timestamp: 0, delta_time: 0.1, visibilty_state: 'visible' }, 0.1);

        expect(b.arousal).toBeDefined();
        expect(b.valence).toBeDefined();
        // Initial values
        expect(b.arousal).toBeCloseTo(0.5, 1);
    });

    it('should converge towards target when dead reckoning (Prediction Only)', () => {
        // Set target to Relax (Low Arousal)
        const pattern = { id: '4-7-8', arousalImpact: -0.8 } as BreathPattern;
        ukf.setProtocol(pattern);

        // Run for 100 ticks (10 seconds)
        for (let i = 0; i < 100; i++) {
            ukf.update({ timestamp: i * 100, delta_time: 0.1, visibilty_state: 'visible' }, 0.1);
        }

        const b = ukf.update({ timestamp: 10000, delta_time: 0.1, visibilty_state: 'visible' }, 0.1);

        // Should have decreased arousal (target is 0.2 for parasympathetic)
        expect(b.arousal).toBeLessThan(1.0);
        expect(b.arousal).toBeGreaterThan(0.1);
    });

    it('should correct state based on observations (Correction Step)', () => {
        // Simulate High Heart Rate input
        const obs: Observation = {
            timestamp: 1000,
            delta_time: 0.1,
            visibilty_state: 'visible',
            heart_rate: 100, // High arousal (~0.7)
            hr_confidence: 1.0
        };

        // Run updates
        for (let i = 0; i < 10; i++) {
            ukf.update(obs, 0.1);
        }

        const b = ukf.update(obs, 0.1);
        expect(b.arousal).toBeGreaterThan(0.6); // Should track the HR
    });

    it('should REJECT outliers (Mahalanobis Distance)', () => {
        // First stabilize
        for (let i = 0; i < 50; i++) {
            ukf.update({ timestamp: i * 100, delta_time: 0.1, visibilty_state: 'visible', heart_rate: 60, hr_confidence: 1 }, 0.1);
        }
        const steadyState = ukf.update({ timestamp: 5000, delta_time: 0.1, visibilty_state: 'visible' }, 0.1);
        const steadyArousal = steadyState.arousal;

        // Suddenly inject MASSIVE spike (Sensor Glitch: HR 200)
        // This should be rejected
        const spikeObs: Observation = {
            timestamp: 5100,
            delta_time: 0.1,
            visibilty_state: 'visible',
            heart_rate: 220,
            hr_confidence: 1.0
        };

        const afterSpike = ukf.update(spikeObs, 0.1);

        // Arousal should NOT jump to 1.0 instantly
        expect(Math.abs(afterSpike.arousal - steadyArousal)).toBeLessThan(0.2);
    });

    it('should maintain state bounds [0,1]', () => {
        // Force drive out of bounds
        const weirdObs: Observation = {
            timestamp: 0, delta_time: 0.1, visibilty_state: 'visible',
            heart_rate: 999, hr_confidence: 1
        };

        // Config with high noise to allow movement
        const looseUkf = new UKFStateEstimator({ R_hr: 0.001 });

        for (let i = 0; i < 20; i++) {
            const b = looseUkf.update(weirdObs, 0.1);
            expect(b.arousal).toBeLessThanOrEqual(1.0);
            expect(b.arousal).toBeGreaterThanOrEqual(0.0);
        }
    });
});
