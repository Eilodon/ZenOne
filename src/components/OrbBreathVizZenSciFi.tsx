
import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { useSpring, animated, config } from '@react-spring/three';
import * as THREE from 'three';
import { BreathPhase, ColorTheme, QualityTier } from '../types';
import { AIConnectionStatus } from '../services/PureZenBKernel';
import { setSpatialBreathParams } from '../services/audio'; // [NEW] Spatial Audio Sync

type Props = {
  phase: BreathPhase;
  theme: ColorTheme;
  quality: QualityTier;
  reduceMotion: boolean;
  isActive: boolean;
  progressRef: React.MutableRefObject<number>;
  entropyRef?: React.MutableRefObject<number>;
  aiStatus?: AIConnectionStatus;
};
// ... THEMES definition (preserved) ...
const THEMES: Record<ColorTheme, { deep: THREE.Color; mid: THREE.Color; glow: THREE.Color; accent: THREE.Color }> = {
  warm: {
    deep: new THREE.Color('#2b0505'),
    mid: new THREE.Color('#a3341e'),
    glow: new THREE.Color('#ffd39a'),
    accent: new THREE.Color('#ff8f6a'),
  },
  cool: {
    deep: new THREE.Color('#00121a'),
    mid: new THREE.Color('#0b4f6e'),
    glow: new THREE.Color('#7afff3'),
    accent: new THREE.Color('#1ad3ff'),
  },
  neutral: {
    deep: new THREE.Color('#0d0d12'),
    mid: new THREE.Color('#5e5e6e'),
    glow: new THREE.Color('#ffffff'),
    accent: new THREE.Color('#c8d6e5'),
  },
};

function resolveTier(q: QualityTier) {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4;
  const auto = q === 'auto';
  // If cores < 4, it's very low end. < 8 is mid. >= 8 is high/desktop.
  const isLow = q === 'low' || (auto && cores < 4);
  const isHigh = q === 'high' || (auto && cores >= 8);

  // octaves: Complexity of FBM noise. 4 is standard, 2 for low end.
  if (isLow) return { dpr: Math.min(dpr, 1.0), seg: 24, halo: false, ring: false, octaves: 2 };
  if (isHigh) return { dpr: Math.min(dpr, 2), seg: 64, halo: true, ring: true, octaves: 4 };
  return { dpr: Math.min(dpr, 1.5), seg: 40, halo: true, ring: false, octaves: 3 };
}

// ... CORE_VERT (preserved) ...
const CORE_VERT = `
varying vec3 vPos;
varying vec3 vNormal;
uniform float uTime;
uniform float uAiPulse;

void main() {
  vNormal = normalMatrix * normal;
  
  // Geometric Distortion when AI speaks (The "Voice" effect)
  vec3 pos = position;
  if (uAiPulse > 0.1) {
      float noise = sin(pos.y * 10.0 + uTime * 20.0) * cos(pos.x * 10.0 + uTime * 15.0);
      pos += normal * noise * uAiPulse * 0.08;
  }
  
  vPos = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

// Inject octaves into fragment shader
const getFragShader = (octaves: number) => `
precision highp float;
varying vec3 vPos;
varying vec3 vNormal;
uniform float uTime;
uniform float uBreath;
uniform float uEntropy;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uGlow;
uniform vec3 uAccent;
uniform float uAiPulse; 

float hash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n000 = hash(i + vec3(0,0,0));
  float n100 = hash(i + vec3(1,0,0));
  float n010 = hash(i + vec3(0,1,0));
  float n110 = hash(i + vec3(1,1,0));
  float n001 = hash(i + vec3(0,0,1));
  float n101 = hash(i + vec3(1,0,1));
  float n011 = hash(i + vec3(0,1,1));
  float n111 = hash(i + vec3(1,1,1));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

