const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({origin: true});

admin.initializeApp();
const db = admin.firestore();

// --- Constants ---
const GRAMS_PER_POUND = 453.592;
const GRAMS_PER_OZ = 28.3495;
// Approximate volumetric density for common granular chemicals
// !! VERY APPROXIMATE - Different chemicals have different densities !!
const GRAMS_PER_TSP_APPROX = 5; 
const GRAMS_PER_TBSP_APPROX = 16; // Approx 3 * tsp
const TSP_PER_TBSP = 3;
const OZ_PER_LB = 16;

// --- System Definitions ---
const systems = {
  cold_plunge: {
    volume: 126, // gallons
    targets: {
      "Total Hardness": 150, // ppm
      "Free Chlorine": 2, // ppm
      "Total Alkalinity": 120, // ppm
      "pH": 7.4,
      "Bromine": 2, // ppm
      "Cyanuric Acid": 40, // ppm
      "Total Chlorine": 3, // ppm
    },
  },
  pool: {
    volume: 15000, // gallons
    targets: {
      "Total Hardness": 300, // ppm
      "Free Chlorine": 3, // ppm
      "Total Alkalinity": 100, // ppm
      "pH": 7.4,
      "Bromine": 2, // ppm
      "Cyanuric Acid": 40, // ppm
      "Total Chlorine": 3, // ppm
    },
  },
};

// --- Detailed Chemical Dosage Information --- 
// Structure: system -> chemicalKey -> {productName, rate, rateUnit, rateVolume, rateVolumeUnit, ratePpmEffect, outputUnit}
// ** IMPORTANT: Fill in accurate data from product labels **
const chemicalDosages = {
  pool: {
    ph_up: { 
      productName: "Pool pH Increaser (Soda Ash)",
      // Placeholder - requires specific product data 
      rate: 1.5, rateUnit: 'lbs', rateVolume: 10000, rateVolumeUnit: 'gal', ratePpmEffect: 0.2, // Highly dependent on TA!
      outputUnit: 'lbs' 
    },
    ph_down: { 
      productName: "Pool pH Decreaser (Dry Acid)",
      // Placeholder
      rate: 2, rateUnit: 'lbs', rateVolume: 10000, rateVolumeUnit: 'gal', ratePpmEffect: 0.2, // Highly dependent on TA!
      outputUnit: 'lbs'
    },
    alkalinity_up: {
      productName: "Pool Alkalinity Increaser (Sodium Bicarbonate)",
      // Based on ~1.5 lbs per 10ppm per 10k gal
      rate: 1.5, rateUnit: 'lbs', rateVolume: 10000, rateVolumeUnit: 'gal', ratePpmEffect: 10,
      outputUnit: 'lbs' 
    },
    hardness_up: {
      productName: "Pool Calcium Hardness Increaser (Calcium Chloride)",
      // Based on ~1.25 lbs per 10ppm per 10k gal (adjust for purity?)
      rate: 1.25, rateUnit: 'lbs', rateVolume: 10000, rateVolumeUnit: 'gal', ratePpmEffect: 10, 
      outputUnit: 'lbs'
    },
    chlorine_up: {
      productName: "Pool Shock (Cal Hypo based)",
      // Based on ~2.5 oz per 1ppm per 10k gal
      rate: 2.5, rateUnit: 'oz', rateVolume: 10000, rateVolumeUnit: 'gal', ratePpmEffect: 1,
      outputUnit: 'oz' // Or maybe lbs for larger amounts
    },
    cya_up: {
      productName: "Pool Cyanuric Acid Stabilizer",
      // Based on ~1 lb per 10ppm per 10k gal
      rate: 1, rateUnit: 'lbs', rateVolume: 10000, rateVolumeUnit: 'gal', ratePpmEffect: 10,
      outputUnit: 'lbs'
    }
    // Add entries for reducing chemicals if needed
  },
  cold_plunge: {
    ph_up: {
      productName: "SpaGuard pH Increaser",
      // Placeholder - get from label
      rate: 1, rateUnit: 'tbsp', rateVolume: 100, rateVolumeUnit: 'gal', ratePpmEffect: 0.2, // Placeholder!
      outputUnit: 'tbsp'
    },
    ph_down: {
      productName: "SpaGuard pH Decreaser",
       // Placeholder - get from label
      rate: 1, rateUnit: 'tsp', rateVolume: 100, rateVolumeUnit: 'gal', ratePpmEffect: 0.2, // Placeholder!
      outputUnit: 'tsp'
    },
    alkalinity_up: {
      productName: "SpaGuard Alkalinity Increaser",
      // Placeholder - get from label
      rate: 1, rateUnit: 'tbsp', rateVolume: 100, rateVolumeUnit: 'gal', ratePpmEffect: 10, // Placeholder!
      outputUnit: 'tbsp' 
    },
    hardness_up: {
      productName: "SpaGuard Calcium Hardness Increaser",
      // Placeholder - get from label
      rate: 1, rateUnit: 'tbsp', rateVolume: 100, rateVolumeUnit: 'gal', ratePpmEffect: 10, // Placeholder! 
      outputUnit: 'tbsp'
    },
    chlorine_up: { // ** SpaGuard Chlorinating Concentrate **
      productName: "SpaGuard Chlorinating Concentrate",
      // Rate: 1/2 tsp per 100 gal aims for 3-5ppm residual. 
      // We need ppm *increase*. Let's *estimate* 1/2 tsp raises by 4ppm in 100 gal.
      // This is the weakest link - needs verification or a better source!
      rate: 0.5, rateUnit: 'tsp', rateVolume: 100, rateVolumeUnit: 'gal', ratePpmEffect: 4, // Estimated PPM effect
      outputUnit: 'tsp' // Output in teaspoons
    },
    // CYA likely not needed for cold plunge
  }
};

