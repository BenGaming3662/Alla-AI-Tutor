// Returns the current status of a quiz job for the browser poller.
const { getQuizStore, jsonResponse } = require("../lib/quizJobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Use GET" });
  }

  const jobId = String(event.queryStringParameters?.jobId || "").trim();
  if (!jobId) {
    return jsonResponse(400, { error: "jobId is required" });
  }

  try {
    const store = getQuizStore(event);
    // Read the saved job as JSON from Netlify Blobs.
    const job = await store.get(jobId, { type: "json" });

    if (!job) {
      return jsonResponse(404, { status: "missing", error: "Job not found", jobId });
    }

    return jsonResponse(200, {
      jobId,
      status: job.status || "pending",
      quiz: job.quiz || null,
      error: job.error || null
    });
  } catch (err) {
    return jsonResponse(500, {
      status: "error",
      error: err.message || "Could not read job status",
      jobId
    });
  }
};
