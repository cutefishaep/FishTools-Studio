# OpenFishTools Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-blue.svg)](https://nodejs.org/)
[![CI](https://github.com/cutefishaep/FishTools-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/cutefishaep/FishTools-Studio/actions)

[English](#english) • [Bahasa Indonesia](#bahasa-indonesia)

---

<a name="english"></a>
## English

### Overview
OpenFishTools Studio is a browser-based motion graphics and video editing application built with vanilla web technologies. It provides a non-linear editor (NLE) with layer compositing, multi-track timeline keyframing, an extensible visual effect registry, and client-side hardware-accelerated video rendering.

### Key Architecture & Capabilities
- **Non-Linear Timeline**: Multi-track timeline supporting keyframe interpolation, parent & link hierarchies, blend modes, and nested precompositions.
- **Dual Interface Modes**:
  - **Desktop Suite** (`desktop.html`): After Effects-style layout with docked inspector panels, track headers, playhead scrubbing, and curve graph editor.
  - **Mobile / Responsive Editor** (`editor.html`): Touch-friendly and viewport-adaptive canvas compositor with gesture-driven timeline controls.
- **Modular Effect Plugin Engine**: Standalone effect modules located in `effects/*.js` registering directly to `FishEffectsRegistry` with automated parameter-to-timeline binding.
- **Client-Side Video Export**: Utilizes WebCodecs API and MP4-muxer for local rendering and video generation directly inside the browser without cloud processing.
- **Zero-Dependency Development Server**: Built-in HTTP server (`server.js`) with Server-Sent Events (SSE) live reload and optional Cloudflare tunnel support.
- **Strict Design System**: 100% CSS theme token binding (`css/theme.css`), pure flat aesthetic without heavy blur or shadow overhead.

### System Requirements & Compatibility
- **Node.js**: v18.0.0 or later (for local dev server).
- **Web Browser**: Modern browser with WebCodecs and HTML5 Canvas support (Google Chrome 94+, Microsoft Edge 94+, Safari 16.4+).

### Quick Start

1. **Clone the repository**:
   ```bash
   git clone https://github.com/cutefishaep/FishTools-Studio.git
   cd FishTools-Studio
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the local server**:
   ```bash
   npm start
   ```
   *Alternative native launchers:*
   - **macOS**: Double-click `./run.command`
   - **Windows**: Double-click `run.bat`

4. **Access the application**:
   - Desktop Interface: `http://localhost:3000/desktop.html`
   - Responsive Interface: `http://localhost:3000/editor.html`
   - Project Launcher & Dashboard: `http://localhost:3000/index.html`

### Project Structure

```text
├── assets/          # Vector SVG icons, fonts, and static assets
├── css/             # Design system tokens and component stylesheets
│   ├── theme.css    # Central color and spacing tokens
│   ├── desktop.css  # Desktop NLE styling
│   ├── editor.css   # Responsive editor styling
│   └── modal.css    # Modular modal components
├── effects/         # Modular visual effect plugins (FishEffectsRegistry)
├── js/              # Core client-side modules
│   ├── desktop.js   # Desktop interface, track controls, and graph editor
│   ├── editor.js    # Canvas compositor, layer operations, and playback
│   ├── fishtool-engine.js  # 2D/3D matrix transforms and rendering pipeline
│   ├── FishExport-Enggine.js # WebCodecs export engine
│   └── main.js      # Project launcher and IndexedDB storage
├── functions/       # Cloudflare Pages / Workers backend handlers
├── scripts/         # Verification test suite and build synchronizers
│   ├── test-suite.js          # Automated test runner
│   ├── static-scope-audit.js  # AST scope and syntax audit
│   ├── prepare-wrangler.js    # Wrangler configuration synchronizer
│   └── sync-effects.js        # Effect manifest generator
├── server.js        # Local development server
├── version.json     # Single source of truth for versioning
└── CHANGELOG.md     # Chronological release notes
```

### Environment Configuration
Copy the template file to configure optional cloud backups or upload keys:
```bash
cp .env.example .env
```
Available environment variables:
- `SHARE_SECRET_TOKEN`: Protects `/api/share` uploads from unauthorized access.
- `CATBOX_USERHASH`: Optional Catbox user account hash for cloud hosting.
- `CF_KV_NAMESPACE_ID`: Cloudflare KV namespace ID (synced to `wrangler.jsonc` via `npm run prepare:wrangler`).
- `GOOGLE_CLIENT_ID`: Google OAuth Client ID for cloud project synchronization.

### Automated Testing
Run the comprehensive test suite (syntax validation, AST scope verification, HTML integrity):
```bash
npm test
```

### AI Agent Guidance
Autonomous coding agents (Cursor, GitHub Copilot, Cline, Windsurf, OpenCode) should consult [`AGENTS.md`](AGENTS.md) for architectural maps, strict design token enforcement rules, and error investigation protocols.

### License
This project is licensed under the [MIT License](LICENSE).

---

<a name="bahasa-indonesia"></a>
## Bahasa Indonesia

### Ringkasan
OpenFishTools Studio adalah aplikasi grafis gerak (motion graphics) dan penyunting video non-linear berbasis web yang dibangun menggunakan teknologi web murni (*vanilla*). Menyediakan editor non-linear (NLE) dengan *compositing* layer, animasi *keyframe* pada multi-track timeline, sistem plugin efek visual modular, dan rendering video berbasis akselerasi perangkat keras langsung di sisi klien (*client-side*).

### Arsitektur & Kapabilitas Utama
- **Timeline Non-Linear**: Mendukung animasi *keyframe*, hierarki *parent & link*, mode *blend*, serta komposisi bertingkat (*precomps*).
- **Dua Mode Antarmuka**:
  - **Desktop Suite** (`desktop.html`): Tata letak desktop profesional dengan panel inspektur terintegrasi, header track, playhead scrubbing, dan kurva *graph editor*.
  - **Editor Responsif** (`editor.html`): Kompositor canvas yang adaptif terhadap perangkat mobile maupun tablet dengan kontrol sentuh.
- **Arsitektur Efek Modular**: Seluruh efek visual merupakan modul plugin independen di dalam `effects/*.js` yang terdaftar langsung ke `FishEffectsRegistry` dengan integrasi parameter ke timeline secara otomatis.
- **Ekspor Video Client-Side**: Memanfaatkan WebCodecs API dan MP4-muxer untuk proses rendering dan ekspor video langsung di dalam peramban (*browser*) tanpa ketergantungan server pemroses video eksternal.
- **Server Lokal Mandiri**: Server HTTP bawaan (`server.js`) tanpa dependensi eksternal, dilengkapi fitur *live reload* otomatis (SSE) dan integrasi opsional tunnel Cloudflare.
- **Sistem Desain Terstandarisasi**: Mengikat 100% warna dan token desain dari `css/theme.css` dengan prinsip *flat design* murni tanpa efek blur atau bayangan berat.

### Persyaratan Sistem & Kompatibilitas
- **Node.js**: Versi 18.0.0 atau lebih baru.
- **Peramban Web**: Peramban modern dengan dukungan WebCodecs dan HTML5 Canvas (Google Chrome 94+, Microsoft Edge 94+, Safari 16.4+).

### Panduan Memulai Cepat

1. **Kloning repositori**:
   ```bash
   git clone https://github.com/cutefishaep/FishTools-Studio.git
   cd FishTools-Studio
   ```

2. **Pasang dependensi**:
   ```bash
   npm install
   ```

3. **Jalankan server lokal**:
   ```bash
   npm start
   ```
   *Peluncur langsung sistem operasi:*
   - **macOS**: Klik dua kali file `./run.command`
   - **Windows**: Klik dua kali file `run.bat`

4. **Akses aplikasi melalui peramban**:
   - Antarmuka Desktop: `http://localhost:3000/desktop.html`
   - Antarmuka Responsif: `http://localhost:3000/editor.html`
   - Manajemen Proyek: `http://localhost:3000/index.html`

### Struktur Direktori Proyek

```text
├── assets/          # Ikon vektor SVG, font, dan berkas statis
├── css/             # Token desain tema dan lembar gaya CSS
│   ├── theme.css    # Token warna utama dan tipografi
│   ├── desktop.css  # Tampilan antarmuka desktop NLE
│   ├── editor.css   # Tampilan antarmuka editor responsif
│   └── modal.css    # Komponen dialog pop-up modular
├── effects/         # Plugin efek visual mandiri (FishEffectsRegistry)
├── js/              # Modul fungsional utama aplikasi
│   ├── desktop.js   # Logika desktop, pengaturan track, dan graph editor
│   ├── editor.js    # Komposisi canvas layer, manipulasi, dan playback
│   ├── fishtool-engine.js  # Mesin transformasi matriks 2D/3D & rendering
│   ├── FishExport-Enggine.js # Mesin ekspor WebCodecs
│   └── main.js      # Peluncur proyek dan basis data IndexedDB
├── functions/       # Handler backend Cloudflare Pages / Workers
├── scripts/         # Skrip otomatisasi, pengujian, dan sinkronisasi
│   ├── test-suite.js          # Skrip pengujian otomatis
│   ├── static-scope-audit.js  # Audit cakupan AST dan sintaksis JS
│   ├── prepare-wrangler.js    # Sinkronisasi konfigurasi Cloudflare dari .env
│   └── sync-effects.js        # Generator manifest efek otomatis
├── server.js        # Server pengembangan lokal
├── version.json     # Sumber kebenaran tunggal untuk versi aplikasi
└── CHANGELOG.md     # Catatan rilis kronologis
```

### Konfigurasi Lingkungan (Environment)
Salin berkas template untuk mengonfigurasi penyimpanan cloud opsional atau kunci pengunggahan:
```bash
cp .env.example .env
```
Daftar variabel lingkungan:
- `SHARE_SECRET_TOKEN`: Melindungi endpoint `/api/share` agar hanya pengguna terotorisasi yang dapat mengunggah proyek ke database cloud.
- `CATBOX_USERHASH`: Kunci akun Catbox opsional untuk hosting berkas cloud.
- `CF_KV_NAMESPACE_ID`: ID namespace Cloudflare KV (disinkronkan otomatis ke `wrangler.jsonc` lewat `npm run prepare:wrangler`).
- `GOOGLE_CLIENT_ID`: ID Klien Google OAuth untuk cadangan proyek ke Google Drive.

### Pengujian Otomatis
Jalankan rangkaian pengujian menyeluruh (validasi sintaksis, verifikasi cakupan AST, integritas dokumen HTML):
```bash
npm test
```

### Panduan untuk AI Agent
AI coding agent mandiri (Cursor, GitHub Copilot, Cline, Windsurf, OpenCode) wajib membaca dan mematuhi panduan dalam [`AGENTS.md`](AGENTS.md) mengenai peta arsitektur kode, kepatuhan token CSS, dan protokol investigasi bug runtime.

### Lisensi
Proyek ini didistribusikan di bawah [Lisensi MIT](LICENSE).
