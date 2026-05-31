// Local development server only.
// On Vercel, api/fetch-attendance.js handles requests instead.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fetchAgcAttendance } = require("./lib/agc");

const PORT = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "POST" && url.pathname === "/api/fetch-attendance") {
      await handleFetchAttendance(request, response);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`AGC attendance calculator running at http://127.0.0.1:${PORT}`);
});

async function handleFetchAttendance(request, response) {
  const body = await readJsonBody(request);
  const studentId = String(body.studentId || "").trim();
  const password = String(body.password || "");

  if (!studentId || !password) {
    sendJson(response, 400, { error: "Student ID and password are required." });
    return;
  }

  const result = await fetchAgcAttendance({ studentId, password });
  sendJson(response, 200, result);
}

async function readJsonBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 50_000) throw new Error("Request body is too large.");
  }
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function serveStatic(pathname, response) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(cleanPath);
  const filePath = path.normalize(path.join(__dirname, decodedPath));

  if (!filePath.startsWith(__dirname) || path.basename(filePath) === "server.js") {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}
