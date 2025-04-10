import React, { useState, useEffect } from "react";
import { useNavigate, Routes, Route, Navigate } from "react-router-dom";
import { getAuth, signOut } from "firebase/auth";
import { getFirestore, collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { useTestStrip } from "../context/TestStripContext";
import TestStripUpload from "./TestStripUpload";
import TestStripResults from "./TestStripResults";

const AppContent = () => {
  const navigate = useNavigate();
  const auth = getAuth();
  const db = getFirestore();
  const { detectedReadings } = useTestStrip();

  const [system, setSystem] = useState("pool");
  const [current, setCurrent] = useState({
    volume: 0,
    'pH': 7.2,
    'Total Alkalinity': 100,
    'Total Hardness': 200,
    'Cyanuric Acid': 30,
    'Free Chlorine': 1.0,
    'Total Chlorine': 1.0,
    'Bromine': 0
  });
  const [adjustments, setAdjustments] = useState(null);
  const [readings, setReadings] = useState([]);
  const [showReadings, setShowReadings] = useState(false);
  const [loadingReadings, setLoadingReadings] = useState(false);
  const [readingsError, setReadingsError] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (detectedReadings) {
      console.log('Updating dashboard form with detected readings (Title Case):', detectedReadings);
      setCurrent(prevCurrent => {
        const updated = { ...prevCurrent };
        for (const key in detectedReadings) {
          if (key in updated) {
            updated[key] = detectedReadings[key] ?? updated[key];
          }
        }
        return updated;
      });
    }
  }, [detectedReadings]);

  useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      const newVolume = system === 'pool' ? 15000 : 124;
      setCurrent(prev => ({
        ...prev,
        volume: prev.volume === 0 || 
                (system === 'pool' && prev.volume === 124) || 
                (system === 'cold_plunge' && prev.volume === 15000) 
                ? newVolume : prev.volume
      }));

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
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
          })
          .then((result) => {
            console.log("Systems data fetched, targets available but not merged into form state:", result.data);
          })
          .catch((err) => {
            console.error("Error fetching systems:", err.message);
            setError("Failed to load system data. Please try again later.");
          });
      });
    }
  }, [system, auth]);

  useEffect(() => {
    const fetchReadings = async () => {
      const currentUser = auth.currentUser;
      if (showReadings && currentUser) {
        console.log(`Fetching readings for user: ${currentUser.uid}`);
        setLoadingReadings(true);
        setReadingsError(null);
        setReadings([]);

        try {
          const readingsCol = collection(db, "readings");
          console.log("Executing query: Order by timestamp desc, limit 20");
          const q = query(
            readingsCol, 
            orderBy("timestamp", "desc"), 
            limit(20) 
          );
          
          const querySnapshot = await getDocs(q);
          console.log(`Query returned ${querySnapshot.size} documents`);

          const userReadings = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          console.log("Mapped readings:", userReadings);

          setReadings(userReadings);
        } catch (err) {
          console.error("Error fetching previous readings:", err);
          setReadingsError("Failed to load previous readings. Please try again later.");
        } finally {
          setLoadingReadings(false);
        }
      }
    };

    fetchReadings();
  }, [showReadings, auth, db]);

  const handleLogout = () => {
    signOut(auth)
      .then(() => {
        navigate('/');
      })
      .catch((err) => {
        console.error("Logout error:", err.message);
        setError("Logout failed. Please try again.");
      });
  };

  const handleCalculate = (e) => {
    e.preventDefault();
    const user = auth.currentUser;
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
            setError(null);
          })
          .catch((err) => {
            console.error("Error calculating adjustments:", err.message);
            setError("Failed to calculate adjustments. Please try again.");
          });
      });
    }
  };

  const toggleReadings = () => {
    setShowReadings(prev => !prev);
  };

  return (
    <div className="App">
      <header>
        <h1>Pool Chemistry Assistant</h1>
        <button onClick={handleLogout}>Logout</button>
      </header>

      <nav>
        <button onClick={() => navigate('/')}>Dashboard</button>
        <button onClick={() => navigate('/test-strip/upload')}>Test Strip</button>
      </nav>

      <Routes>
        <Route path="/" element={
          <div className="dashboard">
            <div className="system-selection">
              <select value={system} onChange={(e) => setSystem(e.target.value)}>
                <option value="pool">Pool</option>
                <option value="cold_plunge">Cold Plunge</option>
              </select>
            </div>

            <form onSubmit={handleCalculate}>
              <div className="input-grid">
                {Object.entries(current).map(([key, value]) => (
                  <div key={key} className="input-group">
                    <label>{key}:</label>
                    <input
                      type="number"
                      step={key === 'volume' ? 100 : 0.1}
                      value={isNaN(value) ? '' : value}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        setCurrent({ ...current, [key]: isNaN(newValue) ? 0 : newValue });
                      }}
                    />
                  </div>
                ))}
              </div>
              <button type="submit">Calculate Adjustments</button>
            </form>

            {adjustments && (
              <div className="adjustments">
                <h2>Recommended Adjustments</h2>
                <table>
                  <thead>
                    <tr>
                      <th>Chemical</th>
                      <th>Amount</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(adjustments.adjustments || {}).map(([chemical, amount]) => (
                      <tr key={chemical}>
                        <td>{chemical}</td>
                        <td>{amount}</td>
                        <td>oz</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="readings-section">
              <button onClick={toggleReadings} disabled={loadingReadings}>
                {loadingReadings 
                  ? 'Loading Readings...' 
                  : showReadings 
                    ? 'Hide Previous Readings' 
                    : 'Show Previous Readings'}
              </button>
              {showReadings && (
                <div className="readings">
                  <h2>Previous Readings</h2>
                  {readingsError && <p className="error">{readingsError}</p>}
                  {!loadingReadings && !readingsError && readings.length === 0 && (
                    <p>No previous readings found.</p>
                  )}
                  {!loadingReadings && !readingsError && readings.length > 0 && (
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>pH</th>
                          <th>Total Chlorine</th>
                          <th>Free Chlorine</th>
                          <th>Total Hardness</th>
                          <th>Total Alkalinity</th>
                          <th>Cyanuric Acid</th>
                          <th>Bromine</th>
                        </tr>
                      </thead>
                      <tbody>
                        {readings.map((reading) => (
                          <tr key={reading.id}>
                            <td>{reading.timestamp?.toDate ? reading.timestamp.toDate().toLocaleDateString() : 'N/A'}</td>
                            <td>{reading.readings?.pH ?? 'N/A'}</td>
                            <td>{reading.readings?.['Total Chlorine'] ?? 'N/A'}</td>
                            <td>{reading.readings?.['Free Chlorine'] ?? 'N/A'}</td>
                            <td>{reading.readings?.['Total Hardness'] ?? 'N/A'}</td>
                            <td>{reading.readings?.['Total Alkalinity'] ?? 'N/A'}</td>
                            <td>{reading.readings?.['Cyanuric Acid'] ?? 'N/A'}</td>
                            <td>{reading.readings?.['Bromine'] ?? 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        } />
        <Route path="/test-strip/upload" element={<TestStripUpload />} />
        <Route path="/test-strip/results" element={<TestStripResults />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

export default AppContent; 