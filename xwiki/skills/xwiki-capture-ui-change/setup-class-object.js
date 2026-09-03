// Create a throwaway XWiki class + object directly via action URLs, bypassing any
// higher-level wizard UI (e.g. AppWithinMinutes' drag-and-drop palette). This is what actually
// renders a PropertyClass subtype's displayEdit()/displayView() HTML for a screenshot, without
// the flakiness of automating AWM's mouse-based drag-and-drop and its custom save button
// (AWM overrides the standard save button: selector is [name=xaction_save], and clicking the
// wrong thing silently saves to the wrong place - direct action URLs sidestep all of that).
//
// Usage: node setup-class-object.js <space> <propname> <propTypeFQCN>
// Example: node setup-class-object.js TicketNameAfter number1 com.xpn.xwiki.objects.classes.NumberClass
//
// After this, the field is visible/editable at:
//   http://localhost:8080/xwiki/bin/edit/<space>/WebHome?editor=object
// Click the "<space> 0:" object row text to expand it (it's collapsed by default; clicking the
// object-group's own outer caret instead collapses everything - target the row text, not a caret
// icon index, since there are two nested toggle-collapsable elements and indices aren't stable).
// Give the AJAX ~2s after that click before screenshotting or querying for the field.
const { chromium } = require('playwright');
const { login } = require(__dirname + '/xwiki-login');

const BASE = process.env.XWIKI_BASE_URL || 'http://localhost:8080/xwiki';

const [space, propname, proptype] = process.argv.slice(2);
if (!space || !propname || !proptype) {
  console.error('usage: node setup-class-object.js <space> <propname> <propTypeFQCN>');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

  await login(page);

  // CSRF token, grabbed from any already-rendered page's meta tag.
  await page.goto(`${BASE}/bin/view/Main/WebHome`);
  const token = await page.evaluate(() => document.querySelector('meta[name="form_token"]')?.content);
  if (!token) {
    console.error('could not read form_token meta tag - login likely failed');
    process.exit(1);
  }

  // Gotcha: the query param is "proptype", NOT "type" - using the wrong name fails silently
  // (200 response, redirects to the class editor, but no property is actually added).
  const r1 = await page.goto(
    `${BASE}/bin/propadd/${space}/WebHome?propname=${propname}` +
      `&proptype=${encodeURIComponent(proptype)}&form_token=${token}`
  );
  console.log('propadd status:', r1.status(), '->', page.url());

  const r2 = await page.goto(`${BASE}/bin/objectadd/${space}/WebHome?classname=${space}.WebHome&form_token=${token}`);
  console.log('objectadd status:', r2.status(), '->', page.url());

  await browser.close();

  console.log(`Done. Verify: curl -s -u Admin:admin "${BASE}/rest/wikis/xwiki/classes/${space}.WebHome"`);
  console.log(`Edit at: ${BASE}/bin/edit/${space}/WebHome?editor=object`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
