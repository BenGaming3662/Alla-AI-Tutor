const http = require("http");
const fs = require("fs");
const path = require("path");
const { AskOpenAi } = require("./OpenAi");
const { validatePromptInput } = require("./zod");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const MAX_REQUEST_BYTES = 16 * 1024;

// Local server configuration. The static allowlist excludes .env and server source.
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/About.html", ["About.html", "text/html; charset=utf-8"]],
  ["/OpenAi.js", ["OpenAi.js", "text/javascript; charset=utf-8"]]
]);

// Return consistent, non-cacheable JSON responses from the API.
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(payload);
}

// Serve an allowlisted file with the app's content security policy.
function sendStaticFile(res, fileName, contentType) {
  const filePath = path.join(__dirname, fileName);
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      sendJson(res, 500, { error: "Unable to load the application page." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' https://i.imgur.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
    });
    res.end(contents);
  });
}

// Build the server so the same routes can be started locally and exercised in integration tests.
function createServer() {
  return http.createServer((req, res) => {
    // Serve only the pages and client script used by the app.
    if (req.method === "GET" && STATIC_FILES.has(req.url)) {
      const [fileName, contentType] = STATIC_FILES.get(req.url);
      sendStaticFile(res, fileName, contentType);
      return;
    }

    // Validate and process same-origin prompt requests.
    if (req.method === "POST" && req.url === "/openai") {
      // The UI is same-origin; reject foreign hosts/origins before reading or processing prompts.
      const origin = req.headers.origin;
      const port = req.socket.localPort;
      const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
      const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
      if (!allowedHosts.has(req.headers.host) || (origin && !allowedOrigins.has(origin))) {
        sendJson(res, 403, { error: "Cross-origin requests are not allowed." });
        return;
      }
      if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
        sendJson(res, 415, { error: "Content-Type must be application/json." });
        return;
      }

      // Bound request memory before parsing or sending user text to the model.
      let body = "";
      let bodyBytes = 0;
      let tooLarge = false;
      req.on("data", (chunk) => {
        if (tooLarge) return;
        bodyBytes += chunk.length;
        if (bodyBytes > MAX_REQUEST_BYTES) {
          tooLarge = true;
          sendJson(res, 413, { error: "Request is too large." });
          return;
        }
        body += chunk;
      });
      req.on("end", async () => {
        if (tooLarge) return;
        try {
          let payload;
          try {
            payload = JSON.parse(body || "{}");
          } catch {
            sendJson(res, 400, { error: "Request body must contain valid JSON." });
            return;
          }
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            sendJson(res, 400, { error: "Request body must be a JSON object." });
            return;
          }
          const prompt = payload.prompt ?? payload.message ?? "";

          // Validate the request before passing user text to the model layer.
          const validation = validatePromptInput({ prompt });

          if (!validation.success) {
            const message = validation.error.flatten().fieldErrors?.prompt?.[0] || "Please provide a valid prompt.";
            sendJson(res, 400, { error: message });
            return;
          }

          const text = await AskOpenAi(validation.data.prompt);
          sendJson(res, 200, { text });
        } catch (error) {
          sendJson(res, 500, { error: error.message || "Server error" });
        }
      });
      return;
    }

    sendJson(res, req.method === "OPTIONS" ? 405 : 404, { error: req.method === "OPTIONS" ? "Cross-origin preflight is not supported." : "Not found" });
  });
}

if (require.main === module) {
  // Start only when executed directly; report the assigned port for VS Code's serverReadyAction.
  const server = createServer();
  server.listen(PORT, HOST, () => {
    const address = server.address();
    const listeningPort = address && typeof address === "object" ? address.port : PORT;
    console.log(`OpenAI proxy server running at http://localhost:${listeningPort}`);
    if (!process.env.OPENAI_API_KEY) {
      console.warn("OPENAI_API_KEY is not set. Set it before starting the server.");
    }
  });
}

module.exports = { createServer, MAX_REQUEST_BYTES };
