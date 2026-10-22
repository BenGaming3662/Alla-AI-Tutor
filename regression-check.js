const assert = require('assert');
const http = require('http');
const { AskOpenAi, QUIZ_COUNTS, VERIFICATION_SCHEMA, isAnswerCorrect, isProfanityBlocked, isQuizValid, isValidVerification } = require('./OpenAi');
const { OutputSchema, SingleQuestionAnswerSchema, validatePromptInput } = require('./zod');
const { createServer, MAX_REQUEST_BYTES } = require('./server');
const { handler: netlifyOpenAiHandler } = require('./netlify/functions/openai');

// Fixed fixtures exercise the three separately rendered question sets.
const topic = '2 digit addition';
const practiceQuestions = [
  { question: '12 + 13', answer: '25' },
  { question: '24 + 15', answer: '39' },
  { question: '36 + 17', answer: '53' }
];
const morePracticeQuestions = [
  { question: '48 + 19', answer: '67' },
  { question: '21 + 22', answer: '43' },
  { question: '23 + 24', answer: '47' }
];
const finalQuestions = [
  { question: '35 + 26', answer: '61' },
  { question: '47 + 28', answer: '75' },
  { question: '51 + 32', answer: '83' },
  { question: '63 + 34', answer: '97' },
  { question: '74 + 15', answer: '89' }
];
let classificationCalls = 0;
let generationCalls = 0;
let verificationCalls = 0;
let invalidCategoryGenerationCalls = 0;
let lastAuthorization = '';
let forceApiFailure = false;
let forceInvalidVerification = false;
let forceCorrectableOriginal = false;
let lastGenerationPrompt = '';
let lastVerificationPrompt = '';

global.APP_CONFIG = { OPENAI_API_KEY: 'test-key' };
// Stub the model API so tests are deterministic and never make paid network requests.
global.fetch = async (_url, options) => {
  lastAuthorization = options.headers.Authorization;
  if (forceApiFailure) {
    return { ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) };
  }
  const request = JSON.parse(options.body);
  const prompt = request.messages?.[0]?.content || '';

  if (prompt.includes('Extract the broad academic subject')) {
    classificationCalls += 1;
    const lowerPrompt = prompt.toLowerCase();
    const subject = lowerPrompt.includes('celebrity gossip') ? 'Category: Id10T error.'
      : lowerPrompt.includes('topology') ? 'Topology'
        : 'Calculus';
    return { ok: true, json: async () => ({ choices: [{ message: { content: subject } }] }) };
  }

  if (prompt.includes('# Quiz Generation Task')) {
    generationCalls += 1;
    lastGenerationPrompt = prompt;
    if (prompt.includes('basketball highlights tonight')) {
      invalidCategoryGenerationCalls += 1;
      const invalidQuiz = {
        subject: 'Category: Id10T error.',
        review: { summary: '', prerequisites: [], formulas: [], guidedProblem: { prompt: '', steps: [], answer: '' } },
        questions: [],
        moreQuestions: [],
        finalQuestions: []
      };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(invalidQuiz) } }] }) };
    }

    const requestedTopic = prompt.match(/requested topic or skill is: \*\*(.*?)\*\*/)?.[1] || '';
    const prerequisites = /\barea\b/i.test(requestedTopic)
      ? [
          'Single-digit multiplication fact: 6 × 4 = 24.',
          'Area is measured in square units; a 6 cm by 4 cm rectangle has an area of 24 cm^2.'
        ]
      : /\b(?:multiplication|multiply|multiplying|multiplied|times tables?|products?)\b/i.test(requestedTopic)
        ? ['Single-digit multiplication fact: 6 × 4 = 24.']
        : ['Know single-digit addition: 8 + 1 = 9.'];
    const quiz = {
      subject: /foil|quadratic/i.test(requestedTopic) ? 'Algebra'
        : prompt.match(/academic subject \*\*(.*?)\*\*/)?.[1] || 'Math',
      review: { summary: 'Add the place values.', prerequisites, formulas: ['Add tens and ones.'], guidedProblem: { prompt: '18 + 21', steps: ['Add each place.'], answer: '39' } },
      questions: forceCorrectableOriginal
        ? practiceQuestions.map((item, index) => index === 0 ? { ...item, answer: 'incorrect source answer' } : item)
        : practiceQuestions,
      moreQuestions: morePracticeQuestions,
      finalQuestions
    };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(quiz) } }] }) };
  }

  if (prompt.includes('Check every original and corrected question in Guided Practice')) {
    verificationCalls += 1;
    lastVerificationPrompt = prompt;
    const quiz = JSON.parse(prompt.split('\nQuiz:\n')[1]);
    const verify = (items, isCorrected = false) => items.map((item) => {
      const needsCorrection = forceCorrectableOriginal && item.answer === 'incorrect source answer';
      return {
        ...item,
        answer: isCorrected && needsCorrection ? practiceQuestions[0].answer : item.answer,
        isAccurate: isCorrected || !needsCorrection,
        isOnTopic: true
      };
    });
    const verification = {
      reviewPrerequisitesValid: true,
      questions: verify(quiz.questions),
      moreQuestions: verify(quiz.moreQuestions),
      finalQuestions: verify(quiz.finalQuestions),
      correctedQuestions: verify(quiz.questions, true),
      correctedMoreQuestions: verify(quiz.moreQuestions, true),
      correctedFinalQuestions: verify(quiz.finalQuestions, true)
    };
    if (forceInvalidVerification) verification.correctedQuestions[0].isAccurate = false;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(verification) } }] }) };
  }

  throw new Error(`Unexpected request prompt: ${prompt}`);
};

