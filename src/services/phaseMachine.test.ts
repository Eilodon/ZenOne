
import { describe, it, expect } from 'vitest';
import { nextPhaseSkipZero, isCycleBoundary, isPatternValid } from './phaseMachine';
import { BREATHING_PATTERNS } from '../types';

describe('PhaseMachine (Biological Clock)', () => {
  
  it('should validate patterns correctly', () => {
    expect(isPatternValid(BREATHING_PATTERNS['4-7-8'])).toBe(true);
    
    const invalidPattern = { ...BREATHING_PATTERNS['4-7-8'], timings: { inhale: 0, holdIn: 0, exhale: 0, holdOut: 0 } };
    expect(isPatternValid(invalidPattern)).toBe(false);
  });

  it('should cycle 4-7-8 correctly (Inhale -> Hold -> Exhale -> Inhale)', () => {
    const p = BREATHING_PATTERNS['4-7-8'];
    // Inhale(4) -> HoldIn(7)
    expect(nextPhaseSkipZero('inhale', p)).toBe('holdIn');
    // HoldIn(7) -> Exhale(8)
    expect(nextPhaseSkipZero('holdIn', p)).toBe('exhale');
    // Exhale(8) -> Inhale(4) (No holdOut)
    expect(nextPhaseSkipZero('exhale', p)).toBe('inhale');
  });

  it('should handle Box Breathing correctly (All 4 phases)', () => {
    const p = BREATHING_PATTERNS['box'];
    expect(nextPhaseSkipZero('inhale', p)).toBe('holdIn');
    expect(nextPhaseSkipZero('holdIn', p)).toBe('exhale');
    expect(nextPhaseSkipZero('exhale', p)).toBe('holdOut');
    expect(nextPhaseSkipZero('holdOut', p)).toBe('inhale');
  });

  it('should skip zero-duration phases (Awake: No Holds)', () => {
    const p = BREATHING_PATTERNS['awake']; // Inhale 4, HoldIn 0, Exhale 2, HoldOut 0
    
    // Inhale -> Exhale (Skip HoldIn)
    expect(nextPhaseSkipZero('inhale', p)).toBe('exhale');
    
    // Exhale -> Inhale (Skip HoldOut)
    expect(nextPhaseSkipZero('exhale', p)).toBe('inhale');
  });

  it('should identify cycle boundaries', () => {
    expect(isCycleBoundary('inhale')).toBe(true);
    expect(isCycleBoundary('exhale')).toBe(false);
    expect(isCycleBoundary('holdIn')).toBe(false);
  });
});
