// Reusable Playwright login helper. Use this instead of HTTP Basic auth whenever a script needs
// to perform an authenticated WRITE action through the browser (submitting a form, clicking a
// button that POSTs) - some endpoints (e.g. the annotation-rest module's POST) reject Basic auth
// with "Invalid or missing form token" even with a scraped token, for reasons not fully root-
// caused (suspected response caching serving a stale token). A real form-based login session
// sidesteps the question entirely, since the token is read live off the actually-rendered page.
//
// Basic auth via curl is still fine for read-only calls and for the wiki Import flow used by
// setup-xar-instance.sh - this helper is specifically for browser-driven write actions.
//
// Usage:
//   const { login } = require(process.env.XWIKI_CAPTURE_SKILL + '/xwiki-login');
//   await login(page);                                  // uses XWIKI_BASE_URL and the admin vars
//   await login(page, 'http://localhost:8080');          // or pass a base URL explicitly
// where XWIKI_CAPTURE_SKILL points at this skill's directory (SKILL.md, step 0, exports it).
//
// baseUrl is accepted either as the host root (http://localhost:8080) or with the webapp path
// already on it (http://localhost:8080/xwiki): XWIKI_BASE_URL carries the /xwiki suffix because
// the other JS helpers need it, while setup-xar-instance.sh's --base-url does not. A trailing
// /xwiki is stripped here so both forms work - passing the suffixed form used to produce
// /xwiki/xwiki/bin/login/..., which 404s and leaves the session silently logged out.
async function login(
  page,
  baseUrl = process.env.XWIKI_BASE_URL || 'http://localhost:8080',
  user = process.env.XWIKI_ADMIN_USER || 'Admin',
  password = process.env.XWIKI_ADMIN_PASS || 'admin'
) {
  const host = String(baseUrl).replace(/\/+$/, '').replace(/\/xwiki$/, '');
  const url = `${host}/xwiki/bin/login/XWiki/XWikiLogin`;
  await page.goto(url);
  // Do NOT gate on the response status: XWiki serves this page with 401 by design, form and all.
  // Wait for the form instead - that distinguishes "wrong base URL" (no form on a 404 page) from
  // the expected 401, and fails here rather than silently continuing unauthenticated.
  try {
    await page.waitForSelector('#j_username', { timeout: 10000 });
  } catch (e) {
    throw new Error(`login: no login form at ${url} - check the base URL`);
  }
  await page.fill('#j_username', user);
  await page.fill('#j_password', password);
  await page.click('input[type=submit]');
  await page.waitForLoadState('networkidle');
}

module.exports = { login };