// --- Unit Conversion Helpers --- 

// Convert a known dosage (like lbs or tsp) to grams
function convertToGrams(amount, unit) {
  switch (unit.toLowerCase()) {
    case 'lbs': return amount * GRAMS_PER_POUND;
    case 'oz': return amount * GRAMS_PER_OZ;
    case 'tbsp': return amount * GRAMS_PER_TBSP_APPROX;
    case 'tsp': return amount * GRAMS_PER_TSP_APPROX;
    case 'grams': return amount;
    default: console.warn(`Unknown unit for gram conversion: ${unit}`); return 0;
  }
}

// Convert grams to a desired target unit (e.g., tsp, tbsp, lbs, oz)
function convertFromGrams(grams, targetUnit) {
  switch (targetUnit.toLowerCase()) {
    case 'lbs': return grams / GRAMS_PER_POUND;
    case 'oz': return grams / GRAMS_PER_OZ;
    case 'tbsp': return grams / GRAMS_PER_TBSP_APPROX;
    case 'tsp': return grams / GRAMS_PER_TSP_APPROX;
    case 'grams': return grams;
    default: console.warn(`Unknown target unit for gram conversion: ${targetUnit}`); return 0;
  }
}

// --- Helper Functions ---

/**
 * Validate the Firebase ID token from the Authorization header.
 *
 * @param {string} authHeader - The Auth header with the Bearer token.
 * @return {Promise<string>} The user ID if the token is valid.
 * @throws {Error} If the token is invalid or missing.
 */
async function validateToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }
  const token = authHeader.split(" ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    throw new Error(`Token verification failed: ${error.message}`);
  }
}

/**
 * Calculates the required adjustment based on detailed chemical dosage info.
 * @param {string} field - e.g., "Free Chlorine"
 * @param {number} currentVal - Current ppm
 * @param {number} targetVal - Target ppm
 * @param {number} volumeGallons - System volume
 * @param {string} system - 'pool' or 'cold_plunge'
 * @returns {[number, string, string, string] | null} [amount, unit, direction, productName] or null
 */
