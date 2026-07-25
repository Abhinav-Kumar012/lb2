// Custom JS for The Linux Encyclopedia

document.addEventListener('DOMContentLoaded', function() {
    // Add copy buttons to code blocks (excluding mermaid blocks)
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
});
