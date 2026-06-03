// modules/markAnalysis.js
import { CacheEngine } from '../utils/localDb.js';
import { db, collection, getDocs, query, where, writeBatch, doc, serverTimestamp } from '../services/firebase.js';

export const MarkAnalysisModule = {
  state: {
    exams: [],
    selectedExam: null,
    subjects: [],
    students: [],
    rawMarks: [], 
    processedData: null, 
    loading: false
  },

  // 1. Unified Setup Engine - Everyone fetches the Central Exam Configurations
  async init(institutionId) {
  this.state.loading = true;
  
  try {
    const auth = window.AuthModule;

    // 1. Build query constraints for Exams
    const examConstraints = [
      where('isDeleted', '==', false),
      where('publishStatus', '!=', 'DRAFT') // Faster: exclude DRAFT directly at the query level
    ];

    // Force institution isolation unless the user is a super admin
    if (auth?.currentRole !== 'super_admin') {
      examConstraints.push(where('institutionId', '==', auth.institutionId));
    }

    // 2. Fetch Exams (Firestore natively checks local persistence first, then updates from network)
    const examQuery = query(collection(db, 'exams'), ...examConstraints);
    const examSnap = await getDocs(examQuery);
    this.state.exams = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 3. Fetch Active Subjects utilizing local persistent cache instantly
    const subjectQuery = query(collection(db, 'subjects'), where('isDeleted', '==', false));
    const subSnap = await getDocs(subjectQuery);
    this.state.subjects = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 4. Render the controls workspace layout
    this.renderControls();

  } catch (e) {
    console.error("Analysis initialization failure:", e);
    window.UI.showToast("Failed to load analysis engine parameters.", "error");
  } finally {
    this.state.loading = false;
  }
},

  // 2. Data Gathering Pipeline - strictly institution-isolated analytics aggregation
  async loadAnalysis() {
  const examId = document.getElementById('analysis-exam-select').value;
  if (!examId) return;

  this.state.selectedExam = this.state.exams.find(e => e.id === examId);
  this.state.loading = true;
  this.renderSkeleton();

  const auth = window.AuthModule;
  const instId = auth.institutionId; 
  const targetBatch = this.state.selectedExam.batch;

  try {
    // ── STEP A: Pull Students (Filtered directly at the database query level) ──
    const studentConstraints = [
      where('batch', '==', targetBatch),
      where('isDeleted', '==', false)
    ];

    // Multi-tenant isolation boundary guard
    if (auth.currentRole !== 'super_admin') {
      studentConstraints.push(where('institutionId', '==', instId));
    }

    const studentQuery = query(collection(db, 'students'), ...studentConstraints);
    const stuSnap = await getDocs(studentQuery);
    this.state.students = stuSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (this.state.students.length === 0) {
      this.state.processedData = null;
      document.getElementById('analysis-content').innerHTML = `
        <div class="empty-state">No students found for batch ${targetBatch}.</div>
      `;
      this.state.loading = false;
      return;
    }

    // ── STEP B: Direct Dynamic Subcollection Query for Marks ──
    this.state.rawMarks = [];
    console.log(`Analyzing batch: ${targetBatch} | Exam: ${examId}`);

    const marksConstraints = [where('examId', '==', examId)];
    
    if (auth.currentRole !== 'super_admin') {
      marksConstraints.push(where('institutionId', '==', instId));
    }

    // Target the specific nested subcollection path natively
    const marksQuery = query(collection(db, 'marks', targetBatch, 'records'), ...marksConstraints);
    const recordsSnap = await getDocs(marksQuery);

    // Unpack dynamic score objects from the snapshot documents
    recordsSnap.forEach(docSnap => {
      const reportCard = docSnap.data();
      const studentId = reportCard.studentId;

      Object.keys(reportCard).forEach(key => {
        if (key.startsWith('scores_')) {
          const subjectCode = key.replace('scores_', ''); 
          const record = reportCard[key]; 

          this.state.rawMarks.push({
            studentId: studentId,
            subjectCode: subjectCode,
            desc: record.desc !== undefined ? record.desc : 0,
            omr: record.omr !== undefined ? record.omr : 0,
            ce: record.ce !== undefined ? record.ce : 0,
            status: record.status
          });
        }
      });
    });
    
    console.log(`Unpacked ${this.state.rawMarks.length} raw subject component entries into calculation grid.`);

    // ── STEP C: Execute Analytics Calculation Pipeline ──
    this.runProcessingPipeline();
    this.renderDashboard();

  } catch (e) {
    console.error("Analytics processing crash:", e);
    window.UI.showToast("Error processing analytics configurations: " + e.message, "error");
  } finally {
    this.state.loading = false;
  }
},

  runProcessingPipeline() {
    let totalPass = 0;
    let totalFail = 0;
    let subjectAnalytics = {};
    let studentResults = [];

    this.state.subjects.forEach(s => {
      subjectAnalytics[s.subjectCode] = { name: s.subjectName, totalAppeared: 0, passed: 0, failed: 0, highest: 0 };
    });

    const expectedSubjectCount = this.state.selectedExam.schedule.length;
    const currentInstId = window.AuthModule.institutionId; 

    this.state.students.forEach(student => {
      const studentMarks = this.state.rawMarks.filter(m => m.studentId === student.id);
      
      if (studentMarks.length < expectedSubjectCount) {
        console.warn(`Skipping calculation for ${student.candidateName} - entries incomplete (${studentMarks.length}/${expectedSubjectCount} subjects scored).`);
        return; 
      }

      let studentTotal = 0;
      let hasFailed = false;
      let failedSubjects = [];
      let processedSubjects = [];

      studentMarks.forEach(record => {
        const scheduleItem = this.state.selectedExam.schedule.find(s => s.subjectCode.trim().toUpperCase() === record.subjectCode.trim().toUpperCase());
        if (!scheduleItem) return;

        const crit = scheduleItem.markCriteria || { descMax: 50, descPass: 20, omrMax: 20, omrPass: 8, ceMax: 30, cePass: 12 };
        const isAbsent = record.status === 'A';

        const descScore = isAbsent ? 0 : parseFloat(record.desc || 0);
        const omrScore = isAbsent ? 0 : parseFloat(record.omr || 0);
        const ceScore = isAbsent ? 0 : parseFloat(record.ce || 0);

        // Individual sectional pass check verification
        const isSubjectPass = !isAbsent && (descScore >= crit.descPass) && (omrScore >= crit.omrPass) && (ceScore >= crit.cePass);
        const subjectTotalMark = descScore + omrScore + ceScore;
        const totalMaxAllowed = crit.descMax + crit.omrMax + crit.ceMax;

        if (subjectAnalytics[record.subjectCode]) {
          subjectAnalytics[record.subjectCode].totalAppeared++;
          if (isSubjectPass) subjectAnalytics[record.subjectCode].passed++;
          else subjectAnalytics[record.subjectCode].failed++;
          
          if (subjectTotalMark > subjectAnalytics[record.subjectCode].highest) {
            subjectAnalytics[record.subjectCode].highest = subjectTotalMark;
          }
        }

        studentTotal += subjectTotalMark;
        if (!isSubjectPass) {
          hasFailed = true;
          failedSubjects.push(scheduleItem.subjectCode);
        }

        processedSubjects.push({
          code: scheduleItem.subjectCode,
          name: scheduleItem.subjectName,
          desc: isAbsent ? 'AB' : descScore,
          omr: isAbsent ? 'AB' : omrScore,
          ce: isAbsent ? 'AB' : ceScore,
          total: isAbsent ? 'AB' : subjectTotalMark,
          isPass: isSubjectPass,
          grade: this.calculateGrade(isAbsent ? 'AB' : subjectTotalMark, totalMaxAllowed)
        });
      });

      if (hasFailed) totalFail++; else totalPass++;
      
      studentResults.push({
        studentId: student.id,
        institutionId: student.institutionId || currentInstId, 
        name: student.candidateName,
        regNo: student.registerNumber,
        total: studentTotal,
        result: hasFailed ? 'FAILED' : 'PASSED',
        supplyEligible: hasFailed,
        failedCount: failedSubjects.length,
        subjects: processedSubjects,
        overallRank: "-", // Default placeholder structural boundaries
        instRank: "-"
      });
    });

    // --- TIED-RANK ENGINE PIPELINE ---
    // A. Generate Overall Rankings (across all active visible records loaded)
    const passedStudentsOverall = studentResults.filter(s => s.result === 'PASSED').sort((a, b) => b.total - a.total);
    passedStudentsOverall.forEach((s, index) => {
      const originalRef = studentResults.find(orig => orig.studentId === s.studentId);
      if (originalRef) originalRef.overallRank = index + 1;
    });

    // B. Generate Institution-Isolated Rankings (campus specific subset groupings)
    const campusGroups = {};
    studentResults.forEach(s => {
      if (!campusGroups[s.institutionId]) campusGroups[s.institutionId] = [];
      campusGroups[s.institutionId].push(s);
    });

    Object.keys(campusGroups).forEach(instKey => {
      const passedInCampus = campusGroups[instKey].filter(s => s.result === 'PASSED').sort((a, b) => b.total - a.total);
      passedInCampus.forEach((s, index) => {
        const originalRef = studentResults.find(orig => orig.studentId === s.studentId);
        if (originalRef) originalRef.instRank = index + 1;
      });
    });

    const passPercentage = studentResults.length ? ((totalPass / studentResults.length) * 100).toFixed(1) : 0;

    this.state.processedData = {
      totalProcessed: studentResults.length,
      totalPass,
      totalFail,
      passPercentage,
      subjectAnalytics,
      studentResults,
      topRankers: passedStudentsOverall.slice(0, 5) 
    };
  },

  calculateGrade(mark, maxMark) {
    if (mark === 'AB') return 'F';
    const percent = (mark / maxMark) * 100;
    if (percent >= 90) return 'A+';
    if (percent >= 80) return 'A';
    if (percent >= 70) return 'B+';
    if (percent >= 60) return 'B';
    if (percent >= 50) return 'C';
    return 'F';
  },

  // 3. Upgraded Future-Proof Result Publisher Engine (Saves Both Ranks Globally)
  async publishFinalResults() {
    if (!this.state.processedData || this.state.processedData.studentResults.length === 0) {
      return window.UI.showToast("No complete records available to publish.", "warning");
    }
    if (!confirm("WARNING: Publishing makes results visible across Student Dashboards with Campus and Overall Rankings. Proceed?")) return;
    
    const btn = document.getElementById('btn-publish');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> Synchronizing Ledger...`;
    
    const instId = window.AuthModule.institutionId; 
    const examId = this.state.selectedExam.id;
    const batchKey = this.state.selectedExam.batch; 

    try {
      const batch = writeBatch(db);

      this.state.processedData.studentResults.forEach(result => {
        const docRef = doc(db, 'processed_results', batchKey, 'records', `${examId}_${result.studentId}`);
        
        batch.set(docRef, {
          examId: examId,
          batch: batchKey,
          ...result, // Safely spreads overallRank and instRank properties alongside scores arrays
          publishedAt: serverTimestamp()
        });
      });
      
      await batch.commit();
      window.UI.showToast("Campus metrics ledger containing dual rankings published directly!", "success");
      this.renderDashboard();
      
    } catch (e) {
      console.error(e);
      window.UI.showToast("Failed compilation batch transaction execution routing.", "error");
    } finally {
      btn.innerHTML = oldHtml;
    }
  },

  // 4. Native Browser Spreadsheet Data Stream Downloader Mapping Both Ranks
  exportAnalysisCSV() {
    if (!this.state.processedData || this.state.processedData.studentResults.length === 0) {
      return window.UI.showToast("No structured records found to extract.", "warning");
    }

    try {
      let csvContent = "data:text/csv;charset=utf-8,";
      csvContent += "Overall Rank,Campus Rank,Institution ID,Register Number,Candidate Name,Total Marks,Overall Outcome,Failed Count\n";

      this.state.processedData.studentResults.forEach(r => {
        const row = [
          r.overallRank || "-",
          r.instRank || "-",
          `"${r.institutionId}"`, 
          `"${r.regNo}"`,
          `"${r.name}"`,
          r.total,
          r.result,
          r.failedCount
        ].join(",");
        csvContent += row + "\n";
      });

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `Mark_Analysis_${this.state.selectedExam.examName.replace(/\s+/g, '_')}.csv`);
      document.body.appendChild(link);
      
      link.click();
      document.body.removeChild(link);
      window.UI.showToast("CSV data sheet mapping dual-tiers exported successfully!", "success");
    } catch (err) {
      console.error(err);
      window.UI.showToast("Export process run crash.", "error");
    }
  },

  renderControls() {
    const container = document.getElementById('analysis-controls');
    if (!container) return;

    const examOptions = this.state.exams.map(e => 
      `<option value="${e.id}">${e.examName} (${e.batch})</option>`
    ).join('');

    container.innerHTML = `
      <div class="form-floating" style="max-width: 400px; margin-bottom: 20px;">
        <select id="analysis-exam-select" onchange="window.AnalysisApp.loadAnalysis()">
          <option value="">-- Select Centralized Exam --</option>
          ${examOptions}
        </select>
        <label>Select Examination</label>
      </div>
    `;
  },

  renderDashboard() {
    const container = document.getElementById('analysis-content');
    if (!this.state.processedData) return;

    const data = this.state.processedData;

    let html = `
      <div class="stat-grid" style="margin-bottom: 24px;">
        <div class="stat-card" style="border-left: 4px solid var(--accent-gold);">
          <div class="stat-info"><small>Overall Pass %</small><strong>${data.passPercentage}%</strong></div>
        </div>
        <div class="stat-card" style="border-left: 4px solid var(--success);">
          <div class="stat-info"><small>Passed</small><strong>${data.totalPass}</strong></div>
        </div>
        <div class="stat-card" style="border-left: 4px solid var(--danger);">
          <div class="stat-info"><small>Failed / Supply</small><strong>${data.totalFail}</strong></div>
        </div>
        <div class="stat-card">
          <div class="stat-info"><small>Total Processed</small><strong>${data.totalProcessed}</strong></div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 20px;">
        <div class="card-glass table-wrap">
          <h4 style="margin-bottom: 16px; color: var(--accent-gold);">Subject Component Performance</h4>
          <table>
            <thead><tr><th>Subject</th><th>Appeared</th><th>Pass %</th><th>Highest Composite</th></tr></thead>
            <tbody>
              ${Object.values(data.subjectAnalytics).filter(s => s.totalAppeared > 0).map(s => {
                const passPrc = ((s.passed / s.totalAppeared) * 100).toFixed(1);
                return `<tr>
                  <td><strong>${s.name}</strong></td>
                  <td>${s.totalAppeared}</td>
                  <td><span style="color: ${passPrc >= 50 ? 'var(--success)' : 'var(--danger)'}">${passPrc}%</span></td>
                  <td><strong>${s.highest}</strong></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div class="card-glass">
          <h4 style="margin-bottom: 16px; color: var(--accent-gold);">Top Rankers (Cross-Campus)</h4>
          ${data.topRankers.length === 0 ? '<p class="text-secondary" style="font-size:13px;">No qualifying rankers found.</p>' : ''}
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${data.topRankers.map(t => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
                <div>
                  <div style="font-size:14px; font-weight:600;">#${t.overallRank} ${t.name}</div>
                  <div style="font-size:11px; color:var(--text-secondary);">Reg No: ${t.regNo} | Campus Rank: #${t.instRank}</div>
                </div>
                <strong style="color: var(--success);">${t.total}</strong>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px;">
        <button class="btn btn-outline" onclick="window.AnalysisApp.exportAnalysisCSV()"><i class="fa fa-download"></i> Export Analysis CSV</button>
        <button id="btn-publish" class="btn btn-gold" onclick="window.AnalysisApp.publishFinalResults()">
          <i class="fa fa-bullhorn"></i> Publish Campus Results
        </button>
      </div>
    `;
    container.innerHTML = html;
  },

  renderSkeleton() {
    const container = document.getElementById('analysis-content');
    if (container) container.innerHTML = `<div class="skeleton-loader" style="height: 100px; width: 100%; margin-bottom:20px;"></div><div class="skeleton-loader" style="height: 300px; width: 100%;"></div>`;
  }
};