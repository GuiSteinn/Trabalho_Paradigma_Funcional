// --- Configuração de planos (valores mensais) ---
const PLANS = Object.freeze({
  basic: 10.0,
  standard: 20.0,
  premium: 30.0
});

const parseDate = (iso) => new Date(iso + 'T00:00:00'); // pure helper

const daysInMonth = (year, monthIndex) => {
  return new Date(year, monthIndex + 1, 0).getDate();
};

// retorna overlap em dias (inteiro) entre [aStart,aEnd] e [bStart,bEnd]
const overlapDays = (aStart, aEnd, bStart, bEnd) => {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((end - start) / msPerDay) + 1);
};

// Recebe um evento e retorna {valid: boolean, errors: []}
const validateEvent = (event) => {
  const errors = [];
  if (!event || typeof event !== 'object') errors.push('Evento inválido');
  if (!event.userId) errors.push('Falta userId');
  if (!['subscribe', 'change', 'cancel'].includes(event.type)) errors.push('Tipo inválido');
  if (event.type !== 'cancel' && !event.plan) errors.push('Falta plano');
  if (!event.date) errors.push('Falta data');
  const d = new Date(event.date + 'T00:00:00');
  if (Number.isNaN(d.getTime())) errors.push('Data inválida');
  if (event.promoDiscountPct != null && (typeof event.promoDiscountPct !== 'number' || event.promoDiscountPct < 0 || event.promoDiscountPct > 100)) errors.push('promoDiscountPct inválido');
  if (event.penaltyPct != null && (typeof event.penaltyPct !== 'number' || event.penaltyPct < 0 || event.penaltyPct > 100)) errors.push('penaltyPct inválido');
  return { valid: errors.length === 0, errors };
};

// --- Função para transformar lista de eventos em timeline por usuário ---
const buildTimelines = (events) => {
  const byUser = events
    .slice() // copy
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .reduce((acc, ev) => {
      const user = ev.userId;
      const list = acc[user] ? acc[user].slice() : [];
      if (ev.type === 'subscribe') {
        list.push({ plan: ev.plan, start: parseDate(ev.date), end: null, promoDiscountPct: ev.promoDiscountPct || 0 });
      } else if (ev.type === 'change') {
        // fechar o último segmento e abrir novo
        if (list.length > 0) {
          const last = Object.assign({}, list[list.length - 1]);
          last.end = new Date(parseDate(ev.date).getTime() - 24*60*60*1000); 
          list[list.length - 1] = last;
        }
        list.push({ plan: ev.plan, start: parseDate(ev.date), end: null, promoDiscountPct: ev.promoDiscountPct || 0 });
      } else if (ev.type === 'cancel') {
        // fechar last segment on cancel date
        if (list.length > 0) {
          const last = Object.assign({}, list[list.length - 1]);
          last.end = parseDate(ev.date);
          last.penaltyPct = ev.penaltyPct || 0;
          list[list.length - 1] = last;
        }
      }
      acc[user] = list;
      return acc;
    }, {});
  return byUser;
};

// calcula receita por segmento sobre um mês (YYYY-MM)
// segment: {plan, start, end (Date|null), promoDiscountPct, penaltyPct}
const chargeForSegmentInMonth = (segment, year, monthIndex) => {
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex, daysInMonth(year, monthIndex));
  const segStart = segment.start;
  const segEnd = segment.end ? segment.end : monthEnd; 

  const usedDays = overlapDays(segStart, segEnd, monthStart, monthEnd);
  if (usedDays === 0) return 0;

  const daysTotal = daysInMonth(year, monthIndex);
  const monthlyPrice = PLANS[segment.plan] || 0;

  // aplicar desconto promocional se houver
  const discount = (segment.promoDiscountPct || 0) / 100;
  const baseProrata = monthlyPrice * (usedDays / daysTotal);
  const afterDiscount = baseProrata * (1 - discount);

  // taxa de penalidade (aplicada plenamente no mês do cancelamento se presente)
  const penalty = (segment.penaltyPct || 0) / 100;
  const penaltyValue = penalty > 0 ? monthlyPrice * penalty : 0;

  return afterDiscount + penaltyValue;
};

