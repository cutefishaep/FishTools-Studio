/**
 * OpenFishTools Studio - Unified Version Synchronizer
 * Single Source of Truth: version.json
 *
 * Usage:
 *   node scripts/sync-version.js            # Syncs all files using current version in version.json
 *   node scripts/sync-version.js 0.5.13     # Sets version.json to 0.5.13 and syncs all files
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function getVersionFromChangelog() {
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) return null;
  const content = fs.readFileSync(changelogPath, 'utf8');
  const match = content.match(/^##\s*\[([0-9]+\.[0-9]+\.[0-9]+[^\]]*)\]/m);
  return match ? match[1] : null;
}

function parseLatestChangelogSection() {
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) return null;
  const content = fs.readFileSync(changelogPath, 'utf8');

  // Match the first ## [version] - date block
  const versionMatch = content.match(/^##\s*\[([0-9]+\.[0-9]+\.[0-9]+[^\]]*)\]\s*-\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/m);
  if (!versionMatch) return null;

  const version = versionMatch[1];
  const dateStr = versionMatch[2];

  // Format date as "Sep 12, 2026"
  const d = new Date(dateStr + 'T00:00:00Z');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formattedDate = !isNaN(d.getTime())
    ? `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
    : dateStr;

  // Extract content between this version heading and the next "---" or "## ["
  const startIndex = versionMatch.index + versionMatch[0].length;
  const nextSectionMatch = content.slice(startIndex).match(/(?:\r?\n)(?:---|##\s*\[)/);
  const rawBody = nextSectionMatch
    ? content.slice(startIndex, startIndex + nextSectionMatch.index)
    : content.slice(startIndex);

  // Parse categories and items
  const items = [];
  const lines = rawBody.split(/\r?\n/);
  let currentCategory = 'Improved';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### Added') || trimmed.startsWith('### [Added]')) {
      currentCategory = 'New';
    } else if (trimmed.startsWith('### Fixed') || trimmed.startsWith('### [Fixed]')) {
      currentCategory = 'Fixed';
    } else if (trimmed.startsWith('### Changed') || trimmed.startsWith('### [Changed]') || trimmed.startsWith('### Improved') || trimmed.startsWith('### [Improved]')) {
      currentCategory = 'Improved';
    } else if (trimmed.startsWith('- **')) {
      // e.g. - **Title**: Description or - **Title** — Description
      const bulletMatch = trimmed.match(/^-\s*\*\*([^*]+)\*\*(?::|—|-)?\s*(.*)$/);
      if (bulletMatch) {
        items.push({
          badge: currentCategory === 'New' ? 'badge-new' : currentCategory === 'Fixed' ? 'badge-fixed' : 'badge-improved',
          badgeLabel: currentCategory === 'New' ? 'New' : currentCategory === 'Fixed' ? 'Fixed' : 'Improved',
          title: bulletMatch[1].trim(),
          desc: bulletMatch[2].trim()
        });
      }
    }
  }

  return {
    version,
    date: formattedDate,
    items
  };
}

function generateChangelogBlockHtml(info) {
  if (!info || !info.items || info.items.length === 0) return '';
  const escapeHtml = str => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let html = `            <!-- Version ${info.version} -->\n`;
  html += `            <div class="welcome-version-block">\n`;
  html += `              <div class="welcome-version-header">\n`;
  html += `                <span class="welcome-version-pill">v${info.version}</span>\n`;
  html += `                <span class="welcome-version-badge-latest">Latest</span>\n`;
  html += `                <span class="welcome-version-date">${info.date}</span>\n`;
  html += `              </div>\n`;

  for (const item of info.items) {
    html += `              <div class="welcome-changelog-item">\n`;
    html += `                <span class="changelog-badge ${item.badge}">${item.badgeLabel}</span>\n`;
    html += `                <div class="changelog-item-content">\n`;
    html += `                  <span class="changelog-item-title">${escapeHtml(item.title)}</span>\n`;
    html += `                  <span class="changelog-item-desc">${escapeHtml(item.desc)}</span>\n`;
    html += `                </div>\n`;
    html += `              </div>\n`;
  }

  html += `            </div>\n`;
  return html;
}

function syncHtmlChangelogFeed(filePath, changelogInfo) {
  if (!fs.existsSync(filePath) || !changelogInfo) return;
  let content = fs.readFileSync(filePath, 'utf8');

  // Check if this version block already exists
  const versionMarker = `<!-- Version ${changelogInfo.version} -->`;
  const pillMarker = `welcome-version-pill">v${changelogInfo.version}</span>`;

  if (content.includes(versionMarker) || content.includes(pillMarker)) {
    return;
  }

  // Generate new block
  const blockHtml = generateChangelogBlockHtml(changelogInfo);
  if (!blockHtml) return;

  // Remove existing Latest badges from older blocks
  content = content.replace(/<span class="welcome-version-badge-latest">Latest<\/span>\s*/g, '');

  // Prepend new block right inside <div class="welcome-changelog-feed">
  const feedMatch = content.match(/<div class="welcome-changelog-feed">(\r?\n)/);
  if (feedMatch) {
    const insertIdx = feedMatch.index + feedMatch[0].length;
    const newContent = content.slice(0, insertIdx) + blockHtml + '\n' + content.slice(insertIdx);
    if (newContent.length < content.length * 0.95 || !newContent.includes('</html>')) {
      throw new Error(`[SyncVersion] Integrity check failed for changelog feed in ${filePath}`);
    }
    const tmpPath = filePath + '.tmp.' + Date.now() + Math.random().toString(36).substring(2, 6);
    fs.writeFileSync(tmpPath, newContent, 'utf8');
    fs.renameSync(tmpPath, filePath);
  }
}

