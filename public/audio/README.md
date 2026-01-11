# ZenOne Audio Library

## 🎵 Directory Structure

```
/public/audio/
├── ai-generated/          # ElevenLabs generated breathing sounds
│   ├── inhale-calm-01.mp3
│   ├── inhale-calm-02.mp3
│   ├── inhale-deep-01.mp3
│   ├── exhale-calm-01.mp3
│   ├── exhale-deep-01.mp3
│   ├── hold-silence-01.mp3
│   ├── bell-ting-01.mp3
│   ├── bowl-strike-01.mp3
│   └── ambience-forest.mp3
│
└── soundscapes/           # Multi-layer ambient soundscapes
    ├── forest/
    │   ├── birds.mp3      # Bird chirps (60s loop)
    │   ├── wind.mp3       # Wind through trees (60s loop)
    │   ├── creek.mp3      # Creek water (60s loop)
    │   └── crickets.mp3   # Night crickets (60s loop)
    │
    ├── ocean/
    │   ├── waves.mp3      # Wave crashes (60s loop)
    │   ├── seagulls.mp3   # Seagull calls (60s loop)
    │   └── wind.mp3       # Ocean breeze (60s loop)
    │
    ├── rain/
    │   ├── rain-light.mp3 # Light rain (60s loop)
    │   ├── rain-heavy.mp3 # Heavy rain (60s loop)
    │   └── thunder.mp3    # Distant thunder (60s loop)
    │
    └── fireplace/
        ├── crackle.mp3    # Wood crackling (60s loop)
        └── ambient.mp3    # Fire ambience (60s loop)
```

## 🚀 How to Generate Audio Samples

### Method 1: Using ElevenLabs API (Recommended)

```bash
# Set your API key
export ELEVENLABS_API_KEY="your_key_here"

# Run generation script
npm run generate-audio

# Or manually:
npx tsx scripts/generate-audio-library.ts
```

**Note:** The script was unable to run in this environment due to network restrictions.
Please run it locally on your machine with the API key: `sk_899a39e8e6045a8b45702e702896d08be3a2fefd51945785`

### Method 2: Manual Recording/Download

1. **Breathing Sounds:** Record your own or download from royalty-free libraries:
   - Freesound.org (search: "breathing", "inhale", "exhale")
   - Soundsnap.com
   - AudioJungle.net

2. **Soundscapes:** Download from:
   - MyNoise.net (export custom soundscapes)
   - Freesound.org (search: "forest ambience", "ocean waves", etc.)
   - YouTube Audio Library

### Method 3: Using AI Generation Services

**ElevenLabs Sound Effects:**
- Visit: https://elevenlabs.io/sound-effects
- Generate with prompts from `scripts/generate-audio-library.ts`

**Suno AI / Stable Audio:**
- Alternative AI sound generation services

## 📋 Audio Specifications

All audio files should meet these specs:

- **Format:** MP3 (128-320 kbps) or WAV (48kHz, 16-24 bit)
- **Channels:** Stereo
- **Loop Duration:** 60 seconds (seamless loops for soundscapes)
- **Dynamic Range:** -18 LUFS (breathable, not compressed)
- **Frequency Range:** 60Hz - 12kHz (warm, no harshness)

## ✅ Verification

After adding files, verify the audio system:

```bash
npm run dev
# Navigate to Settings > Audio > Sound Pack
# Select different packs and test playback
```

## 🎨 Current Status

- ✅ Audio engine implemented (synthesis-based)
- ✅ Fallback system active (works without samples)
- ⏳ Sample library pending (generate with ElevenLabs)
- ⏳ Soundscape layers pending (manual addition)

The app **works perfectly without these files** using real-time synthesis.
Adding samples will enhance quality and provide more variety.
