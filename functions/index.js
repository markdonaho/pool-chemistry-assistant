const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({origin: true});

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
 * Validates the Firebase ID token from the Authorization header.
 * @param {string} authHeader - The Authorization header.
 * @return {Promise<string>} - The user's UID if valid.
 * @throws {Error} - If the token is invalid or missing.
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
 * Calculates adjustment for a given field based on current and target values.
 * @param {number} current - The current value.
 * @param {number} target - The target value.
 * @param {number} volume - The volume of the system.
 * @param {number} rateUp - The rate of increase.
 * @param {number} rateDown - The rate of decrease.
 * @param {string} field - The field name.
 * @return {[number, string, string]} - An array containing the adjust amount,
 *                                      direction (up/down), and chemical name.
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

      if (!system || !current) {
        return res.status(400).json({error: "System and readings required"});
      }

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

      await db.collection("readings").add({
        date: new Date().toISOString().split("T")[0],
        system,
        volume,
        userId: uid,
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
      return res.status(200).json(response);
    } catch (error) {
      console.error("calculate: Error:", error.message);
      return res.status(401).json({error: "Unauthorized",
        details: error.message});
    }
  });
});

exports.getReadings = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "GET") {
      return res.status(405).json({error: "Method not allowed. Use GET."});
    }

    try {
      const uid = await validateToken(req.headers.authorization);
      const readingsSnapshot = await admin.firestore()
          .collection("readings")
          .where("userId", "==", uid)
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
