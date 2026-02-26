/* ═══════════════════════════════════════════════════════════
   🌱 성장곡선 — 쌍둥이 성장 백분위 차트
   ═══════════════════════════════════════════════════════════ */

const socket = io();
let WHO = null;      // WHO 성장 기준표 데이터
let appData = null;  // { babies, records }
let chart = null;    // Chart.js 인스턴스

let currentTab = 'a';     // 'a' | 'b' | 'compare'
let currentMetric = 'weight'; // 'weight' | 'length' | 'headCirc'
let useCorrected = false;

// ── 초기화 ──────────────────────────────────────────────
async function init() {
  const [whoResp, dataResp] = await Promise.all([
    fetch('/data/who-standards.json'),
    fetch('/api/data')
  ]);
  WHO = await whoResp.json();
  appData = await dataResp.json();

  setupTabs();
  setupForm();
  setupOptions();
  setupSettings();
  renderAll();

  // Socket.io 실시간 업데이트
  socket.on('record:new', (rec) => { appData.records.push(rec); renderAll(); });
  socket.on('record:update', (rec) => {
    const idx = appData.records.findIndex(r => r.id === rec.id);
    if (idx >= 0) appData.records[idx] = rec;
    renderAll();
  });
  socket.on('record:delete', (id) => {
    appData.records = appData.records.filter(r => r.id !== id);
    renderAll();
  });
  socket.on('babies:update', (babies) => { appData.babies = babies; renderAll(); });
  socket.on('data:refresh', async () => {
    const resp = await fetch('/api/data');
    appData = await resp.json();
    renderAll();
  });
}

// ── 탭 ──────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAll();
    });
  });

  document.querySelectorAll('.subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMetric = btn.dataset.metric;
      document.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAll();
    });
  });
}

// ── 옵션 ──────────────────────────────────────────────
function setupOptions() {
  document.getElementById('correctedAge').addEventListener('change', (e) => {
    useCorrected = e.target.checked;
    renderAll();
  });

  document.getElementById('btnPrint').addEventListener('click', () => window.print());

  document.getElementById('btnImport').addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/import-twin-log', { method: 'POST' });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      showToast(`📥 ${data.imported}건 가져옴`);
      const refreshResp = await fetch('/api/data');
      appData = await refreshResp.json();
      renderAll();
    } catch (err) {
      showToast(`❌ ${err.message}`);
    }
  });
}

// ── 폼 ──────────────────────────────────────────────
function setupForm() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('inputDate').value = today;

  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      baby: document.getElementById('inputBaby').value,
      date: document.getElementById('inputDate').value,
      weight: document.getElementById('inputWeight').value || null,
      height: document.getElementById('inputHeight').value || null,
      headCirc: document.getElementById('inputHeadCirc').value || null,
      note: document.getElementById('inputNote').value
    };

    if (!body.weight && !body.height && !body.headCirc) {
      showToast('⚠️ 하나 이상 입력해 주세요');
      return;
    }

    await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    document.getElementById('inputWeight').value = '';
    document.getElementById('inputHeight').value = '';
    document.getElementById('inputHeadCirc').value = '';
    document.getElementById('inputNote').value = '';
    showToast('✅ 기록 추가');
  });
}

