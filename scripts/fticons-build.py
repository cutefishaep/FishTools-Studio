#!/usr/bin/env python3
"""fticons build phase 1: inventory -> staging SVGs -> picosvg -> fantasticon.
Staging di /tmp/ftsrc (dibuang setelah build). Output: fticons/fticons.woff2 + fticons.css
Review: MANIFEST.json + SKIP.json di /tmp/ftsrc.
"""
import re, os, glob, json, hashlib, subprocess, sys, shutil

ROOT = os.environ.get('FTROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # output selalu ke repo
STAGE = '/tmp/ftsrc'
os.makedirs(STAGE, exist_ok=True)

ASSET_MAP = {
 'beatmark.svg':'beatmark','category-media.svg':'media-category','checkerboard.svg':'checkerboard',
 'chevron-down.svg':'chevron-down','chevron-left.svg':'chevron-left','chevron-right.svg':'chevron-right',
 'chevron-up.svg':'chevron-up','control-solid.svg':'layer-solid','copy.svg':'copy','cut-left.svg':'cut-left',
 'cut-mid.svg':'cut-middle','cut-right.svg':'cut-right','freeze-frame.svg':'freeze-frame','icon-3d.svg':'badge-3d',
 'icon-camera-lens-blur.svg':'lens-blur','icon-check.svg':'check','icon-export.svg':'export','icon-eye-off.svg':'eye-off',
 'icon-eye.svg':'eye','icon-grid.svg':'grid','icon-motion-blur.svg':'motion-blur','icon-palette.svg':'palette',
 'icon-particles.svg':'particles','icon-pitch.svg':'rotate-x','icon-reorder.svg':'reorder','icon-roll.svg':'rotate-z',
 'icon-yaw.svg':'rotate-y','layer-expand-left.svg':'expand-left','layer-expand-right.svg':'expand-right',
 'layer-move-left.svg':'move-left','layer-move-right.svg':'move-right','layer-null.svg':'layer-null',
 'lightning.svg':'lightning','magnet.svg':'magnet','more.svg':'more','next.svg':'next','paste.svg':'paste',
 'pause.svg':'pause','pickwhip.svg':'pickwhip','play.svg':'play','plus.svg':'plus','prev.svg':'previous',
 'primitive-box.svg':'box','redo.svg':'redo','speed.svg':'speed','track-adjustment.svg':'track-adjustment',
 'track-audio.svg':'track-audio','track-video.svg':'track-video','undo.svg':'undo','volume-mute.svg':'volume-mute',
 'volume.svg':'volume',
}

def slug(s, fb='icon'):
    s = re.sub(r'&amp;', '&', s)
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()[:40].strip('-')
    return s or fb

used_names, manifest, skipped = set(), {}, []
def claim(base):
    n, i = base, 2
    while n in used_names:
        n = f'{base}-{i}'; i += 1
    used_names.add(n)
    return n

PICK_ATTRS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
               'fill-rule', 'clip-rule', 'stroke-dasharray']

def norm_inner(inner):
    return re.sub(r'\s+', ' ', inner).strip()

def svg_attrs(tag):
    out = {}
    for a in PICK_ATTRS:
        m = re.search(r'\b' + a + r'="([^"]+)"', tag)
        if m:
            out[a] = m.group(1)
    return out

def g_open(attrs):
    return '<g>' if not attrs else '<g ' + ' '.join(f'{k}="{v}"' for k, v in attrs.items()) + '>'

def paint_ok(inner):
    """Font tak bisa: gradient, pattern, clipPath, opacity<1, var()/url()/hex paint.
    id= menandakan elemen interaktif (diubah JS) -> jangan font-kan."""
    if re.search(r'<(linearGradient|radialGradient|pattern|clipPath|mask|image)', inner): return False
    if re.search(r'\bid\s*=', inner): return False
    if re.search(r'fill-opacity|stroke-opacity|opacity\s*=\s*"0', inner): return False
    if re.search(r'fill\s*=\s*"(?!none\b|currentColor\b)[^"]+"', inner): return False
    if re.search(r'stroke\s*=\s*"(?!none\b|currentColor\b)[^"]+"', inner): return False
    if 'url(' in inner: return False
    return True

