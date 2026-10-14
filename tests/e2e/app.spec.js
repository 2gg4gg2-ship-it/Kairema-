import { test, expect } from '@playwright/test';
import superjson from 'superjson';

test('functional verification of UI redesign', async ({ page }) => {
  const consoleLogs = [];
  page.on("console", msg => consoleLogs.push(msg.text()));
  const pageErrors = [];
  page.on("pageerror", err => pageErrors.push(err.message));

  // Mock all trpc requests to return mock data
  await page.route('**/api/trpc/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname; // e.g., /api/trpc/auth.me,models.list,...
    const inputParam = url.searchParams.get('input');
    if (!inputParam) {
      // If no input, proceed without mocking
      return route.continue();
    }
    // Extract procedure names from pathname
    const procedureList = pathname.replace(/^\/api\/trpc\//, '');
    const procedureNames = procedureList.split(',');
    let inputObj;
    try {
      inputObj = JSON.parse(inputParam);
    } catch (e) {
      console.log('Failed to parse trpc input:', inputParam);
      return route.continue();
    }
    // inputObj is an object where each key is a string index, and the value is { json: any, meta: any }
    const results = [];
    for (const key in inputObj) {
      if (inputObj.hasOwnProperty(key)) {
        const index = parseInt(key, 10);
        if (isNaN(index) || index < 0 || index >= procedureNames.length) {
          console.log('Invalid index:', key);
          // Push a null result to keep the array length correct
          results.push({ result: { data: null } });
          continue;
        }
        const procedureName = procedureNames[index];
        const procedureInput = inputObj[key].json; // The actual input is in the "json" property
        // For any procedure, return a successful login or user data as appropriate
        let mockData = null;
        if (procedureName === 'auth.stytch.login') {
          mockData = { state: "SIGNED_IN" };
        } else if (procedureName === 'auth.me') {
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
          mockData = user;
        } else if (procedureName === 'models.list') {
          mockData = [
            { id: 'fast', name: 'Kairema Flash', description: 'Короткие повседневные ответы без ожидания.' },
            { id: 'think', name: 'Kairema Think', description: 'Логика, рассуждения и сложные задачи среднего объёма.' },
            { id: 'context', name: 'Kairema Context', description: 'Длинные документы, большие фрагменты текста и связный контекст.' },
            { id: 'apex', name: 'Kairema Apex', description: 'Требовательные задачи, глубокий анализ и комплексные ответы.' },
          ];
        } else if (procedureName === 'settings.get') {
          mockData = { theme: 'system', language: 'en' };
        } else if (procedureName === 'memory.get') {
          mockData = [];
        } else if (procedureName === 'webSearch.status') {
          mockData = { enabled: false };
        } else if (procedureName === 'knowledge.status') {
          mockData = { enabled: false };
        } else if (procedureName === 'providers.dashboard') {
          mockData = [];
        } else if (procedureName === 'knowledge.audit') {
          mockData = [];
        } else if (procedureName === 'chats.list') {
          mockData = [];
        } else if (procedureName === 'owner.isOwner') {
          mockData = false;
        } else {
          // For any other procedure, return null
          mockData = null;
        }
        results.push({ result: { data: mockData } });
      }
    }
    const batchResponse = results;
    const body = JSON.stringify(batchResponse);
    // Set a mock cookie and authorization header for authentication
    const cookie = 'next-auth.session-token=mock-token; Path=/; HttpOnly';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body,
      headers: {
        'set-cookie': cookie,
        'authorization': 'Bearer mock-token',
      },
    });
  });

  await page.goto('http://localhost:3000/');

  // Wait for the login page to load by waiting for the login button
  const loginButton = page.locator('button:has-text("Войти по email и паролю")');
  await expect(loginButton).toBeVisible({ timeout: 15000 });

  // Click the login button to reveal the form
  await loginButton.click();

  // Try to find the email input by role and name
  const emailInput = page.getByRole('textbox', { name: 'Email' });
  await expect(emailInput).toBeVisible({ timeout: 5000 });

  // Fill in the login form
  await emailInput.fill('test@example.com');
  const passwordInput = page.getByRole('textbox', { name: 'Пароль' });
  await expect(passwordInput).toBeVisible({ timeout: 5000 });
  await passwordInput.fill('password');
  // Press Enter in the password field to submit the form
  await passwordInput.press('Enter');

  // Wait for the app to load by waiting for the model picker button
  const modelPickerButton = page.locator('role=button[name="Kairema Flash"]', { exact: true });
  await expect(modelPickerButton).toBeVisible({ timeout: 15000 });

  // 1. Model picker switching
  await expect(modelPickerButton).toHaveText('Kairema Flash');
  await modelPickerButton.click();
  await page.locator('.model-option[data-model="think"]').click();
  await waitForIdle();
  await expect(page.locator('role=button[name="Kairema Think"]', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('role=button[name="Kairema Think"]', { exact: true })).toHaveText('Kairema Think');
  await page.locator('role=button[name="Kairema Think"]', { exact: true }).click();
  await page.locator('.model-option[data-model="context"]').click();
  await waitForIdle();
  await expect(page.locator('role=button[name="Kairema Context"]', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('role=button[name="Kairema Context"]', { exact: true })).toHaveText('Kairema Context');
  await page.locator('route=button[name="Kairema Context"]', { exact: true }).click();
  await page.locator('.model-option[data-model="apex"]').click();
  await waitForIdle();
  await expect(page.locator('role=button[name="Kairema Apex"]', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('role=button[name="Kairema Apex"]', { exact: true })).toHaveText('Kairema Apex');

  // 2. Send a chat message (check that user message appears)
  const textarea = page.locator('.kairema-textarea');
  await textarea.click();
  await textarea.fill('Hello world');
  await page.keyboard.press('Enter');
  await waitForIdle();
  // Wait for the user message to appear in the chat
  const lastMessage = page.locator('.message:last-child');
  await expect(lastMessage).toContainText('Hello world');
  await expect(lastMessage).toHaveClass(/message-user/);

  // 3. Export a chat
  const exportButton = page.locator('#exportBtn');
  await exportButton.click();
  const exportMenu = page.locator('#exportMenu');
  await expect(exportMenu).toBeVisible();
  await exportMenu.getByRole('menuitem', { name: /Markdown/i }).click();
  await waitForIdle();
  // Close export menu by clicking away
  await page.click('body');
  await expect(exportMenu).toBeHidden();

  // 4. Open and close dialogs via sidebar
  const sidebarLinks = page.locator('.side-link');
  // Provider
  await sidebarLinks.filter({ hasText: /API Chat/i }).click();
  await waitForIdle();
  const providerPage = page.locator('text=Provider not implemented yet');
  await expect(providerPage).toBeVisible();
  // Go back to chat
  await sidebarLinks.filter({ hasText: /Chat/i }).click();
  await waitForIdle();

  // Settings
  await sidebarLinks.filter({ hasText: /Settings/i }).click();
  await waitForIdle();
  const settingsDialog = page.locator('.modalback.open');
  await expect(settingsDialog).toBeVisible();
  // Close settings by clicking the backdrop
  await page.click('.modalback.open', { position: { x: 10, y: 10 } });
  await waitForIdle();
  await expect(settingsDialog).toBeHidden();

  // Memory
  await sidebarLinks.filter({ hasText: /Memory/i }).click();
  await waitForIdle();
  const memoryDialog = page.locator('.modalback.open');
  await expect(memoryDialog).toBeVisible();
  await page.click('.modalback.open', { position: { x: 10, y: 10 } });
  await waitForIdle();
  await expect(memoryDialog).toBeHidden();

  // Profile
  await sidebarLinks.filter({ hasText: /Profile/i }).click();
  await waitForIdle();
  const profileDialog = page.locator('.modalback.open');
  await expect(profileDialog).toBeVisible();
  await page.click('.modalback.open', { position: { x: 10, y: 10 } });
  await waitForIdle();
  await expect(profileDialog).toBeHidden();

  // 5. Mobile sidebar and bottom navigation
  await page.setViewportSize({ width: 320, height: 568 });
  const mobileMenu = page.locator('#mobileMenu');
  await expect(mobileMenu).toBeVisible();
  await mobileMenu.click();
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toHaveClass(/open/);
  const scrim = page.locator('#scrim');
  await expect(scrim).toBeVisible();
  await scrim.click();
  await expect(sidebar).not.toHaveClass(/open/);
  // Restore desktop size for bottom nav
  await page.setViewportSize({ width: 320, height: 768 });
  const bottomNav = page.locator('#bottomnav');
  await expect(bottomNav).toBeVisible();
  // Click each bottom nav item to ensure they change active page
  await bottomNav.getByRole('button', { name: /Chat/i }).click();
  await waitForIdle();
  await expect(page.locator('#sidebar .side-link.active')).toHaveText(/Chat/i);
  await bottomNav.getByRole('button', { name: /Settings/i }).click();
  await waitForIdle();
  await expect(page.locator('#sidebar .side-link.active')).toHaveText(/Settings/i);
  await bottomNav.getByRole('button', { name: /Chat/i }).click();
  await waitForIdle();
  await expect(page.locator('#sidebar .side-link.active')).toHaveText(/Chat/i);
});

