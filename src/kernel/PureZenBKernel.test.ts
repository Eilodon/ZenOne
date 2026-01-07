
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PureZenBKernel } from '../services/PureZenBKernel';
import { SafetyConfig } from '../config/SafetyConfig';

// Mock BioFS
const mockFS = {
  getMeta: vi.fn(),
  setMeta: vi.fn(),
  writeEvent: vi.fn(),
  garbageCollect: vi.fn(),
  getSessionLog: vi.fn()
};

describe('PureZenBKernel v6.1 (Sentient)', () => {
  let kernel: PureZenBKernel;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFS.getMeta.mockResolvedValue(undefined);
    kernel = new PureZenBKernel(SafetyConfig, mockFS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- CORE & SAFETY ---

  it('should boot into IDLE', () => {
    expect(kernel.getState().status).toBe('IDLE');
  });

  it('should trigger EMERGENCY_HALT on sustained high prediction error', () => {
    kernel.dispatch({ type: 'LOAD_PROTOCOL', patternId: '4-7-8', timestamp: Date.now() });
    kernel.dispatch({ type: 'START_SESSION', timestamp: Date.now() });

    // Simulate 15 seconds passing
    vi.setSystemTime(Date.now() + 15000);
    kernel.tick(15, { timestamp: Date.now(), delta_time: 15, visibilty_state: 'visible' });

    // Inject "Panic" belief
    kernel.dispatch({
        type: 'BELIEF_UPDATE',
        belief: {
            arousal: 1.0, attention: 0, rhythm_alignment: 0, valence: -1,
            arousal_variance: 0, attention_variance: 0, rhythm_variance: 0,
            prediction_error: 0.99, // Threshold is 0.95
            innovation: 1, mahalanobis_distance: 10, confidence: 1
        },
        timestamp: Date.now()
    });

    expect(kernel.getState().status).toBe('SAFETY_LOCK');
  });

  // --- AI INTEGRATION TESTS ---

  it('should track AI connection status', () => {
    expect(kernel.getState().aiActive).toBe(false);
    expect(kernel.getState().aiStatus).toBe('disconnected');

    kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'connecting', timestamp: Date.now() });
    expect(kernel.getState().aiStatus).toBe('connecting');
    expect(kernel.getState().aiActive).toBe(true);

    kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'thinking', timestamp: Date.now() });
    expect(kernel.getState().aiStatus).toBe('thinking');
  });

  it('should capture AI voice messages for UI display', () => {
    kernel.dispatch({ type: 'AI_VOICE_MESSAGE', text: "Slow down...", sentiment: "calm", timestamp: Date.now() });
    expect(kernel.getState().lastAiMessage).toBe("Slow down...");
    expect(kernel.getState().aiStatus).toBe('speaking');
  });

  it('should allow AI to adjust tempo via Tool Call (Active Inference Loop)', () => {
    kernel.dispatch({ type: 'LOAD_PROTOCOL', patternId: 'box', timestamp: Date.now() });
    kernel.dispatch({ type: 'START_SESSION', timestamp: Date.now() });

    // AI Tool Call: Adjust Tempo
    kernel.dispatch({ 
        type: 'ADJUST_TEMPO', 
        scale: 1.2, 
        reason: 'User HR too high', 
        timestamp: Date.now() 
    });

    expect(kernel.getState().tempoScale).toBe(1.2);
  });

  it('should REJECT unsafe AI tempo adjustments (The Turing Police)', () => {
    const spy = vi.spyOn(console, 'warn');
    
    // AI tries to set dangerous speed (0.5x is too fast)
    kernel.dispatch({ 
        type: 'ADJUST_TEMPO', 
        scale: 0.5, 
        reason: 'Hyperventilate', 
        timestamp: Date.now() 
    });

    // State should NOT change
    expect(kernel.getState().tempoScale).toBe(1.0);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Rejected unsafe tempo'));
  });

  it('should reset AI status on HALT', () => {
     kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'connected', timestamp: Date.now() });
     kernel.dispatch({ type: 'HALT', reason: 'User Stop', timestamp: Date.now() });
     
     expect(kernel.getState().aiActive).toBe(false);
     expect(kernel.getState().aiStatus).toBe('disconnected');
  });
});
