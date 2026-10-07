#!/usr/bin/env python3
"""fticons phase 2: ganti refs SVG -> font, migrasi CSS, hapus aset termakan.
Jalankan: python3 scripts/fticons-apply.py [--dry]
Adaftasi: --dry hanya lapor, tanpa tulis/hapus.
"""
import re, os, glob, json, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = '--dry' in sys.argv
MANI = json.load(open('/tmp/ftsrc/MANIFEST.json'))

# hash -> glyph dari staging pra-pico
import hashlib
def norm_inner(inner):
    return re.sub(r'\s+', ' ', inner).strip()

def load_orig_hashes():
    m = {}
    for p in glob.glob('/tmp/ftorig/*.svg'):
        name = os.path.basename(p)[:-4]
        s = open(p, encoding='utf-8').read()
        inner = s[s.index('>') + 1:s.rindex('<')]
        h = hashlib.md5(norm_inner(inner).encode()).hexdigest()
        m[h] = name
    return m

HASH2NAME = load_orig_hashes()
# nama glyph <- file aset (untuk span svg-icon-*)
FILE2NAME = {v: k for k, v in MANI['manifest'].items() if v.startswith('assets/')}

# suffix class -> file aset (dari aturan mask CSS)
SUF2FILE = {}
for cf in glob.glob(os.path.join(ROOT, 'css', '*.css')):
    css = open(cf, encoding='utf-8').read()
    for m in re.finditer(r'\.svg-icon-([a-z0-9-]+)\s*\{[^}]*?url\([\'"]?([^\'")]+)[\'"]?\)', css):
        SUF2FILE[m.group(1)] = os.path.basename(m.group(2).split('?')[0])

PICK = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
        'fill-rule', 'clip-rule', 'stroke-dasharray']
def svg_attrs(tag):
    return {a: m.group(1) for a in PICK for m in [re.search(r'\b' + a + r'="([^"]+)"', tag)] if m}

def to24(vb, inner, attrs=None):
    if vb == 'NONE':
        return None
    try:
        x, y, w, h = map(float, vb.split())
    except ValueError:
        return None
    if max(w, h) / max(min(w, h), 1e-6) > 1.6:
        return None
    s = 24.0 / max(w, h)
    tx, ty = (24 - w * s) / 2 - x * s, (24 - h * s) / 2 - y * s
    inner2 = re.sub(r'\sclass="[^"]*"', '', inner)
    if vb == '0 0 24 24' and not attrs:
        g = f'<g>{inner2}</g>'
    else:
        extra = ''.join(f' {k}="{v}"' for k, v in (attrs or {}).items())
        g = f'<g transform="translate({tx:.3f} {ty:.3f}) scale({s:.4f})"{extra}>{inner2}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">{g}</svg>'

def glyph_of(vb, inner, tag):
    svg24 = to24(vb, inner, svg_attrs(tag))
    if svg24 is None:
        return None
    inner24 = svg24[svg24.index('>') + 1:svg24.rindex('<')]
    return HASH2NAME.get(hashlib.md5(norm_inner(inner24).encode()).hexdigest())

stats = {'span': 0, 'inline': 0, 'inline_left': [], 'span_left': [], 'jsq': {}}

def pick_quote(pre):
    """Pilih quote attr yang aman berdasar konteks JS/HTML."""
    idx = {q: pre.rfind(q) for q in ['"', "'", '`']}
    # hindari quote yang di-escape
    for q in list(idx):
        i = idx[q]
        if i >= 0 and i > 0 and pre[i - 1] == '\\':
            idx[q] = -1
    outer = max(idx, key=lambda q: idx[q])
    if idx[outer] < 0:
        return '"'
    return "'" if outer == '"' else '"'

def i_tag(name, cls_extra='', style_extra='', q='"'):
    cls = f'fticon fticon-{name}' + (f' {cls_extra}' if cls_extra else '')
    st = f' style={q}{style_extra}{q}' if style_extra else ''
    return f'<i class={q}{cls}{q}{st} aria-hidden={q}true{q}></i>'

def repl_inline(m, pre):
    full = m.group(0)
    if '${' in full:
        return full
    tag = full[:full.index('>') + 1]
    v = re.search(r'viewBox="([^"]+)"', tag)
    name = glyph_of(v.group(1) if v else 'NONE', full[full.index('>') + 1:full.rindex('<')], tag)
    if not name:
        stats['inline_left'].append(full[:70])
        return full
    q = pick_quote(pre)
    cls = (re.search(r'class="([^"]+)"', tag) or re.search(r"class='([^']+)'", tag))
    cls_extra = cls.group(1) if cls else ''
    w = re.search(r'width="(\d+)"', tag)
    h = re.search(r'height="(\d+)"', tag)
    st = ''
    if w and h:
        st = f'width:{w.group(1)}px;height:{h.group(1)}px;font-size:{h.group(1)}px;line-height:1;'
    elif cls_extra:
        st = ''
    else:
        st = 'font-size:16px;line-height:1;'
    old_st = re.search(r'style="([^"]+)"', tag)
    if old_st:
        st = (old_st.group(1).rstrip(';') + ';' + st) if st else old_st.group(1)
    stats['inline'] += 1
    stats['jsq'][q] = stats['jsq'].get(q, 0) + 1
    return i_tag(name, cls_extra, st, q)

def repl_span(m):
    suf = m.group(1)
    fn = SUF2FILE.get(suf)
    name = FILE2NAME.get('assets/' + fn) if fn else None
    if not name:
        stats['span_left'].append(suf)
        return m.group(0)
    stats['span'] += 1
    return f'fticon fticon-{name}'

TARGETS = ['editor.html', 'desktop.html'] + glob.glob('js/*.js') + glob.glob('effects/*.js')
for f in TARGETS:
    p = os.path.join(ROOT, f)
    src = open(p, encoding='utf-8', errors='replace').read()
    # 1. span svg-icon-*
    src = re.sub(r'svg-icon-([a-z0-9-]+)', repl_span, src)
    # 2. sisa class dasar svg-icon -> fticon (hati-hati prefix sudah diganti)
    src = re.sub(r'(?<![\w-])svg-icon(?![\w-])', 'fticon', src)
    # 3. inline svg
    out = []
    last = 0
    for m in re.finditer(r'<svg\b[^>]*>.*?</svg>', src, re.S):
        out.append(src[last:m.start()])
        out.append(repl_inline(m, src[max(0, m.start() - 200):m.start()]))
        last = m.end()
    out.append(src[last:])
    new = ''.join(out)
    if new != src and not DRY:
        open(p, 'w', encoding='utf-8').write(new)
    print(f'{f}: span={stats["span"]} inline-total={stats["inline"]}')

print('span tak petakan:', sorted(set(stats['span_left'])))
print('inline tersisa contoh:', len(stats['inline_left']))
print('quote pakai:', stats['jsq'])
json.dump(stats, open('/tmp/ftsrc/APPLY.json', 'w'), indent=1)
