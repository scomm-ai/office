/// <reference types="office-js" />

function onMessageSend(event: Office.AddinCommands.Event): void {
  console.info("[SComm] OnMessageSend stub — softBlock policy not wired in MVP");
  event.completed({ allowEvent: true });
}

function onMessageCompose(event: Office.AddinCommands.Event): void {
  console.info("[SComm] OnMessageCompose stub");
  event.completed({ allowEvent: true });
}

function onMessageDecrypt(event: Office.AddinCommands.Event): void {
  console.info("[SComm] OnMessageDecrypt stub — E2EE not finalized");
  event.completed({ allowEvent: true });
}

Office.onReady(() => {
  Office.actions.associate("onMessageSend", onMessageSend);
  Office.actions.associate("onMessageCompose", onMessageCompose);
  Office.actions.associate("onMessageDecrypt", onMessageDecrypt);
});

export { onMessageCompose, onMessageDecrypt, onMessageSend };
