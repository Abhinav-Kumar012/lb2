// Custom JS for The Linux Encyclopedia
document.addEventListener('DOMContentLoaded', function() {
    // Add copy buttons to code blocks (excluding mermaid)
    var codeBlocks = document.querySelectorAll('pre code:not(.language-mermaid)');
    codeBlocks.forEach(function(block) {
        var button = document.createElement('button');
        button.className = 'copy-button';
        button.textContent = 'Copy';
        button.style.cssText = 'position:absolute;top:4px;right:4px;padding:2px 8px;font-size:12px;cursor:pointer;background:#f0f0f0;border:1px solid #ccc;border-radius:3px;';
        block.parentElement.style.position = 'relative';
        block.parentElement.appendChild(button);
        button.addEventListener('click', function() {
            navigator.clipboard.writeText(block.textContent).then(function() {
                button.textContent = 'Copied!';
                setTimeout(function() { button.textContent = 'Copy'; }, 2000);
            });
        });
    });

    // Render mermaid: convert <pre><code class="language-mermaid"> to <div class="mermaid">
    var mermaidBlocks = document.querySelectorAll('pre code.language-mermaid');
    if (mermaidBlocks.length === 0) return;

    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    script.onload = function() {
        mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
        mermaidBlocks.forEach(function(code) {
            var pre = code.closest('pre');
            var div = document.createElement('div');
            div.className = 'mermaid';
            // textContent already decodes HTML entities
            div.textContent = code.textContent;
            if (pre) pre.replaceWith(div);
        });
        mermaid.run();
    };
    document.head.appendChild(script);
});
