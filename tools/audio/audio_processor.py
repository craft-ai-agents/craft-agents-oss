#!/usr/bin/env python3
"""
ARCHstudio audio processor — ffmpeg wrapper for beat rendering, mixing,
time-stretching, pitch-shifting, trimming, and normalization.

Usage:
    python audio_processor.py --operation <op> [options]

Operations:
    stretch   — time-stretch audio by a ratio (1.0 = original, 0.5 = half speed)
    transpose — pitch-shift audio by semitones
    trim      — trim audio from start to end (seconds)
    normalize — normalize peak to 0 dB
    mix       — mix multiple audio files into one output
    beat      — render a beat pattern to WAV

Prints JSON progress to stdout, errors to stderr (same protocol as stem_splitter.py).
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


def emit_progress(progress: float, stage: str, **extra):
    payload = {"progress": progress, "stage": stage, **extra}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def emit_error(message: str):
    sys.stderr.write(json.dumps({"error": message}) + "\n")
    sys.stderr.flush()


def ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def run_ffmpeg(args: list[str], progress: float, stage: str):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        emit_error(f"ffmpeg failed: {result.stderr[:500]}")
        sys.exit(1)
    emit_progress(progress, stage)


def op_stretch(args):
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ratio = float(args.ratio)

    if ratio <= 0:
        emit_error("Ratio must be positive")
        sys.exit(1)

    atempo = ratio
    atempo_filters = []
    while atempo > 2.0:
        atempo_filters.append("atempo=2.0")
        atempo /= 2.0
    while atempo < 0.5:
        atempo_filters.append("atempo=0.5")
        atempo *= 2.0
    atempo_filters.append(f"atempo={atempo:.6f}")
    atempo_chain = ",".join(atempo_filters)

    emit_progress(0.2, "stretching")
    run_ffmpeg([
        "ffmpeg", "-y", "-i", str(input_path),
        "-filter:a", atempo_chain,
        "-vn", str(output_path)
    ], 0.9, "done", output=str(output_path))


def op_transpose(args):
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    semitones = float(args.semitones)

    cents = semitones * 100
    emit_progress(0.2, "transposing")
    run_ffmpeg([
        "ffmpeg", "-y", "-i", str(input_path),
        "-filter:a", f"asetrate=44100*{2**(cents/1200)},aresample=44100",
        "-vn", str(output_path)
    ], 0.9, "done", output=str(output_path))


def op_trim(args):
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    start = float(args.start)
    duration = float(args.duration)

    emit_progress(0.2, "trimming")
    run_ffmpeg([
        "ffmpeg", "-y", "-i", str(input_path),
        "-ss", str(start), "-t", str(duration),
        "-c", "copy", str(output_path)
    ], 0.9, "done", output=str(output_path))


def op_normalize(args):
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    emit_progress(0.2, "normalizing")
    run_ffmpeg([
        "ffmpeg", "-y", "-i", str(input_path),
        "-filter:a", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-vn", str(output_path)
    ], 0.9, "done", output=str(output_path))


def op_mix(args):
    inputs = json.loads(args.inputs)
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not inputs:
        emit_error("No inputs provided for mix")
        sys.exit(1)

    ff_args = ["ffmpeg", "-y"]
    for item in inputs:
        ff_args.extend(["-i", str(Path(item["path"]).resolve())])

    n = len(inputs)
    filter_parts = []
    for idx, item in enumerate(inputs):
        gain = float(item.get("gain", 1.0))
        pan = float(item.get("pan", 0.0))
        left = gain * (1.0 - max(0.0, pan)) * 0.5
        right = gain * (1.0 + min(0.0, -pan)) * 0.5
        filter_parts.append(f"[{idx}:a]volume={gain:.4f},pan=stereo|c0={left:.4f}|c1={right:.4f}[a{idx}]")

    mix_inputs = "".join(f"[a{idx}]" for idx in range(n))
    filter_parts.append(f"{mix_inputs}amix=inputs={n}:duration=longest[aout]")
    filter_complex = ";".join(filter_parts)

    emit_progress(0.2, "mixing")
    run_ffmpeg([
        *ff_args,
        "-filter_complex", filter_complex,
        "-map", "[aout]",
        str(output_path)
    ], 0.9, "done", output=str(output_path))


def op_beat(args):
    """
    Render a beat pattern to WAV using pure Python wave generation.
    Pattern format (JSON):
    {
        "bpm": 120,
        "bars": 1,
        "steps": 16,
        "tracks": [
            {"name": "kick",  "sample": "kick",  "steps": [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]},
            {"name": "snare", "sample": "snare", "steps": [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0]},
            ...
        ]
    }

    Built-in samples are synthesized (sine + noise bursts) so no external
    sample packs are needed for a first version.
    """
    import math
    import struct

    pattern = json.loads(args.pattern)
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    bpm = int(pattern.get("bpm", 120))
    bars = int(pattern.get("bars", 1))
    steps_per_bar = int(pattern.get("steps", 16))
    tracks = pattern.get("tracks", [])

    sample_rate = 44100
    step_duration = 60.0 / bpm / (steps_per_bar / 4)  # seconds per step
    total_steps = steps_per_bar * bars
    total_samples = int(sample_rate * step_duration * total_steps)

    buffer = [0.0] * total_samples

    def synth_kick(t):
        freq = 150.0 * math.exp(-t * 30)
        return 0.8 * math.sin(2 * math.pi * freq * t) * math.exp(-t * 8)

    def synth_snare(t):
        noise = (hash(t * 1e6) % 1000 / 500.0 - 1.0)
        tone = math.sin(2 * math.pi * 200 * t)
        return 0.5 * (noise * 0.7 + tone * 0.3) * math.exp(-t * 15)

    def synth_hihat(t):
        noise = (hash(t * 1e7) % 1000 / 500.0 - 1.0)
        return 0.3 * noise * math.exp(-t * 40)

    def synth_clap(t):
        noise = (hash(t * 1e6) % 1000 / 500.0 - 1.0)
        return 0.4 * noise * math.exp(-t * 20)

    def synth_bass(t, freq=80):
        return 0.6 * math.sin(2 * math.pi * freq * t) * math.exp(-t * 5)

    synths = {
        "kick": synth_kick,
        "snare": synth_snare,
        "hihat": synth_hihat,
        "clap": synth_clap,
        "bass": synth_bass,
    }

    emit_progress(0.2, "rendering_beat")

    for track in tracks:
        sample_name = track.get("sample", "kick")
        synth = synths.get(sample_name, synth_kick)
        step_pattern = track.get("steps", [])
        volume = float(track.get("volume", 1.0))
        extra = track.get("freq")

        for step_idx, active in enumerate(step_pattern):
            if not active:
                continue
            start_sample = int(step_idx * step_duration * sample_rate)
            hit_duration = min(0.3, step_duration)
            hit_samples = int(hit_duration * sample_rate)
            for s in range(hit_samples):
                pos = start_sample + s
                if pos >= total_samples:
                    break
                t = s / sample_rate
                if extra:
                    buffer[pos] += volume * synth(t, freq=float(extra))
                else:
                    buffer[pos] += volume * synth(t)

    emit_progress(0.7, "writing_wav")

    with wave.open(str(output_path), "w") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for sample in buffer:
            clamped = max(-1.0, min(1.0, sample))
            wav_file.writeframes(struct.pack("<h", int(clamped * 32767)))

    emit_progress(1.0, "done", output=str(output_path))


def main():
    if not ffmpeg_available():
        emit_error("ffmpeg not found on PATH. Install ffmpeg to use audio processing.")
        sys.exit(1)

    parser = argparse.ArgumentParser(description="ARCHstudio audio processor")
    parser.add_argument("--operation", required=True,
                        choices=["stretch", "transpose", "trim", "normalize", "mix", "beat"])
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--ratio", type=float)
    parser.add_argument("--semitones", type=float)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--duration", type=float)
    parser.add_argument("--inputs", help="JSON array for mix operation")
    parser.add_argument("--pattern", help="JSON beat pattern for beat operation")
    args = parser.parse_args()

    ops = {
        "stretch": op_stretch,
        "transpose": op_transpose,
        "trim": op_trim,
        "normalize": op_normalize,
        "mix": op_mix,
        "beat": op_beat,
    }
    handler = ops.get(args.operation)
    if handler:
        handler(args)
    else:
        emit_error(f"Unknown operation: {args.operation}")
        sys.exit(1)


if __name__ == "__main__":
    main()