float fbm(vec3 p){
  float v = 0.0;
  float a = 0.55;
  // Adaptive Octaves via JS Injection
  for(int i=0;i<${octaves};i++){ 
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main(){
  vec3 n = normalize(vNormal);
  vec3 p = vPos * 1.2;
  float t = uTime * 0.22;
  float f = fbm(p + vec3(0.0, t, t*0.7));
  float fil = smoothstep(0.45, 0.85, f);
  vec3 base = mix(uDeep, uMid, fil);
  vec3 glow = mix(base, uGlow, clamp(uBreath, 0.0, 1.0) * 0.75);
  float shimmer = fbm(p * 2.2 + vec3(t*2.0)) * 0.5 + 0.5;
  
  vec3 aiColor = mix(vec3(0.0, 1.0, 0.6), vec3(0.6, 0.2, 1.0), smoothstep(0.4, 1.0, uAiPulse)); 
  vec3 accent = mix(uAccent, aiColor, uAiPulse);
  
  glow = mix(glow, aiColor, uAiPulse * 0.6);

  if (uAiPulse > 0.05) {
     float grid = abs(sin(vPos.x * 20.0)) + abs(sin(vPos.y * 20.0));
     glow += aiColor * (1.0 - smoothstep(0.0, 0.1, grid)) * uAiPulse * 0.5;
  }

  glow = mix(glow, accent, shimmer * (clamp(uEntropy, 0.0, 1.0) * 0.18 + uAiPulse * 0.4));
  
  float fres = pow(1.0 - abs(dot(n, vec3(0.0,0.0,1.0))), 2.5);
  float energy = (0.35 + 0.95 * uBreath) * (0.65 + 0.35 * fil);
  vec3 col = glow * energy + uGlow * fres * (0.35 + 0.5 * uBreath);
  float alpha = 0.25 + 0.55 * uBreath + 0.15 * fil;
  gl_FragColor = vec4(col, alpha);
}
`;

function ZenOrb(props: Props) {
  const { phase, theme, quality, reduceMotion, isActive, progressRef, entropyRef, aiStatus } = props;
  const tier = useMemo(() => resolveTier(quality), [quality]);
  const colors = useMemo(() => THEMES[theme] ?? THEMES.neutral, [theme]);
  const { gl } = useThree(); // Access WebGL Context

  const group = useRef<THREE.Group>(null);
  const shellMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const coreMat = useRef<THREE.ShaderMaterial>(null);

  const breathRef = useRef(0);
  const entropySmoothRef = useRef(0);
  const aiPulseRef = useRef(0);

  // [P0.2 UPGRADE] Spring physics for material properties (organic transitions)
  const [materialSpring, materialApi] = useSpring(() => ({
    scale: 1.35,
    roughness: 0.55,
    transmission: 0.45,
    clearcoat: 0.35,
    clearcoatRoughness: 0.5,
    thickness: 0.3,
    attenuationDistance: 1.8,
    config: {
      mass: 1.2,
      tension: 180,
      friction: 26,
      clamp: false, // Allow 8-12% overshoot for organic feel
    },
  }));

  // [NEW] WebGL Context Robustness
  useEffect(() => {
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn("⚠️ WebGL Context Lost");
      // Three.js usually handles auto-restore if we preventDefault,
      // but we might need to reset some shader state if it comes back weird.
    };
    const handleContextRestored = () => {
      console.log("✅ WebGL Context Restored");
      if (coreMat.current) coreMat.current.needsUpdate = true;
    };

    gl.domElement.addEventListener('webglcontextlost', handleContextLost, false);
    gl.domElement.addEventListener('webglcontextrestored', handleContextRestored, false);
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', handleContextLost);
      gl.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
    };
  }, [gl]);

  useFrame((state, delta) => {
    const time = state.clock.getElapsedTime();

    const motion = reduceMotion ? 0.45 : 1.0;
    const p = THREE.MathUtils.clamp(progressRef.current, 0, 1);

    let targetBreath = 0;
    if (isActive) {
      if (phase === 'inhale') targetBreath = p;
      else if (phase === 'holdIn') targetBreath = 1;
      else if (phase === 'exhale') targetBreath = 1 - p;
      else targetBreath = 0;
    } else {
      targetBreath = (Math.sin(time * 0.7) * 0.5 + 0.5) * 0.35;
    }

    // [NEW] Sync Spatial Audio
    setSpatialBreathParams(breathRef.current);

    // AI Pulse Logic
    let targetAi = 0;
    if (aiStatus === 'speaking') targetAi = 0.9 + Math.sin(time * 15) * 0.2; // Rapid flutter + Voice
    else if (aiStatus === 'thinking') targetAi = 0.4 + Math.sin(time * 3) * 0.1; // Deep throb
    else if (aiStatus === 'connected') targetAi = 0.15; // Subtle presence

    aiPulseRef.current = THREE.MathUtils.lerp(aiPulseRef.current, targetAi, delta * 4.0);

    const targetEntropy = entropyRef?.current ?? 0;
    breathRef.current = THREE.MathUtils.lerp(breathRef.current, targetBreath, 1 - Math.pow(0.001, delta * 3.2));
    entropySmoothRef.current = THREE.MathUtils.lerp(entropySmoothRef.current, targetEntropy, 1 - Math.pow(0.001, delta * 2.0));

    const breath = breathRef.current;
    const entropy = THREE.MathUtils.clamp(entropySmoothRef.current, 0, 1);

    // [P0.2 UPGRADE] Update spring targets based on breath state
    const baseScale = 1.35;
    const pulse = 0.14 * breath + 0.02 * Math.sin(time * 2.2);

    materialApi.start({
      scale: baseScale + pulse,
      roughness: THREE.MathUtils.lerp(0.55, 0.18, breath),
      transmission: THREE.MathUtils.lerp(0.45, 0.92, breath),
      clearcoat: THREE.MathUtils.lerp(0.35, 1.0, breath),
      clearcoatRoughness: THREE.MathUtils.lerp(0.5, 0.1, breath),
      thickness: THREE.MathUtils.lerp(0.3, 0.7, breath),
      attenuationDistance: THREE.MathUtils.lerp(1.8, 0.9, breath),
      immediate: false, // Use spring physics
    });

    // Apply spring values to group scale
    if (group.current) {
      group.current.scale.setScalar(materialSpring.scale.get());
      group.current.rotation.y += delta * 0.18 * motion;
      group.current.rotation.x = Math.sin(time * 0.15) * 0.08 * motion;
    }

    // Apply spring values to material
    if (shellMat.current) {
      shellMat.current.roughness = materialSpring.roughness.get();
      shellMat.current.clearcoat = materialSpring.clearcoat.get();
      shellMat.current.clearcoatRoughness = materialSpring.clearcoatRoughness.get();
      shellMat.current.transmission = materialSpring.transmission.get();
      shellMat.current.ior = 1.3;
      shellMat.current.thickness = materialSpring.thickness.get();
      shellMat.current.attenuationColor.copy(colors.deep);
      shellMat.current.attenuationDistance = materialSpring.attenuationDistance.get();

      // Slight tint change for AI - "The Ghost" is Emerald
      if (aiPulseRef.current > 0.1) {
        shellMat.current.attenuationColor.lerp(new THREE.Color('#00ff88'), aiPulseRef.current * 0.4);
      }
    }

    if (coreMat.current) {
      coreMat.current.uniforms.uTime.value = time;
      coreMat.current.uniforms.uBreath.value = breath;
      coreMat.current.uniforms.uEntropy.value = entropy;
      coreMat.current.uniforms.uDeep.value.copy(colors.deep);
      coreMat.current.uniforms.uMid.value.copy(colors.mid);
      coreMat.current.uniforms.uGlow.value.copy(colors.glow);
      coreMat.current.uniforms.uAccent.value.copy(colors.accent);
      coreMat.current.uniforms.uAiPulse.value = aiPulseRef.current;
    }
  });

  // Re-memoize shader to update octaves when tier changes
  const fragShader = useMemo(() => getFragShader(tier.octaves), [tier.octaves]);

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[1.0, tier.seg, tier.seg]} />
        <meshPhysicalMaterial
          ref={shellMat}
          color={colors.mid}
          metalness={0.0}
          roughness={0.35}
          transmission={0.8}
          thickness={0.5}
          ior={1.3}
          clearcoat={0.8}
          clearcoatRoughness={0.15}
          envMapIntensity={1.1}
          transparent
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[0.72, Math.max(18, Math.floor(tier.seg * 0.8)), Math.max(18, Math.floor(tier.seg * 0.8))]} />
        <shaderMaterial
          ref={coreMat}
          vertexShader={CORE_VERT}
          fragmentShader={fragShader}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{
            uTime: { value: 0 },
            uBreath: { value: 0 },
            uEntropy: { value: 0 },
            uDeep: { value: colors.deep.clone() },
            uMid: { value: colors.mid.clone() },
            uGlow: { value: colors.glow.clone() },
            uAccent: { value: colors.accent.clone() },
            uAiPulse: { value: 0 },
          }}
        />
      </mesh>

      {tier.halo && (
        <mesh>
          <sphereGeometry args={[1.08, Math.max(18, Math.floor(tier.seg * 0.5)), Math.max(18, Math.floor(tier.seg * 0.5))]} />
          <meshBasicMaterial
            color={colors.glow}
            transparent
            opacity={0.08}
            blending={THREE.AdditiveBlending}
            side={THREE.BackSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {tier.ring && (
        <mesh rotation={[Math.PI / 2.2, 0, 0]}>
          <torusGeometry args={[1.15, 0.015, 10, 120]} />
          <meshBasicMaterial
            color={colors.accent}
            transparent
            opacity={0.18}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

export default function OrbBreathVizZenSciFi(props: Props) {
  const tier = useMemo(() => resolveTier(props.quality), [props.quality]);

  return (
    <Canvas
      dpr={tier.dpr}
      camera={{ position: [0, 0, 4.8], fov: 45 }}
      gl={{ antialias: tier.dpr > 1.1, alpha: true, powerPreference: 'high-performance' }}
    >
      {tier.seg >= 44 && <Environment preset="city" />}
      <ambientLight intensity={0.55} />
      <pointLight position={[3, 3, 4]} intensity={1.2} />
      <ZenOrb {...props} />
    </Canvas>
  );
}
