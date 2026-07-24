const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function captureScreenshots() {
  const outputDir = 'D:\\craft-agents-oss\\screenshots';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://localhost:5173/playground.html', { waitUntil: 'networkidle0' });
  await page.waitForTimeout(1000);

  const panels = ['Command', 'Runs', 'Projects', 'Memory', 'Media Lab', 'Integrations', 'Security', 'Search', 'Settings'];

  for (const panel of panels) {
    const btn = await page.$(`button:has-text("${panel}")`);
    if (btn) {
      await btn.click();
      await page.waitForTimeout(500);
      const screenshotPath = path.join(outputDir, `${panel.toLowerCase().replace(/ /g, '-')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`Screenshot saved: ${screenshotPath}`);
    }
  }

  await browser.close();
}

captureScreenshots().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
