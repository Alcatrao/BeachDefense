# Three playable versions

- Original: https://alcatrao.github.io/BeachDefense/
- Codex: https://alcatrao.github.io/BeachDefense/codex/
- Claude: https://alcatrao.github.io/BeachDefense/claude/

The `Publish three game versions` workflow on **main** exports root HTML and
`js/`, `assets/`, `textures/` from main, `codex/breaking-surf`, and
`claude/shorebreak-waves` into one Pages artifact. Game files are copied byte for
byte; the wave branches are never merged or rewritten. Assistant notes, reviews,
screenshots, private worktrees and repository metadata are excluded. `versions.json`
on the site records the source commits and SHA-256 of every exported file.

Every main push rebuilds all versions. Each wave branch has a tiny `Wave branch
updated` push workflow. Its successful completion automatically triggers the
publisher on main through `workflow_run`; the publisher always checks out main
and exports the latest independent branch snapshots. No access token or game-code
merge is needed. Keep `.github/workflows/wave-updated.yml` on both wave branches.
Manual refresh remains available: Actions → **Publish three game versions** →
**Run workflow** → branch **main** (or `gh workflow run pages.yml --ref main`).
Concurrent publications are serialized. One successful publication replaces all
three folders together; do not deploy a wave branch directly to Pages.

Before publishing, a headless Chromium test serves the artifact under the actual
`/BeachDefense/` prefix, starts each game, checks network/page errors, and verifies
the Codex module workers, binary initial state, and advancing fluid clocks. A failed
test blocks publication. Screenshots and request evidence are retained as the
`pages-browser-evidence` Actions artifact. This is a startup/path smoke test, not
a long gameplay or wave-physics validation.

For local testing: fetch both wave refs into `origin/…`, run
`python tooling/pages/build.py`, then `node tooling/pages/smoke.cjs` with Playwright
installed. The builder requires a fresh `_site`; preserve or remove prior output
explicitly before rebuilding. Set `PLAYWRIGHT_MODULE`, `BROWSER_CHANNEL`, and
`GPU=1` to use an existing local Playwright/Edge installation. `SITE_URL` tests the
published site instead of local output. Windows runs must follow the shared
Resource Governor guidance before launching a browser.

To roll back a wave version, revert its source branch normally and manually rerun
the workflow. To restore the former legacy publication, switch Settings → Pages
to Deploy from a branch, main, root; the original main game remains unchanged.

Implementation reference (18 October 2026):
https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run
