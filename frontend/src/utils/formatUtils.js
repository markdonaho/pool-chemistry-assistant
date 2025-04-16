/**
 * Formats adjustment data into a user-readable string.
 * Handles both chemical adjustment arrays and shock treatment objects.
 * @param {Array|Object|null} adjustment - The adjustment data.
 *        Expected Array: [amount, unit, direction, productName]
 *        Expected Object: { amount, unit, product }
 * @returns {string} Formatted recommendation string or "No adjustment needed".
 */
export const formatAdjustment = (field, adjustment, system) => {
  if (!adjustment || adjustment[0] === 0) {
    return { recommendation: "No adjustment needed.", instructions: null };
  }

  const [amount, unit, direction, productName] = adjustment;
  // Special case for pH down - we want to say "Add" even though direction is "down"
  const action = (field === "pH" && direction === "down") ? "Add" : 
                (direction === "up" ? "Add" : "Remove/Lower");
  let recommendation = "";
  let instructions = null;

  // Specific formatting for HTH 3" Tabs (Action-based)
  if (productName === "HTH 3\" Chlorine Tabs") {
    recommendation = `Check Feeder/Skimmer for ${productName}.`; 
    instructions = "Low Free Chlorine detected. Ensure tabs are present in the skimmer basket, feeder, or floater. Add tabs if empty or low. Run pump at least 8 hours daily.";
  }
  // Standard formatting for other chemicals (Quantity-based)
  else {
    const roundedAmount = Math.round(amount * 100) / 100; // Keep precision
    recommendation = `${action} ${roundedAmount} ${unit || ''} of ${productName || field}`;

    // Add product-specific instructions
    if (productName === "SpaGuard pH Increaser") {
      instructions = "Sprinkle into spa water with pump running on high speed. Run pump for 30 mins.";
    } else if (productName === "SpaGuard pH Decreaser") {
      instructions = "Ensure TA is >= 125 ppm. Sprinkle into water (aerator off) with pump running. Run pump for 30 mins.";
    } else if (productName === "SpaGuard Total Alkalinity Increaser") {
      instructions = "Sprinkle directly into spa water. Run pump for 30 minutes.";
    } else if (productName === "Pool Mate Premium Calcium Hardness Increaser") {
      instructions = "Dissolve required amount in a bucket of pool water first (max 2 lbs per 5 gal). Slowly pour solution around pool perimeter with pump running. Do not add more than 10 lbs per 10,000 gal per 2 hours.";
    }
  }

  // Add specific usage instructions based on product name
  if (productName === "SpaGuard Chlorinating Concentrate") {
    instructions = "Repeat dose every 15-20 mins until 2-3 ppm residual is achieved.";
  } else if (productName === "SpaGuard Total Alkalinity Increaser") {
    instructions = "Pour directly into spa water with pump running on high speed. Run pump for 30 mins.";
  } else if (productName === "SpaGuard Calcium Hardness Increaser") {
    instructions = "With pump running at high speed, scatter the required amount of product over the spa water and continue running pump for 30 minutes.";
  } else if (productName === "HTH Super Shock! Treatment") { // Will be used for actual shock calc
    instructions = "With pump running, broadcast the required amount evenly over a wide area in the deepest part of the pool. Brush any undissolved granules. Keep pump running for several hours.";
  } else if (productName === "HTH Shock Advanced") {
    instructions = "With pump running during evening hours, broadcast the product evenly over a wide area in the deepest part of the pool. Brush any settled granules to disperse. Keep pump running.";
  } else if (productName === "Clorox Pool & Spa pH Down") {
    instructions = "While walking around edge of pool, broadcast product evenly across the deepest area while pool is not in use and pump is running. Allow to circulate for 2 hours then retest pH. Brush any undissolved clumps off surface.";
  } else if (productName === "Clorox Pool & Spa Chlorine Stabilizer") {
    instructions = "Before adding, backwash or clean filter. Remove items from skimmer. Add product VERY SLOWLY into skimmer with filter and pump operating. Do not backwash filter for at least 48 hours. If using deep-end application, broadcast evenly and brush undissolved product. Do not allow product to sit on bottom.";
  }
  // Note: The HTH 3" Tabs instructions are handled in the specific block above

  // Append instructions if they exist
  if (instructions) {
    return { recommendation, instructions };
  } else {
    return { recommendation, instructions: null };
  }
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