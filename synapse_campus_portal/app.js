/* =========================================================
   SYNAPSE APPLICATION CONTROLLER & THREE.JS NEURAL CANVAS
   ========================================================= */
let state = SynapseVault.load();
let currentUser = null;

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

/* ---------------- THEME SWITCHER ---------------- */
const themeToggle = document.getElementById('themeToggle');
themeToggle.addEventListener('click', () => {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  document.getElementById('themeIcon').textContent = next === 'dark' ? '☀' : '☾';
  document.getElementById('themeLabel').textContent = next === 'dark' ? 'Metallic Light' : 'Abyssal Dark';
  updateNeuralColors(next);
});

/* ---------------- AUTHENTICATION ---------------- */
function switchAuthTab(tab) {
  const isSign = tab === 'signin';
  document.getElementById('tabSignIn').classList.toggle('active', isSign);
  document.getElementById('tabRegister').classList.toggle('active', !isSign);
  document.getElementById('signInForm').classList.toggle('hidden', !isSign);
  document.getElementById('registerForm').classList.toggle('hidden', isSign);
}

function fillDemoStudent() {
  switchAuthTab('signin');
  document.getElementById('loginIdentifier').value = '20251CSE0028';
  document.getElementById('loginPassword').value = 'student123';
}

function fillDemoAdmin() {
  switchAuthTab('signin');
  document.getElementById('loginIdentifier').value = 'ADMIN-PU-01';
  document.getElementById('loginPassword').value = 'admin123';
}

function handleSignIn(e) {
  e.preventDefault();
  const idVal = document.getElementById('loginIdentifier').value.trim().toLowerCase();
  const passVal = document.getElementById('loginPassword').value;

  const user = state.users.find(
    u =>
      (u.roll.toLowerCase() === idVal || u.email.toLowerCase() === idVal) &&
      u.password === passVal
  );

  if (!user) {
    showToast('Invalid University Credentials. Check Roll/Email or Password.');
    return;
  }

  currentUser = user;
  document.getElementById('authView').classList.add('hidden');

  if (user.role === 'admin') {
    document.getElementById('adminPortal').classList.remove('hidden');
    document.getElementById('navAdminName').textContent = user.name;
    renderAdminAll();
    showToast('Authenticated as Faculty Administrator');
  } else {
    document.getElementById('studentPortal').classList.remove('hidden');
    renderStudentAll();
    showToast(`Welcome back, ${user.name}`);
  }
}

function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const roll = document.getElementById('regRoll').value.trim().toUpperCase();
  const dept = document.getElementById('regDept').value;
  const year = document.getElementById('regYear').value;
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const skills = document
    .getElementById('regSkills')
    .value.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const password = document.getElementById('regPassword').value;

  if (state.users.some(u => u.roll === roll || u.email === email)) {
    showToast('An account with this Roll Number or Email already exists.');
    return;
  }

  const newUser = {
    id: roll,
    name,
    roll,
    email,
    password,
    role: 'student',
    dept,
    year,
    verified: false,
    skills,
    bio: 'Presidency University student eager to collaborate on hackathons and real-world software/hardware builds.',
    github: 'https://github.com',
    linkedin: 'https://linkedin.com'
  };

  state.users.push(newUser);
  SynapseVault.save(state);
  currentUser = newUser;

  document.getElementById('authView').classList.add('hidden');
  document.getElementById('studentPortal').classList.remove('hidden');
  renderStudentAll();
  showToast('Student account created & synced to Synapse Vault!');
}

function signOut() {
  currentUser = null;
  document.getElementById('studentPortal').classList.add('hidden');
  document.getElementById('adminPortal').classList.add('hidden');
  document.getElementById('authView').classList.remove('hidden');
  showToast('Signed out securely');
}

/* ---------------- STUDENT PORTAL ---------------- */
function switchStudentTab(tabName) {
  document.querySelectorAll('#studentPortal .nav-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.student-section').forEach(sec => sec.classList.add('hidden'));
  document.getElementById(`studentTab-${tabName}`).classList.remove('hidden');
}

