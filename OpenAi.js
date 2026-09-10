const CATEGORY_ERROR_CODE = "Id10T error";

const globalScope = typeof window !== "undefined" ? window : globalThis;

const QUIZ_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    review: {
      type: "object",
      properties: {
        summary: { type: "string" },
        formulas: { type: "array", items: { type: "string" } },
        guidedProblem: {
          type: "object",
          properties: {
            prompt: { type: "string" },
            steps: { type: "array", items: { type: "string" } },
            answer: { type: "string" }
          },
          required: ["prompt", "steps", "answer"],
          additionalProperties: false
        }
      },
      required: ["summary", "formulas", "guidedProblem"],
      additionalProperties: false
    },
    questions: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" }
        },
        required: ["question", "answer"],
        additionalProperties: false
      }
    },
    finalQuestions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" }
        },
        required: ["question", "answer"],
        additionalProperties: false
      }
    }
  },
  required: ["subject", "review", "questions", "finalQuestions"],
  additionalProperties: false
};

// The model fact-checks educational content; deterministic checks independently
// reject malformed data and simple arithmetic errors.
const VERIFICATION_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    questions: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          isAccurate: { type: "boolean" },
          isOnTopic: { type: "boolean" },
          reasonIfInaccurate: { type: "string" }
        },
        required: ["question", "answer", "isAccurate", "isOnTopic", "reasonIfInaccurate"],
        additionalProperties: false
      }
    },
    finalQuestions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          isAccurate: { type: "boolean" },
          isOnTopic: { type: "boolean" },
          reasonIfInaccurate: { type: "string" }
        },
        required: ["question", "answer", "isAccurate", "isOnTopic", "reasonIfInaccurate"],
        additionalProperties: false
      }
    },
    allQuestionsValid: { type: "boolean" },
    correctedQuestions: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" }
        },
        required: ["question", "answer"],
        additionalProperties: false
      }
    },
    correctedFinalQuestions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" }
        },
        required: ["question", "answer"],
        additionalProperties: false
      }
    }
  },
  required: ["subject", "questions", "finalQuestions", "allQuestionsValid", "correctedQuestions", "correctedFinalQuestions"],
  additionalProperties: false
};

function isValidVerificationResult(result) {
  return Boolean(
    result &&
    typeof result.subject === "string" &&
    Array.isArray(result.questions) &&
     result.questions.length === 6 &&
    result.questions.every((question) =>
      question &&
      typeof question.question === "string" &&
      typeof question.answer === "string" &&
      question.isAccurate === true &&
      question.isOnTopic === true
    ) &&
     Array.isArray(result.finalQuestions) &&
     result.finalQuestions.length === 5 &&
     result.finalQuestions.every((question) =>
       question &&
       typeof question.question === "string" &&
       typeof question.answer === "string" &&
       question.isAccurate === true &&
       question.isOnTopic === true
     ) &&
    result.allQuestionsValid === true &&
    Array.isArray(result.correctedQuestions) &&
     result.correctedQuestions.length === 6 &&
    result.correctedQuestions.every((question) =>
      question &&
      typeof question.question === "string" &&
      typeof question.answer === "string"
    ) &&
    Array.isArray(result.correctedFinalQuestions) &&
    result.correctedFinalQuestions.length === 5 &&
    result.correctedFinalQuestions.every((question) =>
      question &&
      typeof question.question === "string" &&
      typeof question.answer === "string"
    )
  );
}

let leoProfanity = null;
let leoProfanityLoaded = false;

try {
  if (typeof require === "function") {
    leoProfanity = require("leo-profanity");
    leoProfanity.loadDictionary();
    leoProfanityLoaded = true;
  }
} catch (err) {
  console.warn("Profanity filter unavailable:", err);
}

function isMoreThan4Words(text) {
  if (!text) return false;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return wordCount >= 4;
}

