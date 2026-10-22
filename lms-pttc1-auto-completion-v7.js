(() => {
  'use strict';

  const VERSION = 'v7';
  const STORAGE_KEY = 'lms_pttc1_auto_completion_state';
  const REVIEW_ANSWERS_KEY = 'lms_pttc1_quiz_review_answers';
  const FORUM_DRAFT_KEY = 'lms_pttc1_forum_draft';

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const log = (...args) => console.log(`[LMS Auto ${VERSION}]`, ...args);

  const doneStates = new Set(['1', '2', 'done', 'completed', 'complete', 'pass', 'passed', 'true']);

  const readState = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  };

  const writeState = (next) => localStorage.setItem(STORAGE_KEY, JSON.stringify(next));

  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();

  const getCompletionState = (activityElement) => {
    const host = activityElement.closest('[data-completionstate]') || activityElement;
    const value = host?.dataset?.completionstate || activityElement.dataset?.completionstate;
    if (value) return value.toLowerCase();

    const completionBadge = activityElement.querySelector('[data-region="completion-info"], .completioninfo, .badge');
    const completionText = normalize(completionBadge?.textContent).toLowerCase();
    if (completionText.includes('done') || completionText.includes('complete') || completionText.includes('hoàn thành')) {
      return 'done';
    }

    return '';
  };

  const isActivityDone = (activityElement) => doneStates.has(getCompletionState(activityElement));

  const parseProgressPercent = () => {
    const progressNodes = Array.from(document.querySelectorAll('[class*="progress"], [data-region="progress"], .percentage'));
    for (const node of progressNodes) {
      const txt = normalize(node.textContent);
      const match = txt.match(/(\d{1,3})\s*%/);
      if (match) {
        const pct = Number(match[1]);
        if (!Number.isNaN(pct)) return pct;
      }
    }
    return null;
  };

  const getCourseIdFromLink = (href) => {
    if (!href) return '';
    try {
      const url = new URL(href, location.origin);
      return url.searchParams.get('id') || url.pathname;
    } catch {
      return href;
    }
  };

  const getCourseLinks = () => {
    const links = Array.from(document.querySelectorAll('a[href*="/course/view.php?id="]'));
    const unique = new Map();
    for (const link of links) {
      const href = link.href;
      const id = getCourseIdFromLink(href);
      if (!id || unique.has(id)) continue;
      unique.set(id, { id, href, text: normalize(link.textContent) });
    }
    return Array.from(unique.values());
  };

  const getCurrentCourseId = () => new URL(location.href).searchParams.get('id') || '';

  const shouldSkipCurrentCourse = () => {
    const progressPercent = parseProgressPercent();
    if (progressPercent === 100) {
      return { skip: true, reason: 'course progress = 100%' };
    }

    const activities = Array.from(document.querySelectorAll('li.activity, .activity-item'));
    if (!activities.length) return { skip: false, reason: 'no activities found' };

    const allDone = activities.every(isActivityDone);
    if (allDone) {
      return { skip: true, reason: 'all activities already done' };
    }

    return { skip: false, reason: 'incomplete activities remain' };
  };

  const nextCourseFromListing = () => {
    const state = readState();
    const links = getCourseLinks();
    for (const course of links) {
      if (!state[`course_done_${course.id}`]) return course;
    }
    return null;
  };

  const markCourseDone = (courseId, reason) => {
    const state = readState();
    state[`course_done_${courseId}`] = {
      at: new Date().toISOString(),
      reason,
    };
    writeState(state);
  };

  const moveToNextCourse = () => {
    const nextCourse = nextCourseFromListing();
    if (!nextCourse) {
      log('No remaining course link found on this page.');
      return;
    }
    log(`Navigate to next course: ${nextCourse.text || nextCourse.id}`);
    location.href = nextCourse.href;
  };

  const openFirstIncompleteActivity = async () => {
    const activities = Array.from(document.querySelectorAll('li.activity, .activity-item'));
    const pending = activities.find((item) => !isActivityDone(item));
    if (!pending) {
      log('No incomplete activity left in current course.');
      return;
    }

    const link = pending.querySelector('a[href]');
    if (!link) {
      log('Pending activity has no clickable link.');
      return;
    }

    log('Open next incomplete activity:', normalize(link.textContent));
    await sleep(400);
    link.click();
  };

  const clickFirst = async (selectors) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        node.click();
        return true;
      }
    }
    return false;
  };

  const saveLatestForumDraft = () => {
    const latestTitleNode = document.querySelector('.discussion .topic a, .discussionname a, .forumpost .subject');
    const latestBodyNode = document.querySelector('.forumpost .content, .post-content, .message');
    const subject = normalize(latestTitleNode?.textContent);
    const body = normalize(latestBodyNode?.textContent);
    if (!subject && !body) return false;
    localStorage.setItem(FORUM_DRAFT_KEY, JSON.stringify({ subject, body, at: Date.now() }));
    log('Saved latest forum draft (subject + body).');
    return true;
  };

  const fillForumDraft = () => {
    const raw = localStorage.getItem(FORUM_DRAFT_KEY);
    if (!raw) return false;

    let draft = null;
    try {
      draft = JSON.parse(raw);
    } catch {
      return false;
    }

    const subjectInput = document.querySelector('#id_subject, input[name="subject"]');
    const bodyTextarea = document.querySelector('#id_message, textarea[name="message"]');
    const editorFrame = document.querySelector('iframe.tox-edit-area__iframe');

    if (subjectInput && draft.subject && !subjectInput.value) subjectInput.value = draft.subject;

    if (editorFrame && draft.body) {
      const editorDoc = editorFrame.contentDocument;
      if (editorDoc?.body && !normalize(editorDoc.body.textContent)) {
        editorDoc.body.innerHTML = draft.body.replace(/\n/g, '<br>');
      }
    } else if (bodyTextarea && draft.body && !bodyTextarea.value) {
      bodyTextarea.value = draft.body;
    }

    log('Filled forum post with latest subject + body.');
    return true;
  };

  const captureQuizReviewAnswers = () => {
    const answers = {};
    const questionBlocks = document.querySelectorAll('.que');

    for (const block of questionBlocks) {
      const qname = block.getAttribute('id') || normalize(block.querySelector('.qtext')?.textContent);
      if (!qname) continue;
      const rightAnswerNode = block.querySelector('.rightanswer');
      if (!rightAnswerNode) continue;
      const raw = normalize(rightAnswerNode.textContent);
      if (!raw) continue;
      answers[qname] = raw.replace(/^The correct answer is:?\s*/i, '').trim();
    }

    if (!Object.keys(answers).length) return false;

    localStorage.setItem(REVIEW_ANSWERS_KEY, JSON.stringify(answers));
    log(`Captured ${Object.keys(answers).length} quiz answers from review page.`);
    return true;
  };

  const fillQuizAnswersFromReview = () => {
    const raw = localStorage.getItem(REVIEW_ANSWERS_KEY);
    if (!raw) return false;

    let answers = null;
    try {
      answers = JSON.parse(raw);
    } catch {
      return false;
    }

    let filledCount = 0;

    for (const block of document.querySelectorAll('.que')) {
      const qid = block.getAttribute('id') || normalize(block.querySelector('.qtext')?.textContent);
      const expected = answers[qid];
      if (!expected) continue;

      const options = Array.from(block.querySelectorAll('label, option'));
      const match = options.find((opt) => normalize(opt.textContent).toLowerCase().includes(expected.toLowerCase()));

      if (match?.tagName === 'LABEL') {
        const inputId = match.getAttribute('for');
        const input = inputId ? document.getElementById(inputId) : match.querySelector('input[type="radio"], input[type="checkbox"]');
        if (input && !input.checked) {
          input.click();
          filledCount += 1;
        }
      } else if (match?.tagName === 'OPTION') {
        match.selected = true;
        const select = match.closest('select');
        if (select) select.dispatchEvent(new Event('change', { bubbles: true }));
        filledCount += 1;
      }
    }

    if (!filledCount) return false;
    log(`Filled ${filledCount} quiz answers from review data.`);
    return true;
  };

  const autoHandleQuiz = async () => {
    const isAttemptPage = /\/mod\/quiz\/attempt\.php/.test(location.pathname);
    const isReviewPage = /\/mod\/quiz\/review\.php/.test(location.pathname);

    if (isAttemptPage) {
      const filled = fillQuizAnswersFromReview();
      if (filled) {
        await sleep(500);
        await clickFirst([
          'button[name="next"]',
          'input[name="next"]',
          'input[value*="Finish attempt"]',
          'button:has(span)',
        ]);
        return;
      }

      log('Quiz smart: submit blank attempt to unlock review answers.');
      await clickFirst([
        'input[value*="Finish attempt"]',
        'button[name="finishattempt"]',
        '.mod_quiz-next-nav input[type="submit"]',
      ]);
      await sleep(1000);
      await clickFirst([
        'button[data-action="save"]',
        'input[value*="Submit all and finish"]',
        'button:has(span)',
      ]);
      return;
    }

    if (isReviewPage) {
      const captured = captureQuizReviewAnswers();
      if (!captured) return;
      await sleep(500);
      const retried = await clickFirst([
        'a[href*="mod/quiz/startattempt.php"]',
        'button[id*="mod_quiz-next-nav"]',
        'input[value*="Re-attempt quiz"]',
      ]);
      if (retried) log('Quiz smart: re-attempting with captured correct answers.');
    }
  };

  const autoHandleSimpleActivities = async () => {
    const simpleTypes = ['resource', 'folder', 'page', 'url', 'book', 'videotime'];
    if (!simpleTypes.some((type) => location.pathname.includes(`/mod/${type}/`))) return;

    await sleep(1200);
    await clickFirst([
      'button[data-toggletype="manual:mark-done"]',
      'button[title*="Mark as done"]',
      'button:has(span)',
      'input[value*="Mark as done"]',
    ]);

    await sleep(1200);
    await clickFirst([
      'a[href*="/course/view.php?id="]',
      'a[title*="Back to course"]',
    ]);
  };

  const runCourseLogic = async () => {
    const courseId = getCurrentCourseId();
    if (!courseId) return;

    const { skip, reason } = shouldSkipCurrentCourse();
    if (skip) {
      log(`Course ${courseId} skipped: ${reason}`);
      markCourseDone(courseId, reason);
      moveToNextCourse();
      return;
    }

    await openFirstIncompleteActivity();
  };

  const run = async () => {
    log('Starting automation...');

    if (/\/course\/view\.php/.test(location.pathname)) {
      await runCourseLogic();
      return;
    }

    if (/\/mod\/forum\//.test(location.pathname)) {
      saveLatestForumDraft();
      fillForumDraft();
      return;
    }

    if (/\/mod\/quiz\//.test(location.pathname)) {
      await autoHandleQuiz();
      return;
    }

    await autoHandleSimpleActivities();

    const links = getCourseLinks();
    if (links.length) {
      log('Detected course listing page. Opening first unfinished course.');
      moveToNextCourse();
      return;
    }

    log('No supported automation action found on this page.');
  };

  run().catch((error) => log('Error:', error));
})();
