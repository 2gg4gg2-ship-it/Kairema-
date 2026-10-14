import { test, expect } from '@playwright/test';

test('smoke test: load homepage', async ({ page }) => {
  const response = await page.goto('http://localhost:3000/');
  expect(response.status()).toBe(200);
  // Check for login button text as seen in the UI
  await expect(page.locator('text=Войти по email и паролю')).toBeVisible();
});
