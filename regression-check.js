const fs = require('fs');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  const code = fs.readFileSync('OpenAi.js', 'utf8');
  let fetchCalls = 0;

  const validQuiz = {
    subject: 'Algebra',
    review: {
      summary: 'Algebra basics',
      formulas: ['x + y'],
      guidedProblem: {
        prompt: 'Solve 2+2',
        steps: ['Add the numbers', 'Combine the result'],
        answer: '4'
      }
    },
    questions: [
      { question: '2+2', answer: '4' },
      { question: '3+3', answer: '6' },
      { question: '4+4', answer: '8' },
      { question: '5+5', answer: '10' },
      { question: '6+6', answer: '12' },
      { question: '7+7', answer: '14' }
    ],
    finalQuestions: [
      { question: '8+8', answer: '16' },
      { question: '9+9', answer: '18' },
      { question: '10+10', answer: '20' },
      { question: '11+11', answer: '22' },
      { question: '12+12', answer: '24' }
    ]
  };

  const validVerification = {
    subject: 'Algebra',
    questions: [
      { question: '2+2', answer: '4', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' },
      { question: '3+3', answer: '6', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' },
      { question: '4+4', answer: '8', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' },
      { question: '5+5', answer: '10', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' },
      { question: '6+6', answer: '12', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' },
      { question: '7+7', answer: '14', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' }
    ],
    finalQuestions: [
      { question: '8+8', answer: '16', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' },
      { question: '9+9', answer: '18', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' },
      { question: '10+10', answer: '20', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' },
      { question: '11+11', answer: '22', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' },
      { question: '12+12', answer: '24', isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' }
    ],
    correctedQuestions: validQuiz.questions.map((item) => ({ ...item, isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' })),
    correctedFinalQuestions: validQuiz.finalQuestions.map((item) => ({ ...item, isAccurate: true, isOnTopic: true, reasonIfInaccurate: '' }))
  };

  const invalidVerification = {
    ...validVerification,
    questions: validVerification.questions.slice(0, -1),
    correctedQuestions: validVerification.correctedQuestions.slice(0, -1)
  };

  const inaccurateCorrection = {
    ...validVerification,
    correctedQuestions: validVerification.correctedQuestions.map((item, index) => index === 0 ? { ...item, isAccurate: false } : item)
  };

  let alertCalls = 0;
  // This harness isolates routing and validation behavior from the live API.
  const ctx = {
    window: { APP_CONFIG: { OPENAI_API_KEY: 'test-key' } },
    globalThis: {},
    console,
    process: { env: {} },
    alert: () => {
      alertCalls += 1;
    },
    fetch: async (_url, opts) => {
      fetchCalls += 1;
      const body = JSON.parse(opts.body);
      const content = body.messages[0].content;

      if (content.includes('Identify the broad academic subject')) {
        const lowerContent = content.toLowerCase();
        if (lowerContent.includes('cooking')) {
          return { ok: true, json: async () => ({ choices: [{ message: { content: 'Category: Cooking' } }] }) };
        }
        if (lowerContent.includes('football')) {
          return { ok: true, json: async () => ({ choices: [{ message: { content: 'Category: Football' } }] }) };
        }
        if (lowerContent.includes('biology')) {
          return { ok: true, json: async () => ({ choices: [{ message: { content: 'Category: Biology' } }] }) };
        }
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Category: Algebra' } }] }) };
      }

      if (content.includes('Quiz Generation Task')) {
        const quiz = content.toLowerCase().includes('**biology**') ? { ...validQuiz, subject: 'Biology' } : validQuiz;
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(quiz) } }] }) };
      }

      if (content.includes('Quiz Verification & Quality Assurance')) {
        const verification = content.toLowerCase().includes('**biology**') ? { ...validVerification, subject: 'Biology' } : validVerification;
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(verification) } }] }) };
      }

      return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) };
    }
  };

  ctx.globalThis = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  const apiModule = require('./OpenAi');
  const expectedCounts = apiModule.QUIZ_COUNTS;
  assert(apiModule.isValidVerificationResult(validVerification) === true, 'Valid verification should pass');
  assert(apiModule.isValidVerificationResult(invalidVerification) === false, 'Changed verification count should fail');
  assert(apiModule.isValidVerificationResult(inaccurateCorrection) === false, 'Inaccurate corrected questions should fail');

  // Every blocked input must return before the first mocked API request.
  const profanityInputs = [
    'damn this is a test prompt with more than four words',
    'fuck this is a test prompt with more than four words',
    'hell this is a test prompt with more than four words',
    'crap this is a test prompt with more than four words'
  ];
  let blockedSubject = '';
  for (const profanityInput of profanityInputs) {
    const blocked = await ctx.window.AskOpenAi(profanityInput);
    assert(blocked.subject === 'Error', `Profanity check should block: ${profanityInput}`);
    blockedSubject = blocked.subject;
  }
  assert(fetchCalls === 0, `Expected 0 fetch calls after profanity block, got ${fetchCalls}`);

  const generic = await ctx.window.AskOpenAi('this is a test prompt');
  assert(generic.subject === 'Error', 'Generic/off-topic prompt should be rejected');

  const nonAcademic = await ctx.window.AskOpenAi('How do I prepare a cooking recipe');
  assert(nonAcademic.subject === 'Error', 'Non-academic subjects must be rejected');
  assert(fetchCalls === 1, `Non-academic category must not trigger quiz generation, got ${fetchCalls} fetch calls`);

  const shortNonAcademic = await ctx.window.AskOpenAi('What is football');
  assert(shortNonAcademic.subject === 'Error', 'Short non-academic subjects must be rejected');
  assert(fetchCalls === 2, 'Short non-academic input must stop after category classification');

  const inferredNonAcademic = await ctx.window.AskOpenAi('How do I learn football tactics');
  assert(inferredNonAcademic.subject === 'Error', 'Category-inferred non-academic subjects must be rejected');
  assert(fetchCalls === 3, 'Category-inferred non-academic input must stop before quiz generation');

  const mixedNonAcademic = await ctx.window.AskOpenAi('How do I analyze football statistics');
  assert(mixedNonAcademic.subject === 'Error', 'Off-topic prompts containing academic words must be rejected');
  assert(fetchCalls === 4, 'Mixed off-topic input must stop before quiz generation');

  const valid = await ctx.window.AskOpenAi('How can I solve 2+2');
  assert(valid.subject === 'Algebra', `Expected subject Algebra, got ${valid.subject}`);
  assert(Array.isArray(valid.questions) && valid.questions.length === expectedCounts.practice, 'Practice question count did not match the shared contract');
  assert(Array.isArray(valid.finalQuestions) && valid.finalQuestions.length === expectedCounts.final, 'Final question count did not match the shared contract');
  assert(Boolean(valid.review), 'Expected review data to be present');
  assert(Object.keys(valid.questions[0]).sort().join(',') === 'answer,question', 'Verification metadata must not reach the UI quiz data');
  assert(alertCalls === 0, `Expected no alert on the valid path, got ${alertCalls}`);

  const digitAddition = await ctx.window.AskOpenAi('2 digit addition');
  assert(digitAddition.subject !== 'Error', 'Two-digit addition should be recognized as an academic math topic');
  assert(Array.isArray(digitAddition.questions) && digitAddition.questions.length === expectedCounts.practice, 'Two-digit addition should produce a quiz');

  const foilMethod = await ctx.window.AskOpenAi('foil method');
  assert(foilMethod.subject !== 'Error', 'FOIL method should be recognized as an academic math topic');
  assert(Array.isArray(foilMethod.questions) && foilMethod.questions.length === expectedCounts.practice, 'FOIL method should produce a quiz');

  const biology = await ctx.window.AskOpenAi('How do I study biology today');
  assert(biology.subject === 'Biology', 'Academic Biology input should remain allowed');
  assert(Array.isArray(biology.questions) && biology.questions.length === expectedCounts.practice, 'Biology should produce the expected practice count');

  const promptValidation = require('./zod').validatePromptInput({ prompt: 'hi' });
  assert(!promptValidation.success, 'Short prompts must be rejected');

  assert(typeof apiModule.AskOpenAi === 'function', 'AskOpenAi must be exported');

  console.log(JSON.stringify({
    blockedSubject,
    genericSubject: generic.subject,
    nonAcademicSubject: nonAcademic.subject,
    shortNonAcademicSubject: shortNonAcademic.subject,
    inferredNonAcademicSubject: inferredNonAcademic.subject,
    mixedNonAcademicSubject: mixedNonAcademic.subject,
    validSubject: valid.subject,
    digitAdditionSubject: digitAddition.subject,
    foilMethodSubject: foilMethod.subject,
    biologySubject: biology.subject,
    practiceCount: valid.questions.length,
    finalCount: valid.finalQuestions.length,
    shortPromptRejected: !promptValidation.success,
    validVerificationPassed: apiModule.isValidVerificationResult(validVerification),
    invalidVerificationFailed: !apiModule.isValidVerificationResult(invalidVerification),
    inaccurateCorrectionFailed: !apiModule.isValidVerificationResult(inaccurateCorrection),
    happyPathAlertCalls: alertCalls,
    fetchCalls,
    status: 'PASS'
  }));
})().catch((error) => {
  console.error('FAIL', error.message);
  process.exit(1);
});
