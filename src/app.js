(function () {
  'use strict';

  const P = window.Planificador;
  const STORE_KEY = 'plan-cero-deudas:v1';

  /* ---------- Estado ---------- */

  let seq = 0;
  const newId = (prefix) => prefix + Date.now().toString(36) + (seq++).toString(36);

  function nextMonthISO() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function exampleState() {
    return {
      isExample: true,
      currency: 'COP',
      startMonth: nextMonthISO(),
      buffer: '150.000',
      referenceRate: '24',
      priority: 'balanceado',
      incomes: [
        { id: 'i1', name: 'Salario', amount: '4.200.000' },
        { id: 'i2', name: 'Trabajos independientes', amount: '600.000' },
      ],
      expenses: [
        { id: 'e1', name: 'Arriendo', amount: '1.300.000' },
        { id: 'e2', name: 'Mercado', amount: '700.000' },
        { id: 'e3', name: 'Servicios e internet', amount: '280.000' },
        { id: 'e4', name: 'Transporte', amount: '250.000' },
      ],
      debts: [
        { id: 'd1', name: 'Tarjeta de crédito', balance: '7.800.000', rate: '28,9', rateType: 'EA', payment: '520.000', kind: 'rotativo', monthlyFee: '35.000' },
        { id: 'd2', name: 'Crédito libre inversión', balance: '14.500.000', rate: '21,5', rateType: 'EA', payment: '610.000', kind: 'cuota', monthlyFee: '18.000' },
        { id: 'd3', name: 'Celular a cuotas', balance: '1.450.000', rate: '2,3', rateType: 'MV', payment: '165.000', kind: 'cuota', monthlyFee: '0' },
        { id: 'd4', name: 'Préstamo familiar', balance: '2.000.000', rate: '0', rateType: 'EA', payment: '200.000', kind: 'cuota', monthlyFee: '0' },
      ],
      offers: [
        { id: 'o1', name: 'Compra de cartera', maxAmount: '12.000.000', rate: '17,9', rateType: 'EA', termMonths: '48', feePct: '0', monthlyInsurance: '22.000' },
      ],
    };
  }

  const blankRow = {
    incomes: () => ({ id: newId('i'), name: '', amount: '', frequency: 'mensual' }),
    expenses: () => ({ id: newId('e'), name: '', amount: '' }),
    debts: () => ({ id: newId('d'), name: '', balance: '', rate: '', rateType: 'EA', payment: '', kind: 'cuota', monthlyFee: '', payroll: false }),
    offers: () => ({ id: newId('o'), name: '', maxAmount: '', rate: '', rateType: 'EA', termMonths: '60', feePct: '0', monthlyInsurance: '' }),
  };

  function blankState() {
    return {
      isExample: false,
      currency: state ? state.currency : 'COP',
      startMonth: nextMonthISO(),
      buffer: '',
      referenceRate: '24',
      priority: 'balanceado',
      incomes: [blankRow.incomes()],
      expenses: [blankRow.expenses()],
      debts: [blankRow.debts()],
      offers: [],
    };
  }

  function isValidState(s) {
    return s && typeof s === 'object' && ['incomes', 'expenses', 'debts', 'offers'].every((k) => Array.isArray(s[k]));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (isValidState(s)) return s;
      }
    } catch (e) { /* sin almacenamiento disponible */ }
    return exampleState();
  }

  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignorar */ }
  }

  let state = null;
  state = loadState();
  let selectedId = null;
  let lastResult = null;
  const charts = [];

  /* ---------- Formato ---------- */

  let moneyFmt, compactFmt;
  function setFormatters() {
    const currency = state.currency || 'COP';
    const digits = currency === 'USD' || currency === 'EUR' || currency === 'PEN' ? 2 : 0;
    try {
      moneyFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: 0 });
      compactFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
    } catch (e) {
      moneyFmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
      compactFmt = moneyFmt;
    }
  }
  const money = (v) => moneyFmt.format(Math.round(v * 100) / 100);
  const compact = (v) => compactFmt.format(v);
  const pctFmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
  const pct = (v) => pctFmt.format(v * 100) + ' %';
  const signed = (v) => (v >= 0 ? '+' : '−') + money(Math.abs(v));

  const monthFmt = new Intl.DateTimeFormat('es-CO', { month: 'short', year: 'numeric' });
  function monthDate(m) {
    const [y, mo] = (state.startMonth || nextMonthISO()).split('-').map(Number);
    return new Date(y, mo - 1 + (m - 1), 1);
  }
  const monthLabel = (m) => monthFmt.format(monthDate(m)).replace('.', '');
  const durationLabel = (n) => {
    if (n == null) return 'más de 50 años';
    const y = Math.floor(n / 12);
    const mo = n % 12;
    const parts = [];
    if (y) parts.push(y + (y === 1 ? ' año' : ' años'));
    if (mo) parts.push(mo + (mo === 1 ? ' mes' : ' meses'));
    return parts.join(' y ') || '0 meses';
  };

  /* ---------- DOM ---------- */

  const $ = (sel) => document.querySelector(sel);

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    return el;
  }

  /* ---------- Formularios ---------- */

  function field(list, row, key, label, opts = {}) {
    const id = `${list}-${row.id}-${key}`;
    const input = h('input', {
      id,
      class: opts.cls || null,
      inputmode: opts.inputmode || null,
      placeholder: opts.placeholder || null,
      'data-list': list,
      'data-row': row.id,
      'data-field': key,
      'aria-label': opts.hideLabel ? label : null,
    });
    input.value = row[key] == null ? '' : row[key];
    if (opts.hideLabel) return input;
    return h('label', { for: id }, label, input);
  }

  function selectField(list, row, key, options, label, hideLabel) {
    const id = `${list}-${row.id}-${key}`;
    const sel = h('select', { id, 'data-list': list, 'data-row': row.id, 'data-field': key, 'aria-label': hideLabel ? label : null },
      options.map(([v, t]) => h('option', { value: v, text: t })));
    sel.value = row[key] || options[0][0];
    if (hideLabel) return sel;
    return h('label', { for: id }, label, sel);
  }

  const FREQUENCIES = [['mensual', 'al mes'], ['quincenal', 'por quincena'], ['semanal', 'por semana']];
  const RATE_TYPES = [['EA', '% E.A.'], ['MV', '% mensual'], ['NA', '% N.A.M.V.']];

  function checkField(list, row, key, label, hint) {
    const id = `${list}-${row.id}-${key}`;
    const input = h('input', { id, type: 'checkbox', 'data-list': list, 'data-row': row.id, 'data-field': key });
    input.checked = Boolean(row[key]);
    return h('label', { for: id, class: 'check' }, input, h('span', null, h('span', { text: label }), h('small', { text: hint })));
  }

  function removeBtn(list, row, what) {
    return h('button', { type: 'button', class: 'ghost', 'data-remove': list, 'data-row': row.id, 'aria-label': 'Eliminar ' + what, title: 'Eliminar' }, '✕');
  }

  function renderSimpleList(list, placeholder) {
    const box = $('#list-' + list);
    box.textContent = '';
    const withFreq = list === 'incomes';
    for (const row of state[list]) {
      box.append(h('div', { class: 'line-row' + (withFreq ? ' with-freq' : '') },
        field(list, row, 'name', 'Concepto', { hideLabel: true, placeholder }),
        field(list, row, 'amount', 'Valor', { hideLabel: true, cls: 'money', inputmode: 'decimal', placeholder: withFreq ? 'Valor neto' : 'Valor mensual' }),
        withFreq ? selectField(list, row, 'frequency', FREQUENCIES, 'Cada cuánto', true) : null,
        removeBtn(list, row, 'fila')));
    }
  }

  function renderDebts() {
    const box = $('#list-debts');
    box.textContent = '';
    state.debts.forEach((d, idx) => {
      box.append(h('div', { class: 'item' },
        h('div', { class: 'item-head' },
          field('debts', d, 'name', 'Nombre de la deuda', { hideLabel: true, placeholder: 'Deuda ' + (idx + 1) }),
          removeBtn('debts', d, 'deuda')),
        h('div', { class: 'grid2' },
          field('debts', d, 'balance', 'Saldo actual', { cls: 'money', inputmode: 'decimal', placeholder: '0' }),
          field('debts', d, 'payment', d.kind === 'rotativo' ? 'Pago mínimo' : 'Cuota mensual', { cls: 'money', inputmode: 'decimal', placeholder: '0' }),
          h('label', { for: `debts-${d.id}-rate` }, 'Tasa de interés',
            h('div', { class: 'pair' },
              field('debts', d, 'rate', 'Tasa', { hideLabel: true, cls: 'rate', inputmode: 'decimal', placeholder: '0' }),
              selectField('debts', d, 'rateType', RATE_TYPES, 'Tipo de tasa', true))),
          selectField('debts', d, 'kind', [['cuota', 'Cuota fija (crédito)'], ['rotativo', 'Rotativo (tarjeta, cupo)']], 'Tipo de deuda'),
          field('debts', d, 'monthlyFee', 'Seguros y cuota de manejo al mes', { cls: 'money', inputmode: 'decimal', placeholder: '0' })),
        checkField('debts', d, 'payroll', 'Me la descuentan por nómina (libranza)', 'Ya viene restada del neto de tu colilla. Escribe la cuota del mes: si es por quincena, multiplícala por 2.'),
        h('p', { class: 'meta', id: 'meta-debts-' + d.id })));
      updateDebtMeta(d);
    });
  }

  function renderOffers() {
    const box = $('#list-offers');
    box.textContent = '';
    if (!state.offers.length) {
      box.append(h('p', { class: 'small muted' }, 'Sin ofertas. Si tienes una, agrégala para ver si conviene.'));
    }
    state.offers.forEach((o, idx) => {
      box.append(h('div', { class: 'item' },
        h('div', { class: 'item-head' },
          field('offers', o, 'name', 'Nombre de la oferta', { hideLabel: true, placeholder: 'Oferta ' + (idx + 1) }),
          removeBtn('offers', o, 'oferta')),
        h('div', { class: 'grid2' },
          field('offers', o, 'maxAmount', 'Monto máximo aprobado', { cls: 'money', inputmode: 'decimal', placeholder: '0' }),
          field('offers', o, 'termMonths', 'Plazo (meses)', { cls: 'rate', inputmode: 'numeric', placeholder: '60' }),
          h('label', { for: `offers-${o.id}-rate` }, 'Tasa de interés',
            h('div', { class: 'pair' },
              field('offers', o, 'rate', 'Tasa', { hideLabel: true, cls: 'rate', inputmode: 'decimal', placeholder: '0' }),
              selectField('offers', o, 'rateType', RATE_TYPES, 'Tipo de tasa', true))),
          field('offers', o, 'feePct', 'Comisión de apertura (%)', { cls: 'rate', inputmode: 'decimal', placeholder: '0' }),
          field('offers', o, 'monthlyInsurance', 'Seguro mensual', { cls: 'money', inputmode: 'decimal', placeholder: '0' })),
        h('p', { class: 'meta', id: 'meta-offers-' + o.id })));
      updateOfferMeta(o);
    });
  }

  function updateDebtMeta(d) {
    const el = document.getElementById('meta-debts-' + d.id);
    if (!el) return;
    const i = P.monthlyRate(d.rate, d.rateType);
    const bal = P.parseNumber(d.balance);
    const pay = P.parseNumber(d.payment);
    const interest = bal * i;
    let text = i > 0 ? `${pct(i)} mensual · ${pct(P.toEA(i))} E.A. · interés este mes ≈ ${money(interest)}` : 'Sin intereses';
    if (d.kind !== 'rotativo' && bal > 0 && pay > 0 && pay <= interest) text += ' · la cuota no cubre los intereses';
    el.textContent = text;
  }

  function updateOfferMeta(o) {
    const el = document.getElementById('meta-offers-' + o.id);
    if (!el) return;
    const i = P.monthlyRate(o.rate, o.rateType);
    const amount = P.parseNumber(o.maxAmount);
    const n = Math.round(P.parseNumber(o.termMonths));
    if (!(amount > 0) || !(n > 0)) {
      el.textContent = 'Completa monto y plazo para evaluarla.';
      return;
    }
    const cuota = P.annuityPayment(amount, i, n);
    const ins = P.parseNumber(o.monthlyInsurance);
    el.textContent = `${pct(i)} mensual · cuota por el monto máximo ≈ ${money(cuota + ins)}${ins ? ' con seguro' : ''}`;
  }

  function renderRootFields() {
    $('#f-buffer').value = state.buffer || '';
    $('#f-start').value = state.startMonth || nextMonthISO();
    $('#f-currency').value = state.currency || 'COP';
    $('#f-ref').value = state.referenceRate || '';
    $('#example-banner').hidden = !state.isExample;
  }

  function renderForms() {
    setFormatters();
    renderRootFields();
    renderSimpleList('incomes', 'Ej. salario');
    renderSimpleList('expenses', 'Ej. arriendo');
    renderDebts();
    renderOffers();
  }

  function renderTotals() {
    const total = (list, key) => state[list].reduce((t, r) => t + P.parseNumber(r[key]) * (P.FREQUENCY[r.frequency] || 1), 0);
    $('#t-incomes').textContent = money(total('incomes', 'amount')) + ' al mes';
    $('#t-expenses').textContent = money(total('expenses', 'amount'));
    $('#t-debts').textContent = money(total('debts', 'balance'));
    $('#t-offers').textContent = state.offers.length ? state.offers.length + (state.offers.length === 1 ? ' oferta' : ' ofertas') : '';
  }

  /* ---------- Eventos de formulario ---------- */

  let timer = null;
  function scheduleCompute() {
    clearTimeout(timer);
    timer = setTimeout(compute, 220);
  }

  function markEdited() {
    if (state.isExample) {
      state.isExample = false;
      $('#example-banner').hidden = true;
    }
  }

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.list) {
      const row = state[t.dataset.list].find((r) => r.id === t.dataset.row);
      if (!row) return;
      row[t.dataset.field] = t.type === 'checkbox' ? t.checked : t.value;
      if (t.dataset.list === 'debts') {
        if (t.dataset.field === 'kind') renderDebts();
        else updateDebtMeta(row);
      }
      if (t.dataset.list === 'offers') updateOfferMeta(row);
    } else if (t.dataset.fieldRoot) {
      state[t.dataset.fieldRoot] = t.value;
      if (t.dataset.fieldRoot === 'currency') {
        setFormatters();
        state.debts.forEach(updateDebtMeta);
        state.offers.forEach(updateOfferMeta);
      }
    } else {
      return;
    }
    markEdited();
    saveState();
    scheduleCompute();
  });

  document.addEventListener('click', (ev) => {
    const add = ev.target.closest('[data-add]');
    const rem = ev.target.closest('[data-remove]');
    if (add) {
      const list = add.dataset.add;
      const row = blankRow[list]();
      state[list].push(row);
      rerenderList(list);
      const first = document.getElementById(`${list}-${row.id}-name`);
      if (first) first.focus();
    } else if (rem) {
      const list = rem.dataset.remove;
      state[list] = state[list].filter((r) => r.id !== rem.dataset.row);
      rerenderList(list);
    } else {
      return;
    }
    markEdited();
    saveState();
    compute();
  });

  function rerenderList(list) {
    if (list === 'debts') renderDebts();
    else if (list === 'offers') renderOffers();
    else renderSimpleList(list, list === 'incomes' ? 'Ej. salario' : 'Ej. arriendo');
  }

  /* ---------- Datos: copiar, pegar, reiniciar ---------- */

  $('#btn-copy').addEventListener('click', async () => {
    const text = JSON.stringify(state, null, 2);
    const btn = $('#btn-copy');
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Datos copiados';
    } catch (e) {
      openImport(text);
      $('#import-text').select();
      $('#import-msg').textContent = 'Copia este texto y guárdalo donde quieras.';
      btn.textContent = 'Copia el texto de abajo';
    }
    setTimeout(() => (btn.textContent = 'Copiar mis datos'), 2500);
  });

  function openImport(text) {
    $('#import-box').hidden = false;
    $('#import-text').value = text || '';
    $('#import-msg').textContent = '';
  }
  $('#btn-import').addEventListener('click', () => {
    openImport('');
    $('#import-text').focus();
  });
  $('#btn-import-cancel').addEventListener('click', () => ($('#import-box').hidden = true));
  $('#btn-import-apply').addEventListener('click', () => {
    try {
      const s = JSON.parse($('#import-text').value);
      if (!isValidState(s)) throw new Error('formato');
      state = s;
      state.isExample = false;
      saveState();
      renderForms();
      compute();
      $('#import-box').hidden = true;
    } catch (e) {
      $('#import-msg').textContent = 'No reconozco ese texto. Pega exactamente lo que copiaste con "Copiar mis datos".';
    }
  });

  let resetArmed = null;
  $('#btn-reset').addEventListener('click', () => {
    const btn = $('#btn-reset');
    if (!resetArmed) {
      btn.textContent = '¿Borrar todo? Toca otra vez';
      resetArmed = setTimeout(() => {
        resetArmed = null;
        btn.textContent = 'Empezar en blanco';
      }, 4000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = null;
    btn.textContent = 'Empezar en blanco';
    state = blankState();
    selectedId = null;
    saveState();
    renderForms();
    compute();
  });

  $('#btn-clear-example').addEventListener('click', () => {
    state = blankState();
    selectedId = null;
    saveState();
    renderForms();
    compute();
  });

  /* ---------- Cálculo ---------- */

  function compute() {
    setFormatters();
    renderTotals();
    const res = P.plan(state, { referenceRateEA: P.parseNumber(state.referenceRate) || 24 });
    lastResult = res;
    if (selectedId && !res.scenarios.some((x) => x.id === selectedId)) selectedId = null;
    renderResults(res);
  }

  /* ---------- Resultados ---------- */

  const nameOf = (sim, id) => {
    const d = sim.debts.find((x) => x.id === id);
    return d ? d.name : id;
  };
  const quoteList = (names) => {
    const q = names.map((n) => '«' + n + '»');
    return q.length > 1 ? q.slice(0, -1).join(', ') + ' y ' + q[q.length - 1] : q[0];
  };

  function originalNames(res, ids) {
    return ids.map((id) => {
      const d = state.debts.find((x) => String(x.id) === id);
      return d ? d.name || 'Deuda' : id;
    });
  }

  function scenarioTitle(sc, res) {
    const strat = P.STRATEGIES[sc.strategy].label;
    if (sc.strategy === 'minimos') return 'Pagar solo las cuotas mínimas, sin abonos extra.';
    if (sc.loan) {
      return `Toma «${sc.loan.name}» por ${money(sc.loan.principal)} para pagar ${quoteList(originalNames(res, sc.loan.replaces))}, y abona el resto con el método ${strat}.`;
    }
    return `Sin crédito nuevo: abona tu excedente con el método ${strat}.`;
  }

  function statusOf(sc, res) {
    if (sc === res.best && sc.metrics.feasible) return ['Recomendada', 'accent'];
    if (sc.metrics.months == null) return ['No termina', 'bad'];
    if (!sc.metrics.feasible) return ['Déficit', 'bad'];
    return ['Viable', 'good'];
  }

  function renderResults(res) {
    const root = $('#results');
    root.textContent = '';
    charts.length = 0;

    root.append(renderPriority(res));
    root.append(renderStrip(res.summary));
    const alerts = renderAlerts(res);
    if (alerts) root.append(alerts);

    if (!res.best) {
      root.append(h('section', { class: 'panel empty' },
        h('h2', { text: 'Agrega al menos una deuda con saldo' }),
        h('p', { text: 'Con tus ingresos, gastos y deudas el plan calcula la ruta de pago.' })));
      return;
    }

    const sel = res.scenarios.find((x) => x.id === selectedId) || res.best;
    root.append(renderHero(sel, res));
    root.append(renderCharts(sel, res));
    root.append(renderScenarioTable(sel, res));
    root.append(renderSchedule(sel, res));
    root.append(renderFoot());
    drawCharts();
  }

  function renderPriority(res) {
    const opts = [
      ['intereses', 'Pagar menos intereses'],
      ['balanceado', 'Equilibrio'],
      ['flujo', 'Más flujo de caja'],
    ];
    return h('section', { class: 'priority' },
      h('p', { class: 'eyebrow', id: 'prio-label', text: '¿Qué te importa más?' }),
      h('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'prio-label' },
        opts.map(([v, t]) => h('button', {
          type: 'button',
          'aria-pressed': String(res.priority === v),
          onclick: () => {
            state.priority = v;
            selectedId = null;
            saveState();
            compute();
          },
        }, t))));
  }

  function renderStrip(sm) {
    let pill;
    if (sm.budget <= 0 || sm.extraNow < 0) pill = h('span', { class: 'pill bad', text: 'Déficit' });
    else if (sm.extraNow < sm.income * 0.05) pill = h('span', { class: 'pill warn', text: 'Ajustado' });
    else pill = h('span', { class: 'pill good', text: 'Hay margen' });
    const cell = (label, value, extra) => h('div', null, h('span', { class: 'eyebrow', text: label }), h('span', { class: 'v', text: value }), extra || null);
    return h('section', { class: 'strip', 'aria-label': 'Resumen del mes' },
      cell('Ingresos al mes', money(sm.income), sm.payrollAddBack > 0
        ? h('span', { class: 'small muted', text: `Neto ${money(sm.netIncome)} + libranzas ${money(sm.payrollAddBack)}` })
        : null),
      cell('Gastos + colchón', money(sm.expense + sm.buffer)),
      cell('Cuotas de deudas hoy', money(sm.requiredNow), h('span', { class: 'small muted', text: 'Deuda total ' + money(sm.totalDebt) })),
      cell('Queda para abonar', money(sm.extraNow), pill));
  }

  function renderAlerts(res) {
    const items = res.warnings.map((w) =>
      h('div', { class: 'alert ' + w.level }, h('b', { text: w.level === 'critico' ? 'Ojo' : 'Aviso' }), h('span', { text: w.text })));
    if (res.suggestion) {
      const sg = res.suggestion;
      items.push(h('div', { class: 'alert aviso' },
        h('b', { text: 'Crédito' }),
        h('span', { text: `Para cubrir el déficit podrías consolidar todo en un crédito por ${money(sg.amount)} a ${sg.term} meses al ${pctFmt.format(sg.rateEA)} % E.A. La cuota sería de ${money(sg.payment)}. Pide ofertas así y agrégalas para compararlas.` }),
        h('div', { class: 'actions' },
          h('button', {
            type: 'button',
            onclick: () => {
              state.offers.push({ id: newId('o'), name: 'Consolidación sugerida', maxAmount: String(Math.ceil(sg.amount / 1000) * 1000), rate: String(sg.rateEA).replace('.', ','), rateType: 'EA', termMonths: String(sg.term), feePct: '0', monthlyInsurance: '0' });
              markEdited();
              saveState();
              renderOffers();
              compute();
            },
          }, 'Simular esta oferta'))));
    }
    if (!items.length) return null;
    return h('section', { class: 'alerts' }, items);
  }

  function renderHero(sc, res) {
    const m = sc.metrics;
    const isBest = sc === res.best;
    const base = res.baseline;
    const sm = res.summary;

    const kpi = (label, value, delta, cls) =>
      h('div', { class: 'kpi' }, h('span', { class: 'eyebrow', text: label }), h('span', { class: 'v', text: value }), delta ? h('span', { class: 'd ' + (cls || ''), text: delta }) : null);

    let costDelta = null;
    let costCls = '';
    if (base && sc !== base) {
      if (base.metrics.months == null) {
        costDelta = 'Con solo mínimos no terminarías en 50 años';
        costCls = 'up';
      } else {
        const saved = base.metrics.totalCost - m.totalCost;
        costDelta = saved >= 0 ? `Ahorras ${money(saved)} frente a pagar solo mínimos` : `${money(-saved)} más que pagar solo mínimos`;
        costCls = saved >= 0 ? 'up' : 'down';
      }
    }
    const flowDelta = m.free1 - sm.freeNow;

    const head = h('div', { class: 'hero-title' },
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' },
        h('span', { class: 'eyebrow', text: isBest ? 'Ruta recomendada' : 'Ruta seleccionada' }),
        !m.feasible ? h('span', { class: 'pill bad', text: m.months == null ? 'No termina' : 'Tiene meses en déficit' }) : null,
        !isBest ? h('button', { type: 'button', class: 'ghost', style: 'color:var(--accent)', onclick: () => { selectedId = null; renderResults(lastResult); } }, 'Volver a la recomendada') : null),
      h('h2', { text: scenarioTitle(sc, res) }),
      h('p', { class: 'muted small', text: P.STRATEGIES[sc.strategy].detail }));

    const kpis = h('div', { class: 'kpis' },
      kpi('Libre de deudas', m.months != null ? monthLabel(m.months) : '—', 'En ' + durationLabel(m.months)),
      kpi('Intereses, seguros y comisiones', money(m.totalCost), costDelta, costCls),
      kpi('Flujo libre el primer mes', money(m.free1), Math.abs(flowDelta) >= 1 ? `${signed(flowDelta)} frente a hoy` : 'Igual que hoy', flowDelta > 0 ? 'up' : flowDelta < 0 ? 'down' : ''),
      kpi('Flujo libre al terminar', money(sm.income - sm.expense), 'Cada mes, para ahorrar o invertir'));

    if (!m.feasible && m.maxDeficit > 0) {
      kpis.append(kpi('Déficit máximo', money(m.maxDeficit), `${m.deficitMonths} ${m.deficitMonths === 1 ? 'mes' : 'meses'} sin plata para las cuotas`, 'down'));
    }

    return h('section', { class: 'hero' }, head, kpis, renderRoute(sc, res));
  }

  function renderRoute(sc, res) {
    const steps = P.roadmap(sc);
    const ol = h('ol', { class: 'route', 'aria-label': 'Hoja de ruta' });
    const sim = sc.sim;
    const lastMonth = sc.metrics.months;
    for (const st of steps) {
      if (st.kind === 'credito') {
        const L = st.loan;
        ol.append(h('li', { class: 'loan' },
          h('span', { class: 'when', text: 'Antes de ' + monthLabel(1) }),
          h('span', { class: 'dot' }),
          h('div', { class: 'what' },
            h('strong', { text: `Toma «${L.name}» por ${money(L.principal)} a ${L.term} meses` }),
            h('span', { class: 'small muted', text: `Con ese dinero pagas completas ${quoteList(originalNames(res, L.replaces))}. Sus cuotas sumaban ${money(L.replacedPayments)}; la nueva es ${money(L.payment + L.insurance)}${L.insurance ? ' con seguro' : ''}. Costo real con comisión y seguros: ${pct(L.effectiveEA)} E.A.` }))));
      } else if (st.kind === 'objetivo') {
        const extra = sim.rows[0] ? sim.rows[0].extra : 0;
        ol.append(h('li', null,
          h('span', { class: 'when', text: monthLabel(1) }),
          h('span', { class: 'dot' }),
          h('div', { class: 'what' },
            h('strong', { text: extra > 1 ? `Paga todas las cuotas y abona ${money(extra)} a «${st.debt.name}»` : 'Paga todas las cuotas a tiempo' }),
            h('span', { class: 'small muted', text: 'Cada mes, todo el excedente va a capital de la deuda objetivo. Pide al banco que el abono reduzca plazo, no cuota.' }))));
      } else if (st.kind === 'cierre') {
        const isLast = st.month === lastMonth;
        const names = st.debts.map((d) => d.name);
        ol.append(h('li', { class: 'done' },
          h('span', { class: 'when', text: monthLabel(st.month) }),
          h('span', { class: 'dot' }),
          h('div', { class: 'what' },
            h('strong', { text: isLast ? `Terminas de pagar ${quoteList(names)}. Quedas libre de deudas.` : `Terminas de pagar ${quoteList(names)}` }),
            h('span', { class: 'small muted', text: isLast ? `Desde ${monthLabel(st.month + 1)} tienes ${money(res.summary.income - res.summary.expense)} libres cada mes.` : `Se liberan ${money(st.freed)} de cuota que pasan a la siguiente deuda.` }))));
      }
    }
    if (lastMonth == null) {
      ol.append(h('li', null,
        h('span', { class: 'when', text: '—' }),
        h('span', { class: 'dot' }),
        h('div', { class: 'what' }, h('strong', { text: 'Con este ritmo las deudas no terminan en 50 años' }))));
    }
    return ol;
  }

  /* ---------- Gráficas ---------- */

  function pickAlternative(sc, res) {
    const pool = res.scenarios.filter((x) => x.strategy !== 'minimos' && x !== sc);
    if (sc.loan) return pool.find((x) => !x.loan) || null;
    return pool.find((x) => x.loan) || pool.find((x) => x.metrics.totalCost !== sc.metrics.totalCost) || null;
  }

  function altLabel(alt) {
    if (!alt) return '';
    return alt.loan ? `Con «${alt.loan.name}»` : `Sin crédito (${P.STRATEGIES[alt.strategy].label})`;
  }

  function balanceSeries(sc) {
    const start = sc.sim.debts.reduce((t, d) => t + d.balance, 0);
    return [start, ...sc.sim.rows.map((r) => r.totalBalance)];
  }

  function freeSeries(sc, len, freeBase) {
    const out = [];
    for (let m = 1; m <= len; m++) {
      const r = sc.sim.rows[m - 1];
      out.push(r ? r.free : freeBase);
    }
    return out;
  }

  function renderCharts(sc, res) {
    const alt = pickAlternative(sc, res);
    const base = res.baseline && res.baseline !== sc ? res.baseline : null;
    const selLen = sc.sim.rows.length;
    const altLen = alt ? alt.sim.rows.length : 0;
    const main = Math.max(selLen, altLen, 1);
    const horizon = Math.min(Math.max(main + 3, base ? Math.min(base.sim.rows.length, main * 2) : 0), 600);

    const bal = [{ label: 'Ruta seleccionada', color: 'var(--s1)', values: balanceSeries(sc) }];
    if (alt) bal.push({ label: altLabel(alt), color: 'var(--s2)', values: balanceSeries(alt) });
    if (base) bal.push({ label: 'Solo mínimos', color: 'var(--s3)', dash: true, values: balanceSeries(base) });

    const freeBase = res.summary.income - res.summary.expense;
    const flowLen = Math.max(main + 3, 12);
    const flow = [{ label: 'Ruta seleccionada', color: 'var(--s1)', values: freeSeries(sc, flowLen, freeBase) }];
    if (alt) flow.push({ label: altLabel(alt), color: 'var(--s2)', values: freeSeries(alt, flowLen, freeBase) });

    const c1 = h('div', { class: 'chart' });
    const c2 = h('div', { class: 'chart' });
    charts.push({ host: c1, cfg: { series: bal, n: horizon + 1, xLabel: (i) => (i === 0 ? 'Hoy' : monthLabel(i)), yFmt: compact, fmt: money, startAtZero: true } });
    charts.push({ host: c2, cfg: { series: flow, n: flowLen, xLabel: (i) => monthLabel(i + 1), yFmt: compact, fmt: money, startAtZero: true, zeroLine: true } });

    const baseNote = base && base.sim.rows.length > horizon
      ? `La línea de solo mínimos sigue fuera de la gráfica: tarda ${durationLabel(base.metrics.months)}.`
      : null;

    return h('section', { class: 'panel' },
      h('div', { class: 'charts' },
        h('div', { style: 'display:grid;gap:10px;min-width:0' },
          h('h3', { text: 'Deuda total mes a mes' }),
          legend(bal),
          c1,
          baseNote ? h('p', { class: 'small muted', text: baseNote }) : null),
        h('div', { style: 'display:grid;gap:10px;min-width:0' },
          h('h3', { text: 'Flujo libre cada mes' }),
          legend(flow),
          c2,
          h('p', { class: 'small muted', text: 'Ingresos menos gastos menos cuotas obligatorias. Sube cada vez que cierras una deuda.' }))));
  }

  function legend(series) {
    return h('div', { class: 'legend' },
      series.map((se) => h('span', null, h('i', { class: se.dash ? 'dash' : null, style: 'border-color:' + se.color }), se.label)));
  }

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function lineChart(host, cfg) {
    host.textContent = '';
    const W = Math.max(280, Math.round(host.clientWidth || 560));
    const H = 230;
    const mg = { l: 58, r: 14, t: 10, b: 26 };
    const pw = W - mg.l - mg.r;
    const ph = H - mg.t - mg.b;
    const n = Math.max(2, cfg.n);

    let lo = cfg.startAtZero ? 0 : Infinity;
    let hi = -Infinity;
    for (const se of cfg.series) for (let i = 0; i < Math.min(n, se.values.length); i++) {
      lo = Math.min(lo, se.values[i]);
      hi = Math.max(hi, se.values[i]);
    }
    if (!isFinite(hi) || hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;

    const x = (i) => mg.l + (i / (n - 1)) * pw;
    const y = (v) => mg.t + (1 - (v - lo) / (hi - lo)) * ph;

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: '0', 'aria-label': cfg.series.map((se) => se.label).join(', ') });
    for (let v = lo; v <= hi + step / 2; v += step) {
      svg.append(s('line', { x1: mg.l, x2: W - mg.r, y1: y(v), y2: y(v), class: Math.abs(v) < step / 2 && cfg.zeroLine ? 'axis-line' : 'gridline', 'stroke-width': 1 }));
      const t = s('text', { x: mg.l - 8, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = cfg.yFmt(v);
      svg.append(t);
    }
    svg.append(s('line', { x1: mg.l, x2: W - mg.r, y1: mg.t + ph, y2: mg.t + ph, class: 'axis-line' }));

    const labelCount = Math.max(2, Math.floor(pw / 90));
    const xStep = Math.max(1, Math.ceil((n - 1) / labelCount));
    for (let i = 0; i < n; i += xStep) {
      const t = s('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : 'middle' });
      t.textContent = cfg.xLabel(i);
      svg.append(t);
    }

    // Líneas: primero las de fondo para que la seleccionada quede encima.
    [...cfg.series].reverse().forEach((se) => {
      const pts = [];
      for (let i = 0; i < Math.min(n, se.values.length); i++) pts.push(`${x(i).toFixed(1)},${y(se.values[i]).toFixed(1)}`);
      if (pts.length < 2) return;
      svg.append(s('polyline', {
        points: pts.join(' '),
        fill: 'none',
        stroke: se.color,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        'stroke-dasharray': se.dash ? '5 4' : null,
      }));
    });

    const cross = s('line', { y1: mg.t, y2: mg.t + ph, stroke: 'var(--ink-3)', 'stroke-width': 1, visibility: 'hidden' });
    svg.append(cross);
    const dots = cfg.series.map((se) => {
      const c = s('circle', { r: 4, fill: se.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' });
      svg.append(c);
      return c;
    });

    const tip = h('div', { class: 'tip', hidden: true });
    host.append(svg, tip);

    const show = (i) => {
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      tip.textContent = '';
      tip.append(h('span', { class: 't', text: cfg.xLabel(i) }));
      cfg.series.forEach((se, k) => {
        const v = i < se.values.length ? se.values[i] : null;
        if (v == null) {
          dots[k].setAttribute('visibility', 'hidden');
        } else {
          dots[k].setAttribute('cx', x(i));
          dots[k].setAttribute('cy', y(v));
          dots[k].setAttribute('visibility', 'visible');
        }
        tip.append(h('div', { class: 'r' },
          h('i', { style: 'border-color:' + se.color + (se.dash ? ';border-top-style:dashed' : '') }),
          h('b', { text: v == null ? '—' : cfg.fmt(v) }),
          h('span', { text: se.label })));
      });
      tip.hidden = false;
      const scale = svg.getBoundingClientRect().width / W || 1;
      const px = x(i) * scale;
      const tw = tip.offsetWidth;
      tip.style.left = (px + 14 + tw > host.clientWidth ? Math.max(0, px - tw - 14) : px + 14) + 'px';
      tip.style.top = '8px';
      svg._i = i;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tip.hidden = true;
    };
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      show(Math.round(((px - mg.l) / pw) * (n - 1)));
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', () => show(svg._i || 0));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight') { show((svg._i || 0) + 1); ev.preventDefault(); }
      if (ev.key === 'ArrowLeft') { show((svg._i || 0) - 1); ev.preventDefault(); }
    });
  }

  function drawCharts() {
    for (const c of charts) lineChart(c.host, c.cfg);
  }

  let lastWidth = 0;
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (Math.abs(w - lastWidth) > 4) {
        lastWidth = w;
        drawCharts();
      }
    }).observe($('#results'));
  }

  /* ---------- Tabla de escenarios ---------- */

  function uniqueScenarios(list) {
    const map = new Map();
    const out = [];
    for (const sc of list) {
      const loanKey = sc.loan ? sc.loan.offerId + ':' + [...sc.loan.replaces].sort().join(',') : '-';
      const key = [loanKey, sc.metrics.months, Math.round(sc.metrics.totalCost / 100), Math.round(sc.metrics.avgFree12 / 100), sc.strategy === 'minimos'].join('|');
      if (map.has(key)) {
        map.get(key).also.push(sc.strategy);
        continue;
      }
      const e = { sc, also: [] };
      map.set(key, e);
      out.push(e);
    }
    return out;
  }

  function renderScenarioTable(sel, res) {
    const uniq = uniqueScenarios(res.scenarios);
    let shown = uniq.slice(0, 8);
    const baseEntry = uniq.find((e) => e.sc === res.baseline);
    if (baseEntry && !shown.includes(baseEntry)) shown = shown.concat(baseEntry);
    if (!shown.some((e) => e.sc === sel)) {
      const e = uniq.find((x) => x.sc === sel);
      if (e) shown.push(e);
    }

    const rows = shown.map((e, idx) => {
      const sc = e.sc;
      const m = sc.metrics;
      const [st, cls] = statusOf(sc, res);
      const strat = [sc.strategy, ...e.also].map((k) => P.STRATEGIES[k].label).join(' = ');
      const credit = sc.loan
        ? `Consolida ${quoteList(originalNames(res, sc.loan.replaces))} con «${sc.loan.name}»`
        : 'Sin crédito nuevo';
      const isSel = sc === sel;
      const pick = () => {
        selectedId = sc.id;
        renderResults(lastResult);
        const hero = document.querySelector('.hero');
        if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      return h('tr', {
        class: 'pick' + (isSel ? ' sel' : ''),
        tabindex: '0',
        'aria-selected': String(isSel),
        onclick: pick,
        onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } },
      },
        h('td', { class: 'txt' }, h('strong', { text: strat }), h('span', { class: 'sub', text: credit })),
        h('td', { text: m.months != null ? String(m.months) : '600+' }),
        h('td', { text: money(m.totalCost) }),
        h('td', { text: money(m.free1) }),
        h('td', { text: money(m.avgFree12) }),
        h('td', null, h('span', { class: 'pill ' + cls, text: st })));
    });

    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'Rutas comparadas' }), h('span', { class: 'small muted', text: res.scenarios.length + ' simulaciones' })),
      h('p', { class: 'small muted', text: 'Toca una fila para ver su hoja de ruta. El orden depende de lo que te importa más.' }),
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { text: 'Ruta' }),
            h('th', { text: 'Meses' }),
            h('th', { text: 'Intereses y costos' }),
            h('th', { text: 'Flujo libre mes 1' }),
            h('th', { text: 'Flujo prom. 12 meses' }),
            h('th', { text: 'Estado' }))),
          h('tbody', null, rows))));
  }

  /* ---------- Cronograma ---------- */

  function renderSchedule(sc, res) {
    const debts = sc.sim.debts;
    const head = h('tr', null,
      h('th', { text: 'Mes' }),
      debts.map((d) => h('th', { text: d.name })),
      h('th', { text: 'Pago total' }),
      h('th', { text: 'Deuda restante' }),
      h('th', { text: 'Flujo libre' }));
    const body = sc.sim.rows.map((r) => {
      const total = Object.values(r.payments).reduce((a, b) => a + b, 0);
      return h('tr', { class: r.closed.length ? 'closed' : null },
        h('td', { text: monthLabel(r.month) }),
        debts.map((d) => {
          const p = r.payments[d.id];
          if (!p) return h('td', { text: '—' });
          return h('td', null, money(p), h('span', { class: 'sub', text: r.closed.includes(d.id) ? 'pagada' : 'saldo ' + compact(r.balances[d.id]) }));
        }),
        h('td', { text: money(total) }),
        h('td', { text: money(r.totalBalance) }),
        h('td', { text: money(r.free) }));
    });
    return h('section', { class: 'panel' },
      h('details', null,
        h('summary', null, 'Cronograma mes a mes'),
        h('p', { class: 'small muted', style: 'margin-top:10px', text: 'Lo que pagas a cada deuda cada mes, incluidos seguros y abonos extra.' }),
        h('div', { class: 'table-wrap scroll-y', style: 'margin-top:10px' },
          h('table', null, h('thead', null, head), h('tbody', null, body)))));
  }

  function renderFoot() {
    return h('section', { class: 'foot' },
      h('p', { text: 'Cómo calcula: simula mes a mes. Cada mes suma los intereses, paga todas las cuotas obligatorias y lleva el excedente (ingresos − gastos − colchón − cuotas) a la deuda objetivo de la estrategia. Cuando una deuda termina, su cuota se suma al abono de la siguiente.' }),
      h('p', { text: 'Para los créditos nuevos evalúa varias combinaciones de deudas a consolidar y descuenta la comisión del desembolso. Los abonos extra a capital no tienen penalidad en créditos de consumo en Colombia (Ley 1555 de 2012). Antes de firmar, confirma que la tasa no supere la tasa de usura vigente y pide la tabla de amortización.' }),
      h('p', { text: 'Tus datos se guardan solo en este navegador. Es una herramienta de planeación, no una asesoría financiera.' }));
  }

  /* ---------- Inicio ---------- */

  renderForms();
  compute();
})();
