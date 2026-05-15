/**
 * Generates placeholder branding assets (app icon, adaptive icon,
 * splash, favicon) from inline SVGs using sharp. Run via:
 *
 *   npm run generate-branding
 *
 * Output goes to ./assets/images/ to match the existing app.json paths.
 * These are placeholders — replace with real branded artwork before
 * launch (tracked in PRELAUNCH_CHECKLIST.md).
 */
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

const PRIMARY = '#0E7C3A'; // matches theme.colors.primary
const TEXT_COLOR = '#FFFFFF';
const APP_LETTER = 'K'; // "K" for Kirana — placeholder

const assetsDir = path.join(__dirname, '..', 'assets', 'images');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

function svgSquare(size: number, fontSize: number, withBg = true): string {
  return `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      ${withBg ? `<rect width="${size}" height="${size}" fill="${PRIMARY}" />` : ''}
      <text x="50%" y="50%" font-family="Arial, sans-serif"
            font-size="${fontSize}" font-weight="800" fill="${TEXT_COLOR}"
            text-anchor="middle" dominant-baseline="central">${APP_LETTER}</text>
    </svg>
  `;
}

async function writePng(svg: string, file: string, label: string) {
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log(`  ok ${label} -> ${path.relative(process.cwd(), file)}`);
}

async function main() {
  console.log('Generating branding assets...');

  // 1024x1024 app icon (iOS + general)
  await writePng(
    svgSquare(1024, 600, true),
    path.join(assetsDir, 'icon.png'),
    'icon (1024)',
  );

  // 1024x1024 Android adaptive-icon foreground (transparent margins)
  await writePng(
    svgSquare(1024, 500, false),
    path.join(assetsDir, 'android-icon-foreground.png'),
    'adaptive-icon foreground',
  );

  // Solid-color background layer for adaptive icon
  await writePng(
    `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
       <rect width="1024" height="1024" fill="${PRIMARY}" />
     </svg>`,
    path.join(assetsDir, 'android-icon-background.png'),
    'adaptive-icon background',
  );

  // Monochrome layer (Android 13+ themed icons) — same as foreground but
  // pure white on transparent so the system can tint it.
  await writePng(
    svgSquare(1024, 500, false),
    path.join(assetsDir, 'android-icon-monochrome.png'),
    'adaptive-icon monochrome',
  );

  // Splash icon — small centered glyph, transparent background.
  // expo-splash-screen plugin renders this on top of `backgroundColor`.
  await writePng(
    svgSquare(512, 280, false),
    path.join(assetsDir, 'splash-icon.png'),
    'splash-icon (512)',
  );

  // Favicon for web build
  await writePng(
    svgSquare(48, 32, true),
    path.join(assetsDir, 'favicon.png'),
    'favicon (48)',
  );

  console.log('\nDone. Rebuild dev client to pick up the new assets.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
