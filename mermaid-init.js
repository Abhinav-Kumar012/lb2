// mermaid-init.js — decode HTML entities then render mermaid diagrams
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
  script.src = '../mermaid.min.js';
  script.onload = initMermaid;
  script.onerror = function() {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    s.onload = initMermaid;
    document.head.appendChild(s);
  };
  document.head.appendChild(script);
})();
