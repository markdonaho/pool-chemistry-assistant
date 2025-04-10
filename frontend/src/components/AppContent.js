import React, { useState, useEffect } from "react";
import { useNavigate, Routes, Route, Navigate } from "react-router-dom";
import { getAuth, signOut } from "firebase/auth";
import { useTestStrip } from "../context/TestStripContext";
import TestStripUpload from "./TestStripUpload";
import TestStripResults from "./TestStripResults";

const AppContent = () => {
  const navigate = useNavigate();
  const auth = getAuth();
  const { detectedReadings } = useTestStrip();

  const [system, setSystem] = useState("pool");
  const [current, setCurrent] = useState({
    volume: 0,
    pH: 7.2,
    alkalinity: 100,
    calcium: 200,
    cyanuricAcid: 30,
    chlorine: 1.0,
    bromine: 0
  });
  const [adjustments, setAdjustments] = useState(null);
  const [readings, setReadings] = useState([]);
  const [showReadings, setShowReadings] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (detectedReadings) {
      console.log('Updating dashboard form with detected readings:', detectedReadings);
      setCurrent(prevCurrent => ({
        ...prevCurrent,
        pH: detectedReadings['pH'] ?? prevCurrent.pH,
        alkalinity: detectedReadings['Total Alkalinity'] ?? prevCurrent.alkalinity,
        calcium: detectedReadings['Total Hardness'] ?? prevCurrent.calcium,
        cyanuricAcid: detectedReadings['Cyanuric Acid'] ?? prevCurrent.cyanuricAcid,
        chlorine: detectedReadings['Free Chlorine'] ?? prevCurrent.chlorine,
        bromine: detectedReadings['Bromine'] ?? prevCurrent.bromine
      }));
    }
  }, [detectedReadings]);

  useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      const newVolume = system === 'pool' ? 15000 : 124;
      // Set default volume immediately when system changes
      setCurrent(prev => ({
        ...prev, // Keep potentially updated readings
        volume: prev.volume === 0 || (system === 'pool' && prev.volume === 124) || (system === 'cold_plunge' && prev.volume === 15000) ? newVolume : prev.volume // Only set default if volume hasn't been manually changed from the *other* system's default or 0
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
            console.log("Systems data fetched:", result.data);
            const targets = result.data[system].targets;
            // Apply targets, ensuring volume keeps its potentially set default
            setCurrent(prev => ({
              ...targets,
              ...prev, // Apply existing state (including the default volume we just set)
            }));
          })
          .catch((err) => {
            console.error("Error fetching systems:", err.message);
            setError("Failed to load system data. Please try again later.");
          });
      });
    }
  }, [system, auth]);

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
    setShowReadings(!showReadings);
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
                      value={isNaN(value) ? '' : value}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        setCurrent({ ...current, [key]: isNaN(newValue) ? 0 : newValue });
                      }}
                      step="0.1"
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
              <button onClick={toggleReadings}>
                {showReadings ? 'Hide Previous Readings' : 'Show Previous Readings'}
              </button>
              {showReadings && readings.length > 0 && (
                <div className="readings">
                  <h2>Previous Readings</h2>
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
                      </tr>
                    </thead>
                    <tbody>
                      {readings.map((reading) => (
                        <tr key={reading.id}>
                          <td>{new Date(reading.timestamp).toLocaleDateString()}</td>
                          <td>{reading.readings.pH}</td>
                          <td>{reading.readings['Total Chlorine']}</td>
                          <td>{reading.readings['Free Chlorine']}</td>
                          <td>{reading.readings['Total Hardness']}</td>
                          <td>{reading.readings['Total Alkalinity']}</td>
                          <td>{reading.readings['Cyanuric Acid']}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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