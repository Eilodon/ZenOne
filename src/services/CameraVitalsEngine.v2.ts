
import * as tf from '@tensorflow/tfjs';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import type { Keypoint } from '@tensorflow-models/face-landmarks-detection';
import type { ProcessingRequest, ProcessingResponse, ErrorResponse } from './fft.worker';
import { SignalQuality, VitalSigns, AffectiveState } from '../types';
import { PhysFormerRPPG } from './ml/PhysFormerRPPG';
import { EmoNetAffectRecognizer } from './ml/EmoNetAffectRecognizer';

/**
 * ZENB BIO-SIGNAL PIPELINE v6.2 (OPTIMIZED)
 * =========================================
 * Upgrades:
 * - Fixed-buffer ROI extraction (O(1) memory alloc).
 * - Hardware-accelerated downsampling via drawImage.
 * - Geometric Valence Calculation (Facial AUs proxy).
 * - Motion-compensated RGB Stream.
 * - [NEW] Holodeck Simulation Hooks.
 */

interface ROI {
    x: number; y: number; width: number; height: number;
}

export class CameraVitalsEngine {
    private detector: faceLandmarksDetection.FaceLandmarksDetector | null = null;
    private canvas: OffscreenCanvas;
    private ctx: OffscreenCanvasRenderingContext2D;

    // ML Engines (Hybrid Architecture)
    private physFormer: PhysFormerRPPG;
    private emoNet: EmoNetAffectRecognizer;

    // Data Buffers
    private rgbBuffer: { r: number; g: number; b: number; timestamp: number }[] = [];
    private readonly BUFFER_DURATION = 6;
    private readonly SAMPLE_RATE = 30;

    private worker: Worker | null = null;
    private isProcessing = false;

    // Affective State Tracking
    private valenceSmoother = 0;
    private arousalSmoother = 0;

    // --- SIMULATION MODE ---
    private isSimulated = false;
    private simGenerator: (() => VitalSigns) | null = null;

    constructor() {
        this.canvas = new OffscreenCanvas(32, 32);
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
        this.physFormer = new PhysFormerRPPG();
        this.emoNet = new EmoNetAffectRecognizer();
    }

