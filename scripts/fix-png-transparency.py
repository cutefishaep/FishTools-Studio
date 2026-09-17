import struct, zlib, math, os

def unfilter_png(filename):
    with open(filename, 'rb') as f:
        data = f.read()

    pos = 8
    idat = bytearray()
    while pos < len(data):
        length, chunk_type = struct.unpack('>I4s', data[pos:pos+8])
        chunk_data = data[pos+8:pos+8+length]
        if chunk_type == b'IHDR':
            width, height, bit_depth, color_type, _, _, _ = struct.unpack('>IIBBBBB', chunk_data)
        elif chunk_type == b'IDAT':
            idat.extend(chunk_data)
        pos += 12 + length

    raw = zlib.decompress(idat)
    bpp = 4
    stride = 1 + width * bpp
    pixels = bytearray(width * height * bpp)

    def paeth(a, b, c):
        p = a + b - c
        pa = abs(p - a)
        pb = abs(p - b)
        pc = abs(p - c)
        if pa <= pb and pa <= pc:
            return a
        elif pb <= pc:
            return b
        else:
            return c

    for y in range(height):
        filter_type = raw[y * stride]
        row_offset = y * stride + 1
        for x in range(width):
            px_idx = (y * width + x) * bpp
            for c in range(bpp):
                filt_val = raw[row_offset + x * bpp + c]
                left = pixels[(y * width + (x - 1)) * bpp + c] if x > 0 else 0
                up = pixels[((y - 1) * width + x) * bpp + c] if y > 0 else 0
                up_left = pixels[((y - 1) * width + (x - 1)) * bpp + c] if (x > 0 and y > 0) else 0

                if filter_type == 0:
                    val = filt_val
                elif filter_type == 1:
                    val = (filt_val + left) & 0xff
                elif filter_type == 2:
                    val = (filt_val + up) & 0xff
                elif filter_type == 3:
                    val = (filt_val + (left + up) // 2) & 0xff
                elif filter_type == 4:
                    val = (filt_val + paeth(left, up, up_left)) & 0xff
                pixels[px_idx + c] = val

    return width, height, pixels

def make_png(width, height, raw_rgba):
    stride = width * 4
    scanlines = bytearray((1 + stride) * height)
    for y in range(height):
        scanlines[y * (1 + stride)] = 0 # None
        scanlines[y * (1 + stride) + 1 : (y + 1) * (1 + stride)] = raw_rgba[y * stride : (y + 1) * stride]
    
    compressed = zlib.compress(bytes(scanlines), 9)
    
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = zlib.crc32(c)
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)
    
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    
    png = bytearray(b'\x89PNG\r\n\x1a\n')
    png.extend(chunk(b'IHDR', ihdr_data))
    png.extend(chunk(b'IDAT', compressed))
    png.extend(chunk(b'IEND', b''))
    return bytes(png)

def process_icon(filepath):
    width, height, pixels = unfilter_png(filepath)
    # Corner radius ratio from SVG (216 / 960)
    r = width * (216.0 / 960.0)
    
    # Theme background green color for antialiased edge de-matting
    BG_R, BG_G, BG_B = 34, 146, 0
    
    modified = bytearray(len(pixels))
    
    transparent_count = 0
    edge_count = 0
    
    for y in range(height):
        py = y + 0.5
        for x in range(width):
            px = x + 0.5
            idx = (y * width + x) * 4
            orig_r, orig_g, orig_b, _ = pixels[idx:idx+4]
            
            # Check corner distance
            d = 0.0
            if px < r and py < r:
                d = math.hypot(px - r, py - r)
            elif px > (width - r) and py < r:
                d = math.hypot(px - (width - r), py - r)
            elif px < r and py > (height - r):
                d = math.hypot(px - r, py - (height - r))
            elif px > (width - r) and py > (height - r):
                d = math.hypot(px - (width - r), py - (height - r))
            
            edge_dist = d - r
            
            if edge_dist >= 0.75:
                # Fully outside squircle: 100% transparent!
                modified[idx] = 0
                modified[idx+1] = 0
                modified[idx+2] = 0
                modified[idx+3] = 0
                transparent_count += 1
            elif edge_dist <= -0.75:
                # Fully inside: Keep original pixels intact
                modified[idx] = orig_r
                modified[idx+1] = orig_g
                modified[idx+2] = orig_b
                modified[idx+3] = 255
            else:
                # Antialiased border transition
                t = (edge_dist - (-0.75)) / 1.5 # 0.0 inside to 1.0 outside
                coverage = 1.0 - t
                alpha = int(round(coverage * 255.0))
                alpha = max(0, min(255, alpha))
                
                # De-matte from white background to pure green base
                if coverage > 0.05:
                    new_r = max(0, min(255, int(round((orig_r - 255.0 * (1.0 - coverage)) / coverage))))
                    new_g = max(0, min(255, int(round((orig_g - 255.0 * (1.0 - coverage)) / coverage))))
                    new_b = max(0, min(255, int(round((orig_b - 255.0 * (1.0 - coverage)) / coverage))))
                else:
                    new_r, new_g, new_b = BG_R, BG_G, BG_B
                
                modified[idx] = new_r
                modified[idx+1] = new_g
                modified[idx+2] = new_b
                modified[idx+3] = alpha
                edge_count += 1

    png_bytes = make_png(width, height, modified)
    with open(filepath, 'wb') as f:
        f.write(png_bytes)
        
    print(f'Processed {filepath}: {width}x{height}, transparent={transparent_count}, edge={edge_count}')

process_icon('assets/icon-512.png')
process_icon('assets/icon-192.png')
