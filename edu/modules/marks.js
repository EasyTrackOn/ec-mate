// modules/marks.js
import { CacheEngine } from '../utils/localDb.js';
import { db, collection, writeBatch, getDocs, getDoc, setDoc, doc, serverTimestamp, query, where } from '../services/firebase.js';

export const MarkModule = {
  state: {
    exams: [],
    students: [],
    subjects: [],
    currentExam: null,
    currentSubjectCode: null,
    marksData: {}, // Format: { studentId: { desc: 40, omr: 15, ce: 25, status: 'P', updatedAt: ms } }
    activeCriteria: { descMax: 50, descPass: 20, omrMax: 20, omrPass: 8, ceMax: 30, cePass: 12 }
  },

  // 1. Core Initializer - Utilizing persistent local storage structures seamlessly
async initMarkEntry() {
  try {
    const auth = window.AuthModule;

    // ── STEP A: Build Query Constraints for Exams ──
    const examConstraints = [
      where('isDeleted', '==', false),
      where('publishStatus', '!=', 'DRAFT') // Filter drafts at database layer
    ];

    // Multi-tenant boundary isolation guard
    if (auth?.currentRole !== 'super_admin') {
      examConstraints.push(where('institutionId', '==', auth.institutionId));
    }

    // Fetch Exams (Firestore natively resolves this cache-first via IndexedDB)
    const examQuery = query(collection(db, 'exams'), ...examConstraints);
    const exSnap = await getDocs(examQuery);
    this.state.exams = exSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // ── STEP B: Fetch Core Subjects ──
    const subjectQuery = query(collection(db, 'subjects'), where('isDeleted', '==', false));
    const subSnap = await getDocs(subjectQuery);
    this.state.subjects = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // ── STEP C: Populate Application UI Form Fields ──
    this.populateExamDropdown();
    await this.renderInstitutionSelector(); 

  } catch(e) { 
    console.error("[MarkEntry Initializer Exception]:", e);
    window.UI.showToast("Error loading evaluation parameters from database storage.", "error"); 
  }
},

  async renderInstitutionSelector() {
    const container = document.getElementById('me-inst-container');
    if(!container) return;

    const currentRole = window.AuthModule.currentRole;
    const userInstId = window.AuthModule.institutionId;

    if (currentRole === 'super_admin') {
      const institutions = await window.InstitutionApp.getAllActiveInstitutions();
      const options = institutions.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
      
      container.innerHTML = `
        <div class="form-floating">
          <select id="me-inst-select" onchange="window.MarkApp.handleInstitutionChange()">
            <option value="">-- Choose Campus --</option>
            ${options}
          </select>
          <label>Campus Filter (Super Admin)</label>
        </div>
      `;
    } else {
      container.innerHTML = `<input type="hidden" id="me-inst-select" value="${userInstId}">`;
    }
  },

  populateExamDropdown() {
    const select = document.getElementById('me-exam-select');
    if(!select) return;
    
    let html = `<option value="">-- Select Exam --</option>`;
    this.state.exams.forEach(ex => {
      html += `<option value="${ex.id}">${ex.examName} (${ex.batch})</option>`;
    });
    select.innerHTML = html;
  },

  handleExamSelection(examId) {
    this.state.currentExam = this.state.exams.find(e => e.id === examId);
    const subSelect = document.getElementById('me-subject-select');
    
    if(!this.state.currentExam) {
      subSelect.innerHTML = `<option value="">-- Select Subject --</option>`;
      subSelect.disabled = true;
      return;
    }

    let html = `<option value="">-- Select Subject --</option>`;
    this.state.currentExam.schedule.forEach(sch => {
      html += `<option value="${sch.subjectCode}">${sch.subjectName} (${sch.subjectCode})</option>`;
    });
    subSelect.innerHTML = html;
    subSelect.disabled = false;
  },

  handleInstitutionChange() {
    const container = document.getElementById('mark-grid-container');
    if (container) {
      container.innerHTML = `<div class="empty-state">Campus shifted. Click "Load Grid" to pull workspace metrics.</div>`;
    }
  },

  // 2. Build Grid dynamically with native persistence cache-first loading structures
async generateMarkGrid() {
  const examId = document.getElementById('me-exam-select').value;
  const subjectCode = document.getElementById('me-subject-select').value;
  const targetInstId = document.getElementById('me-inst-select').value; 

  if (!examId || !subjectCode) return window.UI.showToast("Select both Exam and Subject.", "error");
  if (!targetInstId) return window.UI.showToast("Please select a target campus first.", "warning");

  this.state.currentSubjectCode = subjectCode;
  const targetBatch = this.state.currentExam.batch; 

  document.getElementById('mark-grid-container').innerHTML = `
    <div class="skeleton-loader" style="height: 200px; width: 100%;"></div>
  `;

  try {
    const auth = window.AuthModule;

    // ── STEP A: Pull Students (Using database-level filters) ──
    const studentConstraints = [
      where('institutionId', '==', targetInstId),
      where('batch', '==', targetBatch),
      where('isDeleted', '==', false)
    ];

    // Read student records (Firestore automatically pulls from cache first if network is sluggish/offline)
    const stuQ = query(collection(db, 'students'), ...studentConstraints);
    const stuSnap = await getDocs(stuQ);
    
    this.state.students = stuSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Apply alpha-numeric registration number sorting safely over the resulting dataset map
    this.state.students.sort((a, b) => {
      const regA = a.registerNumber || a.regNo || '';
      const regB = b.registerNumber || b.regNo || '';
      return regA.localeCompare(regB);
    });

    if (this.state.students.length === 0) {
      document.getElementById('mark-grid-container').innerHTML = `
        <div class="empty-state">No active students found for batch ${targetBatch} at this campus.</div>
      `;
      return;
    }

    // Sync evaluation metrics from active exam schedule configuration blocks
    const scheduleItem = this.state.currentExam.schedule?.find(s => s.subjectCode === subjectCode);
    if (scheduleItem && scheduleItem.markCriteria) {
      this.state.activeCriteria = scheduleItem.markCriteria;
    }

    // ── STEP B: Fetch Existing Evaluation Score Records ──
    this.state.marksData = {}; 

    // Target dynamic subcollection route structure: marks ➔ targetBatch ➔ records
    const marksQ = query(
      collection(db, 'marks', targetBatch, 'records'),
      where('examId', '==', examId),
      where('institutionId', '==', targetInstId)
    );

    const recordsSnap = await getDocs(marksQ);
    
    // Unpack dynamic score mapping objects safely
    recordsSnap.forEach(docSnap => {
      const reportCard = docSnap.data();
      const studentId = reportCard.studentId; 
      const dynamicKey = `scores_${subjectCode}`;
      
      if (reportCard && reportCard[dynamicKey]) {
        this.state.marksData[studentId] = reportCard[dynamicKey];
      }
    });

    // Notify user if working completely disconnected from cellular/wifi systems
    if (!navigator.onLine) {
      window.UI.showToast("Offline workspace active: Pulling grid details from local cache snapshots.", "info");
    }

    // ── STEP C: Build HTML Interface Components ──
    this.renderGrid();

  } catch (e) {
    console.error("[MarksTerminal Engine Error]: ", e);
    window.UI.showToast("Error processing evaluation workspace tables.", "error");
    document.getElementById('mark-grid-container').innerHTML = `
      <div class="empty-state" style="color: var(--text-rose);">Failed to initialize terminal sheet workspace.</div>
    `;
  }
},

  renderGrid() {
    const subjectDef = this.state.subjects.find(s => s.subjectCode === this.state.currentSubjectCode);
    const crit = this.state.activeCriteria;
    const isSuperAdmin = (window.AuthModule.currentRole === 'super_admin');

    let html = `
      <div style="background: var(--surface2); padding: 15px; border-radius: 10px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h4 style="margin-bottom: 5px;">${this.state.currentExam.examName} - ${subjectDef ? subjectDef.subjectName : this.state.currentSubjectCode}</h4>
          <div style="font-size:12px; color:var(--text-secondary);">
            Bounds Constraint Architecture &rarr; 
            <strong>DESC:</strong> ${crit.descMax}/${crit.descPass} | 
            <strong>OMR:</strong> ${crit.omrMax}/${crit.omrPass} | 
            <strong>CE:</strong> ${crit.ceMax}/${crit.cePass}
          </div>
        </div>
        <button id="me-btn-save" class="btn btn-gold" onclick="window.MarkApp.saveAllMarks()">
          <i class="fa fa-save"></i> Synchronize Record Set
        </button>
      </div>

      <table class="mark-entry-table form-floating">
        <thead>
          <tr>
            <th style="width: 130px;">Reg No</th>
            <th>Student Name</th>
            <th style="width: 110px;">DESC (${crit.descMax})</th>
            <th style="width: 110px;">OMR (${crit.omrMax})</th>
            <th style="width: 110px;">CE (${crit.ceMax})</th>
            <th style="width: 110px;">Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    this.state.students.forEach((stu, index) => {
      const scoreRecord = this.state.marksData[stu.id] || {};
      
      const displayDesc = scoreRecord.desc !== undefined ? scoreRecord.desc : '';
      const displayOmr = scoreRecord.omr !== undefined ? scoreRecord.omr : '';
      const displayCe = scoreRecord.ce !== undefined ? scoreRecord.ce : '';
      const displayStatus = scoreRecord.status ? scoreRecord.status : 'P'; 
      
      // 🔥 GOOD IDEA IMPLEMENTED: If not super admin, add the disabled attribute to DESC and OMR elements completely dropping tampering windows
      const rootControlAttr = isSuperAdmin ? '' : 'disabled style="background: var(--disabled-surface); color: var(--text-muted); cursor: not-allowed;"';

      html += `
        <tr>
          <td><strong>${stu.registerNumber}</strong></td>
          <td>${stu.candidateName}</td>
          <td>
            <input type="number" class="grid-input" id="mark_desc_${stu.id}" value="${displayDesc}" 
                   placeholder="0" ${rootControlAttr} onblur="window.MarkApp.autoCalculateStatus('${stu.id}')"
                   onkeydown="if(event.key === 'Enter') document.getElementById('mark_omr_${stu.id}').focus()">
          </td>
          <td>
            <input type="number" class="grid-input" id="mark_omr_${stu.id}" value="${displayOmr}" 
                   placeholder="0" ${rootControlAttr} onblur="window.MarkApp.autoCalculateStatus('${stu.id}')"
                   onkeydown="if(event.key === 'Enter') document.getElementById('mark_ce_${stu.id}').focus()">
          </td>
          <td>
            <input type="number" class="grid-input" id="mark_ce_${stu.id}" value="${displayCe}" 
                   placeholder="0" onblur="window.MarkApp.autoCalculateStatus('${stu.id}')"
                   onkeydown="if(event.key === 'Enter') window.MarkApp.focusNext(${index})">
          </td>
          <td>
            <select class="grid-input" id="mark_stat_${stu.id}" ${rootControlAttr}>
              <option value="P" ${displayStatus === 'P' ? 'selected' : ''}>Pass (P)</option>
              <option value="F" ${displayStatus === 'F' ? 'selected' : ''}>Fail (F)</option>
              <option value="A" ${displayStatus === 'A' ? 'selected' : ''}>Absent (A)</option>
            </select>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    document.getElementById('mark-grid-container').innerHTML = html;
  },

  autoCalculateStatus(studentId) {
    const descInput = document.getElementById(`mark_desc_${studentId}`);
    const omrInput = document.getElementById(`mark_omr_${studentId}`);
    const ceInput = document.getElementById(`mark_ce_${studentId}`);
    const statSelect = document.getElementById(`mark_stat_${studentId}`);
    
    const dVal = descInput.value.trim();
    const oVal = omrInput.value.trim();
    const cVal = ceInput.value.trim();
    const crit = this.state.activeCriteria;

    if (!dVal && !oVal && statSelect.value === 'A') return;

    let descScore = parseFloat(dVal) || 0;
    let omrScore = parseFloat(oVal) || 0;
    let ceScore = parseFloat(cVal) || 0;

    if (descScore > crit.descMax) { descScore = crit.descMax; descInput.value = descScore; }
    if (omrScore > crit.omrMax) { omrScore = crit.omrMax; omrInput.value = omrScore; }
    if (ceScore > crit.ceMax) { ceScore = crit.ceMax; ceInput.value = ceScore; }

    if (descScore < crit.descPass || omrScore < crit.omrPass || ceScore < crit.cePass) {
      statSelect.value = 'F';
    } else {
      statSelect.value = 'P';
    }
  },

  focusNext(currentIndex) {
    const nextStudent = this.state.students[currentIndex + 1];
    if(nextStudent) {
      // Intuitively sets focus straight down the interactive column lines automatically
      const focusTargetId = (window.AuthModule.currentRole === 'super_admin') ? `mark_desc_${nextStudent.id}` : `mark_ce_${nextStudent.id}`;
      document.getElementById(focusTargetId).focus();
    }
  },

  // 3. Native Persistence Atomic Marks Committer
async saveAllMarks() {
  const examId = this.state.currentExam.id;
  const subjectCode = this.state.currentSubjectCode;
  const batchKey = this.state.currentExam.batch; 
  const targetInstId = document.getElementById('me-inst-select').value;
  const isSuperAdmin = (window.AuthModule.currentRole === 'super_admin');

  try {
    // 1. Initialize an Atomic Mutation Write Batch
    const batch = writeBatch(db);
    const timestampEpoch = Date.now(); // Local tracking execution coordinate ticks

    // 2. Loop through evaluated student arrays within the active view screen
    for (const stu of this.state.students) {
      const dVal = document.getElementById(`mark_desc_${stu.id}`).value;
      const oVal = document.getElementById(`mark_omr_${stu.id}`).value;
      const cVal = document.getElementById(`mark_ce_${stu.id}`).value;
      const statusVal = document.getElementById(`mark_stat_${stu.id}`).value;

      // Only prepare a payload if input parameters contain mutations
      if (dVal || oVal || cVal || statusVal === 'A') {
        
        // Target dynamic nested multi-tenant schema path: marks ➔ targetBatch ➔ records
        const docRef = doc(db, 'marks', batchKey, 'records', `${stu.id}_${examId}`);
        
        // Pull historical baseline from local module state memory cache structures
        const currentRecord = this.state.marksData[stu.id] || {};

        let scoreEntry = {};
        if (isSuperAdmin) {
          // Super Admins have absolute read-write authorization boundaries
          scoreEntry = {
            desc: statusVal === 'A' ? 0 : dVal ? parseFloat(dVal) || 0 : 0,
            omr: statusVal === 'A' ? 0 : oVal ? parseFloat(oVal) || 0 : 0,
            ce: cVal ? parseFloat(cVal) || 0 : (currentRecord.ce || 0),
            status: statusVal,
            clientUpdatedAt: timestampEpoch
          };
        } else {
          // Campus instructors maintain internal variable scores (CE) while keeping DESC and OMR immutable
          const existingDesc = currentRecord.desc !== undefined ? currentRecord.desc : 0;
          const existingOmr = currentRecord.omr !== undefined ? currentRecord.omr : 0;
          const computedCe = cVal ? parseFloat(cVal) || 0 : 0;
          
          let finalStatus = 'P';
          if (existingDesc < this.state.activeCriteria.descPass || 
              existingOmr < this.state.activeCriteria.omrPass || 
              computedCe < this.state.activeCriteria.cePass) {
            finalStatus = 'F';
          }

          scoreEntry = {
            desc: existingDesc,
            omr: existingOmr,
            ce: computedCe,
            status: finalStatus,
            clientUpdatedAt: timestampEpoch
          };
        }

        // Mutate the reactive state map model locally for instantaneous UI reflection
        this.state.marksData[stu.id] = scoreEntry;

        // Build the Firestore Document Payload Shape
        const payload = {
          studentId: stu.id,
          examId: examId,
          institutionId: targetInstId,
          updatedAt: serverTimestamp(), // Evaluates server-side when the packet merges upstream
          updatedBy: window.AuthModule.currentUser.email,
          [`scores_${subjectCode}`]: scoreEntry
        };

        // Queue document into atomic batch operation with structural deep merging active
        batch.set(docRef, payload, { merge: true });
      }
    }

    // 3. Commit Mutations Atomically
    // (Writes instantly to the persistent disk queue before shipping to remote servers)
    await batch.commit();
    
    window.UI.showToast("Evaluation ledger successfully committed to database storage!", "success");

  } catch(e) { 
    console.error("[MarksTerminal Engine Exception]: ", e);
    window.UI.showToast("Database synchronization routine transaction fault.", "error"); 
  }
}
};