<?php
declare(strict_types=1);

function database(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $path = getenv('SYNAPSE_DB_PATH') ?: __DIR__ . DIRECTORY_SEPARATOR . 'synapse.db';
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
        skills TEXT NOT NULL DEFAULT '', github_url TEXT,
        role TEXT NOT NULL DEFAULT 'student', university_id TEXT,
        password_hash TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    $userColumns = array_column($pdo->query('PRAGMA table_info(users)')->fetchAll(), 'name');
    foreach ([
        'role' => "TEXT NOT NULL DEFAULT 'student'",
        'university_id' => 'TEXT',
        'password_hash' => 'TEXT',
        'skills' => "TEXT NOT NULL DEFAULT ''",
        'github_url' => 'TEXT',
    ] as $column => $definition) {
        if (!in_array($column, $userColumns, true)) {
            $pdo->exec("ALTER TABLE users ADD COLUMN $column $definition");
        }
    }
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS users_university_id_unique ON users (university_id) WHERE university_id IS NOT NULL');
    $pdo->exec("CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        event_tag TEXT NOT NULL, track TEXT CHECK(track IN ('Competitive', 'Growth')) NOT NULL,
        leader_id TEXT NOT NULL, status TEXT DEFAULT 'Open', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (leader_id) REFERENCES users (id)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS vacancies (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, role_title TEXT NOT NULL,
        required_skills TEXT NOT NULL, status TEXT DEFAULT 'Open' CHECK(status IN ('Open', 'Filled')),
        assigned_user_id TEXT, FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_user_id) REFERENCES users (id)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY, vacancy_id TEXT NOT NULL, applicant_id TEXT NOT NULL,
        pitch_note TEXT NOT NULL, proof_url TEXT NOT NULL, status TEXT DEFAULT 'Pending'
        CHECK(status IN ('Pending', 'Accepted', 'Declined')), created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vacancy_id) REFERENCES vacancies (id) ON DELETE CASCADE,
        FOREIGN KEY (applicant_id) REFERENCES users (id), UNIQUE(vacancy_id, applicant_id)
    )");
    $applicationColumns = array_column($pdo->query('PRAGMA table_info(applications)')->fetchAll(), 'name');
    foreach (['resume_name' => 'TEXT', 'resume_data' => 'BLOB'] as $column => $definition) {
        if (!in_array($column, $applicationColumns, true)) {
            $pdo->exec("ALTER TABLE applications ADD COLUMN $column $definition");
        }
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS project_members (
        project_id TEXT NOT NULL, user_id TEXT NOT NULL, role_title TEXT NOT NULL,
        vacancy_id TEXT UNIQUE, event_tag TEXT NOT NULL, assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (project_id, user_id), UNIQUE (user_id, event_tag),
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (vacancy_id) REFERENCES vacancies (id) ON DELETE CASCADE
    )");
    $pdo->exec("INSERT OR IGNORE INTO project_members (project_id, user_id, role_title, event_tag)
        SELECT id, leader_id, 'Team Lead', event_tag FROM projects ORDER BY created_at");
    $pdo->exec("INSERT OR IGNORE INTO project_members (project_id, user_id, role_title, vacancy_id, event_tag)
        SELECT p.id, v.assigned_user_id, v.role_title, v.id, p.event_tag
        FROM vacancies v JOIN projects p ON p.id = v.project_id WHERE v.assigned_user_id IS NOT NULL");

    $projectCount = $pdo->prepare('SELECT COUNT(*) FROM projects');
    $projectCount->execute();
    if ((int)$projectCount->fetchColumn() === 0) {
        $demoPassword = getenv('SYNAPSE_DEMO_PASSWORD');
        if (!is_string($demoPassword) || $demoPassword === '') {
            $demoPassword = bin2hex(random_bytes(32));
        }
        $demoAccounts = [
            ['Aarav Mehta', 'aarav.mehta@campus.example', 'DEMO-STU-1001', 'Frontend development, accessibility, CSS'],
            ['Diya Nair', 'diya.nair@campus.example', 'DEMO-STU-1002', 'Python, data science, machine learning'],
            ['Kabir Shah', 'kabir.shah@campus.example', 'DEMO-STU-1003', 'JavaScript, Node.js, APIs'],
            ['Mira Iyer', 'mira.iyer@campus.example', 'DEMO-STU-1004', 'UI/UX, Figma, user research'],
        ];
        $projectIds = ['PRJ-DEMO-WEB', 'PRJ-DEMO-SIH', 'PRJ-DEMO-IDEA'];
        $accountIds = [];
        $pdo->beginTransaction();
        try {
            $insertUser = $pdo->prepare("INSERT OR IGNORE INTO users (id, name, email, skills, role, university_id, password_hash)
                VALUES (?, ?, ?, ?, 'student', ?, ?)");
            $findUser = $pdo->prepare('SELECT id FROM users WHERE university_id = ?');
            foreach ($demoAccounts as [$name, $email, $universityId, $skills]) {
                $insertUser->execute([
                    'USR-' . strtoupper(bin2hex(random_bytes(6))),
                    $name,
                    $email,
                    $skills,
                    $universityId,
                    password_hash(hash('sha256', $demoPassword), PASSWORD_DEFAULT),
                ]);
                $findUser->execute([$universityId]);
                $accountId = $findUser->fetchColumn();
                if (!is_string($accountId)) {
                    throw new RuntimeException('Unable to create the demo student accounts.');
                }
                $accountIds[] = $accountId;
            }

            $projects = [
                [$projectIds[0], 'Campus Collaboration Hub', 'A responsive space for students to discover collaborators and organize course work.', 'Web Tech Course Project', 'Growth', $accountIds[0]],
                [$projectIds[1], 'Smart Campus Navigation', 'A mobile-first campus navigation prototype with accessible route and venue information.', 'SIH Hackathon 2026', 'Competitive', $accountIds[1]],
                [$projectIds[2], 'Reuse & Share Campus', 'A student-led idea for sharing books, lab supplies, and reusable campus resources.', 'Campus Ideathon', 'Growth', $accountIds[2]],
            ];
            $insertProject = $pdo->prepare('INSERT INTO projects (id, title, description, event_tag, track, leader_id) VALUES (?, ?, ?, ?, ?, ?)');
            $insertMember = $pdo->prepare("INSERT INTO project_members (project_id, user_id, role_title, event_tag)
                VALUES (?, ?, 'Team Lead', ?)");
            foreach ($projects as [$projectId, $title, $description, $eventTag, $track, $leaderId]) {
                $insertProject->execute([$projectId, $title, $description, $eventTag, $track, $leaderId]);
                $insertMember->execute([$projectId, $leaderId, $eventTag]);
            }

            $roles = [
                ['VAC-DEMO-WEB-1', $projectIds[0], 'Frontend Engineer', 'HTML, CSS, JavaScript', 'Filled', $accountIds[1]],
                ['VAC-DEMO-WEB-2', $projectIds[0], 'Backend Developer', 'PHP, SQLite, REST APIs', 'Open', null],
                ['VAC-DEMO-SIH-1', $projectIds[1], 'Mobile App Developer', 'Flutter or React Native, API integration', 'Open', null],
                ['VAC-DEMO-SIH-2', $projectIds[1], 'Accessibility Researcher', 'Inclusive design, usability testing', 'Open', null],
                ['VAC-DEMO-IDEA-1', $projectIds[2], 'Product Designer', 'Figma, prototyping, user research', 'Open', null],
            ];
            $insertVacancy = $pdo->prepare('INSERT INTO vacancies (id, project_id, role_title, required_skills, status, assigned_user_id) VALUES (?, ?, ?, ?, ?, ?)');
            $insertAssignedMember = $pdo->prepare('INSERT INTO project_members (project_id, user_id, role_title, vacancy_id, event_tag) VALUES (?, ?, ?, ?, ?)');
            foreach ($roles as [$vacancyId, $projectId, $roleTitle, $skills, $status, $assignedUserId]) {
                $insertVacancy->execute([$vacancyId, $projectId, $roleTitle, $skills, $status, $assignedUserId]);
                if ($assignedUserId !== null) {
                    $eventTag = array_values(array_filter($projects, static fn(array $project): bool => $project[0] === $projectId))[0][3];
                    $insertAssignedMember->execute([$projectId, $assignedUserId, $roleTitle, $vacancyId, $eventTag]);
                }
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }
    $pdo->exec('PRAGMA user_version = 1');

    return $pdo;
}
