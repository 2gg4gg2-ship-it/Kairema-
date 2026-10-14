import { test, expect } from '@playwright/test';

test('block manus script and check UI', async ({ page }) => {
  // Abort requests to the manus debug collector
  await page.route('**/__manus__/debug-collector.js', route => route.abort());
  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(3000);
  const html = await page.content();
  console.log('HTML length after abort:', html.length);
  // Check if we see the app div
  if (html.includes('class="app"')) {
    console.log('Found app div');
  } else {
    console.log('Did NOT find app div');
  }
  // Check for sidebar
  if (html.includes('class="sidebar"')) {
    console.log('Found sidebar');
  } else {
    console.log('Did NOT find sidebar');
  }
  // Check for topbar
  if (html.includes('class="topbar"')) {
    console.log('Found topbar');
  } else {
    console.log('Did NOT find topbar');
  }
  // Check for workspace
  if (html.includes('class="workspace"')) {
    console.log('Found workspace');
  } else {
    console.log('Did NOT find workspace');
  }
  // Check for composer
  if (html.includes('class="composer"')) {
    console.log('Found composer');
  } else {
    console.log('Did NOT find composer');
  }
});
