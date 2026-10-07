const form = document.getElementById("attendance-form");
const course = document.getElementById("course");
const yearLevelBlock = document.getElementById("year-level-block");
const studentName = document.getElementById("student-name");
const attendanceType = document.getElementById("attendance-type");
const attendanceTime = document.getElementById("attendance-time");
const submitButton = document.getElementById("submit-button");
const submitWithoutLocationButton = document.getElementById(
  "submit-without-location-button",
);
const geoStatus = document.getElementById("geo-status");
const deviceLockStatus = document.getElementById("device-lock-status");
const recentEntry = document.getElementById("recent-entry");
const submissionStatus = document.getElementById("submission-status");
const submitHelp = document.getElementById("submit-help");
const adminToggle = document.getElementById("admin-toggle");
const adminControls = document.getElementById("admin-controls");
const adminCode = document.getElementById("admin-code");
const adminUnlock = document.getElementById("admin-unlock");
const adminStatus = document.getElementById("admin-status");
const allRestrictionsOverride = document.getElementById(
  "all-restrictions-override",
);
const locationOverride = document.getElementById("location-override");
const timeOverride = document.getElementById("time-override");
const deviceLockOverride = document.getElementById("device-lock-override");
const saveSchedule = document.getElementById("save-schedule");
const resetSchedule = document.getElementById("reset-schedule");
const scheduleStatus = document.getElementById("schedule-status");
const attendanceCard = document.getElementById("attendance-card");
const recentCard = document.getElementById("recent-card");
const adminPanel = document.getElementById("admin-panel");
const accessToken = "";
let locationTimestamp = null;
let locationSpeed = null;
const scheduleInputs = Array.from({ length: 4 }, (_, index) => ({
  start: document.getElementById(`schedule-start-${index}`),
  end: document.getElementById(`schedule-end-${index}`),
}));

let officeLocation = {
  latitude: 9.741743961337196,
  longitude: 118.73231919805337,
  radiusMeters: 100,
};
const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbynO-w_b6lib3u0sXWOdxEebVcL05AGxOdVjuUsRpcAkd-fzWqSqvGJTG84n2eN_ubc-w/exec";
// Set this to the public HTTPS URL where index.html is hosted.
const PUBLIC_APP_URL = "";
const DEVICE_LOCK_KEY = "studentAttendanceDeviceLock";
const RESET_INTERVAL_MS = 60 * 60 * 1000;
const ATTENDANCE_SCHEDULE_KEY = "attendanceSchedule";
const ATTENDANCE_TIME_ZONE = "Asia/Manila";
const DEFAULT_ATTENDANCE_WINDOWS = [
  { start: "07:40", end: "08:50" },
  { start: "11:35", end: "12:45" },
  { start: "13:15", end: "13:50" },
  { start: "15:30", end: "17:00" },
];
let ATTENDANCE_WINDOWS = loadAttendanceWindows();

let currentLocation = null;
let locationOk = false;
let locationUnavailable = false;
let adminUnlocked = false;
let adminToken = "";

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidSchedule(schedule) {
  if (
    !Array.isArray(schedule) ||
    schedule.length !== DEFAULT_ATTENDANCE_WINDOWS.length
  ) {
    return false;
  }

  return schedule.every(({ start, end }, index) => {
    const previousWindow = schedule[index - 1];
    return (
      isValidTime(start) &&
      isValidTime(end) &&
      start < end &&
      (!previousWindow || previousWindow.end <= start)
    );
  });
}

function loadAttendanceWindows() {
  try {
    const savedSchedule = JSON.parse(
      localStorage.getItem(ATTENDANCE_SCHEDULE_KEY),
    );
    return isValidSchedule(savedSchedule)
      ? savedSchedule
      : DEFAULT_ATTENDANCE_WINDOWS.map((window) => ({ ...window }));
  } catch (error) {
    return DEFAULT_ATTENDANCE_WINDOWS.map((window) => ({ ...window }));
  }
}

function updateScheduleInputs() {
  scheduleInputs.forEach(({ start, end }, index) => {
    start.value = ATTENDANCE_WINDOWS[index].start;
    end.value = ATTENDANCE_WINDOWS[index].end;
  });
}

function setScheduleControlsDisabled(disabled) {
  scheduleInputs.forEach(({ start, end }) => {
    start.disabled = disabled;
    end.disabled = disabled;
  });
  saveSchedule.disabled = disabled;
  resetSchedule.disabled = disabled;
}

