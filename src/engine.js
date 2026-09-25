/*
 * Motor del planificador de deudas.
 *
 * Simula mes a mes el pago de un conjunto de deudas con un presupuesto fijo,
 * compara estrategias (avalancha, bola de nieve, flujo de caja) y evalúa si
 * conviene tomar un crédito de consolidación con las ofertas disponibles.
 *
 * No depende del DOM: funciona en el navegador (window.Planificador) y en Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Planificador = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Saldos por debajo de esto se consideran pagados (unidades de moneda).
  const EPS = 0.5;
  const MAX_MONTHS = 600;

  const STRATEGIES = {
    avalancha: {
      label: 'Avalancha',
      detail: 'Abona primero a la deuda con la tasa más alta. Es la que menos intereses paga.',
    },
    bola: {
      label: 'Bola de nieve',
      detail: 'Abona primero a la deuda con el saldo más pequeño. Cierra deudas rápido.',
    },
    flujo: {
      label: 'Flujo de caja',
      detail: 'Abona primero a la deuda que libera más cuota por cada peso pagado.',
    },
    minimos: {
      label: 'Solo pagos mínimos',
      detail: 'Paga únicamente las cuotas obligatorias. Sirve como punto de comparación.',
    },
  };

  const PRIORITY_WEIGHTS = {
    intereses: { cost: 0.8, flow: 0.05, time: 0.15 },
    balanceado: { cost: 0.45, flow: 0.3, time: 0.25 },
    flujo: { cost: 0.15, flow: 0.7, time: 0.15 },
  };

  /* ---------- Utilidades numéricas ---------- */

  // Acepta "1.500.000", "1,500,000", "28,5", "28.5", "$ 2.000.000,50".
  function parseNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    if (value == null) return 0;
    let s = String(value).trim().replace(/[^\d.,-]/g, '');
    if (!s) return 0;
    const hasDot = s.includes('.');
    const hasComma = s.includes(',');
    if (hasDot && hasComma) {
      const decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
      const thousandSep = decimalSep === ',' ? '.' : ',';
      s = s.split(thousandSep).join('').replace(decimalSep, '.');
    } else if (hasDot || hasComma) {
      const sep = hasDot ? '.' : ',';
      const parts = s.split(sep);
      // Varias apariciones o exactamente 3 dígitos al final: separador de miles.
      if (parts.length > 2 || parts[1].length === 3) s = parts.join('');
      else s = parts.join('.');
    }
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }

  // Convierte una tasa en % a tasa mensual efectiva.
  // EA: efectiva anual. MV: % mensual (mes vencido). NA: nominal anual mes vencido.
  function monthlyRate(rate, type) {
    const r = parseNumber(rate) / 100;
    if (!(r > 0)) return 0;
    if (type === 'MV') return r;
    if (type === 'NA') return r / 12;
    return Math.pow(1 + r, 1 / 12) - 1;
  }

  function toEA(i) {
    return Math.pow(1 + i, 12) - 1;
  }

  function annuityPayment(principal, i, n) {
    if (!(n > 0)) return principal;
    if (!(i > 0)) return principal / n;
    return (principal * i) / (1 - Math.pow(1 + i, -n));
  }

  // Tasa mensual que iguala lo recibido con los pagos (TIR). Bisección.
  function irrMonthly(received, payment, n) {
    if (!(received > 0) || !(payment > 0) || !(n > 0)) return 0;
    if (payment * n <= received) return 0;
    let lo = 0;
    let hi = 1;
    const pv = (i) => (payment * (1 - Math.pow(1 + i, -n))) / i;
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if (pv(mid) > received) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function sum(arr, fn) {
    let t = 0;
    for (const x of arr) t += fn ? fn(x) : x;
    return t;
  }

  /* ---------- Normalización de entradas ---------- */

  function normalizeDebt(d, idx) {
    const balance = Math.max(0, parseNumber(d.balance));
    const payment = Math.max(0, parseNumber(d.payment));
    const kind = d.kind === 'rotativo' ? 'rotativo' : 'cuota';
    return {
      id: String(d.id != null ? d.id : 'd' + idx),
      name: (d.name && String(d.name).trim()) || 'Deuda ' + (idx + 1),
      balance,
      i: monthlyRate(d.rate, d.rateType),
      payment,
      kind,
      // En rotativos (tarjetas, cupos) el mínimo baja cuando baja el saldo.
      minPct: balance > 0 ? payment / balance : 0,
      fee: Math.max(0, parseNumber(d.monthlyFee)),
      payroll: Boolean(d.payroll),
      isNew: false,
    };
  }

  function normalizeOffer(o, idx) {
    return {
      id: String(o.id != null ? o.id : 'o' + idx),
      name: (o.name && String(o.name).trim()) || 'Crédito ' + (idx + 1),
      maxAmount: Math.max(0, parseNumber(o.maxAmount)),
      i: monthlyRate(o.rate, o.rateType),
      term: Math.max(1, Math.round(parseNumber(o.termMonths))),
      feePct: Math.min(50, Math.max(0, parseNumber(o.feePct))) / 100,
      insurance: Math.max(0, parseNumber(o.monthlyInsurance)),
    };
  }

  // Veces que se recibe un ingreso en un mes.
  const FREQUENCY = { mensual: 1, quincenal: 2, semanal: 52 / 12 };

  function monthlyAmount(x) {
    return Math.max(0, parseNumber(x.amount)) * (FREQUENCY[x.frequency] || 1);
  }

  function normalizeInput(input) {
    const expense = sum((input.expenses || []).map(monthlyAmount));
    const buffer = Math.max(0, parseNumber(input.buffer));
    const debts = (input.debts || []).map(normalizeDebt).filter((d) => d.balance > EPS);
    // Las libranzas ya vienen descontadas del neto de la colilla: se devuelven
    // al ingreso para que el plan las trate como cualquier otra cuota.
    const payrollAddBack = sum(debts.filter((d) => d.payroll), (d) => d.payment + d.fee);
    const netIncome = sum((input.incomes || []).map(monthlyAmount));
    const income = netIncome + payrollAddBack;
    const offers = (input.offers || [])
      .map(normalizeOffer)
      .filter((o) => o.maxAmount > 0 && o.term > 0);
    const priority = PRIORITY_WEIGHTS[input.priority] ? input.priority : 'balanceado';
    return { income, netIncome, payrollAddBack, expense, buffer, debts, offers, priority };
  }

  /* ---------- Simulación ---------- */

  function minimumDue(d) {
    // d.bal ya incluye el interés del mes.
    if (d.kind === 'rotativo') {
      const base = d.bal - d._int;
      return Math.min(d.bal, Math.max(base * d.minPct, d._int));
    }
    return Math.min(d.bal, d.payment);
  }

  function orderFor(strategy) {
    switch (strategy) {
      case 'avalancha':
        return (a, b) => b.i - a.i || a.bal - b.bal;
      case 'bola':
        return (a, b) => a.bal - b.bal || b.i - a.i;
      case 'flujo':
        // Índice de flujo de caja: saldo / cuota. Menor = libera más cuota por peso.
        return (a, b) => cfi(a) - cfi(b) || b.i - a.i;
      default:
        return null;
    }
  }

  function cfi(d) {
    const due = d.kind === 'rotativo' ? d.bal * d.minPct : d.payment;
    const total = due + d.fee;
    return total > 0 ? d.bal / total : Infinity;
  }

  /**
   * Simula el pago de `debts` con `budget` mensual para deudas.
   * `freeBase` es ingresos - gastos (sin descontar colchón): con él se mide el
   * flujo libre = freeBase - pagos obligatorios del mes.
   */
  function simulate(debts, { budget, freeBase, strategy, maxMonths = MAX_MONTHS }) {
    const state = debts.map((d) => ({
      ...d,
      bal: d.balance,
      paidOffMonth: null,
      interest: 0,
      fees: 0,
      paid: 0,
    }));
    const order = orderFor(strategy);
    const rows = [];
    let deficitMonths = 0;
    let maxDeficit = 0;

    for (let m = 1; m <= maxMonths; m++) {
      const active = state.filter((d) => d.bal > EPS);
      if (!active.length) break;

      let required = 0;
      for (const d of active) {
        d._int = d.bal * d.i;
        d.bal += d._int;
        d.interest += d._int;
        d._min = minimumDue(d);
        d.fees += d.fee;
        d.paid += d.fee;
        required += d._min + d.fee;
      }

      const payments = {};
      const pay = (d, amount) => {
        if (amount <= 0) return;
        d.bal -= amount;
        d.paid += amount;
        payments[d.id] = (payments[d.id] || 0) + amount;
      };
      for (const d of active) {
        pay(d, d._min);
        payments[d.id] = (payments[d.id] || 0) + d.fee;
      }

      let deficit = 0;
      if (required > budget + EPS) {
        deficit = required - budget;
        deficitMonths++;
        maxDeficit = Math.max(maxDeficit, deficit);
      }

      let extra = order ? Math.max(0, budget - required) : 0;
      const extraStart = extra;
      if (extra > 0) {
        const targets = active.filter((d) => d.bal > EPS).sort(order);
        for (const d of targets) {
          if (extra <= EPS) break;
          const p = Math.min(extra, d.bal);
          pay(d, p);
          extra -= p;
        }
      }

      const closed = [];
      for (const d of active) {
        if (d.bal <= EPS) {
          d.bal = 0;
          d.paidOffMonth = m;
          closed.push(d.id);
        }
      }

      const balances = {};
      for (const d of state) balances[d.id] = d.bal;
      rows.push({
        month: m,
        payments,
        balances,
        totalBalance: sum(state, (d) => d.bal),
        required,
        extra: extraStart - extra,
        free: freeBase - required,
        deficit,
        closed,
      });
    }

    const remaining = sum(state, (d) => d.bal);
    const months = remaining > EPS ? null : rows.length;
    const totalPaid = sum(state, (d) => d.paid) + remaining;
    const totalInterest = sum(state, (d) => d.interest);
    const totalFees = sum(state, (d) => d.fees);
    return {
      rows,
      months,
      totalPaid,
      totalInterest,
      totalFees,
      deficitMonths,
      maxDeficit,
      remaining,
      debts: state.map((d) => ({
        id: d.id,
        name: d.name,
        isNew: d.isNew,
        balance: d.balance,
        i: d.i,
        payment: d.payment,
        kind: d.kind,
        fee: d.fee,
        paidOffMonth: d.paidOffMonth,
        interest: d.interest,
        fees: d.fees,
      })),
    };
  }

  /* ---------- Consolidación ---------- */

  function buildConsolidation(debts, offer, ids) {
    const chosen = debts.filter((d) => ids.has(d.id));
    if (!chosen.length) return null;
    const needed = sum(chosen, (d) => d.balance);
    // La comisión se descuenta del desembolso: hay que pedir un poco más.
    const principal = needed / (1 - offer.feePct);
    if (principal > offer.maxAmount + EPS) return null;
    const payment = annuityPayment(principal, offer.i, offer.term);
    const loan = {
      id: 'nuevo:' + offer.id,
      name: offer.name,
      balance: principal,
      i: offer.i,
      payment,
      kind: 'cuota',
      minPct: 0,
      fee: offer.insurance,
      isNew: true,
    };
    const effI = irrMonthly(needed, payment + offer.insurance, offer.term);
    return {
      debts: debts.filter((d) => !ids.has(d.id)).concat(loan),
      loan: {
        offerId: offer.id,
        name: offer.name,
        principal,
        needed,
        payment,
        insurance: offer.insurance,
        term: offer.term,
        rateEA: toEA(offer.i),
        effectiveEA: toEA(effI),
        replaces: chosen.map((d) => d.id),
        replacedPayments: sum(chosen, (d) => d.payment + d.fee),
      },
    };
  }

  function candidateSubsets(debts, offer) {
    const byRate = [...debts].sort((a, b) => b.i - a.i);
    const byPaymentWeight = [...debts].sort(
      (a, b) => (b.payment + b.fee) / b.balance - (a.payment + a.fee) / a.balance
    );
    const byBalance = [...debts].sort((a, b) => a.balance - b.balance);
    const seen = new Map();
    const add = (list) => {
      if (!list.length) return;
      const key = list.map((d) => d.id).sort().join('|');
      if (seen.has(key)) return;
      const needed = sum(list, (d) => d.balance) / (1 - offer.feePct);
      if (needed > offer.maxAmount + EPS) return;
      seen.set(key, new Set(list.map((d) => d.id)));
    };
    for (const ordering of [byRate, byPaymentWeight, byBalance]) {
      for (let k = 1; k <= ordering.length; k++) add(ordering.slice(0, k));
    }
    for (const d of debts) add([d]);
    // Solo las deudas más caras que el crédito.
    add(debts.filter((d) => d.i > offer.i));
    return [...seen.values()];
  }

  /* ---------- Planificación ---------- */

  function metrics(sim, ctx) {
    const firstYear = [];
    for (let m = 1; m <= 12; m++) {
      const row = sim.rows[m - 1];
      firstYear.push(row ? row.free : ctx.freeBase);
    }
    return {
      months: sim.months,
      totalCost: sim.totalPaid - ctx.originalBalance,
      totalInterest: sim.totalInterest,
      totalFees: sim.totalFees,
      free1: firstYear[0],
      avgFree12: sum(firstYear) / 12,
      feasible: sim.deficitMonths === 0 && sim.months != null,
      deficitMonths: sim.deficitMonths,
      maxDeficit: sim.maxDeficit,
    };
  }

  function scoreScenarios(list, priority) {
    const w = PRIORITY_WEIGHTS[priority];
    const pool = list.filter((s) => s.metrics.feasible && s.strategy !== 'minimos');
    const range = (fn) => {
      const vals = pool.map(fn);
      return [Math.min(...vals), Math.max(...vals)];
    };
    const norm = (v, [lo, hi]) => (hi - lo > 1e-9 ? (v - lo) / (hi - lo) : 0);
    const rc = range((s) => s.metrics.totalCost);
    const rf = range((s) => s.metrics.avgFree12);
    const rt = range((s) => s.metrics.months);
    for (const s of list) {
      if (!pool.includes(s)) {
        s.score = Infinity;
        continue;
      }
      s.score =
        w.cost * norm(s.metrics.totalCost, rc) +
        w.flow * (1 - norm(s.metrics.avgFree12, rf)) +
        w.time * norm(s.metrics.months, rt);
    }
    // Sin escenarios viables: ordenar por menor déficit y luego por costo.
    return [...list].sort(
      (a, b) =>
        a.score - b.score ||
        a.metrics.maxDeficit - b.metrics.maxDeficit ||
        (a.metrics.months || Infinity) - (b.metrics.months || Infinity) ||
        a.metrics.totalCost - b.metrics.totalCost
    );
  }

  // Mayor plazo/tasa necesarios para cubrir un déficit consolidando todo.
  function suggestConsolidation(debts, deficit, referenceRateEA) {
    const i = monthlyRate(referenceRateEA, 'EA');
    const total = sum(debts, (d) => d.balance);
    const currentPayments = sum(debts, (d) => d.payment + d.fee);
    const target = currentPayments - deficit;
    if (!(target > 0)) return null;
    for (let n = 6; n <= 120; n += 6) {
      const p = annuityPayment(total, i, n);
      if (p <= target) return { amount: total, term: n, payment: p, rateEA: referenceRateEA };
    }
    return null;
  }

  function plan(input, opts = {}) {
    const n = normalizeInput(input);
    const freeBase = n.income - n.expense;
    const budget = freeBase - n.buffer;
    const originalBalance = sum(n.debts, (d) => d.balance);
    const ctx = { freeBase, budget, originalBalance };
    const warnings = [];

    const summary = {
      income: n.income,
      netIncome: n.netIncome,
      payrollAddBack: n.payrollAddBack,
      expense: n.expense,
      buffer: n.buffer,
      budget,
      totalDebt: originalBalance,
      requiredNow: sum(n.debts, (d) => d.payment + d.fee),
      weightedEA: originalBalance
        ? toEA(sum(n.debts, (d) => d.i * d.balance) / originalBalance)
        : 0,
    };
    summary.freeNow = freeBase - summary.requiredNow;
    summary.extraNow = budget - summary.requiredNow;

    if (!n.debts.length) {
      return { summary, scenarios: [], best: null, baseline: null, warnings, suggestion: null, priority: n.priority };
    }

    for (const d of n.debts) {
      const firstInterest = d.balance * d.i;
      if (d.kind === 'cuota' && d.payment <= firstInterest + EPS) {
        warnings.push({
          level: 'critico',
          text: `La cuota de "${d.name}" no alcanza a cubrir los intereses del mes. Sin abonos extra esa deuda crece.`,
        });
      }
      if (d.payment <= 0) {
        warnings.push({ level: 'aviso', text: `"${d.name}" no tiene cuota mensual registrada.` });
      }
    }
    if (budget <= 0) {
      warnings.push({
        level: 'critico',
        text: 'Tus gastos y el colchón de ahorro consumen todo el ingreso. No queda dinero para pagar deudas.',
      });
    } else if (summary.extraNow < 0) {
      warnings.push({
        level: 'critico',
        text: 'Tus ingresos no alcanzan para las cuotas actuales. Para evitar mora necesitas bajar gastos, subir ingresos o refinanciar a un plazo más largo.',
      });
    }

    const scenarios = [];
    const addScenario = (debts, strategy, loan) => {
      const sim = simulate(debts, { budget, freeBase, strategy, maxMonths: opts.maxMonths });
      scenarios.push({
        id: (loan ? loan.offerId + '[' + loan.replaces.join(',') + ']' : 'sin-credito') + ':' + strategy,
        strategy,
        loan: loan || null,
        sim,
        metrics: metrics(sim, ctx),
      });
    };

    for (const s of ['avalancha', 'bola', 'flujo']) addScenario(n.debts, s, null);
    addScenario(n.debts, 'minimos', null);

    for (const offer of n.offers) {
      for (const ids of candidateSubsets(n.debts, offer)) {
        const c = buildConsolidation(n.debts, offer, ids);
        if (!c) continue;
        for (const s of ['avalancha', 'bola', 'flujo']) addScenario(c.debts, s, c.loan);
      }
    }

    const ranked = scoreScenarios(scenarios, n.priority);
    const best = ranked[0];
    const baseline = scenarios.find((s) => s.id === 'sin-credito:minimos');

    let suggestion = null;
    const noLoanFeasible = scenarios.some((s) => !s.loan && s.metrics.feasible);
    if (!noLoanFeasible && summary.extraNow < 0 && budget > 0) {
      suggestion = suggestConsolidation(n.debts, -summary.extraNow, opts.referenceRateEA || 24);
    }

    return { summary, scenarios: ranked, best, baseline, warnings, suggestion, priority: n.priority };
  }

  /* ---------- Hoja de ruta en palabras ---------- */

  function roadmap(scenario) {
    const steps = [];
    const { sim, loan, strategy } = scenario;
    if (loan) {
      steps.push({
        month: 0,
        kind: 'credito',
        loan,
      });
    }
    const byMonth = new Map();
    for (const d of sim.debts) {
      if (d.paidOffMonth != null) {
        if (!byMonth.has(d.paidOffMonth)) byMonth.set(d.paidOffMonth, []);
        byMonth.get(d.paidOffMonth).push(d);
      }
    }
    // Primer objetivo de abono extra.
    const first = sim.rows.find((r) => r.extra > EPS);
    let firstTarget = null;
    if (first && strategy !== 'minimos') {
      const order = orderFor(strategy);
      const alive = sim.debts
        .map((d) => ({ ...d, bal: d.balance, minPct: d.balance ? d.payment / d.balance : 0 }))
        .sort(order);
      firstTarget = alive[0] || null;
    }
    if (firstTarget) steps.push({ month: 1, kind: 'objetivo', debt: firstTarget });
    for (const [month, list] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])) {
      steps.push({
        month,
        kind: 'cierre',
        debts: list,
        freed: sum(list, (d) => d.payment + d.fee),
      });
    }
    return steps;
  }

  return {
    EPS,
    MAX_MONTHS,
    STRATEGIES,
    PRIORITY_WEIGHTS,
    FREQUENCY,
    parseNumber,
    monthlyRate,
    toEA,
    annuityPayment,
    irrMonthly,
    normalizeInput,
    simulate,
    buildConsolidation,
    candidateSubsets,
    plan,
    roadmap,
  };
});
