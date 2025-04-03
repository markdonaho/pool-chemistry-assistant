const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const systems = {
  cold_plunge: {
    volume: 126,
    targets: {
      "Total Hardness": 150,
      "Total Chlorine": 3,
      "Free Chlorine": 2,
      "Bromine": 4,
      "Total Alkalinity": 120,
      "Cyanuric Acid": 0,
      "pH": 7.4,
    },
  },
  pool: {
    volume: 15000,
    targets: {
      "Total Hardness": 300,
      "Total Chlorine": 3,
      "Free Chlorine": 3,
      "Total Alkalinity": 100,
      "Cyanuric Acid": 40,
      "pH": 7.4,
    },
  },
};

const rates = {
  cold_plunge: {
    "Total Hardness": {up: 15 / 100, down: 0},
    "Total Chlorine": {up: 2.5 / 100, down: 0},
    "Free Chlorine": {up: 2.5 / 100, down: 0},
    "Bromine": {up: 0, down: 0},
    "Total Alkalinity": {up: 15 / 100, down: 0},
    "Cyanuric Acid": {up: 0, down: 0},
    "pH": {up: 5 / 100 / 0.2, down: 5 / 100 / 0.2},
  },
  pool: {
    "Total Hardness": {up: 0.0068, down: 0},
    "Total Chlorine": {up: 0.004, down: 0},
    "Free Chlorine": {up: 0.004, down: 0},
    "Bromine": {up: 0, down: 0},
    "Total Alkalinity": {up: 0.0068, down: 0},
    "Cyanuric Acid": {up: 0.0453, down: 0},
    "pH": {up: 0.425, down: 0.0525},
  },
};

/**
 * Calculates adjustment for a given field based on current and target values.
 * @param {number} current - The current value of the field.
 * @param {number} target - The target value of the field.
 * @param {number} volume - The volume of the system.
 * @param {number} rateUp - The rate to increase the field.
 * @param {number} rateDown - The rate to decrease the field.
 * @param {string} field - The name of the field.
 * @return {Array} - [adjustment, direction, chemical]
 */
function calculateAdjustment(current, target, volume, rateUp, rateDown, field) {
  const difference = target - current;
  if (difference > 0) {
    const adjustment = difference * volume * rateUp;
    const direction = "up";
    const chemical = field.includes("pH") ?
        "pH Increaser" :
        field.includes("Chlorine") ?
        "Chlorinating Concentrate" :
        `${field} Increaser`;
    return [adjustment, direction, chemical];
  } else if (difference < 0) {
    const adjustment = -difference * volume * rateDown;
    const direction = "down";
    const chemical = field.includes("pH") ? "pH Decreaser" : `${field} Reducer`;
    return [adjustment, direction, chemical];
  } else {
    return [0, null, null];
  }
}

exports.systems = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Auth required");
  }
  return systems;
});

exports.calculate = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Auth required");
  }
  if (!data.system || !data.current) {
    throw new functions.https.HttpsError(
        "invalid-argument", "System readings required");
  }

  const {system, current} = data;
  const volume = systems[system].volume;
  const targets = systems[system].targets;
  const systemRates = rates[system];

  const adjustments = {};
  let needsShock = false;
  let shockAmount = 0;

  for (const field in targets) {
    if (Object.prototype.hasOwnProperty.call(targets, field)) {
      const adj = calculateAdjustment(
          current[field],
          targets[field],
          volume,
          systemRates[field].up,
          systemRates[field].down,
          field,
      );
      if (adj && field.includes("Chlorine") && adj[1] === "down") {
        needsShock = true;
        shockAmount = Math.max(shockAmount, (28 / 500) * volume);
        adjustments[field] = [0, null, null];
      } else {
        adjustments[field] = adj[0] !== 0 ? adj : [0, null, null];
      }
    }
  }

  // Save to Firestore
  await db.collection("readings").add({
    date: new Date().toISOString().split("T")[0],
    system,
    volume,
    ...Object.fromEntries(
        Object.keys(targets).flatMap((field) => [
          [`${field}_current`, current[field]],
          [`${field}_target`, targets[field]],
          [`${field}_adjust`, adjustments[field][0]],
        ]),
    ),
  });

  const response = {adjustments};
  if (needsShock) {
    response.shock = {amount: shockAmount, chemical: "Enhanced Shock"};
  }
  return response;
});
