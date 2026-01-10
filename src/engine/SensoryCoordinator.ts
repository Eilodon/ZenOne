import { playCue, setAiDucking, unlockAudio } from '../services/audio';
import { hapticTick, hapticPhase } from '../services/haptics';
import { CueType, SoundPack } from '../types';

/**
 * EIDOLON SENSORY COORDINATOR
 * 
 * Central nervous system for ZenOne's multisensory experience.
 * Ensures Audio, Haptic, and Visual events are synchronized.
 */

export type SensoryEvent = {
    type: 'breath_phase' | 'ai_speech' | 'ui_interaction' | 'achievement';
    payload: any;
    priority: number; // 0 (Low) - 10 (Critical)
    timestamp: number;
};

// Singleton instance
let instance: SensoryCoordinator | null = null;

export class SensoryCoordinator {
    private isMuted: boolean = false;
    private soundPack: SoundPack = 'real-zen';
    private hapticsEnabled: boolean = true;

    constructor() {
        if (instance) return instance;
        instance = this;

        // Listen for visual fallback events to log or debug
        if (typeof window !== 'undefined') {
            window.addEventListener('zen:sensory:fallback', (_e: Event) => {
                // Could trigger a global edge glow here if we wanted
                // But usually local components handle this.
            });
        }
    }

    static getInstance(): SensoryCoordinator {
        if (!instance) instance = new SensoryCoordinator();
        return instance;
    }

    public updateSettings(settings: {
        soundPack: SoundPack,
        hapticsEnabled: boolean,
        muted?: boolean
    }) {
        this.soundPack = settings.soundPack;
        this.hapticsEnabled = settings.hapticsEnabled;
        if (settings.muted !== undefined) this.isMuted = settings.muted;
    }

    /**
     * Dispatch a Breath Phase Change event.
     * Guaranteed to trigger Audio + Haptics in sync.
     */
    public onBreathPhase(phase: 'inhale' | 'exhale' | 'hold', duration: number) {
        // 1. Audio
        const cueMapping: Record<string, CueType> = {
            'inhale': 'inhale',
            'exhale': 'exhale',
            'hold': 'hold'
        };

        if (!this.isMuted) {
            playCue(cueMapping[phase], true, this.soundPack, duration)
                .catch(err => console.warn('[SENSORY] Audio failed:', err));
        }

        // 2. Haptics (Organic Patterns)
        if (this.hapticsEnabled) {
            hapticPhase(true, 'medium', phase);
        }

        // 3. Visuals (Handled by React State/Props usually, but we could emit events)
        // For particle effects or global shocks, we can dispatch:
        window.dispatchEvent(new CustomEvent('zen:phase:change', {
            detail: { phase, duration }
        }));
    }

    /**
     * Triggered when AI starts/stops speaking
     */
    public onAiVoice(isSpeaking: boolean) {
        // 1. Audio Ducking
        setAiDucking(isSpeaking);

        // 2. Haptic "Flutter"
        if (isSpeaking && this.hapticsEnabled) {
            hapticTick(true, 'AI_THINKING');
        }
    }

    /**
     * Triggered on user interaction (tap, click)
     */
    public onInteraction(kind: 'success' | 'warn' | 'error' | 'neutral' = 'neutral') {
        if (!this.hapticsEnabled) return;

        const map = {
            'success': 'UI_SUCCESS',
            'warn': 'UI_WARN',
            'error': 'UI_ERROR',
            'neutral': 'light' // simple tick
        } as const;

        // @ts-ignore
        hapticTick(true, map[kind] || 'light');
    }

    /**
     * Force unlock audio subsystem
     */
    public async unlock() {
        await unlockAudio();
    }
}

export const sensory = SensoryCoordinator.getInstance();
