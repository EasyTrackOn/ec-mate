// modules/institutions.js
import { CacheEngine } from '../utils/localDb.js';
import { AuthModule } from './auth.js';
window.AuthModule = AuthModule; // Make AuthModule globally accessible for use in this module
// Changed 'addDoc' to 'setDoc' and imported 'doc' for custom ID generation
import { db, collection, getDocs, query, where, setDoc, doc, updateDoc, serverTimestamp } from '../services/firebase.js';

export const InstitutionModule = {
  state: {
    institutions: [],
    loading: false,
    searchQuery: ''
  },

  async fetchInstitutions() {
    this.state.loading = true;
    this.renderSkeleton();

    try {
      // 1. Build simple active query constraint
      const q = query(
        collection(db, 'institutions'),
        where('isDeleted', '==', false)
      );

      // 2. Fetch documents (Firestore implicitly handles Cache-First execution)
      const snap = await getDocs(q);
      
      // 3. Map documents to state array memory locations
      this.state.institutions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 4. Render output tables with freshly loaded metrics
      this.renderTable(this.state.institutions);

    } catch (error) {
      console.error("[InstitutionModule] Fetch failure: ", error);
      window.UI.showToast("Failed to load matching institution directories.", "error");
    } finally {
      this.state.loading = false;
    }
  },

  // Helper to fetch all active institutions for dropdowns
  async getAllActiveInstitutions() {
    try {
      // 1. Build a direct query constraint looking for non-deleted records
      const q = query(collection(db, 'institutions'), where('isDeleted', '==', false));
      
      // 2. Fetch documents (Firestore automatically reads your local IndexedDB cache first)
      const snap = await getDocs(q);
      
      // 3. Map directly to a clean data array and return it
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));

    } catch (error) {
      console.error("Failed to fetch institutions with native persistence routing:", error);
      return [];
    }
  },

  async addInstitution(instData) {
    try {
      // 1. Duplicate prevention check using the code as the document lookup
      const exists = this.state.institutions.some(i => i.code.toLowerCase() === instData.code.toLowerCase());
      if (exists) throw new Error(`Institution with code ${instData.code} already exists.`);
      
      // 2. Build the uniform structural payload document matrix
      const payload = {
        ...instData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: window.AuthModule?.currentUser?.uid || 'system',
        isDeleted: false,
        status: 'ACTIVE' // ACTIVE or INACTIVE
      };

      // 3. Generate Custom Document Reference using the institution code as the Doc ID
      const docRef = doc(db, 'institutions', instData.code);
      
      // 4. Use setDoc instead of addDoc to write with the custom identifier
      await setDoc(docRef, payload);
      
      // 5. Trigger localized success UI toasts instantly
      window.UI.showToast("Institution registered successfully.", "success");
      
      // 6. Refresh your cached view state maps automatically
      this.fetchInstitutions(); 

    } catch (error) {
      console.error("[InstitutionModule] Registration failure: ", error);
      window.UI.showToast(error.message || "Failed to register institution.", "error");
    }
  },

  // --- MODAL HELPERS ---
  openAddModal() {
    // Multi-line HTML includes all newly requested layout tracking fields
    const body = `
      <div class="form-floating mb-2">
        <input id="new-inst-code" class="form-control" placeholder="Code">
        <label>Institution Code (Will be used as ID)</label>
      </div>
      <div class="form-floating mb-2">
        <input id="new-inst-name" class="form-control" placeholder="Name">
        <label>Institution Name</label>
      </div>
      <div class="form-floating mb-2">
        <input id="new-inst-email" type="email" class="form-control" placeholder="Email">
        <label>Email Address</label>
      </div>
      <div class="form-floating mb-2">
        <input id="new-inst-password" type="password" class="form-control" placeholder="Password">
        <label>Password</label>
      </div>
      <div class="form-floating mb-2">
        <input id="new-inst-contact" class="form-control" placeholder="Contact">
        <label>Contact Number</label>
      </div>
      <div class="form-floating mb-2">
        <input id="new-inst-principal" class="form-control" placeholder="Principal">
        <label>Principal Name</label>
      </div>
      <div class="form-floating mb-2">
        <input id="new-inst-place" class="form-control" placeholder="Place">
        <label>Place / Location</label>
      </div>
    `;

    const footer = `
      <button class="btn btn-outline" onclick="window.UI.closeModal()">Cancel</button>
      <button class="btn btn-gold" onclick="window.InstitutionApp.submitNew()">Save</button>
    `;

    window.UI.openModal('Add Institution', body, footer);
  },

  submitNew() {
    const code = document.getElementById('new-inst-code').value.trim();
    const name = document.getElementById('new-inst-name').value.trim();
    const email = document.getElementById('new-inst-email').value.trim();
    const password = document.getElementById('new-inst-password').value.trim();
    const contactNumber = document.getElementById('new-inst-contact').value.trim();
    const principalName = document.getElementById('new-inst-principal').value.trim();
    const place = document.getElementById('new-inst-place').value.trim();
    
    // Validate required fields
    if (!code || !name || !email || !password || !contactNumber || !principalName || !place) {
      window.UI.showToast("Please fill in all fields", "error");
      return;
    }

    this.addInstitution({ 
      code, 
      name, 
      email, 
      password, 
      contactNumber, 
      principalName, 
      place 
    });
    window.UI.closeModal();
  },

  async toggleStatus(instId, currentStatus) {
    try {
      const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const payload = {
        status: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy: window.AuthModule.currentUser.uid
      };
      
      const docRef = doc(db, 'institutions', instId);
      await updateDoc(docRef, payload);
      
      window.UI.showToast(`Institution marked as ${newStatus}`, "success");
      this.fetchInstitutions();
    } catch (error) {
       window.UI.showToast(error.message, "error");
    }
  },

  async softDeleteInstitution(instId) {
    if(!confirm("Are you sure you want to completely remove this institution? This action will hide it from the system.")) return;
    try {
      const payload = {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        deletedBy: window.AuthModule.currentUser.uid,
        status: 'ARCHIVED'
      };
      
      const docRef = doc(db, 'institutions', instId);
      await updateDoc(docRef, payload);
      
      window.UI.showToast("Institution deleted securely.", "success");
      this.fetchInstitutions();
    } catch (error) {
       window.UI.showToast(error.message, "error");
    }
  },

  handleSearch(queryText) {
    this.state.searchQuery = queryText.toLowerCase();
    const filtered = this.state.institutions.filter(inst => 
      (inst.name && inst.name.toLowerCase().includes(this.state.searchQuery)) || 
      (inst.code && inst.code.toLowerCase().includes(this.state.searchQuery)) ||
      (inst.place && inst.place.toLowerCase().includes(this.state.searchQuery))
    );
    this.renderTable(filtered);
  },

  renderTable(data) {
    const container = document.getElementById('institution-table-body');
    if (!container) return;

    if (!data.length) {
      container.innerHTML = `<tr><td colspan="6" class="empty-state">No institutions found.</td></tr>`;
      return;
    }
    
    container.innerHTML = data.map(inst => `
      <tr>
        <td><strong>${inst.code}</strong></td>
        <td>
          <strong>${inst.name}</strong><br>
          <small class="text-secondary">${inst.place || ''} | ${inst.email || ''}</small>
        </td>
        <td>${inst.principalName || ''}</td>
        <td>${inst.contactNumber || ''}</td>
        <td><span class="badge ${inst.status === 'ACTIVE' ? 'badge-teal' : 'badge-rose'}">${inst.status}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window.InstitutionApp.toggleStatus('${inst.id}', '${inst.status}')" title="Toggle Status"><i class="fa fa-power-off"></i></button>
          <button class="btn btn-danger btn-sm" onclick="window.InstitutionApp.softDeleteInstitution('${inst.id}')" title="Delete"><i class="fa fa-trash"></i></button></td>
      </tr>
    `).join('');
  },

  renderSkeleton() {
    const container = document.getElementById('institution-table-body');
    if (!container) return;
    container.innerHTML = Array(3).fill(`<tr><td colspan="6"><div class="skeleton-loader" style="height: 48px; width: 100%;"></div></td></tr>`).join('');
  }
};