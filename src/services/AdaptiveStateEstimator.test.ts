
import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveStateEstimator } from './AdaptiveStateEstimator';
import { BREATHING_PATTERNS } from '../types';

describe('AdaptiveStateEstimator (Active Inference Core)', () => {
  let estimator: AdaptiveStateEstimator;

  beforeEach(() => {
    estimator = new AdaptiveStateEstimator({
        alpha: 0.1, // Fast learning for tests
        adaptive_r: true
    });
  });

  it('should initialize with high uncertainty', () => {
    // We simulate a "Tick" with empty observation to see initial state
    const state = estimator.update({ timestamp: 0, delta_time: 0, visibilty_state: 'visible' }, 0.1);
    expect(state.confidence).toBeLessThan(0.1);
    expect(state.arousal_variance).toBeGreaterThan(0.1);
  });

  it('should converge Arousal when Heart Rate is observed consistently', () => {
    estimator.setProtocol(BREATHING_PATTERNS['coherence']); // Target Arousal ~0.4

    // Feed reliable HR data (High Confidence)
    // HR 60 -> Normalized Arousal ~ 0.14
    for (let i = 0; i < 20; i++) {
        estimator.update({ 
            timestamp: i * 100, 
            delta_time: 0.1, 
            visibilty_state: 'visible',
            heart_rate: 60,
            hr_confidence: 0.95 
        }, 0.1);
    }

    const state = estimator.update({ timestamp: 2000, delta_time: 0.1, visibilty_state: 'visible' }, 0.1);
    
    // Should have learned the low arousal
    expect(state.arousal).toBeLessThan(0.3);
    // Uncertainty should drop
    expect(state.arousal_variance).toBeLessThan(0.1);
    // Confidence should rise
    expect(state.confidence).toBeGreaterThan(0.5);
  });

  it('should NOT update belief strongly if sensor confidence is low', () => {
    // Initial state
    const s1 = estimator.update({ timestamp: 0, delta_time: 0.1, visibilty_state: 'visible' }, 0.1);
    const initialArousal = s1.arousal;

    // Feed noisy/bad data
    estimator.update({ 
        timestamp: 100, 
        delta_time: 0.1, 
        visibilty_state: 'visible',
        heart_rate: 180, // Panic level!
        hr_confidence: 0.1 // But sensor is unsure
    }, 0.1);

    const s2 = estimator.update({ timestamp: 200, delta_time: 0.1, visibilty_state: 'visible' }, 0.1);

    // Should resist the outlier due to low confidence and Kalman Gain
    expect(Math.abs(s2.arousal - initialArousal)).toBeLessThan(0.1);
  });

  it('should detect Distraction (Attention decay)', () => {
    // User pauses or tabs away
    for (let i = 0; i < 10; i++) {
        estimator.update({ 
            timestamp: i*100, 
            delta_time: 0.1, 
            visibilty_state: 'hidden' // User backgrounded app
        }, 0.1);
    }
    
    const state = estimator.update({ timestamp: 1000, delta_time: 0.1, visibilty_state: 'visible' }, 0.1);
    expect(state.attention).toBeLessThan(0.5); // Attention should have decayed
  });

  it('should compute Prediction Error (Free Energy)', () => {
     estimator.setProtocol(BREATHING_PATTERNS['4-7-8']); // Target: Low Arousal
     
     // Observation: High Stress
     const state = estimator.update({ 
         timestamp: 0, 
         delta_time: 0.1, 
         visibilty_state: 'visible',
         heart_rate: 100, // High arousal
         hr_confidence: 1.0
     }, 0.1);

     // High mismatch between Target (Relax) and Observation (Stress) -> High Free Energy
     expect(state.prediction_error).toBeGreaterThan(0.3);
  });
});
