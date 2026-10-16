document.addEventListener("DOMContentLoaded", function () {
    // Define the ad container markup
    function createAdSlot(slotId) {
        const adWrapper = document.createElement("div");
        adWrapper.className = "ad-slot container mx-auto px-6 my-8 text-center min-h-[90px]";
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

    // Example 1: Inject an ad above the main footer
    const footer = document.querySelector("footer");
    if (footer) {
        const footerAd = createAdSlot("1695682396");
        footer.parentNode.insertBefore(footerAd, footer);
        (adsbygoogle = window.adsbygoogle || []).push({});
    }

    // Example 2: Inject an ad after the first heading/article section
    const firstSection = document.querySelector("main section, article section");
    if (firstSection) {
        const topAd = createAdSlot("1695682396");
        firstSection.after(topAd);
        (adsbygoogle = window.adsbygoogle || []).push({});
    }
});
