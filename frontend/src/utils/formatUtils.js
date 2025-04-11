/**
 * Formats adjustment data into a user-readable string.
 * Handles both chemical adjustment arrays and shock treatment objects.
 * @param {Array|Object|null} adjustment - The adjustment data.
 *        Expected Array: [amount, unit, direction, productName]
 *        Expected Object: { amount, unit, product }
 * @returns {string} Formatted recommendation string or "No adjustment needed".
 */
export const formatAdjustment = (adjustment) => {
  // Handle Shock Object: { amount, unit, product }
  if (typeof adjustment === 'object' && adjustment !== null && 'amount' in adjustment && 'unit' in adjustment && 'product' in adjustment) {
    const amount = Number(adjustment.amount);
    if (isNaN(amount) || amount <= 0) return "No shock treatment needed"; // Or maybe hide section entirely
    // Round to 1 decimal unless it's a whole number then show 0
    const formattedAmount = amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(1);
    return `Add ${formattedAmount} ${adjustment.unit} of ${adjustment.product}`;
  }

  // Handle Chemical Adjustment Array: [amount, unit, direction, productName]
  if (Array.isArray(adjustment) && adjustment.length === 4) {
    const [amountValue, unit, direction, productName] = adjustment;
    const amount = Number(amountValue);

    if (isNaN(amount) || amount <= 0 || !direction || !unit || !productName) {
      return "No adjustment needed";
    }

    const action = direction === 'up' ? 'Add' : 'Reduce with'; // Or "Lower using" etc.
    // Round to 1 decimal unless it's a whole number then show 0
    const formattedAmount = amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(1);
    return `${action} ${formattedAmount} ${unit} of ${productName}`;
  }

  console.warn('Unexpected adjustment format received in formatAdjustment:', adjustment);
  return "Adjustment data unavailable";
};

/**
 * Determines the CSS class for a table row based on adjustment data.
 * @param {Array|Object|null} adjustment - The adjustment data.
 * @returns {string} CSS class name ('needs-adjustment' or 'no-change').
 */
export const getRecommendationClass = (adjustment) => {
   // Handle Shock Object
   if (typeof adjustment === 'object' && adjustment !== null && 'amount' in adjustment) {
    const amount = Number(adjustment.amount);
    return isNaN(amount) || amount <= 0 ? 'no-change' : 'needs-adjustment';
  }

  // Handle Chemical Adjustment Array
  if (Array.isArray(adjustment) && adjustment.length === 4) {
    const [amountValue] = adjustment;
    const amount = Number(amountValue);
    return isNaN(amount) || amount <= 0 ? 'no-change' : 'needs-adjustment';
  }

  // Default for unexpected formats or no adjustment needed implicitly
  return 'no-change';
}; 