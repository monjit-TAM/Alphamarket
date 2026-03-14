#!/usr/bin/env node
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FRAME_DIR = '/tmp/alphamarket-frames';
const HTML_FILE = '/var/www/alphamarket/client/public/product-video.html';
const FPS = 24;

const FORMATS = {
  youtube:   { w: 1920, h: 1080, label: 'YouTube (16:9)' },
  linkedin:  { w: 1920, h: 1080, label: 'LinkedIn (16:9)' },
  instagram: { w: 1080, h: 1080, label: 'Instagram (1:1)' },
  reels:     { w: 1080, h: 1920, label: 'Reels/Shorts (9:16)' },
};

const format = process.argv[2] || 'youtube';
if (!FORMATS[format]) { console.log('Usage: node generate-video.cjs [youtube|linkedin|instagram|reels]'); process.exit(1); }
const { w: WIDTH, h: HEIGHT, label } = FORMATS[format];
const OUTPUT = `/var/www/alphamarket/client/public/AlphaMarket_Demo_${format}.mp4`;

const SCENES = [
  { duration: 4 },  // 0: Intro
  { duration: 5 },  // 1: Dashboard
  { duration: 5 },  // 2: Features
  { duration: 5 },  // 3: Deep Analysis
  { duration: 5 },  // 4: Stocks + Edit + PDF
  { duration: 4 },  // 5: Closing
];

async function main() {
  console.log(`\n  AlphaMarket Video Generator`);
  console.log(`  Format: ${label} (${WIDTH}x${HEIGHT})`);
  console.log(`  ─────────────────────────────\n`);

  if (fs.existsSync(FRAME_DIR)) execSync('rm -rf ' + FRAME_DIR);
  fs.mkdirSync(FRAME_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });
  await page.goto('file://' + HTML_FILE, { waitUntil: 'networkidle0', timeout: 30000 });

  // Hide controls and stop auto-play
  await page.evaluate(() => {
    const c = document.querySelector('.controls');
    if (c) c.style.display = 'none';
    if (typeof togglePlay === 'function') togglePlay();
    clearTimeout(window._timer);
  });

  const sceneCount = await page.evaluate(() => document.querySelectorAll('.scene').length);
  const scenesToCapture = Math.min(sceneCount, SCENES.length);
  console.log(`  Found ${sceneCount} scenes, capturing ${scenesToCapture}\n`);

  let frameNum = 0;
  const totalFrames = SCENES.slice(0, scenesToCapture).reduce((s, sc) => s + sc.duration * FPS, 0);

  for (let si = 0; si < scenesToCapture; si++) {
    const dur = SCENES[si].duration;
    const frames = dur * FPS;
    
    await page.evaluate((idx) => { if(typeof show==='function')show(idx); }, si);
    await new Promise(r => setTimeout(r, 800));

    // Re-trigger CSS animations
    await page.evaluate(() => {
      document.querySelectorAll('.feat,[style*="animation"]').forEach(el => {
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = '';
      });
    });
    await new Promise(r => setTimeout(r, 200));

    for (let f = 0; f < frames; f++) {
      const fp = path.join(FRAME_DIR, 'frame_' + String(frameNum).padStart(6, '0') + '.png');
      await page.screenshot({ path: fp, type: 'png' });
      frameNum++;
      if (f % (FPS * 2) === 0) {
        const pct = Math.round((frameNum / totalFrames) * 100);
        process.stdout.write(`\r  Scene ${si+1}/${scenesToCapture} | ${pct}% complete (${frameNum}/${totalFrames} frames)`);
      }
    }
  }
  await browser.close();

  const totalDur = SCENES.slice(0, scenesToCapture).reduce((s, sc) => s + sc.duration, 0);
  console.log(`\n\n  Captured ${frameNum} frames (${totalDur}s)\n  Encoding MP4...\n`);

  const cmd = [
    'ffmpeg -y',
    '-framerate ' + FPS,
    '-i ' + FRAME_DIR + '/frame_%06d.png',
    '-c:v libx264 -pix_fmt yuv420p',
    '-preset medium -crf 18',
    '-movflags +faststart',
    '-s ' + WIDTH + 'x' + HEIGHT,
    '"' + OUTPUT + '"',
  ].join(' ');
  execSync(cmd, { stdio: 'inherit' });
  execSync('rm -rf ' + FRAME_DIR);

  // Copy to dist/public too
  const distPath = OUTPUT.replace('client/public', 'dist/public');
  fs.copyFileSync(OUTPUT, distPath);

  const sz = (fs.statSync(OUTPUT).size / (1024 * 1024)).toFixed(1);
  console.log(`\n  ─────────────────────────────`);
  console.log(`  Video: ${OUTPUT}`);
  console.log(`  Size: ${sz} MB | Duration: ${totalDur}s | ${WIDTH}x${HEIGHT}`);
  console.log(`  URL: https://alphamarket.co.in/AlphaMarket_Demo_${format}.mp4\n`);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
