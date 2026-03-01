import { useState, type KeyboardEvent } from "react";
import { useAuthStore } from "../../stores/auth-store";
import { PasswordInput } from "./PasswordInput";
import { PasswordStrengthBar } from "./PasswordStrengthBar";

export function ChangeTemporaryPassphraseScreen() {
  const { changeTemporaryPassphrase, error } = useAuthStore();
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!newPassphrase || !confirmPassphrase || submitting) return;

    if (newPassphrase.length < 8) {
      useAuthStore.getState().setError("Passphrase must be at least 8 characters");
      return;
    }

    if (newPassphrase !== confirmPassphrase) {
      useAuthStore.getState().setError("Passphrases do not match");
      return;
    }

    setSubmitting(true);
    await changeTemporaryPassphrase(newPassphrase);
    setSubmitting(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <div className="bg-card border border-border rounded-lg p-8">
          <div className="flex items-center justify-center gap-2 mb-2">
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

          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-sm font-medium mb-1">Change Your Passphrase</h2>
              <p className="text-xs text-muted-foreground">
                You logged in with a temporary passphrase. Set your own passphrase to continue.
              </p>
            </div>

            <div>
              <label
                htmlFor="newPassphrase"
                className="block text-sm font-medium text-muted-foreground mb-1.5"
              >
                New Passphrase
              </label>
              <PasswordInput
                id="newPassphrase"
                name="new-passphrase"
                autoComplete="new-password"
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                placeholder="Enter a new passphrase"
                minLength={8}
                required
                autoFocus
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="mt-1.5">
                <PasswordStrengthBar password={newPassphrase} />
              </div>
            </div>

            <div>
              <label
                htmlFor="confirmPassphrase"
                className="block text-sm font-medium text-muted-foreground mb-1.5"
              >
                Confirm Passphrase
              </label>
              <PasswordInput
                id="confirmPassphrase"
                name="confirm-passphrase"
                autoComplete="new-password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Confirm your passphrase"
                minLength={8}
                required
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {/* Inline match validation */}
              {confirmPassphrase && (
                <p
                  className={`text-xs mt-1 ${
                    newPassphrase === confirmPassphrase
                      ? "text-green-500"
                      : "text-destructive"
                  }`}
                >
                  {newPassphrase === confirmPassphrase
                    ? "Passphrases match"
                    : "Passphrases do not match"}
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={
                !newPassphrase ||
                !confirmPassphrase ||
                newPassphrase.length < 8 ||
                newPassphrase !== confirmPassphrase ||
                submitting
              }
              className="w-full px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Saving..." : "Set Passphrase"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
