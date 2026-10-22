// REVIEW GUIDE
// Purpose: generate, validate, and verify structured tutoring lessons.
// Code map (line numbers are approximate; use the named symbols when searching):
// - 17-182: CATEGORY_ERROR_CODE / QUIZ_COUNTS and the generation/verification schemas.
// - 181-206: input moderation, including isProfanityBlocked.
// - 208-244: category/text normalization, JSON extraction, and basic shape checks.
// - 246-339: answer comparison and verifier-output checks
//   (isAnswerCorrect, getVerificationFailure, isValidVerification).
// - 341-380: arithmetic-specific checks and the full isQuizValid lesson validation.
// - 382-419: generation/verification prompts and requestJsonSchema API helper.
// - 421-532: AskOpenAi orchestration: classify, generate, validate, verify, retry, return.
// - 534-549: CommonJS exports for tests/server and globals used by the browser page.
// Key contract: 3 questions in each practice set and 5 in final practice.
// Browser requests use the same-origin server; server-side callers use the API directly.
// Run `npm test` for deterministic regression checks without paid model requests.

// 1. Configuration and response contracts.
// This exact sentinel tells the UI that AI classification rejected the request.
const CATEGORY_ERROR_CODE = "Id10T error";
const globalScope = typeof window !== "undefined" ? window : globalThis;
const QUIZ_COUNTS = Object.freeze({ practicePerPage: 3, final: 5 });
const OPENAI_MODEL = "gpt-4o-mini";

// Model response contracts shared by generation, verification, and the lesson UI.
const QUIZ_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    review: {
      type: "object",
      properties: {
        summary: { type: "string" },
        prerequisites: { type: "array", items: { type: "string" } },
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
      required: ["summary", "prerequisites", "formulas", "guidedProblem"],
      additionalProperties: false
    },
    questions: {
      type: "array",
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
    moreQuestions: {
      type: "array",
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
  required: ["subject", "review", "questions", "moreQuestions", "finalQuestions"],
  additionalProperties: false
};

// Keep the verifier schema aligned with getVerificationFailure below:
// each set includes the original audit and a separately corrected set.
// The verifier reports each source set and its corrected set, with a decision for every item.
const VERIFICATION_SCHEMA = {
  type: "object",
  properties: {
    reviewPrerequisitesValid: { type: "boolean" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          isAccurate: { type: "boolean" },
          isOnTopic: { type: "boolean" }
        },
        required: ["question", "answer", "isAccurate", "isOnTopic"],
        additionalProperties: false
      }
    },
    moreQuestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          isAccurate: { type: "boolean" },
          isOnTopic: { type: "boolean" }
        },
        required: ["question", "answer", "isAccurate", "isOnTopic"],
        additionalProperties: false
      }
    },
    finalQuestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          isAccurate: { type: "boolean" },
          isOnTopic: { type: "boolean" }
        },
        required: ["question", "answer", "isAccurate", "isOnTopic"],
        additionalProperties: false
      }
    },
    correctedQuestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          isAccurate: { type: "boolean" },
          isOnTopic: { type: "boolean" }
        },
        required: ["question", "answer", "isAccurate", "isOnTopic"],
        additionalProperties: false
      }
    },
    correctedMoreQuestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          isAccurate: { type: "boolean" },
          isOnTopic: { type: "boolean" }
        },
        required: ["question", "answer", "isAccurate", "isOnTopic"],
        additionalProperties: false
      }
    },
    correctedFinalQuestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          isAccurate: { type: "boolean" },
          isOnTopic: { type: "boolean" }
        },
        required: ["question", "answer", "isAccurate", "isOnTopic"],
        additionalProperties: false
      }
    }
  },
  required: ["reviewPrerequisitesValid", "questions", "moreQuestions", "finalQuestions", "correctedQuestions", "correctedMoreQuestions", "correctedFinalQuestions"],
  additionalProperties: false
};

// 2. Input moderation.
// Combine Leo's dictionary with the app's fallback terms; fail closed if Leo fails.
let profanityFilter = null;
const CUSTOM_PROFANITY_WORDS = new Set([
  "idiot"
]);

try {
  if (typeof require === "function") {
    profanityFilter = require("leo-profanity");
    profanityFilter.loadDictionary();
  }
} catch {
  // If the filter cannot load, isProfanityBlocked rejects input rather than bypassing moderation.
  profanityFilter = null;
}

