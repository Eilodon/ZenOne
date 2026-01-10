import * as tf from '@tensorflow/tfjs';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import type { Keypoint } from '@tensorflow-models/face-landmarks-detection';
import type { ProcessingRequest, ProcessingResponse, ErrorResponse } from './fft.worker';
import { AffectiveState } from '../types';
import { PhysFormerRPPG } from './ml/PhysFormerRPPG';
import { EmoNetAffectRecognizer } from './ml/EmoNetAffectRecognizer';

// VITALS DOMAIN
import { ZenVitalsSnapshot, Metric, QualityReport } from '../vitals/snapshot';
import { TimeWindowBuffer } from '../vitals/ringBuffer';
import { computeQualityGate, DEFAULT_GATE_CONFIG } from '../vitals/qualityGate';
import { ReasonCode } from '../vitals/reasons';

/**
 * ZENB BIO-SIGNAL PIPELINE v7.0 (Quality Gated)
 * =============================================
 * Upgrades:
 * - Quality Gate Invariants (Safety Plane).
 * - Time-based buffers (Heart Rate: 12s, Respiration: 40s, HRV: 120s).
 * - Robust FPS estimation & Jitter detection.
 * - Formal guidance system for UX.
 */

interface ROI {
    x: number; y: number; width: number; height: number;
}

interface FrameStats {
    timestamp: number;
    brightness: number; // 0..255
    saturation: number; // 0..1 ratio
}

export class CameraVitalsEngine {
    private detector: faceLandmarksDetection.FaceLandmarksDetector | null = null;
    private canvas: OffscreenCanvas;
    private ctx: OffscreenCanvasRenderingContext2D;

    // ML Engines (Hybrid Architecture)
    private physFormer: PhysFormerRPPG;
    private emoNet: EmoNetAffectRecognizer;

    // Data Buffers (Time-Windowed)
    private rgbBufHR = new TimeWindowBuffer<{ r: number; g: number; b: number }>(12); // Min 12s for HR
    private rgbBufRR = new TimeWindowBuffer<{ r: number; g: number; b: number }>(40); // Min 40s for RR
    private rgbBufHRV = new TimeWindowBuffer<{ r: number; g: number; b: number }>(120); // Min 60s, rec 120s for HRV

    private frameStatsBuf = new TimeWindowBuffer<FrameStats>(12); // For motion/brightness stability

    // FPS Estimation
    private frameTimeBuf = new TimeWindowBuffer<number>(12);

    private worker: Worker | null = null;
    private isProcessing = false;

    // Affective State Tracking
    private valenceSmoother = 0;
    private arousalSmoother = 0;

    // --- SIMULATION MODE ---
    private isSimulated = false;
    private simGenerator: (() => ZenVitalsSnapshot) | null = null;

    constructor() {
        this.canvas = new OffscreenCanvas(32, 32);
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
        this.physFormer = new PhysFormerRPPG();
        this.emoNet = new EmoNetAffectRecognizer();
    }

    // --- HOLODECK HOOKS ---
    public setSimulationMode(enabled: boolean, generator?: () => ZenVitalsSnapshot) {
        this.isSimulated = enabled;
        this.simGenerator = generator || null;
        console.log(`[CameraEngine] Simulation Mode: ${enabled}`);
    }

    async init(): Promise<void> {
        try {
            if (!this.isSimulated) {
                await tf.ready();
                await tf.setBackend('webgl');

                this.detector = await faceLandmarksDetection.createDetector(
                    faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
                    {
                        runtime: 'tfjs',
                        maxFaces: 1,
                        refineLandmarks: true
                    }
                );

                this.worker = new Worker(new URL('./fft.worker.ts', import.meta.url), { type: 'module' });

                // Initialize ML Engines (Async load)
                this.physFormer.loadModel().catch(e => console.warn('[ZenB] PhysFormer load failed', e));
                this.emoNet.loadModel().catch(e => console.warn('[ZenB] EmoNet load failed', e));
            }
            console.log('[ZenB] Affective Engine v7.0 initialized');
        } catch (error) {
            console.error('[ZenB] Engine init failed', error);
            throw error;
        }
    }

