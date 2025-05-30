const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({origin: true});
const sharp = require("sharp");
const Busboy = require("busboy");
const os = require("os");
const path = require("path");
const fs = require("fs");

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
      productName: "Pool Mate pH Up",
      calculationType: "tiered_ph_up", // Signal specific tiered logic
      // Base rate info for reference only
      rate: 1, rateUnit: "oz", rateVolume: 5000,
      rateVolumeUnit: "gal", ratePpmEffect: 0, // Not applicable
      outputUnit: "oz", // Will convert to lbs when needed
      // Tiered dosage rates based on pool volume and pH level
      // Format: { volume: gallons, phLevel: number, amount: oz }
      tiers: [
        {volume: 5000, phLevel: 1, amount: 2.6},
        {volume: 5000, phLevel: 2, amount: 5.1},
        {volume: 5000, phLevel: 3, amount: 7.7},
        {volume: 5000, phLevel: 4, amount: 10.3},
        {volume: 5000, phLevel: 5, amount: 12.8},
        {volume: 5000, phLevel: 6, amount: 15.4},
        {volume: 5000, phLevel: 7, amount: 17.6}, // 1.1 lbs = 17.6 oz
        {volume: 10000, phLevel: 1, amount: 5.1},
        {volume: 10000, phLevel: 2, amount: 10.3},
        {volume: 10000, phLevel: 3, amount: 15.4},
        {volume: 10000, phLevel: 4, amount: 20.8}, // 1.3 lbs = 20.8 oz
        {volume: 10000, phLevel: 5, amount: 24}, // 1.5 lbs = 24 oz
        {volume: 10000, phLevel: 6, amount: 30.4}, // 1.9 lbs = 30.4 oz
        {volume: 10000, phLevel: 7, amount: 35.2}, // 2.2 lbs = 35.2 oz
        {volume: 20000, phLevel: 1, amount: 10.3},
        {volume: 20000, phLevel: 2, amount: 20.8}, // 1.3 lbs = 20.8 oz
        {volume: 20000, phLevel: 3, amount: 30.4}, // 1.9 lbs = 30.4 oz
        {volume: 20000, phLevel: 4, amount: 40}, // 2.5 lbs = 40 oz
        {volume: 20000, phLevel: 5, amount: 51.2}, // 3.2 lbs = 51.2 oz
        {volume: 20000, phLevel: 6, amount: 62.4}, // 3.9 lbs = 62.4 oz
        {volume: 20000, phLevel: 7, amount: 72}, // 4.5 lbs = 72 oz
      ],
    },
    ph_down: {
      productName: "Clorox Pool & Spa pH Down",
      calculationType: "tiered_ph_down", // Signal specific tiered logic
      // Base rate info for reference only
      rate: 6, rateUnit: "oz", rateVolume: 10000,
      rateVolumeUnit: "gal", ratePpmEffect: 0, // Not applicable
      outputUnit: "oz",
      // Tiered dosage rates (pH ranges are upper bounds)
      tiers: [
        {maxPh: 7.6, amount: 0}, // Ideal range, no adjustment
        {maxPh: 7.8, amount: 6}, // pH 7.7-7.8
        {maxPh: 8.0, amount: 12}, // pH 7.9-8.0
        {maxPh: 8.4, amount: 20}, // pH 8.1-8.4
        {maxPh: 99.9, amount: 24}, // pH Above 8.4
      ],
    },
    alkalinity_up: {
      productName: "Pool Alkalinity Increaser (Sodium Bicarbonate)",
      // Based on ~1.5 lbs per 10ppm per 10k gal
      rate: 1.5, rateUnit: "lbs", rateVolume: 10000,
      rateVolumeUnit: "gal", ratePpmEffect: 10,
      outputUnit: "lbs",
    },
    hardness_up: {
      productName: "Pool Mate Premium Calcium Hardness Increaser",
      calculationType: "tiered_hardness_up", // Signal tiered logic
      // Base rate: 1.6 oz per 1 ppm per 10k gal (matches chart)
      outputUnit: "lbs", // Dosage chart uses lbs primarily
      // Tiered dosage rates based on pool volume and desired PPM increase
      // Format: { volume: gallons, increasePpm: ppm, amountLbs: lbs }
      tiers: [
        // 5,000 Gallons
        {volume: 5000, increasePpm: 10, amountLbs: 0.5}, // 8 oz
        {volume: 5000, increasePpm: 20, amountLbs: 1},
        {volume: 5000, increasePpm: 30, amountLbs: 1.5}, // 1 lb 8 oz
        {volume: 5000, increasePpm: 40, amountLbs: 2},
        {volume: 5000, increasePpm: 60, amountLbs: 3},
        {volume: 5000, increasePpm: 80, amountLbs: 4},
        {volume: 5000, increasePpm: 100, amountLbs: 5},
        // 10,000 Gallons
        {volume: 10000, increasePpm: 10, amountLbs: 1},
        {volume: 10000, increasePpm: 20, amountLbs: 2},
        {volume: 10000, increasePpm: 30, amountLbs: 3},
        {volume: 10000, increasePpm: 40, amountLbs: 4},
        {volume: 10000, increasePpm: 60, amountLbs: 6},
        {volume: 10000, increasePpm: 80, amountLbs: 8},
        {volume: 10000, increasePpm: 100, amountLbs: 10},
        // 20,000 Gallons
        {volume: 20000, increasePpm: 10, amountLbs: 2},
        {volume: 20000, increasePpm: 20, amountLbs: 4},
        {volume: 20000, increasePpm: 30, amountLbs: 7},
        {volume: 20000, increasePpm: 40, amountLbs: 8},
        {volume: 20000, increasePpm: 60, amountLbs: 12},
        {volume: 20000, increasePpm: 80, amountLbs: 16},
        {volume: 20000, increasePpm: 100, amountLbs: 20},
      ],
    },
    chlorine_up: {
      productName: "HTH 3\" Chlorine Tabs",
      calculationType: "check_feeder_tabs", // Signal action-based logic
      rate: 1, rateUnit: "tab", rateVolume: 10000, // For reference
      rateVolumeUnit: "gal", ratePpmEffect: 0, // Not used for calculation
      outputUnit: "tab(s)",
    },
    cya_up: {
      productName: "Clorox Pool & Spa Chlorine Stabilizer",
      calculationType: "tiered_cya_up", // Signal specific tiered logic
      // Base rate info for reference only
      rate: 1, rateUnit: "lbs", rateVolume: 4000,
      rateVolumeUnit: "gal", ratePpmEffect: 0, // Not applicable
      outputUnit: "lbs",
      // Tiered dosage rates based on pool volume and target CYA
      // Format: { volume: gallons, targetCya: ppm, amount: lbs }
      tiers: [
        {volume: 4000, targetCya: 10, amount: 0.33}, // 5.3 oz
        {volume: 4000, targetCya: 15, amount: 0.5}, // 8 oz
        {volume: 4000, targetCya: 30, amount: 1},
        {volume: 12000, targetCya: 10, amount: 1},
        {volume: 12000, targetCya: 15, amount: 1.5},
        {volume: 12000, targetCya: 30, amount: 3},
        {volume: 15000, targetCya: 10, amount: 1.25},
        {volume: 15000, targetCya: 15, amount: 1.875},
        {volume: 15000, targetCya: 30, amount: 3.75},
        {volume: 15000, targetCya: 40, amount: 5},
        {volume: 16000, targetCya: 10, amount: 1.2},
        {volume: 16000, targetCya: 15, amount: 2},
        {volume: 16000, targetCya: 30, amount: 4},
      ],
    },
    // Entry for Pool Shock Treatment
    shock_treatment: {
      productName: "HTH Shock Advanced",
      calculationType: "fixed_rate_shock", // Explicitly define shock calc
      // Dosage: 1 lb (1 bag) / 13,500 gal
      rate: 1, rateUnit: "lbs", rateVolume: 13500,
      rateVolumeUnit: "gal", ratePpmEffect: 0, // Not ppm based
      outputUnit: "lbs", // Recommend in lbs
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
    if (dosageInfo.calculationType ===
      "check_feeder_tabs" && currentVal < targetVal) {
      console.log(`Low pool FC (${
        currentVal} ppm), recommending check/add HTH 3" Tabs.`);
      // Return nominal unit; formatting function provides real instructions
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
  } else if (field === "pH" && system === "pool" && direction === "up") {
    console.log(`Calculating Pool Mate pH Up for current pH: ${currentVal}`);
    const dosageInfo = chemicalDosages.pool.ph_up;
    if (dosageInfo.calculationType === "tiered_ph_up") {
      // Determine ACTUAL pH difference needed
      const phDiff = targetVal - currentVal;
      console.log(
          `Target pH: ${targetVal}, Current pH: ${currentVal}, 
        Actual pH Difference (phDiff): ${phDiff.toFixed(1)}`);

      if (phDiff <= 0) return null; // No increase needed

      // Determine levels to interpolate between based on phDiff
      // User interpretation: Level X increases pH by X.0 points
      const lowerLevel = Math.floor(phDiff); // e.g., 2 for phDiff 2.4
      const upperLevel = Math.ceil(phDiff); // e.g., 3 for phDiff 2.4

      // Cap levels at chart bounds (0 to 7)
      const boundedLowerLevel = Math.max(0, Math.min(7, lowerLevel));
      const boundedUpperLevel = Math.max(1, Math.min(7, upperLevel));

      console.log(
          `Interpolating dosage between chart Level ${boundedLowerLevel}
         and Level ${boundedUpperLevel} based on phDiff ${phDiff.toFixed(1)}`);

      // --- Helper Function to Get Dose for Specific Level & Volume ---
      const getDosageOz = (level, volume) => {
        if (level === 0) return 0; // Base case: Level 0 = 0 dose

        const levelTiers = dosageInfo.tiers.filter((t) => t.phLevel === level);
        if (levelTiers.length === 0) {
          console.warn(
              `No dosage tiers found for level ${level}. Cannot calculate.`);
          return null; // Indicate failure
        }

        // Sort tiers by volume to allow interpolation
        levelTiers.sort((a, b) => a.volume - b.volume);

        // Find tiers that bracket the target volume
        let lowerVolTier = null;
        let upperVolTier = null;
        for (const tier of levelTiers) {
          if (tier.volume <= volume) {
            lowerVolTier = tier;
          }
          if (tier.volume >= volume && !upperVolTier) {
            upperVolTier = tier;
          }
        }
        // Handle edge cases where volume is outside tier range
        if (!lowerVolTier) lowerVolTier = levelTiers[0];
        if (!upperVolTier) upperVolTier = levelTiers[levelTiers.length - 1];

        if (lowerVolTier.volume === upperVolTier.volume) {
          console.log(
              `  Level ${level}: Exact match or single tier found:
           ${lowerVolTier.amount} oz for ${volume} gal`);
          return lowerVolTier.amount; // Amount is in oz
        }

        // Interpolate amount based on volume
        const volRange = upperVolTier.volume - lowerVolTier.volume;
        const amountRange = upperVolTier.amount - lowerVolTier.amount;
        const volPosition = (
        volRange === 0) ? 0 : (volume - lowerVolTier.volume) / volRange;
        const interpolatedAmountOz =
        lowerVolTier.amount + (amountRange * volPosition);

        console.log(
            `  Level ${level}: Interpolated ${interpolatedAmountOz.toFixed(2)}
         oz for ${volume} gal 
         (based on ${lowerVolTier.volume}gal/${lowerVolTier.amount}oz
          and ${upperVolTier.volume}gal/${upperVolTier.amount}oz)`);
        return interpolatedAmountOz;
      };
      // --- End Helper Function ---

      // Get the volume-interpolated dosages for the lower and upper pH levels
      const lowerLevelDosageOz = getDosageOz(boundedLowerLevel, volumeGallons);
      const upperLevelDosageOz = getDosageOz(boundedUpperLevel, volumeGallons);

      if (lowerLevelDosageOz === null || upperLevelDosageOz === null) {
        console.error("Failed to get dosages for interpolation levels.");
        return null; // Cannot proceed if helper failed
      }

      // Interpolate between the two level dosages based on phDiff decimal part
      let finalAmountOz;
      if (boundedLowerLevel === boundedUpperLevel) {
        finalAmountOz = lowerLevelDosageOz;
      } else {
        const levelRange = boundedUpperLevel - boundedLowerLevel;
        const levelPosition = (levelRange === 0) ? 0 :
        (phDiff - boundedLowerLevel) / levelRange;
        finalAmountOz = lowerLevelDosageOz +
        ( (upperLevelDosageOz - lowerLevelDosageOz) * levelPosition );
        console.log(
            `Final pH Level Interpolation: ${lowerLevelDosageOz.toFixed(2)}oz
         (L${boundedLowerLevel}) + [(${upperLevelDosageOz.toFixed(2)}oz
          (L${boundedUpperLevel}) - ${lowerLevelDosageOz.toFixed(2)}oz)
           * ${levelPosition.toFixed(2)}] = ${finalAmountOz.toFixed(2)} oz`);
      }

      let finalAmount;
      let finalUnit;

      // Convert to lbs if amount is 16 oz or more, round appropriately
      if (finalAmountOz >= 16) {
        finalAmount = Math.round((finalAmountOz / 16) * 10) / 10;
        finalUnit = "lbs";
      } else {
        finalAmount = Math.round(finalAmountOz * 10) / 10;
        finalUnit = "oz";
      }
      console.log(
          `Calculated Pool Mate pH Up Dose: ${finalAmount} ${finalUnit}`);

      // Return the calculated dose based on interpolation
      return [finalAmount, finalUnit, "up", dosageInfo.productName];
    }
  } else if (field === "pH" && system === "pool" && direction === "down") {
    console.log(`Calculating Clorox pH Down for current pH: ${currentVal}`);
    const dosageInfo = chemicalDosages.pool.ph_down;
    if (dosageInfo.calculationType === "tiered_ph_down") {
      // Find the appropriate tier based on current pH
      const tier = dosageInfo.tiers.find((t) => currentVal <= t.maxPh);
      if (tier && tier.amount > 0) {
        const volumeRatio = volumeGallons / dosageInfo.rateVolume;
        const totalDosageNeeded = tier.amount * volumeRatio;
        // Round to nearest 0.5 oz
        const finalAmount = Math.round(totalDosageNeeded * 2) / 2;
        console.log(`Calculated Clorox pH Down Dose: ${finalAmount} oz`);
        return [finalAmount, dosageInfo.outputUnit,
          "down", dosageInfo.productName];
      } else {
        console.log("Pool pH is in ideal range, no adjustment needed.");
        return null;
      }
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
  } else if (
    field === "Cyanuric Acid" && system === "pool" && direction === "up") {
    console.log(`Calculating Clorox Stabilizer for current CYA: ${currentVal}`);
    const dosageInfo = chemicalDosages.pool.cya_up;
    if (dosageInfo.calculationType === "tiered_cya_up") {
      const getCYADosageLbs = (targetPpm, volume) => {
        if (targetPpm <= 0) return 0; // Base case

        // Find PPM tiers that bracket the targetPpm
        const allPpmLevels = [
          ...new Set(dosageInfo.tiers.map(
              (t) => t.targetCya))].sort((a, b) => a - b);
        let lowerPpmTierVal = 0;
        let upperPpmTierVal = allPpmLevels[allPpmLevels.length - 1];

        for (const ppm of allPpmLevels) {
          if (ppm <= targetPpm) {
            lowerPpmTierVal = ppm;
          }
          if (ppm >= targetPpm) {
            upperPpmTierVal = ppm;
            break; // Found the upper bound
          }
        }
        // Handle targetPpm lower than the lowest defined tier PPM
        if (targetPpm < allPpmLevels[0]) {
          upperPpmTierVal = allPpmLevels[0];
        }

        console.log(
            `  [getCYADosageLbs] Target PPM ${targetPpm}
          : Interpolating between ${lowerPpmTierVal}
          ppm and ${upperPpmTierVal}ppm tiers.`);

        const getVolumeInterpolatedDose = (ppmLevel) => {
          if (ppmLevel === 0) return 0; // Dose for 0 ppm is 0
          const levelTiers =
          dosageInfo.tiers.filter((t) => t.targetCya ===
           ppmLevel).sort((a, b)=> a.volume - b.volume);
          if (levelTiers.length === 0) return null;

          let lowerVolTier = levelTiers[0];
          let upperVolTier = levelTiers[levelTiers.length - 1];
          for (const tier of levelTiers) {
            if (tier.volume <= volume) lowerVolTier = tier;
            if (tier.volume >= volume) {
              upperVolTier = tier;
              break;
            }
          }

          if (lowerVolTier.volume ===
            upperVolTier.volume) return lowerVolTier.amount;

          const volRange = upperVolTier.volume - lowerVolTier.volume;
          const amountRange = upperVolTier.amount - lowerVolTier.amount;
          const volPosition =
          (volRange === 0) ? 0 : (volume - lowerVolTier.volume) / volRange;
          const interpolatedAmount =
          lowerVolTier.amount + (amountRange * volPosition);
          console.log(
              `    [getCYADosageLbs] Volume Interp for ${ppmLevel}
            ppm @ ${volume}gal: ${interpolatedAmount.toFixed(3)} lbs`);
          return interpolatedAmount;
        };
        // --- End Inner Helper ---

        const lowerPpmDose = getVolumeInterpolatedDose(lowerPpmTierVal);
        const upperPpmDose = getVolumeInterpolatedDose(upperPpmTierVal);

        if (lowerPpmDose === null || upperPpmDose === null) {
          console.error(
              `Could not get volume interpolated doses for PPM 
            levels ${lowerPpmTierVal} or ${upperPpmTierVal}`);
          return null;
        }

        // Interpolate between the PPM level dosages
        if (lowerPpmTierVal === upperPpmTierVal) {
          return lowerPpmDose;
        } // Exact PPM match

        const ppmRange = upperPpmTierVal - lowerPpmTierVal;
        const ppmPosition =
        (ppmRange === 0) ? 0 : (targetPpm - lowerPpmTierVal) / ppmRange;
        const finalInterpolatedDose =
        lowerPpmDose + ( (upperPpmDose - lowerPpmDose) * ppmPosition );
        console.log(
            `  [getCYADosageLbs] Final Dose for ${targetPpm}ppm @ ${volume}
          gal: ${finalInterpolatedDose.toFixed(3)} lbs`);
        return finalInterpolatedDose;
      };
      // --- End Helper Function ---

      const totalLbsForTarget = getCYADosageLbs(targetVal, volumeGallons);
      const totalLbsForCurrent = getCYADosageLbs(currentVal, volumeGallons);

      if (totalLbsForTarget === null || totalLbsForCurrent === null) {
        console.error(
            "Failed to calculate total CYA dosages for target or current PPM.");
        return null; // Cannot calculate adjustment
      }

      let adjustmentNeeded = totalLbsForTarget - totalLbsForCurrent;

      adjustmentNeeded = Math.max(0, adjustmentNeeded);

      if (adjustmentNeeded < 0.05) { // Threshold for negligible amount
        console.log("Calculated CYA adjustment is negligible.");
        return null;
      }

      // Round final adjustment to nearest 0.1 lbs
      const finalAmount = Math.round(adjustmentNeeded * 10) / 10;

      console.log(
          `Calculated CYA Adjustment: ${finalAmount}
         lbs (Target: ${totalLbsForTarget.toFixed(2)}
          lbs - Current: ${totalLbsForCurrent.toFixed(2)} lbs)`);
      return [finalAmount, dosageInfo.outputUnit, "up", dosageInfo.productName];
    }
  } else if (
    field === "Total Hardness" && system === "pool" && direction === "up") {
    console.log(
        `Calculating Pool Mate Hardness Increaser current: ${currentVal} ppm`);
    const dosageInfo = chemicalDosages.pool.hardness_up;
    if (dosageInfo.calculationType === "tiered_hardness_up") {
      const getHardnessDosageLbs = (targetPpm, volume) => {
        const requiredPpmIncrease = targetPpm;
        if (requiredPpmIncrease <= 0) return 0;

        // Find PPM Increase tiers that bracket the requiredPpmIncrease
        const allPpmIncreaseLevels =
        [...new Set(dosageInfo.tiers.map((t) => t.increasePpm))].sort(
            (a, b) => a - b);
        let lowerPpmTierVal = 0;
        let upperPpmTierVal =
        allPpmIncreaseLevels[allPpmIncreaseLevels.length - 1]; // Default to max

        for (const ppm of allPpmIncreaseLevels) {
          if (ppm <= requiredPpmIncrease) {
            lowerPpmTierVal = ppm;
          }
          if (ppm >= requiredPpmIncrease) {
            upperPpmTierVal = ppm;
            break;
          }
        }
        if (requiredPpmIncrease < allPpmIncreaseLevels[0]) {
          upperPpmTierVal = allPpmIncreaseLevels[0];
        }

        console.log(
            `  [getHardnessDosageLbs] Required PPM 
            Increase ${requiredPpmIncrease}
          : Interpolating between ${lowerPpmTierVal}ppm and ${upperPpmTierVal}
          ppm increase tiers.`);


        const getVolumeInterpolatedDose = (ppmIncreaseLevel) => {
          if (ppmIncreaseLevel === 0) return 0;
          const levelTiers =
          dosageInfo.tiers.filter((t) => t.increasePpm ===
          ppmIncreaseLevel).sort((a, b)=> a.volume - b.volume);
          if (levelTiers.length === 0) return null;

          let lowerVolTier = levelTiers[0];
          let upperVolTier = levelTiers[levelTiers.length - 1];
          for (const tier of levelTiers) {
            if (tier.volume <= volume) lowerVolTier = tier;
            if (tier.volume >= volume) {
              upperVolTier = tier; break;
            }
          }

          if (lowerVolTier.volume ===
            upperVolTier.volume) return lowerVolTier.amountLbs;

          const volRange = upperVolTier.volume - lowerVolTier.volume;
          const amountRange = upperVolTier.amountLbs - lowerVolTier.amountLbs;
          const volPosition =
          (volRange === 0) ? 0 : (volume - lowerVolTier.volume) / volRange;
          const interpolatedAmount =
          lowerVolTier.amountLbs + (amountRange * volPosition);
          console.log(
              `    [getHardnessDosageLbs] Volume Interp for ${ppmIncreaseLevel}
            ppm increase @ ${volume}gal: ${interpolatedAmount.toFixed(3)} lbs`);
          return interpolatedAmount;
        };
          // --- End Inner Helper ---

        const lowerPpmDose = getVolumeInterpolatedDose(lowerPpmTierVal);
        const upperPpmDose = getVolumeInterpolatedDose(upperPpmTierVal);

        if (lowerPpmDose === null || upperPpmDose === null) {
          console.error(
              `Could not get volume interpolated doses for PPM increase
             levels ${lowerPpmTierVal} or ${upperPpmTierVal}`);
          return null;
        }

        // Interpolate between the PPM level dosages
        if (lowerPpmTierVal === upperPpmTierVal) return lowerPpmDose;

        const ppmRange = upperPpmTierVal - lowerPpmTierVal;
        const ppmPosition =
        (ppmRange === 0) ? 0 : (
          requiredPpmIncrease - lowerPpmTierVal) / ppmRange;
        const finalInterpolatedDose =
        lowerPpmDose + ( (upperPpmDose - lowerPpmDose) * ppmPosition );
        console.log(
            `  [getHardnessDosageLbs] Final Dose for ${requiredPpmIncrease}ppm
             increase @ ${volume}gal: ${finalInterpolatedDose.toFixed(3)} lbs`);
        return finalInterpolatedDose;
      };
        // --- End Helper Function ---

      // Calculate the actual PPM increase needed
      const ppmIncreaseNeeded = targetVal - currentVal;
      if (ppmIncreaseNeeded <= 0) {
        console.log("Pool Hardness does not need increase.");
        return null;
      }

      const totalLbsNeeded =
      getHardnessDosageLbs(ppmIncreaseNeeded, volumeGallons);

      if (totalLbsNeeded === null) {
        console.error("Failed to calculate total Hardness dosage.");
        return null;
      }

      if (totalLbsNeeded < 0.05) { // Threshold for negligible amount
        console.log("Calculated Hardness adjustment is negligible.");
        return null;
      }

      // Round final adjustment to nearest 0.1 lbs
      const finalAmount = Math.round(totalLbsNeeded * 10) / 10;

      console.log(
          `Calculated Hardness Adjustment: ${finalAmount}
        lbs for ${ppmIncreaseNeeded.toFixed(0)} ppm increase`);
      return [finalAmount, dosageInfo.outputUnit, "up", dosageInfo.productName];
    }
  }
  // --- End New Block ---

  // --- Standard PPM Calculation Logic (Fallback) ---
  // Find the chemical key for standard adjustments
  let chemicalKey = null;
  if (field === "Total Alkalinity" && direction === "up") {
    chemicalKey = "alkalinity_up";
  } else if (field === "Total Hardness" && direction === "up") {
    // ** REMOVE standard hardness calculation if tiered exists **
    // chemicalKey = "hardness_up";
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

// --- Test Strip Color Definitions ---

// Pre-calculated LAB values for color matching
const COLOR_KEY = {
    "Total Hardness": [
        {"lab": [47, -11, 5], "value": 0},
        {"lab": [46, 12, -1], "value": 25},
        {"lab": [46, 19, 0], "value": 50},
        {"lab": [49, 19, -1], "value": 120},
        {"lab": [51, 24, 0], "value": 250},
        {"lab": [52, 29, 1], "value": 425}
    ],
    "Total Chlorine": [
        {"lab": [99, -6, 26], "value": 0},
        {"lab": [98, -11, 23], "value": 0.5},
        {"lab": [93, -14, 23], "value": 1},
        {"lab": [89, -19, 27], "value": 3},
        {"lab": [84, -21, 25], "value": 5},
        {"lab": [76, -29, 10], "value": 10},
        {"lab": [72, -32, 6], "value": 20}
    ],
    "Free Chlorine": [
        {"lab": [100, 0, 0], "value": 0}, // Theoretical white
        {"lab": [96, 7, -1], "value": 0.5},
        {"lab": [91, 14, -1], "value": 1},
        {"lab": [73, 35, -10], "value": 3},
        {"lab": [59, 41, -10], "value": 5},
        {"lab": [52, 34, -4], "value": 10},
        {"lab": [46, 29, -3], "value": 20}
    ],
    "Bromine": [
        {"lab": [100, 0, 0], "value": 0}, // Theoretical white
        {"lab": [96, 7, -1], "value": 1},
        {"lab": [91, 14, -1], "value": 2},
        {"lab": [73, 35, -10], "value": 6},
        {"lab": [59, 41, -10], "value": 10},
        {"lab": [52, 34, -4], "value": 20},
        {"lab": [46, 29, -3], "value": 40}
    ],
    "Total Alkalinity": [
        {"lab": [96, -5, 32], "value": 0},
        {"lab": [93, -24, 25], "value": 40},
        {"lab": [80, -29, 24], "value": 80},
        {"lab": [67, -32, 18], "value": 120},
        {"lab": [57, -30, 8], "value": 180},
        {"lab": [47, -26, 2], "value": 240},
        {"lab": [40, -21, 0], "value": 360}
    ],
    "Cyanuric Acid": [
        {"lab": [86, 10, 26], "value": 0},
        {"lab": [83, 11, 25], "value": 40}, // Simplified 30-50
        {"lab": [79, 14, 26], "value": 100},
        {"lab": [76, 16, 25], "value": 150},
        {"lab": [72, 19, 23], "value": 240}
    ],
     "pH": [
        {"lab": [79, 25, 29], "value": 6.2},
        {"lab": [75, 30, 32], "value": 6.8},
        {"lab": [71, 36, 34], "value": 7.2},
        {"lab": [66, 42, 36], "value": 7.8},
        {"lab": [61, 48, 37], "value": 8.4},
        {"lab": [57, 52, 37], "value": 9.0}
    ]
};

const NORMAL_RANGES = {
    "Total Hardness": {"min": 120, "max": 250},
    "Total Chlorine": {"min": 1, "max": 5},
    "Free Chlorine": {"min": 1, "max": 5},
    "Bromine": {"min": 2, "max": 10},
    "Total Alkalinity": {"min": 80, "max": 120},
    "Cyanuric Acid": {"min": 30, "max": 100}, // Covers 40 and 100 blocks
    "pH": {"min": 7.2, "max": 7.8}
};

const PAD_ORDER = [
    "Total Hardness", "Total Chlorine", "Free Chlorine", "pH",
    "Total Alkalinity", "Cyanuric Acid", "Bromine"
];
const NUM_PADS = PAD_ORDER.length;

/**
 * Calculates the Euclidean distance between two LAB colors.
 * @param {number[]} lab1 First LAB color [L, a, b].
 * @param {number[]} lab2 Second LAB color [L, a, b].
 * @return {number} The distance.
 */
function calculateLabDistance(lab1, lab2) {
  if (!lab1 || !lab2 || lab1.length !== 3 || lab2.length !== 3) {
    return Infinity;
  }
  return Math.sqrt(
      Math.pow(lab1[0] - lab2[0], 2) + // L
      Math.pow(lab1[1] - lab2[1], 2) + // a
      Math.pow(lab1[2] - lab2[2], 2)   // b
  );
}

/**
 * Finds the closest color match in the COLOR_KEY for a given parameter.
 * @param {number[]} sampledLab The sampled LAB color [L, a, b].
 * @param {string} parameterName The name of the parameter (e.g., "pH").
 * @return {object} Result containing value, distance, or error.
 */
async function matchColor(sampledLab, parameterName) {
  // Dynamically import color-convert here
  const convert = (await import('color-convert')).default;

  const parameterKey = COLOR_KEY[parameterName];
  if (!parameterKey) {
    console.error(`No color key found for parameter: ${parameterName}`);
    return {value: null, distance: null, error: `Missing color key`};
  }
  if (!sampledLab) {
    return {value: null, distance: null, error: "Invalid sample color"};
  }

  let minDistance = Infinity;
  let closestMatch = null;

  for (const entry of parameterKey) {
    const distance = calculateLabDistance(sampledLab, entry.lab);
    if (distance < minDistance) {
      minDistance = distance;
      closestMatch = entry;
    }
  }

  if (closestMatch) {
    console.log(`Color match for ${parameterName}: Value=${closestMatch.value}, Dist=${minDistance.toFixed(2)}`);
    // Basic matching, no interpolation for now
    return {value: closestMatch.value, distance: minDistance};
  } else {
    console.error(`Could not find any color match for ${parameterName}`);
    return {value: null, distance: null, error: "No color match found"};
  }
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
            const baseDose = shockDosageInfo.rate; // e.g., 1
            const doseVolume = shockDosageInfo.rateVolume; // e.g., 13500
            const outputUnit = shockDosageInfo.outputUnit; // e.g., "lbs"

            const volumeRatio = volume / doseVolume; // e.g., 15000 / 13500
            const totalDosageNeeded = baseDose * volumeRatio;

            // Convert units if rateUnit differs from outputUnit
            let finalAmount = totalDosageNeeded;
            const finalUnit = outputUnit;

            // Rounding logic
            if (["tsp", "tbsp"].includes(finalUnit.toLowerCase())) {
              finalAmount = Math.max(0.25, Math.round(finalAmount * 4) / 4);
            } else if (["lbs", "oz"].includes(finalUnit.toLowerCase())) {
              // For shock, always round up to nearest 0.5 lbs
              finalAmount = Math.max(1, Math.ceil(finalAmount * 2) / 2);
            }

            // Always recommend shock if needed
            shockResult = {
              amount: finalAmount,
              unit: finalUnit,
              product: shockDosageInfo.productName,
            };
            console.log("Calculated Shock Dose:", shockResult);
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
