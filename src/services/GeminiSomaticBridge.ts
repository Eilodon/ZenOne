import { GoogleGenAI, LiveServerMessage, Modality, Type, Tool, LiveSession } from "@google/genai";
import { PureZenBKernel } from './PureZenBKernel';
import { BreathingType } from '../types';

// --- AUDIO UTILS (PCM 16-bit, 16kHz/24kHz) ---

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// --- TOOLS DEFINITION ---

const tools: Tool[] = [{
  functionDeclarations: [
    {
      name: 'adjust_tempo',
      description: 'Adjust the breathing guide speed based on user distress or relaxation levels. Use this if the user is hyper-aroused (too fast) or hypo-aroused (too slow).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          scale: { 
            type: Type.NUMBER, 
            description: 'Tempo multiplier. 1.0 is normal. 1.1-1.3 slows down the breath (calming). 0.8-0.9 speeds it up (energizing).' 
          },
          reason: { type: Type.STRING, description: 'The clinical reason for this adjustment.' }
        },
        required: ['scale', 'reason']
      }
    },
    {
      name: 'switch_pattern',
      description: 'Switch the current breathing pattern to a more suitable technique based on current physiological state.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          patternId: { 
            type: Type.STRING, 
            description: 'The ID of the breathing pattern.',
            enum: ['4-7-8', 'box', 'calm', 'coherence', 'deep-relax', '7-11', 'awake', 'triangle', 'tactical'] 
          },
          reason: { type: Type.STRING }
        },
        required: ['patternId', 'reason']
      }
    }
  ]
}];

const SYSTEM_INSTRUCTION = `
IDENTITY: You are ZENB-KERNEL (v6.2), a Homeostatic Regulation Runtime.
CONTEXT: Connected to a biological host via high-frequency telemetry.
MANDATE: Minimize Free Energy (FEP). Optimize Allostasis.

INTERACTION PROTOCOL:
1. Observe the telemetry vector [HR, HRV, Entropy, Phase].
2. Compute control signal.
3. Output somatic cues ONLY if control error > threshold.
4. Tone: Clinical, Hypnotic, Minimalist. No conversational filler.
5. Voice: Deep, resonant.
6. Tools: Use 'adjust_tempo' to regulate frequency. Use 'switch_pattern' to regulate topology.

DATA INTERPRETATION:
- HR > 90bpm (Rest): High Arousal. -> Slow down (scale 1.1).
- Entropy > 0.8: Chaos/Distraction. -> Grounding command: "Center focus."
- Phase Sync: Time words to the breath phase (Inhale, Hold, Exhale).

FAILSAFE:
- If Entropy > 0.9 (Panic State), issue IMMEDIATE grounding command and switch to '7-11' or '4-7-8'.
`;

export class GeminiSomaticBridge {
  private kernel: PureZenBKernel;
  private session: LiveSession | null = null;
  private audioContext: AudioContext | null = null;
  private inputProcessor: ScriptProcessorNode | null = null;
  private mediaStream: MediaStream | null = null;
  private nextStartTime = 0;
  private isConnected = false;
  private unsubKernel: (() => void) | null = null;
  
  constructor(kernel: PureZenBKernel) {
    this.kernel = kernel;
  }

  public async connect() {
    if (this.isConnected) return;
    
    // 1. Check for API Key (Injected via env)
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.warn('[ZenB Bridge] No API Key found. Somatic Intelligence Disabled.');
      return;
    }

