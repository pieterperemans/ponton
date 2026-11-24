/**
 * Generates a realistic, fully fictional KBC export (Dutch headers, semicolons, decimal commas)
 * so the demo exercises exactly the same parser as a real statement.
 */
const HEADER = 'Rekeningnummer;Rubrieknaam;Naam;Munt;Afschriftnummer;Datum;Omschrijving;Valuta;Bedrag;Saldo;credit;debet;rekeningnummer tegenpartij;BIC tegenpartij;Naam tegenpartij;Adres tegenpartij;gestructureerde mededeling;Vrije mededeling';
const OWN = 'BE68539007547034';
const SAVINGS = 'BE71096123456769';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const fmtNum = (n: number) => n.toFixed(2).replace('.', ',');
const ddmmyyyy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

interface Tx { date: Date; amount: number; desc: string; cpName?: string; cpAccount?: string; msg?: string }

export function sampleKbcCsv(today = new Date()): string {
  const r = rng(42);
  const txs: Tx[] = [];
  const start = new Date(today.getFullYear(), today.getMonth() - 6, 1);
  const card = (d: Date, merchant: string, amount: number) =>
    txs.push({ date: d, amount: -amount, desc: `BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 1234 ${merchant} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} OM ${10 + Math.floor(r() * 9)}.${String(Math.floor(r() * 60)).padStart(2, '0')} UUR BANCONTACT` });
  const dom = (d: Date, creditor: string, amount: number) =>
    txs.push({ date: d, amount: -amount, desc: `EUROPESE DOMICILIERING SCHULDEISER : ${creditor} REF. : ${Math.floor(r() * 1e9)}`, cpName: creditor });

  for (let m = 0; m <= 6; m++) {
    const y = start.getFullYear(), mo = start.getMonth() + m;
    const day = (d: number) => new Date(y, mo, d);
    const last = m === 6; // current, partial month
    const upTo = last ? today.getDate() : 31;
    const on = (d: number, fn: () => void) => { if (d <= upTo && day(d).getMonth() === ((mo % 12) + 12) % 12) fn(); };

    on(1, () => txs.push({ date: day(1), amount: -1150, desc: 'EUROPESE OVERSCHRIJVING NAAR WOONKREDIET', cpName: 'KBC WOONKREDIET', msg: 'Maandelijkse aflossing woonkrediet' }));
    on(25, () => txs.push({ date: day(25), amount: 3420 + Math.round(r() * 40), desc: 'EUROPESE OVERSCHRIJVING VAN LOON', cpName: 'ACME LOGISTICS NV', cpAccount: 'BE10363012345604', msg: 'LOON' }));
    on(8, () => txs.push({ date: day(8), amount: 196.55, desc: 'EUROPESE OVERSCHRIJVING VAN GROEIPAKKET', cpName: 'FONS', msg: 'GROEIPAKKET' }));
    on(26, () => txs.push({ date: day(26), amount: -400, desc: 'OVERSCHRIJVING NAAR EIGEN REKENING', cpName: 'SPAARREKENING', cpAccount: SAVINGS }));
    on(3, () => dom(day(3), 'PROXIMUS', 89.99));
    on(5, () => dom(day(5), 'ENGIE', 142 + Math.round(r() * 20)));
    on(12, () => dom(day(12), 'NETFLIX.COM', 13.99));
    on(14, () => dom(day(14), 'SPOTIFY', last ? 12.99 : 10.99));
    on(15, () => dom(day(15), 'AG INSURANCE', 64.2));
    on(18, () => dom(day(18), 'DE WATERGROEP', 38.5));
    on(20, () => dom(day(20), 'BASIC-FIT', 29.99));

    for (let d = 2; d <= 28; d += 3 + Math.floor(r() * 3)) {
      on(d, () => card(day(d), ['COLRUYT HALLE', 'DELHAIZE GENT', 'ALDI BRUGGE', 'LIDL AALST'][Math.floor(r() * 4)], 35 + r() * 75));
    }
    for (let d = 4; d <= 28; d += 6 + Math.floor(r() * 5)) {
      const extra = m >= 5 ? 1.6 : 1; // eating out creeping up recently
      on(d, () => card(day(d), ['DELIVEROO', 'BRASSERIE DE KAAI', 'PIZZERIA NAPOLI', 'T SMOSKE'][Math.floor(r() * 4)], (25 + r() * 45) * extra));
    }
    for (let d = 6; d <= 27; d += 10) on(d, () => card(day(d), 'SHELL EXPRESS', 55 + r() * 20));
    on(9, () => card(day(9), 'DE LIJN', 18));
    on(16, () => card(day(16), 'APOTHEEK DE ROOS', 12 + r() * 25));
    on(21, () => card(day(21), ['BOL.COM', 'HEMA', 'ZALANDO', 'ACTION'][Math.floor(r() * 4)], 20 + r() * 60));
    on(23, () => card(day(23), 'HOUTHANDEL VERMEULEN', 30 + r() * 30));
    on(11, () => card(day(11), 'LA FERME DU CHATEAU', 22 + r() * 10));
    on(27, () => txs.push({ date: day(27), amount: -(20 + Math.round(r() * 30)), desc: 'OVERSCHRIJVING VIA KBC MOBILE', cpName: 'JANSSENS EVA', cpAccount: 'BE43068999999501', msg: 'etentje' }));
    if (m === 6) on(10, () => card(day(10), 'COOLBLUE', 899));
    if (m === 2) on(19, () => card(day(19), 'RYANAIR', 236.4));
  }

  txs.sort((a, b) => a.date.getTime() - b.date.getTime());
  let balance = 4200;
  const lines = txs.map((t, i) => {
    balance += t.amount;
    const d = ddmmyyyy(t.date);
    return [
      OWN, 'Zichtrekening', 'J. PEETERS', 'EUR', `${t.date.getFullYear()}${String(Math.floor(i / 20) + 1).padStart(3, '0')}`, d,
      t.desc, d, fmtNum(t.amount), fmtNum(balance),
      t.amount > 0 ? fmtNum(t.amount) : '', t.amount < 0 ? fmtNum(-t.amount) : '',
      t.cpAccount ?? '', '', t.cpName ?? '', '', '', t.msg ?? '',
    ].join(';');
  });
  return [HEADER, ...lines].join('\r\n');
}
