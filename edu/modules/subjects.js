// modules/subjects.js
import { CacheEngine } from '../utils/localDb.js';
import { db, collection, getDocs, query, where, addDoc, updateDoc, doc, serverTimestamp } from '../services/firebase.js';

export const SubjectModule = {
  state: {
    subjects: [],
    loading: false,
    searchQuery: ''
  },

  async fetchSubjects() {
  this.state.loading = true;
  this.renderSkeleton();

  try {
    // 1. Build a direct query constraint looking for non-deleted curriculum records
    // This shifts the filtering logic from heavy client-side JS arrays directly into the database index layer
    const q = query(
      collection(db, 'subjects'),
      where('isDeleted', '==', false)
    );

    // 2. Fetch documents (Firestore automatically performs Cache-First resolution from its local IndexedDB store)
    const snap = await getDocs(q);
    
    // 3. Map snapshot parameters straight into your local module state tracking arrays
    this.state.subjects = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 4. Render UI tables with the loaded master entries instantly
    this.renderTable(this.state.subjects);

  } catch (error) {
    console.error("[SubjectModule] Synchronization failure: ", error);
    window.UI.showToast("Failed to compile subject directories from database cache.", "error");
  } finally {
    this.state.loading = false;
  }
},

  async addSubject(subjectData) {
  try {
    // 1. Duplicate prevention check using current standardized state cache array matching
    const targetCode = subjectData.subjectCode ? subjectData.subjectCode.trim().toUpperCase() : '';
    if (!targetCode) throw new Error("Subject Code cannot be empty.");

    // Check against existing cached local modules map arrays to catch quick repeats
    const exists = this.state.subjects.some(s => {
      const existingCode = s.subjectCode || s.code || '';
      return existingCode.toUpperCase() === targetCode;
    });
    
    if (exists) throw new Error(`Subject Code ${targetCode} already exists!`);

    // 2. Build uniform structural collection payload document matrix
    const payload = {
      ...subjectData,
      subjectCode: targetCode, // Standardize codes to uppercase directly
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: window.AuthModule?.currentUser?.uid || 'system',
      isDeleted: false,
      status: 'ACTIVE'
    };

    // 3. Native Persistence execution (Acts identically online or offline)
    await addDoc(collection(db, 'subjects'), payload);
    
    // 4. Trigger localized success UI toast alerts instantly
    window.UI.showToast("Subject added successfully.", "success");
    
    // 5. Refresh your local module state memories automatically
    this.fetchSubjects(); 

  } catch (error) {
    console.error("[SubjectMaster Engine Error]:", error);
    window.UI.showToast(error.message || "Failed to save subject parameters.", "error");
  }
},
// --- MODAL HELPERS ---
  openAddModal() {
    const body = `
      <div class="form-floating">
        <input id="new-sub-code" placeholder="Code">
        <label>Subject Code</label>
      </div>
      <div class="form-floating">
        <input id="new-sub-name" placeholder="Name">
        <label>Subject Name</label>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
        <div class="form-floating">
          <input type="number" id="new-sub-max" placeholder="Max" value="100">
          <label>Max Marks</label>
        </div>
        <div class="form-floating">
          <input type="number" id="new-sub-pass" placeholder="Pass" value="40">
          <label>Pass Marks</label>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Cancel</button>
      <button class="btn btn-gold" onclick="window.SubjectApp.submitNew()">Save Subject</button>
    `;

    window.UI.openModal('Add New Subject', body, footer);
  },

  submitNew() {
    const subjectCode = document.getElementById('new-sub-code').value.trim();
    const subjectName = document.getElementById('new-sub-name').value.trim();
    const maxMark = parseInt(document.getElementById('new-sub-max').value, 10);
    const passMark = parseInt(document.getElementById('new-sub-pass').value, 10);

    // Validation to prevent bad data
    if (!subjectCode || !subjectName || isNaN(maxMark) || isNaN(passMark)) {
      window.UI.showToast("Please fill in all fields correctly.", "error");
      return;
    }

    this.addSubject({ subjectCode, subjectName, maxMark, passMark });
    window.UI.closeModal();
  },
  async softDeleteSubject(subjectId) {
    if(!confirm("Are you sure you want to delete this subject? It will be archived to maintain historical exam records.")) return;
    try {
      const payload = {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(), // 🔥 ADD THIS TO ALL CREATES
        deletedBy: window.AuthModule.currentUser.uid,
        status: 'ARCHIVED'
      };
      
      const docRef = doc(db, 'subjects', subjectId);
      await updateDoc(docRef, payload);
      
      window.UI.showToast("Subject archived successfully", "success");
      this.fetchSubjects();
    } catch (error) {
       window.UI.showToast(error.message, "error");
    }
  },

  // Premium Feature: CSV Export
  exportToCSV() {
    if (!this.state.subjects.length) {
      window.UI.showToast("No data to export.", "warning");
      return;
    }

    const headers = ["Subject Code,Subject Name,Short Name,Type,Category,Max Marks,Pass Marks,Status"];
    const rows = this.state.subjects.map(s => 
      `${s.subjectCode},"${s.subjectName}",${s.shortName},${s.subjectType},${s.category},${s.maxMark},${s.passMark},${s.status}`
    );
    
    const csvContent = "data:text/csv;charset=utf-8," + headers.concat(rows).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Subjects_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  handleSearch(queryText) {
    this.state.searchQuery = queryText.toLowerCase();
    const filtered = this.state.subjects.filter(sub => 
      sub.subjectName.toLowerCase().includes(this.state.searchQuery) || 
      sub.subjectCode.toLowerCase().includes(this.state.searchQuery)
    );
    this.renderTable(filtered);
  },

  renderTable(data) {
    const container = document.getElementById('subject-table-body');
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `<tr><td colspan="7" class="empty-state">No subjects found.</td></tr>`;
      return;
    }
    
    container.innerHTML = data.map(sub => `
      <tr>
        <td><strong>${sub.subjectCode}</strong></td>
        <td>
          <strong>${sub.subjectName}</strong><br>
          <small class="text-secondary">${sub.shortName}</small>
        </td>
        <td><span class="badge badge-teal">${sub.subjectType}</span></td>
        <td>${sub.category}</td>
        <td>
          <small>Max: ${sub.maxMark}</small><br>
          <small style="color: var(--danger)">Pass: ${sub.passMark}</small>
        </td>
        <td><span class="badge ${sub.status === 'ACTIVE' ? 'badge-teal' : 'badge-rose'}">${sub.status}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.SubjectApp.edit('${sub.id}')"><i class="fa fa-pen"></i></button>
          <button class="btn btn-danger btn-sm" onclick="window.SubjectApp.softDeleteSubject('${sub.id}')"><i class="fa fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
  },

  renderSkeleton() {
    const container = document.getElementById('subject-table-body');
    if (!container) return;
    container.innerHTML = Array(4).fill(`<tr><td colspan="7"><div class="skeleton-loader" style="height: 40px; width: 100%;"></div></td></tr>`).join('');
  }
};