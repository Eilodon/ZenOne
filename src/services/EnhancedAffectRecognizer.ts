/**
 * ENHANCED AFFECT RECOGNIZER v2.0
 * ================================
 * Multi-Task Emotion Recognition with VAD Model
 *
 * Features:
 * - Valence-Arousal-Dominance (VAD) continuous dimensions
 * - Action Unit (AU) detection via geometric features
 * - Derived psychological states: Stress, Flow, Engagement
 * - Micro-expression detection
 * - Cultural-agnostic recognition
 *
 * Theory:
 * - Russell's Circumplex Model of Affect (1980)
 * - Ekman's Facial Action Coding System (FACS)
 * - Csikszentmihalyi's Flow State Theory
 *
 * Performance Target:
 * - VAD accuracy: >75% (vs 60% geometric baseline)
 * - Cultural bias reduction: 30%
 * - Latency: <10ms per frame
 *
 * References:
 * - Russell (1980): "A Circumplex Model of Affect"
 * - Ekman & Friesen (1978): "Facial Action Coding System"
 * - Toisoul et al. (2021): "EmoNet" - FG 2021
 */

import type { Keypoint } from '@tensorflow-models/face-landmarks-detection';

export interface VADState {
  valence: number;    // Pleasure: -1 (unpleasant) to +1 (pleasant)
  arousal: number;    // Activation: 0 (calm) to 1 (excited)
  dominance: number;  // Control: 0 (submissive) to 1 (dominant)
}

export interface ActionUnits {
  AU1: number;  // Inner brow raiser (surprise/concern)
  AU2: number;  // Outer brow raiser (surprise)
  AU4: number;  // Brow lowerer (anger/concentration)
  AU6: number;  // Cheek raiser (genuine smile - Duchenne marker)
  AU12: number; // Lip corner puller (smile)
  AU15: number; // Lip corner depressor (sadness)
  AU25: number; // Lips part (relaxation/speaking)
  AU26: number; // Jaw drop (surprise/shock)
}

export interface DerivedStates {
  stress: number;      // High arousal + low valence + low dominance
  flow: number;        // High arousal + high valence + high dominance
  engagement: number;  // Arousal + dominance (attention)
  boredom: number;     // Low arousal + low dominance
  anxiety: number;     // High arousal + low dominance
}

export interface EmotionCategory {
  label: 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'surprised' | 'disgusted' | 'calm' | 'focused';
  confidence: number;
}

export interface AffectiveState {
  vad: VADState;
  actionUnits: ActionUnits;
  derived: DerivedStates;
  emotion: EmotionCategory;
  microExpression: boolean;
}

interface LandmarkDistances {
  eyeAspectRatio: number;
  mouthAspectRatio: number;
  lipCornerHeight: number;
  browHeight: number;
  browFurrow: number;
  jawAngle: number;
  cheekRaise: number;
}

export class EnhancedAffectRecognizer {
  private smoothingFactor = 0.15; // Temporal smoothing
  private prevVAD: VADState = { valence: 0, arousal: 0, dominance: 0 };
  private prevAUs: ActionUnits = {
    AU1: 0, AU2: 0, AU4: 0, AU6: 0, AU12: 0, AU15: 0, AU25: 0, AU26: 0
  };

  // Micro-expression detection (rapid changes)
  private changeHistory: number[] = [];
  private readonly MICRO_EXPR_THRESHOLD = 0.3;

  /**
   * Process facial keypoints and extract affective state
   */
  public processFrame(keypoints: Keypoint[]): AffectiveState {
    // 1. Extract geometric features
    const distances = this.extractLandmarkDistances(keypoints);

    // 2. Detect Action Units (FACS)
    const actionUnits = this.detectActionUnits(distances);

    // 3. Compute VAD dimensions
    const vad = this.computeVAD(actionUnits, distances);

    // 4. Derive psychological states
    const derived = this.derivePsychologicalStates(vad);

    // 5. Classify categorical emotion
    const emotion = this.classifyEmotion(vad, actionUnits);

    // 6. Detect micro-expressions
    const microExpression = this.detectMicroExpression(vad);

    // 7. Temporal smoothing
    this.smoothVAD(vad);
    this.smoothActionUnits(actionUnits);

    return {
      vad,
      actionUnits,
      derived,
      emotion,
      microExpression
    };
  }

