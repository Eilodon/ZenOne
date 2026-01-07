
export type BreathPhase = 'inhale' | 'holdIn' | 'exhale' | 'holdOut';
export type CueType = 'inhale' | 'exhale' | 'hold' | 'finish';

export type BreathingType = 
  | '4-7-8' 
  | 'box' 
  | 'calm'
  | 'coherence'
  | 'deep-relax'
  | '7-11'
  | 'awake'
  | 'triangle'
  | 'tactical'
  | 'buteyko'
  | 'wim-hof';

export type PatternTier = 1 | 2 | 3; 

export type ColorTheme = 'warm' | 'cool' | 'neutral';
export type Language = 'en' | 'vi';

export type SoundPack = 'synth' | 'breath' | 'bells' | 'real-zen' | 'voice-full' | 'voice-12';

export type QualityTier = 'auto' | 'low' | 'medium' | 'high';

export type SignalQuality = 'excellent' | 'good' | 'fair' | 'poor';

export interface HRVMetrics {
  rmssd: number;       
  sdnn: number;        
  stressIndex: number; 
}

export interface AffectiveState {
  valence: number;     
  arousal: number;     
  dominance?: number;  
  mood_label: 'anxious' | 'calm' | 'focused' | 'neutral' | 'distracted';
}

export interface VitalSigns {
  heartRate: number;
  respirationRate?: number; 
  hrv?: HRVMetrics;         
  affective?: AffectiveState; 
  confidence: number;
  signalQuality: SignalQuality;
  snr: number;
  motionLevel: number;
}

// --- PRIMITIVE 3: UNIVERSAL CONTROL (Active Inference) ---

export type BeliefState = {
  arousal: number;          // 0.0 (Coma) -> 1.0 (Panic)
  attention: number;        // 0.0 (Dissociated) -> 1.0 (Hyper-focused)
  rhythm_alignment: number; // 0.0 (Arrhythmia) -> 1.0 (Resonance)
  valence: number;          // -1.0 to 1.0
  
  arousal_variance: number;
  attention_variance: number;
  rhythm_variance: number;
  
  prediction_error: number; 
  innovation: number;       
  mahalanobis_distance: number; 
  confidence: number;       
};

export type Observation = {
  timestamp: number;
  delta_time: number;
  user_interaction?: 'pause' | 'resume' | 'touch';
  visibilty_state: 'visible' | 'hidden';
  heart_rate?: number;
  hr_confidence?: number;
  respiration_rate?: number; 
  stress_index?: number;     
  facial_valence?: number;   
};

// --- PRIMITIVE 1: TIME-TRAVELING DEBUGGER (Event Log) ---

export type KernelEvent = 
  | { type: 'BOOT'; timestamp: number }
  | { type: 'LOAD_PROTOCOL'; patternId: BreathingType; timestamp: number }
  | { type: 'START_SESSION'; timestamp: number }
  | { type: 'TICK'; dt: number; observation: Observation; timestamp: number } 
  | { type: 'BELIEF_UPDATE'; belief: BeliefState; timestamp: number }
  | { type: 'PHASE_TRANSITION'; from: BreathPhase; to: BreathPhase; timestamp: number }
  | { type: 'CYCLE_COMPLETE'; count: number; timestamp: number }
  | { type: 'INTERRUPTION'; kind: 'pause' | 'background'; timestamp: number }
  | { type: 'RESUME'; timestamp: number }
  | { type: 'HALT'; reason: string; timestamp: number }
  | { type: 'SAFETY_INTERDICTION'; riskLevel: number; action: string; timestamp: number }
  | { type: 'SYMPATHETIC_OVERRIDE'; fromPattern: string; toPattern: string; reason: string; timestamp: number } // NEW: Level 3 Reflex
  | { type: 'LOAD_SAFETY_REGISTRY'; registry: Record<string, SafetyProfile>; timestamp: number }
  | { type: 'ADJUST_TEMPO'; scale: number; reason: string; timestamp: number }
  | { type: 'AI_INTERVENTION'; intent: string; parameters: any; timestamp: number }
  | { type: 'AI_VOICE_MESSAGE'; text: string; sentiment: string; timestamp: number }
  | { type: 'AI_STATUS_CHANGE'; status: 'connecting' | 'connected' | 'thinking' | 'speaking' | 'disconnected'; timestamp: number };

// --- PRIMITIVE 2: SAFETY-BY-CONSTRUCTION (Trauma Registry) ---

export type SafetyProfile = {
  patternId: BreathingType;
  cummulative_stress_score: number; 
  last_incident_timestamp: number;
  safety_lock_until: number; 
  resonance_history: number[]; 
  resonance_score: number; 
};

// --- SIMULATION TYPES (HOLODECK) ---
export type SimScenario = 'nominal' | 'panic_attack' | 'ai_intervention' | 'sensor_failure';
export type SimStatus = 'idle' | 'running' | 'passed' | 'failed';

// --- USER SPACE ---

export type UserSettings = {
  soundEnabled: boolean;
  hapticEnabled: boolean;
  hapticStrength: 'light' | 'medium' | 'heavy';
  theme: ColorTheme;
  quality: QualityTier;
  reduceMotion: boolean;
  showTimer: boolean;
  language: Language; 
  soundPack: SoundPack;
  streak: number;
  lastBreathDate: string;
  lastUsedPattern: BreathingType;
  safetyRegistry: Record<string, SafetyProfile>;
  cameraVitalsEnabled: boolean;
  showKernelMonitor: boolean;
  aiCoachEnabled: boolean;
  apiKey?: string; 
  developerMode?: boolean;
};

