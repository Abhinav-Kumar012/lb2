// mermaid-init.js — load mermaid from CDN, decode HTML entities, then render
(function() {
  function decodeEntities(str) {
    var ta = document.createElement('textarea');
    ta.innerHTML = str;
    return ta.value;
  }

  function initMermaid() {
    // Decode HTML entities in all mermaid <pre> blocks
    var blocks = document.querySelectorAll('pre.mermaid');
    blocks.forEach(function(block) {
      block.textContent = decodeEntities(block.innerHTML);
    });
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
  }

  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
  script.onload = initMermaid;
  document.head.appendChild(script);
})();
