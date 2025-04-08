import React, { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";
import { BrowserRouter as Router } from "react-router-dom";
import { TestStripProvider } from "./context/TestStripContext";
import AppContent from "./components/AppContent";
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
  const [isSignUp, setIsSignUp] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (!user) {
        setError(null);
      }
    });
    return () => unsubscribe();
  }, []);

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
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <Router>
      <TestStripProvider>
        <AppContent />
      </TestStripProvider>
    </Router>
  );
}

export default App;