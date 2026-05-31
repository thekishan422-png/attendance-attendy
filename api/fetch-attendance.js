const { fetchAgcAttendance } = require("../lib/agc");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const studentId = String(body.studentId || "").trim();
    const password = String(body.password || "");

    if (!studentId || !password) {
      res.status(400).json({ error: "Student ID and password are required." });
      return;
    }

    const result = await fetchAgcAttendance({ studentId, password });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || "Unexpected server error." });
  }
};
