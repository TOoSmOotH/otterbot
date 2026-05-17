import { Box, Text, useInput } from "ink";
import { colors } from "./theme.js";

/**
 * Shown when the server is up but onboarding is not finished. The COO has no
 * LLM credentials yet, and there is no terminal onboarding flow — the user must
 * finish setup in the web UI.
 */
export function Onboarding({
  webUrl,
  rechecking,
  onOpenWeb,
  onRecheck,
}: {
  webUrl: string;
  rechecking: boolean;
  onOpenWeb: () => void;
  onRecheck: () => void;
}) {
  useInput((input) => {
    if (rechecking) return;
    if (input === "o") onOpenWeb();
    if (input === "r") onRecheck();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.reconnecting} padding={1}>
      <Text color={colors.reconnecting} bold>
        Setup not finished
      </Text>
      <Box marginTop={1}>
        <Text>
          The COO agent has no model credentials yet. Terminal onboarding isn't
          supported — finish setup in the web UI:
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={colors.brand}>{webUrl}</Text>
      </Box>
      <Box marginTop={1}>
        {rechecking ? (
          <Text color={colors.dim}>re-checking…</Text>
        ) : (
          <Text color={colors.dim}>
            press <Text color={colors.brand}>o</Text> to open the browser ·{" "}
            <Text color={colors.brand}>r</Text> to re-check · Ctrl+C to quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
