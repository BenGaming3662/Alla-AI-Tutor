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
      prerequisites: [
        { concept: 'Addition', explanation: 'Adding puts two numbers together.', example: '2 + 3 = 5' }
      ],
      howItWorks: ['Start with the first number', 'Add the second number to it'],
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

  // Hooks that let a test see (and change) what the fake AI is asked and what it answers.
  let lessonCalls = 0;           // how many lesson requests were made
  let lastLessonPrompt = '';     // the text of the latest lesson request
  let lastVerifyPrompt = '';     // the text of the latest verification request
  let lessonReplyForCall = null; // optional: (callNumber) => the lesson the fake AI sends back
  let verifyCalls = 0;           // how many answer-checker requests were made
  let verifyPrompts = [];        // the text of every answer-checker request, in order
  let verifyReplyForCall = null; // optional: (callNumber) => the checker reply the fake AI sends back

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
        // Like the real AI, a specific math skill is mapped to the broad subject "Math".
        if (lowerContent.includes('multiplication')) {
          return { ok: true, json: async () => ({ choices: [{ message: { content: 'Category: Math' } }] }) };
        }
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Category: Algebra' } }] }) };
      }

      if (content.includes('Quiz Generation Task')) {
        lessonCalls += 1;
        lastLessonPrompt = content;
        const defaultQuiz = content.toLowerCase().includes('**biology**') ? { ...validQuiz, subject: 'Biology' } : validQuiz;
        const quiz = lessonReplyForCall ? lessonReplyForCall(lessonCalls) : defaultQuiz;
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(quiz) } }] }) };
      }

      if (content.includes('Quiz Verification & Quality Assurance')) {
        verifyCalls += 1;
        verifyPrompts.push(content);
        lastVerifyPrompt = content;
        const defaultVerification = content.toLowerCase().includes('**biology**') ? { ...validVerification, subject: 'Biology' } : validVerification;
        const verification = verifyReplyForCall ? verifyReplyForCall(verifyCalls) : defaultVerification;
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

  // ---- Topic must not be lost (bug: "single digit multiplication" became just "Math") ----
  // The category step maps this input to the broad subject "Math".
  // The quiz writer must STILL hear the real topic, or the lesson drifts to random math.
  lessonCalls = 0;
  const multiplication = await ctx.window.AskOpenAi('single digit multiplication');
  assert(multiplication.subject !== 'Error', 'Single digit multiplication should be accepted');
  assert(lastLessonPrompt.includes('**single digit multiplication**'), 'The quiz writer must be told the real topic, not just "Math"');
  assert(lastLessonPrompt.includes('**Math**'), 'The broad subject should still be sent as context');
  // The answer checker is deliberately NOT given the topic wording. In live tests it misread "single digit"
  // as "the answer must be one digit" and marked good questions (5 × 5 = 25) as wrong.
  assert(!lastVerifyPrompt.toLowerCase().includes('single digit'), 'The answer checker must not get the topic wording (it misreads size words)');
  assert(!lastVerifyPrompt.includes('Algebra basics'), 'The answer checker should get only the questions, not the review');
  assert(lessonCalls === 1, `A complete lesson should need only 1 lesson request, got ${lessonCalls}`);

  // ---- Review must teach the prerequisites (for example repeated addition for multiplication) ----
  assert(lastLessonPrompt.includes('prerequisites') && lastLessonPrompt.includes('repeated addition'), 'The prompt must ask for prerequisites and point to repeated addition');
  assert(apiModule.hasCompleteReview(multiplication.review), 'The review that reaches the page must include prerequisites and how-it-works steps');

  // Each broken copy below is missing one required part of the review, so each must fail.
  const goodReview = validQuiz.review;
  assert(apiModule.hasCompleteReview(goodReview) === true, 'A full review should pass');
  assert(apiModule.hasCompleteReview({ summary: 'Old format', formulas: [], guidedProblem: goodReview.guidedProblem }) === false, 'The old review format (no prerequisites) should fail');
  assert(apiModule.hasCompleteReview({ ...goodReview, prerequisites: [] }) === false, 'An empty prerequisites list should fail');
  assert(apiModule.hasCompleteReview({ ...goodReview, prerequisites: [{ concept: 'Addition', explanation: '', example: '2 + 3 = 5' }] }) === false, 'A prerequisite with no explanation should fail');
  assert(apiModule.hasCompleteReview({ ...goodReview, prerequisites: [{ concept: 'Addition', explanation: 'Adds numbers.', example: '' }] }) === false, 'A prerequisite with no example should fail');
  assert(apiModule.hasCompleteReview({ ...goodReview, howItWorks: [] }) === false, 'Missing how-it-works steps should fail');
  assert(apiModule.hasCompleteReview({ ...goodReview, guidedProblem: undefined }) === false, 'A missing guided problem should fail');

  // If the AI forgets the prerequisites, the app asks again once instead of showing a thin review.
  const reviewWithoutPrerequisites = { ...validQuiz, review: { ...validQuiz.review, prerequisites: [] } };
  lessonCalls = 0;
  lessonReplyForCall = (callNumber) => (callNumber === 1 ? reviewWithoutPrerequisites : validQuiz);
  const retried = await ctx.window.AskOpenAi('algebra retry check');
  assert(lessonCalls === 2, `An incomplete review should trigger exactly 1 retry, got ${lessonCalls} lesson requests`);
  assert(apiModule.hasCompleteReview(retried.review), 'The retried lesson should have a complete review');

  // If it is incomplete every time, the app returns no quiz (instead of a review with missing parts).
  lessonCalls = 0;
  lessonReplyForCall = () => reviewWithoutPrerequisites;
  const stillIncomplete = await ctx.window.AskOpenAi('algebra retry check');
  assert(lessonCalls === 2, `The app should give up after 2 lesson requests, got ${lessonCalls}`);
  assert(Array.isArray(stillIncomplete.questions) && stillIncomplete.questions.length === 0, 'A lesson with an incomplete review must not reach the page');
  lessonReplyForCall = null;

  // A very long, messy topic is cleaned (no quotes or new lines) and cut short before it goes into the prompt.
  await ctx.window.AskOpenAi('algebra "quoted"\nword ' + 'x'.repeat(300));
  const sentTopic = (lastLessonPrompt.match(/Topic the student asked for: \*\*(.*)\*\*/) || [])[1] || '';
  assert(sentTopic.length > 0 && sentTopic.length <= 150, `The topic should be cut to 150 characters or less, got ${sentTopic.length}`);
  assert(!sentTopic.includes('"') && !sentTopic.includes('\n'), 'The topic should have no quotes or new lines');
  console.log('Lesson topic and review checks: PASS');

  // ---- The answer checker (the second AI pass) must help, not hurt ----
  // Make alert() visible to the app, so we can prove no pop-up appears.
  ctx.window.alert = () => {
    alertCalls += 1;
  };

  // Plain-math pre-check: right answers pass (even fractions), wrong answers fail, and anything it cannot judge is skipped.
  const precheck = (question, answer) => apiModule.deterministicQuestionCheck([{ question, answer }]).valid;
  assert(precheck('What is 1/2 + 1/4?', '3/4') === true, 'A right fraction answer must not be flagged (the old check read "3/4" as 3)');
  assert(precheck('What is 1/2 + 1/4?', '2/3') === false, 'A wrong fraction answer must be flagged');
  assert(precheck('What is 7 × 8?', '56') === true, 'A right × answer should pass');
  assert(precheck('What is 7 × 8?', '54') === false, 'A wrong × answer should be flagged');
  assert(precheck('What is 1/2 ÷ 1/4?', '2') === true, 'Fraction division is too tricky for the simple check, so it must be skipped');
  assert(precheck('Write 3 + 3 + 3 as multiplication.', '3 × 3') === true, 'Questions with extra words must be skipped, not flagged');
  assert(precheck('In which war (1914-1918) did trench fighting happen?', 'World War I') === true, 'Dates in history questions must not be read as math');
  assert(apiModule.deterministicQuestionCheck([{ question: 'What is 7 × 8?', answer: '54' }]).reason.includes('The correct value is 56'), 'The pre-check should tell the AI the correct value');

  // If the checker complains but changes nothing, the app must not keep asking (each ask costs about 20 seconds).
  const flaggedOnly = {
    ...validVerification,
    questions: validVerification.questions.map((item, index) => (index === 0 ? { ...item, isAccurate: false, reasonIfInaccurate: 'Not sure' } : item))
  };
  verifyCalls = 0;
  verifyReplyForCall = () => flaggedOnly;
  const stoppedEarly = await ctx.window.AskOpenAi('algebra checker check');
  assert(verifyCalls === 1, `A checker that changes nothing should be asked only once, got ${verifyCalls}`);
  assert(stoppedEarly.questions.length === expectedCounts.practice, 'The quiz must still be returned when the checker changes nothing');

  // If the checker "fixes" a right answer into a wrong one (2+2 = 5), the app keeps the right answer.
  const wrongFix = {
    ...validVerification,
    correctedQuestions: validVerification.correctedQuestions.map((item, index) => (index === 0 ? { ...item, answer: '5' } : item))
  };
  verifyCalls = 0;
  verifyReplyForCall = () => wrongFix;
  const keptRightAnswer = await ctx.window.AskOpenAi('algebra checker check');
  assert(keptRightAnswer.questions[0].answer === '4', `The right answer 2+2 = 4 must be kept, got ${keptRightAnswer.questions[0].answer}`);

  // Same, when the checker also flags the item (so the "not fully valid" path is used).
  verifyCalls = 0;
  verifyReplyForCall = () => ({ ...wrongFix, questions: flaggedOnly.questions });
  const keptRightAnswer2 = await ctx.window.AskOpenAi('algebra checker check');
  assert(keptRightAnswer2.questions[0].answer === '4', 'A flagged item with a wrong fix must still keep the right answer');
  assert(verifyCalls === 1, `After the wrong fix is thrown away nothing changed, so the checker should be asked once, got ${verifyCalls}`);

  // A real fix is kept, and the fixed quiz is checked once more.
  const lessonWithError = { ...validQuiz, questions: validQuiz.questions.map((item, index) => (index === 5 ? { question: '7+7', answer: '15' } : item)) };
  const fixingReply = {
    ...validVerification,
    questions: validVerification.questions.map((item, index) => (index === 5 ? { ...item, answer: '15', isAccurate: false, reasonIfInaccurate: '7+7 is 14' } : item))
  };
  lessonReplyForCall = () => lessonWithError;
  verifyCalls = 0;
  verifyPrompts = [];
  verifyReplyForCall = (callNumber) => (callNumber === 1 ? fixingReply : validVerification);
  const fixedQuiz = await ctx.window.AskOpenAi('algebra checker check');
  assert(fixedQuiz.questions[5].answer === '14', `The real fix (7+7 = 14) must be kept, got ${fixedQuiz.questions[5].answer}`);
  assert(verifyCalls === 2, `A real fix should be checked once more (2 checker requests), got ${verifyCalls}`);
  assert(verifyPrompts[0].includes('The correct value is 14'), 'The checker should be told the right value for a wrong answer');
  lessonReplyForCall = null;
  verifyReplyForCall = null;

  assert(alertCalls === 0, `No pop-up alert should appear in these checker flows, got ${alertCalls}`);
  console.log('Answer checker checks: PASS');

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