function saveAttendanceWindows(schedule) {
  ATTENDANCE_WINDOWS = schedule.map((window) => ({ ...window }));
  localStorage.setItem(
    ATTENDANCE_SCHEDULE_KEY,
    JSON.stringify(ATTENDANCE_WINDOWS),
  );
  updateScheduleInputs();
  updateSubmitButton();
}

function sendBackendRequest(payload) {
  return new Promise((resolve, reject) => {
    const callbackName = `attendanceCallback${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const script = document.createElement("script");
    const query = new URLSearchParams({
      ...payload,
      schedule: payload.schedule ? JSON.stringify(payload.schedule) : undefined,
      callback: callbackName,
    });

    window[callbackName] = (result) => {
      cleanup();
      if (result.success) {
        resolve(result);
      } else {
        reject(new Error(result.error || "The backend request failed."));
      }
    };
    script.onerror = () => {
      cleanup();
      reject(
        new Error(
          "The backend could not be reached. Check the deployed Apps Script URL.",
        ),
      );
    };
    script.src = `${GOOGLE_SCRIPT_URL}?${query.toString()}`;
    document.body.appendChild(script);

    function cleanup() {
      delete window[callbackName];
      script.remove();
    }
  });
}

function openAttendanceForm() {
  attendanceCard.hidden = false;
  recentCard.hidden = false;
  adminPanel.hidden = false;
  course.disabled = false;
  yearLevelBlock.disabled = false;
  studentName.disabled = false;
}

async function loadRosterOptions() {
  try {
    const result = await sendBackendRequest({ action: "rosterOptions" });
    const courses = [
      ...new Set(
        result.options.map(({ course: optionCourse }) => optionCourse),
      ),
    ].sort();
    course.innerHTML = '<option value="">-- Select course --</option>';
    courses.forEach((optionCourse) =>
      course.add(new Option(optionCourse, optionCourse)),
    );
    course.addEventListener("change", async () => {
      yearLevelBlock.innerHTML =
        '<option value="">-- Select year/block --</option>';
      studentName.innerHTML =
        '<option value="">-- Select your name --</option>';
      studentName.disabled = true;
      result.options
        .filter(({ course: optionCourse }) => optionCourse === course.value)
        .forEach(({ yearLevelBlock: optionBlock }) =>
          yearLevelBlock.add(new Option(optionBlock, optionBlock)),
        );
      updateSubmitButton();
    });
    yearLevelBlock.addEventListener("change", loadRosterStudents);
  } catch (error) {
    adminStatus.textContent =
      error.message || "Unable to load the registered course list.";
  }
}

async function loadRosterStudents() {
  studentName.innerHTML =
    '<option value="">Loading registered names...</option>';
  studentName.disabled = true;
  if (!course.value || !yearLevelBlock.value) {
    studentName.innerHTML = '<option value="">-- Select your name --</option>';
    updateSubmitButton();
    return;
  }

  try {
    const result = await sendBackendRequest({
      action: "rosterStudents",
      course: course.value,
      yearLevelBlock: yearLevelBlock.value,
    });
    studentName.innerHTML = '<option value="">-- Select your name --</option>';
    result.names.forEach((name) => studentName.add(new Option(name, name)));
    studentName.disabled = false;
  } catch (error) {
    studentName.innerHTML = '<option value="">Unable to load names</option>';
    adminStatus.textContent =
      error.message || "Unable to load registered names.";
  }
  updateSubmitButton();
}

async function initializeAccess() {
  openAttendanceForm();
  await loadRosterOptions();
  return true;
}

async function loadServerSchedule() {
  try {
    const result = await sendBackendRequest({ action: "schedule" });
    if (result.success && isValidSchedule(result.schedule)) {
      ATTENDANCE_WINDOWS = result.schedule;
      updateScheduleInputs();
      updateSubmitButton();
    }
  } catch (error) {
    console.warn("Unable to load server schedule", error);
  }
}

function formatTime(date) {
  return date.toLocaleString(undefined, {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function updateTime() {
  attendanceTime.value = formatTime(new Date());
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function setGeoStatus(message, status) {
  geoStatus.textContent = message;
  geoStatus.className = `geo-status ${status}`;
}

function hasAdminOverride(control) {
  return adminUnlocked && (allRestrictionsOverride.checked || control.checked);
}

function isWithinAttendanceTime() {
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: ATTENDANCE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const currentHour = Number(
    timeParts.find(({ type }) => type === "hour").value,
  );
  const currentMinute = Number(
    timeParts.find(({ type }) => type === "minute").value,
  );
  const currentMinutes = currentHour * 60 + currentMinute;

  return ATTENDANCE_WINDOWS.some(({ start, end }) => {
    const [startHour, startMinute] = start.split(":").map(Number);
    const [endHour, endMinute] = end.split(":").map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  });
}

function getAttendanceTimeMessage() {
  const schedule = ATTENDANCE_WINDOWS.map(
    ({ start, end }) => `${start}-${end}`,
  ).join(", ");
  return `Attendance is only available during these times: ${schedule}.`;
}

function validateForm() {
  const hasStudentDetails =
    course.value.trim() &&
    yearLevelBlock.value.trim() &&
    studentName.value.trim() &&
    attendanceType.value;

  const locationAllowed =
    (locationOk && currentLocation !== null) ||
    hasAdminOverride(locationOverride);
  const timeAllowed =
    isWithinAttendanceTime() || hasAdminOverride(timeOverride);
  return locationAllowed && timeAllowed && hasStudentDetails;
}

function getSubmitDisabledReason(allowUnavailableLocation = false) {
  if (isDeviceLocked() && !hasAdminOverride(deviceLockOverride)) {
    return `Cannot submit: This device is locked. Try again in ${getRemainingLockMinutes()} minute(s).`;
  }

  if (!isWithinAttendanceTime() && !hasAdminOverride(timeOverride)) {
    return `Cannot submit: ${getAttendanceTimeMessage()}`;
  }

  if (
    (!locationOk || !currentLocation) &&
    !hasAdminOverride(locationOverride) &&
    !(allowUnavailableLocation && locationUnavailable)
  ) {
    return "Cannot submit: location is unavailable or outside the allowed area.";
  }

  const missingFields = [];
  if (!course.value.trim()) missingFields.push("course");
  if (!yearLevelBlock.value.trim()) missingFields.push("year/block");
  if (!studentName.value.trim()) missingFields.push("student name");
  if (!attendanceType.value) missingFields.push("status");

  if (missingFields.length) {
    return `Cannot submit: complete ${missingFields.join(", ")}.`;
  }

  return "";
}

function isDeviceLocked() {
  const savedTime = Number(localStorage.getItem(DEVICE_LOCK_KEY));
  if (!savedTime || Number.isNaN(savedTime)) {
    return false;
  }

  return Date.now() - savedTime < RESET_INTERVAL_MS;
}

function getRemainingLockMinutes() {
  const savedTime = Number(localStorage.getItem(DEVICE_LOCK_KEY));
  if (!savedTime || Number.isNaN(savedTime)) {
    return 0;
  }

  const remainingMs = RESET_INTERVAL_MS - (Date.now() - savedTime);
  return Math.max(0, Math.ceil(remainingMs / 60000));
}

function updateLockStatus() {
  if (!isDeviceLocked()) {
    deviceLockStatus.textContent = "";
    return;
  }

  const remainingMs =
    RESET_INTERVAL_MS -
    (Date.now() - Number(localStorage.getItem(DEVICE_LOCK_KEY)));
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  deviceLockStatus.textContent = `Next submission available in ${minutes}m ${seconds}s.`;
}

function updateSubmitButton() {
  const disabledReason = getSubmitDisabledReason();
  submitButton.disabled = Boolean(disabledReason);
  submitHelp.textContent = disabledReason || "Ready to submit attendance.";
  submitHelp.className = `submit-help${disabledReason ? " disabled" : " ready"}`;
  const showUnavailableLocationButton =
    locationUnavailable && !currentLocation && !locationOk;
  submitWithoutLocationButton.hidden = !showUnavailableLocationButton;
  submitWithoutLocationButton.disabled = Boolean(getSubmitDisabledReason(true));

  if (
    disabledReason &&
    isDeviceLocked() &&
    !hasAdminOverride(deviceLockOverride)
  ) {
    updateLockStatus();
    setGeoStatus(
      `This device has already submitted attendance in the last hour. Please try again in ${getRemainingLockMinutes()} minute(s).`,
      "error",
    );
    return;
  }

  deviceLockStatus.textContent = "";
  if (
    disabledReason &&
    !isWithinAttendanceTime() &&
    !hasAdminOverride(timeOverride)
  ) {
    setGeoStatus(getAttendanceTimeMessage(), "error");
    return;
  }
}

function evaluateLocation(position) {
  const { latitude, longitude } = position.coords;
  locationUnavailable = false;
  currentLocation = {
    latitude,
    longitude,
    mocked: position.coords.mocked === true,
  };
  locationTimestamp = Number(position.timestamp);
  locationSpeed = Number(position.coords.speed);
  const distance = getDistanceMeters(
    latitude,
    longitude,
    officeLocation.latitude,
    officeLocation.longitude,
  );
  const locationAgeSeconds = (Date.now() - locationTimestamp) / 1000;
  const freshLocation =
    Number.isFinite(locationTimestamp) &&
    locationAgeSeconds >= 0 &&
    locationAgeSeconds <= 30;
  const reasonableSpeed =
    !Number.isFinite(locationSpeed) || locationSpeed < 0 || locationSpeed <= 55;
  locationOk =
    distance <= officeLocation.radiusMeters &&
    freshLocation &&
    reasonableSpeed &&
    position.coords.mocked !== true;

  if (locationOk) {
    setGeoStatus("Location confirmed. Attendance can be submitted.", "success");
  } else if (distance <= officeLocation.radiusMeters) {
    setGeoStatus(
      "Location verification failed. The reading must be fresh, and implausible movement or mock locations are blocked.",
      "error",
    );
  } else {
    setGeoStatus(
      "You are outside the allowed attendance location. Move closer to submit.",
      "error",
    );
  }

  updateSubmitButton();
}

function handleGeoError(error) {
  console.warn("Geolocation error", error);
  locationUnavailable = true;
  currentLocation = null;
  locationTimestamp = null;
  locationSpeed = null;
  locationOk = false;
  setGeoStatus(
    "Unable to detect location. You may submit with the location marked unavailable.",
    "error",
  );
  updateSubmitButton();
}

function requestLocation() {
  if (!navigator.geolocation) {
    locationUnavailable = true;
    setGeoStatus("Geolocation is not supported by your browser.", "error");
    updateSubmitButton();
    return;
  }

  navigator.geolocation.getCurrentPosition(evaluateLocation, handleGeoError, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  });
}

function updateRecentEntry(data, displayTime, displayLocation) {
  recentEntry.innerHTML = `
    <strong>${data.Name}</strong><br />
    Course: ${data.course}<br />
    Year/Block: ${data["Yearl Level/Block"]}<br />
    <em>${data.Status}</em><br />
    ${displayTime}<br />
    Location: ${displayLocation}
  `;
}

function resetAdminAccess() {
  adminUnlocked = false;
  adminToken = "";
  adminControls.hidden = true;
  adminToggle.textContent = "Admin";
  adminCode.value = "";
  adminStatus.textContent = "";
  adminStatus.className = "admin-status";
  scheduleStatus.textContent = "";
  setScheduleControlsDisabled(true);

  [
    allRestrictionsOverride,
    locationOverride,
    timeOverride,
    deviceLockOverride,
  ].forEach((control) => {
    control.checked = false;
    control.disabled = true;
  });
}

async function submitAttendance(event) {
  return submitAttendanceWithLocationOption(event, false);
}

async function submitAttendanceWithoutLocation(event) {
  return submitAttendanceWithLocationOption(event, true);
}

async function submitAttendanceWithLocationOption(
  event,
  submitWithoutLocation,
) {
  event.preventDefault();

  const adminWasUsed = adminUnlocked;
  const lockOverridden = hasAdminOverride(deviceLockOverride);
  const locationOverridden = hasAdminOverride(locationOverride);
  const timeOverridden = hasAdminOverride(timeOverride);
  const allowUnavailableLocation = submitWithoutLocation && locationUnavailable;

  if (isDeviceLocked() && !lockOverridden) {
    const remainingMinutes = getRemainingLockMinutes();
    setGeoStatus(
      `This device has already submitted attendance in the last hour. Please try again in ${remainingMinutes} minute(s).`,
      "error",
    );
    submissionStatus.textContent = `Submission unsuccessful: this device is locked for ${remainingMinutes} more minute(s).`;
    submissionStatus.className = "submission-status error";
    updateLockStatus();
    submitButton.disabled = true;
    return;
  }

  if (
    (!locationOk || !currentLocation) &&
    !locationOverridden &&
    !allowUnavailableLocation
  ) {
    setGeoStatus(
      "Submission blocked: your location must be detected and within the allowed area.",
      "error",
    );
    submissionStatus.textContent =
      "Not submitted. Location is outside the allowed area or unavailable. Use the unavailable-location option only when location detection failed.";
    submissionStatus.className = "submission-status error";
    return;
  }

  if (!isWithinAttendanceTime() && !timeOverridden) {
    setGeoStatus(getAttendanceTimeMessage(), "error");
    submissionStatus.textContent =
      "Not submitted. Attendance time is outside the allowed schedule.";
    submissionStatus.className = "submission-status error";
    return;
  }

  const fullName = studentName.value.trim();
  const statusLabel = attendanceType.value;
  const displayLocation = currentLocation
    ? `${currentLocation.latitude.toFixed(6)}, ${currentLocation.longitude.toFixed(6)}${locationOverridden ? " (Admin override)" : ""}`
    : allowUnavailableLocation
      ? "Not applicable"
      : "Admin override - location unavailable";
  const payload = {
    action: "attendance",
    adminToken: adminToken,
    adminOverride: allRestrictionsOverride.checked
      ? "all"
      : locationOverridden
        ? "location"
        : timeOverridden
          ? "time"
          : lockOverridden
            ? "device"
            : "",
    Name: fullName,
    course: course.value.trim(),
    "Yearl Level/Block": yearLevelBlock.value.trim(),
    Status: attendanceType.value,
    latitude: currentLocation ? currentLocation.latitude : "",
    longitude: currentLocation ? currentLocation.longitude : "",
    locationTimestamp: locationTimestamp || "",
    locationSpeed: Number.isFinite(locationSpeed) ? locationSpeed : "",
    locationMocked:
      currentLocation && currentLocation.mocked === true ? "true" : "false",
    locationUnavailable: allowUnavailableLocation ? "true" : "false",
    accessToken: accessToken,
  };
  let submittedPayload = payload;
  let submittedDisplayLocation = displayLocation;
  let submittedWithoutLocation = allowUnavailableLocation;

  submitButton.disabled = true;
  submissionStatus.textContent = "Submitting attendance...";
  submissionStatus.className = "submission-status";

  try {
    let result;
    try {
      result = await sendBackendRequest(submittedPayload);
    } catch (error) {
      const isLocationRejection =
        /attendance location is unavailable or outside the allowed area/i.test(
          error.message || "",
        );
      if (!isLocationRejection || submittedWithoutLocation) {
        throw error;
      }

      const continueWithoutLocation = window.confirm(
        'Your location could not be verified. Continue submitting attendance with the location recorded as "Not applicable"?',
      );
      if (!continueWithoutLocation) {
        throw error;
      }

      submittedPayload = {
        ...payload,
        latitude: "",
        longitude: "",
        locationTimestamp: "",
        locationSpeed: "",
        locationMocked: "false",
        locationUnavailable: "true",
      };
      submittedDisplayLocation = "Not applicable";
      submittedWithoutLocation = true;
      result = await sendBackendRequest(submittedPayload);
    }

    updateRecentEntry(
      submittedPayload,
      attendanceTime.value,
      submittedDisplayLocation,
    );
    setGeoStatus(
      submittedWithoutLocation
        ? "Location marked not applicable. Attendance was accepted by the server."
        : "Location confirmed. Attendance was accepted by the server.",
      "success",
    );
    submissionStatus.textContent =
      result.message || `${statusLabel} submitted successfully.`;
    submissionStatus.className = "submission-status success";
    localStorage.setItem(DEVICE_LOCK_KEY, String(Date.now()));
    form.reset();
    updateTime();

    if (adminWasUsed) {
      resetAdminAccess();
    }

    updateLockStatus();
    const postSubmissionReason = getSubmitDisabledReason();
    submitHelp.textContent =
      postSubmissionReason || "Attendance has been submitted.";
    submitHelp.className = `submit-help${postSubmissionReason ? " disabled" : " ready"}`;
  } catch (error) {
    submissionStatus.textContent = `Submission rejected: ${error.message || "The server could not record this attendance."}`;
    submissionStatus.className = "submission-status error";
    submitHelp.textContent =
      "The attendance was not recorded. Correct the issue and try again.";
    submitHelp.className = "submit-help disabled";
    submitButton.disabled = false;
  }
}

form.addEventListener("submit", submitAttendance);
submitWithoutLocationButton.addEventListener(
  "click",
  submitAttendanceWithoutLocation,
);
[
  allRestrictionsOverride,
  locationOverride,
  timeOverride,
  deviceLockOverride,
].forEach((control) => {
  control.addEventListener("change", updateSubmitButton);
});
adminToggle.addEventListener("click", () => {
  adminControls.hidden = !adminControls.hidden;
  if (!adminControls.hidden) {
    adminCode.focus();
  }
});
adminUnlock.addEventListener("click", async () => {
  adminUnlock.disabled = true;
  try {
    const result = await sendBackendRequest({
      action: "adminLogin",
      password: adminCode.value.trim(),
    });
    adminToken = result.token;
  } catch (error) {
    adminStatus.textContent =
      error.message || "Administrator authentication failed.";
    adminStatus.className = "admin-status error";
    adminUnlocked = false;
    allRestrictionsOverride.checked = false;
    locationOverride.checked = false;
    timeOverride.checked = false;
    deviceLockOverride.checked = false;
    allRestrictionsOverride.disabled = true;
    locationOverride.disabled = true;
    timeOverride.disabled = true;
    deviceLockOverride.disabled = true;
    setScheduleControlsDisabled(true);
    updateSubmitButton();
    adminUnlock.disabled = false;
    return;
  }

  adminUnlocked = true;
  allRestrictionsOverride.disabled = false;
  locationOverride.disabled = false;
  timeOverride.disabled = false;
  deviceLockOverride.disabled = false;
  setScheduleControlsDisabled(false);
  updateScheduleInputs();
  adminCode.value = "";
  adminStatus.textContent =
    "Admin mode enabled. Select overrides or update the schedule.";
  adminStatus.className = "admin-status success";
  adminToggle.textContent = "Admin unlocked";
  updateSubmitButton();
  adminUnlock.disabled = false;
});
saveSchedule.addEventListener("click", async () => {
  const schedule = scheduleInputs.map(({ start, end }) => ({
    start: start.value,
    end: end.value,
  }));

  if (!isValidSchedule(schedule)) {
    scheduleStatus.textContent =
      "Schedule not saved. Use valid, ordered, non-overlapping times.";
    scheduleStatus.className = "admin-status error";
    return;
  }

  try {
    const result = await sendBackendRequest({
      action: "saveSchedule",
      token: adminToken,
      schedule: schedule,
    });
    saveAttendanceWindows(result.schedule);
    scheduleStatus.textContent = "Schedule saved for all users.";
    scheduleStatus.className = "admin-status success";
  } catch (error) {
    scheduleStatus.textContent = error.message;
    scheduleStatus.className = "admin-status error";
  }
});
resetSchedule.addEventListener("click", async () => {
  try {
    const result = await sendBackendRequest({
      action: "resetSchedule",
      token: adminToken,
    });
    saveAttendanceWindows(result.schedule);
    scheduleStatus.textContent = "Default schedule restored for all users.";
    scheduleStatus.className = "admin-status success";
  } catch (error) {
    scheduleStatus.textContent = error.message;
    scheduleStatus.className = "admin-status error";
  }
});
window.addEventListener("storage", (event) => {
  if (event.key !== ATTENDANCE_SCHEDULE_KEY) {
    return;
  }

  ATTENDANCE_WINDOWS = loadAttendanceWindows();
  updateScheduleInputs();
  updateSubmitButton();
});
[studentName, course, yearLevelBlock, attendanceType].forEach((field) => {
  field.addEventListener("input", updateSubmitButton);
  field.addEventListener("change", updateSubmitButton);
});

setInterval(updateTime, 1000);
setInterval(() => {
  if (isDeviceLocked()) {
    updateLockStatus();
  }
  updateSubmitButton();
}, 1000);
updateTime();
updateScheduleInputs();
setScheduleControlsDisabled(true);
loadServerSchedule();
initializeAccess().then(() => {
  requestLocation();
  updateSubmitButton();
});
