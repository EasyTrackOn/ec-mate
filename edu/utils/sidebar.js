// utils/sidebar.js
import { AuthModule } from '../modules/auth.js';
// 1. Navigation Access Matrix Map
const SIDEBAR_NAVIGATION_SCHEMA = [
  {
    section: "Overview",
    roles: ["super_admin", "institution_admin", "student"],
    items: [
      { id: "nav-dashboard", label: "Dashboard", icon: "fa-gauge-high" }
    ]
  },
  {
    section: "Master Data",
    roles: ["super_admin", "institution_admin"],
    items: [
      { id: "nav-institutions", label: "Institutions", icon: "fa-building-columns", roles: ["super_admin"] },
      { id: "nav-students", label: "Students", icon: "fa-user-graduate", roles: ["super_admin", "institution_admin"] },
      { id: "nav-teachers", label: "Teachers", icon: "fa-person-chalkboard", roles: ["super_admin", "institution_admin"] },
      { id: "nav-subjects", label: "Subjects", icon: "fa-book", roles: ["super_admin", "institution_admin"] }
    ]
  },
  {
    section: "Examination Cycle",
    roles: ["super_admin", "institution_admin", "student"],
    items: [
      { id: "nav-exams", label: "Exams & Timetable", icon: "fa-calendar-days", roles: ["super_admin", "institution_admin", "student"] },
      { id: "nav-marks", label: "Mark Entry", icon: "fa-pen-to-square", roles: ["super_admin", "institution_admin"] },
      { id: "nav-analysis", label: "Result Processing", icon: "fa-chart-pie", roles: ["super_admin", "institution_admin"] },
      { id: "nav-supplementary", label: "Supplementary", icon: "fa-rotate-right", roles: ["super_admin", "institution_admin", "student"] },
      { id: "nav-revaluation", label: "Revaluations", icon: "fa-scale-balanced", roles: ["super_admin", "institution_admin", "student"] }
    ]
  },
  {
    section: "Administration",
    roles: ["super_admin", "institution_admin", "student"],
    items: [
      { id: "nav-print", label: "Print Center", icon: "fa-print", roles: ["super_admin", "institution_admin"] }
    ]
  }
];

// 2. Main Sidebar Layout Compilation Engine
// 🔥 UPDATED: Accepts the userData object parameter passed from launchAppUI
export function renderSidebar(userData) {
  const sidebarNavContainer = document.getElementById('sidebar-nav');
  if (!sidebarNavContainer) return;

  // Read role and user properties straight out of the incoming payload argument
  // Fallbacks are kept active to prevent crashes if fields are missing
  const currentRole = userData?.role || window.AuthModule?.currentRole || 'student';
  const email = userData?.email || 'user@elite.com';
  const name = userData?.name || email.split('@')[0];

  let sidebarHtml = '';

  // Process sections matching user visibility rules matrix mapping
  SIDEBAR_NAVIGATION_SCHEMA.forEach(sectionGroup => {
    if (!sectionGroup.roles.includes(currentRole)) return;

    // Filter module links inside the current section loop context
    const allowedItems = sectionGroup.items.filter(item => {
      return !item.roles || item.roles.includes(currentRole);
    });

    if (allowedItems.length === 0) return;

    // Build the section text title layout
    sidebarHtml += `<div class="nav-section-label">${sectionGroup.section}</div>`;

    // Map out navigation tracking buttons
    allowedItems.forEach(item => {
      sidebarHtml += `
        <div class="nav-item" id="${item.id}" onclick="window.SidebarUtils.handleNavigationClick('${item.id}')">
          <div class="nav-icon"><i class="fa ${item.icon}"></i></div>
          <span>${item.label}</span>
        </div>
      `;
    });
  });

  // Inject permanent trailing actions (Logout trigger link anchor)
  sidebarHtml += `
    <div class="nav-item logout" id="btn-logout">
      <div class="nav-icon"><i class="fa fa-arrow-right-from-bracket"></i></div>
      <span>Logout</span>
    </div>
  `;

  // Write compiled string to DOM
  sidebarNavContainer.innerHTML = sidebarHtml;
document.getElementById('btn-logout').addEventListener('click', () => {
  if (confirm("Are you sure you want to logout?")) {
    AuthModule.logout();
  }
});
  // Update Visual Profile Badges Core Elements with incoming arguments
  const nameBadge = document.getElementById('user-name-badge');
  const emailBadge = document.getElementById('user-email-badge');
  const avatarBadge = document.getElementById('user-avatar');

  if (nameBadge) nameBadge.textContent = name;
  if (emailBadge) emailBadge.textContent = email;
  if (avatarBadge) {
    avatarBadge.textContent = name.charAt(0).toUpperCase();
  }

  // Set default initial lighting highlights on dashboard
  const initialTab = document.getElementById('nav-dashboard');
  if (initialTab) initialTab.classList.add('active');
}

// 4. Interactive Click Highlighting Handler Logic
export function handleNavigationClick(viewElementId) {
  // Clear highlighted active classes on all siblings inside navigation drawer links list
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
    el.classList.remove('active');
  });

  // Add highlight back onto targeted button triggers
  const targetElement = document.getElementById(viewElementId);
  if (targetElement) targetElement.classList.add('active');

  // Trigger main panel router page shifts inside your central app engine configuration mapping arrays
  if (window.AppEngine && typeof window.AppEngine.switchView === 'function') {
    window.AppEngine.switchView(viewElementId);
  }
  
}

// Global System Namespace Registration Bridge
window.SidebarUtils = {
  renderSidebar,
  handleNavigationClick
};
