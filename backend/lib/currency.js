export function formatCurrency(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '$0.00 USD';
  const num = Number(amount);
  return '$' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' USD';
}