def to24(vb, inner, attrs=None):
    """Bungkus inner ke viewBox 24x24. Return None bila aspek ekstrem."""
    if vb == 'NONE': return None
    try: x, y, w, h = map(float, vb.split())
    except ValueError: return None
    if max(w, h) / max(min(w, h), 1e-6) > 1.6: return None
    s = 24.0 / max(w, h)
    tx = (24 - w * s) / 2 - x * s
    ty = (24 - h * s) / 2 - y * s
    inner2 = re.sub(r'\sclass="[^"]*"', '', inner)
    if vb == '0 0 24 24' and not attrs:
        g = f'<g>{inner2}</g>'
    else:
        extra = ''.join(f' {k}="{v}"' for k, v in (attrs or {}).items())
        g = f'<g transform="translate({tx:.3f} {ty:.3f}) scale({s:.4f})"{extra}>{inner2}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">{g}</svg>'

seen_content = {}
def add_glyph(name, svg24, src):
    h = hashlib.md5(norm_inner(svg24).encode()).hexdigest()
    if h in seen_content:
        manifest.setdefault('_dup', []).append({'name': name, 'same_as': seen_content[h], 'src': src})
        return seen_content[h]
    seen_content[h] = name
    with open(os.path.join(STAGE, name + '.svg'), 'w', encoding='utf-8') as f:
        f.write(svg24)
    manifest[name] = src
    return name

# 1. Aset terpakai 24x24
allref = ' '.join(open(os.path.join(ROOT, f), encoding='utf-8').read()
    for f in ['editor.html', 'desktop.html']
    + ['css/' + x for x in os.listdir(os.path.join(ROOT, 'css')) if x.endswith('.css')]
    + ['js/' + x for x in os.listdir(os.path.join(ROOT, 'js')) if x.endswith('.js')])
used_assets = sorted(set(re.findall(r'assets/([a-z0-9-]+\.svg)', allref)))
for a in used_assets:
    p = os.path.join(ROOT, 'assets', a)
    if not os.path.exists(p):
        skipped.append({'name': a, 'why': 'file hilang di disk (referensi putus)', 'src': 'assets/' + a})
        continue
    s = open(p, encoding='utf-8').read()
    m = re.search(r'viewBox="([^"]+)"', s)
    vb = m.group(1) if m else 'NONE'
    if vb != '0 0 24 24':
        skipped.append({'name': a, 'why': f'viewBox {vb}, kecualikan (bukan ikon 24)'})
        continue
    if a not in ASSET_MAP:
        skipped.append({'name': a, 'why': 'tanpa mapping nama'}); continue
    inner = s[s.index('>') + 1:s.rindex('<')]
    root = s[:s.index('>') + 1]
    name = claim(ASSET_MAP[a])
    if not paint_ok(inner):
        skipped.append({'name': name, 'why': 'paint non-monokrom', 'src': 'assets/' + a}); continue
    add_glyph(name, to24('0 0 24 24', inner, svg_attrs(root)), 'assets/' + a)

