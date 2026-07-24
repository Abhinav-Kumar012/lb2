// mermaid-init.js — loads mermaid from CDN and initializes
(function () {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

    script.onload = async () => {
        mermaid.initialize({
            startOnLoad: false,
            theme: "default",
        });

        document.querySelectorAll("pre code.language-mermaid").forEach(code => {
            const pre = code.parentElement;
            const div = document.createElement("div");
            div.className = "mermaid";
            div.textContent = code.textContent;
            pre.replaceWith(div);
        });

        await mermaid.run();
    };

    document.head.appendChild(script);
})();