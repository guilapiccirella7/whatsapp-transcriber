#!/usr/bin/env python3
"""
Whisper transcription script — called by the WhatsApp bot.
Usage: python3 transcribe.py <audio_file_path>
Outputs JSON: { "transcription": "...", "summary": "..." }
"""

import sys
import os
import json
import re

# Add ffmpeg from imageio to PATH
try:
    import imageio_ffmpeg
    ffmpeg_dir = os.path.dirname(imageio_ffmpeg.get_ffmpeg_exe())
    home_dir = os.path.expanduser("~")
    os.environ["PATH"] = ffmpeg_dir + ":" + home_dir + ":" + os.environ.get("PATH", "")
except Exception:
    home_dir = os.path.expanduser("~")
    os.environ["PATH"] = home_dir + ":" + os.environ.get("PATH", "")

import whisper


def summarize(text: str) -> str:
    """Simple extractive summarizer — no external API needed."""
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if len(s.strip()) > 20]
    if not sentences:
        return text[:300]

    # Score by position (first/last sentences carry more weight) + length
    scored = []
    n = len(sentences)
    for i, s in enumerate(sentences):
        pos_score = 1.5 if i == 0 else (1.2 if i == n - 1 else 1.0)
        len_score = min(len(s) / 80, 1.5)
        scored.append((pos_score * len_score, s))

    scored.sort(reverse=True)

    # Pick top sentences (max 3, or fewer for short audios)
    limit = 2 if n <= 4 else 3
    top = [s for _, s in scored[:limit]]

    # Re-order by original position
    ordered = [s for s in sentences if s in top]
    return " ".join(ordered)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No audio file provided"}))
        sys.exit(1)

    audio_path = sys.argv[1]

    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)

    try:
        model = whisper.load_model("small")
        result = model.transcribe(audio_path, language="pt")
        transcription = result["text"].strip()
        summary = summarize(transcription)

        output = {
            "transcription": transcription,
            "summary": summary
        }
        print(json.dumps(output, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
