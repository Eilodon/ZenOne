export type SignalQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'invalid';

export type ReasonCode =
    | 'FACE_LOST'
    | 'INSUFFICIENT_WINDOW'
    | 'LOW_LIGHT'
    | 'SATURATION'
    | 'FLICKER_SUSPECTED'
    | 'MOTION_HIGH'
    | 'FPS_UNSTABLE'
    | 'ROI_TOO_SMALL'
    | 'SNR_LOW'
    | 'PROCESSING_OVERLOAD';