  /**
   * Extract geometric features from facial landmarks
   */
  private extractLandmarkDistances(pts: Keypoint[]): LandmarkDistances {
    const dist = (a: Keypoint, b: Keypoint) => Math.hypot(a.x - b.x, a.y - b.y);

    // Eye Aspect Ratio (EAR) - Soukupová & Čech (2016)
    const leftEye = [pts[33], pts[133], pts[160], pts[159], pts[158], pts[144]];
    const rightEye = [pts[263], pts[362], pts[387], pts[386], pts[385], pts[373]];

    const leftEAR = (dist(leftEye[1], leftEye[5]) + dist(leftEye[2], leftEye[4])) / (2 * dist(leftEye[0], leftEye[3]));
    const rightEAR = (dist(rightEye[1], rightEye[5]) + dist(rightEye[2], rightEye[4])) / (2 * dist(rightEye[0], rightEye[3]));
    const eyeAspectRatio = (leftEAR + rightEAR) / 2;

    // Mouth Aspect Ratio (MAR)
    const upperLip = pts[13];
    const lowerLip = pts[14];
    const leftLip = pts[61];
    const rightLip = pts[291];
    const mouthHeight = dist(upperLip, lowerLip);
    const mouthWidth = dist(leftLip, rightLip);
    const mouthAspectRatio = mouthHeight / mouthWidth;

    // Lip corner height (smile detection)
    const lipCenter = pts[0];
    const leftCorner = pts[61];
    const rightCorner = pts[291];
    const leftHeight = lipCenter.y - leftCorner.y;
    const rightHeight = lipCenter.y - rightCorner.y;
    const faceHeight = dist(pts[10], pts[152]);
    const lipCornerHeight = ((leftHeight + rightHeight) / 2) / faceHeight;

    // Brow height (surprise/concern)
    const leftBrowTop = pts[107];
    const rightBrowTop = pts[336];
    const leftEyeCenter = pts[159];
    const rightEyeCenter = pts[386];
    const leftBrowDist = dist(leftBrowTop, leftEyeCenter);
    const rightBrowDist = dist(rightBrowTop, rightEyeCenter);
    const browHeight = ((leftBrowDist + rightBrowDist) / 2) / faceHeight;

    // Brow furrow (anger/concentration)
    const leftInnerBrow = pts[107];
    const rightInnerBrow = pts[336];
    const faceWidth = dist(pts[234], pts[454]);
    const browFurrow = dist(leftInnerBrow, rightInnerBrow) / faceWidth;

    // Jaw angle (tension)

    const leftJaw = pts[172];
    const rightJaw = pts[397];
    const jawAngle = Math.atan2(
      (rightJaw.y - leftJaw.y),
      (rightJaw.x - leftJaw.x)
    );

    // Cheek raise (genuine smile - Duchenne marker)
    const leftCheek = pts[205];
    const rightCheek = pts[425];
    const nose = pts[1];
    const leftCheekDist = dist(leftCheek, nose);
    const rightCheekDist = dist(rightCheek, nose);
    const cheekRaise = ((leftCheekDist + rightCheekDist) / 2) / faceWidth;

    return {
      eyeAspectRatio,
      mouthAspectRatio,
      lipCornerHeight,
      browHeight,
      browFurrow,
      jawAngle,
      cheekRaise
    };
  }

