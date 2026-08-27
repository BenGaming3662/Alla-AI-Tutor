const CATEGORY_ERROR_CODE = "Id10T error";
let CATEGORY_COUNTER = 0;

const globalScope = typeof window !== "undefined" ? window : globalThis;

const QUIZ_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    questions: {
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
  required: ["subject", "questions"],
  additionalProperties: false
};

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

function buildQuizPrompt(subject) {
  return `You are creating a quiz. The subject is: ${subject}.\n\nRules:\n1. Every question must be directly about ${subject}.\n2. Do not use unrelated topics, general trivia, or off-topic questions.\n3. Create exactly 5 questions.\n4. Each question must have a "question" and a "answer" field.\n5. The "answer" must be the correct final answer only, with no extra explanation.\n6. The answer must be correct and match the question exactly.\n7. Return ONLY valid JSON with this exact schema: ${JSON.stringify(QUIZ_OUTPUT_SCHEMA)}.`;
}

async function verifyQuizAnswerSet(subject, quizData, apiKey) {
  if (!quizData || !Array.isArray(quizData.questions) || quizData.questions.length !== 5) {
    return quizData || { subject, questions: [] };
  }

  const verifyPrompt = `Validate this quiz for subject accuracy and correctness.\nSubject: ${subject}\nQuiz: ${JSON.stringify(quizData)}\n\nRequirements:\n- Every question must stay strictly on ${subject}.\n- Every answer must be correct.\n- Fix any off-topic or incorrect answer.\n- Return ONLY valid JSON matching this schema: ${JSON.stringify(QUIZ_OUTPUT_SCHEMA)}.`;

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
        temperature: 0.2,
        max_tokens: 500
      })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return quizData;
    }

    const parsed = extractJsonObject(data?.choices?.[0]?.message?.content || "");
    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length === 5 && parsed.subject) {
      return parsed;
    }

    return quizData;
  } catch (err) {
    console.warn("Quiz verification failed:", err);
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
    const catPrompt = `Please output the category that this is about. If the subject is unsafe or something you cannot design a quiz around, output: ${CATEGORY_ERROR_CODE}\n\n###\n\n${userInput}`;

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
        CATEGORY_COUNTER += 1;
      } else if (cleaned) {
        category_data = cleaned;
        CATEGORY_COUNTER += 1;
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
        max_tokens: 500,
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

    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length === 5 && parsed.subject) {
      const verifiedQuiz = await verifyQuizAnswerSet(category_data, parsed, requestApiKey);
      if (verifiedQuiz && Array.isArray(verifiedQuiz.questions) && verifiedQuiz.questions.length === 5 && verifiedQuiz.subject) {
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
  module.exports = { AskOpenAi, QUIZ_OUTPUT_SCHEMA };
}

globalScope.AskOpenAi = AskOpenAi;
