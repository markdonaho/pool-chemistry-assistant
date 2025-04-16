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
  }

  // Add specific usage instructions based on product name
  if (productName === "SpaGuard Chlorinating Concentrate") {
    instructions = "Repeat dose every 15-20 mins until 2-3 ppm residual is achieved.";
  } else if (productName === "SpaGuard pH Increaser") {
    instructions = "Sprinkle into spa water with pump running on high speed. Run pump for 30 mins.";
  } else if (productName === "SpaGuard pH Decreaser") {
    instructions = "Ensure Total Alkalinity is >= 125 ppm. Sprinkle into water with pump running. Run pump for 30 mins.";
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

  // Append instructions if they exist and weren't handled above
  // This condition needs adjustment as the HTH Tab instructions are set earlier
  // Let's refine the structure
  
  // Refined logic: Set base recommendation first, then override/set instructions
  let finalRecommendation = "";
  let finalInstructions = null;

  if (productName === "HTH 3\" Chlorine Tabs") {
    finalRecommendation = `Check Feeder/Skimmer for ${productName}.`; 
    finalInstructions = "Low Free Chlorine detected. Ensure tabs are present in the skimmer basket, feeder, or floater. Add tabs if empty or low. Run pump at least 8 hours daily.";
  } else {
    // Standard quantity-based recommendation
    const roundedAmount = Math.round(amount * 100) / 100; 
    finalRecommendation = `${action} ${roundedAmount} ${unit || ''} of ${productName || field}`;

    // Set specific instructions for other products
    if (productName === "SpaGuard Chlorinating Concentrate") {
      finalInstructions = "Repeat dose every 15-20 mins until 2-3 ppm residual is achieved.";
    } else if (productName === "SpaGuard pH Increaser") {
      finalInstructions = "Sprinkle into spa water with pump running on high speed. Run pump for 30 mins.";
    } else if (productName === "SpaGuard pH Decreaser") {
      finalInstructions = "Ensure Total Alkalinity is >= 125 ppm. Sprinkle into water with pump running. Run pump for 30 mins.";
    } else if (productName === "SpaGuard Total Alkalinity Increaser") {
      finalInstructions = "Pour directly into spa water with pump running on high speed. Run pump for 30 mins.";
    } else if (productName === "SpaGuard Calcium Hardness Increaser") {
      finalInstructions = "With pump running at high speed, scatter the required amount of product over the spa water and continue running pump for 30 minutes.";
    } else if (productName === "HTH Super Shock! Treatment") { // For actual shock calculation later
      finalInstructions = "With pump running, broadcast the required amount evenly over a wide area in the deepest part of the pool. Brush any undissolved granules. Keep pump running for several hours.";
    } else if (productName === "HTH Shock Advanced") {
      finalInstructions = "With pump running during evening hours, broadcast the product evenly over a wide area in the deepest part of the pool. Brush any settled granules to disperse. Keep pump running.";
    } else if (productName === "Clorox Pool & Spa pH Down") {
      finalInstructions = "While walking around edge of pool, broadcast product evenly across the deepest area while pool is not in use and pump is running. Allow to circulate for 2 hours then retest pH. Brush any undissolved clumps off surface.";
    } else if (productName === "Clorox Pool & Spa Chlorine Stabilizer") {
      finalInstructions = "Before adding, backwash or clean filter. Remove items from skimmer. Add product VERY SLOWLY into skimmer with filter and pump operating. Do not backwash filter for at least 48 hours. If using deep-end application, broadcast evenly and brush undissolved product. Do not allow product to sit on bottom.";
    }
    // Add more else if blocks for other standard chemicals here
  }

  return { recommendation: finalRecommendation, instructions: finalInstructions };
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