(async () => {
  // Generation route, exact lesson counts, and correction of inaccurate source answers.
  const shortQuiz = await AskOpenAi(topic);
  assert.strictEqual(shortQuiz.subject, 'Math');
  assert.strictEqual(classificationCalls, 0, 'Short prompts should validate the category during generation');
  assert.strictEqual(shortQuiz.questions.length, QUIZ_COUNTS.practicePerPage, 'Guided Practice should have three problems');
  assert.strictEqual(shortQuiz.moreQuestions.length, QUIZ_COUNTS.practicePerPage, 'More Practice should have three problems');
  assert.strictEqual(shortQuiz.finalQuestions.length, QUIZ_COUNTS.final, 'Final practice should have five problems');
  assert(lastGenerationPrompt.includes(`exactly ${QUIZ_COUNTS.practicePerPage} questions in the "questions" array for Guided Practice`));
  assert(lastGenerationPrompt.includes(`exactly ${QUIZ_COUNTS.practicePerPage} questions in the "moreQuestions" array for More Practice`));
  assert(lastGenerationPrompt.includes(`exactly ${QUIZ_COUNTS.final} questions in the "finalQuestions" array for Final Practice`));
  assert(lastGenerationPrompt.includes('include single-digit multiplication facts'));
  assert.strictEqual(shortQuiz.review.prerequisites.length > 0, true, 'Review must include prerequisite instruction');
  assert.strictEqual(isQuizValid({ ...shortQuiz, questions: shortQuiz.questions.slice(1) }), false,
    'A practice page with fewer than three questions must be rejected');
  assert.strictEqual(isQuizValid({ ...shortQuiz, moreQuestions: [...shortQuiz.moreQuestions, morePracticeQuestions[0]] }), false,
    'A practice page with more than three questions must be rejected');
  assert.strictEqual(isQuizValid({ ...shortQuiz, finalQuestions: [...shortQuiz.finalQuestions, finalQuestions[0]] }), false,
    'A final set with more than five questions must be rejected');
  assert.strictEqual(generationCalls, 1);
  assert.strictEqual(verificationCalls, 1);

  forceCorrectableOriginal = true;
  const verificationCallsBeforeCorrection = verificationCalls;
  const lessonWithCorrection = await AskOpenAi('Multiplication');
  forceCorrectableOriginal = false;
  assert.strictEqual(verificationCalls - verificationCallsBeforeCorrection, 1,
    'A flagged inaccurate original with a valid correction should not trigger verifier retries');
  assert.strictEqual(lessonWithCorrection.questions[0].answer, practiceQuestions[0].answer,
    'The final lesson should contain the corrected answer rather than the inaccurate original');

  for (const topicPrompt of ['Foil method', "Quadratic equations don't work!"]) {
    const topicQuiz = await AskOpenAi(topicPrompt);
    assert.strictEqual(topicQuiz.subject, 'Algebra', `${topicPrompt} should map to Algebra and generate a lesson`);
    assert(topicQuiz.questions.length > 0, `${topicPrompt} should include guided practice`);
    assert(topicQuiz.finalQuestions.length > 0, `${topicPrompt} should include final practice`);
  }
  assert(lastGenerationPrompt.includes("The user's requested topic or skill is: **Quadratic equations don't work!**"));
  assert(lastGenerationPrompt.includes('separate the academic concept from conversational framing'));
  assert(lastVerificationPrompt.includes("**Quadratic equations don't work!**"));
  assert(lastVerificationPrompt.includes('ignore conversational framing, complaints, or frustration'));

  const invalidShortQuiz = await AskOpenAi('basketball highlights tonight');
  assert.strictEqual(invalidShortQuiz.subject, 'Error', 'A normalized category sentinel must be rejected');
  assert.strictEqual(invalidCategoryGenerationCalls, 1);

  const generationCallsBeforeInvalidLong = generationCalls;
  const invalidLongQuiz = await AskOpenAi('Tell me about celebrity gossip');
  assert.strictEqual(invalidLongQuiz.subject, 'Error', 'Long invalid prompts must be rejected during extraction');
  assert.strictEqual(generationCalls, generationCallsBeforeInvalidLong, 'Invalid extracted categories must not reach lesson generation');
  assert.strictEqual(classificationCalls, 1);

  const generationCallsBeforeTopology = generationCalls;
  const topologyQuiz = await AskOpenAi('Please teach me about topology');
  assert.strictEqual(topologyQuiz.subject, 'Topology', 'AI-classified academic subjects must not be limited to a local list');
  assert.strictEqual(generationCalls, generationCallsBeforeTopology + 1, 'AI-approved unfamiliar disciplines should reach lesson generation');

  // Verify source-to-audit matching, correction acceptance, and fail-closed corrected sets.
  const goodVerification = {
    reviewPrerequisitesValid: true,
    questions: practiceQuestions.map((item) => ({ ...item, isAccurate: true, isOnTopic: true })),
    moreQuestions: morePracticeQuestions.map((item) => ({ ...item, isAccurate: true, isOnTopic: true })),
    finalQuestions: finalQuestions.map((item) => ({ ...item, isAccurate: true, isOnTopic: true })),
    correctedQuestions: practiceQuestions.map((item) => ({ ...item, isAccurate: true, isOnTopic: true })),
    correctedMoreQuestions: morePracticeQuestions.map((item) => ({ ...item, isAccurate: true, isOnTopic: true })),
    correctedFinalQuestions: finalQuestions.map((item) => ({ ...item, isAccurate: true, isOnTopic: true }))
  };
  const baseQuiz = { questions: practiceQuestions, moreQuestions: morePracticeQuestions, finalQuestions };
  assert.strictEqual(isValidVerification(goodVerification, baseQuiz), true);
  assert.strictEqual(isValidVerification({ ...goodVerification, reviewPrerequisitesValid: false }, baseQuiz), false,
    'The verifier must reject incomplete or inaccurate prerequisite review content');
  const quizWithBadOriginal = {
    ...baseQuiz,
    questions: practiceQuestions.map((item, index) => index === 0 ? { ...item, answer: '26' } : item)
  };
  const correctedBadOriginal = {
    ...goodVerification,
    questions: goodVerification.questions.map((item, index) => index === 0
      ? { ...item, answer: '26', isAccurate: false }
      : item),
    correctedQuestions: goodVerification.correctedQuestions.map((item, index) => index === 0
      ? { ...item, answer: practiceQuestions[0].answer }
      : item)
  };
  assert.strictEqual(isValidVerification(correctedBadOriginal, quizWithBadOriginal), true,
    'An inaccurate original must be accepted when it is faithfully flagged and the correction is valid');
  assert.strictEqual(isValidVerification({
    ...correctedBadOriginal,
    correctedQuestions: correctedBadOriginal.correctedQuestions.map((item, index) => index === 0
      ? { ...item, isOnTopic: false }
      : item)
  }, quizWithBadOriginal), false, 'Corrected questions must still be accurate and on-topic');
  assert.strictEqual(isValidVerification({ ...goodVerification, questions: goodVerification.questions.slice(1) }, baseQuiz), false);
  assert.strictEqual(isValidVerification({
    ...goodVerification,
    correctedFinalQuestions: goodVerification.correctedFinalQuestions.map((item) => ({ ...item, isAccurate: false }))
  }, baseQuiz), false);
  assert.strictEqual(isValidVerification({
    ...goodVerification,
    correctedMoreQuestions: goodVerification.correctedMoreQuestions.map((item) => ({ ...item, isAccurate: false }))
  }, baseQuiz), false);
  assert.strictEqual(isValidVerification({
    ...goodVerification,
    finalQuestions: goodVerification.finalQuestions.map((item) => ({ ...item, isOnTopic: false }))
  }, baseQuiz), true, 'Original questions may be flagged off-topic when their corrected replacements pass');
  assert.strictEqual(isValidVerification({
    ...goodVerification,
    correctedFinalQuestions: goodVerification.correctedFinalQuestions.map((item) => ({ ...item, isOnTopic: false }))
  }, baseQuiz), false, 'Corrected final questions must remain on-topic');
  assert.strictEqual(isValidVerification({
    ...goodVerification,
    questions: goodVerification.questions.map((item) => ({ ...item, answer: 'incorrect' }))
  }, baseQuiz), false, 'Verification must describe the actual original questions');
  assert.strictEqual(isValidVerification({
    ...goodVerification,
    correctedQuestions: goodVerification.correctedQuestions.map((item, index) => index === 0 ? { ...item, answer: '26' } : item)
  }, baseQuiz, topic), false, 'A corrected two-digit sum must still be arithmetically valid');
  assert.strictEqual(isValidVerification({ ...goodVerification, correctedQuestions: 'malformed' }, baseQuiz, topic), false,
    'Malformed verifier collections should fail closed without throwing');
  assert.strictEqual('allQuestions' in VERIFICATION_SCHEMA.properties, false);
  assert.strictEqual('allQuestionsValid' in VERIFICATION_SCHEMA.properties, false);
  assert.strictEqual('minItems' in VERIFICATION_SCHEMA.properties.questions, false, 'Verification counts must remain data-driven');
  assert.strictEqual(isProfanityBlocked('a harmless calculus question'), false);
  assert.strictEqual(isProfanityBlocked('idiot'), true, 'Leo profanity screening must block inappropriate input');

  // Check deterministic arithmetic, answer grading, and shared Zod schemas.
  const wrongAddition = {
    ...shortQuiz,
    questions: shortQuiz.questions.map((item, index) => index === 0 ? { ...item, answer: '26' } : item)
  };
  assert.strictEqual(isQuizValid(wrongAddition, topic), false, 'Incorrect two-digit addition must fail validation');
  assert.strictEqual(isQuizValid({ questions: { malformed: true }, finalQuestions: [] }, topic), false,
    'Malformed non-array sets should be rejected without throwing');
  assert.strictEqual(isQuizValid({
    ...shortQuiz,
    questions: [{ question: '12 + 13', answer: '25 then 1' }, ...shortQuiz.questions.slice(1)]
  }, topic), false,
    'Addition answers must be a single integer and match exactly');
  assert.strictEqual(isQuizValid({
    ...shortQuiz,
    questions: [{ question: '12 + 13 = 25, then add 1', answer: '25' }, ...shortQuiz.questions.slice(1)]
  }, topic), false, 'Addition problems with extra operands should be rejected');
  assert.strictEqual(isQuizValid({
    ...shortQuiz,
    questions: [{ question: '1. 12 + 13', answer: '25' }, ...shortQuiz.questions.slice(1)]
  }, topic), true, 'Normal numbered addition questions should pass');

  const missingMultiplicationPrerequisite = {
    ...shortQuiz,
    review: { ...shortQuiz.review, prerequisites: ['Review addition: 8 + 1 = 9.'] }
  };
  assert.strictEqual(isQuizValid(missingMultiplicationPrerequisite, 'Multiplication'), false,
    'Multiplication lessons must establish a correct single-digit fact first');
  const validMultiplicationPrerequisites = {
    ...shortQuiz,
    review: { ...shortQuiz.review, prerequisites: ['Single-digit multiplication: 6 × 4 = 24.'] }
  };
  assert.strictEqual(isQuizValid(validMultiplicationPrerequisites, 'Multiplication'), true);
  assert.strictEqual(isQuizValid({
    ...validMultiplicationPrerequisites,
    review: { ...validMultiplicationPrerequisites.review, prerequisites: ['Single-digit multiplication: 6 × 4 = 24.'] }
  }, 'Area'), false, 'Area lessons must explain square units in addition to multiplication');
  assert.strictEqual(isQuizValid({
    ...validMultiplicationPrerequisites,
    review: {
      ...validMultiplicationPrerequisites.review,
      prerequisites: [
        'Single-digit multiplication: 6 × 4 = 24.',
        'Area is measured in square units such as cm^2.'
      ]
    }
  }, 'Area'), true);

  assert.strictEqual(isAnswerCorrect('FOIL', 'First, Outer, Inner, Last'), true);
  assert.strictEqual(isAnswerCorrect('first outer inner last', 'FOIL'), true);
  assert.strictEqual(isAnswerCorrect('25.', '25'), true);
  assert.strictEqual(isAnswerCorrect('75', '75 cm^2'), true, 'A correct numeric value should pass when units are omitted');
  assert.strictEqual(isAnswerCorrect('75 cm²', '75 square centimeters'), true, 'Equivalent area-unit spellings should pass');
  assert.strictEqual(isAnswerCorrect('75 m^2', '75 cm^2'), false, 'Conflicting explicit units must not pass');
  assert.strictEqual(isAnswerCorrect('75 cm', '75 cm^2'), false, 'Length and area units must not be treated as equivalent');
  assert.strictEqual(isAnswerCorrect('method', 'foil method'), false, 'Partial substring matches must not pass grading');
  assert.strictEqual(isAnswerCorrect('first outer last', 'first outer inner last'), false);
  assert.strictEqual(validatePromptInput({ prompt: 'Hi' }).success, true, 'Short prompts should pass server-side validation');

  const zodOutput = OutputSchema.parse({
    subject: 'Math',
    review: { summary: 'Review', prerequisites: ['Single-digit addition: 1 + 1 = 2.'], formulas: ['Rule'], guidedProblem: { prompt: '1 + 1', steps: ['Add.'], answer: '2' } },
    questions: practiceQuestions,
    moreQuestions: morePracticeQuestions,
    finalQuestions
  });
  assert.strictEqual(zodOutput.questions.length, QUIZ_COUNTS.practicePerPage);
  assert.strictEqual(zodOutput.moreQuestions.length, QUIZ_COUNTS.practicePerPage);
  assert.strictEqual(zodOutput.finalQuestions.length, QUIZ_COUNTS.final);
  assert.throws(() => OutputSchema.parse({
    ...zodOutput,
    review: { ...zodOutput.review, prerequisites: [] }
  }), 'Review must contain at least one prerequisite');

  const calculusLimit = SingleQuestionAnswerSchema.parse({
    question: 'What is the limit of (x^2 - 1)/(x - 1) as x approaches 1?',
    answer: '2, since (x^2 - 1)/(x - 1) simplifies to x + 1 for x not equal to 1.'
  });
  assert(calculusLimit.question.includes('limit'));
  assert(calculusLimit.answer.startsWith('2'));

  forceApiFailure = true;
  const rateLimited = await AskOpenAi('Algebra');
  forceApiFailure = false;
  assert.match(rateLimited.error, /rate limited/);

  forceInvalidVerification = true;
  const verificationCallsBeforeRetries = verificationCalls;
  const unverifiableQuiz = await AskOpenAi('Multiplication');
  forceInvalidVerification = false;
  assert.strictEqual(verificationCalls - verificationCallsBeforeRetries, 3, 'Verification retry count must be bounded to three');
  assert.strictEqual(unverifiableQuiz.questions.length, 0);
  assert.match(unverifiableQuiz.error, /corrections must preserve the question count/i);

  // Exercise the same local HTTP routes used by the browser, including invalid requests.
  const proxy = createServer();
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxy.address().port;
  function requestHttp(method, requestPath, body = '', headers = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: proxyPort,
        path: requestPath,
        method,
        headers
      }, (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { responseBody += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: responseBody }));
      });
      request.on('error', reject);
      request.end(body);
    });
  }
  const postRaw = (body, headers = {}) => requestHttp('POST', '/openai', body, {
    'Content-Type': 'application/json',
    ...headers
  });

  try {
    const appPage = await requestHttp('GET', '/', '');
    assert.strictEqual(appPage.status, 200);
    assert(appPage.body.includes('<title>Alla AI — Math-first study tutor</title>'));
    assert(appPage.body.includes('<h1 class="title">Alla AI — Math-first study tutor</h1>'));
    assert(appPage.body.includes('Math comes first, and other academic subjects are welcome too.'));
    assert(!appPage.body.includes('secrets.js'), 'The page must not load browser-side secrets');

    const proxySuccess = await postRaw(JSON.stringify({ prompt: topic, apiKey: 'untrusted-client-key' }));
    assert.strictEqual(proxySuccess.status, 200);
    assert.strictEqual(JSON.parse(proxySuccess.body).text.subject, 'Math');
    assert.strictEqual(lastAuthorization, 'Bearer test-key', 'The proxy must ignore client-supplied API keys');

    const invalidJson = await postRaw('{not-json');
    assert.strictEqual(invalidJson.status, 400);
    const invalidBody = await postRaw('[]');
    assert.strictEqual(invalidBody.status, 400);
    const invalidPrompt = await postRaw(JSON.stringify({ prompt: 12 }));
    assert.strictEqual(invalidPrompt.status, 400);
    const oversizedBody = await postRaw(JSON.stringify({ prompt: 'x'.repeat(MAX_REQUEST_BYTES + 1) }));
    assert.strictEqual(oversizedBody.status, 413);
    const nonJson = await requestHttp('POST', '/openai', 'prompt=hi', { 'Content-Type': 'text/plain' });
    assert.strictEqual(nonJson.status, 415);
    const foreignOrigin = await postRaw(JSON.stringify({ prompt: topic }), { Origin: 'https://attacker.example' });
    assert.strictEqual(foreignOrigin.status, 403);
    const spoofedHost = await postRaw(JSON.stringify({ prompt: topic }), {
      Host: `attacker.example:${proxyPort}`,
      Origin: `http://attacker.example:${proxyPort}`
    });
    assert.strictEqual(spoofedHost.status, 403);
    const preflight = await requestHttp('OPTIONS', '/openai', '', { Origin: 'https://attacker.example' });
    assert.strictEqual(preflight.status, 405);
  } finally {
    await new Promise((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  }

  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const netlifyBadMethod = await netlifyOpenAiHandler({ httpMethod: 'GET', headers: {}, body: '' });
    assert.strictEqual(netlifyBadMethod.statusCode, 405);
    const netlifyBadJson = await netlifyOpenAiHandler({
      httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: '{not-json'
    });
    assert.strictEqual(netlifyBadJson.statusCode, 400);
    const netlifyInvalidPrompt = await netlifyOpenAiHandler({
      httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 12 })
    });
    assert.strictEqual(netlifyInvalidPrompt.statusCode, 400);
    const netlifySuccess = await netlifyOpenAiHandler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: topic })
    });
    assert.strictEqual(netlifySuccess.statusCode, 200);
    assert.strictEqual(JSON.parse(netlifySuccess.body).text.subject, 'Math');
  } finally {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }

  console.log(JSON.stringify({
    status: 'PASS',
    shortPrompt: 'one generation call before verification',
    invalidCategories: 2,
    questionCounts: { practice: shortQuiz.questions.length, perPracticePage: QUIZ_COUNTS.practicePerPage, final: shortQuiz.finalQuestions.length },
    calculusLimit: 'validated by Zod',
    proxyChecks: ['same-origin app serving', 'success', 'bad JSON', 'invalid body', 'invalid prompt', 'oversized request', 'content type', 'origin', 'spoofed host', 'preflight'],
    resilienceChecks: ['upstream rate limit', 'bounded verification retries']
  }));
})().catch((error) => {
  console.error('FAIL', error.stack || error.message);
  process.exit(1);
});