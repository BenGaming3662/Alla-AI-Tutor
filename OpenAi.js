const OPENAI_API_KEY = window.APP_CONFIG.OPENAI_API_KEY;
const CATEGORY_ERROR_CODE = "Id10T error";
let CATEGORY_COUNTER = 0;

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

async function AskOpenAi(userInput) {
  if (!userInput || !userInput.trim()) {
    return "Please enter a question or prompt first.";
  }

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
          Authorization: `Bearer ${OPENAI_API_KEY}`
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
        return "Request terminated:  error detected.";
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

  const finalPrompt = `${category_data}\n\n### Create a 1-paragraph summary of the subject. After the summary, provide exactly 3 practice problems. Keep the answer in plain text with no markdown formatting.`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: finalPrompt }],
        temperature: 0.7,
        max_tokens: 180
      })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return "OpenAI error: " + (data?.error?.message || `status ${response?.status}`);
    }

    const out = data?.choices?.[0]?.message?.content || "No response from OpenAI.";
    return out;
  } catch (err) {
    return "OpenAI request failed: " + (err.message || String(err));
  }
}

window.AskOpenAi = AskOpenAi;
