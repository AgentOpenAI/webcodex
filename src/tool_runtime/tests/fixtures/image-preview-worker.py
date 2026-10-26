#!/usr/bin/python3
"""Synthetic process fixture; no production credentials, network or user files."""
from pathlib import Path
import subprocess
import sys
import time

marker = Path(sys.argv[-1])
sys.stdin.buffer.read()
if marker.name == "pipes":
    subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], stdin=subprocess.DEVNULL)
    sys.stdout.buffer.write(b'{"width":1,"height":1,"static_frame":false}\nRIFF\0\0\0\0WEBP')
    sys.stdout.buffer.flush()
elif marker.name == "stderr":
    sys.stderr.buffer.write(b'x' * 1000000)
    sys.stderr.buffer.flush()
    time.sleep(60)
else:
    marker.write_text("stdin EOF observed")
    time.sleep(60)
