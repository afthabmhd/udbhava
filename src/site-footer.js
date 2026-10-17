(() => {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.setAttribute('aria-label', 'Udbhava site footer');
  footer.innerHTML = `
    <div class="site-footer__inner">
      <div class="site-footer__main">
        <a class="site-footer__brand" href="./index.html#home" aria-label="Udbhava 2026 home">
          <img src="./src/assets/logos/udhbava.png" alt="">
          <span class="site-footer__brand-copy"><span>UDBHAVA <b>’26</b></span><small>COLLEGE TECHFEST</small></span>
        </a>
        <p class="site-footer__motto">ENGINEERING <i></i> CULTURE <i></i> COMMUNITY</p>
        <nav class="site-footer__links" aria-label="Footer navigation">
          <a href="./index.html#home">HOME</a>
          <a href="./events.html">EVENTS</a>
          <a href="./about.html">ABOUT</a>
          <a href="./index.html#register">REGISTER <span aria-hidden="true">↗</span></a>
        </nav>
      </div>
      <div class="site-footer__bottom">
        <span>© UDBHAVA ’26 · SNGCET</span>
        <span>SREE NARAYANA GURU COLLEGE OF ENGINEERING AND TECHNOLOGY</span>
      </div>
    </div>`;

  document.body.append(footer);
})();
