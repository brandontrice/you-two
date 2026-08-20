export function inviteMessage(code: string) {
  return (
    `✦ YouTwo ✦\n` +
    `You've been chosen. One prompt, two photos, a running score — ` +
    `you and me, every day.\n\n` +
    `Your match code: ${code}\n\n` +
    `Open YouTwo, tap "Join with code", and enter it. ` +
    `Fair warning: I intend to win.`
  );
}
