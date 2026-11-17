// Background worker: runs the full OpenAI quiz flow (can take longer than 26s).
// The browser never waits on this response; results are saved to Netlify Blobs.
const { AskOpenAi } = require("../../OpenAi");
const { getQuizStore } = require("../lib/quizJobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Use POST" };
  }

  let jobId = "";
  let prompt = "";

  try {
    const payload = JSON.parse(event.body || "{}");
    jobId = String(payload.jobId || "").trim();
    prompt = String(payload.prompt || "").trim();
  } catch (err) {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  if (!jobId || !prompt) {
    return { statusCode: 400, body: "jobId and prompt are required" };
  }

  const store = getQuizStore();

  try {
    if (!process.env.OPENAI_API_KEY) {
      await store.setJSON(jobId, {
        status: "error",
        error: "OPENAI_API_KEY is missing on Netlify",
        finishedAt: Date.now()
      });
      return { statusCode: 200, body: "missing key" };
    }

    // Tell the poller that work is actively running.
    await store.setJSON(jobId, {
      status: "running",
      prompt,
      startedAt: Date.now()
    });

    // This can take a while; that is why this file is a background function.
    const quiz = await AskOpenAi(prompt, process.env.OPENAI_API_KEY);

    if (quiz && quiz.error && (!Array.isArray(quiz.questions) || quiz.questions.length === 0)) {
      await store.setJSON(jobId, {
        status: "error",
        error: quiz.error,
        quiz,
        finishedAt: Date.now()
      });
      return { statusCode: 200, body: "saved error" };
    }

    await store.setJSON(jobId, {
      status: "done",
      quiz,
      finishedAt: Date.now()
    });

    return { statusCode: 200, body: "saved quiz" };
  } catch (err) {
    try {
      await store.setJSON(jobId, {
        status: "error",
        error: err.message || String(err),
        finishedAt: Date.now()
      });
    } catch (storeErr) {
      console.error("Failed to save job error:", storeErr);
    }

    // Background handlers should not throw after retries are exhausted unnecessarily.
    return { statusCode: 200, body: "saved failure" };
  }
};
