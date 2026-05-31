const TARGET_PERCENT = 75;

const elements = {
  form: document.querySelector("#loginForm"),
  studentId: document.querySelector("#studentId"),
  password: document.querySelector("#password"),
  fetchButton: document.querySelector("#fetchButton"),
  statusPanel: document.querySelector("#statusPanel"),
  statusText: document.querySelector("#statusText"),
  subjectCount: document.querySelector("#subjectCount"),
  overallPercent: document.querySelector("#overallPercent"),
  safeCount: document.querySelector("#safeCount"),
  dangerCount: document.querySelector("#dangerCount"),
  studentStrip: document.querySelector("#studentStrip"),
  studentName: document.querySelector("#studentName"),
  sectionName: document.querySelector("#sectionName"),
  lastFetched: document.querySelector("#lastFetched"),
  filterSelect: document.querySelector("#filterSelect"),
  subjectList: document.querySelector("#subjectList"),
  emptyState: document.querySelector("#emptyState"),
  subjectCardTemplate: document.querySelector("#subjectCardTemplate"),
};

let latestResult = null;

elements.form.addEventListener("submit", fetchAttendance);
elements.filterSelect.addEventListener("change", renderSubjects);

async function fetchAttendance(event) {
  event.preventDefault();
  const studentId = elements.studentId.value.trim();
  const password = elements.password.value;
  if (!studentId || !password) return;

  setLoading(true);
  document.body.classList.add("is-fetching");
  setStatus("loading", "Logging in and fetching attendance...");

  try {
    const response = await fetch("/api/fetch-attendance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ studentId, password }),
    });

    const payload = await readApiResponse(response);
    if (!response.ok) {
      throw new Error(payload.error || "Could not fetch attendance.");
    }

    latestResult = payload;
    elements.password.value = "";
    setStatus("ready", `Fetched ${payload.subjects.length} subject${payload.subjects.length === 1 ? "" : "s"}.`);
    renderResult();
  } catch (error) {
    setStatus("error", error.message);
  } finally {
    setLoading(false);
    document.body.classList.remove("is-fetching");
  }
}

function renderResult() {
  if (!latestResult) return;

  const subjects = latestResult.subjects;
  const totals = subjects.reduce(
    (sum, subject) => {
      sum.present += subject.present;
      sum.total += subject.total;
      if (subject.percent >= TARGET_PERCENT) sum.safe += 1;
      if (subject.percent < TARGET_PERCENT) sum.danger += 1;
      return sum;
    },
    { present: 0, total: 0, safe: 0, danger: 0 },
  );

  elements.subjectCount.textContent = subjects.length;
  elements.overallPercent.textContent = totals.total ? `${Math.round((totals.present / totals.total) * 100)}%` : "--";
  elements.safeCount.textContent = totals.safe;
  elements.dangerCount.textContent = totals.danger;

  elements.studentName.textContent = latestResult.student.name || "AGC Student";
  elements.sectionName.textContent = latestResult.student.section || "Not found";
  elements.lastFetched.textContent = new Date(latestResult.fetchedAt).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  elements.studentStrip.hidden = false;

  renderSubjects();
}

function renderSubjects() {
  const subjects = getVisibleSubjects();
  elements.subjectList.innerHTML = "";

  elements.emptyState.hidden = subjects.length > 0;
  if (!latestResult) {
    elements.emptyState.querySelector("strong").textContent = "No attendance loaded";
    elements.emptyState.querySelector("span").textContent = "Enter your AGC LMS credentials to fetch subject-wise attendance.";
    return;
  }

  if (subjects.length === 0) {
    elements.emptyState.querySelector("strong").textContent = "No matching subjects";
    elements.emptyState.querySelector("span").textContent = "Change the filter.";
    return;
  }

  subjects.forEach((subject, index) => {
    const card = elements.subjectCardTemplate.content.firstElementChild.cloneNode(true);
    const badgeType = getBadgeType(subject.percent);
    const mergedText = subject.mergedReports > 1 ? `Combined from ${subject.mergedReports} portal entries` : "Single portal entry";

    card.style.setProperty("--delay", `${Math.min(index * 70, 420)}ms`);
    card.querySelector("[data-name]").textContent = subject.name;
    card.querySelector("[data-meta]").textContent = mergedText;
    card.querySelector("[data-percent]").textContent = `${subject.percent}%`;
    if (badgeType) {
      card.querySelector("[data-percent]").classList.add(badgeType);
    }

    const progress = card.querySelector("[data-progress]");
    progress.style.width = `${Math.min(subject.percent, 100)}%`;
    if (badgeType) {
      progress.classList.add(badgeType);
    }

    card.querySelector("[data-present]").textContent = subject.present;
    card.querySelector("[data-total]").textContent = subject.total;
    card.querySelector("[data-needed]").textContent = subject.classesNeeded;
    card.querySelector("[data-skip]").textContent = subject.canSkip;
    card.querySelector("[data-note]").textContent = getSubjectNote(subject);

    elements.subjectList.append(card);
  });
}

function getVisibleSubjects() {
  if (!latestResult) return [];

  const filter = elements.filterSelect.value;

  return latestResult.subjects.filter((subject) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "below" && subject.percent < TARGET_PERCENT) ||
      (filter === "safe" && subject.percent >= TARGET_PERCENT);
    return matchesFilter;
  });
}

function getSubjectNote(subject) {
  if (subject.total === 0) return "No classes found for this subject.";
  if (subject.percent < TARGET_PERCENT) {
    return `Attend the next ${subject.classesNeeded} class${subject.classesNeeded === 1 ? "" : "es"} to reach 75%.`;
  }
  if (subject.canSkip > 0) {
    return `You can skip ${subject.canSkip} class${subject.canSkip === 1 ? "" : "es"} and remain at or above 75%.`;
  }
  return "You are exactly at 75%. Attend the next class to build a buffer.";
}

function getBadgeType(percent) {
  if (percent < TARGET_PERCENT) return "is-danger";
  if (percent < TARGET_PERCENT + 5) return "is-warning";
  return "";
}

function setLoading(isLoading) {
  elements.fetchButton.disabled = isLoading;
  elements.fetchButton.querySelector("span").textContent = isLoading ? "Fetching..." : "Fetch attendance";
}

function setStatus(type, message) {
  elements.statusPanel.classList.toggle("is-loading", type === "loading");
  elements.statusPanel.classList.toggle("is-error", type === "error");
  elements.statusText.textContent = message;
}

async function readApiResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    if (text.trim().startsWith("<")) {
      throw new Error("The app received a web page instead of attendance data. Run it with node server.js and open the local Node URL.");
    }

    throw new Error("The server returned an unreadable response.");
  }
}
