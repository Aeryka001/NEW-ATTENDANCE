# Attendance Monitoring Website

An attendance website with server-side roster, schedule, location, and admin validation. Attendance records are sent to the configured Google Sheet.

## Features

- Select a course and year/block loaded from Google Sheet roster tabs
- Verify the submitted name against the selected roster tab
- Choose `Time In` or `Time Out`
- Time is captured automatically
- The attendance form is directly accessible without a QR code
- Browser geolocation confirms campus distance without rejecting readings based on reported accuracy
- If location verification fails, users can confirm they want to continue; attendance is then saved with the location recorded as `Not applicable` while schedule and roster checks still apply
- Attendance data is sent to your spreadsheet backend
- Admin-only restriction overrides and schedule management

## Files

- `index.html` — page layout and form
- `styles.css` — UI styling
- `app.js` — location check, time update, form submission

## Setup

1. For local testing, serve the files over HTTP, for example at `http://localhost:8000`. Do not open `index.html` directly as a `file:///` page.
2. Configure the Google Apps Script or REST endpoint to receive POST requests.
3. Replace `GOOGLE_SCRIPT_URL` in `app.js` with your deployed script URL.
### Deploy the authenticated Apps Script backend

1. Open `Code.gs` in Google Apps Script and create a project for the same Google account that owns the attendance sheet.
2. Run `configureScriptProperties` once, then edit the properties in **Project Settings > Script properties**:
  - `ADMIN_PASSWORD`: replace the setup placeholder with a strong password
  - `SHEET_ID`: `1gXRMRzO-3itgpHPQee467-dAoxArH3iwCSTq_FOM1n0`
3. Deploy as **Web app**, execute as **Me**, and allow access for the users who need the attendance page.
4. After changing `Code.gs`, create a new deployment version or update the existing deployment. The deployed version must include the JSONP `doGet` handler; otherwise the old CORS error will continue.
5. Copy the deployed `/exec` URL into `GOOGLE_SCRIPT_URL` in `app.js`.
6. Reload the attendance page and verify admin access. The browser no longer needs to contain the real admin password.

The admin login, schedule controls, and attendance submission use JSONP because Google Apps Script web apps do not provide the CORS response headers required by browser `fetch` calls from a local static server. The page waits for the Apps Script response before showing success; backend validation errors are shown as rejected submissions.

## Admin access

The attendance form includes an **Admin access** section. After entering the configured passcode, an admin can override all restrictions, select individual restrictions, or change the attendance schedule:

- **Override all restrictions** bypasses the location, attendance-time, and device submission-lock checks.
- **Override location restriction** allows an authenticated admin to submit when location is unavailable or outside the configured radius.
- **Override attendance time restriction** allows submission outside the configured attendance schedule.
- **Override device lock** bypasses the device's one-hour submission lock while location remains required.

These overrides require successful admin authentication. Regular users must still pass the location, schedule, and device-lock checks.

These controls are not enabled for regular users. After an admin-authorized submission, the admin section automatically closes and all override selections are cleared. A successful submission is shown on screen and the latest entry is displayed below the form.

### Change the schedule

After admin verification, edit the four opening and closing time pairs and select **Save schedule**. The schedule uses Philippine time (`Asia/Manila`) and is stored centrally by the Apps Script backend. **Reset default schedule** restores the original windows.

The included `Code.gs` backend provides authenticated schedule read/write endpoints. Schedule changes are stored in Script Properties and affect users on different devices after they reload the page. Admin tokens expire after 15 minutes.

## Google Sheets Integration

1. In the configured spreadsheet, create one roster tab per course and year/block. The tab name must exactly be the selected values joined by one space, such as `BSIT 1st`, `BSIT 2nd`, `BSCE 1A`, or `BSCE 1B`.
2. Put a `Name` header in the first row and one student per row. A `Student ID No.` column is optional because attendance is matched by the selected student name. `Full Name` or `Student Name` are also accepted for the name header; `First Name` and `Last Name` columns are supported as an alternative.
3. Each roster tab must contain these columns in its first row, in this order: `Student ID No.`, `Name`, `Date`, `Time In`, `Location`, `Time Out`, `Location`.
4. Attendance updates the selected student's existing row in that roster tab. It does not create a new file, sheet, or attendance row. `Date` receives only the Philippine date; `Time In` and `Time Out` receive only the time; each status writes its GPS coordinates to the `Location` column immediately after that status.
5. Deploy `Code.gs` as a web app, executing as the spreadsheet owner, and allow the attendance page users to access it.
6. Use the deployed `/exec` URL as `GOOGLE_SCRIPT_URL`.

## Notes

- Geolocation requires HTTPS or localhost.
- If you need to add more users, edit the `<select>` options in `index.html`.
- The script will only enable regular submission when the user is within the allowed office radius. The location reading must also be fresh, not report implausible movement, and not indicate a mock location. Accuracy is not checked by the browser or server. An authenticated admin may explicitly override the location restriction.
- If geolocation cannot be obtained, users can use **Submit with location unavailable**. If a detected location fails the server's location check, users are asked to confirm before retrying without coordinates. In either case, the server records `Not applicable` in the attendance location cell and still enforces the attendance schedule and registered-student roster.
- Regular attendance is open only during these Philippine time windows (`Asia/Manila`, UTC+8): `07:40–08:50`, `11:35–12:45`, `13:15–13:50`, and `15:30–17:00`. The closed periods are enforced automatically, even if a device is set to another timezone.
- Admin authentication, roster checks, schedule changes, time validation, and location validation are performed by `Code.gs`. Keep `ADMIN_PASSWORD` only in Apps Script Script Properties.
- Browser geolocation cannot reliably detect every VPN, rooted-device mock location, or GPS-spoofing tool. This implementation rejects browser mock-location signals, stale readings, and implausible reported movement; the server repeats those checks. VPN/proxy detection requires collecting the user's public IP and querying an external IP-risk service. Apps Script does not expose enough request metadata to guarantee VPN detection by itself, and an external service would require an API key, privacy disclosure, and a policy for shared/mobile IP false positives.

`Code.gs` is the complete Apps Script backend for this project. Do not combine it with the old anonymous example endpoint.
