// Starts a quiz job and kicks off the slow OpenAI work in the background.
// Returns a jobId right away so the browser can poll for the finished quiz.
const crypto = require("crypto");
const { getQuizStore, getSiteUrl, jsonResponse } = require("../lib/quizJobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Use POST" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(500, { error: "OPENAI_API_KEY is missing on Netlify" });
  }

  let prompt = "";
  try {
    const payload = JSON.parse(event.body || "{}");
    prompt = String(payload.prompt || "").trim();
  } catch (err) {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (!prompt) {
    return jsonResponse(400, { error: "Please provide a prompt." });
  }

  const jobId = crypto.randomUUID();
  const store = getQuizStore(event);

  // Mark the job as pending before the background worker starts.
  await store.setJSON(jobId, {
    status: "pending",
    prompt,
    createdAt: Date.now()
  });

  const siteUrl = getSiteUrl(event);
  const backgroundUrl = `${siteUrl}/.netlify/functions/openai-background`;

  try {
    // This call returns 202 quickly; the heavy OpenAI work continues in the background.
    const invokeResponse = await fetch(backgroundUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, prompt })
    });

    if (invokeResponse.status !== 202 && invokeResponse.status !== 200) {
      const details = await invokeResponse.text().catch(() => "");
      await store.setJSON(jobId, {
        status: "error",
        error: `Could not start background job (${invokeResponse.status}). ${details}`.trim(),
        finishedAt: Date.now()
      });
      return jsonResponse(502, { error: "Could not start the quiz job.", jobId });
    }
  } catch (err) {
    await store.setJSON(jobId, {
      status: "error",
      error: err.message || "Could not start background job",
      finishedAt: Date.now()
    });
    return jsonResponse(502, { error: err.message || "Could not start the quiz job.", jobId });
  }

  return jsonResponse(202, {
    jobId,
    status: "pending",
    message: "Quiz job started"
  });
};
