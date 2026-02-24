import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";

export function WhatsAppSection() {
  const enabled = useSettingsStore((s) => s.whatsappEnabled);
  const phoneNumber = useSettingsStore((s) => s.whatsappPhoneNumber);
  const pairedUsers = useSettingsStore((s) => s.whatsappPairedUsers);
  const pendingPairings = useSettingsStore((s) => s.whatsappPendingPairings);
  const loadWhatsAppSettings = useSettingsStore((s) => s.loadWhatsAppSettings);
  const updateWhatsAppSettings = useSettingsStore((s) => s.updateWhatsAppSettings);
  const approveWhatsAppPairing = useSettingsStore((s) => s.approveWhatsAppPairing);
  const rejectWhatsAppPairing = useSettingsStore((s) => s.rejectWhatsAppPairing);
  const revokeWhatsAppUser = useSettingsStore((s) => s.revokeWhatsAppUser);

  const [qrCode, setQrCode] = useState<string | null>(null);
  const [botStatus, setBotStatus] = useState<"connected" | "disconnected" | "error">("disconnected");

  useEffect(() => {
    loadWhatsAppSettings();
  }, []);

  // Listen for real-time WhatsApp events
  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: { status: "connected" | "disconnected" | "error"; phoneNumber?: string }) => {
      setBotStatus(data.status);
      if (data.status === "connected") {
        setQrCode(null);
        loadWhatsAppSettings();
      }
    };

    const handleQr = (data: { qr: string }) => {
      setQrCode(data.qr);
    };

    const handlePairingRequest = () => {
      loadWhatsAppSettings();
    };

    socket.on("whatsapp:status", handleStatus);
    socket.on("whatsapp:qr", handleQr);
    socket.on("whatsapp:pairing-request", handlePairingRequest);

    return () => {
      socket.off("whatsapp:status", handleStatus);
      socket.off("whatsapp:qr", handleQr);
      socket.off("whatsapp:pairing-request", handlePairingRequest);
    };
  }, []);

  const handleToggleEnabled = async () => {
    await updateWhatsAppSettings({ enabled: !enabled });
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Connect Otterbot to WhatsApp via QR code pairing. Users must pair with
        the bot before it responds to their messages.
      </p>

      {/* Enable toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          onClick={handleToggleEnabled}
          className={cn(
            "relative w-9 h-5 rounded-full transition-colors",
            enabled ? "bg-primary" : "bg-secondary",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform",
              enabled && "translate-x-4",
            )}
          />
        </button>
        <span className="text-sm">Enable WhatsApp integration</span>
      </label>

      {/* Connection status */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Connection
        </label>

        {phoneNumber && (
          <div className="text-xs text-muted-foreground">
            Phone: <span className="text-foreground font-medium">+{phoneNumber}</span>
            {enabled && (
              <span className={cn(
                "ml-2 text-[10px] px-1.5 py-0.5 rounded",
                botStatus === "connected"
                  ? "text-green-500 bg-green-500/10"
                  : botStatus === "error"
                    ? "text-red-500 bg-red-500/10"
                    : "text-muted-foreground bg-muted",
              )}>
                {botStatus === "connected" ? "Online" : botStatus === "error" ? "Error" : "Offline"}
              </span>
            )}
          </div>
        )}

        {/* QR Code display */}
        {enabled && qrCode && botStatus !== "connected" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Scan this QR code with WhatsApp on your phone to connect:
            </p>
            <div className="bg-white p-4 rounded-lg inline-block">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrCode)}`}
                alt="WhatsApp QR Code"
                className="w-64 h-64"
              />
            </div>
          </div>
        )}

        {enabled && !qrCode && botStatus === "disconnected" && !phoneNumber && (
          <p className="text-xs text-muted-foreground italic">
            Waiting for QR code... Make sure the integration is enabled.
          </p>
        )}
      </div>

      {/* Paired Users section */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Paired Users
          <span className="ml-2 normal-case tracking-normal text-foreground">
            {pairedUsers.length}
          </span>
        </label>

        {pairedUsers.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            No users have been paired yet. When someone messages the bot, they'll receive a pairing code to approve here.
          </p>
        ) : (
          <div className="space-y-2">
            {pairedUsers.map((user) => (
              <div
                key={user.whatsappJid}
                className="flex items-center justify-between bg-secondary rounded-md px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium">{user.whatsappName}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    Paired {new Date(user.pairedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => revokeWhatsAppUser(user.whatsappJid)}
                  className="text-[10px] text-red-500 hover:text-red-400 px-2 py-1"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Pairings section */}
      {pendingPairings.length > 0 && (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Pending Pairings
            <span className="ml-2 normal-case tracking-normal text-yellow-500">
              {pendingPairings.length}
            </span>
          </label>

          <div className="space-y-2">
            {pendingPairings.map((pairing) => (
              <div
                key={pairing.code}
                className="flex items-center justify-between bg-secondary rounded-md px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium">{pairing.whatsappName}</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded ml-2 font-mono">
                    {pairing.code}
                  </code>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {new Date(pairing.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => approveWhatsAppPairing(pairing.code)}
                    className="text-[10px] text-green-500 hover:text-green-400 bg-green-500/10 px-2 py-1 rounded"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectWhatsAppPairing(pairing.code)}
                    className="text-[10px] text-red-500 hover:text-red-400 px-2 py-1"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Setup instructions */}
      <div className="text-[10px] text-muted-foreground space-y-1">
        <p>
          <strong>How to set up WhatsApp:</strong>
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Enable the WhatsApp integration above</li>
          <li>A QR code will appear — scan it with WhatsApp on your phone</li>
          <li>Go to WhatsApp &gt; Linked Devices &gt; Link a Device</li>
          <li>Once connected, message the bot from any WhatsApp account</li>
          <li>Approve the pairing code shown here to start chatting</li>
        </ol>
      </div>
    </div>
  );
}
