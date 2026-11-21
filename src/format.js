// Prikaz iznosa u RSD: tačka za hiljade, bez decimala, .5 se zaokružuje od nule.
export function formatRSD(n) {
  const r = Math.round(Math.abs(Number(n) || 0));
  const digits = String(r).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 && r !== 0 ? '\u2212' : '') + digits;
}