function renderStudentAll() {
  if (!currentUser) return;
  document.getElementById('navStudentName').textContent = currentUser.name;
  document.getElementById('navStudentSub').textContent = `${currentUser.roll} • STUDENT`;
  document.getElementById('welcomeHeading').textContent = `Welcome back, ${currentUser.name.split(' ')[0]}`;
  document.getElementById('welcomeSub').textContent = `${currentUser.dept} • ${currentUser.year} • ${currentUser.roll}`;

  document.getElementById('profName').value = currentUser.name;
  document.getElementById('profYear').value = currentUser.year;
  document.getElementById('profBio').value = currentUser.bio || '';
  document.getElementById('profSkills').value = (currentUser.skills || []).join(', ');
  document.getElementById('profGithub').value = currentUser.github || '';
  document.getElementById('profLinkedin').value = currentUser.linkedin || '';

  const badge = document.getElementById('profileVerifyBadge');
  if (currentUser.verified) {
    badge.textContent = 'Verified Campus Builder';
    badge.classList.add('verified');
  } else {
    badge.textContent = 'Pending Verification';
    badge.classList.remove('verified');
  }

  renderStudentCirculars();
  renderStudentEvents();
  renderLiveProjects();
  renderPeers();
  renderMyPostsAndRegs();
}

function saveStudentProfile(e) {
  e.preventDefault();
  currentUser.name = document.getElementById('profName').value.trim();
  currentUser.year = document.getElementById('profYear').value;
  currentUser.bio = document.getElementById('profBio').value.trim();
  currentUser.skills = document
    .getElementById('profSkills')
    .value.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  currentUser.github = document.getElementById('profGithub').value.trim();
  currentUser.linkedin = document.getElementById('profLinkedin').value.trim();

  const idx = state.users.findIndex(u => u.roll === currentUser.roll);
  if (idx !== -1) state.users[idx] = currentUser;
  SynapseVault.save(state);
  renderStudentAll();
  showToast('Profile & technical stack updated');
}

function renderStudentCirculars() {
  const container = document.getElementById('studentCircularsList');
  container.innerHTML = state.circulars
    .map(
      c => `
    <div class="sub-card">
      <div class="panel-header-row" style="margin-bottom:6px;">
        <span class="status-badge">${c.tag}</span>
        <span class="user-id">${c.date}</span>
      </div>
      <h4>${c.title}</h4>
      <p class="muted-text" style="margin-bottom:0;">${c.body}</p>
    </div>
  `
    )
    .join('');
}

function renderStudentEvents() {
  const grid = document.getElementById('studentEventsGrid');
  grid.innerHTML = state.events
    .map(ev => {
      const alreadyReg = state.registrations.some(
        r => r.eventId === ev.id && r.studentRoll === currentUser.roll
      );
      return `
      <div class="sub-card">
        <div class="mono-accent" style="margin-bottom:6px;">${ev.date}</div>
        <h4>${ev.title}</h4>
        <p class="muted-text">${ev.desc}</p>
        <div class="panel-header-row" style="margin-bottom:0;">
          <span class="user-id">${ev.registeredCount} / ${ev.capacity} Squads</span>
          <button class="${alreadyReg ? 'chip-btn' : 'primary-btn'}" onclick="openEventRegModal('${ev.id}')">
            ${alreadyReg ? '✓ Registered' : 'Register Squad'}
          </button>
        </div>
      </div>
    `;
    })
    .join('');
}

function renderLiveProjects() {
  const query = (document.getElementById('projectSearchInput')?.value || '').toLowerCase();
  const grid = document.getElementById('liveProjectsGrid');
  const filtered = state.projects.filter(
    p =>
      p.approved &&
      (p.title.toLowerCase().includes(query) ||
        p.desc.toLowerCase().includes(query) ||
        p.stack.some(s => s.toLowerCase().includes(query)))
  );

  grid.innerHTML = filtered
    .map(
      p => `
    <div class="sub-card">
      <div class="panel-header-row" style="margin-bottom:6px;">
        <span class="mono-accent">LEAD: ${p.ownerName}</span>
        ${p.featured ? '<span class="status-badge verified">SPOTLIGHT</span>' : ''}
      </div>
      <h4>${p.title}</h4>
      <p class="muted-text">${p.desc}</p>
      <div class="tag-row">
        ${p.stack.map(s => `<span class="skill-tag">${s}</span>`).join('')}
      </div>
      <div class="panel-header-row" style="margin-top:12px;margin-bottom:0;">
        <span class="user-id">${p.roles.length} Open Roles</span>
        <button class="primary-btn" onclick="openApplyModal('${p.id}')">Apply to Join</button>
      </div>
    </div>
  `
    )
    .join('');
}

