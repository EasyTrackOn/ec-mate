// modules/auth.js
import { db, where } from '../services/firebase.js';
import { doc, getDoc,query, collection,getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const AuthModule = {
  currentUser: null,
  currentRole: null,
  institutionId: null,

  async init() {
    // Check local storage for manual session persistence
    const savedSession = localStorage.getItem('erp_session');
    if (savedSession) {
      const userData = JSON.parse(savedSession);
      console.log("Restoring session for:", userData);
      this.currentUser = { uid: userData.email, email: userData.email };
      this.currentRole = userData.role;
      this.institutionId = userData.institutionId;
      this.launchAppUI(userData);
    }

    this.attachEventListeners();
  },

  attachEventListeners() {
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => this.login());
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') {
        this.login();
      }
    });
  },

  async login() {
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pass = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn-text');
  const errEl = document.getElementById('login-error');

  if (!email || !pass) {
    this.showError("Please enter both email and password.");
    return;
  }

  if (errEl) errEl.style.display = 'none';
  btn.textContent = 'Verifying...';

  try {
    let userData = null;

    // 1. First Pass: Look directly into the master users collection using email as the Doc ID
    const userDoc = await getDoc(doc(db, 'users', email));
    
    if (userDoc.exists()) {
      userData = userDoc.data();
      // Ensure the record keeps its structural identity context
      if (!userData.role) userData.role = 'super_admin'; 
    } else {
      // 2. Second Pass: Query the institutions collection cleanly using collection queries
      const instQuery = query(
        collection(db, 'institutions'),
        where('email', '==', email),
        where('isDeleted', '==', false)
      );
      const instSnap = await getDocs(instQuery);

      if (!instSnap.empty) {
        const instDoc = instSnap.docs[0];
        userData = instDoc.data();
        userData.role = 'institution_admin'; 
        userData.institutionId = instDoc.id; // Treat document ID as the unique institution identifier
      } else {
        // 3. Third Pass: Search the partitioned students table repository collection
        const studentQuery = query(
          collection(db, 'students'),
          where('email', '==', email),
          where('isDeleted', '==', false)
        );
        const studentSnap = await getDocs(studentQuery);

        if (!studentSnap.empty) {
          const studentDoc = studentSnap.docs[0];
          userData = studentDoc.data();
          userData.role = 'student';
        }
      }
    }

    // Guard Clause: Throw exception if no document matches across all three entities
    if (!userData) {
      throw new Error("User profile not found.");
    }

    // 4. Manually verify the password matching bounds
    if (userData.password !== pass) {
      throw new Error("Invalid password.");
    }

    // 5. Check structural account visibility parameters
    if (userData.isDeleted || userData.status === 'BLOCKED') {
      throw new Error("Your account has been deactivated.");
    }

    // 6. Set Core Shared Session State
    this.currentUser = { uid: email, email: email };
    this.currentRole = userData.role;
    this.institutionId = userData.institutionId || null;

    // Synchronize down to browser session memory to survive runtime page reloads
    localStorage.setItem('erp_session', JSON.stringify(userData));

    window.UI.showToast("Welcome back!", "success");
    this.launchAppUI(userData);

  } catch (error) {
    console.error("Login System Exception:", error);
    this.showError(error.message || "Login failed. Please try again.");
    btn.textContent = 'Sign In';
  }
},

  async logout(showToast = true) {
    localStorage.removeItem('erp_session');
    this.currentUser = null;
    this.currentRole = null;
    this.institutionId = null;
    
    this.handleLogoutUI();
    if (showToast) window.UI.showToast("Logged out successfully.", "success");
  },

  launchAppUI(userData) {
    console.log("Launching app UI for role:", userData.role, "and institution ID:", userData.institutionId);
  // 1. Swap visibility containers between the authentication wall and workspace shell
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';

  // 2. Reset authentication loading spinner textual feedback status indicators
  const btn = document.getElementById('login-btn-text');
  if(btn) btn.textContent = 'Sign In';

  // 🔥 THE UPGRADE: Let sidebar utils handle user values and build menus safely
  if (window.SidebarUtils && typeof window.SidebarUtils.renderSidebar === 'function') {
    window.SidebarUtils.renderSidebar(userData);
  }

  // 3. Dynamic Router routing dispatch gates based on authentication rules
  if (this.currentRole === 'student') {
    window.Router.navigateTo('portal');
  } else {
    window.Router.navigateTo('dashboard');
  }
},

  handleLogoutUI() {
    document.getElementById('app-shell').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-password').value = '';
  },

  showError(msg) {
    const el = document.getElementById('login-error');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }
};