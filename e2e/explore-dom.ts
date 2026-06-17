/**
 * 探索 MarkLuck 应用的 DOM 结构，输出选择器信息
 * 运行: npx tsx e2e/explore-dom.ts
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Skip welcome
  await page.goto('http://localhost:5175');
  await page.evaluate(() => localStorage.setItem('markluck_welcome_completed', 'true'));
  await page.goto('http://localhost:5175');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Screenshot
  await page.screenshot({ path: 'e2e/screenshots/app-initial.png', fullPage: true });

  // Selector discovery
  const info = await page.evaluate(() => {
    // All elements with class attribute
    const classNames = new Set<string>();
    document.querySelectorAll('[class]').forEach(el => {
      el.classList.forEach(c => classNames.add(c));
    });

    // All buttons
    const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.textContent?.trim().substring(0, 50) || '',
      ariaLabel: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || '',
      className: b.className?.toString?.() || '',
    }));

    // All inputs
    const inputs = Array.from(document.querySelectorAll('input, textarea')).map(i => ({
      placeholder: i.getAttribute('placeholder') || '',
      ariaLabel: i.getAttribute('aria-label') || '',
      type: i.getAttribute('type') || '',
      className: i.className?.toString?.() || '',
    }));

    // Key structural elements
    const structure = {
      appShell: !!document.querySelector('.app-shell'),
      appShellClass: document.querySelector('.app-shell')?.className || '',
      topBar: !!document.querySelector('.topbar'),
      topBarClass: document.querySelector('.topbar')?.className || '',
      leftWing: !!document.querySelector('.left-wing'),
      leftWingClass: document.querySelector('.left-wing')?.className || '',
      rightWing: !!document.querySelector('.right-wing'),
      rightWingClass: document.querySelector('.right-wing')?.className || '',
      editor: !!document.querySelector('.cm-content'),
      editorClass: document.querySelector('.cm-content')?.className || '',
      statusBar: !!document.querySelector('.status-bar'),
      statusBarClass: document.querySelector('.status-bar')?.className || '',
      statusSaved: !!document.querySelector('.status-saved'),
      fileDrawer: !!document.querySelector('.file-drawer'),
      bookmarkDots: document.querySelectorAll('[class*="bookmark"]').length,
      modalOverlay: !!document.querySelector('.modal-overlay'),
      palette: !!document.querySelector('.palette'),
      toast: !!document.querySelector('.toast'),
    };

    return {
      classNames: Array.from(classNames).sort(),
      buttons,
      inputs,
      structure,
    };
  });

  console.log('=== STRUCTURE ===');
  console.log(JSON.stringify(info.structure, null, 2));

  console.log('\n=== BUTTONS ===');
  info.buttons.forEach(b => console.log(`  [${b.className}] "${b.text}" aria="${b.ariaLabel}" title="${b.title}"`));

  console.log('\n=== INPUTS ===');
  info.inputs.forEach(i => console.log(`  [${i.className}] placeholder="${i.placeholder}" aria="${i.ariaLabel}"`));

  console.log('\n=== CLASS NAMES (first 100) ===');
  info.classNames.slice(0, 100).forEach(c => console.log(`  .${c}`));

  // Check initial localStorage state
  const storage = await page.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const val = localStorage.getItem(key) || '';
      items[key] = val.length > 200 ? val.substring(0, 200) + '...' : val;
    }
    return items;
  });
  console.log('\n=== localStorage ===');
  Object.entries(storage).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  await browser.close();
}

main().catch(console.error);