function syncVersion(specifiedVersion) {
  const versionJsonPath = path.join(ROOT, 'version.json');
  const packageJsonPath = path.join(ROOT, 'package.json');

  let targetVersion = specifiedVersion;

  if (!targetVersion) {
    if (fs.existsSync(versionJsonPath)) {
      try {
        const vData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
        if (vData && vData.version) {
          targetVersion = vData.version.trim();
        }
      } catch (_) {}
    }
  }

  if (!targetVersion) {
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (pData && pData.version) {
          targetVersion = pData.version.trim();
        }
      } catch (_) {}
    }
  }

  if (!targetVersion) {
    targetVersion = getVersionFromChangelog();
  }

  if (!targetVersion) {
    console.error('[SyncVersion] Error: Could not determine target version.');
    return null;
  }

  targetVersion = String(targetVersion).trim().replace(/^v\.?/i, '');
  console.log(`[SyncVersion] Synchronizing OpenFishTools Studio to v${targetVersion}...`);

  // 1. Update version.json
  fs.writeFileSync(versionJsonPath, JSON.stringify({ version: targetVersion }, null, 2) + '\n', 'utf8');

  // 2. Update package.json
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      pkg.version = targetVersion;
      fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    } catch (e) {
      console.error('[SyncVersion] Error updating package.json:', e);
    }
  }

  // 3. Update HTML files (badges, cachebusters, changelog feed)
  const changelogInfo = parseLatestChangelogSection();
  const htmlFiles = ['index.html', 'editor.html', 'demo.html', 'desktop.html'];

  for (const relPath of htmlFiles) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;

    let content = fs.readFileSync(fullPath, 'utf8');
    const origLen = content.length;

    // Update #studio-version-badge
    content = content.replace(/(<span[^>]*id="studio-version-badge"[^>]*>)([^<]*)(<\/span>)/g, `$1${targetVersion}$3`);

    // Update .welcome-badge
    content = content.replace(/(<span class="welcome-badge">)([^<]*)(<\/span>)/g, `$1v${targetVersion}$3`);

    // Update demo .badge-pre-alpha (e.g. in demo.html Section 02)
    if (relPath === 'demo.html') {
      content = content.replace(/(<span class="badge-pre-alpha">)([^<]*)(<\/span>)/g, `$1${targetVersion}$3`);
    }

    // Update script cachebusters (?v=0.x.x)
    content = content.replace(/(\?v=)[0-9]+\.[0-9]+\.[0-9]+[^"'\s]*/g, `$1${targetVersion}`);

    // Strict integrity guard: abort if content shrank unexpectedly or lost closing tags
    if (content.length < origLen * 0.90 || !content.includes('</html>')) {
      throw new Error(`[SyncVersion] Integrity check failed for ${relPath}: size shrank unexpectedly from ${origLen} to ${content.length}`);
    }

    // Atomic write via temp file
    const tmpPath = fullPath + '.tmp.' + Date.now() + Math.random().toString(36).substring(2, 6);
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, fullPath);

    // If changelog info matches this version, sync changelog feed
    if (changelogInfo && changelogInfo.version === targetVersion) {
      syncHtmlChangelogFeed(fullPath, changelogInfo);
    }
  }

  // 4. Update sw.js CACHE_NAME and header version
  const swPath = path.join(ROOT, 'sw.js');
  if (fs.existsSync(swPath)) {
    try {
      let swContent = fs.readFileSync(swPath, 'utf8');
      swContent = swContent.replace(/const CACHE_NAME = 'oft-studio-v[^']*';/, `const CACHE_NAME = 'oft-studio-v${targetVersion}';`);
      swContent = swContent.replace(/\* Version: [0-9]+\.[0-9]+\.[0-9]+[^\n]*/, `* Version: ${targetVersion}`);
      fs.writeFileSync(swPath, swContent, 'utf8');
    } catch (e) {
      console.error('[SyncVersion] Error updating sw.js:', e);
    }
  }

  // 5. Update native/src-tauri (tauri.conf.json and Cargo.toml)
  const tauriConfPath = path.join(ROOT, 'native', 'src-tauri', 'tauri.conf.json');
  if (fs.existsSync(tauriConfPath)) {
    try {
      const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
      tauriConf.version = targetVersion;
      fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');
    } catch (e) {
      console.error('[SyncVersion] Error updating tauri.conf.json:', e);
    }
  }

  const cargoPath = path.join(ROOT, 'native', 'src-tauri', 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    try {
      let cargoContent = fs.readFileSync(cargoPath, 'utf8');
      cargoContent = cargoContent.replace(/^version = "[^"]*"/m, `version = "${targetVersion}"`);
      fs.writeFileSync(cargoPath, cargoContent, 'utf8');
    } catch (e) {
      console.error('[SyncVersion] Error updating Cargo.toml:', e);
    }
  }

  console.log(`[SyncVersion] Successfully synchronized all files to v${targetVersion}!`);
  return targetVersion;
}

if (require.main === module) {
  const arg = process.argv[2];
  syncVersion(arg);
}

module.exports = { syncVersion, parseLatestChangelogSection };
