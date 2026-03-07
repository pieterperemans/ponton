'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Housing', 'Food & Groceries', 'Transportation', 'Utilities',
  'Healthcare', 'Entertainment', 'Clothing', 'Education',
  'Savings', 'Travel', 'Subscriptions', 'Personal Care', 'Other'
];

const STORAGE_KEYS = { transactions: 'bt_transactions', budgets: 'bt_budgets' };

// ─── State ────────────────────────────────────────────────────────────────────

let transactions = load(STORAGE_KEYS.transactions) ?? [];
let budgets      = load(STORAGE_KEYS.budgets) ?? [];
let dashPieChart = null;
let reportBarChart = null;
let reportPieChart = null;

// ─── Storage helpers ──────────────────────────────────────────────────────────

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function save() {
  localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  localStorage.setItem(STORAGE_KEYS.budgets, JSON.stringify(budgets));
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function txMonth(tx) { return tx.date.substring(0, 7); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

// Summarise spending per category for a set of transactions
function categorySpend(txList) {
  const map = {};
  for (const tx of txList) {
    if (tx.type === 'expense') {
      map[tx.category] = (map[tx.category] ?? 0) + tx.amount;
    }
  }
  return map;
}

// ─── Category <select> population ─────────────────────────────────────────────

function populateCategorySelects() {
  const selects = ['tx-category', 'budget-category'];
  for (const id of selects) {
    const el = document.getElementById(id);
    el.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
  }
}

// ─── Tab navigation ───────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'dashboard') renderDashboard();
      if (btn.dataset.tab === 'transactions') renderTransactions();
      if (btn.dataset.tab === 'budgets') renderBudgets();
      if (btn.dataset.tab === 'reports') renderReports();
    });
  });
}

// ─── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function renderDashboard() {
  const month = currentMonth();
  const monthTx = transactions.filter(tx => txMonth(tx) === month);

  const income   = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance  = income - expenses;

  document.getElementById('dash-income').textContent   = fmt(income);
  document.getElementById('dash-expenses').textContent = fmt(expenses);
  document.getElementById('dash-balance').textContent  = fmt(balance);

  renderBudgetProgress(month, monthTx);
  renderDashPie(monthTx);
  renderRecentTransactions(monthTx);
}

