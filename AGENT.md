# AGENT GUIDELINES — FISHTOOL STUDIO

Dokumen ini berisi panduan dan aturan wajib bagi agen AI saat mengembangkan, memodifikasi, dan merancang antarmuka (UI/UX) serta sistem visual di **FishTool Studio**.

---

## 🎨 1. Panduan Visual & Palet Tema (Color Palette)

Semua elemen antarmuka (tombol, modal, panel kontrol, timeline, toolbar, teks, dan status) **WAJIB** selaras dengan palet warna resmi FishTool Studio:

| Peran Warna | Hex Code | Penggunaan |
| :--- | :--- | :--- |
| **Primary Background** | `#1A0F0A` / `#22130C` | Background utama aplikasi, canvas wrapper, timeline trackway |
| **Surface & Card** | `#2D1A10` / `#361F13` | Modal dialog, card item, popup menu, inspector panel |
| **Accent Primary** | `#FAB778` | Tombol aktif, highlight timeline, icon aktif, playhead, slider fill |
| **Accent Secondary / Text** | `#FFF2C2` | Judul teks, header label, icon sekunder, label menu |
| **Border & Divider** | `rgba(250, 183, 120, 0.22)` / `#732D06` | Garis pemisah antar panel, outline tombol, batas track |
| **Deep Contrast / Shadowless Area** | `#0D0704` | Kotak input, track background, dark contrast surface |

---

## 🚫 2. Aturan Ketat: TANPA BLUR (NO BLUR)

1. **Dilarang Menggunakan Filter Blur**:
   - ❌ Jangan gunakan `filter: blur(...)` pada elemen UI, canvas, maupun modal.
   - ❌ Jangan gunakan `backdrop-filter: blur(...)` pada overlay atau panel transparan.
2. **Sharp & Crisp Aesthetic**:
   - Gunakan warna latar solid atau semi-transparan tajam (`rgba(...)`) tanpa efek kabur.
   - Pastikan teks, icon, dan garis pembatas tetap tajam di semua resolusi layar (crisp high-DPI).

---

## 🚫 3. Aturan Ketat: TANPA DROPSHADOW (NO DROPSHADOW)

1. **Dilarang Menggunakan Box-Shadow & Drop-Shadow Kabur**:
   - ❌ Jangan tambahkan `box-shadow` dengan radius blur besar atau efek glow kabur (misal: `box-shadow: 0 10px 30px rgba(...)`).
   - ❌ Jangan gunakan `filter: drop-shadow(...)` pada icon SVG atau layer grafis.
2. **Hierarki Menggunakan Border & Warna**:
   - Kedalaman dan pemisahan hierarki visual antar elemen harus dibuat menggunakan **solid crisp borders** (`border: 1px solid rgba(250, 183, 120, 0.2)`) atau perbedaan kontras warna (`#2D1A10` di atas `#1A0F0A`).

---

## ⚡ 4. Aturan Performa & Responsivitas

1. **Efisiensi Animasi**:
   - Gunakan `transform` (`translate`, `scale`) dan `opacity` yang diakselerasi oleh GPU (Hardware Accelerated).
   - Hindari manipulasi properti berat yang memicu reflow (seperti `top`, `left`, `margin` berlebih pada frame rate tinggi).
2. **Timeline & Media Processing**:
   - Utamakan performa tinggi (60 FPS/120 FPS) saat scrubbing timeline.
   - Gunakan frame sequence caching dan GPU memory texture untuk menjamin responsivitas instan tanpa lag.
