const { AskOpenAi } = require("../../OpenAi");
const { validatePromptInput } = require("../../zod");

const MAX_REQUEST_BYTES = 16 * 1024;

function jsonResponse(statusCode, value) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(value)
  };
}

async function handler(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const headers = event.headers || {};
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  if (!String(contentType).toLowerCase().startsWith("application/json")) {
    return jsonResponse(415, { error: "Content-Type must be application/json." });
  }

  const origin = headers.origin || headers.Origin;
  const host = headers.host || headers.Host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return jsonResponse(403, { error: "Cross-origin requests are not allowed." });
    } catch {
      return jsonResponse(403, { error: "Invalid request origin." });
    }
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : String(event.body || "");
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    return jsonResponse(413, { error: "Request is too large." });
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    return jsonResponse(400, { error: "Request body must contain valid JSON." });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse(400, { error: "Request body must be a JSON object." });
  }

  const validation = validatePromptInput({ prompt: payload.prompt ?? payload.message ?? "" });
  if (!validation.success) {
    const message = validation.error.flatten().fieldErrors?.prompt?.[0] || "Please provide a valid prompt.";
    return jsonResponse(400, { error: message });
  }
  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(500, { error: "OpenAI API key is not configured." });
  }

  try {
    const text = await AskOpenAi(validation.data.prompt, process.env.OPENAI_API_KEY);
    if (text?.error) return jsonResponse(502, { error: text.error });
    return jsonResponse(200, { text });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Unable to generate a lesson right now." });
  }
}

module.exports = { handler, MAX_REQUEST_BYTES };
