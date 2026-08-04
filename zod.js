import { z } from "https://cdn.jsdelivr.net/npm/zod@3.23.8/+esm";

const PromptSchema = z.object({
  prompt: z.string().trim().min(4, "Make a 1 paragraph summary of the topic, and 3 questions on it. NO FORMATTING!")
});

function validatePromptInput(input) {
  return PromptSchema.safeParse(input);
}

const OutputSchema = z.object({
  question: z.string().startsWith("Q:"),
  answer: z.string().startsWith("A:")
});

window.PromptSchema = PromptSchema;
window.validatePromptInput = validatePromptInput;
window.OutputSchema = OutputSchema;