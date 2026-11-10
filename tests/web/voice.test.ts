import { describe, expect, it } from "vitest";
import { draftBody, draftSubject, matchesRecipient, parseVoiceCommand, recipientQuery, tidyMessage } from "@/lib/voiceCommand";
import { getRecognitionCtor, joinTranscript, speechErrorMessage } from "@/lib/speech";

describe("parseVoiceCommand", () => {
  it("turns 'reply to Ola that I'll come at 3' into a reply draft", () => {
    expect(parseVoiceCommand("reply to Ola that I'll come at 3")).toEqual({ kind: "reply", recipient: "Ola", message: "I'll come at 3." });
    expect(parseVoiceCommand("Hey Fluent, respond to Sofia Lindqvist saying Thursday works.")).toEqual({ kind: "reply", recipient: "Sofia Lindqvist", message: "Thursday works." });
    expect(parseVoiceCommand("reply to Marcus and tell him that the notes are done")).toEqual({ kind: "reply", recipient: "Marcus", message: "The notes are done." });
    expect(parseVoiceCommand("svar Ola at jeg kommer klokka tre")).toEqual({ kind: "reply", recipient: "Ola", message: "Jeg kommer klokka tre." });
  });

  it("treats 'send an email to …' as a new *draft* too (there is no send outcome)", () => {
    expect(parseVoiceCommand("send an email to Jonas saying the contract is signed")).toEqual({ kind: "new", recipient: "Jonas", message: "The contract is signed." });
    expect(parseVoiceCommand("email Priya that QA is done")).toEqual({ kind: "new", recipient: "Priya", message: "QA is done." });
    expect(parseVoiceCommand("skriv til Erik at teknikeren kan komme")).toEqual({ kind: "new", recipient: "Erik", message: "Teknikeren kan komme." });
    expect(parseVoiceCommand("send a reply to Sofia saying Thursday works")).toEqual({ kind: "reply", recipient: "Sofia", message: "Thursday works." });
  });

  it("leaves ordinary dictation alone", () => {
    expect(parseVoiceCommand("archive all newsletters from last week")).toBeNull();
    expect(parseVoiceCommand("thanks for the update see you tomorrow")).toBeNull();
    expect(parseVoiceCommand("reply to me that it works")).toBeNull();
    expect(parseVoiceCommand("")).toBeNull();
    expect(parseVoiceCommand(`reply to Ola that ${"x".repeat(1200)}`)).toBeNull();
  });
});

describe("voice draft helpers", () => {
  it("tidies the message and writes a greeting with the first name", () => {
    expect(tidyMessage("  i'll   come at 3 ")).toBe("I'll come at 3.");
    expect(tidyMessage("really?")).toBe("Really?");
    expect(draftBody({ kind: "reply", recipient: "ola nordmann", message: "I'll come at 3." })).toBe("Hi Ola,\n\nI'll come at 3.");
    expect(draftSubject("The contract is signed.")).toBe("The contract is signed");
    expect(draftSubject("one two three four five six seven eight nine ten")).toBe("one two three four five six seven eight…");
  });

  it("keeps the Gmail query to a quoted, plain name", () => {
    expect(recipientQuery("from", "Ola")).toBe('from:"Ola"');
    expect(recipientQuery("to", 'Ola" OR in:trash (x)')).toBe('to:"Ola OR intrash x"');
    expect(recipientQuery("from", "\"()")).toBeNull();
  });

  it("matches the spoken name against an address", () => {
    expect(matchesRecipient({ name: "Ola Nordmann", email: "ola@fjord.example" }, "Ola")).toBe(true);
    expect(matchesRecipient({ name: "Sofia Lindqvist", email: "sofia@northwind.example" }, "sofia lindqvist")).toBe(true);
    expect(matchesRecipient({ name: "Marcus Chen", email: "marcus@northwind.example" }, "Ola")).toBe(false);
  });
});

describe("speech helpers", () => {
  it("detects support and falls back gracefully", () => {
    expect(getRecognitionCtor({})).toBeNull();
    expect(getRecognitionCtor(undefined)).toBeNull();
    class Fake {}
    expect(getRecognitionCtor({ webkitSpeechRecognition: Fake })).toBe(Fake);
  });
  it("explains errors and ignores user aborts", () => {
    expect(speechErrorMessage("aborted")).toBeNull();
    expect(speechErrorMessage("not-allowed")).toMatch(/Microphone access is blocked/);
    expect(speechErrorMessage("weird")).toMatch(/stopped/);
  });
  it("joins dictated phrases with spaces", () => {
    expect(joinTranscript("", " hello ")).toBe("hello");
    expect(joinTranscript("archive", "newsletters")).toBe("archive newsletters");
    expect(joinTranscript("archive ", "newsletters")).toBe("archive newsletters");
    expect(joinTranscript("x", "  ")).toBe("x");
  });
});
