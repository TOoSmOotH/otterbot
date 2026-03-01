import { useState, type KeyboardEvent } from "react";
import { useAuthStore } from "../../stores/auth-store";
import { PasswordInput } from "./PasswordInput";

export function LoginScreen() {
  const { login, error } = useAuthStore();
  const [passphrase, setPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!passphrase || submitting) return;
    setSubmitting(true);
    await login(passphrase);
    setSubmitting(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <div className="bg-card border border-border rounded-lg p-8">
          {/* Branding */}
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <span className="text-primary text-sm font-bold">S</span>
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Otterbot</h1>
          </div>

          {/* Hidden username anchor for password managers */}
          <input
            type="text"
            autoComplete="username"
            value="otterbot"
            hidden
            readOnly
          />

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label
                htmlFor="passphrase"
                className="block text-sm text-muted-foreground mb-1.5"
              >
                Passphrase
              </label>
              <PasswordInput
                id="passphrase"
                name="passphrase"
                autoComplete="current-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter your passphrase"
                autoFocus
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!passphrase || submitting}
              className="w-full px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Signing in..." : "Sign In"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
