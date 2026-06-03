// modules/exams.js
import { db, collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, where, getDoc, setDoc } from '../services/firebase.js';

export const ExamModule = {
  state: {
    exams: [],
    subjects: [], 
    loading: false
  },

  async fetchExams() {
  this.state.loading = true;
  this.renderSkeleton();

  try {
    const auth = window.AuthModule;
    
    // 1. Build a streamlined query array for Exams
    const examConstraints = [];
    
    // Rule: Campus Admins only get their own data, Super Admins can look at all campuses
    if (auth?.currentRole !== 'super_admin') {
      examConstraints.push(where('institutionId', '==', auth.institutionId));
    }
    
    // Filter out deleted items safely
    examConstraints.push(where('isDeleted', '==', false));

    // 2. Fetch Exams (Firestore automatically queries its local IndexedDB persistence first)
    const examQuery = query(collection(db, 'exams'), ...examConstraints);
    const examSnap = await getDocs(examQuery);
    
    // Map data to state
    this.state.exams = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 3. Fetch Active Subjects (Utilizing persistent memory instantly as well)
    const subjectQuery = query(collection(db, 'subjects'), where('isDeleted', '==', false));
    const subSnap = await getDocs(subjectQuery);
    
    this.state.subjects = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  } catch (e) {
    console.error("Firestore persistence fetch failed:", e);
    window.UI.showToast("Failed to load records from database storage.", "error");
  } finally {
    this.state.loading = false;
    
    // Render the table smoothly using the state arrays populated by Firestore
    this.renderTable(this.state.exams);
  }
},

  openAddModal() {
    if (window.AuthModule.currentRole !== 'super_admin') {
      return window.UI.showToast("Only Super Admins can create exams.", "error");
    }

    const body = `
      <div class="form-floating">
        <input id="new-exam-name" placeholder="Name" value="Semester 1 Finals">
        <label>Exam Name</label>
      </div>
      <div class="form-floating">
        <input id="new-exam-batch" placeholder="Batch" value="2024-2027">
        <label>Target Batch</label>
      </div>
    `;

    const footer = `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Cancel</button>
      <button class="btn btn-gold" onclick="window.ExamApp.submitNew()">Create Global Exam</button>
    `;

    window.UI.openModal('Create New Centralized Examination', body, footer);
  },

  async submitNew() {
    const examName = document.getElementById('new-exam-name').value.trim();
    const batch = document.getElementById('new-exam-batch').value.trim();

    if (!examName || !batch) return window.UI.showToast("Please fill all fields.", "error");

    // 2. Custom document ID creation combining Trimmed Exam Name and Batch to prevent duplication
    const docId = `${examName}_${batch}`.replace(/\s+/g, '');

    try {
      const docRef = doc(db, 'exams', docId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const existingData = docSnap.data();
        if (!existingData.isDeleted) {
          return window.UI.showToast("An exam record already exists with this identical name and batch configuration.", "error");
        }
      }

      const payload = {
        Id: docId,
        examName,
        batch,
        publishStatus: 'DRAFT', 
        schedule: [], 
        isDeleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: window.AuthModule.currentUser.email
      };

      // Set explicit document tracking ID instead of generating an auto push ID
      await setDoc(docRef, payload);
      window.UI.showToast("Global Exam created successfully!", "success");
      window.UI.closeModal();
      this.fetchExams();
    } catch (error) {
      window.UI.showToast("Error: " + error.message, "error");
    }
  },

  openTimetableModal(examId) {
    const exam = this.state.exams.find(e => e.id === examId);
    if (!exam) return;
    const isSuper = window.AuthModule.currentRole === 'super_admin';

    const subOptions = this.state.subjects.map(s => `<option value="${s.subjectCode}|${s.subjectName}">${s.subjectCode} - ${s.subjectName}</option>`).join('');

    const existingScheduleHtml = exam.schedule.length === 0 
      ? `<p class="text-secondary" style="font-size:12px;">No subjects scheduled yet.</p>`
      : `<table style="margin-bottom: 20px; font-size: 13px; width: 100%;">
          <thead>
            <tr>
              <th>Date / Session</th>
              <th>Subject</th>
              <th>DESC (Max/Pass)</th>
              <th>OMR (Max/Pass)</th>
              <th>CE (Max/Pass)</th>
              ${isSuper && exam.publishStatus === 'DRAFT' ? '<th>Action</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${exam.schedule.map((item, index) => {
              const crit = item.markCriteria || { descMax: 50, descPass: 20, omrMax: 20, omrPass: 8, ceMax: 30, cePass: 12 };
              return `
                <tr>
                  <td><strong>${item.date}</strong><br><small class="text-secondary">${item.session}</small></td>
                  <td><strong>${item.subjectCode}</strong><br><small>${item.subjectName}</small></td>
                  <td>${crit.descMax} / <span class="text-success">${crit.descPass}</span></td>
                  <td>${crit.omrMax} / <span class="text-success">${crit.omrPass}</span></td>
                  <td>${crit.ceMax} / <span class="text-success">${crit.cePass}</span></td>
                  ${isSuper && exam.publishStatus === 'DRAFT' ? `<td><button class="btn btn-danger btn-sm" onclick="window.ExamApp.removeScheduleItem('${exam.id}', ${index})"><i class="fa fa-times"></i></button></td>` : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
         </table>`;

    // 1. Added a scroll layer wrapper container around the content body 
    const body = `
      <div style="max-height: 65vh; overflow-y: auto; overflow-x: hidden; padding-right: 8px;">
        <div style="background: var(--surface2); padding: 15px; border-radius: 10px; margin-bottom: 20px;">
          <h4 style="margin-bottom: 5px;">${exam.examName}</h4>
          <div style="font-size:12px; color:var(--text-secondary);">Batch: ${exam.batch} | Status: ${exam.publishStatus}</div>
        </div>
        
        <div id="timetable-list" style="overflow-x:auto; margin-bottom: 20px;">${existingScheduleHtml}</div>

        ${isSuper && exam.publishStatus === 'DRAFT' ? `
          <div style="border-top: 1px solid var(--border); padding-top: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="form-floating"><input type="date" id="tt-date"><label>Date</label></div>
            <div class="form-floating">
              <select id="tt-session"><option value="FN (9:30 AM)">Forenoon (FN)</option><option value="AN (1:30 PM)">Afternoon (AN)</option></select>
              <label>Session</label>
            </div>
            <div class="form-floating" style="grid-column: span 2;">
              <select id="tt-subject"><option value="">-- Select Subject --</option>${subOptions}</select>
              <label>Subject</label>
            </div>
            
            <div style="grid-column: span 2; background: rgba(0,0,0,0.1); padding: 10px; border-radius: 6px; display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 5px;">
              <div style="grid-column: span 2; font-size:12px; font-weight:bold; color:var(--text-secondary);">Subject Mark Evaluation Criteria</div>
              <div><input type="number" id="crit-desc-max" class="grid-input" value="50" placeholder="DESC Max"><small style="font-size:10px;color:var(--text-secondary)">DESC Max</small></div>
              <div><input type="number" id="crit-desc-pass" class="grid-input" value="20" placeholder="DESC Pass"><small style="font-size:10px;color:var(--text-secondary)">DESC Pass</small></div>
              
              <div><input type="number" id="crit-omr-max" class="grid-input" value="20" placeholder="OMR Max"><small style="font-size:10px;color:var(--text-secondary)">OMR Max</small></div>
              <div><input type="number" id="crit-omr-pass" class="grid-input" value="8" placeholder="OMR Pass"><small style="font-size:10px;color:var(--text-secondary)">OMR Pass</small></div>
              
              <div><input type="number" id="crit-ce-max" class="grid-input" value="30" placeholder="CE Max"><small style="font-size:10px;color:var(--text-secondary)">CE Max</small></div>
              <div><input type="number" id="crit-ce-pass" class="grid-input" value="12" placeholder="CE Pass"><small style="font-size:10px;color:var(--text-secondary)">CE Pass</small></div>
            </div>

            <button class="btn btn-outline" style="grid-column: span 2; justify-content:center; margin-top:10px;" onclick="window.ExamApp.addScheduleItem('${exam.id}')">
              <i class="fa fa-plus"></i> Add to Schedule
            </button>
          </div>
        ` : (isSuper ? `<div class="badge badge-teal" style="display:block; text-align:center;">Timetable is Published. Editing locked.</div>` : '')}
      </div>
    `;

    const footer = `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Close</button>
      ${isSuper && exam.publishStatus === 'DRAFT' && exam.schedule.length > 0 ? 
        `<button class="btn btn-gold" onclick="window.ExamApp.publishTimetable('${exam.id}')"><i class="fa fa-bullhorn"></i> Publish Timetable</button>` 
      : ''}
    `;

    window.UI.openModal(isSuper ? 'Manage Timetable' : 'View Timetable', body, footer);
  },

  async addScheduleItem(examId) {
    const exam = this.state.exams.find(e => e.id === examId);
    const date = document.getElementById('tt-date').value;
    const session = document.getElementById('tt-session').value;
    const subData = document.getElementById('tt-subject').value;

    if (!date || !subData) return window.UI.showToast("Select date and subject.", "error");

    const [subjectCode, subjectName] = subData.split('|');
    if (exam.schedule.find(s => s.subjectCode === subjectCode)) return window.UI.showToast("Subject already scheduled.", "error");

    const markCriteria = {
      descMax: parseFloat(document.getElementById('crit-desc-max').value) || 0,
      descPass: parseFloat(document.getElementById('crit-desc-pass').value) || 0,
      omrMax: parseFloat(document.getElementById('crit-omr-max').value) || 0,
      omrPass: parseFloat(document.getElementById('crit-omr-pass').value) || 0,
      ceMax: parseFloat(document.getElementById('crit-ce-max').value) || 0,
      cePass: parseFloat(document.getElementById('crit-ce-pass').value) || 0
    };

    const updatedSchedule = [...exam.schedule, { date, session, subjectCode, subjectName, markCriteria }];
    try {
      await updateDoc(doc(db, 'exams', examId), { schedule: updatedSchedule, updatedAt: serverTimestamp() });
      exam.schedule = updatedSchedule; 
      this.openTimetableModal(examId); 
      window.UI.showToast("Added to schedule complete with structural criteria rules.", "success");
    } catch(e) { window.UI.showToast("Error updating schedule", "error"); }
  },

  async removeScheduleItem(examId, index) {
    const exam = this.state.exams.find(e => e.id === examId);
    const updatedSchedule = exam.schedule.filter((_, i) => i !== index);
    try {
      await updateDoc(doc(db, 'exams', examId), { schedule: updatedSchedule, updatedAt: serverTimestamp() });
      exam.schedule = updatedSchedule;
      this.openTimetableModal(examId); 
    } catch(e) { window.UI.showToast("Error removing item", "error"); }
  },

  async publishTimetable(examId) {
    if(!confirm("Publishing will lock this exam globally for all campuses. Proceed?")) return;
    try {
      await updateDoc(doc(db, 'exams', examId), { publishStatus: 'TIMETABLE_PUBLISHED', updatedAt: serverTimestamp() });
      window.UI.showToast("Timetable Published Globally!", "success");
      window.UI.closeModal();
      this.fetchExams();
    } catch(e) { window.UI.showToast("Error publishing", "error"); }
  },

  async softDeleteExam(id) {
    if(!confirm("Delete this global exam? This affects all institutions.")) return;
    try {
      await updateDoc(doc(db, 'exams', id), { isDeleted: true, updatedAt: serverTimestamp() });
      window.UI.showToast("Exam deleted.", "success");
      this.fetchExams();
    } catch(e) { window.UI.showToast("Action denied.", "error"); }
  },

  renderTable(data) {
    const container = document.getElementById('exam-table-body');
    if(!container) return;
    const isSuper = window.AuthModule.currentRole === 'super_admin';

    if(data.length === 0) {
      container.innerHTML = `<tr><td colspan="5" class="empty-state">No exams found.</td></tr>`;
      return;
    }

    container.innerHTML = data.map(ex => `
      <tr>
        <td><strong>${ex.examName}</strong></td>
        <td>${ex.batch}</td>
        <td>${ex.schedule.length} Subjects</td>
        <td>
          <span class="badge ${ex.publishStatus === 'DRAFT' ? 'badge-rose' : 'badge-teal'}">
            ${ex.publishStatus.replace('_', ' ')}
          </span>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.ExamApp.openTimetableModal('${ex.id}')" title="View Timetable">
            <i class="fa ${isSuper && ex.publishStatus === 'DRAFT' ? 'fa-calendar-plus' : 'fa-calendar-days'}"></i>
          </button>
          ${isSuper && ex.publishStatus === 'DRAFT' ? `
            <button class="btn btn-danger btn-sm" onclick="window.ExamApp.softDeleteExam('${ex.id}')">
              <i class="fa fa-trash"></i>
            </button>
          ` : (isSuper ? `<button class="btn btn-outline btn-sm" disabled title="Locked"><i class="fa fa-lock"></i></button>` : '')}
        </td>
      </tr>
    `).join('');
  },

  renderSkeleton() {
    const container = document.getElementById('exam-table-body');
    if(container) container.innerHTML = Array(3).fill(`<tr><td colspan="5"><div class="skeleton-loader" style="height: 48px; width: 100%;"></div></td></tr>`).join('');
  }
};