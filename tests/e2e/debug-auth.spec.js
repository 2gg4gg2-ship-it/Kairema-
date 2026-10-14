import { test, expect } from '@playwright/test';

test('auth.me response', async ({ page }) => {
  // Log all network requests and responses
  page.on('request', request => {
    console.log('>>>', request.method(), request.url());
  });
  page.on('response', response => {
    console.log('<<<', response.status(), response.url());
    if (response.url().includes('/auth.me')) {
      response.text().then(body => {
        console.log('Response body:', body);
      });
    }
  });

  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(5000);
});