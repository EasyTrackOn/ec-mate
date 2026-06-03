// modules/teachers.js
import {InstitutionModule} from './institutions.js';
import { db, collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, where } from '../services/firebase.js';
window.InstitutionApp = InstitutionModule; // Make InstitutionModule globally accessible for use in this module
export const TeacherModule = {
  state: {
    teachers: [],
    loading: false
  },

  async fetchTeachers() {
  this.state.loading = true;
  this.renderSkeleton();

  try {
    const auth = window.AuthModule;
    const instId = auth.institutionId;

    // 1. Build core database-level query constraints array
    const constraints = [where('isDeleted', '==', false)];

    // ── Multi-Tenant Security Isolation Guard ──
    // Campus Admins only pull staff from their own campus; Super Admins bypass this to view the global directory
    if (auth.currentRole !== 'super_admin') {
      constraints.push(where('institutionId', '==', instId));
    }

    // 2. Fetch records (Firestore implicitly resolves this cache-first via IndexedDB persistence)
    const q = query(collection(db, 'teachers'), ...constraints);
    const snap = await getDocs(q);
    
    // 3. Map result parameters directly into local module memory state trees
    this.state.teachers = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 4. Render the UI data table with freshly compiled metrics instantly
    this.renderTable(this.state.teachers);

  } catch (error) {
    console.error("[TeacherModule] Fetch failure: ", error);
    window.UI.showToast("Failed to compile staff directory from database storage.", "error");
  } finally {
    this.state.loading = false;
  }
},
  // --- DYNAMIC MODAL WITH ROLE-BASED UI ---
  async openAddModal() {
    const currentRole = window.AuthModule.currentRole;
    const userInstId = window.AuthModule.institutionId;
    let instDropdownHtml = '';

    // If Super Admin, fetch institutions and build the dropdown
    if (currentRole === 'super_admin') {
      const institutions = await window.InstitutionApp.getAllActiveInstitutions();
      const options = institutions.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
      
      instDropdownHtml = `
        <div class="form-floating" style="margin-bottom: 15px;">
          <select id="new-teach-inst">
            <option value="">-- Select Institution --</option>
            ${options}
          </select>
          <label>Assign to Campus</label>
        </div>
      `;
    } else {
      // If normal admin, use a hidden input with their locked ID
      instDropdownHtml = `<input type="hidden" id="new-teach-inst" value="${userInstId}">`;
    }

    const body = `
      ${instDropdownHtml}
      <div class="form-floating">
        <input id="new-teach-name" placeholder="Name">
        <label>Full Name</label>
      </div>
      <div class="form-floating">
        <input type="email" id="new-teach-email" placeholder="Email">
        <label>Email Address</label>
      </div>
      <div class="form-floating">
        <input id="new-teach-dept" placeholder="Department">
        <label>Department (e.g., Mathematics)</label>
      </div>
    `;

    const footer = `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Cancel</button>
      <button class="btn btn-gold" onclick="window.TeacherApp.submitNew()">Add Teacher</button>
    `;

    window.UI.openModal('Add New Teacher', body, footer);
  },

  async submitNew() {
    const name = document.getElementById('new-teach-name').value.trim();
    const email = document.getElementById('new-teach-email').value.trim().toLowerCase();
    const dept = document.getElementById('new-teach-dept').value.trim();
    const institutionId = document.getElementById('new-teach-inst').value;

    if (!name || !email || !institutionId) {
      window.UI.showToast("Please fill in all required fields.", "error");
      return;
    }

    try {
      const payload = {
        name,
        email,
        department: dept || 'General',
        institutionId,
        status: 'ACTIVE',
        isDeleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(), // 🔥 ADD THIS TO ALL CREATES
        createdBy: window.AuthModule.currentUser.email
      };

      await addDoc(collection(db, 'teachers'), payload);
      window.UI.showToast("Teacher added successfully!", "success");
      window.UI.closeModal();
      this.fetchTeachers(); // Refresh table

    } catch (error) {
      window.UI.showToast("Error adding teacher: " + error.message, "error");
    }
  },

  async softDeleteTeacher(id) {
    if(!confirm("Are you sure you want to remove this teacher?")) return;
    try {
      await updateDoc(doc(db, 'teachers', id), {
        isDeleted: true,
        updatedAt: serverTimestamp(),
        updatedBy: window.AuthModule.currentUser.email
      });
      window.UI.showToast("Teacher removed.", "success");
      this.fetchTeachers();
    } catch(e) {
      window.UI.showToast("Action denied.", "error");
    }
  },

  handleSearch(query) {
    const lowerQ = query.toLowerCase();
    const filtered = this.state.teachers.filter(t =>
      t.name.toLowerCase().includes(lowerQ) ||
      t.email.toLowerCase().includes(lowerQ) ||
      (t.department && t.department.toLowerCase().includes(lowerQ))
    );
    this.renderTable(filtered);
  },

  renderTable(data) {
    const container = document.getElementById('teacher-table-body');
    if(!container) return;

    if(data.length === 0) {
      container.innerHTML = `<tr><td colspan="5" class="empty-state">No teachers found.</td></tr>`;
      return;
    }

    container.innerHTML = data.map(t => `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="user-avatar" style="width: 32px; height: 32px; font-size: 13px;">${t.name.charAt(0)}</div>
            <strong>${t.name}</strong>
          </div>
        </td>
        <td>${t.email}</td>
        <td>${t.department || '—'}</td>
        <td><span class="badge ${t.status === 'ACTIVE' ? 'badge-teal' : 'badge-rose'}">${t.status}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" title="Edit"><i class="fa fa-pen"></i></button>
          <button class="btn btn-danger btn-sm" onclick="window.TeacherApp.softDeleteTeacher('${t.id}')" title="Delete"><i class="fa fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
  },

  renderSkeleton() {
    const container = document.getElementById('teacher-table-body');
    if(container) container.innerHTML = Array(3).fill(`<tr><td colspan="5"><div class="skeleton-loader" style="height: 48px; width: 100%;"></div></td></tr>`).join('');
  }
};