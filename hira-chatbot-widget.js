async function respondToMsg(userText) {
  // Quick answer for contact details to save API bandwidth
  const lower = userText.toLowerCase();
  if (lower.includes('contact') || lower.includes('phone') || lower.includes('number')) {
    appendMessage("📞 <strong>Contact Details:</strong><br>• Sir Muhammad Tayyab: 0300 7242631<br>• Sir Mirza Abid: 0346 4645878<br>📍 Location: Near Masjid Usman Ghani, Model Town, Daska", 'bot');
    return;
  }

  // ⚠️ REPLACE WITH YOUR GOOGLE APPS SCRIPT WEB APP URL FROM STEP 2
  const scriptURL = "https://script.google.com/macros/s/YOUR_SCRIPT_ID_HERE/exec";

  try {
    const response = await fetch(scriptURL, {
      method: "POST",
      body: JSON.stringify({ message: userText })
    });
    const data = await response.json();
    appendMessage(data.reply, 'bot');
  } catch (err) {
    appendMessage("Assalamu Alaikum! For immediate help, call Sir Muhammad Tayyab at 0333 8114798.", 'bot');
  }
}