# 2. Inline HTML/JS
files = ['editor.html', 'desktop.html'] + glob.glob('js/*.js') + glob.glob('effects/*.js')
for f in files:
    src = open(os.path.join(ROOT, f), encoding='utf-8', errors='replace').read()
    for m in re.finditer(r'<svg\b[^>]*>.*?</svg>', src, re.S):
        full = m.group(0)
        if '${' in full:
            skipped.append({'name': '?', 'why': 'template dinamis ${}', 'src': f}); continue
        tag = full[:full.index('>') + 1]
        v = re.search(r'viewBox="([^"]+)"', tag)
        vb = v.group(1) if v else 'NONE'
        inner = full[full.index('>') + 1:full.rindex('<')]
        if len(norm_inner(inner)) < 20:
            skipped.append({'name': '?', 'why': 'kosong', 'src': f}); continue
        if not paint_ok(inner):
            skipped.append({'name': '?', 'why': 'paint non-monokrom/gradient/opacity', 'src': f,
                            'ctx': inner[:60]}); continue
        svg24 = to24(vb, inner, svg_attrs(tag))
        if svg24 is None:
            skipped.append({'name': '?', 'why': f'viewBox {vb} non-ikon', 'src': f,
                            'ctx': inner[:60]}); continue
        pre = src[max(0, m.start() - 600):m.start()]
        t = re.findall(r'(?:title|aria-label)="([^"]+)"', pre)
        i = re.findall(r'id="([^"]+)"', pre)
        ctx = (t[-1] if t else (i[-1] if i else 'icon'))[:60]
        base = slug(ctx)
        h = hashlib.md5(norm_inner(svg24).encode()).hexdigest()
        if h in seen_content:
            manifest.setdefault('_dup', []).append({'name': base, 'same_as': seen_content[h], 'src': f + ' :: ' + ctx})
            continue
        name = claim(base)
        add_glyph(name, svg24, f + ' :: ' + ctx)

names = sorted(n for n in manifest if not n.startswith('_'))
print('glyph unik:', len(names))
print('duplikat konten:', len(manifest.get('_dup', [])))
print('skip:', len(skipped))

# 3. picosvg expand strokes (simpan pra-pico untuk QA)
fails = []
os.makedirs('/tmp/ftorig', exist_ok=True)
for n in names:
    p = os.path.join(STAGE, n + '.svg')
    shutil.copy(p, os.path.join('/tmp/ftorig', n + '.svg'))
    r = subprocess.run(['picosvg', p], capture_output=True, text=True)
    if r.returncode != 0 or '<path' not in r.stdout:
        fails.append(n); continue
    open(p, 'w', encoding='utf-8').write(r.stdout)
print('picosvg gagal:', fails)

# 4. codepoints + fantasticon (input dir + config file)
GLYPHS = os.path.join(STAGE, 'glyphs')
os.makedirs(GLYPHS, exist_ok=True)
for n in names:
    shutil.move(os.path.join(STAGE, n + '.svg'), os.path.join(GLYPHS, n + '.svg'))
cps = {n: 0xE001 + i for i, n in enumerate(names)}
cfg = {'name': 'fticons', 'fontTypes': ['woff2'], 'assetTypes': ['css'],
       'prefix': 'fticon', 'tag': 'i', 'codepoints': cps,
       'fontsUrl': '', 'normalize': True}
open(os.path.join(STAGE, '.fantasticonrc.json'), 'w').write(json.dumps(cfg))
outdir = os.path.join(OUTROOT, 'fticons')
os.makedirs(outdir, exist_ok=True)
svgs = [os.path.join(GLYPHS, n + '.svg') for n in names]
r = subprocess.run(['fantasticon', GLYPHS, '--output', outdir,
                    '--config', os.path.join(STAGE, '.fantasticonrc.json')],
                   capture_output=True, text=True)
# selektor agnostik elemen (span hasil konversi juga harus kena font)
_css = os.path.join(outdir, 'fticons.css')
_s = open(_css, encoding='utf-8').read()
_s = _s.replace('i[class^="fticon-"]:before, i[class*=" fticon-"]:before',
                '[class^="fticon-"]:before, [class*=" fticon-"]:before')
open(_css, 'w', encoding='utf-8').write(_s)
print('fantasticon rc:', r.returncode)
print((r.stdout + r.stderr)[-1500:])
json.dump({'manifest': {n: manifest[n] for n in names}, 'dup': manifest.get('_dup', []),
           'codepoints': {n: hex(c) for n, c in cps.items()}},
          open(os.path.join(STAGE, 'MANIFEST.json'), 'w'), indent=1, ensure_ascii=False)
json.dump(skipped, open(os.path.join(STAGE, 'SKIP.json'), 'w'), indent=1, ensure_ascii=False)
print('tulis:', os.listdir(outdir))
