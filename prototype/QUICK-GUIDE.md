# A quick guide to the prototype

This is a practice tool with an invented barber shop and example labour prices. It is for testing the idea, not quoting a real job yet.

1. Open the prototype and choose the sample barber shop.
2. Switch between the plan and the four wall views. Select a fitting to see its position, height and work type.
   Tap Show details to open the controls. Hide details gives the drawing more room; on an iPad or computer, the panel folds into a narrow strip on the right.
3. Add a socket. The fitting count and labour total should change once.
4. Move that socket. Its position should change in the other views without adding another charge. A small wobble as you tap selects without moving it; a deliberate drag carries it from wherever you took hold, and one Undo puts it back.
   If two fittings sit at the same spot, the app asks which one you meant before selecting — it never guesses and never moves the wrong one.
5. Delete it, then use Undo and Redo. The drawing, quantities and price should follow together.
6. Try an unknown fitting or remove a labour rate. The page should say a price is missing, rather than making up a total.
7. Make a note or sketch. These explain the job; they do not create electrical items or charges.
   After using a Pencil, fingers move and zoom the plan. To draw with your finger, tap Finger drawing: off to turn it on, lift the Pencil away and wait a moment. Then choose Draw.
8. Download a backup, reload the page and try reopening the backup. The work and its rates should remain together.
9. Once the page says offline is ready, disconnect and reopen it. Use the same browser and address.
10. Open the labour breakdown, download the CSV and print the plan and wall views.

The prototype keeps one current job in this browser. Download backups for safekeeping or to move between devices. It does not sync to other devices. Real iPad/Pencil and Surface pen feel and palm rejection still need hands-on testing. Materials, cable calculations, circuit design and electrical compliance are outside this prototype.

If the old Details button remains after an update, refresh once more. Keep using the same browser and address so your saved job stays available.

If finger drawing still does not work, select Draw and try one line, then open Menu. The Drawing check at the bottom shows the version and what happened to your touch. It stays on your device. The latest version says “Electrical finger update 3”.

## Give several fittings the same height

To give several fittings the same height, tap **Set height for several** (in the Room details, or under a fitting's height field), tap each fitting, enter the height in mm and tap Apply. One Undo reverses it. Ceiling fittings aren't included.

- Tap a fitting again to take it off the list. Tapping empty space only moves the drawing; it never clears your list.
- You can pick fittings on different walls. Each row shows the fitting, its wall and its current height.
- Only the height changes. Position along the wall, work type, layer and price stay the same.
- If the box is blank or the height is above the room's ceiling, you get a message and nothing changes until you enter a valid height. Applying a height every chosen fitting already has does nothing and adds no Undo step.
- Cancel, Escape or choosing another tool leaves the list without changing anything. Hiding a layer removes its fittings from the list and tells you.

After typing a position or note, keep typing or tap another control — a valid edit commits on its own within a second, and closing or reloading the page saves it first. An invalid number is never saved: the field goes back to the last valid value, and the status next to the menu says when something still needs fixing. While you are typing, the status says “Unsaved changes — typing…” and only changes to “Saved on this device” once the job really is stored.

Forms with a Save button — Room size, Rates for this job and Job details — ask before they close on a stray background tap or Escape once you have edited them: **Keep editing** goes straight back to the form with your typing and caret as they were; **Throw away** closes it and loses only the unsaved typing (nothing is saved, and there is no Undo step for it). An untouched form still closes straight away, and the form's own Cancel always closes it without asking.

## Show different parts of the job

Choose **Try layers demo** for a made-up workshop with lights, sockets, fused spurs and three-phase points.

Tap **Layers** above the drawing. Choose Lighting, Sockets & spurs, Three-phase, or a mix. **Other / unassigned** keeps fittings that still need checking visible. **Show all** brings everything back. This works on the floor plan and all four walls.

Hiding a layer only hides it in the drawing. The fittings are still in the job, and the labour total still includes the whole job. Each fitting is counted once.

Select a fitting to change its layer. Changing its work type puts it in that type’s usual layer. Fused spurs and three-phase points start with no price: add your labour rate under **Rates for this job** when you have one.

Print defaults to all layers. You can instead print the layers currently shown; the drawing pages say which ones are included. The labour breakdown always covers the whole job. A backup saves the fittings and their layers. Reopening a job shows all layers again.

On small screens, you can scroll inside the Layers list. If the details panel covers the drawing controls, tap **Hide details** first. On phones, opening Layers closes details; opening details closes Layers.
