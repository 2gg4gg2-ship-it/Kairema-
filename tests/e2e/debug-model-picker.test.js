import { test, expect } from '@playwright/test';
import superjson from 'superjson';

test('debug model picker', async ({ page }) => {
  // Capture console logs from the page
  page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  // Override the startLogin function and window.location to prevent navigation to OAuth portal
  await page.addInitScript(() => {
    console.log('OVERRIDE SCRIPT EXECUTED');
    // Try to override the startLogin function by importing the module
    try {
      // We are in the browser, so we can use dynamic import
      // However, we cannot use await in the top level of an init script
      // We can use the thenable of the import
      import('@/const').then((module) => {
        console.log('Imported module:', module);
        if (module && module.startLogin && typeof module.startLogin === 'function') {
          console.log('Overriding module.startLogin');
          const originalStartLogin = module.startLogin;
          module.startLogin = () => {
            console.log('startLogin called, but overridden to do nothing');
            // Simulate the OAuth flow by navigating to the callback with a mock code
            // We need to generate a state and a code.
            const state = 'mock-state-123';
            const code = 'mock-code-123';
            const redirectUrl = new URL('http://localhost:3000/api/oauth/callback');
            redirectUrl.searchParams.set('state', state);
            redirectUrl.searchParams.set('code', code);
            window.location.href = redirectUrl.href;
          };
        } else {
          console.log('module.startLogin not found or not a function');
        }
      }).catch((err) => {
        console.log('Failed to import module:', err);
      });
    } catch (err) {
      console.log('Error in override script:', err);
    }
    // Override the assign method
    const originalAssign = window.location.assign;
    window.location.assign = (url) => {
      if (url.includes('/mock-oauth')) {
        console.log('Prevented navigation to OAuth portal via assign:', url);
        // Instead of navigating, we can simulate the OAuth flow by redirecting to the callback with a mock code
        // For simplicity, we will just navigate to the root with a mock session cookie
        // In a real test, we would want to simulate the full OAuth flow, but for now we will just navigate to the app
        // and set a mock session cookie.
        // We cannot set cookies directly in the browser context from here, but we can navigate to a URL that sets the cookie.
        // We will navigate to the callback URL with a mock code and state.
        // We need to generate a state and a code.
        // We don't have the state from the startLogin function, but we can generate a random one.
        const state = 'mock-state-123';
        const code = 'mock-code-123';
        const redirectUrl = new URL('http://localhost:3000/api/oauth/callback');
        redirectUrl.searchParams.set('state', state);
        redirectUrl.searchParams.set('code', code);
        window.location.href = redirectUrl.href;
        return;
      }
      return originalAssign.call(window.location, url);
    };
    // Override the replace method
    const originalReplace = window.location.replace;
    window.location.replace = (url) => {
      if (url.includes('/mock-oauth')) {
        console.log('Prevented navigation to OAuth portal via replace:', url);
        // Same as above
        const state = 'mock-state-123';
        const code = 'mock-code-123';
        const redirectUrl = new URL('http://localhost:3000/api/oauth/callback');
        redirectUrl.searchParams.set('state', state);
        redirectUrl.searchParams.set('code', code);
        window.location.href = redirectUrl.href;
        return;
      }
      return originalReplace.call(window.location, url);
    };
    // Override the href setter
    const originalHrefDescriptor = Object.getOwnPropertyDescriptor(Window.prototype, 'href');
    Object.defineProperty(Window.prototype, 'href', {
      set: function (value) {
        if (value.includes('/mock-oauth')) {
          console.log('Prevented navigation to OAuth portal via href setter:', value);
          // Same as above
          const state = 'mock-state-123';
          const code = 'mock-code-123';
          const redirectUrl = new URL('http://localhost:3000/api/oauth/callback');
          redirectUrl.searchParams.set('state', state);
          redirectUrl.searchParams.set('code', code);
          this.href = redirectUrl.href;
          return;
        }
        return originalHrefDescriptor.set.call(this, value);
      },
      configurable: true
    });
  });

  // Track authentication state
  let isAuthenticated = false;

  // Mock all requests to handle OAuth callback and TRPC requests
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    console.log('ROUTE MATCH: url=' + url.toString() + ' method=' + request.method());

    // Handle OAuth callback
    if (pathname === '/api/oauth/callback') {
      // Simulate the OAuth callback endpoint that exchanges the code for a session
      // We expect the request to have query parameters: state and code
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');

      // For simplicity, we will just redirect back to the root with a session cookie
      // In a real app, this would set a session cookie and redirect to the app
      // We'll set a mock session cookie and redirect to /
      return route.fulfill({
        status: 302,
        headers: {
          'set-cookie': 'next-auth.session-token=mock-token; Path=/; HttpOnly',
          'location': '/',
        },
      );
    }

    // Handle TRPC requests
    if (pathname.startsWith('/api/trpc/')) {
      // Extract procedure names from pathname
      const trpcPathname = pathname.replace(/^\/api\/trpc\//, '');
      const procedureNames = trpcPathname.split(',');
      let inputObj = null;
      // Try to get input from query string (for GET requests)
      const inputParam = url.searchParams.get('input');
      if (inputParam) {
        try {
          inputObj = JSON.parse(inputParam);
        } catch (e) {
          console.log('Failed to parse trpc input from query:', inputParam);
          return route.continue();
        }
      } else if (request.method() === 'POST') {
        // Try to get JSON body for POST requests
        try {
          inputObj = request.postDataJSON();
        } catch (e) {
          // Fallback to text then parse
          const postDataText = request.postData();
          if (postDataText) {
            try {
              inputObj = JSON.parse(postDataText);
            } catch (e2) {
              console.log('Failed to parse trpc POST body as JSON:', postDataText);
              return route.continue();
            }
          } else {
            return route.continue();
          }
        }
      } else {
        // No input available
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
          console.log(`TRPC request: procedure=${procedureName}, input=${JSON.stringify(procedureInput)}`);
          let mockData = null;
          if (procedureName === 'auth.stytch.login') {
            mockData = { state: 'OTP_REQUIRED' };
            console.log('Mocking auth.stytch.login with OTP_REQUIRED');
          } else if (procedureName === 'auth.stytch.verifyOtp') {
            mockData = { state: 'SIGNED_IN' };
            console.log('Mocking auth.stytch.verifyOtp with SIGNED_IN');
            // Mark as authenticated after successful OTP verification
            isAuthenticated = true;
          } else if (procedureName === 'auth.me') {
            if (isAuthenticated) {
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
              console.log('Mocking auth.me with user (authenticated)');
            } else {
              mockData = null;
              console.log('Mocking auth.me with null (not authenticated)');
            }
          } else if (procedureName === 'models.list') {
            mockData = [
              { id: 'fast', name: 'Kairema Flash', description: 'Короткие повседневные ответы без ожидания.' },
              { id: 'think', name: 'Kairema Think', description: 'Логика, рассуждения и сложные задачи среднего объёма.' },
              { id: 'context', name: 'Kairema Context', description: 'Длинные документы, большие фрагменты текста и связный контекст.' },
              { id: 'apex': name: 'Kairema Apex', description: 'Требовательные задачи, глубокий анализ и комплексные ответы.' },
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
          // Compute superjson encoding of the mock data
          const superjsonEncoded = superjson.serialize(mockData);
          console.log(`Mock data for ${procedureName}:`, mockData);
          console.log(`Superjson encoded:`, superjsonEncoded);
          results.push({ result: { data: superjsonEncoded } });
        }
      }
      // The batch array is results
      const batchArray = results;
      // Convert batch array to JSON string (this is what the server sends)
      const body = JSON.stringify(batchArray);
      console.log('Mock response body (JSON string):', body);
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
      return;
    }

    // For all other requests, continue to the server
    return route.continue();
  });

  await page.goto('http://localhost:3000/');

  // Wait for the login page to load by waiting for the login button
  const loginButton = page.locator('button:has-text("Войти по email и паролю")');
  await expect(loginButton).toBeVisible({ timeout: 15000 });

  // Click the login button to reveal the form
  await loginButton.click();

  // Fill in the login form
  const emailInput = page.getByRole('textbox', { name: 'Email' });
  await expect(emailInput).toBeVisible({ timeout: 5000 });
  await emailInput.fill('test@example.com');
  const passwordInput = page.getByRole('textbox', { name: 'Пароль' });
  await expect(passwordInput).toBeVisible({ timeout: 5000 });
  await passwordInput.fill('password');
  // Press Enter in the password field to submit the form
  await passwordInput.press('Enter');

  // Debug: log current URL and page content
  const urlAfterEnter = page.url();
  console.log('URL after Enter:', urlAfterEnter);
  const pageContent = await page.content();
  console.log('Page content length:', pageContent.length);
  // Save a screenshot for debugging
  await page.screenshot({ path: 'debug-after-enter.png' });

  // After login, we should see OTP input (verify view)
  // Wait for the OPT heading to appear
  console.log('Waiting for OPT heading...');
  await expect(page.locator('text=Подтвердите email')).toBeVisible({ timeout: 5000 });
  console.log('OTP heading is visible');
  // Debug: log page text and take screenshot
  const pageTextAfterHeading = await page.innerText('body');
  console.log('Page text after OPT heading (first 1000 chars):', pageTextAfterHeading.slice(0, 1000));
  await page.screenshot({ path: 'debug-after-heading.png' });
  // Debug: log the number of input elements and their attributes
  const inputElements = await page.locator('input').all();
  console.log(`Number of input elements: ${inputElements.length}`);
  for (let i = 0; i < inputElements.length; i++) {
    const el = inputElements[i];
    const placeholder = await el.getAttribute('placeholder');
    const ariaLabel = await el.getAttribute('aria-label');
    const labelText = await el.getAttribute('label');
    const id = await el.getAttribute('id');
    const type = await el.getAttribute('type');
    const name = await el.getAttribute('name');
    console.log(`Input ${i}: type=${type}, id=${id}, name=${name}, placeholder=${placeholder}, aria-label=${ariaLabel}, label=${labelText}`);
  }
  // Debug: log the HTML of the body (first 2000 chars)
  const bodyHTML = await page.evaluate(() => document.body.innerHTML);
  console.log('Body HTML (first 2000 chars):', bodyHTML.slice(0, 2000));

  // Now attempt to fill the OTP code.
  // We will try to locate inputs by label "Цифра 1" through "Цифра 6".
  // If those are not found, we will try to find inputs by placeholder containing "код" or "code".
  // If still not found, we will fall back to filling the first input we find with the full code.
  let filled = false;
  // Try six separate inputs
  try {
    for (let i = 1; i <= 6; i++) {
      const input = page.getByLabel(`Цифра ${i}`);
      // Wait for the input to be attached
      await input.waitFor({ state: 'attached', timeout: 2000 });
      await input.fill(i.toString());
    }
    filled = true;
    console.log('Filled OTP using six separate labels');
  } catch (e) {
    console.log('Failed to fill OTP using six separate labels:', e.message);
  }
  if (!filled) {
    // Try to find a single input with placeholder suggesting a code
    try {
      const codeInput = page.locator('input[placeholder*="код i"], input[placeholder*="code i"], input[placeholder*="Код"], input[placeholder*="code"]');
      await codeInput.waitFor({ state: 'attached', timeout: 2000 });
      await codeInput.fill('123456');
      filled = true;
      console.log('Filled OTP using placeholder-based input');
    } catch (e) {
      console.log('Failed to fill OTP using placeholder-based input:', e.message);
    }
  }
  if (!filled) {
    // If there is exactly one input, fill it with the full code
    const inputCount = await page.locator('input').count();
    if (inputCount === 1) {
      const singleInput = page.locator('input').first();
      await singleInput.waitFor({ state: 'attached', timeout: 2000 });
      await singleInput.fill('123456');
      filled = true;
      console.log('Filled OTP using single input fallback');
    }
  }
  if (!filled) {
    // As a last resort, try to fill all inputs we find with the same digit? Not good.
    // We'll just throw an error to see what's happening.
    throw new Error('Could not locate OTP input(s) to fill');
  }

  // Click the "Подтвердить код" button
  await page.getByRole('button', { name: 'Подтвердить код' }).click();

  // Wait for the app to load by waiting for the model picker button
  const modelPickerButton = page.locator('role=button[name="Kairema Flash"]', { exact: true });
  await expect(modelPickerButton).toBeVisible({ timeout: 15000 });

  // Click the model picker button to open the model picker
  console.log('Clicking model picker button...');
  await modelPickerButton.click();
  // Debug: log what happens after clicking the model picker button
  console.log('After clicking model picker button, checking for model options...');
  // Wait a bit for the options to appear
  await page.waitForTimeout(500);
  // Log the number of elements with class model-option
  const modelOptions = await page.locator('.model-option').all();
  console.log(`Number of model-option elements: ${modelOptions.length}`);
  for (let i = 0; i < modelOptions.length; i++) {
    const opt = modelOptions[i];
    const dataModel = await opt.getAttribute('data-model');
    const textContent = await opt.innerText();
    console.log(`ModelOption ${i}: data-model=${dataModel}, text=${textContent}`);
  }
  // Log the HTML of a potential picker container
  const pickerContainerHTML = await page.evaluate(() => {
    const container = document.querySelector('.model-picker, .picker-options, [data-testid=\"model-picker\"]');
    return container ? container.innerHTML : 'No picker container found';
  });
  console.log('Picker container HTML (first 500 chars):', pickerContainerHTML.slice(0, 500));
  // Save a screenshot for debugging
  await page.screenshot({ path: 'debug-after-model-picker-click.png' });

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
  await sidebarLinks.filter({ hasText: /API Chat/i ).click();
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
  await expect(profileDTO).toBeVisible();
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

