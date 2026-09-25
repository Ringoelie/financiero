const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/engine.js');

const close = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`);

test('parseNumber entiende formatos colombianos y anglosajones', () => {
  assert.equal(P.parseNumber('1.500.000'), 1500000);
  assert.equal(P.parseNumber('1,500,000'), 1500000);
  assert.equal(P.parseNumber('$ 2.000.000,50'), 2000000.5);
  assert.equal(P.parseNumber('2,000,000.50'), 2000000.5);
  assert.equal(P.parseNumber('28,5'), 28.5);
  assert.equal(P.parseNumber('28.5'), 28.5);
  assert.equal(P.parseNumber('1.500'), 1500);
  assert.equal(P.parseNumber(''), 0);
  assert.equal(P.parseNumber('abc'), 0);
  assert.equal(P.parseNumber(1234), 1234);
});

test('monthlyRate convierte EA, MV y NA', () => {
  close(P.monthlyRate(12.682503, 'EA'), 0.01, 1e-6);
  assert.equal(P.monthlyRate(2, 'MV'), 0.02);
  assert.equal(P.monthlyRate(24, 'NA'), 0.02);
  assert.equal(P.monthlyRate(0, 'EA'), 0);
});

test('annuityPayment y irrMonthly son inversas', () => {
  const p = P.annuityPayment(10_000_000, 0.02, 36);
  close(p, 392328.6, 1);
  close(P.irrMonthly(10_000_000, p, 36), 0.02, 1e-7);
  assert.equal(P.annuityPayment(1200, 0, 12), 100);
});

test('simulate: un crédito de cuota fija se paga en su plazo', () => {
  const i = 0.015;
  const pay = P.annuityPayment(5_000_000, i, 24);
  const debts = [{ id: 'a', name: 'A', balance: 5_000_000, i, payment: pay, kind: 'cuota', minPct: 0, fee: 0 }];
  const sim = P.simulate(debts, { budget: pay, freeBase: pay, strategy: 'avalancha' });
  assert.equal(sim.months, 24);
  close(sim.totalPaid, pay * 24, 2);
});

test('simulate: el abono extra acorta el plazo y reduce intereses', () => {
  const i = 0.015;
  const pay = P.annuityPayment(5_000_000, i, 24);
  const debts = [{ id: 'a', name: 'A', balance: 5_000_000, i, payment: pay, kind: 'cuota', minPct: 0, fee: 0 }];
  const base = P.simulate(debts, { budget: pay, freeBase: pay, strategy: 'avalancha' });
  const fast = P.simulate(debts, { budget: pay + 200_000, freeBase: pay + 200_000, strategy: 'avalancha' });
  assert.ok(fast.months < base.months);
  assert.ok(fast.totalInterest < base.totalInterest);
});

const sample = {
  incomes: [{ amount: '4.500.000' }],
  expenses: [{ amount: '2.300.000' }],
  buffer: '100.000',
  debts: [
    { id: 't1', name: 'Tarjeta', balance: '6.000.000', rate: '28', rateType: 'EA', payment: '420.000', kind: 'rotativo' },
    { id: 'l1', name: 'Libre inversión', balance: '12.000.000', rate: '19', rateType: 'EA', payment: '520.000', kind: 'cuota' },
    { id: 'c1', name: 'Celular', balance: '1.200.000', rate: '2,2', rateType: 'MV', payment: '180.000', kind: 'cuota' },
  ],
  offers: [],
  priority: 'intereses',
};

test('avalancha nunca paga más intereses que bola de nieve', () => {
  const r = P.plan(sample);
  const get = (s) => r.scenarios.find((x) => x.id === 'sin-credito:' + s);
  assert.ok(get('avalancha').metrics.totalCost <= get('bola').metrics.totalCost + 1);
  assert.ok(get('avalancha').metrics.months <= get('minimos').metrics.months);
  assert.ok(r.best.metrics.feasible);
  assert.notEqual(r.best.strategy, 'minimos');
});

test('los saldos cuadran: pagado = saldo inicial + costo', () => {
  const r = P.plan(sample);
  for (const s of r.scenarios.filter((x) => x.metrics.feasible)) {
    close(s.sim.totalPaid, r.summary.totalDebt + s.metrics.totalCost, 1);
  }
});

test('un crédito barato para consolidar la tarjeta se recomienda al priorizar intereses', () => {
  const r = P.plan({
    ...sample,
    offers: [{ id: 'o1', name: 'Compra de cartera', maxAmount: '8.000.000', rate: '15', rateType: 'EA', termMonths: 36, feePct: 0, monthlyInsurance: 0 }],
  });
  assert.ok(r.best.loan, 'debería usar el crédito');
  assert.ok(r.best.loan.replaces.includes('t1'));
  const noLoan = r.scenarios.find((x) => x.id === 'sin-credito:avalancha');
  assert.ok(r.best.metrics.totalCost < noLoan.metrics.totalCost);
});

test('un crédito caro no se recomienda al priorizar intereses', () => {
  const r = P.plan({
    ...sample,
    offers: [{ id: 'o1', name: 'Caro', maxAmount: '30.000.000', rate: '40', rateType: 'EA', termMonths: 60, feePct: 4, monthlyInsurance: 30000 }],
  });
  assert.equal(r.best.loan, null);
});

test('con déficit, un crédito a largo plazo vuelve viable el plan', () => {
  const tight = {
    incomes: [{ amount: 3_000_000 }],
    expenses: [{ amount: 2_000_000 }],
    debts: [
      { id: 'a', name: 'A', balance: 8_000_000, rate: 30, rateType: 'EA', payment: 700_000, kind: 'cuota' },
      { id: 'b', name: 'B', balance: 4_000_000, rate: 26, rateType: 'EA', payment: 500_000, kind: 'cuota' },
    ],
    offers: [],
    priority: 'balanceado',
  };
  const without = P.plan(tight);
  assert.equal(without.best.metrics.feasible, false);
  assert.ok(without.suggestion, 'debe sugerir un crédito');
  assert.ok(without.suggestion.payment <= 1_000_000);
  assert.ok(without.warnings.some((w) => w.level === 'critico'));

  const withOffer = P.plan({
    ...tight,
    offers: [{ id: 'x', name: 'Consolidación', maxAmount: 14_000_000, rate: 22, rateType: 'EA', termMonths: 60 }],
  });
  assert.ok(withOffer.best.metrics.feasible);
  assert.ok(withOffer.best.loan);
});

test('la comisión se financia y encarece el costo efectivo', () => {
  const debts = P.normalizeInput(sample).debts;
  const offer = { id: 'o', name: 'X', maxAmount: 1e9, i: P.monthlyRate(15, 'EA'), term: 36, feePct: 0.03, insurance: 0 };
  const c = P.buildConsolidation(debts, offer, new Set(['t1']));
  close(c.loan.principal * 0.97, 6_000_000, 1);
  assert.ok(c.loan.effectiveEA > 0.15);
});

test('prioridad flujo prefiere mayor flujo libre el primer año', () => {
  const offers = [{ id: 'o1', name: 'Largo plazo', maxAmount: '20.000.000', rate: '24', rateType: 'EA', termMonths: 72 }];
  const flow = P.plan({ ...sample, offers, priority: 'flujo' });
  const cost = P.plan({ ...sample, offers, priority: 'intereses' });
  assert.ok(flow.best.metrics.avgFree12 >= cost.best.metrics.avgFree12);
  assert.ok(cost.best.metrics.totalCost <= flow.best.metrics.totalCost);
});

test('roadmap lista los cierres en orden', () => {
  const r = P.plan(sample);
  const steps = P.roadmap(r.best);
  const months = steps.filter((s) => s.kind === 'cierre').map((s) => s.month);
  assert.deepEqual(months, [...months].sort((a, b) => a - b));
  assert.equal(steps.filter((s) => s.kind === 'cierre').reduce((n, s) => n + s.debts.length, 0), 3);
});

test('sin deudas no hay escenarios', () => {
  const r = P.plan({ incomes: [{ amount: 100 }], debts: [] });
  assert.equal(r.best, null);
});
