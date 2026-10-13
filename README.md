# OpenFishTools Studio

[![Status: Deprecated](https://img.shields.io/badge/status-deprecated-red.svg)](https://github.com/openfishtools/Studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-blue.svg)](https://nodejs.org/)
[![CI](https://github.com/cutefishaep/FishTools-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/cutefishaep/FishTools-Studio/actions)

[English](#english) • [Bahasa Indonesia](#bahasa-indonesia)

---

<a name="english"></a>
## English

> [!WARNING]
> **This repository is deprecated.**
>
> This repository is frozen at tag v0.5.132 and receives no further updates. Version v0.5.132 and every version below it are licensed under MIT, so if you want to sell it or use it commercially without disclosing your modifications, go ahead, just use this version.
>
> But if you want the latest version, there are conditions: you must disclose your complete source code under network copyleft if you modify or deploy it on the web, and giving credit is mandatory (how hard is it to give credit, seriously?). I made this project completely free so everyone is free to create without being extorted. Even with vibe coding like this, I still put up my own money for Antigravity Ultra. So just choose: want to make a closed-source fork, use this older MIT version. Want the latest updates, follow the rules of the new license (GNU AGPLv3).
>
> The newer, actively developed version is at [openfishtools/Studio](https://github.com/openfishtools/Studio). Please read that repository's LICENSE before using it.

### Overview
OpenFishTools Studio is a browser-based motion graphics and video editing application built with vanilla web technologies. It provides a non-linear editor (NLE) with layer compositing, a multi-track keyframe timeline, an extensible visual effect registry, and client-side video rendering.

### Key Features
- **Non-linear timeline**: multi-track timeline with keyframe interpolation, parent and link hierarchies, blend modes, and nested precompositions.
- **Two interface modes**:
  - **Desktop** (`desktop.html`): After Effects-style layout with docked inspector panels, track headers, playhead scrubbing, and a curve graph editor.
  - **Responsive** (`editor.html`): touch-friendly canvas compositor with gesture-driven timeline controls.
- **Modular effect plugins**: each effect is a standalone module in `effects/*.js` that registers with `FishEffectsRegistry` and binds its parameters to the timeline automatically.
- **Client-side video export**: renders and exports video in the browser using WebCodecs and MP4-muxer, with no cloud processing.
- **Dependency-free dev server**: a built-in HTTP server (`server.js`) with live reload (SSE) and optional Cloudflare tunnel support.
- **Design tokens**: all colors and spacing come from `css/theme.css`, with a flat visual style and no heavy blur or shadows.

### Requirements
- Node.js v18.0.0 or later (for the local dev server).
- Browser with WebCodecs and HTML5 Canvas support (Chrome 94+, Edge 94+, Safari 16.4+).

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
   *Alternative launchers:*
   - **macOS**: double-click `./run.command`
   - **Windows**: double-click `run.bat`

4. **Open the app**:
   - Desktop interface: `http://localhost:3000/desktop.html`
   - Responsive interface: `http://localhost:3000/editor.html`
   - Project launcher: `http://localhost:3000/index.html`

### Project Structure

```text
├── assets/          # SVG icons, fonts, and static assets
├── css/             # Design tokens and component stylesheets
│   ├── theme.css    # Central color and spacing tokens
│   ├── desktop.css  # Desktop NLE styling
│   ├── editor.css   # Responsive editor styling
│   └── modal.css    # Modal components
├── effects/         # Visual effect plugins (FishEffectsRegistry)
├── js/              # Core client-side modules
│   ├── desktop.js   # Desktop interface, track controls, graph editor
│   ├── editor.js    # Canvas compositor, layer operations, playback
│   ├── fishtool-engine.js  # 2D/3D matrix transforms and rendering pipeline
│   ├── FishExport-Enggine.js # WebCodecs export engine
│   └── main.js      # Project launcher and IndexedDB storage
├── functions/       # Cloudflare Pages / Workers backend handlers
├── scripts/         # Test suite and build helpers
│   ├── test-suite.js          # Automated test runner
│   ├── static-scope-audit.js  # AST scope and syntax audit
│   ├── prepare-wrangler.js    # Generates wrangler config from .env
│   └── sync-effects.js        # Effect manifest generator
├── server.js        # Local development server
├── version.json     # Single source of truth for versioning
└── CHANGELOG.md     # Release notes
```

### Configuration (`.env` and `wrangler.jsonc`)

Because `.env` and `wrangler.jsonc` are gitignored, follow these steps to configure them:

1. **Setup `.env`**:
   Copy the example template:
   ```bash
   cp .env.example .env
   ```
   Configure the environment variables as needed:
   - `SHARE_SECRET_TOKEN`: Secret upload authorization token protecting `/api/share`.
   - `CATBOX_USERHASH`: Optional Catbox account hash for cloud asset hosting.
   - `CF_KV_NAMESPACE_ID`: Cloudflare KV namespace ID for shared projects.

2. **Generate `wrangler.jsonc`**:
   - **Automatic (Recommended)**:
     ```bash
     npm run prepare:wrangler
     ```
     This reads `CF_KV_NAMESPACE_ID` from `.env` and generates `wrangler.jsonc`.
   - **Manual**:
     Copy the template directly:
     ```bash
     cp wrangler.example.jsonc wrangler.jsonc
     ```

### Testing
Run the test suite (syntax validation, AST scope verification, HTML integrity):
```bash
npm test
```

### AI Agent Guidance
Autonomous coding agents (Cursor, GitHub Copilot, Cline, Windsurf, OpenCode) should read [`AGENTS.md`](AGENTS.md) for the architecture map, design token rules, and error investigation protocol.

### License
This repository, meaning version v0.5.132 and every version below it, is licensed under the MIT License. You may use, modify, and distribute it, including commercially, as long as you keep the copyright notice and the license text in all copies.

The actively developed version at [openfishtools/Studio](https://github.com/openfishtools/Studio) is released under a different license ([GNU AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html)), which requires disclosing the full source code for any modifications or web deployments (network copyleft). Its terms do not apply to this repository.

---

<a name="bahasa-indonesia"></a>
## Bahasa Indonesia

> [!WARNING]
> **Repositori ini sudah tidak dipakai lagi (deprecated).**
>
> Repositori ini dibekukan di tag v0.5.132 dan tidak akan menerima pembaruan. Versi v0.5.132 dan semua versi di bawahnya pakai lisensi MIT, jadi kalo mau dijual atau dipake buat komersial tanpa wajib buka source code, silakan, pake aja versi ini.
>
> Tapi kalo lu mau versi terbaru, ada syaratnya: wajib buka seluruh source code modifikasinya (network copyleft) jika dideploy ke web/jaringan & wajib kasih kredit (apa susahnya sih ngasih kredit). Proyek ini gw bikin gratis biar semua orang bebas berkreasi tanpa dipalak. Meski vibe coding gini, gw juga modal sendiri buat Antigravity Ultra. Jadi pilih aja: mau bikin versi closed-source, pake versi MIT ini. Mau update terbaru, ikutin aturan di lisensi baru (GNU AGPLv3).
>
> Versi terbaru yang aktif dikembangkan ada di [openfishtools/Studio](https://github.com/openfishtools/Studio). Baca LICENSE di repositori tersebut sebelum memakainya.

### Ringkasan
OpenFishTools Studio adalah aplikasi motion graphics dan penyunting video berbasis web yang dibangun dengan teknologi web murni (vanilla). Aplikasi ini menyediakan editor non-linear (NLE) dengan compositing layer, timeline multi-track dengan keyframe, sistem plugin efek visual yang bisa diperluas, dan rendering video di sisi klien.

### Fitur Utama
- **Timeline non-linear**: timeline multi-track dengan interpolasi keyframe, hierarki parent dan link, mode blend, dan precomposition bertingkat.
- **Dua mode antarmuka**:
  - **Desktop** (`desktop.html`): tata letak ala After Effects dengan panel inspektur, header track, playhead scrubbing, dan graph editor.
  - **Responsif** (`editor.html`): kompositor canvas yang mendukung layar sentuh, dengan kontrol timeline berbasis gestur.
- **Plugin efek modular**: tiap efek adalah modul mandiri di `effects/*.js` yang terdaftar ke `FishEffectsRegistry` dan parameternya otomatis terhubung ke timeline.
- **Ekspor video di sisi klien**: rendering dan ekspor video langsung di browser memakai WebCodecs dan MP4-muxer, tanpa pemrosesan di cloud.
- **Server dev tanpa dependensi**: server HTTP bawaan (`server.js`) dengan live reload (SSE) dan dukungan opsional tunnel Cloudflare.
- **Design token**: semua warna dan spasi berasal dari `css/theme.css`, dengan gaya flat tanpa blur atau bayangan berat.

### Persyaratan
- Node.js v18.0.0 atau lebih baru (untuk server lokal).
- Browser dengan dukungan WebCodecs dan HTML5 Canvas (Chrome 94+, Edge 94+, Safari 16.4+).

### Memulai

1. **Clone repositori**:
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
   *Peluncur alternatif:*
   - **macOS**: klik dua kali `./run.command`
   - **Windows**: klik dua kali `run.bat`

4. **Buka aplikasi**:
   - Antarmuka desktop: `http://localhost:3000/desktop.html`
   - Antarmuka responsif: `http://localhost:3000/editor.html`
   - Peluncur proyek: `http://localhost:3000/index.html`

### Struktur Proyek

```text
├── assets/          # Ikon SVG, font, dan aset statis
├── css/             # Design token dan stylesheet komponen
│   ├── theme.css    # Token warna dan spasi utama
│   ├── desktop.css  # Gaya antarmuka desktop NLE
│   ├── editor.css   # Gaya antarmuka editor responsif
│   └── modal.css    # Komponen modal
├── effects/         # Plugin efek visual (FishEffectsRegistry)
├── js/              # Modul inti sisi klien
│   ├── desktop.js   # Antarmuka desktop, kontrol track, graph editor
│   ├── editor.js    # Kompositor canvas, operasi layer, playback
│   ├── fishtool-engine.js  # Transformasi matriks 2D/3D dan pipeline rendering
│   ├── FishExport-Enggine.js # Mesin ekspor WebCodecs
│   └── main.js      # Peluncur proyek dan penyimpanan IndexedDB
├── functions/       # Handler backend Cloudflare Pages / Workers
├── scripts/         # Test suite dan skrip bantu build
│   ├── test-suite.js          # Penjalan tes otomatis
│   ├── static-scope-audit.js  # Audit cakupan AST dan sintaksis
│   ├── prepare-wrangler.js    # Membuat konfigurasi wrangler dari .env
│   └── sync-effects.js        # Generator manifest efek
├── server.js        # Server pengembangan lokal
├── version.json     # Sumber tunggal untuk versi
└── CHANGELOG.md     # Catatan rilis
```

### Konfigurasi (`.env` dan `wrangler.jsonc`)

Karena berkas `.env` dan `wrangler.jsonc` diabaikan oleh Git, ikuti langkah berikut untuk menyiapkannya:

1. **Siapkan berkas `.env`**:
   Salin template contoh:
   ```bash
   cp .env.example .env
   ```
   Lalu sesuaikan variabelnya:
   - `SHARE_SECRET_TOKEN`: Melindungi endpoint `/api/share` dari upload tanpa izin.
   - `CATBOX_USERHASH`: (Opsional) Hash akun Catbox untuk hosting berkas aset.
   - `CF_KV_NAMESPACE_ID`: ID namespace Cloudflare KV untuk proyek cloud.

2. **Buat berkas `wrangler.jsonc`**:
   - **Otomatis (Direkomendasikan)**:
     ```bash
     npm run prepare:wrangler
     ```
     Perintah ini membaca `CF_KV_NAMESPACE_ID` dari `.env` dan otomatis membuat `wrangler.jsonc`.
   - **Manual**:
     Salin template bawaan langsung:
     ```bash
     cp wrangler.example.jsonc wrangler.jsonc
     ```

### Pengujian
Jalankan test suite (validasi sintaksis, verifikasi cakupan AST, integritas HTML):
```bash
npm test
```

### Panduan untuk AI Agent
AI coding agent (Cursor, GitHub Copilot, Cline, Windsurf, OpenCode) sebaiknya membaca [`AGENTS.md`](AGENTS.md) untuk peta arsitektur, aturan design token, dan protokol investigasi error.

### Lisensi
Repositori ini, yaitu versi v0.5.132 dan semua versi di bawahnya, berlisensi MIT. Kamu boleh memakai, memodifikasi, dan mendistribusikannya, termasuk untuk keperluan komersial, selama tetap menyertakan pemberitahuan hak cipta dan teks lisensi di setiap salinan.

Versi yang aktif dikembangkan di [openfishtools/Studio](https://github.com/openfishtools/Studio) memakai lisensi yang berbeda ([GNU AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html)) dengan perlindungan copyleft (wajib membuka source code modifikasinya jika di-deploy ke web/jaringan). Ketentuan tersebut tidak berlaku untuk repositori ini.
