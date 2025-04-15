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
      productName: "Pool Shock (Cal Hypo based)",
      // Based on ~2.5 oz per 1ppm per 10k gal
      rate: 2.5, rateUnit: "oz", rateVolume: 10000,
      rateVolumeUnit: "gal", ratePpmEffect: 1,
      outputUnit: "oz", // Or maybe lbs for larger amounts
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
      // Base rate info from label (used in custom logic below)
      rate: 1, rateUnit: "tsp", rateVolume: 100, rateVolumeUnit: "gal",
      ratePpmEffect: 0, // Not applicable/used for tiered pH logic
      outputUnit: "tsp",
    },
    ph_down: {
      productName: "SpaGuard pH Decreaser",
      // Placeholder - get from label
      rate: 1, rateUnit: "tsp", rateVolume: 100,
      rateVolumeUnit: "gal", ratePpmEffect: 0.2, // Placeholder!
      outputUnit: "tsp",
    },
    alkalinity_up: {
      productName: "SpaGuard Alkalinity Increaser",
      // Placeholder - get from label
      rate: 1, rateUnit: "tbsp", rateVolume: 100,
      rateVolumeUnit: "gal", ratePpmEffect: 10, // Placeholder!
      outputUnit: "tbsp",
    },
    hardness_up: {
      productName: "SpaGuard Calcium Hardness Increaser",
      // Placeholder - get from label
      rate: 1, rateUnit: "tbsp", rateVolume: 100,
      rateVolumeUnit: "gal", ratePpmEffect: 10, // Placeholder!
      outputUnit: "tbsp",
    },
    chlorine_up: { // ** SpaGuard Chlorinating Concentrate **
      productName: "SpaGuard Chlorinating Concentrate",
      // Rate: 1/2 tsp per 100 gal aims for 3-5ppm residual.
      // This is the weakest link - needs verification or a better source!
      rate: 0.5, rateUnit: "tsp", rateVolume: 100,
      rateVolumeUnit: "gal", ratePpmEffect: 4, // Estimated PPM effect
      outputUnit: "tsp", // Output in teaspoons
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
 * @param {string} field - e.g., "Free Chlorine"
 * @param {number} currentVal - Current ppm
 * @param {number} targetVal - Target ppm
 * @param {number} volumeGallons - System volume
 * @param {string} system - 'pool' or 'cold_plunge'
 * @return {[number, string, string, string] | null}
 * [amount, unit, direction, productName] or null
 */
function calculateChemicalAdjustment(
    field, currentVal, targetVal, volumeGallons, system) {
  const difference = targetVal - currentVal;
  if (Math.abs(difference) < 0.01) return null;
  const direction = difference > 0 ? "up" : "down";

  // Find the chemical key (e.g., 'chlorine_up', 'ph_down')
  let chemicalKey = null;
  if (field === "Total Alkalinity" && direction === "up") {
    chemicalKey = "alkalinity_up";
  } else if (field === "Total Hardness" && direction === "up") {
    chemicalKey = "hardness_up";
  } else if (field === "Free Chlorine" && direction === "up") {
    chemicalKey = "chlorine_up";
  } else if (field === "Cyanuric Acid" && direction === "up") {
    chemicalKey = "cya_up";
  } else if (field === "pH" && direction === "up") {
    chemicalKey = "ph_up";
  } else if (field === "pH" && direction === "down") {
    chemicalKey = "ph_down";
  }
  // Add other mappings (especially for 'down') as needed

  if (!chemicalKey || !chemicalDosages[system] ||
    !chemicalDosages[system][chemicalKey]) {
    console.warn(`No dosage info found for system: ${system},
      field: ${field}, direction: ${direction}`);
    return null;
  }

  const dosageInfo = chemicalDosages[system][chemicalKey];

  // --- Dosage Calculation ---
  // 1. How much ppm change does the standard rate achieve?
  const ratePpmEffect = dosageInfo.ratePpmEffect;
  // 2. How much standard rate dosage is needed for the required ppm change?
  const requiredPpmChange = Math.abs(difference);
  const dosageMultiplier = requiredPpmChange / ratePpmEffect;
  // 3. Scale the standard rate amount by the multiplier
  const baseDosageNeeded = dosageInfo.rate * dosageMultiplier;
  // 4. Scale this dosage for the actual system volume vs the rate's volume
  const volumeRatio = volumeGallons / dosageInfo.rateVolume;
  const totalDosageInRateUnit = baseDosageNeeded * volumeRatio;

  // --- Unit Conversion (if outputUnit differs from rateUnit) ---
  let finalAmount = totalDosageInRateUnit;
  let finalUnit = dosageInfo.rateUnit;

  if (dosageInfo.outputUnit && dosageInfo.outputUnit.toLowerCase() !==
  dosageInfo.rateUnit.toLowerCase()) {
    // Convert the calculated dosage (in rateUnit) to grams first
    const gramsNeeded =
    convertToGrams(totalDosageInRateUnit, dosageInfo.rateUnit);
    // Then convert grams to the desired outputUnit
    finalAmount = convertFromGrams(gramsNeeded, dosageInfo.outputUnit);
    finalUnit = dosageInfo.outputUnit;
  }

  // Prevent tiny fractional results for units like tsp/tbsp
  if (["tsp", "tbsp"].includes(finalUnit.toLowerCase())) {
    if (finalAmount < 0.25) finalAmount = 0.25; // Minimum practical dose?
  }
  // Add similar logic for lbs/oz if desired

  return [
    finalAmount,
    finalUnit,
    direction,
    dosageInfo.productName,
  ];
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
              system,
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
        const shockKey = "chlorine_up";
        if (chemicalDosages[system] && chemicalDosages[system][shockKey]) {
          const shockDosageInfo = chemicalDosages[system][shockKey];
          const shockTargetPpmBoost = system === "pool" ? 10 : 5;

          // Calculate dosage needed for the boost
          const dosageMultiplier =
          shockTargetPpmBoost / shockDosageInfo.ratePpmEffect;
          const baseDosageNeeded = shockDosageInfo.rate * dosageMultiplier;
          const volumeRatio = volume / shockDosageInfo.rateVolume;
          const totalDosageInRateUnit = baseDosageNeeded * volumeRatio;

          // Convert to output unit
          let shockAmountConverted = totalDosageInRateUnit;
          let shockUnit = shockDosageInfo.rateUnit;
          if (shockDosageInfo.outputUnit &&
            shockDosageInfo.outputUnit.toLowerCase() !==
          shockDosageInfo.rateUnit.toLowerCase()) {
            const shockGrams =
            convertToGrams(totalDosageInRateUnit, shockDosageInfo.rateUnit);
            shockAmountConverted =
            convertFromGrams(shockGrams, shockDosageInfo.outputUnit);
            shockUnit = shockDosageInfo.outputUnit;
          }

          const shockProductName = shockDosageInfo.productName +
          " (Shock Dose)";
          shockResult = {
            amount: shockAmountConverted,
            unit: shockUnit,
            product: shockProductName,
          };
        } else {
          console.warn(`Cannot calculate shock: 
            Missing dosage info for ${shockKey} in system ${system}`);
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