// ── 설정 ──────────────────────────────────────────────
function setupSettings() {
  const grid = document.getElementById('settingsGrid');
  const babies = appData.babies;

  grid.innerHTML = ['a', 'b'].map(id => {
    const b = babies[id];
    return `
      <div class="setting-card">
        <h3>${id === 'a' ? '👶 아둥이' : '👶 바둥이'}</h3>
        <div class="form-group">
          <label>이름</label>
          <input type="text" data-baby="${id}" data-field="name" value="${b.name}">
        </div>
        <div class="form-group">
          <label>성별</label>
          <select data-baby="${id}" data-field="sex">
            <option value="boy" ${b.sex === 'boy' ? 'selected' : ''}>남아</option>
            <option value="girl" ${b.sex === 'girl' ? 'selected' : ''}>여아</option>
          </select>
        </div>
        <div class="form-group">
          <label>생년월일</label>
          <input type="date" data-baby="${id}" data-field="birthDate" value="${b.birthDate || ''}">
        </div>
        <div class="form-group">
          <label>예정일</label>
          <input type="date" data-baby="${id}" data-field="dueDate" value="${b.dueDate || ''}">
        </div>
      </div>`;
  }).join('');

  grid.addEventListener('change', async (e) => {
    const el = e.target;
    if (!el.dataset.baby) return;
    const body = { [el.dataset.field]: el.value || null };
    await fetch(`/api/babies/${el.dataset.baby}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    showToast('💾 설정 저장');
  });
}

// ── 월령 계산 ──────────────────────────────────────────
function calcMonths(birthDate, measureDate, dueDate, corrected) {
  const birth = new Date(birthDate);
  const measure = new Date(measureDate);
  let months = (measure.getFullYear() - birth.getFullYear()) * 12 + (measure.getMonth() - birth.getMonth());
  const dayDiff = measure.getDate() - birth.getDate();
  months += dayDiff / 30.44; // fractional months

  if (corrected && dueDate) {
    // 40주 (280일) 기준 보정
    const due = new Date(dueDate);
    const prematureDays = (due - birth) / (1000 * 60 * 60 * 24);
    if (prematureDays > 0) {
      months -= prematureDays / 30.44;
    }
  }

  return Math.max(0, months);
}

// ── 백분위 계산 (LMS 방법) ──────────────────────────────
function calcPercentile(value, L, M, S) {
  if (!value || !M || !S) return null;
  let z;
  if (L === 0) {
    z = Math.log(value / M) / S;
  } else {
    z = (Math.pow(value / M, L) - 1) / (L * S);
  }
  // z-score → percentile (normal CDF approximation)
  return normalCDF(z) * 100;
}

function normalCDF(z) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1.0 + sign * y);
}

function getWHORow(sex, metric, month) {
  const data = WHO[sex === 'boy' ? 'boys' : 'girls'][metric];
  // 정수 월령 매칭 (가장 가까운 월)
  const rounded = Math.round(month);
  return data.find(r => r.month === rounded) || null;
}

// ── 렌더링 ──────────────────────────────────────────────
function renderAll() {
  renderChart();
  renderAlerts();
  renderStatusCards();
  renderRecords();
}

// ── 차트 렌더링 ──────────────────────────────────────────
function renderChart() {
  const canvas = document.getElementById('growthChart');
  if (chart) chart.destroy();

  const metricLabels = { weight: '체중 (kg)', length: '신장 (cm)', headCirc: '두위 (cm)' };
  const metricUnit = { weight: 'kg', length: 'cm', headCirc: 'cm' };

  const datasets = [];

  if (currentTab === 'compare') {
    addPercentileBands(datasets, 'boy', 0.08);
    addBabyDataset(datasets, 'a');
    addBabyDataset(datasets, 'b');
  } else {
    const baby = appData.babies[currentTab];
    const sex = baby.sex || 'boy';
    addPercentileBands(datasets, sex, 0.12);
    addBabyDataset(datasets, currentTab);
  }

  chart = new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        intersect: false,
        axis: 'x'
      },
      plugins: {
        legend: {
          display: currentTab === 'compare',
          labels: {
            filter: (item) => !item.text.startsWith('P'),
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 12,
          }
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = items[0]?.parsed?.x;
              return x != null ? `${x.toFixed(1)}개월` : '';
            },
            label: (item) => {
              const lbl = item.dataset.label;
              if (lbl && !lbl.startsWith('P')) {
                return `${lbl}: ${item.parsed.y} ${metricUnit[currentMetric]}`;
              }
              return null;
            }
          },
          filter: (item) => item.dataset.label && !item.dataset.label.startsWith('P')
        },
        annotation: { annotations: getPercentileAnnotations() },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 24,
          title: { display: true, text: useCorrected ? '교정 월령' : '월령', font: { size: 11 } },
          ticks: { stepSize: 2, callback: (v) => `${v}` },
          grid: { color: 'rgba(0,0,0,0.04)' }
        },
        y: {
          title: { display: true, text: metricLabels[currentMetric], font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.06)' },
          beginAtZero: currentMetric === 'weight'
        }
      },
      elements: {
        point: { radius: 0 },
        line: { tension: 0.3 }
      }
    }
  });
}

function getPercentileAnnotations() {
  const sex = currentTab === 'compare' ? 'boy' : (appData.babies[currentTab]?.sex || 'boy');
  const data = WHO[sex === 'boy' ? 'boys' : 'girls'][currentMetric];
  const last = data.find(d => d.month === 24);
  if (!last) return {};

  const pcts = [
    { key: 'P3', label: '3rd', color: 'rgba(255,152,0,0.6)' },
    { key: 'P50', label: '50th', color: 'rgba(33,150,243,0.7)' },
    { key: 'P97', label: '97th', color: 'rgba(255,152,0,0.6)' },
  ];

  const annotations = {};
  pcts.forEach(p => {
    annotations[p.key] = {
      type: 'label',
      xValue: 24.3,
      yValue: last[p.key],
      content: p.label,
      color: p.color,
      font: { size: 9, weight: 'bold' },
      position: { x: 'start', y: 'center' },
    };
  });
  return annotations;
}

function addPercentileBands(datasets, sex, opacity) {
  const data = WHO[sex === 'boy' ? 'boys' : 'girls'][currentMetric];
  const pNames = ['P3', 'P15', 'P50', 'P85', 'P97'];
  const pColors = [
    `rgba(255,152,0,${opacity})`,
    `rgba(76,175,80,${opacity})`,
    `rgba(33,150,243,${opacity * 1.5})`,
    `rgba(76,175,80,${opacity})`,
    `rgba(255,152,0,${opacity})`
  ];
  const pDash = [[5, 5], [3, 3], [], [3, 3], [5, 5]];
  const pWidth = [1, 1, 2, 1, 1];

  const toXY = (field) => data
    .filter(d => d.month <= 24)
    .map(d => ({ x: d.month, y: d[field] }));

  datasets.push({
    label: 'P3',
    data: toXY('P3'),
    borderColor: pColors[0], borderWidth: pWidth[0], borderDash: pDash[0],
    fill: false, pointRadius: 0, showLine: true,
  });

  datasets.push({
    label: 'P15',
    data: toXY('P15'),
    borderColor: pColors[1], borderWidth: pWidth[1], borderDash: pDash[1],
    backgroundColor: `rgba(255,183,77,${opacity * 0.5})`,
    fill: '-1', pointRadius: 0, showLine: true,
  });

  datasets.push({
    label: 'P50',
    data: toXY('P50'),
    borderColor: pColors[2], borderWidth: pWidth[2], borderDash: pDash[2],
    backgroundColor: `rgba(129,199,132,${opacity * 0.5})`,
    fill: '-1', pointRadius: 0, showLine: true,
  });

  datasets.push({
    label: 'P85',
    data: toXY('P85'),
    borderColor: pColors[3], borderWidth: pWidth[3], borderDash: pDash[3],
    backgroundColor: `rgba(129,199,132,${opacity * 0.5})`,
    fill: '-1', pointRadius: 0, showLine: true,
  });

  datasets.push({
    label: 'P97',
    data: toXY('P97'),
    borderColor: pColors[4], borderWidth: pWidth[4], borderDash: pDash[4],
    backgroundColor: `rgba(255,183,77,${opacity * 0.5})`,
    fill: '-1', pointRadius: 0, showLine: true,
  });
}

function addBabyDataset(datasets, babyId) {
  const baby = appData.babies[babyId];
  if (!baby.birthDate) return;

  const records = appData.records
    .filter(r => r.baby === babyId)
    .sort((a, b) => a.date.localeCompare(b.date));

  const fieldMap = { weight: 'weight', length: 'height', headCirc: 'headCirc' };
  const field = fieldMap[currentMetric];

  const color = baby.sex === 'girl' ? '#e76f88' : '#4895ef';

  const points = records
    .filter(r => r[field] != null)
    .map(r => ({
      x: Math.round(calcMonths(baby.birthDate, r.date, baby.dueDate, useCorrected) * 10) / 10,
      y: r[field]
    }));

  datasets.push({
    label: baby.name,
    data: points,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2.5,
    pointRadius: 5,
    pointHoverRadius: 7,
    pointStyle: 'circle',
    fill: false,
    showLine: true,
    tension: 0.2,
  });
}

// ── 알림 ──────────────────────────────────────────────
function renderAlerts() {
  const container = document.getElementById('alerts');
  const alerts = [];

  const babies = currentTab === 'compare' ? ['a', 'b'] : [currentTab];

  for (const babyId of babies) {
    const baby = appData.babies[babyId];
    if (!baby.birthDate) {
      alerts.push({ type: 'info', text: `${baby.name}: 생년월일을 설정해 주세요` });
      continue;
    }

    const latest = getLatestRecord(babyId);
    if (!latest) continue;

    const monthAge = calcMonths(baby.birthDate, latest.date, baby.dueDate, useCorrected);
    const sex = baby.sex || 'boy';

    // 각 메트릭 체크
    const checks = [
      { field: 'weight', metric: 'weight', label: '체중', unit: 'kg' },
      { field: 'height', metric: 'length', label: '신장', unit: 'cm' },
      { field: 'headCirc', metric: 'headCirc', label: '두위', unit: 'cm' },
    ];

    for (const check of checks) {
      if (!latest[check.field]) continue;
      const row = getWHORow(sex, check.metric, monthAge);
      if (!row) continue;
      const pct = calcPercentile(latest[check.field], row.L, row.M, row.S);
      if (pct !== null) {
        if (pct < 3) {
          alerts.push({ type: 'danger', text: `⚠️ ${baby.name} ${check.label} ${latest[check.field]}${check.unit} — 3백분위 미만 (${pct.toFixed(1)}%)` });
        } else if (pct > 97) {
          alerts.push({ type: 'warning', text: `⚠️ ${baby.name} ${check.label} ${latest[check.field]}${check.unit} — 97백분위 초과 (${pct.toFixed(1)}%)` });
        }
      }
    }
  }

  // 쌍둥이 체중 차이 체크
  if (currentTab === 'compare' || true) {
    const latA = getLatestRecord('a');
    const latB = getLatestRecord('b');
    if (latA?.weight && latB?.weight) {
      const bigger = Math.max(latA.weight, latB.weight);
      const smaller = Math.min(latA.weight, latB.weight);
      const gap = ((bigger - smaller) / bigger) * 100;
      if (gap >= 20) {
        alerts.push({ type: 'danger', text: `🔴 쌍둥이 체중 차이 ${gap.toFixed(0)}% — 즉시 확인 필요` });
      } else if (gap >= 10) {
        alerts.push({ type: 'warning', text: `🟡 쌍둥이 체중 차이 ${gap.toFixed(0)}% — 주의` });
      }
    }
  }

  container.innerHTML = alerts.map(a => `
    <div class="alert alert-${a.type}">${a.text}</div>
  `).join('');
}

// ── 상태 카드 ──────────────────────────────────────────
function renderStatusCards() {
  const container = document.getElementById('statusCards');
  if (currentTab === 'compare') {
    container.innerHTML = '';
    renderTwinGap();
    return;
  }

  const baby = appData.babies[currentTab];
  if (!baby.birthDate) {
    container.innerHTML = '';
    return;
  }

  const latest = getLatestRecord(currentTab);
  if (!latest) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-light);font-size:0.85rem;">기록이 없습니다</p>';
    return;
  }

  const monthAge = calcMonths(baby.birthDate, latest.date, baby.dueDate, useCorrected);
  const sex = baby.sex || 'boy';
  const cards = [];

  const metrics = [
    { field: 'weight', metric: 'weight', label: '체중', unit: 'kg' },
    { field: 'height', metric: 'length', label: '신장', unit: 'cm' },
    { field: 'headCirc', metric: 'headCirc', label: '두위', unit: 'cm' },
  ];

  for (const m of metrics) {
    const val = latest[m.field];
    if (!val) {
      cards.push(`<div class="status-card"><div class="label">${m.label}</div><div class="value">—</div></div>`);
      continue;
    }
    const row = getWHORow(sex, m.metric, monthAge);
    let pctStr = '';
    let pctClass = 'normal';
    if (row) {
      const pct = calcPercentile(val, row.L, row.M, row.S);
      if (pct !== null) {
        if (pct < 3) pctClass = 'low';
        else if (pct > 97) pctClass = 'high';
        pctStr = `<div class="percentile ${pctClass}">${pct.toFixed(1)} 백분위</div>`;
      }
    }
    cards.push(`
      <div class="status-card">
        <div class="label">${m.label}</div>
        <div class="value">${val} ${m.unit}</div>
        ${pctStr}
      </div>
    `);
  }

  container.innerHTML = cards.join('');
  removeTwinGap();
}

function renderTwinGap() {
  let el = document.getElementById('twinGap');
  if (!el) {
    el = document.createElement('div');
    el.id = 'twinGap';
    document.getElementById('statusCards').after(el);
  }

  const latA = getLatestRecord('a');
  const latB = getLatestRecord('b');

  if (!latA?.weight || !latB?.weight) {
    el.innerHTML = '';
    return;
  }

  const bigger = Math.max(latA.weight, latB.weight);
  const smaller = Math.min(latA.weight, latB.weight);
  const gap = ((bigger - smaller) / bigger) * 100;
  const concern = gap >= 10;

  el.innerHTML = `
    <div class="twin-gap ${concern ? 'concern' : ''}">
      <div class="gap-label">쌍둥이 체중 차이</div>
      <div class="gap-value">${gap.toFixed(1)}%</div>
      <div class="gap-label">${appData.babies.a.name} ${latA.weight}kg / ${appData.babies.b.name} ${latB.weight}kg</div>
      ${concern ? '<div style="margin-top:4px;font-size:0.75rem;color:var(--warning)">⚠️ 10% 이상 차이 — 소아과 상담 권장</div>' : ''}
    </div>
  `;
}

function removeTwinGap() {
  const el = document.getElementById('twinGap');
  if (el) el.innerHTML = '';
}

// ── 기록 목록 ──────────────────────────────────────────
function renderRecords() {
  const container = document.getElementById('recordsList');
  const babyFilter = currentTab === 'compare' ? null : currentTab;

  let records = appData.records
    .filter(r => !babyFilter || r.baby === babyFilter)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (records.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-light);font-size:0.85rem;padding:12px;">기록이 없습니다</p>';
    return;
  }

  container.innerHTML = records.map(r => {
    const baby = appData.babies[r.baby];
    const babyClass = baby.sex === 'girl' ? 'girl' : 'boy';
    const vals = [];
    if (r.weight) vals.push(`${r.weight}kg`);
    if (r.height) vals.push(`${r.height}cm`);
    if (r.headCirc) vals.push(`두위 ${r.headCirc}cm`);

    return `
      <div class="record-item">
        <div class="record-baby ${babyClass}">${r.baby === 'a' ? '아' : '바'}</div>
        <div class="record-info">
          <div class="record-date">${formatDate(r.date)}</div>
          <div class="record-values">${vals.join(' · ')}</div>
          ${r.note ? `<div class="record-note">${r.note}</div>` : ''}
        </div>
        <button class="record-delete" onclick="deleteRecord('${r.id}')" title="삭제">🗑️</button>
      </div>
    `;
  }).join('');
}

async function deleteRecord(id) {
  if (!confirm('이 기록을 삭제할까요?')) return;
  await fetch(`/api/records/${id}`, { method: 'DELETE' });
}

// ── 유틸 ──────────────────────────────────────────────
function getLatestRecord(babyId) {
  return appData.records
    .filter(r => r.baby === babyId)
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ── 시작 ──────────────────────────────────────────────
init();