function calculateChemicalAdjustment(field, currentVal, targetVal, volumeGallons, system) {
  const difference = targetVal - currentVal;
  // Only adjust if pH is below target (don't use this logic for lowering pH)
  if (field === "pH" && system === "cold_plunge" && difference > 0) {
      console.log(`Calculating SpaGuard pH Increaser for current pH: ${currentVal}`);
      const dosageInfo = chemicalDosages.cold_plunge.ph_up;
      let baseDosageTsp = 0;

      // Apply dosage rules from label
      if (currentVal <= 7.1) { // Treat anything 7.1 or less as needing max dose for simplicity
          baseDosageTsp = 2;
      } else if (currentVal <= 7.2) {
          baseDosageTsp = 1;
      } else if (currentVal <= 7.3) { // Assuming target is 7.4, need some increase if 7.3
          baseDosageTsp = 0.5;
      }

      if (baseDosageTsp > 0) {
         // Scale dosage for actual volume
         const volumeRatio = volumeGallons / dosageInfo.rateVolume;
         const totalDosageNeeded = baseDosageTsp * volumeRatio;
         
         // Since output unit is tsp, no further conversion needed, but round?
         const finalAmount = Math.max(0.25, Math.round(totalDosageNeeded * 4) / 4); // Round to nearest 0.25 tsp, min 0.25

         console.log(`Calculated SpaGuard Dose: ${finalAmount} tsp`);
         return [
             finalAmount, 
             dosageInfo.outputUnit, // tsp
             "up", 
             dosageInfo.productName
         ];
      } else {
          console.log("Cold plunge pH doesn't require increase based on rules.");
          return null; // No adjustment needed based on tiered rules
      }
  }

  // --- Existing logic for other chemicals/systems --- 
  if (Math.abs(difference) < 0.01) return null;
  const direction = difference > 0 ? "up" : "down";
  let chemicalKey = null;
  // REMOVED pH UP/DOWN MAPPING from here, handled above/below 
  if (field === "Total Alkalinity" && direction === "up") chemicalKey = "alkalinity_up";
  else if (field === "Total Hardness" && direction === "up") chemicalKey = "hardness_up";
  else if (field === "Free Chlorine" && direction === "up") chemicalKey = "chlorine_up";
  else if (field === "Cyanuric Acid" && direction === "up") chemicalKey = "cya_up";
  // Handle pH down or pool pH up (using placeholder logic)
  else if (field === "pH" && direction === "down") chemicalKey = "ph_down"; // Need dosage info for this
  else if (field === "pH" && system === "pool" && direction === "up") chemicalKey = "ph_up"; // Need dosage info for this
  // Add other mappings

  if (!chemicalKey || !chemicalDosages[system] || !chemicalDosages[system][chemicalKey]) {
    console.warn(`No dosage info for system: ${system}, field: ${field}, direction: ${direction}`);
    return null;
  }
  const dosageInfo = chemicalDosages[system][chemicalKey];
  
  // Placeholder for pH using phRates (Needs refinement or specific dosage info)
  if (field === "pH") {
      console.warn("Using placeholder pH calculation - accuracy not guaranteed.");
      const rate = difference > 0 ? phRates[system].up : phRates[system].down;
      // This logic is arbitrary and likely incorrect, replace with product-specific data if possible
      const amountGrams = Math.abs(difference) * volumeGallons * rate * 100; 
      const finalAmount = convertFromGrams(amountGrams, dosageInfo.outputUnit || 'grams'); // Convert to target unit
      const finalUnit = dosageInfo.outputUnit || 'grams';
      return [finalAmount, finalUnit, direction, dosageInfo.productName];
  }

  // --- Calculation for non-tiered chemicals (Alkalinity, Hardness, Chlorine, CYA) --- 
  const ratePpmEffect = dosageInfo.ratePpmEffect;
  if (!ratePpmEffect || ratePpmEffect <= 0) { // Check for valid PPM effect
      console.warn(`Invalid ratePpmEffect for ${chemicalKey} in system ${system}`);
      return null;
  }
  const requiredPpmChange = Math.abs(difference);
  const dosageMultiplier = requiredPpmChange / ratePpmEffect;
  const baseDosageNeeded = dosageInfo.rate * dosageMultiplier;
  const volumeRatio = volumeGallons / dosageInfo.rateVolume;
  const totalDosageInRateUnit = baseDosageNeeded * volumeRatio;

  // Unit Conversion logic (as before)
  let finalAmount = totalDosageInRateUnit;
  let finalUnit = dosageInfo.rateUnit;
  if (dosageInfo.outputUnit && dosageInfo.outputUnit.toLowerCase() !== dosageInfo.rateUnit.toLowerCase()) {
      const gramsNeeded = convertToGrams(totalDosageInRateUnit, dosageInfo.rateUnit);
      if (gramsNeeded === 0 && totalDosageInRateUnit !== 0) {
         console.warn(`Gram conversion failed for ${totalDosageInRateUnit} ${dosageInfo.rateUnit}`);
         return null; // Avoid division by zero if conversion fails
      }
      finalAmount = convertFromGrams(gramsNeeded, dosageInfo.outputUnit);
      finalUnit = dosageInfo.outputUnit;
      if (isNaN(finalAmount)) { // Check if conversion resulted in NaN
         console.warn(`Unit conversion resulted in NaN for ${gramsNeeded}g to ${dosageInfo.outputUnit}`);
         return null;
      }
  }
  
  if (['tsp', 'tbsp'].includes(finalUnit.toLowerCase())) {
      finalAmount = Math.max(0.25, Math.round(finalAmount * 4) / 4); // Round to nearest 0.25, min 0.25
  }
  // Round lbs/oz to 1 decimal?
  if (['lbs', 'oz'].includes(finalUnit.toLowerCase())) {
      finalAmount = Math.round(finalAmount * 10) / 10;
  }

  // Check for zero amount after rounding
  if (finalAmount <= 0) return null;

  return [finalAmount, finalUnit, direction, dosageInfo.productName];
}

// --- Cloud Functions ---

exports.systems = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({error: "Method not allowed. Use POST."});
    }

    try {
      await validateToken(req.headers.authorization);
      return res.status(200).json({data: systems});
    } catch (error) {
      console.error("systems: Error:", error.message);
      return res.status(401).json({error: "Unauthorized",
        details: error.message});
    }
  });
});

