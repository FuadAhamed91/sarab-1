"""Saves every texture drawn by textures.html as a PNG in textures/, using headless Chrome.

  python hardware/blender/render_textures.py               every texture
  python hardware/blender/render_textures.py decal solar   just these

Needs an internet connection for the web fonts. Set CHROME to the browser's path if it isn't found.
Rebuild the Blender model afterwards (see build_sarab1.py) so the website picks the new textures up.
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PAGE = HERE / 'textures.html'
OUT = HERE / 'textures'
CHROME = os.environ.get('CHROME') or next((p for p in (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium') if os.path.exists(p)), None)

sizes = {k: (int(w), int(h)) for k, w, h in re.findall(r'^\s*(\w+): \[(\d+), (\d+), g =>', PAGE.read_text(encoding='utf-8'), re.M)}
if not CHROME:
    sys.exit('Chrome not found: set CHROME to its path')
OUT.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as profile:
    for key in sys.argv[1:] or sizes:
        w, h = sizes[key]
        subprocess.run([CHROME, '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', f'--user-data-dir={profile}',
                        f'--window-size={w},{h}', '--virtual-time-budget=8000', f'--screenshot={OUT / (key + ".png")}',
                        f'{PAGE.as_uri()}#{key}'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f'{key}.png  {w} x {h}')