function renderPeers() {
  const q = (document.getElementById('peerSearchInput')?.value || '').toLowerCase();
  const grid = document.getElementById('peersGrid');
  const peers = state.users.filter(
    u =>
      u.role === 'student' &&
      u.roll !== currentUser.roll &&
      (u.name.toLowerCase().includes(q) ||
        u.dept.toLowerCase().includes(q) ||
        u.skills.some(s => s.toLowerCase().includes(q)))
  );

  grid.innerHTML = peers
    .map(
      u => `
    <div class="sub-card">
      <div class="panel-header-row" style="margin-bottom:6px;">
        <span class="mono-accent">${u.roll}</span>
        <span class="status-badge ${u.verified ? 'verified' : ''}">${u.verified ? 'Verified' : 'Student'}</span>
      </div>
      <h4>${u.name}</h4>
      <div class="user-id" style="margin-bottom:8px;">${u.dept} &bull; ${u.year}</div>
      <p class="muted-text">${u.bio}</p>
      <div class="tag-row">
        ${u.skills.map(s => `<span class="skill-tag">${s}</span>`).join('')}
      </div>
    </div>
  `
    )
    .join('');
}

function renderMyPostsAndRegs() {
  const myProjs = state.projects.filter(p => p.ownerRoll === currentUser.roll);
  const projContainer = document.getElementById('myProjectsList');
  projContainer.innerHTML = myProjs.length
    ? myProjs
        .map(
          p => `
      <div class="sub-card">
        <h4>${p.title}</h4>
        <p class="muted-text">${p.desc}</p>
        <div class="mono-accent" style="margin-bottom:8px;">APPLICANTS (${p.applications.length})</div>
        ${
          p.applications.length
            ? p.applications
                .map(
                  (app, idx) => `
            <div class="sub-box" style="margin-bottom:8px;">
              <strong>${app.applicantName}</strong> (${app.applicantRoll}) &mdash; <span class="mono-accent">${app.role}</span>
              <p>${app.note}</p>
              <div class="user-id">Phone: ${app.phone} | Resume: ${app.resumeName || 'Not attached'} | Status: <strong>${app.status}</strong></div>
              <div style="margin-top:8px;display:flex;gap:8px;">
                <button class="chip-btn" onclick="updateAppStatus('${p.id}', ${idx}, 'Accepted')">Accept</button>
                <button class="chip-btn" onclick="updateAppStatus('${p.id}', ${idx}, 'Declined')">Decline</button>
              </div>
            </div>
          `
                )
                .join('')
            : '<div class="user-id">No squad applications received yet.</div>'
        }
      </div>
    `
        )
        .join('')
    : '<div class="muted-text">You have not pitched any projects yet. Click "+ New Pitch" to recruit teammates.</div>';

  const myRegs = state.registrations.filter(r => r.studentRoll === currentUser.roll);
  const regContainer = document.getElementById('myRegistrationsList');
  regContainer.innerHTML = myRegs.length
    ? myRegs
        .map(
          r => `
      <div class="sub-card">
        <span class="status-badge verified">CONFIRMED PASS</span>
        <h4 style="margin-top:6px;">${r.eventTitle}</h4>
        <div class="user-id">Squad: ${r.teamName} &bull; Track: ${r.track}</div>
        <div class="user-id" style="margin-top:4px;">Roster: ${r.members}</div>
      </div>
    `
        )
        .join('')
    : '<div class="muted-text">No event passes registered yet.</div>';
}

function updateAppStatus(projectId, appIdx, status) {
  const proj = state.projects.find(p => p.id === projectId);
  if (proj && proj.applications[appIdx]) {
    proj.applications[appIdx].status = status;
    SynapseVault.save(state);
    renderMyPostsAndRegs();
    showToast(`Application marked as ${status}`);
  }
}

/* ---------------- MODALS & SUBMISSIONS ---------------- */
function openApplyModal(projectId) {
  const proj = state.projects.find(p => p.id === projectId);
  if (!proj) return;
  document.getElementById('applyProjectId').value = proj.id;
  document.getElementById('applyModalTitle').textContent = proj.title;
  document.getElementById('applyModalDesc').textContent = proj.desc;
  document.getElementById('applyModalTags').innerHTML = proj.stack
    .map(s => `<span class="skill-tag">${s}</span>`)
    .join('');
  document.getElementById('applyApplicantMeta').value = `${currentUser.name} (${currentUser.roll})`;
  document.getElementById('applyRoleSelect').innerHTML = proj.roles
    .map(r => `<option value="${r}">${r}</option>`)
    .join('');
  document.getElementById('applyPortfolio').value = currentUser.github || '';
  document.getElementById('applyModal').classList.remove('hidden');
}

