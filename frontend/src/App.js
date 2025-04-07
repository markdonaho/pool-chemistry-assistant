import React, { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword, // New import
  signOut,
  sendEmailVerification,
} from "firebase/auth";
import "./App.css";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [system, setSystem] = useState("pool");
  const [systemsData, setSystemsData] = useState(null);
  const [current, setCurrent] = useState({});
  const [adjustments, setAdjustments] = useState(null);
  const [readings, setReadings] = useState([]);
  const [showReadings, setShowReadings] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false); // New state to toggle between login and sign-up

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (!user) {
        setSystemsData(null);
        setAdjustments(null);
        setReadings([]);
        setError(null);
        setShowReadings(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      if (!user.emailVerified) {
        setError("Please verify your email to use the app. Check your inbox for a verification link.");
        return;
      }

      user.getIdToken().then((token) => {
        fetch("https://us-central1-poolchemistryassistant.cloudfunctions.net/systems", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        })
          .then((response) => {
            if (!response.ok) {
              return response.text().then((text) => {
                throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
              });
            }
            return response.json();
          })
          .then((result) => {
            console.log("Systems data fetched:", result.data);
            setSystemsData(result.data);
            const targets = result.data[system].targets;
            setCurrent(Object.fromEntries(Object.keys(targets).map((k) => [k, targets[k]])));
          })
          .catch((err) => {
            console.error("Error fetching systems:", err.message);
            setError("Failed to load system data. Please try again later.");
          });

        fetch("https://us-central1-poolchemistryassistant.cloudfunctions.net/getReadings", {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        })
          .then((response) => {
            if (!response.ok) {
              return response.text().then((text) => {
                throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
              });
            }
            return response.json();
          })
          .then((result) => {
            console.log("Readings fetched:", result.readings);
            setReadings(result.readings || []);
          })
          .catch((err) => {
            console.error("Error fetching readings:", err.message);
            setError("Failed to load readings. Please try again later.");
          });
      });
    }
  }, [user, system]);

  const handleLogin = (e) => {
    e.preventDefault();
    signInWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        setUser(userCredential.user);
        setError(null);
        if (!userCredential.user.emailVerified) {
          sendEmailVerification(userCredential.user)
            .then(() => {
              setError("Verification email sent. Please check your inbox.");
            })
            .catch((err) => {
              console.error("Error sending verification email:", err.message);
              setError("Failed to send verification email. Please try again.");
            });
        }
      })
      .catch((err) => {
        console.error("Login error:", err.message);
        setError("Login failed. Please check your credentials.");
      });
  };

  const handleSignUp = (e) => {
    e.preventDefault();
    createUserWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        setUser(userCredential.user);
        setError(null);
        sendEmailVerification(userCredential.user)
          .then(() => {
            setError("Account created! Verification email sent. Please check your inbox.");
          })
          .catch((err) => {
            console.error("Error sending verification email:", err.message);
            setError("Failed to send verification email. Please try again.");
          });
      })
      .catch((err) => {
        console.error("Sign-up error:", err.message);
        setError("Sign-up failed. " + err.message);
      });
  };

  const handleLogout = () => {
    signOut(auth)
      .then(() => {
        setUser(null);
        setError(null);
      })
      .catch((err) => {
        console.error("Logout error:", err.message);
        setError("Logout failed. Please try again.");
      });
  };

  const handleCalculate = (e) => {
    e.preventDefault();
    if (user) {
      user.getIdToken().then((token) => {
        fetch("https://us-central1-poolchemistryassistant.cloudfunctions.net/calculate", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ system, current }),
        })
          .then((response) => {
            if (!response.ok) {
              return response.text().then((text) => {
                throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
              });
            }
            return response.json();
          })
          .then((result) => {
            console.log("Adjustments calculated:", result);
            setAdjustments(result);
          })
          .catch((err) => {
            console.error("Error calculating adjustments:", err.message);
            setError("Failed to calculate adjustments. Please try again.");
          });
      });
    }
  };

  const toggleReadings = () => {
    setShowReadings(!showReadings);
  };

  if (!user) {
    return (
      <div className="App">
        <h1>Pool Chemistry Assistant</h1>
        <h2>{isSignUp ? "Sign Up" : "Login"}</h2>
        <form onSubmit={isSignUp ? handleSignUp : handleLogin}>
          <div>
            <label>Email:</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
            />
          </div>
          <div>
            <label>Password:</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
            />
          </div>
          <button type="submit">{isSignUp ? "Sign Up" : "Login"}</button>
        </form>
        <button onClick={() => setIsSignUp(!isSignUp)}>
          {isSignUp ? "Already have an account? Login" : "Need an account? Sign Up"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (!user.emailVerified) {
    return (
      <div className="App">
        <h1>Pool Chemistry Assistant</h1>
        <p>Please verify your email to use the app. Check your inbox for a verification link.</p>
        <button onClick={handleLogout}>Logout</button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="App">
      <h1>Pool Chemistry Assistant</h1>
      <button onClick={handleLogout}>Logout</button>
      {error && <p className="error">{error}</p>}
      <select value={system} onChange={(e) => setSystem(e.target.value)}>
        <option value="pool">Pool</option>
        <option value="cold_plunge">Cold Plunge</option>
      </select>
      {systemsData && (
        <form onSubmit={handleCalculate}>
          {Object.keys(systemsData[system].targets).map((field) => (
            <div key={field}>
              <label>{field} (Target: {systemsData[system].targets[field]})</label>
              <input
                type="number"
                step="any"
                value={current[field] || ""}
                onChange={(e) =>
                  setCurrent({ ...current, [field]: parseFloat(e.target.value) })
                }
                required
              />
            </div>
          ))}
          <button type="submit">Calculate Adjustments</button>
        </form>
      )}
      {adjustments && (
        <div>
          <h2>Adjustments</h2>
          {Object.entries(adjustments.adjustments).map(([field, [amount, direction, chemical]]) => (
            <p key={field}>
              {amount !== 0
                ? `Add ${amount.toFixed(2)}g of ${chemical}`
                : direction === null
                ? `${field} is on target`
                : ""}
            </p>
          ))}
          {adjustments.shock && (
            <p>Add {adjustments.shock.amount.toFixed(2)}g of {adjustments.shock.chemical}</p>
          )}
        </div>
      )}
      {readings.length > 0 && (
        <div className="readings-card">
          <button onClick={toggleReadings} className="toggle-button">
            {showReadings ? "Hide Recent Readings" : "Show Recent Readings"}
          </button>
          {showReadings && (
            <div className="readings-content">
              <h2>Recent Readings</h2>
              {readings.map((reading) => (
                <div key={reading.id} className="reading-item">
                  <p>Date: {reading.date}</p>
                  <p>System: {reading.system}</p>
                  {systemsData && Object.keys(systemsData[reading.system].targets).map((field) => (
                    <p key={field}>
                      {field}: Current {reading[`${field}_current`]}, Target {reading[`${field}_target`]}, Adjust {reading[`${field}_adjust`]}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;