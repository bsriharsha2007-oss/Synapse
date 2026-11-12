<?php
declare(strict_types=1);

require_once dirname(__DIR__) . DIRECTORY_SEPARATOR . 'database.php';

header_remove('X-Powered-By');
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');

set_exception_handler(static function (Throwable $error): void {
    error_log((string)$error);
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo '{"error":"An unexpected server error occurred."}';
});

$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
session_name('synapse_sid');
session_set_cookie_params([
    'lifetime' => 86400,
    'path' => '/',
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

function respond(int $status, mixed $data): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fail(int $status, string $message): never
{
    respond($status, ['error' => $message]);
}

function body(): array
{
    $raw = file_get_contents('php://input');
    if (str_contains(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
        $decoded = json_decode($raw ?: '', true);
        return is_array($decoded) ? $decoded : [];
    }
    return $_POST;
}

function id(string $prefix): string
{
    return $prefix . '-' . strtoupper(bin2hex(random_bytes(4)));
}

function userById(string $userId): ?array
{
    $query = database()->prepare('SELECT * FROM users WHERE id = ?');
    $query->execute([$userId]);
    $user = $query->fetch();
    return $user ?: null;
}

function publicUser(array $user): array
{
    return array_intersect_key($user, array_flip(['id', 'name', 'email', 'skills', 'github_url', 'university_id', 'role']));
}

function currentUser(): ?array
{
    return isset($_SESSION['user_id']) ? userById((string)$_SESSION['user_id']) : null;
}

function validUrl(string $value): bool
{
    $parts = parse_url($value);
    return strlen($value) <= 2048 && is_array($parts) &&
        in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) &&
        !isset($parts['user']) && !isset($parts['pass']);
}

function hashPassword(string $password): string
{
    $algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    return password_hash(hash('sha256', $password), $algorithm);
}

function verifyPassword(string $password, string $storedHash): bool
{
    return password_verify(hash('sha256', $password), $storedHash);
}

function rollbackError(Throwable $error): never
{
    if (database()->inTransaction()) {
        database()->rollBack();
    }
    error_log((string)$error);
    fail(500, 'An unexpected server error occurred.');
}

function transaction(callable $work): mixed
{
    $db = database();
    $db->beginTransaction();
    try {
        $result = $work($db);
        $db->commit();
        return $result;
    } catch (Throwable $error) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function provisionAdmin(): void
{
    $universityId = strtoupper(trim((string)getenv('ADMIN_UNIVERSITY_ID')));
    $password = getenv('ADMIN_PASSWORD');
    if ($universityId === '' && ($password === false || $password === '')) {
        return;
    }
    if ($universityId === '' || !is_string($password) || strlen($password) < 10) {
        throw new RuntimeException('Set ADMIN_UNIVERSITY_ID and ADMIN_PASSWORD (at least 10 characters).');
    }
    $db = database();
    $query = $db->prepare('SELECT id, role, password_hash FROM users WHERE university_id = ?');
    $query->execute([$universityId]);
    $existing = $query->fetch();
    if ($existing && $existing['role'] !== 'admin') {
        throw new RuntimeException('ADMIN_UNIVERSITY_ID belongs to a student account. Choose a different administrator ID.');
    }
    if ($existing) {
        if ($existing['password_hash'] === null || str_starts_with((string)$existing['password_hash'], 'scrypt$')) {
            $update = $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $update->execute([hashPassword($password), $existing['id']]);
        }
        return;
    }
    $insert = $db->prepare("INSERT INTO users (id, name, email, skills, role, university_id, password_hash)
        VALUES (?, ?, ?, '', 'admin', ?, ?)");
    $insert->execute([
        id('ADM'),
        trim((string)(getenv('ADMIN_NAME') ?: 'Campus Administrator')),
        strtolower(id('') . '@admins.synapse.local'),
        $universityId,
        hashPassword($password),
    ]);
}

try {
    provisionAdmin();
} catch (Throwable $error) {
    error_log($error->getMessage());
    fail(500, 'Administrator provisioning failed. Check the server configuration.');
}

$originalPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = strtolower($originalPath);
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$data = body();
$user = null;

if ($path === '/api/auth/register' && $method === 'POST') {
    $name = trim((string)($data['name'] ?? ''));
    $email = strtolower(trim((string)($data['email'] ?? '')));
    $universityId = strtoupper(trim((string)($data['university_id'] ?? '')));
    $password = $data['password'] ?? null;
    if ($name === '' || strlen($name) > 100 || $universityId === '' || strlen($universityId) > 64 || preg_match('/[\x00-\x1f]/', $universityId)) {
        fail(400, 'Enter your name and a valid University ID.');
    }
    if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(400, 'Enter a valid college email address.');
    }
    if (!is_string($password) || strlen($password) < 10 || strlen($password) > 128) {
        fail(400, 'Password must be between 10 and 128 characters.');
    }
    try {
        $newId = id('USR');
        $insert = database()->prepare("INSERT INTO users (id, name, email, skills, role, university_id, password_hash)
            VALUES (?, ?, ?, '', 'student', ?, ?)");
        $insert->execute([$newId, $name, $email, $universityId, hashPassword($password)]);
        session_regenerate_id(true);
        $_SESSION['user_id'] = $newId;
        respond(201, ['user' => publicUser(userById($newId))]);
    } catch (PDOException $error) {
        if (str_contains(strtolower($error->getMessage()), 'unique')) {
            fail(409, 'An account with this University ID or email already exists.');
        }
        error_log((string)$error);
        fail(500, 'An unexpected server error occurred.');
    }
}

if ($path === '/api/auth/login' && $method === 'POST') {
    $universityId = strtoupper(trim((string)($data['university_id'] ?? '')));
    $password = $data['password'] ?? null;
    if ($universityId === '' || !is_string($password) || $password === '') {
        fail(400, 'Enter your University ID and password.');
    }
    $query = database()->prepare('SELECT * FROM users WHERE university_id = ?');
    $query->execute([$universityId]);
    $account = $query->fetch();
    if (!$account || !is_string($account['password_hash']) || !verifyPassword($password, $account['password_hash'])) {
        fail(401, 'University ID or password is incorrect.');
    }
    session_regenerate_id(true);
    $_SESSION['user_id'] = $account['id'];
    respond(200, ['user' => publicUser($account)]);
}

if ($path === '/api/auth/logout' && $method === 'POST') {
    $_SESSION = [];
    session_destroy();
    setcookie('synapse_sid', '', ['expires' => time() - 3600, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    respond(200, ['message' => 'Signed out.']);
}

if ($path === '/api/auth/session' && $method === 'GET') {
    $sessionUser = currentUser();
    respond(200, ['user' => $sessionUser ? publicUser($sessionUser) : null]);
}

$publicStatic = in_array($path, ['/login.html', '/css/style.css', '/js/app.js'], true);
$page = in_array($path, ['/', '/index.html', '/create.html', '/profile.html', '/project.html', '/admin.html'], true);
$api = str_starts_with($path, '/api/');
if (($page && !$publicStatic) || ($api && !str_starts_with($path, '/api/auth/'))) {
    $user = currentUser();
    if (!$user) {
        if ($api) {
            fail(401, 'Please sign in to continue.');
        }
        header('Location: /login.html?next=' . rawurlencode($_SERVER['REQUEST_URI'] ?? '/index.html'), true, 302);
        exit;
    }
    if (($path === '/admin.html' || str_starts_with($path, '/api/admin/')) && $user['role'] !== 'admin') {
        if ($api) {
            fail(403, 'Administrator access is required.');
        }
        http_response_code(403);
        echo '<!doctype html><html lang="en"><meta charset="utf-8"><title>Access denied</title><link rel="stylesheet" href="/css/style.css"><body><main class="container"><section class="card"><h1>Administrator access required</h1><p>Your account does not have permission to open the faculty portal.</p><a class="btn-primary" href="/index.html">Return to projects</a></section></main></body></html>';
        exit;
    }
}

if ($page) {
    $file = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . (ltrim($path, '/') ?: 'index.html');
    if (!is_file($file)) {
        http_response_code(404);
        exit;
    }
    header('Content-Type: text/html; charset=utf-8');
    readfile($file);
    exit;
}

if ($path === '/api/me' && $method === 'GET') {
    respond(200, publicUser($user));
}

if ($path === '/api/profile' && $method === 'POST') {
    $name = trim((string)($data['name'] ?? ''));
    $email = strtolower(trim((string)($data['email'] ?? '')));
    $skills = trim((string)($data['skills'] ?? ''));
    $github = trim((string)($data['github_url'] ?? ''));
    if ($name === '' || strlen($name) > 100 || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254 || $skills === '' || strlen($skills) > 500) {
        fail(400, 'Enter a valid name, college email, and skills (up to 500 characters).');
    }
    if ($github !== '' && !validUrl($github)) {
        fail(400, 'Portfolio URL must use http or https.');
    }
    try {
        $query = database()->prepare('UPDATE users SET name = ?, email = ?, skills = ?, github_url = ? WHERE id = ?');
        $query->execute([$name, $email, $skills, $github ?: null, $user['id']]);
        respond(200, ['message' => 'Profile updated.']);
    } catch (PDOException $error) {
        if (str_contains(strtolower($error->getMessage()), 'unique')) {
            fail(409, 'That email address is already in use.');
        }
        error_log((string)$error);
        fail(500, 'An unexpected server error occurred.');
    }
}

if ($path === '/api/password' && $method === 'POST') {
    $current = $data['current_password'] ?? null;
    $next = $data['new_password'] ?? null;
    if (!is_string($current) || !is_string($next) || strlen($next) < 10 || strlen($next) > 128) {
        fail(400, 'Enter your current password and a new password between 10 and 128 characters.');
    }
    if (!verifyPassword($current, (string)$user['password_hash'])) {
        fail(400, 'Your current password is incorrect.');
    }
    $query = database()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $query->execute([hashPassword($next), $user['id']]);
    respond(200, ['message' => 'Password changed successfully.']);
}

if ($path === '/api/projects' && $method === 'GET') {
    $query = database()->prepare("SELECT p.*, u.name AS leader_name FROM projects p JOIN users u ON p.leader_id = u.id
        WHERE EXISTS (SELECT 1 FROM vacancies v WHERE v.project_id = p.id AND v.status = 'Open')
        AND (? = '' OR p.track = ?) AND (? = '' OR p.event_tag = ?) ORDER BY p.created_at DESC");
    $track = trim((string)($_GET['track'] ?? ''));
    $event = trim((string)($_GET['event_tag'] ?? ''));
    $query->execute([$track, $track, $event, $event]);
    $projects = $query->fetchAll();
    $vacancies = database()->query('SELECT * FROM vacancies')->fetchAll();
    $members = database()->prepare('SELECT project_id FROM project_members WHERE user_id = ?');
    $members->execute([$user['id']]);
    $memberIds = array_column($members->fetchAll(), 'project_id');
    $apps = database()->prepare('SELECT vacancy_id, status FROM applications WHERE applicant_id = ?');
    $apps->execute([$user['id']]);
    $statuses = array_column($apps->fetchAll(), 'status', 'vacancy_id');
    foreach ($projects as &$project) {
        $project['is_leader'] = $project['leader_id'] === $user['id'];
        $project['is_member'] = in_array($project['id'], $memberIds, true);
        $project['vacancies'] = array_values(array_map(static function (array $vacancy) use ($project, $statuses): array {
            $vacancy['application_status'] = $statuses[$vacancy['id']] ?? null;
            return $vacancy;
        }, array_filter($vacancies, static fn(array $vacancy): bool => $vacancy['project_id'] === $project['id'])));
    }
    unset($project);
    respond(200, $projects);
}

if (preg_match('~^/api/projects/([^/]+)$~', $originalPath, $match) && $method === 'GET') {
    $query = database()->prepare('SELECT p.*, u.name AS leader_name, u.email AS leader_email FROM projects p JOIN users u ON p.leader_id = u.id WHERE p.id = ?');
    $query->execute([$match[1]]);
    $project = $query->fetch();
    if (!$project) {
        fail(404, 'Project not found.');
    }
    $query = database()->prepare('SELECT * FROM vacancies WHERE project_id = ?');
    $query->execute([$project['id']]);
    $vacancies = $query->fetchAll();
    $appQuery = database()->prepare("SELECT a.id, a.vacancy_id, a.applicant_id, a.pitch_note, a.proof_url, a.status, a.created_at, a.resume_name,
        CASE WHEN a.resume_data IS NULL THEN 0 ELSE 1 END AS has_resume, u.name AS applicant_name,
        u.email AS applicant_email, u.skills AS applicant_skills, u.github_url
        FROM applications a JOIN users u ON a.applicant_id = u.id
        WHERE a.vacancy_id IN (SELECT id FROM vacancies WHERE project_id = ?)");
    $appQuery->execute([$project['id']]);
    $applications = $appQuery->fetchAll();
    $membership = database()->prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?');
    $membership->execute([$project['id'], $user['id']]);
    $isMember = (bool)$membership->fetchColumn();
    if ($user['id'] !== $project['leader_id'] && !$isMember) {
        $project['leader_email'] = null;
    }
    $myApplications = array_map(static fn(array $app): array => ['vacancy_id' => $app['vacancy_id'], 'status' => $app['status']],
        array_values(array_filter($applications, static fn(array $app): bool => $app['applicant_id'] === $user['id'])));
    foreach ($applications as &$application) {
        if ($application['status'] !== 'Accepted') {
            $application['applicant_email'] = null;
        }
    }
    unset($application);
    respond(200, [
        'project' => $project,
        'vacancies' => $vacancies,
        'is_member' => $isMember,
        'applications' => $user['id'] === $project['leader_id'] ? $applications : [],
        'my_applications' => $myApplications,
    ]);
}

if ($path === '/api/me/activity' && $method === 'GET') {
    $query = database()->prepare("SELECT p.id, p.title, p.event_tag, p.track, p.created_at, COUNT(DISTINCT v.id) AS role_count,
        SUM(CASE WHEN v.status = 'Filled' THEN 1 ELSE 0 END) AS filled_count,
        COUNT(DISTINCT CASE WHEN a.status = 'Pending' THEN a.id END) AS pending_count,
        COUNT(DISTINCT a.id) AS application_count
        FROM projects p LEFT JOIN vacancies v ON v.project_id = p.id LEFT JOIN applications a ON a.vacancy_id = v.id
        WHERE p.leader_id = ? GROUP BY p.id ORDER BY p.created_at DESC");
    $query->execute([$user['id']]);
    $projects = $query->fetchAll();
    $query = database()->prepare("SELECT a.id, a.status, a.created_at, a.proof_url,
        CASE WHEN a.resume_data IS NULL THEN 0 ELSE 1 END AS has_resume, a.vacancy_id, v.role_title,
        p.id AS project_id, p.title AS project_title, p.event_tag, p.track, u.name AS leader_name
        FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN projects p ON p.id = v.project_id
        JOIN users u ON u.id = p.leader_id WHERE a.applicant_id = ? ORDER BY a.created_at DESC");
    $query->execute([$user['id']]);
    respond(200, ['projects' => $projects, 'applications' => $query->fetchAll()]);
}

if (preg_match('~^/api/applications/([^/]+)/resume$~', $originalPath, $match) && $method === 'GET') {
    $query = database()->prepare("SELECT a.applicant_id, a.resume_name, a.resume_data, p.leader_id FROM applications a
        JOIN vacancies v ON v.id = a.vacancy_id JOIN projects p ON p.id = v.project_id WHERE a.id = ?");
    $query->execute([$match[1]]);
    $application = $query->fetch();
    if (!$application || !$application['resume_data']) {
        fail(404, 'Resume not found.');
    }
    if ($application['applicant_id'] !== $user['id'] && $application['leader_id'] !== $user['id']) {
        fail(403, 'Only you and the project lead can access this resume.');
    }
    $filename = preg_replace('/[^\w.-]/', '_', basename($application['resume_name'] ?: 'resume.pdf'));
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');
    echo $application['resume_data'];
    exit;
}

if ($path === '/api/projects' && $method === 'POST') {
    $title = trim((string)($data['title'] ?? ''));
    $description = trim((string)($data['description'] ?? ''));
    $event = trim((string)($data['event_tag'] ?? ''));
    $track = $data['track'] ?? '';
    $roles = $data['roles'] ?? null;
    if ($title === '' || strlen($title) > 120 || $description === '' || strlen($description) > 3000 ||
        $event === '' || strlen($event) > 120 || !in_array($track, ['Competitive', 'Growth'], true) ||
        !is_array($roles) || count($roles) < 1 || count($roles) > 12) {
        fail(400, 'Please provide all project details and at least one complete role vacancy.');
    }
    foreach ($roles as $role) {
        if (!is_array($role) || trim((string)($role['role_title'] ?? '')) === '' || strlen(trim((string)$role['role_title'])) > 100 ||
            trim((string)($role['required_skills'] ?? '')) === '' || strlen(trim((string)$role['required_skills'])) > 300) {
            fail(400, 'Please provide all project details and at least one complete role vacancy.');
        }
    }
    try {
        $projectId = id('PRJ');
        transaction(function (PDO $db) use ($roles, $event, $user, $projectId, $title, $description, $track): void {
            $query = $db->prepare('SELECT event_tag FROM projects WHERE event_tag = ? COLLATE NOCASE ORDER BY created_at LIMIT 1');
            $query->execute([$event]);
            $normalizedEvent = $query->fetchColumn() ?: $event;
            $query = $db->prepare('SELECT project_id FROM project_members WHERE user_id = ? AND LOWER(event_tag) = LOWER(?)');
            $query->execute([$user['id'], $normalizedEvent]);
            if ($query->fetchColumn()) {
                throw new DomainException('You are already registered on a team for this event.');
            }
            $db->prepare('INSERT INTO projects (id, title, description, event_tag, track, leader_id) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$projectId, $title, $description, $normalizedEvent, $track, $user['id']]);
            $db->prepare('INSERT INTO project_members (project_id, user_id, role_title, event_tag) VALUES (?, ?, ?, ?)')
                ->execute([$projectId, $user['id'], 'Team Lead', $normalizedEvent]);
            $insert = $db->prepare('INSERT INTO vacancies (id, project_id, role_title, required_skills) VALUES (?, ?, ?, ?)');
            foreach ($roles as $role) {
                $insert->execute([id('VAC'), $projectId, trim((string)$role['role_title']), trim((string)$role['required_skills'])]);
            }
        });
        respond(201, ['message' => 'Project successfully registered with vacancies.', 'projectId' => $projectId]);
    } catch (DomainException $error) {
        fail(409, $error->getMessage());
    } catch (PDOException $error) {
        if (str_contains(strtolower($error->getMessage()), 'unique')) {
            fail(409, 'You are already registered on a team for this event.');
        }
        rollbackError($error);
    }
}

if (preg_match('~^/api/projects/([^/]+)$~', $originalPath, $match) && $method === 'DELETE') {
    try {
        transaction(function (PDO $db) use ($match, $user): void {
            $query = $db->prepare('SELECT id, leader_id FROM projects WHERE id = ?');
            $query->execute([$match[1]]);
            $project = $query->fetch();
            if (!$project) {
                throw new OutOfBoundsException('Project not found.');
            }
            if ($project['leader_id'] !== $user['id']) {
                throw new DomainException('Only the project lead can delete this project.');
            }
            $db->prepare('DELETE FROM projects WHERE id = ?')->execute([$project['id']]);
        });
        respond(200, ['message' => 'Project and its roles and applications were deleted.', 'projectId' => $match[1]]);
    } catch (OutOfBoundsException $error) {
        fail(404, $error->getMessage());
    } catch (DomainException $error) {
        fail(403, $error->getMessage());
    } catch (Throwable $error) {
        rollbackError($error);
    }
}

if ($path === '/api/applications' && $method === 'POST') {
    $vacancyId = trim((string)($_POST['vacancy_id'] ?? $data['vacancy_id'] ?? ''));
    $pitch = trim((string)($_POST['pitch_note'] ?? $data['pitch_note'] ?? ''));
    $proof = trim((string)($_POST['proof_url'] ?? $data['proof_url'] ?? ''));
    if ($vacancyId === '' || $pitch === '' || strlen($pitch) > 1000) {
        fail(400, 'Provide a role and an introduction of up to 1,000 characters.');
    }
    if ($proof !== '' && !validUrl($proof)) {
        fail(400, 'Resume or portfolio links must use http or https.');
    }
    $resumeName = null;
    $resumeBytes = null;
    if (isset($_FILES['resume']) && $_FILES['resume']['error'] !== UPLOAD_ERR_NO_FILE) {
        $file = $_FILES['resume'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            fail($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE ? 413 : 400,
                $file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE ? 'Resume files must be 5 MB or smaller.' : 'Unable to upload the resume.');
        }
        $resumeBytes = file_get_contents($file['tmp_name']);
        if ($file['size'] > 5 * 1024 * 1024) {
            fail(413, 'Resume files must be 5 MB or smaller.');
        }
        if (strtolower(pathinfo($file['name'], PATHINFO_EXTENSION)) !== 'pdf' || !str_starts_with((string)$resumeBytes, '%PDF-')) {
            fail(400, 'Resume attachments must be PDF files.');
        }
        $resumeName = basename($file['name']);
    }
    try {
        $applicationId = id('APP');
        transaction(function (PDO $db) use ($vacancyId, $pitch, $proof, $resumeName, $resumeBytes, $user, $applicationId): void {
            $query = $db->prepare("SELECT v.id, v.status, p.leader_id, p.event_tag FROM vacancies v JOIN projects p ON p.id = v.project_id WHERE v.id = ?");
            $query->execute([$vacancyId]);
            $vacancy = $query->fetch();
            if (!$vacancy || $vacancy['status'] !== 'Open') {
                throw new OutOfBoundsException('This role is no longer available.');
            }
            if ($vacancy['leader_id'] === $user['id']) {
                throw new DomainException('Project leads cannot apply to their own roles.');
            }
            $query = $db->prepare('SELECT project_id FROM project_members WHERE user_id = ? AND LOWER(event_tag) = LOWER(?)');
            $query->execute([$user['id'], $vacancy['event_tag']]);
            if ($query->fetchColumn()) {
                throw new DomainException('You are already registered on a team for this event.');
            }
            $db->prepare('INSERT INTO applications (id, vacancy_id, applicant_id, pitch_note, proof_url, resume_name, resume_data) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$applicationId, $vacancyId, $user['id'], $pitch, $proof, $resumeName, $resumeBytes]);
        });
        respond(201, ['message' => 'Application submitted.', 'applicationId' => $applicationId]);
    } catch (OutOfBoundsException $error) {
        fail(409, $error->getMessage());
    } catch (DomainException $error) {
        fail(409, $error->getMessage());
    } catch (PDOException $error) {
        if (str_contains(strtolower($error->getMessage()), 'unique')) {
            fail(409, 'You have already applied for this role.');
        }
        rollbackError($error);
    }
}

if ($path === '/api/applications/decision' && $method === 'POST') {
    $applicationId = trim((string)($data['application_id'] ?? ''));
    $decision = $data['decision'] ?? '';
    if ($applicationId === '' || !in_array($decision, ['Accepted', 'Declined'], true)) {
        fail(400, 'Choose a valid application decision.');
    }
    try {
        $message = transaction(function (PDO $db) use ($applicationId, $decision, $user): string {
            $query = $db->prepare("SELECT a.id, a.applicant_id, a.status, a.vacancy_id, v.status AS vacancy_status,
                v.role_title, p.id AS project_id, p.leader_id, p.event_tag FROM applications a
                JOIN vacancies v ON v.id = a.vacancy_id JOIN projects p ON p.id = v.project_id WHERE a.id = ?");
            $query->execute([$applicationId]);
            $application = $query->fetch();
            if (!$application) {
                throw new OutOfBoundsException('Application not found.');
            }
            if ($application['leader_id'] !== $user['id']) {
                throw new RuntimeException('Only the project leader can review this application.');
            }
            if ($application['status'] !== 'Pending') {
                throw new LogicException('This application has already been reviewed.');
            }
            if ($decision === 'Declined') {
                $db->prepare("UPDATE applications SET status = 'Declined' WHERE id = ?")->execute([$applicationId]);
                return 'Application politely declined.';
            }
            if ($application['vacancy_status'] !== 'Open') {
                throw new LogicException('This role slot is no longer open.');
            }
            $query = $db->prepare('SELECT project_id FROM project_members WHERE user_id = ? AND LOWER(event_tag) = LOWER(?)');
            $query->execute([$application['applicant_id'], $application['event_tag']]);
            if ($query->fetchColumn()) {
                throw new LogicException('This student is already registered on a team for this event.');
            }
            $db->prepare('INSERT INTO project_members (project_id, user_id, role_title, vacancy_id, event_tag) VALUES (?, ?, ?, ?, ?)')
                ->execute([$application['project_id'], $application['applicant_id'], $application['role_title'], $application['vacancy_id'], $application['event_tag']]);
            $update = $db->prepare("UPDATE vacancies SET status = 'Filled', assigned_user_id = ? WHERE id = ? AND status = 'Open'");
            $update->execute([$application['applicant_id'], $application['vacancy_id']]);
            if ($update->rowCount() !== 1) {
                throw new LogicException('This role slot is no longer open.');
            }
            $db->prepare("UPDATE applications SET status = 'Accepted' WHERE id = ?")->execute([$applicationId]);
            $db->prepare("UPDATE applications SET status = 'Declined' WHERE vacancy_id = ? AND id != ? AND status = 'Pending'")
                ->execute([$application['vacancy_id'], $applicationId]);
            $db->prepare("UPDATE applications SET status = 'Declined' WHERE applicant_id = ? AND status = 'Pending' AND id != ?
                AND vacancy_id IN (SELECT v.id FROM vacancies v JOIN projects p ON p.id = v.project_id WHERE p.event_tag = ?)")
                ->execute([$application['applicant_id'], $applicationId, $application['event_tag']]);
            return 'Applicant accepted and role slot locked. Other pending applications for this event were declined.';
        });
        respond(200, ['message' => $message]);
    } catch (OutOfBoundsException $error) {
        fail(404, $error->getMessage());
    } catch (RuntimeException $error) {
        fail(403, $error->getMessage());
    } catch (LogicException $error) {
        fail(409, $error->getMessage());
    } catch (PDOException $error) {
        if (str_contains(strtolower($error->getMessage()), 'unique')) {
            fail(409, 'This student is already registered on a team for this event.');
        }
        rollbackError($error);
    }
}

if ($path === '/api/admin/overview' && $method === 'GET') {
    $events = database()->query("SELECT p.event_tag, COUNT(DISTINCT p.id) AS project_count, COUNT(v.id) AS role_count,
        COALESCE(SUM(CASE WHEN v.status = 'Filled' THEN 1 ELSE 0 END), 0) AS filled_count,
        COALESCE(SUM(CASE WHEN v.status = 'Open' THEN 1 ELSE 0 END), 0) AS open_count
        FROM projects p LEFT JOIN vacancies v ON v.project_id = p.id GROUP BY p.event_tag ORDER BY p.event_tag")->fetchAll();
    $projects = database()->query("SELECT p.id, p.event_tag, p.title, p.track, p.created_at, u.name AS leader_name,
        COUNT(v.id) AS role_count, COALESCE(SUM(CASE WHEN v.status = 'Filled' THEN 1 ELSE 0 END), 0) AS filled_count,
        COALESCE(SUM(CASE WHEN v.status = 'Open' THEN 1 ELSE 0 END), 0) AS open_count
        FROM projects p JOIN users u ON u.id = p.leader_id LEFT JOIN vacancies v ON v.project_id = p.id
        GROUP BY p.id ORDER BY p.event_tag, p.created_at DESC")->fetchAll();
    respond(200, ['events' => $events, 'projects' => $projects]);
}

if ($path === '/api/admin/users/reset-password' && $method === 'POST') {
    $universityId = strtoupper(trim((string)($data['university_id'] ?? '')));
    $newPassword = $data['new_password'] ?? null;
    if ($universityId === '' || !is_string($newPassword) || strlen($newPassword) < 10 || strlen($newPassword) > 128) {
        fail(400, 'Enter a University ID and a temporary password between 10 and 128 characters.');
    }
    $query = database()->prepare("UPDATE users SET password_hash = ? WHERE university_id = ? AND role = 'student'");
    $query->execute([hashPassword($newPassword), $universityId]);
    if ($query->rowCount() !== 1) {
        fail(404, 'Student account not found.');
    }
    respond(200, ['message' => 'Temporary password set. Share it securely and ask the student to change it after signing in.']);
}

if ($path === '/api/admin/export-roster' && $method === 'GET') {
    $rows = database()->query("SELECT p.event_tag, p.title AS project_title, p.track,
        lead.name AS team_lead, lead.email AS lead_email, v.role_title,
        COALESCE(member.name, 'UNFILLED') AS member_name, COALESCE(member.email, 'N/A') AS member_email
        FROM projects p JOIN users lead ON p.leader_id = lead.id
        LEFT JOIN vacancies v ON p.id = v.project_id LEFT JOIN users member ON v.assigned_user_id = member.id
        ORDER BY p.event_tag, p.title")->fetchAll();
    $escape = static function (mixed $value): string {
        $text = (string)($value ?? '');
        if (preg_match('/^[\s\xEF\xBB\xBF]*[=+\-@]/', $text)) {
            $text = "'" . $text;
        }
        return '"' . str_replace('"', '""', $text) . '"';
    };
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="campus_project_roster.csv"');
    $out = fopen('php://output', 'wb');
    fputcsv($out, ['Event', 'Project Title', 'Track', 'Team Lead', 'Lead Email', 'Role', 'Member Name', 'Member Email']);
    foreach ($rows as $row) {
        fputs($out, implode(',', array_map($escape, array_values($row))) . "\r\n");
    }
    fclose($out);
    exit;
}

if (str_starts_with($path, '/api/')) {
    fail(404, 'API endpoint not found.');
}

if ($path === '/router.php') {
    http_response_code(404);
    exit;
}

$staticPath = realpath(__DIR__ . DIRECTORY_SEPARATOR . ltrim(parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '', '/'));
if ($staticPath && str_starts_with($staticPath, realpath(__DIR__) . DIRECTORY_SEPARATOR) && is_file($staticPath)) {
    return false;
}

http_response_code(404);
echo 'Not found.';
