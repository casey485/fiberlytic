/** True when a keyboard event's target is a place the user is typing text —
 *  global keyboard shortcuts (Delete/Escape/Ctrl+Z/etc.) must not fire while
 *  the user is editing a Notes/Production text field elsewhere on the page. */
export function isTypingTarget(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}
