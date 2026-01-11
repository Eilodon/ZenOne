/**
 * [P2.2 UPGRADE] Binaural Beats Engine
 *
 * Neural frequency entrainment using binaural beat technology.
 * Creates two slightly different frequencies in left/right channels.
 * The brain perceives the difference as a rhythmic "beat" that can
 * induce specific brain wave states.
 *
 * Brain Wave Bands:
 * - Delta (1-4 Hz): Deep sleep, healing, regeneration
 * - Theta (4-8 Hz): Meditation, creativity, deep relaxation
 * - Alpha (8-13 Hz): Relaxed focus, calm awareness
 * - Beta (13-30 Hz): Active thinking, concentration
 *
 * Scientific basis:
 * - Oster, G. (1973). "Auditory beats in the brain"
 * - Le Scouarnec et al. (2001). EEG effects of binaural beats
 */

import * as Tone from 'tone';

export type BrainWaveState = 'delta' | 'theta' | 'alpha' | 'beta';

type BinauralConfig = {
  baseFreq: number;      // Carrier frequency (Hz)
  beatFreq: number;      // Binaural beat frequency (Hz)
  description: string;
  benefits: string[];
};

const BINAURAL_CONFIGS: Record<BrainWaveState, BinauralConfig> = {
  delta: {
    baseFreq: 200,
    beatFreq: 2.5,
    description: 'Deep Sleep & Healing',
    benefits: ['Deep restorative sleep', 'Physical healing', 'Pain relief', 'Immune boost']
  },
  theta: {
    baseFreq: 200,
    beatFreq: 6.0,
    description: 'Meditation & Creativity',
    benefits: ['Deep meditation', 'Creative insights', 'Emotional healing', 'Vivid imagery']
  },
  alpha: {
    baseFreq: 200,
    beatFreq: 10.0,
    description: 'Relaxed Focus',
    benefits: ['Calm awareness', 'Stress reduction', 'Peak performance', 'Learning enhancement']
  },
  beta: {
    baseFreq: 220,
    beatFreq: 18.0,
    description: 'Active Thinking',
    benefits: ['Mental clarity', 'Problem solving', 'Concentration', 'Energy boost']
  }
};

export class BinauralEngine {
  private leftOsc: Tone.Oscillator | null = null;
  private rightOsc: Tone.Oscillator | null = null;
  private leftGain: Tone.Gain | null = null;
  private rightGain: Tone.Gain | null = null;
  private merger: Tone.Merge | null = null;
  private currentState: BrainWaveState = 'theta';
  private isActive = false;
  private masterVolume: Tone.Gain | null = null;

  /**
   * Initialize binaural beat oscillators
   */
  initialize(): void {
    if (this.isActive) return;

    // Create stereo oscillators
    this.leftOsc = new Tone.Oscillator(200, 'sine');
    this.rightOsc = new Tone.Oscillator(200, 'sine');

    // Individual channel gains (very low - binaural should be subtle)
    this.leftGain = new Tone.Gain(0.08);
    this.rightGain = new Tone.Gain(0.08);

    // Master volume control
    this.masterVolume = new Tone.Gain(0);  // Start muted, fade in

    // Merge into stereo
    this.merger = new Tone.Merge();

    // Connect signal chain:
    // Left: Osc -> Gain -> Merger.left
    // Right: Osc -> Gain -> Merger.right
    // Merger -> MasterVolume -> (destination connected externally)
    this.leftOsc.connect(this.leftGain);
    this.rightOsc.connect(this.rightGain);

    this.leftGain.connect(this.merger, 0, 0);   // Channel 0 -> Left
    this.rightGain.connect(this.merger, 0, 1);  // Channel 1 -> Right

    this.merger.connect(this.masterVolume);

    console.log('🧠 Binaural Engine initialized');
  }

  /**
   * Connect to audio destination
   */
  connect(destination: Tone.ToneAudioNode): void {
    if (!this.masterVolume) this.initialize();
    this.masterVolume?.connect(destination);
  }

