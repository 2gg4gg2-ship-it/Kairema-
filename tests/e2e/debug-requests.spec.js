import { test, expect } from '@playwright/test';

test('log all requests', async ({ page }) => {
  page.on('request', request => {
    console.log('>>>', request.method(), request.url());
  });
  page.on('response', response => {
    console.log('<<<', response.status(), response.url());
  });

  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(5000);
});