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
        // Skills the student needs first. Each one gets a short lesson and a tiny worked example.
        prerequisites: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              concept: { type: "string" },
              explanation: { type: "string" },
              example: { type: "string" }
            },
            required: ["concept", "explanation", "example"],
            additionalProperties: false
          }
        },
        // Ordered steps that build from the prerequisites up to the new topic.
        howItWorks: { type: "array", minItems: 1, items: { type: "string" } },
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
      required: ["summary", "prerequisites", "howItWorks", "formulas", "guidedProblem"],
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

// True when two question lists hold the same questions and answers in the same order.
function sameQuestionList(listA, listB) {
  return Array.isArray(listA) &&
    Array.isArray(listB) &&
    listA.length === listB.length &&
    listA.every((item, index) => item?.question === listB[index]?.question && item?.answer === listB[index]?.answer);
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
  "exponent", "exponents", "multiplication", "division", "fractions", "decimals", "percent", "percentage", "equations",
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

// Turns a plain answer like "12", "1,200", "-3.5" or "3/4" into a number.
// Anything else (words, units, "x = 4") returns null, because simple math cannot check it.
function parsePlainNumber(text) {
  const cleaned = String(text || "").trim().replace(/,/g, "").replace(/\.$/, "");
  const fraction = cleaned.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  }
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}