export type SessionHistoryItem = {
  id: string;
  timestamp: number;
  durationSec: number;
  patternId: BreathingType;
  cycles: number;
  finalBelief: BeliefState;
};

export type SessionStats = {
  durationSec: number;
  cyclesCompleted: number;
  patternId: BreathingType;
  timestamp: number;
};

export type BreathPattern = {
  id: BreathingType;
  label: string;
  tag: string;
  description: string;
  timings: Record<BreathPhase, number>;
  colorTheme: ColorTheme;
  recommendedCycles: number;
  tier: PatternTier;
  arousalImpact: number; // -1 (Sedative) to 1 (Stimulant)
};

export const BREATHING_PATTERNS: Record<string, BreathPattern> = {
  '4-7-8': {
    id: '4-7-8',
    label: 'Tranquility',
    tag: 'Sleep & Anxiety',
    description: 'A natural tranquilizer for the nervous system.',
    timings: { inhale: 4, holdIn: 7, exhale: 8, holdOut: 0 },
    colorTheme: 'warm',
    recommendedCycles: 4,
    tier: 1,
    arousalImpact: -0.8
  },
  box: {
    id: 'box',
    label: 'Focus',
    tag: 'Concentration',
    description: 'Used by Navy SEALs to heighten performance.',
    timings: { inhale: 4, holdIn: 4, exhale: 4, holdOut: 4 },
    colorTheme: 'neutral',
    recommendedCycles: 6,
    tier: 1,
    arousalImpact: 0.0
  },
  calm: {
    id: 'calm',
    label: 'Balance',
    tag: 'Coherence',
    description: 'Restores balance to your heart rate variability.',
    timings: { inhale: 4, holdIn: 0, exhale: 6, holdOut: 0 },
    colorTheme: 'cool',
    recommendedCycles: 8,
    tier: 1,
    arousalImpact: -0.3
  },
  coherence: {
    id: 'coherence',
    label: 'Coherence',
    tag: 'Heart Health',
    description: 'Optimizes Heart Rate Variability (HRV). The "Golden Ratio" of breathing.',
    timings: { inhale: 6, holdIn: 0, exhale: 6, holdOut: 0 },
    colorTheme: 'cool',
    recommendedCycles: 10,
    tier: 2,
    arousalImpact: -0.5
  },
  'deep-relax': {
    id: 'deep-relax',
    label: 'Deep Rest',
    tag: 'Stress Relief',
    description: 'Doubling the exhalation to trigger the parasympathetic system.',
    timings: { inhale: 4, holdIn: 0, exhale: 8, holdOut: 0 },
    colorTheme: 'warm',
    recommendedCycles: 6,
    tier: 1,
    arousalImpact: -0.9
  },
  '7-11': {
    id: '7-11',
    label: '7-11',
    tag: 'Deep Calm',
    description: 'A powerful technique for panic attacks and deep anxiety.',
    timings: { inhale: 7, holdIn: 0, exhale: 11, holdOut: 0 },
    colorTheme: 'warm',
    recommendedCycles: 4,
    tier: 2,
    arousalImpact: -1.0
  },
  'awake': {
    id: 'awake',
    label: 'Energize',
    tag: 'Wake Up',
    description: 'Fast-paced rhythm to boost alertness and energy levels.',
    timings: { inhale: 4, holdIn: 0, exhale: 2, holdOut: 0 },
    colorTheme: 'cool',
    recommendedCycles: 15,
    tier: 2,
    arousalImpact: 0.8
  },
  'triangle': {
    id: 'triangle',
    label: 'Triangle',
    tag: 'Yoga',
    description: 'A geometric pattern for emotional stability and control.',
    timings: { inhale: 4, holdIn: 4, exhale: 4, holdOut: 0 },
    colorTheme: 'neutral',
    recommendedCycles: 8,
    tier: 1,
    arousalImpact: 0.2
  },
  'tactical': {
    id: 'tactical',
    label: 'Tactical',
    tag: 'Advanced Focus',
    description: 'Extended Box Breathing for high-stress situations.',
    timings: { inhale: 5, holdIn: 5, exhale: 5, holdOut: 5 },
    colorTheme: 'neutral',
    recommendedCycles: 5,
    tier: 2,
    arousalImpact: 0.1
  },
  'buteyko': {
    id: 'buteyko',
    label: 'Light Air',
    tag: 'Health',
    description: 'Reduced breathing to improve oxygen uptake (Buteyko Method).',
    timings: { inhale: 3, holdIn: 0, exhale: 3, holdOut: 4 },
    colorTheme: 'cool',
    recommendedCycles: 12,
    tier: 3,
    arousalImpact: -0.2
  },
  'wim-hof': {
    id: 'wim-hof',
    label: 'Tummo Power',
    tag: 'Immunity',
    description: 'Charge the body. Inhale deeply, let go. Repeat.',
    timings: { inhale: 2, holdIn: 0, exhale: 1, holdOut: 15 },
    colorTheme: 'warm',
    recommendedCycles: 30,
    tier: 3,
    arousalImpact: 1.0
  }
};
