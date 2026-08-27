const { z } = require("zod");

const PromptSchema = z.object({
  prompt: z.string().trim().min(4, "Make a 1 paragraph summary of the topic, and 3 questions on it. NO FORMATTING!")
});

const QuizQuestionSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1)
});

const OutputSchema = z.object({
  subject: z.string().min(1),
  questions: z.array(QuizQuestionSchema).length(5)
});

function validatePromptInput(input) {
  return PromptSchema.safeParse(input);
}

module.exports = {
  PromptSchema,
  validatePromptInput,
  OutputSchema,
  QuizQuestionSchema
};


/*
As they say in python:
print("Save my soul")

*/