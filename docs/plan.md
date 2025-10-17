PrintMeChecks — Feature Expansion Plan

Saved: docs/plan.md

Overview
--------
This document captures the end-to-end plan to upgrade PrintMeChecks from a single-user local check-printing tool into a small multi-user web application with:

- Azure AD authentication (SPA + backend token validation)
- Multi-user support and per-user data
- PDF upload and attachment support (multiple PDFs per check)
- Ability to upload PDFs independently (documents-only) and send via email or PostGrid physical mail
- Email delivery via Azure Communication Services (ACS)
- Physical mail via PostGrid with full send-job tracking and webhook handling
- Docker-based deployment with Postgres (database) and containerized frontend & backend

Constraints and non-functional goals
----------------------------------
- Preserve the existing check template and all print positioning: the current `src/components/CheckPrinter.vue` must remain unchanged for printing/layout.
- Small scale: 10–20 concurrent users—keep designs simple and operationally lightweight.
- Secure by default: validate auth tokens, limit uploads, verify webhooks, and avoid storing sensitive bank data unless encrypted.

Assumptions
-----------
- Single organization (not multi-tenant).
- Preferred backend: Node.js + TypeScript + Express (Prisma ORM for Postgres). Frontend remains Vue 3 + Vite.
- File storage: prefer Azure Blob Storage (production) but allow local server storage for dev/private installs.
- The browser will be able to export the exact printable check PDF; browser-generated PDF will be the canonical file used for mail to guarantee alignment.

Architecture (high-level)
-------------------------
- Frontend (Vue 3 + Vite): uses MSAL for Azure AD sign-in, authorizes API calls with access tokens. Keeps `CheckPrinter.vue` as-is; adds UI for uploads, attachments, send flows, and history.
- Backend (Node.js/Express + TypeScript): validates Azure AD tokens, exposes REST APIs for checks, documents, send jobs, and webhooks. Uses Prisma to talk to Postgres. Streams files to Azure Blob Storage (or local volume) and integrates with PostGrid and ACS.
- Database: Postgres (Docker container). Stores users, accounts, checks, documents metadata, send_jobs, audit logs.
- Storage: Azure Blob Storage (recommended) or server-local volume.
- External: Azure AD, PostGrid API, Azure Communication Services (Email).

Core Data Model (conceptual)
----------------------------
- User: id, azure_ad_sub, email, name, role, timestamps
- Account: id, owner_user_id, name, optional bank metadata (encrypted)
- Check: id, created_by, account_id, payee info, amount, template_version, status (DRAFT,SENT,...), timestamps
- Document: id, filename, mime, size, storage_path (blob URI), uploaded_by, timestamps
- CheckDocument: join table to order attachments per check
- SendJob: id, check_id (nullable), document_ids, method (EMAIL, POSTGRID), recipient, providerId, status, provider_response, timestamps
- AuditLog: user_id, action, details(json), timestamp

API Surface (high-level)
------------------------
- Auth: SPA uses MSAL; backend validates JWT and upserts user record.
- /api/me — current user
- /api/checks — CRUD for checks
- /api/documents — multipart upload for PDFs, metadata endpoints, download streaming
- /api/checks/:id/attachments — attach/detach documents
- /api/send — create send job (EMAIL or POSTGRID)
- /api/send/:id — fetch status
- /api/send/:id/refresh — ask provider for latest status
- /api/webhook/postgrid — receive PostGrid webhooks (verify signature)

File upload & storage
---------------------
Two options:
- Recommended (simple + reliable): client uploads PDFs to backend; backend streams to Azure Blob Storage and returns blob URI stored in DB.
- Optional (optimized): backend returns a short-lived SAS URL and client uploads directly to Blob Storage, then notifies backend with file metadata.

