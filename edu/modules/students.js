// modules/students.js
//import { CacheEngine } from '../utils/localDb.js';
import { DriveStorageEngine } from '../utils/driveStorage.js';
import { db, collection, getDocs, setDoc, doc, serverTimestamp, query, where, updateDoc } from '../services/firebase.js';

export const StudentModule = {
  state: {
    students: [],
    loading: false,
    selectedPhotoFile: null,
    croppedPhotoBlob: null,
    currentSummaryBatch: '',
    activeStudentId: null, // Tracks if editing (null = Add Mode)
    cropState: { imgScale: 1.0, offsetX: 0, offsetY: 0, isDragging: false, startX: 0, startY: 0 },
    exportableFields: [
      { id: 'registerNumber', label: 'Register Number' },
      { id: 'candidateName', label: 'Candidate Name' },
      { id: 'institutionId', label: 'Institution ID' },
      { id: 'fatherName', label: 'Name of Father' },
      { id: 'husbandName', label: 'Name of Husband' },
      { id: 'phoneNumber', label: 'Phone Number' },
      { id: 'educationalQualification', label: 'Educational Qualification' },
      { id: 'aadhaarCardNumber', label: 'Aadhaar Card' },
      { id: 'residentialAddress', label: 'Address' },
      { id: 'postOffice', label: 'Post Office' },
      { id: 'pincode', label: 'Pincode' },
      { id: 'district', label: 'District' },
      { id: 'batch', label: 'Batch' },
      { id: 'email', label: 'Email Address' }
    ]
  },

  async fetchStudents() {
  this.state.loading = true;
  this.renderSkeleton();

  try {
    const auth = window.AuthModule;
    const instId = auth.institutionId;

    // 1. Build core query constraints
    const constraints = [where('isDeleted', '==', false)];

    // Multi-tenant isolation guard: Scopes data footprint automatically by user privilege role
    if (auth.currentRole !== 'super_admin') {
      constraints.push(where('institutionId', '==', instId));
    }

    // 2. Query collection (Firestore implicitly fetches cache-first via native IndexedDB)
    const studentQuery = query(collection(db, 'students'), ...constraints);
    const snap = await getDocs(studentQuery);
    
    // 3. Map result parameters directly into local module memory state trees
    this.state.students = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  } catch (error) {
    console.error("[StudentModule] Core synchronization failure: ", error);
    window.UI.showToast("Failed to compile candidate metrics from local database storage.", "error");
  } finally {
    this.state.loading = false;

    // 4. Trigger UI presentation rendering handlers instantly
    this.renderTable(this.state.students);
    this.populateBatchDropdown(); 
    this.renderBatchSummaryTable();
  }
},

  async populateInstitutionDropdown(selectedId = null) {
    const selectEl = document.getElementById('stu-inst-select');
    if (!selectEl) return;
    const currentRole = window.AuthModule.currentRole;
    const userInstId = window.AuthModule.institutionId;

    const allInstitutions = await window.InstitutionApp.getAllActiveInstitutions(); 
    let html = `<option value="" disabled selected hidden>-- Select Campus --</option>`;
    allInstitutions.forEach(inst => {
      html += `<option value="${inst.id}">${inst.name} (${inst.id})</option>`;
    });
    selectEl.innerHTML = html;

    if (currentRole === 'super_admin') {
      selectEl.disabled = false;
      if (selectedId) {
        selectEl.value = selectedId;
      }
    } else {
      selectEl.value = userInstId; 
      selectEl.disabled = true;    
    }
    
    // Auto-calculate immediately for New Enrollments
    if (!selectedId) {
      this.handleInstitutionChange(selectEl.value);
    }
  },

  handleInstitutionChange(instId) {
    if (this.state.activeStudentId || !instId) return; // Do not overwrite if editing
    
    const regInput = document.getElementById('stu-reg');
    if (!regInput) return;

    // Filter local cache to match chosen institution context
    const campusStudents = this.state.students.filter(s => String(s.institutionId) === String(instId));
    
    let maxNum = 1000; // Hard base assignment fallback index
    campusStudents.forEach(s => {
      const match = String(s.registerNumber).match(/\d+/);
      if (match) {
        const num = parseInt(match[0], 10);
        if (num > maxNum) maxNum = num;
      }
    });

    const nextRegNumber = maxNum + 1;
    regInput.value = nextRegNumber;
  },

  // --- MODAL GENERATION MATRIX (UNIFIED) ---
  async openStudentModal(studentId = null) {
    this.state.croppedPhotoBlob = null;
    this.state.activeStudentId = studentId;
    const isEditMode = studentId !== null;
    let student = null;

    if (isEditMode) {
      student = this.state.students.find(s => s.id === studentId);
      if (!student) return window.UI.showToast("Target student record lost.", "error");

      if (window.AuthModule.currentRole !== 'super_admin' && String(student.institutionId) !== String(window.AuthModule.institutionId)) {
        return window.UI.showToast("Security Exception: Cross-campus mutation blocked.", "error");
      }
    }

    const modalTitle = isEditMode ? 'Modify Student Profile Ledger' : 'Enroll New Student Ledger';
    const photoUrl = student?.photoUrl || '';
    const hasPhoto = photoUrl && photoUrl !== 'NIL';

    const body = `
      <div style="max-height: 70vh; overflow-y: auto; padding-right: 5px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
          <div class="form-floating">
            <select id="stu-inst-select" onchange="window.StudentApp.handleInstitutionChange(this.value)" required></select>
            <label>Institution ID</label>
          </div>
          <div class="form-floating">
            <input id="stu-reg" value="${student?.registerNumber || ''}" placeholder=" " disabled style="background:var(--disabled-surface); opacity:0.85; font-weight:bold;">
            <label>Register Number</label>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 15px; align-items: start;">
          <div style="display: flex; flex-direction: column; gap: 15px;">
            <div class="form-floating"><input id="stu-name" value="${student?.candidateName || ''}" placeholder=" " required><label>Full Candidate Name</label></div>
            <div class="form-floating"><input id="stu-father" value="${student?.fatherName || ''}" placeholder=" " required><label>Name of Father</label></div>
          </div>
          
          <div style="border: 2px dashed var(--border); border-radius: 10px; padding: 10px; text-align: center; background: rgba(0,0,0,0.15);">
            <div style="width: 85px; height: 110px; border: 1px solid var(--border); margin: 0 auto 8px; display: flex; align-items: center; justify-content: center; background: var(--surface); overflow: hidden;">
              <i class="fa fa-user" id="stu-avatar-placeholder" style="font-size: 32px; color: var(--text-secondary); ${hasPhoto ? 'display: none;' : ''}"></i>
              <img id="stu-avatar-preview" src="${hasPhoto ? photoUrl : 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width: 100%; height: 100%; object-fit: cover; ${hasPhoto ? '' : 'display: none;'}">
            </div>
            <label class="btn btn-outline btn-sm" style="cursor: pointer; font-size:11px; padding: 4px 10px;">
              <i class="fa fa-camera"></i> Passport
              <input type="file" id="new-stu-photo" accept="image/*" style="display: none;" onchange="window.StudentApp.initiatePhotoCrop(this)">
            </label>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
          <div class="form-floating"><input id="stu-husband" value="${student?.husbandName || 'NIL'}" placeholder=" " required><label>Name of Husband</label></div>
          <div class="form-floating"><input id="stu-aadhaar" value="${student?.aadhaarCardNumber || ''}" placeholder=" " pattern="[0-9]{12}" required><label>Aadhaar Card Number</label></div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 15px;">
          <div class="form-floating"><input id="stu-phone" value="${student?.phoneNumber || ''}" placeholder=" " required><label>Phone Number</label></div>
          <div class="form-floating"><input id="stu-qualification" value="${student?.educationalQualification || ''}" placeholder=" " required><label>Qualification</label></div>
          <div class="form-floating"><input id="stu-batch" value="${student?.batch || '2024-2027'}" placeholder=" " required><label>Batch / Year</label></div>
        </div>

        <div class="form-floating" style="margin-bottom: 15px;"><input id="stu-email" type="email" value="${student?.email || ''}" placeholder=" "><label>Email Address</label></div>
        <div class="form-floating" style="margin-bottom: 15px;"><input id="stu-address" value="${student?.residentialAddress || ''}" placeholder=" " required><label>Residential Address</label></div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px;">
          <div class="form-floating"><input id="stu-po" value="${student?.postOffice || ''}" placeholder=" " required><label>Post Office</label></div>
          <div class="form-floating"><input id="stu-pincode" value="${student?.pincode || ''}" placeholder=" " required><label>Pincode</label></div>
          <div class="form-floating"><input id="stu-district" value="${student?.district || ''}" placeholder=" " required><label>District</label></div>
        </div>
      </div>

      <div id="stu-crop-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 10001; align-items: center; justify-content: center;">
        <div class="card-glass" style="max-width: 380px; width: 90%; padding: 20px; text-align: center;">
          <h5 style="margin-bottom: 12px; color: var(--accent-gold);">Crop Passport Portrait</h5>
          <div style="width: 280px; height: 360px; background: #111; overflow: hidden; position: relative; border-radius: 8px; margin: 0 auto 15px; border: 2px solid var(--accent-gold); box-shadow: inset 0 0 20px rgba(0,0,0,0.8);">
            <img id="stu-crop-target" style="position: absolute; top: 0; left: 0; transform-origin: top left; max-width: 300px; max-height: 400px; transition: none;">
            <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; border: 1px dashed rgba(201, 169, 110, 0.3); box-sizing: border-box;"></div>
          </div>
          <div style="display: flex; gap: 10px;"><button class="btn btn-outline" style="flex:1;" onclick="window.StudentApp.closeCropModal()">Cancel</button><button class="btn btn-gold" style="flex:1;" onclick="window.StudentApp.executeCrop()">Crop</button></div>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Cancel</button>
      <button class="btn btn-gold" id="stu-save-btn" onclick="window.StudentApp.saveStudentProfile()">Secure Ledger Record</button>
    `;

    window.UI.openModal(modalTitle, body, footer);
    await this.populateInstitutionDropdown(student?.institutionId);
  },

  // --- UNIFIED STORAGE PIPELINE WRITE SYSTEM (REPLACES SUBMITNEW & SUBMITUPDATE) ---
  // --- UNIFIED STORAGE PIPELINE WRITE SYSTEM ---
  async saveStudentProfile() {
    const isEditMode = this.state.activeStudentId !== null;
    
    const institutionId = document.getElementById('stu-inst-select').value;
    const candidateName = document.getElementById('stu-name').value.trim();
    const fatherName = document.getElementById('stu-father').value.trim();
    const husbandName = document.getElementById('stu-husband').value.trim();
    const aadhaarCardNumber = document.getElementById('stu-aadhaar').value.trim();
    const phoneNumber = document.getElementById('stu-phone').value.trim();
    const educationalQualification = document.getElementById('stu-qualification').value.trim();
    const batch = document.getElementById('stu-batch').value.trim();
    const email = document.getElementById('stu-email').value.trim().toLowerCase();
    const residentialAddress = document.getElementById('stu-address').value.trim();
    const postOffice = document.getElementById('stu-po').value.trim();
    const pincode = document.getElementById('stu-pincode').value.trim();
    const district = document.getElementById('stu-district').value.trim();

    let registerNumber = document.getElementById('stu-reg')?.value?.trim() || "";

    if (isEditMode) {
      const existingStudent = this.state.students.find(s => s.id === this.state.activeStudentId);
      if (existingStudent) { registerNumber = existingStudent.registerNumber; }
    } else if (!registerNumber && institutionId) {
      const campusStudents = this.state.students.filter(s => String(s.institutionId) === String(institutionId));
      let maxNum = 1000;
      campusStudents.forEach(s => {
        const match = String(s.registerNumber).match(/\d+/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (num > maxNum) maxNum = num;
        }
      });
      registerNumber = String(maxNum + 1);
    }

    if (!institutionId) return window.UI.showToast("Please assign an Institution ID.", "error");
    if (!registerNumber) return window.UI.showToast("Critical Error: Register Number allocation sequence failed.", "error");
    if (!candidateName) return window.UI.showToast("Candidate Name field is required.", "error");
    if (!batch) return window.UI.showToast("Batch configuration field is required.", "error");
    if (!isEditMode && !this.state.croppedPhotoBlob) {
      return window.UI.showToast("Passport portrait configuration is strictly mandatory.", "error");
    }
    if (!navigator.onLine) {
      return window.UI.showToast("Network baseline transmission pipeline sync offline.", "error");
    }

    const btn = document.getElementById('stu-save-btn');
    btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> Synchronizing Ledger...`;
    btn.disabled = true;

    try {
      const studentPrimaryKeyId = isEditMode ? this.state.activeStudentId : `${institutionId}_${registerNumber}`;
      const existingStudent = this.state.students.find(s => s.id === studentPrimaryKeyId);
      
      // Fallback base configuration default setup assignment pointer
      let finalPhotoUrl = existingStudent?.photoUrl || "NIL";

      // 🔥 CONDITION CHECK: Trigger Google Drive execution ONLY if a fresh biometric asset exists
      if (this.state.croppedPhotoBlob) {
        window.UI.showToast("Uploading portrait to secure vault...", "info");
        
        // Call your decoupled utility pipeline function
        finalPhotoUrl = await DriveStorageEngine.uploadStudentPhoto(
          this.state.croppedPhotoBlob, 
          registerNumber, 
          institutionId
        );
        
        console.log("Biometric stream committed successfully. Assigned Link:", finalPhotoUrl);
      } else {
        console.log("No portrait updates captured. Preserving record link entry reference:", finalPhotoUrl);
      }

      const payload = {
        id: studentPrimaryKeyId, registerNumber, candidateName, fatherName, husbandName,
        aadhaarCardNumber, phoneNumber, educationalQualification, batch, email,
        residentialAddress, postOffice, pincode, district, photoUrl: finalPhotoUrl,
        institutionId, status: 'ACTIVE', isDeleted: false,
        updatedAt: serverTimestamp(), updatedBy: window.AuthModule.currentUser.email
      };

      if (!isEditMode) {
        payload.createdAt = serverTimestamp();
        payload.createdBy = window.AuthModule.currentUser.email;
      }

      await setDoc(doc(db, 'students', studentPrimaryKeyId), payload, { merge: true });
      
      window.UI.showToast(isEditMode ? "Student profile modified successfully." : "Student profile secured inside ledger.", "success");
      window.UI.closeModal();
      this.state.croppedPhotoBlob = null;
      this.fetchStudents();

    } catch (err) {
      console.error(err);
      window.UI.showToast("Ecosystem save execution failure: " + err.message, "error");
    } finally {
      if (btn) { btn.innerHTML = `Secure Ledger Record`; btn.disabled = false; }
    }
  },
  // --- BATCH SUMMARY ANALYTICS ENGINE TRACKER ---
  populateBatchDropdown() {
    const batchSelect = document.getElementById('summary-batch-select');
    if (!batchSelect) return;

    const uniqueBatches = [...new Set(this.state.students.map(s => s.batch).filter(Boolean))].sort();
    let html = `<option value="">-- Choose Batch Timeline --</option>`;
    uniqueBatches.forEach(b => {
      html += `<option value="${b}" ${b === this.state.currentSummaryBatch ? 'selected' : ''}>${b}</option>`;
    });
    batchSelect.innerHTML = html;
  },

  handleBatchSummaryChange(batchValue) {
    this.state.currentSummaryBatch = batchValue;
    this.renderBatchSummaryTable();
  },

  renderBatchSummaryTable() {
    const container = document.getElementById('batch-summary-table-body');
    if (!container) return;

    if (!this.state.currentSummaryBatch) {
      container.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:15px;" class="text-muted">Select a batch timeline to map institutional allocations.</td></tr>`;
      return;
    }

    const filteredStudents = this.state.students.filter(s => s.batch === this.state.currentSummaryBatch);
    const institutionMetrics = {};
    filteredStudents.forEach(s => {
      institutionMetrics[s.institutionId] = (institutionMetrics[s.institutionId] || 0) + 1;
    });

    const metricRows = Object.entries(institutionMetrics).sort((a, b) => a[0].localeCompare(b[0]));
    let totalCount = 0;

    if (metricRows.length === 0) {
      container.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:15px;" class="text-muted">No student profiles structured inside this batch.</td></tr>`;
      return;
    }

    let html = metricRows.map(([instId, count]) => {
      totalCount += count;
      return `
        <tr>
          <td><span class="badge badge-teal">${instId}</span></td>
          <td><strong>${count} Enrolled</strong></td>
          <td style="text-align: right;">
            <button class="btn btn-outline btn-sm" title="CSV Summary" onclick="window.StudentApp.exportSummaryItem('${instId}', 'CSV')"><i class="fa fa-file-csv text-success"></i></button>
            <button class="btn btn-outline btn-sm" title="PDF Report" onclick="window.StudentApp.exportSummaryItem('${instId}', 'PDF')"><i class="fa fa-file-pdf text-danger"></i></button>
          </td>
        </tr>
      `;
    }).join('');

    html += `
      <tr style="background: rgba(201, 169, 110, 0.1); border-top: 2px solid var(--accent-gold);">
        <td><strong>TOTAL PROFILES MATRIX</strong></td>
        <td><strong>${totalCount} Active Records</strong></td>
        <td style="text-align: right;">
          <button class="btn btn-gold btn-sm" title="Export Batch CSV" onclick="window.StudentApp.exportSummaryItem('ALL', 'CSV')"><i class="fa fa-file-csv"></i></button>
          <button class="btn btn-gold btn-sm" title="Print Batch PDF" onclick="window.StudentApp.exportSummaryItem('ALL', 'PDF')"><i class="fa fa-file-pdf"></i></button>
        </td>
      </tr>
    `;
    container.innerHTML = html;
  },

  exportSummaryItem(instId, format) {
    let dataset = this.state.students.filter(s => s.batch === this.state.currentSummaryBatch);
    if (instId !== 'ALL') dataset = dataset.filter(s => s.institutionId === instId);
    if (dataset.length === 0) return window.UI.showToast("No printable records inside data framework streams.", "warning");

    const defaultExportConfig = [
      { id: 'registerNumber', label: 'Register Number' },
      { id: 'candidateName', label: 'Candidate Name' },
      { id: 'institutionId', label: 'Institution' },
      { id: 'phoneNumber', label: 'Phone' },
      { id: 'batch', label: 'Batch' }
    ];

    const originalCache = this.state.students;
    this.state.students = dataset; 
    if (format === 'CSV') this.generateCustomCSV(defaultExportConfig);
    else this.generateCustomPDF(defaultExportConfig);
    this.state.students = originalCache; 
  },

  // --- BIOMETRIC CANVAS MANAGEMENT CORE ---
  initiatePhotoCrop(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    this.state.selectedPhotoFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      const modal = document.getElementById('stu-crop-modal');
      const targetImg = document.getElementById('stu-crop-target');
      targetImg.src = e.target.result;
      modal.style.display = 'flex';

      this.state.cropState = { imgScale: 1.0, offsetX: 0, offsetY: 0, isDragging: false, startX: 0, startY: 0 };
      targetImg.style.transform = `translate(0px, 0px) scale(1)`;
      targetImg.style.cursor = 'move';
      targetImg.style.userSelect = 'none';
      targetImg.ondragstart = () => false;

      const frameWrapper = targetImg.parentElement;
      frameWrapper.style.position = 'relative';
      frameWrapper.style.overflow = 'hidden';

      frameWrapper.onwheel = (event) => {
        event.preventDefault();
        let scaleChange = event.deltaY < 0 ? 0.1 : -0.1;
        this.state.cropState.imgScale = Math.min(Math.max(0.5, this.state.cropState.imgScale + scaleChange), 4.0);
        this.applyImageTransforms(targetImg);
      };

      frameWrapper.onmousedown = (event) => {
        this.state.cropState.isDragging = true;
        this.state.cropState.startX = event.clientX - this.state.cropState.offsetX;
        this.state.cropState.startY = event.clientY - this.state.cropState.offsetY;
      };

      window.onmousemove = (event) => {
        if (!this.state.cropState.isDragging) return;
        this.state.cropState.offsetX = event.clientX - this.state.cropState.startX;
        this.state.cropState.offsetY = event.clientY - this.state.cropState.startY;
        this.applyImageTransforms(targetImg);
      };

      window.onmouseup = () => { this.state.cropState.isDragging = false; };
    };
    reader.readAsDataURL(file);
  },

  applyImageTransforms(imgElement) {
    imgElement.style.transform = `translate(${this.state.cropState.offsetX}px, ${this.state.cropState.offsetY}px) scale(${this.state.cropState.imgScale})`;
  },

  closeCropModal() {
    const cropModal = document.getElementById('stu-crop-modal');
    if (cropModal) cropModal.style.display = 'none';
    const photoInput = document.getElementById('new-stu-photo');
    if (photoInput) photoInput.value = '';
    window.onmousemove = null; window.onmouseup = null;
  },

  executeCrop() {
    const targetImg = document.getElementById('stu-crop-target');
    if (!targetImg) return window.UI.showToast("Crop workspace source missing.", "error");
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 350; canvas.height = 450;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cs = this.state.cropState;
    const parentContainer = targetImg.parentElement;
    
    const scaleX = canvas.width / parentContainer.clientWidth;
    const scaleY = canvas.height / parentContainer.clientHeight;

    const dx = cs.offsetX * scaleX;
    const dy = cs.offsetY * scaleY;
    const dw = targetImg.offsetWidth * cs.imgScale * scaleX;
    const dh = targetImg.offsetHeight * cs.imgScale * scaleY;

    ctx.drawImage(targetImg, dx, dy, dw, dh);
    canvas.toBlob((blob) => {
      this.state.croppedPhotoBlob = blob;
      const previewImg = document.getElementById('stu-avatar-preview');
      const placeholder = document.getElementById('stu-avatar-placeholder');
      if (previewImg) { previewImg.src = URL.createObjectURL(blob); previewImg.style.display = 'block'; }
      if (placeholder) placeholder.style.display = 'none';
      this.closeCropModal();
      window.UI.showToast("Portrait aligned!", "success");
    }, 'image/jpeg', 0.95);
  },

  async softDeleteStudent(id) {
    if(!confirm("Are you sure you want to remove this student?")) return;
    try {
      await updateDoc(doc(db, 'students', id), {
        isDeleted: true,
        updatedAt: serverTimestamp(),
        updatedBy: window.AuthModule.currentUser.email
      });
      window.UI.showToast("Student profile removed.", "success");
      this.fetchStudents();
    } catch {
      window.UI.showToast("Action execution denied.", "error");
    }
  },

  // --- DATA COMPILING ROUTING EXTENSIONS ---
  openExportSetupModal(formatType) {
    if (this.state.students.length === 0) return window.UI.showToast("No metric data to track.", "warning");

    let fieldsHtml = this.state.exportableFields.map((f, i) => `
      <div style="display:flex; align-items:center; gap:10px; padding:10px; background:var(--surface2); border:1px solid var(--border); border-radius:6px; cursor:move;" 
           draggable="true" ondragstart="window.StudentApp.handleDragStart(event, ${i})" ondragover="event.preventDefault()" ondrop="window.StudentApp.handleDrop(event, ${i})">
        <i class="fa fa-bars text-secondary" style="font-size:12px;"></i>
        <input type="checkbox" id="chk-field-${f.id}" value="${f.id}" checked style="width:16px; height:16px; accent-color:var(--accent-gold);">
        <label for="chk-field-${f.id}" style="font-size:13px; color:var(--text-primary); pointer-events:auto; position:static; margin:0; padding:0;">${f.label}</label>
      </div>
    `).join('');

    const body = `
      <p class="text-secondary" style="font-size:12px; margin-bottom:12px;">Check required columns and drag elements to re-order configuration layers matrix.</p>
      <div id="export-fields-sorting-container" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; max-height:50vh; overflow-y:auto; padding:5px;">${fieldsHtml}</div>
      <input type="hidden" id="active-export-format-type" value="${formatType}">
    `;

    const footer = `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Cancel</button>
      <button class="btn btn-gold" onclick="window.StudentApp.executeExportRoute()"><i class="fa fa-file-download"></i> Generate Report</button>
    `;
    window.UI.openModal(`Configure ${formatType} Columns`, body, footer);
  },

  handleDragStart(e, index) { e.dataTransfer.setData("text/plain", index); },
  handleDrop(e, toIndex) {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (fromIndex === toIndex) return;
    const movedItem = this.state.exportableFields.splice(fromIndex, 1)[0];
    this.state.exportableFields.splice(toIndex, 0, movedItem);
    this.openExportSetupModal(document.getElementById('active-export-format-type').value);
  },

  executeExportRoute() {
    const orderedConfig = [];
    this.state.exportableFields.forEach(f => {
      const el = document.getElementById(`chk-field-${f.id}`);
      if (el && el.checked) orderedConfig.push({ id: f.id, label: f.label });
    });
    const formatType = document.getElementById('active-export-format-type').value;
    if (orderedConfig.length === 0) return window.UI.showToast("Select at least one data column field.", "warning");
    window.UI.closeModal();
    if (formatType === 'CSV') this.generateCustomCSV(orderedConfig);
    else this.generateCustomPDF(orderedConfig);
  },

  generateCustomCSV(columns) {
    try {
      let csvContent = "data:text/csv;charset=utf-8,";
      csvContent += columns.map(c => `"${c.label}"`).join(",") + "\n";
      this.state.students.forEach(stu => {
        const row = columns.map(c => `"${String(stu[c.id] !== undefined ? stu[c.id] : "").replace(/"/g, '""')}"`).join(",");
        csvContent += row + "\n";
      });
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a"); link.setAttribute("href", encodedUri);
      link.setAttribute("download", `Student_Ledger_${Date.now()}.csv`);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } catch { window.UI.showToast("CSV generation crash.", "error"); }
  },

  generateCustomPDF(columns) {
    try {
      const printWindow = window.open('', '_blank');
      const thHtml = columns.map(c => `<th style="padding:10px; border:1px solid #ddd; background:#f5f5f5; text-align:left; font-size:11px;">${c.label}</th>`).join('');
      const trHtml = this.state.students.map(stu => {
        return `<tr>${columns.map(c => `<td style="padding:8px; border:1px solid #ddd; font-size:10px; max-width:180px; overflow:hidden; text-overflow:ellipsis;">${stu[c.id] !== undefined ? stu[c.id] : "-"}</td>`).join('')}</tr>`;
      }).join('');

      const template = `<html><head><title>Student Summary Matrix</title><style>@page { size: A4 landscape; margin: 12mm 8mm; } body { font-family: sans-serif; margin: 0; color: #222; } .header { margin-bottom: 20px; text-align: center; border-bottom: 2px solid #c9a96e; padding-bottom: 8px; } table { width: 100%; border-collapse: collapse; }</style></head><body><div class="header"><h2>Centralized Examination System</h2><p>Profiles Matrix Summary | Timestamp: ${new Date().toLocaleString()}</p></div><table><thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody></table><script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); };</script></body></html>`;
      printWindow.document.write(template); printWindow.document.close();
    } catch { window.UI.showToast("PDF rendering crash.", "error"); }
  },

  handleSearch(query) {
    const lowerQ = query.toLowerCase();
    this.renderTable(this.state.students.filter(s => s.candidateName.toLowerCase().includes(lowerQ) || s.registerNumber.toLowerCase().includes(lowerQ) || s.batch.toLowerCase().includes(lowerQ)));
  },

  renderTable(data) {
    const container = document.getElementById('student-table-body');
    if(!container) return;
    if(data.length === 0) { container.innerHTML = `<tr><td colspan="5" class="empty-state">No student records match configurations.</td></tr>`; return; }

    const currentRole = window.AuthModule.currentRole;
    const userInstId = window.AuthModule.institutionId;

    container.innerHTML = data.map(stu => {
      const isAuthorized = (currentRole === 'super_admin' || String(stu.institutionId) === String(userInstId));
      const controls = isAuthorized ? '' : 'disabled style="opacity:0.25; cursor:not-allowed;" title="Access Denied"';
      
      return `
        <tr>
          <td>
            <a href="#" style="color: var(--accent-gold); font-weight: bold; text-decoration: underline;" 
               onclick="event.preventDefault(); window.StudentApp.openProfileA4View('${stu.id}')">
              ${stu.registerNumber}
            </a>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:30px; height:38px; border:1px solid var(--border); border-radius:4px; overflow:hidden; background:var(--surface);">
                <img src="${stu.photoUrl && stu.photoUrl !== 'NIL' ? stu.photoUrl : 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}" style="width:100%; height:100%; object-fit:cover;">
              </div>
              <div>
                <div style="font-weight: 500;">${stu.candidateName}</div>
                <div style="font-size: 11px; color: var(--text-secondary);">${stu.email || 'No email provided'}</div>
              </div>
            </div>
          </td>
          <td>${stu.batch}</td>
          <td><span class="badge ${stu.status === 'ACTIVE' ? 'badge-teal' : 'badge-rose'}">${stu.status}</span></td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="window.StudentApp.openStudentModal('${stu.id}')" ${controls}><i class="fa fa-pen"></i></button>
            <button class="btn btn-danger btn-sm" onclick="window.StudentApp.softDeleteStudent('${stu.id}')" ${controls}><i class="fa fa-trash"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  },
// --- 4. PRINT-READY A4 SPECIFICATION SHEET MODAL VIEW ---
  openProfileA4View(studentId) {
    const student = this.state.students.find(s => s.id === studentId);
    if (!student) return window.UI.showToast("Profile metrics could not be located.", "error");

    const modalTitle = `Official Profile Sheet - Reg No: ${student.registerNumber}`;
    const avatarImg = student.photoUrl && student.photoUrl !== 'NIL' ? student.photoUrl : 'https://cdn-icons-png.flaticon.com/512/149/149071.png';

    const body = `
      <div style="max-height: 72vh; overflow-y: auto; padding: 10px; background: rgba(0,0,0,0.2); display: flex; justify-content: center;">
        
        <div id="print-a4-area" style="
          width: 210mm; 
          min-height: 297mm; 
          padding: 20mm; 
          background: #FFFFFF; 
          color: #111111; 
          box-sizing: border-box; 
          font-family: Arial, sans-serif;
          box-shadow: 0 0 15px rgba(0,0,0,0.5);
          position: relative;
        ">
          
          <div style="text-align: center; border-bottom: 3px double #c9a96e; padding-bottom: 12px; margin-bottom: 25px;">
            <h2 style="margin: 0 0 5px 0; text-transform: uppercase; font-size: 22px; letter-spacing: 1px; color: #111;">Centralized Examination System</h2>
            <p style="margin: 0; font-size: 13px; color: #555; text-transform: uppercase;">Student Admission Ledger Registration Record</p>
          </div>

          <div style="display: flex; gap: 20px; margin-bottom: 30px;">
            
            <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
              <div style="display: flex; border-bottom: 1px solid #ddd; padding: 4px 0;">
                <span style="width: 150px; font-weight: bold; color: #555; font-size: 12px;">REGISTER NUMBER:</span>
                <span style="font-size: 13px; font-weight: bold; color: #000;">${student.registerNumber}</span>
              </div>
              <div style="display: flex; border-bottom: 1px solid #ddd; padding: 4px 0;">
                <span style="width: 150px; font-weight: bold; color: #555; font-size: 12px;">CANDIDATE NAME:</span>
                <span style="font-size: 13px; font-weight: bold; text-transform: uppercase;">${student.candidateName}</span>
              </div>
              <div style="display: flex; border-bottom: 1px solid #ddd; padding: 4px 0;">
                <span style="width: 150px; font-weight: bold; color: #555; font-size: 12px;">INSTITUTION ID:</span>
                <span style="font-size: 13px; font-weight: bold; color: #c9a96e;">${student.institutionId}</span>
              </div>
              <div style="display: flex; border-bottom: 1px solid #ddd; padding: 4px 0;">
                <span style="width: 150px; font-weight: bold; color: #555; font-size: 12px;">NAME OF FATHER:</span>
                <span style="font-size: 13px;">${student.fatherName || '-'}</span>
              </div>
              <div style="display: flex; border-bottom: 1px solid #ddd; padding: 4px 0;">
                <span style="width: 150px; font-weight: bold; color: #555; font-size: 12px;">NAME OF HUSBAND:</span>
                <span style="font-size: 13px;">${student.husbandName || 'NIL'}</span>
              </div>
            </div>

            <div style="width: 35mm; height: 45mm; border: 1px solid #999; padding: 2px; background: #FFF; box-sizing: border-box;">
              <img src="${avatarImg}" style="width: 100%; height: 100%; object-fit: cover;">
            </div>
          </div>

          <h4 style="margin: 0 0 12px 0; padding-bottom: 4px; border-bottom: 1px solid #c9a96e; color: #111; font-size: 13px; text-transform: uppercase;">Identification & Academic Timeline Details</h4>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px;">
            <div>
              <label style="display:block; font-size:11px; color:#666; font-weight:bold;">AADHAAR NUMBER</label>
              <span style="font-size:13px; letter-spacing:0.5px;">${student.aadhaarCardNumber || '-'}</span>
            </div>
            <div>
              <label style="display:block; font-size:11px; color:#666; font-weight:bold;">BATCH TIMELINE</label>
              <span style="font-size:13px; font-weight:bold;">${student.batch || '-'}</span>
            </div>
            <div>
              <label style="display:block; font-size:11px; color:#666; font-weight:bold;">EDUCATIONAL QUALIFICATION</label>
              <span style="font-size:13px;">${student.educationalQualification || '-'}</span>
            </div>
            <div>
              <label style="display:block; font-size:11px; color:#666; font-weight:bold;">CURRENT ENROLLMENT STATUS</label>
              <span style="font-size:12px; font-weight:bold; color:green;">${student.status || 'ACTIVE'}</span>
            </div>
          </div>

          <h4 style="margin: 0 0 12px 0; padding-bottom: 4px; border-bottom: 1px solid #c9a96e; color: #111; font-size: 13px; text-transform: uppercase;">Communication Matrix Ledger</h4>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px;">
            <div>
              <label style="display:block; font-size:11px; color:#666; font-weight:bold;">PHONE NUMBER</label>
              <span style="font-size:13px; font-weight:bold;">${student.phoneNumber || '-'}</span>
            </div>
            <div>
              <label style="display:block; font-size:11px; color:#666; font-weight:bold;">EMAIL ADDRESS</label>
              <span style="font-size:13px; color:#222;">${student.email || 'NIL'}</span>
            </div>
          </div>

          <div style="margin-bottom: 40px;">
            <label style="display:block; font-size:11px; color:#666; font-weight:bold; margin-bottom: 3px;">RESIDENTIAL CORRESPONDENCE ADDRESS</label>
            <div style="font-size:13px; line-height:1.4; background:#f9f9f9; padding:10px; border:1px solid #eee; border-radius:4px;">
              ${student.residentialAddress || '-'}<br>
              <strong>PO:</strong> ${student.postOffice || '-'} | <strong>Pincode:</strong> ${student.pincode || '-'}<br>
              <strong>District:</strong> ${student.district || '-'}
            </div>
          </div>

          <div style="position: absolute; bottom: 25mm; left: 20mm; right: 20mm; display: flex; justify-content: space-between;">
            <div style="text-align: center; width: 150px;">
              <div style="border-top: 1px dashed #666; margin-top: 40px; padding-top: 5px; font-size: 11px; color: #555;">Candidate Signature</div>
            </div>
            <div style="text-align: center; width: 180px;">
              <div style="border-top: 1px dashed #666; margin-top: 40px; padding-top: 5px; font-size: 11px; color: #555;">Institutional Coordinator Seal</div>
            </div>
          </div>

        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Close View</button>
      <button class="btn btn-gold" onclick="window.StudentApp.printA4Document()"><i class="fa fa-print"></i> Print Document Ledger</button>
    `;

    window.UI.openModal(modalTitle, body, footer);
  },

  // Target Print Engine Context Handler
  printA4Document() {
    const printContents = document.getElementById('print-a4-area').innerHTML;
    const originalContents = document.body.innerHTML;

    // Open a temporary printable window to isolate the target canvas block from external layout themes
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Student Ledger Print</title>
          <style>
            @page { size: A4 portrait; margin: 0; }
            body { margin: 0; background: #fff; padding: 0; }
            /* Force exact sizing mapping values inside print window viewports */
            #print-wrap { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm; box-sizing: border-box; }
          </style>
        </head>
        <body>
          <div id="print-wrap">${printContents}</div>
          <script>
            window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  },
  renderSkeleton() {
    const container = document.getElementById('student-table-body');
    if(container) container.innerHTML = Array(4).fill(`<tr><td colspan="5"><div class="skeleton-loader" style="height: 40px; width: 100%;"></div></td></tr>`).join('');
  }
};

window.StudentApp = StudentModule;