// --- Agregação por mês ---
const aggregateByMonth = (timelines) => {
  const months = new Set();
  Object.values(timelines).forEach(list => {
    list.forEach(seg => {
      const start = seg.start;
      const end = seg.end || new Date(start.getFullYear(), start.getMonth(), daysInMonth(start.getFullYear(), start.getMonth()));
      let cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        months.add(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`);
        cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
      }
    });
  });

  const monthList = Array.from(months).sort();
  const result = {};

  monthList.forEach(monthKey => {
    const [y, m] = monthKey.split('-').map(n => parseInt(n, 10));
    const monthIndex = m - 1;
    // calcular receita total e usuários
    const perUser = Object.entries(timelines).map(([userId, segs]) => {
      const userRevenue = segs
        .map(seg => chargeForSegmentInMonth(seg, y, monthIndex)) 
        .reduce((a, b) => a + b, 0);
      const activeDays = segs
        .map(seg => overlapDays(seg.start, seg.end || new Date(y, monthIndex, daysInMonth(y, monthIndex)), new Date(y, monthIndex,1), new Date(y, monthIndex, daysInMonth(y, monthIndex))))
        .reduce((a, b) => a + b, 0);
      return { userId, revenue: userRevenue, activeDays };
    });

    const totalRevenue = perUser.reduce((a, b) => a + b.revenue, 0);
    const activeUsers = perUser.filter(u => u.activeDays > 0).length;
    result[monthKey] = { totalRevenue, activeUsers, perUser };
  });

  // calcular ARPU e churn (simples)
  const sortedMonths = Object.keys(result).sort();
  sortedMonths.forEach((mk, idx) => {
    const data = result[mk];
    data.arpu = data.activeUsers > 0 ? data.totalRevenue / data.activeUsers : 0;
    const cancelsThisMonth = [];
    Object.entries(timelines).forEach(([userId, segs]) => {
      segs.forEach(seg => {
        if (seg.end) {
          const y = seg.end.getFullYear();
          const m = String(seg.end.getMonth()+1).padStart(2,'0');
          const key = `${y}-${m}`;
          if (key === mk) cancelsThisMonth.push(userId);
        }
      });
    });
    const prev = sortedMonths[idx-1];
    const prevActive = prev ? result[prev].activeUsers : 0;
    data.churn = prevActive > 0 ? (new Set(cancelsThisMonth).size / prevActive) : 0;
  });

  return result;
};

const sampleData = [
  { userId: 'u1', type: 'subscribe', plan: 'basic', date: '2025-10-05' },
  { userId: 'u1', type: 'change', plan: 'standard', date: '2025-10-20', promoDiscountPct: 0 },
  { userId: 'u2', type: 'subscribe', plan: 'premium', date: '2025-10-01', promoDiscountPct: 20 },
  { userId: 'u3', type: 'subscribe', plan: 'standard', date: '2025-09-10' },
  { userId: 'u3', type: 'cancel', date: '2025-10-12', penaltyPct: 10 },
  { userId: 'u4', type: 'subscribe', plan: 'basic', date: '2025-11-03' }
];

const el = (id) => document.getElementById(id);

const renderResults = (agg) => {
  const container = el('results');
  container.innerHTML = '';
  Object.entries(agg).sort().forEach(([month, data]) => {
    const block = document.createElement('div');
    block.className = 'month-block';
    block.innerHTML = `<h3>${month}</h3>
      <p>Total receita: R$ ${data.totalRevenue.toFixed(2)}</p>
      <p>Usuários ativos: ${data.activeUsers}</p>
      <p>ARPU: R$ ${data.arpu.toFixed(2)}</p>
      <p>Churn (estimado): ${(data.churn*100).toFixed(2)}%</p>`;
    container.appendChild(block);
  });
};

let eventsState = sampleData.slice();

// Render a lista de eventos abaixo do formulário
const renderEventList = () => {
  const container = el('eventList');
  container.innerHTML = '';
  eventsState.forEach((ev, idx) => {
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `<div class="meta"><strong>${ev.userId}</strong> <span class="tag">${ev.type}</span> <span class="plan">${ev.plan || ''}</span> <span class="date">${ev.date}</span></div>
      <div class="actions"><button data-idx="${idx}" class="remove">Remover</button></div>`;
    container.appendChild(item);
  });
  container.querySelectorAll('button.remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = parseInt(e.target.dataset.idx, 10);
      eventsState = eventsState.slice(0, i).concat(eventsState.slice(i+1));
      const eventsInputEl = document.getElementById('eventsInput');
      if (eventsInputEl) eventsInputEl.value = JSON.stringify(eventsState, null, 2);
      renderEventList();
    });
  });
};

const addEventFromForm = (ev) => {
  const v = validateEvent(ev);
  if (!v.valid) return v.errors;
  eventsState = eventsState.concat([ev]);
  const eventsInputEl = document.getElementById('eventsInput');
  if (eventsInputEl) eventsInputEl.value = JSON.stringify(eventsState, null, 2);
  renderEventList();
  return null;
};
const exportEventsJson = () => JSON.stringify(eventsState, null, 2);

const computeFromCurrent = () => {
  const eventsToUse = eventsState.slice(); // use a copy — pure input

  // validação em lote (map + filter)
  const validations = eventsToUse.map(validateEvent);
  const invalids = validations.map((v, i) => ({ v, i })).filter(x => !x.v.valid);
  if (invalids.length > 0) {
    el('results').innerText = 'Há eventos inválidos: ' + JSON.stringify(invalids.map(x => ({ index: x.i, errors: x.v.errors })), null, 2);
    return;
  }

  const timelines = buildTimelines(eventsToUse);
  const agg = aggregateByMonth(timelines);
  renderResults(agg);
};

document.addEventListener('DOMContentLoaded', () => {
  const form = el('eventForm');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const eobj = {
      userId: el('f_userId').value.trim(),
      type: el('f_type').value,
      plan: el('f_plan').value,
      date: el('f_date').value,
      promoDiscountPct: el('f_promo').value ? Number(el('f_promo').value) : undefined,
      penaltyPct: el('f_penalty').value ? Number(el('f_penalty').value) : undefined
    };
    const errors = addEventFromForm(eobj);
    if (errors) {
      alert('Erro ao adicionar: ' + errors.join(', '));
    } else {
      el('f_promo').value = '';
      el('f_penalty').value = '';
    }
  });

  el('loadSample').addEventListener('click', () => {
    eventsState = sampleData.slice();
    const eventsInputEl = document.getElementById('eventsInput');
    if (eventsInputEl) eventsInputEl.value = JSON.stringify(eventsState, null, 2);
    renderEventList();
  });

  el('exportJson').addEventListener('click', () => {
    const txt = exportEventsJson();
    const blob = new Blob([txt], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'events.json';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  el('compute').addEventListener('click', () => computeFromCurrent());

  renderEventList();
});