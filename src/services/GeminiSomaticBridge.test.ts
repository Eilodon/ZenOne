import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GeminiSomaticBridge } from './GeminiSomaticBridge';
import { PureZenBKernel } from './PureZenBKernel';
import { SafetyConfig } from '../config/SafetyConfig';

// --- MOCKS ---

// 1. Mock AudioContext (Browser API)
const mockAudioContext = {
  createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
  createScriptProcessor: vi.fn(() => ({ 
      connect: vi.fn(), 
      disconnect: vi.fn(), 
      onaudioprocess: null 
  })),
  createBuffer: vi.fn(),
  createBufferSource: vi.fn(() => ({ 
      connect: vi.fn(), 
      start: vi.fn(), 
      onended: null 
  })),
  destination: {},
  close: vi.fn(),
  currentTime: 0
};

// 2. Mock Navigator MediaDevices
const mockGetUserMedia = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: vi.fn() }]
});

// 3. Mock Google GenAI
const mockSendRealtimeInput = vi.fn();
const mockSendToolResponse = vi.fn();
const mockConnect = vi.fn();

// Mock the module itself
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn(() => ({
      live: {
        connect: mockConnect
      }
    })),
    Modality: { AUDIO: 'AUDIO' },
    Type: { OBJECT: 'OBJECT', NUMBER: 'NUMBER', STRING: 'STRING' }
  };
});

describe('GeminiSomaticBridge (Cortex Interface)', () => {
  let kernel: PureZenBKernel;
  let bridge: GeminiSomaticBridge;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: mockGetUserMedia } });
    vi.stubGlobal('window', { AudioContext: vi.fn(() => mockAudioContext) });
    vi.stubGlobal('btoa', (str: string) => (globalThis as any).Buffer.from(str).toString('base64'));

    process.env.API_KEY = 'test-key';
    
    // Setup Kernel
    kernel = new PureZenBKernel(SafetyConfig, { getMeta: async () => {} } as any);
    bridge = new GeminiSomaticBridge(kernel);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize and connect to Gemini Live', async () => {
    // Mock successful session
    mockConnect.mockResolvedValue({
        sendRealtimeInput: mockSendRealtimeInput,
        sendToolResponse: mockSendToolResponse
    });

    await bridge.connect();

    expect(mockConnect).toHaveBeenCalled();
    expect(mockGetUserMedia).toHaveBeenCalled(); // Should start mic
    
    // Check Kernel State Update
    expect(kernel.getState().aiStatus).toBe('connected');
    expect(kernel.getState().aiActive).toBe(true);
  });

  it('should handle tool calls (adjust_tempo) from AI', async () => {
    let onMessageCallback: any;
    
    mockConnect.mockImplementation(async ({ callbacks }: any) => {
        onMessageCallback = callbacks.onmessage;
        callbacks.onopen();
        return { 
            sendRealtimeInput: mockSendRealtimeInput,
            sendToolResponse: mockSendToolResponse 
        };
    });

    await bridge.connect();

    // Simulate Tool Call Message from Server
    const toolCallMessage = {
        toolCall: {
            functionCalls: [{
                id: 'call_123',
                name: 'adjust_tempo',
                args: { scale: 1.2, reason: 'High Stress' }
            }]
        }
    };

    await onMessageCallback(toolCallMessage);

    // 1. Kernel should receive the event
    const state = kernel.getState();
    expect(state.tempoScale).toBe(1.2);
    
    // 2. Kernel logs should show the audit trail
    const logs = kernel.getLogBuffer();
    expect(logs.some(e => e.type === 'AI_INTERVENTION' && e.intent === 'adjust_tempo')).toBe(true);

    // 3. Should send response back to Gemini
    expect(mockSendToolResponse).toHaveBeenCalled();
  });

  it('should send telemetry to AI when Kernel detects high entropy', async () => {
    mockConnect.mockResolvedValue({ sendRealtimeInput: mockSendRealtimeInput });
    await bridge.connect();
    
    // Wait for subscription to settle
    
    // Trigger High Entropy in Kernel
    kernel.dispatch({ type: 'START_SESSION', timestamp: Date.now() });
    
    // Simulate critical state
    kernel.dispatch({ 
        type: 'BELIEF_UPDATE', 
        belief: { 
            prediction_error: 0.9, // Critical
            arousal: 0.8,
            attention: 0, rhythm_alignment: 0, valence: 0,
            arousal_variance: 0, attention_variance: 0, rhythm_variance: 0, innovation: 0, mahalanobis_distance: 0, confidence: 1
        },
        timestamp: Date.now()
    });

    // Bridge should pick this up via subscription and send context
    expect(mockSendRealtimeInput).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.arrayContaining([
            expect.objectContaining({ text: expect.stringContaining('SYS_TELEMETRY') })
        ])
    }));
  });

  it('should disconnect cleanly', async () => {
    await bridge.connect();
    bridge.disconnect();
    
    expect(kernel.getState().aiStatus).toBe('disconnected');
    expect(mockAudioContext.close).toHaveBeenCalled();
  });
});