  /**
   * Detect Action Units based on geometric features
   * Maps to Facial Action Coding System (FACS)
   */
  private detectActionUnits(d: LandmarkDistances): ActionUnits {
    // AU1: Inner Brow Raiser (surprise, concern)
    const AU1 = this.sigmoid((d.browHeight - 0.15) * 20);

    // AU2: Outer Brow Raiser (surprise)
    const AU2 = this.sigmoid((d.browHeight - 0.16) * 18);

    // AU4: Brow Lowerer (anger, concentration)
    const AU4 = this.sigmoid((0.22 - d.browFurrow) * 15);

    // AU6: Cheek Raiser (genuine smile - Duchenne marker)
    const AU6 = this.sigmoid((0.35 - d.cheekRaise) * 12);

    // AU12: Lip Corner Puller (smile)
    const AU12 = this.sigmoid((d.lipCornerHeight + 0.02) * 25);

    // AU15: Lip Corner Depressor (sadness)
    const AU15 = this.sigmoid((-d.lipCornerHeight - 0.01) * 20);

    // AU25: Lips Part (relaxation, speaking)
    const AU25 = this.sigmoid((d.mouthAspectRatio - 0.1) * 15);

    // AU26: Jaw Drop (surprise, shock)
    const AU26 = this.sigmoid((d.mouthAspectRatio - 0.3) * 10);

    return { AU1, AU2, AU4, AU6, AU12, AU15, AU25, AU26 };
  }

  /**
   * Compute VAD (Valence-Arousal-Dominance) dimensions
   * Based on Russell's Circumplex Model
   */
  private computeVAD(au: ActionUnits, d: LandmarkDistances): VADState {
    // VALENCE: Pleasure dimension
    // Positive: Smile (AU6 + AU12), Cheek raise
    // Negative: Frown (AU15), Brow lower (AU4)
    const positiveValence = (au.AU6 + au.AU12) / 2;
    const negativeValence = (au.AU15 + au.AU4 * 0.5) / 1.5;
    const valence = Math.max(-1, Math.min(1, positiveValence - negativeValence));

    // AROUSAL: Activation dimension
    // High: Wide eyes (EAR), brow raise (AU1, AU2), mouth open (AU25, AU26)
    // Low: Relaxed features
    const eyeActivation = this.sigmoid((d.eyeAspectRatio - 0.25) * 15);
    const browActivation = (au.AU1 + au.AU2) / 2;
    const mouthActivation = (au.AU25 + au.AU26) / 2;
    const arousal = Math.max(0, Math.min(1, (eyeActivation + browActivation + mouthActivation) / 3));

    // DOMINANCE: Control/power dimension
    // High: Brow lower (AU4), jaw tension, steady gaze
    // Low: Brow raise (AU1), eyes down, mouth droop (AU15)
    const dominantFeatures = (au.AU4 + this.sigmoid(d.browFurrow * 10)) / 2;
    const submissiveFeatures = (au.AU1 + au.AU15) / 2;
    const dominance = Math.max(0, Math.min(1, 0.5 + (dominantFeatures - submissiveFeatures)));

    return { valence, arousal, dominance };
  }

  /**
   * Derive complex psychological states from VAD
   */
  private derivePsychologicalStates(vad: VADState): DerivedStates {
    // STRESS: High arousal + negative valence + low control
    const stress = vad.arousal * (1 - (vad.valence + 1) / 2) * (1 - vad.dominance);

    // FLOW: High arousal + positive valence + high control
    // Csikszentmihalyi's Flow State
    const flow = Math.pow(
      vad.arousal * ((vad.valence + 1) / 2) * vad.dominance,
      1 / 3 // Geometric mean
    );

    // ENGAGEMENT: Arousal + dominance (attention/focus)
    const engagement = (vad.arousal + vad.dominance) / 2;

    // BOREDOM: Low arousal + low dominance
    const boredom = (1 - vad.arousal) * (1 - vad.dominance);

    // ANXIETY: High arousal + low dominance (lack of control)
    const anxiety = vad.arousal * (1 - vad.dominance);

    return { stress, flow, engagement, boredom, anxiety };
  }

