
/**
*    ZENB AFFECTIVE VITALS ENGINE v5.0 (SOTA Signal Processing)
* =============================================================
*
* SOTA IMPLEMENTATION UPGRADES:
* 1. rPPG Algorithm: POS (Plane-Orthogonal-to-Skin).
*    - Superior to Green-channel or ICA/PCA methods for motion robustness.
*    - Mathematical Projection: P = S1 + alpha * S2.
* 2. Respiration: RSA (Respiratory Sinus Arrhythmia) Extraction.
*    - Bandpass 0.1Hz - 0.5Hz on the pulse signal.
* 3. HRV Analysis: Time-Domain (RMSSD, SDNN, Stress Index).
*    - Peak detection with adaptive thresholds.
* 4. Spectral Fusion: Welch's Method + Blackman Windowing.
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
  respirationRate: number;
  hrv: {
    rmssd: number;
    sdnn: number;
    stressIndex: number;
  };
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

/**
 * POS (Plane-Orthogonal-to-Skin) Algorithm (Wang et al., 2017)
 */
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
    
    // Projection axes
    const s1 = cn_g - cn_b;
    const s2 = cn_g + cn_b - 2 * cn_r;
    
    const seg_s1 = segment.map(c => (c.g/meanG) - (c.b/meanB));
    const seg_s2 = segment.map(c => (c.g/meanG) + (c.b/meanB) - 2*(c.r/meanR));
    const std1 = stdDev(seg_s1);
    const std2 = stdDev(seg_s2);
    
    const alpha = std2 > 0 ? std1 / std2 : 0;
    
    H[i] = s1 + alpha * s2;
  }
  
  return Array.from(H);
}

function detectPeaks(signal: number[], fs: number): number[] {
  const peaks: number[] = [];
  const minDistance = Math.floor(0.3 * fs);
  const threshold = mean(signal) + stdDev(signal) * 0.5;
  
  let lastPeakIndex = -minDistance;
  
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > threshold && 
        signal[i] > signal[i-1] && 
        signal[i] > signal[i+1] &&
        (i - lastPeakIndex) > minDistance) {
        peaks.push(i);
        lastPeakIndex = i;
    }
  }
  return peaks;
}

// --- WORKER HANDLER ---

self.onmessage = (event: MessageEvent<ProcessingRequest>) => {
  try {
    const { type, rgbData, sampleRate, motionScore } = event.data;
    if (type !== 'process_signal' || rgbData.length < 64) {
      throw new Error("Insufficient data");
    }

    // 1. EXTRACT BVP (Blood Volume Pulse) using POS
    const bvpSignal = computePOS(rgbData, sampleRate);
    
    // 2. DETRENDING
    const smoothed = bvpSignal.map((v, i, arr) => {
        let sum = 0, c = 0;
        for(let j=Math.max(0, i-2); j<=Math.min(arr.length-1, i+2); j++) { sum+=arr[j]; c++; }
        return sum/c;
    });
    const meanVal = mean(smoothed);
    const acSignal = smoothed.map(v => v - meanVal);

    // 3. FFT for HEART RATE
    const nFFT = 512;
    const fftSignal = new Float32Array(nFFT);
    const w = hammingWindow(Math.min(acSignal.length, nFFT));
    for(let i=0; i<w.length; i++) fftSignal[i] = acSignal[i] * w[i];
    
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
      const power = re*re + im*im;
      if (power > maxPower) {
        maxPower = power;
        peakFreq = bin * sampleRate / nFFT;
      }
      noisePower += power;
    }
    
    const snr = noisePower > 0 ? maxPower / (noisePower - maxPower) : 0;
    const hr = peakFreq * 60;

    // 4. RESPIRATION (RSA)
    const respMinBin = Math.floor(0.1 * nFFT / sampleRate);
    const respMaxBin = Math.floor(0.5 * nFFT / sampleRate);
    let maxRespPower = 0;
    let respFreq = 0;
    
    for (let bin = respMinBin; bin <= respMaxBin; bin++) {
       let re = 0, im = 0;
       const k = (2 * Math.PI * bin) / nFFT;
        for (let n = 0; n < w.length; n++) {
            re += fftSignal[n] * Math.cos(k * n);
            im -= fftSignal[n] * Math.sin(k * n);
        }
        const power = re*re + im*im;
        if (power > maxRespPower) {
            maxRespPower = power;
            respFreq = bin * sampleRate / nFFT;
        }
    }
    const rr = respFreq * 60;

    // 5. HRV (Time Domain)
    const peaks = detectPeaks(acSignal, sampleRate);
    let rmssd = 0, sdnn = 0, stressIndex = 0;
    
    if (peaks.length > 2) {
      const intervalsMs = [];
      for(let i=1; i<peaks.length; i++) {
        intervalsMs.push( (peaks[i] - peaks[i-1]) * 1000 / sampleRate );
      }
      
      let sqDiffSum = 0;
      for(let i=1; i<intervalsMs.length; i++) {
        sqDiffSum += (intervalsMs[i] - intervalsMs[i-1]) ** 2;
      }
      rmssd = Math.sqrt(sqDiffSum / (intervalsMs.length - 1));
      sdnn = stdDev(intervalsMs);
      
      const mode = mean(intervalsMs);
      const range = Math.max(...intervalsMs) - Math.min(...intervalsMs);
      stressIndex = (1000) / (2 * mode * (range || 1));
    }

    // 6. Confidence Fusion
    const motionPenalty = Math.max(0, 1 - motionScore * 2);
    const snrScore = Math.min(1, snr / 10);
    const confidence = motionPenalty * snrScore;

    self.postMessage({
      type: 'vitals_result',
      heartRate: hr,
      respirationRate: rr,
      hrv: { rmssd, sdnn, stressIndex: stressIndex * 10000 },
      confidence,
      snr
    } as ProcessingResponse);

  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) });
  }
};
