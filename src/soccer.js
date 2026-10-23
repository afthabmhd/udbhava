(() => {
  'use strict';

  const section = document.querySelector('.soccer-section');
  const arena = section?.querySelector('.soccer-arena');
  if (!section || !arena) return;

  const robotElements = [...arena.querySelectorAll('.soccer-robot')];
  const ballElement = arena.querySelector('[data-ball]');
  if (robotElements.length !== 4 || !ballElement) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const passOrder = [0, 1, 3, 2];
  const robotHomes = [
    { x: -1, y: -1, team: 'blue' },
    { x: 1, y: -1, team: 'magenta' },
    { x: -1, y: 1, team: 'magenta' },
    { x: 1, y: 1, team: 'blue' }
  ];
  const robots = robotHomes.map((home, index) => ({
    sideX: home.x,
    sideY: home.y,
    team: home.team,
    element: robotElements[index],
    x: 0,
    y: 0,
    homeX: 0,
    homeY: 0,
    radius: 1,
    heading: home.team === 'blue' ? 45 : 135
  }));
  const ball = { x: 0, y: 0, radius: 1, rotation: 0 };
  // One pass runs continuously from one robot to the next. Each kick sends the
  // ball on a shallow, curved flight, with no eased arrival or idle interval.
  const passDuration = .9;
  let arenaWidth = 0;
  let arenaHeight = 0;
  let arenaScale = 0;
  let elapsed = 0;
  let previousFrame = null;
  let frameRequest = 0;
  let inView = false;
  let nebulaReady = Boolean(window.__udbhavaSoccerNebulaReady);
  let sceneEntered = false;
  let loopStarted = false;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = value => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const pulse = (value, start, end) => {
    if (value <= start || value >= end) return 0;
    return smoothstep((value - start) / .08) * (1 - smoothstep((value - end + .08) / .08));
  };

  function waypointFor(robotIndex) {
    const robot = robots[robotIndex];
    return {
      x: arenaWidth * .5 + robot.sideX * arenaScale * .105,
      y: arenaHeight * .5 + robot.sideY * arenaScale * .105
    };
  }

  function placeRobots(progress = null, segmentIndex = 0) {
    for (const robot of robots) {
      let contact = 0;
      if (progress !== null) {
        const current = passOrder[segmentIndex];
        const next = passOrder[(segmentIndex + 1) % passOrder.length];
        if (robot.element === robots[current].element) contact = pulse(progress, .04, .24);
        if (robot.element === robots[next].element) contact = Math.max(contact, pulse(progress, .86, .99));
      }

      const target = waypointFor(robotElements.indexOf(robot.element));
      robot.x = robot.homeX + (target.x - robot.homeX) * contact * .11;
      robot.y = robot.homeY + (target.y - robot.homeY) * contact * .11;
      const sign = robot.team === 'blue' ? 1 : -1;
      robot.heading = (robot.team === 'blue' ? 45 : 135) + sign * contact * 5;
    }
  }

  function advanceMatch() {
    if (!arenaWidth || !arenaHeight) return;
    const cycleDuration = passDuration * passOrder.length;
    const cycleTime = elapsed % cycleDuration;
    const segmentIndex = Math.floor(cycleTime / passDuration);
    const segmentTime = cycleTime - segmentIndex * passDuration;
    const progress = segmentTime / passDuration;
    const source = waypointFor(passOrder[segmentIndex]);
    const destination = waypointFor(passOrder[(segmentIndex + 1) % passOrder.length]);

    // Add a different shallow arc to each pass. sin² returns to zero with zero
    // sideways velocity at contact, so each kick still meets the next robot
    // cleanly while the ball stays in motion throughout the cycle.
    const dx = destination.x - source.x;
    const dy = destination.y - source.y;
    const bend = Math.sin(Math.PI * progress) ** 2 * arenaScale * .035 * (segmentIndex % 2 ? -1 : 1);
    ball.x = source.x + dx * progress - (dy / Math.hypot(dx, dy)) * bend;
    ball.y = source.y + dy * progress + (dx / Math.hypot(dx, dy)) * bend;
    ball.rotation = ((segmentIndex + progress) * 90) % 360;
    placeRobots(progress, segmentIndex);
  }

  function measureArena() {
    const rect = arena.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    arenaWidth = rect.width;
    arenaHeight = rect.height;
    arenaScale = Math.min(arenaWidth, arenaHeight);
    for (const robot of robots) {
      robot.homeX = arenaWidth * .5 + robot.sideX * arenaScale * .165;
      robot.homeY = arenaHeight * .5 + robot.sideY * arenaScale * .165;
      robot.radius = robot.element.getBoundingClientRect().width * .34;
    }
    ball.radius = ballElement.getBoundingClientRect().width * .46;
    advanceMatch();
    paintPositions();
  }

  function botTransform(robot) {
    const dx = robot.x - arenaWidth * .5;
    const dy = robot.y - arenaHeight * .5;
    return `translate3d(-50%, -50%, 0) translate3d(${dx}px, ${dy}px, 0) rotate(${robot.heading}deg)`;
  }

  function ballTransform() {
    const dx = ball.x - arenaWidth * .5;
    const dy = ball.y - arenaHeight * .5;
    return `translate3d(-50%, -50%, 0) translate3d(${dx}px, ${dy}px, 0) rotate(${ball.rotation}deg)`;
  }

  function paintPositions() {
    if (!arenaWidth || !arenaHeight) return;
    for (const robot of robots) robot.element.style.transform = botTransform(robot);
    ballElement.style.transform = ballTransform();
  }

  function tick(now) {
    if (!inView || document.hidden || reducedMotion) {
      frameRequest = 0;
      previousFrame = null;
      return;
    }
    if (previousFrame !== null) elapsed += Math.min((now - previousFrame) / 1000, .04);
    previousFrame = now;
    advanceMatch();
    paintPositions();
    frameRequest = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (loopStarted || reducedMotion) return;
    loopStarted = true;
    section.classList.toggle('motion-active', inView);
    section.classList.add('match-active');
    if (inView && !document.hidden) {
      previousFrame = null;
      frameRequest = requestAnimationFrame(tick);
    }
  }

  function enterScene() {
    if (sceneEntered || !nebulaReady || !inView || !arenaWidth || !arenaHeight) return;
    sceneEntered = true;
    section.classList.add('nebula-ready');
    advanceMatch();
    paintPositions();

    if (reducedMotion) {
      for (const robot of robots) robot.element.style.opacity = '1';
      ballElement.style.opacity = '1';
      section.classList.add('match-active');
      return;
    }

    section.classList.add('motion-active');

    const entrances = robots.map((robot, index) => {
      const finalPose = botTransform(robot);
      const startX = robot.x + (robot.x < arenaWidth * .5 ? -arenaWidth * .035 : arenaWidth * .035);
      const startY = robot.y + (robot.y < arenaHeight * .5 ? -arenaHeight * .03 : arenaHeight * .03);
      const startTransform = `translate3d(-50%, -50%, 0) translate3d(${startX - arenaWidth * .5}px, ${startY - arenaHeight * .5}px, 0) rotate(${robot.heading}deg) scale(.86)`;
      const animation = robot.element.animate([
        { transform: startTransform, opacity: 0 },
        { transform: `${finalPose} scale(1)`, opacity: 1 }
      ], { duration: 620, delay: index * 70, easing: 'cubic-bezier(.2,.72,.24,1)', fill: 'both' });
      return animation.finished.then(() => {
        robot.element.style.opacity = '1';
        robot.element.style.transform = finalPose;
        animation.cancel();
      });
    });

    const ballPose = ballTransform();
    const ballAnimation = ballElement.animate([
      { transform: `${ballPose} scale(.78)`, opacity: 0 },
      { transform: `${ballPose} scale(1)`, opacity: 1 }
    ], { duration: 440, delay: 170, easing: 'cubic-bezier(.2,.72,.24,1)', fill: 'both' });
    const ballEntrance = ballAnimation.finished.then(() => {
      ballElement.style.opacity = '1';
      ballElement.style.transform = ballPose;
      ballAnimation.cancel();
    });
    Promise.all([...entrances, ballEntrance]).then(startLoop);
  }

  function resumeLoop() {
    if (!inView) return;
    enterScene();
    if (loopStarted && !reducedMotion && !document.hidden && !frameRequest) {
      previousFrame = null;
      frameRequest = requestAnimationFrame(tick);
    }
  }

  const visibilityObserver = new IntersectionObserver(entries => {
    inView = entries.some(entry => entry.isIntersecting);
    section.classList.toggle('motion-active', inView && !document.hidden && !reducedMotion);
    if (inView) resumeLoop();
    else if (frameRequest) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      previousFrame = null;
    }
  }, { threshold: 0, rootMargin: '100px 0px' });
  visibilityObserver.observe(section);

  if (reducedMotion) nebulaReady = true;
  else window.addEventListener('udbhava:soccer-nebula-ready', () => {
    nebulaReady = true;
    enterScene();
  }, { once: true });

  if ('ResizeObserver' in window) new ResizeObserver(measureArena).observe(arena);
  else window.addEventListener('resize', measureArena);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && frameRequest) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      previousFrame = null;
      section.classList.remove('motion-active');
    } else if (!document.hidden) resumeLoop();
  });
  measureArena();
})();