function submitSquadApplication(e) {
  e.preventDefault();
  const projectId = document.getElementById('applyProjectId').value;
  const proj = state.projects.find(p => p.id === projectId);
  if (!proj) return;

  const fileInput = document.getElementById('applyResumeFile');
  const resumeName = fileInput.files && fileInput.files[0] ? fileInput.files[0].name : 'Attached_Profile_CV.pdf';

  proj.applications.push({
    applicantName: currentUser.name,
    applicantRoll: currentUser.roll,
    role: document.getElementById('applyRoleSelect').value,
    phone: document.getElementById('applyPhone').value.trim(),
    portfolio: document.getElementById('applyPortfolio').value.trim(),
    resumeName,
    note: document.getElementById('applyPitchNote').value.trim(),
    status: 'Under Review'
  });

  SynapseVault.save(state);
  closeModal('applyModal');
  renderMyPostsAndRegs();
  showToast('Squad application & CV submitted to project lead!');
}

function openPitchModal() {
  document.getElementById('pitchModal').classList.remove('hidden');
}

function submitNewProject(e) {
  e.preventDefault();
  const title = document.getElementById('newProjTitle').value.trim();
  const desc = document.getElementById('newProjDesc').value.trim();
  const stack = document.getElementById('newProjStack').value.split(',').map(s => s.trim()).filter(Boolean);
  const roles = document.getElementById('newProjRoles').value.split(',').map(r => r.trim()).filter(Boolean);

  state.projects.unshift({
    id: 'PRJ-' + Date.now().toString().slice(-4),
    title,
    ownerRoll: currentUser.roll,
    ownerName: currentUser.name,
    desc,
    stack,
    roles,
    featured: false,
    approved: true,
    applications: []
  });

  SynapseVault.save(state);
  closeModal('pitchModal');
  renderLiveProjects();
  renderMyPostsAndRegs();
  showToast('Project pitch published to campus feed!');
}

function openEventRegModal(eventId) {
  const ev = state.events.find(x => x.id === eventId);
  if (!ev) return;
  document.getElementById('eventRegId').value = ev.id;
  document.getElementById('eventRegTitle').textContent = `Register Squad — ${ev.title}`;
  document.getElementById('eventTeamMembers').value = currentUser.roll;
  document.getElementById('eventRegModal').classList.remove('hidden');
}

function submitEventRegistration(e) {
  e.preventDefault();
  const eventId = document.getElementById('eventRegId').value;
  const ev = state.events.find(x => x.id === eventId);
  if (!ev) return;

  state.registrations.push({
    id: 'REG-' + Date.now().toString().slice(-4),
    eventId: ev.id,
    eventTitle: ev.title,
    studentRoll: currentUser.roll,
    teamName: document.getElementById('eventTeamName').value.trim(),
    members: document.getElementById('eventTeamMembers').value.trim(),
    track: document.getElementById('eventTrackSelect').value
  });
  ev.registeredCount += 1;

  SynapseVault.save(state);
  closeModal('eventRegModal');
  renderStudentEvents();
  renderMyPostsAndRegs();
  showToast('Squad registered! Event pass added to your hub.');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function closeModalOnBackdrop(e, id) {
  if (e.target.id === id) closeModal(id);
}

/* ---------------- ADMIN PORTAL ---------------- */
function switchAdminTab(tabName) {
  document.querySelectorAll('#adminPortal .nav-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.admintab === tabName);
  });
  document.querySelectorAll('.admin-section').forEach(sec => sec.classList.add('hidden'));
  document.getElementById(`adminTab-${tabName}`).classList.remove('hidden');
}