    // --- HOLODECK HOOKS ---
    public setSimulationMode(enabled: boolean, generator?: () => VitalSigns) {
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
            console.log('[ZenB] Affective Engine v6.2 initialized');
        } catch (error) {
            console.error('[ZenB] Engine init failed', error);
            throw error;
        }
    }

    async processFrame(video: HTMLVideoElement): Promise<VitalSigns> {
        // 0. HOLODECK BYPASS
        if (this.isSimulated && this.simGenerator) {
            return this.simGenerator();
        }

        if (!this.detector || !this.worker) return this.getDefaultVitals();

        const timestamp = performance.now();
        const faces = await this.detector.estimateFaces(video, { flipHorizontal: false });

        if (faces.length === 0) {
            return this.decayVitals();
        }

        const face = faces[0];
        const keypoints = face.keypoints;

        // 1. EXTRACT MULTI-ROI RGB
        const forehead = this.extractROIColor(video, this.getForeheadROI(keypoints, video.videoWidth, video.videoHeight));
        const leftCheek = this.extractROIColor(video, this.getCheekROI(keypoints, video.videoWidth, video.videoHeight, true));
        const rightCheek = this.extractROIColor(video, this.getCheekROI(keypoints, video.videoWidth, video.videoHeight, false));

        // Average color (Fusion)
        const fusedColor = {
            r: (forehead.r + leftCheek.r + rightCheek.r) / 3,
            g: (forehead.g + leftCheek.g + rightCheek.g) / 3,
            b: (forehead.b + leftCheek.b + rightCheek.b) / 3,
            timestamp
        };

        this.rgbBuffer.push(fusedColor);
        const maxSamples = this.BUFFER_DURATION * this.SAMPLE_RATE;
        if (this.rgbBuffer.length > maxSamples) this.rgbBuffer.shift();

        // 2. CALCULATE GEOMETRIC VALENCE (Rule-based AUs)
        const valence = this.calculateGeometricValence(keypoints);
        this.valenceSmoother = this.valenceSmoother * 0.9 + valence * 0.1; // Smooth updates

        // 3. DETECT MOTION (Head Pose stability)
        const motion = this.calculateMotion(keypoints);

        // 4. ASYNC WORKER PROCESSING
        let workerResult = null;
        if (this.rgbBuffer.length > 64 && !this.isProcessing) {
            workerResult = await this.triggerWorker(motion);
        }

        // 5. FUSION & RETURN
        let currentVitals = workerResult || this.lastKnownVitals;

        // ML OVERRIDE (PhysFormer)
        // If PhysFormer has a result, use it (it's SOTA)
        // In real impl, we would feed it the video frame/tensor here
        const mlVitals = this.physFormer.processFrame(fusedColor, timestamp);
        if (mlVitals) {
            currentVitals = { ...currentVitals, ...mlVitals };
        }

        // Combine Physio Arousal (Stress Index) + Facial Valence
        const rawStress = currentVitals.hrv?.stressIndex || 0;
        const arousal = Math.min(1, rawStress / 500);
        this.arousalSmoother = this.arousalSmoother * 0.95 + arousal * 0.05;

        // ML OVERRIDE (EmoNet)
        let finalValence = this.valenceSmoother;
        let finalArousal = this.arousalSmoother;
        const mlAffect = this.emoNet.predict(keypoints); // Using keypoints as proxy input for now
        if (mlAffect) {
            finalValence = finalValence * 0.7 + mlAffect.valence * 0.3; // Fusion
            // We might trust EmoNet arousal more than HRV? Or fuse them?
            // Let's fuse HRV-based arousal with Facial arousal
            finalArousal = (finalArousal + mlAffect.arousal) / 2;
        }

        const affectiveState: AffectiveState = {
            valence: finalValence,
            arousal: finalArousal,
            mood_label: this.classifyMood(finalValence, finalArousal)
        };

        const finalResult = {
            ...currentVitals,
            affective: affectiveState,
            motionLevel: motion
        };

        this.lastKnownVitals = finalResult;
        return finalResult;
    }

    private lastKnownVitals: VitalSigns = this.getDefaultVitals();

    private async triggerWorker(motion: number): Promise<VitalSigns | null> {
        if (!this.worker) return null;
        this.isProcessing = true;

        return new Promise((resolve) => {
            const bufferCopy = [...this.rgbBuffer];
            const req: ProcessingRequest = {
                type: 'process_signal',
                rgbData: bufferCopy,
                motionScore: motion,
                sampleRate: this.SAMPLE_RATE
            };

            const handler = (e: MessageEvent<ProcessingResponse | ErrorResponse>) => {
                this.worker?.removeEventListener('message', handler);
                this.isProcessing = false;
                if (e.data.type === 'vitals_result') {
                    resolve(this.mapWorkerResponse(e.data));
                } else {
                    resolve(null);
                }
            };

            this.worker!.addEventListener('message', handler);
            this.worker!.postMessage(req);
        });
    }

    private mapWorkerResponse(res: ProcessingResponse): VitalSigns {
        return {
            heartRate: res.heartRate,
            respirationRate: res.respirationRate,
            hrv: res.hrv,
            confidence: res.confidence,
            snr: res.snr,
            signalQuality: res.confidence > 0.7 ? 'excellent' : res.confidence > 0.4 ? 'good' : 'poor',
            motionLevel: 0
        };
    }

    // --- GEOMETRIC FEATURES (Valence Proxy) ---

    private calculateGeometricValence(pts: Keypoint[]): number {
        const dist = (a: Keypoint, b: Keypoint) => Math.hypot(a.x - b.x, a.y - b.y);
        const leftLip = pts[61];
        const rightLip = pts[291];
        const upperLip = pts[0];
        const lowerLip = pts[17];
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

    // --- ROI HELPERS ---

    private getForeheadROI(pts: Keypoint[], w: number, h: number): ROI {
        const xs = [pts[109].x, pts[338].x, pts[297].x, pts[332].x].map(x => Math.max(0, Math.min(w, x)));
        const ys = [pts[109].y, pts[338].y, pts[297].y].map(y => Math.max(0, Math.min(h, y)));
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }

    private getCheekROI(pts: Keypoint[], w: number, h: number, isLeft: boolean): ROI {
        const indices = isLeft ? [123, 50, 205] : [352, 280, 425];
        const regionPts = indices.map(i => pts[i]);
        const xs = regionPts.map(p => p.x);
        const ys = regionPts.map(p => p.y);
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }

    private extractROIColor(video: HTMLVideoElement, roi: ROI) {
        if (roi.width <= 0 || roi.height <= 0) return { r: 0, g: 0, b: 0 };
        this.ctx.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, 32, 32);
        const data = this.ctx.getImageData(0, 0, 32, 32).data;
        let r = 0, g = 0, b = 0, c = 0;
        for (let i = 0; i < data.length; i += 4) {
            r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
        }
        return c > 0 ? { r: r / c, g: g / c, b: b / c } : { r: 0, g: 0, b: 0 };
    }

    private calculateMotion(pts: Keypoint[]): number {
        const nose = pts[1];
        if (!this.lastPos) { this.lastPos = nose; return 0; }
        const d = Math.hypot(nose.x - this.lastPos.x, nose.y - this.lastPos.y);
        this.lastPos = nose;
        return Math.min(1, d / 10);
    }
    private lastPos: Keypoint | null = null;

    private decayVitals(): VitalSigns {
        const v = { ...this.lastKnownVitals };
        v.confidence *= 0.95;
        v.signalQuality = v.confidence > 0.4 ? 'fair' : 'poor';
        this.lastKnownVitals = v;
        return v;
    }

    private getDefaultVitals(): VitalSigns {
        return { heartRate: 0, confidence: 0, signalQuality: 'poor', snr: 0, motionLevel: 0 };
    }

    dispose() {
        this.detector?.dispose();
        this.worker?.terminate();
    }
}
