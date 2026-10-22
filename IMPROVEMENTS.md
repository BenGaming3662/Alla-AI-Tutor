# Quiz Generator Improvements

## Request Routing

- Requests of four words or fewer are classified during lesson generation. Longer requests use a separate AI classification call. The model returns the `Id10T error` sentinel for non-academic requests; no local academic-subject allowlist is used.

## Local App and API Key

- Put `OPENAI_API_KEY=your-key` in the ignored local `.env` file, run `npm start`, and open `http://localhost:3000`; opening `index.html` directly is intentionally unsupported. A process environment variable takes precedence over `.env`.
- The browser does not load `secrets.js`, send an API key, or call OpenAI directly.
- The local server binds to loopback by default, serves only the app's explicit static files, accepts bounded JSON requests, and rejects non-local origins/hosts.

## Generation and Verification

- Guided Practice and More Practice each contain exactly three questions; Final Practice contains exactly five. The same counts are prompted, validated, verified, Zod-checked, and rendered.
- `VERIFICATION_SCHEMA` checks both original question sets and their corrected sets, with accuracy and topic flags on every item. The validator confirms that original entries correspond to the generated questions and that corrected arrays preserve their respective lengths.
- Verification retries generation up to three times. Repeated failures report whether generation counts/data or verification checks failed and advise the user to try again or contact support.
- Two-digit addition is checked locally: each problem must use two two-digit addends and its answer must equal their sum.

## Answer Matching

- Grading normalizes case and punctuation, compares equivalent numeric strings, recognizes exact acronym/expansion pairs such as `FOIL` and `First, Outer, Inner, Last`, and accepts numeric answers when a student omits the expected unit (for example, `75` for `75 cm²`). Conflicting explicit units remain incorrect.
- Partial substring and loose word-overlap matches are rejected to avoid accepting incorrect answers.

## Review Foundations

- The Review stage includes a required prerequisite refresher, with concrete examples, before formulas and the worked problem. Math generation explicitly includes foundational multiplication facts where appropriate, including single-digit multiplication before larger products or area problems.
- Lesson titles and the About page describe Alla AI as a math-first tutor that can also support other academic subjects.

## Model Choice

- Lesson generation, verification, and longer-prompt classification use `gpt-4o-mini`, which supports structured outputs and is currently priced at $0.15 per million input tokens and $0.60 per million output tokens on standard pricing.
- `gpt-4.1-nano` is cheaper ($0.10 input / $0.40 output per million tokens) and supports structured outputs, but the project retains `gpt-4o-mini` as the quality/cost balance for multi-step lesson generation and verification.

## Netlify Deployment

- `npm run build` stages only `index.html`, `About.html`, and the browser `OpenAi.js` into `dist`; local secrets, server files, and tests are excluded.
- `netlify.toml` publishes `dist`, deploys the `netlify/functions/openai.js` API, and rewrites `/openai` to the function. Configure `OPENAI_API_KEY` in the Netlify site's environment variables before deploying; do not add it to the repository or publish directory.
- To publish without localhost: in Netlify, choose **Add new site → Import an existing project**, connect `BenGaming3662/Alla-AI-Tutor`, and use the repository root. Netlify reads the build command (`npm run build`), publish directory (`dist`), and Functions directory from `netlify.toml`.
- In the Netlify site, add `OPENAI_API_KEY` under **Site configuration → Environment variables**, ensuring the variable is available to Functions, then trigger a new deploy. Visit the generated `https://<site-name>.netlify.app` URL; the browser's same-origin `/openai` request is rewritten to the function.
- This workspace has no authenticated Netlify CLI or deploy token, so it can prepare and verify the deployment but cannot publish the live site. Local development remains available with `npm start`.

## Validation

Run `npm test` to check category routing, dynamic question counts, verification integrity, two-digit addition, answer matching and unit tolerance, prerequisite review validation, a Zod-validated calculus limits question and answer, local and Netlify API validation, HTTP security behavior, upstream failures, and bounded retries. `npm run build` creates the Netlify publish directory.
