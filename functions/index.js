const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({origin: true});

admin.initializeApp();
const db = admin.firestore();

// --- Constants --- 
const GRAMS_PER_POUND = 453.592;
const GRAMS_PER_OZ = 28.3495;
const GRAMS_PER_TSP = 5; // Approx for granules
const GRAMS_PER_TBSP = 16; // Approx for granules (3 tsp)
const US_GALLONS_PER_LITER = 0.264172;

// --- System Definitions --- 
const systems = {
  cold_plunge: {
    volume: 126, // gallons
    targets: {
      "Total Hardness": 150, // ppm
      "Free Chlorine": 2, // ppm
      "Total Alkalinity": 120, // ppm
      "pH": 7.4,
      // Maybe exclude Bromine/CYA/Total Chlorine targets if not relevant for plunge?
    },
  },
  pool: {
    volume: 15000, // gallons
    targets: {
      "Total Hardness": 300, // ppm
      "Free Chlorine": 3, // ppm
      "Total Alkalinity": 100, // ppm
      "Cyanuric Acid": 40, // ppm
      "pH": 7.4,
    },
  },
};

// --- Chemical Definitions & Dosage --- 
// Structure: { chemicalKey: { productName: { pool: 'Name', cold_plunge: 'Name' }, gramsPerPpmPerGallon: X } }
// Note: Dosage rates are approximate. VERIFY WITH PRODUCT LABELS.
const chemicals = {
  ph_up: {
    productName: { pool: "PoolMate pH Up (Soda Ash)", cold_plunge: "SpaGuard pH Increaser" },
    gramsPerPpmPerGallon: 0, // pH is complex, handle separately
  },
  ph_down: {
    productName: { pool: "HTH pH Down (Dry Acid)", cold_plunge: "SpaGuard pH Decreaser" },
    gramsPerPpmPerGallon: 0, // pH is complex, handle separately
  },
  alkalinity_up: {
    productName: { pool: "PoolMate Alkalinity Increaser (Sodium Bicarbonate)", cold_plunge: "SpaGuard Alkalinity Increaser" },
    // 1.5 lbs / 10 ppm / 10000 gal => 1.5 * 454 / 10 / 10000 = 0.00681 g/ppm/gal
    gramsPerPpmPerGallon: 0.00681,
  },
  hardness_up: {
    productName: { pool: "HTH Calcium Hardness Increaser (Calcium Chloride)", cold_plunge: "SpaGuard Calcium Hardness Increaser" },
    // 1.25 lbs (CaCl2 77%) / 10 ppm / 10000 gal => 1.25 * 454 / 10 / 10000 = 0.005675 g/ppm/gal 
    // (Adjusting for common ~94-97% purity might increase this slightly)
    gramsPerPpmPerGallon: 0.0058, 
  },
  chlorine_up: {
    // Granular chlorine rates vary significantly by % active ingredient
    productName: { pool: "Clorox/HTH Pool Shock (Cal Hypo based)", cold_plunge: "SpaGuard Chlorinating Concentrate (Dichlor based)" },
    // Pool (Cal Hypo ~65%): ~2.5 oz / 1 ppm / 10000 gal => 2.5 * 28.35 / 1 / 10000 = 0.0070 g/ppm/gal
    // Spa (Dichlor ~56%): ~3 oz / 1 ppm / 10000 gal => 3 * 28.35 / 1 / 10000 = 0.0085 g/ppm/gal 
    gramsPerPpmPerGallon: { pool: 0.0070, cold_plunge: 0.0085 }, 
  },
  cya_up: {
    productName: { pool: "HTH Cyanuric Acid Stabilizer", cold_plunge: "N/A" }, // Usually not needed for spa
    // ~1 lb / 10 ppm / 10000 gal => 1 * 454 / 10 / 10000 = 0.00454 g/ppm/gal
    gramsPerPpmPerGallon: 0.00454,
  }
  // Add other chemicals if needed (e.g., alkalinity down - often muriatic acid or dry acid, CYA down - dilution)
};

// Special handling for pH (more complex calculation needed)
// This is a placeholder - real pH adjustment depends heavily on TA.
const phRates = {
  pool: { up: 0.425, down: 0.0525 }, // Original arbitrary rates, needs better logic
  cold_plunge: { up: 0.1, down: 0.01 }, // Scaled down arbitrarily
};

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
 * Converts grams to appropriate units based on system type.
 * @param {number} grams - Amount in grams.
 * @param {string} system - 'pool' or 'cold_plunge'.
 * @return {[number, string]} Amount and unit string.
 */
function convertGramsToUnit(grams, system) {
  if (system === 'cold_plunge') {
    // Prefer Tablespoons for cold plunge
    const tbsp = grams / GRAMS_PER_TBSP;
    if (tbsp < 1/4) return [grams, "grams"]; // Very small amounts in grams
    return [tbsp, "tbsp"];
  } else {
    // Prefer Pounds or Ounces for pool
    const pounds = grams / GRAMS_PER_POUND;
    if (pounds >= 0.5) return [pounds, "lbs"]; // Use pounds if >= 0.5 lbs
    const ounces = grams / GRAMS_PER_OZ;
    if (ounces >= 1) return [ounces, "oz"]; // Use ounces if >= 1 oz
    return [grams, "grams"]; // Small amounts in grams
  }
}

/**
 * Calculates adjustment for a chemical based on ppm change.
 *
 * @param {string} field - The reading field name (e.g., "Total Alkalinity").
 * @param {number} currentVal - The current reading ppm.
 * @param {number} targetVal - The target reading ppm.
 * @param {number} volumeGallons - System volume in gallons.
 * @param {string} system - 'pool' or 'cold_plunge'.
 * @return {[number, string, string, string] | null} [amount, unit, direction, productName] or null if no adjustment.
 */