// Works out a question that is ONLY plain arithmetic, like "What is 7 × 8?" or "What is 1/2 + 1/4?".
// Returns null when the question has any other words or symbols, so those are never marked wrong by mistake.
function evaluatePlainArithmetic(questionText) {
  const expression = String(questionText || "")
    .trim()
    .replace(/^(?:what is|what's|calculate|compute|evaluate|find|solve|simplify)\s*:?\s*/i, "") // drop an opening phrase
    .replace(/\s*=?\s*\??\s*$/, "") // drop a closing "?" or "= ?"
    .replace(/−/g, "-"); // the typographic minus sign becomes a normal minus

  // "1/2 ÷ 1/4" mixes fraction slashes with division. Plain left-to-right math would get it wrong, so skip it.
  if (expression.includes("÷") && expression.includes("/")) return null;

  const mathText = expression.replace(/×/g, "*").replace(/÷/g, "/");
  // Allowed shape: numbers joined by + - * / (brackets are fine). Nothing else.
  if (!/^\(*\s*\d+(?:\.\d+)?\s*\)*(?:\s*[+\-*\/]\s*\(*\s*\d+(?:\.\d+)?\s*\)*)+$/.test(mathText)) return null;

  try {
    const value = Function(`"use strict"; return (${mathText})`)();
    return Number.isFinite(value) ? value : null;
  } catch (err) {
    return null; // for example, brackets that do not match
  }
}

// What plain math can say about one question: "right", "wrong", or "unknown".
// "unknown" means it is not plain arithmetic, or the answer is not a plain number.
function arithmeticStatus(item) {
  const expected = evaluatePlainArithmetic(item?.question);
  const given = parsePlainNumber(item?.answer);
  if (expected === null || given === null) return "unknown";
  return Math.abs(expected - given) <= 1e-9 * Math.max(1, Math.abs(expected)) ? "right" : "wrong";
}

// Writes a number the way a student would: a whole number, or a simple fraction plus its decimal.
// Example: 0.7 becomes "7/10 (0.7)". It is only a hint that helps the AI checker fix a wrong answer.
function describeValue(value) {
  if (Number.isInteger(value)) return String(value);

  const decimalText = String(Number(value.toPrecision(10)));
  for (let denominator = 2; denominator <= 1000; denominator++) {
    const numerator = Math.round(value * denominator);
    if (Math.abs(numerator / denominator - value) < 1e-9) {
      return `${numerator}/${denominator} (${decimalText})`;
    }
  }
  return decimalText;
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
    // Only plain arithmetic with a plain-number answer is checked here. The AI checker handles everything else.
    // Why: the old check misread answers like "3/4" as 3 and flagged good questions.
    if (arithmeticStatus(item) === "wrong") {
      const expected = evaluatePlainArithmetic(item.question);
      return { valid: false, reason: `The arithmetic answer for "${item.question}" is incorrect. The correct value is ${describeValue(expected)}.` };
    }
  }

  return { valid: true, reason: "Structure and checkable arithmetic passed without AI." };
}

function deterministicLessonCheck(quizData) {
  const practiceCheck = deterministicQuestionCheck(quizData?.questions);
  if (!practiceCheck.valid) return practiceCheck;
  return deterministicQuestionCheck(quizData?.finalQuestions);
}

// Stops the AI checker from breaking answers that plain math can prove.
// (In a live test it changed the right answer "2/7 + 3/14 = 1/2" into the wrong answer "5/14".)
// - If the original item is provably right, keep it as it is.
// - If the checker's new version is provably wrong, keep the original item instead.
function keepProvenAnswers(originalList, correctedList) {
  return correctedList.map((corrected, index) => {
    const original = originalList?.[index];
    if (!original) return corrected;
    if (arithmeticStatus(original) === "right" || arithmeticStatus(corrected) === "wrong") {
      return { question: original.question, answer: original.answer };
    }
    return corrected;
  });
}

// Longest topic text we send to the AI. Very long text is cut so it cannot flood the prompt.
const MAX_TOPIC_LENGTH = 150;

// Keeps the student's own words as the topic.
// Why: the category step turns "single digit multiplication" into just "Math". If only "Math"
// reaches the quiz writer, it picks a random math lesson instead of the one the student asked for.
function cleanRequestedTopic(text, fallbackSubject) {
  const cleaned = String(text || "")
    .replace(/[`"]/g, "") // quote and code marks could confuse the prompt layout
    .replace(/\s+/g, " ") // new lines and extra spaces become one space
    .trim()
    .slice(0, MAX_TOPIC_LENGTH)
    .trim();

  return cleaned || fallbackSubject;
}

// True when the value is text with at least one visible character.
function isFilledText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// True when the value is a non-empty list and every item is filled text.
function isFilledTextList(list) {
  return Array.isArray(list) && list.length > 0 && list.every(isFilledText);
}

// A review is complete only when it teaches the prerequisites and explains how the topic works.
function hasCompleteReview(review) {
  return Boolean(
    review &&
    isFilledText(review.summary) &&
    Array.isArray(review.prerequisites) &&
    review.prerequisites.length > 0 &&
    review.prerequisites.every((item) =>
      item && isFilledText(item.concept) && isFilledText(item.explanation) && isFilledText(item.example)
    ) &&
    isFilledTextList(review.howItWorks) &&
    Array.isArray(review.formulas) &&
    review.guidedProblem &&
    isFilledText(review.guidedProblem.prompt) &&
    isFilledTextList(review.guidedProblem.steps) &&
    isFilledText(review.guidedProblem.answer)
  );
}

// A lesson is complete when it has a title, the right number of questions, and a complete review.
function isCompleteLesson(quiz) {
  return Boolean(
    quiz &&
    isFilledText(quiz.subject) &&
    Array.isArray(quiz.questions) &&
    quiz.questions.length === QUIZ_COUNTS.practice &&
    Array.isArray(quiz.finalQuestions) &&
    quiz.finalQuestions.length === QUIZ_COUNTS.final &&
    hasCompleteReview(quiz.review)
  );
}

// Builds the lesson request. It carries BOTH the broad subject (like "Math")
// and the student's specific topic (like "single digit multiplication").
function buildQuizPrompt(subject, requestedTopic = subject) {
  return `# Quiz Generation Task

You are creating a short lesson and quiz for a student.

- Subject area: **${subject}**
- Topic the student asked for: **${requestedTopic}**

The student may have added extra words around the topic (such as "how do I" or "help me"). Teach only the skill or idea the topic names.
Everything you write must stay on "${requestedTopic}": the review, the guided problem, and every question. Do not switch to other topics, even closely related ones.

## Core Requirements

- Set **subject** to a short title for "${requestedTopic}" (a few words, not a full sentence)
- Generate exactly **${QUIZ_COUNTS.practice} guided-practice questions** and exactly **${QUIZ_COUNTS.final} final-practice questions** directly about "${requestedTopic}"
- Put answers in the guided-practice set for immediate review; keep final-practice answers separate
- Each answer must be the correct, final response with NO extra explanation
- All answers must be factually accurate and match their questions precisely

## Review Page Requirements

The review is the student's FIRST page, so it must TEACH. Assume the student is new to "${requestedTopic}" and may have forgotten the basics. Fill it in like this:

1. **summary**: 2-3 short sentences in plain words that say what "${requestedTopic}" is and why it is useful
2. **prerequisites**: 3-4 skills the student needs BEFORE learning "${requestedTopic}". Even beginner topics have basics, so do not skip them. Tailor them to this exact topic, not a generic list.
   - Order them from the most basic skill to the simpler idea the topic grows out of (the one closest to the topic comes last). For example: multiplication grows out of repeated addition, division grows out of equal sharing, and exponents grow out of repeated multiplication.
   - Give each one a **concept** (its name), an **explanation** (2-4 simple sentences that really teach it: what it means and how it works, so a student who forgot it can relearn it), and an **example** (one tiny worked example with real numbers or a real situation, showing the work and the result).
3. **howItWorks**: 4-7 short steps, in order, that explain how "${requestedTopic}" works by BUILDING ON the prerequisites.
   - Use ONE running example in every step, so the steps never contradict each other.
   - Start by connecting that example to the idea the topic grows out of.
   - Say what the main symbol or key word means in plain everyday words. Avoid jargon the student does not need.
   - Finish with the faster method or pattern students use once they understand the idea.
4. **formulas**: the key rules, facts, or formulas for "${requestedTopic}". Write one rule per line, with its tiny example on that same line.
5. **guidedProblem**: one example problem on "${requestedTopic}". Its steps use the same method taught in howItWorks, one small step at a time, and the last step gives the final answer.

Review writing rules:
- Use simple words and match the level the topic is normally taught at
- Double-check that every explanation, example, and answer is correct and agrees with the others
- Write math in plain text (for example 2 + 3 = 5). Use × and ÷ as the multiplication and division signs (the letter x is only for variables). Do not use LaTeX or other markup
- Do not number the steps yourself; the page numbers them
- The "example" field holds only the example itself, with no "Example:" label

## Answer Format Guidelines

- Keep answers concise (1-5 words typically)
- For acronyms: provide the expanded form OR abbreviation consistently
  - Formatting example only (NOT a topic to teach): "FOIL method" or "First Outer Inner Last" (not both in different answers)
- Avoid answers that are too vague or too verbose
- Ensure mathematical accuracy for math topics
- For procedures/steps: provide the most essential element as the answer

## Quality Checklist

✓ Every question tests understanding of "${requestedTopic}"  
✓ The review teaches the prerequisites first, then builds from them to "${requestedTopic}"  
✓ No off-topic, general knowledge, or unrelated trivia questions  
✓ Each answer directly responds to its question  
✓ Answers are internally consistent in style and format  
✓ Return ONLY valid JSON matching this exact schema:

\`\`\`json
${JSON.stringify(QUIZ_OUTPUT_SCHEMA, null, 2)}
\`\`\``;
}

// Double-checks the quiz answers.
// It only sees the broad subject (like "Math"), NOT the student's exact words. When it saw "single digit multiplication",
// it wrongly marked good questions like 5 × 5 = 25 as wrong ("25 is not a single digit") and rewrote them.
// The quiz writer already gets the exact topic, so staying on topic is the writer's job.
async function verifyQuizAnswerSet(subject, quizData, apiKey, attemptNumber = 1) {
  if (!quizData || !Array.isArray(quizData.questions) || quizData.questions.length !== QUIZ_COUNTS.practice || !Array.isArray(quizData.finalQuestions) || quizData.finalQuestions.length !== QUIZ_COUNTS.final) {
    return quizData || { subject, questions: [] };
  }

  const MAX_VERIFICATION_ATTEMPTS = 3;
  if (attemptNumber > MAX_VERIFICATION_ATTEMPTS) {
    console.warn(`Verification exceeded max attempts (${MAX_VERIFICATION_ATTEMPTS}). Returning quiz as-is.`);
    return quizData;
  }

  // The checker gets only the questions (no review, no title). It does not need them, and the title's wording tempted it to judge by the topic.
  const verifyPrompt = `# Quiz Verification & Quality Assurance

## Your Task
Validate and verify the following quiz for **${subject}**. Check that ALL questions are accurate, on-topic, and have correct answers.

## Validation Criteria

1. **Accuracy Check** (isAccurate): Work out the correct answer yourself. If it matches the given answer, the item is accurate (true). Mark it false ONLY when the given answer is different from the correct answer.
2. **Topic Consistency** (isOnTopic): Is the question about ${subject}? Mark it false ONLY when it is clearly about a different subject.
3. **Quality**: Are answers clear, concise, and directly responsive to questions?
4. **Consistency**: Are answers formatted consistently (e.g., all acronyms handled the same way)?

## Instructions

Be fair, not picky. Only an item with a real problem gets a false flag, and every false flag needs a fixed replacement in the corrected list.

If you find a real problem (a wrong answer or a question about a different subject):
- Fix that item
- Fix answer formatting for consistency
- Return the corrected quiz

If all questions are valid:
- Return the quiz as-is (no changes needed)

How to fill in the response:
- "questions" and "finalQuestions" are the quiz exactly as given, with your true/false flags. For any false flag, say what is wrong in "reasonIfInaccurate". When both flags are true, leave it as an empty string.
- "correctedQuestions" and "correctedFinalQuestions" are the final quiz. Copy unchanged items as they are. Every item here must be accurate and on-topic, so both flags are true.

## Quiz to Verify
\`\`\`json
${JSON.stringify({ questions: quizData.questions, finalQuestions: quizData.finalQuestions }, null, 2)}
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
        max_tokens: 3000, // the checker's reply is about 1,200 tokens; a limit of 1,000 cut it off mid-answer (unreadable)
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

    // Take the checker's corrected lists, but never let it break an answer that plain math can prove.
    const correctedQuestions = Array.isArray(verificationResult.correctedQuestions) ? keepProvenAnswers(quizData.questions, removeVerificationMetadata(verificationResult.correctedQuestions)) : quizData.questions;
    const correctedFinalQuestions = Array.isArray(verificationResult.correctedFinalQuestions) ? keepProvenAnswers(quizData.finalQuestions, removeVerificationMetadata(verificationResult.correctedFinalQuestions)) : quizData.finalQuestions;

    // Only corrected content from a fully valid verification response is returned to the UI.
    if (isValidVerificationResult(verificationResult)) {
      return {
        subject: quizData.subject || verificationResult.subject, // keep the quiz writer's title; the verifier may reword it
        questions: correctedQuestions,
        finalQuestions: correctedFinalQuestions,
        review: quizData.review
      };
    }

    if (!Array.isArray(correctedQuestions) || correctedQuestions.length !== QUIZ_COUNTS.practice || !Array.isArray(correctedFinalQuestions) || correctedFinalQuestions.length !== QUIZ_COUNTS.final) {
      console.warn("Verification result missing corrected question sets; keeping original quiz.");
      showVerificationAlert("The quiz verification failed because the question count did not match the expected format. Please contact support or try again.");
      return quizData;
    }

    // The checker complained but changed nothing. Asking again would give the same answer (and cost about 20 more seconds), so stop here.
    if (sameQuestionList(correctedQuestions, quizData.questions) && sameQuestionList(correctedFinalQuestions, quizData.finalQuestions)) {
      console.warn(`Verification (attempt ${attemptNumber}) flagged items but changed nothing. Keeping the quiz as-is.`);
      return quizData;
    }

    const correctedQuiz = {
      subject: quizData.subject || verificationResult.subject, // keep the quiz writer's title; the verifier may reword it
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

// How many times we ask for a lesson if the AI sends back an incomplete one.
const MAX_LESSON_ATTEMPTS = 2;

// Sends ONE lesson request to OpenAI.
// Returns { lesson } on success (lesson is null if the reply could not be read) or { error } if the API call failed.
async function requestLesson(prompt, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 4000, // the review has more parts now; a reply cut off early would be broken JSON
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
    return { error: data?.error?.message || `status ${response?.status}` };
  }

  return { lesson: extractJsonObject(data?.choices?.[0]?.message?.content || "") };
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

  // Prefer an explicit key from the Netlify function; fall back to env only in Node.
  const requestApiKey =
    apiKeyOverride ||
    globalScope?.APP_CONFIG?.OPENAI_API_KEY ||
    (typeof process !== "undefined" && process.env && process.env.OPENAI_API_KEY);

  if (!requestApiKey) {
    return { subject: "Error", questions: [], error: "OPENAI_API_KEY is missing" };
  }

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

      // Surface real OpenAI failures (bad key, billing, rate limit) instead of silently failing later.
      if (!category_summary_response.ok) {
        return {
          subject: "Error",
          questions: [],
          error: category_response_data?.error?.message || "OpenAI category request failed"
        };
      }

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

  // Keep the student's own words as the topic. "Math" alone is too broad, so the lesson would drift to random math.
  const requestedTopic = cleanRequestedTopic(trimmedInput, category_data);
  const finalPrompt = buildQuizPrompt(category_data, requestedTopic);

  try {
    // Ask again if the lesson comes back incomplete (for example, a review with no prerequisites).
    for (let attempt = 1; attempt <= MAX_LESSON_ATTEMPTS; attempt++) {
      const { lesson, error } = await requestLesson(finalPrompt, requestApiKey);

      // A real API error (bad key, rate limit, ...) will not fix itself, so stop right away.
      if (error) {
        return { subject: category_data, questions: [], error };
      }

      if (isCompleteLesson(lesson)) {
        const verifiedQuiz = await verifyQuizAnswerSet(category_data, lesson, requestApiKey);
        if (verifiedQuiz && Array.isArray(verifiedQuiz.questions) && verifiedQuiz.questions.length === QUIZ_COUNTS.practice && Array.isArray(verifiedQuiz.finalQuestions) && verifiedQuiz.finalQuestions.length === QUIZ_COUNTS.final && verifiedQuiz.subject) {
          return verifiedQuiz;
        }
        return lesson;
      }

      console.warn(`Lesson attempt ${attempt} of ${MAX_LESSON_ATTEMPTS} was incomplete.`);
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
  module.exports = { AskOpenAi, hasCompleteReview, isValidVerificationResult, deterministicQuestionCheck, QUIZ_COUNTS, QUIZ_OUTPUT_SCHEMA, VERIFICATION_SCHEMA };
}

globalScope.AskOpenAi = AskOpenAi;
