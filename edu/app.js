// app.js
//import { CacheEngine } from './utils/localDb.js';
import { AuthModule } from './modules/auth.js';
import { InstitutionModule } from './modules/institutions.js';
import { StudentModule } from './modules/students.js';
import { SubjectModule } from './modules/subjects.js';
import { TeacherModule } from './modules/teachers.js';
import { ExamModule } from './modules/exams.js';
import { MarkModule } from './modules/marks.js';
import { MarkAnalysisModule } from './modules/markAnalysis.js';
import { PrintCenterModule } from './modules/printCenter.js';
import { SupplyModule } from './modules/supplementary.js';
import { RevaluationModule } from './modules/revaluations.js';
import { StudentPortalModule } from './modules/studentPortal.js';
import { renderSidebar } from './utils/sidebar.js';
import { DashboardModule } from './modules/dashboard.js';



const App = {
  async init() {
    console.log("Initializing Elite She Campus ERP...");
    
    // 1. Initialize Global UI Helpers
    this.setupGlobalUI();

    // 2. Setup Navigation Router FIRST
    this.setupRouter();

    // 4. Initialize Authentication LAST
    await AuthModule.init();
  },

  setupGlobalUI() {
    window.UI = {
      showToast(msg, type = 'success') {
        const toast = document.getElementById('toast');
        const msgEl = document.getElementById('toast-msg');
        if (!toast || !msgEl) return;
        msgEl.textContent = msg;
        toast.className = `show ${type}`;
        setTimeout(() => { toast.className = toast.className.replace('show', '').trim(); }, 3000);
      },
      openSidebar() {
        document.getElementById('sidebar').classList.add('open');
        document.getElementById('sidebar-overlay').classList.add('show');
        const userData = JSON.parse(localStorage.getItem('erp_session'));
        if (window.SidebarUtils) window.SidebarUtils.renderSidebar(userData);
      },
      closeSidebar() {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('show');
      },
      openModal(title, body, footer) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = body;
        document.getElementById('modal-footer').innerHTML = footer;
        document.getElementById('modal-overlay').classList.add('show');
      },
      closeModal() {
        document.getElementById('modal-overlay').classList.remove('show');
      }
    };
    
    const overlay = document.getElementById('sidebar-overlay');
    if(overlay) overlay.addEventListener('click', window.UI.closeSidebar);
  },

  setupRouter() {
    window.Router = {
      currentRoute: 'nav-dashboard', // Aligned with standard element IDs
      
      navigateTo(routeId) {
        // Normalize incoming route string identifiers cleanly
        const fullRouteId = routeId.startsWith('nav-') ? routeId : `nav-${routeId}`;
        this.currentRoute = fullRouteId;
        
        // 1. Update active styling highlights inside our dynamic sidebar view list
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => el.classList.remove('active'));
        const activeNav = document.getElementById(fullRouteId);
        if (activeNav) activeNav.classList.add('active');
        
        window.UI.closeSidebar();

        // 2. Direct view execution mapping logic jump
        this.renderView(fullRouteId);
      },

      renderView(routeId) {
        const main = document.getElementById('main-content');
        if (!main) return;

        switch (routeId) {
          case 'nav-dashboard':
    // 1. Show a loading state inside your main panel wrapper right away
    const container = document.getElementById('main-workspace-root') || document.getElementById('app-content');
    if (container) {
        container.innerHTML = `
          <div style="padding: 20px;">
            <div class="skeleton-loader" style="height: 40px; width: 30%; margin-bottom: 20px; border-radius:6px;"></div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px;">
              <div class="skeleton-loader" style="height: 120px; border-radius:8px;"></div>
              <div class="skeleton-loader" style="height: 120px; border-radius:8px;"></div>
            </div>
          </div>`;
    }

    // 2. Trigger the core init pipeline which checks the user's role, 
    // fetches the cache-first data metrics, and handles rendering automatically!
    DashboardModule.init().catch(err => {
        console.error("Router navigation breakdown:", err);
        window.UI?.showToast("Failed to mount dashboard panel workspace.", "error");
    });
    break;
          case 'nav-institutions':
            if (AuthModule.currentRole !== 'super_admin') {
              window.UI.showToast("Access Denied", "error");
              return;
            }
            this.loadInstitutionView(main);
            break;
          case 'nav-subjects':
            this.loadSubjectView(main);
            break;
          case 'nav-teachers':
            this.loadTeacherView(main);
            break;
          case 'nav-exams':
            this.loadExamView(main);
            break;
          case 'nav-marks':
            this.loadMarkEntryView(main);
            break;
          case 'nav-analysis':
            this.loadAnalysisView(main);
            break;
          case 'nav-revaluation':
            this.loadRevalView(main);
            break;
          case 'nav-students':
            this.loadStudentView(main);
            break;
          case 'nav-portal':
            this.loadStudentPortalView(main);
            break;
            case 'nav-print-center':
                this.loadPrintCenterView(main);
                break;
            case 'nav-supplementary':
                this.loadSupplyView(main);
                break;

          default:
            main.innerHTML = `<div class="page-header"><h2>${routeId.replace('nav-', '').toUpperCase()}</h2><p>Module under construction.</p></div>`;
        }
      },

      // --- View Injectors ---
      loadInstitutionView(main) {
        main.innerHTML = `
          <div class="page-header flex-between">
            <div><h2>Institutions</h2><p>Manage all registered campuses.</p></div>
            <button class="btn btn-gold" onclick="window.InstitutionApp.openAddModal()">
              <i class="fa fa-plus"></i> Add Institution
            </button>
          </div>
          <div class="form-floating" style="max-width: 400px; margin-bottom: 20px;">
            <input type="text" id="search-inst" placeholder="Search..." onkeyup="window.InstitutionApp.handleSearch(this.value)">
            <label>Search Institutions</label>
          </div>
          <div class="card-glass table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name & Location</th><th>Principal</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody id="institution-table-body"></tbody>
            </table>
          </div>
        `;
        window.InstitutionApp = InstitutionModule;
        InstitutionModule.fetchInstitutions();
      },

      loadStudentView(main) {
        main.innerHTML = `
          <div class="action-bar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div class="search-box form-floating" style="max-width: 350px; flex: 1;">
              <input type="text" id="stu-search" placeholder=" " oninput="window.StudentApp.handleSearch(this.value)">
              <label><i class="fa fa-search"></i> Filter Students...</label>
            </div>
            <div style="display: flex; gap: 10px;">
              <button class="btn btn-outline" onclick="window.StudentApp.openExportSetupModal('CSV')">
                <i class="fa fa-file-csv"></i> Export CSV
              </button>
              <button class="btn btn-outline" onclick="window.StudentApp.openExportSetupModal('PDF')">
                <i class="fa fa-file-pdf"></i> Export PDF Report
              </button>
              <button class="btn btn-gold" onclick="window.StudentApp.openStudentModal()">
                <i class="fa fa-user-plus"></i> Enroll Student
              </button>
            </div>
          </div>

          <div class="card-glass table-wrap" style="margin-bottom: 25px;">
            <table>
              <thead>
                <tr>
                  <th style="width: 140px;">Reg No</th>
                  <th>Candidate Particulars</th>
                  <th>Batch</th>
                  <th>Status</th>
                  <th style="width: 110px;">Actions</th>
                </tr>
              </thead>
              <tbody id="student-table-body"></tbody>
            </table>
          </div>

          <div class="card-glass" style="padding: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; wrap-flow: wrap; gap: 15px;">
              <h4 style="color: var(--accent-gold); margin: 0; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">Batch Allocation Matrix Summary</h4>
              <div class="form-floating" style="max-width: 250px; margin: 0;">
                <select id="summary-batch-select" onchange="window.StudentApp.handleBatchSummaryChange(this.value)">
                </select>
                <label>Select Batch</label>
              </div>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border);">
                  <th style="text-align: left; padding: 10px; font-size: 12px; color: var(--text-secondary);">Institution ID</th>
                  <th style="text-align: left; padding: 10px; font-size: 12px; color: var(--text-secondary);">Enrolled Capacity</th>
                  <th style="text-align: right; padding: 10px; font-size: 12px; color: var(--text-secondary); width: 100px;">Actions</th>
                </tr>
              </thead>
              <tbody id="batch-summary-table-body">
                <tr>
                  <td colspan="3" style="text-align: center; padding: 20px;" class="text-muted">Select a batch timeline to map institutional allocations.</td>
                </tr>
              </tbody>
            </table>
          </div>
        `;
        window.StudentApp = StudentModule;
        StudentModule.fetchStudents(); 
      },

      loadSubjectView(main) {
        main.innerHTML = `
          <div class="page-header flex-between">
            <div><h2>Subject Master</h2><p>Manage curriculum subjects and passing criteria.</p></div>
            <button class="btn btn-gold" onclick="window.SubjectApp.openAddModal()">
              <i class="fa fa-plus"></i> Add Subject
            </button>
          </div>
          <div class="form-floating" style="max-width: 400px; margin-bottom: 20px;">
            <input type="text" id="search-sub" placeholder="Search..." onkeyup="window.SubjectApp.handleSearch(this.value)">
            <label>Search Subjects</label>
          </div>
          <div class="card-glass table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Subject Name</th><th>Max Marks</th><th>Pass Marks</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody id="subject-table-body"></tbody>
            </table>
          </div>
        `;
        window.SubjectApp = SubjectModule;
        SubjectModule.fetchSubjects();
      },

      loadTeacherView(main) {
        main.innerHTML = `
          <div class="page-header flex-between">
            <div><h2>Staff Directory</h2><p>Manage teacher profiles and department assignments.</p></div>
            <button class="btn btn-gold" onclick="window.TeacherApp.openAddModal()">
              <i class="fa fa-user-plus"></i> Add Teacher
            </button>
          </div>
          <div class="form-floating" style="max-width: 400px; margin-bottom: 20px;">
            <input type="text" id="search-teacher" placeholder="Search..." onkeyup="window.TeacherApp.handleSearch(this.value)">
            <label>Search by Name, Email, or Dept</label>
          </div>
          <div class="card-glass table-wrap">
            <table>
              <thead>
                <tr><th>Teacher Name</th><th>Email Address</th><th>Department</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody id="teacher-table-body"></tbody>
            </table>
          </div>
        `;
        window.TeacherApp = TeacherModule;
        TeacherModule.fetchTeachers();
      },

      loadExamView(main) {
        main.innerHTML = `
          <div class="page-header flex-between">
            <div><h2>Exams & Timetable</h2><p>Create exam batches, schedule subjects, and publish timetables.</p></div>
            <button class="btn btn-gold" onclick="window.ExamApp.openAddModal()">
              <i class="fa fa-plus"></i> Create Exam
            </button>
          </div>
          <div class="card-glass table-wrap" style="margin-top: 20px;">
            <table>
              <thead>
                <tr><th>Examination Name</th><th>Target Batch</th><th>Schedule Count</th><th>Status</th><th>Actions / Timetable</th></tr>
              </thead>
              <tbody id="exam-table-body"></tbody>
            </table>
          </div>
        `;
        window.ExamApp = ExamModule;
        ExamModule.fetchExams();
      },

      loadMarkEntryView(main) {
        main.innerHTML = `
          <div class="page-header">
            <h2>Mark Entry Terminal</h2>
            <p>Select campus configurations, active examinations, and matching subjects to grade candidate parameters.</p>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 15px; margin-bottom: 20px; align-items: end;">
            <div id="me-inst-container"></div>
            <div class="form-floating">
              <select id="me-exam-select" onchange="window.MarkApp.handleExamSelection(this.value)">
                <option value="">Loading Exams...</option>
              </select>
              <label>Select Exam</label>
            </div>
            <div class="form-floating">
              <select id="me-subject-select" disabled>
                <option value="">-- Select Subject --</option>
              </select>
              <label>Select Subject</label>
            </div>
            <button class="btn btn-gold" style="height: 50px; padding: 0 30px;" onclick="window.MarkApp.generateMarkGrid()">Load Grid</button>
          </div>
          <div class="card-glass table-wrap" id="mark-grid-container">
            <div class="empty-state">Configure active filters above to render your target evaluation sheets.</div>
          </div>
        `;
        window.MarkApp = MarkModule;
        MarkModule.initMarkEntry();
      },

      loadAnalysisView(main) {
        main.innerHTML = `
          <div class="page-header">
            <h2>Mark Analysis & Result Processing</h2>
            <p>Compute grades, apply grace marks, identify supplementary candidates, and publish final results.</p>
          </div>
          <div id="analysis-controls"></div>
          <div id="analysis-content" style="margin-top: 20px;">
            <div class="empty-state" style="padding: 60px 20px;">
              <i class="fa fa-chart-pie" style="font-size: 48px; color: var(--border);"></i>
              <p style="margin-top: 16px;">Select an exam to run the Result Processing Pipeline.</p>
            </div>
          </div>
        `;
        window.AnalysisApp = MarkAnalysisModule;
        MarkAnalysisModule.init(AuthModule.institutionId);
      },

      loadPrintCenterView(main) {
        main.innerHTML = `
          <div class="page-header">
            <h2>Print Center & PDF Engine</h2>
            <p>Generate perfectly formatted, physical documents for your institution.</p>
          </div>
          <div id="print-controls"></div>
        `;
        window.PrintApp = PrintCenterModule;
        PrintCenterModule.init(AuthModule.institutionId);
      },

      loadSupplyView(main) {
  main.innerHTML = `
    <div class="page-header flex-between">
      <div><h2>Supplementary Management</h2><p>Process retakes, calculate fees, and register failed students.</p></div>
      <button class="btn btn-gold"><i class="fa fa-file-invoice-dollar"></i> View Fee Receipts</button>
    </div>
    
    <div id="supply-filter-controls"></div>
    
    <div class="card-glass table-wrap" style="margin-top: 20px;">
      <table>
        <thead>
          <tr>
            <th>Student Info</th>
            <th>Failed Subjects (Marks)</th>
            <th>Backlog Count</th>
            <th>Calculated Fee</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="supply-table-body"></tbody>
      </table>
    </div>
  `;
  window.SupplyApp = SupplyModule;
  SupplyModule.init(AuthModule.institutionId);
},

      loadRevalView(main) {
        main.innerHTML = `
          <div class="page-header flex-between">
            <div><h2>Revaluation Portal</h2><p>Manage re-grading requests, track fee collections, and maintain secure audit trails.</p></div>
            <button class="btn btn-gold" onclick="window.RevalApp.openRegistrationModal()">
              <i class="fa fa-plus"></i> Register Request
            </button>
          </div>
          <div class="card-glass table-wrap" style="margin-top: 20px;">
            <table>
              <thead>
                <tr><th>Student Info</th><th>Subject</th><th>Marks (Old &rarr; New)</th><th>Difference</th><th>Status</th><th>Action / Audit</th></tr>
              </thead>
              <tbody id="reval-table-body"></tbody>
            </table>
          </div>
        `;
        window.RevalApp = RevaluationModule;
        RevaluationModule.init(AuthModule.institutionId);
      },

      loadStudentPortalView(main) {
        main.innerHTML = `
          <div class="page-header">
            <h2>Student Dashboard</h2>
            <p>Welcome to your academic portal.</p>
          </div>
          <div id="student-portal-content"></div>
        `;
        window.StudentPortalApp = StudentPortalModule;
        StudentPortalModule.init(AuthModule.studentId);
      }
    };
  }
};

// Global AppEngine Bridge (Triggered natively via utils/sidebar.js actions)
window.AppEngine = {
  switchView(viewElementId) {
    console.log("Switching view module target to:", viewElementId);
    
    // Pass the element ID straight to the navigation router handler
    if (window.Router) {
      window.Router.navigateTo(viewElementId);
    }
  }
};

// Boot the application shell when DOM parsing finishes
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});