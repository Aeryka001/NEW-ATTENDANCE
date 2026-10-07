/**
 * Attendance Monitoring backend for Google Apps Script.
 * Configure SCRIPT_PROPERTIES before deploying as a web app.
 */
const DEFAULT_SCHEDULE = [
  { start: '07:40', end: '08:50' },
  { start: '11:35', end: '12:45' },
  { start: '13:15', end: '13:50' },
  { start: '15:30', end: '17:00' },
];
const TIME_ZONE = 'Asia/Manila';
const ADMIN_TOKEN_TTL_SECONDS = 15 * 60;
const MAX_LOCATION_AGE_SECONDS = 30;
const MAX_REASONABLE_SPEED_METERS_PER_SECOND = 55;
const OFFICE_LOCATION = {
  latitude: 9.741719220273076,
  longitude: 118.73234378349623,
  radiusMeters: 50,
};
const SCHEDULE_PROPERTY = 'ATTENDANCE_SCHEDULE';
const ADMIN_PASSWORD_PROPERTY = 'ADMIN_PASSWORD';
const SHEET_ID_PROPERTY = 'SHEET_ID';

function doGet(e) {
  const parameters = (e && e.parameter) || {};
  const action = parameters.action || 'schedule';
  const callback = parameters.callback;

  try {
    if (action === 'schedule') {
      return jsonpResponse({ success: true, schedule: getSchedule() }, callback);
    }

    if (action === 'rosterOptions') {
      return jsonpResponse({ success: true, options: getRosterOptions() }, callback);
    }

    if (action === 'rosterStudents') {
      return jsonpResponse({ success: true, names: getRosterStudents(parameters.course, parameters.yearLevelBlock) }, callback);
    }

    if (action === 'attendance') {
      return jsonpResponse(handleAttendance(parameters), callback);
    }

    if (action === 'adminLogin') {
      return jsonpResponse(handleAdminLogin(parameters), callback);
    }

    if (action === 'saveSchedule') {
      requireAdminToken(parameters.token);
      const schedule = parseSchedule(parameters.schedule);
      setSchedule(schedule);
      return jsonpResponse({ success: true, schedule: schedule }, callback);
    }

    if (action === 'resetSchedule') {
      requireAdminToken(parameters.token);
      setSchedule(DEFAULT_SCHEDULE);
      return jsonpResponse({ success: true, schedule: DEFAULT_SCHEDULE }, callback);
    }

    return jsonpResponse({ success: false, error: 'Unknown GET action.' }, callback);
  } catch (error) {
    return jsonpResponse({ success: false, error: error.message }, callback);
  }
}

function doPost(e) {
  try {
    const data = readRequest(e);
    const action = data.action || 'attendance';

    if (action === 'adminLogin') {
      return jsonResponse(handleAdminLogin(data));
    }

    if (action === 'saveSchedule') {
      requireAdminToken(data.token);
      const schedule = parseSchedule(data.schedule);
      setSchedule(schedule);
      return jsonResponse({ success: true, schedule: schedule });
    }

    if (action === 'resetSchedule') {
      requireAdminToken(data.token);
      setSchedule(DEFAULT_SCHEDULE);
      return jsonResponse({ success: true, schedule: DEFAULT_SCHEDULE });
    }

    if (action === 'attendance') {
      return jsonResponse(handleAttendance(data));
    }

    return jsonResponse({ success: false, error: 'Unknown POST action.' });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message });
  }
}

function handleAdminLogin(data) {
  const configuredPassword = PropertiesService.getScriptProperties().getProperty(ADMIN_PASSWORD_PROPERTY);
  const enteredPassword = String(data.password || '').trim();
  if (!configuredPassword || enteredPassword !== configuredPassword.trim()) {
    return { success: false, error: 'Invalid administrator credentials.' };
  }

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(`admin:${token}`, 'valid', ADMIN_TOKEN_TTL_SECONDS);
  return { success: true, token: token, expiresInSeconds: ADMIN_TOKEN_TTL_SECONDS };
}

