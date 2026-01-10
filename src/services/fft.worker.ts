/**
*    ZENB AFFECTIVE VITALS ENGINE v5.1 (Partial Metrics)
* ======================================================
*
* Updates:
* - Return partial metrics (HR only if RR/HRV window undefined).
* - Safer signal processing for short windows.
*/

export interface ProcessingRequest {
  type: 'process_signal';
  rgbData: { r: number; g: number; b: number; timestamp: number }[];
  motionScore: number;
  sampleRate: number;
}

export interface ProcessingResponse {
  type: 'vitals_result';
  heartRate: number;
  respirationRate: number; // Placeholder, 0 if N/A
  hrv: {
    rmssd: number;
    sdnn: number;
    stressIndex: number;
  } | undefined; // Undefined if N/A
  confidence: number;
  snr: number;
}

export interface ErrorResponse {
  type: 'error';
  message: string;
}

// --- MATH UTILS ---

function mean(data: number[]): number {
  return data.reduce((a, b) => a + b, 0) / data.length;
}

function stdDev(data: number[]): number {
  const m = mean(data);
  const variance = data.reduce((sum, val) => sum + (val - m) ** 2, 0) / data.length;
  return Math.sqrt(variance);
}

// Hamming Window
function hammingWindow(n: number): number[] {
  const w = new Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// --- CORE ALGORITHMS ---

function computePOS(rgb: { r: number, g: number, b: number }[], fs: number): number[] {
  const l = rgb.length;
  const H = new Float32Array(l);
  const windowSize = Math.floor(1.6 * fs);

  for (let i = 0; i < l; i++) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(l, i + windowSize);
    const segment = rgb.slice(start, end);

    const meanR = mean(segment.map(c => c.r)) || 1;
    const meanG = mean(segment.map(c => c.g)) || 1;
    const meanB = mean(segment.map(c => c.b)) || 1;

    const cn_r = rgb[i].r / meanR;
    const cn_g = rgb[i].g / meanG;
    const cn_b = rgb[i].b / meanB;

    const s1 = cn_g - cn_b;
    const s2 = cn_g + cn_b - 2 * cn_r;

    const seg_s1 = segment.map(c => (c.g / meanG) - (c.b / meanB));
    const seg_s2 = segment.map(c => (c.g / meanG) + (c.b / meanB) - 2 * (c.r / meanR));
    const std1 = stdDev(seg_s1);
    const std2 = stdDev(seg_s2);

    const alpha = std2 > 0 ? std1 / std2 : 0;

    H[i] = s1 + alpha * s2;
  }

  return Array.from(H);
}

self.onmessage = (event: MessageEvent<ProcessingRequest>) => {
  try {
    const { type, rgbData, sampleRate, motionScore } = event.data;
    if (type !== 'process_signal' || rgbData.length < 32) { // Allow smaller chunks but safer
      throw new Error("Insufficient data");
    }

    const bvpSignal = computePOS(rgbData, sampleRate);

    // Detrending
    const smoothed = bvpSignal.map((_v, i, arr) => {
      let sum = 0, c = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(arr.length - 1, i + 2); j++) { sum += arr[j]; c++; }
      return sum / c;
    });
    const meanVal = mean(smoothed);
    const acSignal = smoothed.map(v => v - meanVal);

    // FFT for Heart Rate
    const nFFT = 512;
    const fftSignal = new Float32Array(nFFT);
    const w = hammingWindow(Math.min(acSignal.length, nFFT));
    for (let i = 0; i < w.length; i++) fftSignal[i] = acSignal[i] * w[i];

    const minBin = Math.floor(0.66 * nFFT / sampleRate);
    const maxBin = Math.floor(3.66 * nFFT / sampleRate);

    let maxPower = 0;
    let peakFreq = 0;
    let noisePower = 0;

    for (let bin = minBin; bin <= maxBin; bin++) {
      let re = 0, im = 0;
      const k = (2 * Math.PI * bin) / nFFT;
      for (let n = 0; n < w.length; n++) {
        re += fftSignal[n] * Math.cos(k * n);
        im -= fftSignal[n] * Math.sin(k * n);
      }
      const power = re * re + im * im;
      if (power > maxPower) {
        maxPower = power;
        peakFreq = bin * sampleRate / nFFT;
      }
      noisePower += power;
    }

    const snr = noisePower > 0 ? maxPower / (noisePower - maxPower) : 0;
    const hr = peakFreq * 60;

    // Respiration & HRV - Return dummy/undefined if window too short
    // Real logic to be implemented with specialized buffers from Engine
    // For now we just return neutral/empty for these to avoid hallucinations

    // Confidence Fusion
    const motionPenalty = Math.max(0, 1 - motionScore * 2);
    const snrScore = Math.min(1, snr / 5); // Relaxed SNR requirement for v1
    const confidence = motionPenalty * snrScore;

    self.postMessage({
      type: 'vitals_result',
      heartRate: hr,
      respirationRate: 0, // Explicitly N/A
      hrv: undefined,     // Explicitly N/A
      confidence,
      snr
    } as ProcessingResponse);

  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) });
  }
};
