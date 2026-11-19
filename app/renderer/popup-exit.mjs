const exits = new WeakMap();

export function cancelPopupExit(popup) {
  exits.get(popup)?.cancel();
  exits.delete(popup);
  popup.inert = false;
}

export function animatePopupExit(popup, anchor, finish = () => popup.remove()) {
  if (!popup) return;
  cancelPopupExit(popup);
  popup.inert = true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !popup.getClientRects().length) {
    finish();
    return;
  }
  const bounds = popup.getBoundingClientRect();
  const target = anchor?.getBoundingClientRect();
  const toward = (start, end) => Math.max(-6, Math.min(6, end - start));
  const x = target ? toward(bounds.x + bounds.width / 2, target.x + target.width / 2) : 0;
  const y = target ? toward(bounds.y + bounds.height / 2, target.y + target.height / 2) : -3;
  const style = getComputedStyle(popup);
  const motion = popup.animate([
    { opacity: style.opacity, transform: style.transform },
    { opacity: 0, transform: `translate(${x}px, ${y}px)` },
  ], { duration: 120, easing: 'ease-in', fill: 'forwards' });
  exits.set(popup, motion);
  motion.finished.then(() => {
    if (exits.get(popup) !== motion) return;
    exits.delete(popup);
    finish();
    motion.cancel();
  }, () => {});
}
