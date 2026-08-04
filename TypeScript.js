const { z } = require("zod");

const PromptSchema = z.object({
  prompt: z.string().trim().min(4, "Make a 1 paragraph summary of the topic, and 3 questions on it. NO FORMATTING!")
});

function validatePromptInput(input) {
  return PromptSchema.safeParse(input);
}

module.exports = {
  PromptSchema,
  validatePromptInput
};