// mermaid-init.js — loads mermaid from CDN and initializes
(function() {
  var script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
  script.onload = function() {
    mermaid.initialize({ startOnLoad: true, theme: 'default' });
  };
  document.head.appendChild(script);
})();