    async processFrame(video: HTMLVideoElement): Promise<ZenVitalsSnapshot> {
        // 0. HOLODECK BYPASS
        if (this.isSimulated && this.simGenerator) {
            return this.simGenerator();
        }

        const nowMs = performance.now();
        this.frameTimeBuf.push(nowMs, 0); // Value unused, just tracking timestamps

        if (!this.detector || !this.worker) return this.createInvalidSnapshot(nowMs, ['PROCESSING_OVERLOAD']);

        // Estimate FPS & Jitter
        const { fps, jitter } = this.estimateFpsAnalysis(nowMs);

        const faces = await this.detector.estimateFaces(video, { flipHorizontal: false });

        if (faces.length === 0) {
            this.clearBuffers(); // Lost face -> clear history to avoid splicing bad data
            return this.createInvalidSnapshot(nowMs, ['FACE_LOST']);
        }

        const face = faces[0];
        const keypoints = face.keypoints;

        // 1. EXTRACT MULTI-ROI RGB & Stats
        const forehead = this.extractROIColor(video, this.getForeheadROI(keypoints, video.videoWidth, video.videoHeight));
        const leftCheek = this.extractROIColor(video, this.getCheekROI(keypoints, video.videoWidth, video.videoHeight, true));
        const rightCheek = this.extractROIColor(video, this.getCheekROI(keypoints, video.videoWidth, video.videoHeight, false));

        // Average color (Fusion)
        const fusedColor = {
            r: (forehead.rgb.r + leftCheek.rgb.r + rightCheek.rgb.r) / 3,
            g: (forehead.rgb.g + leftCheek.rgb.g + rightCheek.rgb.g) / 3,
            b: (forehead.rgb.b + leftCheek.rgb.b + rightCheek.rgb.b) / 3,
        };

        // Aggregate Stats
        const brightnessMean = (forehead.stats.brightness + leftCheek.stats.brightness + rightCheek.stats.brightness) / 3;
        const brightnessStd = (forehead.stats.std + leftCheek.stats.std + rightCheek.stats.std) / 3;
        const saturationRatio = Math.max(forehead.stats.saturation, leftCheek.stats.saturation, rightCheek.stats.saturation);

        // Push to TimeBuffers
        this.rgbBufHR.push(nowMs, fusedColor);
        this.rgbBufRR.push(nowMs, fusedColor);
        this.rgbBufHRV.push(nowMs, fusedColor);

        this.frameStatsBuf.push(nowMs, { timestamp: nowMs, brightness: brightnessMean, saturation: saturationRatio });

        // 2. DETECT MOTION (Head Pose stability)
        const motion = this.calculateMotion(keypoints);

        // 3. QUALITY GATE
        const bufferSpan = this.rgbBufHR.spanSec(); // Use HR buffer span as primary "uptime"

        const gateInput = {
            nowMs,
            facePresent: true,
            motion,
            brightnessMean,
            brightnessStd,
            saturationRatio,
            bufferSpanSec: bufferSpan,
            fpsEstimated: fps,
            fpsJitterMs: jitter,
            snr: this.lastWorkerResult?.snr // Use last known SNR
        };

        const { metric: qualityMetric } = computeQualityGate(gateInput, DEFAULT_GATE_CONFIG);

        // If quality is invalid, stop processing and return early
        if (qualityMetric.quality === 'invalid') {
            // We can return the snapshot here with invalid quality
            return {
                quality: qualityMetric,
                hr: this.createMetric<number>(undefined, qualityMetric),
                rr: this.createMetric<number>(undefined, qualityMetric),
                hrv: this.createMetric<{ rmssd: number; sdnn: number; stressIndex: number }>(undefined, qualityMetric),
                affect: this.createMetric<{ valence: number; arousal: number; moodLabel: string }>(undefined, qualityMetric),
            };
        }

        // 4. GEOMETRIC AFFECT (Valence)
        const valence = this.calculateGeometricValence(keypoints);
        this.valenceSmoother = this.valenceSmoother * 0.9 + valence * 0.1;

        // 5. ASYNC WORKER PROCESSING
        if (this.rgbBufHR.size() > 64 && !this.isProcessing) {
            const samples = this.rgbBufHR.samples().map(s => ({ ...s.v, timestamp: s.tMs }));
            this.triggerWorker(samples, motion, 30);
        }

        // 6. COMPOSE SNAPSHOT

        // HR Check
        let hrValue: number | undefined = this.lastWorkerResult?.heartRate;
        const hrSpan = this.rgbBufHR.spanSec();
        const hrReasons = [...qualityMetric.reasons];
        if (hrSpan < 12) {
            hrValue = undefined;
            hrReasons.push('INSUFFICIENT_WINDOW');
        }

        // RR Check
        // Not implemented (placeholder logic removed)

        // HRV Check
        // Not implemented

        // ML Refinement (PhysFormer)
        // Only run if quality is at least 'fair'
        if (['excellent', 'good', 'fair'].includes(qualityMetric.quality)) {
            // const mlVitals = this.physFormer.processFrame(...)
        }

        // Affect Construction
        // ML EmoNet
        let finalValence = this.valenceSmoother;
        let finalArousal = this.arousalSmoother;

        if (qualityMetric.quality !== 'poor') {
            const mlAffect = this.emoNet.predict(keypoints);
            if (mlAffect) {
                finalValence = finalValence * 0.7 + mlAffect.valence * 0.3;
                finalArousal = (finalArousal + mlAffect.arousal) / 2;
            }
        }

        const affectValue = {
            valence: finalValence,
            arousal: finalArousal,
            moodLabel: this.classifyMood(finalValence, finalArousal)
        };

        return {
            quality: qualityMetric,
            hr: {
                value: hrValue,
                confidence: qualityMetric.confidence * (this.lastWorkerResult?.confidence || 0),
                quality: qualityMetric.quality,
                reasons: hrReasons,
                windowSec: hrSpan,
                updatedAtMs: nowMs
            },
            rr: this.createMetric<number>(undefined, qualityMetric), // Not ready
            hrv: this.createMetric<{ rmssd: number; sdnn: number; stressIndex: number }>(undefined, qualityMetric), // Not ready
            affect: {
                value: affectValue,
                confidence: qualityMetric.confidence, // degrade with bad light/motion
                quality: qualityMetric.quality,
                reasons: qualityMetric.reasons,
                windowSec: 0, // Instantaneous
                updatedAtMs: nowMs
            }
        };
    }

