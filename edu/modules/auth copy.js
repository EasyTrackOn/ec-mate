// modules/auth.js
import { app, db } from '../services/firebase.js';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const auth = getAuth(app);
console.log("Firebase Auth initialized:", auth);
export const AuthModule = {
  currentUser: null,
  currentRole: null,
  institutionId: null,

  async init() {
    // Ensure sessions survive page reloads
    await setPersistence(auth, browserLocalPersistence);
    
    // Listen for auth state changes globally
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        await this.handleSuccessfulLogin(user);
      } else {
        this.handleLogoutUI();
      }
    });

    this.attachEventListeners();
  },

  attachEventListeners() {
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => this.login());
    }

    // Allow pressing "Enter" to submit the login form
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') {
        this.login();
      }
    });
  },

  async login() {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn-text');
    const errEl = document.getElementById('login-error');

    if (!email || !pass) {
      this.showError("Please enter both email and password.");
      return;
    }

    errEl.style.display = 'none';
    btn.textContent = 'Authenticating...';

    try {
      // 1. Authenticate with Firebase Auth
      console.log("Attempting Firebase Auth with email:", email, "and password:", pass ? pass : "(empty)");
      const userCredential = await signInWithEmailAndPassword(auth, email, pass);
      console.log("Firebase Auth successful:", userCredential);
      // 2. Fetch the user's role and institution from Firestore
      await this.handleSuccessfulLogin(userCredential.user);
      
      window.UI.showToast("Welcome back!", "success");

    } catch (error) {
      console.error("Login Error:", error);
      this.showError("Invalid email or password. Please try again.");
      btn.textContent = 'Sign In';
    }
  },

  async handleSuccessfulLogin(firebaseUser) {
    
    try {
      // Fetch user metadata from our 'users' collection (RBAC)
      //const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
      // We use .toLowerCase() to ensure there are no case-sensitivity mismatches
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.email.toLowerCase()));
      
      if (!userDoc.exists()) {
        throw new Error("User profile not found in database.");
      }

      const userData = userDoc.data();
      
      // Check if user is soft-deleted or blocked
      if (userData.isDeleted || userData.status === 'BLOCKED') {
        await this.logout(false);
        this.showError("Your account has been deactivated. Contact the administrator.");
        return;
      }

      this.currentUser = firebaseUser;
      this.currentRole = userData.role; // e.g., 'super_admin', 'institution_admin', 'teacher'
      this.institutionId = userData.institutionId;
      this.studentId = userData.studentId; // Grab this for the student!

// Inside AuthModule.launchAppUI()
if (this.currentRole === 'student') {
  // Hide Admin specific sidebar items
  document.querySelectorAll('.nav-section-label, .nav-item').forEach(el => {
    if (!el.classList.contains('logout')) el.style.display = 'none';
  });
  
  // Create a Student specific nav item
  const nav = document.getElementById('sidebar-nav');
  nav.insertAdjacentHTML('afterbegin', `
    <div class="nav-item active" id="nav-portal" onclick="window.Router.navigateTo('portal')">
      <div class="nav-icon"><i class="fa fa-user-graduate"></i></div>
      <span>My Portal</span>
    </div>
  `);
  
  window.Router.navigateTo('portal');
} else {
  // Admin Login Flow
  window.Router.navigateTo('dashboard');
}

      // Launch the application UI
      this.launchAppUI(userData);
      
    } catch (error) {
      console.error("Profile Fetch Error:", error);
      this.showError("Failed to load user profile.");
      await this.logout(false);
    }
  },

  async logout(showToast = true) {
    try {
      await signOut(auth);
      this.currentUser = null;
      this.currentRole = null;
      this.institutionId = null;
      
      this.handleLogoutUI();
      if (showToast) window.UI.showToast("Logged out successfully.", "success");
    } catch (error) {
      console.error("Logout Error:", error);
      window.UI.showToast("Error logging out.", "error");
    }
  },

  launchAppUI(userData) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display = 'block';

    // Populate user badge in the sidebar
    const name = userData.name || this.currentUser.email.split('@')[0];
    document.getElementById('user-name-badge').textContent = name;
    document.getElementById('user-email-badge').textContent = this.currentUser.email;
    document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();

    // Reset login button state for next time
    const btn = document.getElementById('login-btn-text');
    if(btn) btn.textContent = 'Sign In';

    // TODO: Route to appropriate dashboard based on this.currentRole
    // window.Router.navigateTo('dashboard');
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