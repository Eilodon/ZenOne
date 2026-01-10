
import fs from 'fs';
import path from 'path';

/**
 * AUDIO GENERATION SCRIPT
 * 
 * Usage:
 * set ELEVENLABS_API_KEY=your_key
 * npx tsx scripts/generate-audio-library.ts
 */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!ELEVENLABS_API_KEY) {
    console.error('❌ Error: ELEVENLABS_API_KEY environment variable is missing.');
    process.exit(1);
}

const OUTPUT_DIR = path.join(process.cwd(), 'public', 'audio', 'ai-generated');

const GENERATION_QUEUE = [
    // Inhale variations
    { id: 'inhale-calm-01', prompt: 'Soft nasal inhale, 4 seconds, calm, ASMR', duration: 4 },
    { id: 'inhale-calm-02', prompt: 'Gentle mouth inhale, 4 seconds, peaceful', duration: 4 },
    { id: 'inhale-deep-01', prompt: 'Deep diaphragmatic inhale, 5 seconds, yoga breathing', duration: 5 },

    // Exhale variations
    { id: 'exhale-calm-01', prompt: 'Slow mouth exhale, 6 seconds, relaxed sigh', duration: 6 },
    { id: 'exhale-deep-01', prompt: 'Long controlled exhale, 8 seconds, meditation', duration: 8 },

    // Holds
    { id: 'hold-silence-01', prompt: 'Quiet room tone, subtle breath hold, 3 seconds', duration: 3 },

    // Bells
    { id: 'bell-ting-01', prompt: 'Crystal bell chime, single strike, 3 seconds decay, 440Hz', duration: 3 },
    { id: 'bowl-strike-01', prompt: 'Tibetan singing bowl, wooden striker, warm resonance', duration: 5 },

    // Ambient
    { id: 'ambience-forest', prompt: 'Gentle forest ambience, birds distant, soft wind, peaceful', duration: 30 }
];

async function generateAudio(prompt: string, duration: number): Promise<Buffer> {
    console.log(`🎙️ Generating: "${prompt}"...`);

    const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: {
            'xi-api-key': ELEVENLABS_API_KEY!,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: prompt,
            duration_seconds: duration,
            prompt_influence: 0.5
        })
    });

    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function main() {
    console.log('🚀 Starting ZenOne Audio Generation...');

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`Created directory: ${OUTPUT_DIR}`);
    }

    for (const item of GENERATION_QUEUE) {
        const filepath = path.join(OUTPUT_DIR, `${item.id}.mp3`);

        if (fs.existsSync(filepath)) {
            console.log(`⏭️  Skipping existing: ${item.id}`);
            continue;
        }

        try {
            const start = Date.now();
            const audioBuffer = await generateAudio(item.prompt, item.duration);
            fs.writeFileSync(filepath, audioBuffer);
            const rtf = (Date.now() - start) / 1000;
            console.log(`✅ Saved: ${item.id}.mp3 (${rtf.toFixed(1)}s)`);

            // Rate limit: Wait 2s between requests
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
            console.error(`❌ Failed: ${item.id}`, error);
        }
    }

    console.log('\n🎉 Generation complete! Assets range check:');
    const files = fs.readdirSync(OUTPUT_DIR);
    console.log(`Total files: ${files.length} in ${OUTPUT_DIR}`);
}

main().catch(console.error);
