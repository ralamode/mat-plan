# Back works after making an item in the open picker

After "+ New item" saved an item while the item picker was open, closing the picker left a dead
history entry, so the next Back press did nothing. Next's router rewrites the current history entry
after a Server Action and drops the sheet's own key. The sheet now also remembers the URL it pushed
its entry at, and pops it on close when the entry is still there. A new e2e test makes an item,
closes the picker and checks one Back leaves the editor. The same fix covers Program order's
arrows, which save while their dialog stays open.