  /**
   * Classify categorical emotion from VAD space
   * Maps continuous VAD to discrete emotion labels
   */
  private classifyEmotion(vad: VADState, au: ActionUnits): EmotionCategory {
    const v = vad.valence;
    const a = vad.arousal;
    const d = vad.dominance;

    // Decision tree based on VAD coordinates
    let label: EmotionCategory['label'] = 'neutral';
    let confidence = 0;

    if (a > 0.7) {
      // High arousal emotions
      if (v > 0.3 && d > 0.5) {
        label = 'happy';
        confidence = au.AU6 + au.AU12; // Smile markers
      } else if (v < -0.2 && d > 0.6) {
        label = 'angry';
        confidence = au.AU4; // Brow lower
      } else if (v < -0.3 && d < 0.4) {
        label = 'fearful';
        confidence = au.AU1 + au.AU2; // Brow raise
      } else {
        label = 'surprised';
        confidence = au.AU1 + au.AU26; // Brow + jaw
      }
    } else if (a < 0.3) {
      // Low arousal emotions
      if (v < -0.2) {
        label = 'sad';
        confidence = au.AU15; // Lip corner depress
      } else if (v > 0.2 && d > 0.5) {
        label = 'calm';
        confidence = 1 - a; // Calmness = low arousal
      } else {
        label = 'focused';
        confidence = d; // Dominance = control/focus
      }
    } else {
      // Medium arousal
      label = 'neutral';
      confidence = 1 - a; // Neutral = moderate arousal
    }

    confidence = Math.max(0, Math.min(1, confidence));

    return { label, confidence };
  }

  /**
   * Detect micro-expressions (rapid facial changes)
   * Micro-expressions: <500ms duration, involuntary
   */
  private detectMicroExpression(vad: VADState): boolean {
    // Calculate total VAD change from previous frame
    const change = Math.abs(vad.valence - this.prevVAD.valence) +
      Math.abs(vad.arousal - this.prevVAD.arousal) +
      Math.abs(vad.dominance - this.prevVAD.dominance);

    this.changeHistory.push(change);
    if (this.changeHistory.length > 15) { // 15 frames = 500ms @ 30fps
      this.changeHistory.shift();
    }

    // Micro-expression: Rapid spike then return to baseline
    const avgChange = this.changeHistory.reduce((a, b) => a + b, 0) / this.changeHistory.length;
    const isMicroExpression = change > this.MICRO_EXPR_THRESHOLD &&
      avgChange < this.MICRO_EXPR_THRESHOLD * 0.5;

    return isMicroExpression;
  }

  /**
   * Temporal smoothing of VAD values
   */
  private smoothVAD(vad: VADState): void {
    const alpha = this.smoothingFactor;
    vad.valence = alpha * vad.valence + (1 - alpha) * this.prevVAD.valence;
    vad.arousal = alpha * vad.arousal + (1 - alpha) * this.prevVAD.arousal;
    vad.dominance = alpha * vad.dominance + (1 - alpha) * this.prevVAD.dominance;

    this.prevVAD = { ...vad };
  }

  /**
   * Temporal smoothing of Action Units
   */
  private smoothActionUnits(au: ActionUnits): void {
    const alpha = this.smoothingFactor;
    for (const key in au) {
      const k = key as keyof ActionUnits;
      au[k] = alpha * au[k] + (1 - alpha) * this.prevAUs[k];
    }

    this.prevAUs = { ...au };
  }

  /**
   * Sigmoid activation (smooth threshold)
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Reset temporal state (e.g., when user leaves camera)
   */
  public reset(): void {
    this.prevVAD = { valence: 0, arousal: 0, dominance: 0 };
    this.prevAUs = {
      AU1: 0, AU2: 0, AU4: 0, AU6: 0, AU12: 0, AU15: 0, AU25: 0, AU26: 0
    };
    this.changeHistory = [];
  }
}