PDF handling and the check template (critical)
---------------------------------------------
- To guarantee zero-drift in print positioning, the frontend should export the check as a PDF (exactly as the print view) and upload that PDF as the canonical check file. The backend and PostGrid will use that exact PDF for physical mail.
- For physical mail, checks must always be sent individually (or printed locally) using the exact browser-generated check PDF — do not merge the check PDF into another document or alter its layout. Attachments (other PDFs) may be included as separate files/enclosures in the same PostGrid send request if the provider supports multiple files; they should not be merged into the check PDF. This preserves the check template and guarantees alignment while still allowing additional documents to be delivered alongside the check.
- Note: PostGrid supports multiple ways to receive check content. Some customers send a ready-made PDF, others POST structured (raw) check data that PostGrid renders using a template on their side. To support both workflows while guaranteeing the existing check template is never altered by our app, the system will support two send modes:
 
 1. PDF mode (default): the frontend uploads the exact browser-generated check PDF and the backend sends that PDF to PostGrid. This guarantees the app's check template and print positioning are preserved exactly.
 2. Raw-data mode (optional): when configured to use raw-data sending (via env var POSTGRID_SEND_MODE=raw or POSTGRID_SEND_MODE=auto and provider capability detection), the backend will POST structured check fields (payee, amount, memo, positions, templateId, etc.) to PostGrid's raw-data endpoint and let PostGrid render the check using a server-side template. Use this only if you have confirmed the PostGrid template reproduces your current printed layout exactly.
 
 Adaptive send strategy and configuration:
 
 - New environment flag: POSTGRID_SEND_MODE with values: `pdf`, `raw`, or `auto` (default: `auto`).
  - `pdf`: always require a canonical check PDF (client-uploaded) and send that to PostGrid.
  - `raw`: accept structured `checkData` in the send request and POST that raw data to PostGrid's data endpoint.
  - `auto`: prefer `raw` if the provider is configured to accept raw check data (POSTGRID_API_SUPPORTS_RAW=true), otherwise fall back to `pdf`.
 
 Implementation rules to preserve the template and behavior:
 - The frontend should continue to render the check exactly as-it-is for local printing and must not change the `CheckPrinter.vue` template. If you elect to use raw-data mode, you must validate (outside this app) that the PostGrid-hosted template reproduces the exact printed layout before enabling `raw` for production.
 - API contract: `POST /api/send` for method=POSTGRID will accept either:
  - `checkDocumentId` (string): id of an uploaded PDF document flagged as `isCheck` — required when in `pdf` mode.
  - `checkData` (object): structured fields representing the check (payee, amount, memo, date, templateId, fieldPositions optional) — required when in `raw` mode.
  The backend will validate that the request contains the correct payload for the configured send mode and reject combinations that would require altering the check PDF (for example, attempting to merge a `checkDocumentId` into another PDF server-side when `isCheck=true`).
 
 Combining checks and attachments:
 - If the provider supports raw-data and multiple files/enclosures in one API call, the backend may send the `checkData` plus attachments together in a single PostGrid request. If the provider supports raw-data but not multiple file enclosures, attachments will be sent as separate mailings or handled per your configured policy.
 - If using `pdf` mode, the backend will send the canonical check PDF as the primary file and attachments as separate enclosures in the same request only if the provider's API supports multiple files. If not supported, attachments will be sent in separate mailings or as decided by your policy.
 
 This approach lets us combine checks and PDFs when PostGrid's API allows it; otherwise we will keep checks and attachments as separate artifacts to preserve the check PDF exactly.

