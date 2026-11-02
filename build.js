const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const publishDirectory = path.join(projectRoot, "dist");
const publicFiles = ["index.html", "About.html", "OpenAi.js"];

fs.rmSync(publishDirectory, { recursive: true, force: true });
fs.mkdirSync(publishDirectory, { recursive: true });
for (const fileName of publicFiles) {
  fs.copyFileSync(path.join(projectRoot, fileName), path.join(publishDirectory, fileName));
}
