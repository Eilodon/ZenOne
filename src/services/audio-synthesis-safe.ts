

/**
 * SAFE_SYNTHESIS_PRESETS
 * 
 * "Gentle Zen" configuration.
 * Optimized for warmth, lower modulation, and reduced digital harshness.
 */
export const SAFE_SYNTHESIS_PRESETS = {
    // 1. Warmth / Distortion: Gentle saturation
    warmth: {
        distortion: 0.008, // Very subtle warmth
        oversample: '2x' as const
    },

    // 2. Synth Layers: Softer attack, less harmonic modulation
    synthLayers: {
        sub: {
            // Pure sine for clean low end
            oscillator: { type: 'sine' as const },
            envelope: {
                attack: 1.5,
                decay: 0.3,
                sustain: 0.7,
                release: 2.5
            },
            volume: -20
        },
        body: {
            harmonicity: 1.5, // Reduced from 1.8
            oscillator: { type: 'triangle' as const },
            envelope: {
                attack: 0.8,
                decay: 0.2,
                sustain: 0.8,
                release: 2.0
            },
            modulationEnvelope: {
                attack: 1.0,
                sustain: 0.9
            },
            volume: -14
        }
    },

    // 3. Breath Engine: Wider, gentler formants (less whistling)
    breathFormants: {
        formant1: {
            type: 'bandpass' as const,
            frequency: 750,
            Q: 1.8, // Lower Q = wider band = less resonant
            rolloff: -12 as const
        },
        formant2: {
            type: 'bandpass' as const,
            frequency: 1150,
            Q: 2.0,
            rolloff: -12 as const
        }
    },

    // 4. Singing Bowl: Realistic partials without high-freq clutter
    bowlPartials: {
        // Just 4 main partials for a cleaner tone
        amplitudes: [1.0, 0.5, 0.25, 0.12],
        envelope: {
            attack: 0.015,
            decay: 4.0,
            sustain: 0.0,
            release: 6.0
        },
        vibrato: {
            frequency: 3.5, // Slower wobble 
            min: -5,
            max: 5
        }
    },

    // 5. Crystal Bell: CRITICAL FIX for harshness
    crystalBell: {
        harmonicity: 4.5,      // Less metallic
        modulationIndex: 18,   // DRASTIC reduction from 38
        resonance: 4000,       // Cut high resonant peak
        octaves: 1.2,          // Tighter frequency range
        envelope: {
            attack: 0.002,
            decay: 1.2,        // Shorter tail
            release: 0.4
        },
        volume: -22
    }
};