PostGrid integration and tracking
--------------------------------
- Backend stores providerId returned by PostGrid when a job is created.
- Implement a webhook endpoint (`/api/webhook/postgrid`) to receive provider callbacks and update `send_jobs.provider_response` and `send_jobs.status`.
- Support polling: `/api/send/:id/refresh` calls PostGrid's status API when webhook is not available or for reconciliation.
- Add provider signature validation for the webhook (verify using PostGrid's webhook secret if provided).

Email via Azure Communication Services (ACS)
-------------------------------------------
- Use the official `@azure/communication-email` client on the backend.
- Backend streams attachments from storage to ACS when sending.
- Respect sender verification and compliance constraints for ACS (verified sender domain).

Docker & Deployment
-------------------
- docker-compose.yml with services:
  - postgres (persistent volume)
  - backend (build from ./server)
  - frontend (build/serve static or run Vite in prod preview)
- Local dev: run Postgres in docker, frontend & backend in dev mode locally.

Security & Compliance
---------------------
- Validate Azure AD tokens on every request
- Limit file types to PDF, validate PDF magic bytes, and enforce per-file and per-account storage quotas
- Use HTTPS in production; store secrets in env or secret store (Azure Key Vault)
- Encrypt any sensitive fields (e.g., bank account numbers) or avoid storing them
- Protect webhooks with signature verification

Edge cases and error handling
-----------------------------
- Token expiry: return 401 and have frontend use MSAL silent refresh
- Partial provider failure: mark send_job as FAILED and persist provider error
- Idempotency: require idempotency key for send creation to avoid duplicate sends
- Large attachments: enforce limits and use direct SAS upload if needed

Testing, QA, and quality gates
-----------------------------
- Unit tests for auth middleware and provider wrappers
- Integration tests using mocks for PostGrid and ACS
- Manual e2e smoke tests: login, export check PDF from browser, upload, attach, send via email/postgrid, verify webhook updates
- CI: lint, typecheck, unit tests, build images

Milestones & Implementation Plan (recommended incremental)
---------------------------------------------------------
1) Scaffold backend, Prisma schema, docker-compose + Postgres, auth middleware (Azure AD token validation). (1–2 days)
2) Document upload endpoints + storage (Azure Blob or local), document metadata. (1–2 days)
3) Check CRUD + attach/detach documents; frontend UI for uploads and attachments; export check PDF and upload flow (frontend unchanged for print layout). (1–2 days)
4) Integrate ACS Email (send with attachments) and record send_job. (1 day)
5) Integrate PostGrid (send check PDF + attachments), persist providerId, implement webhook verification and tracking UI. (1–2 days)
6) Replace JSON store with Postgres/Prisma and add migrations, tests, polish, and Docker production images. (1–2 days)

Notes about preserving the check template and sending rules
----------------------------------------
- To guarantee exact print alignment, the frontend must produce the final check PDF and upload it. Server-side rendering of the check is optional but risks layout drift.
- Sending rule: Every check is an individual artifact and must be sent individually via PostGrid (or printed locally). Do not combine the check PDF with other documents into a single merged PDF when sending the check. If additional documents should accompany the check, send them as separate files/enclosures in the same mail job (if PostGrid supports that) or as separate mailings per your business rules.

Files and changes created during the exploratory work
---------------------------------------------------
- `server/` — prototype Express server with send-job tracking and a PostGrid wrapper that simulates responses when API keys are not configured.
- `docker-compose.yml` — prototype compose for Postgres + server
- `printmechecks/src/services/sendApi.ts` — frontend API client
- `printmechecks/src/views/HistoryView.vue` — UI extension to list and manage PostGrid send jobs

Next decisions for you
----------------------
Please pick one or more of the following next steps so I can implement them next:

A) Wire real PostGrid API payloads (multipart/form-data or file-URL based) and add webhook signature verification — I'll need PostGrid API docs/credentials or I'll adapt from their public docs.

B) Implement Postgres + Prisma schema and migrate the `send_jobs`, `documents`, `checks`, and `users` models from the prototype JSON store to Postgres.

C) Implement the browser export-to-PDF + upload flow and backend document endpoints (this ensures the check PDF used for mail is identical to the print template).

D) Integrate Azure Communication Services email sending and test end-to-end email sends with attachments.

E) Add Azure AD (MSAL) frontend integration and backend token validation & user upsert (if you want auth next).

If you want to discuss priorities, I recommend we implement C (client PDF export) and B (Postgres) next, then A (PostGrid exact payloads) and D (ACS email). For most risk minimization: start with C so we guarantee the check PDF is identical, then persist artifacts in Postgres (B), then integrate providers (A & D).

Where I saved the plan
----------------------
- File: `docs/plan.md` in the repository root (this file).

What I will do next once you confirm
-----------------------------------
- If you confirm C or B, I'll start implementing those changes immediately and run the local stack and tests. If you confirm A, I'll request the PostGrid webhook secret and preferred file-transfer method (upload vs URL) or I can infer from their public docs and proceed.

Questions for you
------------------
1. Do you prefer Azure Blob Storage (recommended) or server-local storage for attachments?
2. Will the browser always produce the check PDF (i.e., do you want the client to export & upload the check PDF), or do you prefer server-side rendering?
3. Do you have PostGrid credentials and webhook secret now, or should I continue with simulation until you provide them?

End of plan.
