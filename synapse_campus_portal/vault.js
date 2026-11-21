/* =========================================================
   SYNAPSE VAULT — CLIENT-SIDE PERSISTENT RELATIONAL STORE
   ========================================================= */
const SynapseVault = (() => {
  const STORAGE_KEY = 'synapse_pu_vault_v1';

  const DEFAULT_DATA = {
    users: [
      {
        id: 'ADMIN-PU-01',
        name: 'Dr. Kavitha Rao',
        roll: 'ADMIN-PU-01',
        email: 'admin.synapse@presidencyuniversity.in',
        password: 'admin123',
        role: 'admin',
        dept: 'School of Computer Science & Engineering',
        year: 'Faculty Coordinator',
        verified: true,
        skills: ['Innovation Cell', 'Hackathon Jury', 'System Architecture'],
        bio: 'Faculty Lead, Presidency University Innovation Hub.',
        github: 'https://github.com',
        linkedin: 'https://linkedin.com'
      },
      {
        id: '20251CSE0028',
        name: 'B. Sri Harsha',
        roll: '20251CSE0028',
        email: '20251cse0028@presidencyuniversity.in',
        password: 'student123',
        role: 'student',
        dept: 'Computer Science & Engineering',
        year: '2nd Year',
        verified: true,
        skills: ['Python', 'Next.js', 'Three.js', 'ESP32', 'Agentic AI'],
        bio: 'Presidency University student eager to collaborate on hackathons and real-world software/hardware builds.',
        github: 'https://github.com/bsriharsha2007-oss',
        linkedin: 'https://linkedin.com'
      },
      {
        id: '20251CSE0048',
        name: 'Gaurav Rastogi',
        roll: '20251CSE0048',
        email: '20251cse0048@presidencyuniversity.in',
        password: 'student123',
        role: 'student',
        dept: 'Computer Science & Engineering',
        year: '2nd Year',
        verified: true,
        skills: ['React', 'Node.js', 'SQLite', 'UI/UX', 'Java'],
        bio: 'Full-stack developer building scalable campus platforms and interactive web apps.',
        github: 'https://github.com',
        linkedin: 'https://linkedin.com'
      },
      {
        id: '20251CSE0047',
        name: 'Shiva Tokas',
        roll: '20251CSE0047',
        email: '20251cse0047@presidencyuniversity.in',
        password: 'student123',
        role: 'student',
        dept: 'Computer Science & Engineering',
        year: '2nd Year',
        verified: true,
        skills: ['C++', 'Embedded IoT', 'Python', 'Data Structures'],
        bio: 'Hardware-software integration enthusiast focusing on smart campus telemetry.',
        github: 'https://github.com',
        linkedin: 'https://linkedin.com'
      },
      {
        id: '20251CSE0004',
        name: 'Syed Imran Ansaari',
        roll: '20251CSE0004',
        email: '20251cse0004@presidencyuniversity.in',
        password: 'student123',
        role: 'student',
        dept: 'Computer Science & Engineering',
        year: '2nd Year',
        verified: true,
        skills: ['Backend APIs', 'Java Spring Boot', 'MySQL', 'Docker'],
        bio: 'Backend systems engineer interested in distributed cloud architectures.',
        github: 'https://github.com',
        linkedin: 'https://linkedin.com'
      },
      {
        id: '20251CSE0053',
        name: 'Usama',
        roll: '20251CSE0053',
        email: '20251cse0053@presidencyuniversity.in',
        password: 'student123',
        role: 'student',
        dept: 'Computer Science & Engineering',
        year: '2nd Year',
        verified: false,
        skills: ['Frontend', 'Tailwind CSS', 'JavaScript', 'Figma'],
        bio: 'UI/UX designer and frontend developer crafting responsive interfaces.',
        github: 'https://github.com',
        linkedin: 'https://linkedin.com'
      },
      {
        id: '20251CSE0069',
        name: 'Zohair',
        roll: '20251CSE0069',
        email: '20251cse0069@presidencyuniversity.in',
        password: 'student123',
        role: 'student',
        dept: 'Computer Science & Engineering',
        year: '2nd Year',
        verified: false,
        skills: ['Machine Learning', 'Python', 'PyTorch', 'Data Analysis'],
        bio: 'AI & Data Science builder exploring computer vision and predictive modeling.',
        github: 'https://github.com',
        linkedin: 'https://linkedin.com'
      }
    ],
    events: [
      {
        id: 'EVT-101',
        title: 'Smart India Hackathon (SIH) Internal Prelims',
        date: '28 Nov 2026 • Auditorium Block A',
        capacity: 120,
        registeredCount: 3,
        desc: '36-hour campus qualifier for SIH software & hardware problem statements.'
      },
      {
        id: 'EVT-102',
        title: 'Bharatiya Antariksh Space-Tech Sprint',
        date: '05 Dec 2026 • Innovation Hub Lab 2',
        capacity: 80,
        registeredCount: 1,
        desc: 'Build lunar terrain analytics, orbital telemetry dashboards, and satellite payload tools.'
      },
      {
        id: 'EVT-103',
        title: 'AI Murder Mystery: CODE RED',
        date: '12 Dec 2026 • CSE Seminar Hall',
        capacity: 90,
        registeredCount: 0,
        desc: 'Interactive forensic debugging, prompt-injection clues, and algorithmic deduction challenge.'
      },
      {
        id: 'EVT-104',
        title: 'Build with Trae: Rapid Agentic Prototyping',
        date: '19 Dec 2026 • Main Computer Center',
        capacity: 150,
        registeredCount: 0,
        desc: 'Hands-on workshop on multi-agent workflows and full-stack deployment.'
      }
    ],
    projects: [
      {
        id: 'PRJ-201',
        title: 'CampusPulse: Smart Microgrid & Lab Energy Twin',
        ownerRoll: '20251CSE0048',
        ownerName: 'Gaurav Rastogi',
        desc: 'Engineering laboratories across campus consume high peak-hour power due to unmonitored HVAC and workstation loads. CampusPulse deploys ESP32 current-transformer nodes streamed to a React + Python digital twin to forecast load spikes and automate relay scheduling.',
        stack: ['Python', 'IoT/ESP32', 'React', 'Node.js'],
        roles: ['Embedded Firmware Lead', 'ML Forecasting Engineer', 'Frontend Twin Developer'],
        featured: true,
        approved: true,
        applications: []
      },
      {
        id: 'PRJ-202',
        title: 'Sovereign On-Premise Industrial AI Workbench',
        ownerRoll: '20251CSE0028',
        ownerName: 'B. Sri Harsha',
        desc: 'Air-gapped multimodal RAG and agentic orchestration platform engineered for confidential refinery and industrial CAD/SOP inspection without external cloud telemetry.',
        stack: ['Python', 'LLMs', 'FastAPI', 'VectorDB'],
        roles: ['RAG Pipeline Engineer', 'Security & Auth Specialist'],
        featured: true,
        approved: true,
        applications: []
      },
      {
        id: 'PRJ-203',
        title: 'GuardianMesh: Sub-GHz Women Safety Panic Node',
        ownerRoll: '20251CSE0047',
        ownerName: 'Shiva Tokas',
        desc: 'Wearable ESP32-WROOM-32 + SIM800L + NEO-6M GPS emergency beacon with haptic SOS confirmation and live campus security geofencing.',
        stack: ['ESP32', 'C++', 'GSM/GPS', 'Flutter'],
        roles: ['PCB & Enclosure Designer', 'Mobile Companion Dev'],
        featured: false,
        approved: true,
        applications: []
      }
    ],
    circulars: [
      {
        id: 'CIR-01',
        tag: 'URGENT',
        date: '20 Nov 2026',
        title: 'SIH Internal Prelims — Hardware Bench & Lab Allocation',
        body: 'Teams shortlisted for hardware tracks must report to Innovation Hub Lab 2 by 8:30 AM with their ESP32/sensor kits for safety inspection.'
      },
      {
        id: 'CIR-02',
        tag: 'GENERAL',
        date: '18 Nov 2026',
        title: 'Final Jury Evaluation Rubric Published',
        body: 'Prototypes will be evaluated on Technical Feasibility (40%), Problem Impact (35%), and Live Demo Execution (25%).'
      }
    ],
    registrations: [
      {
        id: 'REG-901',
        eventId: 'EVT-101',
        eventTitle: 'Smart India Hackathon (SIH) Internal Prelims',
        studentRoll: '20251CSE0028',
        teamName: 'Team CryoSAR',
        members: '20251CSE0028, 20251CSE0048, 20251CSE0047',
        track: 'Open Innovation & Agentic AI'
      }
    ]
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        save(DEFAULT_DATA);
        return JSON.parse(JSON.stringify(DEFAULT_DATA));
      }
      return JSON.parse(raw);
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  }

  function save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Storage quota warning:', e);
    }
  }

  return { load, save };
})();
