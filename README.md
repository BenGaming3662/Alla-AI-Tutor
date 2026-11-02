# Alla AI Tutor

Alla AI is a math-first study tutor that can also help with other academic
subjects. The browser app sends lesson requests to a server-side API, so the
OpenAI API key is never part of the published site.

## Run locally

1. Install Node.js 22 and npm.
2. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` in `.env`.
3. Run `npm install`, then `npm start`.
4. Open the local URL printed in the terminal.

Do not commit `.env` or put an API key in browser code.

## Push to GitHub and deploy with Netlify

1. From the repository root, run the checks:

   ```sh
   npm test
   npm run build
   ```

2. Commit and push the project to the GitHub repository:

   ```sh
   git add .
   git commit -m "Prepare app for Netlify"
   git push origin <your-branch>
   ```

   `.env`, other `.env.*` files, `secrets.js`, `node_modules`, and `dist` are
   ignored by Git. Review `git status` before committing and never force-add
   local credentials.

3. In Netlify, choose **Add new site → Import an existing project**, connect
   `BenGaming3662/Alla-AI-Tutor`, and select the branch to deploy. Netlify reads
   `netlify.toml` for the build command (`npm run build`), publish directory
   (`dist`), Functions directory, and `/openai` API rewrite.
4. Before the first deploy, add `OPENAI_API_KEY` in the Netlify site's
   environment variables with access for Functions. Do not put this key in
   GitHub, `netlify.toml`, or any file in the publish directory.
5. Deploy the site and test lesson generation from its Netlify URL. After the
   GitHub repository is connected, pushes to the configured production branch
   trigger new Netlify builds and deploys automatically.

## Checks

```sh
npm test
npm run build
```
