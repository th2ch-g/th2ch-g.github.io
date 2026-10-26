# My portfolio

## Local validation

Install Node.js 22.12 or newer and uv, then prepare the dependencies and browsers:

```bash
npm ci
export PLAYWRIGHT_BROWSERS_PATH=.cache/playwright
npx playwright install --with-deps chromium firefox webkit
```

Before pushing code or content changes, run:

```bash
npm run check:local
```

This checks types, CSS, build inputs, and security regressions, builds the site
once, and runs the browser and quality checks against that build. It covers all
three browser engines; leave `BROWSER_ENGINE` unset for the full check. Lighthouse
runs after the other browser processes exit and uses Playwright's Chromium.
Set `CHROME_PATH` only to override that executable.

For an existing build, `npm run check:quality` runs the mobile fixes,
accessibility, visual consistency, and Lighthouse checks. Generated builds,
browser downloads, and reports are ignored by Git.

## GitHub Actions

Pull requests run one build. Pushes to `main` build and deploy to GitHub Pages,
reusing the npm and GitHub card caches. Type, browser, and quality checks run
locally, so a successful Actions run confirms only the build and deployment.
Configure branch protection to require the `build` check. Automated dependency
updates receive this build check; they do not run the local validation suite.
The monthly external link check remains scheduled separately.
