import { joinTranscript } from "@/lib/speech";
import { parseVoiceCommand } from "@/lib/voiceCommand";
import { useCopilot } from "../copilot/context";
import { MicButton } from "./MicButton";
import { useVoiceDraft } from "./useVoiceDraft";

/**
 * Mic for the Copilot input. "Reply to Ola that I'll come at 3" becomes a draft in the composer (never sent);
 * anything else is typed into the input for the user to send to Copilot.
 */
export function CopilotMic({ setInput }: { setInput: (fn: (v: string) => string) => void }) {
  const copilot = useCopilot();
  const draft = useVoiceDraft(copilot.close);
  return (
    <MicButton
      label="Speak to Copilot"
      onText={(t) => setInput((v) => joinTranscript(v, t))}
      onPhrase={(t) => {
        const cmd = parseVoiceCommand(t);
        if (!cmd) return false;
        void draft(cmd);
        return true;
      }}
    />
  );
}
