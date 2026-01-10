import { useEffect, useState, useRef } from 'react';
import { CameraVitalsEngine } from '../services/CameraVitalsEngine.v2';
import { ZenVitalsSnapshot } from '../vitals/snapshot';

export function useCameraVitals(enabled: boolean) {
  const [vitals, setVitals] = useState<ZenVitalsSnapshot | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [guidance, setGuidance] = useState<string[]>([]);

  const engineRef = useRef<CameraVitalsEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Cleanup any previous simulation hooks
    const checkForSim = () => {
      const simDataGen = (window as any).__ZENB_HOLODECK_VITALS__;
      if (simDataGen && engineRef.current) {
        engineRef.current.setSimulationMode(true, simDataGen);
      } else if (engineRef.current) {
        engineRef.current.setSimulationMode(false);
      }
    };

    const simInterval = setInterval(checkForSim, 1000);

    if (!enabled) {
      cleanup();
      return () => clearInterval(simInterval);
    }

    let mounted = true;

    const init = async () => {
      try {
        setError(null);
        // Initialize engine
        const engine = new CameraVitalsEngine();

        // Check Sim immediately
        const simDataGen = (window as any).__ZENB_HOLODECK_VITALS__;
        if (simDataGen) engine.setSimulationMode(true, simDataGen);

        await engine.init();
        engineRef.current = engine;

        // Request camera (Skip if simulating)
        if (!simDataGen) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30 }
            }
          });
          streamRef.current = stream;

          const video = document.createElement('video');
          video.srcObject = stream;
          video.playsInline = true;
          video.muted = true;
          await video.play();
          videoRef.current = video;
        } else {
          // Mock video element for sim
          videoRef.current = document.createElement('video');
        }

        if (!mounted) {
          cleanup();
          return;
        }

        setIsReady(true);

        let lastProcessTime = 0;
        const processLoop = async (now: number) => {
          if (!engineRef.current || !videoRef.current || !mounted) return;

          let targetFrameTime = 1000 / 30;

          if (now - lastProcessTime >= targetFrameTime) {
            try {
              const result: ZenVitalsSnapshot = await engineRef.current.processFrame(videoRef.current);
              if (mounted) {
                setVitals(result);

                // Extract guidance for UI
                if (result.quality.quality !== 'excellent' && result.quality.quality !== 'good') {
                  import('../vitals/guidance').then(({ reasonsToGuidanceVi }) => {
                    if (mounted) setGuidance(reasonsToGuidanceVi(result.quality.reasons));
                  });
                } else {
                  if (mounted) setGuidance([]);
                }
              }
              lastProcessTime = now;
            } catch (err) {
              console.error('[rPPG] Processing error:', err);
            }
          }
          rafRef.current = requestAnimationFrame(processLoop);
        };

        rafRef.current = requestAnimationFrame(processLoop);

      } catch (err: any) {
        console.error('[rPPG] Initialization failed:', err);
        if (mounted) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setError('Camera permission denied. Please allow access in settings.');
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setError('No camera found on this device.');
          } else {
            setError(err.message || 'Failed to access camera.');
          }
        }
      }
    };

    init();

    return () => {
      mounted = false;
      clearInterval(simInterval);
      cleanup();
    };
  }, [enabled]);

  const cleanup = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (engineRef.current) engineRef.current.dispose();
    streamRef.current = null;
    videoRef.current = null;
    engineRef.current = null;

    setIsReady(false);
    setVitals(null);
  };

  return { vitals, isReady, error, guidance };
}
