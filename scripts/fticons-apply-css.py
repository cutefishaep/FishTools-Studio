#!/usr/bin/env python3
"""fticons phase 2b: migrasi CSS (.svg-icon -> .fticon) + <link> font.
Jalankan: python3 scripts/fticons-apply-css.py [--dry]
"""
import re, os, glob, json, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = '--dry' in sys.argv
MANI = json.load(open('/tmp/ftsrc/MANIFEST.json'))
FILE2NAME = {v: k for k, v in MANI['manifest'].items() if v.startswith('assets/')}

SUF2FILE = {}
for cf in glob.glob(os.path.join(ROOT, 'css', '*.css')):
    css = open(cf, encoding='utf-8').read()
    for m in re.finditer(r'\.svg-icon-([a-z0-9-]+)\s*\{[^}]*?url\([\'"]?([^\'")]+)[\'"]?\)', css):
        SUF2FILE[m.group(1)] = os.path.basename(m.group(2).split('?')[0])

def suf2glyph(suf):
    fn = SUF2FILE.get(suf)
    return FILE2NAME.get('assets/' + fn) if fn else None

CONSUMED = set('assets/' + os.path.basename(v) for v in [] )  # diisi di bawah
consumed_files = set(v for v in MANI['manifest'].values() if v.startswith('assets/'))

log = []
for cf in sorted(glob.glob(os.path.join(ROOT, 'css', '*.css'))):
    css = open(cf, encoding='utf-8').read()
    out = []
    for chunk in css.split('}'):
        if '{' not in chunk:
            out.append(chunk)
            continue
        sel, decl = chunk.split('{', 1)
        # aturan mask per-ikon: hapus bila asetnya masuk font
        m = re.fullmatch(r'\s*\.svg-icon-([a-z0-9-]+)\s*', sel)
        if m:
            g = suf2glyph(m.group(1))
            fn = SUF2FILE.get(m.group(1))
            if g and ('assets/' + fn) in consumed_files:
                log.append(f'DROP {os.path.basename(cf)} :: .svg-icon-{m.group(1)}')
                continue
            out.append(chunk)
            continue
        orig_sel = sel
        # aturan definisi base .svg-icon (untuk span sisa): jangan sentuh
        if re.fullmatch(r'\s*\.svg-icon\s*', sel):
            out.append(chunk)
            continue
        # ganti suffix terpetakan -> fticon
        def rep_suf(mm):
            g = suf2glyph(mm.group(1))
            return f'.fticon-{g}' if g else mm.group(0)
        sel2 = re.sub(r'\.svg-icon-([a-z0-9-]+)', rep_suf, sel)
        sufs_left = re.findall(r'\.svg-icon-[a-z0-9-]+', sel2)
        # base .svg-icon -> .fticon (kecuali aturan mask generik: buang paint-nya)
        if re.search(r'(?<![\w-])\.svg-icon(?![\w-])', sel2):
            sel2 = re.sub(r'(?<![\w-])\.svg-icon(?![\w-])', '.fticon', sel2)
        changed_sel = (sel2 != sel)
        # font-size dari height utk aturan ikon
        new_decl = decl
        if ('.fticon' in sel2) or (' svg' in sel2):
            hm = re.search(r'height\s*:\s*(\d+)px\s*(!important)?', decl)
            if hm and 'font-size' not in decl:
                new_decl = decl.rstrip() + f'\n  font-size: {hm.group(1)}px{hm.group(2) or ""};'
        # buang mask-* & background-color pada aturan .fticon (cat mask tak ada)
        if '.fticon' in sel2 and '.svg-icon' not in sel2:
            new_decl = re.sub(r'\s*(?:-webkit-)?mask-[a-z-]+\s*:[^;]+;', '', new_decl)
            new_decl = re.sub(r'\s*background-color\s*:[^;]+;', '', new_decl)
        # C. aturan ikon generik: selektor ber-'icon' + height px + tanpa font-size
        #    (mis. .layer-action-icon {height:24px} -> tambah font-size agar glyph ikut)
        if (re.search(r'icon', sel2, re.I)
                and not re.search(r'[-_]?(label|title|text|badge|name|count|desc|input)\b', sel2, re.I)):
            hm = re.search(r'height\s*:\s*(\d+)px\s*(!important)?', new_decl)
            if hm and 'font-size' not in new_decl:
                new_decl = new_decl.rstrip() + f'\n  font-size: {hm.group(1)}px{hm.group(2) or ""};'
                log.append(f'FSIZE {os.path.basename(cf)} :: {orig_sel.strip()[:70]}')
        # D. klon aturan bare-svg berukuran -> varian i.fticon
        if re.search(r'(?<![\w.\-])svg(?![\w\-])', sel) and 'i.fticon' not in sel:
            hm = re.search(r'height\s*:\s*(\d+)px\s*(!important)?', decl)
            wm = re.search(r'(?<![\w-])width\s*:\s*(\d+)px', decl)
            if hm and wm:
                imp = hm.group(2) or ''
                clone_sel = re.sub(r'(?<![\w.\-])svg(?![\w\-])', 'i.fticon', sel)
                clean = re.sub(r'\s*font-size\s*:[^;]+;', '', decl).rstrip()
                clone = (clone_sel + '{' + clean
                         + f'\n  font-size: {hm.group(1)}px{imp};')
                out.append(sel2 + '{' + new_decl)
                out.append(clone)
                log.append(f'CLONE {os.path.basename(cf)} :: {orig_sel.strip()[:70]}')
                continue
        if changed_sel or new_decl != decl:
            log.append(f'EDIT {os.path.basename(cf)} :: {orig_sel.strip()[:70]}')
        out.append(sel2 + '{' + new_decl)
    new = '}'.join(out)
    # base rule fticon (hanya bila file ini pakai fticon)
    if '.fticon' in new and '.fticon {' not in new:
        anchor = '/* Universal SVG Mask Icons'
        base = ('.fticon {\n  display: inline-block;\n  font-style: normal;\n'
                '  font-weight: normal;\n  line-height: 1;\n  flex-shrink: 0;\n}\n\n')
        new = new.replace(anchor, base + anchor) if anchor in new else base + new
        log.append(f'BASE {os.path.basename(cf)} :: tambah .fticon')
    if new != css and not DRY:
        open(cf, 'w', encoding='utf-8').write(new)

# <link> font di head editor + desktop
for hf in ['editor.html', 'desktop.html']:
    p = os.path.join(ROOT, hf)
    s = open(p, encoding='utf-8').read()
    if 'fticons/fticons.css' in s:
        continue
    m = re.search(r'<link[^>]*theme\.css[^>]*>', s)
    tag = '\n  <link rel="stylesheet" href="fticons/fticons.css">'
    if m:
        s = s[:m.end()] + tag + s[m.end():]
        log.append(f'LINK {hf}')
        if not DRY:
            open(p, 'w', encoding='utf-8').write(s)
    else:
        log.append(f'LINK {hf} GAGAL: theme.css tak ketemu')

print('\n'.join(log))
print('total aksi:', len(log))
