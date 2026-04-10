/* ═══ Custom confirm/prompt dialogs ═══ */

export function customConfirm(msg, title = 'Confirmer') {
  return new Promise(resolve => {
    const dlg = document.getElementById("dlgConfirm");
    document.getElementById("dlgConfirmTitle").textContent = title;
    document.getElementById("dlgConfirmMsg").textContent = msg;
    const yes = document.getElementById("dlgConfirmYes"), no = document.getElementById("dlgConfirmNo");
    function cleanup(val) { yes.removeEventListener("click", onYes); no.removeEventListener("click", onNo); dlg.removeEventListener("close", onClose); resolve(val); }
    function onYes() { dlg.close(); cleanup(true); }
    function onNo() { dlg.close(); cleanup(false); }
    function onClose() { cleanup(false); }
    yes.addEventListener("click", onYes); no.addEventListener("click", onNo); dlg.addEventListener("close", onClose);
    dlg.showModal();
  });
}

export function customPrompt(msg, title = 'Saisie', defaultVal = '') {
  return new Promise(resolve => {
    const dlg = document.getElementById("dlgPrompt");
    document.getElementById("dlgPromptTitle").textContent = title;
    document.getElementById("dlgPromptMsg").textContent = msg;
    const input = document.getElementById("dlgPromptInput"); input.value = defaultVal;
    const yes = document.getElementById("dlgPromptYes"), no = document.getElementById("dlgPromptNo");
    function cleanup(val) { yes.removeEventListener("click", onYes); no.removeEventListener("click", onNo); dlg.removeEventListener("close", onClose); resolve(val); }
    function onYes() { dlg.close(); cleanup(input.value.trim() || null); }
    function onNo() { dlg.close(); cleanup(null); }
    function onClose() { cleanup(null); }
    yes.addEventListener("click", onYes); no.addEventListener("click", onNo); dlg.addEventListener("close", onClose);
    dlg.showModal(); setTimeout(() => input.focus(), 50);
  });
}
