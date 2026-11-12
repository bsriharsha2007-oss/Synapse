# Synapse

## Run locally

Install PHP 8.1 or later with the `PDO_SQLITE` and `fileinfo` extensions enabled. Start the local development server with:

```powershell
php -d upload_max_filesize=6M -d post_max_size=8M -S 127.0.0.1:8000 -t public public/router.php
```

Open `http://127.0.0.1:8000`. The PHP backend uses the local SQLite database `synapse.db` and has no PHP package dependencies.

Students register with their name, college email, University ID, and a password of at least 10 characters. Account details and projects are stored in SQLite; passwords use PHP's password hashing. Registration always grants the student role. Administrator access is provisioned only from server environment variables. Email addresses are used for team contact after acceptance; this demo does not perform college-domain or email ownership verification.

Project leads define up to 12 role vacancies. Applicants can select an open role and submit an introduction; a PDF resume (up to 5 MB) and/or an `http`/`https` resume or portfolio link are optional. Resume downloads are private to the applicant and project lead. The My Activity page tracks both submitted applications and projects the user posted, including pending decisions. Accepting an applicant fills the role, declines competing applications, unlocks team contact details, and registers the student to one team for that course or event. Project leads can delete their own projects from the project page or My Activity; deleting a project also permanently deletes its roles, applications, resumes, and team membership records. The public discovery feed hides projects once all their roles are filled. Faculty users can inspect all projects, filter to open or fully staffed projects, search and filter by event, and export the master roster as CSV.

Run the end-to-end account, password, application, access-control, and roster checks with `npm test`. Tests use a temporary SQLite database and require PHP to be available on `PATH`.

## Administrator account

Set these environment variables before the first server start to provision the administrator account:

```powershell
$env:ADMIN_UNIVERSITY_ID = "your-admin-university-id"
$env:ADMIN_PASSWORD = "use-a-unique-password-of-at-least-10-characters"
$env:ADMIN_NAME = "Campus Administrator"
php -S 127.0.0.1:8000 -t public public/router.php
```

`ADMIN_NAME` is optional. Set a unique administrator password outside source control; never use example credentials in a real deployment. On first startup, the configured administrator University ID is provisioned with the admin role. Existing Node-era student password hashes are retained with their account data but cannot be verified by PHP; an administrator can set a temporary password in the Faculty Portal and the student can then sign in and change it. Student registrations cannot grant administrator access, and administrator pages, password recovery, and exports are checked on the server. The development command raises PHP's upload limits so valid PDF resumes up to 5 MB can be submitted.

# Synapse — Role-Based Campus Project & Hackathon Matchmaker

Synapse is a full-stack campus team formation platform built with **HTML5, CSS3, Vanilla JavaScript, PHP 8.3, and SQLite3**. It replaces unstructured group chats with a role-slotted recruitment workflow so students can form balanced project and hackathon teams.

---

## Project Structure

```text
Synapse-Web_Tech Project/
├── Dockerfile             # Production container setup (PHP 8.3 + Apache + PDO_SQLITE)
├── database.php           # SQLite schema initialization & PDO connection handler
├── README.md              # Project documentation & deployment guide
├── public/                # Public web root served by Apache
│   ├── .htaccess          # Routes clean URLs & API calls to router.php
│   ├── router.php         # Backend REST API, session auth & role-slot state machine
│   ├── index.html         # Project discovery feed & track filters
│   ├── create.html        # Project creation with dynamic role vacancies
│   ├── project.html       # Project details & structured application handshake
│   ├── profile.html       # Student skill portfolio & proof-of-work links
│   ├── admin.html         # Faculty coordinator dashboard & CSV roster export
│   ├── login.html         # University ID sign-in & student registration
│   ├── css/               # Stylesheets
│   └── js/                # Client-side scripts
└── test/
    └── app.integration.test.js