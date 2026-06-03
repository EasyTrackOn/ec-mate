// modules/supplementary.js
// Supplementary Exam Portal — with Paytm Payment Gateway & Student Role Isolation

import {
  db,
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  doc,
  serverTimestamp,
} from '../services/firebase.js';

import { PaytmModule } from './paytm.js';

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────

const SUPPLY_FEE_PER_SUBJECT = 250; // ₹ per failed subject

const PAYMENT_STATUS = {
  PENDING:   'PENDING',
  SUCCESS:   'SUCCESS',
  FAILED:    'FAILED',
  REFUNDED:  'REFUNDED',
};

// ─────────────────────────────────────────────
//  Module Definition
// ─────────────────────────────────────────────

export const SupplyModule = {

  // ── State ──────────────────────────────────

  state: {
    eligibleStudents: [],
    allExams:         [],
    activeExamId:      '',
    activeBatch:       '',
    loading:           false,
  },

  // ── Lifecycle ──────────────────────────────

  /**
   * Entry point — called once when the portal tab is opened.
   * @param {string} institutionId  Caller's institution (ignored for super_admin)
   */
  async init(institutionId) {
    this._resetState();
    this.state.loading = true;
    this._renderSkeleton();

    try {
      await this._loadExams();
      this._renderFilterControls();
      await this._fetchEligibleStudents();
    } catch (err) {
      console.error('[SupplyModule] init error:', err);
      window.UI.showToast('Failed to initialise supplementary portal.', 'error');
    } finally {
      this.state.loading = false;
    }
  },

  // ── Data Fetching ──────────────────────────

  /** Load all exams into local cache for the filter dropdown. */
  async _loadExams() {
    const snap = await getDocs(collection(db, 'exams'));
    this.state.allExams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /**
   * Fetch eligible students applying active filters and role-based isolation.
   * Targets nested path: processed_results -> activeBatch -> records
   */
  async _fetchEligibleStudents() {
    if (!navigator.onLine) {
      window.UI.showToast('No internet connection. Please try again.', 'warning');
      return;
    }

    // ── Structural Guard ─────────────────────
    // Because it's a subcollection, we must have a batch name to build the path
    if (!this.state.activeBatch) {
      const container = document.getElementById('supply-table-body');
      if (container) {
        container.innerHTML = `
          <tr>
            <td colspan="5" class="empty-state">
              <i class="fa fa-filter" style="font-size: 24px; color: var(--accent-gold); margin-bottom: 10px; display: block;"></i>
              Please select an Academic Batch to load supplementary records.
            </td>
          </tr>
        `;
      }
      return;
    }

    this.state.loading = true;
    this._renderSkeleton();

    try {
      const constraints = [where('supplyEligible', '==', true)];

      // ── Role-based Campus Isolation ─────────
      const auth = window.AuthModule;

      if (auth?.currentRole === 'student') {
        // Students only see their own result record
        constraints.push(where('studentId', '==', auth.currentUser.uid));
      } else if (auth?.currentRole !== 'super_admin') {
        // Campus Staff/Admin: scoped directly to their institution code
        constraints.push(where('institutionId', '==', auth.institutionId));
      }
      // Super Admin: matches exam and batch without institution constraints!

      // ── Optional Exam Dropdown Filter ──────
      if (this.state.activeExamId) {
        constraints.push(where('examId', '==', this.state.activeExamId));
      }

      // ── Execute Subcollection Query ────────
      const collRef = collection(db, 'processed_results', this.state.activeBatch, 'records');
      const snapshot = await getDocs(query(collRef, ...constraints));

      this.state.eligibleStudents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      this._renderTable();

    } catch (err) {
      console.error('[SupplyModule] fetch error:', err);
      window.UI.showToast('Failed to load supplementary roster.', 'error');
    } finally {
      this.state.loading = false;
    }
  },

  // ── Filter Handlers ────────────────────────

  /** Called by dropdown elements onchange. */
  async handleFilterChange(filterType, value) {
    if (filterType === 'exam')  this.state.activeExamId = value;
    if (filterType === 'batch') this.state.activeBatch  = value;
    await this._fetchEligibleStudents();
  },

  // ── Payment & Registration Flow ────────────

  /**
   * Initiate Paytm payment interface for student's supplementary registration.
   */
  async initiatePayment(processedResultId, studentId, studentName, failedSubjects) {
    const totalFee  = failedSubjects.length * SUPPLY_FEE_PER_SUBJECT;
    const orderId   = `SUPPLY_${studentId}_${Date.now()}`;

    const confirmed = confirm(
      `Register ${studentName} for Supplementary Exams?\n` +
      `Subjects: ${failedSubjects.length}  |  Fee: ₹${totalFee}\n\n` +
      `You will be directed to the Paytm Gateway to complete the transaction.`
    );
    if (!confirmed) return;

    try {
      window.UI.showToast("Contacting Paytm Terminal...", "warning");

      // 1. Generate Transaction Token via Backend / Mock Sandbox Proxy
      const txnToken = await PaytmModule.generateTxnToken({
        orderId,
        amount:     totalFee.toFixed(2),
        customerId: studentId,
        mobile:     '', 
        email:      '', 
      });

      // 2. Open Paytm Checkout Widget Frame
      await PaytmModule.openCheckout({
        orderId,
        txnToken,
        amount: totalFee.toFixed(2),
        onSuccess: (paymentData) => this._onPaymentSuccess(
          processedResultId, studentId, studentName, failedSubjects, orderId, paymentData
        ),
        onFailure: (err) => this._onPaymentFailure(studentName, err),
      });

    } catch (err) {
      console.error('[SupplyModule] payment initiation error:', err);
      window.UI.showToast('Could not connect to payment gateway. Please retry.', 'error');
    }
  },

  /**
   * Triggered by PaytmModule upon successful transaction processing.
   * Commits the registration record and flips the result eligibility status flags atomically.
   */
  async _onPaymentSuccess(processedResultId, studentId, studentName, failedSubjects, orderId, paymentData) {
    try {
      window.UI.showToast("Securing registration ledger...", "warning");
      
      const record    = this._findRecord(processedResultId);
      const totalFee  = failedSubjects.length * SUPPLY_FEE_PER_SUBJECT;
      const batch     = writeBatch(db);

      // ── 1. Create flat global supply registration reference ──────
      const supplyRef = doc(collection(db, 'supply_registrations'));
      batch.set(supplyRef, {
        studentId,
        studentName,
        examId:           record?.examId        || this.state.activeExamId,
        batch:            record?.batch         || this.state.activeBatch,
        institutionId:    record?.institutionId || window.AuthModule?.institutionId || 'system',
        originalResultId: processedResultId,
        subjectsToRetake: failedSubjects.map(s => s.code),
        totalFee,
        paymentStatus:    PAYMENT_STATUS.SUCCESS,
        paymentOrderId:   orderId,
        paytmTxnId:       paymentData.TXNID     || '',
        paytmBankTxnId:   paymentData.BANKTXNID || '',
        paidAt:           serverTimestamp(),
        createdAt:        serverTimestamp(),
        createdBy:        window.AuthModule?.currentUser?.uid || 'system',
      });

      // ── 2. Target the exact nested document subcollection route to mutate flags ──
      const targetBatchFolder = record?.batch || this.state.activeBatch;
      const resultRef = doc(db, 'processed_results', targetBatchFolder, 'records', processedResultId);
      
      batch.update(resultRef, {
        supplyEligible:    false,
        supplyRegistered: true,
        supplyOrderId:     orderId,
        supplyPaidAt:      serverTimestamp(),
      });

      // Execute transaction batch atomically
      await batch.commit();

      window.UI.showToast(`✓ Supplementary confirmed for ${studentName}`, 'success');

      // ── 3. Update view pipeline structures instantly ──
      this.state.eligibleStudents = this.state.eligibleStudents.filter(
        s => s.id !== processedResultId
      );
      this._renderTable();

    } catch (err) {
      console.error('[SupplyModule] post-payment write error:', err);
      window.UI.showToast(
        'Payment captured, but write failed! Contact support with Order ID: ' + orderId,
        'error'
      );
    }
  },

  /** Triggered by Paytm Module upon terminal errors or interface cancellations */
  _onPaymentFailure(studentName, err) {
    console.warn('[SupplyModule] payment failed:', err);
    window.UI.showToast(`Payment declined for ${studentName}. No alterations were committed.`, 'error');
  },

  // ── Rendering Engine UI Components ──────────

  _renderFilterControls() {
    // Role Isolation Guard: Students shouldn't interact with operational dropdown matrices
    if (window.AuthModule?.currentRole === 'student') return;

    let container = document.getElementById('supply-filter-controls');
    if (!container) {
      container = document.createElement('div');
      container.id = 'supply-filter-controls';
      const tableWrap = document.querySelector('.table-wrap');
      if (!tableWrap) return;
      tableWrap.parentNode.insertBefore(container, tableWrap);
    }

    const uniqueBatches = [
      ...new Set(
        this.state.allExams
          .map(ex => ex.targetBatch || ex.batch)
          .filter(Boolean)
      ),
    ];

    container.innerHTML = `
      <div style="
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
        margin-bottom: 20px;
        background: rgba(0,0,0,0.15);
        padding: 15px;
        border-radius: 8px;
        border: 1px solid var(--border);
      ">
        <div class="form-floating">
          <select id="supply-filter-batch" onchange="window.SupplyApp.handleFilterChange('batch', this.value)">
            <option value="">-- Select Academic Batch (Required) --</option>
            ${uniqueBatches.map(b => `<option value="${b}" ${this.state.activeBatch === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select>
          <label>Academic Batch Timeline</label>
        </div>

        <div class="form-floating">
          <select id="supply-filter-exam" onchange="window.SupplyApp.handleFilterChange('exam', this.value)">
            <option value="">-- Filter All Active Examinations --</option>
            ${this.state.allExams.map(ex => `
              <option value="${ex.id}" ${this.state.activeExamId === ex.id ? 'selected' : ''}>
                ${ex.examName || ex.name}
              </option>
            `).join('')}
          </select>
          <label>Target Examination</label>
        </div>
      </div>
    `;
  },

  _renderTable() {
    const container = document.getElementById('supply-table-body');
    if (!container) return;

    if (!this.state.eligibleStudents.length) {
      container.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">
            No pending supplementary candidates match your selection criteria parameters.
          </td>
        </tr>
      `;
      return;
    }

    container.innerHTML = this.state.eligibleStudents.map(record => {
      const failedSubjects = (record.subjects || []).filter(s => !s.isPass);
      const totalFee       = failedSubjects.length * SUPPLY_FEE_PER_SUBJECT;
      const subjectBadges  = failedSubjects
        .map(s => `<span class="badge badge-rose" style="margin: 2px;">${s.code} (${s.desc || s.name || 'Core'})</span>`)
        .join('');

      return `
        <tr>
          <td>
            <strong>${record.name || record.candidateName}</strong><br>
            <small class="text-secondary">${record.regNo || record.registerNumber}</small>
          </td>
          <td>
            <div style="display:flex; gap:2px; flex-wrap:wrap; max-width: 300px;">
              ${subjectBadges}
            </div>
          </td>
          <td><span class="badge" style="background: rgba(255,255,255,0.1); font-weight:600;">${failedSubjects.length}</span></td>
          <td><strong style="color: var(--accent-gold); font-size: 14px;">₹${totalFee}</strong></td>
          <td>
            <button
              class="btn btn-gold btn-sm"
              style="padding: 6px 14px; font-size: 12px;"
              onclick='window.SupplyApp.initiatePayment(
                "${record.id}",
                "${record.studentId}",
                "${record.name || record.candidateName}",
                ${JSON.stringify(failedSubjects)}
              )'
            >
              <i class="fa fa-credit-card"></i> Pay & Register
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  _renderSkeleton() {
    const container = document.getElementById('supply-table-body');
    if (!container) return;
    container.innerHTML = Array(3).fill(`
      <tr>
        <td colspan="5">
          <div class="skeleton-loader" style="height:48px; width:100%;"></div>
        </td>
      </tr>
    `).join('');
  },

  // ── Operational Helpers ─────────────────────

  _resetState() {
    this.state.eligibleStudents = [];
    this.state.allExams         = [];
    this.state.activeExamId     = '';
    this.state.activeBatch      = '';
    this.state.loading          = false;
  },

  _findRecord(processedResultId) {
    return this.state.eligibleStudents.find(s => s.id === processedResultId) || null;
  },
};

// Bind to explicit namespace hook for routing engines and window layout frames
window.SupplyApp = SupplyModule;