const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('OpenAi.js', 'utf8');

const context = {
  window: { APP_CONFIG: { OPENAI_API_KEY: 'test-key' } },
  fetch: async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'Category: Id10T error.' } }] })
  }),
  console,
  setTimeout,
  clearTimeout
};

vm.createContext(context);
vm.runInContext(code, context);

(async () => {
  const result = await context.window.AskOpenAi('This is a test prompt with more than four words to trigger detection');
  console.log(result);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
