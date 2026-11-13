// This file runs on Netlify's server, NOT in the browser.
// That's why it can safely read process.env.OPENAI_API_KEY.
const { AskOpenAi } = require("../../OpenAi");

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Use POST" }) };
  }

  try {
    // Read the student's prompt sent from the browser
    const { prompt } = JSON.parse(event.body || "{}");

    // Call OpenAI using the secret key stored in Netlify
    const result = await AskOpenAi(prompt, process.env.OPENAI_API_KEY);

    // Send the quiz back to the browser
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};