#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

console.log('--- OpenFishTools Studio Comprehensive Test Suite ---');

function getJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(dir, f));
}

const targetDirs = ['js', 'effects', 'scripts'];
let allJsFiles = [];
targetDirs.forEach(d => {
  allJsFiles.push(...getJsFiles(d));
});
if (fs.existsSync('server.js')) allJsFiles.push('server.js');

console.log(`\n[1/4] Syntax Verification (node --check) across ${allJsFiles.length} JS files...`);
let syntaxFailures = 0;
allJsFiles.forEach(file => {
  try {
    execFileSync('node', ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    console.error(`  FAIL: Syntax error in ${file}:`, err.message);
    syntaxFailures++;
  }
});
if (syntaxFailures === 0) {
  console.log(`  PASS: All ${allJsFiles.length} files passed syntax verification.`);
} else {
  console.error(`  FAIL: ${syntaxFailures} syntax errors detected.`);
  process.exit(1);
}

console.log('\n[2/4] AST Scope & Undeclared Reference Audit...');
try {
  const auditScript = path.join(__dirname, 'static-scope-audit.js');
  // Exclude third-party vendor minified bundle jszip.min.js from strict audit
  const auditFiles = allJsFiles.filter(f => !f.includes('jszip.min.js'));
  const output = execFileSync('node', [auditScript, ...auditFiles], { encoding: 'utf8' });
  const lines = output.trim().split('\n');
  const fails = lines.filter(l => l.includes('Undeclared references'));
  if (fails.length > 0) {
    console.error(output);
    console.error(`  FAIL: ${fails.length} files contain undeclared references.`);
    process.exit(1);
  }
  console.log(`  PASS: All ${auditFiles.length} application files passed scope audit with 0 undeclared references.`);
} catch (err) {
  console.error('  FAIL: Scope audit execution failed:', err.message);
  process.exit(1);
}

console.log('\n[3/4] Synchronizers & System Sanity Check...');
try {
  execFileSync('node', ['scripts/sync-effects.js'], { stdio: 'pipe' });
  execFileSync('node', ['scripts/sync-version.js'], { stdio: 'pipe' });
  console.log('  PASS: Effects and version synchronizers executed cleanly.');
} catch (err) {
  console.error('  FAIL: Synchronizers failed:', err.message);
  process.exit(1);
}

console.log('\n[4/4] HTML File Integrity & Structure Check...');
const expectedHtmlFiles = [
  { file: 'index.html', minLines: 2500 },
  { file: 'editor.html', minLines: 5000 },
  { file: 'desktop.html', minLines: 5000 }
];

let htmlFailures = 0;
for (const item of expectedHtmlFiles) {
  if (!fs.existsSync(item.file)) {
    console.error(`  FAIL: Missing required file ${item.file}`);
    htmlFailures++;
    continue;
  }
  const content = fs.readFileSync(item.file, 'utf8');
  const lines = content.split('\n').length;
  if (!content.includes('</html>')) {
    console.error(`  FAIL: ${item.file} is missing closing </html> tag!`);
    htmlFailures++;
  } else if (lines < item.minLines) {
    console.error(`  FAIL: ${item.file} line count ${lines} is below minimum threshold ${item.minLines}!`);
    htmlFailures++;
  } else {
    console.log(`  PASS: ${item.file} verified (${lines} lines, valid structure).`);
  }
}

if (htmlFailures > 0) {
  console.error(`  FAIL: ${htmlFailures} HTML integrity check(s) failed.`);
  process.exit(1);
}

console.log('\n========================================');
console.log('ALL TESTS PASSED SUCCESSFULLY! (100%)');
console.log('========================================\n');
process.exit(0);
