# Accessibility

Dash is an ambient display: most of the time it is read from across a room, not operated. That shapes what it does well and where it falls short.

## What's there

- Large type throughout, with high-contrast text on both the light daytime sky and the dark night and music views. Every panel is checked for readability on the real hardware (a 10-inch tablet at about two metres).
- Keyboard navigation: arrow keys change panels, and the Settings screen is ordinary focusable HTML (tabs, inputs, buttons).
- Buttons have labels for screen readers (`aria-label`), in the display's language.
- Voice: with the assistant on, the shopping list, timers, notes, cooking mode and music can be used entirely by voice, and cooking steps are read aloud.
- Motion is limited to panel transitions, the slow news pan and the scrolling lyrics; with `prefers-reduced-motion` set, animations and transitions are turned off throughout.
- No information is conveyed by colour alone: live games carry a "LIVE" label, results say Win/Loss, warnings have text.

## Known limitations

- The rotating panels are not announced to screen readers; Dash is designed to be looked at, not listened to.
- Touch targets in the Settings screen are sized for a finger on a tablet but have not been tested with switch access or screen magnifiers.
- The wake word relies on the browser's speech recognition and is less reliable for some accents and in noisy kitchens; the microphone button is always available as an alternative.
- Wake on motion uses the camera and cannot distinguish people from pets or curtains.

## Reporting barriers

If something is hard to see, reach or use, please [open an issue](https://github.com/xavidop/dash/issues/new?template=bug_report.yml) and say what device, browser and language you're using. Accessibility problems are treated as bugs.
