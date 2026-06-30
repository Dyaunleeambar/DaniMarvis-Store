export function formatCurrency(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '$0.00';
  const num = Number(amount);
  return 'USD ' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
