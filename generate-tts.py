#!/usr/bin/env python3
"""
NaviTalk TTS Audio Generator
=============================
edge-tts를 사용하여 모든 대화문/단어의 MP3 파일을 사전 생성합니다.
생성된 파일은 audio/ 폴더에 저장되며, audio-map.json 매핑 파일도 생성됩니다.

사용법:
  pip install edge-tts
  python generate-tts.py

옵션:
  --vocab-only    단어만 생성 (빠른 테스트용)
  --limit N       N개만 생성 (테스트용)
"""

import asyncio
import json
import hashlib
import os
import sys
import time

try:
    import edge_tts
except ImportError:
    print("edge-tts가 설치되어 있지 않습니다.")
    print("설치: pip install edge-tts")
    sys.exit(1)

# Korean Neural Voices
VOICE_FEMALE = "ko-KR-SunHiNeural"  # Speaker A (visitor)
VOICE_MALE = "ko-KR-InJoonNeural"   # Speaker B (staff)

AUDIO_DIR = "audio"
RATE = "+25%"
PITCH_FEMALE = "+30Hz"
PITCH_MALE = "-10Hz"

def text_hash(text, speaker):
    """Generate filename hash from text + speaker"""
    key = f"{speaker}:{text}"
    return hashlib.md5(key.encode('utf-8')).hexdigest()[:12]

async def generate_audio(text, speaker, output_path):
    """Generate single TTS audio file"""
    voice = VOICE_FEMALE if speaker == 'A' else VOICE_MALE
    pitch = PITCH_FEMALE if speaker == 'A' else PITCH_MALE
    
    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        rate=RATE,
        pitch=pitch
    )
    await communicate.save(output_path)

async def process_batch(items, batch_size=20):
    """Process items in batches to avoid rate limiting"""
    total = len(items)
    generated = 0
    skipped = 0
    errors = 0
    
    for i in range(0, total, batch_size):
        batch = items[i:i+batch_size]
        tasks = []
        
        for item in batch:
            text, speaker, filepath = item
            if os.path.exists(filepath):
                skipped += 1
                continue
            tasks.append((text, speaker, filepath))
        
        for text, speaker, filepath in tasks:
            try:
                await generate_audio(text, speaker, filepath)
                generated += 1
                progress = generated + skipped + errors
                print(f"  [{progress}/{total}] ✓ {text[:40]}...")
            except Exception as e:
                errors += 1
                print(f"  [{generated + skipped + errors}/{total}] ✗ Error: {text[:30]}... - {e}")
        
        # Small delay between batches
        if i + batch_size < total:
            await asyncio.sleep(0.5)
    
    return generated, skipped, errors

async def main():
    vocab_only = '--vocab-only' in sys.argv
    limit = None
    if '--limit' in sys.argv:
        idx = sys.argv.index('--limit')
        if idx + 1 < len(sys.argv):
            limit = int(sys.argv[idx + 1])
    
    os.makedirs(AUDIO_DIR, exist_ok=True)
    
    # Audio mapping: hash → { text, speaker, file }
    audio_map = {}
    items_to_generate = []
    
    # === Load Vocabulary ===
    print("📖 Loading vocabulary.json...")
    with open('vocabulary.json', 'r', encoding='utf-8') as f:
        vocabulary = json.load(f)
    
    vocab_count = 0
    for loc_key, words in vocabulary.items():
        if not isinstance(words, list):
            continue
        for word in words:
            korean = word.get('korean', '')
            if not korean:
                continue
            h = text_hash(korean, 'A')
            filepath = os.path.join(AUDIO_DIR, f"{h}.mp3")
            audio_map[f"A:{korean}"] = { "hash": h, "file": f"{h}.mp3" }
            items_to_generate.append((korean, 'A', filepath))
            vocab_count += 1
    
    print(f"  → {vocab_count} vocabulary items")
    
    # === Load Dialogues ===
    if not vocab_only:
        print("💬 Loading dialogues.json...")
        with open('dialogues.json', 'r', encoding='utf-8') as f:
            dialogues = json.load(f)
        
        dial_count = 0
        for loc_key, loc_data in dialogues.items():
            scenarios = loc_data.get('scenarios', {})
            for scen_key, lines in scenarios.items():
                if not isinstance(lines, list):
                    continue
                for line in lines:
                    tts_text = line.get('tts', '') or line.get('korean', '')
                    if not tts_text:
                        continue
                    speaker_name = line.get('speaker', 'Customer')
                    # Determine speaker A/B
                    sp = speaker_name.lower()
                    is_visitor = sp in ['customer', 'guest', 'visitor', 'patient', 'buyer', 
                                        'traveler', 'passenger', 'student', 'caller', 'sender',
                                        'client', 'shopper', 'diner', 'tenant', 'applicant',
                                        'parent', 'member', 'viewer', 'user', 'rider',
                                        'borrower', 'newcomer', 'attendee', 'fan']
                    speaker = 'A' if is_visitor else 'B'
                    
                    h = text_hash(tts_text, speaker)
                    filepath = os.path.join(AUDIO_DIR, f"{h}.mp3")
                    audio_map[f"{speaker}:{tts_text}"] = { "hash": h, "file": f"{h}.mp3" }
                    items_to_generate.append((tts_text, speaker, filepath))
                    dial_count += 1
        
        print(f"  → {dial_count} dialogue lines")
    
    # Deduplicate
    seen = set()
    unique_items = []
    for item in items_to_generate:
        key = (item[0], item[1])
        if key not in seen:
            seen.add(key)
            unique_items.append(item)
    
    if limit:
        unique_items = unique_items[:limit]
    
    print(f"\n🎯 Total unique items to generate: {len(unique_items)}")
    
    # Generate audio files
    print(f"\n🔊 Generating audio files with Edge TTS...")
    print(f"   Female voice: {VOICE_FEMALE}")
    print(f"   Male voice: {VOICE_MALE}")
    print(f"   Output: {AUDIO_DIR}/\n")
    
    start = time.time()
    generated, skipped, errors = await process_batch(unique_items)
    elapsed = time.time() - start
    
    print(f"\n✅ Complete! ({elapsed:.1f}s)")
    print(f"   Generated: {generated}")
    print(f"   Skipped (existing): {skipped}")
    print(f"   Errors: {errors}")
    
    # Save audio map
    map_path = os.path.join(AUDIO_DIR, 'audio-map.json')
    with open(map_path, 'w', encoding='utf-8') as f:
        json.dump(audio_map, f, ensure_ascii=False)
    print(f"   Map saved: {map_path} ({len(audio_map)} entries)")
    
    # Calculate total size
    total_size = sum(os.path.getsize(os.path.join(AUDIO_DIR, f)) 
                     for f in os.listdir(AUDIO_DIR) if f.endswith('.mp3'))
    print(f"   Total size: {total_size / 1024 / 1024:.1f} MB")

if __name__ == '__main__':
    asyncio.run(main())
