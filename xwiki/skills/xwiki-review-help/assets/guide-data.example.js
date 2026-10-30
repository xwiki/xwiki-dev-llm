// The content of one change review guide, loaded by review-guide.html from the same folder as
// guide-data.js. Every text field is HTML. A field left out (or empty) is not displayed.
window.GUIDE = {
  // Unique per guide: every file:// page shares one localStorage in the browser, so two guides with
  // the same key would read each other's choices.
  storageKey: "my-app-1.4.0-review-v1",
  pageTitle: "My App 1.4.0 Review",          // browser tab, 2-4 words
  eyebrow: "My App · 1.3.x → 1.4.0",
  confidential: true,                         // shows the "Confidential, local only" badge
  title: "What the 1.4.0 changes do for users, and what to decide",
  exportTitle: "My App 1.4.0",                // first line of the exported Markdown
  lede: "One card per user-visible change of PRs #12 and #13. Likelihoods marked <span class='guess'>guess</span> are estimates, not data.",
  beforeLabel: "Before (1.3.x)",
  afterLabel: "After (1.4.0)",
  imgDir: "img",                              // screenshots folder, relative to the page

  // Optional free HTML sections, before the triage table and after the decisions (e.g. the PRs and
  // their merge order, a primer of the feature, release-notes lines). A function receives
  // { img, imgs } to embed screenshots.
  introNav: "PRs",
  intro: `<span class="eyebrow">Part 1</span><h2>The PRs and their merge order</h2>
    <div class="tablewrap"><table><thead><tr><th>PR</th><th>What it does</th><th>Cards</th></tr></thead><tbody>
    <tr><td><a href="https://github.com/org/repo/pull/12">#12</a></td><td>Validates the server URL.</td><td><a href="#A1">A1</a></td></tr>
    </tbody></table></div>`,
  outroNav: "Release notes",
  outro: `<h2>Release-notes lines (draft)</h2><ol class="check"><li>The server URL must now be an absolute HTTP or HTTPS URL.</li></ol>`,

  // Tier ids must be A, B and C (their colours are in the stylesheet). The last tier gets the
  // "accept all" button.
  tiers: [
    { id: "A", name: "Noticed widely, or needs an admin action", short: "widely noticed", legend: "many installs notice it, or an admin must act." },
    { id: "B", name: "Noticed only in unusual setups", short: "unusual setups", legend: "noticed only in unusual setups or by API clients." },
    { id: "C", name: "Invisible in practice", short: "invisible", legend: "invisible in practice, can be approved in bulk." }
  ],

  cards: [
    { id: "A1", tier: "A", ref: "PR #12 · #10",
      title: "The server URL must be an absolute http(s) URL",
      summary: "Saving a connection with a URL without scheme is refused, instead of saving a broken connection.",
      who: "Admins who type a URL without <code>https://</code>",          // short: also shown in the triage table
      likely: "<span class='guess'>guess</span>Occasional typo",           // short: also shown in the triage table
      adminShort: "Fix the URL when the error shows",                      // triage table only
      rnNeed: "Yes",                                                       // triage table only
      feature: "Administration › Connections › Add.",
      before: "The connection was saved and didn't work.",
      after: "An error notification asks for an absolute URL.",
      shots: [["a1-before.png", "Before: saved"], ["a1-after.png", "After: the error"]],  // thumbnails, click to enlarge
      whoDetail: "Existing connections keep working until they are saved again.",
      adminDo: "Nothing on upgrade.",
      why: "Otherwise …",
      alts: "<ul><li>Answer 400 instead of 409.</li></ul>",
      rec: "Accept.",
      rn: "The server URL of a connection must now be an absolute HTTP or HTTPS URL." }
  ],

  // Choices made or left open by the fixes and reviews. decided: true = already implemented, to confirm.
  decisions: [
    { id: "D1", decided: false, ref: "PR #12",
      title: "Status code for an invalid URL",
      q: "The PR answers 409, like the other validation errors of the endpoint.",
      opts: [["Keep 409", "Consistent with the endpoint."], ["Use 400", "More accurate HTTP."]],
      reviewer: "Noted, not changed.",
      mine: "Keep 409." }
  ],

  footer: "Built from the PR branches and the review notes. Choices are stored in this browser only."
};
