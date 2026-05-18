import { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import type { CliOptions } from "../types.js";
import { probeServer } from "../lifecycle/detect.js";
import { ensureDaemon } from "../lifecycle/daemon.js";
import { openWeb } from "../lifecycle/web.js";
import { useChat } from "../state/useChat.js";
import { Header } from "./Header.js";
import { MessageList } from "./MessageList.js";
import { StatusBar } from "./StatusBar.js";
import { InputBar } from "./InputBar.js";
import { Onboarding } from "./Onboarding.js";
import { colors } from "./theme.js";

type Phase = "booting" | "onboarding" | "chat" | "error";

/** True for a server URL we could start ourselves (loopback host). */
function isLocal(serverUrl: string): boolean {
  try {
    const host = new URL(serverUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
  } catch {
    return false;
  }
}

export function App({ options }: { options: CliOptions }) {
  const [phase, setPhase] = useState<Phase>("booting");
  const [bootMessage, setBootMessage] = useState("Looking for the otterbot daemon…");
  const [errorText, setErrorText] = useState("");
  const [rechecking, setRechecking] = useState(false);

  // One-shot boot sequence: probe, then start the daemon if needed.
  useEffect(() => {
    let cancelled = false;
    const settle = (next: Phase, detail?: string) => {
      if (cancelled) return;
      if (detail) setErrorText(detail);
      setPhase(next);
    };

    (async () => {
      const probe = await probeServer(options.serverUrl);
      if (probe.up) {
        settle(probe.onboardingComplete ? "chat" : "onboarding");
        return;
      }
      if (options.noSpawn) {
        settle("error", `No server is running at ${options.serverUrl} and --no-spawn was set.`);
        return;
      }
      if (!isLocal(options.serverUrl)) {
        settle(
          "error",
          `No server is running at ${options.serverUrl}. It is not a local address, so it cannot be started automatically.`
        );
        return;
      }

      setBootMessage("Starting the otterbot daemon…");
      try {
        const result = await ensureDaemon({ port: options.port, host: options.host });
        if (cancelled) return;
        const after = await probeServer(result.url);
        settle(after.up && !after.onboardingComplete ? "onboarding" : "chat");
      } catch (err) {
        settle("error", err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [options]);

  if (phase === "booting") {
    return <BootScreen message={bootMessage} />;
  }
  if (phase === "error") {
    return <ErrorScreen text={errorText} />;
  }
  if (phase === "onboarding") {
    return (
      <OnboardingPhase
        options={options}
        rechecking={rechecking}
        onRecheck={async () => {
          setRechecking(true);
          const probe = await probeServer(options.serverUrl);
          setRechecking(false);
          if (probe.up && probe.onboardingComplete) setPhase("chat");
        }}
      />
    );
  }
  return <ChatView options={options} />;
}

function BootScreen({ message }: { message: string }) {
  return (
    <Box padding={1}>
      <Text color={colors.brand}>
        <Spinner type="dots" />{" "}
      </Text>
      <Text>{message}</Text>
    </Box>
  );
}

function ErrorScreen({ text }: { text: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.error} padding={1}>
      <Text color={colors.error} bold>
        Could not start a chat session
      </Text>
      <Box marginTop={1}>
        <Text>{text}</Text>
      </Box>
    </Box>
  );
}

function OnboardingPhase({
  options,
  rechecking,
  onRecheck,
}: {
  options: CliOptions;
  rechecking: boolean;
  onRecheck: () => void;
}) {
  return (
    <Onboarding
      webUrl={options.serverUrl}
      rechecking={rechecking}
      onOpenWeb={() => openWeb(options.serverUrl)}
      onRecheck={onRecheck}
    />
  );
}

/** The live chat view — owns the chat socket via useChat. */
function ChatView({ options }: { options: CliOptions }) {
  const { exit } = useApp();
  const { messages, agentStatus, connection, streaming, send } = useChat(
    options.serverUrl,
    options.agentId
  );

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "/quit" || trimmed === "/exit") {
      exit();
      return;
    }
    if (trimmed === "/web") {
      openWeb(options.serverUrl);
      return;
    }
    send(text);
  };

  return (
    <Box flexDirection="column">
      <Header serverUrl={options.serverUrl} agentId={options.agentId} />
      <MessageList messages={messages} streaming={streaming} agentId={options.agentId} />
      <StatusBar connection={connection} agentStatus={agentStatus} streaming={streaming} />
      <InputBar disabled={streaming} onSubmit={handleSubmit} />
    </Box>
  );
}
