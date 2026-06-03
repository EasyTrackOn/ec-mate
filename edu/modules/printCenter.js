// modules/printCenter.js
import { db, collection, getDocs, query, where, doc, getDoc } from '../services/firebase.js';

export const PrintCenterModule = {
  state: {
    exams: [],
    loading: false
  },

  async init(institutionId) {
    this.state.loading = true;
    try {
      // Fetch Published Exams
      const examSnap = await getDocs(query(
        collection(db, 'exams'), 
        where('institutionId', '==', institutionId),
        where('publishStatus', 'in', ['TIMETABLE_PUBLISHED', 'RESULTS_PUBLISHED']),
        where('isDeleted', '==', false)
      ));
      this.state.exams = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      this.renderControls();
    } catch (e) {
      window.UI.showToast("Failed to load Print Center.", "error");
    }
    this.state.loading = false;
  },

  async generateDocument(type) {
    const examId = document.getElementById('print-exam-select').value;
    if (!examId) {
      window.UI.showToast("Please select an exam first.", "error");
      return;
    }

    const btn = document.getElementById(`btn-print-${type}`);
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> Generating...`;

    try {
      const selectedExam = this.state.exams.find(e => e.id === examId);
      
      // Fetch Students for this exam
      const studentSnap = await getDocs(query(
        collection(db, 'students'),
        where('institutionId', '==', selectedExam.institutionId),
        where('batch', '==', selectedExam.batch)
      ));
      const students = studentSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (type === 'hallticket') {
        if (selectedExam.publishStatus === 'DRAFT') throw new Error("Timetable not published yet.");
        await this.printHallTickets(selectedExam, students);
      } else if (type === 'marksheet') {
        if (selectedExam.publishStatus !== 'RESULTS_PUBLISHED') throw new Error("Results are not published yet.");
        await this.printMarksheets(selectedExam, students);
      }

    } catch (e) {
      window.UI.showToast(e.message, "error");
    } finally {
      btn.innerHTML = originalText;
    }
  },

  async printHallTickets(exam, students) {
    // Generate the HTML for all hall tickets (page breaks between each)
    const printWindow = window.open('', '_blank');
    let html = this.getPrintHeader('Hall Tickets');

    students.forEach((student, index) => {
      const scheduleHtml = exam.schedule.map(s => `
        <tr>
          <td>${s.date}</td>
          <td>${s.session}</td>
          <td>${s.subjectCode}</td>
          <td>${s.subjectName}</td>
        </tr>
      `).join('');

      html += `
        <div class="print-page">
          <div class="document-header">
            <h2>ELITE SHE CAMPUS</h2>
            <h3>OFFICIAL HALL TICKET</h3>
            <p>${exam.examName} - Batch: ${exam.batch}</p>
          </div>
          <div class="student-info" style="margin-top: 30px;">
            <p><strong>Candidate Name:</strong> ${student.candidateName}</p>
            <p><strong>Register Number:</strong> ${student.registerNumber}</p>
          </div>
          <table class="print-table" style="margin-top: 20px;">
            <thead><tr><th>Date</th><th>Session</th><th>Code</th><th>Subject</th></tr></thead>
            <tbody>${scheduleHtml}</tbody>
          </table>
          <div style="margin-top: 60px; display: flex; justify-content: space-between;">
            <div style="border-top: 1px solid #000; padding-top: 5px;">Candidate Signature</div>
            <div style="border-top: 1px solid #000; padding-top: 5px;">Controller of Examinations</div>
          </div>
        </div>
      `;
    });

    html += `</body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    
    // Trigger print automatically after images/CSS load
    setTimeout(() => { printWindow.print(); }, 500);
  },

  getPrintHeader(title) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: 'Arial', sans-serif; color: #000; background: #fff; margin: 0; padding: 0; }
          .print-page { page-break-after: always; padding: 40px; box-sizing: border-box; position: relative; height: 100vh; }
          .print-page:last-child { page-break-after: auto; }
          .document-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .document-header h2 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px; }
          .document-header h3 { margin: 5px 0; font-size: 16px; color: #444; }
          .print-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          .print-table th, .print-table td { border: 1px solid #000; padding: 10px; text-align: left; font-size: 14px; }
          .print-table th { background: #f0f0f0; }
          @media print {
            body { -webkit-print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
    `;
  },

  renderControls() {
    const container = document.getElementById('print-controls');
    if (!container) return;

    const examOptions = this.state.exams.map(e => 
      `<option value="${e.id}">${e.examName} (${e.batch}) - ${e.publishStatus}</option>`
    ).join('');

    container.innerHTML = `
      <div class="form-floating" style="max-width: 400px; margin-bottom: 30px;">
        <select id="print-exam-select">
          <option value="">-- Select Exam Batch --</option>
          ${examOptions}
        </select>
        <label>Target Examination</label>
      </div>

      <div class="stat-grid">
        <div class="card-glass" style="text-align: center; padding: 30px;">
          <i class="fa fa-ticket" style="font-size: 40px; color: var(--accent-gold); margin-bottom: 15px;"></i>
          <h4 style="margin-bottom: 10px;">Hall Tickets</h4>
          <p class="text-secondary" style="font-size: 12px; margin-bottom: 20px;">Generate standard hall tickets with exam schedules and signature lines.</p>
          <button id="btn-print-hallticket" class="btn btn-outline" style="width: 100%;" onclick="window.PrintApp.generateDocument('hallticket')">Generate PDF</button>
        </div>
        
        <div class="card-glass" style="text-align: center; padding: 30px;">
          <i class="fa fa-award" style="font-size: 40px; color: var(--success); margin-bottom: 15px;"></i>
          <h4 style="margin-bottom: 10px;">Official Marksheets</h4>
          <p class="text-secondary" style="font-size: 12px; margin-bottom: 20px;">Generate physical result sheets for students (Requires Published Results).</p>
          <button id="btn-print-marksheet" class="btn btn-gold" style="width: 100%;" onclick="window.PrintApp.generateDocument('marksheet')">Generate PDF</button>
        </div>
      </div>
    `;
  }
};