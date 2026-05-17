import { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { colors, glyphs } from "./theme.js";

/** Prompt line. Disabled while the agent is responding. */
export function InputBar({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  const submit = (text: string) => {
    setValue("");
    if (text.trim()) onSubmit(text);
  };

  return (
    <Box>
      <Text color={disabled ? colors.dim : colors.brand} bold>
        {glyphs.caret}{" "}
      </Text>
      {disabled ? (
        <Text color={colors.dim}>waiting for the agent…</Text>
      ) : (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={submit}
          placeholder="message…"
        />
      )}
    </Box>
  );
}
