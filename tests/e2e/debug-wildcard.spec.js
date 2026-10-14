import { test, expect } from '@playwright/test';
import superjson from 'superjson';

test('test route with wildcard', async ({ page }) => {
  page.on('console', msg => {
    console.log('PAGE CONSOLE:', msg.text());
  });

  await page.route('**/api/trpc/*', async (route) => {
    console.log('[MOCK] Wildcard route handler called!');
    const request = route.request();
    console.log(`[MOCK] ${request.method()} ${request.url()}`);
    const user = {
      id: 1,
      openId: 'test-openid-123',
      name: 'Test User',
      email: 'test@example.com',
      loginMethod: 'stytch-password',
      role: 'user',
      isGuest: 0,
      expiresAt: null,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    const serializedUser = superjson.serialize(user);
    const batchResponse = [
      {
        result: {
          data: serializedUser
        }
      }
    ];
    const responseBody = JSON.stringify(batchResponse);
    console.log('[MOCK] Response body:', responseBody);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: responseBody,
    });
  });

  page.on('request', request => {
    console.log('[NET] REQUEST:', request.method(), request.url());
  });
  page.on('response', response => {
    console.log('[NET] RESPONSE:', response.status(), response.url());
  });

  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(5000);
});