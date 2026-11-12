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
    if ((int)$pdo->query('PRAGMA user_version')->fetchColumn() >= 1) {
        return $pdo;
    }
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
    $pdo->exec('PRAGMA user_version = 1');

    return $pdo;
}
