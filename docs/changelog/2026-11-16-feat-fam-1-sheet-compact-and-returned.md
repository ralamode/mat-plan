# A sheet with a tall footer keeps room for its list when the keyboard is up, and can announce after it closes

Two additions to the shared `Sheet` (`apps/web/components/ui/sheet.tsx`), for the program builder's item picker (FAM-1 step 9):

- **`compactBelow`:** the visual-viewport height below which the footer stops pinning and scrolls with the body. It defaults to 480 as before; that value was sized for a one-button footer. The item picker's footer is about 157–177px (picks, Add, Close), so with the phone keyboard up at 480–560px it left about one row of matches. The picker will pass about 580.
- **`onReturned`:** runs once per close, after focus has been returned to the trigger (or the `main` fallback). It's the safe moment for a page-level announcement such as "3 items added.", which the file's "What consumers owe" note already asked for but gave no hook for.

Lane B wires both into the item picker in its next step. The keyboard-up behaviour still needs checking on a real phone.
