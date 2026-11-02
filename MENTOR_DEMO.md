# Alla AI — Mentor Demo

## 15-minute walkthrough

### 0:00–1:00 — Goal

Alla AI is a math-first study tutor that can also help with other academic
subjects. A lesson should teach the foundations, show worked examples, provide
practice, and let a student check their own final answers.

### 1:00–5:00 — Demonstrate a lesson

1. Start the app with `npm start`, then open the local URL printed in the
   terminal. In VS Code, **Run and Debug → Debug Alla AI locally** starts it
   and opens the browser automatically.
2. Enter: `Area of a 6 cm by 4 cm rectangle`.
3. Show the Review stage first. Look for multiplication prerequisites and an
   explanation that area uses square units.
4. Walk through the worked example, Guided Practice, More Practice, and Final
   Practice.
5. In Final Practice, enter a numeric value without units when the expected
   answer includes units (for example, `24` for `24 cm^2`) and select **Check
   Answers**. Then try a conflicting unit to show that unit tolerance is not
   the same as accepting any answer.

If the model is unavailable or the API key is not configured, explain that the
lesson needs a server-side OpenAI API key; never show or paste the key during
the demo.

### 5:00–10:00 — Explain the code

- [index.html](./index.html) is the student-facing interface. It submits the
  prompt, renders the lesson stages, and displays local final-answer feedback.
- [OpenAi.js](./OpenAi.js) requests structured lesson data from `gpt-4o-mini`,
  checks the generated lesson and prerequisites, verifies question sets, and
  compares student answers with expected answers.
- [server.js](./server.js) is the local API boundary. It validates same-origin
  requests and keeps the OpenAI call on the server rather than in the browser.
- [netlify/functions/openai.js](./netlify/functions/openai.js) provides the
  corresponding server-side endpoint for a Netlify deployment.
- [netlify.toml](./netlify.toml) and [build.js](./build.js) configure the
  Netlify route and produce a `dist` folder containing only the public app
  files.
- [regression-check.js](./regression-check.js) exercises lesson validation,
  answer matching, local HTTP behavior, and the Netlify function without
  making paid model requests.

The request flow is:

`Browser form → POST /openai → local server or Netlify function → OpenAI`

The lesson comes back to the browser, where the stages are rendered and final
answers are checked locally.

### 10:00–12:00 — Show the checks

Run:

```text
npm test
npm run build
```

The tests cover the expected 3/3/5 question counts, verified lesson content,
math prerequisites, numeric answers with omitted or equivalent units,
conflicting-unit rejection, malformed requests, and bounded retry behavior.
The build stages the static files used by Netlify.

### 12:00–15:00 — Discuss next steps

Be clear that Netlify deployment is prepared, not yet live. To publish, import
the repository into Netlify, configure `OPENAI_API_KEY` as a server-side
environment variable, deploy, and test the deployed URL. No browser extension
is required; students can use a normal browser. Local development uses
localhost, and the VS Code debug configuration opens that page automatically.

Possible next steps to discuss: publish and test the Netlify site, gather
student feedback on prerequisite explanations, and expand regression coverage
for more math topics and unit formats.
