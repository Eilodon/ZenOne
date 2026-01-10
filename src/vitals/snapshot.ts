import type { ReasonCode, SignalQuality } from './reasons';

export interface Metric<T> {
    value?: T;                // undefined = N/A (không bịa)
    confidence: number;       // 0..1
    quality: SignalQuality;
    reasons: ReasonCode[];
    windowSec: number;        // cửa sổ thực dùng
    updatedAtMs: number;
}

export interface QualityReport {
    facePresent: boolean;
    motion: number;           // 0..1
    brightnessMean: number;   // 0..255
    brightnessStd: number;
    saturationRatio: number;  // 0..1
    fpsEstimated: number;
    fpsJitterMs: number;
    bufferSpanSec: number;
    snr?: number;
}

export interface ZenVitalsSnapshot {
    quality: Metric<QualityReport>;

    hr: Metric<number>;       // bpm
    rr: Metric<number>;       // breaths/min
    hrv: Metric<{ rmssd: number; sdnn: number; stressIndex: number }>;

    affect: Metric<{ valence: number; arousal: number; moodLabel: string }>;
}