function renderAdminAll() {
  const students = state.users.filter(u => u.role === 'student');
  const verifiedCount = students.filter(u => u.verified).length;
  const featuredCount = state.projects.filter(p => p.featured).length;

  document.getElementById('kpiStudents').textContent = students.length;
  document.getElementById('kpiVerifiedSub').textContent = `${verifiedCount} Verified Profiles`;
  document.getElementById('kpiEvents').textContent = state.events.length;
  document.getElementById('kpiRegs').textContent = state.registrations.length;
  document.getElementById('kpiProjects').textContent = state.projects.length;
  document.getElementById('kpiFeaturedSub').textContent = `${featuredCount} Featured Spotlights`;

  // Turnout Bars
  document.getElementById('adminTurnoutBars').innerHTML = state.events
    .map(ev => {
      const pct = Math.min(100, Math.round((ev.registeredCount / ev.capacity) * 100));
      return `
      <div class="sub-card">
        <div class="panel-header-row" style="margin-bottom:4px;">
          <strong>${ev.title}</strong>
          <span class="mono-accent">${ev.registeredCount} / ${ev.capacity} (${pct}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${Math.max(4, pct)}%;"></div>
        </div>
      </div>
    `;
    })
    .join('');

  // Admin Circulars
  document.getElementById('adminCircularsList').innerHTML = state.circulars
    .map(
      (c, i) => `
    <div class="sub-card">
      <div class="panel-header-row" style="margin-bottom:6px;">
        <span class="status-badge">${c.tag}</span>
        <button class="chip-btn" onclick="deleteCircular(${i})">Delete</button>
      </div>
      <h4>${c.title}</h4>
      <p class="muted-text" style="margin-bottom:0;">${c.body}</p>
    </div>
  `
    )
    .join('');

  // Admin Events
  document.getElementById('adminEventsList').innerHTML = state.events
    .map(
      ev => `
    <div class="sub-card">
      <div class="panel-header-row" style="margin-bottom:4px;">
        <h4>${ev.title}</h4>
        <span class="mono-accent">${ev.registeredCount} / ${ev.capacity} Squads</span>
      </div>
      <div class="user-id" style="margin-bottom:6px;">${ev.date}</div>
      <p class="muted-text" style="margin-bottom:0;">${ev.desc}</p>
    </div>
  `
    )
    .join('');

  renderAdminDirectory();

  // Admin Project Approvals
  document.getElementById('adminProjectsList').innerHTML = state.projects
    .map(
      p => `
    <div class="sub-card">
      <div class="panel-header-row" style="margin-bottom:6px;">
        <div>
          <h4>${p.title}</h4>
          <div class="user-id">Lead: ${p.ownerName} (${p.ownerRoll})</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="chip-btn" onclick="toggleSpotlight('${p.id}')">
            ${p.featured ? '★ Featured' : '☆ Spotlight'}
          </button>
          <button class="chip-btn" onclick="deleteProject('${p.id}')">Remove</button>
        </div>
      </div>
      <p class="muted-text" style="margin-bottom:0;">${p.desc}</p>
    </div>
  `
    )
    .join('');
}

function renderAdminDirectory() {
  const q = (document.getElementById('adminStudentSearch')?.value || '').toLowerCase();
  const students = state.users.filter(
    u =>
      u.role === 'student' &&
      (u.name.toLowerCase().includes(q) ||
        u.roll.toLowerCase().includes(q) ||
        u.dept.toLowerCase().includes(q))
  );

  document.getElementById('adminStudentsTable').innerHTML = students
    .map(
      s => `
    <div class="sub-card">
      <div class="panel-header-row" style="margin-bottom:0;">
        <div>
          <strong>${s.name}</strong> <span class="mono-accent">(${s.roll})</span>
          <div class="user-id">${s.dept} &bull; ${s.year} &bull; ${s.email}</div>
        </div>
        <button class="${s.verified ? 'chip-btn' : 'primary-btn'}" onclick="toggleVerifyStudent('${s.roll}')">
          ${s.verified ? '✓ Verified' : 'Verify Student'}
        </button>
      </div>
    </div>
  `
    )
    .join('');
}

function toggleVerifyStudent(roll) {
  const st = state.users.find(u => u.roll === roll);
  if (st) {
    st.verified = !st.verified;
    SynapseVault.save(state);
    renderAdminAll();
    showToast(`Updated verification status for ${st.name}`);
  }
}

function toggleSpotlight(projectId) {
  const prj = state.projects.find(p => p.id === projectId);
  if (prj) {
    prj.featured = !prj.featured;
    SynapseVault.save(state);
    renderAdminAll();
    showToast(prj.featured ? 'Project added to Campus Spotlight' : 'Removed from Spotlight');
  }
}

function deleteProject(projectId) {
  state.projects = state.projects.filter(p => p.id !== projectId);
  SynapseVault.save(state);
  renderAdminAll();
  showToast('Project removed from feed');
}

function openCircularModal() {
  document.getElementById('circularModal').classList.remove('hidden');
}