function isProfanityBlocked(text) {
  try {
    // Treat a missing filter as a blocked result; callers can never silently skip moderation.
    if (!profanityFilter || typeof profanityFilter.check !== "function") return true;
    const candidate = String(text || "").toLowerCase();
    const words = candidate.match(/[a-z']+/g) || [];
    return words.some((word) => CUSTOM_PROFANITY_WORDS.has(word.replace(/['’]/g, ""))) || profanityFilter.check(candidate);
  } catch {
    return true;
  }
}

// 3. Prompt normalization, parsing, and structural validation.
// Remove common model prefixes/quotes before checking the non-academic sentinel.
function normalizeCategoryText(text) {
  return String(text || "").replace(/^Category:\s*/i, "").replace(/["'`]/g, "").trim();
}

// Compare labels without case or punctuation differences.
function normalizeForComparison(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Parse model JSON while tolerating code fences or short surrounding text.
function extractJsonObject(rawText) {
  if (!rawText) return null;
  const text = String(rawText).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // Model replies may wrap JSON in prose or Markdown fences; parse only the outermost object.
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

// Type guards used to reject malformed model output before rendering or grading.
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isQuestionSetValid(questionSet, expectedCount) {
  // Validate both the fixed count and each renderable question/answer pair.
  return Array.isArray(questionSet) && questionSet.length === expectedCount && questionSet.every((item) =>
    isRecord(item) && typeof item.question === "string" && item.question.trim() &&
    typeof item.answer === "string" && item.answer.trim()
  );
}

function isCorrectSingleDigitMultiplicationFact(text) {
  const match = String(text || "").match(/\b(\d)\s*(?:×|x|\*|times|multiplied by)\s*(\d)\s*(?:=|equals?|is)\s*(\d+)\b/i);
  return Boolean(match && Number(match[1]) * Number(match[2]) === Number(match[3]));
}

function hasSquareUnitExample(text) {
  return /\bsquare\s+(?:units?|centimeters?|millimeters?|meters?|inches|feet)\b|\b(?:units?|cm|mm|m|in|ft)\s*(?:\^?2|²)\b/i.test(String(text || ""));
}

function getReviewPrerequisiteFailure(quiz, requestedTopic) {
  const topic = String(requestedTopic || "");
  const prerequisites = quiz?.review?.prerequisites;
  if (!Array.isArray(prerequisites)) return "";

  const isArea = /\barea\b/i.test(topic);
  const needsMultiplicationFact = isArea || /\b(?:multiplication|multiply|multiplying|multiplied|times tables?|products?)\b/i.test(topic);
  if (needsMultiplicationFact && !prerequisites.some(isCorrectSingleDigitMultiplicationFact)) {
    return "Review prerequisites must include a correct single-digit multiplication fact before larger multiplication or area work.";
  }
  if (isArea && !prerequisites.some(hasSquareUnitExample)) {
    return "Review prerequisites for area must explain square units with an example.";
  }
  return "";
}

// 4. Student answer normalization, grading, and verification.
// No fuzzy partial matches are accepted.
function normalizeAnswer(value) {
  return String(value || "").toLowerCase().replace(/[²³]/g, (power) => power === "²" ? "^2" : "^3").replace(/[^a-z0-9^]+/g, " ").trim();
}

function parseNumericAnswer(value) {
  const text = String(value || "").trim().toLowerCase()
    .replace(/^(?:the\s+)?(?:answer|result)\s*(?:is|:|=)?\s*/i, "")
    .replace(/[²³]/g, (power) => power === "²" ? "^2" : "^3");
  const match = /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(.*))?$/.exec(text);
  if (!match) return null;

  const number = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;

  const unitText = (match[2] || "").replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  const unitAliases = new Map([
    ["square centimeter", "cm^2"], ["square centimeters", "cm^2"], ["centimeter squared", "cm^2"], ["centimeters squared", "cm^2"], ["cm2", "cm^2"], ["cm ^2", "cm^2"],
    ["square millimeter", "mm^2"], ["square millimeters", "mm^2"], ["millimeter squared", "mm^2"], ["millimeters squared", "mm^2"], ["mm2", "mm^2"], ["mm ^2", "mm^2"],
    ["square meter", "m^2"], ["square meters", "m^2"], ["meter squared", "m^2"], ["meters squared", "m^2"], ["m2", "m^2"], ["m ^2", "m^2"],
    ["square inch", "in^2"], ["square inches", "in^2"], ["inch squared", "in^2"], ["inches squared", "in^2"], ["in2", "in^2"], ["in ^2", "in^2"],
    ["square foot", "ft^2"], ["square feet", "ft^2"], ["foot squared", "ft^2"], ["feet squared", "ft^2"], ["ft2", "ft^2"], ["ft ^2", "ft^2"],
    ["centimeter", "cm"], ["centimeters", "cm"], ["millimeter", "mm"], ["millimeters", "mm"], ["meter", "m"], ["meters", "m"],
    ["inch", "in"], ["inches", "in"], ["foot", "ft"], ["feet", "ft"]
  ]);
  return { number, unit: unitAliases.get(unitText) || unitText };
}

// Match normalized text, equivalent numeric answers (including omitted units), or exact acronym expansions.
function isAnswerCorrect(userAnswer, expectedAnswer) {
  const user = normalizeAnswer(userAnswer);
  const expected = normalizeAnswer(expectedAnswer);
  if (!user || !expected) return false;
  if (user === expected) return true;

  // Accept formatting variants and omitted units, but reject conflicting explicit units.
  const userNumeric = parseNumericAnswer(userAnswer);
  const expectedNumeric = parseNumericAnswer(expectedAnswer);
  if (userNumeric && expectedNumeric && userNumeric.number === expectedNumeric.number &&
      (!userNumeric.unit || !expectedNumeric.unit || userNumeric.unit === expectedNumeric.unit)) return true;

  const userWords = user.split(" ");
  const expectedWords = expected.split(" ");
  if (userWords.length === 1 && expectedWords.length > 1) {
    return user === expectedWords.map((word) => word[0]).join("");
  }
  if (expectedWords.length === 1 && userWords.length > 1) {
    return expected === userWords.map((word) => word[0]).join("");
  }
  return false;
}

// Corrected sets are accepted only when all reported accuracy/topic checks pass.
function isVerifiedSet(verifiedSet, originalSet) {
  return Array.isArray(originalSet) && Array.isArray(verifiedSet) &&
    verifiedSet.length === originalSet.length && verifiedSet.every((item) =>
    isRecord(item) && typeof item.question === "string" && item.question.trim() &&
    typeof item.answer === "string" && item.answer.trim() &&
    item.isAccurate === true && item.isOnTopic === true
  );
}

// Originals must match the generated quiz, but may be marked false so the verifier can correct them.
function isVerifiedOriginalSet(verifiedSet, originalSet) {
  // The audit must refer to the exact generated items; only the corrected set may change them.
  return Array.isArray(originalSet) && Array.isArray(verifiedSet) &&
    verifiedSet.length === originalSet.length && originalSet.every(isRecord) &&
    verifiedSet.every((item, index) => isRecord(item) &&
      typeof item.question === "string" && item.question.trim() &&
      typeof item.answer === "string" && item.answer.trim() &&
      typeof item.isAccurate === "boolean" && typeof item.isOnTopic === "boolean" &&
      normalizeForComparison(item.question) === normalizeForComparison(originalSet[index].question) &&
      normalizeForComparison(item.answer) === normalizeForComparison(originalSet[index].answer)
    );
}

// Return an empty string if every verifier contract passes, otherwise explain the first failure.
function getVerificationFailure(verification, quiz, requestedTopic = "") {
  if (!isRecord(verification) || !isRecord(quiz)) return "The verifier response was not a JSON object.";
  const prerequisiteFailure = getReviewPrerequisiteFailure(quiz, requestedTopic);
  if (prerequisiteFailure) return prerequisiteFailure;
  if (verification.reviewPrerequisitesValid !== true) {
    return "The Review prerequisites must be complete, correct, and explained with examples for the requested topic.";
  }

  const sets = [
    ["Guided Practice", verification.questions, quiz.questions],
    ["More Practice", verification.moreQuestions, quiz.moreQuestions],
    ["Final Practice", verification.finalQuestions, quiz.finalQuestions]
  ];
  for (const [name, originalReport, originalItems] of sets) {
    if (!isVerifiedOriginalSet(originalReport, originalItems)) {
      return `${name} original audit did not match the generated set or include boolean audit flags.`;
    }
  }

  const correctedSets = [
    ["Guided Practice", verification.correctedQuestions, quiz.questions],
    ["More Practice", verification.correctedMoreQuestions, quiz.moreQuestions],
    ["Final Practice", verification.correctedFinalQuestions, quiz.finalQuestions]
  ];
  for (const [name, correctedItems, originalItems] of correctedSets) {
    // Reject the whole verifier result if even one item lacks both positive audit flags.
    if (!isVerifiedSet(correctedItems, originalItems)) {
      return `${name} corrections must preserve the question count and mark every item accurate and on-topic.`;
    }
  }

  if (isTwoDigitAdditionTopic(requestedTopic)) {
    const correctedItems = [
      ...verification.correctedQuestions,
      ...verification.correctedMoreQuestions,
      ...verification.correctedFinalQuestions
    ];
    if (!correctedItems.every(isTwoDigitAdditionItemValid)) {
      return "A corrected two-digit addition item did not have two two-digit operands and the exact sum.";
    }
  }

  return "";
}

function isValidVerification(verification, quiz, requestedTopic = "") {
  return getVerificationFailure(verification, quiz, requestedTopic) === "";
}

// 5. Deterministic arithmetic and generated-lesson validation.
function isTwoDigitAdditionTopic(topic) {
  return /\b(?:two|2)[ -]digit addition\b/i.test(String(topic || ""));
}

// Validate one addition expression and its exact integer answer without evaluating arbitrary code.
function isTwoDigitAdditionItemValid(item) {
  if (!isRecord(item)) return false;
  const expression = String(item.question || item.prompt || "").replace(/^\s*(?:question\s*)?\d+[.):]\s*/i, "");
  const numbers = expression.match(/\d+/g) || [];
  const operands = expression.match(/\b(\d{2})\s*\+\s*(\d{2})\b/);
  const answer = Number(String(item?.answer || "").trim());
  // Restrict this special case to one two-digit addition expression and its exact integer sum.
  return Boolean(
    operands && numbers.length === 2 && /^\d+$/.test(String(item.answer || "").trim()) &&
    Number.isSafeInteger(answer) && Number(operands[1]) >= 10 && Number(operands[2]) >= 10 &&
    Number(operands[1]) + Number(operands[2]) === answer
  );
}

// Validate the full lesson shape, fixed question counts, and topic-specific arithmetic rules.
function isQuizValid(quiz, requestedTopic = "") {
  // Check the common lesson shape before applying any topic-specific arithmetic rules.
  if (!isRecord(quiz) || !isRecord(quiz.review) || !isRecord(quiz.review.guidedProblem)) return false;
  if (typeof quiz.subject !== "string" || !quiz.subject.trim()) return false;
  if (typeof quiz.review.summary !== "string" || !quiz.review.summary.trim()) return false;
  if (!Array.isArray(quiz.review.prerequisites) || !quiz.review.prerequisites.length ||
      !quiz.review.prerequisites.every((item) => typeof item === "string" && item.trim())) return false;
  if (!Array.isArray(quiz.review.formulas) ||
      !quiz.review.formulas.every((formula) => typeof formula === "string" && formula.trim())) return false;
  if (typeof quiz.review.guidedProblem.prompt !== "string" || !quiz.review.guidedProblem.prompt.trim()) return false;
  if (!Array.isArray(quiz.review.guidedProblem.steps) ||
      !quiz.review.guidedProblem.steps.every((step) => typeof step === "string" && step.trim())) return false;
  if (typeof quiz.review.guidedProblem.answer !== "string" || !quiz.review.guidedProblem.answer.trim()) return false;
  if (!isQuestionSetValid(quiz.questions, QUIZ_COUNTS.practicePerPage) ||
      !isQuestionSetValid(quiz.moreQuestions, QUIZ_COUNTS.practicePerPage) ||
      !isQuestionSetValid(quiz.finalQuestions, QUIZ_COUNTS.final)) return false;
  if (getReviewPrerequisiteFailure(quiz, requestedTopic)) return false;
  // Ordinary topics need only satisfy the shared shape/count contract above.
  if (!isTwoDigitAdditionTopic(requestedTopic)) return true;

  return isTwoDigitAdditionItemValid(quiz.review.guidedProblem) &&
    quiz.questions.every(isTwoDigitAdditionItemValid) &&
    quiz.moreQuestions.every(isTwoDigitAdditionItemValid) &&
    quiz.finalQuestions.every(isTwoDigitAdditionItemValid);
}

// 6. Model prompts and API requests.
// Build the generation prompt with the separate 3/3/5 lesson contract.
function buildQuizPrompt(subject, requestedTopic, validateCategory = false) {
  return `# Quiz Generation Task

${validateCategory
    ? `Interpret the user's intent and determine the broad academic discipline for **${requestedTopic}**. A skill or subtopic belongs under its parent discipline; do not use the skill phrase itself as the subject. If no valid academic discipline or teachable topic can be inferred, set subject to exactly **${CATEGORY_ERROR_CODE}** and return empty question arrays.`
    : `Create a lesson for the academic subject **${subject}**.`} The user's requested topic or skill is: **${requestedTopic}**.

Interpret natural-language wording as a request: separate the academic concept from conversational framing, complaints, or expressions of frustration. Do not treat that framing as part of the academic topic. Keep every question focused on the intended concept; do not replace a specific skill with unrelated material. For math, use the requested operation and difficulty, and calculate each answer carefully.

The Review must teach the foundations a learner needs before starting this specific topic. In "prerequisites", list and briefly explain prerequisite skills with a concrete mini-example and its result for each. Do not assume basic facts are already known: for multiplication, include single-digit multiplication facts (such as 6 × 4 = 24) before multi-digit or area problems; for area, refresh multiplication and square units. Tailor the prerequisites to the request, not a generic list. Include a concise review summary, useful formulas or rules, and one fully worked guided problem with steps. The Review page must be usable on its own as a refresher.

Return exactly ${QUIZ_COUNTS.practicePerPage} questions in the "questions" array for Guided Practice, exactly ${QUIZ_COUNTS.practicePerPage} questions in the "moreQuestions" array for More Practice, and exactly ${QUIZ_COUNTS.final} questions in the "finalQuestions" array for Final Practice. Keep these three arrays separate; do not combine the practice pages. Every question and answer must be clear and correct. If the request is not a valid academic subject or lesson topic, return subject exactly as **${CATEGORY_ERROR_CODE}** and all question arrays empty. Return only JSON matching this schema:

${JSON.stringify(QUIZ_OUTPUT_SCHEMA)}`;
}

// Send one strict JSON-schema request and parse the model response.
async function requestJsonSchema(apiKey, schemaName, schema, prompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      max_tokens: 3000,
      response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } }
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `status ${response.status}`);
  // Keep malformed or non-JSON model output out of the validation and rendering pipeline.
  return extractJsonObject(data?.choices?.[0]?.message?.content);
}

// Ask the verifier to audit and correct each set without changing its count.
function buildVerificationPrompt(subject, requestedTopic, quiz) {
  return `Check every original and corrected question in Guided Practice, More Practice, and Final Practice. Keep the three sets separate and preserve each set's original length. Check that the Review prerequisites are necessary, correct, and sufficiently explained for **${requestedTopic}**, including basic facts a learner may not know yet. In particular, multiplication lessons must refresh single-digit multiplication before relying on larger products, and area lessons must explain multiplication and square units. Set reviewPrerequisitesValid to true only if the Review prerequisites are complete, correct, and include concrete examples; otherwise set it to false. Check factual accuracy and relevance to the user's intended academic concept in **${subject}**. Interpret **${requestedTopic}** as natural-language intent; ignore conversational framing, complaints, or frustration when identifying the educational topic. The original arrays must describe the supplied quiz exactly. Correct any inaccurate or off-topic items. Set both flags true only for accurate, on-topic entries. Return only JSON matching this schema:\n\n${JSON.stringify(VERIFICATION_SCHEMA)}\n\nQuiz:\n${JSON.stringify(quiz)}`;
}

// 7. Public entry point: browsers use the same-origin server; server calls use OpenAI directly.
async function AskOpenAi(userInput, apiKeyOverride) {
  const prompt = String(userInput || "").trim();
  if (!prompt) return { subject: "", questions: [] };

  if (typeof window !== "undefined") {
    // Browsers call the same-origin serverless/local proxy; the OpenAI key stays server-side.
    if (globalScope?.location?.protocol === "file:") {
      return {
        subject: "Error",
        questions: [],
        error: "This page needs to be hosted to reach its secure lesson API. Deploy it to Netlify, or use npm start for local development."
      };
    }
    try {
      const response = await fetch("/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) return { subject: "Error", questions: [], error: data?.error || `status ${response.status}` };
      return data?.text || { subject: "Error", questions: [], error: "The server returned an empty response." };
    } catch (error) {
      return { subject: "Error", questions: [], error: error.message || String(error) };
    }
  }

  // Reject unsafe prompts before classification or generation calls.
  if (isProfanityBlocked(prompt)) return { subject: "Error", questions: [], error: "Please remove inappropriate language and try again." };

  const apiKey = apiKeyOverride || globalScope?.APP_CONFIG?.OPENAI_API_KEY ||
    (typeof process !== "undefined" ? process.env?.OPENAI_API_KEY : "");
  if (!apiKey) return { subject: "Error", questions: [], error: "OpenAI API key is not configured." };

  // Short prompts classify during generation; longer prompts use a separate AI classification call.
  const validateCategoryDuringGeneration = prompt.split(/\s+/).length <= 4;
  let subject = "";
  let lastValidationFailure = "";

  try {
    if (!validateCategoryDuringGeneration) {
      // Longer requests are classified first so the generator receives a stable broad subject.
      const classification = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{
            role: "user",
            content: `Extract the broad academic subject for this lesson request. If it is not academic or cannot support a lesson, return exactly ${CATEGORY_ERROR_CODE}. Return only the subject.\n\n${prompt}`
          }],
          max_tokens: 32,
          temperature: 0.1
        })
      });
      const data = await classification.json().catch(() => null);
      if (!classification.ok) throw new Error(data?.error?.message || `status ${classification.status}`);
      subject = normalizeCategoryText(data?.choices?.[0]?.message?.content);
      if (!subject || normalizeForComparison(subject) === normalizeForComparison(CATEGORY_ERROR_CODE)) {
        return { subject: "Error", questions: [] };
      }
      if (isProfanityBlocked(prompt) || isProfanityBlocked(subject)) return { subject: "Error", questions: [] };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      // Generate first, then validate the full lesson before spending a second call on verification.
      const quiz = await requestJsonSchema(
        apiKey,
        "quiz_schema",
        QUIZ_OUTPUT_SCHEMA,
        buildQuizPrompt(subject, prompt, validateCategoryDuringGeneration)
      );
      if (validateCategoryDuringGeneration) {
        quiz.subject = normalizeCategoryText(quiz?.subject);
        if (!quiz.subject || normalizeForComparison(quiz.subject) === normalizeForComparison(CATEGORY_ERROR_CODE)) {
          return { subject: "Error", questions: [] };
        }
        if (isProfanityBlocked(prompt) || isProfanityBlocked(quiz.subject)) return { subject: "Error", questions: [] };
      }
      if (!isQuizValid(quiz, prompt)) {
        lastValidationFailure = getReviewPrerequisiteFailure(quiz, prompt) ||
          `Generation returned ${quiz?.questions?.length || 0} Guided Practice, ${quiz?.moreQuestions?.length || 0} More Practice, and ${quiz?.finalQuestions?.length || 0} Final Practice questions; expected ${QUIZ_COUNTS.practicePerPage}, ${QUIZ_COUNTS.practicePerPage}, and ${QUIZ_COUNTS.final}.`;
        continue;
      }

      const verification = await requestJsonSchema(
        apiKey,
        "quiz_verification_schema",
        VERIFICATION_SCHEMA,
        buildVerificationPrompt(quiz.subject || subject, prompt, quiz)
      );
      const verificationFailure = getVerificationFailure(verification, quiz, prompt);
      if (verificationFailure) {
        // Retry from generation when verification flags any issue; never return a failed audit.
        lastValidationFailure = verificationFailure;
        continue;
      }

      // Expose only verified question/answer fields to the UI, not internal audit metadata.
      return {
        ...quiz,
        questions: verification.correctedQuestions.map(({ question, answer }) => ({ question, answer })),
        moreQuestions: verification.correctedMoreQuestions.map(({ question, answer }) => ({ question, answer })),
        finalQuestions: verification.correctedFinalQuestions.map(({ question, answer }) => ({ question, answer }))
      };
    }

    return {
      subject: subject || "Error",
      questions: [],
      error: `The generated lesson failed validation after three attempts. ${lastValidationFailure} Try again, or contact support if this continues.`
    };
  } catch (error) {
    return { subject: subject || "Error", questions: [], error: error.message || String(error) };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AskOpenAi,
    QUIZ_COUNTS,
    VERIFICATION_SCHEMA,
    QUIZ_OUTPUT_SCHEMA,
    isAnswerCorrect,
    isQuizValid,
    isValidVerification,
    isProfanityBlocked
  };
}

globalScope.AskOpenAi = AskOpenAi;
globalScope.isAnswerCorrect = isAnswerCorrect;
globalScope.QUIZ_COUNTS = QUIZ_COUNTS;