function handleAttendance(data) {
  const overrideAll = data.adminOverride === 'all';
  const adminToken = data.adminToken || '';
  const locationOverride = overrideAll || data.adminOverride === 'location';
  if (overrideAll || data.adminOverride === 'location' || data.adminOverride === 'time' || data.adminOverride === 'device') {
    requireAdminToken(adminToken);
  }

  const schedule = getSchedule();
  if (!overrideAll && data.adminOverride !== 'time' && !isWithinSchedule(new Date(), schedule)) {
    throw new Error('Attendance is closed for the current Philippine time.');
  }

  const hasLatitude = data.latitude !== undefined && data.latitude !== null && String(data.latitude).trim() !== '';
  const hasLongitude = data.longitude !== undefined && data.longitude !== null && String(data.longitude).trim() !== '';
  const latitude = hasLatitude ? Number(data.latitude) : NaN;
  const longitude = hasLongitude ? Number(data.longitude) : NaN;
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const unavailableLocationSubmission = data.locationUnavailable === 'true';
  const locationTimestamp = Number(data.locationTimestamp);
  const locationAgeSeconds = (Date.now() - locationTimestamp) / 1000;
  const hasFreshLocation = Number.isFinite(locationTimestamp) && locationAgeSeconds >= 0 && locationAgeSeconds <= MAX_LOCATION_AGE_SECONDS;
  const reportedSpeed = Number(data.locationSpeed);
  const hasReasonableSpeed = !Number.isFinite(reportedSpeed) || reportedSpeed < 0 || reportedSpeed <= MAX_REASONABLE_SPEED_METERS_PER_SECOND;
  if (unavailableLocationSubmission && hasLocation) {
    throw new Error('Unavailable-location submissions must not include coordinates.');
  }
  if (!locationOverride && !unavailableLocationSubmission && (!hasLocation || !hasFreshLocation || !hasReasonableSpeed || data.locationMocked === 'true' || getDistanceMeters(latitude, longitude, OFFICE_LOCATION.latitude, OFFICE_LOCATION.longitude) > OFFICE_LOCATION.radiusMeters)) {
    throw new Error('Attendance location is unavailable or outside the allowed area.');
  }

  const sheetId = PropertiesService.getScriptProperties().getProperty(SHEET_ID_PROPERTY);
  if (!sheetId) {
    throw new Error('SHEET_ID is not configured in Script Properties.');
  }

  const workbook = SpreadsheetApp.openById(sheetId);
  const rosterSheetName = `${normalizeRosterValue(data.course)} ${normalizeRosterValue(data['Yearl Level/Block'])}`;
  const rosterSheet = workbook.getSheets().find((candidate) => normalizeRosterValue(candidate.getName()) === rosterSheetName);
  if (!rosterSheet) {
    throw new Error(`Roster sheet "${rosterSheetName}" was not found.`);
  }

  const student = findRegisteredStudent(rosterSheet, data.Name);
  if (!student) {
    throw new Error('The submitted name is not registered in the selected course and year/block.');
  }

  const now = new Date();
  const dateTime = Utilities.formatDate(now, TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  const date = Utilities.formatDate(now, TIME_ZONE, 'yyyy-MM-dd');
  const time = Utilities.formatDate(now, TIME_ZONE, 'HH:mm:ss');
  const location = hasLocation
    ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
    : unavailableLocationSubmission ? 'Not applicable' : 'Admin override - location unavailable';
  const attendanceColumns = ensureAttendanceColumns(rosterSheet);
  const rowNumber = student.rowNumber;
  rosterSheet.getRange(rowNumber, attendanceColumns.date).setValue(date);
  const isTimeOut = data.Status === 'Time Out';
  const statusColumn = isTimeOut ? attendanceColumns.timeOut : attendanceColumns.timeIn;
  rosterSheet.getRange(rowNumber, statusColumn).setValue(time);
  const locationColumn = isTimeOut ? attendanceColumns.timeOutLocation : attendanceColumns.timeInLocation;
  rosterSheet.getRange(rowNumber, locationColumn).setValue(location);

  return { success: true, message: `${data.Status || 'Attendance'} submitted successfully.`, timestamp: dateTime };
}

function getRosterOptions() {
  const sheetId = PropertiesService.getScriptProperties().getProperty(SHEET_ID_PROPERTY);
  if (!sheetId) throw new Error('SHEET_ID is not configured in Script Properties.');
  return SpreadsheetApp.openById(sheetId).getSheets().map((sheet) => {
    const parts = sheet.getName().trim().split(/\s+/);
    return {
      course: parts.shift() || '',
      yearLevelBlock: parts.join(' '),
      sheetName: sheet.getName(),
    };
  }).filter(({ course, yearLevelBlock, sheetName }) => course && yearLevelBlock && sheetName !== 'Attendance Log');
}

function getRosterStudents(course, yearLevelBlock) {
  const sheetId = PropertiesService.getScriptProperties().getProperty(SHEET_ID_PROPERTY);
  if (!sheetId || !course || !yearLevelBlock) return [];
  const rosterName = `${normalizeRosterValue(course)} ${normalizeRosterValue(yearLevelBlock)}`;
  const rosterSheet = SpreadsheetApp.openById(sheetId).getSheets().find((sheet) => normalizeRosterValue(sheet.getName()) === rosterName);
  if (!rosterSheet) throw new Error('The selected course and year/block roster was not found.');

  const values = rosterSheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0].map(normalizeRosterValue);
  const nameIndex = headers.findIndex((header) => ['NAME', 'FULL NAME', 'STUDENT NAME'].includes(header));
  const firstNameIndex = headers.indexOf('FIRST NAME');
  const lastNameIndex = headers.indexOf('LAST NAME');
  const names = values.slice(1).map((row) => nameIndex >= 0
    ? row[nameIndex]
    : firstNameIndex >= 0 && lastNameIndex >= 0
      ? `${row[firstNameIndex]} ${row[lastNameIndex]}`
      : row[0]).map((name) => String(name || '').trim()).filter(Boolean);
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function findRegisteredStudent(sheet, submittedName) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return null;
  const headers = values[0].map(normalizeRosterValue);
  const idIndex = headers.findIndex((header) => ['STUDENT ID NO.', 'STUDENT ID NO', 'STUDENT ID', 'ID NO.'].includes(header));
  const nameIndex = headers.findIndex((header) => ['NAME', 'FULL NAME', 'STUDENT NAME'].includes(header));
  const firstNameIndex = headers.indexOf('FIRST NAME');
  const lastNameIndex = headers.indexOf('LAST NAME');
  const submitted = normalizeRosterValue(submittedName);
  const row = values.slice(1).find((candidate) => normalizeRosterValue(getRosterName(candidate, nameIndex, firstNameIndex, lastNameIndex)) === submitted);
  if (!row) return null;
  return { name: getRosterName(row, nameIndex, firstNameIndex, lastNameIndex), id: idIndex >= 0 ? row[idIndex] : '', rowNumber: values.slice(0, values.indexOf(row) + 1).length };
}

