"use client";

import { useState, FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode]       = useState<"login" | "register">("login");
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Registration failed"); return; }
        // Auto-sign-in after register
      }

      const result = await signIn("credentials", {
        email, password, redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--color-bg)" }}>

      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center text-white font-bold text-xl"
            style={{ background: "var(--color-primary)" }}>F</div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--color-fg)" }}>
            Fact Knowledge Layer
          </h1>
          <p className="text-sm" style={{ color: "var(--color-muted-fg)" }}>
            {mode === "login" ? "Sign in to your knowledge base" : "Create your knowledge base"}
          </p>
        </div>

        {/* Card */}
        <div className="card p-6 space-y-5">
          {/* Tab switcher */}
          <div className="flex rounded-lg overflow-hidden border"
            style={{ borderColor: "var(--color-border)" }}>
            {(["login", "register"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(""); }}
                className="flex-1 py-2 text-sm font-medium transition-colors capitalize"
                style={{
                  background: mode === m ? "var(--color-primary)" : "transparent",
                  color: mode === m ? "#fff" : "var(--color-muted-fg)",
                }}>
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted-fg)" }}>
                  Full Name
                </label>
                <input
                  type="text" required value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none"
                  style={{
                    background: "var(--color-muted)", border: "1px solid var(--color-border)",
                    color: "var(--color-fg)",
                  }}
                />
              </div>
            )}

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted-fg)" }}>
                Email
              </label>
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none"
                style={{
                  background: "var(--color-muted)", border: "1px solid var(--color-border)",
                  color: "var(--color-fg)",
                }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted-fg)" }}>
                Password {mode === "register" && <span>(min 8 characters)</span>}
              </label>
              <input
                type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none"
                style={{
                  background: "var(--color-muted)", border: "1px solid var(--color-border)",
                  color: "var(--color-fg)",
                }}
              />
            </div>

            {error && (
              <p className="text-sm rounded-lg px-3 py-2"
                style={{ background: "color-mix(in srgb,#ef4444 10%,transparent)", color: "#f87171" }}>
                {error}
              </p>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60"
              style={{ background: "var(--color-primary)", color: "#fff" }}>
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs" style={{ color: "var(--color-muted-fg)" }}>
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
            className="underline" style={{ color: "var(--color-primary)" }}>
            {mode === "login" ? "Register" : "Sign In"}
          </button>
        </p>
      </div>
    </div>
  );
}
