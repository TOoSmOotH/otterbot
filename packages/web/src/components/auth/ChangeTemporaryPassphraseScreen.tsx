import { useState, type KeyboardEvent } from "react";
import { useAuthStore } from "../../stores/auth-store";
import { PasswordInput } from "../ui/PasswordInput";
import { StrengthMeter } from "../ui/StrengthMeter";
import { scorePassword } from "../../utils/password-strength";

export function ChangeTemporaryPassphraseScreen() {
  const { changeTemporaryPassphrase, error } = useAuthStore();
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const strength = scorePassword(newPassphrase);
  const matches = newPassphrase && newPassphrase === confirmPassphrase;
  const canSubmit =
    newPassphrase.length >= 8 &&
    matches &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;

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
            readOnly
            hidden
            tabIndex={-1}
          />

          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-sm font-medium mb-1">Change Your Passphrase</h2>
              <p className="text-xs text-muted-foreground">
                You logged in with a temporary passphrase. Set your own
                passphrase to continue. This passphrase encrypts your API
                keys, conversations, and other personal data.
              </p>
            </div>

            <div>
              <label
                htmlFor="change-new-passphrase"
                className="block text-sm font-medium text-muted-foreground mb-1.5"
              >
                New Passphrase
              </label>
              <PasswordInput
                id="change-new-passphrase"
                name="newPassphrase"
                autoComplete="new-password"
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.currentTarget.value)}
                placeholder="Enter a new passphrase (min. 8 characters)"
                autoFocus
                minLength={8}
                required
              />
              {newPassphrase && (
                <div className="mt-2">
                  <StrengthMeter strength={strength} />
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="change-confirm-passphrase"
                className="block text-sm font-medium text-muted-foreground mb-1.5"
              >
                Confirm Passphrase
              </label>
              <PasswordInput
                id="change-confirm-passphrase"
                name="confirmPassphrase"
                autoComplete="new-password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder="Confirm your passphrase"
                minLength={8}
                required
              />
              {confirmPassphrase && (
                <p className={`mt-1.5 text-xs ${matches ? "text-green-500" : "text-destructive"}`}>
                  {matches
                    ? "Passphrases match"
                    : "Passphrases do not match"}
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              There is no recovery mechanism — if you forget this passphrase
              you will need to reset the database.
            </p>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
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
