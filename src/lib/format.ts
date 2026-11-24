const eur = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export const money = (n: number) => eur.format(n);
export const money0 = (n: number) => eur0.format(Math.round(n));
export const pct = (n: number) => `${Math.round(n * 100)}%`;

export const monthKey = (iso: string) => iso.slice(0, 7);

export function monthLabel(ym: string, style: 'long' | 'short' = 'long') {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: style, year: style === 'long' ? 'numeric' : '2-digit' });
}

export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysInMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** "COLRUYT HALLE" → "Colruyt Halle"; leaves mixed-case names alone. */
export function nice(name: string) {
  if (!name || name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s.&'-])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());
}

/** Turns KBC's long technical descriptions into a short human label. */
export function txKind(description: string): string | undefined {
  const d = description.toUpperCase();
  if (/DEBETKAART|KREDIETKAART|CARTE DE DEBIT|CARTE DE CREDIT|DEBIT CARD/.test(d)) {
    if (/GELDOPNEMING|GELDOPNAME|RETRAIT/.test(d)) return 'Cash withdrawal';
    const time = d.match(/\b(\d{1,2})[.:](\d{2}) UUR\b/);
    return `Card payment${time ? ` · ${time[1]}:${time[2]}` : ''}`;
  }
  if (/DOMICILIERING|DOMICILIATION|DIRECT DEBIT/.test(d)) return 'Direct debit';
  if (/INSTANT/.test(d)) return 'Instant transfer';
  if (/OVERSCHRIJVING|VIREMENT|TRANSFER/.test(d)) return 'Transfer';
  return undefined;
}
