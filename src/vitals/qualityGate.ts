import { reasonsToGuidanceVi } from './guidance';
import type { Metric, QualityReport } from './snapshot';
import type { ReasonCode, SignalQuality } from './reasons';

export interface QualityGateInput {
    nowMs: number;

    facePresent: boolean;
    motion: number;                // 0..1

    // ROI stats (tính từ 32x32 ROI, rẻ)
    brightnessMean: number;        // 0..255
    brightnessStd: number;
    saturationRatio: number;       // 0..1

    // Timing
    bufferSpanSec: number;
    fpsEstimated: number;
    fpsJitterMs: number;

    // Signal (nếu có)
    snr?: number;                  // linear or dB, chuẩn hóa trong gate
}

export interface QualityGateConfig {
    minBrightness: number;         // default 45
    maxSaturationRatio: number;    // default 0.08
    maxMotion: number;             // default 0.45
    minFps: number;                // default 20
    maxFpsJitterMs: number;        // default 12
    minSnrLinear: number;          // default 1.5 (tùy cách tính)
}

export const DEFAULT_GATE_CONFIG: QualityGateConfig = {
    minBrightness: 45,
    maxSaturationRatio: 0.15, // Relaxed slightly from 0.08
    maxMotion: 0.45,
    minFps: 15,               // Tolerant low light
    maxFpsJitterMs: 15,
    minSnrLinear: 1.2
};

export function computeQualityGate(
    input: QualityGateInput,
    cfg: QualityGateConfig = DEFAULT_GATE_CONFIG
): { metric: Metric<QualityReport>; guidance: string[] } {
    const reasons: ReasonCode[] = [];

    if (!input.facePresent) reasons.push('FACE_LOST');
    if (input.brightnessMean < cfg.minBrightness) reasons.push('LOW_LIGHT');
    if (input.saturationRatio > cfg.maxSaturationRatio) reasons.push('SATURATION');
    if (input.motion > cfg.maxMotion) reasons.push('MOTION_HIGH');
    // Allow initial period or single frame glitches, but check average
    if (input.fpsEstimated > 0 && input.fpsEstimated < cfg.minFps) reasons.push('FPS_UNSTABLE');
    if (input.fpsJitterMs > cfg.maxFpsJitterMs) reasons.push('FPS_UNSTABLE');

    if (input.snr !== undefined && input.snr < cfg.minSnrLinear) reasons.push('SNR_LOW');

    // Quality mapping: “invalid” nếu face lost hoặc fps cực tệ
    let quality: SignalQuality = 'excellent';

    if (reasons.includes('FACE_LOST')) {
        quality = 'invalid';
    } else {
        const count = reasons.length;
        if (count >= 3) quality = 'poor';
        else if (count === 2) quality = 'fair';
        else if (count === 1) quality = 'good';
        else quality = 'excellent';
    }

    // Confidence = 1 - penalty (đơn giản v1, tuning v2)
    const confidence = quality === 'invalid' ? 0 : Math.max(0, 1 - reasons.length * 0.25);

    const report: QualityReport = {
        facePresent: input.facePresent,
        motion: input.motion,
        brightnessMean: input.brightnessMean,
        brightnessStd: input.brightnessStd,
        saturationRatio: input.saturationRatio,
        fpsEstimated: input.fpsEstimated,
        fpsJitterMs: input.fpsJitterMs,
        bufferSpanSec: input.bufferSpanSec,
        snr: input.snr,
    };

    const metric: Metric<QualityReport> = {
        value: report,
        confidence,
        quality,
        reasons,
        windowSec: input.bufferSpanSec,
        updatedAtMs: input.nowMs,
    };

    return { metric, guidance: reasonsToGuidanceVi(reasons) };
}
