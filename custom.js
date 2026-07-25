document.addEventListener("DOMContentLoaded", () => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
    script.async = true;

    script.onerror = () => {
        console.error("[mermaid] Failed to load mermaid.js from CDN");
    };

    script.onload = async () => {
        try {
            mermaid.initialize({
                startOnLoad: false,
                theme: "default",
                securityLevel: "loose",
            });

            // Convert <pre><code class="language-mermaid"> to <div class="mermaid">
            const codeBlocks = document.querySelectorAll("pre code.language-mermaid");
            codeBlocks.forEach(code => {
                const pre = code.closest("pre");
                const div = document.createElement("div");
                div.className = "mermaid";
                div.textContent = code.textContent;
                if (pre) {
                    pre.replaceWith(div);
                } else {
                    code.replaceWith(div);
                }
            });

            // Run mermaid on all converted blocks
            if (document.querySelectorAll(".mermaid").length > 0) {
                await mermaid.run();
            }
        } catch (e) {
            console.error("[mermaid] Rendering error:", e);
        }
    };

    document.head.appendChild(script);
});
