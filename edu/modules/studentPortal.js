// modules/studentPortal.js
//import { CacheEngine } from '../utils/localDb.js';
import { db, collection, getDocs, query, where, doc, getDoc } from '../services/firebase.js';

export const StudentPortalModule = {
  state: {
    studentProfile: null,
    timetables: [],
    results: [],
    revaluations: [],
    loading: false
  },

  async init(studentId) {
    this.state.loading = true;
    this.renderSkeleton();

    try {
      // 1. Fetch Student Profile
      const studentRef = doc(db, 'students', studentId);
      const studentSnap = await getDoc(studentRef);
      if (studentSnap.exists()) {
        this.state.studentProfile = { id: studentSnap.id, ...studentSnap.data() };
      }

      if (this.state.studentProfile) {
        // Fetch everything else concurrently for maximum speed
        await Promise.all([
          this.fetchTimetables(),
          this.fetchResults(),
          this.fetchRevaluations()
        ]);
      }
      
      this.renderDashboard();
    } catch (e) {
      window.UI.showToast("Failed to load student portal.", "error");
    }
    this.state.loading = false;
  },

  async fetchTimetables() {
    const q = query(
      collection(db, 'exams'),
      where('institutionId', '==', this.state.studentProfile.institutionId),
      where('batch', '==', this.state.studentProfile.batch),
      where('publishStatus', 'in', ['TIMETABLE_PUBLISHED', 'RESULTS_PUBLISHED']),
      where('isDeleted', '==', false)
    );
    const snap = await getDocs(q);
    this.state.timetables = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async fetchResults() {
    const q = query(
      collection(db, 'processed_results'),
      where('studentId', '==', this.state.studentProfile.id)
    );
    const snap = await getDocs(q);
    this.state.results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async fetchRevaluations() {
    const q = query(
      collection(db, 'revaluation_requests'),
      where('studentId', '==', this.state.studentProfile.id)
    );
    const snap = await getDocs(q);
    this.state.revaluations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  downloadHallTicket(examId) {
    const exam = this.state.timetables.find(e => e.id === examId);
    if (!exam) return;
    
    // Borrowing the print engine logic we built earlier, localized for a single student
    const printWindow = window.open('', '_blank');
    const scheduleHtml = exam.schedule.map(s => `
      <tr>
        <td style="border: 1px solid #000; padding: 10px;">${s.date}</td>
        <td style="border: 1px solid #000; padding: 10px;">${s.session}</td>
        <td style="border: 1px solid #000; padding: 10px;">${s.subjectCode}</td>
        <td style="border: 1px solid #000; padding: 10px;">${s.subjectName}</td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Hall Ticket - ${this.state.studentProfile.registerNumber}</title>
        <style>body { font-family: sans-serif; padding: 40px; color: #000; background: #fff; }</style>
      </head>
      <body>
        <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px;">
          <h2 style="margin: 0; text-transform: uppercase; letter-spacing: 2px;">ELITE SHE CAMPUS</h2>
          <h3 style="margin: 5px 0;">HALL TICKET - ${exam.examName}</h3>
        </div>
        <div style="margin-top: 30px;">
          <p><strong>Candidate Name:</strong> ${this.state.studentProfile.candidateName}</p>
          <p><strong>Register Number:</strong> ${this.state.studentProfile.registerNumber}</p>
          <p><strong>Batch:</strong> ${this.state.studentProfile.batch}</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="border: 1px solid #000; padding: 10px; text-align: left;">Date</th>
              <th style="border: 1px solid #000; padding: 10px; text-align: left;">Session</th>
              <th style="border: 1px solid #000; padding: 10px; text-align: left;">Code</th>
              <th style="border: 1px solid #000; padding: 10px; text-align: left;">Subject</th>
            </tr>
          </thead>
          <tbody>${scheduleHtml}</tbody>
        </table>
      </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  },

  renderDashboard() {
    const container = document.getElementById('student-portal-content');
    if (!container || !this.state.studentProfile) return;

    const p = this.state.studentProfile;
    
    // Quick calculations
    const latestResult = this.state.results.length > 0 ? this.state.results[0] : null;

    container.innerHTML = `
      <div class="card-glass flex-between" style="margin-bottom: 24px; align-items: center;">
        <div style="display: flex; gap: 20px; align-items: center;">
          <div class="user-avatar" style="width: 64px; height: 64px; font-size: 24px;">${p.candidateName.charAt(0)}</div>
          <div>
            <h3 style="margin-bottom: 4px; color: var(--accent-gold);">${p.candidateName}</h3>
            <p class="text-secondary" style="font-size: 14px;">Reg No: <strong>${p.registerNumber}</strong> | Batch: ${p.batch}</p>
          </div>
        </div>
        <span class="badge ${p.status === 'ACTIVE' ? 'badge-teal' : 'badge-rose'}">${p.status}</span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
        
        <div class="card-glass">
          <h4 style="margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Upcoming Exams</h4>
          ${this.state.timetables.length === 0 ? '<p class="text-secondary" style="font-size: 13px;">No upcoming exams published.</p>' : ''}
          
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${this.state.timetables.map(exam => `
              <div style="background: var(--surface2); padding: 16px; border-radius: 8px;">
                <div class="flex-between" style="margin-bottom: 12px;">
                  <strong style="color: var(--text-primary);">${exam.examName}</strong>
                  <button class="btn btn-gold btn-sm" onclick="window.StudentPortalApp.downloadHallTicket('${exam.id}')"><i class="fa fa-download"></i> Hall Ticket</button>
                </div>
                <div style="font-size: 12px; color: var(--text-secondary);">
                  ${exam.schedule.length} Subjects Scheduled
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card-glass">
          <h4 style="margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">My Results</h4>
          ${this.state.results.length === 0 ? '<p class="text-secondary" style="font-size: 13px;">No results published yet.</p>' : ''}
          
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${this.state.results.map(res => `
              <div style="background: var(--surface2); padding: 16px; border-radius: 8px; border-left: 4px solid ${res.result === 'PASSED' ? 'var(--success)' : 'var(--danger)'};">
                <div class="flex-between" style="margin-bottom: 8px;">
                  <strong>Total: ${res.total}</strong>
                  <span class="badge ${res.result === 'PASSED' ? 'badge-teal' : 'badge-rose'}">${res.result}</span>
                </div>
                <div style="font-size: 12px; color: var(--text-secondary);">
                  Rank: #${res.rank || 'N/A'} | Failed Subjects: ${res.failedCount}
                </div>
                <div style="margin-top: 12px;">
                  ${res.subjects.map(s => `<div style="display:flex; justify-content:space-between; font-size:12px; border-top:1px solid var(--border); padding-top:4px; margin-top:4px;">
                    <span>${s.code}</span>
                    <strong style="color: ${s.isPass ? 'var(--success)' : 'var(--danger)'}">${s.mark} (${s.grade})</strong>
                  </div>`).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

      </div>
    `;
  },

  renderSkeleton() {
    const container = document.getElementById('student-portal-content');
    if (container) container.innerHTML = `<div class="skeleton-loader" style="height: 100px; width: 100%; margin-bottom:24px;"></div><div class="skeleton-loader" style="height: 300px; width: 100%;"></div>`;
  }
};