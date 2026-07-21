// Mermaid diagram rendering for mdBook
// Finds ```mermaid code blocks and renders them as SVG diagrams

document.addEventListener('DOMContentLoaded', function() {
    // Load mermaid.js from CDN
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    script.onload = function() {
        // Initialize mermaid with settings
        mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'loose',
            fontFamily: 'inherit',
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis'
            },
            sequence: {
                useMaxWidth: true
            },
            gantt: {
                useMaxWidth: true
            }
        });

        // Find all mermaid code blocks and render them
        var codeBlocks = document.querySelectorAll('code.language-mermaid');
        var counter = 0;
        
        codeBlocks.forEach(function(block) {
            counter++;
            var container = document.createElement('div');
            container.className = 'mermaid';
            container.id = 'mermaid-' + counter;
            container.textContent = block.textContent;
            
            // Replace the pre>code with the mermaid div
            var pre = block.parentElement;
            pre.parentElement.replaceChild(container, pre);
        });

        // Render all mermaid diagrams
        if (counter > 0) {
            mermaid.run({
                querySelector: '.mermaid'
            }).catch(function(error) {
                console.error('Mermaid rendering error:', error);
            });
        }
    };
    document.head.appendChild(script);
});
