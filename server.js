const http = require("http");
const { AskOpenAi } = require("./OpenAi");
const { validatePromptInput } = require("./Zod");

const PORT = process.env.PORT || 3000;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, { ok: true });
    return;
  }

  if (req.method === "POST" && req.url === "/openai") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const prompt = payload.prompt || payload.message || "";
        const apiKey = payload.apiKey || undefined;

        const validation = validatePromptInput({ prompt });

        if (!validation.success) {
          const message = validation.error.flatten().fieldErrors?.prompt?.[0] || "Please provide a valid prompt.";
          sendJson(res, 400, { error: message });
          return;
        }

        const text = await AskOpenAi(validation.data.prompt, apiKey);
        sendJson(res, 200, { text });
      } catch (error) {
        sendJson(res, 500, { error: error.message || "Server error" });
      }
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`OpenAI proxy server running at http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY is not set. Set it before starting the server.");
  }
});