function renderBudgetProgress(month, monthTx) {
  const list = document.getElementById('budget-progress-list');
  const monthBudgets = budgets.filter(b => b.month === month);
  const spend = categorySpend(monthTx);

  if (monthBudgets.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:.875rem;">No budgets set for this month. Add them in the Budgets tab.</p>';
    return;
  }

  list.innerHTML = monthBudgets.map(b => {
    const spent = spend[b.category] ?? 0;
    const pct   = Math.min((spent / b.limit) * 100, 100);
    const cls   = pct >= 100 ? 'over' : pct >= 80 ? 'warning' : '';
    return `
      <div class="budget-item">
        <div class="budget-item-header">
          <span class="cat">${b.category}</span>
          <span class="amounts">${fmt(spent)} / ${fmt(b.limit)}</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${cls}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
}

function renderDashPie(monthTx) {
  const spend = categorySpend(monthTx);
  const labels = Object.keys(spend);
  const data   = Object.values(spend);

  if (dashPieChart) dashPieChart.destroy();
  const ctx = document.getElementById('dash-pie-chart').getContext('2d');

  if (labels.length === 0) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    return;
  }

  dashPieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: generateColors(labels.length), borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      cutout: '55%'
    }
  });
}

function renderRecentTransactions(monthTx) {
  const tbody = document.querySelector('#recent-tx-table tbody');
  const recent = [...monthTx].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No transactions this month.</td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(tx => `
    <tr>
      <td>${tx.date}</td>
      <td>${escHtml(tx.description)}</td>
      <td>${tx.category}</td>
      <td class="amount-${tx.type}">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}</td>
    </tr>`).join('');
}

// ─── Transactions ─────────────────────────────────────────────────────────────

function renderTransactions() {
  const filter = document.getElementById('tx-month-filter').value || currentMonth();
  const filtered = transactions
    .filter(tx => txMonth(tx) === filter)
    .sort((a, b) => b.date.localeCompare(a.date));

  const tbody = document.querySelector('#tx-table tbody');

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No transactions for ${monthLabel(filter)}.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(tx => `
    <tr>
      <td>${tx.date}</td>
      <td>${escHtml(tx.description)}</td>
      <td>${tx.category}</td>
      <td><span class="badge ${tx.type}">${tx.type}</span></td>
      <td class="amount-${tx.type}">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}</td>
      <td>
        <button class="btn small secondary" onclick="editTransaction('${tx.id}')">Edit</button>
        <button class="btn small danger" onclick="deleteTransaction('${tx.id}')">Delete</button>
      </td>
    </tr>`).join('');
}

function openAddTransaction() {
  document.getElementById('tx-modal-title').textContent = 'Add Transaction';
  document.getElementById('tx-form').reset();
  document.getElementById('tx-id').value = '';
  document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
  openModal('tx-modal');
}

function editTransaction(id) {
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;
  document.getElementById('tx-modal-title').textContent = 'Edit Transaction';
  document.getElementById('tx-id').value       = tx.id;
  document.getElementById('tx-date').value     = tx.date;
  document.getElementById('tx-desc').value     = tx.description;
  document.getElementById('tx-category').value = tx.category;
  document.getElementById('tx-type').value     = tx.type;
  document.getElementById('tx-amount').value   = tx.amount;
  openModal('tx-modal');
}

function deleteTransaction(id) {
  if (!confirm('Delete this transaction?')) return;
  transactions = transactions.filter(t => t.id !== id);
  save();
  renderTransactions();
  renderDashboard();
}

function saveTransaction(e) {
  e.preventDefault();
  const id   = document.getElementById('tx-id').value;
  const data = {
    id:          id || uid(),
    date:        document.getElementById('tx-date').value,
    description: document.getElementById('tx-desc').value.trim(),
    category:    document.getElementById('tx-category').value,
    type:        document.getElementById('tx-type').value,
    amount:      parseFloat(document.getElementById('tx-amount').value)
  };
  if (id) {
    transactions = transactions.map(t => t.id === id ? data : t);
  } else {
    transactions.push(data);
  }
  save();
  closeModal('tx-modal');
  renderTransactions();
  renderDashboard();
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

function renderBudgets() {
  const filter = document.getElementById('budget-month-filter').value || currentMonth();
  const monthBudgets = budgets.filter(b => b.month === filter);
  const monthTx = transactions.filter(tx => txMonth(tx) === filter);
  const spend = categorySpend(monthTx);
  const container = document.getElementById('budget-list');

  if (monthBudgets.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No budgets for ${monthLabel(filter)}.</p><button class="btn primary" onclick="openAddBudget()">+ Add Budget</button></div>`;
    return;
  }

  container.innerHTML = `<div class="budget-grid">${monthBudgets.map(b => {
    const spent = spend[b.category] ?? 0;
    const pct   = Math.min((spent / b.limit) * 100, 100);
    const cls   = pct >= 100 ? 'over' : pct >= 80 ? 'warning' : '';
    const remaining = b.limit - spent;
    return `
      <div class="budget-card">
        <div class="budget-card-header">
          <div>
            <div class="cat">${b.category}</div>
            <div class="budget-card-month">${monthLabel(b.month)}</div>
          </div>
          <div class="actions">
            <button class="btn small secondary" onclick="editBudget('${b.id}')">Edit</button>
            <button class="btn small danger" onclick="deleteBudget('${b.id}')">×</button>
          </div>
        </div>
        <div class="budget-item-header">
          <span>${fmt(spent)} spent</span>
          <span style="color:var(--text-muted)">of ${fmt(b.limit)}</span>
        </div>
        <div class="progress-bar-bg" style="margin:8px 0">
          <div class="progress-bar-fill ${cls}" style="width:${pct}%"></div>
        </div>
        <div style="font-size:.8rem;color:${remaining < 0 ? 'var(--expense-color)' : 'var(--income-color)'}">
          ${remaining < 0 ? `${fmt(Math.abs(remaining))} over budget` : `${fmt(remaining)} remaining`}
        </div>
      </div>`;
  }).join('')}</div>`;
}

