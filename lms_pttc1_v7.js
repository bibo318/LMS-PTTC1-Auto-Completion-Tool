/**
 * LMS PTTC1 - Auto Completion Tool v7
 * =====================================
 * Paste vào Console (F12) ở bất kỳ trang lms.pttc1.edu.vn
 *
 * Mới trong v7:
 *   ⏭️  Course-skip: môn nào progress 100% hoặc tất cả activity đã done → bỏ qua luôn
 *
 * Từ v6:
 *   🔄 Resume: bỏ qua hoạt động đã xong (data-completionstate), chạy tiếp chỗ dở
 *   📝 Forum: copy cả subject + body của bài viết gần nhất vào bài mới
 *   🎯 Quiz smart: nộp blank → đọc đáp án đúng từ review → nộp lại nếu còn lượt
 *
 * Tương thích v5: xử lý đầy đủ videotime, resource, folder, page, url, book,
 *   forum (auto-post + reply), quiz (Nhận điểm), bỏ qua assign / quiz pass-grade
 */
(async function lmsPTTC1_v7() {
  'use strict';
  const BASE    = 'https://lms.pttc1.edu.vn';
  const SESSKEY = M?.cfg?.sesskey;
  const sleep   = ms => new Promise(r => setTimeout(r, ms));

  // ── Config ─────────────────────────────────────────────────────────────────
  const CFG = {
    SKIP_DONE:    true,  // Bỏ qua activity có completionstate=1/2 trên course page
    QUIZ_SMART:   true,  // Sau blank attempt, đọc review và nộp lại nếu còn lượt
    DELAY_MS:     700,   // Delay giữa các activity (ms)
    QUIZ_PAGE_MS: 400,   // Delay giữa các trang quiz (ms)
  };

  const VIEW_MODS   = new Set(['videotime','resource','folder','forum','page','url','book','h5pactivity','imscp']);
  const ACTION_MODS = new Set(['assign','workshop','lesson','feedback','choice']);

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  async function getDoc(path) {
    const r = await fetch(BASE + path, {credentials:'include', headers:{Accept:'text/html'}});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return {doc: new DOMParser().parseFromString(await r.text(), 'text/html'), finalUrl: r.url};
  }

  // Supports array values (for multi-select quiz answers)
  async function postForm(path, data) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v)) v.forEach(val => body.append(k, val));
      else if (v !== undefined && v !== null) body.append(k, String(v));
    }
    const r = await fetch(BASE + path, {
      method: 'POST', credentials: 'include',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: body.toString()
    });
    const html = await r.text();
    return {doc: new DOMParser().parseFromString(html, 'text/html'), finalUrl: r.url};
  }

  // ── Badge parser ───────────────────────────────────────────────────────────
  function readBadge(doc) {
    const badges = [...doc.querySelectorAll(
      '[data-region="completionrequirements"] .badge, .automatic-completion-conditions .badge'
    )];
    if (!badges.length) return {state: 'no_tracking', text: ''};
    const allDone = badges.every(b => b.classList.contains('alert-success'));
    const anyNeed = badges.some(b => {
      const t = b.textContent;
      return t.includes('Cần') || t.includes('Gửi') || t.includes('Đạt');
    });
    if (allDone) return {state: 'done', text: badges.map(b=>b.textContent.trim()).join(' | ')};
    if (anyNeed) return {state: 'needs_action', text: badges.map(b=>b.textContent.trim()).join(' | ')};
    return {state: 'done', text: ''};
  }

  // ── Scrape activities — reads data-completionstate for resume ──────────────
  // Moodle sets completionstate: 0=not done, 1=done, 2=pass, 3=fail
  function scrapeActivities(doc) {
    const seen = new Set(), list = [];
    doc.querySelectorAll('li.activity').forEach(li => {
      const id   = li.dataset.id;
      const type = [...li.classList].find(c=>c.startsWith('modtype_'))?.replace('modtype_','');
      if (!id || !type || seen.has(id)) return;
      seen.add(id);
      const name = li.querySelector('.instancename,.activitytitle')
                      ?.textContent?.replace(/\s+/g,' ').replace('Thời gian Video','').trim()
                   || `${type}_${id}`;
      const sect = li.closest('[data-sectionid]')
                      ?.querySelector('.sectionname,h3,h4')?.textContent?.trim() || '';
      const cs     = li.dataset.completionstate;
      const isDone = cs === '1' || cs === '2';
      list.push({id, type, name, sect, isDone});
    });
    return list;
  }

  // ── Get enrolled courses ───────────────────────────────────────────────────
  async function getCourses() {
    const {doc} = await getDoc('/my/courses.php');
    const map   = new Map();
    doc.querySelectorAll('a[href*="/course/view.php"]').forEach(a => {
      const id   = new URL(a.href).searchParams.get('id');
      const name = a.textContent.replace(/\s+/g,' ').trim();
      if (id && name.length > 2 && !map.has(id)) map.set(id, {id, name});
    });
    return [...map.values()];
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HANDLERS
  // ════════════════════════════════════════════════════════════════════════════

  // ── View-based modules ─────────────────────────────────────────────────────
  async function handleView(act) {
    const {doc} = await getDoc(`/mod/${act.type}/view.php?id=${act.id}`);
    return readBadge(doc);
  }

  // ── Forum helpers ──────────────────────────────────────────────────────────
  async function getReplyForm(postId) {
    const {doc} = await getDoc(`/mod/forum/post.php?reply=${postId}`);
    return {
      course:      doc.querySelector('[name="course"]')?.value,
      forum:       doc.querySelector('[name="forum"]')?.value,
      discussion:  doc.querySelector('[name="discussion"]')?.value,
      parent:      doc.querySelector('[name="parent"]')?.value,
      reply:       doc.querySelector('[name="reply"]')?.value,
      sesskey:     doc.querySelector('[name="sesskey"]')?.value || SESSKEY,
      itemid:      doc.querySelector('[name="message[itemid]"]')?.value || '0',
      attachments: doc.querySelector('[name="attachments"]')?.value || '0',
    };
  }

  async function postReply(postId, subject, message) {
    const f = await getReplyForm(postId);
    return postForm('/mod/forum/post.php', {
      course: f.course, forum: f.forum, discussion: f.discussion,
      parent: f.parent, reply: f.reply, edit: 0, sesskey: f.sesskey,
      _qf__mod_forum_post_form: 1, mform_isexpanded_id_general: 1,
      subject: subject || 'Re: Thảo luận',
      'message[text]': message || '<p>Cảm ơn bạn đã chia sẻ nội dung hữu ích.</p>',
      'message[format]': 1, 'message[itemid]': f.itemid,
      attachments: f.attachments,
      submitbutton: 'Gửi bài viết lên diễn đàn'
    });
  }

  // Fetch body HTML of the first (most recent) discussion post
  async function getDiscussionContent(discId) {
    try {
      const {doc} = await getDoc(`/mod/forum/discuss.php?d=${discId}`);
      // Try multiple selectors for different Moodle/theme layouts
      const body = doc.querySelector(
        '.forumpost .posting, .post-content-container .no-overflow, ' +
        '.forumpost .message, [data-region="forum-post"] .message'
      )?.innerHTML?.trim();
      return body || '<p>Chia sẻ thêm về chủ đề này để cùng nhau trao đổi và học hỏi.</p>';
    } catch {
      return '<p>Chia sẻ thêm về chủ đề này để cùng nhau trao đổi và học hỏi.</p>';
    }
  }

  async function createDiscussion(forumId, courseId, subject, bodyHtml) {
    const {doc: fDoc} = await getDoc(`/mod/forum/post.php?forum=${forumId}`);
    return postForm('/mod/forum/post.php', {
      course: courseId, forum: forumId, discussion: 0, parent: 0,
      groupid: fDoc.querySelector('[name="groupid"]')?.value || '',
      edit: 0, reply: 0, sesskey: SESSKEY,
      _qf__mod_forum_post_form: 1, mform_isexpanded_id_general: 1,
      mform_isexpanded_id_tagshdr: 1,
      subject,
      'message[text]': bodyHtml || '<p>Chia sẻ thêm về chủ đề này.</p>',
      'message[format]': 1,
      'message[itemid]': fDoc.querySelector('[name="message[itemid]"]')?.value || '0',
      attachments: fDoc.querySelector('[name="attachments"]')?.value || '0',
      tags: '_qf__force_multiselect_submission',
      submitbutton: 'Gửi bài viết lên diễn đàn'
    });
  }

  // ── Forum handler ──────────────────────────────────────────────────────────
  async function handleForum(act, courseId) {
    const {doc: viewDoc} = await getDoc(`/mod/forum/view.php?id=${act.id}`);
    const badge = readBadge(viewDoc);
    if (badge.state === 'done') return badge;

    // View-only (Thông báo) has no "post new discussion" link
    const forumId = viewDoc.querySelector('a[href*="post.php?forum"]')
      ?.href?.match(/forum=(\d+)/)?.[1];
    if (!forumId) return badge;

    // Most recent (top-listed) discussion
    const discLinks     = [...viewDoc.querySelectorAll('a[href*="discuss.php?d="]')];
    const firstDiscLink = discLinks.find(a => a.href.match(/d=(\d+)/));
    const firstDiscId   = firstDiscLink?.href?.match(/d=(\d+)/)?.[1];
    const firstSubject  = firstDiscLink?.textContent?.trim() || 'Thảo luận chương học';

    const needsDisc  = badge.text.includes('Bắt đầu');
    const needsReply = badge.text.includes('câu trả lời') || badge.text.includes('Phúc đáp');

    let targetDiscId = firstDiscId;

    // Create new discussion — copy subject + body from most recent topic
    if (needsDisc) {
      const bodyHtml = await getDiscussionContent(firstDiscId);
      const {finalUrl} = await createDiscussion(forumId, courseId, firstSubject, bodyHtml);
      targetDiscId = finalUrl?.match(/d=(\d+)/)?.[1] || firstDiscId;
      await sleep(400);
    }

    // Reply to first post of the target discussion
    if (needsReply && targetDiscId) {
      const {doc: dDoc} = await getDoc(`/mod/forum/discuss.php?d=${targetDiscId}`);
      const firstPostId = dDoc.querySelector('a[href*="post.php?reply="]')
        ?.href?.match(/reply=(\d+)/)?.[1];
      if (firstPostId) {
        await postReply(firstPostId, 'Re: ' + firstSubject);
        await sleep(400);
      }
    }

    const {doc: checkDoc} = await getDoc(`/mod/forum/view.php?id=${act.id}`);
    return readBadge(checkDoc);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  QUIZ SMART-ANSWER
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Parse the review page for correct answers.
   * Returns: { "slotNum": { suffix: "answer", value: "3" | ["1","2"] } }
   * "suffix" is the part after q{attemptId}:{slot}_ in the input name.
   * The slot key lets us remap to a new attempt ID later.
   */
  async function extractAnswersFromReview(attemptId, cmid) {
    const slotAnswers = {};

    for (let page = 0; page < 20; page++) {
      const {doc} = await getDoc(
        `/mod/quiz/review.php?attempt=${attemptId}&cmid=${cmid}&page=${page}`
      );
      const questions = [...doc.querySelectorAll('.que')];
      if (!questions.length) break;

      questions.forEach(q => {
        // q.id format: "q{attemptId}-{slot}"
        const slotMatch = q.id?.match(/q\d+-(\d+)/);
        if (!slotMatch) return;
        const slot = slotMatch[1];

        // Radio buttons (multichoice, truefalse)
        let found = false;
        q.querySelectorAll('.answer > div, .answer > label').forEach(opt => {
          if (found) return;
          if (opt.classList.contains('correct') || opt.classList.contains('gradedright')) {
            const radio = opt.querySelector('input[type="radio"]');
            if (radio?.name) {
              const suffix = radio.name.replace(`q${attemptId}:${slot}_`, '');
              slotAnswers[slot] = {suffix, value: radio.value};
              found = true;
            }
          }
        });

        // Checkboxes (multianswer — multiple correct options)
        if (!found) {
          const correctVals = [];
          let sharedSuffix  = '';
          q.querySelectorAll('.answer > div, .answer > label').forEach(opt => {
            if (opt.classList.contains('correct') || opt.classList.contains('gradedright')) {
              const cb = opt.querySelector('input[type="checkbox"]');
              if (cb?.name) {
                sharedSuffix = cb.name.replace(`q${attemptId}:${slot}_`, '');
                correctVals.push(cb.value || '1');
              }
            }
          });
          if (correctVals.length) {
            slotAnswers[slot] = {suffix: sharedSuffix, value: correctVals, multi: true};
          }
        }
      });

      // Stop if no "next page" navigation exists
      if (!doc.querySelector('a[href*="page="]')) break;
    }
    return slotAnswers;
  }

  // Check if the quiz view page offers a re-attempt button
  function quizCanRetake(viewDoc) {
    const text = viewDoc.body?.textContent || '';
    return !!(
      viewDoc.querySelector('[name="forcenew"]') ||
      text.includes('Thử lại') ||
      text.includes('attempt is allowed') ||
      text.match(/còn \d+ lần/) ||
      viewDoc.querySelector('.quizinfo form button')
    );
  }

  // Submit a quiz attempt, filling in slotAnswers where available
  async function submitAttemptPages(attemptId, cmid, slotAnswers) {
    let page = 0;
    for (let safety = 0; safety < 30; safety++) {
      const {doc: pageDoc, finalUrl: pageUrl} = await getDoc(
        `/mod/quiz/attempt.php?attempt=${attemptId}&cmid=${cmid}&page=${page}`
      );
      if (pageUrl?.includes('summary') || pageUrl?.includes('review')) break;

      // Base form data from hidden fields
      const formData = {attempt: attemptId, sesskey: SESSKEY, scrollpos: 0, thispage: page};
      pageDoc.querySelectorAll('form[method="post"] input[type="hidden"]').forEach(el => {
        if (el.name && !(el.name in formData)) formData[el.name] = el.value;
      });

      // Inject correct answers using slot→value map (if provided)
      if (slotAnswers) {
        pageDoc.querySelectorAll('.que').forEach(q => {
          const slotMatch = q.id?.match(/q\d+-(\d+)/);
          if (!slotMatch) return;
          const slot = slotMatch[1];
          const ans  = slotAnswers[slot];
          if (!ans) return;

          const inputName = `q${attemptId}:${slot}_${ans.suffix}`;
          if (ans.multi) {
            formData[inputName] = ans.value; // array → appended by postForm
          } else {
            formData[inputName] = ans.value;
          }
        });
      }

      const isLastPage = !pageDoc.querySelector('.submitbtns [name="next"]') ||
                          !!pageDoc.querySelector('.submitbtns [name="finishattempt"]');
      if (isLastPage) {
        formData['finishattempt'] = 1;
        await postForm('/mod/quiz/processattempt.php', formData);
        break;
      } else {
        formData['next'] = 1;
        await postForm('/mod/quiz/processattempt.php', formData);
        page++;
        await sleep(CFG.QUIZ_PAGE_MS);
      }
    }
  }

  // ── Quiz handler ───────────────────────────────────────────────────────────
  async function handleQuiz(act) {
    const {doc: viewDoc} = await getDoc(`/mod/quiz/view.php?id=${act.id}`);
    const badge = readBadge(viewDoc);
    if (badge.state === 'done') return badge;

    // Cannot auto-pass minimum-grade quizzes
    if (badge.text.includes('Đạt điểm tối thiểu') || badge.text.includes('pass')) {
      return {state: 'needs_action', text: 'Quiz yêu cầu điểm tối thiểu — cần làm tay'};
    }

    // Step 1: Start a blank attempt
    const {doc: startDoc, finalUrl: startUrl} = await postForm('/mod/quiz/startattempt.php', {
      cmid: act.id, sesskey: SESSKEY, quizpassword: '', forcenew: 0
    });
    const attemptId = startUrl?.match(/attempt=(\d+)/)?.[1] ||
                      startDoc.querySelector('[name="attempt"]')?.value;
    if (!attemptId) return {state: 'error', text: 'Không start được quiz attempt'};

    // Step 2: Submit blank (records a grade, unlocks completion for "Nhận điểm" type)
    await submitAttemptPages(attemptId, act.id, null);
    await sleep(600);

    // Step 3 (optional): Extract correct answers from review, re-attempt if allowed
    if (CFG.QUIZ_SMART) {
      const slotAnswers   = await extractAnswersFromReview(attemptId, act.id);
      const answeredCount = Object.keys(slotAnswers).length;

      if (answeredCount > 0) {
        const {doc: viewDoc2} = await getDoc(`/mod/quiz/view.php?id=${act.id}`);
        if (quizCanRetake(viewDoc2)) {
          console.log(`    🎯 ${answeredCount} đáp án tìm thấy → nộp lại lần 2`);
          const {doc: s2Doc, finalUrl: s2Url} = await postForm('/mod/quiz/startattempt.php', {
            cmid: act.id, sesskey: SESSKEY, quizpassword: '', forcenew: 1
          });
          const attempt2Id = s2Url?.match(/attempt=(\d+)/)?.[1] ||
                             s2Doc.querySelector('[name="attempt"]')?.value;
          if (attempt2Id) {
            await submitAttemptPages(attempt2Id, act.id, slotAnswers);
            await sleep(600);
          }
        } else {
          console.log(`    ℹ️  Review cho ${answeredCount} đáp án nhưng không còn lượt làm lại`);
        }
      }
    }

    // Final verify
    const {doc: checkDoc} = await getDoc(`/mod/quiz/view.php?id=${act.id}`);
    return readBadge(checkDoc);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PROCESS ACTIVITY
  // ════════════════════════════════════════════════════════════════════════════
  async function processActivity(act, courseId, idx, total) {
    const pfx = `  [${String(idx).padStart(2)}/${total}]`;

    // ── RESUME: skip already-done activities detected from course page ─────
    if (CFG.SKIP_DONE && act.isDone) {
      console.log(`${pfx} ✅ ALREADY   ${act.name}`);
      return {...act, status:'done'};
    }

    if (ACTION_MODS.has(act.type)) {
      console.log(`${pfx} ✋ SKIP       ${act.name}  (${act.type} — cần làm tay)`);
      return {...act, status:'skipped'};
    }

    try {
      let result;
      if      (act.type === 'quiz')            result = await handleQuiz(act);
      else if (act.type === 'forum')           result = await handleForum(act, courseId);
      else if (VIEW_MODS.has(act.type))        result = await handleView(act);
      else                                     result = await handleView(act); // unknown → try view

      if (result.state === 'done') {
        console.log(`${pfx} ✅ DONE      ${act.name}`);
        return {...act, status:'done'};
      } else if (result.state === 'no_tracking') {
        console.log(`${pfx} ➖ NO TRACK  ${act.name}`);
        return {...act, status:'no_tracking'};
      } else if (result.state === 'needs_action') {
        console.log(`${pfx} ✋ MANUAL    ${act.name}  → ${result.text}`);
        return {...act, status:'needs_action'};
      } else {
        console.warn(`${pfx} ❌ ERROR     ${act.name}: ${result.text}`);
        return {...act, status:'error', error: result.text};
      }
    } catch(e) {
      console.warn(`${pfx} ❌ ERROR     ${act.name}: ${e.message}`);
      return {...act, status:'error', error: e.message};
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PROCESS COURSE
  // ════════════════════════════════════════════════════════════════════════════
  async function processCourse(course, ci, total) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📚 [${ci}/${total}] ${course.name}`);

    let doc;
    try { ({doc} = await getDoc(`/course/view.php?id=${course.id}`)); }
    catch(e) { console.warn('  ❌ Lỗi tải course:', e.message); return []; }

    const progressBefore = doc.querySelector('.progress-bar')?.style?.width || '?';
    const acts           = scrapeActivities(doc);
    if (!acts.length) { console.log('  ℹ️  Không có hoạt động.'); return []; }

    const doneBefore  = acts.filter(a => a.isDone).length;
    const pendingActs = acts.filter(a => !a.isDone && !ACTION_MODS.has(a.type));
    const pending     = pendingActs.length;

    // ── COURSE-LEVEL SKIP: chỉ bỏ qua khi progress bar đúng 100% ────────────
    const courseComplete = progressBefore === '100%';
    if (courseComplete) {
      console.log(`  📈 Progress: ${progressBefore}  |  ✅${doneBefore}/${acts.length} — MÔN HỌC ĐÃ HOÀN THÀNH, bỏ qua.\n`);
      return acts.map(a => ({...a, status:'done'}));
    }

    console.log(`  📈 Progress: ${progressBefore}  |  ✅${doneBefore} đã xong  ⏳${pending} còn lại\n`);

    const results = [];
    for (let i = 0; i < acts.length; i++) {
      results.push(await processActivity(acts[i], course.id, i+1, acts.length));
      // No delay needed when just skipping already-done items
      if (i < acts.length - 1 && !acts[i].isDone) await sleep(CFG.DELAY_MS);
    }

    try {
      const {doc: d2} = await getDoc(`/course/view.php?id=${course.id}`);
      const after = d2.querySelector('.progress-bar')?.style?.width || '?';
      console.log(`\n  📈 Progress: ${progressBefore} → ${after}  ${after !== progressBefore ? '⬆️' : '(không đổi)'}`);
    } catch(_) {}

    const n = s => results.filter(r=>r.status===s).length;
    console.log(`  ✨ ✅${n('done')} done  ➖${n('no_tracking')} no-track  ✋${n('skipped')+n('needs_action')} tay  ❌${n('error')} lỗi`);
    if (n('needs_action') + n('skipped') > 0) {
      const manual = results.filter(r=>['skipped','needs_action'].includes(r.status));
      console.log(`  ✋ Cần làm tay:\n${manual.map(a=>`     • ${a.name} (${a.type})`).join('\n')}`);
    }
    return results;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  MAIN
  // ════════════════════════════════════════════════════════════════════════════
  console.clear();
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       LMS PTTC1 - Auto Completion Tool v7                 ║');
  console.log('║  ⏭️  course-skip  🔄 resume  📝 forum  🎯 quiz smart      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const courses = await getCourses();
  if (!courses.length) { console.error('❌ Không tìm thấy môn. Hãy đăng nhập.'); return; }

  console.log(`📚 ${courses.length} môn học:`);
  courses.forEach((c,i) => console.log(`  ${i+1}. [${c.id}] ${c.name}`));

  const allResults = {};
  for (let i = 0; i < courses.length; i++) {
    allResults[courses[i].id] = await processCourse(courses[i], i+1, courses.length);
    if (i < courses.length - 1) await sleep(800);
  }

  // Grand summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('🏁  TỔNG KẾT\n');
  let [gDone, gManual, gNoTrack, gErr] = [0,0,0,0];
  for (const c of courses) {
    const res = allResults[c.id] || [];
    const n   = s => res.filter(r=>r.status===s).length;
    gDone    += n('done');  gManual  += n('skipped') + n('needs_action');
    gNoTrack += n('no_tracking');  gErr += n('error');
    console.log(`  📖 ${c.name.substring(0,48)}`);
    console.log(`     ✅${n('done')}  ✋${n('skipped')+n('needs_action')}  ➖${n('no_tracking')}  ❌${n('error')}`);
  }
  console.log(`\n  ${'─'.repeat(56)}`);
  console.log(`  ✅ ${gDone} tự động  ✋ ${gManual} cần tay  ➖ ${gNoTrack} no-track  ❌ ${gErr} lỗi`);
  console.log(`  💡 Reload course page → xem progress bar % kết quả`);
  console.log(`${'═'.repeat(60)}`);
  return allResults;
})();
