# A form sheet's buttons stack on a narrow screen instead of clipping Cancel

The shared form footer (Copy and Put on today, and Clear this day when it lands) placed its action and Cancel side by side at
every width. At 200% zoom on a 390px phone the column is about 163 CSS px, and Cancel ran out of its
button. Below a 20rem column the two buttons now stack, the action first; at 100% on a 360px phone
they stay side by side. Found by lane S's B2-ii review panel.