function openAddBudget() {
  document.getElementById('budget-modal-title').textContent = 'Add Budget';
  document.getElementById('budget-form').reset();
  document.getElementById('budget-id').value = '';
  document.getElementById('budget-month').value = document.getElementById('budget-month-filter').value || currentMonth();
  openModal('budget-modal');
}

function editBudget(id) {
  const b = budgets.find(x => x.id === id);
  if (!b) return;
  document.getElementById('budget-modal-title').textContent = 'Edit Budget';
  document.getElementById('budget-id').value       = b.id;
  document.getElementById('budget-month').value    = b.month;
  document.getElementById('budget-category').value = b.category;
  document.getElementById('budget-limit').value    = b.limit;
  openModal('budget-modal');
}

function deleteBudget(id) {
  if (!confirm('Delete this budget?')) return;
  budgets = budgets.filter(b => b.id !== id);
  save();
  renderBudgets();
}

function saveBudget(e) {
  e.preventDefault();
  const id       = document.getElementById('budget-id').value;
  const month    = document.getElementById('budget-month').value;
  const category = document.getElementById('budget-category').value;

  // Prevent duplicate budget for same month+category (when adding)
  if (!id && budgets.some(b => b.month === month && b.category === category)) {
    alert(`A budget for ${category} in ${monthLabel(month)} already exists.`);
    return;
  }

  const data = { id: id || uid(), month, category, limit: parseFloat(document.getElementById('budget-limit').value) };

  if (id) {
    budgets = budgets.map(b => b.id === id ? data : b);
  } else {
    budgets.push(data);
  }
  save();
  closeModal('budget-modal');
  renderBudgets();
  renderDashboard();
}

// ─── Reports ──────────────────────────────────────────────────────────────────

