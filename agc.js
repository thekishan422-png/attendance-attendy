const AGC_ORIGIN = "https://agclms.in";
const TARGET_RATIO = 0.75;

async function fetchAgcAttendance({ studentId, password }) {
  const jar = createCookieJar();
  const loginPath = "/Elogin/StudentLogin";

  const loginPage = await agcRequest(jar, loginPath);
  const token = parseVerificationToken(loginPage.text);
  if (!token) {
    throw new Error("Could not read the AGC login token. The portal page may have changed.");
  }

  const form = new URLSearchParams({
    StudentId: studentId,
    Password: password,
    __RequestVerificationToken: token,
  });

  let loginResult;
  try {
    loginResult = await agcRequest(jar, loginPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${AGC_ORIGIN}${loginPath}`,
      },
      body: form.toString(),
    });
  } catch (error) {
    if (/DashBoardStudent/i.test(error.message)) {
      throw new Error("Login failed. Check the student ID and password.");
    }
    throw error;
  }

  let dashboardHtml = loginResult.text;
  if (/Student Login/i.test(dashboardHtml)) {
    throw new Error("Login failed. Check the student ID and password.");
  }

  if (!/DashBoardStudent/i.test(loginResult.url) || /Student Login/i.test(dashboardHtml)) {
    try {
      dashboardHtml = (await agcRequest(jar, "/DashBoardStudent")).text;
    } catch (error) {
      if (/DashBoardStudent/i.test(error.message)) {
        throw new Error("Login failed. Check the student ID and password.");
      }
      throw error;
    }
  }

  if (!/DashBoardStudent/i.test(dashboardHtml) && !/Subjects in Current Session/i.test(dashboardHtml)) {
    throw new Error("Login failed or the dashboard could not be loaded. Check the ID and password.");
  }

  const student = parseStudentInfo(dashboardHtml, studentId);
  const subjects = parseDashboardSubjects(dashboardHtml);
  if (subjects.length === 0) {
    throw new Error("No subject attendance links were found on the dashboard.");
  }

  const reports = [];
  for (const subject of subjects) {
    const report = await agcRequest(jar, subject.href);
    reports.push({
      ...subject,
      entries: parseAttendanceEntries(report.text),
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    student,
    subjects: mergeAndCalculateSubjects(reports),
  };
}

async function agcRequest(jar, href, options = {}) {
  let currentUrl = new URL(href, AGC_ORIGIN).toString();
  let method = options.method || "GET";
  let body = options.body;
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 AGC-Attendance-Calculator/1.0",
    ...options.headers,
  };

  for (let redirectCount = 0; redirectCount < 8; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      method,
      body,
      headers: {
        ...headers,
        Cookie: jar.header(),
      },
      redirect: "manual",
    });

    jar.add(response.headers);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) break;
      currentUrl = new URL(location, currentUrl).toString();
      if (response.status === 303 || response.status === 302) {
        method = "GET";
        body = undefined;
        delete headers["Content-Type"];
      }
      continue;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`AGC portal returned ${response.status} while loading ${new URL(currentUrl).pathname}.`);
    }
    return { text, url: currentUrl, status: response.status };
  }

  throw new Error("Too many redirects from the AGC portal.");
}

function parseVerificationToken(html) {
  const match = html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)["']/i);
  return match ? decodeHtml(match[1]) : "";
}

function parseStudentInfo(html, fallbackId) {
  const nameMatch = html.match(/<span[^>]*class=['"][^'"]*fs-4[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i);
  const idMatch = html.match(/id=["']StudentId["'][^>]*value=["']([^"']+)["']/i);
  const sectionMatch = html.match(/SectionName\s*:\s*<i>([\s\S]*?)<\/i>/i);

  return {
    id: idMatch ? decodeHtml(idMatch[1]) : fallbackId,
    name: nameMatch ? stripHtml(nameMatch[1]) : "",
    section: sectionMatch ? stripHtml(sectionMatch[1]) : "",
  };
}

function parseDashboardSubjects(html) {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const subjects = [];

  for (const row of rows) {
    if (!/AttendanceReport/i.test(row)) continue;

    const hrefMatch = row.match(/<a\b[^>]*href=["']([^"']*AttendanceReport[^"']*)["'][^>]*>\s*Attendance\s*<\/a>/i);
    const cells = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || [];
    if (!hrefMatch || cells.length === 0) continue;

    const name = stripHtml(cells[0]);
    if (!name) continue;

    const url = new URL(decodeHtml(hrefMatch[1]), AGC_ORIGIN);
    subjects.push({
      name,
      href: `${url.pathname}${url.search}`,
      saId: url.searchParams.get("SAId") || "",
    });
  }

  return subjects;
}

function parseAttendanceEntries(html) {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const entries = [];

  for (const row of rows) {
    const cells = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 2) continue;

    const date = stripHtml(cells[0]);
    const status = stripHtml(cells[1]).toUpperCase();
    if (!/^\d{2}-\d{2}-\d{4}$/.test(date) || !status) continue;
    if (!isPresent(status) && !isAbsent(status)) continue;

    entries.push({ date, status });
  }

  return entries;
}

function mergeAndCalculateSubjects(reports) {
  const groups = new Map();

  for (const report of reports) {
    const key = normalizeSubject(report.name);
    if (!groups.has(key)) {
      groups.set(key, {
        name: report.name,
        entries: [],
        reports: new Set(),
      });
    }

    const group = groups.get(key);
    group.reports.add(report.saId || report.href);
    group.entries.push(...report.entries);
  }

  return [...groups.values()]
    .map((group) => {
      const present = group.entries.filter((entry) => isPresent(entry.status)).length;
      const absent = group.entries.filter((entry) => isAbsent(entry.status)).length;
      const total = present + absent;
      const percent = total > 0 ? Math.round((present / total) * 100) : 0;

      return {
        name: group.name,
        present,
        absent,
        total,
        percent,
        classesNeeded: classesNeeded(present, total),
        canSkip: classesCanSkip(present, total),
        mergedReports: group.reports.size,
      };
    })
    .filter((subject) => subject.total > 0)
    .sort((a, b) => a.percent - b.percent || a.name.localeCompare(b.name));
}

function classesNeeded(present, total) {
  if (total === 0) return 0;
  if (present / total >= TARGET_RATIO) return 0;
  return Math.ceil((TARGET_RATIO * total - present) / (1 - TARGET_RATIO));
}

function classesCanSkip(present, total) {
  if (total === 0 || present / total < TARGET_RATIO) return 0;
  return Math.max(0, Math.floor(present / TARGET_RATIO - total));
}

function isPresent(status) {
  return /\bPRESENT\b/i.test(status);
}

function isAbsent(status) {
  return /\bABSENT\b/i.test(status);
}

function normalizeSubject(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };

  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] || `&${name};`);
}

function createCookieJar() {
  const cookies = new Map();

  return {
    add(headers) {
      for (const cookie of getSetCookieHeaders(headers)) {
        const [pair] = cookie.split(";");
        const separatorIndex = pair.indexOf("=");
        if (separatorIndex === -1) continue;
        const name = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();
        if (!name) continue;
        if (value) cookies.set(name, value);
        else cookies.delete(name);
      }
    },
    header() {
      return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    },
  };
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const header = headers.get("set-cookie");
  return splitSetCookieHeader(header);
}

function splitSetCookieHeader(header) {
  if (!header) return [];
  const cookies = [];
  let start = 0;
  let inExpires = false;

  for (let index = 0; index < header.length; index += 1) {
    const part = header.slice(index, index + 8).toLowerCase();
    if (part === "expires=") inExpires = true;
    if (inExpires && header[index] === ";") inExpires = false;
    if (!inExpires && header[index] === ",") {
      cookies.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }

  cookies.push(header.slice(start).trim());
  return cookies.filter(Boolean);
}

module.exports = {
  fetchAgcAttendance,
  classesCanSkip,
  classesNeeded,
  mergeAndCalculateSubjects,
  parseAttendanceEntries,
  parseDashboardSubjects,
  parseStudentInfo,
};
