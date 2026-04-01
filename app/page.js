"use client";

import { useState, useEffect } from "react";
import Dashboard from "@/components/Dashboard";

export default function Home() {
  const [token, setToken] = useState(null);
  const [partnerInfo, setPartnerInfo] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Check for existing session
  useEffect(() => {
    const saved = sessionStorage.getItem("surfline_session");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setToken(parsed.token);
        setPartnerInfo({ partner: parsed.partner, label: parsed.label });
      } catch {}
    }
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }

      setToken(data.token);
      setPartnerInfo({ partner: data.partner, label: data.label });
      sessionStorage.setItem("surfline_session", JSON.stringify(data));
    } catch (err) {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    setToken(null);
    setPartnerInfo(null);
    sessionStorage.removeItem("surfline_session");
  }

  // Login screen
  if (!token) {
    return (
      <div className="login-container">
        <form className="login-card" onSubmit={handleLogin}>
          <h1>Surfline Capital</h1>
          <p>Enter your partner access code to view your dashboard.</p>
          <input
            type="password"
            placeholder="Access code"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={loading || !password}>
            {loading ? "Signing in..." : "View dashboard"}
          </button>
          {error && <div className="login-error">{error}</div>}
        </form>
      </div>
    );
  }

  // Dashboard
  return (
    <Dashboard
      token={token}
      partnerInfo={partnerInfo}
      onLogout={handleLogout}
    />
  );
}
