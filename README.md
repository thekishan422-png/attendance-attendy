# AGC Attendance Calculator

A student-facing attendance calculator for AGC LMS with a fixed 75% target.

## Run

```bash
node server.js
```

Open the URL printed by the server, usually:

```text
http://127.0.0.1:3000
```

## What It Does

- Logs in to the AGC LMS student portal for the current request.
- Reads the dashboard subject attendance links.
- Fetches each subject attendance report.
- Combines duplicate subject names into one subject.
- Shows current percentage, classes needed to reach 75%, and classes that can be skipped while staying at 75%.

## Privacy

The password is not stored in the browser or server files. It is only sent to the local server for one attendance fetch request.

If this app is deployed online for many students, the deployed server will receive student passwords during login. Use a trusted server and HTTPS.