    // --- WORKER INTEGRATION ---

    private lastWorkerResult: { heartRate: number; respirationRate: number; hrv: any; confidence: number; snr: number } | null = null;

    private async triggerWorker(rgbData: any[], motion: number, sampleRate: number): Promise<void> {
        if (!this.worker) return;
        this.isProcessing = true;

        const req: ProcessingRequest = {
            type: 'process_signal',
            rgbData,
            motionScore: motion,
            sampleRate
        };

        this.worker.postMessage(req);

        const handler = (e: MessageEvent<ProcessingResponse | ErrorResponse>) => {
            this.worker?.removeEventListener('message', handler);
            this.isProcessing = false;
            if (e.data.type === 'vitals_result') {
                this.lastWorkerResult = e.data;
            }
        };
        this.worker.addEventListener('message', handler);
    }

    // --- HELPER METHODS ---

    private createMetric<T>(value: T | undefined, baseQuality: Metric<QualityReport>): Metric<T> {
        return {
            value,
            confidence: value === undefined ? 0 : baseQuality.confidence,
            quality: baseQuality.quality,
            reasons: value === undefined && baseQuality.quality !== 'invalid'
                ? [...baseQuality.reasons, 'INSUFFICIENT_WINDOW']
                : baseQuality.reasons,
            windowSec: baseQuality.windowSec,
            updatedAtMs: baseQuality.updatedAtMs
        };
    }

    private createInvalidSnapshot(nowMs: number, reasons: ReasonCode[]): ZenVitalsSnapshot {
        const quality: Metric<QualityReport> = {
            value: undefined,
            confidence: 0,
            quality: 'invalid',
            reasons,
            windowSec: 0,
            updatedAtMs: nowMs
        };
        return {
            quality,
            hr: this.createMetric<number>(undefined, quality),
            rr: this.createMetric<number>(undefined, quality),
            hrv: this.createMetric<{ rmssd: number; sdnn: number; stressIndex: number }>(undefined, quality),
            affect: this.createMetric<{ valence: number; arousal: number; moodLabel: string }>(undefined, quality)
        };
    }

    private clearBuffers() {
        this.rgbBufHR.clear();
        this.rgbBufRR.clear();
        this.rgbBufHRV.clear();
        this.frameStatsBuf.clear();
    }

