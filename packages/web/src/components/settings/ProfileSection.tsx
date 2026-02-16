import { useState, useEffect } from "react";

interface Profile {
  name: string | null;
  avatar: string | null;
  bio: string | null;
  timezone: string | null;
}

export function ProfileSection() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState("");

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data: Profile) => {
        setProfile(data);
        setName(data.name ?? "");
        setAvatar(data.avatar ?? "");
        setBio(data.bio ?? "");
        setTimezone(data.timezone ?? "");
      })
      .catch(() => setError("Failed to load profile"));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || null,
          avatar: avatar || null,
          bio: bio || null,
          timezone: timezone || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save profile");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (!profile && !error) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Loading profile...
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      <div>
        <h3 className="text-xs font-semibold mb-1">Profile</h3>
        <p className="text-xs text-muted-foreground">
          Your personal information.
        </p>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium mb-1 block">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your display name"
            className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">Avatar URL</label>
          <input
            type="text"
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            placeholder="https://example.com/avatar.png"
            className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A short bio about yourself"
            rows={3}
            className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">Timezone</label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/New_York"
            className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {saved && (
          <span className="text-xs text-green-400">Saved successfully</span>
        )}
      </div>
    </div>
  );
}
