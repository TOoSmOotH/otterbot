import { useState, useEffect, useRef } from "react";
import { DEFAULT_AVATARS } from "../setup/default-avatars";

interface Profile {
  name: string | null;
  avatar: string | null;
  bio: string | null;
  timezone: string | null;
}

function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = maxSize;
      canvas.height = maxSize;
      const ctx = canvas.getContext("2d")!;

      // Cover-crop: scale and center
      const scale = Math.max(maxSize / img.width, maxSize / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (maxSize - w) / 2, (maxSize - h) / 2, w, h);

      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
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

  const [draggingOver, setDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleAvatarChange = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file");
      return;
    }
    try {
      const dataUrl = await resizeImage(file, 256);
      setAvatar(dataUrl);
      setError(null);
    } catch {
      setError("Failed to process image");
    }
  };

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
        {/* Avatar picker */}
        <div>
          <label className="text-xs font-medium mb-2 block">Avatar</label>
          <div className="flex items-start gap-4">
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleAvatarChange(file);
                }}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDraggingOver(true);
                }}
                onDragLeave={() => setDraggingOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDraggingOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleAvatarChange(file);
                }}
                className={`relative w-16 h-16 rounded-full border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${
                  draggingOver
                    ? "border-primary bg-primary/10"
                    : avatar
                      ? "border-transparent"
                      : "border-border hover:border-muted-foreground"
                }`}
              >
                {avatar ? (
                  <img
                    src={avatar}
                    alt="Avatar preview"
                    className="w-16 h-16 rounded-full object-cover"
                  />
                ) : (
                  <span className="text-muted-foreground text-[10px] text-center leading-tight">
                    Upload
                  </span>
                )}
              </div>
              {avatar && (
                <button
                  onClick={() => setAvatar("")}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-1 w-16 text-center"
                >
                  Remove
                </button>
              )}
            </div>
            {!avatar && (
              <div className="flex gap-1.5 flex-wrap pt-1">
                {DEFAULT_AVATARS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAvatar(a.url)}
                    title={a.label}
                    className="w-8 h-8 rounded-full overflow-hidden border-2 border-transparent hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <img
                      src={a.url}
                      alt={a.label}
                      className="w-full h-full"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

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