function submitNewCircular(e) {
  e.preventDefault();
  state.circulars.unshift({
    id: 'CIR-' + Date.now().toString().slice(-3),
    tag: document.getElementById('circTag').value,
    date: '21 Nov 2026',
    title: document.getElementById('circTitle').value.trim(),
    body: document.getElementById('circBody').value.trim()
  });
  SynapseVault.save(state);
  closeModal('circularModal');
  renderAdminAll();
  showToast('Circular broadcast to all student dashboards!');
}

function deleteCircular(idx) {
  state.circulars.splice(idx, 1);
  SynapseVault.save(state);
  renderAdminAll();
  showToast('Circular deleted');
}

function openNewEventModal() {
  document.getElementById('newEventModal').classList.remove('hidden');
}

function submitNewEvent(e) {
  e.preventDefault();
  state.events.unshift({
    id: 'EVT-' + Date.now().toString().slice(-3),
    title: document.getElementById('evTitle').value.trim(),
    date: document.getElementById('evDate').value.trim(),
    capacity: parseInt(document.getElementById('evCap').value, 10) || 100,
    registeredCount: 0,
    desc: document.getElementById('evDesc').value.trim()
  });
  SynapseVault.save(state);
  closeModal('newEventModal');
  renderAdminAll();
  showToast('New campus event published!');
}

function exportCampusCSV() {
  const rows = [
    ['Roll Number', 'Name', 'Department', 'Year', 'Verified', 'Skills'],
    ...state.users
      .filter(u => u.role === 'student')
      .map(u => [u.roll, u.name, u.dept, u.year, u.verified ? 'Yes' : 'No', u.skills.join('; ')])
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Presidency_Synapse_Campus_Roster.csv';
  link.click();
  showToast('Exported Presidency_Synapse_Campus_Roster.csv');
}

/* ---------------- 3D CARD TILT PHYSICS ---------------- */
document.addEventListener('mousemove', e => {
  document.querySelectorAll('.tilt-card').forEach(card => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
      const rx = ((y / rect.height) - 0.5) * -6;
      const ry = ((x / rect.width) - 0.5) * 6;
      card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    } else {
      card.style.transform = '';
    }
  });
});

/* ---------------- THREE.JS 3D NEURAL CONSTELLATION ---------------- */
let scene, camera, renderer, pointsMesh, linesMesh;

function initNeuralCanvas() {
  const canvas = document.getElementById('neural-canvas');
  if (!window.THREE || !canvas) return;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
  camera.position.z = 240;

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const count = 68;
  const positions = new Float32Array(count * 3);
  const velocities = [];

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 420;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 260;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 140;
    velocities.push({
      x: (Math.random() - 0.5) * 0.25,
      y: (Math.random() - 0.5) * 0.25,
      z: (Math.random() - 0.5) * 0.15
    });
  }

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pMat = new THREE.PointsMaterial({ color: 0x64748b, size: 3.2, transparent: true, opacity: 0.7 });
  pointsMesh = new THREE.Points(pGeo, pMat);
  scene.add(pointsMesh);

  const lGeo = new THREE.BufferGeometry();
  const lMat = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.24 });
  linesMesh = new THREE.LineSegments(lGeo, lMat);
  scene.add(linesMesh);

  function animate() {
    requestAnimationFrame(animate);
    const pos = pointsMesh.geometry.attributes.position.array;
    const lineVerts = [];

    for (let i = 0; i < count; i++) {
      pos[i * 3] += velocities[i].x;
      pos[i * 3 + 1] += velocities[i].y;
      pos[i * 3 + 2] += velocities[i].z;

      if (Math.abs(pos[i * 3]) > 220) velocities[i].x *= -1;
      if (Math.abs(pos[i * 3 + 1]) > 140) velocities[i].y *= -1;
      if (Math.abs(pos[i * 3 + 2]) > 80) velocities[i].z *= -1;

      for (let j = i + 1; j < count; j++) {
        const dx = pos[i * 3] - pos[j * 3];
        const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 78) {
          lineVerts.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
        }
      }
    }

    pointsMesh.geometry.attributes.position.needsUpdate = true;
    linesMesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function updateNeuralColors(theme) {
  if (!pointsMesh || !linesMesh) return;
  if (theme === 'dark') {
    pointsMesh.material.color.setHex(0xd99b7f);
    linesMesh.material.color.setHex(0x38bdf8);
    linesMesh.material.opacity = 0.22;
  } else {
    pointsMesh.material.color.setHex(0x64748b);
    linesMesh.material.color.setHex(0x94a3b8);
    linesMesh.material.opacity = 0.26;
  }
}

initNeuralCanvas();
