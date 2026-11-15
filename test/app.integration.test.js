const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const workspace = path.resolve(__dirname, '..');
let child;
let baseUrl;
let tempDirectory;

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Synapse exited during startup with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/login.html`);
      if (response.ok) return;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('Synapse did not start in time.');
}

async function request(pathname, { cookie, method = 'GET', body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    redirect: 'manual'
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const setCookie = response.headers.get('set-cookie');
  return {
    status: response.status,
    data,
    text,
    cookie: setCookie ? setCookie.split(';', 1)[0] : cookie
  };
}

async function register(universityId, email) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: universityId,
      email,
      university_id: universityId,
      password: 'valid-test-password'
    }
  });
  assert.equal(result.status, 201, result.text);
  assert.ok(result.cookie, 'registration should establish a signed-in session');
  return { cookie: result.cookie, user: result.data.user };
}

before(async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-integration-'));
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn('php', [
    '-d', 'upload_max_filesize=6M',
    '-d', 'post_max_size=8M',
    '-S', `127.0.0.1:${port}`,
    '-t', 'public',
    'public/router.php'
  ], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      SYNAPSE_DB_PATH: path.join(tempDirectory, 'synapse-test.db'),
      SYNAPSE_DEMO_PASSWORD: 'synapse-demo-test-password',
      ADMIN_UNIVERSITY_ID: 'ADMIN-TEST',
      ADMIN_PASSWORD: 'admin-test-password'
    },
    stdio: 'ignore'
  });
  await waitForServer();
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
  if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
});

test('accounts, matching, access controls, team locking, and roster export work end to end', async () => {
  const publicStats = await request('/api/public-stats');
  assert.equal(publicStats.status, 200, 'campus activity stats should be available without signing in');
  assert.equal(publicStats.data.active_project_count, 3);
  assert.equal(publicStats.data.open_vacancy_count, 4);
  const demoLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { university_id: 'DEMO-STU-1001', password: 'synapse-demo-test-password' }
  });
  assert.equal(demoLogin.status, 200, 'seeded student passwords should use the existing authentication format');

  const unauthenticatedAdminPage = await request('/admin.html');
  assert.equal(unauthenticatedAdminPage.status, 302, 'faculty pages should redirect unauthenticated visitors');

  const mixedCaseUnauthenticatedExport = await request('/API/admin/export-roster');
  assert.equal(mixedCaseUnauthenticatedExport.status, 401, `case variations of admin routes must still require authentication: ${mixedCaseUnauthenticatedExport.text}`);

  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { university_id: 'UNKNOWN', password: 'wrong-password' }
  });
  assert.equal(badLogin.status, 401, 'unknown account should not authenticate');

  const leader = await register('LEAD-1', 'lead@campus.example');
  const applicant = await register('STUDENT-1', 'student@campus.example');
  const competingApplicant = await register('STUDENT-2', 'student2@campus.example');
  const identity = await request('/api/me', { cookie: applicant.cookie });
  assert.equal(identity.status, 200);
  assert.equal(identity.data.email, 'student@campus.example', 'registered account details should persist');
  const studentAdminPage = await request('/admin.html', { cookie: applicant.cookie });
  assert.equal(studentAdminPage.status, 403, 'students must not open the faculty page');

  const wrongPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { university_id: 'LEAD-1', password: 'incorrect-password' }
  });
  assert.equal(wrongPassword.status, 401, 'incorrect password should not authenticate');

  const correctPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { university_id: 'LEAD-1', password: 'valid-test-password' }
  });
  assert.equal(correctPassword.status, 200, 'correct username and password should authenticate');
  const passwordChange = await request('/api/password', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { current_password: 'valid-test-password', new_password: 'updated-test-password' }
  });
  assert.equal(passwordChange.status, 200, 'users should be able to change their password');
  const oldPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { university_id: 'STUDENT-1', password: 'valid-test-password' }
  });
  assert.equal(oldPasswordLogin.status, 401, 'the previous password should stop working after a change');
  const newPasswordLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { university_id: 'STUDENT-1', password: 'updated-test-password' }
  });
  assert.equal(newPasswordLogin.status, 200, 'the new password should authenticate');
  const updatedProfile = await request('/api/profile', {
    method: 'POST',
    cookie: applicant.cookie,
    body: {
      name: 'STUDENT-1',
      email: 'student@campus.example',
      skills: 'HTML, CSS, JavaScript',
      github_url: 'https://github.com/student',
      department: 'Computer Science',
      year_of_study: '3rd year',
      bio: 'Interested in accessible campus software.'
    }
  });
  assert.equal(updatedProfile.status, 200, updatedProfile.text);
  const persistedProfile = await request('/api/me', { cookie: applicant.cookie });
  assert.equal(persistedProfile.data.university_id, 'STUDENT-1');
  assert.equal(persistedProfile.data.department, 'Computer Science');
  assert.equal(persistedProfile.data.year_of_study, '3rd year');
  assert.equal(persistedProfile.data.bio, 'Interested in accessible campus software.');
  const unsafeProfileLink = await request('/api/profile', {
    method: 'POST',
    cookie: applicant.cookie,
    body: {
      name: 'STUDENT-1',
      email: 'student@campus.example',
      skills: 'HTML',
      github_url: 'javascript:alert(1)'
    }
  });
  assert.equal(unsafeProfileLink.status, 400, 'profile portfolio links must use http or https');

  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Duplicate',
      email: 'another@campus.example',
      university_id: 'LEAD-1',
      password: 'valid-test-password'
    }
  });
  assert.equal(duplicate.status, 409, 'duplicate university IDs should be rejected');

  const project = await request('/api/projects', {
    method: 'POST',
    cookie: leader.cookie,
    body: {
      title: '<img src=x onerror=alert(1)> Matchmaker',
      description: 'A project description controlled by a student.',
      event_tag: 'web tech test',
      track: 'Growth',
      roles: [{ role_title: 'Frontend Engineer', required_skills: 'HTML, CSS, JavaScript' }]
    }
  });
  assert.equal(project.status, 201, project.text);

  const projects = await request('/api/projects?event_tag=web%20tech%20test', { cookie: applicant.cookie });
  assert.equal(projects.status, 200);
  assert.equal(projects.data.length, 1);
  assert.equal(projects.data[0].leader_email, undefined, 'team contact must stay private before acceptance');
  const vacancyId = projects.data[0].vacancies[0].id;
  const oneSentencePitch = await request('/api/applications', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { vacancy_id: vacancyId, pitch_note: 'I build useful things.' }
  });
  assert.equal(oneSentencePitch.status, 400, 'introductions must contain exactly two sentences');

  const projectDetails = await request(`/api/projects/${project.data.projectId}`, { cookie: applicant.cookie });
  assert.equal(projectDetails.data.project.leader_email, null, 'non-members must not see team contact details');

  const invalidPitch = await request('/api/applications', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { vacancy_id: vacancyId, pitch_note: '' }
  });
  assert.equal(invalidPitch.status, 400, 'applications must include an introduction');

  const invalidProof = await request('/api/applications', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { vacancy_id: vacancyId, pitch_note: 'I build useful things. I can help this team.', proof_url: 'javascript:alert(1)' }
  });
  assert.equal(invalidProof.status, 400, 'proof links must use http or https');
  const invalidResumeForm = new FormData();
  invalidResumeForm.set('vacancy_id', vacancyId);
  invalidResumeForm.set('pitch_note', 'I can help with frontend work.');
  invalidResumeForm.set('resume', new Blob(['not a PDF'], { type: 'text/plain' }), 'resume.txt');
  const invalidResume = await request('/api/applications', {
    method: 'POST',
    cookie: applicant.cookie,
    body: invalidResumeForm
  });
  assert.equal(invalidResume.status, 400, 'non-PDF resume attachments must be rejected');

  const pitch = 'I have built responsive interfaces with accessible CSS and semantic HTML. I can help deliver this project and learn from the team.';
  const application = await request('/api/applications', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { vacancy_id: vacancyId, pitch_note: pitch }
  });
  assert.equal(application.status, 201, application.text);

  const resumeForm = new FormData();
  resumeForm.set('vacancy_id', vacancyId);
  resumeForm.set('pitch_note', pitch);
  resumeForm.set('resume', new Blob(['%PDF-1.7\nsample resume'], { type: 'application/pdf' }), 'student-resume.pdf');
  const competingApplication = await request('/api/applications', {
    method: 'POST',
    cookie: competingApplicant.cookie,
    body: resumeForm
  });
  assert.equal(competingApplication.status, 201, competingApplication.text);

  const leaderDetails = await request(`/api/projects/${project.data.projectId}`, { cookie: leader.cookie });
  const applicationId = leaderDetails.data.applications.find(item => item.applicant_name === 'STUDENT-1').id;
  const resumeApplicationId = leaderDetails.data.applications.find(item => item.applicant_name === 'STUDENT-2').id;
  assert.equal(leaderDetails.data.applications.find(item => item.applicant_name === 'STUDENT-2').has_resume, 1);
  assert.equal(Object.hasOwn(leaderDetails.data.applications[0], 'resume_data'), false, 'resume bytes must not leak in project JSON');
  const resumeDownload = await request(`/api/applications/${resumeApplicationId}/resume`, { cookie: leader.cookie });
  assert.equal(resumeDownload.status, 200);
  assert.match(resumeDownload.text, /^%PDF-/);
  const privateResume = await request(`/api/applications/${resumeApplicationId}/resume`, { cookie: applicant.cookie });
  assert.equal(privateResume.status, 403, 'other applicants must not be able to download a resume');
  const applicantActivity = await request('/api/me/activity', { cookie: applicant.cookie });
  assert.equal(applicantActivity.status, 200);
  assert.equal(applicantActivity.data.applications.length, 1);
  assert.equal(applicantActivity.data.applications[0].status, 'Pending');
  assert.equal(applicantActivity.data.applications[0].has_resume, 0);
  const leaderActivity = await request('/api/me/activity', { cookie: leader.cookie });
  assert.equal(leaderActivity.data.projects.length, 1);
  assert.equal(leaderActivity.data.projects[0].pending_count, 2);
  const forbiddenDecision = await request('/api/applications/decision', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { application_id: applicationId, decision: 'Accepted' }
  });
  assert.equal(forbiddenDecision.status, 403, 'only a project leader can make a decision');

  const decision = await request('/api/applications/decision', {
    method: 'POST',
    cookie: leader.cookie,
    body: { application_id: applicationId, decision: 'Accepted' }
  });
  assert.equal(decision.status, 200, decision.text);

  const acceptedDetails = await request(`/api/projects/${project.data.projectId}`, { cookie: applicant.cookie });
  assert.equal(acceptedDetails.data.project.leader_email, 'lead@campus.example');
  assert.equal(acceptedDetails.data.is_member, true);
  const completedDiscovery = await request('/api/projects?include_completed=1', { cookie: applicant.cookie });
  assert.ok(completedDiscovery.data.some(item => item.id === project.data.projectId),
    'the all-projects filter should include a fully staffed team');
  const updatedApplicantActivity = await request('/api/me/activity', { cookie: applicant.cookie });
  assert.equal(updatedApplicantActivity.data.applications[0].status, 'Accepted');
  assert.equal(updatedApplicantActivity.data.applications[0].pitch_note, pitch);
  assert.equal(updatedApplicantActivity.data.teams.some(team => team.project_id === project.data.projectId), true);
  const fullApplicantProfile = await request('/api/me', { cookie: applicant.cookie });
  assert.equal(fullApplicantProfile.data.applications[0].project_title, '<img src=x onerror=alert(1)> Matchmaker');
  assert.equal(fullApplicantProfile.data.active_teams[0].role_title, 'Frontend Engineer');
  const reviewedDetails = await request(`/api/projects/${project.data.projectId}`, { cookie: leader.cookie });
  assert.equal(reviewedDetails.data.applications.find(item => item.applicant_name === 'STUDENT-1').applicant_email, 'student@campus.example');
  assert.equal(reviewedDetails.data.applications.find(item => item.applicant_name === 'STUDENT-2').status, 'Declined');
  const staleDecision = await request('/api/applications/decision', {
    method: 'POST',
    cookie: leader.cookie,
    body: {
      application_id: reviewedDetails.data.applications.find(item => item.applicant_name === 'STUDENT-2').id,
      decision: 'Accepted'
    }
  });
  assert.equal(staleDecision.status, 409, 'an already-declined application cannot be accepted');

  const secondTeam = await request('/api/projects', {
    method: 'POST',
    cookie: applicant.cookie,
    body: {
      title: 'Second team',
      description: 'This should be rejected for the same event.',
      event_tag: 'Web Tech Test',
      track: 'Growth',
      roles: [{ role_title: 'Developer', required_skills: 'JavaScript' }]
    }
  });
  assert.equal(secondTeam.status, 409, 'a student may only join one team per event');

  const formulaProject = await request('/api/projects', {
    method: 'POST',
    cookie: leader.cookie,
    body: {
      title: '=HYPERLINK("https://example.com","click")',
      description: 'Roster cells must not execute as formulas.',
      event_tag: 'Hackathon Test',
      track: 'Competitive',
      roles: [{ role_title: 'Security', required_skills: 'Threat modeling' }]
    }
  });
  assert.equal(formulaProject.status, 201, formulaProject.text);
  const abbreviationProject = await request('/api/projects?event_tag=Hackathon%20Test', { cookie: applicant.cookie });
  const abbreviationPitch = await request('/api/applications', {
    method: 'POST',
    cookie: applicant.cookie,
    body: {
      vacancy_id: abbreviationProject.data.find(item => item.id === formulaProject.data.projectId).vacancies[0].id,
      pitch_note: 'I use e.g. Node.js, Next.js, and Vue.js, i.e. modern tools. Dr. Smith, Mr. Lee, and Ms. Ray can advise.'
    }
  });
  assert.equal(abbreviationPitch.status, 201, `abbreviations should not inflate the sentence count: ${abbreviationPitch.text}`);

  const studentAdminOverview = await request('/api/admin/overview', { cookie: applicant.cookie });
  assert.equal(studentAdminOverview.status, 403, 'students must not access the faculty dashboard');
  const mixedCaseStudentAdminOverview = await request('/API/admin/overview', { cookie: applicant.cookie });
  assert.equal(mixedCaseStudentAdminOverview.status, 403, 'case variations of admin routes must still enforce authorization');

  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { university_id: 'ADMIN-TEST', password: 'admin-test-password' }
  });
  assert.equal(adminLogin.status, 200);
  const adminOverview = await request('/api/admin/overview', { cookie: adminLogin.cookie });
  assert.equal(adminOverview.status, 200);
  assert.equal(adminOverview.data.events.length, 5);
  assert.equal(adminOverview.data.summary.total_projects, 5);
  assert.ok(adminOverview.data.students.some(item => item.university_id === 'DEMO-STU-1001'));
  assert.equal(adminOverview.data.students.find(item => item.university_id === 'DEMO-STU-1004').assignment_status, 'Unassigned');
  assert.equal(adminOverview.data.projects.find(item => item.id === 'PRJ-DEMO-WEB').members.length, 2);
  assert.equal(adminOverview.data.students.find(item => item.university_id === 'STUDENT-1').department, 'Computer Science');
  assert.ok(adminOverview.data.projects.find(item => item.id === project.data.projectId).applications.length >= 2);
  assert.equal(adminOverview.data.projects.find(item => item.id === project.data.projectId).vacancies[0].status, 'Filled');
  const forbiddenReset = await request('/api/admin/users/reset-password', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { university_id: 'STUDENT-2', new_password: 'temporary-password' }
  });
  assert.equal(forbiddenReset.status, 403, 'students must not reset other users passwords');
  const legacyAccountReset = await request('/api/admin/users/reset-password', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { university_id: 'STUDENT-2', new_password: 'temporary-password' }
  });
  assert.equal(legacyAccountReset.status, 200, 'admins should be able to set a temporary student password');
  const resetLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { university_id: 'STUDENT-2', password: 'temporary-password' }
  });
  assert.equal(resetLogin.status, 200, 'the temporary password should enable account recovery');
  const staffedProject = adminOverview.data.projects.find(item => item.id === project.data.projectId);
  assert.equal(staffedProject.filled_count, 1);
  assert.equal(staffedProject.open_count, 0, 'faculty overview should identify fully staffed projects');
  const openProject = adminOverview.data.projects.find(item => item.id === formulaProject.data.projectId);
  assert.equal(openProject.open_count, 1);
  const forbiddenStatusChange = await request('/api/admin/projects/status', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { project_id: formulaProject.data.projectId, status: 'Completed' }
  });
  assert.equal(forbiddenStatusChange.status, 403, 'students must not change project status');
  const projectStatusChange = await request('/api/admin/projects/status', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { project_id: formulaProject.data.projectId, status: 'Completed' }
  });
  assert.equal(projectStatusChange.status, 200, projectStatusChange.text);
  const completedProjectOverview = await request('/api/admin/overview', { cookie: adminLogin.cookie });
  assert.equal(completedProjectOverview.data.projects.find(item => item.id === formulaProject.data.projectId).status, 'Completed');
  const reopenProject = await request('/api/admin/projects/status', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { project_id: formulaProject.data.projectId, status: 'Open' }
  });
  assert.equal(reopenProject.status, 200);
  const discoverableProjects = await request('/api/projects', { cookie: applicant.cookie });
  assert.equal(discoverableProjects.data.some(item => item.id === project.data.projectId), false,
    'fully staffed projects should be hidden from the open-project discovery feed');

  const roster = await request('/api/admin/export-roster', { cookie: adminLogin.cookie });
  assert.equal(roster.status, 200);
  assert.match(roster.text, /"'=HYPERLINK\(/, 'formula-leading values should be escaped before CSV export');
  const unassignedExport = await request('/api/admin/export-unassigned', { cookie: adminLogin.cookie });
  assert.equal(unassignedExport.status, 200);
  assert.match(unassignedExport.text, /Mira Iyer/);
  assert.match(unassignedExport.text, /DEMO-STU-1004/);
  const studentsExport = await request('/api/admin/export-students', { cookie: adminLogin.cookie });
  assert.equal(studentsExport.status, 200);
  assert.match(studentsExport.text, /Computer Science/);
  assert.match(studentsExport.text, /STUDENT-1/);

  const removeMemberVacancyId = leaderDetails.data.vacancies[0].id;
  const forbiddenMemberRemoval = await request('/api/admin/members/remove', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { vacancy_id: removeMemberVacancyId }
  });
  assert.equal(forbiddenMemberRemoval.status, 403, 'students must not moderate team members');
  const memberRemoval = await request('/api/admin/members/remove', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { vacancy_id: removeMemberVacancyId }
  });
  assert.equal(memberRemoval.status, 200, memberRemoval.text);
  const overviewAfterRemoval = await request('/api/admin/overview', { cookie: adminLogin.cookie });
  const reopenedProject = overviewAfterRemoval.data.projects.find(item => item.id === project.data.projectId);
  assert.equal(reopenedProject.completion_status, 'Recruiting');
  assert.equal(reopenedProject.open_count, 1, 'removing a member should reopen their slot');

  const deletableProject = await request('/api/projects', {
    method: 'POST',
    cookie: leader.cookie,
    body: {
      title: 'Project scheduled for deletion',
      description: 'Deleting this project should remove its dependent applications.',
      event_tag: 'Project Deletion Test',
      track: 'Growth',
      roles: [{ role_title: 'Tester', required_skills: 'Testing' }]
    }
  });
  assert.equal(deletableProject.status, 201, deletableProject.text);
  const deletableRole = (await request('/api/projects', { cookie: applicant.cookie }))
    .data.find(item => item.id === deletableProject.data.projectId).vacancies[0].id;
  const pendingForDeletedProject = await request('/api/applications', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { vacancy_id: deletableRole, pitch_note: 'I can test the project carefully. I communicate defects clearly.' }
  });
  assert.equal(pendingForDeletedProject.status, 201, pendingForDeletedProject.text);
  const forbiddenProjectDeletion = await request(`/api/projects/${deletableProject.data.projectId}`, {
    method: 'DELETE',
    cookie: applicant.cookie
  });
  assert.equal(forbiddenProjectDeletion.status, 403, 'only a project leader can delete a project');
  const unauthenticatedProjectDeletion = await request(`/api/projects/${deletableProject.data.projectId}`, {
    method: 'DELETE'
  });
  assert.equal(unauthenticatedProjectDeletion.status, 401, 'project deletion requires authentication');
  const projectDeletion = await request(`/api/projects/${deletableProject.data.projectId}`, {
    method: 'DELETE',
    cookie: leader.cookie
  });
  assert.equal(projectDeletion.status, 200, projectDeletion.text);
  const deletedProjectDetails = await request(`/api/projects/${deletableProject.data.projectId}`, {
    cookie: applicant.cookie
  });
  assert.equal(deletedProjectDetails.status, 404);
  const activityAfterDeletion = await request('/api/me/activity', { cookie: applicant.cookie });
  assert.equal(activityAfterDeletion.data.applications.some(item => item.project_id === deletableProject.data.projectId), false,
    'project deletion should cascade to its applications');
  const replacementProject = await request('/api/projects', {
    method: 'POST',
    cookie: leader.cookie,
    body: {
      title: 'Replacement project after cleanup',
      description: 'The deleted project released the lead membership for this event.',
      event_tag: 'Project Deletion Test',
      track: 'Growth',
      roles: [{ role_title: 'Reviewer', required_skills: 'Code review' }]
    }
  });
  assert.equal(replacementProject.status, 201, 'project deletion should cascade to the team lead membership');
  const forbiddenModerationDelete = await request('/api/admin/projects/delete', {
    method: 'POST',
    cookie: applicant.cookie,
    body: { project_id: replacementProject.data.projectId }
  });
  assert.equal(forbiddenModerationDelete.status, 403, 'students must not delete projects through admin moderation');
  const moderationDelete = await request('/api/admin/projects/delete', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { project_id: replacementProject.data.projectId }
  });
  assert.equal(moderationDelete.status, 200, moderationDelete.text);
  const deletedByAdmin = await request('/api/admin/overview', { cookie: adminLogin.cookie });
  assert.equal(deletedByAdmin.data.projects.some(item => item.id === replacementProject.data.projectId), false);

  const spamAccount = await register('SPAM-TEST', 'spam@campus.example');
  const forbiddenAdminDeletion = await request('/api/admin/users/delete', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { user_id: adminLogin.data.user.id }
  });
  assert.equal(forbiddenAdminDeletion.status, 403, 'administrator accounts cannot be deleted from student management');
  const studentDeletion = await request('/api/admin/users/delete', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: { user_id: spamAccount.user.id }
  });
  assert.equal(studentDeletion.status, 200, studentDeletion.text);
  const overviewAfterStudentDeletion = await request('/api/admin/overview', { cookie: adminLogin.cookie });
  assert.equal(overviewAfterStudentDeletion.data.students.some(item => item.id === spamAccount.user.id), false);

  const logout = await request('/api/auth/logout', { method: 'POST', cookie: correctPassword.cookie });
  assert.equal(logout.status, 200);
  const afterLogout = await request('/api/me', { cookie: correctPassword.cookie });
  assert.equal(afterLogout.status, 401, 'signing out should invalidate the old session');
});

test('database initialization upgrades a legacy schema without losing accounts', () => {
  const legacyPath = path.join(tempDirectory, 'legacy-schema.db');
  const env = { ...process.env, SYNAPSE_DB_PATH: legacyPath };
  const createLegacy = spawnSync('php', ['-r', `
    $db = new PDO('sqlite:' . getenv('SYNAPSE_DB_PATH'));
    $db->exec("CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      skills TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'student',
      university_id TEXT, password_hash TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    $db->exec("INSERT INTO users (id, name, email, university_id) VALUES ('legacy-1', 'Legacy Student', 'legacy@campus.example', 'LEGACY-1')");
  `], { cwd: workspace, env, encoding: 'utf8' });
  assert.equal(createLegacy.status, 0, createLegacy.stderr);

  const migrate = spawnSync('php', ['-r', `
    require 'database.php';
    $db = database();
    $user = $db->query("SELECT id, name, department, year_of_study, bio FROM users WHERE id = 'legacy-1'")->fetch();
    echo json_encode([
      'user' => $user,
      'foreign_keys' => $db->query('PRAGMA foreign_keys')->fetchColumn(),
      'journal_mode' => $db->query('PRAGMA journal_mode')->fetchColumn(),
      'synchronous' => $db->query('PRAGMA synchronous')->fetchColumn()
    ]);
  `], { cwd: workspace, env, encoding: 'utf8' });
  assert.equal(migrate.status, 0, migrate.stderr);
  const result = JSON.parse(migrate.stdout);
  assert.equal(result.user.id, 'legacy-1');
  assert.equal(result.user.name, 'Legacy Student');
  assert.equal(result.user.department, '');
  assert.equal(result.user.year_of_study, '');
  assert.equal(result.user.bio, '');
  assert.equal(Number(result.foreign_keys), 1);
  assert.equal(result.journal_mode.toLowerCase(), 'wal');
  assert.equal(Number(result.synchronous), 2);
});
