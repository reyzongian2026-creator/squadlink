const button = document.querySelector('#install-app');
let installPrompt;
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
window.addEventListener('beforeinstallprompt', event => {
  if (!button) return;
  event.preventDefault();
  installPrompt = event;
  button.hidden = false;
});
button?.addEventListener('click', async () => {
  const prompt = installPrompt;
  if (!prompt) return;
  button.hidden = true;
  installPrompt = null;
  await prompt.prompt();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  if (button) button.hidden = true;
});
