import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import { bannerGradient, colors } from "./theme.js";

const WORDMARK = [
  "  ___  _____  _____  ___  ___ ",
  " / _ \\|_   _||_   _|| __|| _ \\",
  "| (_) | | |    | |  | _| |   /",
  " \\___/  |_|    |_|  |___||_|_\\",
];

/** One-time banner: gradient OTTER wordmark + tagline. */
export function Header({ serverUrl, agentId }: { serverUrl: string; agentId: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gradient colors={[...bannerGradient]}>
        {WORDMARK.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </Gradient>
      <Box marginTop={1}>
        <Text color={colors.dim}>
          terminal chat · agent <Text color={colors.brand}>{agentId}</Text> ·{" "}
          {serverUrl}
        </Text>
      </Box>
      <Text color={colors.dim}>
        type a message and press enter · /web opens the browser · /quit or Ctrl+C exits
      </Text>
    </Box>
  );
}
