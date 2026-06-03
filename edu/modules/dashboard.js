// modules/dashboard.js
// Multi-Tenant Core Dashboard Engine with Native Firestore Cache Routing

import {
  db,
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc
} from '../services/firebase.js';

export const DashboardModule = {
  
  // ── State ──────────────────────────────────
  state: {
    metrics: {
      totalCampuses: 0,
      totalStudents: 0,
      totalTeachers: 0,
      totalSubjects: 0,
      activeExams:   0
    },
    studentProfile: null,
    loading: false
  },

  // ── Initialization Entry Point ─────────────
  async init() {
    this.state.loading = true;
    this._renderContainerSkeleton();

    const auth = window.AuthModule;
    if (!auth || !auth.currentUser) {
      window.UI.showToast("Session expired. Please log in again.", "error");
      return;
    }

    try {
      // Branch layout execution matrices dynamically depending on account permissions
      switch (auth.currentRole) {
        case 'super_admin':
          await this._loadSuperAdminMetrics();
          this._renderSuperAdminDashboard();
          break;
          
        case 'institution':
        case 'teacher':
          await this._loadInstitutionMetrics(auth.institutionId);
          this._renderInstitutionDashboard();
          break;
          
        case 'student':
          await this._loadStudentProfileAndData(auth.currentUser.uid, auth.institutionId);
          this._renderStudentDashboard();
          break;
          
        default:
          throw new Error("Unauthorized or undefined application authorization role.");
      }
    } catch (err) {
      console.error("[DashboardEngine Crash]:", err);
      window.UI.showToast("Failed to compile dashboard metrics.", "error");
    } finally {
      this.state.loading = false;
    }
  },

  // ── Data Fetchers (Leveraging Native Persistence) ──────────────────

  /** Gather global data maps across all partitions (Super Admin View) */
  async _loadSuperAdminMetrics() {
    // Firestore native cache matches these instantly
    const campusSnap  = await getDocs(query(collection(db, 'institutions'), where('isDeleted', '==', false)));
    const studentSnap = await getDocs(query(collection(db, 'students'), where('isDeleted', '==', false)));
    const teacherSnap = await getDocs(query(collection(db, 'teachers'), where('isDeleted', '==', false)));
    const subjectSnap = await getDocs(query(collection(db, 'subjects'), where('isDeleted', '==', false)));
    const examSnap    = await getDocs(query(collection(db, 'exams'), where('isDeleted', '==', false), where('publishStatus', '==', 'PUBLISHED')));

    this.state.metrics = {
      totalCampuses: campusSnap.size,
      totalStudents: studentSnap.size,
      totalTeachers: teacherSnap.size,
      totalSubjects: subjectSnap.size,
      activeExams:   examSnap.size
    };
  },

  /** Gather localized metrics restricted to a specific campus (Institution Admin View) */
  async _loadInstitutionMetrics(institutionId) {
    const studentQ = query(collection(db, 'students'), where('institutionId', '==', institutionId), where('isDeleted', '==', false));
    const teacherQ = query(collection(db, 'teachers'), where('institutionId', '==', institutionId), where('isDeleted', '==', false));
    const examQ    = query(collection(db, 'exams'), where('institutionId', '==', institutionId), where('isDeleted', '==', false));
    const subjectQ = query(collection(db, 'subjects'), where('isDeleted', '==', false)); // Subjects are global

    const [studentSnap, teacherSnap, examSnap, subjectSnap] = await Promise.all([
      getDocs(studentQ),
      getDocs(teacherQ),
      getDocs(examQ),
      getDocs(subjectQ)
    ]);

    this.state.metrics = {
      totalCampuses: 1,
      totalStudents: studentSnap.size,
      totalTeachers: teacherSnap.size,
      totalSubjects: subjectSnap.size,
      activeExams:   examSnap.size
    };
  },

  /** Gather profile data specific to a logged-in student (Student View) */
  async _loadStudentProfileAndData(studentId, institutionId) {
    // 1. Load basic candidate card metrics
    const studentDocRef = doc(db, 'students', studentId);
    const docSnap = await getDoc(studentDocRef);
    
    if (docSnap.exists()) {
      this.state.studentProfile = docSnap.data();
    } else {
      // Fallback fallback array if document key initialization varies
      this.state.studentProfile = {
        name: window.AuthModule.currentUser.displayName || "Academic Candidate",
        registerNumber: "PENDING_VERIFICATION",
        batch: "N/A"
      };
    }

    // 2. Load their dynamic pending supplementary eligibility flags out of processed results subcollections
    if (this.state.studentProfile.batch) {
      const recordsRef = collection(db, 'processed_results', this.state.studentProfile.batch, 'records');
      const supplyQuery = query(recordsRef, where('studentId', '==', studentId), where('supplyEligible', '==', true));
      const supplySnap = await getDocs(supplyQuery);
      
      this.state.studentProfile.pendingSupplementsCount = supplySnap.size;
    }
  },

  // ── Rendering Matrices ──────────────────────────────────────────────

  _renderContainerSkeleton() {
    const container = document.getElementById('main-content') || document.getElementById('main-content');
    if (!container) return;
    container.innerHTML = `
      <div style="padding: 20px;">
        <div class="skeleton-loader" style="height: 40px; width: 30%; margin-bottom: 20px; border-radius:6px;"></div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px;">
          <div class="skeleton-loader" style="height: 120px; border-radius:8px;"></div>
          <div class="skeleton-loader" style="height: 120px; border-radius:8px;"></div>
          <div class="skeleton-loader" style="height: 120px; border-radius:8px;"></div>
        </div>
      </div>
    `;
  },

  _renderSuperAdminDashboard() {
    const container = document.getElementById('main-content') || document.getElementById('app-content');
    const m = this.state.metrics;

    container.innerHTML = `
      <div class="dashboard-wrapper" style="padding: 25px; animation: fadeIn 0.3s ease-out;">
        <div class="dash-header" style="margin-bottom: 25px;">
          <h2 style="font-weight: 700; color: var(--text-primary);">System Overlord Command Console</h2>
          <p style="color: var(--text-secondary); font-size: 14px;">Global institutional infrastructure master parameters.</p>
        </div>

        <div class="metrics-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px;">
          ${this._buildMetricCard("Total Active Campuses", m.totalCampuses, "fa-university", "linear-gradient(135deg, #2c3e50, #3498db)")}
          ${this._buildMetricCard("System Enrolled Students", m.totalStudents, "fa-users", "linear-gradient(135deg, #16a085, #2ecc71)")}
          ${this._buildMetricCard("Verified Educators", m.totalTeachers, "fa-graduation-cap", "linear-gradient(135deg, #d35400, #e67e22)")}
          ${this._buildMetricCard("Curriculum Course Masters", m.totalSubjects, "fa-book", "linear-gradient(135deg, #7f8c8d, #95a5a6)")}
        </div>

        <div class="quick-actions" style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 8px; border: 1px solid var(--border);">
          <h4 style="margin-bottom: 15px; font-size: 16px; font-weight: 600;"><i class="fa fa-sliders" style="margin-right: 8px;"></i> Accelerated Management Pipelines</h4>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm" onclick="window.RoutingEngine?.navigate('institutions')"><i class="fa fa-plus"></i> Provision New Campus</button>
            <button class="btn btn-secondary btn-sm" onclick="window.RoutingEngine?.navigate('subjects')"><i class="fa fa-book"></i> Modify Course Masters</button>
          </div>
        </div>
      </div>
    `;
  },

  _renderInstitutionDashboard() {
    const container = document.getElementById('main-content') || document.getElementById('app-content');
    const m = this.state.metrics;
    const campusName = window.AuthModule?.institutionName || "Branch HQ Campus";

    container.innerHTML = `
      <div class="dashboard-wrapper" style="padding: 25px; animation: fadeIn 0.3s ease-out;">
        <div class="dash-header" style="margin-bottom: 25px;">
          <h2 style="font-weight: 700; color: var(--text-primary);">${campusName}</h2>
          <p style="color: var(--text-secondary); font-size: 14px;">Campus Administration & Evaluation Dashboard.</p>
        </div>

        <div class="metrics-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px;">
          ${this._buildMetricCard("Enrolled Candidates", m.totalStudents, "fa-user-graduation", "linear-gradient(135deg, #1e3c72, #2a5298)")}
          ${this._buildMetricCard("Campus Faculty Staff", m.totalTeachers, "fa-chalkboard-teacher", "linear-gradient(135deg, #11998e, #38ef7d)")}
          ${this._buildMetricCard("Total Examinations Run", m.activeExams, "fa-file-alt", "linear-gradient(135deg, #8a2387, #e94057)")}
        </div>

        <div class="quick-actions" style="background: rgba(0,0,0,0.15); padding: 20px; border-radius: 8px; border: 1px solid var(--border);">
          <h4 style="margin-bottom: 15px; font-size: 16px; font-weight: 600;"><i class="fa fa-bolt" style="margin-right: 8px;"></i> Evaluation Tasks</h4>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button class="btn btn-gold btn-sm" onclick="window.RoutingEngine?.navigate('mark-entry')"><i class="fa fa-edit"></i> Launch Score Terminal</button>
            <button class="btn btn-primary btn-sm" onclick="window.RoutingEngine?.navigate('students')"><i class="fa fa-user-plus"></i> Student Roster</button>
            <button class="btn btn-secondary btn-sm" onclick="window.RoutingEngine?.navigate('supplementary')"><i class="fa fa-receipt"></i> Supplementary Portal</button>
          </div>
        </div>
      </div>
    `;
  },

  _renderStudentDashboard() {
    const container = document.getElementById('main-content') || document.getElementById('app-content');
    const profile = this.state.studentProfile;
    const hasSupplyAlert = profile.pendingSupplementsCount > 0;

    container.innerHTML = `
      <div class="dashboard-wrapper" style="padding: 25px; animation: fadeIn 0.3s ease-out;">
        <div class="dash-header" style="margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
          <div>
            <h2 style="font-weight: 700; color: var(--accent-gold);">Welcome back, ${profile.name}</h2>
            <p style="color: var(--text-secondary); font-size: 14px;">Student Self-Service Portal Profile Matrix.</p>
          </div>
          <div style="background: rgba(255,255,255,0.05); padding: 10px 20px; border-radius: 30px; border: 1px solid var(--border); font-size: 13px;">
            <strong style="color: var(--text-primary);">Batch Track:</strong> ${profile.batch || 'Unassigned'}
          </div>
        </div>

        ${hasSupplyAlert ? `
          <div class="alert-banner-supply" style="background: linear-gradient(90deg, rgba(231,76,60,0.2), rgba(231,76,60,0.05)); border-left: 5px solid #e74c3c; padding: 20px; border-radius: 6px; margin-bottom: 25px; display: flex; align-items: center; justify-content: space-between; gap: 15px; border: 1px solid rgba(231,76,60,0.3); border-left-width: 5px;">
            <div>
              <h4 style="color: #e74c3c; margin: 0 0 5px 0; font-weight: 600;"><i class="fa fa-exclamation-triangle"></i> Action Required: Supplementary Papers Detected</h4>
              <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">You have ${profile.pendingSupplementsCount} failed item components eligible for supplementary scheduling re-registrations.</p>
            </div>
            <button class="btn btn-rose btn-sm" style="white-space: nowrap;" onclick="window.RoutingEngine?.navigate('supplementary')">Pay & Register Now</button>
          </div>
        ` : `
          <div class="alert-banner-clear" style="background: linear-gradient(90deg, rgba(46,204,113,0.15), rgba(46,204,113,0.02)); border-left: 5px solid #2ecc71; padding: 15px; border-radius: 6px; margin-bottom: 25px; border: 1px solid rgba(46,204,113,0.2); border-left-width: 5px; font-size:13px; color: var(--text-secondary);">
            <i class="fa fa-check-circle" style="color: #2ecc71; margin-right: 6px;"></i> Standing Status Account Clear: No supplementary actions currently pending tracking.
          </div>
        `}

        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 20px; class="student-workspace-layout">
          
          <div class="info-card" style="background: rgba(0,0,0,0.15); border: 1px solid var(--border); padding: 20px; border-radius: 8px;">
            <h4 style="margin-bottom: 15px; font-weight: 600; border-bottom: 1px solid var(--border); padding-bottom: 8px; font-size:14px;"><i class="fa fa-id-badge"></i> Identification Credentials</h4>
            <p style="font-size:13px; margin-bottom:8px;"><span class="text-secondary">Register No:</span> <strong style="color: var(--text-primary); float: right;">${profile.registerNumber || profile.regNo || 'N/A'}</strong></p>
            <p style="font-size:13px; margin-bottom:8px;"><span class="text-secondary">Email Parameter:</span> <strong style="color: var(--text-primary); float: right; font-size:11px;">${window.AuthModule?.currentUser?.email || 'N/A'}</strong></p>
            <p style="font-size:13px; margin-bottom:0;"><span class="text-secondary">System Profile ID:</span> <strong style="color: var(--text-primary); float: right; font-size:10px;">${profile.id || window.AuthModule?.currentUser?.uid}</strong></p>
          </div>

          <div class="actions-card" style="background: rgba(0,0,0,0.15); border: 1px solid var(--border); padding: 20px; border-radius: 8px; display: flex; flex-direction: column; justify-content: center;">
            <h4 style="margin-bottom: 15px; font-weight: 600; font-size:14px;"><i class="fa fa-compass"></i> Workspace Shortcuts</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
              <div style="background: rgba(255,255,255,0.02); padding: 15px; border-radius: 6px; border: 1px solid var(--border); cursor: pointer;" onclick="window.RoutingEngine?.navigate('analysis')">
                <h5 style="color: var(--accent-gold); font-size: 14px; margin: 0 0 5px 0;"><i class="fa fa-chart-line"></i> Performance Analytics</h5>
                <p style="margin:0; font-size:11px; color: var(--text-secondary);">Review marked score matrix components and criteria charts.</p>
              </div>
              <div style="background: rgba(255,255,255,0.02); padding: 15px; border-radius: 6px; border: 1px solid var(--border); cursor: pointer;" onclick="window.RoutingEngine?.navigate('revaluation')">
                <h5 style="color: var(--accent-gold); font-size: 14px; margin: 0 0 5px 0;"><i class="fa fa-balance-scale"></i> Revaluation Requests</h5>
                <p style="margin:0; font-size:11px; color: var(--text-secondary);">File evaluation tracking requests against finalized items.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // ── Reusable Component Sub-Blocks ─────────────────────────────────

  _buildMetricCard(title, val, icon, backgroundStyle) {
    return `
      <div class="metric-card" style="
        background: ${backgroundStyle};
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #ffffff;
      ">
        <div>
          <span style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8; display: block; margin-bottom: 5px;">${title}</span>
          <strong style="font-size: 28px; font-weight: 700; line-height: 1;">${val}</strong>
        </div>
        <div class="metric-icon" style="opacity: 0.3; font-size: 32px;">
          <i class="fa ${icon}"></i>
        </div>
      </div>
    `;
  }
};

// Bind to window layout frames seamlessly
window.DashboardApp = DashboardModule;