function normalizeCategoryText(text) {
  if (!text) return "";
  return text.replace(/^Category:\s*/i, "").replace(/["'`]/g, "").trim();
}

function normalizeForComparison(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[`"'()]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferCategoryFromPrompt(text) {
  if (!text) return "";

  return text
    .trim()
    .replace(/^\s*(how do i solve|how can i solve|how do i|how can i|how to|what is|what are|do|show|explain|teach|learn|practice|solve|study)\b\s+/i, "")
    .replace(/^category:\s*/i, "")
    .replace(/["'`]/g, "")
    .trim();
}

function extractJsonObject(rawText) {
  if (!rawText) return null;

  let text = String(rawText).trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function deterministicQuestionCheck(questionSet) {
  if (!Array.isArray(questionSet) || questionSet.length === 0) {
    return { valid: false, reason: "The question set is empty or malformed." };
  }

  const normalizedQuestions = questionSet.map((item) => normalizeForComparison(item?.question));
  if (normalizedQuestions.some((question) => !question)) {
    return { valid: false, reason: "Every question must contain text." };
  }
  if (new Set(normalizedQuestions).size !== normalizedQuestions.length) {
    return { valid: false, reason: "Questions must not be duplicates." };
  }
  if (questionSet.some((item) => !item || !String(item.answer || "").trim())) {
    return { valid: false, reason: "Every question must contain an answer." };
  }

  for (const item of questionSet) {
    const expression = String(item.question).match(/\b(\d+(?:\s*[+\-*\/]\s*\d+){1,})\b/);
    if (!expression) continue;

    const expected = Function(`"use strict"; return (${expression[1]})`)();
    const answerNumber = Number(String(item.answer).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
    if (!Number.isFinite(expected) || !Number.isFinite(answerNumber) || Math.abs(expected - answerNumber) > 1e-9) {
      return { valid: false, reason: `The arithmetic answer for "${item.question}" is incorrect.` };
    }
  }

  return { valid: true, reason: "Structure and checkable arithmetic passed without AI." };
}

function deterministicLessonCheck(quizData) {
  const practiceCheck = deterministicQuestionCheck(quizData?.questions);
  if (!practiceCheck.valid) return practiceCheck;
  return deterministicQuestionCheck(quizData?.finalQuestions);
}

function buildQuizPrompt(subject) {
  return `# Quiz Generation Task

You are creating an educational quiz on the subject: **${subject}**

## Core Requirements

  - Generate exactly **6 guided-practice questions** and exactly **5 final-practice questions** directly about ${subject}
  - Create one review page with a concise summary, key formulas or rules, and one guided problem with numbered steps
  - Put answers in the guided-practice set for immediate review; keep final-practice answers separate
- Each answer must be the correct, final response with NO extra explanation
- All answers must be factually accurate and match their questions precisely

## Answer Format Guidelines

- Keep answers concise (1-5 words typically)
- For acronyms: provide the expanded form OR abbreviation consistently
  - Example: "FOIL method" or "First Outer Inner Last" (not both in different answers)
- Avoid answers that are too vague or too verbose
- Ensure mathematical accuracy for math topics
- For procedures/steps: provide the most essential element as the answer

## Quality Checklist

✓ Every question tests understanding of ${subject}  
✓ No off-topic, general knowledge, or unrelated trivia questions  
✓ Each answer directly responds to its question  
✓ Answers are internally consistent in style and format  
✓ Return ONLY valid JSON matching this exact schema:

\`\`\`json
${JSON.stringify(QUIZ_OUTPUT_SCHEMA, null, 2)}
\`\`\``;
}

async function verifyQuizAnswerSet(subject, quizData, apiKey, attemptNumber = 1) {
  if (!quizData || !Array.isArray(quizData.questions) || quizData.questions.length !== 6 || !Array.isArray(quizData.finalQuestions) || quizData.finalQuestions.length !== 5) {
    return quizData || { subject, questions: [] };
  }

  // Max 3 verification attempts
  const MAX_VERIFICATION_ATTEMPTS = 3;
  if (attemptNumber > MAX_VERIFICATION_ATTEMPTS) {
    console.warn(`Verification exceeded max attempts (${MAX_VERIFICATION_ATTEMPTS}). Returning quiz as-is.`);
    return quizData;
  }

  const verifyPrompt = `# Quiz Verification & Quality Assurance

## Your Task
Validate and verify the following quiz for **${subject}**. Check that ALL questions are accurate, on-topic, and have correct answers.

## Validation Criteria

1. **Accuracy Check**: Is every answer factually correct?
2. **Topic Consistency**: Does every question stay strictly on ${subject}?
3. **Quality**: Are answers clear, concise, and directly responsive to questions?
4. **Consistency**: Are answers formatted consistently (e.g., all acronyms handled the same way)?

## Instructions

If you find ANY inaccurate or off-topic questions:
- Correct them to ensure accuracy
- Fix answer formatting for consistency
- Return the corrected quiz

If all questions are valid:
- Return the quiz as-is (no changes needed)

## Quiz to Verify
\`\`\`json
${JSON.stringify(quizData, null, 2)}
\`\`\`

## Deterministic pre-check (performed without AI)
${JSON.stringify(deterministicLessonCheck(quizData))}

If the deterministic pre-check is invalid, you MUST correct the affected question before returning.

## Response Format (ONLY valid JSON)
\`\`\`json
${JSON.stringify(VERIFICATION_SCHEMA, null, 2)}
\`\`\`

**Important**: Return only the JSON with no additional text.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: verifyPrompt }],
        temperature: 0.1,
        max_tokens: 1000,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "quiz_verification_schema",
            strict: true,
            schema: VERIFICATION_SCHEMA
          }
        }
      })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn(`Verification API error (attempt ${attemptNumber}):`, data?.error?.message);
      return quizData;
    }

    const verificationResult = extractJsonObject(data?.choices?.[0]?.message?.content || "");
    
    if (!verificationResult) {
      console.warn(`Failed to parse verification response (attempt ${attemptNumber})`);
      return quizData;
    }

    if (isValidVerificationResult(verificationResult)) {
      return {
        subject: verificationResult.subject || quizData.subject,
        questions: verificationResult.correctedQuestions,
        finalQuestions: verificationResult.correctedFinalQuestions,
        review: quizData.review
      };
    }

    if (verificationResult && Array.isArray(verificationResult.correctedQuestions) && verificationResult.correctedQuestions.length === 6 && Array.isArray(verificationResult.correctedFinalQuestions) && verificationResult.correctedFinalQuestions.length === 5) {
      console.log(`Corrections found in verification attempt ${attemptNumber}. Retrying verification...`);
      const correctedQuiz = {
        subject: verificationResult.subject || quizData.subject,
        questions: verificationResult.correctedQuestions,
        finalQuestions: verificationResult.correctedFinalQuestions,
        review: quizData.review
      };
      // Retry verification with corrected quiz
      return verifyQuizAnswerSet(subject, correctedQuiz, apiKey, attemptNumber + 1);
    }

    return quizData;
  } catch (err) {
    console.warn(`Quiz verification error (attempt ${attemptNumber}):`, err);
    return quizData;
  }
}

async function AskOpenAi(userInput, apiKeyOverride) {
  if (!userInput || !userInput.trim()) {
    return { subject: "", questions: [] };
  }

  const requestApiKey = apiKeyOverride || globalScope?.APP_CONFIG?.OPENAI_API_KEY || process?.env?.OPENAI_API_KEY;
  let category_data = userInput.trim();

  function AllaAntiSwear(text) {
    if (!leoProfanity || !leoProfanityLoaded) {
      return false;
    }

    return leoProfanity.check(text);
  }

  if (isMoreThan4Words(userInput)) {
    const catPrompt = `
      Please output the category that this is about.
      The category should not alter the original user input substantially.
      Focus on the specific subject the user wants. Example: "Give me hundreds of questions about the Pythagorean Theorem" Subject: "Pythagorean Theorem"
      If the subject is unsafe or something you cannot design a quiz around, output: ${CATEGORY_ERROR_CODE}\n\n###\n\n${userInput}
    `;

    try {
      const category_summary_response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requestApiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: catPrompt }],
          max_tokens: 32
        })
      });

      const category_response_data = await category_summary_response.json().catch(() => null);
      const raw = category_response_data?.choices?.[0]?.message?.content || "";
      const cleaned = normalizeCategoryText(raw);
      const normalizedRaw = normalizeForComparison(raw);
      const normalizedErrorCode = normalizeForComparison(CATEGORY_ERROR_CODE);

      if (
        normalizedRaw.includes(normalizedErrorCode) ||
        normalizeForComparison(cleaned).includes(normalizedErrorCode) ||
        AllaAntiSwear(category_data)
      ) {
        return { subject: "Error", questions: [] };
      }

      const inferredCategory = inferCategoryFromPrompt(cleaned || userInput);
      if (inferredCategory) {
        category_data = inferredCategory;
      } else if (cleaned) {
        category_data = cleaned;
      }
    } catch (err) {
      console.warn("Category extraction failed:", err);
      category_data = userInput.trim();
    }
  }

  const finalPrompt = buildQuizPrompt(category_data);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requestApiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: finalPrompt }],
        temperature: 0.2,
        max_tokens: 2200,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "quiz_schema",
            schema: QUIZ_OUTPUT_SCHEMA
          }
        }
      })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        subject: category_data,
        questions: [],
        error: data?.error?.message || `status ${response?.status}`
      };
    }

    const out = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(out);

    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length === 6 && Array.isArray(parsed.finalQuestions) && parsed.finalQuestions.length === 5 && parsed.review && parsed.subject) {
      const verifiedQuiz = await verifyQuizAnswerSet(category_data, parsed, requestApiKey);
      if (verifiedQuiz && Array.isArray(verifiedQuiz.questions) && verifiedQuiz.questions.length === 6 && Array.isArray(verifiedQuiz.finalQuestions) && verifiedQuiz.finalQuestions.length === 5 && verifiedQuiz.subject) {
        return verifiedQuiz;
      }
      return parsed;
    }

    return {
      subject: category_data,
      questions: []
    };
  } catch (err) {
    return {
      subject: category_data,
      questions: [],
      error: err.message || String(err)
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { AskOpenAi, QUIZ_OUTPUT_SCHEMA, VERIFICATION_SCHEMA };
}

globalScope.AskOpenAi = AskOpenAi;
