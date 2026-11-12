const { z } = require("zod");

// HTTP input schema: trim prompts and reject empty submissions.
const PromptSchema = z.object({
  prompt: z.string().trim().min(1, "Please enter a prompt.")
});

// Shared question/answer shape used by lesson output and the calculus example.
const QuizQuestionSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1)
});

// Reuse the common item schema for standalone question/answer validation.
const SingleQuestionAnswerSchema = QuizQuestionSchema;

// Schemas for the lesson's worked example and review section.
const GuidedProblemSchema = z.object({
  prompt: z.string().min(1),
  steps: z.array(z.string()),
  answer: z.string().min(1)
});

const ReviewSchema = z.object({
  summary: z.string().min(1),
  prerequisites: z.array(z.string().min(1)).min(1),
  formulas: z.array(z.string()),
  guidedProblem: GuidedProblemSchema
});

// Mirror the lesson's two three-question practice pages and five-question final set.
const OutputSchema = z.object({
  subject: z.string().min(1),
  review: ReviewSchema,
  questions: z.array(QuizQuestionSchema).length(3),
  moreQuestions: z.array(QuizQuestionSchema).length(3),
  finalQuestions: z.array(QuizQuestionSchema).length(5)
});

// Return Zod's structured success/error result for an incoming prompt.
function validatePromptInput(input) {
  return PromptSchema.safeParse(input);
}

module.exports = {
  PromptSchema,
  validatePromptInput,
  OutputSchema,
  QuizQuestionSchema,
  SingleQuestionAnswerSchema
};