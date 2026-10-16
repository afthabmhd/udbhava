const button=document.querySelector('.menu-toggle'),menu=document.querySelector('.mobile-nav');
button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Close navigation':'Open navigation');menu.classList.toggle('open',open);menu.inert=!open});
menu.addEventListener('click',e=>{if(e.target.closest('a')){button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Open navigation');menu.classList.remove('open');menu.inert=true}});

const hero=document.querySelector('.hero');
const scrambleNodes=[...hero.querySelectorAll('[data-scramble]')];
const lateNodes=hero.querySelectorAll('.topbar,.top-right,.corner,.title-rule,.bottom-left,.scroll-cue');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!reducedMotion&&scrambleNodes.length){
  const scrambleChars='.:;,+-~=/*\\|()[]{}<>^_#%';
  const phases=scrambleNodes.map((node,index)=>{
    const text=node.dataset.scramble,fragment=document.createDocumentFragment(),slots=[];
    for(const character of text){const slot=document.createElement('span');slot.className=character===' '?'scramble-cell scramble-cell--space':'scramble-cell';slot.textContent=character===' '?character:scrambleChars[Math.floor(Math.random()*scrambleChars.length)];fragment.appendChild(slot);slots.push(slot)}
    node.replaceChildren(fragment);
    return {text,slots,delay:index*230,duration:index===0?1350:1220};
  });
  lateNodes.forEach(node=>node.classList.add('intro-late'));
  hero.classList.add('intro-active');
  hero.classList.remove('scramble-pending');
  window.addEventListener('udbhava:nebula-reveal-complete',()=>hero.classList.remove('intro-active'),{once:true});
  const start=performance.now();
  const timer=window.setInterval(()=>{
    const elapsed=performance.now()-start;
    for(const phase of phases){
      if(elapsed<phase.delay)continue;
      const progress=Math.max(0,Math.min(1,(elapsed-phase.delay)/phase.duration));
      const resolved=Math.floor(progress*phase.text.length);
      phase.slots.forEach((slot,index)=>{slot.textContent=index<resolved?phase.text[index]:scrambleChars[Math.floor(Math.random()*scrambleChars.length)]});
    }
    if(elapsed>=1500){
      window.clearInterval(timer);
    }
  },42);
}else hero.classList.remove('scramble-pending');
