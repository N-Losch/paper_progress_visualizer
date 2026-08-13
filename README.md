# Paper Progress Dashboard

A static GitHub Pages site that visualizes the submission timeline of one or
more papers: deadlines, time slots, logged events, and anything currently in
progress. No server, no build step, no framework runtime — plain HTML/CSS/JS
modules plus JSON files.

```
paper-progress-dashboard/
├── index.html              Dashboard (read-only view of all papers)
├── editor.html              Form-based creator/editor for a single paper
├── css/style.css
├── js/
│   ├── timeline-model.js    Date math + status computation (pure functions)
│   ├── timeline-render.js   Builds the SVG timeline (shared by both pages)
│   ├── schema-validate.js   Hand-rolled validator used in the browser
│   ├── paper-switcher.js    Pure logic for the dashboard's paper dropdown
│   ├── dashboard.js         Fetches data/papers/*.json, renders cards
│   └── editor.js            Form state, live preview, JSON export
├── data/
│   ├── schema/paper.schema.json   Authoritative JSON Schema (draft-07)
│   ├── template.json              Blank starting point for a new paper
│   └── papers/
│       ├── index.json             List of paper ids to show on the dashboard
│       └── example-paper.json     Worked example (mirrors the hand sketch)
├── tests/                   Node test suite (schema + logic + rendering)
├── .github/workflows/test.yml   Runs the test suite on every push
└── package.json             Only used for the test suite (ajv, ajv-formats)
```

## Storage design

Each paper is one JSON file in `data/papers/`, validated against
`data/schema/paper.schema.json`. A paper has:

- **`milestones`** — point-in-time markers, either a `deadline` (renders red
  once overdue and left unmarked) or an `event` (renders as a plain
  completed marker once its date passes). A milestone's `status` is
  computed automatically from today's date unless you set it explicitly.
- **`slots`** — time ranges, drawn as bars. Status (`upcoming` / `active` /
  `done` / `cancelled`) is likewise auto-computed unless overridden.
- **`events`** — a free-text log of things that actually happened
  ("submitted draft v1 to coauthors"), separate from planned milestones.
- **`processes`** — open-ended, no fixed end date, just `active: true/false`
  ("waiting on coauthor feedback"). Shown in the "currently running" panel.

Because GitHub Pages can't list a directory at runtime, `data/papers/index.json`
is the manifest that tells the dashboard which files to load. If a paper's
JSON file exists but isn't listed there, it won't appear — the test suite
checks for this and will fail if you forget.

`data/template.json` is a plain-text starting point if you'd rather hand-edit
a file than use the browser editor.

## Visualization

Rendering is a hand-built SVG (`js/timeline-render.js`), not a charting
library — the diagram is simple enough (an axis, diamonds/circles for
milestones, bracket-shaped bars for slots, a dashed line for "today") that a
library would add a dependency without adding real capability, and it kept
the design close to your sketch: the diamond markers, the "[ ... ]" bracket
bars, and the dashed today-line all mirror it directly.

Colors: green = done, amber = active, gray = upcoming/pending, red =
overdue. Deadlines are only ever "done" if you say so explicitly — an
unmarked deadline whose date has passed turns red rather than silently
disappearing, which is the entire point of a deadline tracker.

A "Viewing" dropdown above the paper list lets you switch between "All
papers" and a single paper. The selection is stored in the URL as
`#paper=<id>`, so a filtered view is bookmarkable and shareable, and
survives a page reload — reasonable for a static site with nowhere else
to persist UI state. Its logic (hash parsing/building, the show/hide
decision) lives in `js/paper-switcher.js` as plain functions with no DOM
dependency, specifically so it has real unit test coverage
(`tests/paper-switcher.test.mjs`) without pulling in a browser-based test
runner like Playwright for a handful of dropdown behaviors — that would
be a disproportionately heavy dependency for what it tests.

## Creation / editing interface

`editor.html` is a form: fill in paper metadata, add/remove milestones,
slots, events, and processes, see a live preview, validate, and download the
resulting JSON.