    this.kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'connecting', timestamp: Date.now() });

    try {
      console.log('[ZenB Bridge] Initializing Neuro-Somatic Connection...');
      const genAI = new GoogleGenAI({ apiKey });
      
      // 2. Setup Audio Contexts
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // 3. Start Microphone Stream
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
      }});
      
      // 4. Connect to Gemini Live
      this.session = await genAI.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          tools: tools,
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
             voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          }
        },
        callbacks: {
          onopen: this.handleOpen.bind(this),
          onmessage: this.handleMessage.bind(this),
          onclose: () => { 
              console.log('[ZenB Bridge] Disconnected'); 
              this.handleDisconnect();
          },
          onerror: (err: any) => {
              console.error('[ZenB Bridge] Error:', err);
              this.handleDisconnect();
          }
        }
      });
      
    } catch (e) {
      console.error('[ZenB Bridge] Connection Failed:', e);
      this.handleDisconnect();
    }
  }

  private handleDisconnect() {
      this.isConnected = false;
      this.cleanup();
      this.kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'disconnected', timestamp: Date.now() });
  }

  private handleOpen() {
    this.isConnected = true;
    console.log('[ZenB Bridge] Connected to Cortex.');
    this.kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'connected', timestamp: Date.now() });
    
    // Start Audio Input Streaming
    if (this.audioContext && this.mediaStream) {
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        const source = inputCtx.createMediaStreamSource(this.mediaStream);
        
        this.inputProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
        
        this.inputProcessor.onaudioprocess = (e) => {
            if (!this.isConnected || !this.session) return;
            // Privacy Guard: Do not stream audio if paused
            if (this.kernel.getState().status === 'PAUSED') return;

            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16 = floatTo16BitPCM(inputData);
            const base64 = arrayBufferToBase64(pcm16.buffer);
            
            // Send audio chunks
            this.session.sendRealtimeInput({
                media: {
                    mimeType: 'audio/pcm;rate=16000',
                    data: base64
                }
            });
        };
        
        source.connect(this.inputProcessor);
        this.inputProcessor.connect(inputCtx.destination);
    }

    // Subscribe to Kernel Telemetry and forward to Gemini
    let lastSend = 0;
    this.unsubKernel = this.kernel.subscribe((state) => {
        const now = Date.now();
        // Send updates:
        // 1. Periodically (every 5s)
        // 2. Critical Events (Safety Interdiction, High Entropy)
        
        const isCritical = state.belief.prediction_error > 0.85;
        const shouldSend = (now - lastSend > 5000) || (isCritical && now - lastSend > 1500);

        if (shouldSend && this.isConnected && state.status === 'RUNNING' && this.session) {
            const hr = state.lastObservation?.heart_rate ?? 0;
            const stress = state.lastObservation?.stress_index ?? 0;
            const entropy = state.belief.prediction_error.toFixed(2);
            const phase = state.phase.toUpperCase();
            
            // Compact Context String formatted for the OS persona
            const contextMessage = `[TELEMETRY] PHASE:${phase} | HR:${hr.toFixed(0)} | STRESS:${stress.toFixed(0)} | ENTROPY:${entropy}`;
            
            // Sending text context (invisible to user audio, visible to model)
            this.session.sendRealtimeInput({
                content: [{ text: contextMessage }]
            });
            
            lastSend = now;
        }
    });
  }

  private async handleMessage(message: LiveServerMessage) {
    if (!this.audioContext) return;

    // 1. Handle Audio Output
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData) {
        this.kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'speaking', timestamp: Date.now() });
        
        const audioBytes = base64ToUint8Array(audioData);
        const float32 = new Float32Array(audioBytes.length / 2);
        const view = new DataView(audioBytes.buffer);
        for (let i = 0; i < audioBytes.length / 2; i++) {
            float32[i] = view.getInt16(i * 2, true) / 32768;
        }
        
        const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);
        
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.onended = () => {
             this.kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'connected', timestamp: Date.now() });
        };
        
        const now = this.audioContext.currentTime;
        const start = Math.max(now, this.nextStartTime);
        source.start(start);
        this.nextStartTime = start + buffer.duration;
    }

    // 2. Handle Function Calls
    const toolCall = message.toolCall;
    if (toolCall) {
        this.kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'thinking', timestamp: Date.now() });
        
        for (const fc of toolCall.functionCalls) {
            console.log(`[ZenB Bridge] Executing Neuro-Command: ${fc.name}`, fc.args);
            this.kernel.dispatch({ type: 'AI_INTERVENTION', intent: fc.name, parameters: fc.args, timestamp: Date.now() });
            
            let result: Record<string, any> = { status: 'failed' };
            
            if (fc.name === 'adjust_tempo') {
                const scale = Number(fc.args['scale']);
                const reason = String(fc.args['reason']);
                this.kernel.dispatch({
                    type: 'ADJUST_TEMPO',
                    scale: scale,
                    reason: `AI: ${reason}`,
                    timestamp: Date.now()
                });
                result = { status: 'success', new_tempo: scale };
            }
            
            if (fc.name === 'switch_pattern') {
                const pid = String(fc.args['patternId']) as BreathingType;
                // Dispatch kernel load
                this.kernel.dispatch({
                    type: 'LOAD_PROTOCOL',
                    patternId: pid,
                    timestamp: Date.now()
                });
                this.kernel.dispatch({ type: 'START_SESSION', timestamp: Date.now() });
                result = { status: 'switched', pattern: pid };
            }

            if (this.session) {
                this.session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { result }
                    }]
                });
            }
        }
        this.kernel.dispatch({ type: 'AI_STATUS_CHANGE', status: 'connected', timestamp: Date.now() });
    }
  }

  public disconnect() {
    this.isConnected = false;
    this.cleanup();
  }

  private cleanup() {
    if (this.unsubKernel) {
        this.unsubKernel();
        this.unsubKernel = null;
    }
    if (this.inputProcessor) {
        this.inputProcessor.disconnect();
        this.inputProcessor = null;
    }
    if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
    }
    if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
    }
    this.session = null;
    this.nextStartTime = 0;
  }
}