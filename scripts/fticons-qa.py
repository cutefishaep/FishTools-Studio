#!/usr/bin/env python3
"""fticons QA: validasi woff2 + diff raster pra-pico vs pasca-pico (batch)."""
import os, subprocess, json, shutil, glob
from PIL import Image, ImageChops, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

from fontTools.ttLib import TTFont
f = TTFont(os.path.join(ROOT, 'fticons', 'fticons.woff2'))
cmap = f.getBestCmap()
pua = [c for c in cmap if 0xE001 <= c <= 0xF8FF]
print('numGlyphs:', len(f.getGlyphOrder()), '| cmap PUA:', len(pua))

names = sorted(n[:-4] for n in os.listdir('/tmp/ftorig') if n.endswith('.svg'))
os.makedirs('/tmp/ftqa/orig', exist_ok=True)
os.makedirs('/tmp/ftqa/pico', exist_ok=True)

orig_files = [f'/tmp/ftorig/{n}.svg' for n in names]
subprocess.run(['qlmanage', '-t', '-s', '96', '-o', '/tmp/ftqa/orig'] + orig_files,
               capture_output=True)

for n in names:
    shutil.copy(f'/tmp/ftsrc/glyphs/{n}.svg', f'/tmp/ftqa/pico/{n}.pico.svg')
pico_files = sorted(glob.glob('/tmp/ftqa/pico/*.pico.svg'))
subprocess.run(['qlmanage', '-t', '-s', '96', '-o', '/tmp/ftqa/pico'] + pico_files,
               capture_output=True)

diffs = []
for n in names:
    pa, pb = f'/tmp/ftqa/orig/{n}.svg.png', f'/tmp/ftqa/pico/{n}.pico.svg.png'
    if not (os.path.exists(pa) and os.path.exists(pb)):
        diffs.append((n, -1)); continue
    A = Image.open(pa).convert('L')
    B = Image.open(pb).convert('L')
    if A.size != B.size:
        diffs.append((n, -2)); continue
    d = ImageChops.difference(A, B)
    diffs.append((n, ImageStat.Stat(d).mean[0]))

diffs.sort(key=lambda x: -x[1])
print('terburuk 15:')
for n, d in diffs[:15]:
    print(f'  {d:7.2f}  {n}')
bad = [n for n, d in diffs if d > 12]
print('flag diff>12:', len(bad), bad[:40])
missing = [n for n, d in diffs if d < 0]
print('gagal render:', len(missing), missing[:20])
json.dump({'diffs': diffs, 'flag': bad, 'missing': missing},
          open('/tmp/ftsrc/QA.json', 'w'), indent=1)
