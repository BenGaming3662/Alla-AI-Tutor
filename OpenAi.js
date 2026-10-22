const CATEGORY_ERROR_CODE = "Id10T error";

const globalScope = typeof window !== "undefined" ? window : globalThis;

// Keep the quiz-size contract in one place. Schemas, runtime checks, prompts, and tests use these values.
const QUIZ_COUNTS = Object.freeze({
  practice: 6,
  final: 5
});

// Constrains the quiz-generation response before it can reach verification or the UI.
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
      minItems: QUIZ_COUNTS.practice,
      maxItems: QUIZ_COUNTS.practice,
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
      minItems: QUIZ_COUNTS.final,
      maxItems: QUIZ_COUNTS.final,
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


// Requires the verifier to report the original and corrected sets with accuracy metadata.
const VERIFICATION_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    questions: {
      type: "array",
      minItems: QUIZ_COUNTS.practice,
      maxItems: QUIZ_COUNTS.practice,
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
      minItems: QUIZ_COUNTS.final,
      maxItems: QUIZ_COUNTS.final,
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
    correctedQuestions: {
      type: "array",
      minItems: QUIZ_COUNTS.practice,
      maxItems: QUIZ_COUNTS.practice,
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
    correctedFinalQuestions: {
      type: "array",
      minItems: QUIZ_COUNTS.final,
      maxItems: QUIZ_COUNTS.final,
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
    }
  },
  required: ["subject", "questions", "finalQuestions", "correctedQuestions", "correctedFinalQuestions"],
  additionalProperties: false
};

// A verified set must have the expected size and every item must be accurate and on-topic.
function hasVerifiedQuestionSet(questionSet, expectedCount) {
  return Array.isArray(questionSet) &&
    questionSet.length === expectedCount &&
    questionSet.every((question) =>
      question &&
      typeof question.question === "string" &&
      typeof question.answer === "string" &&
      question.isAccurate === true &&
      question.isOnTopic === true
    );
}

// Accept only verification results that fully validate both original and corrected sets.
function isValidVerificationResult(result) {
  return Boolean(
    result &&
    typeof result.subject === "string" &&
    hasVerifiedQuestionSet(result.questions, QUIZ_COUNTS.practice) &&
    hasVerifiedQuestionSet(result.finalQuestions, QUIZ_COUNTS.final) &&
    hasVerifiedQuestionSet(result.correctedQuestions, QUIZ_COUNTS.practice) &&
    hasVerifiedQuestionSet(result.correctedFinalQuestions, QUIZ_COUNTS.final)
  );
}

// Keep verifier-only flags out of the object consumed by the lesson UI.
function removeVerificationMetadata(questionSet) {
  return questionSet.map(({ question, answer }) => ({ question, answer }));
}

function showVerificationAlert(message) {
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(message);
  }
}

let leoProfanity = null;
let leoProfanityLoaded = false;

// Leo Profanity does not recognize every term in the product's safety policy.
// These fallback terms keep blocking deterministic when the package is unavailable or incomplete.
const CUSTOM_PROFANITY_WORDS = new Set([
  "fuck",
  "damn",
  "hell",
  "crap",
  "idiot",
  "stupid",
  "dumb",
  "freak",
  "freaking",
  "butt",
  "jerk",
  "trash",
  "screw",
  "screwed",
  "idiocy",
  "moron",
  "loser",
  "hate"
]);

try {
  if (typeof require === "function") {
    leoProfanity = require("leo-profanity");
    if (typeof leoProfanity?.loadDictionary === "function") {
      leoProfanity.loadDictionary();
    }
    leoProfanityLoaded = Boolean(leoProfanity);
  }
} catch (err) {
  console.warn("Profanity filter unavailable:", err);
  leoProfanityLoaded = false;
}

