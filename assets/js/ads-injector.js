document.addEventListener("DOMContentLoaded", function () {
    // Define the ad container markup
    function createAdSlot(slotId) {
        const adWrapper = document.createElement("div");
        adWrapper.className = "ad-slot max-w-7xl mx-auto px-6 my-8 text-center min-h-[90px]";
        adWrapper.setAttribute("aria-label", "Advertisement");

        adWrapper.innerHTML = `
            <p class="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Advertisement</p>
            <ins class="adsbygoogle"
                 style="display:block"
                 data-ad-client="ca-pub-4029002473204443"
                 data-ad-slot="${slotId}"
                 data-ad-format="auto"
                 data-full-width-responsive="true"></ins>
        `;
        return adWrapper;
    }

    // 1. Inject an ad above the main footer (Slot: Pairing Scheme - Bottom Banner)
    const footer = document.querySelector("footer");
    if (footer) {
        const footerAd = createAdSlot("3074931418");
        footer.parentNode.insertBefore(footerAd, footer);
        try { (adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) {}
    }

    // 2. Inject an ad near the top after the first available section or header container
    const topTarget = document.querySelector("main section, article section, header + div, section");
    if (topTarget) {
        const topAd = createAdSlot("1796763903"); // Pairing Scheme - Top Banner
        topTarget.after(topAd);
        try { (adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) {}
    }

    // 3. Inject a middle ad further down the page (targeting later sections if available)
    const allSections = document.querySelectorAll("section");
    if (allSections.length > 2) {
        const middleAd = createAdSlot("7998201012"); // Pairing Scheme - Middle 1
        allSections[Math.floor(allSections.length / 2)].after(middleAd);
        try { (adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) {}
    }
});
