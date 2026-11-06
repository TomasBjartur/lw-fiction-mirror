// The site's behaviour on every page: theme toggle, story nav, reading progress,
// title fitting, reading position, email signup and the title hover morph. Copied
// to dist/ by build.js and stamped with a hash of its bytes. The geo curtain stays
// inline in the page (build.js), where it can act before first paint.
(function(){
  var h=document.documentElement;

  // Theme: light until the reader picks dark; the toggle switches between
  // the two and remembers the choice.
  var tb=document.getElementById('theme-btn');
  if(tb){
    var NAME={light:'Light theme',dark:'Dark theme'};
    var cur=function(){return h.getAttribute('data-theme')==='dark'?'dark':'light'};
    var show=function(){
      var c=cur();tb.title=NAME[c]+' (click to change)';tb.setAttribute('aria-label',NAME[c]+'. Change theme');
      document.querySelector('meta[name=color-scheme]').content=c;
      document.querySelector('meta[name=theme-color]').content=getComputedStyle(document.body).backgroundColor;
    };
    tb.addEventListener('click',function(e){
      var n=cur()==='dark'?'light':'dark';
      if(n==='dark')h.setAttribute('data-theme','dark');else h.removeAttribute('data-theme');
      try{localStorage.setItem('theme',n)}catch(x){}
      show();
      // A mouse leaves it focused, where Space would flip the theme again instead
      // of scrolling, with the nav hidden. A key press has no pointer and keeps focus.
      if(e.pointerType)tb.blur();
    });
    show();
    // A page restored from the back/forward cache keeps the theme it was
    // left with, which may have changed on another page since.
    addEventListener('pageshow',function(e){
      if(!e.persisted)return;
      var t=null;try{t=localStorage.getItem('theme')}catch(x){}
      if(t==='dark')h.setAttribute('data-theme','dark');else h.removeAttribute('data-theme');
      show();
    });
  }

  // Story pages, as on markusstrasser.org (Nav.svelte): the nav slides
  // away while reading down and returns on any scroll up, at the top, or
  // when it holds keyboard focus.
  var nav=document.querySelector('.is-post .nav');
  if(nav){
    var lastY=scrollY,frame=0;
    var update=function(){
      frame=0;var y=scrollY,d=y-lastY;
      if(y<50)nav.classList.remove('hidden');
      else if(Math.abs(d)>5&&!nav.querySelector(':focus-visible'))nav.classList.toggle('hidden',d>0);
      if(Math.abs(d)>5||y<50)lastY=y;
    };
    addEventListener('scroll',function(){if(!frame)frame=requestAnimationFrame(update)},{passive:true});
    nav.addEventListener('focusin',function(){nav.classList.remove('hidden')});
    update();
  }

  // Reading progress: the hairline fades in after 100px and fills from
  // the story text's top at the window's top to its last line at the
  // window's bottom, so it reaches the end at the text, not the footer.
  var storyBody=document.querySelector('.is-post .post-body');
  var progressWrap=document.querySelector('.reading-progress');
  var progressBar=progressWrap&&progressWrap.querySelector('.progress-bar');
  if(storyBody&&progressWrap&&progressBar){
    var progressFrame=0;
    var updateProgress=function(){
      progressFrame=0;
      var r=storyBody.getBoundingClientRect();
      var start=r.top+scrollY,end=r.bottom+scrollY,denom=end-innerHeight-start;
      var p=denom>0?Math.min(1,Math.max(0,(scrollY-start)/denom)):1;
      progressBar.style.transform='scaleX('+p.toFixed(4)+')';
      progressWrap.style.opacity=Math.min(1,Math.max(0,(scrollY-100)/40)).toFixed(2);
    };
    var scheduleProgress=function(){if(!progressFrame)progressFrame=requestAnimationFrame(updateProgress)};
    addEventListener('scroll',scheduleProgress,{passive:true});
    addEventListener('resize',scheduleProgress,{passive:true});
    if(document.fonts)document.fonts.ready.then(scheduleProgress);
    updateProgress();
  }

  // A title too wide for its space shrinks just enough to fit: --fit
  // scales its CSS size. That is a long title in a wide face in a list
  // row (with its meta, when the meta shares the line), or a long word in
  // a story's title, on a phone. Only a row that keeps its title on one
  // line (the filling list) has a width to fit.
  var rows=document.querySelectorAll('.stories .story'),heads=document.querySelectorAll('.post-header h1');
  function setFit(el,w,room){if(room>0&&w>room)el.style.setProperty('--fit',(room/w).toFixed(3))}
  function fit(){
    rows.forEach(function(li){li.style.removeProperty('--fit')});
    heads.forEach(function(h){h.style.removeProperty('--fit')});
    rows.forEach(function(li){
      var a=li.querySelector('.story-title'),c=li.querySelector('.title-cell'),m=li.querySelector('.meta');
      if(!a||!c)return;
      var ms=m&&getComputedStyle(m),beside=ms&&ms.display!=='block'?m.getBoundingClientRect().width+parseFloat(ms.marginLeft)+4:0;
      setFit(li,a.getBoundingClientRect().width,c.clientWidth-2-beside);
    });
    heads.forEach(function(h){setFit(h,h.scrollWidth,h.clientWidth)});
  }
  if(rows.length||heads.length){
    var fitFrame=0;
    (document.fonts?document.fonts.ready:Promise.resolve()).then(fit);
    addEventListener('resize',function(){cancelAnimationFrame(fitFrame);fitFrame=requestAnimationFrame(fit)},{passive:true});
  }

  // Where the reader stopped in a story, so a later visit opens there. It is kept
  // as a paragraph and how far into it the window's top was, because a scroll
  // offset means nothing once the width or text size changes. Back, forward and
  // reload stay the browser's own, and a link to a place in the story wins. The
  // first screen of text doesn't count, and reaching the last line clears it, so
  // a finished story opens at its title again. Only the reader moving counts: a
  // page the browser or this code put somewhere, or one left idle in another tab,
  // says nothing about where they stopped.
  if(storyBody){
    var readKey='read:'+location.pathname,blocks=storyBody.children,readTimer=0,place=null,placeW=innerWidth,finished=false;
    var goTo=function(p){var b=blocks[p.i].getBoundingClientRect();scrollTo(0,scrollY+b.top+b.height*p.f)};
    var saveRead=function(){
      readTimer=0;
      var r=storyBody.getBoundingClientRect(),lo=0,hi=blocks.length-1;
      while(lo<hi){var mid=(lo+hi)>>1;if(blocks[mid].getBoundingClientRect().bottom>0)hi=mid;else lo=mid+1}
      var b=blocks[lo].getBoundingClientRect();
      // Above the text there is no paragraph to hold on to.
      place=!lo&&b.top>0?null:{i:lo,f:+(-b.top/b.height).toFixed(3),n:blocks.length};
      if(!moved)return;
      // A nudge back up after the last line, to reach the nav, doesn't undo finishing.
      if(r.bottom<innerHeight)finished=true;else if(r.bottom>2*innerHeight)finished=false;
      try{if(finished||r.top>-innerHeight)localStorage.removeItem(readKey);else localStorage.setItem(readKey,JSON.stringify(place))}catch(e){}
    };
    var kept=null;try{kept=JSON.parse(localStorage.getItem(readKey))}catch(e){}
    // A fresh visit starts at the top, where any scroll is the reader's. The entry's
    // name is the whole link: a text fragment (#:~:text=) is hidden from location.
    var entry=performance.getEntriesByType('navigation')[0];
    var moved=entry&&entry.type==='navigate'&&entry.name.indexOf('#')<0;
    if(moved&&kept&&kept.n===blocks.length){
      moved=false;place=kept;goTo(kept);
      // The text face can arrive after this and move the text. That scroll is this
      // code's, so the nav doesn't read it as the reader scrolling back up.
      document.fonts.ready.then(function(){if(moved)return;goTo(kept);if(nav){nav.classList.add('hidden');lastY=scrollY}});
    }
    if(!moved)['wheel','touchstart','keydown','pointerdown'].forEach(function(t){addEventListener(t,function(){moved=true},{passive:true,once:true})});
    addEventListener('scroll',function(){if(!readTimer)readTimer=setTimeout(saveRead,300)},{passive:true});
    // Leaving saves only a scroll still waiting: another tab may have read further.
    var flush=function(){if(readTimer){clearTimeout(readTimer);saveRead()}};
    addEventListener('pagehide',flush);
    document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush()});
    // A rotated phone or a resized window reflows the text under the same scroll
    // offset. A phone's toolbars change only the height, and move no text.
    addEventListener('resize',function(){if(innerWidth===placeW)return;placeW=innerWidth;if(place)goTo(place)});
  }

  // Footer email signup, the form from markusstrasser.org: submit by
  // fetch and show the message in place; without JS the form still POSTs.
  var signup=document.querySelector('.site-signup .subscribe');
  if(signup){
    var signupMsg=signup.parentElement.querySelector('.subscribe-message');
    var signupBtn=signup.querySelector('button');
    var signupPage=signup.querySelector('input[name="_page"]');
    if(signupPage)signupPage.value=location.pathname;
    signup.addEventListener('submit',function(e){
      if(!window.fetch)return;
      e.preventDefault();
      signupBtn.disabled=true;
      fetch(signup.action,{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({email:signup.email.value,_source:'footer',_page:location.pathname})})
        .then(function(r){if(!r.ok)throw new Error();location.href=signup.getAttribute('data-success')||'/subscribed/';})
        .catch(function(){signupMsg.textContent='Something went wrong. Please try again.';signupMsg.className='subscribe-message error';signupMsg.setAttribute('role','alert');signupBtn.disabled=false;});
    });
    // Back from the success page restores this page with its button still disabled.
    addEventListener('pageshow',function(e){if(e.persisted)signupBtn.disabled=false});
  }

  // Hovering a title turns it, letter by letter at uneven speed, into Major Mono
  // Display; leaving resets it at once. The title (or, if it wraps, each
  // word) keeps its resting box, so nothing around it moves; the mono
  // letters keep the title's size, never distorted (see .morph in style.css).
  if(matchMedia('(prefers-reduced-motion: reduce)').matches||!matchMedia('(hover: hover)').matches)return;
  var mono=document.fonts?document.fonts.load('1em "Major Mono Display"'):Promise.resolve();
  // The mono text keeps the title's width and height about equally: its
  // size is the geometric mean of the size that makes it as wide as the
  // title and the size that makes its letters as tall as the title's (the
  // mean of x-height and capitals; Major Mono is unicase, so one height).
  // Major Mono is wider than every title face, so a hovered title grows a
  // little wider and a little shorter, never much of either.
  var cx=document.createElement('canvas').getContext('2d');
  function up(font,t){cx.font=font;return cx.measureText(t).actualBoundingBoxAscent}
  function heightSize(a,t,fontPx){
    var cs=getComputedStyle(a);
    var xs=function(s){return (s.match(/[acemnorsuvwxz]/g)||[]).join('')||s};
    var f=cs.fontStyle+' '+cs.fontWeight+' '+fontPx+'px '+cs.fontFamily,mf='400 100px "Major Mono Display"';
    var h=(up(f,xs(t))+up(f,t))/2,m=(up(mf,xs(t))+up(mf,t))/200;
    return m>0?h/m:fontPx;
  }
  document.querySelectorAll('.morph').forEach(function(a){
    var spans=null,words=null,text=null,timers=[],left=null,dir=0,running=false;
    function split(){
      var br=a.getBoundingClientRect(),box=br.width,boxH=br.height; // before splitting, which can shift kerning
      var inline=/^inline/.test(getComputedStyle(a).display);
      // Lines are counted on the text, one rect per line however tall the
      // face's glyphs (a block-level link, the newer/older row's, has one
      // box however many lines it wraps to), and before splitting, since
      // the letter spans add fragments.
      var lr=document.createRange();lr.selectNodeContents(a);
      var oneLine=lr.getClientRects().length===1,textW=lr.getBoundingClientRect().width;
      text=a.textContent;a.setAttribute('aria-label',text);a.textContent='';spans=[];words=[];
      var mi=document.createElement('span');mi.className='mi';
      text.split(/(\s+)/).forEach(function(part){
        if(!part)return;
        if(/^\s+$/.test(part)){mi.appendChild(document.createTextNode(part));return}
        var w=document.createElement('span');w.className='w';w.setAttribute('aria-hidden','true');
        var g=[];words.push(g);
        Array.from(part).forEach(function(ch){var s=document.createElement('span');s.textContent=ch;w.appendChild(s);g.push(spans.length);spans.push(s)});
        mi.appendChild(w);
      });
      a.appendChild(mi);
      var fontPx=parseFloat(getComputedStyle(a).fontSize);
      // Measure the text, not the box.
      var width=function(e){var r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect().width};
      var boxes=oneLine?[mi]:Array.from(a.querySelectorAll('.w'));
      a.style.whiteSpace='nowrap';
      // A one-line title's width is taken before splitting: WebKit does not
      // kern across the letter spans, which widens some titles (The Distaff
      // Texts by 1.5%).
      var rest=oneLine?[textW]:boxes.map(width);
      spans.forEach(function(s){s.className='mq'});
      var wide=boxes.map(width);
      spans.forEach(function(s){s.className=''});
      var widthSize=fontPx*Math.min.apply(null,rest.map(function(r,i){return r/wide[i]}));
      a.style.setProperty('--mono-size',Math.sqrt(heightSize(a,text,fontPx)*widthSize).toFixed(1)+'px');
      if(oneLine){
        // The link keeps its resting box, so nothing moves.
        var c=a.closest('.title-cell')||a.parentElement,cr=c.getBoundingClientRect(),ar=a.getBoundingClientRect();
        // The mono text may run past the title, up to the end of the title
        // column (the meta beside it fades meanwhile) or, in the newer/older
        // row, up to the other link; if it needs more, the other link fades
        // too (.spread) and it has the whole row. Only past that does it
        // shrink further.
        var nav=a.closest('.post-nav'),room=cr.right-ar.left-4;
        if(nav){
          var o=Array.from(nav.querySelectorAll('.morph')).filter(function(x){return x!==a})[0],or=o&&o.getBoundingClientRect();
          room=cr.width-(ar.width-textW);
          var need=wide[0]*parseFloat(a.style.getPropertyValue('--mono-size'))/fontPx,beside=or&&Math.abs(or.top-ar.top)<ar.height?or.width+24:0;
          if(need>room-beside)a.classList.add('spread');else room-=beside;
        }
        a.style.setProperty('--mfit',(room*fontPx/wide[0]).toFixed(1)+'px');
        // An inline title (the contents list) pins to its line height, so
        // the line it sits on keeps its height; a block-level link (a flex
        // item in the newer/older row) pins to its own resting box.
        var h=inline?(parseFloat(getComputedStyle(a).lineHeight)||boxH):boxH;
        a.style.boxSizing='border-box';a.style.width=box+'px';a.style.height=h+'px';a.classList.add('pinned');
      }else{
        // Wrapped: each word keeps its width and the mono letters shrink to fit.
        a.style.whiteSpace='';
        a.style.setProperty('--mfit',(fontPx*Math.min.apply(null,[1].concat(rest.map(function(r,i){return r/wide[i]})))).toFixed(1)+'px');
        boxes.forEach(function(w,i){w.style.setProperty('--w',rest[i]+'px')});
      }
    }
    // The whole title changes left to right, one letter at a time; each
    // waits a random time before the next, mostly short with rare pauses
    // (cubed random). A layout change under the pointer can fire mouseenter
    // again; 'running' keeps a second chain from starting on the same queue.
    function stop(){timers.forEach(clearTimeout);timers=[];running=false}
    function run(){
      if(running)return;
      running=true;
      // A title longer than 20 letters speeds up letter by letter, so the
      // sweep finishes in about the time a 20-letter title would. Letters
      // follow the clock, not the timer: where a step is slow to draw (Safari
      // took about 90 ms a step on a 33-letter title in Bitcount Double Ink,
      // whose glyphs are OpenType SVG), several turn together and the sweep
      // still takes the same time.
      var pace=Math.min(1,20/spans.length),next=performance.now();
      (function step(){
        var now=performance.now();
        while(left.length&&next<=now){
          spans[left.shift()].className='mm';
          var r=Math.random();next+=pace*(2.7+51.4*r*r*r);
        }
        if(!left.length){running=false;return}
        timers.push(setTimeout(step,next-now));
      })();
    }
    a.addEventListener('mouseenter',function(){dir=1;mono.then(function(){if(dir<1)return;if(!spans||a.textContent!==text){split();left=null}if(!left){left=[];words.forEach(function(g){left=left.concat(g)})}run()})});
    // A resize rescales the titles, so pins measured at the old size are
    // dropped; the next hover measures afresh. A click leaves the page with
    // the title morphed and no mouseleave, so a page restored from the
    // back/forward cache starts over too.
    function reset(){if(!spans)return;stop();dir=0;a.textContent=text;a.removeAttribute('style');a.removeAttribute('aria-label');a.classList.remove('pinned','spread');spans=null}
    addEventListener('resize',reset);
    addEventListener('pageshow',function(e){if(e.persisted)reset()});
    // Leaving resets the title at once; the morph only plays forwards.
    function leave(){dir=-1;stop();if(spans){spans.forEach(function(s){s.className=''});left=null}}
    a.addEventListener('mouseleave',leave);
  });
})();
