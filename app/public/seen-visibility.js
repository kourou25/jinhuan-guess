// A long card is judged against its clipped scroll viewport, not its full area.
export function seenCoverage(el) {
  if (!el.isConnected || !el.getClientRects().length) return false
  const win = el.ownerDocument.defaultView, rect = el.getBoundingClientRect()
  let left = 0, top = 0, right = win.innerWidth, bottom = win.innerHeight
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = win.getComputedStyle(p)
    const clipX = /auto|scroll|hidden|clip/.test(style.overflowX)
    const clipY = /auto|scroll|hidden|clip/.test(style.overflowY)
    if (!clipX && !clipY) continue
    const r = p.getBoundingClientRect()
    if (clipX) { left = Math.max(left, r.left + p.clientLeft); right = Math.min(right, r.left + p.clientLeft + p.clientWidth) }
    if (clipY) { top = Math.max(top, r.top + p.clientTop); bottom = Math.min(bottom, r.top + p.clientTop + p.clientHeight) }
  }
  const width = Math.max(0, Math.min(rect.right, right) - Math.max(rect.left, left))
  const height = Math.max(0, Math.min(rect.bottom, bottom) - Math.max(rect.top, top))
  const expectedWidth = Math.min(rect.width, right - left), expectedHeight = Math.min(rect.height, bottom - top)
  if (expectedWidth <= 0 || expectedHeight <= 0) return false
  return width >= expectedWidth * .97 && height >= expectedHeight * (rect.height > bottom - top ? .85 : .97)
}