function getRosterName(row, nameIndex, firstNameIndex, lastNameIndex) {
  return nameIndex >= 0
    ? row[nameIndex]
    : firstNameIndex >= 0 && lastNameIndex >= 0
      ? `${row[firstNameIndex]} ${row[lastNameIndex]}`
      : row[0];
}

function ensureAttendanceColumns(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(normalizeRosterValue);
  const findColumn = (header, startIndex) => {
    const index = headers.indexOf(normalizeRosterValue(header), startIndex || 0);
    if (index < 0) throw new Error(`Roster sheet is missing the "${header}" column.`);
    return index + 1;
  };
  const timeIn = findColumn('Time In');
  const timeOut = findColumn('Time Out', timeIn);
  const timeInLocation = findColumn('Location', timeIn);
  const timeOutLocation = findColumn('Location', timeOut);
  return {
    name: findColumn('Name'),
    date: findColumn('Date'),
    timeIn: timeIn,
    timeInLocation: timeInLocation,
    timeOut: timeOut,
    timeOutLocation: timeOutLocation,
  };
}

function normalizeRosterValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function isRegisteredStudent(sheet, submittedName) {
  return Boolean(findRegisteredStudent(sheet, submittedName));
}

function requireAdminToken(token) {
  if (!token || CacheService.getScriptCache().get(`admin:${token}`) !== 'valid') {
    throw new Error('Administrator authentication is required or has expired.');
  }
}

function getSchedule() {
  const saved = PropertiesService.getScriptProperties().getProperty(SCHEDULE_PROPERTY);
  if (!saved) {
    return DEFAULT_SCHEDULE;
  }

  try {
    return parseSchedule(saved);
  } catch (error) {
    return DEFAULT_SCHEDULE;
  }
}

function setSchedule(schedule) {
  PropertiesService.getScriptProperties().setProperty(SCHEDULE_PROPERTY, JSON.stringify(schedule));
}

function parseSchedule(value) {
  const schedule = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(schedule) || schedule.length !== DEFAULT_SCHEDULE.length) {
    throw new Error('Schedule must contain exactly four opening windows.');
  }

  for (let index = 0; index < schedule.length; index += 1) {
    const window = schedule[index];
    const previous = schedule[index - 1];
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end) || window.start >= window.end || (previous && previous.end > window.start)) {
      throw new Error('Schedule times must be valid, ordered, and non-overlapping.');
    }
  }

  return schedule.map((window) => ({ start: window.start, end: window.end }));
}

function isWithinSchedule(date, schedule) {
  const current = Utilities.formatDate(date, TIME_ZONE, 'HH:mm');
  return schedule.some((window) => current >= window.start && current < window.end);
}

function getDistanceMeters(latitude1, longitude1, latitude2, longitude2) {
  const toRadians = (value) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const deltaLatitude = toRadians(latitude2 - latitude1);
  const deltaLongitude = toRadians(longitude2 - longitude1);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(toRadians(latitude1)) * Math.cos(toRadians(latitude2)) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function readRequest(e) {
  if (e.postData && e.postData.contents && e.postData.type && e.postData.type.indexOf('application/json') !== -1) {
    return JSON.parse(e.postData.contents);
  }
  return e.parameter || {};
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function jsonpResponse(payload, callback) {
  const json = JSON.stringify(payload);
  if (!callback || !/^[a-zA-Z_$][\w$]*$/.test(callback)) {
    return jsonResponse(payload);
  }
  return ContentService.createTextOutput(`${callback}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
}   

/** Run once from the Apps Script editor after setting the values below. */
function configureScriptProperties() {
  PropertiesService.getScriptProperties().setProperties({
    ADMIN_PASSWORD: 'JungK00k1',
    SHEET_ID: '1gXRMRzO-3itgpHPQee467-dAoxArH3iwCSTq_FOM1n0',
  }, false);
}