exports.calculate = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({error: "Method not allowed. Use POST."});
    }

    try {
      const uid = await validateToken(req.headers.authorization);
      const {system, current} = req.body;

      if (!system || !systems[system] || !current) {
        return res.status(400).json({error: "System and current required"});
      }

      const volume = systems[system].volume;
      const targets = systems[system].targets;

      const calculatedAdjustments = {};
      let needsShock = false;

      console.log(`Calculating for system: ${system}, volume: ${volume}`);
      console.log("Current Readings:", current);
      console.log("Target Readings:", targets);

      for (const field in targets) {
        if (Object.prototype.hasOwnProperty.call(targets, field) &&
            Object.prototype.hasOwnProperty.call(current, field)) {
          const currentVal = parseFloat(current[field]);
          const targetVal = targets[field];

          if (isNaN(currentVal)) {
            console.warn(
                "Invalid current value for ${field}: ${current[field]}");
            continue; // Skip if current value is not a number
          }

          const adj = calculateChemicalAdjustment(
              field,
              currentVal,
              targetVal,
              volume,
              system
          );

          calculatedAdjustments[field] = adj || [0, null, null, null];

          // Basic Shock Logic (Example - needs refinement)
          const totalChlorine = parseFloat(current["Total Chlorine"]);
          if (field === "Free Chlorine" && !isNaN(totalChlorine) &&
          totalChlorine > 0 && (totalChlorine - currentVal > 0.5)) {
            needsShock = true;
          }
          // Or if Free Chlorine is zero or very low
          if (field === "Free Chlorine" && currentVal < 0.5) {
            needsShock = true;
          }
        } else {
          console.warn("Field ${field} in targets but not in readings.");
        }
      }

      // Calculate shock if needed
      let shockResult = null;
      if (needsShock) {
        console.log("Shock treatment indicated.");
        const shockKey = "chlorine_up"; // Assuming shock uses the chlorine_up chemical
        if (chemicalDosages[system] && chemicalDosages[system][shockKey]) {
           const shockDosageInfo = chemicalDosages[system][shockKey];
           const shockTargetPpmBoost = system === 'pool' ? 10 : 5; // Desired *increase* in ppm for shock
           
           // Calculate dosage needed for the boost
           const dosageMultiplier = shockTargetPpmBoost / shockDosageInfo.ratePpmEffect;
           const baseDosageNeeded = shockDosageInfo.rate * dosageMultiplier;
           const volumeRatio = volume / shockDosageInfo.rateVolume;
           const totalDosageInRateUnit = baseDosageNeeded * volumeRatio;

           // Convert to output unit
           let shockAmountConverted = totalDosageInRateUnit;
           let shockUnit = shockDosageInfo.rateUnit;
           if (shockDosageInfo.outputUnit && shockDosageInfo.outputUnit.toLowerCase() !== shockDosageInfo.rateUnit.toLowerCase()) {
               const shockGrams = convertToGrams(totalDosageInRateUnit, shockDosageInfo.rateUnit);
               shockAmountConverted = convertFromGrams(shockGrams, shockDosageInfo.outputUnit);
               shockUnit = shockDosageInfo.outputUnit;
           }

           const shockProductName = shockDosageInfo.productName + " (Shock Dose)";
           shockResult = {
               amount: shockAmountConverted,
               unit: shockUnit,
               product: shockProductName,
           };
        } else {
           console.warn(`Cannot calculate shock: Missing dosage info for ${shockKey} in system ${system}`);
        }
      }

      // --- Store Readings (Consider refining what is stored) ---
      // Maybe store the calculated adjustments too?
      const readingData = {
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        system,
        userId: uid,
        readings: current, // Store the readings used for calculation
        // Optional: store targets used
        // Optional: store calculated adjustments
      };
      await db.collection("readings").add(readingData);
      console.log("Reading stored successfully");
      // --- End Store Readings ---

      const response = {adjustments: calculatedAdjustments};
      if (shockResult) {
        response.shock = shockResult;
      }
      console.log("Calculated Adjustments:", response);
      return res.status(200).json(response);
    } catch (error) {
      console.error("calculate error:", error);
      // Send back a more generic error in production
      return res.status(500).json({
        error: "Calculation failed", details: error.message});
    }
  });
});

exports.getReadings = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "GET") {
      return res.status(405).json({error: "Method not allowed. Use GET."});
    }

    try {
      await validateToken(req.headers.authorization);
      const readingsSnapshot = await admin.firestore()
          .collection("readings")
          .orderBy("date", "desc")
          .limit(10)
          .get();

      const readings = [];
      readingsSnapshot.forEach((doc) => {
        readings.push({id: doc.id, ...doc.data()});
      });

      return res.status(200).json({readings});
    } catch (error) {
      console.error("getReadings: Error:", error.message);
      return res.status(401).json({error: "Unauthorized",
        details: error.message});
    }
  });
});