function calculateChemicalAdjustment(field, currentVal, targetVal, volumeGallons, system) {
  const difference = targetVal - currentVal;
  if (Math.abs(difference) < 0.01) return null; // Ignore tiny differences

  let chemicalKey = null;
  let direction = difference > 0 ? "up" : "down";

  // Map field name to chemical key
  if (field === "Total Alkalinity" && direction === "up") chemicalKey = "alkalinity_up";
  else if (field === "Total Hardness" && direction === "up") chemicalKey = "hardness_up";
  else if (field === "Free Chlorine" && direction === "up") chemicalKey = "chlorine_up";
  else if (field === "Cyanuric Acid" && direction === "up") chemicalKey = "cya_up";
  // Add mappings for 'down' adjustments if needed
  
  // Special pH handling (using placeholder rates)
  if (field === "pH") {
    const rate = difference > 0 ? phRates[system].up : phRates[system].down;
    const amountGrams = Math.abs(difference) * volumeGallons * rate * 100; // Arbitrary scaling for placeholder
    const [amount, unit] = convertGramsToUnit(amountGrams, system);
    const productName = chemicals[difference > 0 ? "ph_up" : "ph_down"].productName[system];
    return [amount, unit, direction, productName];
  }

  if (!chemicalKey) {
    console.warn(`No chemical mapping found for field: ${field}, direction: ${direction}`);
    return null;
  }

  const chemicalInfo = chemicals[chemicalKey];
  let rate = chemicalInfo.gramsPerPpmPerGallon;
  if (typeof rate === 'object') {
    rate = rate[system]; // Get system specific rate if defined (like chlorine)
  }

  if (!rate) {
     console.warn(`No dosage rate found for chemical: ${chemicalKey}, system: ${system}`);
     return null;
  }

  const totalGramsNeeded = Math.abs(difference) * volumeGallons * rate;
  const [amount, unit] = convertGramsToUnit(totalGramsNeeded, system);
  const productName = chemicalInfo.productName[system];

  return [amount, unit, direction, productName];
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
        return res.status(400).json({error: "Valid system and current readings required"});
      }
      
      const volume = systems[system].volume;
      const targets = systems[system].targets;
      
      const adjustments = {};
      let needsShock = false;
      let shockAmount = 0; // Grams

      console.log(`Calculating for system: ${system}, volume: ${volume}`);
      console.log("Current Readings:", current);
      console.log("Target Readings:", targets);

      // Iterate through TARGETS to ensure we calculate for relevant fields
      for (const field in targets) {
        if (Object.prototype.hasOwnProperty.call(targets, field) && 
            Object.prototype.hasOwnProperty.call(current, field)) { // Make sure current reading exists
              
          const currentVal = parseFloat(current[field]);
          const targetVal = targets[field];

          if (isNaN(currentVal)) {
             console.warn(`Invalid current value for ${field}: ${current[field]}`);
             continue; // Skip if current value is not a number
          }

          const adj = calculateChemicalAdjustment(
              field,
              currentVal,
              targetVal,
              volume,
              system
          );

          if (adj) {
            adjustments[field] = adj; // Store [amount, unit, direction, productName]
          } else {
            adjustments[field] = [0, null, null, null]; // Indicate no adjustment needed
          }

          // Basic Shock Logic (Example - needs refinement)
          // If Free Chlorine is much lower than Total Chlorine (implies high combined chlorine)
          const totalChlorine = parseFloat(current["Total Chlorine"]);
          if (field === "Free Chlorine" && !isNaN(totalChlorine) && totalChlorine > 0 && (totalChlorine - currentVal > 0.5)) { // CC > 0.5 ppm
             needsShock = true;
          }
          // Or if Free Chlorine is zero or very low
          if (field === "Free Chlorine" && currentVal < 0.5) {
             needsShock = true;
          }
        } else {
           console.warn(`Field ${field} in targets but not in current readings.`);
        }
      }

      // Calculate shock amount if needed (Example: Target breakpoint chlorination ~ 10x CC)
      let shockResult = null;
      if (needsShock) {
         console.log("Shock treatment indicated.");
         // Example: Raise FC by ~10ppm as a shock for pool, ~5ppm for plunge (adjust as needed)
         const shockTargetPpm = system === 'pool' ? 10 : 5;
         const chlorineRate = chemicals.chlorine_up.gramsPerPpmPerGallon[system];
         const shockGrams = shockTargetPpm * volume * chlorineRate;
         const [shockAmountConverted, shockUnit] = convertGramsToUnit(shockGrams, system);
         const shockProductName = chemicals.chlorine_up.productName[system] + " (Shock Dose)"; // Modify name
         shockResult = {
             amount: shockAmountConverted,
             unit: shockUnit,
             product: shockProductName,
         };
      }

      // --- Store Readings (Consider refining what is stored) ---
      // Maybe store the calculated adjustments too?
      const readingData = {
        timestamp: admin.firestore.FieldValue.serverTimestamp(), // Use server timestamp
        system,
        userId: uid,
        readings: current, // Store the readings used for calculation
        // Optional: store targets used
        // Optional: store calculated adjustments
      };
      await db.collection("readings").add(readingData);
      console.log("Reading stored successfully");
      // --- End Store Readings ---

      const response = { adjustments };
      if (shockResult) {
        response.shock = shockResult;
      }
      console.log("Calculated Adjustments:", response);
      return res.status(200).json(response);

    } catch (error) {
      console.error("calculate error:", error);
      // Send back a more generic error in production
      return res.status(500).json({error: "Calculation failed", details: error.message });
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