function renderReports() {
  const from = document.getElementById('report-from').value;
  const to   = document.getElementById('report-to').value;

  if (!from || !to || from > to) return;

  // Collect all months in range
  const months = [];
  let cur = from;
  while (cur <= to) {
    months.push(cur);
    const [y, m] = cur.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    cur = next;
  }

  const incomeData   = months.map(mo => transactions.filter(t => txMonth(t) === mo && t.type === 'income').reduce((s, t) => s + t.amount, 0));
  const expenseData  = months.map(mo => transactions.filter(t => txMonth(t) === mo && t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const labels       = months.map(monthLabel);

  // Bar chart
  if (reportBarChart) reportBarChart.destroy();
  reportBarChart = new Chart(document.getElementById('report-bar-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income',   data: incomeData,  backgroundColor: '#86efac', borderColor: '#16a34a', borderWidth: 1 },
        { label: 'Expenses', data: expenseData, backgroundColor: '#fca5a5', borderColor: '#dc2626', borderWidth: 1 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } }
    }
  });

  // Pie chart — spending by category over range
  const rangeTx = transactions.filter(t => txMonth(t) >= from && txMonth(t) <= to);
  const spend   = categorySpend(rangeTx);
  const catLabels = Object.keys(spend);
  const catData   = Object.values(spend);

  if (reportPieChart) reportPieChart.destroy();
  if (catLabels.length > 0) {
    reportPieChart = new Chart(document.getElementById('report-pie-chart').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{ data: catData, backgroundColor: generateColors(catLabels.length), borderWidth: 2, borderColor: '#fff' }]
      },
      options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }, cutout: '55%' }
    });
  }

  // Category breakdown table
  const tbody = document.querySelector('#report-category-table tbody');
  if (catLabels.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">No expense data in range.</td></tr>';
    return;
  }

  tbody.innerHTML = catLabels.sort().map(cat => {
    const spent = spend[cat] ?? 0;
    const budget = budgets.filter(b => b.category === cat && b.month >= from && b.month <= to).reduce((s, b) => s + b.limit, 0);
    const diff = budget - spent;
    return `
      <tr>
        <td>${cat}</td>
        <td class="amount-expense">${fmt(spent)}</td>
        <td>${budget > 0 ? fmt(budget) : '—'}</td>
        <td style="color:${diff < 0 ? 'var(--expense-color)' : 'var(--income-color)'}">
          ${budget > 0 ? (diff < 0 ? `-${fmt(Math.abs(diff))}` : `+${fmt(diff)}`) : '—'}
        </td>
      </tr>`;
  }).join('');
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportCSV() {
  const filter = document.getElementById('tx-month-filter').value || currentMonth();
  const filtered = transactions.filter(tx => txMonth(tx) === filter);
  const header = ['Date', 'Description', 'Category', 'Type', 'Amount'];
  const rows = filtered
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(t => [t.date, `"${t.description.replace(/"/g, '""')}"`, t.category, t.type, t.amount.toFixed(2)]);

  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `budget-${filter}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

function importCSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.trim().split('\n');
    // Skip header row
    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVRow(lines[i]);
      if (cols.length < 5) continue;
      const [date, description, category, type, amount] = cols;
      if (!date || !description || !amount) continue;
      const normalType = (type.trim().toLowerCase() === 'income') ? 'income' : 'expense';
      const cat = CATEGORIES.includes(category.trim()) ? category.trim() : 'Other';
      transactions.push({
        id: uid(), date: date.trim(), description: description.trim(),
        category: cat, type: normalType, amount: Math.abs(parseFloat(amount))
      });
      imported++;
    }
    save();
    alert(`Imported ${imported} transaction(s).`);
    renderTransactions();
    renderDashboard();
  };
  reader.readAsText(file);
}

function parseCSVRow(row) {
  const result = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

// ─── Color palette ────────────────────────────────────────────────────────────

function generateColors(n) {
  const palette = [
    '#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6',
    '#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16',
    '#06b6d4','#a855f7','#e11d48'
  ];
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
}

// ─── Security helper ──────────────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  populateCategorySelects();
  initTabs();

  // Set default month filters to current month
  const month = currentMonth();
  document.getElementById('tx-month-filter').value     = month;
  document.getElementById('budget-month-filter').value = month;

  // Set report defaults to last 3 months
  const [y, m] = month.split('-').map(Number);
  const fromM   = m <= 3 ? `${y - 1}-${String(12 + m - 3).padStart(2, '0')}` : `${y}-${String(m - 3).padStart(2, '0')}`;
  document.getElementById('report-from').value = fromM;
  document.getElementById('report-to').value   = month;

  // Transaction modal
  document.getElementById('open-add-tx').addEventListener('click', openAddTransaction);
  document.getElementById('cancel-tx').addEventListener('click', () => closeModal('tx-modal'));
  document.getElementById('tx-form').addEventListener('submit', saveTransaction);

  // Budget modal
  document.getElementById('open-add-budget').addEventListener('click', openAddBudget);
  document.getElementById('cancel-budget').addEventListener('click', () => closeModal('budget-modal'));
  document.getElementById('budget-form').addEventListener('submit', saveBudget);

  // Month filters
  document.getElementById('tx-month-filter').addEventListener('change', renderTransactions);
  document.getElementById('budget-month-filter').addEventListener('change', renderBudgets);

  // Reports
  document.getElementById('generate-report').addEventListener('click', renderReports);

  // CSV
  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('import-csv').addEventListener('change', e => {
    if (e.target.files[0]) { importCSV(e.target.files[0]); e.target.value = ''; }
  });

  // Overlay click closes modals
  document.getElementById('modal-overlay').addEventListener('click', () => {
    closeModal('tx-modal');
    closeModal('budget-modal');
  });

  // Initial render
  renderDashboard();
}

document.addEventListener('DOMContentLoaded', init);
