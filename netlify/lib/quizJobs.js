// Shared helpers for quiz jobs stored in Netlify Blobs.
// The browser never talks to OpenAI; it only starts a job and polls for status.
const { getStore } = require("@netlify/blobs");

const STORE_NAME = "quiz-jobs";

// One blob store for all in-progress and finished quiz jobs.
function getQuizStore() {
  return getStore(STORE_NAME);
}

// Build a base site URL so the start function can kick off the background worker.
function getSiteUrl(event) {
  if (process.env.URL) {
    return process.env.URL.replace(/\/$/, "");
  }
  if (process.env.DEPLOY_PRIME_URL) {
    return process.env.DEPLOY_PRIME_URL.replace(/\/$/, "");
  }

  const host = event?.headers?.host || event?.headers?.Host;
  if (host) {
    const proto = event?.headers?.["x-forwarded-proto"] || "http";
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  return "http://localhost:8888";
}

// Small JSON helper so every function returns the same shape.
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

module.exports = {
  getQuizStore,
  getSiteUrl,
  jsonResponse
};