function isProfanityBlocked(text) {
  if (!text) {
    return false;
  }

  const candidate = String(text).toLowerCase();
  const words = candidate.match(/[a-z']+/g) || [];

  // Check the local fallback first so the guard works in both browser and Node environments.
  if (words.some((word) => CUSTOM_PROFANITY_WORDS.has(word.replace(/['’]/g, "")))) {
    return true;
  }

  // Use Leo as a broader secondary dictionary when it is available.
  if (!leoProfanity || !leoProfanityLoaded) {
    return false;
  }

  try {
    if (typeof leoProfanity.check === "function" && leoProfanity.check(candidate)) {
      return true;
    }

    if (typeof leoProfanity.badWordsUsed === "function") {
      const badWords = leoProfanity.badWordsUsed(candidate) || [];
      return badWords.length > 0;
    }
  } catch (err) {
    console.warn("Profanity validation failed:", err);
  }

  return false;
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

const ACADEMIC_SUBJECT_TERMS = [
  "algebra", "calculus", "geometry", "trigonometry", "statistics", "probability", "arithmetic", "mathematics", "math",
  "physics", "chemistry", "biology", "astronomy", "geology", "science", "computer science", "programming", "coding",
  "history", "geography", "economics", "psychology", "sociology", "political science", "government", "civics", "law",
  "philosophy", "ethics", "anthropology", "linguistics", "literature", "writing", "grammar", "reading", "language",
  "english", "spanish", "french", "german", "art history", "music theory", "engineering", "medicine", "anatomy"
];

function isAcademicSubject(subjectText) {
  const normalized = normalizeForComparison(subjectText || "");
  return ACADEMIC_SUBJECT_TERMS.some((term) => normalized === term || normalized.includes(` ${term} `) || normalized.startsWith(`${term} `) || normalized.endsWith(` ${term}`));
}

function isGenericSubject(subjectText) {
  const normalized = normalizeForComparison(subjectText || "");
  if (!normalized) return true;

  const genericValues = [
    "this is a test prompt",
    "test prompt",
    "this is a test",
    "sample prompt",
    "random prompt",
    "prompt",
    "test",
    "question",
    "help",
    "general knowledge",
    "topic",
    "subject"
  ];

  if (genericValues.includes(normalized)) {
    return true;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const genericWords = new Set(["this", "is", "a", "an", "test", "prompt", "question", "help", "topic", "subject", "general", "knowledge", "sample", "random", "thing", "stuff"]);

  if (words.length === 1) {
    return words[0].length <= 2 || genericWords.has(words[0]);
  }

  return words.every((word) => genericWords.has(word) || word.length <= 2);
}

function isGenericPrompt(inputText) {
  const normalized = normalizeForComparison(inputText || "");
  if (!normalized) return true;

  const genericPatterns = [
    "this is a test prompt",
    "this is a test",
    "test prompt",
    "sample prompt",
    "random prompt",
    "prompt",
    "test",
    "question",
    "help me",
    "help",
    "general knowledge",
    "topic",
    "subject"
  ];

  if (genericPatterns.includes(normalized)) {
    return true;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const genericWords = new Set(["this", "is", "a", "an", "test", "prompt", "question", "help", "me", "topic", "subject", "general", "knowledge", "sample", "random", "thing", "stuff"]);

  if (words.length <= 3) {
    return words.every((word) => genericWords.has(word) || word.length <= 2);
  }

  return false;
}

function extractJsonObject(rawText) {
  if (!rawText) return null;

  let text = String(rawText).trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  // Models may wrap valid JSON in Markdown fences or surrounding prose.
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

  - Generate exactly **${QUIZ_COUNTS.practice} guided-practice questions** and exactly **${QUIZ_COUNTS.final} final-practice questions** directly about ${subject}
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
  if (!quizData || !Array.isArray(quizData.questions) || quizData.questions.length !== QUIZ_COUNTS.practice || !Array.isArray(quizData.finalQuestions) || quizData.finalQuestions.length !== QUIZ_COUNTS.final) {
    return quizData || { subject, questions: [] };
  }

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

    // Only corrected content from a fully valid verification response is returned to the UI.
    if (isValidVerificationResult(verificationResult)) {
      return {
        subject: verificationResult.subject || quizData.subject,
        questions: removeVerificationMetadata(verificationResult.correctedQuestions),
        finalQuestions: removeVerificationMetadata(verificationResult.correctedFinalQuestions),
        review: quizData.review
      };
    }

    const correctedQuestions = Array.isArray(verificationResult.correctedQuestions) ? removeVerificationMetadata(verificationResult.correctedQuestions) : quizData.questions;
    const correctedFinalQuestions = Array.isArray(verificationResult.correctedFinalQuestions) ? removeVerificationMetadata(verificationResult.correctedFinalQuestions) : quizData.finalQuestions;

    if (!Array.isArray(correctedQuestions) || correctedQuestions.length !== QUIZ_COUNTS.practice || !Array.isArray(correctedFinalQuestions) || correctedFinalQuestions.length !== QUIZ_COUNTS.final) {
      console.warn("Verification result missing corrected question sets; keeping original quiz.");
      showVerificationAlert("The quiz verification failed because the question count did not match the expected format. Please contact support or try again.");
      return quizData;
    }

    const correctedQuiz = {
      subject: verificationResult.subject || quizData.subject,
      questions: correctedQuestions,
      finalQuestions: correctedFinalQuestions,
      review: quizData.review
    };

    return verifyQuizAnswerSet(subject, correctedQuiz, apiKey, attemptNumber + 1);
  } catch (err) {
    console.warn(`Quiz verification error (attempt ${attemptNumber}):`, err);
    showVerificationAlert("The quiz verification could not complete. The question count may be different or a support issue may be needed.");
    return quizData;
  }
}

async function AskOpenAi(userInput, apiKeyOverride) {
  if (!userInput || !userInput.trim()) {
    return { subject: "", questions: [] };
  }

  const trimmedInput = userInput.trim();
  // Reject unsafe or non-substantive input before spending an API call.
  if (isProfanityBlocked(trimmedInput) || isGenericPrompt(trimmedInput)) {
    return { subject: "Error", questions: [] };
  }

  const requestApiKey = apiKeyOverride || globalScope?.APP_CONFIG?.OPENAI_API_KEY || process?.env?.OPENAI_API_KEY;
  let category_data = trimmedInput;

  {
    // Classify every substantive prompt so short math skills are supported without a hardcoded topic list.
    const catPrompt = `Identify the broad academic subject for this request. Map every mathematics request, including specific skills or methods, to Math. Return only the subject. If the subject is unsafe, non-academic, or something you cannot design a quiz around, output: ${CATEGORY_ERROR_CODE}\n\n###\n\n${userInput}`;

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
        isProfanityBlocked(category_data)
      ) {
        return { subject: "Error", questions: [] };
      }

      const inferredCategory = inferCategoryFromPrompt(cleaned || userInput);
      const candidateCategory = inferredCategory || cleaned || userInput.trim();

      if (isGenericSubject(candidateCategory)) {
        return { subject: "Error", questions: [] };
      }

      category_data = candidateCategory;

      if (isProfanityBlocked(category_data)) {
        return { subject: "Error", questions: [] };
      }
    } catch (err) {
      console.warn("Category extraction failed:", err);
      category_data = userInput.trim();
    }
  }

  // Fail closed: only recognized academic subjects may reach quiz generation.
  if (!isAcademicSubject(category_data)) {
    return { subject: "Error", questions: [] };
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

    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length === QUIZ_COUNTS.practice && Array.isArray(parsed.finalQuestions) && parsed.finalQuestions.length === QUIZ_COUNTS.final && parsed.review && parsed.subject) {
      const verifiedQuiz = await verifyQuizAnswerSet(category_data, parsed, requestApiKey);
      if (verifiedQuiz && Array.isArray(verifiedQuiz.questions) && verifiedQuiz.questions.length === QUIZ_COUNTS.practice && Array.isArray(verifiedQuiz.finalQuestions) && verifiedQuiz.finalQuestions.length === QUIZ_COUNTS.final && verifiedQuiz.subject) {
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
  module.exports = { AskOpenAi, isValidVerificationResult, QUIZ_COUNTS, QUIZ_OUTPUT_SCHEMA, VERIFICATION_SCHEMA };
}

globalScope.AskOpenAi = AskOpenAi;
