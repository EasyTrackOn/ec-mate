// modules/revaluations.js
//import { CacheEngine } from '../utils/localDb.js';
import { db, collection, getDocs, query, where, writeBatch, doc, serverTimestamp, getDoc } from '../services/firebase.js';

export const RevaluationModule = {
  state: {
    requests: [],
    exams: [],
    loading: false,
    revalFeePerSubject: 500 // Global setting
  },

  async init(institutionId) {
    this.state.loading = true;
    this.renderSkeleton();

    try {
      // Fetch only exams where results are published
      const examSnap = await getDocs(query(
        collection(db, 'exams'), 
        where('institutionId', '==', institutionId),
        where('publishStatus', '==', 'RESULTS_PUBLISHED'),
        where('isDeleted', '==', false)
      ));
      this.state.exams = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      await this.fetchRequests(institutionId);
    } catch (e) {
      window.UI.showToast("Failed to load revaluation module.", "error");
    }
    this.state.loading = false;
  },

  async fetchRequests(institutionId) {
  this.state.loading = true;
  this.renderSkeleton();

  try {
    const auth = window.AuthModule;

    // 1. Build dynamic query constraints array
    const constraints = [];

    // ── Multi-Tenant Security Isolation Guard ──
    // Campus Admins are locked into their own data; Super Admins bypass this to view global metrics
    if (auth?.currentRole !== 'super_admin') {
      constraints.push(where('institutionId', '==', auth.institutionId || institutionId));
    } else if (institutionId) {
      // If a Super Admin passes a specific institutionId target filter via the UI select dropdown
      constraints.push(where('institutionId', '==', institutionId));
    }

    // 2. Fetch documents (Firestore implicitly performs Cache-First resolution from IndexedDB)
    const q = query(collection(db, 'revaluation_requests'), ...constraints);
    const snap = await getDocs(q);
    
    // 3. Map snapshot parameters straight into local module state tracking trees
    this.state.requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  } catch (e) {
    console.error("[RevaluationModule] Fetch failure: ", e);
    window.UI.showToast("Failed to load records from database cache storage.", "error");
  } finally {
    this.state.loading = false;
    
    // 4. Render UI table with the loaded metrics instantly
    this.renderTable();
  }
},

  // OPENS THE MODAL TO REGISTER A NEW REVALUATION
  openRegistrationModal() {
    const examOptions = this.state.exams.map(e => `<option value="${e.id}">${e.examName} (${e.batch})</option>`).join('');
    
    window.UI.openModal('Register Revaluation', `
      <div class="form-floating" style="margin-bottom:15px;">
        <select id="rev-exam" onchange="window.RevalApp.loadStudentDropdown()"><option value="">-- Select Exam --</option>${examOptions}</select>
        <label>Exam</label>
      </div>
      <div class="form-floating" style="margin-bottom:15px;">
        <select id="rev-student" onchange="window.RevalApp.loadSubjectDropdown()" disabled><option value="">-- Select Student --</option></select>
        <label>Student Register Number</label>
      </div>
      <div class="form-floating" style="margin-bottom:15px;">
        <select id="rev-subject" disabled><option value="">-- Select Subject --</option></select>
        <label>Subject to Revalue</label>
      </div>
    `, `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Cancel</button>
      <button class="btn btn-gold" onclick="window.RevalApp.submitRegistration()">Register & Bill</button>
    `);
  },

  // DYNAMIC DROPDOWNS FOR THE REGISTRATION MODAL
  async loadStudentDropdown() {
    const examId = document.getElementById('rev-exam').value;
    const studentSelect = document.getElementById('rev-student');
    if (!examId) return;

    studentSelect.innerHTML = `<option>Loading...</option>`;
    
    // Fetch students who have published results for this exam
    const snap = await getDocs(query(collection(db, 'processed_results'), where('examId', '==', examId)));
    let html = `<option value="">-- Select Student --</option>`;
    snap.docs.forEach(d => {
      const data = d.data();
      html += `<option value="${data.studentId}" data-subjects='${JSON.stringify(data.subjects)}'>${data.regNo} - ${data.name}</option>`;
    });
    
    studentSelect.innerHTML = html;
    studentSelect.disabled = false;
  },

  loadSubjectDropdown() {
    const studentSelect = document.getElementById('rev-student');
    const subjectSelect = document.getElementById('rev-subject');
    const selectedOption = studentSelect.options[studentSelect.selectedIndex];
    
    if (!selectedOption.value) return;
    
    const subjects = JSON.parse(selectedOption.getAttribute('data-subjects'));
    let html = `<option value="">-- Select Subject --</option>`;
    subjects.forEach(s => {
      html += `<option value="${s.code}" data-mark="${s.mark}">${s.code} (Current Mark: ${s.mark})</option>`;
    });
    
    subjectSelect.innerHTML = html;
    subjectSelect.disabled = false;
  },

  async submitRegistration() {
    const examId = document.getElementById('rev-exam').value;
    const studentSelect = document.getElementById('rev-student');
    const subjectSelect = document.getElementById('rev-subject');
    
    if (!examId || !studentSelect.value || !subjectSelect.value) {
      window.UI.showToast("Please fill all fields", "error");
      return;
    }

    const studentName = studentSelect.options[studentSelect.selectedIndex].text;
    const oldMark = subjectSelect.options[subjectSelect.selectedIndex].getAttribute('data-mark');

    try {
      const payload = {
        institutionId: window.AuthModule.institutionId,
        examId,
        studentId: studentSelect.value,
        studentName,
        subjectCode: subjectSelect.value,
        oldMark: oldMark === 'AB' ? 0 : parseFloat(oldMark),
        newMark: null,
        status: 'PENDING_EVALUATION', // PENDING_EVALUATION -> COMPLETED
        fee: this.state.revalFeePerSubject,
        createdAt: serverTimestamp(),
        createdBy: window.AuthModule.currentUser.uid
      };

      await addDoc(collection(db, 'revaluation_requests'), payload);
      window.UI.showToast("Revaluation registered successfully.", "success");
      window.UI.closeModal();
      this.fetchRequests(window.AuthModule.institutionId);

    } catch (e) {
      window.UI.showToast(e.message, "error");
    }
  },

  openMarkEntry(reqId) {
    const req = this.state.requests.find(r => r.id === reqId);
    window.UI.openModal('Enter Revaluation Mark', `
      <div style="margin-bottom: 20px; padding: 15px; background: rgba(224,122,138,0.1); border-radius: 8px;">
        <strong>${req.studentName}</strong><br>
        Subject: ${req.subjectCode}<br>
        Original Mark: <strong style="color: var(--danger)">${req.oldMark}</strong>
      </div>
      <div class="form-floating">
        <input type="number" id="rev-newmark" placeholder="New Mark" />
        <label>Enter New Evaluated Mark</label>
      </div>
    `, `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Cancel</button>
      <button class="btn btn-gold" onclick="window.RevalApp.saveNewMark('${req.id}')">Save & Finalize</button>
    `);
  },

  async saveNewMark(reqId) {
    const req = this.state.requests.find(r => r.id === reqId);
    const newMarkInput = document.getElementById('rev-newmark').value;
    if (newMarkInput === '') return window.UI.showToast("Enter a valid mark", "error");
    
    const newMark = parseFloat(newMarkInput);
    if (!confirm(`Are you sure? This will permanently change the student's mark from ${req.oldMark} to ${newMark}.`)) return;

    try {
      const batch = writeBatch(db);
      const timestamp = serverTimestamp();
      
      // 1. Update the Revaluation Request
      const revRef = doc(db, 'revaluation_requests', reqId);
      batch.update(revRef, {
        newMark: newMark,
        difference: newMark - req.oldMark,
        status: 'COMPLETED',
        updatedAt: timestamp,
        updatedBy: window.AuthModule.currentUser.uid
      });

      // 2. Update the RAW exam marks collection
      const markDocId = `${req.examId}_${req.subjectCode}_${req.studentId}`;
      const markRef = doc(db, 'exam_marks', markDocId);
      batch.update(markRef, {
        mark: newMark.toString(),
        isRevalued: true,
        updatedAt: timestamp
      });

      // 3. Insert into the Audit Log Collection
      const auditRef = doc(collection(db, 'audit_logs'));
      batch.set(auditRef, {
        type: 'REVALUATION_MARK_CHANGE',
        institutionId: req.institutionId,
        studentId: req.studentId,
        examId: req.examId,
        subjectCode: req.subjectCode,
        oldMark: req.oldMark,
        newMark: newMark,
        changedBy: window.AuthModule.currentUser.email,
        timestamp: timestamp
      });

      // NOTE: In a full production system, you would also trigger a recalculation 
      // of the `processed_results` here to update their total/grade/supply eligibility.

      await batch.commit();
      window.UI.showToast("Revaluation mark applied and audited.", "success");
      window.UI.closeModal();
      this.fetchRequests(window.AuthModule.institutionId);

    } catch (e) {
      window.UI.showToast("Update failed: " + e.message, "error");
    }
  },

  renderTable() {
    const container = document.getElementById('reval-table-body');
    if (!container) return;

    if (!this.state.requests.length) {
      container.innerHTML = `<tr><td colspan="6" class="empty-state">No revaluation requests found.</td></tr>`;
      return;
    }
    
    container.innerHTML = this.state.requests.map(req => {
      let markHtml = `<span class="badge badge-rose">${req.oldMark}</span>`;
      let diffHtml = `—`;
      
      if (req.status === 'COMPLETED') {
        const isUp = req.difference > 0;
        markHtml = `<del class="text-secondary">${req.oldMark}</del> &rarr; <span class="badge badge-teal">${req.newMark}</span>`;
        diffHtml = `<span style="color: ${isUp ? 'var(--success)' : 'var(--danger)'}; font-weight:bold;">${isUp ? '+' : ''}${req.difference}</span>`;
      }

      return `
      <tr>
        <td><strong>${req.studentName}</strong></td>
        <td>${req.subjectCode}</td>
        <td>${markHtml}</td>
        <td>${diffHtml}</td>
        <td><span class="badge ${req.status === 'COMPLETED' ? 'badge-teal' : 'badge-gold'}">${req.status.replace('_', ' ')}</span></td>
        <td>
          ${req.status === 'PENDING_EVALUATION' ? 
            `<button class="btn btn-outline btn-sm" onclick="window.RevalApp.openMarkEntry('${req.id}')"><i class="fa fa-pen"></i> Enter Mark</button>` : 
            `<span class="text-secondary" style="font-size:12px;"><i class="fa fa-check"></i> Finalized</span>`
          }
        </td>
      </tr>
    `}).join('');
  },

  renderSkeleton() {
    const container = document.getElementById('reval-table-body');
    if (container) container.innerHTML = Array(3).fill(`<tr><td colspan="6"><div class="skeleton-loader" style="height: 48px; width: 100%;"></div></td></tr>`).join('');
  }
};