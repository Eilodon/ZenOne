import { describe, it, expect } from 'vitest';
import { computeQualityGate, QualityGateInput, DEFAULT_GATE_CONFIG } from './qualityGate';

describe('computeQualityGate', () => {
    const baseInput: QualityGateInput = {
        nowMs: 1000,
        facePresent: true,
        motion: 0,
        brightnessMean: 100,
        brightnessStd: 10,
        saturationRatio: 0,
        bufferSpanSec: 5,
        fpsEstimated: 30,
        fpsJitterMs: 2,
        snr: 5
    };

    it('should return excellent quality for perfect input', () => {
        const { metric, guidance } = computeQualityGate(baseInput, DEFAULT_GATE_CONFIG);
        expect(metric.quality).toBe('excellent');
        expect(metric.reasons).toHaveLength(0);
        expect(guidance).toHaveLength(0);
        expect(metric.confidence).toBe(1);
    });

    it('should return invalid if face is lost', () => {
        const input = { ...baseInput, facePresent: false };
        const { metric } = computeQualityGate(input, DEFAULT_GATE_CONFIG);
        expect(metric.quality).toBe('invalid');
        expect(metric.reasons).toContain('FACE_LOST');
        expect(metric.confidence).toBe(0);
    });

    it('should detect low light', () => {
        const input = { ...baseInput, brightnessMean: 10 };
        const { metric } = computeQualityGate(input, DEFAULT_GATE_CONFIG);
        expect(metric.reasons).toContain('LOW_LIGHT');
        expect(metric.quality).not.toBe('excellent');
    });

    it('should detect high motion', () => {
        const input = { ...baseInput, motion: 0.9 };
        const { metric } = computeQualityGate(input, DEFAULT_GATE_CONFIG);
        expect(metric.reasons).toContain('MOTION_HIGH');
    });

    it('should degrade quality with multiple issues', () => {
        const input = {
            ...baseInput,
            brightnessMean: 10,  // LOW_LIGHT
            motion: 0.9,         // MOTION_HIGH
            snr: 0.5             // SNR_LOW
        };
        const { metric } = computeQualityGate(input, DEFAULT_GATE_CONFIG);
        expect(metric.reasons).toHaveLength(3);
        expect(metric.quality).toBe('poor');
        expect(metric.confidence).toBeLessThan(0.3); // 1 - 0.75
    });

    it('should generate guidance for failures', () => {
        const input = { ...baseInput, brightnessMean: 10 };
        const { guidance } = computeQualityGate(input, DEFAULT_GATE_CONFIG);
        expect(guidance[0]).toMatch(/ánh sáng/);
    });
});
