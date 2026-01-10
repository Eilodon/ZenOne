
import type { Keypoint } from '@tensorflow-models/face-landmarks-detection';

export interface VADOutput {
    valence: number;
    arousal: number;
    dominance: number;
}

export class EmoNetAffectRecognizer {
    private isReady = false;

    async loadModel(): Promise<boolean> {
        // Stub load
        this.isReady = true;
        return true;
    }

    predict(_keypoints: Keypoint[]): VADOutput | null {
        if (!this.isReady) return null;

        // Mock inference
        // In reality: Convert keypoints to tensor -> Model -> VAD
        return {
            valence: 0.1,
            arousal: 0.2,
            dominance: 0.5
        };
    }
}