**Read this before you rely on it:** this is a static site with no backend,
so the editor **cannot commit to your repository for you**. It downloads
`<id>.json` and, on request, an updated `index.json`. You still have to move
the file into `data/papers/` and commit/push it yourself. I considered
having the editor call the GitHub API directly with a personal access token
typed into the browser — I'd rather not ship that: a client-side PAT sitting
in page memory/localStorage on a public GitHub Pages site is a real
credential-exposure risk for very little convenience gain. The two-step
download-then-commit flow is slower but doesn't have that problem. If you
want true in-browser write access later, the honest way to do it is a small
serverless function (e.g. a Cloudflare Worker) that holds the token
server-side and the editor calls instead — that's a deliberate scope cut,
not an oversight.

## Validation — two validators, on purpose, with a caveat

- `tests/` uses **ajv** (MIT-licensed, the de facto standard JSON Schema
  validator) against the real schema file. This is the authoritative check
  and runs in CI on every push.
- The browser (`js/schema-validate.js`) uses a small hand-written validator
  instead of shipping ajv to the client, to keep the site dependency-free.
  It checks the same shape rules **plus** two things plain JSON Schema
  can't express at all: slot `end` must not be before `start`, and ids must
  be unique across a paper. Both validators are exercised by the same test
  file (`tests/schema.test.mjs`) so they can't silently drift apart, but
  if you extend the schema, you have to update this file by hand too —
  that's the real trade-off, not a hidden one.

## Fonts, honestly

The pages pull Space Grotesk, IBM Plex Sans, and IBM Plex Mono from Google
Fonts' CDN. The font files themselves are open-licensed (SIL Open Font
License), but Google Fonts as a *delivery* mechanism is a third-party
service, not an open-source tool, and it does leak the visitor's IP to
Google on every page load. If that matters to you (e.g. self-hosting for
GDPR reasons or to avoid the external request entirely), download the
`.woff2` files from Google Fonts or Fontsource, put them in a new
`fonts/` folder, and swap the `<link>` tags in `index.html`/`editor.html`
for a local `@font-face` block in `css/style.css`. I didn't do this by
default because it adds three binary files to the repo for a cosmetic
choice you might want to make differently — it's a five-minute change if
you do.

## Running locally

```bash
# any static file server works, e.g.:
python3 -m http.server 8000
# then open http://localhost:8000/index.html and http://localhost:8000/editor.html
```

## Running the tests

```bash
npm install   # installs ajv + ajv-formats as dev dependencies (dev-only, not shipped to the browser)
npm test
```

The suite covers: the schema file itself compiles; `example-paper.json` and
every file listed in `index.json` validate against it; every physical file
in `data/papers/` is actually referenced from `index.json` (so nothing goes
missing silently); date/status computation logic (overdue vs. pending vs.
done, slot status transitions, event sorting); and the SVG renderer (valid
markup, tag balance, XSS-safe label escaping, today-marker only appears
when today is in range, layout grows to fit more slots).

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. Repo Settings → Pages → Source: "Deploy from a branch" → select your
   default branch and `/ (root)`.
3. Wait for the Pages build, then visit the published URL.

No build step is required — the site is served as-is. `.nojekyll` is
included so GitHub Pages doesn't run this through Jekyll (irrelevant here
since nothing starts with `_`, but it avoids a class of surprise if you add
such a file later).

## Adding a new paper, end to end

1. Open `editor.html` on the published site (or locally).
2. "Start from template", fill in the form, add milestones/slots as needed.
3. Click **Validate**, fix anything it flags.
4. Click **Download paper JSON**, save it into `data/papers/<id>.json`.
5. Click **Download updated index.json**, replace `data/papers/index.json`
   with it (or add the id by hand — it's a one-line array).
6. Commit and push both files.

## Known limitations

- No write-back from the editor to GitHub (see above — deliberate).
- The dashboard re-fetches and re-renders everything on load; fine for a
  personal set of a handful of papers, not built for hundreds.
- Dates are calendar dates (`YYYY-MM-DD`) with no timezone/time-of-day —
  intentional, since a submission deadline is a day, not a millisecond, and
  this sidesteps an entire category of off-by-one-day timezone bugs.
- The SVG layout staggers milestone labels by index, not by actual
  proximity, so two milestones that are very close together in time but
  land on the same stagger row can still visually crowd each other. Fine
  for the handful-of-milestones-per-paper case this was built for; would
  need real collision detection to scale further.
