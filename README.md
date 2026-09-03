# Paper Progress Dashboard

A static GitHub Pages site that visualizes the submission timeline of one or
more papers: deadlines, time slots, logged events, and anything currently in
progress.

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
is the manifest that tells the dashboard which files to load.


## Visualization

Rendering is a hand-built SVG (`js/timeline-render.js`).

Colors: green = done, amber = active, gray = upcoming/pending, red =
overdue. Deadlines are only ever "done" if you say so explicitly — an
unmarked deadline whose date has passed turns red rather than silently
disappearing.

A "Viewing" dropdown above the paper list lets you switch between "All
papers" and a single paper. The selection is stored in the URL as
`#paper=<id>`, so a filtered view is bookmarkable and shareable, and
survives a page reload — reasonable for a static site with nowhere else
to persist UI state. Its logic (hash parsing/building, the show/hide
decision) lives in `js/paper-switcher.js` as plain functions with no DOM
dependency.

## Creation / editing interface

`editor.html` is a form: fill in paper metadata, add/remove milestones,
slots, events, and processes, see a live preview, validate, and download the
resulting JSON.

It downloads `<id>.json` and, on request, an updated `index.json`. You still have to move
the file into `data/papers/` and commit/push it yourself. 

## Validation — two validators, on purpose, with a caveat

- `tests/` uses **ajv** against the real schema file. This is the authoritative check
  and runs in CI on every push.
- The browser (`js/schema-validate.js`) uses a small hand-written validator
  instead of shipping ajv to the client, to keep the site dependency-free.
  It checks the same shape rules **plus** two things plain JSON Schema
  can't express at all: slot `end` must not be before `start`, and ids must
  be unique across a paper. Both validators are exercised by the same test
  file (`tests/schema.test.mjs`).

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

## Adding a new paper, end to end

1. Open `editor.html` on the published site (or locally).
2. "Start from template", fill in the form, add milestones/slots as needed.
3. Click **Validate**, fix anything it flags.
4. Click **Download paper JSON**, save it into `data/papers/<id>.json`.
5. Click **Download updated index.json**, replace `data/papers/index.json`
   with it (or add the id by hand — it's a one-line array).
6. Commit and push both files.
