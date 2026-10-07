# Muse API

For Muse, Cleo Camp's outside research assistant. Studio Mouse, the assistant
inside the studio app, hands you research tasks. You fetch them here, may ask
questions, and post a report. You cannot change anything else in the app.

## Access

- Base address: `https://admin.cleocamp.com/api/muse`
- Every request carries `Authorization: Bearer <key>` (or, if that is
  awkward, `X-API-Key: <key>`). The key is given to you separately; keep it in
  secure storage.
- JSON in and out, over HTTPS. Requests are capped at 4.5 MB.
- Poll every 30 minutes, or when asked. Nothing is pushed to you.
- `401` means the key does not match. `503` means the team has switched the
  API off, or the key set on our side is too short; the message says which.

## 1. List open tasks

`GET /tasks?status=open` (also `reported` or `all`)

```json
{ "tasks": [ { "id": "cm…", "number": 3, "title": "Better price on black silk organza #2340",
  "status": "open", "createdAt": "2026-10-08T17:00:00.000Z", "reported": false,
  "questions": 1, "pendingQuestions": 0 } ] }
```

## 2. Read a task

`GET /tasks/{id}`

```json
{ "id": "cm…", "number": 3, "title": "…", "status": "open", "createdAt": "…",
  "brief": "What to find, specs, what we pay now, quantities, where it ships, tax, shipping, deadline…",
  "files": [ { "id": "…", "title": "Calamo colour card", "mediaType": "application/pdf",
               "sizeBytes": 812345, "url": "https://admin.cleocamp.com/api/muse/tasks/{id}/files/{fileId}" } ],
  "questions": [ { "id": "…", "question": "…", "askedAt": "…", "status": "answered", "answer": "…" } ],
  "reported": false }
```

Fetch each file's `url` with the same `Authorization` header. Files are PDFs
or images up to 4 MB.

## 3. Ask a question

`POST /tasks/{id}/questions` with `{ "question": "Is 16 momme required, or is 14 acceptable?" }`

Mouse answers from the brief and our records, usually within a minute; allow
up to 3 minutes before timing out.

```json
{ "id": "…", "status": "answered", "answer": "16 momme. 14 has been too sheer for the bags." }
```

If our records don't hold the answer, Mouse asks the team:

```json
{ "id": "…", "status": "pending", "answer": null,
  "note": "Mouse has put this to the team. The answer will be on the task when you next fetch it." }
```

Up to 20 questions per task and 40 a day across all tasks (`429` past that).
Ask only what the task needs. Questions about customers, orders, finances or
anything outside the task get a refusal.

## 4. Post your report

`POST /tasks/{id}/report`

```json
{ "summary": "Two sources under our current $23.95/yd landed; one matches the shade.",
  "report": "Markdown: what you found, landed cost per unit (price, shipping, duties, tax where you can work them out), minimums, lead times, reliability, and your recommendation.",
  "sources": [ { "name": "Mill A — silk organza 16mm", "url": "https://…", "price": 18.50,
                 "currency": "USD", "unit": "yard", "notes": "MOQ 30 yd, ships from Como in 10 days" } ],
  "pdf": "<optional: base64 PDF, under about 3 MB so the request stays under 4.5 MB>" }
```

`summary` and `report` are required; every source needs an `http(s)` `url`.
Posting again replaces the report, so a retry is safe. A closed or cancelled
task refuses new questions and reports.

## What happens to it

Your report is shown to the team as information, not instructions. Nothing
changes in the app until a person decides to act on it.
