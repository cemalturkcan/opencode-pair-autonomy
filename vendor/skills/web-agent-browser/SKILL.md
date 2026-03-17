---
name: web-agent-browser
description: Browser automation with web-agent-mcp. Covers session management, iframe-based auth flows (Apple Developer, Google), 2FA handling, and reliable interaction patterns for complex web applications.
---

## Purpose
Use this skill for browser automation tasks using `web-agent-mcp`. Covers the proven patterns for interacting with embedded iframes, auth flows, 2FA prompts, and dynamic SPAs.

## Use When
- The task involves web-agent-mcp tool usage (`session_create`, `act_fill`, `observe_screenshot`, etc.)
- The target page uses iframe-based auth (Apple Developer, Google, etc.)
- The task involves login, form submission, or multi-step auth flows
- 2FA / verification code input is needed

---

## Session Lifecycle

```
1. session_create → get session_id
2. page_navigate (url, wait_until="networkidle")
3. observe_screenshot → understand page state
4. interact (act_fill / act_click / runtime_evaluate_js)
5. session_close when done
```

Always take a screenshot before interacting. Never guess the page state.

---

## Iframe Handling

### Option A — frame_selector parameter (preferred for same-origin or Playwright-accessible iframes)
```
act_fill:
  selector: "input#account_name_text_field"
  frame_selector: "iframe#aid-auth-widget-iFrame"
  value: "user@example.com"
```
Works for iframes Playwright can access via `frameLocator()`.

### Option B — JavaScript contentDocument injection (fallback for same-session cross-origin iframes)
Use when `frame_selector` times out. Apple Developer's login iframe (`idmsa.apple.com`) is accessible via `contentDocument` in the same browser session:

```javascript
// Fill email in Apple iframe
const iframe = document.querySelector('iframe#aid-auth-widget-iFrame');
const emailInput = iframe.contentDocument.querySelector('#account_name_text_field');
emailInput.focus();
emailInput.value = 'user@example.com';
emailInput.dispatchEvent(new Event('input', { bubbles: true }));
emailInput.dispatchEvent(new Event('change', { bubbles: true }));
```

```javascript
// Click Continue / Sign In button
const iframe = document.querySelector('iframe#aid-auth-widget-iFrame');
const btn = iframe.contentDocument.querySelector('#sign-in');
btn.click();
```

```javascript
// Wait and check state
await new Promise(r => setTimeout(r, 3000));
const iframe = document.querySelector('iframe#aid-auth-widget-iFrame');
const passwordField = iframe.contentDocument.querySelector('#password_text_field');
JSON.stringify({
  passwordVisible: passwordField ? getComputedStyle(passwordField).display !== 'none' : false,
  bodyText: iframe.contentDocument.body.innerText.substring(0, 500)
});
```

---

## Apple Developer Portal Login

**URL:** `https://developer.apple.com/account`

**Login flow:**
1. `page_navigate` → `https://developer.apple.com/account`
2. `observe_screenshot` — verify login form visible
3. Fill email via JavaScript injection (Option B above) into `#account_name_text_field`
4. Click `#sign-in` (Continue button)
5. Wait 3s, take screenshot — password field should appear
6. Fill password via JavaScript into `#password_text_field`
7. Click `#sign-in` (Sign In button)
8. Wait 5s, take screenshot — check for 2FA prompt

**Iframe selector:** `iframe#aid-auth-widget-iFrame`
**Email field:** `#account_name_text_field`
**Password field:** `#password_text_field`
**Action button:** `#sign-in` (used for both Continue and Sign In)

### 2FA Handling
After sign-in, Apple shows phone number selection for SMS code:
1. `observe_screenshot` to see the 2FA options
2. Ask the user which phone number to use if multiple options shown
3. Click the desired phone option
4. Wait for user to provide the 6-digit code
5. Use `act_enter_code` or `runtime_evaluate_js` to fill the code fields
6. Submit

---

## General Patterns

### Detecting page state after navigation
```javascript
// Check current URL and key elements
JSON.stringify({
  url: window.location.href,
  title: document.title,
  hasError: !!document.querySelector('.error, [role="alert"], .alert-error'),
  errorText: document.querySelector('.error, [role="alert"]')?.textContent?.trim()
});
```

### React/Vue input filling (when plain value= doesn't work)
```javascript
const input = document.querySelector('input#myField');
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
nativeInputValueSetter.call(input, 'new value');
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

### Checking for login success (Google pattern)
```javascript
document.querySelector('a[href*="SignOutOptions"], [aria-label*="Google Account"], [data-ogsr-up]')?.getAttribute('aria-label') || 'not logged in';
```

---

## Guardrails
- Always `observe_screenshot` before each major action to confirm page state.
- After clicking Submit/Continue, wait 3-5 seconds before checking result.
- If `frame_selector` times out, switch to JavaScript `contentDocument` injection.
- Never store credentials in artifacts or history — use them directly in JS expressions.
- If 2FA code is needed, always ask the user and wait — do not attempt to bypass.
- Use `session_close` after completing the task to release the Chrome profile lock.