  /**
   * Start binaural beats with specific brain wave state
   *
   * @param state - Target brain wave state
   * @param fadeInTime - Fade in duration in seconds (default: 3s)
   */
  async start(state: BrainWaveState = 'theta', fadeInTime = 3.0): Promise<void> {
    if (!this.leftOsc || !this.rightOsc || !this.masterVolume) {
      this.initialize();
    }

    await Tone.start(); // Ensure audio context

    const config = BINAURAL_CONFIGS[state];

    // Set frequencies
    this.leftOsc!.frequency.value = config.baseFreq;
    this.rightOsc!.frequency.value = config.baseFreq + config.beatFreq;

    // Start oscillators
    if (this.leftOsc!.state !== 'started') this.leftOsc!.start();
    if (this.rightOsc!.state !== 'started') this.rightOsc!.start();

    // Fade in master volume
    this.masterVolume!.gain.rampTo(1.0, fadeInTime);

    this.currentState = state;
    this.isActive = true;

    console.log(`🧠 Binaural Beats: ${config.description} (${config.beatFreq} Hz)`);
  }

  /**
   * Stop binaural beats
   *
   * @param fadeOutTime - Fade out duration in seconds (default: 2s)
   */
  async stop(fadeOutTime = 2.0): Promise<void> {
    if (!this.isActive || !this.masterVolume) return;

    // Fade out
    this.masterVolume.gain.rampTo(0, fadeOutTime);

    // Wait for fade out, then stop oscillators
    await new Promise(resolve => setTimeout(resolve, fadeOutTime * 1000));

    this.leftOsc?.stop();
    this.rightOsc?.stop();

    this.isActive = false;

    console.log('🧠 Binaural Beats stopped');
  }

  /**
   * Change brain wave state (smooth transition)
   *
   * @param newState - Target state
   * @param transitionTime - Transition duration in seconds (default: 4s)
   */
  setState(newState: BrainWaveState, transitionTime = 4.0): void {
    if (!this.isActive || !this.leftOsc || !this.rightOsc) return;

    const config = BINAURAL_CONFIGS[newState];

    // Smoothly transition frequencies
    this.leftOsc.frequency.rampTo(config.baseFreq, transitionTime);
    this.rightOsc.frequency.rampTo(config.baseFreq + config.beatFreq, transitionTime);

    this.currentState = newState;

    console.log(`🧠 Binaural transition: ${config.description} (${config.beatFreq} Hz)`);
  }

  /**
   * Sync binaural state to breathing phase
   *
   * @param phase - Current breathing phase
   * @param arousalTarget - Target arousal level (0-1)
   */
  onBreathPhase(phase: 'inhale' | 'exhale' | 'hold', arousalTarget = 0.5): void {
    if (!this.isActive) return;

    // Inhale → slightly increase frequency (alertness)
    if (phase === 'inhale') {
      const state = arousalTarget > 0.5 ? 'alpha' : 'theta';
      this.setState(state, 2.0);
    }

    // Exhale → decrease for relaxation
    if (phase === 'exhale') {
      this.setState('theta', 2.0);
    }

    // Hold → maintain current state or go deeper
    if (phase === 'hold') {
      const state = arousalTarget < 0.3 ? 'delta' : 'theta';
      this.setState(state, 3.0);
    }
  }

  /**
   * Set overall volume (0.0 - 1.0)
   */
  setVolume(volume: number): void {
    if (!this.leftGain || !this.rightGain) return;

    const clampedVolume = Math.max(0, Math.min(1, volume));
    const targetGain = clampedVolume * 0.08; // Max 0.08 for subtlety

    this.leftGain.gain.rampTo(targetGain, 0.5);
    this.rightGain.gain.rampTo(targetGain, 0.5);
  }

  /**
   * Get current brain wave state
   */
  getCurrentState(): BrainWaveState {
    return this.currentState;
  }

  /**
   * Check if binaural beats are active
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Get configuration for a brain wave state
   */
  static getConfig(state: BrainWaveState): BinauralConfig {
    return BINAURAL_CONFIGS[state];
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.stop(0);

    this.leftOsc?.dispose();
    this.rightOsc?.dispose();
    this.leftGain?.dispose();
    this.rightGain?.dispose();
    this.merger?.dispose();
    this.masterVolume?.dispose();

    this.leftOsc = null;
    this.rightOsc = null;
    this.leftGain = null;
    this.rightGain = null;
    this.merger = null;
    this.masterVolume = null;

    console.log('🧠 Binaural Engine disposed');
  }
}

// Singleton instance
export const binauralEngine = new BinauralEngine();