    private estimateFpsAnalysis(_nowMs: number) {
        const times = this.frameTimeBuf.samples().map(s => s.tMs);
        if (times.length < 5) return { fps: 0, jitter: 0 };

        const dt: number[] = [];
        for (let i = 1; i < times.length; i++) dt.push(times[i] - times[i - 1]);

        // Median DT
        dt.sort((a, b) => a - b);
        const medianDt = dt[Math.floor(dt.length / 2)];
        const fps = medianDt > 0 ? 1000 / medianDt : 0;

        // Jitter (MAD)
        const diffs = dt.map(d => Math.abs(d - medianDt));
        diffs.sort((a, b) => a - b);
        const mad = diffs[Math.floor(diffs.length / 2)];
        const jitter = mad * 1.4826; // Approx StdDev

        return { fps, jitter };
    }

    // --- ROI & STATS ---

    private getForeheadROI(pts: Keypoint[], w: number, h: number): ROI {
        const xs = [pts[109].x, pts[338].x, pts[297].x, pts[332].x].map(x => Math.max(0, Math.min(w, x)));
        const ys = [pts[109].y, pts[338].y, pts[297].y].map(y => Math.max(0, Math.min(h, y)));
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }

    private getCheekROI(pts: Keypoint[], _w: number, _h: number, isLeft: boolean): ROI {
        const indices = isLeft ? [123, 50, 205] : [352, 280, 425];
        const regionPts = indices.map(i => pts[i]);
        const xs = regionPts.map(p => p.x);
        const ys = regionPts.map(p => p.y);
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }

    private extractROIColor(video: HTMLVideoElement, roi: ROI) {
        if (roi.width <= 0 || roi.height <= 0) return { rgb: { r: 0, g: 0, b: 0 }, stats: { brightness: 0, std: 0, saturation: 0 } };

        this.ctx.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, 32, 32);
        const data = this.ctx.getImageData(0, 0, 32, 32).data;

        let rSum = 0, gSum = 0, bSum = 0;
        let brightnessSum = 0, saturationCount = 0;
        const count = data.length / 4;
        const brightnessValues: number[] = [];

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            rSum += r; gSum += g; bSum += b;

            const bri = (r + g + b) / 3;
            brightnessSum += bri;
            brightnessValues.push(bri);

            if (r > 250 || g > 250 || b > 250 || r < 5 || g < 5 || b < 5) {
                saturationCount++;
            }
        }

        const meanBri = brightnessSum / count;

        // Std Dev
        let sqDiffSum = 0;
        for (const v of brightnessValues) sqDiffSum += (v - meanBri) ** 2;
        const std = Math.sqrt(sqDiffSum / count);

        return {
            rgb: count > 0 ? { r: rSum / count, g: gSum / count, b: bSum / count } : { r: 0, g: 0, b: 0 },
            stats: {
                brightness: meanBri,
                std,
                saturation: saturationCount / count
            }
        };
    }

    // --- OTHERS ---

    private calculateGeometricValence(pts: Keypoint[]): number {
        const dist = (a: Keypoint, b: Keypoint) => Math.hypot(a.x - b.x, a.y - b.y);
        const leftLip = pts[61];
        const rightLip = pts[291];

        const mouthWidth = dist(leftLip, rightLip);
        const faceWidth = dist(pts[234], pts[454]);
        const smileRatio = mouthWidth / faceWidth;
        const smileScore = (smileRatio - 0.35) * 5.0;
        const leftBrow = pts[107];
        const rightBrow = pts[336];
        const browDist = dist(leftBrow, rightBrow) / faceWidth;
        const furrowScore = (0.25 - browDist) * 8.0;
        return Math.max(-1, Math.min(1, smileScore - Math.max(0, furrowScore)));
    }

    private classifyMood(val: number, aro: number): AffectiveState['mood_label'] {
        if (aro > 0.7) return 'anxious';
        if (val > 0.3 && aro < 0.5) return 'calm';
        if (val > 0.2 && aro > 0.4 && aro < 0.7) return 'focused';
        if (aro < 0.2) return 'distracted';
        return 'neutral';
    }

    private calculateMotion(pts: Keypoint[]): number {
        const nose = pts[1];
        if (!this.lastPos) { this.lastPos = nose; return 0; }
        const d = Math.hypot(nose.x - this.lastPos.x, nose.y - this.lastPos.y);
        this.lastPos = nose;
        return Math.min(1, d / 10);
    }
    private lastPos: Keypoint | null = null;

    dispose() {
        this.detector?.dispose();
        this.worker?.terminate();
    }
}
