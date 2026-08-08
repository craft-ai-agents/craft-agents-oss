#!/usr/bin/env python3
"""
ARCHstudio stem splitter — Demucs wrapper.

Usage:
    python stem_splitter.py --input <audio_file> [--model htdemucs] [--output-dir <dir>] [--job-id <id>]

Outputs 4 stems into <output-dir>/<job-id>/:
    vocals.wav  drums.wav  bass.wav  other.wav

Prints JSON progress lines to stdout for the server to parse:
    {"progress": 0.25, "stage": "loading_model"}
    {"progress": 0.50, "stage": "separating"}
    {"progress": 1.00, "stage": "done", "stems": {...}}

Errors print to stderr and exit non-zero:
    {"error": "message"}
"""

import argparse
import json
import os
import sys
from pathlib import Path


def emit_progress(progress: float, stage: str, **extra):
    payload = {"progress": progress, "stage": stage, **extra}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def emit_error(message: str):
    sys.stderr.write(json.dumps({"error": message}) + "\n")
    sys.stderr.flush()


def main():
    parser = argparse.ArgumentParser(description="ARCHstudio stem splitter")
    parser.add_argument("--input", required=True, help="Input audio file")
    parser.add_argument("--model", default="htdemucs", help="Demucs model name")
    parser.add_argument("--output-dir", required=True, help="Output directory for stems")
    parser.add_argument("--job-id", default="default", help="Job identifier")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        emit_error(f"Input file not found: {input_path}")
        sys.exit(1)

    output_dir = Path(args.output_dir) / args.job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        emit_progress(0.05, "loading_model")
        import torch
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        import torchaudio

        emit_progress(0.15, "model_loaded")
        model = get_model(args.model)
        model.eval()

        if torch.cuda.is_available():
            model = model.cuda()
            device = "cuda"
        else:
            device = "cpu"

        emit_progress(0.20, "loading_audio")
        wav, sr = torchaudio.load(str(input_path))
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        wav = wav.unsqueeze(0)
        if device == "cuda":
            wav = wav.cuda()

        emit_progress(0.30, "separating")
        with torch.no_grad():
            sources = apply_model(model, wav, split=True, overlap=0.25)

        emit_progress(0.85, "saving_stems")
        stem_names = ["drums", "bass", "other", "vocals"]
        stem_paths = {}
        for idx, name in enumerate(stem_names):
            stem_wav = sources[0, idx].cpu()
            stem_path = output_dir / f"{name}.wav"
            torchaudio.save(str(stem_path), stem_wav, sr)
            stem_paths[name] = str(stem_path)

        emit_progress(1.0, "done", stems=stem_paths)

    except ImportError as e:
        emit_error(f"Missing dependency: {e}. Install with: pip install -r tools/audio/requirements.txt")
        sys.exit(1)
    except Exception as e:
        emit_error(str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()