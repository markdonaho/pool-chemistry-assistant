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
    },
  },
};

// --- Detailed Chemical Dosage Information ---
// Structure: system -> chemicalKey -> {productName, rate, rateUnit,
// rateVolume, rateVolumeUnit, ratePpmEffect, outputUnit}
// ** IMPORTANT: Fill in accurate data from product labels **
const chemicalDosages = {
  pool: {
    ph_up: {
      productName: "Pool pH Increaser (Soda Ash)",
      // Placeholder - requires specific product data
      rate: 1.5, rateUnit: "lbs", rateVolume: 10000,
      rateVolumeUnit: "gal", ratePpmEffect: 0.2, // Highly dependent on TA!
      outputUnit: "lbs",
    },
    ph_down: {
      productName: "Pool pH Decreaser (Dry Acid)",
      // Placeholder
      rate: 2, rateUnit: "lbs", rateVolume: 10000,
      rateVolumeUnit: "gal", ratePpmEffect: 0.2, // Highly dependent on TA!
      outputUnit: "lbs",
    },
    alkalinity_up: {
      productName: "Pool Alkalinity Increaser (Sodium Bicarbonate)",
      // Based on ~1.5 lbs per 10ppm per 10k gal
      rate: 1.5, rateUnit: "lbs", rateVolume: 10000,
      rateVolumeUnit: "gal", ratePpmEffect: 10,
      outputUnit: "lbs",
    },
    hardness_up: {
      productName: "Pool Calcium Hardness Increaser (Calcium Chloride)",
      // Based on ~1.25 lbs per 10ppm per 10k gal (adjust for purity?)
      rate: 1.25, rateUnit: "lbs", rateVolume: 10000,
      rateVolumeUnit: "gal", ratePpmEffect: 10,
      outputUnit: "lbs",
    },
    chlorine_up: {
      productName: "HTH 3\" Chlorine Tabs",
      calculationType: "check_feeder_tabs", // Signal action-based logic
      rate: 1, rateUnit: "tab", rateVolume: 10000, // For reference (weekly dose)
      rateVolumeUnit: "gal", ratePpmEffect: 0, // Not used for immediate calculation
      outputUnit: "tab(s)" 
    },
    cya_up: {
      productName: "Pool Cyanuric Acid Stabilizer",
      // Based on ~1 lb per 10ppm per 10k gal
      rate: 1, rateUnit: "lbs", rateVolume: 10000,
      rateVolumeUnit: "gal", ratePpmEffect: 10,
      outputUnit: "lbs",
    },
    // Add entries for reducing chemicals if needed
  },
  cold_plunge: {
    ph_up: {
      productName: "SpaGuard pH Increaser",
      calculationType: "tiered_ph_up", // Signal specific tiered logic
      // Base rate info (lowest tier) for reference only
      rate: 0.5, rateUnit: "tsp", rateVolume: 100, rateVolumeUnit: "gal",
      ratePpmEffect: 0, // Not applicable
      outputUnit: "tsp",
    },
    ph_down: {
      productName: "SpaGuard pH Decreaser",
      calculationType: "tiered_ph_down", // Signal specific tiered logic
      // Base rate info (lowest tier) for reference only
      rate: 0.5, rateUnit: "tsp", rateVolume: 200, rateVolumeUnit: "gal",
      ratePpmEffect: 0, // Not applicable
      outputUnit: "tsp",
    },
    alkalinity_up: {
      productName: "SpaGuard Total Alkalinity Increaser",
      // Dosage: 1 tbsp / 100 gal raises TA by 25 ppm
      rate: 1, rateUnit: "tbsp", rateVolume: 100, rateVolumeUnit: "gal",
      ratePpmEffect: 25,
      outputUnit: "tbsp",
      // No specific calculationType needed, uses standard PPM logic
    },
    hardness_up: {
      productName: "SpaGuard Calcium Hardness Increaser",
      // Dosage: 1 tbsp / 100 gal raises hardness by 25 ppm
      rate: 1, rateUnit: "tbsp", rateVolume: 100,
      rateVolumeUnit: "gal", ratePpmEffect: 25,
      outputUnit: "tbsp",
      // No specific calculationType needed, uses standard PPM logic
    },
    chlorine_up: {
      productName: "SpaGuard Chlorinating Concentrate",
      calculationType: "residual_target",
      routineDoseAmount: 0.5,
      routineDoseUnit: "tsp",
      routineDoseVolume: 100,
      routineDoseVolumeUnit: "gal",
      targetResidualMinPpm: 2,
      targetResidualMaxPpm: 3,
      outputUnit: "tsp",
    },
    shock_treatment: { // ** SpaGuard Enhanced Shock **
      productName: "SpaGuard Enhanced Shock",
      calculationType: "fixed_rate_shock", // Signal specific calculation
      doseAmount: 3, // 3 tbsp
      doseUnit: "tbsp",
      doseVolume: 500, // per 500 gal
      doseVolumeUnit: "gal",
      outputUnit: "tbsp", // Rec in tbsp (or maybe tsp for smaller amounts)
    },
    // CYA likely not needed for cold plunge
  },
};

// --- Unit Conversion Helpers ---

/**
 * Convert a known dosage (like lbs or tsp) to grams.
 * @param {number} amount The amount of the chemical.
 * @param {string} unit The unit of the amount (e.g., 'lbs', 'tsp').
 * @return {number} The amount in grams.
 */
function convertToGrams(amount, unit) {
  switch (unit.toLowerCase()) {
    case "lbs": return amount * GRAMS_PER_POUND;
    case "oz": return amount * GRAMS_PER_OZ;
    case "tbsp": return amount * GRAMS_PER_TBSP_APPROX;
    case "tsp": return amount * GRAMS_PER_TSP_APPROX;
    case "grams": return amount;
    default: console.warn(`Unknown unit for conversion: ${unit}`); return 0;
  }
}

/**
 * Convert grams to a desired target unit (e.g., tsp, tbsp, lbs, oz).
 * @param {number} grams The amount in grams.
 * @param {string} targetUnit The desired output unit.
 * @return {number} The amount in the target unit.
 */
function convertFromGrams(grams, targetUnit) {
  switch (targetUnit.toLowerCase()) {
    case "lbs": return grams / GRAMS_PER_POUND;
    case "oz": return grams / GRAMS_PER_OZ;
    case "tbsp": return grams / GRAMS_PER_TBSP_APPROX;
    case "tsp": return grams / GRAMS_PER_TSP_APPROX;
    case "grams": return grams;
    default: console.warn(
        `Unknown target unit for gram conversion: ${targetUnit}`); return 0;
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
 * Handles standard ppm-based adjustments and logic like residual targets.
 * @param {string} field - e.g., "Free Chlorine"
 * @param {number} currentVal - Current ppm
 * @param {number} targetVal - Target ppm (from systems config)
 * @param {number} volumeGallons - System volume
 * @param {string} system - 'pool' or 'cold_plunge'
 * @return {[number, string, string, string] | null}
 * [amount, unit, direction, productName] or null
 */
function calculateChemicalAdjustment(
    field, currentVal, targetVal, volumeGallons, system) {
  const difference = targetVal - currentVal;
  const direction = difference > 0 ? "up" : "down";

  // --- Specific Calculation Types First ---

  // NEW: Handle Pool FC with Tabs
  if (field === "Free Chlorine" && system === "pool" && direction === "up") {
    const dosageInfo = chemicalDosages.pool.chlorine_up;
    if (dosageInfo.calculationType === "check_feeder_tabs" && currentVal < targetVal) {
      console.log(`Low pool FC (${currentVal} ppm), recommending check/add HTH 3" Tabs.`);
      // Return nominal amount/unit; formatting function provides real instructions
      return [1, dosageInfo.outputUnit, "up", dosageInfo.productName]; 
    }
  } 
  // END NEW BLOCK

  // SpaGuard pH Increaser (Cold Plunge)
  if (field === "pH" && system === "cold_plunge" && direction === "up") {
    console.log(
        `Calculating SpaGuard pH Increaser for current pH: ${currentVal}`);
    const dosageInfo = chemicalDosages.cold_plunge.ph_up;
    let baseDosageTsp = 0;
    if (currentVal <= 7.1) baseDosageTsp = 2;
    else if (currentVal <= 7.2) baseDosageTsp = 1;
    else if (currentVal < targetVal) baseDosageTsp = 0.5; // Only add if below

    if (baseDosageTsp > 0) {
      const volumeRatio = volumeGallons / dosageInfo.rateVolume;
      const totalDosageNeeded = baseDosageTsp * volumeRatio;
      const finalAmount = Math.max(0.25, Math.round(totalDosageNeeded * 4) / 4);
      console.log(`Calculated SpaGuard pH Up Dose: ${finalAmount} tsp`);
      return [finalAmount, dosageInfo.outputUnit, "up", dosageInfo.productName];
    } else {
      console.log("Cold plunge pH doesn't require increase.");
      return null;
    }
  } else if (
    field === "pH" && system === "cold_plunge" && direction === "down") {
    console.log(
        `Calculating SpaGuard pH Decreaser for current pH: ${currentVal}`);
    const dosageInfo = chemicalDosages.cold_plunge.ph_down;
    let baseDosageTsp = 0;

    // Apply dosage rules from label (pH range is upper bound)
    if (currentVal > 8.4) { // pH 8.4 and above
      baseDosageTsp = 2;
    } else if (currentVal > 8.0) { // pH 8.0+ to 8.4
      baseDosageTsp = 1.5;
    } else if (currentVal > 7.8) { // pH 7.8+ to 8.0
      baseDosageTsp = 0.75;
    } else if (currentVal > 7.6) { // pH 7.6+ to 7.8
      baseDosageTsp = 0.5;
    } // No action needed if 7.6 or below (within target or already low)

    if (baseDosageTsp > 0) {
      const volumeRatio = volumeGallons / dosageInfo.rateVolume;
      const totalDosageNeeded = baseDosageTsp * volumeRatio;
      const finalAmount = Math.max(0.25, Math.round(totalDosageNeeded * 4) / 4);
      console.log(`Calculated SpaGuard pH Down Dose: ${finalAmount} tsp`);
      return [
        finalAmount, dosageInfo.outputUnit, "down", dosageInfo.productName];
    } else {
      console.log("Cold plunge pH doesn't require decrease.");
      return null;
    }
  } else if (field === "Free Chlorine" &&
    system === "cold_plunge" && direction === "up") {
    const dosageInfo = chemicalDosages.cold_plunge.chlorine_up;
    if (dosageInfo.calculationType === "residual_target") {
      console.log(
          `Calculating SpaGuard Concentrate for current FC: ${currentVal}`);
      const minResidual = dosageInfo.targetResidualMinPpm;
      if (currentVal < minResidual) {
        const baseDose = dosageInfo.routineDoseAmount;
        const doseVolume = dosageInfo.routineDoseVolume;
        const doseUnit = dosageInfo.routineDoseUnit;
        const volumeRatio = volumeGallons / doseVolume;
        const totalDosageNeeded = baseDose * volumeRatio;
        const finalAmount =
        Math.max(0.25, Math.round(totalDosageNeeded * 4) / 4);
        console.log(`Recommended dose: ${finalAmount} ${doseUnit}`);
        return [finalAmount, doseUnit, "up", dosageInfo.productName];
      } else {
        console.log("Cold plunge FC at or above minimum residual.");
        return null;
      }
    }
  }

  // --- Standard PPM Calculation Logic (Fallback) ---
  // Find the chemical key for standard adjustments
  let chemicalKey = null;
  if (field === "Total Alkalinity" && direction === "up") {
    chemicalKey = "alkalinity_up";
  } else if (field === "Total Hardness" && direction === "up") {
    chemicalKey = "hardness_up";
  } else if (
    field === "Free Chlorine" && direction === "up" && system === "pool") {
    chemicalKey = "chlorine_up";
  } else if (
    field === "Cyanuric Acid" && direction === "up") chemicalKey = "cya_up";
  // Use standard logic for Pool pH or if specific tiered logic didn't apply
  else if (field === "pH" && system === "pool") {
    chemicalKey = direction === "up" ? "ph_up" : "ph_down";
  }
  // Get dosage info for standard calculation
  if (!chemicalKey || !chemicalDosages[system] ||
    !chemicalDosages[system][chemicalKey]) {
    if (Math.abs(difference) > 0.01) {
      console.warn(
          `No STANDARD dosage info for: ${system}, ${field}, ${direction}`);
    }
    return null;
  }
  const dosageInfo = chemicalDosages[system][chemicalKey];

  // --- Handle Specific Calculation Types ---
  if (dosageInfo.calculationType === "residual_target" &&
    field === "Free Chlorine" && system === "cold_plunge") {
    console.log(
        `Calculating SpaGuard Concentrate for current FC: ${currentVal}`);
    const minResidual = dosageInfo.targetResidualMinPpm; // e.g., 3 ppm

    // If current chlorine is below the minimum target residual
    if (currentVal < minResidual) {
      const baseDose = dosageInfo.routineDoseAmount; // e.g., 0.5 tsp
      const doseVolume = dosageInfo.routineDoseVolume; // e.g., 100 gal
      const doseUnit = dosageInfo.routineDoseUnit; // e.g., "tsp"

      // Scale dose for actual volume
      const volumeRatio = volumeGallons / doseVolume;
      const totalDosageNeeded = baseDose * volumeRatio;

      // Round to nearest 0.25 tsp, min 0.25
      const finalAmount = Math.max(0.25, Math.round(totalDosageNeeded * 4) / 4);

      console.log(`Recommended dose: ${finalAmount} ${doseUnit}`);
      return [
        finalAmount,
        doseUnit, // Use the dose unit directly
        "up", // Implied direction
        dosageInfo.productName,
      ];
    } else {
      console.log("Cold plunge FC is at or above minimum residual target.");
      return null; // No adjustment needed if already in range
    }
  }

  // --- Standard PPM-Based Calculation (Refined) ---
  // Only proceed if it's NOT the special case handled above
  const ratePpmEffect = dosageInfo.ratePpmEffect;
  if (ratePpmEffect ===
     undefined || ratePpmEffect === null || ratePpmEffect <= 0) {
    // Check if it's pH - pH uses separate logic currently
    if (field === "pH") {
      // TODO: Implement proper pH calculation based on TA and product data
      console.warn(`Using pH logic for ${system} - accuracy not guaranteed.`);
      // Return null or a placeholder based on phRates if absolutely needed
      return null;
    } else {
      console.warn(
          `Invalid or missing ratePpmEffect for ${chemicalKey} in ${system}`);
      return null;
    }
  }

  if (Math.abs(difference) < 0.01) return null; // Ignore tiny diff for ppm calc

  const requiredPpmChange = Math.abs(difference);
  const dosageMultiplier = requiredPpmChange / ratePpmEffect;
  const baseDosageNeeded = dosageInfo.rate * dosageMultiplier;
  const volumeRatio = volumeGallons / dosageInfo.rateVolume;
  const totalDosageInRateUnit = baseDosageNeeded * volumeRatio;

  // Unit Conversion logic (as before)
  let finalAmount = totalDosageInRateUnit;
  let finalUnit = dosageInfo.rateUnit;
  if (dosageInfo.outputUnit && dosageInfo.outputUnit.toLowerCase() !==
  dosageInfo.rateUnit.toLowerCase()) {
    const gramsNeeded = convertToGrams(
        totalDosageInRateUnit, dosageInfo.rateUnit);
    if (gramsNeeded === 0 && totalDosageInRateUnit !== 0) {
      console.warn(`Gram conversion failed: ${totalDosageInRateUnit}
         ${dosageInfo.rateUnit}`);
      return null;
    }
    finalAmount = convertFromGrams(gramsNeeded, dosageInfo.outputUnit);
    finalUnit = dosageInfo.outputUnit;
    if (isNaN(finalAmount)) {
      console.warn(`Unit NaN: ${gramsNeeded}g to ${dosageInfo.outputUnit}`);
      return null;
    }
  }

  // Rounding logic (as before)
  if (["tsp", "tbsp"].includes(finalUnit.toLowerCase())) {
    finalAmount = Math.max(0.25, Math.round(finalAmount * 4) / 4);
  }
  if (["lbs", "oz"].includes(finalUnit.toLowerCase())) {
    finalAmount = Math.round(finalAmount * 10) / 10;
  }
  if (finalAmount <= 0) return null;

  return [finalAmount, finalUnit, direction, dosageInfo.productName];
}

// --- Cloud Functions ---

/**
 * Firebase Cloud Function to get system definitions.
 * Requires authentication.
 * @param {functions.https.Request} req - The HTTPS request object.
 * @param {functions.Response} res - The HTTPS response object.
 */
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

/**
 * Firebase Cloud Function to calculate chemical adjustments.
 * Requires authentication and expects system type and current readings in body.
 * Stores the reading in Firestore.
 * @param {functions.https.Request} req - The HTTPS request object.
 * @param {functions.Response} res - The HTTPS response object.
 */
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

      // Iterate through TARGETS to calculate adjustments for each
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
              system,
          );

          calculatedAdjustments[field] = adj || [0, null, null, null];

          // Check for low FC condition *within* the loop for immediate flag
          if (field === "Free Chlorine" && currentVal < 0.5) {
            console.log("Low FC detected, potentially needs shock.");
            needsShock = true;
          }
        } else {
          console.warn(`Field ${field} in targets but not in readings.`);
        }
      }

      // --- Check for High Combined Chlorine AFTER the main loop ---
      const currentFC = parseFloat(current["Free Chlorine"]);
      const currentTC = parseFloat(current["Total Chlorine"]);

      if (!isNaN(currentFC) && !isNaN(currentTC) && currentTC > 0) {
        const combinedChlorine = currentTC - currentFC;
        console.log(`Calculated Combined Chlorine: 
        ${combinedChlorine.toFixed(1)} ppm`);
        if (combinedChlorine > 0.5) {
          console.log("High Combined Chlorine detected, needs shock.");
          needsShock = true;
        }
      }
      // Low FC check already happened in the loop

      // Calculate shock if needed
      let shockResult = null;
      if (needsShock) {
        console.log("Shock treatment indicated.");
        const shockKey = "shock_treatment"; // Use the new key

        if (chemicalDosages[system] && chemicalDosages[system][shockKey]) {
          const shockDosageInfo = chemicalDosages[system][shockKey];

          // Check if calculation type is fixed_rate_shock (as expected)
          if (shockDosageInfo.calculationType === "fixed_rate_shock") {
            // Calculate dosage based on fixed rate
            const baseDose = shockDosageInfo.doseAmount; // e.g., 3
            const doseVolume = shockDosageInfo.doseVolume; // e.g., 500
            const outputUnit = shockDosageInfo.outputUnit; // e.g., "tbsp"

            const volumeRatio = volume / doseVolume; // e.g., 126 / 500
            const totalDosageNeeded = baseDose * volumeRatio;

            // Convert units if rateUnit differs from outputUnit
            let finalAmount = totalDosageNeeded;
            const finalUnit = outputUnit;

            // Rounding for volumetric units (tsp/tbsp)
            if (["tsp", "tbsp"].includes(finalUnit.toLowerCase())) {
              finalAmount = Math.max(0.25, Math.round(
                  finalAmount * 4) / 4); // Round to nearest 0.25
            }

            // Don't recommend shock if calculated amount is effectively zero
            if (finalAmount > 0) {
              shockResult = {
                amount: finalAmount,
                unit: finalUnit,
                product: shockDosageInfo.productName,
              };
              console.log("Calculated Shock Dose:", shockResult);
            } else {
              console.log("Calculated shock amount is zero, skipping.");
            }
          } else {
            // Handle unexpected calculation type for shock
            console.warn(`Unexpected calculationType for shock: 
                 ${shockDosageInfo.calculationType}`);
          }
        } else {
          console.warn(`Cannot calculate shock: 
             Missing dosage info for ${shockKey} in system ${system}`);
        }
      }
      // --- End Shock Calculation ---

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

/**
 * Firebase Cloud Function to get previous readings.
 * Requires authentication.
 * Fetches latest 10 readings across all users (for household model).
 * @param {functions.https.Request} req - The HTTPS request object.
 * @param {functions.Response} res - The HTTPS response object.
 */
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
          .limit(1000)
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
